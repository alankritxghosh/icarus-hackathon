"""
Draws the front page's hero: an office Icarus designed, sketched in blue pen, as an SVG that animates itself.

Input is a scene dump ({"shell", "nodes"} with each node's type, size, position and rotation) of the 35-person studio
starter brief. Every box is projected through a perspective camera at the studio's opening three-quarter view; only the
faces turned towards the camera are kept. Each face becomes a path that is first drawn as a pen line (floor, then walls,
then furniture), then washed with a tint once the drawing is done, held, faded and drawn again in a loop. The animation is CSS inside the SVG, so it plays as
an <img> and stays still for people who ask for reduced motion.

    python3 scripts/hero-sketch.py scene.json apps/web/public/home/office-sketch.svg
"""

from __future__ import annotations

import json
import math
import sys

W, H = 1300, 820
INK = "#1f3a8f"
KEEP = {"floor", "wall", "door", "furniture", "fixture"}


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(a):
    n = math.sqrt(dot(a, a)) or 1.0
    return [x / n for x in a]


def main(src: str, dst: str) -> None:
    scene = json.load(open(src))
    w, h = scene["shell"]["w"], scene["shell"]["h"]
    reach = max(w, h)
    eye = [w / 2 + reach * 0.95, reach * 0.9, h / 2 + reach * 1.2]
    target = [w / 2, 1.0, h / 2]
    forward = unit(sub(target, eye))
    right = unit(cross(forward, [0, 1, 0]))
    up = cross(right, forward)
    focal = (H / 2) / math.tan(math.radians(30) / 2)

    def project(p):
        d = sub(p, eye)
        z = dot(d, forward)
        return (W / 2 + focal * dot(d, right) / z, H / 2 - focal * dot(d, up) / z, z)

    faces = []
    for node in scene["nodes"]:
        if node["type"] not in KEEP or node["kind"] == "cylinder":
            continue
        sx, sy, sz = node["size"]
        px, py, pz = node["position"]
        cy = py + sy / 2 if node["kind"] == "asset" else py
        c, s = math.cos(node["rotationY"]), math.sin(node["rotationY"])

        def corner(ix, iy, iz):
            lx, ly, lz = ix * sx / 2, iy * sy / 2, iz * sz / 2
            return [px + c * lx + s * lz, cy + ly, pz - s * lx + c * lz]

        # Each face: its four corners and its outward normal (rotated with the box). The bottom is never seen.
        boxes = {
            "top": ([(-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)], [0, 1, 0]),
            "+x": ([(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)], [c, 0, -s]),
            "-x": ([(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)], [-c, 0, s]),
            "+z": ([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], [s, 0, c]),
            "-z": ([(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)], [-s, 0, -c]),
        }
        for side, (quad, normal) in boxes.items():
            pts = [corner(*q) for q in quad]
            centre = [sum(p[i] for p in pts) / 4 for i in range(3)]
            if dot(normal, sub(eye, centre)) <= 0:
                continue
            flat = [project(p) for p in pts]
            if any(z <= 0.1 for _, _, z in flat):
                continue
            faces.append(
                {
                    "type": node["type"],
                    "side": side,
                    "depth": math.dist(centre, eye),
                    "order": centre[0] + centre[2] * 0.3,
                    "pts": [(x, y) for x, y, _ in flat],
                }
            )

    # Drawing order: the floor, then the walls left to right, then everything inside; shading after all the lines.
    stage = {"floor": 0, "wall": 1, "door": 1}
    timing = {0: (0.0, 0.9), 1: (0.6, 2.4), 2: (2.2, 3.8)}
    groups: dict[int, list[dict]] = {}
    for f in faces:
        groups.setdefault(stage.get(f["type"], 2), []).append(f)
    for g, items in groups.items():
        start, end = timing[g]
        items.sort(key=lambda f: f["order"])
        for i, f in enumerate(items):
            f["delay"] = start + (end - start) * i / max(1, len(items) - 1)

    # One loop of LOOP seconds: lines drawn up to 4.5 s, shading 4.2 to 5.4 s, held, faded out 8.6 to 9.4 s, then again.
    # Every line restarts at the same moment, so each line's start is written into its bucket's keyframes rather than as
    # a delay; lines starting within 0.1 s of each other share a bucket.
    LOOP, DRAW = 10.0, 0.7
    pct = lambda t: f"{100 * t / LOOP:.2f}%"
    buckets = sorted({round(f["delay"], 1) for f in faces})
    keyframes = "".join(
        f"@keyframes d{i} {{ 0%, {pct(t)} {{ stroke-dashoffset: 1; }} {pct(t + DRAW)}, 100% {{ stroke-dashoffset: 0; }} }}"
        f".d{i} {{ animation: d{i} {LOOP}s linear infinite; }}"
        for i, t in enumerate(buckets)
    )
    bucket = {t: i for i, t in enumerate(buckets)}
    tint = {"top": "#eef0f7", "+x": "#b9c4e0", "-x": "#cdd5ea", "+z": "#d9deef", "-z": "#c3cce5"}
    paths = []
    for f in sorted(faces, key=lambda f: -f["depth"]):
        d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in f["pts"]) + "Z"
        fill = "#e6eaf4" if f["type"] == "floor" else tint[f["side"]]
        width = 1.3 if f["type"] == "wall" else 0.8
        paths.append(
            f'<path class="d{bucket[round(f["delay"], 1)]}" d="{d}" pathLength="1" fill="{fill}" stroke-width="{width}"/>'
        )

    style = f"""
path {{ stroke: {INK}; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1;
  fill-opacity: inherit; }}
g {{ animation: cycle {LOOP}s linear infinite; }}
@keyframes cycle {{ 0%, {pct(4.2)} {{ fill-opacity: 0; opacity: 1; }} {pct(5.4)}, {pct(8.6)} {{ fill-opacity: 1; opacity: 1; }}
  {pct(9.4)}, 100% {{ fill-opacity: 1; opacity: 0; }} }}
{keyframes}
@media (prefers-reduced-motion: reduce) {{ g, path {{ animation: none !important; stroke-dashoffset: 0; fill-opacity: 1; }} }}
"""
    # Crop to the drawing, with room for the pen's wobble.
    xs = [x for f in faces for x, _ in f["pts"]]
    ys = [y for f in faces for _, y in f["pts"]]
    pad = 12
    box = f"{min(xs) - pad:.0f} {min(ys) - pad:.0f} {max(xs) - min(xs) + 2 * pad:.0f} {max(ys) - min(ys) + 2 * pad:.0f}"
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" '
        f'aria-label="An office Icarus designed, sketched in blue pen">'
        '<filter id="pen"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7"/>'
        '<feDisplacementMap in="SourceGraphic" scale="2.2"/></filter>'
        f"<style>{style}</style><g filter=\"url(#pen)\">{''.join(paths)}</g></svg>"
    )
    open(dst, "w").write(svg)
    print(f"{len(paths)} faces, {len(svg) / 1024:.0f} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
