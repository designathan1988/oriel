// Operations on the forma/3 document (they mutate in place; the caller records
// the history). No three.
import type { Building3, ID, PlanVertex, Solid, Vec2 } from './schema';
import { arcOf, offsetRing, ringValid, sampleRing, signedArea2, oriented } from './plan';
import { uid } from './defaults';

const rad = (d: number) => (d * Math.PI) / 180;

/** World point [x, z] → building plan. */
export function toLocal(b: Building3, p: Vec2): Vec2 {
  const a = -rad(b.rotation);
  const dx = p[0] - b.position[0],
    dz = p[1] - b.position[1];
  // three: a Y rotation by θ takes (x, z) to (x cosθ + z sinθ, −x sinθ + z cosθ).
  return [dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a)];
}

export function toWorld(b: Building3, p: Vec2): Vec2 {
  const a = rad(b.rotation);
  return [b.position[0] + p[0] * Math.cos(a) + p[1] * Math.sin(a), b.position[1] - p[0] * Math.sin(a) + p[1] * Math.cos(a)];
}

/** World direction → plan (no translation). */
export function dirToLocal(b: Building3, d: Vec2): Vec2 {
  const a = -rad(b.rotation);
  return [d[0] * Math.cos(a) + d[1] * Math.sin(a), -d[0] * Math.sin(a) + d[1] * Math.cos(a)];
}

export function findSolid(b: Building3, id: ID | null | undefined): Solid | undefined {
  return id ? b.solids.find((s) => s.id === id) : undefined;
}

/** Ring holding the vertex/side (outer or hole) and its index in it. */
export function locateVertex(s: Solid, vid: ID): { ring: PlanVertex[]; i: number } | null {
  for (const ring of [s.plan.outer, ...s.plan.holes]) {
    const i = ring.findIndex((v) => v.id === vid);
    if (i >= 0) return { ring, i };
  }
  return null;
}

const baseId = (edge: ID) => (edge.endsWith(':c') ? edge.slice(0, -2) : edge);

/** Outward normal of the side (on the oriented ring). */
export function edgeNormal(s: Solid, edge: ID): Vec2 | null {
  const loc = locateVertex(s, baseId(edge));
  if (!loc) return null;
  const { ring, i } = loc;
  const sign = ring === s.plan.outer ? 1 : -1;
  const ccw = Math.sign(signedArea2(ring.map((v) => v.p))) === sign;
  const a = ring[i]!.p,
    b = ring[(i + 1) % ring.length]!.p;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const n: Vec2 = [t[1], -t[0]];
  return ccw ? n : [-n[0], -n[1]];
}

