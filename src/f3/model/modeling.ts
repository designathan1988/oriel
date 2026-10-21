// Modeling tools as document operations (non-destructive): what changes the
// mesh in Blender/3ds Max/SketchUp here creates or adjusts parametric volumes
// that stay editable.
//  - offsetPlan: parallel outline (SketchUp/Rhino Offset), keeps the arcs.
//  - extrudeSide / insetSide: extrude and inset of a side face → annex
//    (add) or recess (subtract), like Edit Poly Extrude/Inset.
//  - insetTop: top inset with depth → set-back volume or well/atrium.
//  - scaleSolid, splitAtHeight.
// No three.
import type { Building3, ID, Item, PlanVertex, Solid, Vec2 } from './schema';
import { arcOf, sampleRing, signedArea2 } from './plan';
import { cloneSolid, locateVertex, planValid } from './ops';
import { keyParts, pickLevels, solidLevels } from './levelpick';
import { roofSpec, solid, uid } from './defaults';

type Corner = 'sharp' | 'round' | 'chamfer';

const rotate = (t: Vec2, a: number): Vec2 => [t[0] * Math.cos(a) - t[1] * Math.sin(a), t[0] * Math.sin(a) + t[1] * Math.cos(a)];
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
/** Right of the travel direction: (tz, −tx). It is "outward" on a counterclockwise ring. */
const right = (t: Vec2): Vec2 => [t[1], -t[0]];

/**
 * Tangents at the start and end of the side leaving `a` (bulge = tan(θ/4); an
 * arc with bulge > 0 bulges to the right of the chord, so the outgoing tangent
 * turns θ/2 right and the incoming one θ/2 left).
 */
function tangents(a: Vec2, b: Vec2, bulge: number): { start: Vec2; end: Vec2 } {
  const c = norm([b[0] - a[0], b[1] - a[1]]);
  if (!bulge) return { start: c, end: c };
  const th = 4 * Math.atan(bulge);
  // Turning "right" on the (x, z) plane with positive area = counterclockwise is a negative angle.
  return { start: rotate(c, -th / 2), end: rotate(c, th / 2) };
}

