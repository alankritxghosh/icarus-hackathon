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
}

const spec = (id: string, w: number, h: number, d: number): AssetSpec => ({ id, w, h, d });

export const ASSETS = {
  sofaSmall: spec("Sofa_01", 1.57, 0.8, 0.66),
  sofaMedium: spec("sofa_02", 1.81, 0.71, 0.82),
  sofaLarge: spec("sofa_03", 2.73, 1.12, 0.93),
  armchair: spec("modern_arm_chair_01", 0.82, 1.02, 0.99),
  loungeChair: spec("mid_century_lounge_chair", 1.01, 1.17, 1.19),
  coffeeTable: spec("modern_coffee_table_02", 1.2, 0.37, 1.2),
  coffeeTableLong: spec("modern_coffee_table_01", 0.6, 0.39, 1.2),
  diningChair: spec("dining_chair_02", 0.43, 0.97, 0.58),
  cabinet: spec("modern_wooden_cabinet", 2.44, 0.68, 0.68),
  shelves: spec("wooden_display_shelves_01", 0.37, 1.56, 1.08),
  plantTall: spec("potted_plant_01", 0.59, 1.34, 0.63),
  plantLow: spec("potted_plant_02", 0.73, 0.63, 0.76),
  tree: spec("pachira_aquatica_01", 1.11, 1.9, 1.0),
  barStool: spec("bar_chair_round_01", 0.49, 0.75, 0.48),
  pendant: spec("modern_ceiling_lamp_01", 0.43, 0.95, 0.43),
  deskLamp: spec("desk_lamp_arm_01", 0.2, 0.89, 0.61),
} as const satisfies Record<string, AssetSpec>;

export type AssetKey = keyof typeof ASSETS;
