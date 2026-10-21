// Opening projects in FORMA 3: forma/3 (validated), forma/2 and v1 (through the
// old core, which takes v1 to forma/2) converted to forma/3, and the
// forma/3 validation with readable messages. No three.
//
// forma/2 → forma/3:
//  - each building stays a building (same position and rotation);
//  - storeys become levels (same IDs, elevation and floor height);
//  - each mass becomes an 'add' solid with the same vertex IDs (hence the
//    same side IDs); base = elevation of the start storey, height = sum up to
//    the end storey;
//  - roof: flat → flat with a 0.45 m parapet (the v2 one); shed,
//    gable, hip, mansard and dome with the same name; the v2 height
//    becomes a slope via atan(height / half span) (half span = half of the short
//    side of the plan's minimum rectangle, which is the straight skeleton time on a
//    rectangle); the dome keeps the height in `rise`;
//  - finish: wall, frame and roof with the v2 colors;
//  - facade: the mass pattern becomes facade rules with the built-in types;
//    sides with their own pattern get rules of their own and stay out of the
//    general rules (`blank`); sides with manual openings become free
//    occurrences attached to the face;
//  - lots, styles and interior walls are copied.
import type { Building, EdgeOverride, FacadePattern, Mass, Opening, Project } from '../../core/schema';
import { loadProject } from '../../core';
import { edgeConfig, massExtent, sortedStoreys, type EdgeConfig } from '../../core/model';
import { massEdges } from '../../geometry/ring';
import { validateStylePack } from '../../styles/schema';
import type { Building3, BuildingUse, EdgeSpec, FacadeRule, ID, Interior, Item, Level, ParamValue, PlanVertex, Project3, RoofKind, RoofSpec, Solid, Vec2 } from '../model/schema';
import { LIMITS3, SCHEMA3 } from '../model/schema';
import { DEFAULT_MATERIALS, facadeRule, mat, roofSpec, solid } from '../model/defaults';
import { BUILTIN_TYPES, family, typeById } from '../families/index';
import { FINISHES } from '../render/finishes';

export interface Migration {
  project: Project3;
  /** What has no forma/3 equivalent and was left out (to tell the user). */
  notes: string[];
}

/** Opens a project of any known version as forma/3. Throws an Error with a readable message. */
export function toForma3(raw: unknown): Project3 {
  return migrateForma3(raw).project;
}

/** Like `toForma3`, also returning the migration notes. */
export function migrateForma3(raw: unknown): Migration {
  const r = raw as { schema?: unknown } | null;
  if (r && typeof r === 'object' && r.schema === SCHEMA3) {
    const copy = structuredClone(r) as Project3;
    renameTypes(copy);
    englishDefaults(copy);
    inferHosts(copy);
    const notes = [...repairRefs(copy), ...repairColors(copy)];
    const errors = validateForma3(copy);
    if (errors.length) throw new Error(`Invalid forma/3 project: ${errors.slice(0, 3).join(' ')}`);
    return { project: normalize3(copy), notes };
  }
  const v2 = loadProject(raw);
  const out = fromForma2(v2);
  const errors = validateForma3(out.project);
  if (errors.length) throw new Error(`Conversion failed: ${errors.slice(0, 3).join(' ')}`);
  return out;
}

/**
 * Niches and projections saved before volumes remembered their wall: one whose
 * first side lies on a side of another volume of the building gets it back, so
 * its depth can be pulled through the wall again (in = niche, out = projection).
 */
function inferHosts(p: Project3): void {
  const on = (q: Vec2, a: Vec2, z: Vec2) => {
    const dx = z[0] - a[0],
      dz = z[1] - a[1];
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return false;
    const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / len2;
    const px = a[0] + t * dx - q[0],
      pz = a[1] + t * dz - q[1];
    return t > -1e-4 && t < 1 + 1e-4 && px * px + pz * pz < 1e-6;
  };
  for (const b of p.buildings)
    for (const s of b.solids) {
      if (s.host || !/\((recess|annex)\)$/.test(s.name) || s.plan.holes.length || s.plan.outer.length !== 4) continue;
      const [v0, v1] = s.plan.outer;
      for (const h of b.solids) {
        if (h === s || h.op !== 'add') continue;
        const ring = h.plan.outer;
        const i = ring.findIndex((v, k) => !v.bulge && on(v0!.p, v.p, ring[(k + 1) % ring.length]!.p) && on(v1!.p, v.p, ring[(k + 1) % ring.length]!.p));
        if (i >= 0) {
          s.host = { solid: h.id, edge: ring[i]!.id };
          break;
        }
      }
    }
}

/** Built-in type IDs renamed after projects were saved with them (old → new). */
const RENAMED_TYPES: Record<string, string> = { 'win-basculante': 'win-hopper' };

/** Default names that older versions saved in Portuguese (samples, levels) → the current English ones. */
const OLD_DEFAULT_NAMES: Record<string, string> = {
  Exemplos: 'Samples', Casa: 'House', 'Casa com torre': 'House with tower', Torre: 'Tower', 'Mansarda em L': 'L mansard',
  'Galpão abobadado': 'Vaulted shed', 'Fábrica': 'Factory', Bloco: 'Block', 'Pátio': 'Courtyard', 'Bloco com pátio': 'Courtyard block',
  'Torre afunilada': 'Tapered tower', 'Edifício curvo': 'Curved building', Mercado: 'Market', Arco: 'Arch', Arcada: 'Arcade',
  Celeiro: 'Barn', 'Bangalô': 'Bungalow', 'Térreo': 'Ground',
};

/** Only exact default names change; anything the user typed is kept. */
function englishDefaults(p: Project3): void {
  const to = (n: unknown) => (typeof n === 'string' ? (OLD_DEFAULT_NAMES[n] ?? n.replace(/^(\d+)º pavimento$/, 'Floor $1')) : n) as string;
  if (typeof p.name === 'string') p.name = to(p.name);
  if (!Array.isArray(p.buildings)) return;
  for (const b of p.buildings) {
    if (!isObj(b)) continue;
    b.name = to(b.name);
    if (Array.isArray(b.levels)) for (const l of b.levels) if (isObj(l)) l.name = to(l.name);
    if (Array.isArray(b.solids)) for (const x of b.solids) if (isObj(x)) x.name = to(x.name);
  }
}

