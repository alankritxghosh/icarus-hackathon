import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSETS, furnish, layoutOffice, ProgramSchema } from "../src";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(join(root, "assets/manifest.json"), "utf8")) as {
  models: string[];
};
const licences = readFileSync(join(root, "assets/LICENSES.md"), "utf8");

describe("the CC0 models the furniture uses", () => {
  it("are all in the manifest, on disk, and credited in the licence table", () => {
    for (const spec of Object.values(ASSETS)) {
      expect(manifest.models, spec.id).toContain(spec.id);
      expect(
        existsSync(join(root, `apps/web/public/assets/models/${spec.id}/${spec.id}.gltf`)),
        spec.id,
      ).toBe(true);
      expect(licences, spec.id).toContain(`| ${spec.id} |`);
    }
  });

  it("show up in a furnished office, scaled to the footprint the planner chose", () => {
    const program = ProgramSchema.parse({
      company: { headcount: 12 },
      shell: { widthM: 16, depthM: 10, windows: ["north"], entrance: "south" },
      rooms: [
        { kind: "open_workspace" },
        { kind: "meeting_room", capacity: 4 },
        { kind: "lounge" },
        { kind: "reception" },
        { kind: "storage" },
      ],
    });
    const plan = layoutOffice(program, { seed: 1 });
    const { scene } = furnish(plan, program);
    const ids = new Set(
      scene.nodes.flatMap((n) => (n.geometry.kind === "asset" ? [n.geometry.id] : [])),
    );
    for (const id of ["metal_office_desk", "mid_century_lounge_chair", "dining_table", "Shelf_01"])
      expect(ids.has(id), id).toBe(true);
    const desk = scene.nodes.find(
      (n) => n.geometry.kind === "asset" && n.geometry.id === "metal_office_desk",
    );
    expect(desk?.geometry.kind === "asset" && desk.geometry.scale?.[1]).toBe(1);
    expect(desk?.geometry.kind === "asset" && desk.geometry.size[2]).toBeCloseTo(0.75, 5);
  });
});
