"""Build a blinded review packet for architects: one self-contained HTML file plus a private key.

Each page shows the same brief solved by two generators, side by side, in random order. The
reviewer picks the plan they would rather start from and scores each plan 1-5 on five dimensions.
The key (which side was which) is written to PRIVATE-key.json and stays with the study owner.

Usage: python make_packet.py <out_dir> <generatorName=results.json[:variant]> ...
  baseline is always read from problems.json; other generators from files that hold, per brief,
  entries like {"rect": {"rooms": [...], "geo": {...}}} as written by cpsat_layout.py.
"""
import html
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "layout"))
from metrics import plan_svg, shell_polygon  # noqa: E402

RESULTS = Path(__file__).resolve().parents[2] / "results"
RUBRIC = {
    "function": ("Function", "Do the rooms work for what the brief says the company does? 1 = unworkable, 5 = I would use it as drawn."),
    "utilisation": ("Space utilisation", "Is floor used well: sensible room sizes, no dead space, no cramped rooms? 1 = wasteful or cramped, 5 = efficient."),
    "circulation": ("Circulation", "Can people reach every room clearly and comfortably from the entrance? 1 = confusing or blocked, 5 = obvious and comfortable."),
    "daylight": ("Daylight", "Do the rooms that need daylight get it? 1 = poor, 5 = well placed."),
    "furniture": ("Furniture usability", "Could you fit the furniture these rooms need, with clearances? 1 = no, 5 = comfortably."),
}


def baseline_rooms(problem):
    return [{"id": r["id"], "kind": r["kind"], "rect": r["rect"]} for r in problem["baseline"]["plan"]["rooms"]]


def svg_for(problem, rooms, W, D, notch=None):
    return plan_svg(rooms, shell_polygon(W, D, notch), W, D, "", scale=20)


def main(out_dir, specs, seed=2026):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    problems = {p["name"]: p for p in json.load(open(RESULTS / "problems.json"))["problems"]}
    gens = {}
    for spec in specs:
        name, path = spec.split("=", 1)
        gens[name] = {r["name"]: r for r in json.load(open(path))}
    rng = random.Random(seed)
    key, pages = {}, []
    n = 0
    for brief, p in problems.items():
        for name, table in gens.items():
            r = table.get(brief)
            if not r or not r.get("rect", {}).get("rooms"):
                continue
            n += 1
            pid = f"p{n:02d}"
            sides = ["baseline", name]
            rng.shuffle(sides)
            s = p["shell"]
            plans = {"baseline": svg_for(p, baseline_rooms(p), s["widthM"], s["depthM"]),
                     name: svg_for(p, r["rect"]["rooms"], r["rect"]["geo"]["W"], r["rect"]["geo"]["D"])}
            key[pid] = {"brief": brief, "A": sides[0], "B": sides[1]}
            pages.append((pid, p, plans[sides[0]], plans[sides[1]]))
    order = list(range(len(pages)))
    rng.shuffle(order)
    cards = []
    for i in order:
        pid, p, a, b = pages[i]
        dims = "".join(
            f'<tr><td>{html.escape(RUBRIC[d][0])}</td>' + "".join(f'<td><select data-pair="{pid}" data-side="{side}" data-dim="{d}"><option value="">-</option>' + "".join(f"<option>{v}</option>" for v in range(1, 6)) + "</select></td>" for side in "AB") + "</tr>"
            for d in RUBRIC)
        cards.append(f'''<section class="card"><h2>{html.escape(pid)}</h2><p class="brief">{html.escape(p["brief"])}</p>
<div class="pair"><figure><figcaption>Plan A</figcaption>{a}</figure><figure><figcaption>Plan B</figcaption>{b}</figure></div>
<p><b>Which would you rather start from?</b> <label><input type="radio" name="pref-{pid}" value="A"> A</label> <label><input type="radio" name="pref-{pid}" value="B"> B</label> <label><input type="radio" name="pref-{pid}" value="tie"> No preference</label></p>
<table><tr><th></th><th>Plan A</th><th>Plan B</th></tr>{dims}</table>
<textarea data-note="{pid}" placeholder="What is wrong with either plan? (optional)"></textarea></section>''')
    rubric = "".join(f"<li><b>{html.escape(v[0])}</b>: {html.escape(v[1])}</li>" for v in RUBRIC.values())
    page = f'''<!doctype html><meta charset="utf-8"><title>Plan review</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font:15px system-ui;max-width:1100px;margin:24px auto;padding:0 16px;color:#222}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0}}figcaption{{font-weight:600}}svg{{max-width:100%;height:auto;border:1px solid #ccc;background:#fff}}.card{{border-top:3px solid #333;margin-top:28px;padding-top:8px}}.brief{{background:#f4f1e8;padding:8px 12px}}textarea{{width:100%;min-height:50px}}table{{border-collapse:collapse}}td,th{{padding:3px 10px;border-bottom:1px solid #eee}}@media(max-width:700px){{.pair{{grid-template-columns:1fr}}}}</style>
<h1>Office plan review</h1><p>Each page shows two plans for the same brief. You are reviewing concept layouts only: no code, structural or fire compliance is claimed. Rooms are drawn as rectangles; circulation is the uncoloured floor.</p>
<ul>{rubric}</ul><p>Your name or initials: <input id="who"> <button onclick="save()">Download my ratings</button></p>{"".join(cards)}
<p><button onclick="save()">Download my ratings</button></p>
<script>function save(){{const who=document.getElementById("who").value||"reviewer";const pairs={{}};document.querySelectorAll("[data-pair]").forEach(e=>{{const p=e.dataset.pair;pairs[p]=pairs[p]||{{pair:p,A:{{}},B:{{}}}};if(e.value)pairs[p][e.dataset.side][e.dataset.dim]=Number(e.value)}});document.querySelectorAll("input[type=radio]:checked").forEach(e=>{{const p=e.name.slice(5);pairs[p]=pairs[p]||{{pair:p,A:{{}},B:{{}}}};pairs[p].preferred=e.value}});document.querySelectorAll("[data-note]").forEach(e=>{{if(e.value)(pairs[e.dataset.note]=pairs[e.dataset.note]||{{pair:e.dataset.note,A:{{}},B:{{}}}}).note=e.value}});const out={{reviewer:who,pairs:Object.values(pairs).filter(x=>x.preferred)}};const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{{type:"application/json"}}));a.download="ratings-"+who+".json";a.click()}}</script>'''
    (out / "packet.html").write_text(page)
    (out / "PRIVATE-key.json").write_text(json.dumps(key, indent=1))
    print(f"{len(pages)} pairs -> {out}/packet.html ; send only packet.html to reviewers; keep {out}/PRIVATE-key.json")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
