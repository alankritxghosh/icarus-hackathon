import { applySuggestion, diagnose, evaluateProgram, fitShell } from "@icarus/core";
import { type Built, builtFromEvaluation, type EditEntry } from "./design";

/** A short, explicit acceptance of the larger-shell option offered in the conversation. */
export function wantsLargerShell(text: string): boolean {
  return /^(?:please\s+)?(?:use|try|make|enlarge|increase)\s+(?:the\s+)?(?:larger|bigger)\s+shell[.!?]?$/i.test(
    text.trim(),
  );
}

/** Re-plan from the current program, so an old chat offer cannot silently override later edits. */
export function acceptLargerShell(
  base: Built,
): { built: Built; line: string } | { reason: string } {
  const placed = base.report.seatsPlaced + base.report.privateDesksPlaced;
  const wanted = base.report.seatsWanted + base.report.privateDesksWanted;
  const baseFailures = diagnose(base.plan, base.program, base.report).filter(
    (i) => i.severity === "fail",
  );
  if (
    !baseFailures.length &&
    placed >= wanted &&
    base.report.phoneBoothsPlaced >= base.report.phoneBoothsWanted
  )
    return { reason: "This design already fits its requested workstations and rooms." };

  const found = fitShell(base.program, { seeds: [1, 2] });
  if (
    !found ||
    found.widthM <= base.program.shell.widthM ||
    found.depthM <= base.program.shell.depthM
  )
    return { reason: "I could not find a larger shell that improves this design." };

  const statement = `Shell changed to ${found.widthM} × ${found.depthM} m at your request.`;
  const program = applySuggestion(base.program, {
    change: { kind: "grow_shell", widthM: found.widthM, depthM: found.depthM },
  });
  program.assumptions = [
    ...program.assumptions.filter((a) => a.topic !== "shell"),
    { topic: "shell", statement, source: "brief", confidence: 1 },
  ];
  const evaluation = evaluateProgram(program, { seeds: [1, 2] });
  const report = evaluation.furnished.report;
  const failures = evaluation.issues.filter((i) => i.severity === "fail");
  if (
    failures.length ||
    report.seatsPlaced + report.privateDesksPlaced <
      report.seatsWanted + report.privateDesksWanted ||
    report.phoneBoothsPlaced < report.phoneBoothsWanted
  )
    return {
      reason:
        "I tried a larger shell, but it still missed part of the brief. Your design is unchanged.",
    };

  const entry: EditEntry = {
    text: "use the larger shell",
    by: "rules",
    lines: [{ status: "applied", text: statement }],
  };
  const built = builtFromEvaluation(evaluation, base, entry);
  return {
    built: { ...built, trace: undefined, notes: [...base.notes, statement] },
    line: statement,
  };
}
