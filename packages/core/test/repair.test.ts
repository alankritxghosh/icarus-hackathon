import { describe, expect, it } from "vitest";
import {
  applyPatch,
  applySuggestion,
  diagnose,
  evaluateProgram,
  furnish,
  type Issue,
  issueCost,
  layoutOffice,
  OpSchema,
  type Patch,
  PatchSchema,
  type Program,
  readBrief,
  refineDesign,
  shellIsStated,
  suggestFixes,
} from "../src";

const BRIEFS = {
  east: "A 30-person firm with three meeting rooms, kitchen, lounge, reception, storage. 24 m by 15 m shell, windows on the west wall, entrance on the east.",
  roomy:
    "A 25-person team with two meeting rooms, kitchen, lounge, reception. 26 m by 16 m shell, windows on the north and south walls, entrance on the west.",
  tight:
    "A 40-person agency with four meeting rooms, a kitchen, lounge, reception, storage. 22 m by 14 m shell, windows on the south and east walls, entrance on the west.",
  assumed:
    "A 12-person startup. Open workspace, two meeting rooms, one phone booth, kitchen, reception, two restrooms. Windows on the north and south walls, entrance on the west.",
};
const program = (key: keyof typeof BRIEFS): Program => readBrief(BRIEFS[key]).program;
const FAST = { iterations: 1500, restarts: 2 };

