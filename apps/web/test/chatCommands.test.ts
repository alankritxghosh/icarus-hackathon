import { describe, expect, it } from "vitest";
import { viewCommand } from "../src/chatCommands";

describe("what a person can ask of the view in words", () => {
  it("understands the realistic render, in and out", () => {
    for (const t of [
      "make it real",
      "Make it realistic!",
      "render it",
      "photorealistic",
      "realistic mode",
    ])
      expect(viewCommand(t), t).toEqual({ kind: "real", on: true });
    for (const t of ["stop realistic", "turn off realistic mode", "back to the quick view"])
      expect(viewCommand(t), t).toEqual({ kind: "real", on: false });
  });

  it("understands where to stand and what to show", () => {
    expect(viewCommand("walk in")).toEqual({ kind: "mode", mode: "eye" });
    expect(viewCommand("take me inside")).toEqual({ kind: "mode", mode: "eye" });
    expect(viewCommand("top view")).toEqual({ kind: "mode", mode: "plan" });
    expect(viewCommand("go outside")).toEqual({ kind: "mode", mode: "orbit" });
    expect(viewCommand("hide the ceiling")).toEqual({ kind: "ceiling", show: false });
    expect(viewCommand("show ceiling")).toEqual({ kind: "ceiling", show: true });
  });

  it("understands export for Blender and starting over", () => {
    for (const t of ["export", "export for blender", "download the model", "give me the glb"])
      expect(viewCommand(t), t).toEqual({ kind: "export" });
    expect(viewCommand("start over")).toEqual({ kind: "new" });
  });

  it("leaves a design request alone, even when it uses the same words", () => {
    for (const t of [
      "make the kitchen bigger",
      "move the kitchen east",
      "add a meeting room",
      "make it real quiet near the phone booths",
      "a 35 person studio with a walk in wardrobe and a plan for storage",
      "never put plants in the kitchen",
    ])
      expect(viewCommand(t), t).toBeUndefined();
  });
});