/** Saved references to renamed built-in types are pointed at the new IDs. */
function renameTypes(p: Project3): void {
  const to = (id: unknown) => (typeof id === 'string' && RENAMED_TYPES[id]) || id;
  if (!Array.isArray(p.buildings)) return;
  for (const b of p.buildings) {
    if (!isObj(b)) continue;
    if (Array.isArray(b.solids))
      for (const s of b.solids)
        if (isObj(s) && Array.isArray(s.facade))
          for (const r of s.facade) {
            if (!isObj(r)) continue;
            r.type = to(r.type) as ID;
            if (isObj(r.except)) for (const k of Object.keys(r.except)) r.except[k] = to(r.except[k]) as ID;
          }
    if (Array.isArray(b.items))
      for (const it of b.items) {
        if (!isObj(it)) continue;
        it.type = to(it.type) as ID;
        if (isObj(it.origin) && it.origin.prev !== undefined) it.origin.prev = to(it.origin.prev) as ID;
      }
  }
}

/**
 * Dangling references (a component, rule or setting pointing to a side or
 * volume that no longer exists) are repaired instead of rejecting the whole
 * project: they are dropped, and each drop becomes a note for the user. The
 * rest of the validation still applies.
 */
function repairRefs(p: Project3): string[] {
  const notes: string[] = [];
  if (!Array.isArray(p.buildings)) return notes;
  for (const b of p.buildings) {
    if (!isObj(b) || !Array.isArray(b.solids)) continue;
    const name = typeof b.name === 'string' ? b.name : 'building';
    const sides = new Map<string, Set<string>>();
    for (const s of b.solids) {
      if (!isObj(s) || !isObj(s.plan) || !Array.isArray(s.plan.outer)) continue;
      const rings = [s.plan.outer, ...(Array.isArray(s.plan.holes) ? s.plan.holes : [])];
      const vids = new Set(rings.flatMap((ring) => (Array.isArray(ring) ? ring.map((v) => (isObj(v) ? v.id : undefined)) : [])).filter((id): id is string => typeof id === 'string'));
      sides.set(s.id, vids);
      if (isObj(s.edges))
        for (const id of Object.keys(s.edges))
          if (!vids.has(id)) {
            delete s.edges[id];
            notes.push(`${name}: a setting of a side that no longer exists was dropped.`);
          }
      if (Array.isArray(s.facade))
        for (const rule of s.facade)
          if (isObj(rule) && Array.isArray(rule.edges) && rule.edges.some((id) => !vids.has(id))) {
            rule.edges = rule.edges.filter((id) => vids.has(id));
            notes.push(`${name}: a facade rule lost sides that no longer exist.`);
          }
    }
    if (!Array.isArray(b.items)) continue;
    b.items = b.items.filter((it) => {
      const h = isObj(it) ? it.host : null;
      if (!isObj(h) || h.kind !== 'face') return true;
      const vids = sides.get(h.solid);
      if (vids && vids.has(h.edge)) return true;
      notes.push(`${name}: component removed (the face it was on no longer exists).`);
      return false;
    });
  }
  return notes;
}

/**
 * Material colors: `#rgb` is the same color as `#rrggbb` (each digit doubled,
 * CSS <hex-color>) and becomes the long form silently; an unreadable color
 * becomes gray with a note, instead of rejecting the project.
 */
function repairColors(p: Project3): string[] {
  const notes: string[] = [];
  if (!Array.isArray(p.buildings)) return notes;
  const fix = (m: unknown, name: string): void => {
    if (!isObj(m)) return;
    for (const k of ['color', 'color2'] as const) {
      const c = m[k];
      if (c === undefined && k === 'color2') continue;
      if (typeof c === 'string' && COLOR.test(c)) continue;
      if (typeof c === 'string' && /^#[0-9a-f]{3}$/i.test(c)) {
        m[k] = '#' + [...c.slice(1)].map((d) => d + d).join('').toLowerCase();
        continue;
      }
      m[k] = '#9a9a9a';
      notes.push(`${name}: an unreadable color became gray.`);
    }
  };
  for (const b of p.buildings) {
    if (!isObj(b) || !Array.isArray(b.solids)) continue;
    const name = typeof b.name === 'string' ? b.name : 'building';
    for (const s of b.solids) {
      if (!isObj(s)) continue;
      if (isObj(s.materials)) for (const m of Object.values(s.materials)) fix(m, name);
      if (isObj(s.edges)) for (const e of Object.values(s.edges)) if (isObj(e) && e.material !== undefined) fix(e.material, name);
    }
  }
  return notes;
}

/** JSON turns NaN into null: the "from type" sill becomes NaN again. */
function normalize3(p: Project3): Project3 {
  for (const b of p.buildings) for (const s of b.solids) for (const r of s.facade) if (r.sill === null || r.sill === undefined) r.sill = NaN;
  return p;
}

// ── forma/2 → forma/3 ──────────────────────────────────────────────────

const FINISH_IDS = new Set(FINISHES.map((f) => f.id));

/** Built-in balcony type, if any exists in the registry. */
function balconyType(): string | undefined {
  return BUILTIN_TYPES.find((t) => family(t.family)?.category === 'balconies')?.id;
}

/** Smallest-area rectangle containing the points (side directions): long side angle and sizes. */
export function minRect(pts: Vec2[]): { angle: number; long: number; short: number } {
  let best = { area: Infinity, angle: 0, long: 0, short: 0 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const u: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const p of pts) {
      const pu = p[0] * u[0] + p[1] * u[1],
        pv = -p[0] * u[1] + p[1] * u[0];
      u0 = Math.min(u0, pu);
      u1 = Math.max(u1, pu);
      v0 = Math.min(v0, pv);
      v1 = Math.max(v1, pv);
    }
    const du = u1 - u0,
      dv = v1 - v0;
    if (du * dv < best.area - 1e-9) {
      const along = Math.atan2(u[1], u[0]);
      // Long side angle, in degrees, on the [x, z] plane.
      const angle = du >= dv ? along : along + Math.PI / 2;
      best = { area: du * dv, angle: (angle * 180) / Math.PI, long: Math.max(du, dv), short: Math.min(du, dv) };
    }
  }
  return { angle: best.angle, long: best.long, short: best.short };
}

const deg = (r: number) => (r * 180) / Math.PI;
const clampPitch = (p: number) => Math.round(Math.max(3, Math.min(75, p)) * 100) / 100;

