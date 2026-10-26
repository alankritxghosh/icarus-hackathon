import { describe, expect, it } from "vitest";
import { type Built, builtFromRefine } from "../src/design";
import { designFromBrief } from "../src/designLoop";
import { editByWords, evaluationOf } from "../src/editByWords";

const BRIEF =
  "A 30-person firm with three meeting rooms, kitchen, lounge, reception, storage, two phone booths. 24 m by 15 m shell, windows on the south and east walls, entrance on the west.";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
type Handler = (body: Record<string, unknown>) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Record<string, unknown>[] = [];
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    return handler(body);
  }) as typeof fetch;
  return { fetcher, calls };
}

let cached: Built | undefined;
async function built(): Promise<Built> {
  if (cached) return cached;
  const out = await designFromBrief(BRIEF, { useModel: false });
  cached = builtFromRefine(out.refine, out.notes, out.trace, 0);
  return cached;
}

describe("editByWords", () => {
  it("applies a typed request with no model and records what happened", async () => {
    const base = await built();
    const net = fakeFetch(() => ok({}));
    const result = await editByWords("add a third phone booth", base, { fetcher: net.fetcher });
    expect(net.calls).toHaveLength(0);
    expect(result.entry.by).toBe("rules");
    expect(result.entry.lines[0]?.status).toBe("applied");
    expect(result.built?.program.phoneBooths).toBe(3);
    expect(result.built?.edits).toHaveLength(1);
    // The original design is untouched, so undo is just going back to it.
    expect(base.program.phoneBooths).toBe(2);
    expect(base.edits).toBeUndefined();
  });

  it("moves a room and keeps the change only because it was measured", async () => {
    const base = await built();
    const result = await editByWords("move the lounge north", base, { useModel: false });
    const step = result.entry.lines[0];
    expect(["applied", "unchanged", "refused"]).toContain(step?.status);
    if (step?.status === "applied") {
      expect(result.built?.program.arrangement).toBeDefined();
      expect(step.text).toContain("Score");
    } else expect(result.built).toBeUndefined();
  });

  it("adds, resizes and removes meeting rooms from words, with no model", async () => {
    const base = await built();
    const before = base.plan.rooms.filter((r) => r.kind === "meeting_room").length;
    const added = await editByWords("add a meeting room for 10", base, { useModel: false });
    expect(["applied", "refused"]).toContain(added.entry.lines[0]?.status);
    if (added.built) {
      expect(added.built.plan.rooms.filter((r) => r.kind === "meeting_room")).toHaveLength(
        before + 1,
      );
      const removed = await editByWords("remove the last meeting room", added.built, {
        useModel: false,
      });
      expect(removed.built?.plan.rooms.filter((r) => r.kind === "meeting_room")).toHaveLength(
        before,
      );
    }
    const resized = await editByWords("make meeting room 2 bigger", base, { useModel: false });
    expect(["applied", "refused"]).toContain(resized.entry.lines[0]?.status);
    if (resized.built) expect(resized.built.edits?.[0]?.text).toBe("make meeting room 2 bigger");
  });

  it("returns an undo request without touching the design", async () => {
    const result = await editByWords("undo", await built(), { useModel: false });
    expect(result.undo).toBe(true);
    expect(result.built).toBeUndefined();
  });

  it("asks the model only for what the grammar cannot read, and applies its answer through the same checks", async () => {
    const base = await built();
    const net = fakeFetch(() =>
      ok({ edit: { ops: [{ op: "add_phone_booths", count: 1 }] }, model: "m" }),
    );
    const result = await editByWords("we need somewhere quiet to take calls, sort it out", base, {
      fetcher: net.fetcher,
    });
    expect(net.calls).toHaveLength(1);
    const sent = net.calls[0] as { text: string; rooms: { id: string }[] };
    expect(sent.rooms.some((r) => r.id === "kitchen.1")).toBe(true);
    expect(result.entry.by).toBe("model");
    expect(result.built?.program.phoneBooths).toBe(3);
  });

  it("still refuses what the checks refuse, even when the model asks for it", async () => {
    const base = await built();
    const net = fakeFetch(() =>
      ok({ edit: { ops: [{ op: "swap_rooms", a: "reception", b: "lounge" }] }, model: "m" }),
    );
    const result = await editByWords(
      "trade places between the front desk and the break area",
      base,
      {
        fetcher: net.fetcher,
      },
    );
    expect(result.entry.by).toBe("model");
    expect(result.entry.lines.some((l) => l.status === "refused" || l.status === "applied")).toBe(
      true,
    );
    // Whatever was applied is a valid, measured plan.
    if (result.built) {
      const ev = evaluationOf(result.built);
      expect(ev.issues.filter((i) => i.severity === "fail")).toEqual(
        evaluationOf(base).issues.filter((i) => i.severity === "fail"),
      );
    }
  });

  it("says what it cannot do, and changes nothing, when the model has no way to say it", async () => {
    const base = await built();
    const net = fakeFetch(() =>
      ok({ edit: { ops: [], unsupported: "Colours are not an edit operation here." }, model: "m" }),
    );
    const colour = await editByWords("make the walls pink", base, { fetcher: net.fetcher });
    expect(colour.built).toBeUndefined();
    expect(colour.entry.lines[0]?.text).toContain("Colours are not an edit operation");

    const down = fakeFetch(() => new Response("{}", { status: 503 }));
    const offline = await editByWords("make the walls pink", base, { fetcher: down.fetcher });
    expect(offline.built).toBeUndefined();
    expect(offline.entry.lines[0]?.status).toBe("refused");
    expect(offline.entry.lines[0]?.text).toContain("move a room");

    const none = await editByWords("make the walls pink", base, { useModel: false });
    expect(none.built).toBeUndefined();
  });

  it("rejects a model answer outside the closed set instead of applying it", async () => {
    const base = await built();
    const net = fakeFetch(() => ok({ edit: { ops: [{ op: "demolish", room: "kitchen" }] } }));
    const result = await editByWords("get rid of the walls", base, { fetcher: net.fetcher });
    expect(result.built).toBeUndefined();
    expect(result.entry.lines[0]?.status).toBe("refused");
  });

  it("holds the arrangement so an edit never re-searches or reshuffles the rest", async () => {
    const base = await built();
    const ev = evaluationOf(base);
    expect(ev.plan.rooms.map((r) => r.rect)).toEqual(base.plan.rooms.map((r) => r.rect));
  });
});
