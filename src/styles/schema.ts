// Style pack: a JSON file describing materials, facade rules
// per storey (splits in the spirit of CGA/CityEngine) and glTF
// modules. No three.js: the game can validate and interpret styles in a worker.
import type { MassFlags, RoofKind } from '../core/schema';

export const STYLE_SCHEMA = 'forma-style/1' as const;

export type TextureKind = 'brick' | 'plaster' | 'stone' | 'concrete' | 'tile' | 'wood' | 'metal';

export interface StyleMaterial {
  color: string;
  roughness?: number;
  metalness?: number;
  /** Real-scale procedural texture (multiplied by the color). */
  texture?: TextureKind;
  /** Size, in meters, of one texture repeat. */
  scale?: number;
}

/**
 * Size of a split piece, as in CGA:
 *  - number or "2.5": absolute (meters);
 *  - "'0.2": relative to the facade length;
 *  - "~1.4": floating (nominal value in meters; stretches to fill).
 */
export type SplitSize = number | string;

export type Tile =
  | { kind: 'wall' }
  | {
      kind: 'window';
      width?: number;
      height?: number;
      /** Sill above the storey floor. */
      sill?: number;
      arch?: boolean;
      balcony?: boolean;
      brise?: boolean;
      shutters?: boolean;
    }
  | { kind: 'door'; width?: number; height?: number; arch?: boolean }
  | { kind: 'storefront' }
  | { kind: 'pilaster'; width?: number; depth?: number; material?: 'trim' | 'stone' | 'wall' }
  | { kind: 'module'; module: string; width?: number; height?: number; sill?: number; hole?: boolean };

export type SplitNode = { size: SplitSize; tile: Tile } | { repeat: SplitNode[] };

export interface FloorRule {
  split: SplitNode[];
  /** Band (cornice) at the top of the storey. */
  band?: { height: number; depth: number; material?: 'trim' | 'stone' | 'wall' };
}

export interface StyleModule {
  url: string;
  /** Box the module occupies on the facade [width, height, depth]. */
  size: [number, number, number];
}

export interface StylePack {
  schema: typeof STYLE_SCHEMA;
  id: string;
  name: string;
  description?: string;
  materials: { wall: StyleMaterial; trim: StyleMaterial; stone?: StyleMaterial; roof?: StyleMaterial };
  floors: {
    typical: FloorRule;
    ground?: FloorRule;
    top?: FloorRule;
    /** Exceptions by storey index (0 = ground). */
    byIndex?: Record<string, FloorRule>;
  };
  /** Plinth: a stone band at the base. */
  plinth?: { height: number };
  roof?: { kind?: RoofKind; height?: number; overhang?: number };
  flags?: Partial<MassFlags>;
  modules?: Record<string, StyleModule>;
}

// ── Validation ────────────────────────────────────────────────────────
const TEXTURES: TextureKind[] = ['brick', 'plaster', 'stone', 'concrete', 'tile', 'wood', 'metal'];
const TILE_KINDS = ['wall', 'window', 'door', 'storefront', 'pilaster', 'module'];
const ROOFS: RoofKind[] = ['flat', 'shed', 'gable', 'dome', 'hip', 'mansard'];
const isNum = (v: unknown, a: number, b: number) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Parses a split size; null if invalid. */
export function parseSize(s: SplitSize): { kind: 'abs' | 'rel' | 'float'; value: number } | null {
  if (typeof s === 'number') return Number.isFinite(s) && s >= 0 ? { kind: 'abs', value: s } : null;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const kind = t.startsWith("'") ? 'rel' : t.startsWith('~') ? 'float' : 'abs';
  const v = Number(kind === 'abs' ? t : t.slice(1));
  if (!Number.isFinite(v) || v < 0 || (kind === 'rel' && v > 1)) return null;
  return { kind, value: v };
}

