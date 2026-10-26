import { describe, expect, it } from "vitest";
import {
  type FloorPlan,
  facingSpan,
  layoutOffice,
  overlapArea,
  type Program,
  type Side,
  sharedEdge,
} from "../src";
import { planCost } from "../src/layout/cost";
import { makeFrame } from "../src/layout/frame";
import { realize } from "../src/layout/realize";
import { rng } from "../src/layout/search";
import { expandRooms } from "../src/program";
import { demoProgram, must, smallProgram } from "./fixtures";

const SIDES: Side[] = ["north", "south", "east", "west"];
const FAST = { iterations: 1500, restarts: 2 };

function assertValid(plan: FloorPlan, program: Program) {
  const shellArea = plan.shell.w * plan.shell.h;
  const all = [...plan.rooms.map((r) => r.rect), ...plan.circulation.map((c) => c.rect)];
  // Every room present exactly once.
  expect(plan.rooms.map((r) => r.id).sort()).toEqual(
    expandRooms(program)
      .map((r) => r.id)
      .sort(),
  );
  // Inside the shell, no overlaps, and together they tile it exactly.
  for (const r of all) {
    expect(r.x).toBeGreaterThanOrEqual(-1e-6);
    expect(r.y).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(plan.shell.w + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(plan.shell.h + 1e-6);
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      expect(overlapArea(must(all[i]), must(all[j]))).toBeLessThan(1e-6);
  expect(all.reduce((s, r) => s + r.w * r.h, 0)).toBeCloseTo(shellArea, 6);
  // Each door lies on the wall it names, within that wall, and opens onto circulation it touches.
  for (const room of plan.rooms) {
    const { door, rect } = room;
    const onWall =
      door.side === "north"
        ? Math.abs(door.y - rect.y)
        : door.side === "south"
          ? Math.abs(door.y - (rect.y + rect.h))
          : door.side === "west"
            ? Math.abs(door.x - rect.x)
            : Math.abs(door.x - (rect.x + rect.w));
    expect(onWall, `${room.id} door is on its wall`).toBeLessThan(1e-6);
    const along =
      door.side === "north" || door.side === "south"
        ? [door.x, rect.x, rect.x + rect.w]
        : [door.y, rect.y, rect.y + rect.h];
    expect(along[0] as number).toBeGreaterThanOrEqual((along[1] as number) - 1e-6);
    expect(along[0] as number).toBeLessThanOrEqual((along[2] as number) + 1e-6);
    const target = plan.circulation.find((c) => c.id === door.opensTo);
    expect(target, `${room.id} opens onto real circulation`).toBeDefined();
    expect(sharedEdge(rect, must(target).rect)).toBeGreaterThan(0.5);
  }
  // The lobby sits on the entrance wall and the front door is on it.
  const lobby = plan.circulation.find((c) => c.id === "lobby");
  expect(lobby).toBeDefined();
  const e = plan.entrance;
  const wallDistance =
    e.side === "west"
      ? e.x
      : e.side === "east"
        ? plan.shell.w - e.x
        : e.side === "north"
          ? e.y
          : plan.shell.h - e.y;
  expect(wallDistance).toBeCloseTo(0, 6);
}

describe("layoutOffice", () => {
  it("plans the demo office with every room, and a front door on the entrance wall", () => {
    const program = demoProgram();
    const plan = layoutOffice(program, { seed: 1 });
    assertValid(plan, program);
    expect(plan.rooms).toHaveLength(11);
    expect(plan.circulation.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SIDES)("produces a valid plan for an entrance on the %s wall", (entrance) => {
    const program = demoProgram({
      entrance,
      windows: entrance === "north" || entrance === "south" ? ["east"] : ["south"],
    });
    assertValid(layoutOffice(program, { seed: 3, ...FAST }), program);
  });

  it.each([1, 2, 3, 4, 5, 6])("is valid for seed %i", (seed) => {
    const program = demoProgram();
    assertValid(layoutOffice(program, { seed, ...FAST }), program);
  });

  it("handles a small office with a south entrance", () => {
    const program = smallProgram();
    const plan = layoutOffice(program, { seed: 2, ...FAST });
    assertValid(plan, program);
    expect(plan.entrance.side).toBe("south");
  });

  it("is reproducible: the same seed gives the identical plan", () => {
    const a = layoutOffice(demoProgram(), { seed: 7, ...FAST });
    const b = layoutOffice(demoProgram(), { seed: 7, ...FAST });
    expect(a).toEqual(b);
  });

  it("puts reception on the entrance lobby", () => {
    const plan = layoutOffice(demoProgram(), { seed: 1 });
    const reception = plan.rooms.find((r) => r.kind === "reception");
    const lobby = plan.circulation.find((c) => c.id === "lobby");
    expect(
      sharedEdge(
        (reception as never as { rect: never }).rect,
        (lobby as never as { rect: never }).rect,
      ),
    ).toBeGreaterThan(0.5);
    expect(reception?.door.opensTo).toBe("lobby");
  });

  it("gives the open workspace daylight when windows exist, and keeps the server room off the glass", () => {
    const plan = layoutOffice(demoProgram(), { seed: 1 });
    const open = plan.rooms.find((r) => r.kind === "open_workspace");
    const server = plan.rooms.find((r) => r.kind === "server_room");
    const touchesWindow = (r: { x: number; y: number; w: number; h: number }) =>
      plan.shell.windows.some(
        (s) =>
          (s === "south" && Math.abs(r.y + r.h - plan.shell.h) < 1e-6) ||
          (s === "east" && Math.abs(r.x + r.w - plan.shell.w) < 1e-6) ||
          (s === "north" && r.y < 1e-6) ||
          (s === "west" && r.x < 1e-6),
      );
    expect(touchesWindow(must(open).rect)).toBe(true);
    expect(touchesWindow(must(server).rect)).toBe(false);
  });

  it("seats kitchen and lounge across or along a shared wall", () => {
    const plan = layoutOffice(demoProgram(), { seed: 1 });
    const kitchen = plan.rooms.find((r) => r.kind === "kitchen");
    const lounge = plan.rooms.find((r) => r.kind === "lounge");
    expect(
      facingSpan(
        (kitchen as never as { rect: never }).rect,
        (lounge as never as { rect: never }).rect,
        1.7,
      ),
    ).toBeGreaterThanOrEqual(1.5);
  });

  it("searches better than chance: the result beats the best of many random orderings", () => {
    const program = demoProgram();
    const plan = layoutOffice(program, { seed: 1 });
    const rooms = new Map(expandRooms(program).map((r) => [r.id, r]));
    const frame = makeFrame({ w: 24, h: 16 }, "west");
    const ctx = {
      rooms,
      W: frame.W,
      D: frame.D,
      windows: program.shell.windows.map((s) => frame.side(s)),
    };
    const random = rng(99);
    const ids = [...rooms.keys()];
    let bestRandom = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 300; i++) {
      const shuffled = [...ids].sort(() => random() - 0.5);
      const half = Math.ceil(shuffled.length / 2);
      bestRandom = Math.min(
        bestRandom,
        planCost(
          realize([shuffled.slice(0, half), shuffled.slice(half)], rooms, frame.W, frame.D),
          ctx,
        ).total,
      );
    }
    expect(plan.search.cost).toBeLessThan(bestRandom);
  });

  it("still produces valid geometry when the program cannot fit, and says what gave way", () => {
    const program = demoProgram({ widthM: 12, depthM: 10 });
    const plan = layoutOffice(program, { seed: 1, ...FAST });
    assertValid(plan, program);
    expect(plan.diagnostics.some((d) => d.level === "warn" || d.level === "fail")).toBe(true);
  });

  it("finishes in interactive time", () => {
    const t = performance.now();
    layoutOffice(demoProgram(), { seed: 1 });
    expect(performance.now() - t).toBeLessThan(4000);
  });
});
