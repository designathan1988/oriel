// Solid plan → sampled ring, with the origin of each segment.
// Arcs by the bulge convention (tan(θ/4)), rounded corners (round) and
// chamfered ones (chamfer). Each segment knows which side it came from and where
// it starts along it (s), so the facade spreads components along the whole side,
// even a curved one. No three.
import type { ID, PlanVertex, Vec2 } from './schema';

export interface Segment {
  /** Source side (start vertex ID) or corner (`<id>:c`). */
  edge: ID;
  /** Distance along the source side at the start and end of the segment. */
  s0: number;
  s1: number;
  /** Segment of an arc (curved side) or of a rounded corner. */
  curved: boolean;
}

export interface SampledRing {
  /** Points; segment i goes from pts[i] to pts[i+1] (closed). */
  pts: Vec2[];
  segs: Segment[];
}

/** Chord tolerance (m) for sampling arcs. */
const CHORD_TOL = 0.02;
const MAX_ARC_SEGS = 48;

export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function signedArea2(p: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!,
      b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Segment count for an arc of radius r and angle θ within the chord tolerance. */
export function arcSegments(r: number, theta: number): number {
  const a = Math.abs(theta);
  if (r < 1e-6 || a < 1e-6) return 1;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - CHORD_TOL / r)));
  return Math.max(2, Math.min(MAX_ARC_SEGS, Math.ceil(a / Math.max(step, 0.05))));
}

/** Center and radius of the arc from a to b with the given bulge. */
export function arcOf(a: Vec2, b: Vec2, bulge: number): { c: Vec2; r: number; theta: number; a0: number } {
  const theta = 4 * Math.atan(bulge);
  const chord = dist(a, b);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const m = lerp(a, b, 0.5);
  const d = sub(b, a);
  const l = len(d) || 1;
  // Normal to the left of the chord; the center lies opposite the bulge.
  const nl: Vec2 = [-d[1] / l, d[0] / l];
  const h = r * Math.cos(Math.abs(theta) / 2);
  // bulge > 0 on a counterclockwise ring: arc outward (to the right of the chord) → center on the left.
  const sgn = bulge > 0 ? 1 : -1;
  const c: Vec2 = [m[0] + nl[0] * h * sgn, m[1] + nl[1] * h * sgn];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  return { c, r, theta, a0 };
}

interface Corner {
  /** Point where the previous side ends and the next one starts. */
  inP: Vec2;
  outP: Vec2;
  /** Intermediate points of the (rounded) corner. */
  mid: Vec2[];
}

/** Corner cut: rounded (round) or chamfered (chamfer), limited by the sides. */
function cornerOf(prev: Vec2, v: Vec2, next: Vec2, round: number, chamfer: number): Corner | null {
  const d1 = sub(prev, v),
    d2 = sub(next, v);
  const l1 = len(d1),
    l2 = len(d2);
  if (l1 < 1e-6 || l2 < 1e-6) return null;
  const u1: Vec2 = [d1[0] / l1, d1[1] / l1],
    u2: Vec2 = [d2[0] / l2, d2[1] / l2];
  const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const ang = Math.acos(cos);
  if (ang < 1e-3 || Math.PI - ang < 1e-3) return null;
  const maxT = Math.min(l1, l2) * 0.49;
  if (chamfer > 0 && !(round > 0)) {
    const t = Math.min(chamfer, maxT);
    return { inP: [v[0] + u1[0] * t, v[1] + u1[1] * t], outP: [v[0] + u2[0] * t, v[1] + u2[1] * t], mid: [] };
  }
  if (!(round > 0)) return null;
  let t = round / Math.tan(ang / 2);
  let r = round;
  if (t > maxT) {
    t = maxT;
    r = t * Math.tan(ang / 2);
  }
  const p1: Vec2 = [v[0] + u1[0] * t, v[1] + u1[1] * t],
    p2: Vec2 = [v[0] + u2[0] * t, v[1] + u2[1] * t];
  const bis: Vec2 = [u1[0] + u2[0], u1[1] + u2[1]];
  const bl = len(bis) || 1;
  const cd = r / Math.sin(ang / 2);
  const c: Vec2 = [v[0] + (bis[0] / bl) * cd, v[1] + (bis[1] / bl) * cd];
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  let da = a2 - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = arcSegments(r, da);
  const mid: Vec2[] = [];
  for (let k = 1; k < n; k++) {
    const a = a1 + (da * k) / n;
    mid.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
  }
  void a2;
  return { inP: p1, outP: p2, mid };
}

