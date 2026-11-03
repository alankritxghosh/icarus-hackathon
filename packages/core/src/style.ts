import { z } from "zod";
import { MATERIALS, type MaterialDef } from "./build/scene";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a #rrggbb colour");

export const FLOORS = [
  "oak",
  "light_oak",
  "dark_wood",
  "concrete",
  "carpet_grey",
  "patterned_carpet",
  "tile",
] as const;
export type FloorKind = (typeof FLOORS)[number];

/** How the office looks, apart from where things are. Defaults are the warm oak and green house style. */
export const StyleSchema = z.object({
  floor: z.enum(FLOORS).default("oak"),
  /** A measured floor colour that replaces the preset's, keeping its texture. */
  floorColor: hex.optional(),
  /** The colour of upholstery, chairs, felt and carpet in meeting rooms. */
  accent: hex.default("#4d7558"),
  walls: hex.default("#f1efe9"),
  /** An exposed dark ceiling with services, or a plain white one. */
  ceiling: z.enum(["white", "exposed_dark"]).default("white"),
});
export type Style = z.infer<typeof StyleSchema>;

type FloorFinish = Pick<MaterialDef, "color" | "texture" | "roughness" | "pbr" | "tileM">;

/**
 * Each floor's procedural look (the software renderer's fallback) and, where a scanned CC0 set fits, its photographic
 * material. A photographic set is multiplied by `pbrTint`, so a tint of white shows the scan as it was photographed.
 */
const FLOOR_MATERIAL: Record<FloorKind, FloorFinish & { pbrTint?: string }> = {
  oak: {
    color: "#c79d6a",
    texture: "planks",
    roughness: 0.55,
    pbr: "laminate_floor_02",
    tileM: 1.5,
    pbrTint: "#ffffff",
  },
  light_oak: {
    color: "#dcc49c",
    texture: "planks",
    roughness: 0.55,
    pbr: "herringbone_parquet",
    tileM: 1.2,
    pbrTint: "#ffffff",
  },
  dark_wood: {
    color: "#7a5436",
    texture: "planks",
    roughness: 0.5,
    pbr: "laminate_floor_02",
    tileM: 1.5,
    pbrTint: "#9c7d64",
  },
  concrete: {
    color: "#a9a8a3",
    roughness: 0.8,
    pbr: "concrete_floor_02",
    tileM: 2,
    pbrTint: "#ffffff",
  },
  carpet_grey: { color: "#8b9298", texture: "carpet", roughness: 1 },
  patterned_carpet: { color: "#7d7466", texture: "carpet", roughness: 1 },
  tile: { color: "#d6d8d6", roughness: 0.4, pbr: "interior_tiles", tileM: 1.2, pbrTint: "#ffffff" },
};

/** A floor finish as a scene material: the photographic set unless a measured colour asks for the plain one. */
function floorFinish(floor: (typeof FLOOR_MATERIAL)[FloorKind], color?: string): FloorFinish {
  const { pbrTint, pbr, tileM, ...plain } = floor;
  if (color || !pbr) return { ...plain, ...(color ? { color } : {}) };
  return { ...plain, pbr, tileM, color: pbrTint ?? "#ffffff" };
}

/** Shift a colour toward white, to make a carpet from an accent. */
function lighten(color: string, amount: number): string {
  const n = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** The scene materials with a style applied. Pure: the shared defaults are never mutated. */
export function applyStyle(style: Style): Record<string, MaterialDef> {
  const floor = FLOOR_MATERIAL[style.floor];
  const materials: Record<string, MaterialDef> = { ...MATERIALS };
  const base = { metalness: 0, opacity: 1 };
  materials["floor.oak"] = { ...base, ...floorFinish(floor, style.floorColor) };
  materials["floor.oak.light"] = {
    ...base,
    ...(style.floorColor
      ? floorFinish(floor, lighten(style.floorColor, 0.12))
      : style.floor === "oak"
        ? floorFinish(FLOOR_MATERIAL.light_oak)
        : floorFinish(floor)),
  };
  materials["floor.carpet.green"] = {
    ...base,
    color: lighten(style.accent, 0.25),
    texture: "carpet",
    roughness: 1,
  };
  materials["fabric.green"] = { ...base, color: style.accent, roughness: 0.95 };
  materials["felt.green"] = { ...base, color: style.accent, roughness: 1 };
  // The plaster scan is nearly white, so the wall colour tints it without darkening it.
  materials["wall.interior"] = {
    ...base,
    color: style.walls,
    pbr: "plastered_wall",
    tileM: 2,
    roughness: 0.9,
  };
  if (style.ceiling === "exposed_dark")
    materials.ceiling = { ...base, color: "#2a2c2d", roughness: 0.95, emissive: "#3a3c3d" };
  return materials;
}

const NAMED: [string, number, number, number][] = [
  ["black", 24, 24, 26],
  ["charcoal", 56, 60, 62],
  ["grey", 140, 145, 150],
  ["light grey", 200, 202, 204],
  ["white", 245, 245, 242],
  ["cream", 235, 225, 200],
  ["beige", 205, 185, 150],
  ["tan", 180, 130, 80],
  ["brown", 110, 75, 50],
  ["red", 190, 40, 40],
  ["orange", 225, 120, 40],
  ["mustard yellow", 220, 170, 40],
  ["olive green", 120, 130, 60],
  ["green", 70, 150, 80],
  ["deep forest green", 68, 112, 82],
  ["teal", 40, 130, 135],
  ["blue", 50, 100, 190],
  ["navy blue", 30, 50, 110],
  ["purple", 110, 70, 150],
  ["pink", 220, 130, 160],
];

/** The plain-English name of the nearest common colour, for prompts and captions. */
export function colourName(color: string): string {
  const n = Number.parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = NAMED[0] as (typeof NAMED)[number];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of NAMED) {
    const d = (entry[1] - r) ** 2 + (entry[2] - g) ** 2 + (entry[3] - b) ** 2;
    if (d < bestDistance) {
      best = entry;
      bestDistance = d;
    }
  }
  return best[0];
}

const FLOOR_WORDS: Record<FloorKind, string> = {
  oak: "warm oak plank flooring",
  light_oak: "pale light oak plank flooring",
  dark_wood: "dark walnut wood flooring",
  concrete: "polished grey concrete flooring",
  carpet_grey: "grey carpet tile flooring",
  patterned_carpet: "patterned carpet tile flooring",
  tile: "pale tile flooring",
};

/** What the style looks like, in words a picture model follows. The house style reads as warm oak and green. */
export function describeStyle(style: Style): {
  floor: string;
  furniture: string;
  walls: string;
  ceiling: string;
} {
  return {
    floor: style.floorColor
      ? `${FLOOR_WORDS[style.floor]} in a ${colourName(style.floorColor)} tone`
      : FLOOR_WORDS[style.floor],
    furniture: `${colourName(style.accent)} upholstered chairs and soft furnishings`,
    walls: `${colourName(style.walls)} walls`,
    ceiling:
      style.ceiling === "exposed_dark"
        ? "a dark exposed ceiling with ducts and pipes"
        : "a plain white ceiling",
  };
}
