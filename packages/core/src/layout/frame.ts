import type { Rect, Side } from "../geometry";

/**
 * The layout is solved in one canonical frame: the entrance on the west wall and rooms in
 * horizontal rows. Any real shell is turned into that frame and the result turned back, so the
 * search only ever has to solve one orientation.
 */
export interface Frame {
  /** Canonical width (along the rows) and depth (across them). */
  W: number;
  D: number;
  side: (s: Side) => Side;
  unside: (s: Side) => Side;
  rect: (r: Rect) => Rect;
  unrect: (r: Rect) => Rect;
  point: (x: number, y: number) => [number, number];
  unpoint: (x: number, y: number) => [number, number];
}

const norm = (a: [number, number], b: [number, number]): Rect => ({
  x: Math.min(a[0], b[0]),
  y: Math.min(a[1], b[1]),
  w: Math.abs(a[0] - b[0]),
  h: Math.abs(a[1] - b[1]),
});

const SWAP_EW: Record<Side, Side> = { north: "north", south: "south", east: "west", west: "east" };
const TRANSPOSE: Record<Side, Side> = {
  north: "west",
  south: "east",
  west: "north",
  east: "south",
};
const TRANSPOSE_BACK: Record<Side, Side> = {
  west: "north",
  east: "south",
  north: "west",
  south: "east",
};
// South entrance: (x, y) -> (h - y, x). North of the original lands on the canonical east wall.
const SOUTH: Record<Side, Side> = { south: "west", north: "east", west: "north", east: "south" };
const SOUTH_BACK: Record<Side, Side> = {
  west: "south",
  east: "north",
  north: "west",
  south: "east",
};

export function makeFrame(shell: { w: number; h: number }, entrance: Side): Frame {
  const { w, h } = shell;
  const build = (
    W: number,
    D: number,
    fwd: (x: number, y: number) => [number, number],
    back: (x: number, y: number) => [number, number],
    side: Record<Side, Side>,
    unside: Record<Side, Side>,
  ): Frame => ({
    W,
    D,
    side: (s) => side[s],
    unside: (s) => unside[s],
    point: fwd,
    unpoint: back,
    rect: (r) => norm(fwd(r.x, r.y), fwd(r.x + r.w, r.y + r.h)),
    unrect: (r) => norm(back(r.x, r.y), back(r.x + r.w, r.y + r.h)),
  });
  switch (entrance) {
    case "west":
      return build(
        w,
        h,
        (x, y) => [x, y],
        (x, y) => [x, y],
        { north: "north", south: "south", east: "east", west: "west" },
        { north: "north", south: "south", east: "east", west: "west" },
      );
    case "east":
      return build(
        w,
        h,
        (x, y) => [w - x, y],
        (x, y) => [w - x, y],
        SWAP_EW,
        SWAP_EW,
      );
    case "north":
      return build(
        h,
        w,
        (x, y) => [y, x],
        (x, y) => [y, x],
        TRANSPOSE,
        TRANSPOSE_BACK,
      );
    case "south":
      return build(
        h,
        w,
        (x, y) => [h - y, x],
        (x, y) => [y, h - x],
        SOUTH,
        SOUTH_BACK,
      );
  }
}
