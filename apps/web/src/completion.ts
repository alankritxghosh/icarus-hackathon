import { diagnose, expandRooms } from "@icarus/core";
import type { Built } from "./design";

/** Compare the requested program with rooms and desk objects in the finished scene. */
export function assessCompletion(built: Built): { complete: boolean; lines: string[] } {
  const foundRooms = new Set(built.plan.rooms.map((room) => room.id));
  const missingRooms = expandRooms(built.program).filter((room) => !foundRooms.has(room.id));
  const reportedDesks = built.report.seatsPlaced + built.report.privateDesksPlaced;
  const wantedDesks = built.report.seatsWanted + built.report.privateDesksWanted;
  const sceneDesks = built.scene.nodes.filter(
    (node) =>
      (node.roomKind === "open_workspace" || node.roomKind === "private_office") &&
      node.name === "desk" &&
      node.geometry.kind === "asset",
  ).length;
  const failures = diagnose(built.plan, built.program, built.report).filter(
    (issue) => issue.severity === "fail",
  );
  const lines: string[] = [];
  if (missingRooms.length)
    lines.push(`Still missing rooms: ${missingRooms.map((room) => room.name).join(", ")}.`);
  if (sceneDesks !== reportedDesks)
    lines.push(`I could not verify the workstation count in the 3D model.`);
  const areaFailure = failures.find((issue) => issue.code === "program_too_big");
  const otherFailure = failures.find(
    (issue) =>
      issue.code !== "seats_short" &&
      (issue.code !== "workspace_density" || reportedDesks >= wantedDesks),
  );
  if (areaFailure) lines.push(`By Icarus's concept sizing rules, ${areaFailure.message}`);
  else if (otherFailure) lines.push(`Planning concern: ${otherFailure.message}`);
  return {
    complete:
      missingRooms.length === 0 &&
      sceneDesks === reportedDesks &&
      reportedDesks >= wantedDesks &&
      built.report.phoneBoothsPlaced >= built.report.phoneBoothsWanted &&
      failures.length === 0,
    lines,
  };
}
