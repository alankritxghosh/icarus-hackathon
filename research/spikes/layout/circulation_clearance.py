"""Spike: topological circulation (every room has a door onto circulation) versus usable circulation
(a clear route of a given width from the front door to each room). Four small hand-made plans."""
import json
from metrics import bottleneck_width, plan_metrics, shell_polygon

W, D = 16.0, 8.0
KINDS = json.load(open("../../results/problems.json"))["kinds"]


def R(i, k, x, y, w, h):
    return {"id": i, "kind": k, "rect": {"x": x, "y": y, "w": w, "h": h}}


def case(name, rooms, note):
    shell = shell_polygon(W, D)
    entrance = (0.0, 4.0)
    bw = bottleneck_width(rooms, shell, entrance, W, D)
    # topological answer: each room shares a wall with the corridor band (door assumed) -> reachable
    return {"case": name, "note": note, "topologicallyReachable": True, "clearRouteWidthM": bw,
            "passes0.9m": bw >= 0.9, "passes1.2m": bw >= 1.2}


plan = [R("a", "meeting_room", 2, 0, 5, 3.2), R("b", "meeting_room", 7, 0, 5, 3.2), R("c", "kitchen", 2, 4.8, 5, 3.2), R("d", "lounge", 7, 4.8, 5, 3.2)]
out = [
    case("corridor 1.6 m", plan, "rooms either side of a 1.6 m corridor, open end at x=12"),
    case("corridor 1.2 m", [R("a", "meeting_room", 2, 0, 5, 3.4), R("b", "meeting_room", 7, 0, 5, 3.4), R("c", "kitchen", 2, 4.6, 5, 3.4), R("d", "lounge", 7, 4.6, 5, 3.4)], "same rooms, 1.2 m corridor"),
    case("0.7 m neck", [R("a", "meeting_room", 2, 0, 5, 3.2), R("b", "meeting_room", 7, 0, 5, 3.2), R("c", "kitchen", 2, 4.8, 5, 3.2), R("d", "lounge", 7, 4.8, 5, 3.2), R("neck1", "storage", 6, 3.2, 1.0, 0.45), R("neck2", "storage", 6, 4.35, 1.0, 0.45)], "two cupboards narrow the corridor to 0.7 m for 1 m; every room still has a door"),
    case("column 0.5 m from a door", plan + [R("col", "storage", 4.2, 3.2, 0.5, 0.6)], "a column-sized obstacle in front of room a's doorway narrows the approach"),
]
for o in out:
    print(json.dumps(o))
json.dump(out, open("../../results/circulation-clearance.json", "w"), indent=1)
