import { describe, expect, it } from "vitest";
import {
  DrawingError,
  designFromDrawing,
  readDrawingViews,
  scaleInText,
} from "../src/drawingDesign";

const BROWN = "rgb(80.39%, 41.18%, 15.68%)";
const wall = (x0: number, y0: number, x1: number, y1: number) =>
  `<path fill="${BROWN}" fill-opacity="1" d="M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z"/>`;
// A 6 m x 4 m house at 1:100 (35.28 mm per unit) with a doorway in the middle wall and a label for each room.
const U = (25.4 / 72) * 100;
const mm = (v: number) => v / U;
const svg = `<svg xmlns="http://www.w3.org/2000/svg">${[
  [0, 0, 6000, 200],
  [0, 3800, 6000, 4000],
  [0, 0, 200, 4000],
  [5800, 0, 6000, 4000],
  [2900, 200, 3100, 1000],
  [2900, 2000, 3100, 3800],
]
  .map(([a, b, c, d]) =>
    wall(mm(a as number) + 50, mm(b as number) + 50, mm(c as number) + 50, mm(d as number) + 50),
  )
  .join("")}</svg>`;
const word = (t: string, x: number, y: number) =>
  `<flow><block xMin="${x - 10}" yMin="${y - 3}" xMax="${x + 10}" yMax="${y + 3}"><line xMin="${x - 10}" yMin="${y - 3}" xMax="${x + 10}" yMax="${y + 3}"><word xMin="${x - 10}" yMin="${y - 3}" xMax="${x + 10}" yMax="${y + 3}">${t}</word></line></block></flow>`;
const bbox = `<doc><page>${word("BEDROOM", mm(1500) + 50, mm(2000) + 50)}${word("KITCHEN", mm(4400) + 50, mm(2000) + 50)}</page></doc>`;
const serve = (status = 200) =>
  (async () =>
    status === 200
      ? Response.json({ svg, bboxHtml: bbox, page: 1 })
      : new Response("no", { status })) as unknown as typeof fetch;
const pdf = new Blob(["%PDF-1.4"], { type: "application/pdf" });

describe("a scale said in words", () => {
  it("reads the common ways of saying it", () => {
    expect(scaleInText("scale 1:100")).toBe(100);
    expect(scaleInText("it is 1 / 50")).toBe(50);
    expect(scaleInText("drawn at 1 to 200")).toBe(200);
    expect(scaleInText("a 35 person studio")).toBeUndefined();
    expect(scaleInText("1:1")).toBeUndefined();
  });
});

describe("reading a drawing in the chat", () => {
  it("turns the server's refusals into sentences", async () => {
    await expect(readDrawingViews(pdf, 1, serve(503))).rejects.toThrow(/not set up/);
    await expect(readDrawingViews(pdf, 1, serve(429))).rejects.toThrow(/Too many/);
  });

  it("draws the building in 3D and says plainly what it read, what it added and what it left out", async () => {
    const d = await designFromDrawing(pdf, "house", "1:100", serve());
    expect(d.scene.shell.w).toBeCloseTo(6, 0);
    expect(d.scene.nodes.some((n) => n.type === "wall")).toBe(true);
    expect(d.scene.nodes.some((n) => n.type === "furniture")).toBe(true);
    const said = d.lines.join(" ");
    expect(said).toMatch(/Scale 1:100, as you said/);
    expect(said).toMatch(/walls and 1 door or window/);
    expect(said).toMatch(/I furnished .*BEDROOM.*KITCHEN|I furnished .*KITCHEN.*BEDROOM/);
    expect(said).toMatch(/Every other room is as drawn/);
    expect(d.viewpoints).toHaveLength(1);
  });

  it("asks for the scale when the sheet gives none and none was said", async () => {
    await expect(designFromDrawing(pdf, "house", "", serve())).rejects.toThrow(DrawingError);
    await expect(designFromDrawing(pdf, "house", "", serve())).rejects.toThrow(/Tell me the scale/);
  });

  it("refuses a drawing with no walls", async () => {
    const empty = (async () =>
      Response.json({ svg: "<svg/>", bboxHtml: "<doc/>", page: 1 })) as unknown as typeof fetch;
    await expect(designFromDrawing(pdf, "x", "1:100", empty)).rejects.toThrow(
      /could not identify solid walls/,
    );
  });
});
