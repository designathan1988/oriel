// Persistent relations between the parts of a building, kept after every edit
// (the Store runs `resolveBuilding` on each touch and commit, so a drag, a panel
// field, a menu action, undo and an opened file all keep them the same way):
//  - a volume resting on another (`on`): its base follows the top of its support
//    (a support that moves carries it; a rider moved on its own leaves it);
//  - a volume's top on a floor (`topLevel`): the top of that level plus an offset,
//    like Revit's Top Constraint + Top Offset. When the floors change, the volume
//    follows them; when the volume is changed, it is attached again where it is;
//  - a cutter through a wall (`through`): when the wall moves out or bulges, the
//    cutter's outer end moves with it, so the opening keeps going through;
//  - a volume made on a side (`Solid.host`: annex, projection, niche): it follows the
//    side when the side moves, turns or changes length;
//  - a part hosted on a side (`host.anchor`): it keeps its distance to its anchor
//    (start, center or end of the side), chosen as the nearest when it is placed
//    (Lipp, Wonka, Wimmer 2008, anchored instance locators).
// A relation that cannot hold (support or wall deleted, rider no longer above its
// support) stays in the document and is reported by `relationWarnings`; undoing
// the edit, or putting the support back, restores it. No three.
import type { Building3, ID, Level, PlanVertex, Solid, Vec2 } from './schema';
import { oriented, sampleRing } from './plan';
import { inside, planCenter } from './ops';

/** Elevation tolerance (m) for "this volume stands on that top". */
const ON_TOL = 0.02;

export type Anchor = 'start' | 'center' | 'end';

/**
 * Outlines sampled and whole values compared since the count was last zeroed: the work of resolving,
 * as counts (test/unit/budget.test.ts).
 */
export const relationStats: { outlines: number; compares: number } = { outlines: 0, compares: 0 };

const sortedLevels = (b: Building3): Level[] => [...b.levels].sort((p, q) => p.elevation - q.elevation);
const topOfLevel = (l: Level) => l.elevation + l.height;
const top = (s: Solid) => s.base + s.height;
const same = (a: unknown, b: unknown) => (relationStats.compares++, JSON.stringify(a) === JSON.stringify(b));

/** sampleRing, counted. */
function sampled(ring: PlanVertex[]): ReturnType<typeof sampleRing> {
  relationStats.outlines++;
  return sampleRing(ring);
}

/** Outline points of a volume (sampled, counterclockwise). */
function ringOf(s: Solid): Vec2[] {
  return sampled(oriented(s.plan.outer, 1)).pts;
}

/** Does the plan of `s` overlap the plan of `sup` (center or any vertex inside)? */
function overlaps(s: Solid, sup: Solid): boolean {
  const r = ringOf(sup);
  if (inside(planCenter(s), r)) return true;
  return ringOf(s).some((p) => inside(p, r));
}

/** Length of a side and its straight frame (start, unit direction, outward normal). */
export function edgeFrame(s: Solid, edge: ID): { a: Vec2; t: Vec2; n: Vec2; len: number; ring: PlanVertex[]; i: number } | null {
  for (const ring of [s.plan.outer, ...s.plan.holes]) {
    const i = ring.findIndex((v) => v.id === edge);
    if (i < 0) continue;
    const a = ring[i]!.p,
      z = ring[(i + 1) % ring.length]!.p;
    const l = Math.hypot(z[0] - a[0], z[1] - a[1]) || 1;
    const t: Vec2 = [(z[0] - a[0]) / l, (z[1] - a[1]) / l];
    // Outward normal: to the right of travel on the counterclockwise outline (holes run the other way).
    const ccw = signedArea(ring) > 0;
    const isOuter = ring === s.plan.outer;
    const out = isOuter === ccw;
    const n: Vec2 = out ? [t[1], -t[0]] : [-t[1], t[0]];
    // Arc sides: the length along the arc (what the facade measures).
    const len = edgeLen(s, edge) || l;
    return { a, t, n, len, ring, i };
  }
  return null;
}