function lineHit(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Offsets a ring: `dist(edgeId)` > 0 pushes the side out of the material. Each
 * vertex goes to the intersection of the offset tangents of its two sides
 * (arcs stay concentric: the bulge does not change). `outer` says whether the
 * ring is the outline (material inside) or a hole (material outside).
 */
export function offsetRingVertices(ring: PlanVertex[], dist: (id: ID) => number, outer: boolean, corner: Corner = 'sharp', keepIds = true): PlanVertex[] {
  const n = ring.length;
  const ccw = signedArea2(ring.map((v) => v.p)) > 0;
  // Outside the material = right of travel on the counterclockwise outline and the clockwise hole.
  const sgn = outer === ccw ? 1 : -1;
  const tg = ring.map((v, i) => tangents(v.p, ring[(i + 1) % n]!.p, v.bulge ?? 0));
  return ring.map((v, i) => {
    const ip = (i - 1 + n) % n;
    const dIn = dist(ring[ip]!.id) * sgn,
      dOut = dist(v.id) * sgn;
    const tIn = tg[ip]!.end,
      tOut = tg[i]!.start;
    const nIn = right(tIn),
      nOut = right(tOut);
    const pIn: Vec2 = [v.p[0] + nIn[0] * dIn, v.p[1] + nIn[1] * dIn];
    const pOut: Vec2 = [v.p[0] + nOut[0] * dOut, v.p[1] + nOut[1] * dOut];
    const hit = lineHit(pIn, tIn, pOut, tOut);
    const p = hit ?? pOut;
    const out: PlanVertex = { ...v, id: keepIds ? v.id : uid(), p };
    // Material on the left of travel when sgn = 1; a convex corner = a turn toward the material side.
    const turn = tIn[0] * tOut[1] - tIn[1] * tOut[0];
    const convex = turn * sgn > 0;
    const d = (dist(ring[ip]!.id) + dist(v.id)) / 2;
    // A rounded corner follows: the radius grows on a convex corner and shrinks on a concave one (concentric).
    if (v.round) out.round = Math.max(0, v.round + (convex ? d : -d));
    // A growing sharp corner: filled like the Rhino Offset (round or chamfer).
    if (hit && convex && d > 0 && corner !== 'sharp' && !v.bulge && !ring[ip]!.bulge) {
      const cos = Math.max(-1, Math.min(1, tIn[0] * tOut[0] + tIn[1] * tOut[1]));
      const alpha = Math.acos(cos);
      if (alpha > 1e-3) {
        if (corner === 'round') out.round = (v.round ?? 0) + d;
        else out.chamfer = (v.chamfer ?? 0) + d * Math.tan(alpha / 2);
      }
    }
    return out;
  });
}

/**
 * Offset of the whole plan by `d` (m; > 0 grows, < 0 shrinks). Holes move the
 * opposite way (the material grows into them). Returns the new plan or null if
 * it would self-intersect.
 */
export function offsetPlan(s: Solid, d: number, corner: Corner = 'sharp', keepIds = true): Solid['plan'] | null {
  const plan: Solid['plan'] = {
    outer: offsetRingVertices(s.plan.outer, () => d, true, corner, keepIds),
    holes: s.plan.holes.map((h) => offsetRingVertices(h, () => d, false, corner, keepIds)),
  };
  return sameShape(s.plan, plan) && planValid(plan) ? plan : null;
}

/**
 * The offset did not turn the plan inside out: same orientation on each ring
 * and no straight side with a reversed direction (shrinking past half the width
 * makes a side "cross" the opposite one).
 */
function sameShape(a: Solid['plan'], b: Solid['plan']): boolean {
  const rings: [PlanVertex[], PlanVertex[]][] = [[a.outer, b.outer], ...a.holes.map((h, i) => [h, b.holes[i]!] as [PlanVertex[], PlanVertex[]])];
  for (const [r0, r1] of rings) {
    if (Math.sign(signedArea2(r0.map((v) => v.p))) !== Math.sign(signedArea2(r1.map((v) => v.p)))) return false;
    for (let i = 0; i < r0.length; i++) {
      const j = (i + 1) % r0.length;
      const d0: Vec2 = [r0[j]!.p[0] - r0[i]!.p[0], r0[j]!.p[1] - r0[i]!.p[1]];
      const d1: Vec2 = [r1[j]!.p[0] - r1[i]!.p[0], r1[j]!.p[1] - r1[i]!.p[1]];
      if (d0[0] * d1[0] + d0[1] * d1[1] <= 1e-9) return false;
    }
  }
  return true;
}

/** Adds typical floors (without touching the volumes) until elevation y is covered. */
export function levelsUpTo(b: Building3, y: number): void {
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  let last = lv[lv.length - 1];
  let top = last ? last.elevation + last.height : 0;
  while (y > top + typ * 0.5 && b.levels.length < 60) {
    const n = b.levels.length;
    last = { id: uid(), name: `Floor ${n}`, elevation: top, height: typ };
    b.levels.push(last);
    top += typ;
  }
}

/** Applies the offset on the volume itself (sides, rules and parts keep the same IDs). */
export function offsetSolid(s: Solid, d: number, corner: Corner = 'sharp'): boolean {
  const plan = offsetPlan(s, d, corner, true);
  if (!plan) return false;
  s.plan = plan;
  return true;
}

/**
 * After a Clipper2 offset (the outline split or lost a part, so the exact offset could not keep its
 * vertices), gives the new sides back their identity (audit E3: side materials, rule sides and hosted
 * parts were reset). Each new side is matched to the old side it is a parallel copy of: same outward
 * direction, on the line of the old side moved by `d`. The first new piece of an old side keeps its ID
 * (hosted parts and exceptions stay with it); the other pieces of that side get its settings and join
 * the rules that named it (a split side keeps its rules on both halves). `pieces[0]` is the original
 * volume with its new plan; the others are new volumes. Hosted parts on a side that went to another
 * piece move to that piece.
 */
export function adoptOffsetSides(old: Solid, pieces: Solid[], d: number, items: Item[] = []): void {
  type Seg = { a: Vec2; t: Vec2; n: Vec2; len: number; edge: ID; tol: number };
  const segsOf = (s: Solid, offset: number, sampled: boolean): Seg[][] =>
    [s.plan.outer, ...s.plan.holes].map((ring) => {
      const sgn = (ring === s.plan.outer) === signedArea2(ring.map((v) => v.p)) > 0 ? 1 : -1;
      const out: Seg[] = [];
      const pts = sampled ? sampleRing(ring) : { pts: ring.map((v) => v.p), segs: ring.map((v) => ({ edge: v.id, curved: false })) };
      for (let i = 0; i < pts.pts.length; i++) {
        const a = pts.pts[i]!,
          b = pts.pts[(i + 1) % pts.pts.length]!;
        const sg = pts.segs[i]!;
        if (sg.edge.endsWith(':c')) continue;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const t = norm([b[0] - a[0], b[1] - a[1]]);
        const r = right(t);
        const n: Vec2 = [r[0] * sgn, r[1] * sgn];
        out.push({ a: [a[0] + n[0] * offset, a[1] + n[1] * offset], t, n, len, edge: sg.edge, tol: sg.curved ? 0.15 : 0.05 + 0.02 * Math.abs(offset) });
      }
      return out;
    });
  const from = segsOf(old, d, true).flat();
  const reach = Math.abs(d) * 2.5 + 0.05;
  /** Old side each new side comes from (null: a side Clipper made, such as a cut through a vanished neck). */
  const sourceOf = (s: Seg): ID | null => {
    const mid: Vec2 = [s.a[0] + s.t[0] * s.len * 0.5, s.a[1] + s.t[1] * s.len * 0.5];
    let best: ID | null = null,
      bd = Infinity;
    for (const o of from) {
      if (o.n[0] * s.n[0] + o.n[1] * s.n[1] < 0.995) continue;
      const rx = mid[0] - o.a[0],
        rz = mid[1] - o.a[1];
      const along = rx * o.t[0] + rz * o.t[1];
      const off = Math.abs(rx * o.n[0] + rz * o.n[1]);
      if (off > o.tol || along < -reach || along > o.len + reach) continue;
      if (off < bd) {
        bd = off;
        best = o.edge;
      }
    }
    return best;
  };
  const kept = new Map<ID, Solid>();
  const derived = new Map<ID, Map<Solid, ID[]>>();
  pieces.forEach((pc) => {
    const rings = [pc.plan.outer, ...pc.plan.holes];
    const segs = segsOf(pc, 0, false);
    rings.forEach((ring, ri) => {
      segs[ri]!.forEach((sg) => {
        const src = sourceOf(sg);
        if (!src) return;
        const v = ring.find((x) => x.id === sg.edge)!;
        if (!kept.has(src)) {
          kept.set(src, pc);
          v.id = src;
        } else {
          const m = derived.get(src) ?? new Map<Solid, ID[]>();
          m.set(pc, [...(m.get(pc) ?? []), v.id]);
          derived.set(src, m);
        }
        const spec = old.edges[src];
        if (spec) pc.edges[v.id] = structuredClone(spec);
      });
    });
  });
  // Rules: each piece keeps the rules that still have a side in it (named sides mapped to the new ones;
  // "every side" stays every side). A rule whose sides all vanished stays on the original volume (it
  // reports placing nothing) rather than being lost.
  const idsIn = (e: ID, pc: Solid): ID[] => [...(kept.get(e) === pc ? [e] : []), ...(derived.get(e)?.get(pc) ?? [])];
  const lost = new Set(old.facade.filter((r) => r.edges.length && !pieces.some((pc) => r.edges.some((e) => idsIn(e, pc).length))).map((r) => r.id));
  pieces.forEach((pc, i) => {
    pc.facade = old.facade.flatMap((r) => {
      if (!r.edges.length) return [{ ...structuredClone(r), id: i ? uid() : r.id }];
      const edges = r.edges.flatMap((e) => idsIn(e, pc));
      if (!edges.length) return !i && lost.has(r.id) ? [structuredClone(r)] : [];
      const except = Object.fromEntries(Object.entries(r.except).filter(([k]) => kept.get(keyParts(k)?.edge ?? '') === pc));
      return [{ ...structuredClone(r), id: i ? uid() : r.id, edges, except }];
    });
  });
  for (const it of items) if (it.host.kind === 'face' && it.host.solid === old.id) {
    const to = kept.get(it.host.edge);
    if (to) it.host.solid = to.id;
  }
}

/**
 * Offset copy as a new volume, stacked on top of the source (a setback storey when it shrinks, an
 * overhanging one when it grows), one floor high. Before, it stood in the same place as the source,
 * hidden inside it (shrinking) or swallowing it (growing).
 */
export function offsetCopy(b: Building3, s: Solid, d: number, corner: Corner = 'sharp'): Solid | null {
  const plan = offsetPlan(s, d, corner, true);
  if (!plan) return null;
  const c = cloneSolid({ ...s, plan });
  stackOnTop(b, s, c);
  b.solids.push(c);
  return c;
}

/** Puts a copy made from `s` on its top, one floor high, flat-roofed (model/relations.ts seats it there). */
export function stackOnTop(b: Building3, s: Solid, c: Solid): void {
  const top = s.base + s.height;
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const floor = lv.find((l) => l.elevation >= top - 0.05)?.height ?? lv[lv.length - 1]?.height ?? 3;
  c.name = `${s.name.replace(/ \(offset\)$/, '')} (offset)`;
  c.base = top;
  c.height = floor;
  c.taper = 0;
  c.plinth = 0;
  c.roof = roofSpec('flat', { parapet: s.roof.kind === 'flat' || s.roof.kind === 'terrace' ? s.roof.parapet : 0.6 });
  // The source's top becomes a floor for the new storey: no parapet between them.
  if (s.roof.kind === 'flat' || s.roof.kind === 'terrace') s.roof = { ...s.roof, kind: 'terrace', parapet: Math.max(1.05, s.roof.parapet) };
  else s.roof = roofSpec('flat', { parapet: 0 });
  delete c.on;
  delete c.topLevel;
}

// ── Side faces ─────────────────────────────────────────────────────────

/** Point and normal (out of the material) at a distance `u` along the side. */
function along(s: Solid, ring: PlanVertex[], i: number, u: number): { p: Vec2; n: Vec2; len: number } {
  const a = ring[i]!,
    b = ring[(i + 1) % ring.length]!;
  const outer = ring === s.plan.outer;
  const ccw = signedArea2(ring.map((v) => v.p)) > 0;
  const sgn = outer === ccw ? 1 : -1;
  const bulge = a.bulge ?? 0;
  if (!bulge) {
    const len = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    const t = norm([b.p[0] - a.p[0], b.p[1] - a.p[1]]);
    const k = Math.max(0, Math.min(len, u));
    const r = right(t);
    return { p: [a.p[0] + t[0] * k, a.p[1] + t[1] * k], n: [r[0] * sgn, r[1] * sgn], len };
  }
  const arc = arcOf(a.p, b.p, bulge);
  const len = Math.abs(arc.theta) * arc.r;
  const f = Math.max(0, Math.min(1, u / len));
  const ang = arc.a0 + arc.theta * f;
  const p: Vec2 = [arc.c[0] + Math.cos(ang) * arc.r, arc.c[1] + Math.sin(ang) * arc.r];
  // Tangent along the travel direction; the normal is its right.
  const t: Vec2 = norm([-Math.sin(ang) * Math.sign(arc.theta), Math.cos(ang) * Math.sign(arc.theta)]);
  const r = right(t);
  return { p, n: [r[0] * sgn, r[1] * sgn], len };
}

/** Length of a side (an arc by its arc length). */
export function edgeLength(s: Solid, edge: ID): number {
  const loc = locateVertex(s, edge);
  if (!loc) return 0;
  return along(s, loc.ring, loc.i, 0).len;
}

export interface SideRegion {
  /** Margins along the side (m, from the start and the end). */
  left: number;
  right: number;
  /** Margins in height (m, from the foot and the top of the volume). */
  bottom: number;
  top: number;
}

/**
 * New volume on a span of a side face: `depth` > 0 projects outward (annex,
 * bay, projection, add); < 0 sinks (loggia, niche, subtract). Curved sides
 * follow the arc (the annex stays concentric).
 */
export function sideVolume(b: Building3, s: Solid, edge: ID, depth: number, region: SideRegion = { left: 0, right: 0, bottom: 0, top: 0 }): Solid | null {
  const loc = locateVertex(s, edge);
  if (!loc || Math.abs(depth) < 0.01) return null;
  const { ring, i } = loc;
  const len = along(s, ring, i, 0).len;
  const u0 = Math.max(0, region.left),
    u1 = Math.min(len, len - Math.max(0, region.right));
  if (u1 - u0 < 0.1) return null;
  const h = s.height - Math.max(0, region.bottom) - Math.max(0, region.top);
  if (h < 0.1) return null;
  const add = depth > 0;
  // Against the wall, without overlap: Manifold resolves coincident faces
  // in the booleans, and the displayed sizes stay exact.
  const inner = 0;
  const outerD = depth;
  const a = along(s, ring, i, u0),
    z = along(s, ring, i, u1);
  const bulge0 = ring[i]!.bulge ?? 0;
  const frac = len > 0 ? (u1 - u0) / len : 1;
  // Arc span: same direction, proportional angle.
  const subBulge = bulge0 ? Math.tan(Math.atan(bulge0) * frac) : 0;
  const P = (q: { p: Vec2; n: Vec2 }, d: number): Vec2 => [q.p[0] + q.n[0] * d, q.p[1] + q.n[1] * d];
  // Outline: the wall side (along travel) and back along the outside.
  const pts: { p: Vec2; bulge?: number }[] = [
    { p: P(a, inner), bulge: subBulge || undefined },
    { p: P(z, inner) },
    { p: P(z, outerD), bulge: subBulge ? -subBulge : undefined },
    { p: P(a, outerD) },
  ];
  const outer: PlanVertex[] = pts.map((q) => ({ id: uid(), p: q.p, ...(q.bulge ? { bulge: q.bulge } : {}) }));
  const n = solid({
    name: add ? `${s.name} (annex)` : `${s.name} (recess)`,
    op: add ? 'add' : 'subtract',
    plan: { outer, holes: [] },
    base: s.base + Math.max(0, region.bottom),
    height: h,
    roof: add ? roofSpec('flat', { parapet: s.roof.kind === 'flat' ? s.roof.parapet : 0 }) : roofSpec('flat', { parapet: 0 }),
    facade: add ? s.facade.filter((r) => r.mode !== 'count').map((r) => ({ ...structuredClone(r), id: uid(), edges: [], except: {} })) : [],
    materials: structuredClone(s.materials),
    plinth: add && s.base + region.bottom < 0.3 ? s.plinth : 0,
    ...(add && s.bevel ? { bevel: structuredClone(s.bevel) } : {}),
    ...(s.layer ? { layer: s.layer } : {}),
    host: { solid: s.id, edge },
  });
  if (!planValid(n.plan)) return null;
  // The annex comes right after its source volume (later cutters cut it too).
  const at = b.solids.indexOf(s);
  if (add) b.solids.splice(at + 1, 0, n);
  else b.solids.push(n);
  return n;
}

/** A side volume still shaped as made on its wall: four corners, the first side on the wall. */
export function hostedFrame(s: Solid): { a: Vec2; z: Vec2; n: Vec2; depth: number } | null {
  if (!s.host || s.plan.holes.length || s.plan.outer.length !== 4) return null;
  const [v0, v1, , v3] = s.plan.outer;
  const dx = v3!.p[0] - v0!.p[0],
    dz = v3!.p[1] - v0!.p[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  // Its plan runs out from the wall when it adds, into the wall when it cuts.
  const k = s.op === 'subtract' ? -1 : 1;
  return { a: v0!.p, z: v1!.p, n: [(dx / len) * k, (dz / len) * k], depth: len * k };
}

/**
 * New depth of a side volume, measured from its wall: > 0 a projection (add),
 * < 0 a niche (subtract); crossing the wall turns one into the other (SketchUp
 * Push/Pull: pulled out adds, pushed in removes). `host` gives a projection its
 * walls' rules and finishes.
 */
export function setSideDepth(s: Solid, depth: number, host?: Solid): boolean {
  const f = hostedFrame(s);
  if (!f || Math.abs(depth) < 0.05) return false;
  const [v0, v1, v2, v3] = s.plan.outer as [PlanVertex, PlanVertex, PlanVertex, PlanVertex];
  v2.p = [f.z[0] + f.n[0] * depth, f.z[1] + f.n[1] * depth];
  v3.p = [f.a[0] + f.n[0] * depth, f.a[1] + f.n[1] * depth];
  void v0;
  void v1;
  const add = depth > 0;
  if (add !== (s.op === 'add')) {
    s.op = add ? 'add' : 'subtract';
    s.name = s.name.replace(/\((annex|recess)\)$/, add ? '(annex)' : '(recess)');
    if (add && host) {
      s.facade = host.facade.filter((r) => r.mode !== 'count').map((r) => ({ ...structuredClone(r), id: uid(), edges: [], except: {} }));
      s.materials = structuredClone(host.materials);
      s.roof = roofSpec('flat', { parapet: host.roof.kind === 'flat' ? host.roof.parapet : 0 });
      s.plinth = s.base < 0.3 ? host.plinth : 0;
    } else if (!add) {
      s.facade = [];
      s.roof = roofSpec('flat', { parapet: 0 });
      s.plinth = 0;
    }
  }
  return planValid(s.plan);
}

/** Extrudes the whole side face. */
export function extrudeSide(b: Building3, s: Solid, edge: ID, depth: number): Solid | null {
  return sideVolume(b, s, edge, depth);
}

/** Side face inset: the same margin on the four sides of the span, then the depth. */
export function insetSide(b: Building3, s: Solid, edge: ID, margin: number, depth: number, keepBottom = false): Solid | null {
  return sideVolume(b, s, edge, depth, { left: margin, right: margin, bottom: keepBottom ? 0 : margin, top: margin });
}

// ── Top ────────────────────────────────────────────────────────────────

/**
 * Top inset: `inset` sets the outline back; `depth` > 0 raises a new volume
 * (extrude the top when inset = 0; a set-back floor when > 0); < 0 sinks (well,
 * atrium, pool, sunken terrace).
 */
export function insetTop(b: Building3, s: Solid, inset: number, depth: number): Solid | null {
  if (Math.abs(depth) < 0.01) return null;
  const plan = offsetPlan({ ...s, plan: s.plan }, -Math.max(0, inset) - s.taper, 'sharp', false);
  if (!plan) return null;
  const top = s.base + s.height;
  if (depth > 0) {
    const n = solid({
      name: `${s.name} (top)`,
      plan,
      base: top,
      height: depth,
      roof: structuredClone(s.roof),
      facade: s.facade.map((r) => ({ ...structuredClone(r), id: uid(), edges: [], except: {} })),
      materials: structuredClone(s.materials),
      plinth: 0,
      ...(s.layer ? { layer: s.layer } : {}),
    });
    // The one below becomes a slab: flat roof (terrace when an edge remains).
    s.roof = inset > 0.3 ? roofSpec('terrace') : roofSpec('flat', { parapet: 0 });
    b.solids.splice(b.solids.indexOf(s) + 1, 0, n);
    levelsUpTo(b, n.base + n.height);
    return n;
  }
  const d = Math.min(-depth, s.height - 0.1);
  const n = solid({
    name: `${s.name} (recess)`,
    op: 'subtract',
    plan,
    base: top - d,
    height: d + 1,
    roof: roofSpec('flat', { parapet: 0 }),
    plinth: 0,
    ...(s.layer ? { layer: s.layer } : {}),
  });
  b.solids.push(n);
  return n;
}

// ── Scale and split ────────────────────────────────────────────────────

/** Bounding box of the plan (building axes). */
export function planBox(s: Solid): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (const v of s.plan.outer) {
    x0 = Math.min(x0, v.p[0]);
    x1 = Math.max(x1, v.p[0]);
    z0 = Math.min(z0, v.p[1]);
    z1 = Math.max(z1, v.p[1]);
  }
  return { x0, x1, z0, z1 };
}

/**
 * Scales the plan in x and z from the box center (exact width and depth).
 * Arcs stay arcs through the new vertices; rounded corners scale by the
 * smaller of the two.
 */
export function scaleSolid(s: Solid, sx: number, sz: number): boolean {
  if (!(sx > 0.01 && sz > 0.01)) return false;
  const bx = planBox(s);
  const cx = (bx.x0 + bx.x1) / 2,
    cz = (bx.z0 + bx.z1) / 2;
  const before = structuredClone(s.plan);
  const k = Math.min(sx, sz);
  for (const ring of [s.plan.outer, ...s.plan.holes])
    for (const v of ring) {
      v.p = [cx + (v.p[0] - cx) * sx, cz + (v.p[1] - cz) * sz];
      if (v.round) v.round *= k;
      if (v.chamfer) v.chamfer *= k;
    }
  if (!planValid(s.plan)) {
    s.plan = before;
    return false;
  }
  return true;
}

/** Exact width (x) and depth (z). */
export function setSolidSize(s: Solid, w: number, d: number): boolean {
  const bx = planBox(s);
  const W = bx.x1 - bx.x0,
    D = bx.z1 - bx.z0;
  if (W < 1e-3 || D < 1e-3) return false;
  return scaleSolid(s, w / W, d / D);
}

/**
 * Splits the volume at elevation `y` (above its base): the original stays below
 * (with the parts below), a new volume goes on top with the roof, the top
 * bevel and the upper parts. Taper and leans continue.
 */
export function splitAtHeight(b: Building3, s: Solid, y: number): Solid | null {
  const h1 = y;
  if (!(h1 > 0.2 && h1 < s.height - 0.2)) return null;
  const H = s.height;
  // Plan of the upper one: the original ring at the cut height.
  const taper0 = s.taper;
  const leanOff = (id: ID) => taper0 * (h1 / H) + h1 * Math.tan(((Math.max(-60, Math.min(60, s.edges[id]?.lean ?? 0)) * Math.PI) / 180));
  const upperPlan: Solid['plan'] = {
    outer: offsetRingVertices(s.plan.outer, (id) => -leanOff(id), true, 'sharp', true),
    holes: s.plan.holes.map((h) => offsetRingVertices(h, (id) => -leanOff(id), false, 'sharp', true)),
  };
  if (!planValid(upperPlan)) return null;
  const upper = cloneSolid({ ...s, plan: upperPlan });
  // cloneSolid swaps the IDs in the same order: map old side → new.
  const map = new Map<ID, ID>();
  [s.plan.outer, ...s.plan.holes].forEach((r, ri) => r.forEach((v, vi) => map.set(v.id, ([upper.plan.outer, ...upper.plan.holes][ri]![vi]!).id)));
  // "Block" → "Block (upper)" → "Block (upper 2)": never "(upper) (upper)" (audit B3).
  const baseName = s.name.replace(/ \(upper(?: \d+)?\)$/, '');
  const taken = new Set(b.solids.map((x) => x.name));
  let un = `${baseName} (upper)`;
  for (let k = 2; taken.has(un); k++) un = `${baseName} (upper ${k})`;
  upper.name = un;
  upper.base = s.base + h1;
  upper.height = H - h1;
  upper.taper = s.taper * ((H - h1) / H);
  upper.plinth = 0;
  if (s.bevel) upper.bevel = { ...s.bevel, bottom: 0 };
  s.height = h1;
  s.taper = s.taper * (h1 / H);
  s.roof = roofSpec('flat', { parapet: 0 });
  if (s.bevel) s.bevel = { ...s.bevel, top: 0 };
  for (const e of Object.values(s.edges)) delete e.bevel;
  // Each piece keeps the rules of the floors it has (audit B3: both copied every rule, the shops of the
  // ground floor and the exceptions included): the ground floor's stay below, the top floor's (attic,
  // cornice) go up, the others on both; exceptions only where their floor is.
  const keepRules = (p: Solid, lower: boolean) => {
    const lv = solidLevels(b, p);
    const own = new Set(lv.map((l) => l.index));
    p.facade = p.facade
      .filter((r) => !(lower && r.levels === 'top') && pickLevels(r.levels, lv).length > 0)
      .map((r) => ({ ...r, except: Object.fromEntries(Object.entries(r.except).filter(([k]) => own.has(keyParts(k)?.level ?? -1))) }));
  };
  keepRules(s, true);
  keepRules(upper, false);
  b.solids.splice(b.solids.indexOf(s) + 1, 0, upper);
  // Upper parts move to the other volume in the same place: the start of the upper side
  // moved (taper), so the distance along the side is corrected.
  const shiftAlong = (edge: ID): number => {
    const lo = locateVertex(s, edge),
      up = locateVertex(upper, map.get(edge) ?? '');
    if (!lo || !up || lo.ring[lo.i]!.bulge) return 0;
    const a = lo.ring[lo.i]!.p,
      b2 = lo.ring[(lo.i + 1) % lo.ring.length]!.p;
    const t = norm([b2[0] - a[0], b2[1] - a[1]]);
    const q = up.ring[up.i]!.p;
    return (q[0] - a[0]) * t[0] + (q[1] - a[1]) * t[1];
  };
  // On a leaning face, y runs along the wall (not vertically): h1 becomes h1·√(1 + m²).
  const slantH1 = (edge: ID) => h1 * Math.hypot(1, leanOff(edge) / h1);
  for (const it of b.items) {
    const host = it.host;
    if ((host.kind === 'face' && host.solid === s.id && host.y >= slantH1(host.edge)) || (host.kind === 'roof' && host.solid === s.id)) {
      host.solid = upper.id;
      if (host.kind === 'face') {
        host.u -= shiftAlong(host.edge);
        host.y -= slantH1(host.edge);
        host.edge = map.get(host.edge) ?? host.edge;
      }
    }
  }
  return upper;
}

// ── Bands, cornice and plinth band (swept along the outline) ───────────

export type BandPreset = 'floors' | 'cornice' | 'base';

/** Adds ready bands: one at each slab, a cornice on top or a plinth band. */
export function addBands(b: Building3, s: Solid, preset: BandPreset): number {
  const list = (s.bands ??= []);
  const before = list.length;
  if (preset === 'floors') {
    for (const l of b.levels) {
      const y = l.elevation - s.base;
      if (y > 0.5 && y < s.height - 0.5) list.push({ id: uid(), y: y - 0.12, height: 0.24, depth: 0.08, profile: 'flat' });
    }
  } else if (preset === 'cornice') list.push({ id: uid(), y: Math.max(0, s.height - 0.6), height: 0.6, depth: 0.32, profile: 'cornice' });
  else list.push({ id: uid(), y: 0, height: Math.min(0.7, s.height / 3), depth: 0.06, profile: 'flat' });
  return list.length - before;
}

// ── Cuts (Cut tool) ────────────────────────────────────────────────────

/**
 * A side as a curve: its length, the distance along it of the point nearest to `p` and the point at a
 * distance (straight or arc; the cut tool and splitSideAt measure the same way).
 */
export function sideCurve(s: Solid, edge: ID): { len: number; param: (p: Vec2) => number; at: (u: number) => Vec2 } | null {
  const loc = locateVertex(s, edge);
  if (!loc) return null;
  const v0 = loc.ring[loc.i]!,
    v1 = loc.ring[(loc.i + 1) % loc.ring.length]!;
  if (v0.bulge) {
    const arc = arcOf(v0.p, v1.p, v0.bulge);
    const len = Math.abs(arc.theta) * arc.r;
    return {
      len,
      param: (p) => {
        let ang = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0]) - arc.a0;
        while (ang * Math.sign(arc.theta) < 0) ang += 2 * Math.PI * Math.sign(arc.theta);
        return Math.max(0, Math.min(len, (ang / arc.theta) * len));
      },
      at: (u) => {
        const ang = arc.a0 + arc.theta * (u / len);
        return [arc.c[0] + Math.cos(ang) * arc.r, arc.c[1] + Math.sin(ang) * arc.r];
      },
    };
  }
  const a = v0.p,
    z = v1.p;
  const len = Math.hypot(z[0] - a[0], z[1] - a[1]);
  return {
    len,
    param: (p) => Math.max(0, Math.min(len, ((p[0] - a[0]) * (z[0] - a[0]) + (p[1] - a[1]) * (z[1] - a[1])) / (len || 1))),
    at: (u) => [a[0] + ((z[0] - a[0]) * u) / (len || 1), a[1] + ((z[1] - a[1]) * u) / (len || 1)],
  };
}

