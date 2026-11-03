import { describe, expect, it } from "vitest";
import {
  applyStyle,
  checkProgram,
  colourName,
  describeStyle,
  dominantColours,
  furnish,
  layoutOffice,
  type PhotoRead,
  PhotoReadSchema,
  programFromPhoto,
  StyleSchema,
} from "../src";
import { MATERIALS } from "../src/build/scene";

const read = (over: Partial<PhotoRead> = {}): PhotoRead => ({
  spaceKind: "open_plan",
  seatsVisible: 12,
  estimatedHeadcount: 30,
  zones: ["open_workspace", "lounge", "meeting_room"],
  windows: "wall_of_glass",
  ceiling: "high_exposed",
  floor: "oak",
  accentColor: "#e0a030",
  wallColor: "#f4f1ea",
  mood: "Warm industrial coworking",
  notes: [],
  ...over,
});

describe("PhotoReadSchema", () => {
  it("accepts a good reading and refuses an invented floor or a bad colour", () => {
    expect(PhotoReadSchema.safeParse(read()).success).toBe(true);
    expect(PhotoReadSchema.safeParse({ ...read(), floor: "marble" }).success).toBe(false);
    expect(PhotoReadSchema.safeParse({ ...read(), accentColor: "orange" }).success).toBe(false);
    expect(PhotoReadSchema.safeParse({ ...read(), seatsVisible: -1 }).success).toBe(false);
  });
});

describe("programFromPhoto", () => {
  it("builds a plannable office and records what the photo could not give", () => {
    const { program, notes } = programFromPhoto(read());
    expect(program.company.headcount).toBe(36); // 12 visible workstations x 3, above the model's 30
    expect(
      programFromPhoto(read({ seatsVisible: 1, estimatedHeadcount: 4 })).program.company.headcount,
    ).toBe(16);
    expect(checkProgram(program).filter((p) => /no workspace|no restroom/.test(p))).toEqual([]);
    expect(notes.some((n) => /gives no dimensions/.test(n))).toBe(true);
    expect(program.style).toMatchObject({
      floor: "oak",
      accent: "#e0a030",
      ceiling: "exposed_dark",
    });
    expect(program.rooms.some((r) => r.kind === "lounge")).toBe(true);
  });

  it("adds a meeting room and a restroom when none were visible, and says so", () => {
    const { program, notes } = programFromPhoto(read({ zones: ["open_workspace"] }));
    expect(program.rooms.some((r) => r.kind === "meeting_room")).toBe(true);
    expect(program.rooms.some((r) => r.kind === "restroom")).toBe(true);
    expect(notes.some((n) => /No meeting room was visible/.test(n))).toBe(true);
  });

  it("lays out and furnishes for any reading, tiny to large", () => {
    for (const estimatedHeadcount of [2, 8, 45, 120]) {
      const { program } = programFromPhoto(read({ estimatedHeadcount, windows: "none" }));
      const f = furnish(layoutOffice(program, { seed: 1, iterations: 800, restarts: 1 }), program);
      expect(f.report.seatsPlaced, String(estimatedHeadcount)).toBeGreaterThan(0);
    }
  });
});

describe("applyStyle", () => {
  it("recolours the accent and floor without touching the shared defaults", () => {
    const before = JSON.stringify(MATERIALS);
    const m = applyStyle(StyleSchema.parse({ floor: "concrete", accent: "#3050a0" }));
    expect(m["fabric.green"]?.color).toBe("#3050a0");
    expect(m["floor.oak"]?.texture).toBeUndefined();
    // Concrete is the scanned concrete set, shown as photographed.
    expect(m["floor.oak"]?.pbr).toBe("concrete_floor_02");
    expect(m["floor.oak"]?.color).toBe("#ffffff");
    expect(JSON.stringify(MATERIALS)).toBe(before);
  });

  it("keeps a measured floor colour as a plain finish instead of tinting a scan", () => {
    const m = applyStyle(StyleSchema.parse({ floor: "oak", floorColor: "#8a6a47" }));
    expect(m["floor.oak"]?.pbr).toBeUndefined();
    expect(m["floor.oak"]?.color).toBe("#8a6a47");
    expect(m["floor.oak"]?.texture).toBe("planks");
  });

  it("the default style is the warm oak and green house style", () => {
    const m = applyStyle(StyleSchema.parse({}));
    expect(m["floor.oak"]?.texture).toBe("planks");
    expect(m["fabric.green"]?.color).toBe("#4d7558");
  });
});

describe("dominantColours", () => {
  /** A synthetic photo: pale wall on top, a red band in the middle, a brown floor below. */
  function photo(w: number, h: number, accent: [number, number, number] | undefined) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = y / h;
        const c: [number, number, number] =
          t < 0.12
            ? [30, 30, 30]
            : t < 0.45
              ? [236, 234, 228]
              : t < 0.78
                ? (accent ?? [150, 150, 150])
                : [160, 110, 70];
        const i = (y * w + x) * 4;
        data.set([...c, 255], i);
      }
    return { data, w, h };
  }

  it("reads floor, wall and a clear accent from the pixels", () => {
    const { data, w, h } = photo(200, 200, [190, 40, 40]);
    const c = dominantColours(data, w, h);
    expect(c.floor).toBe("#a06e46");
    expect(c.wall).toBe("#eceae4");
    expect(c.accent).toBe("#be2828");
  });

  it("reports no accent for a photo with no standout colour", () => {
    const { data, w, h } = photo(200, 200, undefined);
    expect(dominantColours(data, w, h).accent).toBeUndefined();
  });

  it("lets measured colours override the model's guess", () => {
    const { program } = programFromPhoto(read({ accentColor: "#6495ed" }), {
      accent: "#be2828",
      floor: "#a06e46",
    });
    expect(program.style.accent).toBe("#be2828");
    expect(program.style.floorColor).toBe("#a06e46");
    expect(applyStyle(program.style)["floor.oak"]?.color).toBe("#a06e46");
  });
});

describe("describeStyle", () => {
  it("names colours the way a person would", () => {
    expect(colourName("#4d7558")).toBe("deep forest green");
    expect(colourName("#3050a0")).toBe("blue");
    expect(colourName("#be2828")).toBe("red");
    expect(colourName("#ececea")).toBe("white");
  });

  it("describes the house style as warm oak and green", () => {
    const d = describeStyle(StyleSchema.parse({}));
    expect(d.floor).toContain("warm oak");
    expect(d.furniture).toContain("green");
    expect(d.ceiling).toContain("white");
  });

  it("follows what was read from a photo", () => {
    const d = describeStyle(
      StyleSchema.parse({
        floor: "carpet_grey",
        floorColor: "#9a9a9a",
        accent: "#2a4a9a",
        ceiling: "exposed_dark",
      }),
    );
    expect(d.floor).toContain("grey carpet");
    expect(d.furniture).toContain("blue");
    expect(d.ceiling).toContain("exposed");
  });
});
