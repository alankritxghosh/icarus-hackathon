// The twenty principles of architecture and interior design as records, and a router that decides, for one model, which
// of them apply, which can be judged with the data the model holds, and which cannot. The point is restraint: a model is
// held only against the principles that concern it, at concept stage, with the thresholds the repository can cite, and
// every principle that was not used says why. Nothing here is a building-code check, and no number is invented: every
// threshold comes from `knowledge/office.v1.json` (which names its source and says it is a planning default) or is
// left out.
//
// Tiers: a gate is a safety or regulatory matter and fails closed (never "pass" without evidence); a measurable
// principle has a check over the geometry; a judgement principle is advisory and needs the client's priorities.
import { KNOWLEDGE, type RoomKind } from "@icarus/core";
import { toRegion } from "./geometry";
import { sharedBoundaryLength } from "./predicates";
import type { SpatialModel } from "./schema";
import type { Finding } from "./validate";

export type Tier = "gate" | "measurable" | "judgement";
export type Status = "checked" | "not-applicable" | "not-assessable";

export interface Profile {
  buildingType: "office" | "residential" | "mixed" | "unknown";
  levels: number;
  spaces: number;
  hasItems: boolean;
  hasDoors: boolean;
  hasWindows: boolean;
  hasConnectors: boolean;
  /** Things the model does not hold, which decide what can be assessed. */
  missing: {
    location: true;
    materials: true;
    services: true;
    loads: true;
    acoustics: true;
    lighting: true;
    brief: true;
  };
}

export interface Decision {
  principle: number;
  name: string;
  tier: Tier;
  status: Status;
  /** Why it was used, skipped, or could not be judged. */
  reason: string;
  /** Where the threshold, if any, comes from. */
  source?: string;
  findings: Finding[];
}

interface Principle {
  id: number;
  name: string;
  tier: Tier;
  /** Returns a reason when the principle does not concern this model, or what the model lacks to judge it. */
  decide: (p: Profile, m: SpatialModel) => { status: Status; reason: string };
  check?: (m: SpatialModel) => Finding[];
  source?: string;
}

const kindKey = (kind: string): RoomKind | undefined => {
  const key = kind.replace(/^office\./, "");
  return key in KNOWLEDGE.rooms ? (key as RoomKind) : undefined;
};

const bbox = (s: SpatialModel["spaces"][number]) => {
  const xs = s.boundary.outer.map((v) => v.x);
  const ys = s.boundary.outer.map((v) => v.y);
  return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys) };
};

/** Shortest distance between the bounding boxes of two spaces, millimetres (0 when they touch or overlap). */
function gapMm(a: SpatialModel["spaces"][number], b: SpatialModel["spaces"][number]): number {
  const box = (s: SpatialModel["spaces"][number]) => {
    const xs = s.boundary.outer.map((v) => v.x);
    const ys = s.boundary.outer.map((v) => v.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
  };
  const [ax0, ay0, ax1, ay1] = box(a);
  const [bx0, by0, bx1, by1] = box(b);
  return Math.hypot(Math.max(0, bx0 - ax1, ax0 - bx1), Math.max(0, by0 - ay1, ay0 - by1));
}

function ringDistance(ring: { x: number; y: number }[], px: number, py: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as { x: number; y: number };
    const b = ring[(i + 1) % ring.length] as { x: number; y: number };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)));
  }
  return best;
}

/** A rule of thumb about proportion is not a hard line: a room 15% past it is left alone. */
const ASPECT_SLACK = 1.15;

const finding = (code: string, message: string, ...ids: string[]): Finding => ({
  level: "warn",
  code,
  message,
  ids,
});

const need = (what: string) => ({
  status: "not-assessable" as const,
  reason: `the model holds no ${what}`,
});
const ok = (reason: string) => ({ status: "checked" as const, reason });
const na = (reason: string) => ({ status: "not-applicable" as const, reason });

const officeSpaces = (m: SpatialModel) => m.spaces.filter((s) => kindKey(s.kind));

