import type { FloorPlan } from "../layout/types";
import { FLOOR_BY_KIND, MATERIALS, type Scene, type SceneNode } from "./scene";
import { buildWalls } from "./walls";

export * from "./scene";
export { buildWalls, openings, wallRuns } from "./walls";

/** The shell, floors, walls with openings and ceiling for a plan. Furniture is added separately. */
export function buildShell(plan: FloorPlan): Scene {
  const ceilingM = plan.shell.ceilingM;
  const nodes: SceneNode[] = [];
  for (const room of plan.rooms) {
    const r = room.rect;
    nodes.push({
      id: `floor.${room.id}`,
      name: `${room.name} floor`,
      type: "floor",
      roomId: room.id,
      roomKind: room.kind,
      geometry: { kind: "box", size: [r.w, 0.05, r.h] },
      position: [r.x + r.w / 2, -0.025, r.y + r.h / 2],
      rotationY: 0,
      material: FLOOR_BY_KIND[room.kind],
      tags: ["floor"],
    });
  }
  for (const c of plan.circulation) {
    nodes.push({
      id: `floor.${c.id}`,
      name: c.kind === "lobby" ? "Entrance lobby floor" : "Corridor floor",
      type: "floor",
      roomId: c.id,
      geometry: { kind: "box", size: [c.rect.w, 0.05, c.rect.h] },
      position: [c.rect.x + c.rect.w / 2, -0.025, c.rect.y + c.rect.h / 2],
      rotationY: 0,
      material: c.kind === "lobby" ? "floor.wood.light" : "floor.corridor",
      tags: ["floor", "circulation"],
    });
  }
  nodes.push({
    id: "ceiling",
    name: "Ceiling",
    type: "ceiling",
    geometry: { kind: "box", size: [plan.shell.w, 0.1, plan.shell.h] },
    position: [plan.shell.w / 2, ceilingM + 0.05, plan.shell.h / 2],
    rotationY: 0,
    material: "ceiling",
    tags: ["ceiling"],
  });
  nodes.push(...buildWalls(plan, ceilingM));
  return { ceilingM, nodes, materials: MATERIALS, shell: { w: plan.shell.w, h: plan.shell.h } };
}
