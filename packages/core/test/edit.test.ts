import { describe, expect, it } from "vitest";
import {
  applyEdit,
  diagnose,
  EDIT_EXAMPLE,
  EditOpSchema,
  EditSchema,
  type Evaluation,
  evaluateProgram,
  expandRooms,
  furnish,
  type Issue,
  inZone,
  layoutOffice,
  lockTolerance,
  overlapArea,
  type Program,
  readBrief,
  refineDesign,
  resolveRoom,
  sharedEdge,
  understandEdit,
} from "../src";
import { must, smallProgram } from "./fixtures";

const FAST = { iterations: 1500, restarts: 2 };
const BRIEFS = {
  firm: "A 30-person firm with three meeting rooms, kitchen, lounge, reception, storage, two phone booths. 24 m by 15 m shell, windows on the south and east walls, entrance on the west.",
  roomy:
    "A 25-person team with two meeting rooms, kitchen, lounge, reception. 26 m by 16 m shell, windows on the north and south walls, entrance on the west.",
  northDoor:
    "A 20-person studio with two meeting rooms, kitchen, lounge, reception, storage, one phone booth. 20 m by 14 m shell, windows on the south and east walls, entrance on the north.",
};
const start = (key: keyof typeof BRIEFS): Evaluation =>
  evaluateProgram(readBrief(BRIEFS[key]).program, { seeds: [1, 2], layout: FAST });
const centreOf = (ev: Evaluation, id: string) => {
  const r = must(
    ev.plan.rooms.find((x) => x.id === id),
    id,
  ).rect;
  return [r.x + r.w / 2, r.y + r.h / 2] as [number, number];
};

