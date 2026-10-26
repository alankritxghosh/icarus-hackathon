import { KIND_RULES } from "../catalog";
import type { Side } from "../geometry";
import type { FloorPlan } from "../layout/types";
import type { SceneNode } from "./scene";

export const INTERIOR_T = 0.1;
export const EXTERIOR_T = 0.25;
export const DOOR_HEAD_M = 2.1;
export const WINDOW_SILL_M = 0.9;
export const WINDOW_HEAD_M = 2.4;
const EPS = 1e-6;
const key = (v: number) => Math.round(v * 1000) / 1000;

interface Run {
  /** "h" runs along x at a fixed y; "v" runs along y at a fixed x. */
  axis: "h" | "v";
  at: number;
  from: number;
  to: number;
  exterior: boolean;
}

interface Opening {
  kind: "door" | "window";
  center: number;
  width: number;
  sill: number;
  head: number;
  label: string;
  roomId?: string;
  glazed?: boolean;
}

/** Merge touching or overlapping intervals into continuous runs. */
function union(intervals: [number, number][]): [number, number][] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Wall runs for a plan: every room edge plus the shell perimeter, merged so a wall shared by two
 * rooms is built once. Circulation spaces add nothing of their own; the rooms around them do.
 */
export function wallRuns(plan: FloorPlan): Run[] {
  const lines = new Map<string, { axis: "h" | "v"; at: number; spans: [number, number][] }>();
  const add = (axis: "h" | "v", at: number, from: number, to: number) => {
    const k = `${axis}:${key(at)}`;
    const line = lines.get(k) ?? { axis, at: key(at), spans: [] };
    line.spans.push([from, to]);
    lines.set(k, line);
  };
  const { w, h } = plan.shell;
  add("h", 0, 0, w);
  add("h", h, 0, w);
  add("v", 0, 0, h);
  add("v", w, 0, h);
  for (const { rect: r } of plan.rooms) {
    add("h", r.y, r.x, r.x + r.w);
    add("h", r.y + r.h, r.x, r.x + r.w);
    add("v", r.x, r.y, r.y + r.h);
    add("v", r.x + r.w, r.y, r.y + r.h);
  }
  const runs: Run[] = [];
  for (const line of lines.values()) {
    const exterior =
      line.axis === "h"
        ? line.at < EPS || Math.abs(line.at - h) < EPS
        : line.at < EPS || Math.abs(line.at - w) < EPS;
    for (const [from, to] of union(line.spans))
      runs.push({ axis: line.axis, at: line.at, from, to, exterior });
  }
  return runs.sort((a, b) =>
    a.axis === b.axis ? a.at - b.at || a.from - b.from : a.axis < b.axis ? -1 : 1,
  );
}

function windowsFor(plan: FloorPlan): { side: Side; roomId: string; from: number; to: number }[] {
  const out: { side: Side; roomId: string; from: number; to: number }[] = [];
  const { w, h } = plan.shell;
  for (const room of plan.rooms) {
    if (KIND_RULES[room.kind].daylight === "avoid" || KIND_RULES[room.kind].daylight === "none")
      continue;
    const r = room.rect;
    for (const side of plan.shell.windows) {
      if (side === "north" && r.y < EPS)
        out.push({ side, roomId: room.id, from: r.x, to: r.x + r.w });
      if (side === "south" && Math.abs(r.y + r.h - h) < EPS)
        out.push({ side, roomId: room.id, from: r.x, to: r.x + r.w });
      if (side === "west" && r.x < EPS)
        out.push({ side, roomId: room.id, from: r.y, to: r.y + r.h });
      if (side === "east" && Math.abs(r.x + r.w - w) < EPS)
        out.push({ side, roomId: room.id, from: r.y, to: r.y + r.h });
    }
  }
  return out;
}

/** Door and window openings, each tied to the wall line it belongs on. */
export function openings(plan: FloorPlan): { axis: "h" | "v"; at: number; opening: Opening }[] {
  const out: { axis: "h" | "v"; at: number; opening: Opening }[] = [];
  for (const room of plan.rooms) {
    const d = room.door;
    const horizontal = d.side === "north" || d.side === "south";
    out.push({
      axis: horizontal ? "h" : "v",
      at: key(horizontal ? d.y : d.x),
      opening: {
        kind: "door",
        center: horizontal ? d.x : d.y,
        width: d.widthM,
        sill: 0,
        head: DOOR_HEAD_M,
        label: `Door to ${room.name}`,
        roomId: room.id,
      },
    });
  }
  const e = plan.entrance;
  const eh = e.side === "north" || e.side === "south";
  out.push({
    axis: eh ? "h" : "v",
    at: key(eh ? (e.side === "north" ? 0 : plan.shell.h) : e.side === "west" ? 0 : plan.shell.w),
    opening: {
      kind: "door",
      center: eh ? e.x : e.y,
      width: e.widthM,
      sill: 0,
      head: 2.2,
      label: "Entrance door",
      glazed: true,
    },
  });
  const { w, h } = plan.shell;
  for (const win of windowsFor(plan)) {
    const length = win.to - win.from;
    if (length < 1.8) continue;
    const count = Math.max(1, Math.floor(length / 2.4));
    const width = Math.min(1.6, (0.7 * length) / count);
    const horizontal = win.side === "north" || win.side === "south";
    const at = win.side === "north" ? 0 : win.side === "south" ? h : win.side === "west" ? 0 : w;
    for (let i = 0; i < count; i++)
      out.push({
        axis: horizontal ? "h" : "v",
        at: key(at),
        opening: {
          kind: "window",
          center: win.from + (length * (i + 0.5)) / count,
          width,
          sill: WINDOW_SILL_M,
          head: WINDOW_HEAD_M,
          label: `Window, ${win.roomId}`,
          roomId: win.roomId,
        },
      });
  }
  return out;
}

