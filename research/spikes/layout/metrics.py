"""Independent plan metrics shared by every layout spike.

Written separately from the TypeScript cost and diagnose code on purpose: same rules (read from the
exported knowledge), different implementation, so a plan from any generator is judged the same way.
Units are metres. A plan is a list of rooms {id, kind, rect:{x,y,w,h}} inside a shell polygon.
"""
import heapq
import math

import numpy as np
import shapely
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

RES = 0.1          # raster cell, metres
HALF_PATH = 0.45   # half of a 0.9 m clear route
NEAR_GAP = 1.7     # rooms "adjacent" when this close, as in the TypeScript rules
MIN_SPAN = 1.0


def shell_polygon(w, d, notch=None):
    s = box(0, 0, w, d)
    if notch:
        s = s.difference(box(*notch))
    return s


def room_poly(r):
    q = r["rect"]
    return box(q["x"], q["y"], q["x"] + q["w"], q["y"] + q["h"])


def exposure(rect, w, d, windows):
    q, e, tol = rect, 0.0, 1e-6
    if "west" in windows and q["x"] < tol:
        e += q["h"]
    if "east" in windows and abs(q["x"] + q["w"] - w) < tol:
        e += q["h"]
    if "north" in windows and q["y"] < tol:
        e += q["w"]
    if "south" in windows and abs(q["y"] + q["h"] - d) < tol:
        e += q["w"]
    return e


def facing_span(a, b):
    """Length over which two rectangles face each other within NEAR_GAP (0 if overlapping)."""
    ax1, ay1, bx1, by1 = a["x"] + a["w"], a["y"] + a["h"], b["x"] + b["w"], b["y"] + b["h"]
    ox = min(ax1, bx1) - max(a["x"], b["x"])
    oy = min(ay1, by1) - max(a["y"], b["y"])
    if ox > 1e-6 and oy > 1e-6:
        return 0.0
    best = 0.0
    gap_x = max(a["x"], b["x"]) - min(ax1, bx1)
    gap_y = max(a["y"], b["y"]) - min(ay1, by1)
    if -1e-6 <= gap_x <= NEAR_GAP + 1e-6 and oy > 1e-6:
        best = max(best, oy)
    if -1e-6 <= gap_y <= NEAR_GAP + 1e-6 and ox > 1e-6:
        best = max(best, ox)
    return best


def _grid(w, d):
    nx, ny = int(math.ceil(w / RES)), int(math.ceil(d / RES))
    xs = (np.arange(nx) + 0.5) * RES
    ys = (np.arange(ny) + 0.5) * RES
    X, Y = np.meshgrid(xs, ys)
    return nx, ny, X, Y


def _dijkstra(free, start):
    ny, nx = free.shape
    dist = np.full(free.shape, np.inf)
    sy, sx = start
    dist[sy, sx] = 0.0
    pq = [(0.0, sy, sx)]
    steps = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0), (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414)]
    while pq:
        dd, y, x = heapq.heappop(pq)
        if dd > dist[y, x]:
            continue
        for dy, dx, c in steps:
            yy, xx = y + dy, x + dx
            if 0 <= yy < ny and 0 <= xx < nx and free[yy, xx]:
                nd = dd + c * RES
                if nd < dist[yy, xx]:
                    dist[yy, xx] = nd
                    heapq.heappush(pq, (nd, yy, xx))
    return dist


def circulation(rooms, shell, entrance, w, d, half=HALF_PATH):
    """Usable circulation: free floor eroded by a 0.9 m clear route, walked from the front door."""
    free_poly = shell.difference(unary_union([room_poly(r) for r in rooms]))
    walk = free_poly.buffer(-half)
    nx, ny, X, Y = _grid(w, d)
    free = shapely.contains_xy(walk, X, Y) if not walk.is_empty else np.zeros((ny, nx), bool)
    ex, ey = entrance
    # step inside from the wall
    inside = np.array([min(max(ex, 0.4), w - 0.4), min(max(ey, 0.4), d - 0.4)])
    cx, cy = int(inside[0] / RES), int(inside[1] / RES)
    # snap the start to the nearest walkable cell within 1.5 m
    start = None
    if free.any():
        ys_, xs_ = np.nonzero(free)
        dd = (xs_ - cx) ** 2 + (ys_ - cy) ** 2
        k = int(np.argmin(dd))
        if dd[k] * RES * RES <= 1.5 ** 2:
            start = (int(ys_[k]), int(xs_[k]))
    dist = _dijkstra(free, start) if start else np.full(free.shape, np.inf)
    out = {}
    for r in rooms:
        poly = room_poly(r)
        dsts = shapely.distance(poly, np.stack([X.ravel(), Y.ravel()], axis=1) if False else shapely.points(X.ravel(), Y.ravel()))
        near = (dsts.reshape(X.shape) <= half + 0.25) & np.isfinite(dist)
        n = int(near.sum())
        out[r["id"]] = {"cells": n, "travel": float(dist[near].min()) if n else None}
    return out, float(free_poly.area)


