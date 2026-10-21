// Body of a solid: the sampled plan at the bottom, the offset top (taper
// and per-side lean) on top, and the walls between them. With a bevel, profile
// rings go above and below the straight band (like the Blender Bevel, but
// stored as a parameter). Each side segment becomes a face with
// its own frame for the facade.
import type { Solid, Vec2, Vec3 } from '../model/schema';
import { offsetRing, oriented, ringValid, sampleRing, type SampledRing } from '../model/plan';
import { FaceTable, type FaceFrame } from './faces';
import { MeshBuilder, triangulatePlan } from './mesh';

export interface RingLevel {
  /** Absolute elevation. */
  y: number;
  outer: Vec2[];
  holes: Vec2[][];
}

export interface SolidRings {
  outer: SampledRing;
  holes: SampledRing[];
  topOuter: Vec2[];
  topHoles: Vec2[][];
  base: number;
  top: number;
  /** Rings from bottom to top (two without a bevel). */
  levels: RingLevel[];
  /** Index of the ring where the straight wall band starts. */
  wall: number;
  /** How many slices the wall band has (more than one when the volume is twisted). */
  wallBands?: number;
}

const edgeOf = (e: string) => (e.endsWith(':c') ? e.slice(0, -2) : e);

/** Top offset of each segment: taper + height · tan(side lean). */
function segmentOffsets(s: Solid, r: SampledRing): number[] {
  const side = (edge: string) => {
    const lean = s.edges[edgeOf(edge)]?.lean ?? 0;
    return s.taper + s.height * Math.tan((Math.max(-60, Math.min(60, lean)) * Math.PI) / 180);
  };
  const out = r.segs.map((seg) => side(seg.edge));
  // A rounded or chamfered corner between sides with different leans blends from the incoming side's
  // offset to the outgoing one along its arc: a jump at the arc start made nearly parallel lines meet far
  // away (a spike through the ring, a solid that is not a manifold).
  const n = r.segs.length;
  for (let i = 0; i < n; i++) {
    if (!r.segs[i]!.edge.endsWith(':c') || r.segs[(i - 1 + n) % n]!.edge === r.segs[i]!.edge) continue;
    let m = 0;
    while (m < n && r.segs[(i + m) % n]!.edge === r.segs[i]!.edge) m++;
    const a = out[(i - 1 + n) % n]!,
      b = out[(i + m) % n]!;
    for (let k = 0; k < m; k++) out[(i + k) % n] = a + ((b - a) * (k + 0.5)) / m;
  }
  return out;
}

export interface Bevel {
  top: number;
  bottom: number;
  segments: number;
  profile: number;
}

/** Effective volume bevel (null without a bevel); base and top never cross. */
export function bevelOf(s: Solid): Bevel | null {
  const b = s.bevel;
  const edgeMax = Math.max(0, ...Object.values(s.edges).map((e) => e.bevel ?? 0));
  const top = Math.max(0, b?.top ?? 0),
    bottom = Math.max(0, b?.bottom ?? 0);
  if (Math.max(top, edgeMax) <= 1e-3 && bottom <= 1e-3) return null;
  const k = Math.min(1, (s.height * 0.95) / Math.max(1e-6, Math.max(top, edgeMax) + bottom));
  return { top: top * k, bottom: bottom * k, segments: Math.max(1, Math.min(12, Math.round(b?.segments ?? 1))), profile: Math.max(0, Math.min(1, b?.profile ?? 0)) };
}

/** Profile setback at φ ∈ [0, π/2]: straight (profile 0) to a quarter circle (1). The rise is w·sin φ in both. */
const bevelInset = (w: number, phi: number, profile: number) => w * ((1 - profile) * Math.sin(phi) + profile * (1 - Math.cos(phi)));

const NONE: ReadonlySet<string> = new Set();

/**
 * Sides touching another additive volume (internal seams): the bevel does not
 * go on them, otherwise the union leaves a groove at the seam.
 */