/**
 * Samples a plan ring. `orient` forces the orientation (1 counterclockwise for
 * the outer ring, -1 clockwise for holes) without losing the segment origins.
 */
export function sampleRing(vs: PlanVertex[]): SampledRing {
  const n = vs.length;
  const corners: (Corner | null)[] = vs.map((v, i) => {
    const prevV = vs[(i - 1 + n) % n]!,
      nextV = vs[(i + 1) % n]!;
    // Corners only between straight sides (an arc or a spline is already smooth).
    if ((prevV.bulge ?? 0) !== 0 || (v.bulge ?? 0) !== 0 || v.smooth || prevV.smooth || nextV.smooth) return null;
    return cornerOf(prevV.p, v.p, nextV.p, v.round ?? 0, v.chamfer ?? 0);
  });
  const pts: Vec2[] = [];
  const segs: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const v = vs[i]!,
      w = vs[(i + 1) % n]!;
    const c0 = corners[i],
      c1 = corners[(i + 1) % n];
    const start = c0 ? c0.outP : v.p;
    const end = c1 ? c1.inP : w.p;
    const bulge = v.bulge ?? 0;
    const off0 = c0 ? dist(v.p, c0.outP) : 0;
    if (Math.abs(bulge) < 1e-6 && (v.smooth || w.smooth)) {
      // Spline side (cubic Hermite, Catmull-Rom tangents at the smooth points; a sharp end keeps the
      // side's own direction): sampled by length, s along the chords.
      const u = vs[(i - 1 + n) % n]!.p,
        x = vs[(i + 2) % n]!.p;
      const m0: Vec2 = v.smooth ? [(w.p[0] - u[0]) / 2, (w.p[1] - u[1]) / 2] : [w.p[0] - v.p[0], w.p[1] - v.p[1]];
      const m1: Vec2 = w.smooth ? [(x[0] - v.p[0]) / 2, (x[1] - v.p[1]) / 2] : [w.p[0] - v.p[0], w.p[1] - v.p[1]];
      const k = Math.max(6, Math.min(32, Math.ceil(dist(v.p, w.p) / 0.6)));
      const at = (t: number): Vec2 => {
        const t2 = t * t,
          t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1,
          h10 = t3 - 2 * t2 + t,
          h01 = -2 * t3 + 3 * t2,
          h11 = t3 - t2;
        return [h00 * v.p[0] + h10 * m0[0] + h01 * w.p[0] + h11 * m1[0], h00 * v.p[1] + h10 * m0[1] + h01 * w.p[1] + h11 * m1[1]];
      };
      let s = 0;
      for (let j = 0; j < k; j++) {
        const a = at(j / k),
          b = at((j + 1) / k);
        pts.push(a);
        const l = dist(a, b);
        segs.push({ edge: v.id, s0: s, s1: s + l, curved: true });
        s += l;
      }
    } else if (Math.abs(bulge) > 1e-6) {
      const arc = arcOf(v.p, w.p, bulge);
      const k = arcSegments(arc.r, arc.theta);
      // s along the chords (the wall is made of them): contiguous segments without gaps.
      const chord = 2 * arc.r * Math.sin(Math.abs(arc.theta) / (2 * k));
      for (let j = 0; j < k; j++) {
        const a = arc.a0 + (arc.theta * j) / k;
        pts.push([arc.c[0] + Math.cos(a) * arc.r, arc.c[1] + Math.sin(a) * arc.r]);
        segs.push({ edge: v.id, s0: chord * j, s1: chord * (j + 1), curved: true });
      }
    } else {
      pts.push(start);
      segs.push({ edge: v.id, s0: off0, s1: off0 + dist(start, end), curved: false });
    }
    // Corner at the end of this side (next vertex).
    if (c1) {
      const cornerPts = [end, ...c1.mid];
      let s = 0;
      for (let j = 0; j < cornerPts.length; j++) {
        const a = cornerPts[j]!,
          b = j + 1 < cornerPts.length ? cornerPts[j + 1]! : c1.outP;
        if (j > 0) pts.push(a);
        else pts.push(a);
        const l = dist(a, b);
        segs.push({ edge: `${w.id}:c`, s0: s, s1: s + l, curved: c1.mid.length > 0 });
        s += l;
      }
    }
  }
  // Removes repeated points (touching corners).
  for (let i = pts.length - 1; i >= 0 && pts.length > 3; i--) {
    const j = (i + 1) % pts.length;
    if (dist(pts[i]!, pts[j]!) < 1e-6) {
      pts.splice(j, 1);
      segs.splice(i, 1);
    }
  }
  return { pts, segs };
}

