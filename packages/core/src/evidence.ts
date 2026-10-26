import { KIND_RULES } from "./catalog";
import { exposureOnSide, facingSpan, round2, sharedEdge } from "./geometry";
import { ADJACENT_GAP_M } from "./layout/cost";
import { CORRIDOR_WIDTH_M, type FloorPlan, LOBBY_WIDTH_M } from "./layout/types";
import { expandRooms, type Program } from "./program";

export interface EvidenceItem {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "info";
  detail: string;
  measured?: number;
  unit?: string;
}

const WORKSPACE_OK_M2 = 4.5;
const WORKSPACE_WARN_M2 = 3.5;

/** Every circulation or room id reachable from the front door by walking through doors. */
export function reachable(plan: FloorPlan): Set<string> {
  const edges = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)?.add(b);
    edges.get(b)?.add(a);
  };
  for (const a of plan.circulation)
    for (const b of plan.circulation)
      if (a.id < b.id && sharedEdge(a.rect, b.rect) > 0.5) link(a.id, b.id);
  for (const room of plan.rooms)
    if (plan.circulation.some((c) => c.id === room.door.opensTo)) link(room.id, room.door.opensTo);
  const seen = new Set<string>(["lobby"]);
  const queue = ["lobby"];
  while (queue.length) {
    for (const next of edges.get(queue.shift() as string) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Measured facts about a plan, each computed from its geometry. The layout search optimises the
 * same quantities, so this panel is the search's own report card and not a separate story.
 */
export function measurePlan(plan: FloorPlan, program: Program): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const shell = { w: plan.shell.w, h: plan.shell.h };
  const shellArea = shell.w * shell.h;
  const roomArea = plan.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
  const circulationArea = plan.circulation.reduce((s, c) => s + c.rect.w * c.rect.h, 0);
  const headcount = program.company.headcount;

  items.push({
    id: "areas",
    label: "Floor area",
    status: "info",
    detail: `${round2(shellArea)} m2 shell: ${round2(roomArea)} m2 in rooms and ${round2(circulationArea)} m2 circulation (${Math.round((circulationArea / shellArea) * 100)}%).`,
    measured: round2(shellArea),
    unit: "m2",
  });

  const workspaceArea = plan.rooms
    .filter((r) => r.kind === "open_workspace" || r.kind === "private_office")
    .reduce((s, r) => s + r.rect.w * r.rect.h, 0);
  const perPerson = workspaceArea / headcount;
  items.push({
    id: "workspace-per-person",
    label: "Workspace per person",
    status: perPerson >= WORKSPACE_OK_M2 ? "ok" : perPerson >= WORKSPACE_WARN_M2 ? "warn" : "fail",
    detail: `${round2(perPerson)} m2 of workspace for ${headcount} people. A rule of thumb for concept design, not a code requirement.`,
    measured: round2(perPerson),
    unit: "m2 per person",
  });

  const planned = new Map(expandRooms(program).map((r) => [r.id, r]));
  for (const room of plan.rooms) {
    const rule = KIND_RULES[room.kind];
    const actual = room.rect.w * room.rect.h;
    const scale = actual / room.targetAreaM2;
    const issues: string[] = [];
    if (scale < rule.minScale) issues.push(`below ${Math.round(rule.minScale * 100)}% of target`);
    if (Math.min(room.rect.w, room.rect.h) < Math.min(rule.minWidth, rule.minDepth) - 1e-6)
      issues.push("narrower than this kind of room should be");
    items.push({
      id: `room.${room.id}`,
      label: room.name,
      status: issues.length ? "warn" : scale > 1.4 ? "info" : "ok",
      detail: `${round2(actual)} m2 against a target of ${room.targetAreaM2} m2 (${Math.round(scale * 100)}%; ${planned.get(room.id)?.basis ?? "catalog rule"}), ${round2(room.rect.w)} x ${round2(room.rect.h)} m${issues.length ? `, ${issues.join(", ")}` : ""}.`,
      measured: round2(actual),
      unit: "m2",
    });
  }

  const lit = plan.rooms.map((r) => ({
    room: r,
    exposure: plan.shell.windows.reduce((s, side) => s + exposureOnSide(r.rect, shell, side), 0),
  }));
  const missingRequired = lit.filter(
    ({ room, exposure }) => KIND_RULES[room.kind].daylight === "required" && exposure <= 0,
  );
  const missingPreferred = lit.filter(
    ({ room, exposure }) => KIND_RULES[room.kind].daylight === "preferred" && exposure <= 0,
  );
  items.push({
    id: "daylight",
    label: "Daylight",
    status: missingRequired.length ? "fail" : "info",
    detail: `${lit.filter((l) => l.exposure > 0).length} of ${plan.rooms.length} rooms touch a window wall. ${missingRequired.length ? `Needs daylight but has none: ${missingRequired.map((m) => m.room.name).join(", ")}. ` : ""}${missingPreferred.length ? `Would prefer it: ${missingPreferred.map((m) => m.room.name).join(", ")}.` : ""} Wall exposure only; no daylight simulation was run.`,
    measured: lit.filter((l) => l.exposure > 0).length,
    unit: "rooms",
  });

  const misses: string[] = [];
  let wishes = 0;
  for (const room of plan.rooms)
    for (const want of KIND_RULES[room.kind].adjacent) {
      const others = plan.rooms.filter((o) => o.id !== room.id && o.kind === want);
      if (others.length === 0) continue;
      wishes++;
      if (!others.some((o) => facingSpan(room.rect, o.rect, ADJACENT_GAP_M) >= 1.5))
        misses.push(`${room.name} is not next to a ${KIND_RULES[want].label.toLowerCase()}`);
    }
  items.push({
    id: "adjacency",
    label: "Adjacency wishes",
    status: misses.length ? "warn" : "ok",
    detail:
      wishes === 0
        ? "No adjacency wishes apply."
        : `${wishes - misses.length} of ${wishes} met (rooms share a wall or face each other across a corridor).${misses.length ? ` Missed: ${misses.join("; ")}.` : ""}`,
    measured: wishes - misses.length,
    unit: "wishes met",
  });

  const reach = reachable(plan);
  const stranded = plan.rooms.filter((r) => !reach.has(r.id));
  items.push({
    id: "reachability",
    label: "Every room reachable from the front door",
    status: stranded.length ? "fail" : "ok",
    detail: stranded.length
      ? `Cannot reach: ${stranded.map((r) => r.name).join(", ")}.`
      : `All ${plan.rooms.length} rooms are reachable through doors and circulation.`,
    measured: plan.rooms.length - stranded.length,
    unit: "rooms",
  });

  const reception = plan.rooms.find((r) => r.kind === "reception");
  const lobby = plan.circulation.find((c) => c.id === "lobby");
  if (reception && lobby)
    items.push({
      id: "entrance-sequence",
      label: "Reception at the entrance",
      status: sharedEdge(reception.rect, lobby.rect) > 0.5 ? "ok" : "warn",
      detail:
        sharedEdge(reception.rect, lobby.rect) > 0.5
          ? "Reception opens onto the entrance lobby."
          : "Reception is not on the entrance lobby.",
    });

  items.push({
    id: "circulation-widths",
    label: "Circulation widths",
    status: "info",
    detail: `Corridors ${CORRIDOR_WIDTH_M} m and entrance lobby ${LOBBY_WIDTH_M} m, fixed planning values. Not checked against any building code.`,
    measured: CORRIDOR_WIDTH_M,
    unit: "m",
  });

  for (const d of plan.diagnostics.filter((d) => d.level !== "info"))
    items.push({
      id: `diagnostic.${items.length}`,
      label: d.room ? `Note on ${d.room}` : "Planning note",
      status: d.level === "fail" ? "fail" : "warn",
      detail: d.message,
    });

  items.push({
    id: "scope",
    label: "What this is",
    status: "info",
    detail:
      "Concept design only. It is not a building-code, fire-safety, accessibility, structural or acoustic assessment, and no claim of compliance is made.",
  });
  return items;
}
