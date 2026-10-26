import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { median, relError, scoreView, type TruthView } from "./score";

/**
 * The reconstruction benchmark: renders of Icarus's own offices, whose true geometry is known, run
 * through the Modal worker. Set BENCH_DIR to a folder holding `truth.json` and `geo/bench-<office>-<view>.json`
 * to run it; without it the suite is skipped, so a fresh clone passes. Results go to BENCH_DIR/result.json.
 */
const dir = process.env.BENCH_DIR;
const bench = dir && existsSync(`${dir}/truth.json`) ? describe : describe.skip;

bench("reconstruction benchmark", () => {
  it("scores every view against the known room", { timeout: 120_000 }, () => {
    const truth = JSON.parse(readFileSync(`${dir}/truth.json`, "utf8")) as TruthView[];
    const counters = [0, 0, 0, 0, 0, 0];
    const rows = truth.map((t) => {
      const v = counters[t.office] as number;
      counters[t.office] = v + 1;
      return { t, geo: JSON.parse(readFileSync(`${dir}/geo/bench-${t.office}-${v}.json`, "utf8")) };
    });
    const raw = rows.map(({ t, geo }) => scoreView(t, geo, 1));
    const all = raw.flatMap((s) => s.measures);
    const stat = (ms: typeof all) => ({
      n: ms.length,
      medianAbsErrPct: +(median(ms.map((m) => Math.abs(relError(m)))) * 100).toFixed(1),
      medianSignedPct: +(median(ms.map(relError)) * 100).toFixed(1),
    });
    const ceilingScaled = rows
      .map(({ t, geo }) => {
        const c = scoreView(t, geo, 1).fit?.ceilingHeightM;
        return scoreView(t, geo, c ? Math.min(1.3, Math.max(0.8, 2.8 / c)) : 1);
      })
      .flatMap((s) => s.measures);
    const out = {
      views: raw.length,
      noFit: raw.filter((s) => !s.fit).length,
      falseWalls: raw.reduce((a, s) => a + s.falseWalls, 0),
      missedWalls: raw.reduce((a, s) => a + s.missedWalls, 0),
      overall: stat(all),
      camera: stat(all.filter((m) => m.kind === "camera")),
      ceiling: stat(all.filter((m) => m.kind === "ceiling")),
      wall: stat(all.filter((m) => m.kind === "wall")),
      ifScaledToATypical2p8mCeiling: stat(ceilingScaled),
      perView: raw.map((s) => ({
        office: s.view.office,
        view: s.view.view,
        fit: !!s.fit,
        liftedFloorM: s.fit ? +s.fit.liftedFloorM.toFixed(2) : null,
        false: s.falseWalls,
        measures: s.measures.map(
          (m) =>
            `${m.label} ${m.measured.toFixed(2)} vs ${m.truth.toFixed(2)} (${(relError(m) * 100).toFixed(0)}%)`,
        ),
      })),
    };
    writeFileSync(`${dir}/result.json`, JSON.stringify(out, null, 1));
  });
});
