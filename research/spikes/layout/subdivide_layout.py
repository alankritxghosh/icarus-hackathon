"""Spike: lay out rooms by recursive subdivision of a polygon, with local search on top.

The floor polygon is split by axis-aligned cuts into one region per room (a guillotine layout,
generalised to a polygon because a cut of an L-shape simply yields polygons). Cut position follows
the area targets; the search moves over (a) the order of rooms and (b) the first cut's orientation.
A corridor spine and the entrance lobby are carved out first, as in the CP-SAT spike, so both
generators solve the same problem. Regions that are not rectangles are rejected, so every room
stays a usable rectangle and the result can be scored by the shared metrics.
"""
import json
import math
import random
import sys
import time

from shapely.geometry import box
from shapely.ops import unary_union

from metrics import plan_metrics, plan_svg, shell_polygon

LOBBY, CORRIDOR = 2.0, 1.6
data = json.load(open("../../results/problems.json"))
KINDS = data["kinds"]


def is_rect(poly, tol=1e-6):
    if poly.is_empty or poly.geom_type != "Polygon":
        return False
    return abs(poly.area - poly.envelope.area) < tol


def split(region, items, axis):
    """Cut region (a Polygon) into two by an axis-aligned line so that area follows the targets."""
    left, right = items[0], items[1]
    # greedy partition of the sequence into two groups close to half of the area
    total = sum(i["t"] for i in items)
    acc, k = 0.0, 0
    for k, it in enumerate(items[:-1], 1):
        acc += it["t"]
        if acc >= total / 2:
            break
    a, b = items[:k], items[k:]
    frac = sum(i["t"] for i in a) / total
    minx, miny, maxx, maxy = region.bounds
    lo, hi = (minx, maxx) if axis == "x" else (miny, maxy)
    target = region.area * frac
    for _ in range(60):  # bisection on the cut coordinate so the first region has the right area
        mid = (lo + hi) / 2
        part = region.intersection(box(minx, miny, mid, maxy) if axis == "x" else box(minx, miny, maxx, mid))
        if part.area < target:
            lo = mid
        else:
            hi = mid
    cut = (lo + hi) / 2
    r1 = region.intersection(box(minx, miny, cut, maxy) if axis == "x" else box(minx, miny, maxx, cut))
    r2 = region.difference(r1)
    return (r1, a), (r2, b)


def partition(region, items, rng_axes, depth=0):
    if len(items) == 1:
        return [(region, items[0])] if region.geom_type == "Polygon" else None
    axis = rng_axes[depth % len(rng_axes)]
    minx, miny, maxx, maxy = region.bounds
    # cut across the longer side unless the sequence says otherwise
    if rng_axes[depth % len(rng_axes)] == "auto":
        axis = "x" if (maxx - minx) >= (maxy - miny) else "y"
    (r1, a), (r2, b) = split(region, items, axis)
    if r1.is_empty or r2.is_empty:
        return None
    if r1.geom_type != "Polygon" or r2.geom_type != "Polygon":
        return None
    p1 = partition(r1, a, rng_axes, depth + 1)
    p2 = partition(r2, b, rng_axes, depth + 1)
    if p1 is None or p2 is None:
        return None
    return p1 + p2


def decompose(region):
    """Split a rectilinear region into rectangles by slicing at every vertex height, then merging
    slabs that share the same horizontal extent. An L becomes two rectangles."""
    polys = list(region.geoms) if region.geom_type == "MultiPolygon" else [region]
    out = []
    for poly in polys:
        ys = sorted({round(y, 6) for _, y in poly.exterior.coords})
        minx, _, maxx, _ = poly.bounds
        slabs = []
        for y0, y1 in zip(ys, ys[1:]):
            piece = poly.intersection(box(minx - 1, y0, maxx + 1, y1))
            parts = list(piece.geoms) if piece.geom_type == "MultiPolygon" else [piece]
            slabs += [q for q in parts if q.geom_type == "Polygon" and q.area > 1e-6]
        merged = []
        for q in sorted(slabs, key=lambda g: (round(g.bounds[0], 4), round(g.bounds[2], 4), g.bounds[1])):
            last = merged[-1] if merged else None
            if last is not None and abs(last.bounds[0] - q.bounds[0]) < 1e-6 and abs(last.bounds[2] - q.bounds[2]) < 1e-6 and abs(last.bounds[3] - q.bounds[1]) < 1e-6:
                merged[-1] = box(last.bounds[0], last.bounds[1], last.bounds[2], q.bounds[3])
            else:
                merged.append(q)
        out += merged
    return out


