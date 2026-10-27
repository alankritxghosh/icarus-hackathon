import type { FloorPlan } from "@icarus/core";
import { beforeAll, describe, expect, it } from "vitest";
import { circulationGraph, fromFloorPlan, type Kernel, toFloorPlan, validate } from "../src";
import { plans } from "./fixtures";
import { testKernel } from "./kernelSetup";
import { samePlan } from "./samePlan";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});

describe("adapter", () => {
  for (const { name, program, plan } of plans()) {
    it(`${name}: converts, validates, is reachable and round-trips to the same plan`, () => {
      const model = fromFloorPlan(plan, { program });
      const { findings } = validate(model, k);
      expect(findings.filter((f) => f.level === "error")).toEqual([]);
      expect(circulationGraph(model, k).unreachable).toEqual([]);
      const back = toFloorPlan(model, { search: plan.search, diagnostics: plan.diagnostics });
      expect(back.unsupported).toEqual([]);
      expect(samePlan(plan, back.plan)).toEqual([]);
      // the solver's bookkeeping is carried by the caller, not the model
      expect(back.plan.search).toEqual(plan.search);
    });
  }

  it("capacity and locks come from the program", () => {
    const { program, plan } = plans()[0] as ReturnType<typeof plans>[number];
    const lock = plan.rooms.find((r) => r.kind === "kitchen");
    const model = fromFloorPlan(plan, {
      program: { ...program, locks: [{ id: lock?.id ?? "", x: 1, y: 1 }] },
    });
    expect(model.spaces.find((s) => s.id === lock?.id)?.locked).toBe(true);
    expect(model.spaces.filter((s) => s.locked)).toHaveLength(1);
    expect(model.spaces.find((s) => s.kind === "office.meeting_room")?.programme.capacity).toBe(6);
  });

  it("is deterministic and has stable ids", () => {
    const { program, plan } = plans()[0] as ReturnType<typeof plans>[number];
    expect(JSON.stringify(fromFloorPlan(plan, { program }))).toBe(
      JSON.stringify(fromFloorPlan(plan, { program })),
    );
    expect(fromFloorPlan(plan).walls.every((w) => /^wall\.[hv]\d+\.\d+-\d+$/.test(w.id))).toBe(
      true,
    );
  });

  it("models what the plan only implied: virtual walls, windows, door per room, unknown exterior structure", () => {
    const { plan } = plans()[0] as ReturnType<typeof plans>[number];
    const model = fromFloorPlan(plan);
    expect(model.walls.some((w) => w.kind === "virtual")).toBe(true);
    expect(model.openings.filter((o) => o.kind === "window").length).toBeGreaterThan(0);
    expect(model.openings.filter((o) => o.kind === "door" && !o.entrance)).toHaveLength(
      plan.rooms.length,
    );
    expect(
      model.walls.filter((w) => w.kind === "exterior").every((w) => w.structural === "unknown"),
    ).toBe(true);
  });

  it("keeps a glazed side even where no window fits on it", () => {
    const { plan } = plans()[0] as ReturnType<typeof plans>[number];
    const glazedAllSides = {
      ...plan,
      shell: {
        ...plan.shell,
        windows: ["north", "south", "east", "west"] as FloorPlan["shell"]["windows"],
      },
    };
    const model = fromFloorPlan(glazedAllSides);
    // strip every window opening: the sides must still come back
    const bare = { ...model, openings: model.openings.filter((o) => o.kind !== "window") };
    expect(toFloorPlan(bare).plan.shell.windows.sort()).toEqual(["east", "north", "south", "west"]);
  });

  it("says what a plan cannot hold instead of dropping it", () => {
    const { plan } = plans()[0] as ReturnType<typeof plans>[number];
    const model = fromFloorPlan(plan);
    const withColumn = {
      ...model,
      obstacles: [
        {
          id: "c1",
          levelId: "L0",
          kind: "column" as const,
          footprint: {
            outer: [
              { x: 5000, y: 5000 },
              { x: 5400, y: 5000 },
              { x: 5400, y: 5400 },
              { x: 5000, y: 5400 },
            ],
            holes: [],
          },
          provenance: { source: "generated" as const, evidence: [] },
        },
      ],
    };
    expect(toFloorPlan(withColumn).unsupported).toContain("columns, cores or other obstacles");
  });
});
