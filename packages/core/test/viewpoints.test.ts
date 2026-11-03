import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT_M,
  type FloorPlan,
  furnish,
  layoutOffice,
  type Program,
  ProgramSchema,
  type Side,
  viewpoints,
} from "../src";
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
    const view = viewpoints(plan).find((v) => v.roomId?.startsWith("open_workspace"));
    if (!view) throw new Error("no workspace view");
    // The demo has windows on the south and east, so the view starts north-west and looks south-east.
    expect(view.target[0]).toBeGreaterThan(view.position[0]);
    expect(view.target[2]).toBeGreaterThan(view.position[2]);
  });

  it("offers the 35-person studio's workspace, meeting rooms and kitchen, each on clear floor", () => {
    const program = must(demoProgram());
    const plan = layoutOffice(program, { seed: 1 });
    const { scene } = furnish(plan, program);
    const views = viewpoints(plan, scene).filter((v) => v.id.startsWith("room."));
    const kinds = new Set(views.map((v) => plan.rooms.find((r) => r.id === v.roomId)?.kind));
    for (const kind of ["open_workspace", "meeting_room", "kitchen"]) expect(kinds).toContain(kind);
    expect(views.filter((v) => v.roomId?.startsWith("meeting_room")).length).toBe(3);
    for (const v of views) {
      const [x, , z] = v.position;
      // Read from the scene, not the plan: the floor slab under the visitor belongs to the view's room.
      const floor = scene.nodes.find(
        (n) =>
          n.type === "floor" &&
          n.geometry.kind === "box" &&
          Math.abs(x - n.position[0]) < n.geometry.size[0] / 2 &&
          Math.abs(z - n.position[2]) < n.geometry.size[2] / 2 &&
          n.roomId === v.roomId,
      );
      expect(floor, `${v.name} stands on its own floor`).toBeDefined();
      for (const n of scene.nodes) {
        if (n.type !== "furniture" && n.type !== "fixture") continue;
        if (n.geometry.kind === "cylinder") continue;
        const [w, , d] = n.geometry.size;
        // The visitor's point in the piece's own frame must sit at least 0.3 m outside its footprint.
        const dx = x - n.position[0];
        const dz = z - n.position[2];
        const lx = Math.cos(n.rotationY) * dx - Math.sin(n.rotationY) * dz;
        const lz = Math.sin(n.rotationY) * dx + Math.cos(n.rotationY) * dz;
        const gap = Math.max(Math.abs(lx) - w / 2, Math.abs(lz) - d / 2);
        expect(gap, `${v.name} vs ${n.name}`).toBeGreaterThan(0.3);
      }
    }
  });

  it("finds a view in every meeting room of the live 4 Nov design, where a long table reaches the door", () => {
    const saved = JSON.parse(readFileSync(new URL("./studio-4nov.json", import.meta.url), "utf8"));
    const program = ProgramSchema.parse(saved.program);
    const plan = saved.plan as FloorPlan;
    const { scene } = furnish(plan, program);
    const views = viewpoints(plan, scene);
    for (const room of plan.rooms.filter((r) =>
      ["meeting_room", "kitchen", "lounge", "reception", "open_workspace"].includes(r.kind),
    )) {
      const view = views.find((v) => v.roomId === room.id);
      expect(view, room.id).toBeDefined();
      if (!view) continue;
      const [x, , z] = view.position;
      const r = room.rect;
      expect(x > r.x && x < r.x + r.w && z > r.y && z < r.y + r.h, `${room.id} stands inside`).toBe(
        true,
      );
    }
  });
});
