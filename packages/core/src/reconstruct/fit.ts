import type { PointCloud } from "./geometry";

type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

/** A small deterministic generator, so a fit is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

interface Plane {
  n: V3;
  /** n . p + d = 0 */
  d: number;
}

function planeThrough(a: V3, b: V3, c: V3): Plane | undefined {
  const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  if (Math.hypot(...n) < 1e-9) return undefined;
  const u = norm(n);
  return { n: u, d: -dot(u, a) };
}

/** Least-squares plane through points: the eigenvector of the covariance with the smallest eigenvalue. */
function refine(points: Float32Array, idx: number[]): Plane {
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (const i of idx) {
    mx += points[i * 3] as number;
    my += points[i * 3 + 1] as number;
    mz += points[i * 3 + 2] as number;
  }
  const n = idx.length;
  mx /= n;
  my /= n;
  mz /= n;
  const c = [0, 0, 0, 0, 0, 0];
  for (const i of idx) {
    const x = (points[i * 3] as number) - mx;
    const y = (points[i * 3 + 1] as number) - my;
    const z = (points[i * 3 + 2] as number) - mz;
    c[0] = (c[0] as number) + x * x;
    c[1] = (c[1] as number) + x * y;
    c[2] = (c[2] as number) + x * z;
    c[3] = (c[3] as number) + y * y;
    c[4] = (c[4] as number) + y * z;
    c[5] = (c[5] as number) + z * z;
  }
  const normal = smallestEigenvector(c as [number, number, number, number, number, number]);
  return { n: normal, d: -dot(normal, [mx, my, mz]) };
}

/** Jacobi rotations on a symmetric 3x3 matrix given as [xx, xy, xz, yy, yz, zz]. */
function smallestEigenvector(c: [number, number, number, number, number, number]): V3 {
  const a = [
    [c[0], c[1], c[2]],
    [c[1], c[3], c[4]],
    [c[2], c[4], c[5]],
  ] as number[][];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as number[][];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 2; p++)
      for (let q = p + 1; q < 3; q++) {
        const apq = (a[p] as number[])[q] as number;
        off += Math.abs(apq);
        if (Math.abs(apq) < 1e-14) continue;
        const app = (a[p] as number[])[p] as number;
        const aqq = (a[q] as number[])[q] as number;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < 3; k++) {
          const akp = (a[k] as number[])[p] as number;
          const akq = (a[k] as number[])[q] as number;
          (a[k] as number[])[p] = cs * akp - sn * akq;
          (a[k] as number[])[q] = sn * akp + cs * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = (a[p] as number[])[k] as number;
          const aqk = (a[q] as number[])[k] as number;
          (a[p] as number[])[k] = cs * apk - sn * aqk;
          (a[q] as number[])[k] = sn * apk + cs * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = (v[k] as number[])[p] as number;
          const vkq = (v[k] as number[])[q] as number;
          (v[k] as number[])[p] = cs * vkp - sn * vkq;
          (v[k] as number[])[q] = sn * vkp + cs * vkq;
        }
      }
    if (off < 1e-12) break;
  }
  let best = 0;
  for (let i = 1; i < 3; i++)
    if (((a[i] as number[])[i] as number) < ((a[best] as number[])[best] as number)) best = i;
  return norm([
    (v[0] as number[])[best] as number,
    (v[1] as number[])[best] as number,
    (v[2] as number[])[best] as number,
  ]);
}

export interface Wall {
  /** Unit normal in the floor plane (x right, z forward), pointing from the wall toward the camera. */
  normal: [number, number];
  /** Distance from the camera's foot to the wall along its normal, in metres. */
  distanceM: number;
  /** Where along the wall the points reach, in metres along its direction (x right of the normal's left-hand tangent). */
  extentM: [number, number];
  /** Which wall it is from where the camera looks. */
  side: "back" | "left" | "right" | "front";
  points: number;
}

export interface RoomFit {
  /** Camera height above the floor, metres. */
  cameraHeightM: number;
  /** Floor to ceiling, when a ceiling is clearly visible. */
  ceilingHeightM?: number;
  walls: Wall[];
  /** The cloud in the room frame: x right, y up from the floor, z forward, origin under the camera. */
  world: Float32Array;
  floorInliers: number;
  /** How much of the cloud lies on the floor, a rough check on how much to trust the rest. */
  floorShare: number;
}

