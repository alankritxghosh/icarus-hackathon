import { type Round, type Scene, type Viewpoint, viewpoints } from "@icarus/core";
import type { AccountLesson } from "@icarus/spatial/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLessons, saveLessons } from "./accountLessons";
import {
  type Built,
  builtFromRefine,
  PHOTO_STAGES,
  readPhotoDesign,
  rebuild,
  STAGES,
} from "./design";
import { designFromBrief, refineProgram } from "./designLoop";
import { DrawingError, type DrawnDesign, designFromDrawing } from "./drawingDesign";
import { editByWords } from "./editByWords";
import { RenderError, readPhoto } from "./photo";
import type { Reference } from "./references";
import { type Reply, Studio } from "./Studio";
import { loadBuilds, type SavedBuild, saveBuilds } from "./store";
import { applyTaught, learnFrom } from "./taught";

interface Session {
  id: string;
  brief: string;
  built?: Built;
  drawing?: DrawnDesign;
  history: Built[];
}

const STARTS = [
  {
    label: "35-person design studio",
    text: "A 35-person design studio. Open studio, three meeting rooms, two phone booths, a kitchen and lounge, reception, storage and server closet, restrooms. 24 m by 16 m shell, windows on south and east walls, entrance on the west.",
  },
  {
    label: "12-person startup",
    text: "A 12-person startup. Open workspace, two meeting rooms, one phone booth, kitchen, reception, two restrooms. 14 m by 10 m shell, windows on the north and south walls, entrance on the west.",
  },
  {
    label: "Office with private rooms",
    text: "A 20-person consultancy with six private offices, two meeting rooms, a kitchen, reception and storage. 22 m by 14 m shell, windows on the south wall, entrance on the north.",
  },
];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const titleOf = (brief: string) => {
  const first = brief.split(/[.!?]/)[0]?.trim() ?? "";
  return first.length > 38 ? `${first.slice(0, 36)}…` : first || "Untitled";
};

type Source = { kind: "brief"; text: string } | { kind: "photo"; reference: Reference };

