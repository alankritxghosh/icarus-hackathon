import { type Scene, type Viewpoint, viewpoints } from "@icarus/core";
import { type AccountLesson, sceneFromModel, toDxf } from "@icarus/spatial/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLessons, saveLessons } from "./accountLessons";
import { buildSummary } from "./buildSummary";
import { type Built, builtFromRefine, finish, readPhotoDesign } from "./design";
import { designFromBrief, refineProgram } from "./designLoop";
import { saveFile } from "./download";
import { DrawingError, type DrawnDesign, designFromDrawing } from "./drawingDesign";
import { editByWords } from "./editByWords";
import { RenderError, readPhoto } from "./photo";
import type { Reference } from "./references";
import { type Message, type Reply, Studio } from "./Studio";
import {
  loadBuilds,
  loadDrawings,
  type SavedBuild,
  type SavedRevision,
  saveBuilds,
  saveDrawings,
} from "./store";
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

const revisionOf = (b: Built): SavedRevision => ({
  program: b.program,
  plan: b.plan,
  seed: b.seed,
  notes: b.notes,
});

type Source = { kind: "brief"; text: string } | { kind: "photo"; reference: Reference };

export function App() {
  const [builds, setBuilds] = useState<SavedBuild[]>(loadBuilds);
  const [drawings, setDrawings] = useState(loadDrawings);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [session, setSession] = useState<Session>();
  const [lessons, setLessons] = useState<AccountLesson[]>(() => loadLessons());
  const sessionRef = useRef<Session | undefined>(undefined);
  const viewVersion = useRef(0);
  sessionRef.current = session;

  useEffect(() => saveBuilds(builds), [builds]);
  useEffect(() => saveDrawings(drawings), [drawings]);

  useEffect(() => {
    if (!session) return;
    const completed = conversation.filter((m) => !m.working);
    if (session.built)
      setBuilds((all) =>
        all.map((b) =>
          b.id === session.id
            ? { ...b, conversation: completed, history: session.history.map(revisionOf) }
            : b,
        ),
      );
    if (session.drawing)
      setDrawings((all) =>
        all.map((d) => (d.id === session.id ? { ...d, conversation: completed } : d)),
      );
  }, [conversation, session]);

  const remember = useCallback((id: string, brief: string, built: Built, history: Built[]) => {
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
        conversation: all.find((b) => b.id === id)?.conversation ?? [],
        history: history.map(revisionOf),
      },
      ...all.filter((b) => b.id !== id),
    ]);
  }, []);

  /** Designs an office from a brief or a photo, reporting each step as a line the person can read. */
  const buildFrom = useCallback(
    async (source: Source, previous: Session | undefined, live: (lines: string[]) => void) => {
      const version = viewVersion.current;
      const id = previous?.id ?? crypto.randomUUID();
      const history = previous?.built ? [...previous.history, previous.built] : [];
      const brief =
        source.kind === "brief" ? source.text : `An office like “${source.reference.title}”`;
      const yieldToHost = () => new Promise<void>((r) => setTimeout(r, 0));
      const started = performance.now();
      live([source.kind === "photo" ? "Reading your photo…" : "Designing your office…"]);
      await pause(200);
      let outcome: Awaited<ReturnType<typeof designFromBrief>>;
      if (source.kind === "photo") {
        const result = await readPhoto(source.reference.src);
        const read = readPhotoDesign(result.read, result.measured);
        outcome = await refineProgram(read.program, read.notes, {
          yieldToHost,
        });
      } else {
        outcome = await designFromBrief(source.text, {
          yieldToHost,
        });
      }
      const built = builtFromRefine(
        outcome.refine,
        outcome.notes,
        outcome.trace,
        Math.round(performance.now() - started),
      );
      if (version !== viewVersion.current) return built;
      setSession({ id, brief, built, history });
      remember(id, brief, built, history);
      return built;
    },
    [remember],
  );

  const change = (current: Session, built: Built) => {
    const history = current.built ? [...current.history, current.built] : current.history;
    setSession({ ...current, built, history });
    remember(current.id, current.brief, built, history);
  };

  const undo = (current: Session): boolean => {
    const last = current.history[current.history.length - 1];
    if (!last) return false;
    setSession({ ...current, built: last, history: current.history.slice(0, -1) });
    remember(current.id, current.brief, last, current.history.slice(0, -1));
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
    const version = viewVersion.current;

    if (
      file &&
      (file.type === "application/pdf" ||
        ((file.type === "" || file.type === "application/octet-stream") &&
          /\.pdf$/i.test(file.name)))
    ) {
      live(["Reading your drawing…"]);
      try {
        const drawn = await designFromDrawing(file, file.name.replace(/\.pdf$/i, ""), text);
        if (version !== viewVersion.current) return { text: "" };
        const id = crypto.randomUUID();
        setSession({ id, brief: drawn.name, drawing: drawn, history: [] });
        setDrawings((all) => [
          { id, title: drawn.name, model: drawn.model, editedAt: Date.now(), conversation: [] },
          ...all,
        ]);
        return {
          text: `Here is ${drawn.name}, drawn in 3D from your plan. You can view or export it.`,
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
          lines: buildSummary(built),
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
        text: `Built it: ${built.plan.rooms.length} rooms on ${built.plan.shell.w} × ${built.plan.shell.h} m. Tell me what to change.`,
        lines: [...buildSummary(built), ...remembered],
      };
    }

    if (learned?.onlyPreferences)
      return {
        text: "Done.",
        lines: [...remembered, "It applies to this design and to every one after it."],
      };

    live(["Working on it…"]);
    const result = await editByWords(text, current.built);
    if (version !== viewVersion.current) return { text: "" };
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
    viewVersion.current++;
    const saved = builds.find((b) => b.id === id);
    if (saved) {
      const built = finish(
        { program: saved.program, plan: saved.plan, seed: saved.seed, notes: saved.notes },
        0,
      );
      const history = (saved.history ?? []).map((h) => finish(h, 0));
      setSession({ id, brief: saved.brief, built, history });
      setConversation(
        saved.conversation?.length
          ? saved.conversation
          : [
              {
                id: crypto.randomUUID(),
                role: "icarus",
                text: `Opened “${saved.title}”. Tell me what to change.`,
              },
            ],
      );
      return;
    }
    const drawing = drawings.find((d) => d.id === id);
    if (!drawing) return;
    const shown = sceneFromModel(drawing.model);
    setSession({
      id,
      brief: drawing.title,
      drawing: {
        model: drawing.model,
        scene: shown.scene,
        labels: shown.labels,
        viewpoints: shown.viewpoints,
        name: drawing.title,
        lines: [],
      },
      history: [],
    });
    setConversation(
      drawing.conversation.length
        ? drawing.conversation
        : [{ id: crypto.randomUUID(), role: "icarus", text: `Opened “${drawing.title}”.` }],
    );
  };

  const fresh = () => {
    viewVersion.current++;
    setSession(undefined);
    setConversation([]);
  };

  const exportPlan = (): string => {
    const current = sessionRef.current;
    const model = current?.built?.model ?? current?.drawing?.model;
    if (!model) return "There is no plan to export yet.";
    try {
      const { dxf, skipped } = toDxf(model);
      const stem = (current?.brief ?? "building")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      saveFile(`icarus-${stem || "building"}-plan.dxf`, dxf, "application/dxf");
      return skipped.length
        ? `Downloaded a CAD plan (.dxf). Some parts were left out: ${skipped.slice(0, 2).join("; ")}.`
        : "Downloaded a CAD plan (.dxf).";
    } catch {
      return "I could not export this plan just now.";
    }
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
          w: r.rect.w,
          h: r.rect.h,
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
      builds={[...builds, ...drawings]
        .sort((a, b) => b.editedAt - a.editedAt)
        .map((b) => ({ id: b.id, title: b.title }))}
      activeId={session?.id}
      canEdit={Boolean(session?.built)}
      messages={conversation}
      setMessages={setConversation}
      starts={STARTS}
      onSend={respond}
      onNew={fresh}
      onOpen={open}
      onExportPlan={exportPlan}
    />
  );
}
