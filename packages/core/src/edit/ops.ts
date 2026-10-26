import { z } from "zod";

const Room = z.string().min(1).max(60);
const Side = z.enum(["north", "south", "east", "west"]);

/**
 * The only changes a spoken or typed instruction may make. The set is closed: it moves, swaps and
 * locks rooms that already exist and changes the number of phone booths. It cannot add or remove
 * rooms, resize the shell or change the headcount. Each operation is measured before it is kept.
 */
export const EditOpSchema = z.discriminatedUnion("op", [
  /** Put a room in the north, south, east or west part of the shell. */
  z.object({ op: z.literal("move_room"), room: Room, to: Side }),
  /** Exchange the positions of two rooms. */
  z.object({ op: z.literal("swap_rooms"), a: Room, b: Room }),
  z.object({ op: z.literal("add_phone_booths"), count: z.int().min(1).max(6) }),
  z.object({ op: z.literal("remove_phone_booths"), count: z.int().min(1).max(6) }),
  /** Keep a room where it is while other things change. */
  z.object({ op: z.literal("lock_room"), room: Room }),
  /** Release one room, or every room with "all". */
  z.object({ op: z.literal("unlock_room"), room: Room }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

export const EditSchema = z.object({
  ops: z.array(EditOpSchema).max(4),
  /** Set when the request cannot be said in these operations, so the user is told rather than guessed at. */
  unsupported: z.string().max(200).optional(),
});
export type Edit = z.infer<typeof EditSchema>;

/** A worked answer used in prompts; a test checks it parses, so it cannot drift from the schema. */
export const EDIT_EXAMPLE: Edit = {
  ops: [
    { op: "move_room", room: "kitchen", to: "east" },
    { op: "add_phone_booths", count: 1 },
  ],
};
