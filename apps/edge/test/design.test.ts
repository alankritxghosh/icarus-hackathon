import { readBrief } from "@icarus/core";
import { FakeMeta, MetaError } from "@icarus/meta";
import { describe, expect, it } from "vitest";
import {
  DESIGN_DEV_MODEL,
  handleEdit,
  handlePropose,
  handleRevise,
  type ModelSource,
  modelFromEnv,
} from "../src/design";

const BRIEF = "A 20-person design studio. Windows on the south wall, entrance on the west.";
const post = (path: string, body: unknown) =>
  new Request(`https://x${path}`, { method: "POST", body: JSON.stringify(body) });
const source =
  (fake: FakeMeta): ModelSource =>
  () => ({ api: fake, model: () => "fake-model" });

const GOOD_PROPOSAL = {
  meetingRooms: 2,
  phoneBooths: 1,
  addRooms: ["lounge"],
  preferences: { adjacent: [{ a: "kitchen", b: "lounge", weight: 2 }], apart: [], areaScale: {} },
  decisions: [{ topic: "lounge", choice: "add one", reason: "teams like a place to reset" }],
};
const program = () => readBrief(BRIEF).program;
const issue = {
  code: "room_small",
  severity: "warn",
  kinds: ["kitchen"],
  roomIds: ["kitchen.1"],
  measured: 0.7,
  target: 0.8,
  shortfall: 0.12,
  message: "Kitchen is 70% of its target size.",
};

describe("POST /api/design/propose", () => {
  it("returns a validated proposal and sends the rules and the stated facts to the model", async () => {
    const fake = new FakeMeta([{ json: GOOD_PROPOSAL }]);
    const res = await handlePropose(post("/api/design/propose", { brief: BRIEF }), source(fake));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      model: "fake-model",
      proposal: { meetingRooms: 2, addRooms: ["lounge"] },
    });
    const sent = fake.requests[0];
    expect(sent?.instructions).toContain("do NOT give coordinates");
    expect(sent?.instructions).toContain("0.6 m2 per person");
    expect(String(sent?.input)).toContain("headcount 20");
  });

  it("refuses an answer outside the schema without leaking it", async () => {
    const fake = new FakeMeta([
      { json: { ...GOOD_PROPOSAL, meetingRooms: 99, secret: "internal prompt text" } },
    ]);
    const res = await handlePropose(post("/api/design/propose", { brief: BRIEF }), source(fake));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("internal prompt text");
  });

  it("rejects bad input before calling the model", async () => {
    const fake = new FakeMeta([]);
    for (const body of [{}, { brief: "hi" }, { brief: "x".repeat(2000) }])
      expect((await handlePropose(post("/api/design/propose", body), source(fake))).status).toBe(
        400,
      );
    expect(
      (await handlePropose(new Request("https://x/api/design/propose"), source(fake))).status,
    ).toBe(405);
    expect(fake.requests).toHaveLength(0);
  });

  it("says plainly when no model is configured, busy, or unreachable", async () => {
    expect((await handlePropose(post("/", { brief: BRIEF }), () => undefined)).status).toBe(503);
    const busy = new FakeMeta([
      { error: new MetaError("rate_limited", "429", { retryable: true }) },
    ]);
    expect((await handlePropose(post("/", { brief: BRIEF }), source(busy))).status).toBe(429);
    const down = new FakeMeta([{ error: new MetaError("network", "boom") }]);
    const res = await handlePropose(post("/", { brief: BRIEF }), source(down));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});

