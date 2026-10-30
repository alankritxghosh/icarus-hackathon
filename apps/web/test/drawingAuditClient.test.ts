import { ProgramSchema } from "@icarus/core";
import { fromFloorPlan } from "@icarus/spatial/model";
import { describe, expect, it } from "vitest";
import { rebuild } from "../src/design";
import { checkAgainstDrawing, DrawingError, readDrawingViews } from "../src/drawingAuditClient";

const program = ProgramSchema.parse({
  company: { headcount: 8 },
  shell: { widthM: 12, depthM: 9, windows: ["north"], entrance: "south" },
  rooms: [
    { kind: "open_workspace" },
    { kind: "meeting_room", capacity: 4 },
    { kind: "restroom" },
    { kind: "reception" },
  ],
});
const built = rebuild(program, 1, []);

// A "drawing" of the design itself, at 1:100 (35.2778 mm per unit): the wiring test, not a test of the extractor.
const MM = (25.4 / 72) * 100;
const BROWN = "rgb(80.39%, 41.18%, 15.68%)";
function sheetOf(skipWall?: string) {
  const model = fromFloorPlan(built.plan, { program: built.program });
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    `M ${x0 / MM} ${y0 / MM} L ${x1 / MM} ${y0 / MM} L ${x1 / MM} ${y1 / MM} L ${x0 / MM} ${y1 / MM} Z`;
  const paths = model.walls
    .filter(
      (w) => w.kind !== "virtual" && w.id !== skipWall && (w.a.x === w.b.x || w.a.y === w.b.y),
    )
    .map((w) => {
      const h = w.thicknessMm / 2;
      const horizontal = w.a.y === w.b.y;
      const r = horizontal
        ? rect(Math.min(w.a.x, w.b.x) - h, w.a.y - h, Math.max(w.a.x, w.b.x) + h, w.a.y + h)
        : rect(w.a.x - h, Math.min(w.a.y, w.b.y) - h, w.a.x + h, Math.max(w.a.y, w.b.y) + h);
      return `<path fill-rule="nonzero" fill="${BROWN}" fill-opacity="1" d="${r}"/>`;
    });
  const words = model.spaces
    .filter((s) => !s.kind.startsWith("circulation"))
    .map((s) => {
      const xs = s.boundary.outer.map((v) => v.x);
      const ys = s.boundary.outer.map((v) => v.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 / MM;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2 / MM;
      const text = s.name.replace(/&/g, "&amp;");
      return `<flow><block xMin="${cx - 10}" yMin="${cy - 3}" xMax="${cx + 10}" yMax="${cy + 3}"><line xMin="${cx - 10}" yMin="${cy - 3}" xMax="${cx + 10}" yMax="${cy + 3}"><word xMin="${cx - 10}" yMin="${cy - 3}" xMax="${cx + 10}" yMax="${cy + 3}">${text}</word></line></block></flow>`;
    });
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg">${paths.join("")}</svg>`,
    bboxHtml: `<doc><page>${words.join("")}</page></doc>`,
  };
}
const serve = (views: { svg: string; bboxHtml: string }, status = 200) =>
  (async () =>
    status === 200
      ? Response.json({ ...views, page: 1 })
      : new Response("no", { status })) as unknown as typeof fetch;
const file = new Blob(["%PDF-1.4"], { type: "application/pdf" });

describe("readDrawingViews", () => {
  it("turns the server's refusals into sentences a person can act on", async () => {
    for (const [status, text] of [
      [400, /PDF/],
      [413, /too large/],
      [422, /could not be read/],
      [503, /not set up/],
    ] as const)
      await expect(
        readDrawingViews(file, 1, serve({ svg: "", bboxHtml: "" }, status)),
      ).rejects.toThrow(text);
    await expect(
      readDrawingViews(file, 1, (async () => {
        throw new Error("offline");
      }) as never),
    ).rejects.toThrow(/could not be reached/);
  });
});

describe("checkAgainstDrawing", () => {
  it("passes a design against a drawing of itself, and reports the scale it used", async () => {
    const items = await checkAgainstDrawing(file, "sheet.pdf", 100, built, {
      send: serve(sheetOf()),
    });
    const audit = items.find((i) => i.id === "drawing-audit");
    expect(audit?.status, JSON.stringify(items)).toBe("ok");
    expect(items.find((i) => i.id === "drawing-read")?.detail).toContain("1:100");
    expect(items.some((i) => i.id === "drawing-not-checked")).toBe(true);
  });

  it("names the difference when the drawing has a wall the design left out", async () => {
    const model = fromFloorPlan(built.plan, { program: built.program });
    const victim = model.walls.find(
      (w) => w.kind === "interior" && (w.a.x === w.b.x || w.a.y === w.b.y),
    );
    const items = await checkAgainstDrawing(file, "sheet.pdf", 100, built, {
      send: serve(sheetOf(victim?.id)),
    });
    expect(items.find((i) => i.id === "drawing-audit")?.status).toBe("fail");
    expect(items.map((i) => i.detail).join(" ")).toMatch(/not drawn on the sheet/);
  });

  it("asks for a sensible scale and refuses a drawing with no walls", async () => {
    await expect(
      checkAgainstDrawing(file, "s.pdf", 0, built, { send: serve(sheetOf()) }),
    ).rejects.toThrow(DrawingError);
    await expect(
      checkAgainstDrawing(file, "s.pdf", 100, built, {
        send: serve({ svg: "<svg/>", bboxHtml: "<doc/>" }),
      }),
    ).rejects.toThrow(/no wall fill found/);
  });
});
