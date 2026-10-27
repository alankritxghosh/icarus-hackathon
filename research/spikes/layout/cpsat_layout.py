"""Spike: lay out the same rooms with a CP-SAT model, in a rectangle and in an L-shaped boundary.

Rooms are axis-aligned rectangles placed by NoOverlap2D inside the bounding box, with fixed
obstacles for the entrance lobby, one corridor spine and (for the L) the missing corner.
Everything is integer decimetres. The corridor skeleton is an INPUT chosen by a simple rule; the
solver decides room sizes and positions. Nothing here is product code.
"""
import json
import math
import sys
import time

from ortools.sat.python import cp_model

from metrics import plan_metrics, plan_svg, shell_polygon

DM = 10
LOBBY = 20
CORRIDOR = 16
DOOR = 9       # minimum frontage on circulation, decimetres
NEAR = 17
SPAN = 10

data = json.load(open("../../results/problems.json"))
KINDS = data["kinds"]


def build_and_solve(problem, variant, seconds=30, workers=8, seed=1):
    s = problem["shell"]
    W0, D0 = round(s["widthM"] * DM), round(s["depthM"] * DM)
    notch = None
    if variant == "L":
        f = 1 / math.sqrt(1 - 0.35 * 0.40)  # same floor area as the rectangle
        W, D = round(W0 * f), round(D0 * f)
        nx, ny = W - round(0.35 * W), round(0.40 * D)
        notch = (nx, 0, W, ny)
        yc = ny + (D - ny) // 2
    else:
        W, D = W0, D0
        yc = D // 2
    spine = (LOBBY, yc - CORRIDOR // 2, W, yc - CORRIDOR // 2 + CORRIDOR)
    lobby = (0, 0, LOBBY, D)
    obstacles = {"lobby": lobby, "spine": spine}
    if notch:
        obstacles["notch"] = notch

    m = cp_model.CpModel()
    rooms = problem["rooms"]
    R = {}
    for r in rooms:
        k = KINDS[r["kind"]]
        t = round(r["targetAreaM2"] * DM * DM)
        x = m.NewIntVar(0, W, f"x_{r['id']}")
        y = m.NewIntVar(0, D, f"y_{r['id']}")
        w = m.NewIntVar(15, W, f"w_{r['id']}")
        h = m.NewIntVar(15, D, f"h_{r['id']}")
        m.Add(x + w <= W)
        m.Add(y + h <= D)
        a = m.NewIntVar(0, W * D, f"a_{r['id']}")
        m.AddMultiplicationEquality(a, [w, h])
        m.Add(a >= int(0.5 * t))
        m.Add(a <= int(1.5 * t))
        # Minimum side and aspect ratio are soft: a tight brief must still get a plan, with the
        # shortfall measured, instead of an INFEASIBLE answer.
        A = round(k["maxAspect"] * 10)
        asp = m.NewIntVar(0, 10 * max(W, D), f"asp_{r['id']}")
        m.Add(asp >= 10 * w - A * h)
        m.Add(asp >= 10 * h - A * w)
        ms = m.NewIntVar(0, max(W, D), f"ms_{r['id']}")
        m.AddMinEquality(ms, [w, h])
        side_short = m.NewIntVar(0, max(W, D), f"ss_{r['id']}")
        m.Add(side_short >= round(min(k["minWidth"], k["minDepth"]) * DM) - ms)
        dev = m.NewIntVar(0, 2 * t, f"dev_{r['id']}")
        m.AddAbsEquality(dev, a - t)
        short = m.NewIntVar(0, t, f"short_{r['id']}")
        m.Add(short >= int(k["minScale"] * t) - a)
        R[r["id"]] = dict(r=r, k=k, x=x, y=y, w=w, h=h, a=a, t=t, dev=dev, short=short, asp=asp, side_short=side_short)

    xs, ys = [], []
    for v in R.values():
        ex = m.NewIntVar(0, W, f"ex_{v['r']['id']}")
        ey = m.NewIntVar(0, D, f"ey_{v['r']['id']}")
        m.Add(ex == v["x"] + v["w"])
        m.Add(ey == v["y"] + v["h"])
        xs.append(m.NewIntervalVar(v["x"], v["w"], ex, f"ix_{v['r']['id']}"))
        ys.append(m.NewIntervalVar(v["y"], v["h"], ey, f"iy_{v['r']['id']}"))
    for name, (x0, y0, x1, y1) in obstacles.items():
        xs.append(m.NewFixedSizeIntervalVar(x0, x1 - x0, f"ox_{name}"))
        ys.append(m.NewFixedSizeIntervalVar(y0, y1 - y0, f"oy_{name}"))
    m.AddNoOverlap2D(xs, ys)

    def overlap(lo_a, hi_a, lo_b, hi_b, name):
        top = m.NewIntVar(-W - D, W + D, f"top_{name}")
        bot = m.NewIntVar(-W - D, W + D, f"bot_{name}")
        m.AddMinEquality(top, [hi_a, hi_b])
        m.AddMaxEquality(bot, [lo_a, lo_b])
        return top - bot

    n_lit = [0]

    def lit(name):
        n_lit[0] += 1
        return m.NewBoolVar(f"{name}_{n_lit[0]}")

    def touch(v, O, minlen, name):
        ox0, oy0, ox1, oy1 = O
        ovy = overlap(v["y"], v["y"] + v["h"], oy0, oy1, name + "y")
        ovx = overlap(v["x"], v["x"] + v["w"], ox0, ox1, name + "x")
        L = []
        for cond, ov in (
            (v["x"] + v["w"] == ox0, ovy), (v["x"] == ox1, ovy),
            (v["y"] + v["h"] == oy0, ovx), (v["y"] == oy1, ovx),
        ):
            b = lit(name)
            m.Add(cond).OnlyEnforceIf(b)
            m.Add(ov >= minlen).OnlyEnforceIf(b)
            L.append(b)
        return L

    # Every room opens onto the lobby or the spine; reception onto the lobby.
    for rid, v in R.items():
        if v["r"]["kind"] == "reception":
            m.AddBoolOr(touch(v, lobby, DOOR, f"door_{rid}_lobby"))
        else:
            m.AddBoolOr(touch(v, lobby, DOOR, f"door_{rid}_lobby") + touch(v, spine, DOOR, f"door_{rid}_spine"))

    # Area: relative deviation and a heavier penalty under the kind's minimum scale.
    obj = []
    for v in R.values():
        c = max(1, round(1_000_000 / v["t"]))
        obj.append(c * v["dev"])
        obj.append(3 * c * v["short"])
        obj.append(2000 * v["side_short"] * 10)
        obj.append(400 * v["asp"])

    # Daylight: reward exposure along window walls, capped.
    windows = s["windows"]
    for rid, v in R.items():
        d = v["k"]["daylight"]
        if d not in ("required", "preferred"):
            continue
        terms = []
        for side in windows:
            b = lit(f"win_{rid}_{side}")
            if side == "west":
                m.Add(v["x"] == 0).OnlyEnforceIf(b); L_ = v["h"]
            elif side == "east":
                m.Add(v["x"] + v["w"] == W).OnlyEnforceIf(b); L_ = v["h"]
            elif side == "north":
                m.Add(v["y"] == 0).OnlyEnforceIf(b); L_ = v["w"]
            else:
                m.Add(v["y"] + v["h"] == D).OnlyEnforceIf(b); L_ = v["w"]
            e = m.NewIntVar(0, max(W, D), f"e_{rid}_{side}")
            m.Add(e == L_).OnlyEnforceIf(b)
            m.Add(e == 0).OnlyEnforceIf(b.Not())
            terms.append(e)
        if terms:
            cap = 120 if d == "required" else 60
            g = m.NewIntVar(0, cap, f"g_{rid}")
            tot = m.NewIntVar(0, 4 * max(W, D), f"tot_{rid}")
            m.Add(tot == sum(terms))
            m.AddMinEquality(g, [tot, cap])
            obj.append(-(300 if d == "required" else 100) * g)

    # Adjacency wishes from the kind rules: near = within NEAR dm with SPAN dm of overlap.
    near_cache = {}

    def near(a, b):
        key = tuple(sorted((a["r"]["id"], b["r"]["id"])))
        if key in near_cache:
            return near_cache[key]
        ovy = overlap(a["y"], a["y"] + a["h"], b["y"], b["y"] + b["h"], "ay")
        ovx = overlap(a["x"], a["x"] + a["w"], b["x"], b["x"] + b["w"], "ax")
        L = []
        for gap, ov in (
            (b["x"] - (a["x"] + a["w"]), ovy), (a["x"] - (b["x"] + b["w"]), ovy),
            (b["y"] - (a["y"] + a["h"]), ovx), (a["y"] - (b["y"] + b["h"]), ovx),
        ):
            bb = lit("near")
            m.Add(gap >= 0).OnlyEnforceIf(bb)
            m.Add(gap <= NEAR).OnlyEnforceIf(bb)
            m.Add(ov >= SPAN).OnlyEnforceIf(bb)
            L.append(bb)
        t = lit("nearany")
        m.AddBoolOr(L).OnlyEnforceIf(t)
        near_cache[key] = t
        return t

    for rid, v in R.items():
        for want in v["k"]["adjacent"]:
            others = [o for oid, o in R.items() if oid != rid and o["r"]["kind"] == want]
            if not others:
                continue
            ok = lit("wish")
            m.AddBoolOr([near(v, o) for o in others]).OnlyEnforceIf(ok)
            obj.append(-30000 * ok)

    # Break symmetry between identical rooms.
    groups = {}
    for rid, v in R.items():
        groups.setdefault((v["r"]["kind"], v["t"]), []).append(v)
    for g in groups.values():
        for p, q in zip(g, g[1:]):
            m.Add(p["x"] <= q["x"])

    m.Minimize(sum(obj))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = seconds
    solver.parameters.num_workers = workers
    solver.parameters.random_seed = seed
    t0 = time.perf_counter()
    status = solver.Solve(m)
    secs = time.perf_counter() - t0
    info = {
        "status": solver.StatusName(status),
        "seconds": round(secs, 1),
        "objective": solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        "bestBound": solver.BestObjectiveBound() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None,
        "variables": len(m.Proto().variables),
        "constraints": len(m.Proto().constraints),
        "bbox": [W / DM, D / DM],
        "notch": [c / DM for c in notch] if notch else None,
    }
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None, info, None
    out = []
    for rid, v in R.items():
        out.append({"id": rid, "kind": v["r"]["kind"], "rect": {
            "x": solver.Value(v["x"]) / DM, "y": solver.Value(v["y"]) / DM,
            "w": solver.Value(v["w"]) / DM, "h": solver.Value(v["h"]) / DM}})
    return out, info, {"W": W / DM, "D": D / DM, "notch": notch, "windows": windows}


def score(problem, rooms, geo):
    notch = tuple(c / DM for c in geo["notch"]) if geo["notch"] else None
    shell = shell_polygon(geo["W"], geo["D"], notch)
    p = dict(problem, bboxW=geo["W"], bboxD=geo["D"])
    return plan_metrics(p, KINDS, rooms, shell, (0.0, geo["D"] / 2 if not notch else (notch[3] + geo["D"]) / 2), geo["windows"]), shell


if __name__ == "__main__":
    names = sys.argv[1:] or None
    seconds = float(__import__("os").environ.get("SECONDS", "30"))
    results = []
    for p in data["problems"]:
        if p["shell"]["entrance"] != "west" or (names and p["name"] not in names):
            continue
        row = {"name": p["name"], "baseline": None}
        # baseline, scored by the same independent metrics
        s = p["shell"]
        bshell = shell_polygon(s["widthM"], s["depthM"])
        brooms = [{"id": r["id"], "kind": r["kind"], "rect": r["rect"]} for r in p["baseline"]["plan"]["rooms"]]
        e = p["baseline"]["plan"]["entrance"]
        row["baseline"] = {"metrics": plan_metrics(p, KINDS, brooms, bshell, (e["x"], e["y"]), s["windows"]),
                           "issueScoreTS": round(p["baseline"]["issueScore"], 2)}
        for variant in ("rect", "L"):
            rooms, info, geo = build_and_solve(p, variant, seconds=seconds)
            entry = {"solver": info}
            if rooms:
                met, shell = score(p, rooms, geo)
                entry["metrics"] = met
                entry["rooms"] = rooms
                entry["geo"] = geo
                open(f"../../results/svg/{p['name'].split(' (')[0].replace(' ', '_')}_{variant}.svg", "w").write(
                    plan_svg(rooms, shell, geo["W"], geo["D"], f"{p['name']} - CP-SAT {variant} - {info['status']} {info['seconds']}s"))
            row[variant] = entry
            print(p["name"], variant, json.dumps({"solver": info, "metrics": entry.get("metrics")}), flush=True)
        results.append(row)
    json.dump(results, open(__import__("os").environ.get("OUT", "../../results/cpsat.json"), "w"), indent=1)
