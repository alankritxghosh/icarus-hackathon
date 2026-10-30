import type { Scene, Viewpoint } from "@icarus/core";
import { useEffect, useRef, useState } from "react";
import { viewCommand } from "./chatCommands";
import { saveFile } from "./download";
import { OfficeView, type RealState, type ViewMode } from "./officeView";

export interface Reply {
  text: string;
  lines?: string[];
}

interface Message {
  id: number;
  role: "you" | "icarus";
  text: string;
  lines?: string[];
  attachment?: string;
  working?: boolean;
}

interface Props {
  scene?: Scene;
  labels: { name: string; x: number; y: number }[];
  viewpoints: Viewpoint[];
  title?: string;
  builds: { id: string; title: string }[];
  activeId?: string;
  /** Changes when a different project is opened, so the conversation starts over. */
  resetKey: string;
  intro?: string;
  starts: { label: string; text: string }[];
  onSend: (text: string, file: File | undefined, live: (lines: string[]) => void) => Promise<Reply>;
  onNew: () => void;
  onOpen: (id: string) => void;
}

const CAPTION: Record<RealState["state"], (n: number) => string> = {
  off: () => "",
  preparing: () => "Preparing the scene for your GPU…",
  rendering: (n) => `Rendering on your GPU · ${n} samples, getting sharper`,
  done: (n) => `Fully rendered · ${n} samples. Drag to look around.`,
  unsupported: () =>
    "This browser or GPU cannot do realistic rendering, so you are seeing the quick view.",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "building";

let nextId = 1;

export function Studio(props: Props) {
  const {
    scene,
    labels,
    viewpoints,
    title,
    builds,
    activeId,
    resetKey,
    intro,
    starts,
    onSend,
    onNew,
    onOpen,
  } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<OfficeView>(null);
  const thread = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ViewMode>("orbit");
  const [real, setReal] = useState<RealState>({ state: "off", samples: 0 });
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const v = new OfficeView(host.current);
    view.current = v;
    if (import.meta.env.DEV) Object.assign(window, { __icarusView: v });
    return () => {
      v.dispose();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scene) return;
    view.current?.setScene(scene);
    view.current?.setLabels(labels);
  }, [scene, labels]);

  useEffect(() => {
    setMessages(intro ? [{ id: nextId++, role: "icarus", text: intro }] : []);
    void resetKey;
  }, [resetKey, intro]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever the list changes
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [messages]);

  const say = (m: Omit<Message, "id">) => {
    const id = nextId++;
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
      const vp = viewpoints[0];
      if (vp) view.current?.setViewpoint(vp);
      else view.current?.setMode("orbit");
    } else view.current?.setMode(m);
  };

  const exportGlb = async (): Promise<string> => {
    try {
      const bytes = await view.current?.exportGlb();
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
      onNew();
      return "";
    }
    if (!scene)
      return "There is nothing to look at yet. Describe a building or attach a floor plan first.";
    if (cmd.kind === "real") {
      setReality(cmd.on);
      return cmd.on
        ? "Making it real: the model is being rendered on your GPU. You can still orbit and walk it."
        : "Back to the quick view.";
    }
    if (cmd.kind === "mode") {
      goto(cmd.mode);
      return cmd.mode === "eye"
        ? "You are inside. Drag to look, W A S D to walk."
        : cmd.mode === "plan"
          ? "Top view."
          : "Outside view.";
    }
    if (cmd.kind === "ceiling") {
      view.current?.setCeiling(cmd.show);
      return cmd.show ? "Ceiling on." : "Ceiling off.";
    }
    return exportGlb();
  };

  const send = async (said: string) => {
    const t = said.trim();
    if ((!t && !file) || busy) return;
    const attached = file;
    setText("");
    setFile(undefined);
    say({
      role: "you",
      text: t || "(attached)",
      ...(attached ? { attachment: attached.name } : {}),
    });
    if (!attached) {
      const reply = await run(t);
      if (reply !== undefined) {
        if (reply) say({ role: "icarus", text: reply });
        return;
      }
    }
    setBusy(true);
    const id = say({ role: "icarus", text: "", working: true, lines: ["Working on it…"] });
    try {
      const reply = await onSend(t, attached, (lines) =>
        setMessages((all) => all.map((m) => (m.id === id ? { ...m, lines } : m))),
      );
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
      setBusy(false);
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
                            setMenu(false);
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
            <button type="button" className="quiet-btn" onClick={onNew}>
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
          {file && (
            <span className="chip">
              📎 {file.name}
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => setFile(undefined)}
              >
                ✕
              </button>
            </span>
          )}
          <textarea
            value={text}
            rows={2}
            placeholder={
              scene ? "Tell me what to change…" : "Describe a building, or attach a floor plan…"
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
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <button type="submit" className="send" disabled={busy || (!text.trim() && !file)}>
              {busy ? "Working…" : "Send"}
            </button>
          </div>
        </form>
      </aside>
      <section className="stage" aria-label="3D model">
        <div className="viewport" ref={host} />
        {!scene && (
          <div className="empty">
            <p>Your building appears here.</p>
          </div>
        )}
        {scene && (
          <div className="stage-tools">
            <button
              type="button"
              className={`real${real.state !== "off" && real.state !== "unsupported" ? " on" : ""}`}
              onClick={() => setReality(real.state === "off" || real.state === "unsupported")}
            >
              ✦ Make it real
            </button>
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
        {real.state !== "off" && (
          <p className="real-caption">{CAPTION[real.state](real.samples)}</p>
        )}
        <p className="credit">Furniture models: CC0, Poly Haven</p>
      </section>
    </div>
  );
}