/**
 * Vertical cut of a side face `u` m from its start: the side becomes two faces
 * (SketchUp: a line across a face splits it). The new face keeps the side's
 * finish, lean and rules; parts past the cut move onto it. An arc becomes two arcs (`u` along the arc).
 */
export function splitSideAt(b: Building3, s: Solid, edge: ID, u: number): ID | null {
  const loc = locateVertex(s, edge);
  if (!loc) return null;
  const v0 = loc.ring[loc.i]!,
    v1 = loc.ring[(loc.i + 1) % loc.ring.length]!;
  const arc = v0.bulge ? arcOf(v0.p, v1.p, v0.bulge) : null;
  const len = arc ? Math.abs(arc.theta) * arc.r : Math.hypot(v1.p[0] - v0.p[0], v1.p[1] - v0.p[1]);
  if (!(u > 0.1 && u < len - 0.1)) return null;
  const t = u / len;
  const id = uid();
  if (arc) {
    // A curved side splits into two arcs of the same circle (audit F5: curved sides could not be cut).
    const ang = arc.a0 + arc.theta * t;
    loc.ring.splice(loc.i + 1, 0, { id, p: [arc.c[0] + Math.cos(ang) * arc.r, arc.c[1] + Math.sin(ang) * arc.r], bulge: Math.tan((arc.theta * (1 - t)) / 4) });
    v0.bulge = Math.tan((arc.theta * t) / 4);
  } else loc.ring.splice(loc.i + 1, 0, { id, p: [v0.p[0] + (v1.p[0] - v0.p[0]) * t, v0.p[1] + (v1.p[1] - v0.p[1]) * t] });
  if (s.edges[edge]) s.edges[id] = structuredClone(s.edges[edge]!);
  for (const r of s.facade) {
    if (r.edges.includes(edge)) r.edges.push(id);
    // Exceptions counted from the end of the side belong to the new face (it ends where the side ended);
    // those from the start stay. One from the middle has no middle anymore: it stays and is reported.
    for (const [k, v] of Object.entries(r.except)) {
      const m = /^([^:]+):(\d+):e(\d+)$/.exec(k);
      if (!m || m[1] !== edge) continue;
      delete r.except[k];
      r.except[`${id}:${m[2]}:e${m[3]}`] = v;
    }
  }
  for (const it of b.items) {
    const h = it.host;
    if (h.kind === 'face' && h.solid === s.id && h.edge === edge && h.u > u) {
      h.edge = id;
      h.u -= u;
    }
  }
  return id;
}