function lineHit(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Pushes (d > 0 outward) or pulls a side: the side line moves along its normal
 * and both vertices go to the intersection with the neighbouring sides (which
 * keep their direction). Returns false if the plan would become invalid.
 */
export function pushEdge(s: Solid, edge: ID, d: number, from?: Solid['plan']): boolean {
  const src = from ?? s.plan;
  const work = structuredClone(src);
  const target = { ...s, plan: work };
  const loc = locateVertex(target, baseId(edge));
  const n = edgeNormal(target, edge);
  if (!loc || !n) return false;
  const { ring, i } = loc;
  const N = ring.length;
  const ia = i,
    ib = (i + 1) % N;
  const a = ring[ia]!.p,
    b = ring[ib]!.p;
  const pa: Vec2 = [a[0] + n[0] * d, a[1] + n[1] * d],
    pb: Vec2 = [b[0] + n[0] * d, b[1] + n[1] * d];
  const dir: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const prev = ring[(ia - 1 + N) % N]!.p,
    next = ring[(ib + 1) % N]!.p;
  const na = lineHit(pa, dir, prev, [a[0] - prev[0], a[1] - prev[1]]) ?? pa;
  const nb = lineHit(pb, dir, next, [next[0] - b[0], next[1] - b[1]]) ?? pb;
  const sign = Math.sign(signedArea2(ring.map((v) => v.p)));
  ring[ia]!.p = na;
  ring[ib]!.p = nb;
  // The plan must not turn inside out (a side pulled past the opposite one).
  if (Math.sign(signedArea2(ring.map((v) => v.p))) !== sign || !planValid(work)) return false;
  s.plan = work;
  return true;
}

export function planValid(plan: Solid['plan']): boolean {
  const o = sampleRing(oriented(plan.outer, 1));
  if (!ringValid(o.pts, 1)) return false;
  return plan.holes.every((h) => ringValid(sampleRing(oriented(h, -1)).pts, -1));
}

/** Arc of a side from the point dragged at its middle (sagitta = distance to the chord). */
export function bendEdge(s: Solid, edge: ID, point: Vec2): boolean {
  const loc = locateVertex(s, baseId(edge));
  if (!loc) return false;
  const { ring, i } = loc;
  const a = ring[i]!.p,
    b = ring[(i + 1) % ring.length]!.p;
  const c = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (c < 0.05) return false;
  const n = edgeNormal(s, edge)!;
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const sag = (point[0] - m[0]) * n[0] + (point[1] - m[1]) * n[1];
  // A positive bulge curves to the right of the ring direction; the right is
  // "outward" on the counterclockwise outer ring and on the clockwise hole.
  const ccw = signedArea2(ring.map((v) => v.p)) > 0;
  const rightIsOutward = ring === s.plan.outer ? ccw : !ccw;
  let bulge = (2 * sag) / c;
  if (Math.abs(sag) < 0.05) bulge = 0;
  bulge = Math.max(-1, Math.min(1, bulge));
  const before = ring[i]!.bulge;
  ring[i]!.bulge = bulge === 0 ? undefined : rightIsOutward ? bulge : -bulge;
  if (!planValid(s.plan)) {
    ring[i]!.bulge = before;
    return false;
  }
  return true;
}

export function moveVertex(s: Solid, vid: ID, p: Vec2): boolean {
  const loc = locateVertex(s, vid);
  if (!loc) return false;
  const before = loc.ring[loc.i]!.p;
  const sign = Math.sign(signedArea2(loc.ring.map((v) => v.p)));
  loc.ring[loc.i]!.p = [p[0], p[1]];
  if (Math.sign(signedArea2(loc.ring.map((v) => v.p))) !== sign || !planValid(s.plan)) {
    loc.ring[loc.i]!.p = before;
    return false;
  }
  return true;
}

/** Splits a side in half (or at the given point); the new vertex inherits the source side. */
/**
 * Splits a side with a new corner (in the middle, or at the point of the side nearest to `at`). An arc
 * stays an arc: two arcs of the same circle (before, it was straightened into two lines). The new
 * half keeps the side's settings and the rules that named the side (both halves keep them).
 */
export function splitEdge(s: Solid, edge: ID, at?: Vec2): ID | null {
  const loc = locateVertex(s, baseId(edge));
  if (!loc) return null;
  const { ring, i } = loc;
  const a = ring[i]!,
    b = ring[(i + 1) % ring.length]!;
  const v: PlanVertex = { id: uid(), p: [0, 0] };
  if (a.bulge) {
    const arc = arcOf(a.p, b.p, a.bulge);
    let f = 0.5;
    if (at) {
      // Angle of `at` from the arc start, in the arc's turning sense.
      let ang = Math.atan2(at[1] - arc.c[1], at[0] - arc.c[0]) - arc.a0;
      while (ang * Math.sign(arc.theta) < 0) ang += 2 * Math.PI * Math.sign(arc.theta);
      f = Math.max(0.02, Math.min(0.98, ang / arc.theta));
    }
    const t = arc.a0 + arc.theta * f;
    v.p = [arc.c[0] + Math.cos(t) * arc.r, arc.c[1] + Math.sin(t) * arc.r];
    v.bulge = Math.tan((arc.theta * (1 - f)) / 4);
    a.bulge = Math.tan((arc.theta * f) / 4);
  } else {
    const p = at ?? [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    v.p = [p[0], p[1]];
  }
  ring.splice(i + 1, 0, v);
  if (s.edges[a.id]) s.edges[v.id] = { ...s.edges[a.id] };
  for (const r of s.facade) if (r.edges.includes(a.id)) r.edges.push(v.id);
  return v.id;
}

export function removeVertex(s: Solid, vid: ID): boolean {
  const loc = locateVertex(s, vid);
  if (!loc || loc.ring.length <= 3) return false;
  const removed = loc.ring.splice(loc.i, 1)[0]!;
  if (!planValid(s.plan)) {
    loc.ring.splice(loc.i, 0, removed);
    return false;
  }
  delete s.edges[vid];
  return true;
}

/** Plan center (average of the outer ring vertices). */
export function planCenter(s: Solid): Vec2 {
  const o = s.plan.outer;
  let x = 0,
    z = 0;
  for (const v of o) {
    x += v.p[0];
    z += v.p[1];
  }
  return [x / o.length, z / o.length];
}

export function translateSolid(s: Solid, dx: number, dz: number): void {
  for (const ring of [s.plan.outer, ...s.plan.holes]) for (const v of ring) v.p = [v.p[0] + dx, v.p[1] + dz];
}

/** Rotates the plan in degrees (three's sense: positive turns from x to −z) around c. */
export function rotateSolid(s: Solid, deg: number, c: Vec2 = planCenter(s)): void {
  const a = rad(deg);
  const cos = Math.cos(a),
    sin = Math.sin(a);
  for (const ring of [s.plan.outer, ...s.plan.holes])
    for (const v of ring) {
      const x = v.p[0] - c[0],
        z = v.p[1] - c[1];
      v.p = [c[0] + x * cos + z * sin, c[1] - x * sin + z * cos];
    }
}

export function mirrorSolid(s: Solid, axis: 'x' | 'z', c: Vec2 = planCenter(s)): void {
  mirrorSolidAbout(s, c, axis === 'x' ? [0, 1] : [1, 0]);
}

/** Reflection of a point across the line through `a` along the unit direction `d`. */
export function reflect(p: Vec2, a: Vec2, d: Vec2): Vec2 {
  const t = (p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1];
  const f: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t];
  return [2 * f[0] - p[0], 2 * f[1] - p[1]];
}

/** Mirrors a solid across the line through `a` along the unit direction `d` (plan frame of its building). */
export function mirrorSolidAbout(s: Solid, a: Vec2, d: Vec2): void {
  for (const ring of [s.plan.outer, ...s.plan.holes]) {
    for (const v of ring) v.p = reflect(v.p, a, d);
    // Mirroring flips the orientation: reverse while keeping each side with its ID. The reflection and
    // the reversal each swap left and right, so an arc keeps its sign (outward stays outward; before,
    // the sign was flipped and a mirrored curved front bent inward).
    const rev = [...ring].reverse();
    const ids = rev.map((_, i) => rev[(i + 1) % rev.length]!);
    const fixed = rev.map((v, i) => ({ ...v, id: ids[i]!.id, bulge: ids[i]!.bulge || undefined, round: v.round, chamfer: v.chamfer }));
    ring.splice(0, ring.length, ...fixed);
  }
}

/** Copy of a solid with new IDs (sides and rules remapped). */
/** Copy with new ids; `map` receives old vertex → new (edges carry the id of their start vertex). */
export function cloneSolid(s: Solid, map = new Map<ID, ID>()): Solid {
  const ring = (r: PlanVertex[]) =>
    r.map((v) => {
      const id = uid();
      map.set(v.id, id);
      return { ...v, id, p: [v.p[0], v.p[1]] as Vec2 };
    });
  const c: Solid = structuredClone(s);
  c.id = uid();
  c.plan = { outer: ring(s.plan.outer), holes: s.plan.holes.map(ring) };
  c.edges = Object.fromEntries(Object.entries(s.edges).map(([k, v]) => [map.get(k) ?? k, structuredClone(v)]));
  c.facade = s.facade.map((r) => ({ ...structuredClone(r), id: uid(), edges: r.edges.map((e) => map.get(e) ?? e), except: Object.fromEntries(Object.entries(r.except).map(([k, v]) => [k.replace(/^[^:]+/, (e) => map.get(e) ?? e), v])) }));
  return c;
}

export function cloneBuilding(b: Building3): Building3 {
  const c: Building3 = structuredClone(b);
  c.id = uid();
  const solidMap = new Map<ID, ID>();
  const vertexMap = new Map<ID, ID>();
  c.solids = b.solids.map((s) => {
    const n = cloneSolid(s, vertexMap);
    solidMap.set(s.id, n.id);
    return n;
  });
  // References between the copied volumes point to the copies (wall of a niche, support, wall cut through).
  const sid = (id: ID) => solidMap.get(id) ?? id;
  const vid = (id: ID) => vertexMap.get(id) ?? id;
  for (const s of c.solids) {
    if (s.host) s.host = { solid: sid(s.host.solid), edge: vid(s.host.edge) };
    if (s.on) s.on = sid(s.on);
    if (s.through) s.through = { solid: sid(s.through.solid), edge: vid(s.through.edge) };
  }
  c.items = b.items.map((it) => {
    const n = structuredClone(it);
    n.id = uid();
    if (n.host.kind === 'face' || n.host.kind === 'roof') n.host.solid = solidMap.get(n.host.solid) ?? n.host.solid;
    // The face is the edge (start vertex id, with a curved-span suffix): it follows the copied vertex.
    if (n.host.kind === 'face') n.host.edge = n.host.edge.replace(/^[^:]+/, (e) => vertexMap.get(e) ?? e);
    return n;
  });
  return c;
}

/** Top of the highest solid under a plan point (for stacking). */
export function topAt(b: Building3, p: Vec2): number {
  let best = 0;
  for (const s of b.solids) {
    if (s.op !== 'add' || s.hidden) continue;
    const r = sampleRing(oriented(s.plan.outer, 1));
    if (inside(p, r.pts)) best = Math.max(best, s.base + s.height);
  }
  return best;
}

export function inside(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Offset top (for handles): the top ring of a tapered solid. */
export function topRing(s: Solid): Vec2[] {
  const r = sampleRing(oriented(s.plan.outer, 1));
  return offsetRing(
    r.pts,
    r.segs.map(() => s.taper),
  );
}
