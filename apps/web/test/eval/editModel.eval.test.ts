import { writeFileSync } from "node:fs";
import {
  centre,
  type Edit,
  type EditOp,
  EditSchema,
  readBrief,
  refineDesign,
  understandEdit,
} from "@icarus/core";
import { describe, expect, it } from "vitest";
import { EVAL_BRIEFS } from "./briefs";

/**
 * How well a model reads requests the fixed grammar cannot: free-form sentences, synonyms, several
 * requests in one, and things that cannot be done. Each case has the operations a careful person
 * would expect, and the model's answer is scored against them. Needs the Worker with a model route
 * (EVAL_EDGE, for example http://localhost:8789) and a results file (EVAL_OUT). Skipped otherwise.
 * Run it once per route (free Llama, Muse Spark) and compare the files.
 */
const edge = process.env.EVAL_EDGE;
const suite = edge ? describe : describe.skip;

type Expect =
  | { op: "move_room"; kind: string; to: string }
  | { op: "swap_rooms"; kinds: [string, string] }
  | { op: "resize_room"; kind: string; direction: "bigger" | "smaller" }
  | { op: "add_phone_booths"; count?: number }
  | { op: "remove_phone_booths"; count?: number }
  | { op: "add_room"; count?: number; capacity?: number }
  | { op: "remove_room" }
  | { op: "lock_room"; kind: string }
  | { op: "unlock_room"; kind: string };

export const CASES: { text: string; expect: Expect[]; unsupported?: true }[] = [
  {
    text: "I would like the lounge pushed over to the northern end of the floor",
    expect: [{ op: "move_room", kind: "lounge", to: "north" }],
  },
  {
    text: "relocate the pantry so it sits on the east side",
    expect: [{ op: "move_room", kind: "kitchen", to: "east" }],
  },
  {
    text: "can the kitchen live down at the southern edge instead",
    expect: [{ op: "move_room", kind: "kitchen", to: "south" }],
  },
  {
    text: "put the lounge on the west side please",
    expect: [{ op: "move_room", kind: "lounge", to: "west" }],
  },
  {
    text: "the lounge feels cramped, give it noticeably more space",
    expect: [{ op: "resize_room", kind: "lounge", direction: "bigger" }],
  },
  {
    text: "reception is bigger than we need, trim it a little",
    expect: [{ op: "resize_room", kind: "reception", direction: "smaller" }],
  },
  {
    text: "we need two more places to hold meetings, each for about eight people",
    expect: [{ op: "add_room", count: 2, capacity: 8 }],
  },
  {
    text: "one of the meeting rooms is surplus, drop the last one",
    expect: [{ op: "remove_room" }],
  },
  {
    text: "a couple more phone booths would be great",
    expect: [{ op: "add_phone_booths", count: 2 }],
  },
  {
    text: "we have one booth too many, take one out",
    expect: [{ op: "remove_phone_booths", count: 1 }],
  },
  {
    text: "keep reception exactly where it is whatever else changes",
    expect: [{ op: "lock_room", kind: "reception" }],
  },
  { text: "the kitchen may move again now", expect: [{ op: "unlock_room", kind: "kitchen" }] },
  {
    text: "trade places between the lounge and the kitchen",
    expect: [{ op: "swap_rooms", kinds: ["lounge", "kitchen"] }],
  },
  {
    text: "swap round the front desk and the kitchen",
    expect: [{ op: "swap_rooms", kinds: ["reception", "kitchen"] }],
  },
  {
    text: "send the kitchen east and give us one more phone booth",
    expect: [
      { op: "move_room", kind: "kitchen", to: "east" },
      { op: "add_phone_booths", count: 1 },
    ],
  },
  {
    text: "pin the lounge in place and then shove the kitchen to the north",
    expect: [
      { op: "lock_room", kind: "lounge" },
      { op: "move_room", kind: "kitchen", to: "north" },
    ],
  },
  { text: "make the whole building two storeys", expect: [], unsupported: true },
  { text: "add a swimming pool next to reception", expect: [], unsupported: true },
  { text: "paint all the walls blue", expect: [], unsupported: true },
  { text: "double the number of people who work here", expect: [], unsupported: true },
];

export function matches(got: EditOp[], want: Expect[], roomNames: Map<string, string>): boolean {
  if (got.length !== want.length) return false;
  const kind = (id: string) => (roomNames.get(id.toLowerCase()) ?? id).toLowerCase();
  return want.every((w) => {
    const g = got.find(
      (o) =>
        o.op === w.op &&
        (w.op !== "move_room" ||
          (o.op === "move_room" &&
            o.to === w.to &&
            kind(o.room).includes(w.kind.replace("_", " ").split(" ")[0] as string))),
    );
    if (!g) return false;
    switch (w.op) {
      case "move_room":
        return true;
      case "swap_rooms":
        return (
          g.op === "swap_rooms" &&
          w.kinds.every((k) =>
            [g.a, g.b].some((x) => kind(x).includes(k === "reception" ? "reception" : k)),
          )
        );
      case "resize_room":
        return (
          g.op === "resize_room" &&
          kind(g.room).includes(w.kind) &&
          (w.direction === "bigger" ? g.factor > 1 : g.factor < 1)
        );
      case "add_phone_booths":
      case "remove_phone_booths":
        return g.op === w.op && (w.count === undefined || g.count === w.count);
      case "add_room":
        return (
          g.op === "add_room" &&
          (w.count === undefined || g.count === w.count) &&
          (w.capacity === undefined || g.capacity === w.capacity)
        );
      case "remove_room":
        return g.op === "remove_room" && kind(g.room).includes("meeting");
      case "lock_room":
      case "unlock_room":
        return g.op === w.op && kind(g.room).includes(w.kind);
      default:
        return false;
    }
  });
}

