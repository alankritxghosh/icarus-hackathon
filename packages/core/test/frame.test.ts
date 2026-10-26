import { describe, expect, it } from "vitest";
import type { Side } from "../src";
import { makeFrame } from "../src/layout/frame";

const shell = { w: 24, h: 16 };
const SIDES: Side[] = ["north", "south", "east", "west"];

describe("canonical frame", () => {
  it.each(SIDES)("puts a %s entrance on the canonical west wall", (entrance) => {
    const f = makeFrame(shell, entrance);
    expect(f.side(entrance)).toBe("west");
    // Canonical dimensions swap when the rows must run the other way.
    expect([f.W, f.D]).toEqual(entrance === "west" || entrance === "east" ? [24, 16] : [16, 24]);
  });

  it.each(SIDES)(
    "round-trips rectangles, points and sides for an entrance on the %s",
    (entrance) => {
      const f = makeFrame(shell, entrance);
      const r = { x: 3, y: 2, w: 5, h: 4 };
      expect(f.unrect(f.rect(r))).toEqual(r);
      const [cx, cy] = f.point(7, 5);
      expect(f.unpoint(cx, cy)).toEqual([7, 5]);
      for (const s of SIDES) expect(f.unside(f.side(s))).toBe(s);
    },
  );

  it.each(SIDES)(
    "keeps the shell a rectangle of the same area for an entrance on the %s",
    (entrance) => {
      const f = makeFrame(shell, entrance);
      const whole = f.rect({ x: 0, y: 0, w: 24, h: 16 });
      expect(whole).toEqual({ x: 0, y: 0, w: f.W, h: f.D });
    },
  );

  it("maps a window side to the canonical side that faces the same real wall", () => {
    const f = makeFrame(shell, "north");
    // A point on the real south wall (y = 16) must land on the canonical east wall (x = W).
    const [cx] = f.point(10, 16);
    expect(cx).toBe(f.W);
    expect(f.side("south")).toBe("east");
  });
});