function assertSound(ev: Evaluation) {
  const ids = ev.plan.rooms.map((r) => r.id).sort();
  expect(new Set(ids).size).toBe(ids.length);
  const all = [...ev.plan.rooms.map((r) => r.rect), ...ev.plan.circulation.map((c) => c.rect)];
  for (const r of all) {
    expect(r.x).toBeGreaterThanOrEqual(-1e-6);
    expect(r.y).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(ev.plan.shell.w + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(ev.plan.shell.h + 1e-6);
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      expect(overlapArea(must(all[i]), must(all[j]))).toBeLessThan(1e-6);
}
const failKeys = (issues: Issue[]) =>
  issues
    .filter((i) => i.severity === "fail")
    .map((i) => `${i.code}:${i.roomIds.join()}`)
    .sort();

describe("edit operations", () => {
  it("accepts only the closed set, within range", () => {
    expect(EditOpSchema.safeParse({ op: "delete_room", room: "kitchen" }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "move_room", room: "kitchen", to: "up" }).success).toBe(
      false,
    );
    expect(EditOpSchema.safeParse({ op: "add_phone_booths", count: 40 }).success).toBe(false);
    expect(EditOpSchema.safeParse({ op: "add_phone_booths", count: 0 }).success).toBe(false);
    expect(EditSchema.safeParse(EDIT_EXAMPLE).success).toBe(true);
    expect(EditSchema.safeParse({ ops: new Array(5).fill(EDIT_EXAMPLE.ops[0]) }).success).toBe(
      false,
    );
  });
});

describe("naming rooms", () => {
  const ev = start("firm");
  it("finds rooms by id, kind, number and ordinal", () => {
    expect(resolveRoom(ev.plan, "the kitchen")).toEqual({ ok: true, id: "kitchen.1" });
    expect(resolveRoom(ev.plan, "kitchen.1")).toEqual({ ok: true, id: "kitchen.1" });
    expect(resolveRoom(ev.plan, "meeting room 2")).toEqual({ ok: true, id: "meeting_room.2" });
    expect(resolveRoom(ev.plan, "the third meeting room")).toEqual({
      ok: true,
      id: "meeting_room.3",
    });
    expect(resolveRoom(ev.plan, "front desk")).toEqual({ ok: true, id: "reception.1" });
    expect(resolveRoom(ev.plan, "pantry")).toEqual({ ok: true, id: "kitchen.1" });
  });
  it("refuses an ambiguous or unknown room instead of guessing", () => {
    const many = resolveRoom(ev.plan, "meeting room");
    expect(many.ok).toBe(false);
    expect(many.ok ? "" : many.reason).toContain("say which one");
    const missing = resolveRoom(ev.plan, "sauna");
    expect(missing.ok).toBe(false);
    const tooHigh = resolveRoom(ev.plan, "the fifth meeting room");
    expect(tooHigh.ok ? "" : tooHigh.reason).toContain("only 3");
  });
});

describe("reading words", () => {
  const read = (text: string, booths = 2) => understandEdit(text, { phoneBooths: booths });
  it("reads the three headline requests", () => {
    expect(read("move the kitchen east")).toMatchObject({
      kind: "edit",
      ops: [{ op: "move_room", room: "the kitchen", to: "east" }],
    });
    expect(read("add a third phone booth")).toMatchObject({
      kind: "edit",
      ops: [{ op: "add_phone_booths", count: 1 }],
    });
    expect(read("Swap reception and lounge.")).toMatchObject({
      kind: "edit",
      ops: [{ op: "swap_rooms", a: "reception", b: "lounge" }],
    });
  });
  it("reads variants and several requests in one sentence", () => {
    expect(read("Please put the lounge on the north side of the office")).toMatchObject({
      ops: [{ op: "move_room", room: "the lounge", to: "north" }],
    });
    expect(read("add two more phone booths")).toMatchObject({
      ops: [{ op: "add_phone_booths", count: 2 }],
    });
    expect(read("remove a phone booth")).toMatchObject({
      ops: [{ op: "remove_phone_booths", count: 1 }],
    });
    expect(read("lock the kitchen")).toMatchObject({
      ops: [{ op: "lock_room", room: "the kitchen" }],
    });
    expect(read("unlock everything")).toMatchObject({ ops: [{ op: "unlock_room", room: "all" }] });
    const both = read("move the kitchen east and add a third phone booth");
    expect(both.kind === "edit" ? both.ops.map((o) => o.op) : []).toEqual([
      "move_room",
      "add_phone_booths",
    ]);
    // The "and" inside a swap is not a separator.
    expect(read("swap the lounge and the kitchen, then lock the lounge")).toMatchObject({
      ops: [{ op: "swap_rooms" }, { op: "lock_room" }],
    });
  });
  it("counts booths from what is there, and says so when nothing is needed", () => {
    expect(read("add a third phone booth", 0)).toMatchObject({
      ops: [{ op: "add_phone_booths", count: 3 }],
    });
    const already = read("add a third phone booth", 3);
    expect(already).toMatchObject({ kind: "edit", ops: [] });
    expect(already.kind === "edit" ? already.notes[0] : "").toContain("already 3");
  });
  it("does not guess at a phrase that is not a room", () => {
    expect(read("trade places between the front desk and the break area")).toMatchObject({
      kind: "unknown",
    });
    expect(read("move the sauna east")).toMatchObject({ kind: "unknown" });
    expect(read("lock the whole thing")).toMatchObject({ kind: "unknown" });
    // A room the user named themselves is recognised once the plan's names are known.
    expect(
      understandEdit("move the boardroom east", { phoneBooths: 0, names: ["Boardroom"] }),
    ).toMatchObject({ kind: "edit", ops: [{ op: "move_room", to: "east" }] });
    expect(understandEdit("move the atrium east", { phoneBooths: 0 })).toMatchObject({
      kind: "unknown",
    });
  });
  it("recognises undo, and passes everything else on rather than guessing", () => {
    expect(read("undo")).toEqual({ kind: "undo" });
    expect(read("make the lounge purple")).toMatchObject({ kind: "unknown", understood: [] });
    const partial = read("move the kitchen east and paint it blue");
    expect(partial).toMatchObject({ kind: "unknown" });
    expect(partial.kind === "unknown" ? partial.rest : []).toEqual(["paint it blue"]);
  });
});

describe("a fixed arrangement", () => {
  it("is used as it is, whatever the seed", () => {
    const ev = start("firm");
    const pinned = { ...ev.program, arrangement: ev.plan.search.rows };
    const a = layoutOffice(pinned, { seed: 1, ...FAST });
    const b = layoutOffice(pinned, { seed: 9, ...FAST });
    expect(b.rooms.map((r) => r.rect)).toEqual(a.rooms.map((r) => r.rect));
    expect(a.rooms.map((r) => r.rect)).toEqual(ev.plan.rooms.map((r) => r.rect));
  });
  it("is ignored, and the plan searched afresh, when it no longer names the rooms", () => {
    const ev = start("firm");
    const bad = { ...ev.program, arrangement: [["kitchen.1"], ["sauna.1"]] };
    const plan = layoutOffice(bad, { seed: 1, ...FAST });
    expect(plan.rooms.length).toBe(ev.plan.rooms.length);
    expect(plan.diagnostics.some((d) => d.message.includes("searched afresh"))).toBe(true);
  });
});

describe("moving a room by words", () => {
  it("puts the room in the asked part of the office without breaking the plan", () => {
    for (const key of ["firm", "roomy", "northDoor"] as const) {
      const ev = start(key);
      const before = JSON.stringify(ev.program);
      for (const to of ["north", "south", "east", "west"] as const) {
        const out = applyEdit(ev, [{ op: "move_room", room: "lounge", to }]);
        const step = must(out.steps[0]);
        if (step.status === "applied") {
          expect(inZone(centreOf(out.evaluation, "lounge.1"), ev.plan.shell, to)).toBe(true);
          assertSound(out.evaluation);
          expect(
            failKeys(out.evaluation.issues).filter((k) => !failKeys(ev.issues).includes(k)),
          ).toEqual([]);
          expect(out.evaluation.plan.rooms.length).toBe(ev.plan.rooms.length);
        } else {
          expect(out.evaluation).toBe(ev);
        }
        // The original is never mutated, so undo can simply restore it.
        expect(JSON.stringify(ev.program)).toBe(before);
      }
    }
  });

  it("changes little else: only the moved room and the rooms it displaced", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [{ op: "move_room", room: "kitchen", to: "east" }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(out.steps[0]?.message).toContain("Moved Kitchen to the east");
    expect(out.steps[0]?.message).toContain("Score");
    // Same rooms, same shell, same program except the arrangement.
    expect(out.evaluation.program.rooms).toEqual(ev.program.rooms);
    expect(out.evaluation.program.shell).toEqual(ev.program.shell);
    expect(out.changed).toBe(true);
  });

  it("says so, and changes nothing, when the room is already there", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [{ op: "move_room", room: "kitchen", to: "west" }]);
    expect(out.steps[0]?.status).toBe("unchanged");
    expect(out.steps[0]?.message).toContain("already in the west part");
    expect(out.changed).toBe(false);
    expect(out.evaluation).toBe(ev);
  });

  it("refuses an unknown or ambiguous room with a reason", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [
      { op: "move_room", room: "sauna", to: "east" },
      { op: "move_room", room: "meeting room", to: "east" },
    ]);
    expect(out.steps.map((s) => s.status)).toEqual(["refused", "refused"]);
    expect(out.evaluation).toBe(ev);
  });
});

