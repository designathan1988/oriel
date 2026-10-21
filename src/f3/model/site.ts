// Lots and streets (after Estúdio de Construção v4): the buildable area a lot's setbacks leave, a ready
// building put in it, a lot split in equal fronts, lots laid along a street on both sides, the street's
// asphalt and sidewalk outlines and the trees along it. Lots are `Project3.lots` (world plan,
// counterclockwise, `frontEdges` facing the street); streets are `Project3.streets`. Pure, no three.
import type { Lot } from '../../core/schema';
import type { Building3, ID, Item, Project3, Street, Vec2 } from './schema';
import { offsetRing, ringValid, signedArea2 } from './plan';
import { building, facadeRule, levelsFor, planVertices, roofSpec, solid } from './defaults';
import { toLocal } from './ops';
import { outerRing } from './lots';

export type { Lot };

export const DEFAULT_SETBACKS = { front: 4, side: 1.5, back: 3 };

const len = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** A lot as a counterclockwise ring (the stored polygon may come either way). */
export function lotRing(lot: Lot): Vec2[] {
  return signedArea2(lot.polygon) >= 0 ? lot.polygon : [...lot.polygon].reverse();
}

/** Index in `lotRing` of the stored polygon's side `i` (reversing turns side i into side n−2−i). */
export function ringSide(lot: Lot, i: number): number {
  const n = lot.polygon.length;
  return signedArea2(lot.polygon) >= 0 ? i % n : (((n - 2 - i) % n) + n) % n;
}

/** Setback of each side of a lot: front sides, the side opposite a front (back), the others (sides). */
export function sideSetbacks(lot: Lot): number[] {
  const sb = lot.rules?.setbacks ?? DEFAULT_SETBACKS;
  const n = lot.polygon.length;
  const front = new Set(lot.frontEdges.length ? lot.frontEdges : [0]);
  const back = new Set([...front].map((i) => (n === 4 ? (i + 2) % 4 : -1)));
  return Array.from({ length: n }, (_, i) => (front.has(i) ? sb.front : back.has(i) ? sb.back : sb.side));
}

/** What the setbacks leave to build on (counterclockwise world ring), or null when nothing is left. */
export function buildableArea(lot: Lot): Vec2[] | null {
  const ds = sideSetbacks(lot);
  const d: number[] = [];
  ds.forEach((v, i) => (d[ringSide(lot, i)] = v));
  const out = offsetRing(lotRing(lot), d);
  return ringValid(out, 1) && Math.abs(signedArea2(out)) > 4 ? out : null;
}

export type BuildKind = 'house' | 'residential' | 'commercial';

/**
 * A ready building on a lot: its volume fills the buildable area (a house of one floor with a hip
 * roof, a five-floor residential block, a three-floor commercial building with shops), facing the
 * street; the building belongs to the lot (`lotId`).
 */
