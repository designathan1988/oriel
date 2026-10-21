// Support parts shared by the families: materials, distribution along a
// length (the Revit railing pattern modes), segments of a
// path and the railing run reused by balconies, stairs, ramps,
// walkways and parapets. No three.
import type { Vec3 } from '../model/schema';
import type { PartMat, PartSink, Params, Slot } from './family';
import type { ParamDef } from './family';
import { num, P, str } from './family';
import type { Pt } from './shapes';

export const mat = (slot: Slot, color: string, finish?: string): PartMat => (finish ? { slot, color, finish } : { slot, color });
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const toRad = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Fixed dark and light for details (rubber, hardware). */
export const DARK = mat('dark', '#1e2022');
export const STEEL = mat('metal', '#8e959a', 'metal');

/** n equal spans from 0 to L with span ≤ max; includes the ends ("spread to fit"). */
export function spread(L: number, max: number): number[] {
  if (L <= 1e-6) return [0];
  const n = Math.max(1, Math.ceil(L / Math.max(0.02, max) - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => (L * i) / n);
}

export type Justify = 'fit' | 'start' | 'center' | 'end';

/**
 * Positions along L with the ends always present (Revit start and end posts).
 * 'fit' equalizes the spans (the spacing becomes the maximum); the others keep
 * the spacing and leave the remainder at the end, at the start or split.
 */
export function distribute(L: number, s: number, j: Justify): number[] {
  if (j === 'fit') return spread(L, s);
  s = Math.max(0.02, s);
  const n = Math.floor(L / s + 1e-9);
  const rest = L - n * s;
  const off = j === 'start' ? 0 : j === 'end' ? rest : rest / 2;
  const out = [0];
  for (let i = 0; i <= n; i++) {
    const x = off + i * s;
    if (x > s * 0.25 && x < L - s * 0.25) out.push(x);
  }
  out.push(L);
  return out;
}

/** Centers of n parts of width w spread over L (with equal gaps). */
export function centers(L: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => -L / 2 + (L * (i + 0.5)) / n);
}

/** Regular polygon (xy or xz plane) with radius r and n sides. */
export function circlePts(r: number, n: number, cx = 0, cy = 0, a0 = 0): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

/** Path run: start, end, plan length, rise and turn (degrees around y). */
export interface Seg {
  a: Vec3;
  b: Vec3;
  len: number;
  rise: number;
  rot: number;
}

/** Path runs; without a path, one centered straight run of length `fallback`. */
export function segments(path: Vec3[] | undefined, fallback: number): Seg[] {
  const pts: Vec3[] = path && path.length >= 2 ? path : [[-fallback / 2, 0, 0], [fallback / 2, 0, 0]];
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) continue;
    // placed() takes local x to (cos r, 0, −sin r).
    out.push({ a, b, len, rise: b[1] - a[1], rot: toDeg(Math.atan2(-dz, dx)) });
  }
  return out;
}

export function isClosed(path: Vec3[] | undefined): boolean {
  if (!path || path.length < 3) return false;
  const a = path[0]!,
    b = path[path.length - 1]!;
  return Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-4;
}

/** Sink with x along the run, origin at the start. */
export const segSink = (out: PartSink, s: Seg): PartSink => out.placed(s.a[0], s.a[1], s.a[2], s.rot);

/** Sloped box from (x0, y0) to (x1, y1) on the local xy plane (handrails, beams, stringers). */
export function slopedBox(out: PartSink, m: PartMat, x0: number, y0: number, x1: number, y1: number, h: number, d: number, z = 0): void {
  const L = Math.hypot(x1 - x0, y1 - y0);
  if (L < 1e-4) return;
  out.box(m, [(x0 + x1) / 2, (y0 + y1) / 2, z], [L, h, d], [0, 0, toDeg(Math.atan2(y1 - y0, x1 - x0))]);
}

// ---------- Railing ----------

export type Infill = 'bars' | 'balusters' | 'glass' | 'panels' | 'cables' | 'mesh' | 'none';

export interface RailOpts {
  h: number;
  postSize: number;
  postShape: 'square' | 'round';
  postSpacing: number;
  justify: Justify;
  top: 'round' | 'flat' | 'wood' | 'none';
  topSize: number;
  infill: Infill;
  infillSpacing: number;
  /** Gap between the base and the bottom rail. */
  bottomGap: number;
  post: PartMat;
  rail: PartMat;
  infillMat: PartMat;
  glass: PartMat;
}