describe("swapping rooms", () => {
  it("exchanges two rooms' positions", () => {
    const ev = start("firm");
    const ca = centreOf(ev, "kitchen.1");
    const cb = centreOf(ev, "meeting_room.3");
    const out = applyEdit(ev, [{ op: "swap_rooms", a: "kitchen", b: "third meeting room" }]);
    expect(out.steps[0]?.status).toBe("applied");
    const na = centreOf(out.evaluation, "kitchen.1");
    const nb = centreOf(out.evaluation, "meeting_room.3");
    expect(Math.hypot(na[0] - cb[0], na[1] - cb[1])).toBeLessThan(
      Math.hypot(na[0] - ca[0], na[1] - ca[1]),
    );
    expect(Math.hypot(nb[0] - ca[0], nb[1] - ca[1])).toBeLessThan(
      Math.hypot(nb[0] - cb[0], nb[1] - cb[1]),
    );
    assertSound(out.evaluation);
  });

  it("refuses to take reception off the entrance lobby, and says why", () => {
    const ev = start("firm");
    // In this plan the lounge sits beside reception in the same row, behind it.
    const out = applyEdit(ev, [{ op: "swap_rooms", a: "reception", b: "lounge" }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.steps[0]?.message).toContain("entrance lobby");
    expect(out.evaluation).toBe(ev);
  });

  it("swaps reception with a room that is also first in its row", () => {
    const ev = start("firm");
    const firsts = ev.plan.search.rows.map((row) => row[0]);
    expect(firsts).toContain("kitchen.1");
    const out = applyEdit(ev, [{ op: "swap_rooms", a: "reception", b: "kitchen" }]);
    expect(out.steps[0]?.status).toBe("applied");
    const reception = must(out.evaluation.plan.rooms.find((r) => r.kind === "reception"));
    const lobby = must(out.evaluation.plan.circulation.find((c) => c.id === "lobby"));
    expect(reception.rect.x).toBeLessThan(lobby.rect.x + lobby.rect.w + 1e-6);
  });

  it("swaps reception with a room in another row and keeps reception on the lobby", () => {
    const ev = start("northDoor");
    const rows = ev.plan.search.rows;
    const rowOf = (list: string[][], id: string) => list.findIndex((r) => r.includes(id));
    expect(rowOf(rows, "reception.1")).not.toBe(rowOf(rows, "restroom.1"));
    const out = applyEdit(ev, [{ op: "swap_rooms", a: "reception", b: "restroom 1" }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(out.steps[0]?.message).toContain("kept first in its row");
    const after = out.evaluation.plan.search.rows;
    // Each now sits in the other's row, and reception is still first, on the lobby.
    expect(rowOf(after, "reception.1")).toBe(rowOf(rows, "restroom.1"));
    expect(rowOf(after, "restroom.1")).toBe(rowOf(rows, "reception.1"));
    expect(after[rowOf(after, "reception.1")]?.[0]).toBe("reception.1");
    const reception = must(out.evaluation.plan.rooms.find((r) => r.kind === "reception"));
    const lobby = must(out.evaluation.plan.circulation.find((c) => c.id === "lobby"));
    expect(sharedEdge(reception.rect, lobby.rect)).toBeGreaterThan(0.5);
    assertSound(out.evaluation);
  });

  it("refuses to swap a room with itself", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [{ op: "swap_rooms", a: "kitchen", b: "the kitchen" }]);
    expect(out.steps[0]?.status).toBe("refused");
  });
});

describe("phone booths", () => {
  it("adds booths that fit and says how many were placed", () => {
    const ev = start("firm");
    expect(ev.program.phoneBooths).toBe(2);
    const out = applyEdit(ev, [{ op: "add_phone_booths", count: 1 }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(out.evaluation.program.phoneBooths).toBe(3);
    expect(out.evaluation.furnished.report.phoneBoothsPlaced).toBe(
      ev.furnished.report.phoneBoothsPlaced + 1,
    );
    // The user's request is recorded as their own fact, so a model cannot later override it.
    const note = out.evaluation.program.assumptions.find((a) => a.topic === "phone booths");
    expect(note).toMatchObject({ source: "brief" });
    // The room layout does not move for a booth.
    expect(out.evaluation.plan.rooms.map((r) => r.rect)).toEqual(ev.plan.rooms.map((r) => r.rect));
  });

  it("refuses booths that do not fit, leaving the plan alone", () => {
    // A small workspace has wall for only so many booths: keep adding until one no longer fits.
    let ev = evaluateProgram(smallProgram(), { seeds: [1], layout: FAST });
    let refused: ReturnType<typeof applyEdit> | undefined;
    for (let i = 0; i < 8 && !refused; i++) {
      const out = applyEdit(ev, [{ op: "add_phone_booths", count: 2 }]);
      if (out.steps[0]?.status === "refused") refused = out;
      else ev = out.evaluation;
    }
    expect(refused).toBeDefined();
    expect(refused?.steps[0]?.message).toMatch(
      /fit along the open workspace walls|at most|would break the plan/,
    );
    expect(refused?.evaluation).toBe(ev);
    // Every booth the plan claims is really placed.
    expect(ev.furnished.report.phoneBoothsPlaced).toBe(ev.program.phoneBooths);
  });

  it("never claims more booths than the plan holds", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [
      { op: "add_phone_booths", count: 6 },
      { op: "add_phone_booths", count: 6 },
    ]);
    expect(out.steps.map((s) => s.status)).toContain("refused");
    expect(out.evaluation.furnished.report.phoneBoothsPlaced).toBe(
      out.evaluation.program.phoneBooths,
    );
  });

  it("refuses booths that would cost so many seats that the plan fails", async () => {
    const brief =
      "An 8-person studio with one meeting room and a kitchen. Windows on the south wall, entrance on the west.";
    const ev = (await refineDesign(readBrief(brief).program, { layout: FAST })).best;
    expect(ev.furnished.report.seatsPlaced).toBe(ev.furnished.report.seatsWanted);
    // One more fits; two more fit along the walls but leave only 7 of 8 workstations, which fails.
    expect(applyEdit(ev, [{ op: "add_phone_booths", count: 1 }]).steps[0]?.status).toBe("applied");
    const out = applyEdit(ev, [{ op: "add_phone_booths", count: 2 }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.steps[0]?.message).toContain("would break the plan");
    expect(out.steps[0]?.message).toContain("Only 7 of 8 workstations");
    expect(out.evaluation).toBe(ev);
  });

  it("removes booths, and reports when there are none", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [{ op: "remove_phone_booths", count: 5 }]);
    expect(out.evaluation.program.phoneBooths).toBe(0);
    const again = applyEdit(out.evaluation, [{ op: "remove_phone_booths", count: 1 }]);
    expect(again.steps[0]?.status).toBe("unchanged");
    expect(again.evaluation).toBe(out.evaluation);
  });
});

