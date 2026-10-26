import type { EvidenceItem } from "../evidence";
import type { FurnishReport } from "./kits";

/** What furnishing achieved, stated with the numbers, so a shortfall is visible and not hidden. */
export function furnishingEvidence(report: FurnishReport): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const short = report.seatsPlaced < report.seatsWanted;
  items.push({
    id: "furnish.desks",
    label: "Desks",
    status: short ? (report.seatsPlaced >= report.seatsWanted * 0.9 ? "warn" : "fail") : "ok",
    detail: short
      ? `${report.seatsPlaced} of ${report.seatsWanted} workstations fit with aisles. The rest need a larger workspace or fewer meeting rooms.`
      : `${report.seatsPlaced} workstations, back to back in pairs with 1.1 m or more between chairs.`,
    measured: report.seatsPlaced,
    unit: "desks",
  });
  if (report.phoneBoothsWanted > 0)
    items.push({
      id: "furnish.booths",
      label: "Phone booths",
      status: report.phoneBoothsPlaced >= report.phoneBoothsWanted ? "ok" : "warn",
      detail: `${report.phoneBoothsPlaced} of ${report.phoneBoothsWanted} placed along the workspace walls.`,
    });
  if (report.meetingSeatsWanted > 0)
    items.push({
      id: "furnish.meeting",
      label: "Meeting seats",
      status: report.meetingSeatsPlaced >= report.meetingSeatsWanted ? "ok" : "warn",
      detail: `${report.meetingSeatsPlaced} of ${report.meetingSeatsWanted} chairs fit around the tables.`,
    });
  return items;
}
