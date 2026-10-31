import { layoutOffice, ProgramSchema } from "@icarus/core";
import { type DrawingEvidence, fromFloorPlan, SAVED_VERSION } from "@icarus/spatial/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuilds, loadDrawings, saveBuilds, saveDrawings } from "../src/store";

const saved = (program: unknown) => ({
  id: "a",
  title: "t",
  brief: "b",
  program,
  plan: {},
  seed: 1,
  notes: [],
  editedAt: 1,
});
const program = {
  company: { headcount: 10 },
  shell: { widthM: 12, depthM: 9, windows: [], entrance: "west" },
  rooms: [{ kind: "open_workspace" }],
};
const validPlan = () => layoutOffice(ProgramSchema.parse(program), { seed: 1 });

afterEach(() => vi.unstubAllGlobals());

describe("loadBuilds", () => {
  it("gives a build saved before locks existed its defaults, and drops one that no longer parses", () => {
    const store = { icarus_builds: "" };
    store.icarus_builds = JSON.stringify([
      { ...saved(program), plan: validPlan() },
      { ...saved({ nonsense: true }), id: "b" },
    ]);
    vi.stubGlobal("localStorage", { getItem: () => store.icarus_builds });
    const builds = loadBuilds();
    expect(builds.map((b) => b.id)).toEqual(["a"]);
    expect(builds[0]?.program.locks).toEqual([]);
  });

  it("keeps valid projects when a stored entry or revision is damaged", () => {
    const entries = [
      null,
      { ...saved(program), plan: validPlan(), history: [null, { plan: {} }] },
      { ...saved(program), id: 4 },
      { ...saved(program), id: "broken", plan: {} },
    ];
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(entries) });
    const builds = loadBuilds();
    expect(builds.map((b) => b.id)).toEqual(["a"]);
    expect(builds[0]?.history).toEqual([]);
  });
});

describe("saved offices carry the spatial model", () => {
  const office = () => {
    const p = ProgramSchema.parse({
      ...program,
      rooms: [{ kind: "open_workspace" }, { kind: "reception" }],
    });
    return { p, plan: layoutOffice(p, { seed: 1 }) };
  };
  const write = (value: unknown) => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    });
    if (value !== undefined) store["icarus.builds.v1"] = JSON.stringify(value);
    return store;
  };

  it("upgrades a save from before the model existed, leaving the rest of it alone", () => {
    const { p, plan } = office();
    write([{ ...saved(p), plan }]);
    const [b] = loadBuilds();
    expect(b?.version).toBe(SAVED_VERSION);
    expect(b?.model?.spaces.length).toBe(plan.rooms.length + plan.circulation.length);
    expect(b?.plan).toEqual(plan);
    expect(b?.title).toBe("t");
  });

  it("replaces a stale model when the plan has changed, so the two cannot disagree", () => {
    const { p, plan } = office();
    const moved = { ...plan, rooms: plan.rooms.slice(1) };
    const store = write(undefined);
    saveBuilds([{ ...saved(p), plan: moved, version: 2, model: loadModelOf(plan) }]);
    const [b] = JSON.parse(store["icarus.builds.v1"] ?? "[]");
    expect(b.model.spaces.length).toBe(moved.rooms.length + moved.circulation.length);
  });

  it("does not offer a project whose plan would crash when opened", () => {
    const { plan } = office();
    write([{ ...saved(program), version: 2, model: loadModelOf(plan) }]); // plan: {}
    expect(loadBuilds()).toEqual([]);
  });

  it("restores the conversation and prior versions needed for chat undo", () => {
    const { p, plan } = office();
    const store = write(undefined);
    const conversation = [
      { id: "one", role: "you" as const, text: "Move the kitchen" },
      { id: "two", role: "icarus" as const, text: "Done." },
      { id: "working", role: "icarus" as const, text: "", working: true },
    ];
    saveBuilds([
      {
        ...saved(p),
        plan,
        conversation,
        history: [{ program: p, plan, seed: 1, notes: [] }],
      },
    ]);
    expect(store["icarus.builds.v1"]).toBeDefined();
    const [restored] = loadBuilds();
    expect(restored?.conversation?.map((m) => m.text)).toEqual(["Move the kitchen", "Done."]);
    expect(restored?.history?.[0]?.plan).toEqual(plan);
  });
});

describe("saved drawings", () => {
  it("restores a drawing, its editable evidence, undo state and conversation", () => {
    const { p, plan } = (() => {
      const p = ProgramSchema.parse(program);
      return { p, plan: layoutOffice(p, { seed: 1 }) };
    })();
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    });
    const model = fromFloorPlan(plan, { program: p });
    const evidence: DrawingEvidence = {
      schema: "icarus.drawing-evidence/0.1",
      source: "plan.pdf",
      wallRects: [[0, 0, 6000, 200]],
      supportRects: [],
      labels: [{ text: "OFFICE", at: [1000, 1000], role: "room" }],
    };
    saveDrawings([
      {
        id: "drawing-1",
        title: "Plan",
        model,
        evidence,
        sourceEvidence: evidence,
        history: [{ model, evidence }],
        editedAt: 10,
        conversation: [{ id: "one", role: "you", text: "Here is my plan" }],
      },
    ]);
    expect(loadDrawings()[0]?.model).toEqual(model);
    expect(loadDrawings()[0]?.evidence).toEqual(evidence);
    expect(loadDrawings()[0]?.sourceEvidence).toEqual(evidence);
    expect(loadDrawings()[0]?.history?.[0]?.model).toEqual(model);
    expect(loadDrawings()[0]?.conversation[0]?.text).toBe("Here is my plan");
  });
});

function loadModelOf(plan: ReturnType<typeof layoutOffice>) {
  return fromFloorPlan(plan);
}
