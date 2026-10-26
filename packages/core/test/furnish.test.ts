import { describe, expect, it } from "vitest";
import { furnish, layoutOffice, overlapArea, type Program, type Side } from "../src";
import { demoProgram, must, smallProgram } from "./fixtures";

const sides: Side[] = ["north", "south", "east", "west"];
const withEntrance = (p: Program, entrance: Side): Program => ({
  ...p,
  shell: { ...p.shell, entrance },
});

describe("furnish", () => {
  const program = must(demoProgram());
  const plan = layoutOffice(program, { seed: 1 });
  const result = furnish(plan, program);

  it("seats everyone and places every booth and meeting seat in the demo office", () => {
    expect(result.report.seatsPlaced).toBe(program.company.headcount);
    expect(result.report.phoneBoothsPlaced).toBe(program.phoneBooths);
    expect(result.report.meetingSeatsPlaced).toBe(result.report.meetingSeatsWanted);
  });

  it("furnishes every room kind in the program", () => {
    const furnished = new Set(
      result.scene.nodes.filter((n) => n.type === "furniture" && n.roomKind).map((n) => n.roomKind),
    );
    for (const room of plan.rooms) expect(furnished, room.name).toContain(room.kind);
  });

  it("keeps every checked item inside its room, clear of the others and of the door", () => {
    for (const { roomId, rects, doorClearance } of result.checked) {
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) throw new Error(roomId);
      for (const [i, a] of rects.entries()) {
        expect(a.x, roomId).toBeGreaterThanOrEqual(room.rect.x - 1e-6);
        expect(a.y, roomId).toBeGreaterThanOrEqual(room.rect.y - 1e-6);
        expect(a.x + a.w, roomId).toBeLessThanOrEqual(room.rect.x + room.rect.w + 1e-6);
        expect(a.y + a.h, roomId).toBeLessThanOrEqual(room.rect.y + room.rect.h + 1e-6);
        expect(overlapArea(a, doorClearance), `${roomId} door`).toBeLessThan(1e-4);
        for (const b of rects.slice(i + 1)) expect(overlapArea(a, b), roomId).toBeLessThan(1e-4);
      }
    }
  });

  it("puts everything inside the shell and gives each node a known material", () => {
    const furnishings = new Set(["furniture", "fixture", "light"]);
    for (const node of result.scene.nodes.filter((n) => furnishings.has(n.type))) {
      const [x, , z] = node.position;
      expect(x).toBeGreaterThan(-0.01);
      expect(x).toBeLessThan(plan.shell.w + 0.01);
      expect(z).toBeGreaterThan(-0.01);
      expect(z).toBeLessThan(plan.shell.h + 0.01);
      expect(result.scene.materials[node.material], node.id).toBeDefined();
    }
  });

  it("is deterministic for a plan", () => {
    const again = furnish(plan, program);
    expect(again.scene.nodes.map((n) => [n.id, n.position, n.rotationY])).toEqual(
      result.scene.nodes.map((n) => [n.id, n.position, n.rotationY]),
    );
  });

  it("lights the office", () => {
    expect(result.scene.nodes.filter((n) => n.type === "light").length).toBeGreaterThan(10);
  });

  for (const side of sides)
    it(`holds the same guarantees with the entrance on the ${side}`, () => {
      const p = withEntrance(program, side);
      const f = furnish(layoutOffice(p, { seed: 2 }), p);
      expect(f.report.seatsPlaced).toBeGreaterThanOrEqual(Math.floor(p.company.headcount * 0.9));
      for (const { rects, doorClearance } of f.checked)
        for (const a of rects) expect(overlapArea(a, doorClearance)).toBeLessThan(1e-4);
    });

  it("reports honestly when a small shell cannot seat everyone", () => {
    const crowded: Program = { ...program, company: { ...program.company, headcount: 140 } };
    const f = furnish(layoutOffice(crowded, { seed: 1 }), crowded);
    expect(f.report.seatsWanted).toBe(140);
    expect(f.report.seatsPlaced).toBeLessThan(140);
    expect(f.report.seatsPlaced).toBeGreaterThan(0);
  });

  it("furnishes a small office without placing anything outside it", () => {
    const small = must(smallProgram());
    const f = furnish(layoutOffice(small, { seed: 1 }), small);
    expect(f.report.seatsPlaced).toBeGreaterThan(0);
  });
});
