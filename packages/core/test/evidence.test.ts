import { describe, expect, it } from "vitest";
import { type FloorPlan, layoutOffice, measurePlan, reachable } from "../src";
import { demoProgram } from "./fixtures";

const program = demoProgram();
const plan = layoutOffice(program, { seed: 1 });
const byId = (items: ReturnType<typeof measurePlan>, id: string) => items.find((i) => i.id === id);

describe("evidence", () => {
  it("reports measured areas that match the plan's own geometry", () => {
    const items = measurePlan(plan, program);
    const open = plan.rooms.find((r) => r.kind === "open_workspace");
    const area = (open?.rect.w ?? 0) * (open?.rect.h ?? 0);
    expect(byId(items, "workspace-per-person")?.measured).toBeCloseTo(area / 35, 2);
    expect(byId(items, "areas")?.measured).toBeCloseTo(24 * 16, 6);
    expect(items.filter((i) => i.id.startsWith("room.")).length).toBe(plan.rooms.length);
    const first = byId(items, `room.${plan.rooms[0]?.id}`);
    expect(first?.detail).toMatch(/target of/);
  });

  it("finds every room reachable in a generated plan, and notices when one is cut off", () => {
    expect(reachable(plan).size).toBe(plan.rooms.length + plan.circulation.length);
    expect(byId(measurePlan(plan, program), "reachability")?.status).toBe("ok");
    const cut: FloorPlan = {
      ...plan,
      rooms: plan.rooms.map((r, i) =>
        i === 0 ? { ...r, door: { ...r.door, opensTo: "nowhere" } } : r,
      ),
    };
    const item = byId(measurePlan(cut, program), "reachability");
    expect(item?.status).toBe("fail");
    expect(item?.detail).toContain(plan.rooms[0]?.name);
  });

  it("flags a workspace that is too tight and a required-daylight room with none", () => {
    const dark = measurePlan({ ...plan, shell: { ...plan.shell, windows: [] } }, program);
    expect(byId(dark, "daylight")?.status).toBe("fail");
    const crowded = measurePlan(plan, {
      ...program,
      company: { ...program.company, headcount: 200 },
    });
    expect(byId(crowded, "workspace-per-person")?.status).toBe("fail");
  });

  it("states its scope and never claims compliance", () => {
    const items = measurePlan(plan, program);
    expect(byId(items, "scope")?.detail).toMatch(/not a building-code/i);
    expect(JSON.stringify(items)).not.toMatch(/compliant|meets code|approved/i);
  });

  it("carries the plan's own warnings through, so nothing is hidden", () => {
    const tight = demoProgram({ widthM: 12, depthM: 10 });
    const tightPlan = layoutOffice(tight, { seed: 1, iterations: 1500, restarts: 2 });
    const items = measurePlan(tightPlan, tight);
    expect(items.some((i) => i.status === "warn" || i.status === "fail")).toBe(true);
  });
});
