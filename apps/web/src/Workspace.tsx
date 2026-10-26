import { useEffect, useRef, useState } from "react";
import type { Built } from "./design";
import { STAGES } from "./design";
import { EditPanel } from "./EditPanel";
import { OfficeView, type ViewMode } from "./officeView";
import { Prompt } from "./Prompt";

interface Props {
  brief: string;
  /** Index of the stage being worked on while building; undefined once built. */
  stage?: number;
  built?: Built;
  canUndo: boolean;
  onUndo: () => void;
  onStop: () => void;
  onBuild: (brief: string) => void;
  onApplyEdit: (built: Built, program: Built["program"], seed: number) => void;
  onAnother: () => void;
}

export function Workspace({
  brief,
  stage,
  built,
  canUndo,
  onUndo,
  onStop,
  onBuild,
  onApplyEdit,
  onAnother,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OfficeView>(null);
  const [mode, setMode] = useState<ViewMode>("orbit");
  const [ceiling, setCeiling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const building = stage !== undefined;

  useEffect(() => {
    if (!host.current) return;
    const v = new OfficeView(host.current);
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    if (built) view.current?.setScene(built.scene);
  }, [built]);
  useEffect(() => view.current?.setMode(mode), [mode]);
  useEffect(() => view.current?.setCeiling(ceiling), [ceiling]);

  const problems = built?.evidence.filter((e) => e.status === "fail" || e.status === "warn") ?? [];
  const shown = built
    ? [...problems, ...built.evidence.filter((e) => e.status !== "fail" && e.status !== "warn")]
    : [];

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>{building ? "Building" : "Built"}</h1>
          <p>{brief.length > 90 ? `${brief.slice(0, 90)}…` : brief}</p>
        </div>
      </header>
      <div className="columns">
        <section className="side">
          {editing && built ? (
            <EditPanel
              program={built.program}
              seed={built.seed}
              onBack={() => setEditing(false)}
              onApply={(program, seed) => {
                setEditing(false);
                onApplyEdit(built, program, seed);
              }}
            />
          ) : (
            <>
              <p className="eyebrow">{building ? "BUILD IN PROGRESS" : "BUILD COMPLETE"}</p>
              <h2 className="title">{brief.split(/[.!?]/)[0]}</h2>
              {building ? (
                <ol className="steps" aria-live="polite">
                  {STAGES.map((label, i) => (
                    <li key={label} className={i < stage ? "done" : i === stage ? "now" : ""}>
                      <span aria-hidden="true">{i < stage ? "✓" : i === stage ? "↳" : ""}</span>
                      {label}
                    </li>
                  ))}
                </ol>
              ) : (
                built && (
                  <>
                    <p className="summary">
                      {built.plan.rooms.length} rooms on {built.plan.shell.w} × {built.plan.shell.h}{" "}
                      m, planned in {built.plannedMs} ms.
                    </p>
                    <div className="panel-card">
                      <p className="eyebrow">WHAT WAS MEASURED</p>
                      <ul className="evidence">
                        {shown.slice(0, 7).map((e) => (
                          <li key={e.id} className={e.status}>
                            <b>{e.label}</b>
                            <span>{e.detail}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setShowAssumptions((s) => !s)}
                      >
                        {showAssumptions ? "▾" : "▸"} What we assumed ({built.notes.length})
                      </button>
                      {showAssumptions && (
                        <ul className="notes">
                          {built.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="actions">
                      <button type="button" className="ghost" disabled={!canUndo} onClick={onUndo}>
                        ↶ Undo this change
                      </button>
                      <button type="button" className="primary" onClick={onAnother}>
                        Another layout
                      </button>
                      <button type="button" onClick={() => setEditing(true)}>
                        Edit
                      </button>
                    </div>
                  </>
                )
              )}
            </>
          )}
          <div className="bottom">
            {building && (
              <button type="button" className="stop" onClick={onStop}>
                ▢ Stop build
              </button>
            )}
            <Prompt
              compact
              placeholder="Describe a different office…"
              hint="Stop to type"
              disabled={building}
              onBuild={onBuild}
            />
          </div>
        </section>
        <section className="stage" aria-label="Your office">
          <div className="stage-head">
            <span className="eyebrow">{building ? "OFFICE / BUILDING" : "OFFICE / READY"}</span>
            <small>Drag to orbit · Scroll to zoom</small>
          </div>
          <div className="canvas" ref={host} data-testid="canvas" />
          {building && (
            <div className="working" role="status">
              <span /> {STAGES[stage]}…
            </div>
          )}
          <div className="stage-controls">
            <button type="button" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>
              Floor plan
            </button>
            <button type="button" aria-pressed={mode === "orbit"} onClick={() => setMode("orbit")}>
              3D view
            </button>
            <button type="button" aria-pressed={ceiling} onClick={() => setCeiling((c) => !c)}>
              Ceiling
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
