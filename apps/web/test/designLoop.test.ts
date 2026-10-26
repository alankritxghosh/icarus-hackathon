import { describe, expect, it } from "vitest";
import { designFromBrief } from "../src/designLoop";

const BRIEF =
  "A 30-person firm with three meeting rooms, kitchen, lounge, reception, storage. 24 m by 15 m shell, windows on the west wall, entrance on the east.";
const OPEN = "A 20-person design studio. Windows on the south wall, entrance on the west.";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status });

type Handler = (path: string, body: Record<string, unknown>) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: String(input), body });
    return handler(String(input), body);
  }) as typeof fetch;
  return { fetcher, calls };
}

const PROPOSAL = {
  addRooms: ["lounge"],
  meetingRooms: 4,
  preferences: { adjacent: [{ a: "kitchen", b: "lounge", weight: 2 }], apart: [], areaScale: {} },
  decisions: [{ topic: "lounge", choice: "add one", reason: "a place to reset" }],
};

describe("designFromBrief", () => {
  it("merges the model's proposal without overriding a stated fact, and shows what it decided", async () => {
    const net = fakeFetch((path) =>
      path.endsWith("/propose")
        ? ok({ proposal: PROPOSAL, model: "test-model" })
        : fail(502, "the model's answer did not match what Icarus needs"),
    );
    const out = await designFromBrief(BRIEF, { fetcher: net.fetcher });
    expect(out.trace.proposal).toBe("model");
    expect(out.trace.model).toBe("test-model");
    // The brief states three meeting rooms; the proposal's four is refused and the refusal is recorded.
    expect(out.program.rooms.find((r) => r.kind === "meeting_room")?.count).toBe(3);
    expect(out.trace.ignored.join(" ")).toMatch(/states the number of meeting rooms/);
    expect(out.trace.decisions[0]?.topic).toBe("lounge");
    expect(out.notes.join(" ")).toContain("a place to reset");
    expect(out.refine.best.cost).toBeLessThanOrEqual(out.refine.baseline.cost);
  }, 120_000);

  it("falls back to the rules, and says why, when the model service is not configured", async () => {
    const net = fakeFetch(() => fail(503, "no model is configured"));
    const out = await designFromBrief(OPEN, { fetcher: net.fetcher });
    expect(out.trace.proposal).toBe("rules");
    expect(out.trace.note).toMatch(/no model is configured/);
    expect(net.calls.map((c) => c.path)).toEqual(["/api/design/propose"]); // no revise calls once it is known to be down
    expect(out.refine.best.plan.rooms.length).toBeGreaterThan(3);
  }, 120_000);

  it("survives a network failure and an unusable answer", async () => {
    const down = await designFromBrief(OPEN, {
      fetcher: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });
    expect(down.trace.proposal).toBe("rules");
    expect(down.trace.note).toMatch(/not reachable/);
    const junk = fakeFetch(() => ok({ proposal: { meetingRooms: 99 } }));
    const out = await designFromBrief(OPEN, { fetcher: junk.fetcher });
    expect(out.trace.proposal).toBe("rules");
    expect(out.trace.note).toMatch(/not usable/);
  }, 120_000);

  it("uses the model's revisions only when they measure as improvements, and counts them", async () => {
    const net = fakeFetch((path) =>
      path.endsWith("/propose")
        ? ok({ proposal: { decisions: [] }, model: "m" })
        : ok({
            patch: {
              ops: [{ op: "prefer_adjacent", a: "lounge", b: "kitchen", weight: 2 }],
              reason: "keep them together",
            },
            model: "m",
          }),
    );
    const out = await designFromBrief(BRIEF, { fetcher: net.fetcher });
    expect(out.trace.revisions.asked).toBeGreaterThan(0);
    expect(out.trace.revisions.valid).toBe(out.trace.revisions.asked);
    expect(out.trace.revisions.used).toBeLessThanOrEqual(out.trace.revisions.valid);
    for (const call of net.calls.filter((c) => c.path.endsWith("/revise"))) {
      expect(Array.isArray(call.body.issues)).toBe(true);
      expect(call.body.round).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);

  it("makes no network calls at all when the model is turned off", async () => {
    const net = fakeFetch(() => ok({}));
    const out = await designFromBrief(OPEN, { fetcher: net.fetcher, useModel: false });
    expect(net.calls).toHaveLength(0);
    expect(out.trace.proposal).toBe("rules");
  }, 120_000);
});

describe("the model's additions are measured before they are used", () => {
  it("does not leave the starting plan worse than the rules alone would have", async () => {
    const TIGHT =
      "A 40-person agency with four meeting rooms, a kitchen, lounge, reception, storage. 26 m by 17 m shell, windows on the south and east walls, entrance on the west.";
    const { evaluateProgram, readBrief } = await import("@icarus/core");
    const greedy = {
      addRooms: ["private_office", "server_room"],
      preferences: { adjacent: [], apart: [], areaScale: {} },
      decisions: [
        { topic: "extras", choice: "add an office and a server room", reason: "nice to have" },
      ],
    };
    const net = fakeFetch((path) =>
      path.endsWith("/propose") ? ok({ proposal: greedy, model: "m" }) : fail(502, "no revision"),
    );
    const out = await designFromBrief(TIGHT, { fetcher: net.fetcher });
    const rulesOnly = evaluateProgram(readBrief(TIGHT).program, { seeds: [1, 2] });
    expect(out.refine.baseline.cost).toBeLessThanOrEqual(rulesOnly.cost + 0.5 + 1e-9);
    if (out.trace.vetoed.length) expect(out.trace.vetoed.join(" ")).toMatch(/measured worse/);
  }, 180_000);
});

describe("decisions about rooms that were set aside", () => {
  it("are shown as not used and are not recorded as assumptions", async () => {
    const TIGHT =
      "A 40-person agency with four meeting rooms, a kitchen, lounge, reception, storage. 26 m by 17 m shell, windows on the south and east walls, entrance on the west.";
    const proposal = {
      addRooms: ["private_office", "server_room"],
      preferences: { adjacent: [], apart: [], areaScale: {} },
      decisions: [
        { topic: "private office", choice: "add one", reason: "quiet calls" },
        { topic: "server room", choice: "add one", reason: "tooling" },
        { topic: "meeting rooms", choice: "keep four", reason: "stated" },
      ],
    };
    const net = fakeFetch((path) =>
      path.endsWith("/propose") ? ok({ proposal, model: "m" }) : fail(502, "none"),
    );
    const out = await designFromBrief(TIGHT, { fetcher: net.fetcher });
    const dropped = out.trace.vetoed.length > 0;
    for (const d of out.trace.decisions) {
      const aboutExtras = /private office|server room/.test(d.topic);
      if (dropped && aboutExtras) {
        expect(d.used, d.topic).toBe(false);
        expect(out.notes.join(" ")).not.toContain(`${d.topic}: ${d.choice}`);
      }
      if (!aboutExtras) expect(d.used, d.topic).toBe(true);
    }
  }, 180_000);
});
