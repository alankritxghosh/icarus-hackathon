import { evaluateProgram, fitShell, readBrief, suggestFixes } from "@icarus/core";
import { describe, expect, it } from "vitest";
import { buildSummary } from "../src/buildSummary";
import { assessCompletion } from "../src/completion";
import { finish } from "../src/design";
import { acceptLargerShell, wantsLargerShell } from "../src/recovery";

const STARTER =
  "A 12-person startup. Open workspace, two meeting rooms, one phone booth, kitchen, reception, two restrooms. 14 m by 10 m shell, windows on the north and south walls, entrance on the west.";

describe("starter recovery", () => {
  it("offers a measured larger shell when the stated shell loses workstations", {
    timeout: 180_000,
  }, () => {
    const program = readBrief(STARTER).program;
    const base = evaluateProgram(program, { seeds: [1, 2] });
    const grown = fitShell(program, { seeds: [1, 2] });
    const suggestions = suggestFixes(program, base.issues, base);
    expect(base.furnished.report.seatsPlaced).toBe(5);
    expect(base.furnished.report.seatsWanted).toBe(12);
    expect(grown?.widthM).toBe(16.5);
    expect(grown?.depthM).toBe(11.5);
    expect(grown?.evaluation.furnished.report.seatsPlaced).toBe(12);
    expect(grown?.evaluation.issues.filter((i) => i.severity === "fail")).toEqual([]);
    expect(suggestions.some((s) => s.change.kind === "grow_shell")).toBe(true);

    const built = finish({ program, plan: base.plan, seed: base.seed, notes: [] }, 0);
    expect(assessCompletion(built).complete).toBe(false);
    built.trace = {
      proposal: "rules",
      decisions: [],
      ignored: [],
      vetoed: [],
      revisions: { asked: 0, valid: 0, used: 0 },
      rounds: [],
      suggestions,
      startOpen: 0,
      endOpen: 0,
      startCost: base.cost,
      endCost: base.cost,
    };
    expect(buildSummary(built)).toContain(
      "A 16.5 × 11.5 m shell fits in a checked plan. Say “use the larger shell” if you can change the size.",
    );
    expect(wantsLargerShell("use the larger shell")).toBe(true);
    expect(wantsLargerShell("yes")).toBe(false);
    const accepted = acceptLargerShell(built);
    expect("built" in accepted).toBe(true);
    if ("built" in accepted) {
      expect(accepted.built.program.shell.widthM).toBe(16.5);
      expect(accepted.built.program.shell.depthM).toBe(11.5);
      expect(accepted.built.report.seatsPlaced).toBe(12);
      expect(accepted.built.report.seatsWanted).toBe(12);
      expect(
        accepted.built.scene.nodes.filter(
          (n) =>
            n.roomKind === "open_workspace" && n.name === "desk" && n.geometry.kind === "asset",
        ),
      ).toHaveLength(12);
      expect(
        accepted.built.program.assumptions.find((a) => a.topic === "shell")?.statement,
      ).toContain("at your request");
      expect(accepted.built.trace).toBeUndefined();
      expect(assessCompletion(accepted.built)).toEqual({ complete: true, lines: [] });
      const deskIndex = accepted.built.scene.nodes.findIndex(
        (node) => node.roomKind === "open_workspace" && node.name === "desk",
      );
      expect(deskIndex).toBeGreaterThanOrEqual(0);
      const missingDesk = {
        ...accepted.built,
        scene: {
          ...accepted.built.scene,
          nodes: accepted.built.scene.nodes.filter((_, index) => index !== deskIndex),
        },
      };
      expect(assessCompletion(missingDesk)).toEqual({
        complete: false,
        lines: ["I could not verify the workstation count in the 3D model."],
      });
      const boothIndex = accepted.built.scene.nodes.findIndex(
        (node) => node.name === "phone booth back",
      );
      expect(boothIndex).toBeGreaterThanOrEqual(0);
      const missingBooth = {
        ...accepted.built,
        scene: {
          ...accepted.built.scene,
          nodes: accepted.built.scene.nodes.filter((_, index) => index !== boothIndex),
        },
      };
      expect(assessCompletion(missingBooth)).toEqual({
        complete: false,
        lines: ["I could not verify the phone booth count in the 3D model."],
      });
      expect(acceptLargerShell(accepted.built)).toEqual({
        reason: "This design already fits its requested workstations and rooms.",
      });
    }
    expect(built.program.shell.widthM).toBe(14);
  });
});