/** v2 roof → forma/3 RoofSpec. */
export function roofFrom2(m: Mass, outer: Vec2[]): RoofSpec {
  const k = m.roof.kind;
  const h = m.roof.height;
  const rect = minRect(outer);
  const half = Math.max(0.25, rect.short / 2);
  if (k === 'flat') return roofSpec('flat', { parapet: 0.45, overhang: 0 });
  if (k === 'dome') return roofSpec('dome', { rise: h, overhang: 0 });
  if (k === 'shed') {
    // v2 raises the shed roof along x (or the requested direction) over the whole span.
    const dir = m.roof.direction ?? 0;
    const d = (dir * Math.PI) / 180;
    const proj = outer.map((p) => p[0] * Math.cos(d) + p[1] * Math.sin(d));
    const span = Math.max(0.5, Math.max(...proj) - Math.min(...proj));
    return roofSpec('shed', { pitch: clampPitch(deg(Math.atan(h / span))), direction: dir, overhang: m.roof.overhang ?? 0 });
  }
  // Without a v2 direction, the ridge follows the long side (the same as the automatic choice would).
  const direction = Math.round((m.roof.direction ?? rect.angle) * 100) / 100;
  const overhang = m.roof.overhang ?? 0.4;
  if (k === 'mansard') {
    // v2: 70 % of the height on the lower slope up to the break; forma/3 makes the lower one steep and
    // uses the slope for the upper one, which takes the remaining 30 %.
    const fold = Math.min(0.42 * half, 2.6);
    return roofSpec('mansard', { pitch: clampPitch(deg(Math.atan((0.3 * h) / Math.max(0.3, half - fold)))), direction, overhang });
  }
  const kind: RoofKind = k === 'hip' ? 'hip' : 'gable';
  return roofSpec(kind, { pitch: clampPitch(deg(Math.atan(h / half))), direction, overhang });
}

interface RuleContext {
  /** Minimum and ground floor heights among the storeys of the mass. */
  minLevel: number;
  groundLevel: number;
  balcony: string | undefined;
}

const r2 = (v: number) => Math.round(v * 1000) / 1000;

/** Facade rules of a v2 side configuration (empty for 'blank'). */
export function rulesFor(cfg: EdgeConfig, edges: ID[], c: RuleContext): FacadeRule[] {
  const out: FacadeRule[] = [];
  const common = { edges, margin: 0.35, justify: 'center' as const };
  const lh = c.minLevel;
  const window = (type: string, levels: FacadeRule['levels']) => {
    const h = Math.max(0.3, Math.min(cfg.windowHeight, lh - 0.5));
    let sill = Math.max(0.45, (lh - h) * 0.52);
    if (sill + h > lh - 0.1) sill = Math.max(0, lh - 0.1 - h);
    out.push(facadeRule(type, { ...common, levels, mode: 'spacing', value: cfg.spacing, sill: r2(sill), params: { width: cfg.windowWidth, height: r2(h), frameColor: cfg.trim } }));
  };
  switch (cfg.pattern) {
    case 'blank':
      return out;
    case 'regular':
      window('win-casement', 'all');
      break;
    case 'arched':
      window('win-arched', 'all');
      break;
    case 'storefront': {
      const h = Math.max(2.2, Math.min(5, c.groundLevel - 0.45));
      out.push(facadeRule('shopfront', { ...common, levels: 'ground', mode: 'max', value: 4.6, sill: 0, params: { width: 4, height: r2(h), frameColor: cfg.trim } }));
      window('win-casement', 'upper');
      break;
    }
    case 'curtain': {
      const pitch = Math.max(1.4, cfg.spacing * 0.8);
      const h = Math.max(0.3, Math.min(4.5, lh - 0.1 - 0.45));
      out.push(facadeRule('win-tall', { ...common, levels: 'all', mode: 'spacing', value: r2(pitch), sill: 0.1, params: { width: r2(Math.max(0.6, pitch - 0.18)), height: r2(h), frameColor: cfg.trim } }));
      break;
    }
  }
  if (cfg.balconies && c.balcony) out.push(facadeRule(c.balcony, { ...common, levels: 'upper', mode: 'spacing', value: cfg.spacing }));
  return out;
}

const configKey = (c: EdgeConfig) => JSON.stringify([c.pattern, c.windowWidth, c.windowHeight, c.spacing, c.trim, c.balconies]);

function openingItem(o: Opening, m: Mass, base: number, storeyElevation: number, trim: string): Item | null {
  if (o.host.kind !== 'massEdge') return null;
  const arch = !!o.fill.arch;
  let type: string;
  const params: Record<string, ParamValue> = { width: o.width, height: o.height };
  switch (o.fill.type) {
    case 'door':
      type = arch ? 'door-arched' : 'door-panel';
      break;
    case 'window':
      type = arch ? 'win-arched' : 'win-casement';
      params.frameColor = trim;
      break;
    case 'storefront':
      type = 'shopfront';
      params.frameColor = trim;
      break;
    default:
      return null;
  }
  return { id: o.id, type, params, host: { kind: 'face', solid: m.id, edge: o.host.edgeId, u: r2(o.offset), y: r2(storeyElevation - base + o.sill) } };
}

function interiorsOf(b: Building): Record<ID, Interior> {
  const out: Record<ID, Interior> = {};
  for (const s of b.storeys) {
    const g = s.graph;
    if (!g.nodes.length && !g.walls.length && !s.rooms.length) continue;
    out[s.id] = {
      nodes: g.nodes.map((n) => ({ id: n.id, p: [n.p[0], n.p[1]] })),
      walls: g.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: w.thickness, ...(w.splitFrom ? { splitFrom: w.splitFrom } : {}) })),
      rooms: s.rooms.map((r) => ({ id: r.id, name: r.name, wallIds: [...r.wallIds], ...(r.polygon ? { polygon: r.polygon.map((p) => [p[0], p[1]] as Vec2) } : {}), ...(r.area !== undefined ? { area: r.area } : {}) })),
    };
  }
  return out;
}

function useOf(b: Building): BuildingUse {
  const patterns = new Set<FacadePattern>(b.masses.flatMap((m) => [m.facade.pattern, ...Object.values(m.edges).map((e: EdgeOverride) => e.pattern).filter((p): p is FacadePattern => !!p)]));
  if (patterns.has('storefront')) return b.storeys.length > 1 ? 'mixed' : 'commercial';
  if (patterns.has('curtain')) return 'commercial';
  return 'residential';
}

