import type { RoomTrace } from "@icarus/spatial/model";
import { useEffect, useRef, useState } from "react";
import type { PlanReference } from "./drawingDesign";

interface Props {
  plans: PlanReference[];
  traces: RoomTrace[];
  onTrace: (trace: RoomTrace) => boolean;
  onUndo: () => void;
}

type Point = { x: number; y: number };
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function PlanTracer({ plans, traces, onTrace, onUndo }: Props) {
  const [level, setLevel] = useState(plans.at(-1)?.levelId);
  const plan = plans.find((item) => item.levelId === level) ?? plans.at(-1);
  const host = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const start = useRef<Point | undefined>(undefined);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [draft, setDraft] = useState<{ a: Point; b: Point }>();
  const [unnamed, setUnnamed] = useState<{ a: Point; b: Point }>();
  const [name, setName] = useState("");
  const [hint, setHint] = useState("Drag around a room to build it");

  useEffect(() => {
    if (!host.current || !plan) return;
    const measure = () => {
      const box = host.current?.getBoundingClientRect();
      if (!box) return;
      const scale = Math.min(box.width / plan.pageWidth, box.height / plan.pageHeight);
      setSize({ w: plan.pageWidth * scale, h: plan.pageHeight * scale });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host.current);
    measure();
    return () => observer.disconnect();
  }, [plan]);

  if (!plan) return null;
  const point = (event: React.PointerEvent): Point => {
    const box = sheet.current?.getBoundingClientRect();
    return box
      ? {
          x: clamp((event.clientX - box.left) / box.width),
          y: clamp((event.clientY - box.top) / box.height),
        }
      : { x: 0, y: 0 };
  };
  const toMm = (p: Point): Point => ({
    x: p.x * plan.pageWidth * plan.unitMm + plan.offsetMm[0],
    y: p.y * plan.pageHeight * plan.unitMm + plan.offsetMm[1],
  });
  const fromMm = (x: number, y: number): Point => ({
    x: (x - plan.offsetMm[0]) / plan.unitMm / plan.pageWidth,
    y: (y - plan.offsetMm[1]) / plan.unitMm / plan.pageHeight,
  });
  const rectangle = (a: Point, b: Point) => ({
    left: `${Math.min(a.x, b.x) * 100}%`,
    top: `${Math.min(a.y, b.y) * 100}%`,
    width: `${Math.abs(a.x - b.x) * 100}%`,
    height: `${Math.abs(a.y - b.y) * 100}%`,
  });
  const end = (event: React.PointerEvent) => {
    if (!start.current) return;
    const a = start.current;
    const b = point(event);
    start.current = undefined;
    setDraft(undefined);
    if (Math.abs(a.x - b.x) < 0.012 || Math.abs(a.y - b.y) < 0.012) return;
    const x0 = Math.min(a.x, b.x),
      x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y),
      y1 = Math.max(a.y, b.y);
    const labels = plan.labels.filter(
      (label) => label.x >= x0 && label.x <= x1 && label.y >= y0 && label.y <= y1,
    );
    const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    const label = labels.sort(
      (p, q) =>
        Math.hypot(p.x - centre.x, p.y - centre.y) - Math.hypot(q.x - centre.x, q.y - centre.y),
    )[0];
    if (!label) {
      setUnnamed({ a: { x: x0, y: y0 }, b: { x: x1, y: y1 } });
      setName("");
      setHint("Name this space to add it");
      return;
    }
    const lo = toMm({ x: x0, y: y0 });
    const hi = toMm({ x: x1, y: y1 });
    const added = onTrace({
      id: label.id,
      levelId: plan.levelId,
      name: label.name,
      rect: [lo.x, lo.y, hi.x, hi.y],
    });
    setHint(
      added
        ? `${label.name} added. Drag around another room.`
        : "Make the outline at least 0.5 m wide and tall.",
    );
  };
  const addUnnamed = () => {
    if (!unnamed || !name.trim()) return;
    const lo = toMm(unnamed.a);
    const hi = toMm(unnamed.b);
    const added = onTrace({
      id: crypto.randomUUID(),
      levelId: plan.levelId,
      name: name.trim(),
      rect: [lo.x, lo.y, hi.x, hi.y],
    });
    if (added) {
      setUnnamed(undefined);
      setName("");
      setHint(`${name.trim()} added. Drag around another space.`);
    } else setHint("Make the outline at least 0.5 m wide and tall.");
  };
  return (
    <div className="plan-review" ref={host}>
      <div className="plan-review-head">
        <fieldset className="plan-levels">
          <legend className="sr">Floor</legend>
          {plans.map((item) => (
            <button
              key={item.levelId}
              type="button"
              className={plan.levelId === item.levelId ? "on" : ""}
              onClick={() => {
                setLevel(item.levelId);
                setHint("Drag around a room to build it");
              }}
            >
              {item.name}
            </button>
          ))}
        </fieldset>
        {traces.length > 0 && (
          <button type="button" className="plan-undo" onClick={onUndo}>
            Undo room
          </button>
        )}
      </div>
      <div
        className="plan-sheet"
        ref={sheet}
        style={{ width: size.w, height: size.h }}
        onPointerDown={(event) => {
          start.current = point(event);
          setDraft({ a: start.current, b: start.current });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (start.current) setDraft({ a: start.current, b: point(event) });
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = undefined;
          setDraft(undefined);
        }}
      >
        <img src={plan.image} alt={`${plan.name} source floor plan`} draggable={false} />
        {traces
          .filter((trace) => trace.levelId === plan.levelId)
          .map((trace) => {
            const a = fromMm(trace.rect[0], trace.rect[1]);
            const b = fromMm(trace.rect[2], trace.rect[3]);
            return (
              <div key={trace.id} className="plan-traced" style={rectangle(a, b)}>
                <span>{trace.name}</span>
              </div>
            );
          })}
        {draft && <div className="plan-draft" style={rectangle(draft.a, draft.b)} />}
        {unnamed && <div className="plan-draft" style={rectangle(unnamed.a, unnamed.b)} />}
      </div>
      {unnamed ? (
        <div className="plan-name-space">
          <input
            aria-label="Space name"
            placeholder="Space name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addUnnamed();
            }}
          />
          <button type="button" onClick={addUnnamed} disabled={!name.trim()}>
            Add space
          </button>
          <button type="button" onClick={() => setUnnamed(undefined)}>
            Cancel
          </button>
        </div>
      ) : (
        <p className="plan-hint" role="status">
          {hint}
        </p>
      )}
    </div>
  );
}
