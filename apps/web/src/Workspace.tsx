import { type Suggestion, type Viewpoint, viewpoints } from "@icarus/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { DesignTrace } from "./DesignTrace";
import type { Built, EditEntry } from "./design";
import { EditBox } from "./EditBox";
import { EditPanel } from "./EditPanel";
import { OfficeView, type ViewMode } from "./officeView";
import { Prompt } from "./Prompt";
import { downscale } from "./photo";
import type { Reference } from "./references";
import { type MadeReal, makeItReal, RenderError, renderPrompt } from "./render";

interface Props {
  brief: string;
  /** Live lines from the repair loop while it runs. */
  progress?: string[];
  onApplySuggestion?: (suggestion: Suggestion) => void;
  /** Stage names for this kind of build, in order. */
  stages: readonly string[];
  /** The photograph this office was matched to, if any. */
  reference?: Reference;
  /** Index of the stage being worked on while building; undefined once built. */
  stage?: number;
  built?: Built;
  canUndo: boolean;
  onUndo: () => void;
  onStop: () => void;
  onBuild: (brief: string) => void;
  onApplyEdit: (built: Built, program: Built["program"], seed: number) => void;
  /** Change the design with a typed sentence; resolves with what happened, line by line. */
  onEditWords: (text: string) => Promise<EditEntry>;
  onAnother: () => void;
}

type Picture =
  | { state: "making"; view: string }
  | { state: "done"; view: string; result: MadeReal; seed: number }
  | { state: "error"; view: string; kind: RenderError["kind"]; message: string };

const PICTURE_SIZE = { width: 1024, height: 576 };