/** Converts a forma/2 project (already validated) to forma/3. */
export function fromForma2(p: Project): Migration {
  const notes = new Set<string>();
  const balcony = balconyType();
  const buildings: Building3[] = p.buildings.map((b) => {
    const storeys = sortedStoreys(b);
    const levels: Level[] = storeys.map((s) => ({ id: s.id, name: s.name, elevation: s.elevation, height: s.height }));
    const items: Item[] = [];
    const solids: Solid[] = b.masses.map((m) => {
      const ext = massExtent(b, m);
      const toPV = (v: { id: ID; p: Vec2 }): PlanVertex => ({ id: v.id, p: [v.p[0], v.p[1]] });
      const outer = m.outer.vertices.map(toPV);
      const holes = m.holes.map((h) => h.vertices.map(toPV));
      const wallFinish = m.finish.material && FINISH_IDS.has(m.finish.material) ? m.finish.material : 'plaster';
      const materials = {
        wall: mat(wallFinish, m.finish.wall),
        roof: mat('tile', m.roof.color),
        trim: mat('paint', m.finish.trim),
        base: structuredClone(DEFAULT_MATERIALS.base),
      };
      const heights = ext.storeys.map((s) => s.height);
      const ctx: RuleContext = { minLevel: heights.length ? Math.min(...heights) : 3, groundLevel: heights[0] ?? 3, balcony };
      const edges: Record<ID, EdgeSpec> = {};
      const groups = new Map<string, { cfg: EdgeConfig; ids: ID[] }>();
      const base = edgeConfig(m, undefined);
      const baseKey = configKey(base);
      const manualEdges = new Set<ID>();
      for (const e of massEdges(m)) {
        const o = m.edges[e.id];
        const cfg = edgeConfig(m, o);
        const spec: EdgeSpec = {};
        if (o?.wall) spec.material = mat(wallFinish, o.wall);
        if (cfg.manual) {
          spec.blank = true;
          manualEdges.add(e.id);
        } else if (configKey(cfg) !== baseKey) {
          spec.blank = true;
          const k = configKey(cfg);
          let g = groups.get(k);
          if (!g) groups.set(k, (g = { cfg, ids: [] }));
          g.ids.push(e.id);
        }
        if (cfg.balconies && !balcony) notes.add('forma/2 balconies have no FORMA 3 component yet and were left out.');
        if (cfg.brise) notes.add('forma/2 brises have no FORMA 3 component yet and were left out.');
        if (Object.keys(spec).length) edges[e.id] = spec;
      }
      const facade = [...rulesFor(base, [], ctx), ...[...groups.values()].flatMap((g) => rulesFor(g.cfg, g.ids, ctx))];
      if (m.flags.cornice || m.flags.pilotis || m.flags.garden) notes.add('forma/2 cornices, pilotis and roof gardens have no FORMA 3 equivalent and were left out.');
      if (m.style) notes.add('The forma/2 per-mass style does not carry over to FORMA 3 (the project style packs were kept).');
      // Manual openings: only valid on sides marked as manual (as in v2).
      const storeyById = new Map(b.storeys.map((s) => [s.id, s]));
      for (const o of b.openings) {
        if (o.host.kind !== 'massEdge' || o.host.massId !== m.id) continue;
        if (!manualEdges.has(o.host.edgeId)) {
          notes.add('Openings drawn on sides without manual mode were ignored in forma/2 and were not converted.');
          continue;
        }
        const st = storeyById.get(o.storeyId);
        const it = st ? openingItem(o, m, ext.base, st.elevation, edgeConfig(m, m.edges[o.host.edgeId]).trim) : null;
        if (it) items.push(it);
        else notes.add('forma/2 empty openings (no frame) have no FORMA 3 component and were left out.');
      }
      return solid({
        id: m.id,
        name: m.name,
        op: 'add',
        plan: { outer, holes },
        base: ext.base,
        height: ext.height,
        edges,
        roof: roofFrom2(m, outer.map((v) => v.p)),
        facade,
        materials,
      });
    });
    if (b.openings.some((o) => o.host.kind === 'wall')) notes.add('forma/2 interior doors do not carry over to FORMA 3 yet.');
    if (b.slabs.length || b.stairs.length) notes.add('forma/2 slabs and stairs do not carry over to FORMA 3 yet.');
    if (b.styleRef) notes.add('The forma/2 building style does not carry over to FORMA 3 (the project style packs were kept).');
    return {
      id: b.id,
      name: b.name,
      lotId: b.lotId,
      position: [b.position[0], b.position[1]],
      rotation: b.rotation,
      use: useOf(b),
      levels,
      solids,
      items,
      interiors: interiorsOf(b),
    };
  });
  const project: Project3 = {
    schema: SCHEMA3,
    name: p.name,
    lots: structuredClone(p.lots),
    buildings,
    types: [],
    styles: structuredClone(p.styles),
    meta: { createdWith: 'Oriel', migratedFrom: p.meta.migratedFrom === 1 ? 1 : 2 },
  };
  return { project, notes: [...notes] };
}

// ── forma/3 validation ─────────────────────────────────────────────────

const COLOR = /^#[0-9a-f]{6}$/i;
const USES: BuildingUse[] = ['residential', 'commercial', 'industrial', 'public', 'mixed'];
const OPS = ['add', 'subtract', 'intersect'];
const ROOFS: RoofKind[] = ['flat', 'terrace', 'shed', 'gable', 'hip', 'mansard', 'gambrel', 'pyramid', 'dome', 'vault', 'sawtooth'];
const PICKS = ['all', 'ground', 'upper', 'top', 'middle'];
const MODES = ['spacing', 'max', 'count', 'fit'];
const JUSTIFY = ['start', 'center', 'end'];
const MAX_ERRORS = 60;

