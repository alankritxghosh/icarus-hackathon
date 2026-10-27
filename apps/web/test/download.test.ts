import { afterEach, describe, expect, it, vi } from "vitest";
import type { Built } from "../src/design";
import { fileStem, saveFile } from "../src/download";

afterEach(() => vi.unstubAllGlobals());

describe("downloads", () => {
  it("names a file from the brief and the size, with nothing a file system dislikes", () => {
    const built = { plan: { shell: { w: 24, h: 16 } } } as unknown as Built;
    expect(fileStem(built, "A 35-person design studio / 'open' plan, with a kitchen!")).toBe(
      "icarus-a-35-person-design-studio-24x16m",
    );
    expect(fileStem(built, "???")).toBe("icarus-office-24x16m");
  });

  it("hands the bytes to the browser as a named file", () => {
    const clicks: { href: string; download: string }[] = [];
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return "blob:x";
      },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        set href(v: string) {
          this._h = v;
        },
        set download(v: string) {
          this._d = v;
        },
        click() {
          clicks.push({ href: this._h, download: this._d });
        },
        _h: "",
        _d: "",
      }),
    });
    saveFile("plan.dxf", "0\nEOF\n", "image/vnd.dxf");
    expect(clicks).toEqual([{ href: "blob:x", download: "plan.dxf" }]);
    expect(blobs[0]?.type).toBe("image/vnd.dxf");
    expect(blobs[0]?.size).toBe(6);
  });
});
