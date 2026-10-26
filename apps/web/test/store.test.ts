import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBuilds } from "../src/store";

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