export const INFILLS: [string, string][] = [
  ['bars', 'Vertical bars'],
  ['balusters', 'Balusters'],
  ['glass', 'Glass'],
  ['panels', 'Panels'],
  ['cables', 'Steel cables'],
  ['mesh', 'Mesh'],
  ['none', 'Handrail only'],
];

export const TOP_RAILS: [string, string][] = [
  ['round', 'Round tube'],
  ['flat', 'Flat'],
  ['wood', 'Wood'],
  ['none', 'No handrail'],
];

export const JUSTIFY: [string, string][] = [
  ['fit', 'Spread to fit'],
  ['start', 'From the start'],
  ['center', 'Centered'],
  ['end', 'From the end'],
];

/** Railing parameters (optional prefix for families that have others). */
export function railParams(defInfill: Infill = 'bars', h = 1.1): ParamDef[] {
  return [
    P.len('railH', 'Railing height', h, 0.4, 1.6, 'type', 'size'),
    P.pick('infill', 'Infill', defInfill, INFILLS),
    P.len('infillSpacing', 'Infill spacing', 0.11, 0.05, 0.4, 'type', 'divisions', 0.01),
    P.len('postSpacing', 'Max post spacing', 1.5, 0.4, 4, 'type', 'divisions'),
    P.pick('justify', 'Post layout', 'fit', JUSTIFY, 'divisions'),
    P.pick('topRail', 'Handrail', 'round', TOP_RAILS),
    P.len('postSize', 'Post section', 0.05, 0.02, 0.2, 'type', 'profile', 0.01),
    P.pick('postShape', 'Post', 'square', [
      ['square', 'Square'],
      ['round', 'Round'],
    ]),
    P.color('railColor', 'Railing color', '#2e3336'),
    P.finish('railFinish', 'Railing material', 'steel'),
    P.color('glassColor', 'Glass color', '#7fa0a8'),
  ];
}

export function railOpts(p: Params): RailOpts {
  const rail = mat('metal', str(p, 'railColor'), str(p, 'railFinish'));
  const top = str(p, 'topRail') as RailOpts['top'];
  return {
    h: num(p, 'railH'),
    postSize: num(p, 'postSize'),
    postShape: str(p, 'postShape') === 'round' ? 'round' : 'square',
    postSpacing: num(p, 'postSpacing'),
    justify: (str(p, 'justify') || 'fit') as Justify,
    top,
    topSize: top === 'wood' ? 0.07 : top === 'flat' ? 0.06 : 0.045,
    infill: str(p, 'infill') as Infill,
    infillSpacing: num(p, 'infillSpacing'),
    bottomGap: 0.08,
    post: rail,
    rail: top === 'wood' ? mat('wood', '#8a6240', 'wood') : rail,
    infillMat: rail,
    glass: mat('glass', str(p, 'glassColor')),
  };
}

/**
 * Straight railing run from (0, 0) to (L, rise) on the local xy plane (z = 0 on
 * the axis). `ground(x)` gives where the posts rest (steps); by default the
 * line itself. `posts`: false omits the start post (corner already placed).
 */
