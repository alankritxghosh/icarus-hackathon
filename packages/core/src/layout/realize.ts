import { KIND_RULES } from "../catalog";
import type { Rect } from "../geometry";
import type { PlannedRoom } from "../program";
import { CORRIDOR_WIDTH_M, LOBBY_WIDTH_M } from "./types";

export interface Realized {
  /** Canonical-frame rectangle for every room id. */
  rects: Map<string, Rect>;
  rowY: number[];
  rowDepth: number[];
  corridors: Rect[];
  lobby: Rect;
  /** Scale applied to every target area so the rooms fill the space left after circulation. */
  scale: number;
  /** True when even the minimum widths do not fit a row. */
  crowded: boolean;
}

/**
 * Turn an ordering of rooms into rectangles. Rows are separated by corridors and share one
 * lobby column on the entrance side. Row depth is proportional to the area in the row, and room
 * widths are proportional to target area, raised to each room's minimum width where needed.
 */
export function realize(
  rows: string[][],
  rooms: Map<string, PlannedRoom>,
  W: number,
  D: number,
): Realized {
  const k = rows.length;
  const avail = W - LOBBY_WIDTH_M;
  const depthTotal = D - (k - 1) * CORRIDOR_WIDTH_M;
  const targets = rows.map((row) =>
    row.reduce((s, id) => s + (rooms.get(id)?.targetAreaM2 ?? 0), 0),
  );
  const totalTarget = targets.reduce((s, v) => s + v, 0);
  const rects = new Map<string, Rect>();
  const rowY: number[] = [];
  const rowDepth: number[] = [];
  const corridors: Rect[] = [];
  let crowded = false;
  let y = 0;
  rows.forEach((row, b) => {
    const depth = (depthTotal * (targets[b] ?? 0)) / totalTarget;
    rowY.push(y);
    rowDepth.push(depth);
    const widths = fitWidths(
      row.map((id) => rooms.get(id)?.targetAreaM2 ?? 0),
      row.map((id) => KIND_RULES[rooms.get(id)?.kind ?? "storage"].minWidth),
      avail,
    );
    if (widths.crowded) crowded = true;
    let x = LOBBY_WIDTH_M;
    row.forEach((id, i) => {
      const w = widths.values[i] ?? 0;
      rects.set(id, { x, y, w, h: depth });
      x += w;
    });
    y += depth;
    if (b < k - 1) {
      corridors.push({ x: LOBBY_WIDTH_M, y, w: avail, h: CORRIDOR_WIDTH_M });
      y += CORRIDOR_WIDTH_M;
    }
  });
  return {
    rects,
    rowY,
    rowDepth,
    corridors,
    lobby: { x: 0, y: 0, w: LOBBY_WIDTH_M, h: D },
    scale: (avail * depthTotal) / totalTarget,
    crowded,
  };
}

/**
 * Widths proportional to area that fill `total`, with a floor per item. Items below their floor
 * are pinned at it and the rest share what is left, repeated until nothing changes.
 */
export function fitWidths(
  areas: number[],
  mins: number[],
  total: number,
): { values: number[]; crowded: boolean } {
  const sumMin = mins.reduce((s, v) => s + v, 0);
  if (sumMin > total) return { values: mins.map((m) => (m * total) / sumMin), crowded: true };
  const pinned = new Set<number>();
  let values = areas.map(() => 0);
  for (let pass = 0; pass <= areas.length; pass++) {
    const freeArea = areas.reduce((s, a, i) => (pinned.has(i) ? s : s + a), 0);
    const left = total - [...pinned].reduce((s, i) => s + (mins[i] ?? 0), 0);
    values = areas.map((a, i) => (pinned.has(i) ? (mins[i] ?? 0) : (left * a) / freeArea));
    const next = values.findIndex((v, i) => !pinned.has(i) && v < (mins[i] ?? 0) - 1e-9);
    if (next < 0) break;
    pinned.add(next);
  }
  return { values, crowded: false };
}
