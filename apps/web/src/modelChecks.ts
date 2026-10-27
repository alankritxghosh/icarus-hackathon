import type { EvidenceItem } from "@icarus/core";
import { fromFloorPlan } from "@icarus/spatial/model";
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

/** Findings from the spatial model for this office; empty if the checker cannot load. */
export async function modelChecks(built: Built): Promise<EvidenceItem[]> {
  try {
    const { spatial, kernel: k } = await load();
    return spatial.modelEvidence(fromFloorPlan(built.plan, { program: built.program }), k);
  } catch {
    return [];
  }
}
