"""Self-test of the analysis with SYNTHETIC ratings. The data below is invented to check that the
pipeline recovers a planted preference and reports honest uncertainty. It says nothing about Icarus."""
import json
import random
import tempfile
from pathlib import Path

import analyze

rng = random.Random(1)
briefs = [f"brief{i}" for i in range(12)]
key = {}
subs = []
true_share_for_cpsat = 0.70  # planted
for i, b in enumerate(briefs):
    key[f"p{i:02d}"] = {"brief": b, "A": "baseline" if i % 2 else "cpsat", "B": "cpsat" if i % 2 else "baseline"}
for r in range(5):
    pairs = []
    bias = rng.gauss(0, 0.08)
    for i, b in enumerate(briefs):
        k = key[f"p{i:02d}"]
        prefers_cpsat = rng.random() < true_share_for_cpsat + bias
        side = "A" if (k["A"] == "cpsat") == prefers_cpsat else "B"
        scores = {s: {d: min(5, max(1, round(rng.gauss(3.4 + (0.6 if k[s] == "cpsat" else 0), 0.9)))) for d in analyze.DIMENSIONS} for s in "AB"}
        pairs.append({"pair": f"p{i:02d}", "preferred": side, "A": scores["A"], "B": scores["B"]})
    subs.append({"reviewer": f"r{r}", "pairs": pairs})
d = Path(tempfile.mkdtemp())
(d / "ratings.json").write_text(json.dumps(subs))
(d / "key.json").write_text(json.dumps(key))
rep = analyze.report(d / "ratings.json", d / "key.json")
c = rep["comparisons"]["baseline vs cpsat"]
share_cpsat = 1 - c["baselineShare"]
lo, hi = 1 - c["ci95"][1], 1 - c["ci95"][0]
print(json.dumps({"planted": true_share_for_cpsat, "recoveredShare": round(share_cpsat, 3), "ci95": [round(lo, 3), round(hi, 3)], "reviewerAgreement": c["reviewerAgreement"], "dimensionDiffsBaselineMinusCpsat": {k: v["meanDiff"] for k, v in c["dimensions"].items()}}, indent=1))
assert lo <= true_share_for_cpsat <= hi, "interval should cover the planted value in this seeded run"
assert all(v["meanDiff"] < 0 for v in c["dimensions"].values()), "planted score advantage should show in every dimension"
print("needed sample for a 0.70 vs 0.50 effect:", analyze.needed_sample(0.70))
print("selftest ok")
