import { type Scene, type Viewpoint, viewpoints } from "@icarus/core";
import {
  type AccountLesson,
  type DrawingEvidence,
  modelWithRoomTraces,
  moveDrawingWall,
  type RoomTrace,
  SpatialModel,
  sceneFromModel,
  toDxf,
} from "@icarus/spatial/model";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLessons, saveLessons } from "./accountLessons";
import { buildSummary } from "./buildSummary";
import { assessCompletion } from "./completion";
import { type Built, builtFromRefine, finish, readPhotoDesign } from "./design";
import { designFromBrief, refineProgram } from "./designLoop";
import { saveFile } from "./download";
import {
  DrawingError,
  type DrawnDesign,
  designFromDrawing,
  designFromDrawings,
} from "./drawingDesign";
import { editByWords } from "./editByWords";
import { RenderError, readPhoto } from "./photo";
import { acceptLargerShell, wantsLargerShell } from "./recovery";
import type { Reference } from "./references";
import { type Message, type Reply, Studio } from "./Studio";
import {
  loadBuilds,
  loadDrawings,
  type SavedBuild,
  type SavedDrawing,
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
  drawingHistory?: { model: SpatialModel; evidence: DrawingEvidence }[];
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

  const updateTraces = (traces: RoomTrace[]) => {
    const current = sessionRef.current;
    const drawing = current?.drawing;
    if (!current || !drawing?.baseModel) return false;
    try {
      const model = modelWithRoomTraces(drawing.baseModel, traces);
      const shown = sceneFromModel(model);
      setSession({ ...current, drawing: { ...drawing, model, traces, ...shown } });
      setConversation((messages) =>
        messages.map((message) =>
          message.role === "icarus" && message.text.startsWith("Here is a two-floor draft")
            ? {
                ...message,
                text: `Built ${traces.length} named spaces across both floors from the plan outlines.`,
                lines: [
                  "Room outlines and walls are estimated from the visible sheets; doors and untraced areas still need review.",
                ],
              }
            : message,
        ),
      );
      setDrawings((all) =>
        all.map((saved) =>
          saved.id === current.id ? { ...saved, model, traces, editedAt: Date.now() } : saved,
        ),
      );
      return true;
    } catch {
      return false;
    }
  };

  const traceRoom = (trace: RoomTrace) => {
    const previous = sessionRef.current?.drawing?.traces ?? [];
    return updateTraces([...previous.filter((item) => item.id !== trace.id), trace]);
  };

  const undoTrace = () => {
    const previous = sessionRef.current?.drawing?.traces ?? [];
    if (previous.length) updateTraces(previous.slice(0, -1));
  };

  const respond = async (
    text: string,
    files: File[] | undefined,
    live: (lines: string[]) => void,
  ): Promise<Reply> => {
    const current = sessionRef.current;
    const version = viewVersion.current;

    if (files?.length === 1 && /\.icarus\.json$/i.test(files[0]?.name ?? "")) {
      try {
        if ((files[0] as File).size > 8_000_000) throw new Error("project too large");
        const raw = JSON.parse(await (files[0] as File).text()) as SavedDrawing;
        const parsed = SpatialModel.safeParse(raw.model);
        const base = SpatialModel.safeParse(raw.baseModel);
        if (
          !parsed.success ||
          !base.success ||
          !Array.isArray(raw.plans) ||
          !Array.isArray(raw.traces) ||
          raw.plans.length !== base.data.levels.length ||
          raw.traces.length > 200 ||
          !raw.traces.every(
            (trace) =>
              typeof trace.id === "string" &&
              typeof trace.levelId === "string" &&
              typeof trace.name === "string" &&
              Array.isArray(trace.rect) &&
              trace.rect.length === 4 &&
              trace.rect.every((value) => typeof value === "number" && Number.isFinite(value)),
          ) ||
          !raw.plans.every(
            (plan) =>
              typeof plan.levelId === "string" &&
              base.data.levels.some((level) => level.id === plan.levelId) &&
              typeof plan.name === "string" &&
              typeof plan.image === "string" &&
              plan.image.startsWith("data:image/png;base64,") &&
              plan.image.length < 4_000_000 &&
              Number.isFinite(plan.pageWidth) &&
              plan.pageWidth > 0 &&
              Number.isFinite(plan.pageHeight) &&
              plan.pageHeight > 0 &&
              Number.isFinite(plan.unitMm) &&
              plan.unitMm > 0 &&
              Array.isArray(plan.offsetMm) &&
              plan.offsetMm.length === 2 &&
              plan.offsetMm.every(Number.isFinite) &&
              Array.isArray(plan.labels) &&
              plan.labels.every(
                (label) =>
                  typeof label.id === "string" &&
                  typeof label.name === "string" &&
                  Number.isFinite(label.x) &&
                  Number.isFinite(label.y),
              ),
          )
        )
          throw new Error("invalid project");
        modelWithRoomTraces(base.data, raw.traces);
        if (version !== viewVersion.current) return { text: "" };
        const id = crypto.randomUUID();
        const shown = sceneFromModel(parsed.data);
        const title = typeof raw.title === "string" ? raw.title : "Imported building";
        const saved: SavedDrawing = {
          id,
          title,
          model: parsed.data,
          baseModel: base.data,
          plans: raw.plans,
          traces: raw.traces,
          editedAt: Date.now(),
          conversation: [],
        };
        setSession({
          id,
          brief: title,
          drawing: {
            ...shown,
            model: parsed.data,
            baseModel: base.data,
            plans: raw.plans,
            traces: raw.traces,
            name: title,
            lines: [],
          },
          history: [],
          drawingHistory: [],
        });
        setDrawings((all) => [saved, ...all]);
        return {
          text: `Opened ${title}. The reviewed rooms and source plans are ready in Plan and 3D.`,
        };
      } catch {
        return { text: "I could not open that Icarus project file." };
      }
    }

    const isPdf = (file: File) =>
      file.type === "application/pdf" ||
      ((file.type === "" || file.type === "application/octet-stream") && /\.pdf$/i.test(file.name));
    if (files?.length && files.every(isPdf)) {
      live(["Reading your drawing…"]);
      try {
        if (files.length > 2)
          return { text: "Attach one floor plan or two floors of the same building at a time." };
        const drawn =
          files.length === 2
            ? await designFromDrawings(files, text)
            : await designFromDrawing(
                files[0] as File,
                (files[0] as File).name.replace(/\.pdf$/i, ""),
                text,
              );
        if (version !== viewVersion.current) return { text: "" };
        const id = crypto.randomUUID();
        setSession({ id, brief: drawn.name, drawing: drawn, history: [], drawingHistory: [] });
        setDrawings((all) => [
          {
            id,
            title: drawn.name,
            model: drawn.model,
            baseModel: drawn.baseModel,
            plans: drawn.plans,
            traces: drawn.traces,
            evidence: drawn.evidence,
            sourceEvidence: drawn.evidence,
            history: [],
            editedAt: Date.now(),
            conversation: [],
          },
          ...all,
        ]);
        const [roomA, roomB] = drawn.model.spaces;
        const example =
          drawn.model.spaces.length === 2 && roomA && roomB
            ? ` Try “move the wall between ${roomA.name.toLowerCase()} and ${roomB.name.toLowerCase()} 0.5 m toward ${roomB.name.toLowerCase()}”.`
            : "";
        return {
          text: drawn.evidence
            ? `Here is ${drawn.name}, drawn in 3D from your plan. You can move a wall between two enclosed rooms, then undo it.${example}`
            : `Here is a two-floor draft from ${drawn.name}.`,
          lines: drawn.lines,
        };
      } catch (error) {
        return {
          text: error instanceof DrawingError ? error.message : "I could not read that drawing.",
        };
      }
    }

    if (files?.length) {
      if (files.length !== 1) return { text: "Attach one photo or two PDF floor plans together." };
      const file = files[0] as File;
      const reference: Reference = {
        id: "upload",
        src: URL.createObjectURL(file),
        title: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Your photo",
        credit: "Your photo, used only here",
      };
      try {
        const built = await buildFrom({ kind: "photo", reference }, undefined, live);
        const status = assessCompletion(built);
        return {
          text: `${status.complete ? "Designed" : "Drafted"} an office in the style of your photo: ${built.plan.rooms.length} rooms on ${built.plan.shell.w} × ${built.plan.shell.h} m.`,
          lines: [...buildSummary(built), ...status.lines],
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

    if (current?.drawing) {
      const drawn = current.drawing;
      if (/^(?:save|download|export)(?: my| this)? project[.!?]?$/i.test(text.trim())) {
        const saved = drawings.find((item) => item.id === current.id);
        if (!saved) return { text: "I could not save this project just now." };
        saveFile(
          `${current.brief.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.icarus.json`,
          JSON.stringify(saved),
          "application/json",
        );
        return { text: "Downloaded an Icarus project file. Attach it later to continue." };
      }
      if (/^(?:undo|go back|revert)(?:\s+(?:that|last change))?[.!?]?$/i.test(text.trim())) {
        if (drawn.traces?.length) {
          undoTrace();
          return { text: "Undid the last room outline." };
        }
        const prior = current.drawingHistory?.at(-1);
        if (!prior) return { text: "There is nothing to undo." };
        const shown = sceneFromModel(prior.model);
        const nextDrawing = { ...drawn, model: prior.model, evidence: prior.evidence, ...shown };
        const history = current.drawingHistory?.slice(0, -1) ?? [];
        setSession({ ...current, drawing: nextDrawing, drawingHistory: history });
        setDrawings((all) =>
          all.map((d) =>
            d.id === current.id
              ? {
                  ...d,
                  model: prior.model,
                  evidence: prior.evidence,
                  history,
                  editedAt: Date.now(),
                }
              : d,
          ),
        );
        return { text: "Undid the wall move." };
      }
      if (!drawn.evidence)
        return { text: "Reattach this plan to edit it; this saved copy predates drawing edits." };
      const changed = moveDrawingWall(drawn.model, drawn.evidence, text);
      if ("reason" in changed) return { text: "I could not do that.", lines: [changed.reason] };
      const { evidence, model, message } = changed.moved;
      const shown = sceneFromModel(model);
      const nextDrawing = { ...drawn, model, evidence, ...shown };
      const history = [
        ...(current.drawingHistory ?? []),
        { model: drawn.model, evidence: drawn.evidence },
      ].slice(-20);
      setSession({ ...current, drawing: nextDrawing, drawingHistory: history });
      setDrawings((all) =>
        all.map((d) =>
          d.id === current.id ? { ...d, model, evidence, history, editedAt: Date.now() } : d,
        ),
      );
      return { text: "Done.", lines: [message] };
    }

    if (!current?.built) {
      if (learned?.onlyPreferences)
        return { text: "Noted. Now tell me what to build.", lines: remembered };
      const built = await buildFrom({ kind: "brief", text }, undefined, live);
      const status = assessCompletion(built);
      return {
        text: `${status.complete ? "Built it" : "Made a draft"}: ${built.plan.rooms.length} rooms on ${built.plan.shell.w} × ${built.plan.shell.h} m. Tell me what to change.`,
        lines: [...buildSummary(built), ...status.lines, ...remembered],
      };
    }

    if (learned?.onlyPreferences)
      return {
        text: "Done.",
        lines: [...remembered, "It applies to this design and to every one after it."],
      };

    if (wantsLargerShell(text)) {
      live(["Checking a larger shell…"]);
      const result = acceptLargerShell(current.built);
      if (version !== viewVersion.current) return { text: "" };
      if ("reason" in result) return { text: "I could not do that.", lines: [result.reason] };
      change(current, result.built);
      return { text: "Done.", lines: [result.line, ...buildSummary(result.built)] };
    }

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
        baseModel: drawing.baseModel,
        plans: drawing.plans,
        traces: drawing.traces,
        evidence: drawing.evidence,
        scene: shown.scene,
        labels: shown.labels,
        viewpoints: shown.viewpoints,
        name: drawing.title,
        lines: [],
      },
      history: [],
      drawingHistory: drawing.history ?? [],
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
      canEdit={Boolean(session?.built || session?.drawing?.evidence)}
      plainExport={Boolean(session?.drawing && session.drawing.model.levels.length > 1)}
      plans={session?.drawing?.plans}
      traces={session?.drawing?.traces}
      onTraceRoom={traceRoom}
      onUndoTrace={undoTrace}
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
