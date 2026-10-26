import { z } from "zod";

// Present at runtime in browsers and Node; the core library target has no DOM typings.
declare function atob(data: string): string;

/**
 * What the Modal worker returns for one photograph (version 1). Points are in metres in OpenCV
 * camera coordinates: x right, y down, z forward, camera at the origin. Binary arrays are base64.
 */
export const GeometrySchema = z.object({
  version: z.literal(1),
  model: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  intrinsics: z.array(z.array(z.number()).length(3)).length(3),
  fov_x_deg: z.number().min(10).max(170),
  count: z.int().min(100),
  points: z.string(),
  colors: z.string(),
  uv: z.string().optional(),
  depth_m: z.record(z.string(), z.number()),
  seconds: z.number(),
});
export type GeometryJson = z.infer<typeof GeometrySchema>;

export interface PointCloud {
  count: number;
  /** x, y, z per point, camera coordinates. */
  points: Float32Array;
  /** r, g, b per point. */
  colors: Uint8Array;
  /** Pixel x, y per point, when the worker sent them. */
  uv?: Uint16Array;
  fovXDeg: number;
  width: number;
  height: number;
}

function bytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Decode and validate a worker reply. Throws with a plain reason when anything is off. */
export function decodeGeometry(raw: unknown): PointCloud {
  const g = GeometrySchema.parse(raw);
  const p = bytes(g.points);
  const c = bytes(g.colors);
  if (p.byteLength !== g.count * 12)
    throw new Error("the point array does not match the point count");
  if (c.byteLength !== g.count * 3)
    throw new Error("the colour array does not match the point count");
  const points = new Float32Array(p.buffer, p.byteOffset, g.count * 3);
  for (const v of points)
    if (!Number.isFinite(v)) throw new Error("the point cloud contains a non-finite value");
  const out: PointCloud = {
    count: g.count,
    points,
    colors: c,
    fovXDeg: g.fov_x_deg,
    width: g.width,
    height: g.height,
  };
  if (g.uv) {
    const u = bytes(g.uv);
    if (u.byteLength === g.count * 4) out.uv = new Uint16Array(u.buffer, u.byteOffset, g.count * 2);
  }
  return out;
}