function signedArea(r: PlanVertex[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!.p,
      b = r[(i + 1) % r.length]!.p;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Length of a side along the sampled outline (arcs by their chords, like the facade). */
function edgeLen(s: Solid, edge: ID): number {
  for (const ring of [s.plan.outer, ...s.plan.holes]) {
    if (!ring.some((v) => v.id === edge)) continue;
    const r = sampled(ring);
    let L = 0;
    r.segs.forEach((g) => {
      if (g.edge === edge) L = Math.max(L, g.s1);
    });
    // A rounded corner at the end shortens the straight part: the side runs to the next vertex.
    const i = ring.findIndex((v) => v.id === edge);
    const a = ring[i]!.p,
      z = ring[(i + 1) % ring.length]!.p;
    return (ring[i]!.bulge ?? 0) !== 0 ? L : Math.hypot(z[0] - a[0], z[1] - a[1]);
  }
  return 0;
}

/** Nearest anchor of a position u on a side of length L (ties go to the ends, as in Lipp et al.). */
export function nearestAnchor(u: number, L: number): Anchor {
  const ds = u,
    de = L - u,
    dc = Math.abs(u - L / 2);
  if (dc < Math.min(ds, de) - 1e-6) return 'center';
  return ds <= de ? 'start' : 'end';
}

/** Does `s` rest (directly or through others) on `x`? (no cycles of supports) */
function restsOn(b: Building3, s: Solid, x: Solid): boolean {
  const seen = new Set<ID>();
  let cur: Solid | undefined = s;
  while (cur?.on && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.on === x.id) return true;
    cur = b.solids.find((q) => q.id === cur!.on);
  }
  return false;
}

/** Volumes in support order: a support before what rests on it. */
function supportOrder(b: Building3): Solid[] {
  const out: Solid[] = [];
  const done = new Set<ID>();
  const visit = (s: Solid, path: Set<ID>) => {
    if (done.has(s.id) || path.has(s.id)) return;
    path.add(s.id);
    const sup = s.on ? b.solids.find((q) => q.id === s.on) : undefined;
    if (sup) visit(sup, path);
    done.add(s.id);
    out.push(s);
  };
  for (const s of b.solids) visit(s, new Set());
  return out;
}

/** Volumes with a host side after their host (an annex made on an annex follows the first one). */
function hostOrder(b: Building3): Solid[] {
  const out: Solid[] = [];
  const done = new Set<ID>();
  const visit = (s: Solid, path: Set<ID>) => {
    if (done.has(s.id) || path.has(s.id)) return;
    path.add(s.id);
    const h = s.host ? b.solids.find((q) => q.id === s.host!.solid) : undefined;
    if (h) visit(h, path);
    done.add(s.id);
    out.push(s);
  };
  for (const s of b.solids) visit(s, new Set());
  return out;
}

/** The level whose top is nearest to elevation y, among those above the base. */
function nearestTop(lv: Level[], base: number, y: number): Level | null {
  let best: Level | null = null;
  for (const l of lv) {
    if (topOfLevel(l) < base + 0.3) continue;
    if (!best || Math.abs(topOfLevel(l) - y) < Math.abs(topOfLevel(best) - y) - 1e-9) best = l;
  }
  return best;
}

/** Floors cover the tallest volume (a new floor past half a floor; floors above everything go). Levels keep their IDs. */
function fitFloors(b: Building3, uid: () => string): void {
  const lv = sortedLevels(b);
  const add = b.solids.filter((s) => s.op === 'add' && !s.hidden);
  if (!add.length || !lv.length) return;
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  const need = Math.max(...add.map(top));
  while (lv.length < 60 && topOfLevel(lv[lv.length - 1]!) < need - typ / 2) {
    const last = lv[lv.length - 1]!;
    lv.push({ id: uid(), name: `Floor ${lv.length}`, elevation: topOfLevel(last), height: typ });
  }
  while (lv.length > 1 && lv[lv.length - 1]!.elevation >= need - 0.05) lv.pop();
  if (lv.length !== b.levels.length || lv.some((l, i) => l !== b.levels[i])) b.levels = lv;
}

/** Outward reach of a side within [u0, u1] along its chord frame (a curved side bulges). */
function reach(s: Solid, edge: ID, a: Vec2, t: Vec2, n: Vec2, u0: number, u1: number): number | null {
  const r = sampled(oriented(s.plan.outer, 1));
  let best: number | null = null;
  const k = r.pts.length;
  r.segs.forEach((g, i) => {
    if (g.edge !== edge) return;
    const p = r.pts[i]!,
      q = r.pts[(i + 1) % k]!;
    for (let j = 0; j <= 8; j++) {
      const x: Vec2 = [p[0] + ((q[0] - p[0]) * j) / 8, p[1] + ((q[1] - p[1]) * j) / 8];
      const u = (x[0] - a[0]) * t[0] + (x[1] - a[1]) * t[1];
      if (u < u0 - 1e-6 || u > u1 + 1e-6) continue;
      const v = (x[0] - a[0]) * n[0] + (x[1] - a[1]) * n[1];
      if (best === null || v > best) best = v;
    }
  });
  return best;
}

/** Span of a plan along a frame (min and max projection on t). */
function span(s: Solid, a: Vec2, t: Vec2): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of s.plan.outer) {
    const u = (v.p[0] - a[0]) * t[0] + (v.p[1] - a[1]) * t[1];
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  return [lo, hi];
}

