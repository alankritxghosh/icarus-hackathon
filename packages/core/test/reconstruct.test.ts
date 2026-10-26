import { describe, expect, it } from "vitest";
import { fitRoom, type PointCloud } from "../src";

/** A seeded generator for the synthetic room. */
function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Room {
  /** Wall distances from the camera's foot, metres. */
  back: number;
  left: number;
  right: number;
  height: number;
  cameraHeight: number;
}

/**
 * Sample a box room as a camera would see it, with noise, then tilt the camera. The camera sits
 * at the origin of its own frame (x right, y down, z forward) after pitch and roll.
 */
function box(
  room: Room,
  opts: { pitchDeg?: number; rollDeg?: number; noise?: number; n?: number; clutter?: boolean } = {},
): PointCloud {
  const r = rand(7);
  const n = opts.n ?? 30000;
  const noise = opts.noise ?? 0.015;
  const pts: number[] = [];
  const add = (x: number, y: number, z: number) =>
    pts.push(x + (r() - 0.5) * noise * 2, y + (r() - 0.5) * noise * 2, z + (r() - 0.5) * noise * 2);
  for (let i = 0; i < n; i++) {
    const u = r();
    const v = r();
    const k = r();
    // Room frame: x right, y up from the floor, z forward. The camera is at (0, cameraHeight, 0).
    if (k < 0.3)
      add(-room.left + u * (room.left + room.right), 0, 0.5 + v * (room.back - 0.5)); // floor
    else if (k < 0.4)
      add(-room.left + u * (room.left + room.right), room.height, 0.5 + v * (room.back - 0.5)); // ceiling
    else if (k < 0.6)
      add(-room.left + u * (room.left + room.right), v * room.height, room.back); // back wall
    else if (k < 0.75)
      add(-room.left, v * room.height, 0.5 + u * (room.back - 0.5)); // left wall
    else if (k < 0.9)
      add(room.right, v * room.height, 0.5 + u * (room.back - 0.5)); // right wall
    else if (opts.clutter)
      add(-1 + u * 2, v * 0.75, 2 + (r() - 0.5) * 0.9); // a desk-height box
    else add(-room.left + u * (room.left + room.right), 0, 0.5 + v * (room.back - 0.5));
  }
  const pitch = ((opts.pitchDeg ?? 0) * Math.PI) / 180;
  const roll = ((opts.rollDeg ?? 0) * Math.PI) / 180;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 3) {
    // To camera coordinates: x right, y down, z forward, then rotate by pitch (about x) and roll (about z).
    let x = pts[i] as number;
    let y = room.cameraHeight - (pts[i + 1] as number);
    let z = pts[i + 2] as number;
    [y, z] = [y * Math.cos(pitch) - z * Math.sin(pitch), y * Math.sin(pitch) + z * Math.cos(pitch)];
    [x, y] = [x * Math.cos(roll) - y * Math.sin(roll), x * Math.sin(roll) + y * Math.cos(roll)];
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return {
    count: pts.length / 3,
    points: out,
    colors: new Uint8Array(pts.length),
    fovXDeg: 70,
    width: 1000,
    height: 700,
  };
}

const ROOM: Room = { back: 7, left: 3, right: 2.5, height: 2.8, cameraHeight: 1.5 };

describe("fitRoom on a synthetic room with known size", () => {
  it("recovers camera height, ceiling and walls to a few centimetres", () => {
    const fit = fitRoom(box(ROOM));
    if (!fit) throw new Error("no fit");
    expect(Math.abs(fit.cameraHeightM - 1.5)).toBeLessThan(0.05);
    expect(Math.abs((fit.ceilingHeightM ?? 0) - 2.8)).toBeLessThan(0.08);
    const back = fit.walls.find((w) => w.side === "back");
    const left = fit.walls.find((w) => w.side === "left");
    const right = fit.walls.find((w) => w.side === "right");
    expect(Math.abs((back?.distanceM ?? 0) - 7)).toBeLessThan(0.1);
    expect(Math.abs((left?.distanceM ?? 0) - 3)).toBeLessThan(0.1);
    expect(Math.abs((right?.distanceM ?? 0) - 2.5)).toBeLessThan(0.1);
  });

  it("still finds the floor and the height when the camera is tilted", () => {
    for (const [pitchDeg, rollDeg] of [
      [8, 0],
      [-6, 2],
      [12, -3],
    ] as const) {
      const fit = fitRoom(box(ROOM, { pitchDeg, rollDeg }));
      if (!fit) throw new Error(`no fit at ${pitchDeg}, ${rollDeg}`);
      expect(Math.abs(fit.cameraHeightM - 1.5), `${pitchDeg}/${rollDeg}`).toBeLessThan(0.08);
      expect(Math.abs((fit.ceilingHeightM ?? 0) - 2.8), `${pitchDeg}/${rollDeg}`).toBeLessThan(
        0.15,
      );
      const back = fit.walls.find((w) => w.side === "back");
      expect(Math.abs((back?.distanceM ?? 0) - 7), `${pitchDeg}/${rollDeg}`).toBeLessThan(0.2);
    }
  });

  it("does not mistake a desk-height box for a wall", () => {
    const fit = fitRoom(box(ROOM, { clutter: true }));
    if (!fit) throw new Error("no fit");
    expect(fit.walls.every((w) => w.distanceM > 2 || w.side !== "back")).toBe(true);
    expect(fit.walls.filter((w) => w.side === "back")).toHaveLength(1);
  });

  it("is deterministic", () => {
    const a = fitRoom(box(ROOM, { pitchDeg: 5 }));
    const b = fitRoom(box(ROOM, { pitchDeg: 5 }));
    expect(a?.cameraHeightM).toBe(b?.cameraHeightM);
    expect(a?.walls.map((w) => w.distanceM)).toEqual(b?.walls.map((w) => w.distanceM));
  });

  it("says so when there is no floor to find", () => {
    const wall = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      wall[i * 3] = (i % 30) * 0.1;
      wall[i * 3 + 1] = Math.floor(i / 30) * 0.1 - 1;
      wall[i * 3 + 2] = 4;
    }
    expect(
      fitRoom({
        count: 900,
        points: wall,
        colors: new Uint8Array(2700),
        fovXDeg: 60,
        width: 100,
        height: 100,
      }),
    ).toBeUndefined();
  });
});