/** Validates a style pack; returns the list of errors (empty = valid). */
export function validateStylePack(p: unknown): string[] {
  const errors: string[] = [];
  const fail = (m: string) => errors.length < 30 && errors.push(m);
  if (!p || typeof p !== 'object') return ['Invalid style: a JSON object was expected.'];
  const s = p as StylePack;
  if (s.schema !== STYLE_SCHEMA) fail(`The style schema must be "${STYLE_SCHEMA}".`);
  if (typeof s.id !== 'string' || !/^[\w:.-]{1,60}$/.test(s.id)) fail('Invalid style ID (letters, digits, ":", "." and "-").');
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) fail('Invalid style name.');
  const mat = (m: unknown, label: string, required: boolean) => {
    if (m === undefined && !required) return;
    const x = m as StyleMaterial;
    if (!x || typeof x !== 'object') return fail(`Material ${label} missing.`);
    if (!isColor(x.color)) fail(`Invalid color for material ${label} (use #rrggbb).`);
    if (x.roughness !== undefined && !isNum(x.roughness, 0, 1)) fail(`Roughness of material ${label} outside 0..1.`);
    if (x.metalness !== undefined && !isNum(x.metalness, 0, 1)) fail(`Metalness of material ${label} outside 0..1.`);
    if (x.texture !== undefined && !TEXTURES.includes(x.texture)) fail(`Unknown texture for material ${label}.`);
    if (x.scale !== undefined && !isNum(x.scale, 0.05, 20)) fail(`Texture scale of ${label} outside 0.05..20 m.`);
  };
  const ms = s.materials ?? ({} as StylePack['materials']);
  mat(ms.wall, 'wall', true);
  mat(ms.trim, 'frame', true);
  mat(ms.stone, 'stone', false);
  mat(ms.roof, 'roof', false);
  const modules = s.modules ?? {};
  for (const [id, m] of Object.entries(modules)) {
    if (!m || typeof m.url !== 'string' || !m.url) fail(`Module "${id}" without a URL.`);
    if (!Array.isArray(m?.size) || m.size.length !== 3 || !m.size.every((v) => isNum(v, 0.01, 50))) fail(`Module "${id}" with an invalid size.`);
  }
  let depth = 0;
  const tile = (t: Tile, where: string) => {
    if (!t || !TILE_KINDS.includes(t.kind)) return fail(`${where}: unknown piece type.`);
    const r = t as Record<string, unknown>;
    for (const k of ['width', 'height', 'sill', 'depth']) if (r[k] !== undefined && !isNum(r[k], 0, 30)) fail(`${where}: ${k} out of range.`);
    if (t.kind === 'module' && !modules[t.module]) fail(`${where}: module "${t.module}" not declared.`);
  };
  const nodes = (list: SplitNode[], where: string) => {
    if (!Array.isArray(list) || !list.length || list.length > 40) return fail(`${where}: empty or too long split.`);
    if (++depth > 200) return;
    let repeats = 0;
    for (const n of list) {
      if ('repeat' in n) {
        if (++repeats > 1) fail(`${where}: only one repeat per split.`);
        if (n.repeat.some((x) => 'repeat' in x)) fail(`${where}: a repeat inside a repeat is not allowed.`);
        nodes(n.repeat, where + ' (repeat)');
      } else {
        if (!parseSize(n.size)) fail(`${where}: invalid size "${String(n.size)}".`);
        tile(n.tile, where);
      }
    }
  };
  const rule = (r: FloorRule | undefined, where: string, required: boolean) => {
    if (!r) return required ? fail(`${where}: missing rule.`) : undefined;
    nodes(r.split, where);
    if (r.band && (!isNum(r.band.height, 0.02, 2) || !isNum(r.band.depth, 0, 1))) fail(`${where}: invalid band.`);
  };
  const f = s.floors ?? ({} as StylePack['floors']);
  rule(f.typical, 'Typical storey', true);
  rule(f.ground, 'Ground', false);
  rule(f.top, 'Top storey', false);
  for (const [k, r] of Object.entries(f.byIndex ?? {})) {
    if (!/^\d{1,2}$/.test(k)) fail(`Storey exception "${k}" must be a number.`);
    rule(r, `Storey ${k}`, true);
  }
  if (s.plinth && !isNum(s.plinth.height, 0.05, 3)) fail('Plinth with an invalid height.');
  if (s.roof) {
    if (s.roof.kind !== undefined && !ROOFS.includes(s.roof.kind)) fail('Invalid style roof kind.');
    if (s.roof.height !== undefined && !isNum(s.roof.height, 0.2, 10)) fail('Invalid style roof height.');
    if (s.roof.overhang !== undefined && !isNum(s.roof.overhang, 0, 1.5)) fail('Invalid style eave.');
  }
  return errors;
}
