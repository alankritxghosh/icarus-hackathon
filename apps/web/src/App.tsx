import {
  buildShell,
  type EvidenceItem,
  type FloorPlan,
  layoutOffice,
  measurePlan,
  type Program,
  ProgramSchema,
  type Scene,
  type Side,
} from "@icarus/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { OfficeView, type ViewMode } from "./officeView";

interface Form {
  headcount: number;
  width: number;
  depth: number;
  ceiling: number;
  windows: Record<Side, boolean>;
  entrance: Side;
  meetingRooms: number;
  meetingCapacity: number;
  privateOffices: number;
  phoneBooths: number;
  restrooms: number;
  kitchen: boolean;
  lounge: boolean;
  reception: boolean;
  storage: boolean;
  server: boolean;
  seed: number;
}

const DEMO: Form = {
  headcount: 35,
  width: 24,
  depth: 16,
  ceiling: 2.9,
  windows: { north: false, south: true, east: true, west: false },
  entrance: "west",
  meetingRooms: 3,
  meetingCapacity: 6,
  privateOffices: 0,
  phoneBooths: 2,
  restrooms: 2,
  kitchen: true,
  lounge: true,
  reception: true,
  storage: true,
  server: true,
  seed: 1,
};

function toProgram(f: Form) {
  const rooms: unknown[] = [{ kind: "open_workspace" }];
  if (f.meetingRooms > 0)
    rooms.push({ kind: "meeting_room", count: f.meetingRooms, capacity: f.meetingCapacity });
  if (f.privateOffices > 0) rooms.push({ kind: "private_office", count: f.privateOffices });
  if (f.kitchen) rooms.push({ kind: "kitchen" });
  if (f.lounge) rooms.push({ kind: "lounge" });
  if (f.reception) rooms.push({ kind: "reception" });
  if (f.storage) rooms.push({ kind: "storage" });
  if (f.server) rooms.push({ kind: "server_room" });
  if (f.restrooms > 0) rooms.push({ kind: "restroom", count: f.restrooms });
  return ProgramSchema.safeParse({
    company: { headcount: f.headcount },
    shell: {
      widthM: f.width,
      depthM: f.depth,
      ceilingM: f.ceiling,
      windows: (Object.keys(f.windows) as Side[]).filter((s) => f.windows[s]),
      entrance: f.entrance,
    },
    rooms,
    phoneBooths: f.phoneBooths,
  });
}

interface Result {
  program: Program;
  plan: FloorPlan;
  scene: Scene;
  evidence: EvidenceItem[];
  ms: number;
}

export function App() {
  const [form, setForm] = useState<Form>(DEMO);
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("orbit");
  const [ceiling, setCeiling] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OfficeView>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new OfficeView(host.current);
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
  }, []);

  const generate = useCallback((f: Form) => {
    const parsed = toProgram(f);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    setError(undefined);
    setBusy(true);
    // Let the "Planning" state paint before the search blocks the thread.
    setTimeout(() => {
      const t = performance.now();
      const plan = layoutOffice(parsed.data, { seed: f.seed });
      setResult({
        program: parsed.data,
        plan,
        scene: buildShell(plan),
        evidence: measurePlan(plan, parsed.data),
        ms: Math.round(performance.now() - t),
      });
      setBusy(false);
    }, 30);
  }, []);

  useEffect(() => {
    generate(DEMO);
  }, [generate]);
  useEffect(() => {
    if (result) view.current?.setScene(result.scene);
  }, [result]);
  useEffect(() => view.current?.setMode(mode), [mode]);
  useEffect(() => view.current?.setCeiling(ceiling), [ceiling]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const num = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(key, Number(e.target.value) as never);

  return (
    <div className="app">
      <header>
        <strong>Icarus</strong>
        <span>Design a whole office from scratch. Concept design only.</span>
      </header>
      <aside className="panel">
        <h2>The company</h2>
        <label>
          People
          <input
            type="number"
            min={2}
            max={500}
            value={form.headcount}
            onChange={num("headcount")}
          />
        </label>
        <h2>The shell</h2>
        <div className="row">
          <label>
            Width m
            <input type="number" min={6} max={80} value={form.width} onChange={num("width")} />
          </label>
          <label>
            Depth m
            <input type="number" min={6} max={80} value={form.depth} onChange={num("depth")} />
          </label>
          <label>
            Ceiling m
            <input
              type="number"
              step={0.1}
              min={2.4}
              max={6}
              value={form.ceiling}
              onChange={num("ceiling")}
            />
          </label>
        </div>
        <label>
          Entrance wall
          <select value={form.entrance} onChange={(e) => set("entrance", e.target.value as Side)}>
            {(["north", "south", "east", "west"] as Side[]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Windows on</legend>
          {(["north", "south", "east", "west"] as Side[]).map((s) => (
            <label key={s} className="check">
              <input
                type="checkbox"
                checked={form.windows[s]}
                onChange={(e) => set("windows", { ...form.windows, [s]: e.target.checked })}
              />
              {s}
            </label>
          ))}
        </fieldset>
        <h2>The rooms</h2>
        <div className="row">
          <label>
            Meeting rooms
            <input
              type="number"
              min={0}
              max={8}
              value={form.meetingRooms}
              onChange={num("meetingRooms")}
            />
          </label>
          <label>
            Seats each
            <input
              type="number"
              min={2}
              max={20}
              value={form.meetingCapacity}
              onChange={num("meetingCapacity")}
            />
          </label>
        </div>
        <div className="row">
          <label>
            Private offices
            <input
              type="number"
              min={0}
              max={8}
              value={form.privateOffices}
              onChange={num("privateOffices")}
            />
          </label>
          <label>
            Phone booths
            <input
              type="number"
              min={0}
              max={8}
              value={form.phoneBooths}
              onChange={num("phoneBooths")}
            />
          </label>
          <label>
            Restrooms
            <input
              type="number"
              min={1}
              max={4}
              value={form.restrooms}
              onChange={num("restrooms")}
            />
          </label>
        </div>
        {(["kitchen", "lounge", "reception", "storage", "server"] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
            {k === "server" ? "server room" : k}
          </label>
        ))}
        <div className="row">
          <label>
            Seed
            <input type="number" value={form.seed} onChange={num("seed")} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => generate(form)}>
            {busy ? "Planning…" : "Design the office"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = { ...form, seed: form.seed + 1 };
              setForm(next);
              generate(next);
            }}
          >
            Another layout
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </aside>
      <main>
        <div className="toolbar">
          <button type="button" aria-pressed={mode === "orbit"} onClick={() => setMode("orbit")}>
            3D
          </button>
          <button type="button" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>
            Plan
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={ceiling}
              onChange={(e) => setCeiling(e.target.checked)}
            />
            Ceiling
          </label>
          {result && (
            <span className="meta">
              {result.plan.rooms.length} rooms · planned in {result.ms} ms
            </span>
          )}
        </div>
        <div className="canvas" ref={host} data-testid="canvas" />
      </main>
      <aside className="panel evidence">
        <h2>What was measured</h2>
        {result?.evidence.map((item) => (
          <div key={item.id} className={`item ${item.status}`}>
            <b>{item.label}</b>
            <p>{item.detail}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}
