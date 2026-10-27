import { describe, expect, it } from "vitest";
import { arrangementOf, layoutOffice, type Side, snapPlanToMm } from "../src";
import { demoProgram, smallProgram } from "./fixtures";

const SIDES: Side[] = ["north", "south", "east", "west"];

describe("arrangementOf", () => {
  it.each(SIDES)(
    "reads back the rows the engine realized, for an entrance on the %s",
    (entrance) => {
      for (const program of [
        demoProgram({ entrance }),
        { ...smallProgram(), shell: { ...smallProgram().shell, entrance } },
      ]) {
        for (const seed of [1, 2]) {
          const plan = layoutOffice(program, { seed });
          expect(arrangementOf(plan)).toEqual(plan.search.rows);
          // and a plan snapped to the millimetre grid still gives the same rows
          expect(arrangementOf(snapPlanToMm(plan))).toEqual(plan.search.rows);
        }
      }
    },
    60_000,
  );

  it("does not reproduce rows for rooms that are not in rows", () => {
    const plan = layoutOffice(demoProgram(), { seed: 1 });
    const moved = {
      ...plan,
      rooms: plan.rooms.map((r, i) =>
        i === 0 ? { ...r, rect: { ...r.rect, y: r.rect.y + 0.3 } } : r,
      ),
    };
    expect(arrangementOf(moved)).not.toEqual(plan.search.rows);
  });
});