/**
 * Cut of a volume along a straight line between two points of its outline (on
 * its top: the plan is split in two volumes of the same height, like a line
 * across a face in SketchUp). `a` and `z` lie on two different straight sides;
 * the line must stay inside the outline, and volumes with holes are not cut.
 */
export function splitByLine(b: Building3, s: Solid, a: Vec2, z: Vec2): Solid | null {
  if (s.plan.holes.length) return null;
  const V = s.plan.outer;
  const n = V.length;
  const onSide = (q: Vec2): { i: number; u: number } | null => {
    for (let i = 0; i < n; i++) {
      if (V[i]!.bulge) continue;
      const p0 = V[i]!.p,
        p1 = V[(i + 1) % n]!.p;
      const dx = p1[0] - p0[0],
        dz = p1[1] - p0[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const u = ((q[0] - p0[0]) * dx + (q[1] - p0[1]) * dz) / len;
      const off = Math.abs((q[0] - p0[0]) * dz - (q[1] - p0[1]) * dx) / len;
      if (off < 0.02 && u > 0.05 && u < len - 0.05) return { i, u };
    }
    return null;
  };
  const A = onSide(a),
    Z = onSide(z);
  if (!A || !Z || A.i === Z.i) return null;
  // The line stays inside: every sample of it is in the outline.
  const ring = V.map((v) => v.p);
  const inside = (q: Vec2) => {
    let c = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pi = ring[i]!,
        pj = ring[j]!;
      if (pi[1] > q[1] !== pj[1] > q[1] && q[0] < ((pj[0] - pi[0]) * (q[1] - pi[1])) / (pj[1] - pi[1]) + pi[0]) c = !c;
    }
    return c;
  };
  for (let k = 1; k < 20; k++) if (!inside([a[0] + ((z[0] - a[0]) * k) / 20, a[1] + ((z[1] - a[1]) * k) / 20])) return null;
  const walk = (from: number, to: number) => {
    const out: PlanVertex[] = [];
    for (let k = (from + 1) % n; ; k = (k + 1) % n) {
      out.push(V[k]!);
      if (k === to) break;
    }
    return out;
  };
  // Ring kept by `s`: a → V[A.i+1 … Z.i] → z. The other: z → V[Z.i+1 … A.i] → a.
  const aKeep = uid(),
    zKeep = uid();
  const keep: PlanVertex[] = [{ id: aKeep, p: [a[0], a[1]] }, ...walk(A.i, Z.i), { id: zKeep, p: [z[0], z[1]] }];
  const restSrc = walk(Z.i, A.i);
  const map = new Map<ID, ID>(restSrc.map((v) => [v.id, uid()]));
  const zRest = uid(),
    aRest = uid();
  const rest: PlanVertex[] = [{ id: zRest, p: [z[0], z[1]] }, ...restSrc.map((v) => ({ ...structuredClone(v), id: map.get(v.id)! })), { id: aRest, p: [a[0], a[1]] }];
  if (!planValid({ outer: keep, holes: [] }) || !planValid({ outer: rest, holes: [] })) return null;
  const edgeA = V[A.i]!.id,
    edgeZ = V[Z.i]!.id;
  const other = cloneSolid(s);
  other.name = `${s.name} (part)`;
  other.plan = { outer: rest, holes: [] };
  // Each piece of a cut side keeps its settings; the cut line itself is a new, plain side.
  other.edges = {};
  for (const [k, v] of Object.entries(s.edges)) if (map.has(k)) other.edges[map.get(k)!] = structuredClone(v);
  if (s.edges[edgeZ]) other.edges[zRest] = structuredClone(s.edges[edgeZ]!);
  if (s.edges[edgeA]) s.edges[aKeep] = structuredClone(s.edges[edgeA]!);
  // A rule on chosen sides follows them; one whose sides all went to the other piece leaves (no sides = all sides).
  other.facade = s.facade
    .map((r) => ({ ...structuredClone(r), id: uid(), edges: r.edges.flatMap((e) => [...(map.has(e) ? [map.get(e)!] : []), ...(e === edgeZ ? [zRest] : [])]), except: {}, named: r.edges.length > 0 }))
    .filter((r) => !r.named || r.edges.length)
    .map(({ named: _named, ...r }) => r);
  s.facade = s.facade
    .map((r) => ({ r, named: r.edges.length > 0, edges: [...r.edges.filter((e) => !map.has(e)), ...(r.edges.includes(edgeA) ? [aKeep] : [])] }))
    .filter((x) => !x.named || x.edges.length)
    .map((x) => ({ ...x.r, edges: x.edges }));
  s.plan = { outer: keep, holes: [] };
  for (const k of Object.keys(s.edges)) if (map.has(k)) delete s.edges[k];
  // Parts on the sides follow the piece they now stand on.
  for (const it of b.items) {
    const h = it.host;
    if (h.kind !== 'face' || h.solid !== s.id) continue;
    if (h.edge === edgeA && h.u >= A.u) {
      // Past the cut point on the first side: the piece that stays (it starts at `a`).
      h.edge = aKeep;
      h.u -= A.u;
    } else if (h.edge === edgeZ && h.u >= Z.u) {
      h.solid = other.id;
      h.edge = zRest;
      h.u -= Z.u;
    } else if (map.has(h.edge)) {
      h.solid = other.id;
      h.edge = map.get(h.edge)!;
    }
  }
  b.solids.splice(b.solids.indexOf(s) + 1, 0, other);
  return other;
}
