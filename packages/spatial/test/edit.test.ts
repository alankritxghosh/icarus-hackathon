import {
  applyEdit,
  type EditOp,
  type Evaluation,
  evaluateProgram,
  understandEdit,
} from "@icarus/core";
import { describe, expect, it } from "vitest";
import { type EditState, editModel, evaluationOfModel, fromFloorPlan, locksOf } from "../src";
import { demoProgram } from "./fixtures";
import { samePlan } from "./samePlan";

const start = (): Evaluation => evaluateProgram(demoProgram(), { seeds: [1] });
const stateOf = (ev: Evaluation): EditState => ({
  program: ev.program,
  seed: ev.seed,
  model: fromFloorPlan(ev.plan, { program: ev.program }),
});
const ops = (text: string, ev: Evaluation): EditOp[] => {
  const said = understandEdit(text, {
    phoneBooths: ev.program.phoneBooths,
    meetingRooms: ev.plan.rooms.filter((r) => r.kind === "meeting_room").length,
    names: ev.plan.rooms.map((r) => r.name),
  });
  if (said.kind !== "edit") throw new Error(`not understood: ${text}`);
  return said.ops;
};
const messages = (steps: { status: string; message: string }[]) =>
  steps.map((s) => `${s.status}: ${s.message}`);

describe("editModel", () => {
  it("does what editing directly does, step for step, on a chain of requests with a lock in it", () => {
    let direct = start();
    let state = stateOf(direct);
    for (const text of [
      "move the kitchen east",
      "lock the lounge",
      "add a third phone booth",
      "move the lounge west",
      "make the kitchen bigger",
      "unlock the lounge",
      "add a meeting room",
    ]) {
      const o = ops(text, direct);
      const d = applyEdit(direct, o);
      const m = editModel(state, o);
      if (!m.ok) throw new Error(m.reason);
      expect(messages(m.outcome.steps), text).toEqual(messages(d.steps));
      expect(m.outcome.changed, text).toBe(d.changed);
      expect(samePlan(m.evaluation.plan, d.evaluation.plan), text).toEqual([]);
      expect(m.evaluation.cost, text).toBeCloseTo(d.evaluation.cost, 9);
      // the model that comes back is the model of the plan that came back
      expect(JSON.stringify(m.state.model), text).toBe(
        JSON.stringify(
          fromFloorPlan(d.evaluation.plan, {
            program: d.evaluation.program,
            name: state.model.name,
          }),
        ),
      );
      direct = d.evaluation;
      state = m.state;
    }
  });

  it("does not need a stored row order: the rows are read from the geometry", () => {
    const ev = start();
    const state = stateOf(ev);
    const scrubbed = { ...state, program: { ...state.program, arrangement: undefined } };
    const o = ops("move the kitchen east", ev);
    const withRows = editModel(state, o);
    const without = editModel(scrubbed, o);
    if (!withRows.ok || !without.ok) throw new Error("edit failed");
    expect(samePlan(withRows.evaluation.plan, without.evaluation.plan)).toEqual([]);
    expect(JSON.stringify(withRows.state.model)).toBe(JSON.stringify(without.state.model));
  });

  it("a lock lives on the space, keeps its anchor through later edits, and holds the room", () => {
    const ev = start();
    let state = stateOf(ev);
    const lock = editModel(state, ops("lock the kitchen", ev));
    if (!lock.ok) throw new Error(lock.reason);
    state = lock.state;
    const kitchen = state.model.spaces.find((s) => s.kind === "office.kitchen");
    expect(kitchen?.locked).toBe(true);
    const anchor = kitchen?.lockAt;
    expect(anchor).toBeDefined();
    const later = editModel(state, ops("add a third phone booth", lock.evaluation));
    if (!later.ok) throw new Error(later.reason);
    expect(later.state.model.spaces.find((s) => s.id === kitchen?.id)?.lockAt).toEqual(anchor);
    expect(locksOf(later.state.model).map((l) => l.id)).toEqual([kitchen?.id]);
    const move = editModel(later.state, ops("move the kitchen east", later.evaluation));
    if (!move.ok) throw new Error(move.reason);
    expect(move.outcome.steps[0]?.status).toBe("refused");
    expect(move.outcome.steps[0]?.message).toContain("locked");
    expect(move.state).toBe(later.state);
  });

  it("leaves the state alone, and says so, when nothing changes", () => {
    const ev = start();
    const state = stateOf(ev);
    const r = editModel(state, ops("unlock the kitchen", ev)); // it was never locked
    if (!r.ok) throw new Error(r.reason);
    expect(r.outcome.changed).toBe(false);
    expect(r.outcome.steps[0]?.status).toBe("unchanged");
    expect(r.state).toBe(state);
  });

  it("refuses an office the row engine did not make, instead of editing it wrongly", () => {
    const ev = start();
    const state = stateOf(ev);
    const withColumn = {
      ...state,
      model: {
        ...state.model,
        obstacles: [
          {
            id: "c",
            levelId: "L0",
            kind: "column" as const,
            footprint: {
              outer: [
                { x: 5000, y: 5000 },
                { x: 5400, y: 5000 },
                { x: 5400, y: 5400 },
                { x: 5000, y: 5400 },
              ],
              holes: [],
            },
            provenance: { source: "generated" as const, evidence: [] },
          },
        ],
      },
    };
    const r = editModel(withColumn, ops("move the kitchen east", ev));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("columns");

    const spaces = state.model.spaces.map((s, i) =>
      i === 0
        ? {
            ...s,
            boundary: {
              ...s.boundary,
              outer: s.boundary.outer.map((v) => ({ ...v, y: v.y + 300 })),
            },
          }
        : s,
    );
    const moved = evaluationOfModel({ ...state, model: { ...state.model, spaces } });
    expect(moved.ok).toBe(false);
  });
});
