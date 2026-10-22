// FORMA 3 document (forma/3).
// Meters; Y up; plan in [x, z] in the building frame; angles in degrees.
// Stable IDs (never derived from coordinates). This module does not import three.
import type { Lot } from '../../core/schema';
import type { StylePack } from '../../styles/schema';

export const SCHEMA3 = 'forma/3' as const;

export type ID = string;
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export interface Project3 {
  schema: typeof SCHEMA3;
  name: string;
  lots: Lot[];
  buildings: Building3[];
  /** Project component types (the built-in ones need not be here). */
  types: ComponentType[];
  styles: StylePack[];
  meta: { createdWith: string; migratedFrom?: 1 | 2 };
  /** Layers (like SketchUp Tags and Rhino layers); no layer = "Default". */
  layers?: Layer[];
  /** View state: hidden component categories and active layer. */
  view?: ViewState;
  /** Project images (image plates on facades), embedded. */
  images?: ProjectImage[];
  /** Named selection sets (like Revit Save Selection). */
  selectionSets?: SelectionSet[];
  /** Streets: a center line with the asphalt width and a sidewalk on each side (world plan). */
  streets?: Street[];
  /**
   * Dimensions and text labels pinned in the model (the Tape tool). With `building` their points are in
   * that building's frame and follow it when it moves or turns; without, they are in the world.
   */
  notes?: Note[];
  /**
   * Components made from a selection (SketchUp's Make Component, Revit's groups saved to the library):
   * buildings kept with their positions relative to their center, inserted again from the Library.
   */
  components?: { id: ID; name: string; buildings: Building3[] }[];
  /** Guide lines (SketchUp's construction lines): endless lines on the plan the drawing tools snap to. */
  guides?: { id: ID; a: Vec2; b: Vec2 }[];
  /** Grid axes (Revit's grids, ArchiCAD's grid elements): lines of the structural grid, labelled 1, 2, 3… and A, B, C…, in the world. */
  axes?: GridAxis[];
  /** Saved views (SketchUp's scenes, Revit's saved 3D views): camera, time, interior view and layers. */
  scenes?: Scene[];
  /** The ground's shape: heights set at points (Revit's topography from points), flat under the buildings. */
  terrain?: Terrain;
  /** Project material library: named materials to reuse (and to change everywhere at once). */
  materials?: ProjectMaterial[];
  /** The virtual tour published as a site or an app: its stops, points of interest and who to call. */
  tour?: TourSpec;
  /** What the title block of the sheets says (ABNT NBR 10068/13532): client, site, who answers for it. */
  info?: ProjectInfo;
}

export interface ProjectInfo {
  client?: string;
  address?: string;
  /** The architect or engineer responsible, and the registration (CAU / CREA). */
  author?: string;
  registration?: string;
  revision?: string;
}

/** A stop of the virtual tour: a view (eye and the point it looks at, world metres) with a caption. */
export interface TourStop {
  id: ID;
  name: string;
  note?: string;
  eye: Vec3;
  target: Vec3;
  /** Seen walking (eye height, collisions) rather than turning around the model. */
  walk?: boolean;
}

/** A point of interest: a numbered marker on the model that opens a card. */
export interface TourHotspot {
  id: ID;
  title: string;
  text?: string;
  at: Vec3;
}

export interface TourSpec {
  title?: string;
  subtitle?: string;
  /** Who made it and how to reach them (shown on the site; WhatsApp and e-mail become links). */
  author?: string;
  phone?: string;
  email?: string;
  stops: TourStop[];
  hotspots: TourHotspot[];
  /** Seconds per stop when the tour plays by itself (0: only by hand). */
  autoplay?: number;
  /** What the published tour offers. */
  walk?: boolean;
  vr?: boolean;
  plans?: boolean;
}

export interface ProjectMaterial {
  id: ID;
  name: string;
  ref: MaterialRef;
}

/** A dimension end tied to a corner of a volume (at its base, its top or a height): it follows the corner. */
export interface NoteRef {
  solid: ID;
  vertex: ID;
  at: 'base' | 'top' | number;
}

export type Note = { id: ID; kind: 'dim'; a: Vec3; b: Vec3; building?: ID; aRef?: NoteRef; bRef?: NoteRef } | { id: ID; kind: 'label'; p: Vec3; text: string; building?: ID };

