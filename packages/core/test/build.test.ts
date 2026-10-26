import { describe, expect, it } from "vitest";
import {
  buildShell,
  type FloorPlan,
  KIND_RULES,
  layoutOffice,
  MATERIALS,
  type Program,
  type Scene,
  type SceneNode,
  type Side,
} from "../src";
import { demoProgram, must, smallProgram } from "./fixtures";

const FAST = { iterations: 1500, restarts: 2 };
const SIDES: Side[] = ["north", "south", "east", "west"];

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}
function box(node: SceneNode): Box {
  if (node.geometry.kind !== "box") throw new Error("expected a box");
  const [sx, sy, sz] = node.geometry.size;
  const [x, y, z] = node.position;
  return { min: [x - sx / 2, y - sy / 2, z - sz / 2], max: [x + sx / 2, y + sy / 2, z + sz / 2] };
}
const contains = (b: Box, p: [number, number, number], tol = 1e-3) =>
  [0, 1, 2].every(
    (i) =>
      p[i] !== undefined &&
      (p[i] as number) >= (b.min[i] as number) - tol &&
      (p[i] as number) <= (b.max[i] as number) + tol,
  );
const overlap = (a: Box, b: Box) =>
  [0, 1, 2].reduce(
    (v, i) =>
      v *
      Math.max(
        0,
        Math.min(a.max[i] as number, b.max[i] as number) -
          Math.max(a.min[i] as number, b.min[i] as number),
      ),
    1,
  );

const ofType = (scene: Scene, ...types: string[]) =>
  scene.nodes.filter((n) => types.includes(n.type));

function edgeSamples(
  r: { x: number; y: number; w: number; h: number },
  step = 0.1,
): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t <= r.w + 1e-9; t += step) out.push([r.x + t, r.y], [r.x + t, r.y + r.h]);
  for (let t = 0; t <= r.h + 1e-9; t += step) out.push([r.x, r.y + t], [r.x + r.w, r.y + t]);
  return out;
}

