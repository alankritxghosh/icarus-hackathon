import { ProgramSchema } from "@icarus/core";
import { checkLessons, fromFloorPlan, teach } from "@icarus/spatial/model";
import { describe, expect, it } from "vitest";
import { rebuild } from "../src/design";
import { withItems } from "../src/modelChecks";

const program = ProgramSchema.parse({
  company: { headcount: 12 },
  shell: { widthM: 16, depthM: 10, windows: ["north"], entrance: "south" },
  rooms: [
    { kind: "open_workspace" },
    { kind: "meeting_room", count: 2, capacity: 4 },
    { kind: "kitchen" },
    { kind: "lounge" },
    { kind: "reception" },
  ],
});

describe("taught rules over a built office", () => {
  const built = rebuild(program, 1, []);
  const model = withItems(built, fromFloorPlan(built.plan, { program: built.program }));

  it("sees the furniture in each room as items", () => {
    expect(model.items.length).toBeGreaterThan(20);
    expect(new Set(model.items.map((i) => i.kind))).toEqual(
      expect.objectContaining(new Set(["desk", "chair", "plant"])),
    );
  });

  it("catches a plant where a taught rule forbids one, and nothing without the rule", () => {
    expect(checkLessons(model, []).filter((f) => f.code.startsWith("A-"))).toEqual([]);
    const anywhere = teach([], "don't use plants").lessons;
    expect(checkLessons(model, anywhere).length).toBeGreaterThan(0);
    const inLounge = teach([], "never put plants in the lounge").lessons;
    const hits = checkLessons(model, inLounge);
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every((f) => model.items.find((i) => i.id === f.ids[0])?.spaceId.startsWith("lounge")),
    ).toBe(true);
    expect(checkLessons(model, teach([], "never put plants in the storage room").lessons)).toEqual(
      [],
    );
  });
});