export interface Scene {
  id: ID;
  name: string;
  /** Orbit camera: what it looks at, how far, its angles (radians) and the projection. */
  camera: { target: Vec3; distance: number; phi: number; theta: number; parallel: boolean };
  /** The view state kept with it (time of day, interior view, floor cut, exploded floors). */
  view: Pick<ViewState, 'time' | 'hiddenBody' | 'cutLevel' | 'onlyLevel' | 'explode' | 'style' | 'section' | 'phases' | 'options'>;
  /** Visibility of each layer when it was saved. */
  layers?: Record<ID, boolean>;
}

/** Renovation phase of a volume or a part: absent = new work. */
export type Phase = 'existing' | 'demolished';

export interface GridAxis {
  id: ID;
  a: Vec2;
  b: Vec2;
  label: string;
}

export interface WallLayer {
  name: string;
  /** Thickness (m). */
  thickness: number;
}

export interface Terrain {
  /** The ground height (m) at each point (world [x, z]); far from them it comes back to 0. */
  points: { id: ID; p: Vec2; y: number }[];
}

export interface Street {
  id: ID;
  name: string;
  /** Center line, world [x, z], at least two points. */
  points: Vec2[];
  /** Asphalt width (m). */
  width: number;
  /** Sidewalk width on each side (m). */
  sidewalk: number;
  /** Trees planted along it every this many metres (they follow the street when it changes). */
  trees?: number;
  /** The parts-only building that holds those trees. */
  treesBuilding?: ID;
}

/** Named selection: recalled later; what was deleted meanwhile is dropped. */
export interface SelectionSet {
  id: ID;
  name: string;
  sel: { building: ID | null; others: ID[]; solids: ID[]; elems: string[]; item: ID | null };
}

export interface ProjectImage {
  id: ID;
  name: string;
  /** Embedded image (data URL), at most 2048 px. */
  data: string;
  w: number;
  h: number;
}

/**
 * Layer: visible (eye) and locked (padlock: visible, but not selectable).
 * It only affects the view; saving and exporting take everything.
 */
