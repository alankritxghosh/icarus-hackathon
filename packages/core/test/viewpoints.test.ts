import { describe, expect, it } from "vitest";
import { EYE_HEIGHT_M, layoutOffice, type Program, type Side, viewpoints } from "../src";
import { demoProgram, must } from "./fixtures";

const sides: Side[] = ["north", "south", "east", "west"];
const withEntrance = (p: Program, entrance: Side): Program => ({
  ...p,
  shell: { ...p.shell, entrance },
});

describe("viewpoints", () => {
  for (const side of sides)
    it(`gives usable eye-level views with the entrance on the ${side}`, () => {
      const p = withEntrance(must(demoProgram()), side);
      const plan = layoutOffice(p, { seed: 1 });
      const views = viewpoints(plan);
      expect(views.length).toBeGreaterThanOrEqual(5);
      const entrance = views.find((view) => view.name === "Entrance");
      expect(entrance).toBeDefined();
      const inward = {
        north: [0, 1],
        south: [0, -1],
        east: [-1, 0],
        west: [1, 0],
      }[side];
      expect(Math.sign((entrance?.target[0] ?? 0) - (entrance?.position[0] ?? 0))).toBe(inward[0]);
      expect(Math.sign((entrance?.target[2] ?? 0) - (entrance?.position[2] ?? 0))).toBe(inward[1]);
      expect(new Set(views.map((v) => v.id)).size).toBe(views.length);
      for (const v of views) {
        expect(v.position[1], v.name).toBe(EYE_HEIGHT_M);
        expect(v.position[0], v.name).toBeGreaterThan(0);
        expect(v.position[0], v.name).toBeLessThan(plan.shell.w);
        expect(v.position[2], v.name).toBeGreaterThan(0);
        expect(v.position[2], v.name).toBeLessThan(plan.shell.h);
        const dx = v.target[0] - v.position[0];
        const dz = v.target[2] - v.position[2];
        expect(Math.hypot(dx, dz), `${v.name} looks somewhere`).toBeGreaterThan(1.5);
        if (v.roomId) {
          const room = plan.rooms.find((r) => r.id === v.roomId);
          if (!room) throw new Error(v.roomId);
          const r = room.rect;
          expect(v.position[0], `${v.name} stands in its room`).toBeGreaterThanOrEqual(r.x - 0.05);
          expect(v.position[0]).toBeLessThanOrEqual(r.x + r.w + 0.05);
          expect(v.position[2]).toBeGreaterThanOrEqual(r.y - 0.05);
          expect(v.position[2]).toBeLessThanOrEqual(r.y + r.h + 0.05);
        }
      }
    });

  it("looks from the workspace corner away from the windows", () => {
    const plan = layoutOffice(must(demoProgram()), { seed: 1 });
    const view = viewpoints(plan).find((v) => v.name === "Open workspace");
    if (!view) throw new Error("no workspace view");
    // The demo has windows on the south and east, so the view starts north-west and looks south-east.
    expect(view.target[0]).toBeGreaterThan(view.position[0]);
    expect(view.target[2]).toBeGreaterThan(view.position[2]);
  });
});