def solve(problem, variant, seconds=10, seed=1):
    s = problem["shell"]
    W, D = s["widthM"], s["depthM"]
    notch = None
    if variant == "L":
        f = 1 / math.sqrt(1 - 0.35 * 0.40)
        W, D = round(W * f, 1), round(D * f, 1)
        notch = (W - round(0.35 * W, 1), 0, W, round(0.40 * D, 1))
    shell = shell_polygon(W, D, notch)
    yc = D / 2 if not notch else notch[3] + (D - notch[3]) / 2
    lobby = box(0, 0, LOBBY, D)
    spine = box(LOBBY, yc - CORRIDOR / 2, W, yc + CORRIDOR / 2)
    free = shell.difference(unary_union([lobby, spine]))
    # the free floor is a set of rectangles (bands and, for the L, the upper-left block)
    bands = sorted(decompose(free), key=lambda g: -g.area)
    rooms = [{"id": r["id"], "kind": r["kind"], "t": r["targetAreaM2"]} for r in problem["rooms"]]
    rng = random.Random(seed)
    start = time.perf_counter()
    best, best_cost, tried, valid = None, float("inf"), 0, 0
    windows = s["windows"]

    def cost_of(rects):
        met = plan_metrics(dict(problem, bboxW=W, bboxD=D), KINDS, rects, shell, (0.0, yc), windows)
        c = 100 * met["meanAreaDeviation"] + 5 * met["undersizedRooms"] + 5 * met["aspectViolations"] + 8 * met["minSideViolations"]
        c += 10 * met["unreachableRooms"] + 3 * (int(met["adjacencyMet"].split("/")[1]) - int(met["adjacencyMet"].split("/")[0]))
        c -= 0.2 * met["daylightMetres"]
        return c, met

    while time.perf_counter() - start < seconds:
        tried += 1
        order = rooms[:]
        rng.shuffle(order)
        # assign rooms to bands proportionally to band area, then subdivide each band
        total = sum(r["t"] for r in order)
        placed, ok = [], True
        pool = order[:]
        for bi, band in enumerate(bands):
            share = band.area / sum(b.area for b in bands)
            take, acc = [], 0.0
            while pool and (acc < share * total or not take) and not (bi == len(bands) - 1 and False):
                take.append(pool.pop(0)); acc += take[-1]["t"]
                if bi == len(bands) - 1:
                    take += pool; pool = []; break
            if not take:
                continue
            axes = [rng.choice(["x", "y", "auto"]) for _ in range(len(take))]
            parts = partition(band, take, axes)
            if parts is None or any(not is_rect(p) for p, _ in parts):
                ok = False
                break
            placed += parts
        if not ok or len(placed) != len(rooms):
            continue
        valid += 1
        rects = []
        for poly, it in placed:
            x0, y0, x1, y1 = poly.bounds
            rects.append({"id": it["id"], "kind": it["kind"], "rect": {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0}})
        c, met = cost_of(rects)
        if c < best_cost:
            best, best_cost, best_met = rects, c, met
    info = {"seconds": round(time.perf_counter() - start, 1), "candidatesTried": tried, "validRectangularCandidates": valid, "cost": None if best is None else round(best_cost, 2)}
    return best, info, shell, (W, D), (best_met if best else None)


if __name__ == "__main__":
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 10
    names = sys.argv[2:] or None
    out = []
    for p in data["problems"]:
        if p["shell"]["entrance"] != "west" or (names and p["name"] not in names):
            continue
        row = {"name": p["name"]}
        for variant in ("rect", "L"):
            rects, info, shell, (W, D), met = solve(p, variant, seconds)
            row[variant] = {"search": info, "metrics": met}
            if rects:
                open(f"../../results/svg/{p['name'].split(' (')[0].replace(' ', '_')}_{variant}_subdiv.svg", "w").write(
                    plan_svg(rects, shell, W, D, f"{p['name']} - subdivision {variant}"))
            print(p["name"], variant, json.dumps(row[variant]), flush=True)
        out.append(row)
    json.dump(out, open("../../results/subdivision.json", "w"), indent=1)
