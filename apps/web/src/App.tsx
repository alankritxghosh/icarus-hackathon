import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Built,
  finish,
  PHOTO_STAGES,
  planDesign,
  readDesign,
  readPhotoDesign,
  rebuild,
  STAGES,
} from "./design";
import { Home } from "./Home";
import { readPhoto } from "./photo";
import type { Reference } from "./references";
import { RenderError } from "./render";
import { Sidebar } from "./Sidebar";
import { loadBuilds, type SavedBuild, saveBuilds } from "./store";
import { Workspace } from "./Workspace";

interface Session {
  id: string;
  brief: string;
  stage?: number;
  built?: Built;
  history: Built[];
  stages: readonly string[];
  /** The photograph this office was built to match, when it started from one. */
  reference?: Reference;
}

type Source = { kind: "brief"; text: string } | { kind: "photo"; reference: Reference };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titleOf = (brief: string) => {
  const first = brief.split(/[.!?]/)[0]?.trim() ?? "";
  return first.length > 38 ? `${first.slice(0, 36)}…` : first || "Untitled office";
};

export function App() {
  const [builds, setBuilds] = useState<SavedBuild[]>(loadBuilds);
  const [session, setSession] = useState<Session>();
  const [notice, setNotice] = useState<string>();
  const token = useRef(0);

  useEffect(() => saveBuilds(builds), [builds]);

  const remember = useCallback((id: string, brief: string, built: Built) => {
    setBuilds((all) => [
      {
        id,
        title: titleOf(brief),
        brief,
        program: built.program,
        plan: built.plan,
        seed: built.seed,
        notes: built.notes,
        editedAt: Date.now(),
      },
      ...all.filter((b) => b.id !== id),
    ]);
  }, []);

  const start = useCallback(
    async (source: Source, previous?: Session) => {
      const mine = ++token.current;
      const alive = () => token.current === mine;
      const id = previous?.id ?? crypto.randomUUID();
      const history = previous?.built ? [...previous.history, previous.built] : [];
      const reference = source.kind === "photo" ? source.reference : undefined;
      const brief =
        source.kind === "brief" ? source.text : `An office like “${source.reference.title}”`;
      const stages = source.kind === "photo" ? PHOTO_STAGES : STAGES;
      const show = (stage: number) =>
        setSession({ id, brief, stage, history, built: previous?.built, stages, reference });
      setNotice(undefined);
      show(0);
      let read: ReturnType<typeof readDesign>;
      if (source.kind === "photo") {
        try {
          const result = await readPhoto(source.reference.src);
          read = readPhotoDesign(result.read, result.measured);
        } catch (error) {
          if (!alive()) return;
          setSession(previous);
          setNotice(error instanceof RenderError ? error.message : "The photo could not be read.");
          return;
        }
      } else {
        await pause(380);
        read = readDesign(source.text);
      }
      if (!alive()) return;
      show(1);
      await pause(380);
      if (!alive()) return;
      const t = performance.now();
      const design = planDesign(read);
      const ms = Math.round(performance.now() - t);
      show(2);
      await pause(380);
      if (!alive()) return;
      const built = finish(design, ms);
      show(3);
      await pause(380);
      if (!alive()) return;
      setSession({ id, brief, built, history, stages, reference });
      remember(id, brief, built);
    },
    [remember],
  );

  const stop = () => {
    token.current++;
    setSession((s) => (s?.built ? { ...s, stage: undefined } : undefined));
  };

  const open = (id: string) => {
    const saved = builds.find((b) => b.id === id);
    if (!saved) return;
    token.current++;
    const built = rebuild(saved.program, saved.seed, saved.notes);
    setSession({ id, brief: saved.brief, built, history: [], stages: STAGES });
  };

  const change = (session: Session, built: Built) => {
    const history = session.built ? [...session.history, session.built] : session.history;
    setSession({ ...session, built, history });
    remember(session.id, session.brief, built);
  };

  const undo = () => {
    if (!session || session.history.length === 0) return;
    const built = session.history[session.history.length - 1] as Built;
    setSession({ ...session, built, history: session.history.slice(0, -1) });
    remember(session.id, session.brief, built);
  };

  return (
    <div className="app">
      <Sidebar
        builds={builds}
        active={session?.id}
        onHome={() => {
          token.current++;
          setSession(undefined);
        }}
        onOpen={open}
      />
      {session ? (
        <Workspace
          key={session.id}
          brief={session.brief}
          stage={session.stage}
          stages={session.stages}
          reference={session.reference}
          built={session.built}
          canUndo={session.history.length > 0}
          onUndo={undo}
          onStop={stop}
          onBuild={(text) => void start({ kind: "brief", text }, session)}
          onApplyEdit={(current, program, seed) =>
            change(session, rebuild(program, seed, current.notes))
          }
          onAnother={() =>
            session.built &&
            change(
              session,
              rebuild(session.built.program, session.built.seed + 1, session.built.notes),
            )
          }
        />
      ) : (
        <Home
          builds={builds}
          notice={notice}
          onBuild={(text) => void start({ kind: "brief", text })}
          onPhoto={(reference) => void start({ kind: "photo", reference })}
          onOpen={open}
        />
      )}
    </div>
  );
}
