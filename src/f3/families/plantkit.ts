// Procedural plants: a branch skeleton grown breadth-first and meshed into bark tubes and leaf
// cards (the method of ez-tree, github.com/dgreenheck/ez-tree, and of Weber & Penn 1995):
// each branch is a chain of sections that taper, bend at random (more where thin: gnarliness),
// twist and turn toward a force (gravity, light); children start at stratified heights with
// shuffled radial angles, so they never bunch; the last level carries the leaves, crossed cards
// cut out of the foliage atlas. Every random number comes from the seed (never Math.random), so
// the same parameters always draw the same plant. The skeleton is grown in its own units and
// scaled to the asked height and crown, so the size handles stay exact. No three.
// The growth rules follow ez-tree's tree.js (MIT License, Copyright (c) Daniel Greenheck).
import type { Vec3 } from '../model/schema';
import type { Foliage, PartMat, PartSink } from './family';
import { foliageUV } from './family';

type B3 = [Vec3, Vec3, Vec3]; // basis: x, y (growth), z

export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Rodrigues: v turned by angle around the unit axis k. */
function rot(v: Vec3, k: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang),
    s = Math.sin(ang);
  const kv = cross(k, v),
    d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}
const turn = (b: B3, k: Vec3, ang: number): B3 => (ang ? [rot(b[0], k, ang), rot(b[1], k, ang), rot(b[2], k, ang)] : b);

/** Growth rules per level (index 0 = trunk). Lengths of the children are fractions of their parent. */
export interface PlantSpec {
  levels: number;
  /** Trunk length (skeleton units) and the child length ratio per level. */
  length: number[];
  /** Trunk radius and the child radius ratio (of the parent section) per level. */
  radius: number[];
  sections: number[];
  segments: number[];
  taper: number[];
  gnarl: number[];
  twist: number[];
  /** Children per branch of each level, where they start along it (0–1) and their angle to it (rad). */
  children: number[];
  start: number[];
  angle: number[];
  /** Child length shrinks toward the parent tip (conifers: the whorls get shorter going up). */
  cone?: boolean;
  /** Direction the branches turn to and how strongly (negative y = weeping). */
  force: Vec3;
  strength: number;
  /** Stems from the ground (shrubs): extra trunks fanned around the first. */
  stems?: number;
  stemAngle?: number;
  leaves: { kind: Foliage; count: number; start: number; angle: number; size: number; vary: number; double: boolean };
}

interface Sec {
  o: Vec3;
  b: B3;
  r: number;
}
interface Leaf {
  o: Vec3;
  b: B3;
  s: number;
}

export interface Skeleton {
  branches: { secs: Sec[]; segs: number }[];
  leaves: Leaf[];
  /** Crossed leaf cards (two per leaf). */
  double: boolean;
}

export function grow(spec: PlantSpec, seed: number): Skeleton {
  const R = rng(seed);
  const U = (a: number, b: number) => a + (b - a) * R();
  const out: Skeleton = { branches: [], leaves: [], double: spec.leaves.double };
  const up: B3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  type Q = { o: Vec3; b: B3; len: number; r: number; level: number };
  const queue: Q[] = [];
  const stems = Math.max(1, spec.stems ?? 1);
  for (let s = 0; s < stems; s++) {
    let b = up;
    if (stems > 1) {
      b = turn(b, [0, 1, 0], (s / stems) * Math.PI * 2 + U(-0.3, 0.3));
      b = turn(b, b[0], (spec.stemAngle ?? 0.35) * U(0.6, 1.2));
    }
    queue.push({ o: [U(-0.03, 0.03) * (stems > 1 ? 1 : 0), 0, U(-0.03, 0.03) * (stems > 1 ? 1 : 0)], b, len: spec.length[0]! * (stems > 1 ? U(0.75, 1) : 1), r: spec.radius[0]!, level: 0 });
  }
  const F = norm(spec.force);
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    const br = queue.shift()!;
    const L = br.level;
    const n = Math.max(1, spec.sections[L]!);
    const secLen = br.len / n;
    const secs: Sec[] = [];
    let o = br.o,
      b = br.b;
    for (let i = 0; i <= n; i++) {
      const r = L === spec.levels && i === n ? br.r * 0.15 : br.r * (1 - spec.taper[L]! * (i / n));
      secs.push({ o, b, r: Math.max(r, 1e-4) });
      if (i === n) break;
      o = add(o, b[1], secLen);
      const g = Math.max(1, 1 / Math.sqrt(Math.max(r, 1e-3) * 40)) * spec.gnarl[L]!;
      if (g) {
        b = turn(b, b[0], U(-g, g));
        b = turn(b, b[2], U(-g, g));
      }
      b = turn(b, b[1], spec.twist[L]!);
      if (spec.strength) {
        const axis = cross(b[1], F);
        const sn = Math.hypot(axis[0], axis[1], axis[2]);
        if (sn > 1e-5) {
          const full = Math.atan2(sn, dot(b[1], F));
          const step = Math.min(full, (spec.strength * secLen) / Math.max(r * 30, 0.15));
          b = turn(b, norm(axis), step);
        }
      }
    }
    out.branches.push({ secs, segs: spec.segments[L]! });
    // Children or leaves at stratified heights, the radial angle slots shuffled.
    const last = L === spec.levels;
    const count = last ? spec.leaves.count : spec.children[L]!;
    const st = last ? spec.leaves.start : spec.start[L]!;
    const offset = R();
    const slots = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [slots[i], slots[j]] = [slots[j]!, slots[i]!];
    }
    const hs = (1 - st) / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      const t = Math.min(0.999, st + (i + R()) * hs);
      const f = t * n,
        k = Math.min(n - 1, Math.floor(f)),
        a = f - k;
      const A = secs[k]!,
        Bs = secs[k + 1]!;
      const so: Vec3 = [A.o[0] + (Bs.o[0] - A.o[0]) * a, A.o[1] + (Bs.o[1] - A.o[1]) * a, A.o[2] + (Bs.o[2] - A.o[2]) * a];
      const pb = a < 0.5 ? A.b : Bs.b;
      const theta = Math.PI * 2 * (offset + (slots[i]! + U(-0.4, 0.4)) / count);
      let cb = turn(pb, pb[1], theta);
      cb = turn(cb, cb[0], last ? spec.leaves.angle * U(0.7, 1.2) : spec.angle[L + 1]! * U(0.85, 1.15));
      if (last) out.leaves.push({ o: so, b: cb, s: spec.leaves.size * (1 + U(-spec.leaves.vary, spec.leaves.vary)) });
      else {
        const pr = A.r + (Bs.r - A.r) * a;
        queue.push({ o: so, b: cb, len: br.len * spec.length[L + 1]! * (spec.cone ? 1 - t * 0.85 : 1) * U(0.85, 1.1), r: pr * spec.radius[L + 1]!, level: L + 1 });
      }
    }
  }
  return out;
}

