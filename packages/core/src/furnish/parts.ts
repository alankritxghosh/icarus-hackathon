import type { Item, Part } from "./place";

const box = (
  name: string,
  size: [number, number, number],
  at: [number, number, number],
  material: string,
  extra: Partial<Part> = {},
): Part => ({ name, size, at, material, ...extra });

/** A desk 0.75 m deep with an oak top and steel legs; the sitter is on the +z side. */
export function desk(width: number): Item {
  const d = 0.75;
  return {
    name: "desk",
    w: width,
    d,
    parts: [
      box("top", [width, 0.04, d], [0, 0.73, 0], "oak"),
      box("leg", [0.05, 0.71, d - 0.08], [-(width / 2 - 0.06), 0.355, 0], "metal.black"),
      box("leg", [0.05, 0.71, d - 0.08], [width / 2 - 0.06, 0.355, 0], "metal.black"),
      box("modesty panel", [width - 0.2, 0.3, 0.02], [0, 0.55, -d / 2 + 0.06], "oak.dark"),
    ],
  };
}

/** A task chair facing +z, with its back at -z. */
export function taskChair(): Item {
  return {
    name: "chair",
    w: 0.56,
    d: 0.56,
    parts: [
      box("base", [0.5, 0.04, 0.5], [0, 0.03, 0], "metal.black", { cylinder: true }),
      box("stem", [0.06, 0.4, 0.06], [0, 0.24, 0], "metal.black", { cylinder: true }),
      box("seat", [0.5, 0.07, 0.48], [0, 0.46, 0.02], "fabric.green"),
      box("back", [0.46, 0.5, 0.06], [0, 0.76, -0.22], "fabric.green"),
    ],
  };
}

/** A meeting table sized for its seats. */
export function table(width: number, depth: number): Item {
  return {
    name: "table",
    w: width,
    d: depth,
    parts: [
      box("top", [width, 0.05, depth], [0, 0.74, 0], "oak"),
      box("leg", [0.08, 0.72, depth - 0.2], [-(width / 2 - 0.35), 0.36, 0], "metal.black"),
      box("leg", [0.08, 0.72, depth - 0.2], [width / 2 - 0.35, 0.36, 0], "metal.black"),
    ],
  };
}

/** A wall screen for a meeting room, mounted on the wall at the item's back. */
export function screen(): Item {
  return {
    name: "screen",
    w: 1.6,
    d: 0.06,
    parts: [box("panel", [1.6, 0.9, 0.05], [0, 1.45, 0], "screen")],
  };
}

/** A one-person phone booth: three felt panels, a glass door and a light, open to +z. */
export function phoneBooth(): Item {
  const w = 1.0;
  const d = 1.0;
  return {
    name: "phone booth",
    w,
    d,
    front: 0.5,
    parts: [
      box("back", [w, 2.2, 0.06], [0, 1.1, -d / 2 + 0.03], "felt.green"),
      box("left", [0.06, 2.2, d], [-w / 2 + 0.03, 1.1, 0], "felt.green"),
      box("right", [0.06, 2.2, d], [w / 2 - 0.03, 1.1, 0], "felt.green"),
      box("roof", [w, 0.06, d], [0, 2.23, 0], "metal.black"),
      box("floor", [w - 0.1, 0.03, d - 0.1], [0, 0.015, 0], "oak.dark"),
      box("seat", [0.5, 0.45, 0.4], [0, 0.23, -0.25], "fabric.charcoal"),
      box("light", [0.5, 0.03, 0.08], [0, 2.17, -0.2], "light.warm", { type: "light" }),
    ],
  };
}

export function receptionDesk(width: number): Item {
  const d = 0.7;
  return {
    name: "reception desk",
    w: width,
    d,
    front: 0.9,
    parts: [
      box("counter", [width, 1.05, 0.45], [0, 0.525, d / 2 - 0.225], "oak"),
      box("top", [width + 0.1, 0.05, d], [0, 1.075, 0], "terrazzo"),
      box("back desk", [width - 0.2, 0.04, 0.5], [0, 0.73, -d / 2 + 0.05], "oak.dark"),
    ],
  };
}