export function coveredEdges(s: Solid, all: Solid[], hidden: (x: Solid) => boolean = (x) => !!x.hidden): Set<string> {
  const out = new Set<string>();
  if (!bevelOf(s)) return out;
  const top = s.base + s.height;
  const others = all.filter((o) => o !== s && o.op === 'add' && !hidden(o) && o.base <= top - 0.05 && o.base + o.height >= top - 0.05).map((o) => sampleRing(oriented(o.plan.outer, 1)).pts);
  if (!others.length) return out;
  const r = sampleRing(oriented(s.plan.outer, 1));
  const state = new Map<string, boolean>();
  r.segs.forEach((seg, i) => {
    if (seg.edge.endsWith(':c')) return;
    const a = r.pts[i]!,
      b = r.pts[(i + 1) % r.pts.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Segment midpoint, 5 cm outward (counterclockwise ring: outside = right of travel).
    const p: Vec2 = [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / l) * 0.05, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / l) * 0.05];
    const hit = others.some((o) => pointIn(p, o));
    state.set(seg.edge, (state.get(seg.edge) ?? true) && hit);
  });
  for (const [e, v] of state) if (v) out.add(e);
  return out;
}

function pointIn(p: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!,
      b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

export function solidRings(s: Solid, covered: ReadonlySet<string> = NONE): SolidRings {
  const outer = sampleRing(oriented(s.plan.outer, 1));
  const holes = s.plan.holes.map((h) => sampleRing(oriented(h, -1)));
  const bev = bevelOf(s);
  const H = s.height;
  const room = H * 0.95 - (bev?.bottom ?? 0);
  // Top bevel width of each segment (a side with its own value wins).
  const topW = (r: SampledRing) => r.segs.map((seg) => (bev && !covered.has(edgeOf(seg.edge)) ? Math.max(0, Math.min(s.edges[edgeOf(seg.edge)]?.bevel ?? bev.top, room)) : 0));
  const wOuter = topW(outer);
  const wHoles = holes.map(topW);
  const seg = bev?.segments ?? 1;
  const profile = bev?.profile ?? 0;
  type Lv = { z: number; phiBot: number };
  const lvs: Lv[] = [];
  if (bev && bev.bottom > 1e-4) {
    // Base: φ goes from π/2 (at the foot, maximum setback) to 0 (start of the straight wall).
    for (let k = 0; k <= seg; k++) {
      const phi = (Math.PI / 2) * (1 - k / seg);
      lvs.push({ z: bev.bottom * (1 - Math.sin(phi)), phiBot: phi });
    }
  } else lvs.push({ z: 0, phiBot: 0 });
  const wall = lvs.length - 1;
  // Top: the profile points of each distinct width; each side reads its φ at the elevation.
  const widths = [...new Set([...wOuter, ...wHoles.flat()].filter((w) => w > 1e-4).map((w) => Math.round(w * 1e5) / 1e5))];
  const topZ = new Set<number>([H]);
  for (const w of widths) for (let k = 0; k <= seg; k++) topZ.add(Math.round((H - w + w * Math.sin((Math.PI / 2) * (k / seg))) * 1e6) / 1e6);
  for (const z of [...topZ].sort((a, b) => a - b)) if (z > lvs[lvs.length - 1]!.z + 1e-4) lvs.push({ z, phiBot: 0 });
  const ring = (r: SampledRing, ws: number[], l: Lv, factor: number) => {
    const lin = segmentOffsets(s, r);
    return offsetRing(
      r.pts,
      lin.map((d, i) => {
        let off = (d * l.z) / H;
        const w = ws[i]!;
        const t = l.z - (H - w);
        if (w > 1e-4 && t > 1e-6) off += bevelInset(w, Math.asin(Math.min(1, t / w)), profile);
        if (l.phiBot > 0 && !covered.has(edgeOf(r.segs[i]!.edge))) off += bevelInset(bev!.bottom, l.phiBot, profile);
        return off * factor;
      }),
    );
  };
  const build = (factor: number): RingLevel[] => lvs.map((l) => ({ y: s.base + l.z, outer: ring(outer, wOuter, l, factor), holes: holes.map((h, i) => ring(h, wHoles[i]!, l, factor)) }));
  // Every side keeps the direction of its base side: a taper past the inradius turns a ring through its
  // center and back out (a square rotated 180° keeps its orientation, so ringValid alone accepts it) and the
  // walls would join each base vertex to the opposite top vertex (crossing walls, not a manifold solid).
  const sameWay = (a: Vec2[], b: Vec2[]) =>
    a.every((p, i) => {
      const j = (i + 1) % a.length;
      const da = [a[j]![0] - p[0], a[j]![1] - p[1]],
        db = [b[j]![0] - b[i]![0], b[j]![1] - b[i]![1]];
      return Math.hypot(da[0]!, da[1]!) < 1e-6 || da[0]! * db[0]! + da[1]! * db[1]! > 1e-9;
    });
  const ok = (ls: RingLevel[]) =>
    ls.every((l) => ringValid(l.outer, 1) && l.holes.every((h) => ringValid(h, -1)) && sameWay(ls[0]!.outer, l.outer) && l.holes.every((h, i) => sameWay(ls[0]!.holes[i]!, h)));
  let factor = 1;
  let levels = build(factor);
  // Taper or bevel too large: reduce until every ring is valid again.
  for (let k = 0; k < 12 && !ok(levels); k++) {
    factor *= 0.8;
    levels = build(factor);
  }
  // Twist: the wall band is cut in slices, each turned by its share of the angle around the plan center
  // (a twisted tower); the top and the roof on it turn the whole angle.
  let wallBands = 1;
  if (s.twist && Math.abs(s.twist) > 0.01) {
    const k = Math.max(2, Math.min(36, Math.ceil(Math.abs(s.twist) / 5)));
    const lo = levels[wall]!,
      hi = levels[wall + 1]!;
    const lerp = (a: Vec2[], b: Vec2[], t: number) => a.map((p, i) => [p[0] + (b[i]![0] - p[0]) * t, p[1] + (b[i]![1] - p[1]) * t] as Vec2);
    const slices: RingLevel[] = [];
    for (let i = 1; i < k; i++) {
      const t = i / k;
      slices.push({ y: lo.y + (hi.y - lo.y) * t, outer: lerp(lo.outer, hi.outer, t), holes: lo.holes.map((h, j) => lerp(h, hi.holes[j]!, t)) });
    }
    levels.splice(wall + 1, 0, ...slices);
    wallBands = k;
    const c = outer.pts.reduce((a, p) => [a[0] + p[0] / outer.pts.length, a[1] + p[1] / outer.pts.length], [0, 0] as Vec2);
    for (const l of levels) {
      const a = (-(s.twist * Math.PI) / 180) * Math.max(0, Math.min(1, (l.y - s.base) / Math.max(1e-6, s.height)));
      if (!a) continue;
      const turn = (p: Vec2): Vec2 => {
        const x = p[0] - c[0],
          z = p[1] - c[1];
        return [c[0] + x * Math.cos(a) - z * Math.sin(a), c[1] + x * Math.sin(a) + z * Math.cos(a)];
      };
      l.outer = l.outer.map(turn);
      l.holes = l.holes.map((h) => h.map(turn));
    }
  }
  const last = levels[levels.length - 1]!;
  return { outer, holes, topOuter: last.outer, topHoles: last.holes, base: s.base, top: s.base + s.height, levels, wall, wallBands };
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Frame of a side face: u along it, v up the face, n outward. */
export function sideFrame(b0: Vec3, b1: Vec3, t0: Vec3, s0: number, s1: number): FaceFrame {
  const u = norm3(sub3(b1, b0));
  const w = sub3(t0, b0);
  const k = dot3(w, u);
  const v = norm3([w[0] - u[0] * k, w[1] - u[1] * k, w[2] - u[2] * k]);
  const n = norm3(cross3(v, u));
  return { o: b0, u, v, n, s0, s1 };
}

/**
 * Closed body mesh. Subtractive solids become 'cutter' faces (the cut walls);
 * the bevel bands are 'bevel' (no components).
 */
export function bodyMesh(s: Solid, r: SolidRings, table: FaceTable, mb = new MeshBuilder()): MeshBuilder {
  const cutter = s.op === 'subtract';
  const bottomId = table.add({ kind: cutter ? 'cutter' : 'bottom', solid: s.id });
  const topId = table.add({ kind: cutter ? 'cutter' : 'top', solid: s.id });
  const cap = (outer: Vec2[], holes: Vec2[][], y: number, id: number, up: boolean) => {
    const { pts, tris } = triangulatePlan(outer, holes);
    for (let t = 0; t < tris.length; t += 3) {
      const a = pts[tris[t]!]!,
        b = pts[tris[t + 1]!]!,
        c = pts[tris[t + 2]!]!;
      mb.triangle([a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]], id, [0, up ? 1 : -1, 0]);
    }
  };
  const L = r.levels;
  const first = L[0]!,
    last = L[L.length - 1]!;
  cap(first.outer, first.holes, first.y, bottomId, false);
  cap(last.outer, last.holes, last.y, topId, true);
  const lo = L[r.wall]!,
    hi = L[r.wall + 1]!;
  type Pick = (l: RingLevel) => Vec2[];
  const rings: [SampledRing, Pick, number][] = [[r.outer, (l) => l.outer, -1], ...r.holes.map((h, i) => [h, (l: RingLevel) => l.holes[i]!, i] as [SampledRing, Pick, number])];
  for (const [ring, pick, ringIndex] of rings) {
    const n = ring.pts.length;
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const seg = ring.segs[i]!;
      // Frame along the straight band, with its origin at the volume base (the facade measures from there).
      const a = pick(lo),
        b = pick(hi);
      const B0: Vec3 = [a[i]![0], r.base, a[i]![1]],
        B1: Vec3 = [a[j]![0], r.base, a[j]![1]],
        T0: Vec3 = [b[i]![0], hi.y, b[i]![1]];
      const frame = { ...sideFrame(B0, B1, T0, seg.s0, seg.s1), per };
      per += Math.hypot(B1[0] - B0[0], B1[2] - B0[2]);
      const dx = ring.pts[j]![0] - ring.pts[i]![0],
        dz = ring.pts[j]![1] - ring.pts[i]![1];
      // A twisted wall is a warped surface: its slices are drawn smooth (flat, each quad showed its diagonal).
      const wallId = table.add({ kind: cutter ? 'cutter' : 'side', solid: s.id, edge: seg.edge, seg: i, ring: ringIndex, frame, smooth: seg.curved || (r.wallBands ?? 1) > 1 });
      let bevelId = -1;
      for (let k = 0; k + 1 < L.length; k++) {
        const p = pick(L[k]!),
          q = pick(L[k + 1]!);
        const inWall = k >= r.wall && k < r.wall + (r.wallBands ?? 1);
        const id = inWall || cutter ? wallId : bevelId >= 0 ? bevelId : (bevelId = table.add({ kind: 'bevel', solid: s.id, edge: seg.edge, smooth: true }));
        const y0 = L[k]!.y,
          y1 = L[k + 1]!.y;
        mb.quad([p[i]![0], y0, p[i]![1]], [p[j]![0], y0, p[j]![1]], [q[j]![0], y1, q[j]![1]], [q[i]![0], y1, q[i]![1]], id, [dz, 0, -dx]);
      }
    }
  }
  return mb;
}