/** Side of an additive volume that the cutter's outline crosses (the wall it goes through). */
function crossedSide(b: Building3, c: Solid): { solid: ID; edge: ID } | null {
  const cr = sampled(oriented(c.plan.outer, 1)).pts;
  let best: { solid: ID; edge: ID; n: number } | null = null;
  for (const s of b.solids) {
    if (s.op !== 'add' || s === c) continue;
    if (s.base >= top(c) || top(s) <= c.base) continue;
    const r = sampled(oriented(s.plan.outer, 1));
    const k = r.pts.length;
    const count = new Map<ID, number>();
    r.segs.forEach((g, i) => {
      if (g.edge.endsWith(':c')) return;
      const p = r.pts[i]!,
        q = r.pts[(i + 1) % k]!;
      for (let j = 0; j < cr.length; j++) if (segX(p, q, cr[j]!, cr[(j + 1) % cr.length]!)) count.set(g.edge, (count.get(g.edge) ?? 0) + 1);
    });
    for (const [edge, n] of count) if (n >= 2 && (!best || n > best.n)) best = { solid: s.id, edge, n };
  }
  return best ? { solid: best.solid, edge: best.edge } : null;
}

function segX(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c),
    d2 = o(a, b, d),
    d3 = o(c, d, a),
    d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export interface ResolveReport {
  /** Riders that left their support because they were moved on their own. */
  detached: ID[];
}

/**
 * Keeps the relations of building `b` after an edit. `prev` is the building as the
 * previous resolve left it (undefined when there is none: a freshly opened file); what
 * differs from it was changed by the edit and is taken as the user's intent.
 */