suite("model reading of free-form edit requests", () => {
  it("scores the answers", { timeout: 900_000 }, async () => {
    const brief = EVAL_BRIEFS[0]?.brief ?? "";
    const base = (await refineDesign(readBrief(brief).program)).best;
    const roomNames = new Map(
      base.plan.rooms.flatMap(
        (r) =>
          [
            [r.id.toLowerCase(), r.name.toLowerCase()],
            [r.name.toLowerCase(), r.name.toLowerCase()],
          ] as [string, string][],
      ),
    );
    const rooms = base.plan.rooms.map((r) => {
      const [x, y] = centre(r.rect);
      return { id: r.id, name: r.name, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });
    const rows: unknown[] = [];
    let valid = 0;
    let right = 0;
    let unsupportedRight = 0;
    let unsupportedCases = 0;
    let model = "";
    for (const c of CASES) {
      const grammar = understandEdit(c.text, {
        phoneBooths: base.program.phoneBooths,
        meetingRooms: base.plan.rooms.filter((r) => r.kind === "meeting_room").length,
        names: base.plan.rooms.map((r) => r.name),
      }).kind;
      const started = performance.now();
      let status = 0;
      let edit: Edit | undefined;
      let error: string | undefined;
      try {
        const res = await fetch(`${edge}/api/design/edit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: c.text,
            program: base.program,
            rooms,
            shell: { w: base.plan.shell.w, h: base.plan.shell.h },
          }),
        });
        status = res.status;
        const data = (await res.json()) as { edit?: unknown; model?: string; error?: string };
        model = data.model ?? model;
        const parsed = EditSchema.safeParse(data.edit);
        if (parsed.success) edit = parsed.data;
        else error = data.error ?? "unusable answer";
      } catch (e) {
        error = e instanceof Error ? e.message : "failed";
      }
      const ms = Math.round(performance.now() - started);
      const ok =
        !!edit &&
        (c.unsupported
          ? edit.ops.length === 0 && !!edit.unsupported
          : matches(edit.ops, c.expect, roomNames));
      if (edit) valid++;
      if (c.unsupported) {
        unsupportedCases++;
        if (ok) unsupportedRight++;
      } else if (ok) right++;
      rows.push({
        text: c.text,
        grammarWouldRead: grammar !== "unknown",
        status,
        ms,
        ok,
        ops: edit?.ops,
        unsupported: edit?.unsupported,
        error,
      });
    }
    const asked = CASES.length;
    writeFileSync(
      process.env.EVAL_OUT ?? "/tmp/edit-model-eval.json",
      JSON.stringify(
        {
          model,
          asked,
          validAnswers: valid,
          readRight: right,
          doable: asked - unsupportedCases,
          unsupportedFlagged: unsupportedRight,
          unsupportedCases,
          rows,
        },
        null,
        2,
      ),
    );
  });
});

// The scoring must be right before it is trusted with a paid model: this needs no model.
describe("edit-model scoring", () => {
  const names = new Map([
    ["kitchen.1", "kitchen"],
    ["lounge.1", "lounge"],
    ["reception.1", "reception"],
    ["meeting_room.2", "meeting room 2"],
  ]);
  const oracle = (e: Expect): EditOp => {
    switch (e.op) {
      case "move_room":
        return { op: "move_room", room: `${e.kind}.1`, to: e.to as never };
      case "swap_rooms":
        return { op: "swap_rooms", a: `${e.kinds[0]}.1`, b: `${e.kinds[1]}.1` };
      case "resize_room":
        return {
          op: "resize_room",
          room: `${e.kind}.1`,
          factor: e.direction === "bigger" ? 1.3 : 0.8,
        };
      case "add_phone_booths":
        return { op: "add_phone_booths", count: e.count ?? 1 };
      case "remove_phone_booths":
        return { op: "remove_phone_booths", count: e.count ?? 1 };
      case "add_room":
        return {
          op: "add_room",
          kind: "meeting_room",
          count: (e.count ?? 1) as never,
          capacity: e.capacity,
        };
      case "remove_room":
        return { op: "remove_room", room: "meeting_room.2" };
      case "lock_room":
        return { op: "lock_room", room: `${e.kind}.1` };
      case "unlock_room":
        return { op: "unlock_room", room: `${e.kind}.1` };
    }
  };

  it("accepts the right operations for every doable case", () => {
    for (const c of CASES.filter((x) => !x.unsupported))
      expect(matches(c.expect.map(oracle), c.expect, names), c.text).toBe(true);
  });

  it("rejects wrong direction, wrong room, wrong count, missing and extra operations", () => {
    const find = (text: string) =>
      CASES.find((c) => c.text.includes(text)) as (typeof CASES)[number];
    const east = find("pantry");
    expect(matches([{ op: "move_room", room: "kitchen.1", to: "west" }], east.expect, names)).toBe(
      false,
    );
    expect(matches([{ op: "move_room", room: "lounge.1", to: "east" }], east.expect, names)).toBe(
      false,
    );
    const booth = find("couple more phone booths");
    expect(matches([{ op: "add_phone_booths", count: 1 }], booth.expect, names)).toBe(false);
    expect(matches([], booth.expect, names)).toBe(false);
    expect(
      matches(
        [oracle(booth.expect[0] as Expect), { op: "add_phone_booths", count: 1 }],
        booth.expect,
        names,
      ),
    ).toBe(false);
    const bigger = find("cramped");
    expect(
      matches([{ op: "resize_room", room: "lounge.1", factor: 0.8 }], bigger.expect, names),
    ).toBe(false);
    const lock = find("keep reception");
    expect(matches([{ op: "unlock_room", room: "reception.1" }], lock.expect, names)).toBe(false);
  });
});
