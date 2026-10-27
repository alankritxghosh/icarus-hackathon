// Run: node --test schema.test.ts   (Node 24 strips the types)
import assert from "node:assert/strict";
import { test } from "node:test";
import { circularConferenceRoom, fromV1, lShapedWithColumns, reconstructedRoom, twoLevelBuilding } from "./examples.ts";
import { flattenRing, regionArea, toRegion } from "./geometry.ts";
import { circulationGraph, uncertaintySummary, usableAreaM2, validate } from "./validate.ts";
import { readFileSync, writeFileSync } from "node:fs";

const errors = (x: unknown) => validate(x).findings.filter((f) => f.level === "error");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("a circle built from four arcs has the area of a circle", () => {
  const m = circularConferenceRoom();
  const conf = m.spaces.find((s) => s.id === "conf")!;
  const area = regionArea(toRegion(conf.boundary, 2));
  const exact = Math.PI * 3500 ** 2;
  assert.ok(Math.abs(area - exact) / exact < 0.002, `${area} vs ${exact}`);
  assert.ok(flattenRing(conf.boundary.outer).length > 30);
});

test("the circular-room example validates, and its curved wall carries a door", () => {
  assert.deepEqual(errors(circularConferenceRoom()), []);
});

test("the L-shaped CP-SAT plan with columns validates and is fully reachable", () => {
  const { model, findings } = validate(lShapedWithColumns());
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
  const g = circulationGraph(model!);
  assert.deepEqual(g.unreachable, []);
  const ws = model!.spaces.find((s) => s.kind === "office.open_workspace")!;
  const gross = regionArea(toRegion(ws.boundary)) / 1e6;
  assert.ok(usableAreaM2(model!, ws.id) <= gross);
});

test("a two-level building is reachable only through the stair", () => {
  const m = twoLevelBuilding();
  assert.deepEqual(errors(m), []);
  assert.deepEqual(circulationGraph(validate(m).model!).unreachable, []);
  const noStair = { ...clone(m), connectors: [] };
  assert.deepEqual(circulationGraph(validate(noStair).model!).unreachable.sort(), ["lobby1", "work1"]);
});

test("every v1 baseline plan converts and validates; report what the conversion shows", () => {
  const data = JSON.parse(readFileSync(new URL("../../results/problems.json", import.meta.url), "utf8"));
  const rows = data.problems.map((p: { name: string }) => {
    const { model, gapAreaM2 } = fromV1(p.name);
    const { findings } = validate(model);
    const g = circulationGraph(model);
    return {
      brief: p.name,
      errors: findings.filter((f) => f.level === "error").map((f) => `${f.code}: ${f.message}`),
      warnings: findings.filter((f) => f.level === "warn").length,
      walls: model.walls.length, openings: model.openings.length, spaces: model.spaces.length,
      unreachable: g.unreachable, uncoveredFloorM2: Math.round(gapAreaM2 * 100) / 100,
    };
  });
  writeFileSync(new URL("../../results/v1-conversion.json", import.meta.url), JSON.stringify(rows, null, 1));
  for (const r of rows) assert.deepEqual(r.errors, [], r.brief);
  for (const r of rows) assert.deepEqual(r.unreachable, [], `${r.brief} has rooms with no door route from the entrance`);
});

test("validation catches broken models", () => {
  const base = lShapedWithColumns();
  const overlap = clone(base);
  overlap.spaces[1]!.boundary = clone(overlap.spaces[0]!.boundary);
  assert.ok(errors(overlap).some((f) => f.code === "spaces_overlap"));

  const pastEnd = clone(base);
  pastEnd.openings[0]!.offsetMm = 10_000_000;
  assert.ok(errors(pastEnd).some((f) => f.code === "opening_outside_wall"));

  const winding = clone(base);
  winding.spaces[0]!.boundary.outer.reverse();
  assert.ok(errors(winding).some((f) => f.code === "wrong_winding"));

  const dangling = clone(base);
  dangling.openings[0]!.hostWallId = "wall.nope";
  assert.ok(errors(dangling).some((f) => f.code === "missing_wall"));

  const swapped = clone(base);
  const w = swapped.walls.find((x) => x.left && x.left !== "exterior" && x.right && x.right !== "exterior")!;
  [w.left, w.right] = [w.right, w.left];
  assert.ok(errors(swapped).some((f) => f.code === "wrong_side"));

  const outside = clone(base);
  outside.spaces[0]!.boundary.outer = outside.spaces[0]!.boundary.outer.map((v) => ({ ...v, x: v.x + 90_000 }));
  assert.ok(errors(outside).some((f) => f.code === "outside_level"));

  const bowtie = clone(base);
  bowtie.spaces[0]!.boundary.outer = [{ x: 0, y: 0 }, { x: 4000, y: 3000 }, { x: 4000, y: 0 }, { x: 0, y: 3000 }];
  assert.ok(errors(bowtie).some((f) => f.code === "self_intersecting" || f.code === "wrong_winding"));
});

test("removing a door breaks reachability", () => {
  const { model } = validate(lShapedWithColumns());
  const m = clone(model!);
  const door = m.openings.find((o) => !o.entrance && o.kind === "door")!;
  m.openings = m.openings.filter((o) => o.id !== door.id);
  assert.ok(circulationGraph(validate(m).model!).unreachable.length >= 1);
});

test("a reconstructed room says what it knows", () => {
  const { model, findings } = validate(reconstructedRoom());
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
  const u = uncertaintySummary(model!);
  assert.equal(u.mayShowAsExact, false);
  assert.equal(u.unknownStructuralWalls, 3);
  assert.deepEqual(u.unquantifiedIds, ["w.west"]);
  assert.equal(u.worstToleranceMm, 400);
  assert.equal(u.wallMayBeMoved("w.north"), false); // measured but structural
  assert.equal(u.wallMayBeMoved("w.south"), false); // unknown structure
  assert.equal(uncertaintySummary(validate(lShapedWithColumns()).model!).mayShowAsExact, true);
});