class Errors {
  readonly list: string[] = [];
  add(where: string, msg: string): void {
    if (this.list.length < MAX_ERRORS) this.list.push(`${where}: ${msg}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const vec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(fin);

function checkMaterial(e: Errors, where: string, m: unknown, name: string): void {
  if (!isObj(m) || !str(m.finish, 40)) e.add(where, `${name}: invalid finish.`);
  else if (typeof m.color !== 'string' || !COLOR.test(m.color)) e.add(where, `${name}: invalid color.`);
}

function checkParams(e: Errors, where: string, p: unknown): void {
  if (!isObj(p)) return e.add(where, 'invalid parameters.');
  for (const [k, v] of Object.entries(p)) if (!(fin(v) || typeof v === 'string' || typeof v === 'boolean')) e.add(where, `parameter "${k}" with an invalid value.`);
}

function checkRing(e: Errors, where: string, ring: unknown, name: string, ids: Set<string>): void {
  if (!Array.isArray(ring) || ring.length < 3) return e.add(where, `${name} needs at least 3 points.`);
  for (const v of ring as PlanVertex[]) {
    if (!isObj(v) || !str(v.id)) {
      e.add(where, `vertex without an ID in ${name}.`);
      continue;
    }
    if (ids.has(v.id)) e.add(where, `repeated vertex ID (${v.id}).`);
    ids.add(v.id);
    if (!vec(v.p, 2)) e.add(where, `invalid point in ${name}.`);
    else if (Math.abs(v.p[0]) > LIMITS3.worldExtent || Math.abs(v.p[1]) > LIMITS3.worldExtent) e.add(where, `point beyond the ${LIMITS3.worldExtent} m limit in ${name}.`);
    if (v.smooth !== undefined && typeof v.smooth !== 'boolean') e.add(where, `invalid smooth flag in ${name}.`);
    for (const k of ['bulge', 'round', 'chamfer'] as const) if (v[k] !== undefined && !fin(v[k])) e.add(where, `invalid ${k} in ${name}.`);
    if ((v.round ?? 0) < 0 || (v.chamfer ?? 0) < 0) e.add(where, `negative corner in ${name}.`);
  }
}

function knownType(id: unknown, p: Project3): boolean {
  return typeof id === 'string' && !!typeById(id, p);
}

function checkSolid(e: Errors, where: string, s: Solid, p: Project3, ruleIds: Set<string>): void {
  const w = `${where}, solid "${typeof s?.name === 'string' ? s.name : '?'}"`;
  if (!str(s.name, 60)) e.add(w, 'invalid name.');
  if (!OPS.includes(s.op)) e.add(w, 'unknown operation.');
  if (!isObj(s.plan)) return e.add(w, 'no plan.');
  const vids = new Set<string>();
  checkRing(e, w, s.plan.outer, 'outline', vids);
  if (!Array.isArray(s.plan.holes)) e.add(w, 'invalid holes.');
  else s.plan.holes.forEach((h, i) => checkRing(e, w, h, `hole ${i + 1}`, vids));
  if (vids.size > LIMITS3.maxVertices) e.add(w, `more than ${LIMITS3.maxVertices} vertices.`);
  if (!fin(s.base)) e.add(w, 'invalid base.');
  if (!fin(s.height) || s.height <= 0) e.add(w, 'invalid height.');
  else if (fin(s.base) && s.base + s.height > LIMITS3.maxHeight + 1e-6) e.add(w, `above ${LIMITS3.maxHeight} m.`);
  if (!fin(s.taper) || s.taper < 0) e.add(w, 'invalid taper.');
  if (s.twist !== undefined && (!fin(s.twist) || Math.abs(s.twist) > 360)) e.add(w, 'invalid twist.');
  if (s.shell !== undefined && (!fin(s.shell) || s.shell <= 0 || s.shell > 5)) e.add(w, 'invalid shell thickness.');
  if (s.mirror !== undefined && s.mirror !== 'x' && s.mirror !== 'z') e.add(w, 'invalid mirror.');
  if (s.repeat !== undefined) {
    const r = s.repeat as unknown as Record<string, unknown>;
    if (!isObj(r) || (r.kind !== 'line' && r.kind !== 'ring' && r.kind !== 'helix') || !fin(r.count) || (r.count as number) < 1 || (r.kind === 'line' ? !fin(r.dx) || !fin(r.dz) : !fin(r.cx) || !fin(r.cz)) || (r.kind === 'helix' && (!fin(r.rise) || !fin(r.turn) || Math.abs(r.rise as number) > 50 || Math.abs(r.turn as number) > 360))) e.add(w, 'invalid repeat.');
  }
  if (s.loft !== undefined && (!isObj(s.loft) || !fin(s.loft.sides) || !fin(s.loft.scale) || !fin(s.loft.turn) || s.loft.scale <= 0 || s.loft.scale > 4 || (s.loft.sides !== 0 && s.loft.sides < 3) || s.loft.sides > 64)) e.add(w, 'invalid loft.');
  if (s.revolve !== undefined && (!isObj(s.revolve) || !Array.isArray(s.revolve.profile) || s.revolve.profile.length < 2 || !s.revolve.profile.every((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]) && q[0] >= 0) || !fin(s.revolve.segments))) e.add(w, 'invalid revolve profile.');
  if (!fin(s.plinth) || s.plinth < 0) e.add(w, 'invalid plinth.');
  if (s.hidden !== undefined && typeof s.hidden !== 'boolean') e.add(w, 'invalid visibility.');
  if (s.locked !== undefined && typeof s.locked !== 'boolean') e.add(w, 'invalid lock.');
  if (s.layer !== undefined && !str(s.layer)) e.add(w, 'invalid layer.');
  // Relations (model/relations.ts): a support, a floor for the top, a wall cut through. A target that is
  // gone is not an error (the relation is reported and comes back with undo); a malformed one is.
  if (s.on !== undefined && !str(s.on)) e.add(w, 'invalid support.');
  if (s.topLevel !== undefined && (!isObj(s.topLevel) || !str(s.topLevel.level) || !fin(s.topLevel.offset))) e.add(w, 'invalid top floor.');
  if (s.through !== undefined && (!isObj(s.through) || !str(s.through.solid) || !str(s.through.edge))) e.add(w, 'invalid wall cut through.');
  if (s.bands !== undefined) {
    if (!Array.isArray(s.bands) || s.bands.length > 40) e.add(w, 'invalid bands.');
    else for (const bd of s.bands) if (!isObj(bd) || !str(bd.id) || !fin(bd.y) || !fin(bd.height) || !fin(bd.depth) || bd.height < 0 || bd.depth < 0 || (bd.profile !== 'flat' && bd.profile !== 'cornice')) e.add(w, 'invalid band.');
  }
  if (s.bevel !== undefined) {
    const bv = s.bevel;
    if (!isObj(bv) || !fin(bv.top) || !fin(bv.bottom) || !fin(bv.segments) || !fin(bv.profile) || bv.top < 0 || bv.bottom < 0 || bv.segments < 1 || bv.profile < 0 || bv.profile > 1) e.add(w, 'invalid bevel.');
  }
  if (!isObj(s.edges)) e.add(w, 'invalid side settings.');
  else
    for (const [id, spec] of Object.entries(s.edges)) {
      if (!vids.has(id)) e.add(w, `setting on a missing side (${id}).`);
      if (!isObj(spec)) continue;
      if (spec.lean !== undefined && !fin(spec.lean)) e.add(w, 'invalid side lean.');
      if (spec.bevel !== undefined && (!fin(spec.bevel) || spec.bevel < 0)) e.add(w, 'invalid side bevel.');
      for (const k of ['gable', 'blank'] as const) if (spec[k] !== undefined && typeof spec[k] !== 'boolean') e.add(w, `${k} must be true or false.`);
      if (spec.material !== undefined) checkMaterial(e, w, spec.material, 'side material');
    }
  const r = s.roof;
  if (!isObj(r)) e.add(w, 'no roof.');
  else {
    if (!ROOFS.includes(r.kind)) e.add(w, 'unknown roof kind.');
    for (const k of ['pitch', 'rise', 'overhang', 'direction', 'parapet', 'thickness'] as const) if (!fin(r[k])) e.add(w, `roof: invalid ${k}.`);
    for (const k of ['rise', 'overhang', 'parapet', 'thickness'] as const) if (fin(r[k]) && r[k] < 0) e.add(w, `roof: negative ${k}.`);
  }
  if (!isObj(s.materials)) e.add(w, 'no materials.');
  else for (const k of ['wall', 'roof', 'trim', 'base'] as const) checkMaterial(e, w, s.materials[k], `material ${k}`);
  if (!Array.isArray(s.facade)) return e.add(w, 'invalid facade rules.');
  for (const rule of s.facade) {
    if (!isObj(rule) || !str(rule.id)) {
      e.add(w, 'facade rule without an ID.');
      continue;
    }
    if (rule.sizes !== undefined && (!isObj(rule.sizes) || !Object.values(rule.sizes).every((o) => isObj(o) && Object.values(o).every((v) => fin(v) && (v as number) > 0 && (v as number) < 100)))) e.add(w, 'invalid sizes at a position.');
    if (ruleIds.has(rule.id)) e.add(w, `repeated rule ID (${rule.id}).`);
    ruleIds.add(rule.id);
    if (!knownType(rule.type, p)) e.add(w, `rule with an unknown type (${String(rule.type)}).`);
    const lv = rule.levels;
    if (!(PICKS.includes(lv as string) || (Array.isArray(lv) && lv.every((i) => Number.isInteger(i) && i >= 0)))) e.add(w, 'invalid rule levels.');
    if (!Array.isArray(rule.edges)) e.add(w, 'invalid rule sides.');
    else for (const id of rule.edges) if (!vids.has(id)) e.add(w, `rule points to a missing side (${id}).`);
    if (!MODES.includes(rule.mode)) e.add(w, 'unknown rule distribution.');
    if (!fin(rule.value) || rule.value <= 0) e.add(w, 'invalid distribution value.');
    if (!fin(rule.margin) || rule.margin < 0) e.add(w, 'invalid rule margin.');
    // NaN (or null, after JSON) = sill from the type.
    if (!(rule.sill === null || Number.isNaN(rule.sill) || fin(rule.sill))) e.add(w, 'invalid rule sill.');
    if (!JUSTIFY.includes(rule.justify)) e.add(w, 'invalid rule justification.');
    if (!isObj(rule.except)) e.add(w, 'invalid rule exceptions.');
    else for (const v of Object.values(rule.except)) if (v !== 'none' && !knownType(v, p)) e.add(w, `exception with an unknown type (${String(v)}).`);
    checkParams(e, w, rule.params);
  }
}

function checkItem(e: Errors, where: string, it: Item, p: Project3, solids: Map<string, Solid>): void {
  const w = `${where}, component ${typeof it?.id === 'string' ? it.id : '?'}`;
  if (!knownType(it.type, p)) e.add(w, `unknown type (${String(it.type)}).`);
  checkParams(e, w, it.params);
  const h = it.host;
  if (!isObj(h)) return e.add(w, 'no host.');
  if (h.kind === 'face') {
    const s = solids.get(h.solid);
    if (!s) e.add(w, 'attached to a missing solid.');
    else if (![s.plan.outer, ...s.plan.holes].some((r) => r.some((v) => v.id === h.edge))) e.add(w, 'attached to a missing side.');
    if (!fin(h.u) || !fin(h.y)) e.add(w, 'invalid position on the face.');
    if (h.anchor !== undefined && h.anchor !== 'start' && h.anchor !== 'center' && h.anchor !== 'end') e.add(w, 'invalid anchor on the face.');
  } else if (h.kind === 'free') {
    if (!vec(h.p, 3) || !fin(h.rot)) e.add(w, 'invalid free position.');
  } else if (h.kind === 'path') {
    if (!Array.isArray(h.points) || h.points.length < 2 || !h.points.every((q) => vec(q, 3))) e.add(w, 'invalid path (at least 2 points).');
  } else if (h.kind === 'roof') {
    if (!solids.has(h.solid)) e.add(w, 'on a missing solid.');
    if (!vec(h.p, 2) || !fin(h.rot)) e.add(w, 'invalid position on the roof.');
  } else e.add(w, 'unknown host kind.');
  if (it.array !== undefined) {
    const a = it.array;
    if (!isObj(a) || !isObj(a.along) || !MODES.includes(a.along.mode) || !fin(a.along.value) || !fin(a.along.count) || a.along.count < 1) e.add(w, 'invalid array.');
    else if (a.across !== undefined && (!fin(a.across.count) || a.across.count < 1 || !fin(a.across.spacing))) e.add(w, 'invalid column array.');
  }
}

function checkBuilding(e: Errors, b: Building3, p: Project3, lotIds: Set<string>): void {
  const w = `Building "${typeof b?.name === 'string' ? b.name : '?'}"`;
  if (!isObj(b)) return e.add('Project', 'invalid building.');
  if (!str(b.name, 60)) e.add(w, 'invalid name.');
  if (b.lotId !== null && !lotIds.has(b.lotId)) e.add(w, 'missing lot.');
  if (!vec(b.position, 2)) e.add(w, 'invalid position.');
  else if (Math.abs(b.position[0]) > LIMITS3.worldExtent || Math.abs(b.position[1]) > LIMITS3.worldExtent) e.add(w, `position beyond the ${LIMITS3.worldExtent} m limit.`);
  if (b.elevation !== undefined && (!fin(b.elevation) || Math.abs(b.elevation) > LIMITS3.maxHeight)) e.add(w, 'invalid building elevation.');
  if (!fin(b.rotation)) e.add(w, 'invalid rotation.');
  if (!USES.includes(b.use)) e.add(w, 'unknown use.');
  if (!Array.isArray(b.levels) || b.levels.length > LIMITS3.maxLevels) e.add(w, `invalid levels or more than ${LIMITS3.maxLevels}.`);
  else {
    const ids = new Set<string>();
    for (const l of b.levels) {
      if (!isObj(l) || !str(l.id)) {
        e.add(w, 'level without an ID.');
        continue;
      }
      if (ids.has(l.id)) e.add(w, `repeated level ID (${l.id}).`);
      ids.add(l.id);
      if (!str(l.name, 60)) e.add(w, 'invalid level name.');
      if (!fin(l.elevation) || !fin(l.height) || l.height <= 0) e.add(w, `level "${l.name}" with an invalid elevation or height.`);
      else if (l.elevation + l.height > LIMITS3.maxHeight + 1e-6) e.add(w, `level "${l.name}" above ${LIMITS3.maxHeight} m.`);
    }
    if (!isObj(b.interiors)) e.add(w, 'invalid interiors.');
    else
      for (const [lid, int] of Object.entries(b.interiors)) {
        if (!ids.has(lid)) e.add(w, `interior on a missing level (${lid}).`);
        if (!isObj(int) || !Array.isArray(int.nodes) || !Array.isArray(int.walls) || !Array.isArray(int.rooms)) {
          e.add(w, 'invalid interior.');
          continue;
        }
        const nodes = new Set(int.nodes.map((n) => n.id));
        for (const n of int.nodes) if (!vec(n.p, 2)) e.add(w, 'invalid interior wall node.');
        for (const wl of int.walls) {
          if (!nodes.has(wl.a) || !nodes.has(wl.b)) e.add(w, 'interior wall points to a missing node.');
          if (!fin(wl.thickness) || wl.thickness <= 0) e.add(w, 'invalid interior wall thickness.');
        }
      }
  }
  const solids = new Map<string, Solid>();
  const ruleIds = new Set<string>();
  if (!Array.isArray(b.solids) || b.solids.length > LIMITS3.maxSolids) e.add(w, `invalid solids or more than ${LIMITS3.maxSolids}.`);
  else
    for (const s of b.solids) {
      if (!isObj(s) || !str(s.id)) {
        e.add(w, 'solid without an ID.');
        continue;
      }
      if (solids.has(s.id)) e.add(w, `repeated solid ID (${s.id}).`);
      solids.set(s.id, s);
      checkSolid(e, w, s, p, ruleIds);
    }
  if (!Array.isArray(b.items) || b.items.length > LIMITS3.maxItems) e.add(w, `invalid components or more than ${LIMITS3.maxItems}.`);
  else {
    const ids = new Set<string>();
    for (const it of b.items) {
      if (!isObj(it) || !str(it.id)) {
        e.add(w, 'component without an ID.');
        continue;
      }
      if (ids.has(it.id)) e.add(w, `repeated component ID (${it.id}).`);
      ids.add(it.id);
      checkItem(e, w, it, p, solids);
    }
  }
}

/** Validates a forma/3 project. Returns the messages (empty = valid). */
export function validateForma3(raw: unknown): string[] {
  const e = new Errors();
  const p = raw as Project3;
  if (!isObj(p) || p.schema !== SCHEMA3) return ['Project: not a forma/3 project.'];
  if (!str(p.name, 70)) e.add('Project', 'invalid name.');
  if (!isObj(p.meta) || !str(p.meta.createdWith)) e.add('Project', 'invalid metadata.');
  else if (p.meta.migratedFrom !== undefined && p.meta.migratedFrom !== 1 && p.meta.migratedFrom !== 2) e.add('Project', 'invalid source version.');
  const lotIds = new Set<string>();
  if (!Array.isArray(p.lots) || p.lots.length > 500) e.add('Project', 'invalid lots or more than 500.');
  else
    for (const lot of p.lots) {
      const w = `Lot "${typeof lot?.name === 'string' ? lot.name : '?'}"`;
      if (!isObj(lot) || !str(lot.id)) {
        e.add('Project', 'lot without an ID.');
        continue;
      }
      if (lotIds.has(lot.id)) e.add(w, `repeated lot ID (${lot.id}).`);
      lotIds.add(lot.id);
      if (!str(lot.name, 60)) e.add(w, 'invalid name.');
      if (!Array.isArray(lot.polygon) || lot.polygon.length < 3 || !lot.polygon.every((q) => vec(q, 2))) e.add(w, 'invalid polygon (at least 3 points).');
      else if (lot.polygon.some((q) => Math.abs(q[0]) > LIMITS3.worldExtent || Math.abs(q[1]) > LIMITS3.worldExtent)) e.add(w, `polygon beyond the ${LIMITS3.worldExtent} m limit.`);
      if (!Array.isArray(lot.frontEdges) || lot.frontEdges.some((i) => !Number.isInteger(i) || i < 0 || i >= (lot.polygon?.length ?? 0))) e.add(w, 'frontage points to a missing edge.');
    }
  if (p.materials !== undefined) {
    if (!Array.isArray(p.materials) || p.materials.length > 300) e.add('Project', 'invalid material library.');
    else for (const m of p.materials) if (!isObj(m) || !str(m.id) || !str(m.name, 60) || !isObj(m.ref) || !str(m.ref.finish) || !str(m.ref.color)) e.add('Project', 'invalid library material.');
  }
  if (p.streets !== undefined) {
    if (!Array.isArray(p.streets) || p.streets.length > 200) e.add('Project', 'invalid streets or more than 200.');
    else
      for (const st of p.streets) {
        const w = `Street "${typeof st?.name === 'string' ? st.name : '?'}"`;
        if (!isObj(st) || !str(st.id) || !str(st.name, 60)) e.add(w, 'invalid ID or name.');
        else if (!Array.isArray(st.points) || st.points.length < 2 || st.points.length > 200 || !st.points.every((q) => vec(q, 2) && Math.abs(q[0]) <= LIMITS3.worldExtent && Math.abs(q[1]) <= LIMITS3.worldExtent)) e.add(w, 'invalid center line (2 to 200 points inside the world).');
        else if (!fin(st.width) || st.width < 2 || st.width > 60 || !fin(st.sidewalk) || st.sidewalk < 0 || st.sidewalk > 15) e.add(w, 'invalid width (2–60 m) or sidewalk (0–15 m).');
        else if (st.trees !== undefined && (!fin(st.trees) || st.trees < 3 || st.trees > 100)) e.add(w, 'invalid tree spacing.');
        else if (st.treesBuilding !== undefined && !str(st.treesBuilding)) e.add(w, 'invalid trees building.');
      }
  }
  if (p.tour !== undefined) {
    const t = p.tour as unknown as Record<string, unknown>;
    const v3 = (q: unknown) => vec(q, 3) && (q as number[]).every((c) => Math.abs(c) <= LIMITS3.worldExtent);
    const text = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);
    if (!isObj(t) || !Array.isArray(t.stops) || t.stops.length > 200 || !Array.isArray(t.hotspots) || t.hotspots.length > 200) e.add('Project', 'invalid virtual tour (at most 200 stops and 200 points).');
    else {
      if (![t.title, t.subtitle, t.author, t.phone, t.email].every((x) => text(x, 300))) e.add('Project', 'invalid tour title or contact.');
      if (t.autoplay !== undefined && !(fin(t.autoplay) && (t.autoplay as number) >= 0 && (t.autoplay as number) <= 120)) e.add('Project', 'invalid tour autoplay (0–120 s).');
      for (const k of ['walk', 'vr', 'plans']) if (t[k] !== undefined && typeof t[k] !== 'boolean') e.add('Project', `invalid tour option ${k}.`);
      for (const st of t.stops as Record<string, unknown>[]) if (!isObj(st) || !str(st.id) || !str(st.name, 120) || !text(st.note, 2000) || !v3(st.eye) || !v3(st.target) || (st.walk !== undefined && typeof st.walk !== 'boolean')) e.add('Project', 'invalid tour stop.');
      for (const h of t.hotspots as Record<string, unknown>[]) if (!isObj(h) || !str(h.id) || !str(h.title, 120) || !text(h.text, 2000) || !v3(h.at)) e.add('Project', 'invalid tour point of interest.');
    }
  }
  if (p.layers !== undefined) {
    if (!Array.isArray(p.layers) || p.layers.length > 200) e.add('Project', 'invalid layers.');
    else for (const l of p.layers) if (!isObj(l) || !str(l.id) || !str(l.name, 60) || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean' || !str(l.color)) e.add('Project', 'invalid layer.');
  }
  if (p.view !== undefined && (!isObj(p.view) || !Array.isArray(p.view.hiddenCategories))) e.add('Project', 'invalid view state.');
  else if (p.view !== undefined && ((p.view.hiddenBody !== undefined && !(Array.isArray(p.view.hiddenBody) && p.view.hiddenBody.every((c: unknown) => typeof c === 'string'))) || (p.view.cutLevel !== undefined && !(Number.isInteger(p.view.cutLevel) && (p.view.cutLevel as number) >= 0)) || (p.view.explode !== undefined && !(fin(p.view.explode) && (p.view.explode as number) >= 0 && (p.view.explode as number) <= 50)) || (p.view.onlyLevel !== undefined && typeof p.view.onlyLevel !== 'boolean'))) e.add('Project', 'invalid view state.');
  if (p.info !== undefined && (!isObj(p.info) || Object.entries(p.info).some(([k, v]) => !['client', 'address', 'author', 'registration', 'revision'].includes(k) || typeof v !== 'string' || v.length > 160))) e.add('Project', 'invalid project information.');
  if (p.selectionSets !== undefined) {
    const strs = (x: unknown) => Array.isArray(x) && x.every((v) => typeof v === 'string');
    if (!Array.isArray(p.selectionSets) || p.selectionSets.length > 200) e.add('Project', 'invalid selection sets.');
    else for (const st of p.selectionSets) if (!isObj(st) || !str(st.id) || !str(st.name, 60) || !isObj(st.sel) || !(st.sel.building === null || str(st.sel.building)) || !(st.sel.item === null || str(st.sel.item)) || !strs(st.sel.others) || !strs(st.sel.solids) || !strs(st.sel.elems)) e.add('Project', 'invalid selection set.');
  }
  if (p.images !== undefined) {
    if (!Array.isArray(p.images) || p.images.length > 200) e.add('Project', 'invalid images.');
    else for (const im of p.images) if (!isObj(im) || !str(im.id) || typeof im.data !== 'string' || !im.data.startsWith('data:image/') || !fin(im.w) || !fin(im.h)) e.add('Project', 'invalid image.');
  }
  if (!Array.isArray(p.types)) e.add('Project', 'invalid component types.');
  else {
    const ids = new Set<string>();
    for (const t of p.types) {
      if (!isObj(t) || !str(t.id)) {
        e.add('Project', 'component type without an ID.');
        continue;
      }
      if (ids.has(t.id)) e.add('Project', `repeated type ID (${t.id}).`);
      ids.add(t.id);
      if (!str(t.name, 80)) e.add(`Type ${t.id}`, 'invalid name.');
      if (!str(t.family, 60) || !family(t.family)) e.add(`Type ${t.id}`, `unknown family (${String(t.family)}).`);
      checkParams(e, `Type ${t.id}`, t.params);
    }
  }
  if (!Array.isArray(p.buildings) || p.buildings.length > LIMITS3.maxBuildings) e.add('Project', `invalid buildings or more than ${LIMITS3.maxBuildings}.`);
  else {
    const ids = new Set<string>();
    for (const b of p.buildings) {
      if (isObj(b) && str(b.id)) {
        if (ids.has(b.id)) e.add('Project', `repeated building ID (${b.id}).`);
        ids.add(b.id);
      } else e.add('Project', 'building without an ID.');
      if (Array.isArray(p.types)) checkBuilding(e, b, p, lotIds);
    }
  }
  if (!Array.isArray(p.styles) || p.styles.length > 200) e.add('Project', 'invalid styles.');
  else for (const st of p.styles) for (const msg of validateStylePack(st).slice(0, 3)) e.add(`Style "${String((st as { name?: string })?.name ?? '?')}"`, msg);
  return e.list;
}

