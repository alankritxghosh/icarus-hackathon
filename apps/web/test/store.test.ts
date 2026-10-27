import { layoutOffice, ProgramSchema } from "@icarus/core";
import { fromFloorPlan, SAVED_VERSION } from "@icarus/spatial/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuilds, saveBuilds } from "../src/store";

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

afterEach(() => vi.unstubAllGlobals());

describe("loadBuilds", () => {
  it("gives a build saved before locks existed its defaults, and drops one that no longer parses", () => {
    const store = { icarus_builds: "" };
    store.icarus_builds = JSON.stringify([
      saved(program),
      { ...saved({ nonsense: true }), id: "b" },
    ]);
    vi.stubGlobal("localStorage", { getItem: () => store.icarus_builds });
    const builds = loadBuilds();
    expect(builds.map((b) => b.id)).toEqual(["a"]);
    expect(builds[0]?.program.locks).toEqual([]);
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

  it("keeps a build whose plan cannot be converted instead of losing it", () => {
    write([saved(program)]); // plan: {}
    const [b] = loadBuilds();
    expect(b?.id).toBe("a");
    expect(b?.model).toBeUndefined();
  });
});

function loadModelOf(plan: ReturnType<typeof layoutOffice>) {
  return fromFloorPlan(plan);
}
