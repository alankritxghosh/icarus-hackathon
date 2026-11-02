import type { Scene, Viewpoint } from "@icarus/core";
import type { RoomTrace } from "@icarus/spatial/model";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { viewCommand } from "./chatCommands";
import { saveFile } from "./download";
import type { PlanReference } from "./drawingDesign";
import type { OfficeView, RealState, ViewMode } from "./officeView";
import { PlanTracer } from "./PlanTracer";

export interface Reply {
  text: string;
  lines?: string[];
}

export interface Message {
  id: string;
  role: "you" | "icarus";
  text: string;
  lines?: string[];
  attachment?: string;
  working?: boolean;
}

interface Props {
  scene?: Scene;
  labels: { name: string; x: number; y: number; w: number; h: number }[];
  viewpoints: Viewpoint[];
  title?: string;
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
  const [real, setReal] = useState<RealState>({ state: "off", samples: 0 });
  const [canReal, setCanReal] = useState(false);
  const [menu, setMenu] = useState(false);
  const [roofVisible, setRoofVisible] = useState(false);
  const [walkPlace, setWalkPlace] = useState("");
  const rooms = viewpoints.filter((point) => /(^|\.)room\./.test(point.id));
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
      setCanReal(v.supportsRealistic());
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
      setCanReal(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever the list changes
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages]);

  const say = (m: Omit<Message, "id">) => {
    const id = crypto.randomUUID();
    setMessages((all) => [...all, { ...m, id }]);
    return id;
  };

  const setReality = (on: boolean) => {
    view.current?.setRealistic(on, (s) => setReal(s));
    if (!on) setReal({ state: "off", samples: 0 });
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
      if (cmd.on && !canReal)
        return "This device cannot show the realistic view. You can still use 3D and Plan.";
      setReality(cmd.on);
      return cmd.on
        ? "Making it real: the model is being rendered on your GPU. You can still orbit and walk it."
        : "Back to the quick view.";
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
                ...(reply.lines ? { lines: reply.lines } : {}),
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

  return (
    <div className="studio">
      <aside className="chat" aria-label="Conversation">
        <header className="chat-head">
          <div className="brand">
            <span className="mark" aria-hidden="true" />
            <b>ICARUS</b>
          </div>
          <div className="chat-tools">
            {builds.length > 0 && (
              <div className="history">
                <button
                  type="button"
                  className="quiet-btn"
                  onClick={() => setMenu((v) => !v)}
                  aria-expanded={menu}
                >
                  Projects
                </button>
                {menu && (
                  <ul className="history-menu">
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
            <button
              type="button"
              className="quiet-btn"
              onClick={() => {
                leaveProject();
                onNew();
              }}
            >
              New
            </button>
          </div>
        </header>
        <div className="thread" ref={thread} aria-live="polite">
          {messages.length === 0 && (
            <div className="msg icarus">
              <p>
                Describe the building you want, or attach a floor plan (PDF) or a photo of a space
                you like. Then change it by telling me what to change.
              </p>
              <div className="starts">
                {starts.map((s) => (
                  <button key={s.label} type="button" onClick={() => void send(s.text)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}${m.working ? " working" : ""}`}>
              {m.attachment && <span className="chip">📎 {m.attachment}</span>}
              {m.text && <p>{m.text}</p>}
              {m.lines && m.lines.length > 0 && (
                <ul>
                  {m.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
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
              disabled={busy || (!text.trim() && !files.length)}
            >
              {busy ? "Working…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
      <main className="stage" aria-label="3D model">
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
                      if (destination) {
                        view.current?.setViewpoint(destination);
                        setWalkPlace(destination.name);
                      }
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
        {!!traces?.length && (
          <p className="trace-count">
            {traces.length} spaces built from plan · outlines are estimates
          </p>
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
            <p>Your building appears here.</p>
          </div>
        )}
        {scene && (
          <div className="stage-tools">
            {scene.nodes.some((node) => node.tags.includes("roof")) && mode === "orbit" && (
              <button
                type="button"
                className="quiet-btn roof-toggle"
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
            {canReal && (
              <button
                type="button"
                className={`real${real.state !== "off" && real.state !== "unsupported" ? " on" : ""}`}
                onClick={() => setReality(real.state === "off" || real.state === "unsupported")}
              >
                ✦ Make it real
              </button>
            )}
            <fieldset className="seg" aria-label="View">
              {(["orbit", "plan", "eye"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={mode === m ? "on" : ""}
                  onClick={() => goto(m)}
                >
                  {m === "orbit" ? "3D" : m === "plan" ? "Plan" : "Walk"}
                </button>
              ))}
            </fieldset>
            <button
              type="button"
              className="quiet-btn"
              onClick={() => void exportGlb().then((t) => say({ role: "icarus", text: t }))}
            >
              Export for Blender
            </button>
          </div>
        )}
        {real.state === "preparing" && (
          <p className="real-caption" role="status">
            Preparing realistic view…
          </p>
        )}
        {real.state === "unsupported" && (
          <p className="real-caption" role="status">
            Realistic view is not available on this device.
          </p>
        )}
      </main>
    </div>
  );
}