const PRINCIPLES: readonly Principle[] = [
  {
    id: 1,
    name: "Function before form",
    tier: "measurable",
    decide: (p) =>
      p.hasItems
        ? ok("the model places items, so a room's contents can be judged")
        : need("placed items to judge what each room holds"),
    check: (m) => {
      const out: Finding[] = [];
      for (const s of m.spaces) {
        const needs = /(^|\.)(toilet|restroom|wc)$/.test(s.kind)
          ? ["toilet"]
          : /(^|\.)bedroom$/.test(s.kind)
            ? ["bed"]
            : undefined;
        if (needs && !m.items.some((i) => i.spaceId === s.id && needs.includes(i.kind)))
          out.push(finding("function", `"${s.name}" holds none of: ${needs.join(", ")}`, s.id));
      }
      return out;
    },
    source: "the lessons' expected contents",
  },
  {
    id: 2,
    name: "Spatial hierarchy",
    tier: "judgement",
    decide: () => need("brief saying which spaces are primary and which are secondary"),
  },
  {
    id: 3,
    name: "Zoning and spatial organisation",
    tier: "measurable",
    decide: (p, m) =>
      p.buildingType === "office" || officeSpaces(m).length
        ? ok(
            "office rooms have neighbours they want, in the repository's planning rules (within a corridor width)",
          )
        : na("no office rooms; the adjacency rules are for offices"),
    check: (m) => {
      const out: Finding[] = [];
      const spaces = officeSpaces(m);
      // Rooms are usually separated by a corridor, so "next to" means within one corridor width.
      const reach = KNOWLEDGE.circulation.corridorWidthM * 1000 + 200;
      for (const s of spaces) {
        const key = kindKey(s.kind) as RoomKind;
        const wanted = KNOWLEDGE.rooms[key].adjacent;
        if (!wanted.length) continue;
        const near = spaces.some(
          (o) =>
            o.id !== s.id && wanted.includes(kindKey(o.kind) as RoomKind) && gapMm(s, o) <= reach,
        );
        // A rule of thumb about being near, so only a room that touches none of the kinds it wants is mentioned, and only when some exist.
        if (!near && spaces.some((o) => wanted.includes(kindKey(o.kind) as RoomKind)))
          out.push(
            finding(
              "zoning",
              `"${s.name}" is not within ${(reach / 1000).toFixed(1)} m of any of: ${wanted.join(", ")}`,
              s.id,
            ),
          );
      }
      return out;
    },
    source: "knowledge/office.v1.json rooms.*.adjacent (icarus-default)",
  },
  {
    id: 4,
    name: "Human scale and ergonomics",
    tier: "measurable",
    decide: (p) =>
      p.hasDoors ? ok("doors exist, so their clear width can be measured") : need("doors"),
    check: (m) => {
      const min = KNOWLEDGE.circulation.minDoorClearM * 1000;
      return m.openings
        .filter((o) => o.kind === "door" && o.widthMm < min)
        .map((o) =>
          finding(
            "door-width",
            `door ${o.id} is ${o.widthMm} mm wide; the planning floor is ${min} mm clear`,
            o.id,
          ),
        );
    },
    source:
      "knowledge/office.v1.json circulation.minDoorClearM, citing ADA 404.2.3 as a floor (not a compliance claim)",
  },
  {
    id: 5,
    name: "Proportion, balance and scale",
    tier: "measurable",
    decide: (_p, m) =>
      officeSpaces(m).length
        ? ok("rooms of known kinds have minimum sizes and proportions")
        : na("no rooms of a kind the planning rules describe"),
    check: (m) => {
      const out: Finding[] = [];
      for (const s of officeSpaces(m)) {
        const r = KNOWLEDGE.rooms[kindKey(s.kind) as RoomKind];
        const { w, d } = bbox(s);
        const [lo, hi] = [Math.min(w, d), Math.max(w, d)];
        if (lo < Math.min(r.minWidthM, r.minDepthM) * 1000 * r.minScale)
          out.push(
            finding(
              "narrow",
              `"${s.name}" is ${(lo / 1000).toFixed(1)} m across; rooms of this kind usually need ${Math.min(r.minWidthM, r.minDepthM)} m`,
              s.id,
            ),
          );
        else if (hi / lo > r.maxAspect * ASPECT_SLACK)
          out.push(
            finding(
              "elongated",
              `"${s.name}" is ${(hi / lo).toFixed(1)} times longer than wide; the usual limit is ${r.maxAspect} (with ${Math.round((ASPECT_SLACK - 1) * 100)}% allowed)`,
              s.id,
            ),
          );
      }
      return out;
    },
    source:
      "knowledge/office.v1.json rooms.*.minWidthM, minDepthM, maxAspect, minScale (icarus-default)",
  },
  {
    id: 6,
    name: "Natural light and daylight",
    tier: "measurable",
    decide: (p, m) =>
      !p.hasWindows
        ? need("windows to judge daylight")
        : officeSpaces(m).some(
              (s) => KNOWLEDGE.rooms[kindKey(s.kind) as RoomKind].daylight === "required",
            )
          ? ok("some rooms are marked as needing daylight")
          : na("no room of a kind that requires daylight"),
    check: (m) => {
      const out: Finding[] = [];
      const windows = m.openings.filter((o) => o.kind === "window");
      for (const s of officeSpaces(m)) {
        if (KNOWLEDGE.rooms[kindKey(s.kind) as RoomKind].daylight !== "required") continue;
        // A window counts when its centre is within a wall's thickness (plus a little) of the room's boundary.
        const lit = windows.some((o) => {
          const w = m.walls.find((x) => x.id === o.hostWallId);
          if (!w) return false;
          const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
          const t = (o.offsetMm + o.widthMm / 2) / len;
          const px = w.a.x + (w.b.x - w.a.x) * t;
          const py = w.a.y + (w.b.y - w.a.y) * t;
          return ringDistance(s.boundary.outer, px, py) <= w.thicknessMm / 2 + 150;
        });
        if (!lit)
          out.push(
            finding(
              "daylight",
              `"${s.name}" needs daylight and none of the model's windows is in its walls`,
              s.id,
            ),
          );
      }
      return out;
    },
    source: "knowledge/office.v1.json rooms.*.daylight (icarus-default)",
  },
  {
    id: 7,
    name: "Ventilation and air quality",
    tier: "gate",
    decide: () => need("record of which openings open, or any mechanical ventilation"),
  },
  {
    id: 8,
    name: "Climate responsiveness",
    tier: "judgement",
    decide: () => need("location, so no climate"),
  },
  {
    id: 9,
    name: "Resource efficiency and sustainability",
    tier: "judgement",
    decide: () => need("materials, energy or quantities"),
  },
  {
    id: 10,
    name: "Acoustic comfort",
    tier: "judgement",
    decide: () => need("wall constructions or noise sources"),
  },
  {
    id: 11,
    name: "Accessibility and inclusive design",
    tier: "gate",
    decide: (p) =>
      p.hasDoors
        ? ok("doors exist, so their clear width can be measured against the accessible floor")
        : need("doors"),
    check: (m) => {
      const min = KNOWLEDGE.circulation.minDoorClearM * 1000;
      return m.openings
        .filter((o) => o.kind === "door" && o.widthMm < min)
        .map((o) => ({
          ...finding(
            "accessible-door",
            `door ${o.id} is ${o.widthMm} mm wide, under the accessible floor of ${min} mm`,
            o.id,
          ),
          level: "error" as const,
        }));
    },
    source:
      "ADA 2010 404.2.3 as cited in knowledge/office.v1.json; a floor, not a compliance claim, and no jurisdiction is set",
  },
  {
    id: 12,
    name: "Physical and psychological comfort",
    tier: "judgement",
    decide: () => need("temperature, privacy or occupant data"),
  },
  { id: 13, name: "Lighting hierarchy", tier: "judgement", decide: () => need("lighting design") },
  {
    id: 14,
    name: "Material honesty and suitability",
    tier: "judgement",
    decide: () => need("material specifications"),
  },
  {
    id: 15,
    name: "Connection with nature",
    tier: "judgement",
    decide: () => need("client priorities or views"),
  },
  {
    id: 16,
    name: "Structural integrity and safety",
    tier: "gate",
    decide: () =>
      need("loads, structure or fire strategy; concept output is never evidence of safety"),
  },
  {
    id: 17,
    name: "Building systems integration",
    tier: "judgement",
    decide: () => need("services or ceiling zones"),
  },
  {
    id: 18,
    name: "Contextual sensitivity",
    tier: "judgement",
    decide: () => need("site, location or neighbourhood"),
  },
  {
    id: 19,
    name: "Flexibility and adaptability",
    tier: "judgement",
    decide: () => need("a brief about future change"),
  },
  {
    id: 20,
    name: "Durability, maintainability and lifecycle",
    tier: "judgement",
    decide: () => need("materials or a maintenance plan"),
  },
];