describe("POST /api/design/revise", () => {
  const body = () => ({ program: program(), issues: [issue], round: 1 });

  it("returns a validated patch and shows the model the measured problems", async () => {
    const patch = {
      ops: [{ op: "scale_area", kind: "kitchen", factor: 1.2 }],
      reason: "The kitchen is short.",
    };
    const fake = new FakeMeta([{ json: patch }]);
    const res = await handleRevise(post("/api/design/revise", body()), source(fake));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ patch, model: "fake-model" });
    expect(String(fake.requests[0]?.input)).toContain("Kitchen is 70% of its target size.");
    expect(fake.requests[0]?.instructions).toContain("grow_shell");
  });

  it("refuses a patch with an operation outside the closed set", async () => {
    const fake = new FakeMeta([
      { json: { ops: [{ op: "delete_room", kind: "kitchen" }], reason: "x" } },
    ]);
    expect((await handleRevise(post("/", body()), source(fake))).status).toBe(502);
  });

  it("rejects malformed issues and rounds", async () => {
    const fake = new FakeMeta([]);
    for (const bad of [
      { ...body(), round: 0 },
      { ...body(), issues: [{ ...issue, code: "made_up" }] },
      { program: {}, issues: [], round: 1 },
    ])
      expect((await handleRevise(post("/", bad), source(fake))).status).toBe(400);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("modelFromEnv", () => {
  it("has no model without a key, and never exposes the key", () => {
    expect(modelFromEnv({})()).toBeUndefined();
    expect(modelFromEnv({ AI: {} })()).toBeUndefined();
    const found = modelFromEnv({
      OPENROUTER_API_KEY: "sk-or-secret",
      ICARUS_MODEL: "meta/muse-spark-1.3",
    })();
    expect(found?.model()).toBe("meta/muse-spark-1.3");
    expect(JSON.stringify({ model: found?.model() })).not.toContain("secret");
  });
});

describe("the default design model", () => {
  it("is the tested free model for OpenRouter, overridable, and not forced on the Meta API", () => {
    expect(modelFromEnv({ OPENROUTER_API_KEY: "sk-or-x" })()?.model()).toBe(DESIGN_DEV_MODEL);
    expect(
      modelFromEnv({
        OPENROUTER_API_KEY: "sk-or-x",
        ICARUS_MODEL: "meta/muse-spark-1.3",
      })()?.model(),
    ).toBe("meta/muse-spark-1.3");
    expect(modelFromEnv({ MODEL_API_KEY: "key" })()?.model()).toBe("muse-spark-1.3");
  });
});

describe("one re-ask on an invalid answer", () => {
  it("returns the second answer when the first did not match, and gives up after two", async () => {
    const recovers = new FakeMeta([{ json: { meetingRooms: 99 } }, { json: GOOD_PROPOSAL }]);
    expect((await handlePropose(post("/", { brief: BRIEF }), source(recovers))).status).toBe(200);
    expect(recovers.requests).toHaveLength(2);
    const stubborn = new FakeMeta([{ json: { meetingRooms: 99 } }, { json: { meetingRooms: 98 } }]);
    expect((await handlePropose(post("/", { brief: BRIEF }), source(stubborn))).status).toBe(502);
    expect(stubborn.requests).toHaveLength(2);
    const busy = new FakeMeta([
      { error: new MetaError("rate_limited", "429", { retryable: true }) },
    ]);
    expect((await handlePropose(post("/", { brief: BRIEF }), source(busy))).status).toBe(429);
    expect(busy.requests).toHaveLength(1);
  });
});

describe("POST /api/design/edit", () => {
  const body = () => ({
    text: "move the kitchen over to the right side",
    program: program(),
    rooms: [
      { id: "kitchen.1", name: "Kitchen", x: 4, y: 3 },
      { id: "lounge.1", name: "Lounge", x: 12, y: 8 },
    ],
    shell: { w: 20, h: 13 },
  });

  it("returns validated edit operations and tells the model the rooms and the closed set", async () => {
    const edit = { ops: [{ op: "move_room", room: "kitchen.1", to: "east" }] };
    const fake = new FakeMeta([{ json: edit }]);
    const res = await handleEdit(post("/api/design/edit", body()), source(fake));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ edit, model: "fake-model" });
    expect(fake.requests[0]?.instructions).toContain("lock_room");
    expect(fake.requests[0]?.instructions).toContain("resize_room");
    expect(fake.requests[0]?.instructions).toContain("no other kind of room can be added");
    expect(String(fake.requests[0]?.input)).toContain("Meeting rooms now:");
    expect(fake.requests[0]?.instructions).toContain("Never invent an operation");
    expect(String(fake.requests[0]?.input)).toContain('kitchen.1 "Kitchen"');
    expect(String(fake.requests[0]?.input)).toContain("Phone booths now:");
  });

  it("passes on the model's own statement that a request cannot be done", async () => {
    const edit = { ops: [], unsupported: "Adding rooms is not supported here." };
    const fake = new FakeMeta([{ json: edit }]);
    const res = await handleEdit(post("/api/design/edit", body()), source(fake));
    expect(await res.json()).toMatchObject({ edit });
  });

  it("refuses an invented operation without leaking the answer", async () => {
    const fake = new FakeMeta([
      { json: { ops: [{ op: "demolish", room: "kitchen.1" }], note: "internal prompt text" } },
      { json: { ops: [{ op: "demolish", room: "kitchen.1" }] } },
    ]);
    const res = await handleEdit(post("/api/design/edit", body()), source(fake));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("internal prompt text");
  });

  it("rejects bad input before calling the model", async () => {
    const fake = new FakeMeta([]);
    for (const bad of [{ ...body(), text: "" }, { ...body(), text: "x".repeat(500) }, {}])
      expect((await handleEdit(post("/", bad), source(fake))).status).toBe(400);
    expect((await handleEdit(post("/", body()), () => undefined)).status).toBe(503);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("the provider setting and the paid route", () => {
  const BOTH = { OPENROUTER_API_KEY: "sk-or-x", MODEL_API_KEY: "meta-key" };
  const FREE = DESIGN_DEV_MODEL;

  it("ICARUS_PROVIDER picks the route when both keys are present; without it nothing changes", () => {
    expect(modelFromEnv(BOTH)()?.model()).toBe(FREE);
    expect(modelFromEnv({ ...BOTH, ICARUS_PROVIDER: "openrouter" })()?.model()).toBe(FREE);
    expect(modelFromEnv({ ...BOTH, ICARUS_PROVIDER: "meta" })()?.model()).toBe("muse-spark-1.3");
    expect(
      modelFromEnv({ ...BOTH, ICARUS_PROVIDER: "meta", ICARUS_MODEL: "muse-spark-2" })()?.model(),
    ).toBe("muse-spark-2");
  });

  it("asking for Meta without its key, or with a typo, gives no model instead of the wrong one", () => {
    expect(
      modelFromEnv({ OPENROUTER_API_KEY: "sk-or-x", ICARUS_PROVIDER: "meta" })(),
    ).toBeUndefined();
    expect(modelFromEnv({ ...BOTH, ICARUS_PROVIDER: "metta" })()).toBeUndefined();
  });

  it("the Meta route refuses to run without a spending limit and prices, and says why", async () => {
    const found = modelFromEnv({ MODEL_API_KEY: "meta-key", ICARUS_PROVIDER: "meta" })();
    const res = await handlePropose(post("/api/design/propose", { brief: BRIEF }), () => found);
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).toContain("budget");
  });
});