describe("locks", () => {
  it("record where a room is, and refuse to move a locked room", () => {
    const ev = start("firm");
    const locked = applyEdit(ev, [{ op: "lock_room", room: "kitchen" }]);
    expect(locked.evaluation.program.locks).toHaveLength(1);
    const [x, y] = centreOf(ev, "kitchen.1");
    expect(locked.evaluation.program.locks[0]?.x).toBeCloseTo(x, 0);
    expect(locked.evaluation.program.locks[0]?.y).toBeCloseTo(y, 0);
    const moved = applyEdit(locked.evaluation, [{ op: "move_room", room: "kitchen", to: "east" }]);
    expect(moved.steps[0]?.status).toBe("refused");
    expect(moved.steps[0]?.message).toContain("locked");
    const swapped = applyEdit(locked.evaluation, [{ op: "swap_rooms", a: "kitchen", b: "lounge" }]);
    expect(swapped.steps[0]?.status).toBe("refused");
    const freed = applyEdit(locked.evaluation, [
      { op: "unlock_room", room: "kitchen" },
      { op: "move_room", room: "kitchen", to: "east" },
    ]);
    expect(freed.steps.map((s) => s.status)).toEqual(["applied", "applied"]);
  });

  it("keep every locked room within tolerance through later edits", () => {
    for (const key of ["firm", "roomy", "northDoor"] as const) {
      let ev = start(key);
      const lockKinds = ["kitchen", "storage"];
      ev = applyEdit(
        ev,
        lockKinds.map((room) => ({ op: "lock_room" as const, room })),
      ).evaluation;
      const tolerance = lockTolerance(ev.plan.shell);
      for (const to of ["north", "south", "east", "west"] as const)
        for (const room of ["lounge", "reception", "restroom 1", "third meeting room"]) {
          const out = applyEdit(ev, [{ op: "move_room", room, to }]);
          for (const lock of out.evaluation.program.locks) {
            const [cx, cy] = centreOf(out.evaluation, lock.id);
            expect(Math.hypot(cx - lock.x, cy - lock.y)).toBeLessThanOrEqual(tolerance + 1e-6);
          }
        }
    }
  });

  it("explain a refusal that locks cause", () => {
    const ev = start("firm");
    const allLocked = applyEdit(
      ev,
      ev.plan.rooms
        .filter((r) => r.kind !== "lounge")
        .map((r) => ({ op: "lock_room" as const, room: r.id })),
    ).evaluation;
    const out = applyEdit(allLocked, [{ op: "move_room", room: "lounge", to: "east" }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.steps[0]?.message).toMatch(/which you locked in place/);
    expect(out.steps[0]?.message).toMatch(/more/);
    expect(out.evaluation).toBe(allLocked);
  });
});

describe("whole requests", () => {
  it("runs the three headline requests end to end, in one sentence", () => {
    const ev = start("firm");
    const said = understandEdit(
      "move the kitchen east, add a third phone booth and swap reception and kitchen",
      ev.program,
    );
    expect(said.kind).toBe("edit");
    const out = applyEdit(ev, said.kind === "edit" ? said.ops : []);
    expect(out.steps.map((s) => s.op.op)).toEqual(["move_room", "add_phone_booths", "swap_rooms"]);
    for (const s of out.steps) expect(["applied", "refused", "unchanged"]).toContain(s.status);
    assertSound(out.evaluation);
    expect(out.evaluation.program.phoneBooths).toBe(3);
  });

  it("never leaves a design worse than invalid, whatever is asked", () => {
    const sides = ["north", "south", "east", "west"] as const;
    const rooms = ["kitchen", "lounge", "reception", "storage", "restroom 1", "meeting room 2"];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (const key of ["firm", "roomy", "northDoor"] as const) {
      let ev = start(key);
      const baseFails = failKeys(ev.issues);
      for (let i = 0; i < 12; i++) {
        const pick = next() % 3;
        const room = rooms[next() % rooms.length] as string;
        const other = rooms[next() % rooms.length] as string;
        const op =
          pick === 0
            ? ({ op: "move_room", room, to: sides[next() % 4] as "north" } as const)
            : pick === 1
              ? ({ op: "swap_rooms", a: room, b: other } as const)
              : ({ op: "add_phone_booths", count: 1 } as const);
        ev = applyEdit(ev, [op]).evaluation;
        assertSound(ev);
        expect(failKeys(ev.issues).filter((k) => !baseFails.includes(k))).toEqual([]);
      }
    }
  });
});

describe("the reception rule", () => {
  it("is reported when reception is off the entrance lobby", () => {
    const ev = start("firm");
    const rows = ev.plan.search.rows.map((row) => [...row]);
    const row = must(rows.find((r) => r.includes("reception.1")));
    const at = row.indexOf("reception.1");
    [row[at], row[at + 1]] = [must(row[at + 1]), must(row[at])];
    const program: Program = { ...ev.program, arrangement: rows };
    const plan = layoutOffice(program, { seed: 1 });
    const issues = diagnose(plan, program, furnish(plan, program).report);
    expect(issues.some((i) => i.code === "reception_off_entrance")).toBe(true);
  });
});

const area = (ev: Evaluation, id: string) => {
  const r = must(ev.plan.rooms.find((x) => x.id === id)).rect;
  return r.w * r.h;
};
const idsOf = (ev: Evaluation) => ev.plan.rooms.map((r) => r.id).sort();
const TIGHT =
  "A 12-person startup. Open workspace, two meeting rooms, one phone booth, kitchen, reception, two restrooms. 14 m by 10 m shell, windows on the north and south walls, entrance on the west.";

describe("resizing, adding and removing: the operations and the words", () => {
  const read = (text: string, meetings = 3) =>
    understandEdit(text, { phoneBooths: 2, meetingRooms: meetings });
  it("accepts only meeting rooms to add, and only sane factors", () => {
    expect(EditOpSchema.safeParse({ op: "add_room", kind: "kitchen", count: 1 }).success).toBe(
      false,
    );
    expect(EditOpSchema.safeParse({ op: "add_room", kind: "meeting_room", count: 9 }).success).toBe(
      false,
    );
    expect(EditOpSchema.safeParse({ op: "resize_room", room: "kitchen", factor: 3 }).success).toBe(
      false,
    );
    expect(
      EditOpSchema.safeParse({ op: "resize_room", room: "kitchen", factor: 1.25 }).success,
    ).toBe(true);
    expect(EditOpSchema.safeParse({ op: "remove_room", room: "meeting room 2" }).success).toBe(
      true,
    );
  });
  it("reads resizing", () => {
    expect(read("make the kitchen bigger")).toMatchObject({
      ops: [{ op: "resize_room", room: "the kitchen", factor: 1.25 }],
    });
    expect(read("make the kitchen a bit smaller")).toMatchObject({ ops: [{ factor: 0.9 }] });
    expect(read("make the lounge much larger")).toMatchObject({ ops: [{ factor: 1.5 }] });
    expect(read("make the lounge 30% bigger")).toMatchObject({ ops: [{ factor: 1.3 }] });
    expect(read("shrink the storage by 20%")).toMatchObject({ ops: [{ factor: 0.8 }] });
    expect(read("give the kitchen more space")).toMatchObject({ ops: [{ factor: 1.25 }] });
    expect(read("make the sauna bigger")).toMatchObject({ kind: "unknown" });
  });
  it("reads adding and removing meeting rooms, counting from what is there", () => {
    expect(read("add a meeting room")).toMatchObject({
      ops: [{ op: "add_room", kind: "meeting_room", count: 1 }],
    });
    expect(read("add two meeting rooms for 10")).toMatchObject({
      ops: [{ count: 2, capacity: 10 }],
    });
    expect(read("add a fourth meeting room", 3)).toMatchObject({ ops: [{ count: 1 }] });
    expect(read("add a fourth meeting room", 1)).toMatchObject({ ops: [{ count: 3 }] });
    const already = read("add a third meeting room", 3);
    expect(already).toMatchObject({ kind: "edit", ops: [] });
    expect(read("remove meeting room 2")).toMatchObject({
      ops: [{ op: "remove_room", room: "meeting room 2" }],
    });
    expect(read("remove a meeting room")).toMatchObject({
      ops: [{ op: "remove_room", room: "last meeting room" }],
    });
    expect(read("add a meeting room and make the kitchen bigger")).toMatchObject({
      ops: [{ op: "add_room" }, { op: "resize_room" }],
    });
  });
  it("names the last room of a kind", () => {
    const ev = start("firm");
    expect(resolveRoom(ev.plan, "last meeting room")).toEqual({ ok: true, id: "meeting_room.3" });
  });
});

describe("resizing a room", () => {
  it("changes the room's own area, keeps every id, and breaks nothing", () => {
    const ev = start("roomy");
    const before = area(ev, "meeting_room.2");
    const out = applyEdit(ev, [{ op: "resize_room", room: "meeting room 2", factor: 1.4 }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(area(out.evaluation, "meeting_room.2")).toBeGreaterThan(before * 1.05);
    expect(idsOf(out.evaluation)).toEqual(idsOf(ev));
    // Only that room has its own size now; the other meeting room keeps the catalogue rule.
    const meetings = out.evaluation.program.rooms.filter((r) => r.kind === "meeting_room");
    expect(meetings.filter((r) => r.areaM2 !== undefined)).toHaveLength(1);
    expect(
      expandRooms(out.evaluation.program)
        .map((r) => r.id)
        .sort(),
    ).toEqual(idsOf(ev));
    assertSound(out.evaluation);
    expect(failKeys(out.evaluation.issues).filter((k) => !failKeys(ev.issues).includes(k))).toEqual(
      [],
    );
    expect(ev.program.rooms.every((r) => r.areaM2 === undefined)).toBe(true);
  });
  it("makes a room smaller", () => {
    const ev = start("roomy");
    const out = applyEdit(ev, [{ op: "resize_room", room: "kitchen", factor: 0.9 }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(area(out.evaluation, "kitchen.1")).toBeLessThan(area(ev, "kitchen.1") * 0.95);
  });
  it("says why when the room is held at its minimum width and cannot change", () => {
    const ev = start("firm");
    const out = applyEdit(ev, [
      { op: "resize_room", room: "kitchen", factor: 1.25 },
      { op: "resize_room", room: "kitchen", factor: 0.9 },
    ]);
    expect(out.steps.map((x) => x.status)).toEqual(["refused", "refused"]);
    expect(out.steps[0]?.message).toContain("cannot be narrower than");
    expect(out.steps[1]?.message).toContain("smallest");
    expect(out.evaluation).toBe(ev);
  });
  it("will not resize a locked room", () => {
    const ev = applyEdit(start("roomy"), [{ op: "lock_room", room: "lounge" }]).evaluation;
    const out = applyEdit(ev, [{ op: "resize_room", room: "lounge", factor: 1.3 }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.steps[0]?.message).toContain("locked");
  });
});

describe("adding a meeting room", () => {
  it("places a new room, records it as the user's fact, and breaks nothing", () => {
    const ev = start("roomy");
    const out = applyEdit(ev, [{ op: "add_room", kind: "meeting_room", count: 1, capacity: 10 }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(out.evaluation.plan.rooms.filter((r) => r.kind === "meeting_room")).toHaveLength(3);
    expect(idsOf(out.evaluation)).toEqual([...idsOf(ev), "meeting_room.3"].sort());
    expect(out.evaluation.program.rooms.at(-1)).toMatchObject({
      kind: "meeting_room",
      count: 1,
      capacity: 10,
    });
    expect(
      out.evaluation.program.assumptions.find((a) => a.topic === "meeting rooms"),
    ).toMatchObject({ source: "brief" });
    expect(out.evaluation.plan.search.rows.flat()).toContain("meeting_room.3");
    assertSound(out.evaluation);
    expect(failKeys(out.evaluation.issues).filter((k) => !failKeys(ev.issues).includes(k))).toEqual(
      [],
    );
    expect(ev.program.rooms).toHaveLength(readBrief(BRIEFS.roomy).program.rooms.length);
  });
  it("adds several, and refuses all of them if one cannot be placed", async () => {
    const ev = start("roomy");
    const three = applyEdit(ev, [{ op: "add_room", kind: "meeting_room", count: 3 }]);
    if (three.steps[0]?.status === "applied")
      expect(three.evaluation.plan.rooms.filter((r) => r.kind === "meeting_room")).toHaveLength(5);
    else expect(three.evaluation).toBe(ev);
    // A tight shell cannot hold another meeting room without failing the seat check.
    const tight = (await refineDesign(readBrief(TIGHT).program, { layout: FAST })).best;
    const out = applyEdit(tight, [{ op: "add_room", kind: "meeting_room", count: 2 }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.steps[0]?.message).toContain("workstations");
    expect(out.evaluation).toBe(tight);
  }, 15_000);
});

describe("removing a meeting room", () => {
  it("renumbers the later rooms and keeps locks on the rooms they were on", () => {
    const ev = start("firm");
    const locked = applyEdit(ev, [{ op: "lock_room", room: "meeting room 3" }]).evaluation;
    const at = must(locked.program.locks[0]);
    const out = applyEdit(locked, [{ op: "remove_room", room: "meeting room 1" }]);
    expect(out.steps[0]?.status).toBe("applied");
    expect(idsOf(out.evaluation)).toEqual(idsOf(ev).filter((id) => id !== "meeting_room.3"));
    expect(out.evaluation.program.locks).toEqual([{ ...at, id: "meeting_room.2" }]);
    expect(out.evaluation.program.rooms.find((r) => r.kind === "meeting_room")?.count).toBe(2);
    expect(out.evaluation.plan.search.rows.flat().sort()).toEqual(idsOf(out.evaluation));
    const [cx, cy] = centreOf(out.evaluation, "meeting_room.2");
    expect(Math.hypot(cx - at.x, cy - at.y)).toBeLessThanOrEqual(
      lockTolerance(ev.plan.shell) + 1e-6,
    );
    assertSound(out.evaluation);
  });
  it("removes the last one when none is named, and the only one if that is all there is", () => {
    const ev = start("roomy");
    const first = applyEdit(ev, [{ op: "remove_room", room: "last meeting room" }]);
    expect(idsOf(first.evaluation)).not.toContain("meeting_room.2");
    const second = applyEdit(first.evaluation, [{ op: "remove_room", room: "meeting room" }]);
    expect(second.evaluation.plan.rooms.some((r) => r.kind === "meeting_room")).toBe(false);
    assertSound(second.evaluation);
  });
  it("refuses other rooms and locked rooms", () => {
    const ev = start("firm");
    expect(applyEdit(ev, [{ op: "remove_room", room: "lounge" }]).steps[0]?.message).toContain(
      "Only meeting rooms",
    );
    const locked = applyEdit(ev, [{ op: "lock_room", room: "meeting room 2" }]).evaluation;
    const out = applyEdit(locked, [{ op: "remove_room", room: "meeting room 2" }]);
    expect(out.steps[0]?.status).toBe("refused");
    expect(out.evaluation).toBe(locked);
  });
});

describe("the new operations under hostile sequences", () => {
  it("never leave the plan invalid or failing, whatever order they come in", () => {
    let seed = 11;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const rooms = [
      "kitchen",
      "lounge",
      "meeting room",
      "last meeting room",
      "meeting room 1",
      "storage",
    ];
    for (const key of ["firm", "roomy", "northDoor"] as const) {
      let ev = start(key);
      const baseFails = failKeys(ev.issues);
      for (let i = 0; i < 14; i++) {
        const room = rooms[next() % rooms.length] as string;
        const pick = next() % 5;
        const op =
          pick === 0
            ? ({
                op: "resize_room",
                room,
                factor: [0.7, 0.9, 1.2, 1.5][next() % 4] as number,
              } as const)
            : pick === 1
              ? ({ op: "add_room", kind: "meeting_room", count: 1 } as const)
              : pick === 2
                ? ({ op: "remove_room", room } as const)
                : pick === 3
                  ? ({ op: "lock_room", room } as const)
                  : ({
                      op: "move_room",
                      room,
                      to: (["north", "south", "east", "west"] as const)[next() % 4] as "north",
                    } as const);
        ev = applyEdit(ev, [op]).evaluation;
        assertSound(ev);
        expect(failKeys(ev.issues).filter((k) => !baseFails.includes(k))).toEqual([]);
        // Ids, arrangement and locks always agree.
        expect(ev.plan.search.rows.flat().sort()).toEqual(idsOf(ev));
        for (const lock of ev.program.locks) expect(idsOf(ev)).toContain(lock.id);
      }
    }
  });
});

describe("a warning that becomes a failure", () => {
  it("is a new failure: a meeting room that tips workspace density over the line is refused", async () => {
    const brief =
      "A 22-person agency with three meeting rooms, kitchen, lounge, reception. 20 m by 14 m shell, windows on the west wall, entrance on the north.";
    const ev = (await refineDesign(readBrief(brief).program, { layout: FAST })).best;
    const out = applyEdit(ev, [{ op: "add_room", kind: "meeting_room", count: 1 }]);
    expect(failKeys(out.evaluation.issues).filter((k) => !failKeys(ev.issues).includes(k))).toEqual(
      [],
    );
  });
});