export function resolveBuilding(b: Building3, prev: Building3 | undefined, uid: () => string): ResolveReport {
  const report: ResolveReport = { detached: [] };
  const P = new Map((prev?.solids ?? []).map((s) => [s.id, s]));
  const byId = new Map(b.solids.map((s) => [s.id, s]));
  const changed = new Set<ID>();
  for (const s of b.solids) {
    const p = P.get(s.id);
    if (!p || p.base !== s.base || p.height !== s.height) changed.add(s.id);
  }
  const levelsChanged = !!prev && !same(sortedLevels(prev), sortedLevels(b));
  const lvById = () => new Map(b.levels.map((l) => [l.id, l]));
  // 1. Floors changed (count or heights): what was not edited follows its floor.
  if (levelsChanged) {
    const L = lvById();
    for (const s of b.solids) {
      if (changed.has(s.id) || !s.topLevel) continue;
      const l = L.get(s.topLevel.level);
      if (l) s.height = Math.max(0.3, topOfLevel(l) + s.topLevel.offset - s.base);
    }
  }
  // 2. Supports, a support before its riders.
  const moved = new Set<ID>();
  const topBefore = (id: ID) => {
    const p = P.get(id);
    return p ? top(p) : NaN;
  };
  for (const s of supportOrder(b)) {
    if (!s.on) continue;
    const sup = byId.get(s.on);
    if (!sup) continue; // Broken: kept (reported), the base stays.
    const supTop = top(sup);
    const supMoved = !P.has(sup.id) || Math.abs(topBefore(sup.id) - supTop) > 1e-9 || moved.has(sup.id);
    if (changed.has(s.id) && !supMoved && Math.abs(s.base - supTop) > ON_TOL && P.get(s.id)?.base !== s.base) {
      // Moved up or down on its own: it leaves the support (step 3 may seat it on another).
      delete s.on;
      report.detached.push(s.id);
      continue;
    }
    if (Math.abs(s.base - supTop) <= 1e-9) continue;
    const L = lvById();
    const tl = s.topLevel ? L.get(s.topLevel.level) : undefined;
    if (levelsChanged && tl && !changed.has(s.id)) {
      // The floors moved: base on the support, top on its own floor.
      s.base = supTop;
      s.height = Math.max(0.3, topOfLevel(tl) + s.topLevel!.offset - s.base);
    } else {
      // The support alone moved: the rider goes up or down with it, whole.
      s.base = supTop;
    }
    moved.add(s.id);
  }
  // 3. A volume placed (or moved) onto the top of another rests on it from now on.
  for (const s of b.solids) {
    if (s.on || !(changed.has(s.id) || !prev) || s.base < 0.05) continue;
    for (const sup of b.solids) {
      if (sup === s || sup.op !== 'add' || Math.abs(top(sup) - s.base) > ON_TOL) continue;
      if (restsOn(b, sup, s) || !overlaps(s, sup)) continue;
      s.on = sup.id;
      break;
    }
  }
  // 4. Floors cover what the edit built (not when the edit was on the floors themselves, nor when a
  // file is opened: its floors are what was saved).
  if (prev && !levelsChanged && (changed.size || moved.size)) fitFloors(b, uid);
  // 5. Volumes edited, carried or without a floor are attached again where they are.
  const lv = sortedLevels(b);
  const L = lvById();
  for (const s of b.solids) {
    const lost = s.topLevel && !L.has(s.topLevel.level);
    if (!(changed.has(s.id) || moved.has(s.id) || lost || !s.topLevel || !prev)) continue;
    const l = nearestTop(lv, s.base, top(s));
    if (!l) {
      delete s.topLevel;
      continue;
    }
    s.topLevel = { level: l.id, offset: Math.round((top(s) - topOfLevel(l)) * 1e4) / 1e4 };
  }
  // 6. Cutters through a wall: the outer end follows the wall.
  for (const c of b.solids) {
    if (c.op !== 'subtract') continue;
    const pc = P.get(c.id);
    const planEdited = !pc || !same(pc.plan, c.plan) || pc.base !== c.base;
    if (planEdited) {
      // Drawn or moved: the wall it goes through (if any) is found again.
      const x = crossedSide(b, c);
      if (x) c.through = x;
      else delete c.through;
      continue;
    }
    if (!c.through) continue;
    const host = byId.get(c.through.solid),
      ph = prev?.solids.find((q) => q.id === c.through!.solid);
    if (!host || !ph) continue;
    const f = edgeFrame(ph, c.through.edge);
    if (!f || !edgeFrame(host, c.through.edge)) continue;
    const [u0, u1] = span(pc, f.a, f.t);
    const r0 = reach(ph, c.through.edge, f.a, f.t, f.n, u0, u1),
      r1 = reach(host, c.through.edge, f.a, f.t, f.n, u0, u1);
    if (r0 === null || r1 === null || Math.abs(r1 - r0) < 1e-6) continue;
    const d = r1 - r0;
    for (const v of c.plan.outer) {
      const vn = (v.p[0] - f.a[0]) * f.n[0] + (v.p[1] - f.a[1]) * f.n[1];
      if (vn >= r0 - 0.01) v.p = [v.p[0] + f.n[0] * d, v.p[1] + f.n[1] * d];
    }
  }
  // 7. A volume made on a side (`host`: an annex, a projection, a niche) follows that side when the
  // side moves, turns or changes length and the volume itself was not edited: it keeps its place
  // against the side, measured from the side's nearest anchor (start, middle or end), so an annex in
  // the middle of a wall stays in the middle when the wall grows both ways (audit C4: Width grew from
  // the center and swallowed the annex). Hosts first, so an annex on an annex follows too.
  for (const s of hostOrder(b)) {
    if (!s.host || s.through) continue;
    const ps = P.get(s.id),
      host = byId.get(s.host.solid),
      ph = prev?.solids.find((q) => q.id === s.host!.solid);
    if (!ps || !host || !ph || !same(ps.plan, s.plan)) continue;
    const f0 = edgeFrame(ph, s.host.edge),
      f1 = edgeFrame(host, s.host.edge);
    if (!f0 || !f1 || f0.ring[f0.i]!.bulge || f1.ring[f1.i]!.bulge) continue;
    if (same([f0.a, f0.t, f0.len], [f1.a, f1.t, f1.len])) continue;
    const [lo, hi] = span(s, f0.a, f0.t);
    const anchor = nearestAnchor((lo + hi) / 2, f0.len);
    const k = anchor === 'start' ? 0 : anchor === 'center' ? 0.5 : 1;
    const a0: Vec2 = [f0.a[0] + f0.t[0] * f0.len * k, f0.a[1] + f0.t[1] * f0.len * k],
      a1: Vec2 = [f1.a[0] + f1.t[0] * f1.len * k, f1.a[1] + f1.t[1] * f1.len * k];
    for (const ring of [s.plan.outer, ...s.plan.holes])
      for (const v of ring) {
        const u = (v.p[0] - a0[0]) * f0.t[0] + (v.p[1] - a0[1]) * f0.t[1],
          w = (v.p[0] - a0[0]) * f0.n[0] + (v.p[1] - a0[1]) * f0.n[1];
        v.p = [a1[0] + f1.t[0] * u + f1.n[0] * w, a1[1] + f1.t[1] * u + f1.n[1] * w];
      }
  }
  // 8. Parts on a side keep their distance to their anchor.
  const PI = new Map((prev?.items ?? []).map((i) => [i.id, i]));
  for (const it of b.items) {
    const h = it.host;
    if (h.kind !== 'face') continue;
    const s = byId.get(h.solid);
    if (!s) continue;
    const ph = PI.get(it.id)?.host;
    const placed = !ph || ph.kind !== 'face' || ph.solid !== h.solid || ph.edge !== h.edge || ph.u !== h.u;
    if (placed) {
      // Placed or dragged (or an old file without anchors): the nearest anchor. A state put back
      // (no reference) keeps the anchor it has.
      if (!h.anchor || ph) {
        const a = nearestAnchor(h.u, edgeLen(s, h.edge));
        if (a === 'start') delete h.anchor;
        else h.anchor = a;
      }
      continue;
    }
    if (!h.anchor) continue;
    const ps = P.get(h.solid);
    if (!ps || same(ps.plan, s.plan)) continue;
    const L1 = edgeLen(s, h.edge),
      L0 = edgeLen(ps, h.edge);
    if (Math.abs(L1 - L0) < 1e-9) continue;
    h.u += h.anchor === 'end' ? L1 - L0 : (L1 - L0) / 2;
  }
  return report;
}