describe("patches", () => {
  it("accepts only the closed set of operations, within range", () => {
    expect(OpSchema.safeParse({ op: "delete_everything" }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "scale_area", kind: "kitchen", factor: 3 }).success).toBe(
      false,
    );
    expect(OpSchema.safeParse({ op: "scale_area", kind: "sauna", factor: 1 }).success).toBe(false);
    expect(OpSchema.safeParse({ op: "grow_shell", factor: 0.8 }).success).toBe(false);
    expect(
      PatchSchema.safeParse({ ops: Array(7).fill({ op: "grow_shell", factor: 1.1 }), reason: "x" })
        .success,
    ).toBe(false);
  });

  it("clamps area bias, merges repeated pairs and caps their weight", () => {
    let p = program("roomy");
    const up: Patch = { ops: [{ op: "scale_area", kind: "kitchen", factor: 1.4 }], reason: "t" };
    for (let i = 0; i < 4; i++) p = applyPatch(p, up);
    expect(p.preferences.areaScale.kitchen).toBe(1.6);
    const pair: Patch = {
      ops: [{ op: "prefer_adjacent", a: "kitchen", b: "reception", weight: 2 }],
      reason: "t",
    };
    p = applyPatch(applyPatch(p, pair), pair);
    expect(p.preferences.adjacent.filter((x) => x.a === "kitchen" && x.b === "reception")).toEqual([
      { a: "kitchen", b: "reception", weight: 3 },
    ]);
  });

  it("never changes the facts: counts, headcount, and a stated shell stay as given", () => {
    const stated = program("roomy");
    expect(shellIsStated(stated)).toBe(true);
    const grown = applyPatch(stated, { ops: [{ op: "grow_shell", factor: 1.5 }], reason: "t" });
    expect(grown.shell).toEqual(stated.shell);
    expect(grown.company).toEqual(stated.company);
    expect(grown.rooms).toEqual(stated.rooms);
    const assumed = program("assumed");
    expect(shellIsStated(assumed)).toBe(false);
    const bigger = applyPatch(assumed, { ops: [{ op: "grow_shell", factor: 1.3 }], reason: "t" });
    expect(bigger.shell.widthM * bigger.shell.depthM).toBeGreaterThan(
      assumed.shell.widthM * assumed.shell.depthM,
    );
    expect(bigger.rooms).toEqual(assumed.rooms);
  });

  it("does not mutate the program it was given", () => {
    const p = program("roomy");
    const before = JSON.stringify(p);
    applyPatch(p, {
      ops: [
        { op: "scale_area", kind: "kitchen", factor: 1.2 },
        { op: "prefer_apart", a: "kitchen", b: "reception" },
      ],
      reason: "t",
    });
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe("diagnose", () => {
  it("measures what is wrong and costs only warnings and failures", () => {
    const p = program("tight");
    const plan = layoutOffice(p, { seed: 1, ...FAST });
    const issues = diagnose(plan, p, furnish(plan, p).report);
    const codes = new Set(issues.map((i) => i.code));
    expect(codes).toContain("program_too_big");
    expect(codes).toContain("workspace_density");
    expect(issues.find((i) => i.code === "program_too_big")?.severity).toBe("fail");
    const info: Issue = {
      code: "room_oversized",
      severity: "info",
      kinds: [],
      roomIds: [],
      measured: 2,
      target: 1.4,
      shortfall: 0,
      message: "",
    };
    expect(issueCost([info])).toBe(0);
    expect(issueCost([{ ...info, severity: "warn", shortfall: 0 }])).toBe(3);
    expect(issueCost([{ ...info, severity: "fail", shortfall: 0.5 }])).toBe(25);
  });

  it("reports a program that fits comfortably as having nothing to fix", () => {
    const p = program("roomy");
    const e = evaluateProgram(p, { seeds: [1], layout: FAST });
    expect(e.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });
});

describe("refineDesign", () => {
  it("fixes a missed adjacency by asking the solver for it, and the measured cost falls", async () => {
    const r = await refineDesign(program("east"));
    expect(r.baseline.issues.some((i) => i.code === "adjacency_missed")).toBe(true);
    expect(r.best.cost).toBeLessThan(r.baseline.cost * 0.5);
    expect(r.best.issues.filter((i) => i.severity !== "info")).toEqual([]);
    expect(r.rounds.some((x) => x.accepted && x.source === "rules")).toBe(true);
  }, 120_000);

  it("never ends worse than it started, and never alters the user's facts", async () => {
    for (const key of ["east", "roomy", "tight", "assumed"] as const) {
      const p = program(key);
      const r = await refineDesign(p, { layout: FAST, maxRounds: 2 });
      expect(r.best.cost, key).toBeLessThanOrEqual(r.baseline.cost + 1e-9);
      expect(r.best.program.company, key).toEqual(p.company);
      expect(r.best.program.rooms, key).toEqual(p.rooms);
      if (shellIsStated(p)) expect(r.best.program.shell, key).toEqual(p.shell);
    }
  }, 240_000);

  it("sizes a shell that was only assumed, and says it did", async () => {
    const p = program("assumed");
    const r = await refineDesign(p, { layout: FAST });
    expect(r.best.program.shell.widthM * r.best.program.shell.depthM).toBeGreaterThan(
      p.shell.widthM * p.shell.depthM,
    );
    expect(r.best.cost).toBeLessThan(r.baseline.cost * 0.4);
    expect(r.rounds.some((x) => /enlarge the shell/.test(x.description) && x.accepted)).toBe(true);
  }, 120_000);

  it("is deterministic", async () => {
    const a = await refineDesign(program("east"), { layout: FAST, maxRounds: 2 });
    const b = await refineDesign(program("east"), { layout: FAST, maxRounds: 2 });
    expect(a.rounds.map((x) => [x.source, x.accepted, x.cost])).toEqual(
      b.rounds.map((x) => [x.source, x.accepted, x.cost]),
    );
  }, 120_000);
});

describe("an advisor (the model's place in the loop)", () => {
  const helpful: Patch = {
    ops: [{ op: "prefer_adjacent", a: "lounge", b: "kitchen", weight: 2 }],
    reason: "Keep the social rooms together.",
  };

  it("is used when its patch is valid and helps", async () => {
    const r = await refineDesign(program("east"), {
      layout: FAST,
      advisor: { revise: async () => helpful },
    });
    const used = r.rounds.find((x) => x.source === "model");
    expect(used).toBeDefined();
    expect(used?.reason).toBe("Keep the social rooms together.");
  }, 120_000);

  it("is ignored, with a plain note, when its patch is invalid, and the rules take over", async () => {
    const r = await refineDesign(program("east"), {
      layout: FAST,
      advisor: { revise: async () => ({ ops: [{ op: "launch_rocket" }], reason: "x" }) },
    });
    expect(r.rounds.some((x) => x.source === "model")).toBe(false);
    expect(r.rounds.some((x) => x.source === "rules" && x.accepted)).toBe(true);
    expect(r.best.cost).toBeLessThan(r.baseline.cost);
  }, 120_000);

  it("survives a model that cannot be reached", async () => {
    const r = await refineDesign(program("east"), {
      layout: FAST,
      advisor: {
        revise: async () => {
          throw new Error("network");
        },
      },
    });
    expect(r.best.cost).toBeLessThan(r.baseline.cost);
  }, 120_000);

  it("cannot make the plan worse: a harmful patch is rejected by the measurement", async () => {
    const harmful: Patch = {
      ops: [
        { op: "scale_area", kind: "open_workspace", factor: 0.7 },
        { op: "prefer_apart", a: "kitchen", b: "lounge", weight: 3 },
      ],
      reason: "A bad idea.",
    };
    const r = await refineDesign(program("east"), {
      layout: FAST,
      maxRounds: 1,
      advisor: { revise: async () => harmful },
    });
    const model = r.rounds.find((x) => x.source === "model");
    expect(model).toBeDefined();
    if (model && !model.accepted) expect(r.best.cost).toBeLessThanOrEqual(r.baseline.cost);
    expect(r.best.cost).toBeLessThanOrEqual(r.baseline.cost + 1e-9);
  }, 120_000);
});

describe("suggestions for what the loop cannot fix", () => {
  it("offers only changes that were planned and measured to help, and they do", () => {
    const p = program("tight");
    const base = evaluateProgram(p, { seeds: [1], layout: FAST });
    const found = suggestFixes(p, base.issues, base);
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) {
      const after = evaluateProgram(applySuggestion(p, s), { seeds: [1, 2] });
      expect(after.cost, s.label).toBeLessThan(base.cost);
      expect(s.verified.open, s.label).toBeLessThan(
        base.issues.filter((i) => i.severity !== "info").length,
      );
    }
  }, 240_000);

  it("offers nothing for a program that already works", () => {
    const p = program("roomy");
    const base = evaluateProgram(p, { seeds: [1], layout: FAST });
    expect(suggestFixes(p, base.issues, base)).toEqual([]);
  }, 120_000);

  it("never offers to drop the last meeting room", () => {
    const p = program("tight");
    const base = evaluateProgram(p, { seeds: [1], layout: FAST });
    for (const s of suggestFixes(p, base.issues, base))
      if (s.change.kind === "drop_room" && s.change.roomKind === "meeting_room")
        expect(s.change.count).toBeLessThan(4);
  }, 240_000);
});

describe("when a failure is left", () => {
  it("tries more layouts of the same program, and keeps one only if it measures better", async () => {
    const p = program("tight");
    const r = await refineDesign(p, { layout: FAST, maxRounds: 1 });
    const more = r.rounds.find((x) => /six more layouts/.test(x.description));
    expect(more).toBeDefined();
    expect(r.best.cost).toBeLessThanOrEqual(r.baseline.cost + 1e-9);
    if (more && !more.accepted) expect(r.best.cost).toBeLessThanOrEqual(more.cost + 1e-9);
  }, 240_000);

  it("does not bother when nothing failed", async () => {
    const r = await refineDesign(program("roomy"), { layout: FAST });
    expect(r.rounds.some((x) => /six more layouts/.test(x.description))).toBe(false);
  }, 120_000);
});
