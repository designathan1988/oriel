// Parametric component families (like Revit families): a pure function
// parameters → parts, with the parameter schema declared. No three.
//
// Local frame of a part hosted on a face: x along the face (part center
// at x = 0), y up from the part base, z outward (the wall face
// at z = 0). Free parts use the same frame on the ground.
import { evalExpr } from '../model/expr';
import type { ParamValue, Vec3 } from '../model/schema';

export type Category =
  | 'windows'
  | 'doors'
  | 'gates'
  | 'balconies'
  | 'railings'
  | 'fences'
  | 'walls'
  | 'structure'
  | 'stairs'
  | 'canopies'
  | 'shading'
  | 'ornament'
  | 'roofgear'
  | 'industrial'
  | 'facade'
  | 'furniture'
  | 'vegetation'
  | 'street'
  | 'site';

export const CATEGORY_NAMES: Record<Category, string> = {
  windows: 'Windows',
  doors: 'Doors',
  gates: 'Gates',
  balconies: 'Balconies and verandas',
  railings: 'Railings',
  fences: 'Fences and hedges',
  walls: 'Garden walls',
  structure: 'Columns and beams',
  stairs: 'Stairs and ramps',
  canopies: 'Canopies and awnings',
  shading: 'Brise-soleil',
  ornament: 'Ornaments',
  roofgear: 'Roof',
  industrial: 'Industrial',
  facade: 'Cladding and facade',
  furniture: 'Furniture',
  vegetation: 'Trees and plants',
  street: 'Street furniture',
  site: 'Site',
};

export type ParamKind = 'length' | 'angle' | 'count' | 'ratio' | 'enum' | 'bool' | 'color' | 'finish' | 'text';

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** 'type': applies to every occurrence of the type; 'instance': per occurrence. */
  scope: 'type' | 'instance';
  /** Group in the inspector (dimensions, divisions, profile, materials, details). */
  group: 'size' | 'divisions' | 'profile' | 'material' | 'detail';
}

export type Params = Record<string, ParamValue>;

/** Material roles of the parts; the color comes from the parameters. */
export type Slot = 'frame' | 'glass' | 'panel' | 'metal' | 'wood' | 'stone' | 'concrete' | 'wall' | 'roof' | 'green' | 'fabric' | 'light' | 'dark';

export interface PartMat {
  slot: Slot;
  color: string;
  finish?: string;
  /** 2nd color of the procedural finish (joint). */
  color2?: string;
  /** Project image (image plates). */
  image?: string;
  /** Curtain behind the glass: lets the room light through at night. */
  curtain?: boolean;
  /** Leaf cards: the cell of the foliage atlas drawn on them (cut out by its alpha, both sides lit). */
  foliage?: Foliage;
}

/** Cells of the foliage atlas (render/foliage.ts). */
export type Foliage = 'broad' | 'small' | 'needle' | 'palm' | 'grass' | 'flower' | 'fern' | 'maple';

/** Atlas layout: 4 columns × 2 rows, in this order (left to right, top row first). */
export const FOLIAGE_CELLS: Foliage[] = ['broad', 'small', 'needle', 'palm', 'grass', 'flower', 'fern', 'maple'];

/** UV rectangle of a cell: u from u0 to u1, v from the base of the card (vb) to its tip (vt). The canvas row 0 is v = 0. */
export function foliageUV(kind: Foliage): { u0: number; u1: number; vb: number; vt: number } {
  const i = FOLIAGE_CELLS.indexOf(kind);
  const c = i % 4,
    r = Math.floor(i / 4);
  return { u0: c / 4, u1: (c + 1) / 4, vb: (r + 1) / 2, vt: r / 2 };
}

/** Receives the parts in the family's local frame. */
export interface PartSink {
  /** Box: center and size; optional rotation (degrees) around y, x and z, in that order. */
  box(m: PartMat, center: Vec3, size: Vec3, rot?: Vec3): void;
  /** Upright cylinder (y axis): base center, radius, height; `sides` facets. */
  cylinder(m: PartMat, base: Vec3, radius: number, height: number, sides?: number): void;
  /** Cylinder between two points (bars, tubes, sloped balusters). */
  rod(m: PartMat, a: Vec3, b: Vec3, radius: number, sides?: number): void;
  /** Prism: a profile on the xy plane (with holes) extruded from z0 to z1. */
  prism(m: PartMat, profile: [number, number][], z0: number, z1: number, holes?: [number, number][][]): void;
  /** Plan plate: an outline on the xz plane (x, z) from y0 to y1 (slabs, steps, bases). */
  slab(m: PartMat, plan: [number, number][], y0: number, y1: number, holes?: [number, number][][]): void;
  /** Solid of revolution: a (radius, y) profile turned around the local y axis (domes, cones, towers, pots). */
  lathe(m: PartMat, profile: [number, number][], sides?: number, center?: [number, number, number]): void;
  /** The same sink with the origin moved. */
  translated(x: number, y: number, z: number): PartSink;
  /** The same sink rotated around y (degrees) and moved. */
  placed(x: number, y: number, z: number, rotY: number): PartSink;
  /** A profile on the yz plane swept along x, from x0 to x1 (cornices, copings). */
  sweepX(m: PartMat, profile: [number, number][], x0: number, x1: number): void;
  /** Free triangles (3 vertices each) with their own normals and, for leaf cards, UVs (bark tubes, leaves). */
  mesh(m: PartMat, positions: number[], normals: number[], uvs?: number[]): void;
  /** Box with rounded edges and corners of radius r (cushions, worktops, cabinet doors, ceramics). */
  rbox(m: PartMat, center: Vec3, size: Vec3, r: number, rot?: Vec3): void;
  /**
   * Skin through closed rings of the same point count (kit.oval), in order; `caps` closes the first and
   * the last ring. Rings going up wind outward; a surface coming back down (a bowl's inside) faces in.
   */
  loft(m: PartMat, rings: Vec3[][], caps?: [boolean, boolean]): void;
}