export function serverRack(): Item {
  return {
    name: "server rack",
    w: 0.6,
    d: 1.0,
    front: 0.9,
    parts: [
      box("cabinet", [0.6, 2.0, 1.0], [0, 1.0, 0], "metal.black"),
      box("status lights", [0.4, 0.03, 0.02], [0, 1.8, 0.5], "light.warm", { type: "light" }),
    ],
  };
}

export function island(width: number): Item {
  const d = 0.85;
  return {
    name: "kitchen island",
    w: width,
    d,
    front: 0.9,
    parts: [
      box("base", [width, 0.88, d - 0.1], [0, 0.44, 0], "oak.dark"),
      box("top", [width + 0.08, 0.05, d], [0, 0.905, 0], "terrazzo"),
    ],
  };
}

export function fridge(): Item {
  return {
    name: "fridge",
    w: 0.75,
    d: 0.72,
    front: 0.8,
    parts: [box("body", [0.75, 1.85, 0.72], [0, 0.925, 0], "steel")],
  };
}

export function basinCounter(width: number): Item {
  return {
    name: "basins",
    w: width,
    d: 0.55,
    front: 0.8,
    parts: [
      box("counter", [width, 0.85, 0.55], [0, 0.425, 0], "laminate.white"),
      box("mirror", [width - 0.1, 1.0, 0.02], [0, 1.6, -0.265], "steel"),
    ],
  };
}

/** A toilet cubicle open to +z, with a door panel that stands slightly ajar. */
export function cubicle(): Item {
  return {
    name: "cubicle",
    w: 0.95,
    d: 1.5,
    front: 0.2,
    parts: [
      box("left", [0.03, 1.9, 1.5], [-0.46, 0.95, 0], "laminate.white"),
      box("right", [0.03, 1.9, 1.5], [0.46, 0.95, 0], "laminate.white"),
      box("door", [0.9, 1.8, 0.03], [0, 0.95, 0.735], "oak"),
      box("toilet", [0.38, 0.4, 0.62], [0, 0.2, -0.4], "laminate.white"),
    ],
  };
}

/** A hanging linear light above a work row; `ceilingM` fixes the height it hangs at. */
export function linearLight(length: number, ceilingM: number): Item {
  return {
    name: "linear light",
    w: length,
    d: 0.1,
    parts: [
      box("body", [length, 0.05, 0.1], [0, ceilingM - 0.5, 0], "light.warm", { type: "light" }),
      box("rod", [0.01, 0.45, 0.01], [-length / 2 + 0.3, ceilingM - 0.25, 0], "metal.black"),
      box("rod", [0.01, 0.45, 0.01], [length / 2 - 0.3, ceilingM - 0.25, 0], "metal.black"),
    ],
  };
}

/** A recessed downlight disc in the ceiling. */
export function downlight(ceilingM: number): Item {
  return {
    name: "downlight",
    w: 0.2,
    d: 0.2,
    parts: [
      box("disc", [0.24, 0.03, 0.24], [0, ceilingM - 0.02, 0], "light.warm", {
        type: "light",
        cylinder: true,
      }),
    ],
  };
}

/** A modern three-seat sofa in green fabric on an oak plinth, facing +z. */
export function sofa(width: number): Item {
  const d = 0.9;
  return {
    name: "sofa",
    w: width,
    d,
    front: 0.8,
    parts: [
      box("plinth", [width - 0.1, 0.1, d - 0.1], [0, 0.05, 0], "oak.dark"),
      box("base", [width, 0.3, d], [0, 0.25, 0], "fabric.green"),
      box("seat cushion", [width - 0.34, 0.13, d - 0.25], [0, 0.465, 0.07], "fabric.green"),
      box("back", [width, 0.5, 0.2], [0, 0.65, -d / 2 + 0.1], "fabric.green"),
      box("left arm", [0.16, 0.6, d], [-width / 2 + 0.08, 0.4, 0], "fabric.green"),
      box("right arm", [0.16, 0.6, d], [width / 2 - 0.08, 0.4, 0], "fabric.green"),
    ],
  };
}
