// Live modifiers of a volume (like Blender's Array and Mirror modifiers, Estúdio de Construção's "Line ×",
// "Ring ×", "Helix" and "Mirror X/Z"): copies are made at every evaluation from the source volume, so changing the
// source (its plan, height, roof, facade rules) changes them all; removing the modifier removes them.
// The copies are volumes of their own for the evaluation, with the source's side IDs (its facade rules and
// exceptions apply to them) and an ID `<source>~<n>`; picking one selects the source (sourceId).
// No three.
import type { Building3, ID, Solid, Vec2 } from '../model/schema';
import { mirrorSolid, translateSolid } from '../model/ops';
import { offsetRing, ringValid, signedArea2 } from '../model/plan';
import { slabOpeningFor, stairRun } from '../model/stairs';
import { typeById } from '../families/index';

/** The volume an evaluated face belongs to: a copy made by a modifier answers for its source. */
export const sourceId = (id: ID): ID => {
  const i = id.indexOf('~');
  return i < 0 ? id : id.slice(0, i);
};

/** Rotates a plan about a point of the building (degrees, counterclockwise seen from above). */
function spinAbout(s: Solid, cx: number, cz: number, deg: number): void {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    n = Math.sin(a);
  for (const ring of [s.plan.outer, ...s.plan.holes])
    for (const v of ring) {
      const x = v.p[0] - cx,
        z = v.p[1] - cz;
      v.p = [cx + x * c + z * n, cz - x * n + z * c];
    }
  s.roof = { ...s.roof, direction: s.roof.direction - deg };
}

/** The volumes the modifiers make for one source volume (not the source itself). */
export function modifierCopies(s: Solid): Solid[] {
  const out: Solid[] = [];
  const copy = (n: number): Solid => {
    const c = structuredClone(s);
    c.id = `${s.id}~${n}`;
    delete c.repeat;
    delete c.mirror;
    delete c.on;
    delete c.host;
    delete c.through;
    return c;
  };
  const r = s.repeat;
  const base: Solid[] = [s];
  if (r && r.count > 1) {
    for (let i = 1; i < Math.min(64, Math.round(r.count)); i++) {
      const c = copy(out.length + 1);
      if (r.kind === 'line') translateSolid(c, r.dx * i, r.dz * i);
      else if (r.kind === 'ring') spinAbout(c, r.cx, r.cz, (360 / r.count) * i);
      else {
        // A helix (Blender's Screw / an array with a rotating, rising offset): a spiral stair of slabs.
        spinAbout(c, r.cx, r.cz, r.turn * i);
        c.base = s.base + r.rise * i;
      }
      out.push(c);
      base.push(c);
    }
  }
  if (s.mirror) {
    for (const src of base) {
      const c = copy(out.length + 1);
      c.plan = structuredClone(src.plan);
      c.roof = { ...src.roof };
      // Across the building's own axis: x = 0 (mirror X) or z = 0 (mirror Z).
      mirrorSolid(c, s.mirror, [0, 0]);
      out.push(c);
    }
  }
  return out;
}

/**
 * Hollow shell (like Blender's Solidify on a closed mesh, SketchUp's "Shell"): the inside of a volume as a
 * cutter right after it, its plan offset in by the thickness, from the floor plate to under the top. Null
 * when the volume is too thin for it.
 */
export function shellCutter(s: Solid): Solid | null {
  const t = s.shell ?? 0;
  if (!(t > 0) || s.op !== 'add' || s.height <= 2 * t + 0.05) return null;
  const inset = (ring: Solid['plan']['outer'], sign: number) => {
    const pts = offsetRing(ring.map((v) => v.p), ring.map(() => t));
    return ringValid(pts, sign) ? ring.map((v, i) => ({ ...v, id: `${v.id}~s`, p: pts[i]!, round: v.round ? Math.max(0, v.round - t) : undefined, chamfer: undefined })) : null;
  };
  const outer = inset(s.plan.outer, Math.sign(signedArea2(s.plan.outer.map((v) => v.p))) || 1);
  if (!outer) return null;
  const holes = s.plan.holes.map((h) => inset(h, Math.sign(signedArea2(h.map((v) => v.p))) || -1)).filter((h): h is NonNullable<typeof h> => !!h);
  const c = structuredClone(s);
  c.id = `${s.id}~shell`;
  c.op = 'subtract';
  c.plan = { outer, holes };
  c.base = s.base + t;
  c.height = s.height - 2 * t;
  c.roof = { ...s.roof, kind: 'flat', parapet: 0, overhang: 0 };
  c.facade = [];
  c.edges = {};
  for (const k of ['repeat', 'mirror', 'shell', 'on', 'host', 'through', 'revolve'] as const) delete (c as Partial<Solid>)[k];
  return c;
}