export function buildOnLot(lot: Lot, kind: BuildKind, name: string): Building3 | null {
  const area = buildableArea(lot);
  if (!area) return null;
  const c: Vec2 = [area.reduce((a, p) => a + p[0], 0) / area.length, area.reduce((a, p) => a + p[1], 0) / area.length];
  // The building frame turns with the front side (its plan reads straight in the panel).
  const fi = ringSide(lot, lot.frontEdges[0] ?? 0);
  const ring = lotRing(lot);
  const a = ring[fi]!,
    b = ring[(fi + 1) % ring.length]!;
  const rot = -(Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const bld = building({ name, position: c, rotation: Math.round(rot * 1e4) / 1e4, lotId: lot.id, use: kind === 'commercial' ? 'commercial' : 'residential' });
  const local = area.map((p) => toLocal(bld, p));
  const floors = kind === 'house' ? 1 : kind === 'residential' ? 5 : 3;
  const ground = kind === 'commercial' ? 4.5 : 3.1;
  bld.levels = levelsFor(floors, kind === 'commercial' ? 3.9 : 3.1, ground);
  const height = bld.levels.reduce((s, l) => s + l.height, 0);
  const s = solid({
    name: kind === 'house' ? 'House' : kind === 'residential' ? 'Block' : 'Shop building',
    plan: { outer: planVertices(local), holes: [] },
    height,
    roof: kind === 'house' ? roofSpec('hip', { pitch: 25, overhang: 0.5 }) : roofSpec('flat', { parapet: 0.9 }),
  });
  // The buildable ring keeps the lot's corners one for one: its side `fi` is the street front, where
  // the door and the shopfronts go.
  const front = [s.plan.outer[fi]!.id];
  s.facade =
    kind === 'commercial'
      ? [facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 5, margin: 0.6, edges: front }), facadeRule('win-sliding', { levels: 'upper', mode: 'max', value: 2.4 })]
      : [facadeRule('door-panel', { levels: 'ground', mode: 'count', value: 1, edges: front }), facadeRule('win-casement', { levels: kind === 'house' ? 'all' : 'upper', mode: 'max', value: 2.8 })];
  bld.solids = [s];
  return bld;
}

/** A quadrilateral lot split into `n` lots of equal front (the front side and the back cut alike). */
export function splitLot(lot: Lot, n: number, id: (i: number) => ID): Lot[] {
  const ring = lotRing(lot);
  if (ring.length !== 4 || n < 2) return [lot];
  const fi = ringSide(lot, lot.frontEdges[0] ?? 0);
  const p0 = ring[fi]!,
    p1 = ring[(fi + 1) % 4]!,
    p2 = ring[(fi + 2) % 4]!,
    p3 = ring[(fi + 3) % 4]!;
  const at = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return Array.from({ length: n }, (_, i) => {
    const t0 = i / n,
      t1 = (i + 1) / n;
    // Front from p0 to p1; the back runs from p3 to p2 (the same fractions, so the cuts are straight).
    const poly: Vec2[] = [at(p0, p1, t0), at(p0, p1, t1), at(p3, p2, t1), at(p3, p2, t0)];
    return { id: id(i), name: `${lot.name} ${i + 1}`, polygon: poly, frontEdges: [0], ...(lot.rules ? { rules: structuredClone(lot.rules) } : {}) };
  });
}

/** A rectangular lot from two opposite corners (world), its front on the side nearest `front` or the first side. */
export function rectLotFrom(a: Vec2, b: Vec2, id: ID, name: string): Lot {
  const x0 = Math.min(a[0], b[0]),
    x1 = Math.max(a[0], b[0]),
    z0 = Math.min(a[1], b[1]),
    z1 = Math.max(a[1], b[1]);
  // Counterclockwise (positive area, like rectPlan), starting so that the first side is the +z one.
  return { id, name, polygon: [[x1, z1], [x0, z1], [x0, z0], [x1, z0]], frontEdges: [0], rules: { setbacks: { ...DEFAULT_SETBACKS }, enforcement: 'warn' } };
}

/** Left normal of a direction (x, z). */
const leftOf = (t: Vec2): Vec2 => [-t[1], t[0]];

/** Do two convex rings overlap (separating axis; rings that only touch do not)? */
export function convexOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const ring of [a, b])
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!,
        q = ring[(i + 1) % ring.length]!;
      const nx = q[1] - p[1],
        nz = p[0] - q[0];
      const l = Math.hypot(nx, nz) || 1;
      const proj = (r: Vec2[]) => r.map((v) => (v[0] * nx + v[1] * nz) / l);
      const pa = proj(a),
        pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
    }
  return true;
}

/**
 * Lots of `front` × `depth` along a street, on both sides, behind its sidewalks: each straight stretch
 * gets as many as fit (the remainder split at both ends). A lot that would overlap the street, a lot
 * already laid, or one of `avoid` (the project's lots, other streets) is left out: at the inside of a
 * bend the lots stop where the other stretch's begin.
 */
