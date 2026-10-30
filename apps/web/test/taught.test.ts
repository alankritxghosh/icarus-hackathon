import type { Scene, SceneNode } from "@icarus/core";
import { describe, expect, it } from "vitest";
import { applyTaught, learnFrom } from "../src/taught";

const node = (id: string, kind: string, roomKind?: string): SceneNode => ({
  id,
  name: kind,
  type: "furniture",
  ...(roomKind ? { roomId: `${roomKind}.1`, roomKind: roomKind as never } : {}),
  geometry: { kind: "box", size: [1, 1, 1] },
  position: [0, 0, 0],
  rotationY: 0,
  material: "oak",
  tags: ["furniture", kind],
});
const scene = (nodes: SceneNode[]): Scene => ({
  ceilingM: 3,
  nodes,
  materials: {},
  shell: { w: 10, h: 10 },
});

describe("learning from what a person types", () => {
  it("keeps a stated preference in the person's own words, once", () => {
    const a = learnFrom("never put plants in the kitchen", []);
    expect(a.added.map((l) => l.said)).toEqual(["never put plants in the kitchen"]);
    expect(a.onlyPreferences).toBe(true);
    const b = learnFrom("never put plants in the kitchen", a.lessons);
    expect(b.added).toEqual([]);
    expect(b.lessons).toHaveLength(1);
  });

  it("finds a preference inside a longer message and leaves the request to the editor", () => {
    const r = learnFrom("Make the kitchen bigger. No carpet in the kitchen.", []);
    expect(r.added.map((l) => l.rule.type)).toEqual(["forbid-floor"]);
    expect(r.onlyPreferences).toBe(false);
  });

  it("learns nothing from an ordinary request", () => {
    const r = learnFrom("move the kitchen east", []);
    expect(r.added).toEqual([]);
    expect(r.lessons).toEqual([]);
    expect(r.onlyPreferences).toBe(false);
  });
});

describe("applying what was taught", () => {
  const s = scene([
    node("p1", "plant", "kitchen"),
    node("p2", "plant", "lounge"),
    node("c1", "chair", "kitchen"),
  ]);

  it("takes a forbidden item out of the rooms it is forbidden in, and nothing else", () => {
    const { lessons } = learnFrom("never put plants in the kitchen", []);
    const out = applyTaught(s, lessons);
    expect(out.scene.nodes.map((n) => n.id)).toEqual(["p2", "c1"]);
    expect(out.touched).toEqual(["A-1"]);
  });

  it("takes an item out of every room when no room is named, and does nothing with no lessons", () => {
    const { lessons } = learnFrom("don't use plants", []);
    expect(applyTaught(s, lessons).scene.nodes.map((n) => n.id)).toEqual(["c1"]);
    expect(applyTaught(s, [])).toEqual({ scene: s, touched: [] });
  });
});
