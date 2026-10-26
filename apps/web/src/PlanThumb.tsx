import type { FloorPlan, RoomKind } from "@icarus/core";

const FILL: Record<RoomKind, string> = {
  open_workspace: "#1c2a24",
  meeting_room: "#1f4a38",
  private_office: "#1f4a38",
  kitchen: "#3b3a24",
  lounge: "#2c3d2f",
  reception: "#2f5a46",
  storage: "#232b27",
  server_room: "#232b27",
  restroom: "#26322d",
};

/** A small line drawing of a plan, used for cards and the sidebar. */
export function PlanThumb({ plan }: { plan: FloorPlan }) {
  const { w, h } = plan.shell;
  return (
    <svg viewBox={`-0.4 -0.4 ${w + 0.8} ${h + 0.8}`} role="img" aria-label="Floor plan preview">
      <rect x={0} y={0} width={w} height={h} fill="#0f1714" stroke="#426253" strokeWidth={0.3} />
      {plan.rooms.map((room) => (
        <rect
          key={room.id}
          x={room.rect.x}
          y={room.rect.y}
          width={room.rect.w}
          height={room.rect.h}
          fill={FILL[room.kind]}
          stroke="#0c110f"
          strokeWidth={0.18}
        />
      ))}
    </svg>
  );
}