export function lotsAlongStreet(st: Street, front: number, depth: number, id: (i: number) => ID, namePrefix: string, avoid: Vec2[][] = []): Lot[] {
  const out: Lot[] = [];
  const half = st.width / 2 + st.sidewalk;
  const street = ribbon(st.points, 0, half);
  const blocked = (poly: Vec2[]) => street.some((q) => convexOverlap(poly, q)) || out.some((l) => convexOverlap(poly, l.polygon)) || avoid.some((q) => convexOverlap(poly, q));
  for (let k = 0; k + 1 < st.points.length; k++) {
    const a = st.points[k]!,
      b = st.points[k + 1]!;
    const L = len(a, b);
    // Keep clear of the corners (the next stretch's lots would overlap): half a street plus a margin.
    const clear = k > 0 || k + 2 < st.points.length ? half + 1 : 0;
    const usable = L - (k > 0 ? clear : 0) - (k + 2 < st.points.length ? clear : 0);
    const n = Math.floor(usable / front);
    if (n < 1) continue;
    const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const nl = leftOf(t);
    const s0 = (k > 0 ? clear : 0) + (usable - n * front) / 2;
    for (const side of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const u0 = s0 + i * front,
          u1 = u0 + front;
        const P = (u: number, v: number): Vec2 => [a[0] + t[0] * u + nl[0] * v * side, a[1] + t[1] * u + nl[1] * v * side];
        // Front on the street side; the ring turned counterclockwise whichever side it is on.
        let poly: Vec2[] = [P(u0, half), P(u1, half), P(u1, half + depth), P(u0, half + depth)];
        if (signedArea2(poly) < 0) poly = [poly[1]!, poly[0]!, poly[3]!, poly[2]!];
        if (blocked(poly)) continue;
        out.push({ id: id(out.length), name: `${namePrefix}, lot ${out.length + 1}`.slice(0, 60), polygon: poly, frontEdges: [0], rules: { setbacks: { ...DEFAULT_SETBACKS }, enforcement: 'warn' } });
      }
    }
  }
  return out;
}

/** Outline of a polyline widened by `w` on each side (a quad per stretch; the joins overlap). */
export function ribbon(points: Vec2[], w0: number, w1: number): Vec2[][] {
  const out: Vec2[][] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]!,
      b = points[k + 1]!;
    const L = len(a, b) || 1;
    const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = leftOf(t);
    // A small overlap past each end closes the joints of a bent street.
    const e0 = k > 0 ? w1 : 0,
      e1 = k + 2 < points.length ? w1 : 0;
    const A: Vec2 = [a[0] - t[0] * e0, a[1] - t[1] * e0],
      B: Vec2 = [b[0] + t[0] * e1, b[1] + t[1] * e1];
    for (const side of w0 > 0 ? [1, -1] : [1]) {
      const q = (p: Vec2, w: number): Vec2 => [p[0] + n[0] * w * side, p[1] + n[1] * w * side];
      out.push(w0 > 0 ? [q(A, w0), q(B, w0), q(B, w1), q(A, w1)] : [q(A, w1), q(B, w1), q(B, -w1), q(A, -w1)]);
    }
  }
  return out;
}

/**
 * Tree positions along both sidewalks of a street (world), every `spacing` m. At a bend a tree that
 * would stand on the other stretch's asphalt, or next to a tree already there, is left out.
 */