def plan_metrics(problem, kinds, rooms, shell, entrance, windows):
    w = problem["shell"]["widthM"] if "bboxW" not in problem else problem["bboxW"]
    d = problem["shell"]["depthM"] if "bboxD" not in problem else problem["bboxD"]
    targets = {r["id"]: r for r in problem["rooms"]}
    by_kind = {}
    for r in rooms:
        by_kind.setdefault(r["kind"], []).append(r)

    dev, under, aspect, minside, lit_ok, lit_want, lit_m = [], 0, 0, 0, 0, 0, 0.0
    for r in rooms:
        q, k, t = r["rect"], kinds[r["kind"]], targets[r["id"]]["targetAreaM2"]
        a = q["w"] * q["h"]
        dev.append(abs(a / t - 1))
        under += a < k["minScale"] * t - 1e-6
        lo, hi = min(q["w"], q["h"]), max(q["w"], q["h"])
        aspect += hi / lo > k["maxAspect"] + 1e-6
        minside += lo < min(k["minWidth"], k["minDepth"]) - 1e-6
        if k["daylight"] in ("required", "preferred"):
            e = exposure(q, w, d, windows)
            lit_want += 1
            lit_ok += e >= 2.0
            lit_m += e

    wishes, met = 0, 0
    for r in rooms:
        for want in kinds[r["kind"]]["adjacent"]:
            others = [o for o in by_kind.get(want, []) if o["id"] != r["id"]]
            if not others:
                continue
            wishes += 1
            met += any(facing_span(r["rect"], o["rect"]) >= MIN_SPAN for o in others)

    circ, free_area = circulation(rooms, shell, entrance, w, d)
    unreachable = [i for i, v in circ.items() if v["cells"] < 9 or v["travel"] is None]
    travels = [v["travel"] for v in circ.values() if v["travel"] is not None]
    overlap = 0.0
    polys = [room_poly(r) for r in rooms]
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            overlap += polys[i].intersection(polys[j]).area
    outside = sum(p.difference(shell).area for p in polys)
    return {
        "rooms": len(rooms),
        "meanAreaDeviation": round(float(np.mean(dev)), 3),
        "undersizedRooms": int(under),
        "aspectViolations": int(aspect),
        "minSideViolations": int(minside),
        "daylightRoomsLit": f"{lit_ok}/{lit_want}",
        "daylightMetres": round(lit_m, 1),
        "adjacencyMet": f"{met}/{wishes}",
        "unreachableRooms": len(unreachable),
        "unreachableIds": unreachable,
        "maxTravelM": round(max(travels), 1) if travels else None,
        "meanTravelM": round(float(np.mean(travels)), 1) if travels else None,
        "freeFloorShare": round(free_area / shell.area, 3),
        "overlapM2": round(overlap, 4),
        "outsideShellM2": round(outside, 4),
    }


KIND_COLOURS = {
    "open_workspace": "#d9c9a3", "meeting_room": "#9fb8a0", "private_office": "#b9c7a5",
    "kitchen": "#e0b98a", "lounge": "#c9a08a", "reception": "#a9bcd0", "storage": "#bdbdb5",
    "server_room": "#b0b0c0", "restroom": "#c0d4d6",
}


def plan_svg(rooms, shell, w, d, title, scale=24):
    pts = " ".join(f"{x * scale:.1f},{y * scale:.1f}" for x, y in list(shell.exterior.coords))
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w * scale + 20:.0f}" height="{d * scale + 40:.0f}" viewBox="-10 -26 {w * scale + 20:.0f} {d * scale + 40:.0f}" font-family="sans-serif" font-size="10">',
           f'<text x="0" y="-10" font-size="12">{title}</text>',
           f'<polygon points="{pts}" fill="#f6f3ec" stroke="#222" stroke-width="2"/>']
    for r in rooms:
        q = r["rect"]
        out.append(f'<rect x="{q["x"] * scale:.1f}" y="{q["y"] * scale:.1f}" width="{q["w"] * scale:.1f}" height="{q["h"] * scale:.1f}" fill="{KIND_COLOURS.get(r["kind"], "#ddd")}" stroke="#333" stroke-width="1"/>')
        out.append(f'<text x="{(q["x"] + q["w"] / 2) * scale:.1f}" y="{(q["y"] + q["h"] / 2) * scale:.1f}" text-anchor="middle">{r["kind"].replace("_", " ")} {q["w"] * q["h"]:.0f}m²</text>')
    out.append("</svg>")
    return "\n".join(out)


def bottleneck_width(rooms, shell, entrance, w, d, lo=0.4, hi=2.0, step=0.1):
    """Widest clear route (metres) that still reaches every room's door from the front door.
    This is the width of the weakest link in circulation, which a door-and-wall graph cannot see."""
    best = 0.0
    half = lo / 2
    while half * 2 <= hi + 1e-9:
        circ, _ = circulation(rooms, shell, entrance, w, d, half=half)
        if any(v["cells"] < 9 or v["travel"] is None for v in circ.values()):
            break
        best = half * 2
        half += step / 2
    return round(best, 2)