export function Workspace({
  brief,
  progress,
  onApplySuggestion,
  stages,
  reference,
  stage,
  built,
  canUndo,
  onUndo,
  onStop,
  onBuild,
  onApplyEdit,
  onEditWords,
  onAnother,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OfficeView>(null);
  const [mode, setMode] = useState<ViewMode>("orbit");
  const [ceiling, setCeiling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [viewId, setViewId] = useState<string>();
  const [picture, setPicture] = useState<Picture>();
  const building = stage !== undefined;

  const views = useMemo(() => (built ? viewpoints(built.plan) : []), [built]);

  useEffect(() => {
    if (!host.current) return;
    const v = new OfficeView(host.current);
    view.current = v;
    // Development only: lets the reconstruction benchmark ask for a snapshot that does not depend on
    // the page painting frames.
    if (import.meta.env.DEV) Object.assign(window, { __icarusView: v });
    return () => {
      v.dispose();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    if (!built) return;
    view.current?.setScene(built.scene);
    view.current?.setLabels(
      built.plan.rooms.map((r) => ({
        name: r.name,
        x: r.rect.x + r.rect.w / 2,
        y: r.rect.y + r.rect.h / 2,
      })),
    );
  }, [built]);
  useEffect(() => {
    if (mode !== "eye") view.current?.setMode(mode);
  }, [mode]);
  useEffect(() => view.current?.setCeiling(ceiling), [ceiling]);

  // A new design means old viewpoints and pictures no longer describe it.
  useEffect(() => {
    if (!built) return;
    setViewId(undefined);
    setPicture(undefined);
    setMode((m) => (m === "eye" ? "orbit" : m));
  }, [built]);

  const stand = (vp: Viewpoint) => {
    setMode("eye");
    setViewId(vp.id);
    view.current?.setViewpoint(vp);
  };

  const makeReal = async (seed: number) => {
    if (!built || views.length === 0) return;
    // Pictures are taken from eye level: stand somewhere good first if we are not inside.
    const current = mode === "eye" ? views.find((v) => v.id === viewId) : undefined;
    const vp = current ?? views.find((v) => v.name === "Open workspace") ?? views[0];
    if (!vp) return;
    if (!current) stand(vp);
    setPicture({ state: "making", view: vp.name });
    try {
      const shot = view.current?.snapshotAt(PICTURE_SIZE.width, PICTURE_SIZE.height);
      if (!shot) throw new RenderError("failed", "The view could not be captured.");
      const styleImage = reference ? await downscale(reference.src, 768) : undefined;
      const result = await makeItReal(
        shot,
        renderPrompt(built, vp.name, Boolean(reference)),
        seed,
        PICTURE_SIZE,
        styleImage,
      );
      setPicture({ state: "done", view: vp.name, result, seed });
    } catch (error) {
      const known = error instanceof RenderError;
      setPicture({
        state: "error",
        view: vp.name,
        kind: known ? error.kind : "failed",
        message: known ? error.message : "The picture could not be made.",
      });
    }
  };

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
                <>
                  <ol className="steps" aria-live="polite">
                    {stages.map((label, i) => (
                      <li key={label} className={i < stage ? "done" : i === stage ? "now" : ""}>
                        <span aria-hidden="true">{i < stage ? "✓" : i === stage ? "↳" : ""}</span>
                        {label}
                      </li>
                    ))}
                  </ol>
                  {progress && progress.length > 0 && (
                    <ul className="progress" aria-live="polite">
                      {progress.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                built && (
                  <>
                    <p className="summary">
                      {built.plan.rooms.length} rooms on {built.plan.shell.w} × {built.plan.shell.h}{" "}
                      m, designed in {(built.plannedMs / 1000).toFixed(1)} s.
                    </p>
                    <div className="actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={picture?.state === "making"}
                        onClick={() => void makeReal(7)}
                      >
                        ✦ Make it real
                      </button>
                      <button type="button" onClick={() => setEditing(true)}>
                        Edit
                      </button>
                    </div>
                    <EditBox
                      locked={built.program.locks.map((l) => ({
                        id: l.id,
                        name: built.plan.rooms.find((r) => r.id === l.id)?.name ?? l.id,
                      }))}
                      onSubmit={onEditWords}
                      onUnlock={(id) => void onEditWords(`unlock ${id}`)}
                    />
                    {reference && (
                      <div className="reference">
                        <p className="eyebrow">STYLE TAKEN FROM THIS PHOTO</p>
                        <img src={reference.src} alt={reference.title} />
                        <small>{reference.credit}</small>
                      </div>
                    )}
                    {built.trace && onApplySuggestion && (
                      <DesignTrace trace={built.trace} onApply={onApplySuggestion} />
                    )}
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
                      <button
                        type="button"
                        onClick={onAnother}
                        title="Searches for a new arrangement. Moves and locks made in words are cleared; Undo brings them back."
                      >
                        Another layout
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
            <small>
              {mode === "eye"
                ? "Drag to look · Arrow keys or WASD to walk"
                : "Drag to orbit · Scroll to zoom"}
            </small>
          </div>
          <div className="canvas" ref={host} data-testid="canvas" />
          {building && (
            <div className="working" role="status">
              <span /> {stages[stage]}…
            </div>
          )}
          {!building && mode === "eye" && (
            <fieldset className="views" aria-label="Where to stand">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={viewId === v.id}
                  onClick={() => stand(v)}
                >
                  {v.name}
                </button>
              ))}
            </fieldset>
          )}
          <div className="stage-controls">
            <button type="button" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}>
              Floor plan
            </button>
            <button type="button" aria-pressed={mode === "orbit"} onClick={() => setMode("orbit")}>
              3D view
            </button>
            <button
              type="button"
              aria-pressed={mode === "eye"}
              disabled={building || views.length === 0}
              onClick={() => {
                const first = views.find((v) => v.name === "Open workspace") ?? views[0];
                if (first) stand(first);
              }}
            >
              Walk in
            </button>
            {mode === "orbit" && (
              <button type="button" aria-pressed={ceiling} onClick={() => setCeiling((c) => !c)}>
                Ceiling
              </button>
            )}
          </div>
          {picture && (
            <div className="picture" role="dialog" aria-label="Picture of your office">
              {picture.state === "making" && (
                <div className="picture-body">
                  <div className="working inline" role="status">
                    <span /> Making the {picture.view.toLowerCase()} real… about 15 seconds
                  </div>
                </div>
              )}
              {picture.state === "error" && (
                <div className="picture-body">
                  <p className="error" role="alert">
                    {picture.message}
                  </p>
                  <div className="actions">
                    {picture.kind !== "limit" && (
                      <button type="button" className="primary" onClick={() => void makeReal(7)}>
                        Try again
                      </button>
                    )}
                    <button type="button" onClick={() => setPicture(undefined)}>
                      Back to 3D
                    </button>
                  </div>
                </div>
              )}
              {picture.state === "done" && (
                <div className="picture-body">
                  {reference ? (
                    <div className="compare">
                      <figure>
                        <img src={reference.src} alt={`Reference: ${reference.title}`} />
                        <figcaption>The photo (style reference only)</figcaption>
                      </figure>
                      <figure>
                        <img
                          src={picture.result.image}
                          alt={`The ${picture.view.toLowerCase()} as a photograph`}
                        />
                        <figcaption>Icarus's own office, {picture.view.toLowerCase()}</figcaption>
                      </figure>
                    </div>
                  ) : (
                    <img
                      src={picture.result.image}
                      alt={`The ${picture.view.toLowerCase()} as a photograph`}
                    />
                  )}
                  <p className="caption">
                    {picture.view}. An illustrative picture: the layout comes from your plan, the
                    finer details are invented by the model ({picture.result.model}).
                  </p>
                  <div className="actions">
                    <a
                      className="button"
                      href={picture.result.image}
                      download={`icarus-${picture.view.toLowerCase().replace(/\s+/g, "-")}.jpg`}
                    >
                      Download
                    </a>
                    <button type="button" onClick={() => void makeReal(picture.seed + 1)}>
                      Try another look
                    </button>
                    <button type="button" onClick={() => setPicture(undefined)}>
                      Back to 3D
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