export function treesAlong(st: Street, spacing: number, p?: Project3): Vec2[] {
  const out: Vec2[] = [];
  const off = st.width / 2 + st.sidewalk * 0.55;
  const asphalt = ribbon(st.points, 0, st.width / 2);
  // Never on (or against) a building standing over the sidewalk: 1 m clear of each volume's plan.
  const plans = (p?.buildings ?? []).filter((b) => !b.hidden).flatMap((b) => b.solids.filter((x) => x.op === 'add' && !x.hidden).map((x) => outerRing(b, x)));
  const onBuilding = (q: Vec2) => plans.some((r) => insideRing(q, r) || r.some((a, i) => segDist(q, a, r[(i + 1) % r.length]!) < 1));
  const free = (q: Vec2) => !asphalt.some((r) => insideRing(q, r)) && !onBuilding(q) && !out.some((o) => len(o, q) < spacing * 0.6);
  for (let k = 0; k + 1 < st.points.length; k++) {
    const a = st.points[k]!,
      b = st.points[k + 1]!;
    const L = len(a, b);
    const t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = leftOf(t);
    const m = Math.floor(L / spacing);
    for (let i = 0; i < m; i++) {
      const u = (L - (m - 1) * spacing) / 2 + i * spacing;
      for (const side of [1, -1]) {
        const q: Vec2 = [a[0] + t[0] * u + n[0] * off * side, a[1] + t[1] * u + n[1] * off * side];
        if (free(q)) out.push(q);
      }
    }
  }
  return out;
}

/** Free tree items for a building (local coordinates), one per point. */
export function treeItems(b: Building3, pts: Vec2[], type: ID, id: () => ID): Item[] {
  return pts.map((p) => {
    const l = toLocal(b, p);
    return { id: id(), type, params: {}, host: { kind: 'free', p: [l[0], 0, l[1]], rot: 0 } };
  });
}

/** Is a world point inside a ring? */
export function insideRing(p: Vec2, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The lot under a world point (the last drawn wins), or undefined. */
export function lotAt(p: Project3, at: Vec2): Lot | undefined {
  for (let i = p.lots.length - 1; i >= 0; i--) if (insideRing(at, p.lots[i]!.polygon)) return p.lots[i];
  return undefined;
}

/** The street whose asphalt or sidewalk is under a world point, or undefined. */
export function streetAt(p: Project3, at: Vec2): Street | undefined {
  for (const st of p.streets ?? []) for (const q of ribbon(st.points, 0, st.width / 2 + st.sidewalk)) if (insideRing(at, q)) return st;
  return undefined;
}

/** The side of a lot nearest a street becomes its front (the lot keeps its front when there is no street). */
export function frontTowardStreet(lot: Lot, streets: Street[]): Lot {
  let best = -1,
    bestD = Infinity;
  const n = lot.polygon.length;
  for (let i = 0; i < n; i++) {
    const a = lot.polygon[i]!,
      b = lot.polygon[(i + 1) % n]!;
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const st of streets)
      for (let k = 0; k + 1 < st.points.length; k++) {
        const d = segDist(m, st.points[k]!, st.points[k + 1]!);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
  }
  return best >= 0 && bestD < 80 ? { ...lot, frontEdges: [best] } : lot;
}

/** Bounding box of a ring: [x0, z0, x1, z1]. */
const boxOf = (r: Vec2[]) => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))] as const;

/** Lots drawn over each other (four-sided ones, which are convex here): one warning per pair. */
export function lotOverlaps(p: Project3): string[] {
  const out: string[] = [];
  const quads = p.lots.filter((l) => l.polygon.length === 4).map((l) => ({ l, box: boxOf(l.polygon) }));
  for (let i = 0; i < quads.length; i++)
    for (let j = i + 1; j < quads.length; j++) {
      const a = quads[i]!,
        b = quads[j]!;
      if (a.box[2] <= b.box[0] || b.box[2] <= a.box[0] || a.box[3] <= b.box[1] || b.box[3] <= a.box[1]) continue;
      if (convexOverlap(a.l.polygon, b.l.polygon)) out.push(`${b.l.name} overlaps ${a.l.name}.`);
    }
  return out;
}

/**
 * Buildings standing in a lot's setbacks (a corner of a volume outside the buildable area) or outside
 * the lot: one warning per building, as the lot's rules ask ('warn'; nothing is moved).
 */