export interface FitOptions {
  seed?: number;
  /** Plane tolerance in metres. */
  toleranceM?: number;
}

/**
 * Find the room in a single-photo point cloud: the floor (and so the camera height and the
 * vertical), the ceiling when it shows, and the vertical walls. Deterministic for a cloud.
 * Returns undefined when no floor can be found, which is a real outcome for a close-up.
 */
export function fitRoom(cloud: PointCloud, options: FitOptions = {}): RoomFit | undefined {
  const tol = options.toleranceM ?? 0.05;
  const random = rng(options.seed ?? 1);
  const { points, count } = cloud;

  // Floor: the largest plane whose normal is near the camera's vertical (y is down).
  const lowerHalf: number[] = [];
  for (let i = 0; i < count; i++) if ((points[i * 3 + 1] as number) > 0) lowerHalf.push(i);
  if (lowerHalf.length < 200) return undefined;
  let best: { plane: Plane; inliers: number[] } | undefined;
  for (let it = 0; it < 400; it++) {
    const pick = () => lowerHalf[Math.floor(random() * lowerHalf.length)] as number;
    const [ia, ib, ic] = [pick(), pick(), pick()];
    const at = (i: number): V3 => [
      points[i * 3] as number,
      points[i * 3 + 1] as number,
      points[i * 3 + 2] as number,
    ];
    const plane = planeThrough(at(ia), at(ib), at(ic));
    if (!plane || Math.abs(plane.n[1]) < Math.cos((35 * Math.PI) / 180)) continue;
    const inliers: number[] = [];
    for (const i of lowerHalf) if (Math.abs(dot(plane.n, at(i)) + plane.d) < tol) inliers.push(i);
    if (!best || inliers.length > best.inliers.length) best = { plane, inliers };
  }
  if (!best || best.inliers.length < 150) return undefined;
  let floor = refine(points, best.inliers);
  // Point the normal up (toward the camera) and put the origin on its positive side.
  if (floor.d < 0) floor = { n: [-floor.n[0], -floor.n[1], -floor.n[2]], d: -floor.d };
  const up = floor.n;
  if (up[1] > 0) return undefined; // the camera would be below the floor
  const cameraHeightM = floor.d;
  if (cameraHeightM < 0.3 || cameraHeightM > 4) return undefined;

  // The camera's forward direction flattened onto the floor plane.
  const along = dot([0, 0, 1], up);
  const fwd0 = norm([-along * up[0], -along * up[1], 1 - along * up[2]]);
  // The camera frame is right-handed (x right, y down, z forward), so with y flipped to up the
  // handedness flips too: right is forward cross up.
  const right = norm(cross(fwd0, up));
  const fwd = norm(cross(up, right));

  const world = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p: V3 = [
      points[i * 3] as number,
      points[i * 3 + 1] as number,
      points[i * 3 + 2] as number,
    ];
    world[i * 3] = dot(p, right);
    world[i * 3 + 1] = dot(p, up) + cameraHeightM;
    world[i * 3 + 2] = dot(p, fwd);
  }

  // Ceiling: a clear peak in the heights above head height.
  let ceilingHeightM: number | undefined;
  const bins = new Map<number, number>();
  let high = 0;
  for (let i = 0; i < count; i++) {
    const h = world[i * 3 + 1] as number;
    if (h > 2 && h < 6) {
      high++;
      const k = Math.round(h / 0.05);
      bins.set(k, (bins.get(k) ?? 0) + 1);
    }
  }
  let peak = 0;
  let peakBin = 0;
  for (const [k, n] of bins) {
    const near = (bins.get(k - 1) ?? 0) + n + (bins.get(k + 1) ?? 0);
    if (near > peak) {
      peak = near;
      peakBin = k;
    }
  }
  if (high > 0 && peak > count * 0.04) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const h = world[i * 3 + 1] as number;
      if (Math.abs(h - peakBin * 0.05) < 0.1) {
        sum += h;
        n++;
      }
    }
    ceilingHeightM = sum / n;
  }

  // Walls: lines in the floor plane through points at wall height, with real vertical spread.
  const band: number[] = [];
  for (let i = 0; i < count; i++) {
    const h = world[i * 3 + 1] as number;
    if (h > 0.4 && h < (ceilingHeightM ?? 3) - 0.2) band.push(i);
  }
  // A pixel far away covers more wall than one up close, so count points by the surface they stand for.
  const weight = (i: number) => {
    const x = world[i * 3] as number;
    const z = world[i * 3 + 2] as number;
    return Math.max(1, x * x + z * z);
  };
  const totalWeight = band.reduce((sum, i) => sum + weight(i), 0);
  const remaining = new Set(band);
  const walls: Wall[] = [];
  const xz = (i: number): [number, number] => [world[i * 3] as number, world[i * 3 + 2] as number];
  for (let wall = 0; wall < 8 && remaining.size > 60; wall++) {
    const pool = [...remaining];
    let top: { n: [number, number]; d: number; inliers: number[]; score: number } | undefined;
    for (let it = 0; it < 300; it++) {
      const a = xz(pool[Math.floor(random() * pool.length)] as number);
      const b = xz(pool[Math.floor(random() * pool.length)] as number);
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.8) continue;
      const n: [number, number] = [-dz / len, dx / len];
      const d = -(n[0] * a[0] + n[1] * a[1]);
      const inliers: number[] = [];
      let score = 0;
      for (const i of pool) {
        const p = xz(i);
        // The tolerance widens with distance: depth error grows with range.
        const range = Math.hypot(p[0], p[1]);
        if (Math.abs(n[0] * p[0] + n[1] * p[1] + d) < tol * 1.2 * Math.max(1, range / 4)) {
          inliers.push(i);
          score += weight(i);
        }
      }
      if (!top || score > top.score) top = { n, d, inliers, score };
    }
    if (!top || top.inliers.length < 60 || top.score < totalWeight * 0.025) break;
    const hs = top.inliers.map((i) => world[i * 3 + 1] as number).sort((x, y) => x - y);
    const spread =
      (hs[Math.floor(hs.length * 0.95)] as number) - (hs[Math.floor(hs.length * 0.05)] as number);
    for (const i of top.inliers) remaining.delete(i);
    if (spread < 0.9) continue; // a desk edge or a shelf, not a wall
    // Normal toward the camera (the origin): d must be positive.
    let { n, d } = top;
    if (d < 0) {
      n = [-n[0], -n[1]];
      d = -d;
    }
    const tangent: [number, number] = [-n[1], n[0]];
    const along = top.inliers.map((i) => {
      const p = xz(i);
      return p[0] * tangent[0] + p[1] * tangent[1];
    });
    const sorted = [...along].sort((x, y) => x - y);
    const lo = sorted[Math.floor(sorted.length * 0.02)] as number;
    const hi = sorted[Math.floor(sorted.length * 0.98)] as number;
    if (hi - lo < 1.2) continue;
    // From the camera, a wall is the back if its normal points mostly back toward us (-z).
    const side: Wall["side"] =
      Math.abs(n[1]) > Math.abs(n[0]) ? (n[1] < 0 ? "back" : "front") : n[0] > 0 ? "left" : "right";
    walls.push({ normal: n, distanceM: d, extentM: [lo, hi], side, points: top.inliers.length });
  }

  // Drop duplicates (the same wall found twice, at slightly different distances) and lines far
  // longer than any room, which are noise stretched across the cloud.
  const kept: Wall[] = [];
  for (const wall of [...walls].sort((a, b) => b.points - a.points)) {
    if (wall.extentM[1] - wall.extentM[0] > 30) continue;
    const duplicate = kept.some((k) => {
      const cosine = k.normal[0] * wall.normal[0] + k.normal[1] * wall.normal[1];
      return (
        cosine > Math.cos((14 * Math.PI) / 180) && Math.abs(k.distanceM - wall.distanceM) < 0.9
      );
    });
    if (!duplicate) kept.push(wall);
  }

  return {
    cameraHeightM,
    ceilingHeightM,
    walls: kept,
    world,
    floorInliers: best.inliers.length,
    floorShare: best.inliers.length / count,
  };
}