/** Total length of each side (ID → m), adding up the segments. */
export function edgeLengths(r: SampledRing): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const s of r.segs) m.set(s.edge, Math.max(m.get(s.edge) ?? 0, s.s1));
  return m;
}

/** Intersection of two lines (point + direction); null if parallel. */
function intersectLines(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Offsets each segment into the material by its distance (m): the outward
 * normal is (tz, −tx) on a counterclockwise ring (clockwise holes). The new
 * vertices are the intersections of the offset segments (mitered).
 */
export function offsetRing(pts: Vec2[], d: number[]): Vec2[] {
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n]!;
    const l = dist(a, b) || 1;
    const t: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const out: Vec2 = [t[1], -t[0]];
    const k = d[i] ?? 0;
    return { p: [a[0] - out[0] * k, a[1] - out[1] * k] as Vec2, t, k, out };
  });
  return pts.map((v, i) => {
    const ip = (i - 1 + n) % n;
    const L = lines[ip]!,
      C = lines[i]!;
    const hit = intersectLines(L.p, L.t, C.p, C.t);
    // Miter limit (Clipper2 ClipperOffset.MiterLimit): a corner never moves farther than MITER × the
    // offset. Nearly parallel sides with different offsets (a leaning side meeting a rounded corner)
    // otherwise meet far away in a spike that crosses the ring. One point per vertex (rings stay 1:1):
    // the middle of the two offset ends at the vertex.
    const lim = MITER * Math.max(Math.abs(L.k), Math.abs(C.k)) + 1e-9;
    if (hit && dist(hit, v) <= lim) return hit;
    const e: Vec2 = [v[0] - L.out[0] * L.k, v[1] - L.out[1] * L.k],
      f: Vec2 = [v[0] - C.out[0] * C.k, v[1] - C.out[1] * C.k];
    return [(e[0] + f[0]) / 2, (e[1] + f[1]) / 2];
  });
}

/** Offset miter limit, in multiples of the offset (Clipper2 default 2; 4 keeps the sharp corners of common plans). */
const MITER = 4;

/** The ring does not self-intersect and keeps its orientation (a taper top still valid). */
export function ringValid(pts: Vec2[], sign: number): boolean {
  if (pts.length < 3) return false;
  if (Math.sign(signedArea2(pts)) !== sign || Math.abs(signedArea2(pts)) < 0.05) return false;
  const n = pts.length;
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j]!,
        e = pts[(j + 1) % n]!;
      if (cross(a, b, c) * cross(a, b, e) < -1e-10 && cross(c, e, a) * cross(c, e, b) < -1e-10) return false;
    }
  }
  return true;
}

/** Ensures the orientation: counterclockwise (sign 1) or clockwise (sign −1). */
export function oriented(vs: PlanVertex[], sign: number): PlanVertex[] {
  const a = signedArea2(vs.map((v) => v.p));
  if (Math.sign(a) === sign || a === 0) return vs;
  // Reversing keeps each side with its ID: side i (from v_i to v_i+1) now
  // starts at v_i+1, so the IDs shift by one position.
  const rev = [...vs].reverse();
  return rev.map((v, i) => ({ ...v, id: rev[(i + 1) % rev.length]!.id, bulge: -(rev[(i + 1) % rev.length]!.bulge ?? 0) || undefined }));
}

/**
 * Largest round or chamfer a corner can take: half its shorter side, so the two corners of a side
 * never eat more than the side (a 9.5 m radius on 18 m sides turned a block into a blind cylinder).
 */
export function cornerLimit(ring: readonly { p: Vec2 }[], i: number): number {
  const n = ring.length;
  const p = ring[i]!.p,
    a = ring[(i + n - 1) % n]!.p,
    b = ring[(i + 1) % n]!.p;
  return Math.floor((Math.min(Math.hypot(p[0] - a[0], p[1] - a[1]), Math.hypot(b[0] - p[0], b[1] - p[1])) / 2) * 100) / 100;
}