export interface Opening {
  /** Opening width and height. */
  w: number;
  h: number;
  /** Shape of the opening top. */
  shape: 'rect' | 'arch' | 'segment' | 'round';
  /** How deep the opening goes into the wall (m); ≥ thickness goes through. */
  depth: number;
  /** Depth of the room behind the opening (m): a real interior seen through the glass. */
  room?: number;
}

export interface Family {
  id: string;
  name: string;
  category: Category;
  /** Where the part rests. */
  host: 'face' | 'free' | 'path' | 'roof';
  tags: string[];
  params: ParamDef[];
  /** Part width, height and depth (for snapping, arrays and facade rules). */
  size(p: Params): Vec3;
  /** Opening the part cuts in the host face (doors, windows, gates). */
  opening?(p: Params): Opening | null;
  /** Default height of the part base above the floor (sill). */
  sill?(p: Params): number;
  build(p: Params, out: PartSink, ctx: BuildContext): void;
}

export interface BuildContext {
  /** Length of the path (path families) or of the face. */
  length: number;
  /** Depth of the opening cut in the wall (recess). */
  reveal: number;
  /** Index of this copy in an array. */
  index: number;
  /** For path families: points already in the local frame (x along). */
  path?: Vec3[];
}

/** Effective values: family default ← type ← occurrence. */
export function resolveParams(f: Family, ...layers: (Params | undefined)[]): Params {
  const out: Params = {};
  for (const d of f.params) out[d.key] = d.default;
  for (const l of layers) if (l) for (const k in l) if (k in out || k.startsWith('_')) out[k] = l[k]!;
  // Formulas: a number parameter written "=width/2" takes the value of that expression of the others
  // (model/expr.ts); three passes settle formulas that use formulas; one that does not read, the default.
  const formulas = f.params.filter((d) => isNumeric(d) && typeof out[d.key] === 'string' && (out[d.key] as string).startsWith('='));
  if (formulas.length) {
    const src = new Map(formulas.map((d) => [d.key, out[d.key] as string]));
    for (const d of formulas) out[d.key] = d.default;
    for (let pass = 0; pass < 3; pass++) {
      const vars: Record<string, number> = {};
      for (const d of f.params) if (typeof out[d.key] === 'number') vars[d.key] = out[d.key] as number;
      for (const d of formulas) {
        const v = evalExpr(src.get(d.key)!.slice(1), vars);
        if (v !== null) out[d.key] = d.kind === 'count' ? Math.round(v) : v;
      }
    }
  }
  for (const d of f.params) {
    const v = out[d.key];
    if (typeof v === 'number' && (d.min !== undefined || d.max !== undefined)) out[d.key] = Math.max(d.min ?? -Infinity, Math.min(d.max ?? Infinity, v));
  }
  return out;
}

/** A parameter that holds a number (a formula may give it). */
export const isNumeric = (d: ParamDef): boolean => d.kind === 'length' || d.kind === 'angle' || d.kind === 'count' || d.kind === 'ratio';

export const num = (p: Params, k: string): number => Number(p[k] ?? 0);
export const str = (p: Params, k: string): string => String(p[k] ?? '');
export const bool = (p: Params, k: string): boolean => p[k] === true || p[k] === 'true';

/** Shortcuts to declare parameters. */
export const P = {
  len: (key: string, label: string, def: number, min: number, max: number, scope: ParamDef['scope'] = 'type', group: ParamDef['group'] = 'size', step = 0.05): ParamDef => ({ key, label, kind: 'length', default: def, min, max, step, scope, group }),
  count: (key: string, label: string, def: number, min: number, max: number, group: ParamDef['group'] = 'divisions'): ParamDef => ({ key, label, kind: 'count', default: def, min, max, step: 1, scope: 'type', group }),
  angle: (key: string, label: string, def: number, min: number, max: number, scope: ParamDef['scope'] = 'type'): ParamDef => ({ key, label, kind: 'angle', default: def, min, max, step: 1, scope, group: 'profile' }),
  ratio: (key: string, label: string, def: number, scope: ParamDef['scope'] = 'instance'): ParamDef => ({ key, label, kind: 'ratio', default: def, min: 0, max: 1, step: 0.05, scope, group: 'detail' }),
  pick: (key: string, label: string, def: string, options: [string, string][], group: ParamDef['group'] = 'profile'): ParamDef => ({ key, label, kind: 'enum', default: def, options: options.map(([value, label]) => ({ value, label })), scope: 'type', group }),
  flag: (key: string, label: string, def: boolean, group: ParamDef['group'] = 'detail'): ParamDef => ({ key, label, kind: 'bool', default: def, scope: 'type', group }),
  color: (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'color', default: def, scope: 'type', group: 'material' }),
  finish: (key: string, label: string, def: string): ParamDef => ({ key, label, kind: 'finish', default: def, scope: 'type', group: 'material' }),
};