function check(plan: FloorPlan, scene: Scene) {
  const solid = ofType(scene, "wall", "door", "window", "frame").map(box);
  const walls = ofType(scene, "wall").map(box);
  const H = scene.ceilingM;

  // No gaps: every room boundary is closed by wall, door leaf, glazing or frame at eye height.
  for (const room of plan.rooms)
    for (const [sx, sz] of edgeSamples(room.rect)) {
      // On the shell perimeter the wall is outside the clear line; sample its middle, where glass and leaves sit.
      const [x, z] = [
        sx < 1e-6 ? -0.125 : Math.abs(sx - plan.shell.w) < 1e-6 ? plan.shell.w + 0.125 : sx,
        sz < 1e-6 ? -0.125 : Math.abs(sz - plan.shell.h) < 1e-6 ? plan.shell.h + 0.125 : sz,
      ];
      const p: [number, number, number] = [x, 1.0, z];
      expect(
        solid.some((b) => contains(b, p)),
        `${room.id} boundary at (${x.toFixed(2)}, ${z.toFixed(2)}) is closed`,
      ).toBe(true);
    }
  // The shell perimeter is closed too (just outside the clear line, where exterior walls sit).
  const { w, h } = plan.shell;
  for (let t = 0; t <= w; t += 0.1)
    for (const z of [-0.125, h + 0.125])
      expect(
        solid.some((b) => contains(b, [t, 1.0, z])),
        `north/south perimeter at ${t.toFixed(1)}`,
      ).toBe(true);
  for (let t = 0; t <= h; t += 0.1)
    for (const x of [-0.125, w + 0.125])
      expect(
        solid.some((b) => contains(b, [x, 1.0, t])),
        `east/west perimeter at ${t.toFixed(1)}`,
      ).toBe(true);

  // Doors and windows are real openings: nothing solid sits in the clear part of the gap.
  for (const door of ofType(scene, "door")) {
    const b = box(door);
    const clear: Box = {
      min: [b.min[0] + 0.02, 0.05, b.min[2] + 0.02],
      max: [b.max[0] - 0.02, 1.95, b.max[2] - 0.02],
    };
    // Thickness axis is the short one; open it up so a wall box beside the leaf would be caught.
    const grown: Box = {
      min: [
        clear.min[0] - (b.max[0] - b.min[0] < 0.1 ? 0.1 : 0),
        clear.min[1],
        clear.min[2] - (b.max[2] - b.min[2] < 0.1 ? 0.1 : 0),
      ],
      max: [
        clear.max[0] + (b.max[0] - b.min[0] < 0.1 ? 0.1 : 0),
        clear.max[1],
        clear.max[2] + (b.max[2] - b.min[2] < 0.1 ? 0.1 : 0),
      ],
    };
    for (const wall of walls)
      expect(overlap(grown, wall), `${door.name} is clear of walls`).toBeLessThan(1e-6);
  }
  for (const win of ofType(scene, "window")) {
    const b = box(win);
    const grown: Box = {
      min: [
        b.min[0] - (b.max[0] - b.min[0] < 0.1 ? 0.1 : 0),
        b.min[1] + 0.02,
        b.min[2] - (b.max[2] - b.min[2] < 0.1 ? 0.1 : 0),
      ],
      max: [
        b.max[0] + (b.max[0] - b.min[0] < 0.1 ? 0.1 : 0),
        b.max[1] - 0.02,
        b.max[2] + (b.max[2] - b.min[2] < 0.1 ? 0.1 : 0),
      ],
    };
    for (const wall of walls)
      expect(overlap(grown, wall), `${win.name} is clear of walls`).toBeLessThan(1e-6);
  }

  // Shared walls are built once: away from corners and openings, a point on an interior boundary is in exactly one wall box.
  for (const room of plan.rooms) {
    const r = room.rect;
    for (const [x, z] of edgeSamples(r, 0.25)) {
      const onShell = x < 1e-6 || z < 1e-6 || Math.abs(x - w) < 1e-6 || Math.abs(z - h) < 1e-6;
      const nearCorner =
        (Math.abs(x - r.x) < 0.2 || Math.abs(x - (r.x + r.w)) < 0.2) &&
        (Math.abs(z - r.y) < 0.2 || Math.abs(z - (r.y + r.h)) < 0.2);
      if (onShell || nearCorner) continue;
      const p: [number, number, number] = [x, 0.5, z];
      const hits = walls.filter((b) => contains(b, p, 1e-6)).length;
      const inOpening = ofType(scene, "door", "window", "frame").some((n) => contains(box(n), p));
      if (!inOpening)
        expect(hits, `${room.id} wall at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThanOrEqual(
          2,
        );
    }
  }

  // Sanity on every node.
  for (const n of scene.nodes) {
    expect(MATERIALS[n.material], `${n.id} material`).toBeDefined();
    if (n.geometry.kind === "box") for (const v of n.geometry.size) expect(v).toBeGreaterThan(0);
    for (const v of n.position) expect(Number.isFinite(v)).toBe(true);
  }
  expect(new Set(scene.nodes.map((n) => n.id)).size).toBe(scene.nodes.length);
  for (const wall of ofType(scene, "wall")) expect(box(wall).max[1]).toBeLessThanOrEqual(H + 1e-6);
}

describe("buildShell", () => {
  const program = demoProgram();
  const plan = layoutOffice(program, { seed: 1 });
  const scene = buildShell(plan);

  it("builds floors, a ceiling, walls, a door for every room plus the entrance, and windows", () => {
    expect(ofType(scene, "floor")).toHaveLength(plan.rooms.length + plan.circulation.length);
    expect(ofType(scene, "ceiling")).toHaveLength(1);
    expect(ofType(scene, "door")).toHaveLength(plan.rooms.length + 1);
    expect(ofType(scene, "wall").length).toBeGreaterThan(plan.rooms.length);
    expect(ofType(scene, "window").length).toBeGreaterThan(0);
    expect(ofType(scene, "frame").length).toBeGreaterThan(0);
    expect(scene.nodes.find((n) => n.name === "Entrance door")).toBeDefined();
  });

  it("closes every room, leaves every opening clear, and builds shared walls once", () => {
    check(plan, scene);
  });

  it("puts the entrance door in the entrance wall at the lobby", () => {
    const door = must(scene.nodes.find((n) => n.name === "Entrance door"));
    expect(door.position[0]).toBeCloseTo(-0.125, 3);
    expect(door.position[2]).toBeCloseTo(plan.entrance.y, 3);
  });

  it("only puts windows on window walls, only in rooms that want daylight", () => {
    const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
    for (const win of ofType(scene, "window")) {
      const room = must(rooms.get(must(win.roomId)));
      expect(["avoid", "none"]).not.toContain(KIND_RULES[room.kind].daylight);
      const [x, , z] = win.position;
      const onSouth = Math.abs(z - (plan.shell.h + 0.125)) < 1e-3;
      const onEast = Math.abs(x - (plan.shell.w + 0.125)) < 1e-3;
      expect(onSouth || onEast, `${win.id} is on the south or east wall`).toBe(true);
    }
  });

  it("uses a floor finish that matches the room", () => {
    expect(must(scene.nodes.find((n) => n.id === "floor.restroom.1")).material).toBe("floor.tile");
    expect(must(scene.nodes.find((n) => n.id === "floor.open_workspace.1")).material).toBe(
      "floor.carpet",
    );
  });

  it("is deterministic", () => {
    expect(buildShell(plan)).toEqual(scene);
  });

  it("follows the ceiling height", () => {
    const tall = demoProgram();
    tall.shell.ceilingM = 3.4;
    const s = buildShell(layoutOffice(tall, { seed: 1, ...FAST }));
    expect(s.ceilingM).toBe(3.4);
    expect(must(s.nodes.find((n) => n.id === "ceiling")).position[1]).toBeCloseTo(3.45, 6);
    check(layoutOffice(tall, { seed: 1, ...FAST }), s);
  });

  it.each(SIDES)("stays closed and clear for an entrance on the %s wall", (entrance) => {
    const p: Program = demoProgram({
      entrance,
      windows: entrance === "north" || entrance === "south" ? ["east", "west"] : ["north", "south"],
    });
    const pl = layoutOffice(p, { seed: 4, ...FAST });
    check(pl, buildShell(pl));
  });

  it("builds a small office and one with no windows", () => {
    const small = layoutOffice(smallProgram(), { seed: 2, ...FAST });
    check(small, buildShell(small));
    const dark = demoProgram({ windows: [] });
    const darkPlan = layoutOffice(dark, { seed: 1, ...FAST });
    const darkScene = buildShell(darkPlan);
    expect(ofType(darkScene, "window")).toHaveLength(0);
    check(darkPlan, darkScene);
  });
});
