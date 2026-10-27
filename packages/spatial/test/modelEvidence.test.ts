import { beforeAll, describe, expect, it } from "vitest";
import { fromFloorPlan, type Kernel, modelEvidence } from "../src";
import { plans } from "./fixtures";
import { testKernel } from "./kernelSetup";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});
const base = () => fromFloorPlan(plans()[0]?.plan as never, { program: plans()[0]?.program });
const byId = (items: ReturnType<typeof modelEvidence>, id: string) =>
  items.find((i) => i.id === id);

describe("modelEvidence", () => {
  it("a generated design passes the drawing check and says it was designed, not surveyed", () => {
    const items = modelEvidence(base(), k);
    expect(byId(items, "drawing-check")?.status).toBe("ok");
    expect(byId(items, "dimension-source")?.status).toBe("info");
    expect(byId(items, "dimension-source")?.detail).toContain("nothing has been surveyed");
  });

  it("a broken drawing fails with the first problem named", () => {
    const m = base();
    m.spaces[1]!.boundary = JSON.parse(JSON.stringify(m.spaces[0]!.boundary));
    const item = byId(modelEvidence(m, k), "drawing-check");
    expect(item?.status).toBe("fail");
    expect(item?.detail).toContain("overlap");
  });

  it("a room with no route from the front door fails", () => {
    const m = base();
    const door = m.openings.find((o) => !o.entrance && o.kind === "door")!;
    m.openings = m.openings.filter((o) => o.id !== door.id);
    expect(byId(modelEvidence(m, k), "drawing-check")?.status).toBe("fail");
  });

  it("estimates are called estimates", () => {
    const m = base();
    const w = m.walls.find((x) => x.kind === "exterior")!;
    w.provenance = { source: "estimated", toleranceMm: 250, evidence: [] };
    const item = byId(modelEvidence(m, k), "dimension-source");
    expect(item?.status).toBe("warn");
    expect(item?.detail).toContain("±250 mm");
  });
});
