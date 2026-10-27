"""Analysis for the architect-reviewed benchmark.

Input: ratings.json, a list of reviewer submissions as produced by the packet's form:
  {"reviewer": "r1", "pairs": [{"pair": "p03", "preferred": "A"|"B"|"tie",
                                 "A": {"function":1-5, "utilisation":1-5, "circulation":1-5,
                                       "daylight":1-5, "furniture":1-5}, "B": {...}}]}
Key: key.json, which maps a blinded pair id and side to the generator ("baseline", "cpsat", ...).

Reports, per generator pair: preference share with a bootstrap confidence interval (reviewers and
briefs both resampled, because both are sources of variation), per-dimension mean differences,
reviewer agreement, and how many reviewers and briefs would be needed to detect a given effect.
Nothing here depends on which generator is "ours": the key is only opened after ratings are in.
"""
import json
import math
import random
import sys
from collections import defaultdict

DIMENSIONS = ["function", "utilisation", "circulation", "daylight", "furniture"]


def load(ratings_path, key_path):
    return json.load(open(ratings_path)), json.load(open(key_path))


def decode(ratings, key):
    """One row per (reviewer, pair): which generators were compared and who won."""
    rows = []
    for sub in ratings:
        for r in sub["pairs"]:
            k = key[r["pair"]]
            winner = None if r["preferred"] == "tie" else k[r["preferred"]]
            rows.append({
                "reviewer": sub["reviewer"], "brief": k["brief"], "pair": r["pair"],
                "gens": tuple(sorted((k["A"], k["B"]))), "winner": winner,
                "scores": {k["A"]: r["A"], k["B"]: r["B"]},
            })
    return rows


def share(rows, gen):
    """Preference share for `gen`, counting ties as half."""
    if not rows:
        return float("nan")
    return sum(1.0 if r["winner"] == gen else 0.5 if r["winner"] is None else 0.0 for r in rows) / len(rows)


def bootstrap_share(rows, gen, n=4000, seed=7):
    """Two-way bootstrap: resample reviewers, then briefs, so both are treated as random."""
    rng = random.Random(seed)
    reviewers = sorted({r["reviewer"] for r in rows})
    briefs = sorted({r["brief"] for r in rows})
    idx = defaultdict(list)
    for r in rows:
        idx[(r["reviewer"], r["brief"])].append(r)
    stats = []
    for _ in range(n):
        rs = [rng.choice(reviewers) for _ in reviewers]
        bs = [rng.choice(briefs) for _ in briefs]
        sample = [x for rv in rs for b in bs for x in idx.get((rv, b), [])]
        if sample:
            stats.append(share(sample, gen))
    stats.sort()
    return stats[int(0.025 * len(stats))], stats[int(0.975 * len(stats)) - 1]


def dimension_diffs(rows, a, b):
    out = {}
    for d in DIMENSIONS:
        diffs = [r["scores"][a][d] - r["scores"][b][d] for r in rows if a in r["scores"] and b in r["scores"]]
        if diffs:
            m = sum(diffs) / len(diffs)
            sd = math.sqrt(sum((x - m) ** 2 for x in diffs) / max(1, len(diffs) - 1))
            out[d] = {"meanDiff": round(m, 3), "sd": round(sd, 3), "n": len(diffs)}
    return out


def agreement(rows):
    """Pairwise agreement between reviewers on the same pair (share of reviewer pairs choosing the
    same winner), against the chance level implied by the overall win rate. Not a full kappa, but
    it is stable at small n and easy to read."""
    by_pair = defaultdict(list)
    for r in rows:
        by_pair[r["pair"]].append(r["winner"])
    agree = total = 0
    for votes in by_pair.values():
        for i in range(len(votes)):
            for j in range(i + 1, len(votes)):
                total += 1
                agree += votes[i] == votes[j]
    return agree / total if total else float("nan")


def needed_sample(effect_share, sd_reviewer=0.10, sd_brief=0.20, power_z=1.645, alpha_z=1.96):
    """Rough number of briefs and reviewers to detect a preference share different from 0.5.
    Variance of the mean share = sd_brief^2/briefs + sd_reviewer^2/reviewers (additive random effects).
    The two standard deviations are ASSUMED here; estimate them from a pilot before relying on this.
    Returns briefs needed for each reviewer count, or None when reviewer variance alone is too large."""
    delta = abs(effect_share - 0.5)
    need = ((alpha_z + power_z) / delta) ** 2
    out = []
    for reviewers in (3, 5, 8):
        briefs = math.ceil((sd_brief ** 2) / max(1e-9, (delta / (alpha_z + power_z)) ** 2 - sd_reviewer ** 2 / reviewers)) if (delta / (alpha_z + power_z)) ** 2 > sd_reviewer ** 2 / reviewers else None
        out.append({"reviewers": reviewers, "briefsNeeded": briefs})
    return out


def report(ratings_path, key_path):
    ratings, key = load(ratings_path, key_path)
    rows = decode(ratings, key)
    out = {"reviewers": len({r["reviewer"] for r in rows}), "briefs": len({r["brief"] for r in rows}), "comparisons": {}}
    for gens in sorted({r["gens"] for r in rows}):
        sub = [r for r in rows if r["gens"] == gens]
        a, b = gens
        lo, hi = bootstrap_share(sub, a)
        out["comparisons"][f"{a} vs {b}"] = {
            "n": len(sub), f"{a}Share": round(share(sub, a), 3), "ci95": [round(lo, 3), round(hi, 3)],
            "dimensions": dimension_diffs(sub, a, b), "reviewerAgreement": round(agreement(sub), 3),
        }
    return out


if __name__ == "__main__":
    print(json.dumps(report(sys.argv[1], sys.argv[2]), indent=1))