export function App() {
  const [builds, setBuilds] = useState<SavedBuild[]>(loadBuilds);
  const [session, setSession] = useState<Session>();
  const [lessons, setLessons] = useState<AccountLesson[]>(() => loadLessons());
  const [resetKey, setResetKey] = useState("start");
  const [intro, setIntro] = useState<string>();
  const sessionRef = useRef<Session | undefined>(undefined);
  sessionRef.current = session;

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

  /** Designs an office from a brief or a photo, reporting each step as a line the person can read. */
  const buildFrom = useCallback(
    async (source: Source, previous: Session | undefined, live: (lines: string[]) => void) => {
      const id = previous?.id ?? crypto.randomUUID();
      const history = previous?.built ? [...previous.history, previous.built] : [];
      const brief =
        source.kind === "brief" ? source.text : `An office like “${source.reference.title}”`;
      const stages = source.kind === "photo" ? PHOTO_STAGES : STAGES;
      const progress: string[] = [];
      const show = (stage: number) =>
        live([`${stages[Math.min(stage, stages.length - 1)]}…`, ...progress.slice(-4)]);
      const roundLine = (r: Round) => {
        if (r.source === "start")
          progress.push(`First plan: ${r.open} open issue${r.open === 1 ? "" : "s"}`);
        else
          progress.push(
            `${r.accepted ? "Kept" : "Not kept"} (${r.source}): ${r.description} → ${r.open} open`,
          );
      };
      const yieldToHost = () => new Promise<void>((r) => setTimeout(r, 0));
      const started = performance.now();
      show(0);
      await pause(200);
      let outcome: Awaited<ReturnType<typeof designFromBrief>>;
      if (source.kind === "photo") {
        const result = await readPhoto(source.reference.src);
        const read = readPhotoDesign(result.read, result.measured);
        show(1);
        outcome = await refineProgram(read.program, read.notes, {
          yieldToHost,
          onRound: (r) => {
            roundLine(r);
            show(1);
          },
        });
      } else {
        outcome = await designFromBrief(source.text, {
          yieldToHost,
          onStage: (label) => {
            const index = label.startsWith("Checking")
              ? 1
              : STAGES.indexOf(label as (typeof STAGES)[number]);
            show(Math.max(0, index));
          },
          onRound: (r) => {
            roundLine(r);
            show(2);
          },
        });
      }
      show(3);
      const built = builtFromRefine(
        outcome.refine,
        outcome.notes,
        outcome.trace,
        Math.round(performance.now() - started),
      );
      setSession({ id, brief, built, history });
      remember(id, brief, built);
      return built;
    },
    [remember],
  );

  const change = (current: Session, built: Built) => {
    const history = current.built ? [...current.history, current.built] : current.history;
    setSession({ ...current, built, history });
    remember(current.id, current.brief, built);
  };

  const undo = (current: Session): boolean => {
    const last = current.history[current.history.length - 1];
    if (!last) return false;
    setSession({ ...current, built: last, history: current.history.slice(0, -1) });
    remember(current.id, current.brief, last);
    return true;
  };

  /** What Icarus remembers from this message, said once, and the lessons updated. */
  const learn = (text: string) => {
    const learned = learnFrom(text, lessons);
    if (learned.added.length) {
      setLessons(learned.lessons);
      saveLessons(learned.lessons);
    }
    return learned;
  };

  const respond = async (
    text: string,
    file: File | undefined,
    live: (lines: string[]) => void,
  ): Promise<Reply> => {
    const current = sessionRef.current;

    if (file && file.type === "application/pdf") {
      live(["Reading your drawing…"]);
      try {
        const drawn = await designFromDrawing(file, file.name.replace(/\.pdf$/i, ""), text);
        setSession({ id: crypto.randomUUID(), brief: drawn.name, drawing: drawn, history: [] });
        return {
          text: `Here is ${drawn.name}, drawn in 3D from your plan. Say “make it real” to render it on your GPU.`,
          lines: drawn.lines,
        };
      } catch (error) {
        return {
          text: error instanceof DrawingError ? error.message : "I could not read that drawing.",
        };
      }
    }

    if (file) {
      const reference: Reference = {
        id: "upload",
        src: URL.createObjectURL(file),
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Your photo",
        credit: "Your photo, used only here",
      };
      try {
        const built = await buildFrom({ kind: "photo", reference }, undefined, live);
        return {
          text: `Designed an office in the style of your photo: ${built.plan.rooms.length} rooms on ${built.plan.shell.w} × ${built.plan.shell.h} m.`,
        };
      } catch (error) {
        return {
          text: error instanceof RenderError ? error.message : "I could not read that photo.",
        };
      }
    }

    // Anything that states a preference is remembered, whatever else the message asks.
    const learned = text ? learn(text) : undefined;
    const remembered = learned?.added.map((l) => `I will remember: “${l.said}”`) ?? [];

    if (!current?.built) {
      if (current?.drawing)
        return {
          text: "This one comes from your drawing, so I can show it, walk it and export it, but I cannot change its rooms yet. Attach another plan or describe a new building.",
        };
      if (learned?.onlyPreferences)
        return { text: "Noted. Now tell me what to build.", lines: remembered };
      const built = await buildFrom({ kind: "brief", text }, undefined, live);
      return {
        text: `Built it: ${built.plan.rooms.length} rooms on ${built.plan.shell.w} × ${built.plan.shell.h} m. Tell me what to change, or say “make it real”.`,
        lines: remembered,
      };
    }

    if (learned?.onlyPreferences)
      return {
        text: "Done.",
        lines: [...remembered, "It applies to this design and to every one after it."],
      };

    live(["Working on it…"]);
    const result = await editByWords(text, current.built);
    if (result.undo) {
      const done = undo(current);
      return { text: done ? "Undid the last change." : "There is nothing to undo." };
    }
    if (result.built) change(current, result.built);
    const said = result.entry.lines.map((l) => l.text);
    const applied = result.entry.lines.some((l) => l.status === "applied");
    return {
      text: applied
        ? "Done."
        : result.entry.lines.some((l) => l.status === "refused")
          ? "I could not do that."
          : "Nothing changed.",
      lines: [...said, ...remembered],
    };
  };

  const open = (id: string) => {
    const saved = builds.find((b) => b.id === id);
    if (!saved) return;
    const built = rebuild(saved.program, saved.seed, saved.notes);
    setSession({ id, brief: saved.brief, built, history: [] });
    setIntro(`Opened “${saved.title}”. Tell me what to change.`);
    setResetKey(`open-${id}-${Date.now()}`);
  };

  const fresh = () => {
    setSession(undefined);
    setIntro(undefined);
    setResetKey(`new-${Date.now()}`);
  };

  // What is on screen: the office or the drawing, with whatever the person has taught applied.
  const shown = useMemo(() => {
    if (session?.built) {
      const { scene } = applyTaught(session.built.scene, lessons);
      const plan = session.built.plan;
      return {
        scene,
        labels: plan.rooms.map((r) => ({
          name: r.name,
          x: r.rect.x + r.rect.w / 2,
          y: r.rect.y + r.rect.h / 2,
        })),
        views: viewpoints(plan) as Viewpoint[],
      };
    }
    if (session?.drawing)
      return {
        scene: session.drawing.scene as Scene | undefined,
        labels: session.drawing.labels,
        views: session.drawing.viewpoints,
      };
    return { scene: undefined as Scene | undefined, labels: [], views: [] as Viewpoint[] };
  }, [session, lessons]);

  const eye = useMemo(() => {
    const v = shown.views;
    return [v.find((x) => x.name === "Open workspace") ?? v[0]].filter((x): x is Viewpoint =>
      Boolean(x),
    );
  }, [shown.views]);

  return (
    <Studio
      scene={shown.scene}
      labels={shown.labels}
      viewpoints={eye}
      title={session?.brief}
      builds={builds.map((b) => ({ id: b.id, title: b.title }))}
      activeId={session?.id}
      resetKey={resetKey}
      intro={intro}
      starts={STARTS}
      onSend={respond}
      onNew={fresh}
      onOpen={open}
    />
  );
}
