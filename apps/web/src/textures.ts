import * as THREE from "three";

/**
 * Procedural surface textures, drawn once. They are near white so the material colour tints them;
 * a seeded generator keeps them identical on every load.
 */
function canvas(draw: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function drawPlanks(g: CanvasRenderingContext2D, size: number) {
  const rnd = random(7);
  const boards = 6;
  const h = size / boards;
  for (let i = 0; i < boards; i++) {
    let x = -rnd() * 200;
    while (x < size) {
      const len = 220 + rnd() * 200;
      const tone = 0.86 + rnd() * 0.16;
      g.fillStyle = `rgb(${Math.round(255 * tone)},${Math.round(250 * tone)},${Math.round(240 * tone)})`;
      g.fillRect(x, i * h, len, h);
      g.strokeStyle = "rgba(110,75,40,0.13)";
      g.lineWidth = 1;
      for (let k = 0; k < 7; k++) {
        const y = i * h + 3 + rnd() * (h - 6);
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(
          x + len * 0.3,
          y + rnd() * 5 - 2.5,
          x + len * 0.7,
          y + rnd() * 5 - 2.5,
          x + len,
          y,
        );
        g.stroke();
      }
      g.fillStyle = "rgba(70,45,20,0.4)";
      g.fillRect(x, i * h, 1.5, h);
      x += len;
    }
    g.fillStyle = "rgba(70,45,20,0.4)";
    g.fillRect(0, i * h, size, 1.5);
  }
}

function drawCarpet(g: CanvasRenderingContext2D, size: number) {
  const rnd = random(11);
  g.fillStyle = "rgb(236,236,236)";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const v = 190 + Math.round(rnd() * 65);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rnd() * size, rnd() * size, 2, 2);
  }
}

let planks: THREE.CanvasTexture | undefined;
let carpet: THREE.CanvasTexture | undefined;

/** A copy of the named texture tiled so one repeat covers `tileM` metres of a `w` by `d` metre surface. */
export function surface(
  kind: "planks" | "carpet",
  w: number,
  d: number,
  tileM = 2.2,
): THREE.Texture {
  planks ??= canvas(drawPlanks);
  carpet ??= canvas(drawCarpet);
  const copy = (kind === "planks" ? planks : carpet).clone();
  copy.needsUpdate = true;
  copy.repeat.set(w / tileM, d / tileM);
  return copy;
}