/** Relations that cannot hold right now (shown with the building warnings; nothing is moved silently). */
export function relationWarnings(b: Building3): string[] {
  const out: string[] = [];
  const byId = new Map(b.solids.map((s) => [s.id, s]));
  for (const s of b.solids) {
    if (s.on) {
      const sup = byId.get(s.on);
      if (!sup) out.push(`${s.name}: the volume it rested on is gone; it stays at ${s.base.toFixed(2)} m (Ctrl+Z brings the support back).`);
      else if (!overlaps(s, sup)) out.push(`${s.name}: no longer above ${sup.name}, which still carries its height.`);
    }
    if (s.op === 'subtract' && s.through && !byId.has(s.through.solid)) out.push(`${s.name}: the wall it cut through is gone.`);
    else if (s.host && !byId.has(s.host.solid)) out.push(`${s.name}: the volume whose wall it was made on is gone; it stays where it is.`);
  }
  return out;
}

/**
 * Direction for the curved or pointed top of a cutter, so that its arch shows on the wall it cuts
 * (audit D1: the arch ran along the cutter's width, the facade got a straight lintel and the curve
 * only showed on the ceiling). Across the wall it crosses (`through`), else along its longer side:
 * the arch spans the short one, as an arcade bay does.
 */
export function cutTopDirection(b: Building3, s: Solid): number {
  const host = s.through ? b.solids.find((x) => x.id === s.through!.solid) : undefined;
  const fr = host && s.through ? edgeFrame(host, s.through.edge) : null;
  const deg = (r: number) => ((((r * 180) / Math.PI) % 180) + 180) % 180;
  if (fr) return Math.round(deg(Math.atan2(fr.n[1], fr.n[0])) * 1e6) / 1e6;
  const xs = s.plan.outer.map((v) => v.p[0]),
    zs = s.plan.outer.map((v) => v.p[1]);
  return Math.max(...zs) - Math.min(...zs) > Math.max(...xs) - Math.min(...xs) ? 90 : 0;
}