/** Bounds of the skeleton with its leaves (to scale it to the asked size). */
function bounds(sk: Skeleton): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const take = (p: Vec3, pad: number) => {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]! - pad);
      hi[k] = Math.max(hi[k]!, p[k]! + pad);
    }
  };
  for (const b of sk.branches) for (const s of b.secs) take(s.o, s.r);
  for (const l of sk.leaves) take(add(l.o, l.b[1], l.s * 0.6), l.s * 0.5);
  return { lo, hi };
}

export interface PlantMats {
  bark: PartMat;
  leaf: PartMat;
}

/**
 * Meshes a skeleton into `out`, scaled to `width` × `height` (× width) with its base at y = 0.
 * `detail` 0–1 thins the leaves and the tube facets (enlarging the leaves kept, as ez-tree's LOD:
 * leaf scale ≈ 1/√ kept), and branches thinner than `minR` (after scaling) are left out.
 */
export function meshPlant(out: PartSink, sk: Skeleton, m: PlantMats, width: number, height: number, detail = 1, minR = 0.004, bloom?: { mat: PartMat; every: number }): void {
  const { lo, hi } = bounds(sk);
  const cx = (lo[0] + hi[0]) / 2,
    cz = (lo[2] + hi[2]) / 2;
  const sx = width / Math.max(1e-3, Math.max(hi[0] - lo[0], hi[2] - lo[2])),
    sy = height / Math.max(1e-3, hi[1] - Math.min(0, lo[1]));
  const S = (p: Vec3): Vec3 => [(p[0] - cx) * sx, p[1] * sy, (p[2] - cz) * sx];
  const N = (n: Vec3): Vec3 => norm([n[0] / sx, n[1] / sy, n[2] / sx]);
  const rs = Math.sqrt(sx * sy);
  // Bark tubes.
  const pos: number[] = [],
    nrm: number[] = [];
  for (const br of sk.branches) {
    if (br.secs[0]!.r * rs < minR) continue;
    const segs = Math.max(3, Math.round(br.segs * (0.5 + detail * 0.5)));
    const ring = (s: Sec) => {
      const ps: Vec3[] = [],
        ns: Vec3[] = [];
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const d: Vec3 = add(add([0, 0, 0], s.b[0], Math.cos(a)), s.b[2], Math.sin(a));
        ps.push(S(add(s.o, d, s.r)));
        ns.push(N(d));
      }
      return { ps, ns };
    };
    let prev = ring(br.secs[0]!);
    for (let i = 1; i < br.secs.length; i++) {
      const cur = ring(br.secs[i]!);
      for (let j = 0; j < segs; j++) {
        const q = [prev.ps[j]!, prev.ps[j + 1]!, cur.ps[j + 1]!, cur.ps[j]!];
        const qn = [prev.ns[j]!, prev.ns[j + 1]!, cur.ns[j + 1]!, cur.ns[j]!];
        // Outward winding: the ring goes x → z (clockwise seen from the tip).
        for (const k of [0, 2, 1, 0, 3, 2]) {
          pos.push(...q[k]!);
          nrm.push(...qn[k]!);
        }
      }
      prev = cur;
    }
  }
  out.mesh(m.bark, pos, nrm);
  // Leaf cards: crossed quads hanging from their origin; normals bent out of the crown centre
  // (the soft, round canopy shading of billboard foliage).
  const lp: number[] = [],
    ln: number[] = [],
    lu: number[] = [];
  const fp: number[] = [],
    fn: number[] = [],
    fu: number[] = [];
  const fuv = foliageUV('flower');
  let li = 0;
  const keep = Math.max(0.15, Math.min(1, detail));
  const grow = 1 / Math.sqrt(keep);
  const uv = foliageUV(sk.leaves.length ? (m.leaf.foliage ?? 'broad') : 'broad');
  const crown: Vec3 = [0, height * 0.62, 0];
  const cr = Math.max(width, height) * 0.5;
  let acc = 0;
  for (const lf of sk.leaves) {
    acc += keep;
    if (acc < 1) continue;
    acc -= 1;
    const o = S(lf.o);
    const s = lf.s * grow;
    // Blossom: a flower card on every n-th leaf, at its tip, facing out of the crown.
    if (bloom && li++ % bloom.every === 0) {
      const tip = add(o, [lf.b[1][0] * sx * s * 0.7, lf.b[1][1] * sy * s * 0.7, lf.b[1][2] * sx * s * 0.7]);
      const out3 = norm([(tip[0] - crown[0]) / cr, (tip[1] - crown[1]) / cr, (tip[2] - crown[2]) / cr]);
      const u = norm(cross(out3, Math.abs(out3[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const v = cross(out3, u);
      const fs = s * 0.32 * Math.sqrt(sx * sy);
      const cs: Vec3[] = [add(add(tip, u, -fs), v, -fs), add(add(tip, u, fs), v, -fs), add(add(tip, u, fs), v, fs), add(add(tip, u, -fs), v, fs)];
      const uvs: [number, number][] = [[fuv.u0, fuv.vb], [fuv.u1, fuv.vb], [fuv.u1, fuv.vt], [fuv.u0, fuv.vt]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        fp.push(...cs[k]!);
        fn.push(...out3);
        fu.push(...uvs[k]!);
      }
    }
    for (let c = 0; c < 2; c++) {
      if (c && !sk.double) break;
      const bx = c ? lf.b[2] : lf.b[0];
      const X: Vec3 = [bx[0] * sx * s * 0.5, bx[1] * sy * s * 0.5, bx[2] * sx * s * 0.5];
      const Y: Vec3 = [lf.b[1][0] * sx * s, lf.b[1][1] * sy * s, lf.b[1][2] * sx * s];
      const corners: Vec3[] = [add(o, X, -1), add(o, X, 1), add(add(o, X, 1), Y), add(add(o, X, -1), Y)];
      const uvs: [number, number][] = [[uv.u0, uv.vb], [uv.u1, uv.vb], [uv.u1, uv.vt], [uv.u0, uv.vt]];
      const face = norm(cross(X, Y));
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = corners[k]!;
        const out3 = norm([(p[0] - crown[0]) / cr, (p[1] - crown[1]) / cr, (p[2] - crown[2]) / cr]);
        const f = dot(face, out3) < 0 ? -1 : 1;
        lp.push(...p);
        ln.push(...norm(add(out3, face, 0.35 * f)));
        lu.push(...uvs[k]!);
      }
    }
  }
  out.mesh(m.leaf, lp, ln, lu);
  if (bloom && fp.length) out.mesh(bloom.mat, fp, fn, fu);
}

/** One frond (palm, fern): a strip of cards bending along a curve from `o` in the direction `dir`, drooping by `droop`. */
export function frond(lp: number[], ln: number[], lu: number[], kind: Foliage, o: Vec3, dir: Vec3, len: number, width: number, droop: number, steps = 5): void {
  const uv = foliageUV(kind);
  const d = norm([dir[0], 0, dir[2]]);
  const side = norm(cross([0, 1, 0], d));
  const rise = dir[1];
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([o[0] + d[0] * len * t, o[1] + len * (rise * t - droop * t * t), o[2] + d[2] * len * t]);
  }
  for (let i = 0; i < steps; i++) {
    const a = pts[i]!,
      b = pts[i + 1]!;
    const w0 = width * (i === 0 ? 0.6 : 1) * 0.5,
      w1 = width * (i + 1 === steps ? 0.35 : 1) * 0.5;
    const tilt: Vec3 = [0, -0.25, 0];
    const corners: Vec3[] = [add(add(a, side, -w0), tilt, w0), add(add(a, side, w0), tilt, w0), add(add(b, side, w1), tilt, w1), add(add(b, side, -w1), tilt, w1)];
    const v0 = uv.vb + (uv.vt - uv.vb) * (i / steps),
      v1 = uv.vb + (uv.vt - uv.vb) * ((i + 1) / steps);
    const uvs: [number, number][] = [[uv.u0, v0], [uv.u1, v0], [uv.u1, v1], [uv.u0, v1]];
    // Upper side of the strip (segment × side points up), bent further up: lit like the crown top.
    const n = norm(add(cross(norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), side), [0, 1, 0], 0.6));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      lp.push(...corners[k]!);
      ln.push(...n);
      lu.push(...uvs[k]!);
    }
  }
}
