"""Score the TypeScript row-layout baseline with the independent metrics (sanity check)."""
import json, sys
from metrics import plan_metrics, shell_polygon

data = json.load(open("../../results/problems.json"))
kinds = data["kinds"]
for p in data["problems"]:
    s = p["shell"]
    shell = shell_polygon(s["widthM"], s["depthM"])
    rooms = [{"id": r["id"], "kind": r["kind"], "rect": r["rect"]} for r in p["baseline"]["plan"]["rooms"]]
    e = p["baseline"]["plan"]["entrance"]
    m = plan_metrics(p, kinds, rooms, shell, (e["x"], e["y"]), s["windows"])
    print(p["name"], s["entrance"], json.dumps(m))