export function profileOf(m: SpatialModel): Profile {
  const prefixes = new Set(m.spaces.map((s) => s.kind.split(".")[0]));
  const buildingType =
    prefixes.has("office") && prefixes.has("residential")
      ? "mixed"
      : prefixes.has("office")
        ? "office"
        : prefixes.has("residential")
          ? "residential"
          : "unknown";
  return {
    buildingType,
    levels: m.levels.length,
    spaces: m.spaces.length,
    hasItems: m.items.length > 0,
    hasDoors: m.openings.some((o) => o.kind === "door"),
    hasWindows: m.openings.some((o) => o.kind === "window"),
    hasConnectors: m.connectors.length > 0,
    missing: {
      location: true,
      materials: true,
      services: true,
      loads: true,
      acoustics: true,
      lighting: true,
      brief: true,
    },
  };
}

const TIER_RANK: Record<Tier, number> = { gate: 0, measurable: 1, judgement: 2 };

export interface PrincipleReview {
  profile: Profile;
  decisions: Decision[];
  /** The findings worth saying now: gates first, then errors, then the rest, capped at `limit`. */
  top: Finding[];
  /** How many findings were held back, so nothing is hidden silently. */
  heldBack: number;
  note: string;
}

export function reviewAgainstPrinciples(m: SpatialModel, limit = 6): PrincipleReview {
  const profile = profileOf(m);
  const decisions: Decision[] = PRINCIPLES.map((p) => {
    const d = p.decide(profile, m);
    const findings = d.status === "checked" && p.check ? p.check(m) : [];
    return {
      principle: p.id,
      name: p.name,
      tier: p.tier,
      status: d.status,
      reason: d.reason,
      ...(p.source ? { source: p.source } : {}),
      findings,
    };
  });
  const all = decisions.flatMap((d) => d.findings.map((f) => ({ f, tier: TIER_RANK[d.tier] })));
  all.sort(
    (a, b) => a.tier - b.tier || (a.f.level === b.f.level ? 0 : a.f.level === "error" ? -1 : 1),
  );
  const top = all.slice(0, limit).map((x) => x.f);
  return {
    profile,
    decisions,
    top,
    heldBack: Math.max(0, all.length - top.length),
    note: "Concept-stage checks from the repository's own planning rules. Not a building-code or safety assessment.",
  };
}