/** Position and orientation of a box lying along a run. */
function along(
  run: Run,
  from: number,
  to: number,
  y0: number,
  y1: number,
  thickness: number,
  offset: number,
): { size: [number, number, number]; position: [number, number, number] } {
  const len = to - from;
  const mid = (from + to) / 2;
  const cy = (y0 + y1) / 2;
  return run.axis === "h"
    ? { size: [len, y1 - y0, thickness], position: [mid, cy, run.at + offset] }
    : { size: [thickness, y1 - y0, len], position: [run.at + offset, cy, mid] };
}

/** Build the walls, door leaves, glazing and frames for a plan, cutting every opening cleanly. */
export function buildWalls(plan: FloorPlan, ceilingM: number): SceneNode[] {
  const nodes: SceneNode[] = [];
  const all = openings(plan);
  let n = 0;
  for (const run of wallRuns(plan)) {
    const t = run.exterior ? EXTERIOR_T : INTERIOR_T;
    // Exterior walls sit outside the clear shell; interior walls are centred on their line.
    const outward = run.axis === "h" ? (run.at < EPS ? -1 : 1) : run.at < EPS ? -1 : 1;
    const offset = run.exterior ? (outward * t) / 2 : 0;
    // Extend runs so corners and T-junctions close without gaps.
    const pad = run.exterior ? EXTERIOR_T : INTERIOR_T / 2;
    const a = run.from - pad;
    const b = run.to + pad;
    const mine = all
      .filter(
        (o) =>
          o.axis === run.axis &&
          Math.abs(o.at - run.at) < 1e-3 &&
          o.opening.center - o.opening.width / 2 >= run.from - EPS &&
          o.opening.center + o.opening.width / 2 <= run.to + EPS,
      )
      .map((o) => o.opening)
      .sort((p, q) => p.center - q.center);
    const cuts: Opening[] = [];
    for (const o of mine) {
      const last = cuts[cuts.length - 1];
      if (last && o.center - o.width / 2 < last.center + last.width / 2 + 0.05) continue;
      cuts.push(o);
    }
    const id = `${run.axis}@${run.at.toFixed(2)}[${run.from.toFixed(2)}-${run.to.toFixed(2)}]`;
    const mat = run.exterior ? "wall.exterior" : "wall.interior";
    const piece = (from: number, to: number, y0: number, y1: number, label: string) => {
      if (to - from < 1e-3 || y1 - y0 < 1e-3) return;
      const box = along(run, from, to, y0, y1, t, offset);
      nodes.push({
        id: `wall.${id}.${n++}`,
        name: label,
        type: "wall",
        geometry: { kind: "box", size: box.size },
        position: box.position,
        rotationY: 0,
        material: mat,
        tags: [run.exterior ? "exterior" : "interior"],
      });
    };
    let cursor = a;
    for (const o of cuts) {
      const o0 = o.center - o.width / 2;
      const o1 = o.center + o.width / 2;
      piece(cursor, o0, 0, ceilingM, run.exterior ? "Exterior wall" : "Wall");
      if (o.sill > 0) piece(o0, o1, 0, o.sill, "Wall below window");
      piece(o0, o1, o.head, ceilingM, o.kind === "door" ? "Wall above door" : "Wall above window");
      cursor = o1;
      // A closed leaf fills its opening exactly, so nothing is left open around it.
      const fill = along(run, o0, o1, o.sill, o.head, 0.04, offset);
      const pane = along(run, o0, o1, o.sill, o.head, 0.02, offset);
      if (o.kind === "door") {
        nodes.push({
          id: `door.${id}.${n++}`,
          name: o.label,
          type: "door",
          roomId: o.roomId,
          geometry: { kind: "box", size: fill.size },
          position: fill.position,
          rotationY: 0,
          material: o.glazed ? "glass" : "door.wood",
          tags: ["door"],
        });
      } else {
        nodes.push({
          id: `window.${id}.${n++}`,
          name: o.label,
          type: "window",
          roomId: o.roomId,
          geometry: { kind: "box", size: pane.size },
          position: pane.position,
          rotationY: 0,
          material: "glass",
          tags: ["window"],
        });
        const bar = (from: number, to: number, y0: number, y1: number, name: string) => {
          const box = along(run, from, to, y0, y1, t + 0.02, offset);
          nodes.push({
            id: `frame.${id}.${n++}`,
            name,
            type: "frame",
            roomId: o.roomId,
            geometry: { kind: "box", size: box.size },
            position: box.position,
            rotationY: 0,
            material: "frame.metal",
            tags: ["frame"],
          });
        };
        bar(o0, o0 + 0.04, o.sill, o.head, "Window frame");
        bar(o1 - 0.04, o1, o.sill, o.head, "Window frame");
        bar(o0, o1, o.sill, o.sill + 0.04, "Window sill");
        bar(o0, o1, o.head - 0.04, o.head, "Window head");
        bar(o.center - 0.02, o.center + 0.02, o.sill, o.head, "Window mullion");
      }
    }
    piece(cursor, b, 0, ceilingM, run.exterior ? "Exterior wall" : "Wall");
  }
  return nodes;
}
