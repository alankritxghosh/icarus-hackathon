import type { Scene, Viewpoint } from "@icarus/core";
import type { RoomTrace } from "@icarus/spatial/model";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { type BuildCard, roomViews, type Summary } from "./buildCard";
import { viewCommand } from "./chatCommands";
import { saveFile } from "./download";
import type { PlanReference } from "./drawingDesign";
import type { OfficeView, ViewMode } from "./officeView";
import { PlanTracer } from "./PlanTracer";

export interface Reply {
  text: string;
  lines?: string[];
  card?: BuildCard;
}

export interface Message {
  id: string;
  role: "you" | "icarus";
  text: string;
  lines?: string[];
  attachment?: string;
  working?: boolean;
  card?: BuildCard;
  /** When it was said, in milliseconds since 1970; older saved conversations have none. */
  at?: number;
}

interface Props {
  scene?: Scene;
  labels: { name: string; x: number; y: number; w: number; h: number }[];
  viewpoints: Viewpoint[];
  title?: string;
  summary?: Summary;
  builds: { id: string; title: string }[];
  activeId?: string;
  canEdit: boolean;
  plainExport?: boolean;
  plans?: PlanReference[];
  traces?: RoomTrace[];
  onTraceRoom?: (trace: RoomTrace) => boolean;
  onUndoTrace?: () => void;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  starts: { label: string; text: string }[];
  onSend: (
    text: string,
    files: File[] | undefined,
    live: (lines: string[]) => void,
  ) => Promise<Reply>;
  onNew: () => void;
  onOpen: (id: string) => void;
  onExportPlan: () => string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "building";

export function Studio(props: Props) {
  const {
    scene,
    labels,
    viewpoints,
    title,
    summary,
    builds,
    activeId,
    canEdit,
    plainExport,
    plans,
    traces,
    onTraceRoom,
    onUndoTrace,
    messages,
    setMessages,
    starts,
    onSend,
    onNew,
    onOpen,
    onExportPlan,
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OfficeView>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("orbit");
  // A GPU render of the current view, made on the server; the live model stays under it.
  const [real, setReal] = useState<{
    state: "off" | "rendering" | "done" | "failed";
    image?: string;
    note?: string;
  }>({ state: "off" });
  const [menu, setMenu] = useState(false);
  const [roofVisible, setRoofVisible] = useState(false);
  const [walkPlace, setWalkPlace] = useState("");
  const [exporting, setExporting] = useState(false);
  const [overview, setOverview] = useState("");
  const [shots, setShots] = useState<Record<string, string>>({});
  const rooms = roomViews(viewpoints);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const turnRef = useRef(0);
  const pendingRef = useRef(false);
  const latestScene = useRef(scene);
  const latestLabels = useRef(labels);
  const latestPlans = useRef(plans);
  const hasScene = Boolean(scene);
  latestScene.current = scene;
  latestLabels.current = labels;
  latestPlans.current = plans;

  useEffect(() => {
    if (!hasScene) return;
    let closed = false;
    void import("./officeView").then(({ OfficeView }) => {
      if (closed || !host.current) return;
      const v = new OfficeView(host.current);
      v.onWalkLevelChange = (levelId) => {
        const level = latestPlans.current?.find((plan) => plan.levelId === levelId);
        setWalkPlace(level ? `${level.name}: landing` : levelId);
      };
      view.current = v;
      if (latestScene.current) {
        v.setScene(latestScene.current);
        v.setLabels(latestLabels.current);
      }
      if (import.meta.env.DEV) Object.assign(window, { __icarusView: v });
    });
    return () => {
      closed = true;
      view.current?.dispose();
      view.current = null;
    };
    // The viewer lives while a scene exists; later edits update it through the next effect.
  }, [hasScene]);

  useEffect(() => {
    if (!scene) return;
    view.current?.setScene(scene);
    view.current?.setLabels(labels);
  }, [scene, labels]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new building opens with its roof off, so its rooms show
  useEffect(() => setRoofVisible(false), [scene]);

  // A picture of the opening view for the ready card and the views strip, taken once the textures have loaded.
  useEffect(() => {
    setShots({});
    setOverview("");
    if (!scene) return;
    const timer = setTimeout(() => {
      if (view.current && modeRef.current === "orbit")
        setOverview(view.current.snapshotAt(480, 300, 0.85));
    }, 2500);
    return () => clearTimeout(timer);
  }, [scene]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever the list changes
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages]);

  const say = (m: Omit<Message, "id">) => {
    const id = crypto.randomUUID();
    setMessages((all) => [...all, { ...m, id, at: Date.now() }]);
    return id;
  };

  /** Send this view and the model as it is drawn to the GPU renderer, and show the picture over the model. */
  const makeReal = async (): Promise<string> => {
    const v = view.current;
    const stage = host.current;
    if (!v || !stage) return "There is nothing to render yet.";
    setReal({ state: "rendering" });
    const started = performance.now();
    try {
      // The picture is 1600 px on its long side whatever the panel's size: a phone panel would otherwise get a thumbnail.
      const scale = 1600 / Math.max(stage.clientWidth, stage.clientHeight);
      const camera = {
        ...v.renderView(),
        width: Math.max(64, Math.round(stage.clientWidth * scale)),
        height: Math.max(64, Math.round(stage.clientHeight * scale)),
        samples: 128,
      };
      const model = await v.exportGlb(plainExport, true);
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "model/gltf-binary", "x-icarus-view": JSON.stringify(camera) },
        body: model,
      });
      const data = (await res.json().catch(() => ({}))) as { jpegBase64?: string; error?: string };
      if (!res.ok || !data.jpegBase64) throw new Error(data.error ?? "the renderer failed");
      const seconds = Math.round((performance.now() - started) / 1000);
      setReal({ state: "done", image: `data:image/jpeg;base64,${data.jpegBase64}` });
      return `Rendered this view on a GPU in ${seconds} s.`;
    } catch (error) {
      const note = error instanceof Error ? error.message : "the renderer failed";
      setReal({ state: "failed", note });
      return `I could not render this view: ${note}.`;
    }
  };

  const setReality = (on: boolean) => {
    if (on) void makeReal().then((t) => say({ role: "icarus", text: t }));
    else setReal({ state: "off" });
  };

  const goto = (m: ViewMode) => {
    setMode(m);
    if (m === "eye") {
      if (real.state !== "off") setReality(false);
      const vp = viewpoints[0];
      if (vp) {
        view.current?.setViewpoint(vp);
        setWalkPlace(vp.name);
      } else view.current?.setMode("orbit");
    } else view.current?.setMode(m);
  };

  /** Stand in a room; the first visit also takes its picture for the views strip. */
  const visit = (point: Viewpoint) => {
    if (modeRef.current !== "eye") {
      if (real.state !== "off") setReality(false);
      setMode("eye");
    }
    view.current?.setViewpoint(point);
    setWalkPlace(point.name);
    if (shots[point.id]) return;
    setTimeout(() => {
      const v = view.current;
      if (v && modeRef.current === "eye") {
        const shot = v.snapshotAt(320, 200, 0.8);
        setShots((all) => ({ ...all, [point.id]: shot }));
      }
    }, 1500);
  };

  const leaveProject = () => {
    turnRef.current++;
    pendingRef.current = false;
    setBusy(false);
    setText("");
    setFiles([]);
    setMenu(false);
    setReality(false);
    goto("orbit");
  };

  const exportGlb = async (): Promise<string> => {
    try {
      const bytes = await view.current?.exportGlb(plainExport);
      if (!bytes) throw new Error("not ready");
      saveFile(`icarus-${slug(title ?? "building")}.glb`, bytes, "model/gltf-binary");
      return "Exported as a .glb. In Blender: File ▸ Import ▸ glTF 2.0, and edit it there.";
    } catch {
      return "I could not make the 3D file just now.";
    }
  };

  const run = async (text: string): Promise<string | undefined> => {
    const cmd = viewCommand(text);
    if (!cmd) return undefined;
    if (cmd.kind === "new") {
      leaveProject();
      onNew();
      return "";
    }
    if (!scene)
      return "There is nothing to look at yet. Describe a building or attach a floor plan first.";
    if (cmd.kind === "real") {
      if (!cmd.on) {
        setReal({ state: "off" });
        return "Back to the model.";
      }
      return makeReal();
    }
    if (cmd.kind === "mode") {
      goto(cmd.mode);
      return cmd.mode === "eye"
        ? "You are at the entrance in third person. Drag to look; use W A S D to move."
        : cmd.mode === "plan"
          ? "Top view."
          : "Outside view.";
    }
    if (cmd.kind === "ceiling") {
      view.current?.setCeiling(cmd.show);
      return cmd.show ? "Ceiling on." : "Ceiling off.";
    }
    if (cmd.kind === "export_plan") return onExportPlan();
    return exportGlb();
  };

  const send = async (said: string) => {
    const t = said.trim();
    if ((!t && files.length === 0) || pendingRef.current) return;
    pendingRef.current = true;
    const turn = turnRef.current;
    const attached = files;
    setText("");
    setFiles([]);
    say({
      role: "you",
      text: t || "(attached)",
      ...(attached.length ? { attachment: attached.map((file) => file.name).join(", ") } : {}),
    });
    if (!attached.length) {
      const reply = await run(t);
      if (turn !== turnRef.current) return;
      if (reply !== undefined) {
        if (reply) say({ role: "icarus", text: reply });
        pendingRef.current = false;
        return;
      }
    }
    setBusy(true);
    const id = say({ role: "icarus", text: "", working: true, lines: ["Working on it…"] });
    try {
      const reply = await onSend(t, attached.length ? attached : undefined, (lines) => {
        if (turn === turnRef.current)
          setMessages((all) => all.map((m) => (m.id === id ? { ...m, lines } : m)));
      });
      if (turn !== turnRef.current) return;
      setMessages((all) =>
        all.map((m) =>
          m.id === id
            ? {
                id,
                role: "icarus",
                text: reply.text,
                at: Date.now(),
                ...(reply.lines ? { lines: reply.lines } : {}),
                ...(reply.card ? { card: reply.card } : {}),
              }
            : m,
        ),
      );
    } catch {
      if (turn !== turnRef.current) return;
      setMessages((all) =>
        all.map((m) =>
          m.id === id
            ? {
                id,
                role: "icarus",
                text: "Something went wrong on my side. Please try that again.",
              }
            : m,
        ),
      );
    } finally {
      if (turn === turnRef.current) {
        pendingRef.current = false;
        setBusy(false);
      }
    }
  };

  const lastCard = [...messages].reverse().find((m) => m.card)?.id;
  const log = messages.filter((m) => m.role === "you");
  // "fourth floor: MASTER BEDROOM" reads as "master bedroom"; the strip is already per building.
  const place = (name: string) => (name.split(": ").pop() ?? name).toLowerCase();
  const clock = (at?: number) =>
    at ? new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className={`studio${(summary?.length ?? 0) || log.length ? "" : " no-side"}`}>
      <header className="top">
        <div className="crumbs">
          <a className="logo" href="/">
            icarus<span>.</span>
          </a>
          {title && (
            <>
              <span className="crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="crumb">Projects</span>
              <span className="crumb-sep" aria-hidden="true">
                ›
              </span>
              <span className="crumb now">{title}</span>
            </>
          )}
        </div>
        <span className="top-mode">Build</span>
        <div className="top-actions">
          {scene && (
            <div className="menu-wrap">
              <button
                type="button"
                className="btn primary"
                aria-expanded={exporting}
                onClick={() => setExporting((v) => !v)}
              >
                Export ↗
              </button>
              {exporting && (
                <ul className="menu">
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setExporting(false);
                        void exportGlb().then((t) => say({ role: "icarus", text: t }));
                      }}
                    >
                      3D model for Blender (.glb)
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setExporting(false);
                        say({ role: "icarus", text: onExportPlan() });
                      }}
                    >
                      Floor plan for CAD (.dxf)
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>
      </header>

      <nav className="rail" aria-label="Projects">
        <button
          type="button"
          title="New project"
          onClick={() => {
            leaveProject();
            onNew();
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 11 12 4l9 7v9H3z" />
          </svg>
          <span className="sr">New project</span>
        </button>
        <span className="on" title="Build">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z M4 7.5 12 12l8-4.5 M12 12v9" />
          </svg>
        </span>
        {builds.length > 0 && (
          <div className="history">
            <button
              type="button"
              title="Projects"
              onClick={() => setMenu((v) => !v)}
              aria-expanded={menu}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 3 8l9 5 9-5z M3 13l9 5 9-5" />
              </svg>
              <span className="sr">Projects</span>
            </button>
            {menu && (
              <ul className="menu history-menu">
                {builds.slice(0, 10).map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className={b.id === activeId ? "on" : ""}
                      onClick={() => {
                        leaveProject();
                        onOpen(b.id);
                      }}
                    >
                      {b.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      <aside className="chat" aria-label="Conversation">
        <h1 className="hand">
          Describe your build.
          <svg viewBox="0 0 40 42" aria-hidden="true">
            <path d="M3 10 C 18 2, 34 10, 30 34" />
            <path d="M22 28 L 30 35 L 36 26" />
          </svg>
        </h1>
        <p className="lede">
          Tell Icarus about a space, or attach a floor plan.
          <br />
          Then change it by telling Icarus what to change.
        </p>
        <div className="thread" ref={thread} aria-live="polite">
          {messages.length === 0 && (
            <div className="starts">
              {starts.map((s) => (
                <button key={s.label} type="button" onClick={() => void send(s.text)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {messages.map((m) =>
            m.role === "you" ? (
              <div key={m.id} className="msg you">
                <span className="avatar" aria-hidden="true">
                  You
                </span>
                <div>
                  <div className="bubble">
                    {m.attachment && <span className="chip">📎 {m.attachment}</span>}
                    {m.text !== "(attached)" && <p>{m.text}</p>}
                  </div>
                  {m.at && <div className="time">{clock(m.at)}</div>}
                </div>
              </div>
            ) : (
              <div key={m.id} className="msg icarus">
                <span className="spark" aria-hidden="true">
                  ✦
                </span>
                <div className="stack">
                  <div className="who">icarus</div>
                  {m.working ? (
                    <Progress steps={(m.lines ?? []).map((label) => ({ label }))} working />
                  ) : (
                    <>
                      {m.card && <Progress steps={m.card.steps} />}
                      {m.card && m.id === lastCard && scene && (
                        <div className="ready">
                          {overview ? (
                            <img src={overview} alt="" />
                          ) : (
                            <span className="ready-blank" />
                          )}
                          <div>
                            <h3>Your build is ready.</h3>
                            <div className="row">
                              <button
                                type="button"
                                className="btn primary small"
                                onClick={() => goto("orbit")}
                              >
                                View 3D
                              </button>
                              {viewpoints.length > 0 && (
                                <button
                                  type="button"
                                  className="btn small"
                                  onClick={() => goto("eye")}
                                >
                                  Walk through
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {(m.card?.note || m.text || (m.lines && m.lines.length > 0)) && (
                        <div className="bubble">
                          {m.card?.note && <p>{m.card.note}</p>}
                          {m.text && <p>{m.text}</p>}
                          {m.lines && m.lines.length > 0 && (
                            <ul>
                              {m.lines.map((l) => (
                                <li key={l}>{l}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {m.at && !m.working && <div className="time">{clock(m.at)}</div>}
                </div>
              </div>
            ),
          )}
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {files.map((file) => (
            <span className="chip" key={file.name}>
              📎 {file.name}
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((all) => all.filter((item) => item !== file))}
              >
                ✕
              </button>
            </span>
          ))}
          <textarea
            value={text}
            rows={2}
            placeholder={
              scene
                ? canEdit
                  ? "Tell me what to change…"
                  : "View or export this plan…"
                : "Describe a building, or attach a floor plan…"
            }
            aria-label="Message Icarus"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <div className="composer-foot">
            <label className="attach" title="Attach a floor plan (PDF) or a photo">
              <span aria-hidden="true">📎</span>
              <span className="sr">Attach a floor plan or photo</span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,.icarus.json"
                multiple
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="submit"
              className="send"
              aria-label={busy ? "Working" : "Send"}
              disabled={busy || (!text.trim() && !files.length)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h13M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </form>
      </aside>

      <main className="viewer" aria-label="3D model">
        <div className="vtabs">
          {scene && (
            <fieldset className="seg" aria-label="View">
              {(["orbit", "plan", "eye"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? "on" : ""}
                  onClick={() => goto(m)}
                >
                  {m === "orbit" ? "3D" : m === "plan" ? "Floor Plan" : "Walkthrough"}
                </button>
              ))}
            </fieldset>
          )}
          {scene && (
            <div className="stage-tools">
              {scene.nodes.some((node) => node.tags.includes("roof")) && mode === "orbit" && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setRoofVisible((visible) => {
                      view.current?.setCeiling(!visible);
                      return !visible;
                    });
                  }}
                >
                  {roofVisible ? "Roof on" : "Roof off"}
                </button>
              )}
              {mode !== "plan" && (
                <button
                  type="button"
                  className={`btn small real${real.state === "rendering" || real.state === "done" ? " on" : ""}`}
                  disabled={real.state === "rendering"}
                  onClick={() => setReality(real.state !== "done")}
                >
                  {real.state === "rendering" ? "Rendering…" : "✦ Make it real"}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="stage">
          <div className="viewport" ref={host} />
          {mode === "eye" && scene && (
            <div className="walk-hud">
              <div className="walk-note">
                <b>{walkPlace || viewpoints[0]?.name || "Entrance"}</b>
                <span>WASD or arrow keys to move · Drag to look · Scroll to zoom</span>
              </div>
              {((plans && plans.length > 1) || rooms.length > 0) && (
                <fieldset className="walk-floors">
                  <legend className="sr">Visit floor or room</legend>
                  {(plans && plans.length > 1 ? plans : []).map((plan) => (
                    <button
                      key={plan.levelId}
                      type="button"
                      onClick={() => {
                        const destination = viewpoints.find((point) =>
                          point.id.startsWith(`${plan.levelId}.`),
                        );
                        if (destination) {
                          view.current?.setViewpoint(destination);
                          setWalkPlace(destination.name);
                        }
                      }}
                    >
                      {plan.name}
                    </button>
                  ))}
                  {rooms.length > 0 && (
                    <select
                      aria-label="Go to a room"
                      value=""
                      onChange={(e) => {
                        const destination = rooms.find((room) => room.id === e.target.value);
                        if (destination) visit(destination);
                      }}
                    >
                      <option value="">Go to a room…</option>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  )}
                </fieldset>
              )}
              <fieldset className="walk-pad">
                <legend className="sr">Move character</legend>
                {(
                  [
                    ["▲", "w"],
                    ["◀", "a"],
                    ["▼", "s"],
                    ["▶", "d"],
                  ] as const
                ).map(([label, direction]) => (
                  <button
                    key={direction}
                    type="button"
                    aria-label={
                      { w: "Move forward", a: "Move left", s: "Move backward", d: "Move right" }[
                        direction
                      ]
                    }
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      view.current?.setWalkInput(direction, true);
                    }}
                    onPointerUp={() => view.current?.setWalkInput(direction, false)}
                    onPointerCancel={() => view.current?.setWalkInput(direction, false)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            </div>
          )}
          {mode === "plan" && plans?.length && onTraceRoom && onUndoTrace && (
            <PlanTracer
              plans={plans}
              traces={traces ?? []}
              onTrace={onTraceRoom}
              onUndo={onUndoTrace}
            />
          )}
          {!scene && (
            <div className="empty">
              <p className="hand">Your building appears here.</p>
            </div>
          )}
          {real.state === "rendering" && (
            <p className="real-caption" role="status">
              Rendering this view on a GPU…
            </p>
          )}
          {real.state === "failed" && (
            <p className="real-caption" role="status">
              Could not render: {real.note}
            </p>
          )}
          {real.state === "done" && real.image && (
            <div className="real-shot">
              <img src={real.image} alt="A path-traced render of this view" />
              <div className="row">
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setReal({ state: "off" })}
                >
                  Back to the model
                </button>
                <a
                  className="btn small primary"
                  href={real.image}
                  download={`icarus-${slug(title ?? "building")}.jpg`}
                >
                  Save picture
                </a>
              </div>
            </div>
          )}
        </div>
        {scene && (
          <div className="views">
            <button
              type="button"
              className={`view${mode === "orbit" ? " on" : ""}`}
              onClick={() => {
                goto("orbit");
                view.current?.reframe();
              }}
            >
              {overview ? <img src={overview} alt="" /> : <span className="view-blank" />}
              <span>Overview</span>
            </button>
            {rooms.slice(0, 8).map((room) => (
              <button
                key={room.id}
                type="button"
                className={`view${mode === "eye" && walkPlace === room.name ? " on" : ""}`}
                onClick={() => visit(room)}
              >
                {shots[room.id] ? (
                  <img src={shots[room.id]} alt="" />
                ) : (
                  <span className="view-blank hand">{place(room.name)}</span>
                )}
                <span>{place(room.name)}</span>
              </button>
            ))}
          </div>
        )}
      </main>

      <aside
        className="side"
        aria-label="About this build"
        hidden={!summary?.length && !log.length}
      >
        {summary && summary.length > 0 && (
          <section className="card">
            <h2>Build Summary</h2>
            {summary.map((row) => (
              <div className="stat" key={row.label}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </section>
        )}
        {log.length > 0 && (
          <section className="card">
            <h2>
              Change Log <span className="count">({log.length})</span>
            </h2>
            <ol className="log">
              {log.map((m, index) => (
                <li
                  key={m.id}
                  className={
                    busy && index === log.length - 1
                      ? "pending"
                      : index === log.length - 1
                        ? "latest"
                        : ""
                  }
                >
                  {m.attachment ?? m.text}
                  <small>{busy && index === log.length - 1 ? "Applying…" : clock(m.at)}</small>
                </li>
              ))}
            </ol>
          </section>
        )}
      </aside>
    </div>
  );
}

/** The steps of a build, done or under way, each with the one fact it produced. */
function Progress(props: { steps: { label: string; detail?: string }[]; working?: boolean }) {
  const { steps, working } = props;
  return (
    <div className="gcard">
      <div className="ghead">
        <b>Building your space</b>
        <span className={working ? "state busy" : "state"}>● {working ? "Working" : "Done"}</span>
      </div>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={step.label} className={working && index === steps.length - 1 ? "busy" : "done"}>
            <span>{step.label}</span>
            {step.detail && <span className="detail">{step.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
