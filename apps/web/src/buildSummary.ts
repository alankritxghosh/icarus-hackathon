import type { Built } from "./design";

const plural = (n: number, singular: string, many = `${singular}s`) =>
  `${n} ${n === 1 ? singular : many}`;

/** A short account of the finished office, using the built plan and placed furniture. */
export function buildSummary(built: Built): string[] {
  const counts = new Map<string, number>();
  for (const room of built.plan.rooms) counts.set(room.kind, (counts.get(room.kind) ?? 0) + 1);
  const kinds = [
    ...new Set([
      ...built.program.rooms.map((room) => room.kind),
      ...built.plan.rooms.map((room) => room.kind),
    ]),
  ];
  const rooms = kinds
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const count = counts.get(kind) as number;
      const label = kind.replaceAll("_", " ");
      return count === 1 ? label : plural(count, label);
    });
  const lines = [`Rooms: ${rooms.join(", ")}.`];
  const {
    seatsPlaced,
    seatsWanted,
    privateDesksPlaced,
    privateDesksWanted,
    phoneBoothsPlaced,
    phoneBoothsWanted,
  } = built.report;
  const desksPlaced = seatsPlaced + privateDesksPlaced;
  const desksWanted = seatsWanted + privateDesksWanted;
  lines.push(
    `${desksPlaced} of ${desksWanted} workstations and ${phoneBoothsPlaced} of ${phoneBoothsWanted} phone booths fit.`,
  );
  const missing = [
    desksWanted > desksPlaced ? plural(desksWanted - desksPlaced, "workstation") : undefined,
    phoneBoothsWanted > phoneBoothsPlaced
      ? plural(phoneBoothsWanted - phoneBoothsPlaced, "phone booth")
      : undefined,
  ].filter(Boolean);
  if (missing.length) lines.push(`Still missing: ${missing.join(" and ")}.`);
  return lines;
}
