/**
 * The modelled furniture, all CC0 from Poly Haven (see assets/LICENSES.md). Dimensions are the
 * measured bounding boxes of the 1k glTF files, in metres: width (x), height (y), depth (z). Each
 * model rests on the floor with its front facing +z, the plan's south.
 */
export interface AssetSpec {
  id: string;
  w: number;
  h: number;
  d: number;
  /** Turn applied to the model so its front faces +z and its long side runs along x. */
  yaw?: number;
}

const spec = (id: string, w: number, h: number, d: number, yaw = 0): AssetSpec => ({
  id,
  w,
  h,
  d,
  yaw,
});

/** Bounds include every node transform in the glTF; two Poly Haven plants were left out because each file holds several plants in a row. */
export const ASSETS = {
  armchair: spec("modern_arm_chair_01", 0.82, 1.02, 0.99),
  coffeeTable: spec("modern_coffee_table_02", 1.2, 0.37, 1.2),
  diningChair: spec("dining_chair_02", 0.43, 0.97, 0.58),
  cabinet: spec("modern_wooden_cabinet", 2.44, 0.68, 0.52),
  shelves: spec("wooden_display_shelves_01", 1.08, 1.56, 0.37, -Math.PI / 2),
  plantTall: spec("potted_plant_01", 0.59, 1.35, 0.63),
  plantLow: spec("potted_plant_02", 0.7, 0.84, 0.66),
  barStool: spec("bar_chair_round_01", 0.48, 0.75, 0.49),
  pendant: spec("modern_ceiling_lamp_01", 0.43, 0.95, 0.43),
  // Added 30 Oct 2026. Bounds measured from the 1k glTF files with every node transform applied; every front faces +z.
  officeDesk: spec("metal_office_desk", 2.0, 0.79, 0.95),
  sofaSmall: spec("sofa_02", 1.81, 0.71, 0.82),
  sofaLarge: spec("sofa_03", 2.73, 1.12, 0.93),
  swivelChair: spec("mid_century_lounge_chair", 1.01, 1.17, 1.19),
  coffeeTableLong: spec("modern_coffee_table_01", 1.2, 0.39, 0.6, Math.PI / 2),
  woodenChair: spec("painted_wooden_chair_01", 0.43, 0.96, 0.54),
  greenArmchair: spec("GreenChair_01", 0.67, 1.06, 0.66),
  meetingTable: spec("dining_table", 2.26, 0.88, 1.39),
  bookcase: spec("Shelf_01", 1.0, 2.08, 0.26),
  sideTable: spec("side_table_01", 0.55, 0.55, 0.45),
  vase: spec("ceramic_vase_02", 0.22, 0.31, 0.22),
  stationery: spec("stationery_supplies", 0.3, 0.16, 0.08),
  steelShelves: spec("steel_frame_shelves_02", 0.59, 2.14, 0.5),
  // Large low garden plants, used outside the building only.
  anthurium: spec("anthurium_botany_01", 2.8, 0.5, 1.8),
  calathea: spec("calathea_orbifolia_01", 2.49, 0.42, 1.19),
  fern: spec("fern_02", 1.97, 0.43, 1.72),
} as const satisfies Record<string, AssetSpec>;

export type AssetKey = keyof typeof ASSETS;
