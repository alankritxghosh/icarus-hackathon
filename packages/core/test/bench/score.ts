import { decodeGeometry, fitRoom, type RoomFit } from "../../src";

export interface TruthView {
  office: number;
  view: string;
  id: string;
  camera: [number, number, number];
  target: [number, number, number];
  ceilingM: number;
  room: { x: number; y: number; w: number; h: number } | null;
}

export interface Measure {
  kind: "camera" | "ceiling" | "wall";
  label: string;
  measured: number;
  truth: number;
}

export interface ViewScore {
  view: TruthView;
  fit?: RoomFit;
  measures: Measure[];
  falseWalls: number;
  missedWalls: number;
}

const deg = (d: number) => Math.cos((d * Math.PI) / 180);

/** The four planes of a room as seen from a camera: inward normal in the camera's room frame, and distance. */
function truthWalls(view: TruthView) {
  const room = view.room;
  if (!room) return [];
  const [cx, , cz] = view.camera;
  const dx = view.target[0] - cx;
  const dz = view.target[2] - cz;
  const l = Math.hypot(dx, dz);
  const fwd: [number, number] = [dx / l, dz / l];
  const right: [number, number] = [-fwd[1], fwd[0]];
  const planes: { name: string; nu: [number, number]; distance: number }[] = [
    { name: "north", nu: [0, 1], distance: cz - room.y },
    { name: "south", nu: [0, -1], distance: room.y + room.h - cz },
    { name: "west", nu: [1, 0], distance: cx - room.x },
    { name: "east", nu: [-1, 0], distance: room.x + room.w - cx },
  ];
  return planes.map((p) => {
    const normal: [number, number] = [
      p.nu[0] * right[0] + p.nu[1] * right[1],
      p.nu[0] * fwd[0] + p.nu[1] * fwd[1],
    ];
    return { ...p, normal, behind: normal[1] > 0.5 };
  });
}

/** Score one view's reconstruction against what is known to be true. `scale` multiplies every measured length. */
export function scoreView(view: TruthView, geometry: unknown, scale = 1): ViewScore {
  const fit = fitRoom(decodeGeometry(geometry));
  const measures: Measure[] = [];
  if (!fit) return { view, measures, falseWalls: 0, missedWalls: 0 };
  measures.push({
    kind: "camera",
    label: "camera height",
    measured: fit.cameraHeightM * scale,
    truth: view.camera[1],
  });
  if (fit.ceilingHeightM)
    measures.push({
      kind: "ceiling",
      label: "ceiling",
      measured: fit.ceilingHeightM * scale,
      truth: view.ceilingM,
    });
  const truth = truthWalls(view);
  const used = new Set<number>();
  let missed = 0;
  for (const t of truth) {
    if (t.behind) continue;
    let best = -1;
    let bestScore = -1;
    fit.walls.forEach((w, i) => {
      const cos = w.normal[0] * t.normal[0] + w.normal[1] * t.normal[1];
      if (cos < deg(20) || used.has(i)) return;
      const closeness = cos - Math.abs(w.distanceM * scale - t.distance) * 0.05;
      if (closeness > bestScore) {
        bestScore = closeness;
        best = i;
      }
    });
    const found = best >= 0 ? fit.walls[best] : undefined;
    if (found && Math.abs(found.distanceM * scale - t.distance) < Math.max(2.5, t.distance * 0.5)) {
      used.add(best);
      measures.push({
        kind: "wall",
        label: `${t.name} wall`,
        measured: found.distanceM * scale,
        truth: t.distance,
      });
    } else missed++;
  }
  return { view, fit, measures, falseWalls: fit.walls.length - used.size, missedWalls: missed };
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] as number) : Number.NaN;
};
export const relError = (m: Measure) => m.measured / m.truth - 1;