export function setbackWarnings(p: Project3): string[] {
  const out: string[] = [];
  for (const lot of p.lots) {
    const bs = p.buildings.filter((b) => b.lotId === lot.id);
    if (!bs.length) continue;
    const area = buildableArea(lot);
    for (const b of bs) {
      const pts = b.solids.filter((s) => s.op === 'add' && !s.hidden).flatMap((s) => outerRing(b, s));
      if (!pts.length) continue;
      // A small tolerance: a volume drawn on the line of the setback is inside.
      const inside = (q: Vec2, ring: Vec2[]) => insideRing(q, ring) || ring.some((r, i) => segDist(q, r, ring[(i + 1) % ring.length]!) < 0.05);
      if (pts.some((q) => !inside(q, lotRing(lot)))) out.push(`${b.name} goes past the edge of ${lot.name}.`);
      else if (!area || pts.some((q) => !inside(q, area))) out.push(`${b.name} stands in the setbacks of ${lot.name}.`);
    }
  }
  return out;
}

/**
 * Buildings standing in each other (their plans cross; buildings that only touch, like row houses,
 * do not): one warning per pair. Only on the ground floor plans of their visible volumes.
 */
export function buildingOverlaps(p: Project3): string[] {
  const out: string[] = [];
  const bs = p.buildings
    .filter((b) => !b.hidden && b.solids.length)
    .slice(0, 200)
    .map((b) => {
      const rings = b.solids.filter((s) => s.op === 'add' && !s.hidden).map((s) => outerRing(b, s));
      return { b, rings, box: boxOf(rings.flat()) };
    })
    .filter((x) => x.rings.length);
  const cross = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => {
    const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const e = 1e-6;
    return o(a, b, c) * o(a, b, d) < -e && o(c, d, a) * o(c, d, b) < -e;
  };
  // A point well inside (5 cm from every side) of a ring.
  const deep = (q: Vec2, r: Vec2[]) => insideRing(q, r) && r.every((v, i) => segDist(q, v, r[(i + 1) % r.length]!) > 0.05);
  const ringsMeet = (A: Vec2[], B: Vec2[]) =>
    A.some((q) => deep(q, B)) || B.some((q) => deep(q, A)) || A.some((a, i) => B.some((c, j) => cross(a, A[(i + 1) % A.length]!, c, B[(j + 1) % B.length]!)));
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i]!,
        b = bs[j]!;
      if (a.box[2] <= b.box[0] || b.box[2] <= a.box[0] || a.box[3] <= b.box[1] || b.box[3] <= a.box[1]) continue;
      if (a.rings.some((r) => b.rings.some((q) => ringsMeet(r, q)))) out.push(`${b.b.name} overlaps ${a.b.name}.`);
    }
  return out;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
}

/**
 * The trees of every street that has them, planted again along its current line (after a point moved,
 * the street moved, or its width changed): one parts-only building per street, "<street> trees".
 * Returns the IDs of the buildings changed.
 */
export function replantStreetTrees(p: Project3, make: (name: string, at: Vec2) => Building3, type: ID, id: () => ID): ID[] {
  const out: ID[] = [];
  for (const st of p.streets ?? []) {
    if (!st.trees) continue;
    const name = `${st.name} trees`.slice(0, 60);
    // Tied by ID (a renamed street keeps its trees); older projects found them by name.
    let b = p.buildings.find((x) => x.id === st.treesBuilding) ?? p.buildings.find((x) => x.name === name && !x.solids.length);
    if (!b) {
      b = make(name, [st.points[0]![0], st.points[0]![1]]);
      p.buildings.push(b);
    }
    st.treesBuilding = b.id;
    if (!b.solids.length) b.name = name;
    const pts = treesAlong(st, st.trees, p);
    const prevType = b.items[0]?.type ?? type;
    b.items = treeItems(b, pts, prevType, id);
    out.push(b.id);
  }
  return out;
}