export function railRun(out: PartSink, L: number, rise: number, o: RailOpts, startPost = true, endPost = true, ground?: (x: number) => number): void {
  if (L < 0.05) return;
  const k = rise / L;
  const line = (x: number) => x * k;
  const gnd = ground ?? line;
  const h = o.h;
  const topT = o.top === 'none' ? 0 : o.topSize;
  const ps = o.postSize;
  const xs = distribute(L, o.postSpacing, o.justify);
  // Posts.
  xs.forEach((x, i) => {
    if ((i === 0 && !startPost) || (i === xs.length - 1 && !endPost)) return;
    const y0 = Math.min(gnd(x), line(x));
    const y1 = line(x) + h - topT * 0.5;
    if (o.postShape === 'round') out.cylinder(o.post, [x, y0, 0], ps / 2, y1 - y0, 12);
    else out.box(o.post, [x, (y0 + y1) / 2, 0], [ps, y1 - y0, ps]);
    if (o.top === 'none') out.box(o.post, [x, y1 + 0.01, 0], [ps * 1.3, 0.02, ps * 1.3]);
  });
  // Handrail.
  if (o.top === 'round') out.rod(o.rail, [0, h - topT / 2, 0], [L, rise + h - topT / 2, 0], topT / 2, 12);
  else if (o.top === 'flat') slopedBox(out, o.rail, 0, h - 0.015, L, rise + h - 0.015, 0.03, topT);
  else if (o.top === 'wood') slopedBox(out, o.rail, 0, h - topT / 2, L, rise + h - topT / 2, topT * 0.7, topT * 1.4);
  const yb = o.bottomGap;
  const yt = h - topT;
  if (o.infill === 'none') {
    // Mid rail so the handrail is not alone.
    slopedBox(out, o.rail, 0, h * 0.5, L, rise + h * 0.5, 0.03, 0.03);
    return;
  }
  // Bottom rail (except for glass, which is fixed to the posts).
  if (o.infill !== 'glass' && o.infill !== 'cables') slopedBox(out, o.rail, 0, yb, L, rise + yb, 0.03, 0.03);
  if (o.infill === 'bars' || o.infill === 'balusters' || o.infill === 'mesh') {
    // Right below the handrail, a top rail that receives the bars.
    if (o.infill !== 'mesh') slopedBox(out, o.rail, 0, yt - 0.015, L, rise + yt - 0.015, 0.03, 0.03);
  }
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i]! + ps / 2,
      b = xs[i + 1]! - ps / 2;
    const bay = b - a;
    if (bay < 0.03) continue;
    if (o.infill === 'bars' || o.infill === 'balusters') {
      const n = Math.max(1, Math.ceil(bay / Math.max(0.05, o.infillSpacing)) - 1);
      for (let j = 1; j <= n; j++) {
        const x = a + (bay * j) / (n + 1);
        const y0 = line(x) + yb + 0.015,
          y1 = line(x) + yt - 0.03;
        if (y1 - y0 < 0.05) continue;
        if (o.infill === 'bars') out.box(o.infillMat, [x, (y0 + y1) / 2, 0], [0.016, y1 - y0, 0.016]);
        else baluster(out, o.infillMat, x, y0, y1, Math.min(0.06, o.infillSpacing * 0.45));
      }
    } else if (o.infill === 'glass' || o.infill === 'panels' || o.infill === 'mesh') {
      const g = 0.012;
      const prof: Pt[] = [
        [a + g, line(a + g) + yb],
        [b - g, line(b - g) + yb],
        [b - g, line(b - g) + yt - 0.02],
        [a + g, line(a + g) + yt - 0.02],
      ];
      const t = o.infill === 'glass' ? 0.006 : o.infill === 'panels' ? 0.01 : 0.002;
      out.prism(o.infill === 'glass' ? o.glass : o.infill === 'panels' ? mat('panel', o.post.color, 'metal') : o.infillMat, prof, -t, t);
      if (o.infill === 'mesh') {
        // Mesh: thin diagonals over the transparent sheet are expensive; a grid of horizontal wires.
        const rows = Math.max(2, Math.round((yt - yb) / 0.1));
        for (let r = 1; r < rows; r++) {
          const y = yb + ((yt - 0.02 - yb) * r) / rows;
          slopedBox(out, o.infillMat, a, line(a) + y, b, line(b) + y, 0.006, 0.006, 0.004);
        }
      }
    } else if (o.infill === 'cables') {
      const n = Math.max(2, Math.ceil((yt - yb) / Math.max(0.05, o.infillSpacing)));
      for (let j = 0; j < n; j++) {
        const y = yb + ((yt - 0.03 - yb) * j) / (n - 1);
        out.rod(o.infillMat, [a, line(a) + y, 0], [b, line(b) + y, 0], 0.003, 6);
      }
    }
  }
}

/** Turned baluster: base, belly and cap. */
export function baluster(out: PartSink, m: PartMat, x: number, y0: number, y1: number, r: number, z = 0): void {
  const h = y1 - y0;
  out.box(m, [x, y0 + h * 0.06, z], [r * 2, h * 0.12, r * 2]);
  out.cylinder(m, [x, y0 + h * 0.12, z], r * 0.55, h * 0.12, 12);
  out.cylinder(m, [x, y0 + h * 0.24, z], r * 0.95, h * 0.3, 12);
  out.cylinder(m, [x, y0 + h * 0.54, z], r * 0.5, h * 0.28, 12);
  out.cylinder(m, [x, y0 + h * 0.82, z], r * 0.75, h * 0.06, 12);
  out.box(m, [x, y0 + h * 0.94, z], [r * 2, h * 0.12, r * 2]);
}

/**
 * Railing along a plan polyline (x, z) at height y0, with a corner post at
 * each vertex (without repeats) and a closed path without a doubled post at
 * the starting point.
 */
