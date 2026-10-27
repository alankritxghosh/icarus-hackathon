"""Score the row-zone prototype's L-shaped plans with the shared independent metrics and compare
with the CP-SAT and subdivision generators on the same briefs (same floor area, same notch)."""
import json
import statistics as st

from metrics import plan_metrics, plan_svg, shell_polygon

data = json.load(open("../../results/problems.json"))
KINDS = data["kinds"]
problems = {p["name"]: p for p in data["problems"]}
plans = json.load(open("../../results/notched-plans.json"))
summ = json.load(open("../../results/layout-summary.json"))


def num(s):
    a, b = s.split("/")
    return int(a), int(b)


rows_out = {}
for name, pl in plans.items():
    p = problems[name]
    W, D, n = pl["W"], pl["D"], pl["notch"]
    notch = (W - n["w"], 0, W, n["h"])
    shell = shell_polygon(W, D, notch)
    rooms = [{"id": r["id"], "kind": r["kind"], "rect": r["rect"]} for r in pl["rooms"]]
    m = plan_metrics(dict(p, bboxW=W, bboxD=D), KINDS, rooms, shell, (0.0, D / 2), pl["windows"])
    rows_out[name] = m
    open(f"../../results/svg/{name.split(' (')[0].replace(' ', '_')}_L_rowzones.svg", "w").write(
        plan_svg(rooms, shell, W, D, f"{name} - row zones L ({pl['ms']} ms)")
    )
    print(
        f"{name:26} dev {m['meanAreaDeviation']:.3f} under {m['undersizedRooms']} minside {m['minSideViolations']} "
        f"adj {m['adjacencyMet']} lit {m['daylightRoomsLit']} unreach {m['unreachableRooms']} "
        f"overlap {m['overlapM2']} outside {m['outsideShellM2']} free {m['freeFloorShare']} travel {m['maxTravelM']}"
    )


def agg(rs):
    adj = [num(r["adjacencyMet"]) for r in rs]
    lit = [num(r["daylightRoomsLit"]) for r in rs]
    return {
        "plans": len(rs),
        "meanAreaDev": round(st.mean(r["meanAreaDeviation"] for r in rs), 3),
        "undersized/plan": round(st.mean(r["undersizedRooms"] for r in rs), 2),
        "aspectViol/plan": round(st.mean(r["aspectViolations"] for r in rs), 2),
        "minSideViol/plan": round(st.mean(r["minSideViolations"] for r in rs), 2),
        "adjacencyMet%": round(100 * sum(a for a, b in adj) / sum(b for a, b in adj)),
        "daylightLit%": round(100 * sum(a for a, b in lit) / sum(b for a, b in lit)),
        "unreachable/plan": round(st.mean(r["unreachableRooms"] for r in rs), 2),
        "maxTravelM": round(st.mean(r["maxTravelM"] for r in rs if r["maxTravelM"]), 1),
        "freeFloor%": round(100 * st.mean(r["freeFloorShare"] for r in rs)),
        "overlap+outside m2": round(sum(r["overlapM2"] + r["outsideShellM2"] for r in rs), 3),
    }


names = summ["briefs"]  # the six the CP-SAT run solved
table = {
    "row zones (new) L": agg([rows_out[n] for n in names]),
    "CP-SAT L": summ["summary"]["CP-SAT L"],
    "subdivision L": summ["summary"]["subdivision L"],
}
print()
for k, v in table.items():
    print(f"{k:20}", json.dumps(v))
json.dump(
    {"briefs": names, "table": table, "perBrief": rows_out, "ms": {n: plans[n]["ms"] for n in plans}},
    open("../../results/notched-summary.json", "w"),
    indent=1,
)