/** Suffix of the cutters that open a shell's floor for a stair (interior.ts leaves them out of the rooms). */
export const STAIR_OPENING = '~open';

/**
 * The inside of a hollow volume of several floors: one cutter per floor, so a slab as thick as the
 * shell stays at every level above the ground, and an opening in each slab a stair climbs through
 * (its footprint, as the stair tool cuts it: model/stairs.ts).
 */
export function shellCutters(s: Solid, b: Pick<Building3, 'levels' | 'items'>): Solid[] {
  const one = shellCutter(s);
  if (!one) return [];
  const t = s.shell ?? 0;
  const lo = one.base,
    hi = one.base + one.height;
  const levels = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation > lo + 0.5 && l.elevation + t < hi - 0.5);
  if (!levels.length) return [one];
  const out: Solid[] = [];
  const bands = [lo, ...levels.map((l) => l.elevation)];
  bands.forEach((y0, i) => {
    const base = i === 0 ? y0 : y0 + t;
    const top = i + 1 < bands.length ? bands[i + 1]! : hi;
    if (top - base < 0.3) return;
    out.push({ ...structuredClone(one), id: `${one.id}${i ? `-${i}` : ''}`, base, height: top - base });
  });
  for (const it of b.items ?? []) {
    if (it.host.kind !== 'free' || typeById(it.type)?.family !== 'stair') continue;
    const rise = typeof it.params.rise === 'number' ? it.params.rise : 3;
    const going = typeof it.params.going === 'number' ? it.params.going : 0.28;
    const maxRiser = typeof it.params.maxRiser === 'number' ? it.params.maxRiser : 0.18;
    const reach = it.host.p[1] + rise;
    const lv = levels.find((l) => Math.abs(l.elevation - reach) < 0.15);
    if (!lv) continue;
    const ring = slabOpeningFor(it, stairRun(rise, going, maxRiser)).outer;
    // Counterclockwise like every outline (the plan's sign rule), whatever the stair's turn.
    const pts = signedArea2(ring) * signedArea2(s.plan.outer.map((v) => v.p)) < 0 ? [...ring].reverse() : ring;
    out.push({
      ...structuredClone(one),
      id: `${one.id}${STAIR_OPENING}-${it.id}`,
      plan: { outer: pts.map((p, i) => ({ id: `${it.id}~o${i}`, p })), holes: [] },
      base: lv.elevation - 0.02,
      height: t + 0.04,
    });
  }
  // Elevator shafts open every slab they pass through.
  shaftOpenings(b).forEach((o, i) => {
    if (!levels.some((l) => Math.abs(l.elevation - o.y) < 0.01)) return;
    const pts = signedArea2(o.ring) * signedArea2(s.plan.outer.map((v) => v.p)) < 0 ? [...o.ring].reverse() : o.ring;
    out.push({ ...structuredClone(one), id: `${one.id}${STAIR_OPENING}-shaft${i}`, plan: { outer: pts.map((p, j) => ({ id: `shaft${i}~o${j}`, p })), holes: [] }, base: o.y - 0.02, height: t + 0.04 });
  });
  return out;
}

/**
 * The openings an elevator shaft needs: its footprint (building frame, counterclockwise) in every slab
 * between its base and its top (the levels it passes through, above its own floor).
 */
export function shaftOpenings(b: Pick<Building3, 'levels' | 'items'>): { ring: Vec2[]; y: number }[] {
  const out: { ring: Vec2[]; y: number }[] = [];
  for (const it of b.items ?? []) {
    if (it.host.kind !== 'free' || typeById(it.type)?.family !== 'elevator') continue;
    const n = (k: string, d: number) => (typeof it.params[k] === 'number' ? (it.params[k] as number) : d);
    const w = n('width', 2),
      d = n('depth', 2),
      H = n('height', 6);
    const [x, y0, z] = it.host.p;
    const a = (it.host.rot * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const at = (u: number, v: number): Vec2 => [x + u * c + v * s, z - u * s + v * c];
    const ring = [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
    const ccw = signedArea2(ring) > 0 ? ring : [...ring].reverse();
    for (const l of b.levels) if (l.elevation > y0 + 0.5 && l.elevation < y0 + H - 0.1) out.push({ ring: ccw, y: l.elevation });
  }
  return out;
}

/** The building as the evaluation sees it: each volume followed by its modifiers' copies. */
export function withModifiers(b: Building3): Building3 {
  if (!b.solids.some((s) => (s.repeat && s.repeat.count > 1) || s.mirror || s.shell)) return b;
  return {
    ...b,
    solids: b.solids.flatMap((s) => [s, ...modifierCopies(s), ...shellCutters(s, b)]),
  };
}