export function railAlong(out: PartSink, pts: Vec3[], o: RailOpts): void {
  const segs = segments(pts, 1);
  const closed = isClosed(pts);
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    railRun(segSink(out, s), s.len, s.rise, o, i === 0, !(closed && last));
  });
}

/** Color and finish in one place: `mat` from two parameters. */
export const pmat = (p: Params, slot: Slot, colorKey: string, finishKey?: string, finish?: string): PartMat => mat(slot, str(p, colorKey), finishKey ? str(p, finishKey) : finish);

/** Occurrence path; without a path (thumbnail, catalog), a centered line of `ctx.length` or `def` m. */
export function pathOf(ctx: { path?: Vec3[]; length: number }, def = 4): Vec3[] {
  if (ctx.path && ctx.path.length >= 2) return ctx.path;
  const L = ctx.length > 0.1 ? ctx.length : def;
  return [[-L / 2, 0, 0], [L / 2, 0, 0]];
}

/** Deterministic value in [0, 1) from integers (no Math.random). */
export function hash01(a: number, b = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth truncated cone (revolution) from r0 (base) to r1 (top). */
export function cone(out: PartSink, m: PartMat, base: Vec3, r0: number, r1: number, h: number, _steps = 8, sides = 24): void {
  out.lathe(m, [[Math.max(0.002, r0), 0], [Math.max(0, r1), h]], sides, base);
}

/** Smooth cap (revolution): radius r, height h. */
export function dome(out: PartSink, m: PartMat, base: Vec3, r: number, h: number, steps = 10, sides = 24): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    prof.push([r * Math.cos((t * Math.PI) / 2), h * Math.sin((t * Math.PI) / 2)]);
  }
  out.lathe(m, prof, sides, base);
}

/** Square tapered column by slices (the sink has no truncated pyramid). */
export function taperBox(out: PartSink, m: PartMat, base: Vec3, w0: number, w1: number, h: number, steps = 8): void {
  const n = Math.max(1, steps);
  for (let i = 0; i < n; i++) {
    const w = w0 + ((w1 - w0) * (i + 0.5)) / n;
    out.box(m, [base[0], base[1] + (h * (i + 0.5)) / n, base[2]], [w, h / n, w]);
  }
}

/** Gable roof over a w × d plan (ridge along z), from base y0 up to y0 + rise. */
export function gable(out: PartSink, m: PartMat, w: number, d: number, y0: number, rise: number, t = 0.06, cz = 0): void {
  // Two sloped plates; the (x, y) profile extruded along z gives the solid gable underneath.
  out.prism(m, [[-w / 2, y0], [w / 2, y0], [w / 2, y0 + t], [0, y0 + rise + t], [-w / 2, y0 + t]], cz - d / 2, cz + d / 2);
}

/**
 * Superellipse ring at height y: half sizes a (x) and b (z), exponent n (2 = ellipse, 4–6 = a rounded
 * rectangle, as basins and tubs), k points counterclockwise seen from below (the loft winding).
 */
export function oval(a: number, b: number, y: number, n = 4, k = 32, cx = 0, cz = 0): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < k; i++) {
    const t = (i / k) * Math.PI * 2;
    const c = Math.cos(t),
      s = Math.sin(t);
    out.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), y, cz + b * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return out;
}

/**
 * The same sink with its boxes drawn with rounded edges (r, at most a fifth of the thinnest side; boxes
 * thinner than 15 mm stay sharp): furniture whose edges catch the light instead of cardboard boxes.
 */
export function soft(out: PartSink, r = 0.005): PartSink {
  const wrap = (o: PartSink): PartSink => ({
    box: (m, c, sz, rot) => {
      const t = Math.min(sz[0], sz[1], sz[2]);
      if (t < 0.015) o.box(m, c, sz, rot);
      else o.rbox(m, c, sz, Math.min(r, t * 0.2), rot);
    },
    cylinder: (...a) => o.cylinder(...a),
    rod: (...a) => o.rod(...a),
    prism: (...a) => o.prism(...a),
    slab: (...a) => o.slab(...a),
    lathe: (...a) => o.lathe(...a),
    translated: (x, y, z) => wrap(o.translated(x, y, z)),
    placed: (x, y, z, ry) => wrap(o.placed(x, y, z, ry)),
    sweepX: (...a) => o.sweepX(...a),
    mesh: (...a) => o.mesh(...a),
    rbox: (...a) => o.rbox(...a),
    loft: (...a) => o.loft(...a),
  });
  return wrap(out);
}
