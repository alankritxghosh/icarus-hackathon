import { z } from "zod";
import type { MeasuredColours } from "./colour";
import { type Assumption, type Program, ProgramSchema, type RoomRequest } from "./program";
import { FLOORS, StyleSchema } from "./style";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * What a vision model reports about one photograph of an office. It describes only what is visible;
 * it is never asked for coordinates or dimensions, because one photo cannot give them.
 */
export const PhotoReadSchema = z.object({
  spaceKind: z.enum(["open_plan", "cubicles", "lounge", "meeting", "reception", "mixed"]),
  /** Workstations (desk positions) visible in the photo. */
  seatsVisible: z.int().min(0).max(200),
  /** Best guess of how many people the whole space serves. */
  estimatedHeadcount: z.int().min(2).max(300),
  zones: z
    .array(
      z.enum([
        "open_workspace",
        "meeting_room",
        "lounge",
        "kitchen",
        "reception",
        "phone_booth",
        "private_office",
        "storage",
      ]),
    )
    .max(8),
  windows: z.enum(["none", "some", "wall_of_glass"]),
  ceiling: z.enum(["low", "standard", "high_exposed"]),
  floor: z.enum(FLOORS),
  /** The dominant colour of chairs and soft furnishings, as #rrggbb. */
  accentColor: hex,
  wallColor: hex,
  mood: z.string().max(120),
  notes: z.array(z.string().max(160)).max(6),
});
export type PhotoRead = z.infer<typeof PhotoReadSchema>;

export interface FromPhoto {
  program: Program;
  /** Each fact taken from the photo or assumed, one sentence. */
  notes: string[];
}

const ROOM_BY_ZONE: Partial<Record<PhotoRead["zones"][number], RoomRequest["kind"]>> = {
  meeting_room: "meeting_room",
  lounge: "lounge",
  kitchen: "kitchen",
  reception: "reception",
  private_office: "private_office",
  storage: "storage",
};

/**
 * Turn a photo reading into an office program in the house style adjusted to what was seen. Sizes
 * come from the headcount (about 12 m2 a person here) because the photo cannot give them, and that is
 * recorded as an assumption instead of being presented as measured.
 */
export function programFromPhoto(read: PhotoRead, measured: MeasuredColours = {}): FromPhoto {
  const assumptions: Assumption[] = [];
  const say = (
    topic: string,
    statement: string,
    source: Assumption["source"],
    confidence: number,
  ) => assumptions.push({ topic, statement, source, confidence });

  // One photo shows part of a space, so the count seen is a floor, not the answer.
  const headcount = Math.min(300, Math.max(16, read.estimatedHeadcount, read.seatsVisible * 3));
  say(
    "headcount",
    `About ${headcount} people. ${read.seatsVisible} workstations are visible, but a photo shows only part of a space, so at least 16 are assumed.`,
    "model",
    0.4,
  );

  // More generous than the 9.5 m2 a person of a typed brief: a photo says nothing about space, and a cramped plan is worse than a roomy one.
  const area = headcount * 12;
  const widthM = Math.max(8, Math.round(Math.sqrt(area * 1.5) * 2) / 2);
  const depthM = Math.max(8, Math.round((area / widthM) * 2) / 2);
  say(
    "shell",
    `A ${widthM} by ${depthM} m shell assumed: a photograph gives no dimensions.`,
    "catalog",
    0.3,
  );

  const windows =
    read.windows === "none"
      ? []
      : read.windows === "wall_of_glass"
        ? (["south", "east"] as const)
        : (["south"] as const);
  say(
    "windows",
    read.windows === "none"
      ? "No windows are visible."
      : `Windows: ${read.windows.replace(/_/g, " ")}.`,
    "model",
    0.6,
  );

  const rooms: RoomRequest[] = [{ kind: "open_workspace", count: 1 }];
  const zones = new Set(read.zones);
  for (const [zone, kind] of Object.entries(ROOM_BY_ZONE) as [
    PhotoRead["zones"][number],
    RoomRequest["kind"],
  ][])
    if (zones.has(zone))
      rooms.push({
        kind,
        count: kind === "meeting_room" ? Math.max(1, Math.round(headcount / 12)) : 1,
      });
  if (!rooms.some((r) => r.kind === "meeting_room")) {
    rooms.push({ kind: "meeting_room", count: Math.max(1, Math.round(headcount / 15)) });
    say(
      "meeting rooms",
      "No meeting room was visible; some are added so the office is usable.",
      "catalog",
      0.3,
    );
  }
  rooms.push({ kind: "restroom", count: headcount >= 15 ? 2 : 1 });
  say("restrooms", "Restrooms are not visible in photos and are added.", "catalog", 0.3);
  const seen = [...zones].filter((z) => z !== "phone_booth");
  say(
    "rooms",
    seen.length
      ? `Spaces seen: ${seen.map((z) => z.replace(/_/g, " ")).join(", ")}.`
      : "Only open workspace is visible.",
    "model",
    0.7,
  );

  if (read.spaceKind === "cubicles")
    say(
      "desks",
      "The photo shows cubicles; Icarus builds open benches, so the partitions are not reproduced.",
      "catalog",
      0.9,
    );
  const accent = measured.accent ?? read.accentColor;
  const walls = measured.wall ?? read.wallColor;
  const style = StyleSchema.parse({
    floor: read.floor,
    floorColor: measured.floor,
    accent,
    walls,
    ceiling: read.ceiling === "high_exposed" ? "exposed_dark" : "white",
  });
  say(
    "style",
    `${read.mood}. Floor ${read.floor.replace(/_/g, " ")}, accent ${read.accentColor}, ${read.ceiling.replace(/_/g, " ")} ceiling.`,
    "model",
    0.7,
  );

  const program = ProgramSchema.parse({
    company: { headcount },
    shell: {
      widthM,
      depthM,
      windows: [...windows],
      entrance: "west",
      ceilingM: read.ceiling === "low" ? 2.6 : read.ceiling === "high_exposed" ? 3.4 : 2.9,
    },
    rooms,
    phoneBooths: zones.has("phone_booth") ? Math.max(1, Math.round(headcount / 15)) : 0,
    assumptions,
    style,
  });
  return { program, notes: assumptions.map((a) => a.statement) };
}

/** The instructions that go with `PhotoReadSchema`. Kept here so the contract and its prompt change together. */
export const PHOTO_READ_INSTRUCTIONS = `You describe a photograph of an office interior for a design tool. Report only what is plainly visible and be conservative.
Field rules:
- seatsVisible: count desk positions with a chair that you can see. Count carefully.
- estimatedHeadcount: at least twice seatsVisible, because most of the space is out of frame.
- zones: only spaces you can see. Use open_workspace if there are desks. Use lounge only if there are sofas, armchairs or a coffee table. Use reception only if there is a front desk. Use meeting_room only if there is an enclosed room or a meeting table. Use phone_booth only for a small enclosed booth. Never guess spaces that are not visible.
- windows: wall_of_glass if one wall is mostly glass, some if a few windows are visible, none only if no window is visible.
- ceiling: high_exposed if you can see pipes, ducts, a dark ceiling or no ceiling tiles; low if it is plain and low; otherwise standard.
- floor: the closest match: oak (medium warm wood), light_oak (pale wood), dark_wood, concrete, carpet_grey, patterned_carpet, tile.
- accentColor: the main colour of chairs, sofas or partitions as #rrggbb. Ignore walls, floor and plants. If they are black or grey, give that grey or black.
- wallColor: the main wall colour as #rrggbb.
- spaceKind: cubicles only if desks are enclosed by tall partitions.
- mood: a short phrase.`;