export interface Layer {
  id: ID;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export interface ViewState {
  /** Hidden component categories (like Revit Visibility/Graphics). */
  hiddenCategories: string[];
  /** Layer that receives what is created. */
  activeLayer?: ID;
  /** Time of day in the view (0–24). */
  time?: number;
  /** Real sun (model/sun.ts): date (YYYY-MM-DD), place and the angle of true north; absent = stylized sun. */
  sun?: { date: string; latitude: number; longitude: number; utcOffset: number; north: number; place?: string };
  /** Hidden parts of the building body (interior view, like Revit Visibility/Graphics model categories). */
  hiddenBody?: string[];
  /** Cut by floor: shows up to this level index, cut 1.2 m above its floor (Revit plan cut plane). */
  cutLevel?: number;
  /** With `cutLevel`: only that floor (Matterport single-floor dollhouse). */
  onlyLevel?: boolean;
  /** Exploded floors: gap (m) between the floors, each cut 1.2 m above its floor (Revit Displace Elements). 0/absent = off. */
  explode?: number;
  /** The option shown of each design option set (absent: the first one). */
  options?: Record<string, string>;
  /** Phase filter (Revit's phase filters): the site as it is (existing and demolished) or the proposal (existing and new); absent = everything. */
  phases?: 'existing' | 'proposal';
  /** View style (SketchUp's face styles, Revit's visual styles): a white model or x-ray; absent = realistic. */
  style?: 'white' | 'xray';
  /**
   * Live section (Revit's section box, SketchUp's section plane): the buildings cut by a vertical plane
   * across x or z at `at` (world, m), the part toward the viewer taken away; `flip` keeps the other side.
   */
  section?: { axis: 'x' | 'z'; at: number; flip?: boolean };
}

/** Profile swept around the volume at a height. */
export interface Band {
  id: ID;
  /** Height of the profile base above the volume base (m). */
  y: number;
  height: number;
  /** How far it projects from the wall (m). */
  depth: number;
  /** Straight (band) or stepped (classic cornice). */
  profile: 'flat' | 'cornice';
}

/** Bevel of the horizontal edges (like the Blender Bevel, non-destructive). */
export interface BevelSpec {
  /** Width at the top and at the base (m). */
  top: number;
  bottom: number;
  /** Profile segments (1 = straight chamfer). */
  segments: number;
  /** 0 = straight, 1 = rounded (quarter circle). */
  profile: number;
}

export type BuildingUse = 'residential' | 'commercial' | 'industrial' | 'public' | 'mixed';

/** Building: moves and rotates as a whole. */
export interface Building3 {
  id: ID;
  name: string;
  lotId: ID | null;
  /** Design option (Revit's design options): this building is option `name` of the set `set`; one option of a set is shown. */
  option?: { set: string; name: string };
  /**
   * Linked copies (identical houses on several lots, Revit's groups, SketchUp's components): every
   * building with the same key shares its volumes, parts, floors and interiors; an edit of one is made on
   * all of them. Each keeps its own position, rotation, name and lot.
   */
  linked?: ID;
  position: Vec2;
  /** Building base elevation (m; absent = on the ground). Rises onto another building with the green arrow. */
  elevation?: number;
  rotation: number;
  use: BuildingUse;
  /** Levels shared by every solid (like Revit levels). */
  levels: Level[];
  solids: Solid[];
  items: Item[];
  /** Interior walls and rooms per level. */
  interiors: Record<ID, Interior>;
  layer?: ID;
  hidden?: boolean;
  locked?: boolean;
}

export interface Level {
  id: ID;
  name: string;
  /** Floor elevation above the building origin. */
  elevation: number;
  /** Floor-to-floor height. */
  height: number;
}

export const ROOM_USES = ['living', 'bedroom', 'kitchen', 'bathroom', 'circulation', 'service', 'office', 'retail', 'storage', 'other'] as const;
export type RoomUse = (typeof ROOM_USES)[number];
/** Names of the room uses (the room schedule groups by them). */
export const ROOM_USE_NAMES: Record<RoomUse, string> = { living: 'Living', bedroom: 'Bedroom', kitchen: 'Kitchen', bathroom: 'Bathroom', circulation: 'Circulation', service: 'Service', office: 'Office', retail: 'Retail', storage: 'Storage', other: 'Other' };

export interface Interior {
  nodes: { id: ID; p: Vec2 }[];
  walls: { id: ID; a: ID; b: ID; thickness: number; splitFrom?: ID }[];
  rooms: {
    id: ID;
    name: string;
    wallIds: ID[];
    polygon?: Vec2[];
    area?: number;
    /** Floor finish of the room (a plate on the slab). */
    finish?: MaterialRef;
    /** What the room is used for (Revit's occupancy): the room schedule groups by it. */
    use?: RoomUse;
    /** Floor to ceiling (m); absent: the floor height less the slab. */
    ceiling?: number;
  }[];
  /**
   * Finishes inside this floor (the room side of every wall, the ceilings, the bare floor where a room has
   * no finish of its own); absent: the light matte defaults of the interior view.
   */
  finishes?: { walls?: MaterialRef; ceiling?: MaterialRef; floor?: MaterialRef };
}

// ── Solid ──────────────────────────────────────────────────────────────
/**
 * Plan vertex. The edge starting at it has the same ID. `bulge` makes the edge
 * an arc (CAD polyline convention: tan(θ/4), positive = outward arc on a
 * counterclockwise ring). `round` rounds the corner with that radius; `chamfer`
 * cuts the corner with that setback.
 */
export interface PlanVertex {
  id: ID;
  p: Vec2;
  /** A spline point: the outline passes through it smoothly (Catmull-Rom with its neighbours). */
  smooth?: boolean;
  bulge?: number;
  round?: number;
  chamfer?: number;
}

export interface Plan {
  /** Counterclockwise outer ring (seen from above, with z down on screen). */
  outer: PlanVertex[];
  holes: PlanVertex[][];
}

export type SolidOp = 'add' | 'subtract' | 'intersect';

export type RoofKind =
  | 'flat'
  | 'terrace'
  | 'shed'
  | 'gable'
  | 'hip'
  | 'mansard'
  | 'gambrel'
  | 'pyramid'
  | 'dome'
  | 'vault'
  | 'sawtooth'
  | 'profile';

export interface RoofSpec {
  kind: RoofKind;
  /**
   * Roof by profile: its section across the building, points (t, h) with t from 0 to 1 across (the
   * `direction`) and h from 0 to 1 of `rise` above the eave (a butterfly, a curve, an M…).
   */
  profile?: [number, number][];
  /** Roof slope in degrees (shed, gable, hip, gambrel, sawtooth, pyramid). */
  pitch: number;
  /** Dome or vault rise (m); 0 = half circle. */
  rise: number;
  overhang: number;
  /** Ridge or fall direction, in degrees on the building plane. */
  direction: number;
  /** Parapet on a flat roof or terrace (m). */
  parapet: number;
  thickness: number;
}

/** Settings of one side of the solid (plan edge). */
export interface EdgeSpec {
  /** Wall lean in degrees: positive leans inward. */
  lean?: number;
  /** This side gets no slope (becomes a gable end) on a hip roof. */
  gable?: boolean;
  /** Roof pitch of this side (degrees) on a hip or gable roof; absent: the roof's own pitch. */
  pitch?: number;
  /** No components generated by the facade rules on this side. */
  blank?: boolean;
  material?: MaterialRef;
  /** Top bevel on this side only (m); overrides the volume's. */
  bevel?: number;
}

export interface MaterialRef {
  /** Finish: plaster, brick, stone, concrete, wood, metal, glass, tile, panel… */
  finish: string;
  color: string;
  /** 2nd color of the procedural finish (joint, mortar, grout). */
  color2?: string;
  /** Procedural finish parameters (brick size, joint, bond…). */
  params?: Record<string, number>;
  // Adjustments over the finish (ui/mateditor.ts); absent: the finish's own.
  /** Roughness, 0 polished … 1 matte. */
  rough?: number;
  /** Metallic, 0 … 1. */
  metal?: number;
  /** Texture size: × the finish's own; with a picture (finish 'image'), its width in metres. */
  scale?: number;
  /** Texture turn (degrees). */
  rot?: number;
  /** Light given off (0 none, 1 a lit sign, 3 a lamp). */
  glow?: number;
  /** Opacity, 1 solid … 0.02. */
  opacity?: number;
  /** Project image used as the texture (finish 'image'). */
  image?: ID;
}

export interface SolidMaterials {
  wall: MaterialRef;
  roof: MaterialRef;
  trim: MaterialRef;
  base: MaterialRef;
  /** Top floor finish (terrace, slab); without it, a terrace uses ceramic tile and a slab uses membrane. */
  floor?: MaterialRef;
}

export interface Solid {
  id: ID;
  name: string;
  op: SolidOp;
  plan: Plan;
  /** Base elevation above the building origin. */
  base: number;
  height: number;
  /** Uniform setback of the top relative to the base (m); tapers the volume. */
  taper: number;
  edges: Record<ID, EdgeSpec>;
  roof: RoofSpec;
  facade: FacadeRule[];
  materials: SolidMaterials;
  /** Visible plinth (m) at the foot of the walls. */
  plinth: number;
  /** Bevel of the top and base edges. */
  bevel?: BevelSpec;
  /** Bands, cornices and plinth bands swept along the outline (like SketchUp Follow Me). */
  bands?: Band[];
  /** Hidden in the view (tree eye). Hidden cutters keep cutting. */
  hidden?: boolean;
  /** Locked: visible, but not selectable. */
  locked?: boolean;
  layer?: ID;
  /**
   * Made on a side face (Inset, Extrude): its plan starts on that wall (the first
   * side) and its depth is measured from it, out = projection (add), in = niche
   * (subtract), like SketchUp Push/Pull.
   */
  host?: { solid: ID; edge: ID };
  /** Rests on the top of that volume: its base follows the support (model/relations.ts). */
  on?: ID;
  /** Top attached to a floor: the top of that level plus `offset` (Revit Top Constraint + Top Offset). */
  topLevel?: { level: ID; offset: number };
  /** A cutter that goes through that wall: its outer end follows the wall when it moves or bulges. */
  through?: { solid: ID; edge: ID };
  /** Twist: the top turned against the base around the plan center (degrees, + counterclockwise from above). */
  twist?: number;
  /** Hollow shell (a modifier): walls, floor and top this thick, the inside empty (m). */
  shell?: number;
  /** A hollow volume open at the top (walls drawn with the Walls tool): no slab until a roof is chosen. */
  openTop?: boolean;
  /** A wall drawn by the Walls tool: its centre line (building frame); new walls start and end on it. */
  wallAxis?: [Vec2, Vec2];
  /** Thickness of a drawn wall (m): its body is made from the line and this (model/walljoins.ts). */
  wallThickness?: number;
  /** The layers of the walls of a hollow volume, outside in (model/walltypes.ts); `shell` is their sum. */
  wallLayers?: WallLayer[];
  /** Renovation phase (Revit's phases): what stands today or is to be demolished; absent = new work. */
  phase?: Phase;
  /** Live copies (a modifier, eval/modifiers.ts): in a row by (dx, dz), or around (cx, cz) of the building. */
  repeat?:
    | { kind: 'line'; count: number; dx: number; dz: number }
    | { kind: 'ring'; count: number; cx: number; cz: number }
    /** Each copy turned `turn` degrees about (cx, cz) and raised `rise` m over the previous one. */
    | { kind: 'helix'; count: number; cx: number; cz: number; rise: number; turn: number };
  /** Live mirror across the building's X axis (x = 0) or Z axis (z = 0) (a modifier). */
  mirror?: 'x' | 'z';
  /** Solid of revolution: the profile [radius, height above the base] turned around the plan center (domes, spheres, spires). */
  revolve?: { profile: Vec2[]; segments: number };
  /** Loft: the walls go from the plan at the base to another shape on top (a regular polygon, `sides` ≥ 3, or a circle with 0), `scale` of the base size, turned `turn` degrees. */
  loft?: {
    sides: number;
    scale: number;
    turn: number;
    /** Sections between the base and the top (Rhino's loft through several curves): at a share of the height, the blend of the two scaled and turned. */
    mids?: { at: number; scale: number; turn: number }[];
  };
}

// ── Components ─────────────────────────────────────────────────────────
export type ParamValue = number | string | boolean;

/** Component type: a family with named values (linked to its occurrences). */
export interface ComponentType {
  id: ID;
  family: string;
  name: string;
  params: Record<string, ParamValue>;
  /** User-created type (saved in the project and the library). */
  user?: boolean;
  /** Variant of another type (shown under it in the element groups). */
  base?: ID;
}

export type ItemHost =
  /**
   * On a side face of a solid: `u` along the side (m from the start to the center), `y` above the solid
   * base. `anchor` (absent = start): which point of the side it keeps its distance to when the side
   * changes length (model/relations.ts).
   */
  | { kind: 'face'; solid: ID; edge: ID; u: number; y: number; anchor?: 'center' | 'end' | 'start' }
  /** Free in the building: local position and Y rotation. */
  | { kind: 'free'; p: Vec3; rot: number }
  /** Along a path (fences, walls, railings, straight stairs). */
  | {
      kind: 'path';
      points: Vec3[];
      closed?: boolean;
      /** Runs around the top edge of this volume (a railing on a terrace): follows it when it changes. */
      around?: ID;
    }
  /** On the roof or the roof slab of a solid. */
  | { kind: 'roof'; solid: ID; p: Vec2; rot: number };

export type Distribution = 'spacing' | 'max' | 'count' | 'fit';

/** Array of an occurrence (like the Blender Array and the SketchUp measure box). */
export interface ArraySpec {
  /** Along the side or the local x axis. */
  along: { mode: Distribution; value: number; count: number };
  /** In columns (faces: levels above; free: local z axis). */
  across?: { count: number; spacing: number };
}

export interface Item {
  id: ID;
  type: ID;
  /** Overrides of this occurrence over the type values. */
  params: Record<string, ParamValue>;
  host: ItemHost;
  array?: ArraySpec;
  layer?: ID;
  /** Renovation phase (absent = new work). */
  phase?: Phase;
  hidden?: boolean;
  locked?: boolean;
  /** Element detached from a facade rule (position "side:level:index"; `prev`, the type exception the position had): "Back to rule" returns it. */
  origin?: { solid: ID; rule: ID; key: string; prev?: ID };
}

/** Which levels of the solid a facade rule occupies. */
export type LevelPick = 'all' | 'ground' | 'upper' | 'top' | 'middle' | number[];

/**
 * Facade rule: distributes a component type over the sides of the solid, per
 * level, recomputed on every change (the face size decides how many fit).
 */
export interface FacadeRule {
  id: ID;
  type: ID;
  levels: LevelPick;
  /** Sides (IDs); empty = every side long enough. */
  edges: ID[];
  mode: Distribution;
  /** Distance (spacing/max) or count (count/fit). */
  value: number;
  /** Free margin at the ends of each side (m). */
  margin: number;
  /** Sill height above the level floor (m); NaN = from the type. */
  sill: number;
  justify: 'start' | 'center' | 'end';
  /** Exceptions per position: "side:level:index" → type or "none". */
  except: Record<string, ID>;
  params: Record<string, ParamValue>;
  /** Sizes changed at one position only ("side:level:index" → parameters over the rule's). */
  sizes?: Record<string, Record<string, number>>;
}

export interface Limits3 {
  maxBuildings: number;
  maxSolids: number;
  maxItems: number;
  maxLevels: number;
  maxHeight: number;
  maxVertices: number;
  worldExtent: number;
}

export const LIMITS3: Limits3 = {
  maxBuildings: 200,
  maxSolids: 64,
  maxItems: 400,
  maxLevels: 60,
  maxHeight: 240,
  maxVertices: 256,
  worldExtent: 600,
};
