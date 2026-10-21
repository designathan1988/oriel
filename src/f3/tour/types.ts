// What a published tour carries (io/tour.ts writes it into the page, runtime.ts reads it): the model as
// a GLB, the stops and points of interest, the rooms to jump to, the floor plans with the transform from
// their frame to the world (the minimap), the area table and the words of the interface in the
// project's language. World metres, Y up, as in the editor.

export type V3 = [number, number, number];

export interface TourDataStop {
  name: string;
  note?: string;
  eye: V3;
  target: V3;
  walk?: boolean;
}

export interface TourDataRoom {
  name: string;
  area: number;
  /** Floor and building it is in ("Térreo · Casa"). */
  where: string;
  /** Eye position in the middle of the room and the floor height under it. */
  eye: V3;
  floor: number;
  /** Index into `plans` of the plan it is drawn on (−1: none). */
  plan: number;
  /** Where to stand to see it (a free corner) and where to look (across to the far corner). */
  view?: { eye: V3; look: V3 };
}

export interface TourDataPlan {
  title: string;
  /** The plan as SVG (plan frame, metres, y = z). */
  svg: string;
  /** Plan frame → world: x' = a·x + c·z + e, z' = b·x + d·z + f (an SVG matrix). */
  toWorld: [number, number, number, number, number, number];
  /** World height of the floor and of the ceiling: which plan the walker is on. */
  floor: number;
  top: number;
}

export interface TourData {
  v: 1;
  title: string;
  subtitle?: string;
  author?: string;
  phone?: string;
  email?: string;
  date: string;
  lang: string;
  /** Words of the interface: English → translation (missing: the English stays). */
  t: Record<string, string>;
  /** The model (binary glTF, base64). */
  glb: string;
  stops: TourDataStop[];
  hotspots: { title: string; text?: string; at: V3 }[];
  rooms: TourDataRoom[];
  plans: TourDataPlan[];
  /** Area table: rows of [name, area m²], `level` rows bold. */
  areas: { name: string; area: number; level?: boolean }[];
  gross: number;
  decimal: string;
  options: { walk: boolean; vr: boolean; plans: boolean; autoplay: number };
  /** Where the stairs are (world, x/z bounds and the heights they join): only there may the walker
   *  climb onto a part of the model that is not a floor (elsewhere a bed or a sofa is in the way). */
  stairs?: { min: [number, number]; max: [number, number]; y0: number; y1: number }[];
  /** Bounds of the model (world) for the first view. */
  box: { min: V3; max: V3 };
  /** Direction the sunlight comes from (world, normalized). */
  sun: V3;
}
