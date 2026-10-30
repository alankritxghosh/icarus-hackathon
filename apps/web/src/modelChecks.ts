import type { EvidenceItem } from "@icarus/core";
import { type AccountLesson, fromFloorPlan } from "@icarus/spatial/model";
import wasmUrl from "clipper2-wasm/dist/umd/clipper2z.wasm?url";
import type { Built } from "./design";

// The geometry kernel is loaded only when an office is first checked, so the page that asks for a
// brief does not download it. One kernel is shared by every check.
let kernel:
  | Promise<{ spatial: typeof import("@icarus/spatial"); kernel: import("@icarus/spatial").Kernel }>
  | undefined;
function load() {
  kernel ??= (async () => {
    const [spatial, wasm] = await Promise.all([
      import("@icarus/spatial"),
      fetch(wasmUrl).then((r) => {
        if (!r.ok) throw new Error(`kernel download failed: ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    return { spatial, kernel: await spatial.createKernel({ wasmBinary: wasm }) };
  })();
  // A failed load should be retried next time, not remembered.
  kernel.catch(() => {
    kernel = undefined;
  });
  return kernel;
}

/** The office's furniture and fixtures, as the spatial model's items, so taught rules can look at what is in each room. */
export function withItems(built: Built, model: ReturnType<typeof fromFloorPlan>) {
  const spaces = new Set(model.spaces.map((s) => s.id));
  const items = built.scene.nodes
    .filter(
      (n) => (n.type === "furniture" || n.type === "fixture") && n.roomId && spaces.has(n.roomId),
    )
    .map((n) => {
      const [w = 0, h = 0, d = 0] =
        n.geometry.kind === "box"
          ? n.geometry.size
          : n.geometry.kind === "asset"
            ? n.geometry.size
            : [0.4, 0.4, 0.4];
      return {
        id: n.id,
        spaceId: n.roomId as string,
        kind: n.tags[1] ?? n.name,
        at: { x: Math.round(n.position[0] * 1000), y: Math.round(n.position[2] * 1000) },
        sizeMm: {
          w: Math.max(1, Math.round(w * 1000)),
          d: Math.max(1, Math.round(d * 1000)),
          h: Math.max(1, Math.round(h * 1000)),
        },
        rotationDeg: (n.rotationY * 180) / Math.PI,
        clearFrontMm: 0,
        provenance: { source: "generated" as const, evidence: [] },
      };
    });
  return { ...model, items };
}

/** Findings from the spatial model for this office and the account's taught rules; empty if the checker cannot load. */
export async function modelChecks(
  built: Built,
  lessons: AccountLesson[] = [],
): Promise<EvidenceItem[]> {
  try {
    const { spatial, kernel: k } = await load();
    const model = fromFloorPlan(built.plan, { program: built.program });
    const items = spatial.modelEvidence(model, k);
    if (!lessons.length) return items;
    // One line per distinct complaint: six chairs in one room is one finding said once, not six.
    const counted = new Map<
      string,
      { f: ReturnType<typeof spatial.checkLessons>[number]; n: number }
    >();
    for (const f of spatial.checkLessons(withItems(built, model), lessons)) {
      const seen = counted.get(`${f.code}|${f.message}`);
      if (seen) seen.n++;
      else counted.set(`${f.code}|${f.message}`, { f, n: 1 });
    }
    const broken = [...counted.values()];
    return [
      ...items,
      ...(broken.length
        ? broken.slice(0, 6).map(({ f, n }, i) => ({
            id: `lesson-${i}-${f.code}`,
            label: f.level === "error" ? "A rule you taught is broken" : "About your lessons",
            status: f.level === "error" ? ("fail" as const) : ("warn" as const),
            detail: `${f.message}${n > 1 ? ` (${n} times)` : ""}.`,
          }))
        : [
            {
              id: "lessons-ok",
              label: "Your lessons",
              status: "ok" as const,
              detail: `${lessons.length} taught rule${lessons.length === 1 ? "" : "s"}, none broken.`,
            },
          ]),
    ];
  } catch {
    return [];
  }
}
