// Your own object: any object put together from simple solids (box, rounded box, cylinder, tube, cone,
// pyramid, sphere, torus, wedge), each placed, sized, turned and finished on its own, like the primitives
// of Blender or SketchUp grouped into a component. The shapes are a parameter of the type (JSON), so the
// object is saved in the project, placed, copied and arrayed like any other component, and every copy
// follows when it is edited (ui/objectmaker.ts). Pure: shapes → triangles, no three.
import type { Vec3 } from '../model/schema';
import type { Family, PartMat, PartSink, Params, Slot } from './family';

export type ShapeKind = 'box' | 'rbox' | 'cylinder' | 'tube' | 'cone' | 'pyramid' | 'sphere' | 'torus' | 'wedge';

export const SHAPE_KINDS: [ShapeKind, string][] = [
  ['box', 'Box'],
  ['rbox', 'Rounded box'],
  ['cylinder', 'Cylinder'],
  ['tube', 'Tube'],
  ['cone', 'Cone'],
  ['pyramid', 'Pyramid'],
  ['sphere', 'Sphere'],
  ['torus', 'Ring'],
  ['wedge', 'Wedge'],
];

export interface Shape {
  kind: ShapeKind;
  /** Name shown in the list ("Leg", "Shade"). */
  name?: string;
  /** Middle of the shape's box (m; y up from the object's base). */
  at: Vec3;
  /** Width (x), height (y) and depth (z) of its box. */
  size: Vec3;
  /** Turn in degrees: around y, then x, then z. */
  rot?: Vec3;
  /** Rounding (rounded box), wall (tube) or thickness (ring), as a share of the size: 0.05 … 0.9. */
  t?: number;
  color: string;
  finish?: string;
  color2?: string;
  /** Glows at night and lights around it (a lamp shade, a bulb). */
  lamp?: boolean;
  rough?: number;
  metal?: number;
  glow?: number;
  opacity?: number;
}

/** The shapes of a type (its `shapes` parameter), [] when it does not read. */
export function readShapes(p: Params): Shape[] {
  const raw = p.shapes;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const list = JSON.parse(raw) as Shape[];
    return Array.isArray(list) ? list.filter((s) => s && SHAPE_KINDS.some(([k]) => k === s.kind) && Array.isArray(s.at) && Array.isArray(s.size)) : [];
  } catch {
    return [];
  }
}

const SLOT_OF: Record<string, Slot> = { wood: 'wood', 'wood-photo': 'wood', metal: 'metal', steel: 'metal', panel: 'metal', 'metal-photo': 'metal', glass: 'glass', stone: 'stone', 'stone-photo': 'stone', concrete: 'concrete', 'concrete-photo': 'concrete' };

/** The part material of a shape, its surface adjustments carried along. */
export function shapeMat(s: Shape): PartMat {
  const slot: Slot = s.lamp ? 'light' : (s.finish && SLOT_OF[s.finish]) || 'stone';
  const surface = { ...(s.rough !== undefined ? { rough: s.rough } : {}), ...(s.metal !== undefined ? { metal: s.metal } : {}), ...(s.glow ? { glow: s.glow } : {}), ...(s.opacity !== undefined && s.opacity < 1 ? { opacity: s.opacity } : {}) };
  return { slot, color: s.color, ...(s.finish ? { finish: s.finish } : {}), ...(s.color2 ? { color2: s.color2 } : {}), ...(Object.keys(surface).length ? { surface } : {}) };
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Rotation y, then x, then z (as the part sink turns a box), as a 3×3 row-major matrix. */
function rotation(r: Vec3 | undefined): number[] {
  const [ry, rx, rz] = r ? [rad(r[0]), rad(r[1]), rad(r[2])] : [0, 0, 0];
  const cy = Math.cos(ry),
    sy = Math.sin(ry),
    cx = Math.cos(rx),
    sx = Math.sin(rx),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  // Y · X · Z applied to a column vector.
  const Y = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const X = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Z = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const m = (a: number[], b: number[]) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!));
  return m(Y, m(X, Z));
}

/** Triangles of a unit shape (inside the box −0.5 … 0.5) with their normals. */
function unit(kind: ShapeKind, t: number): { p: number[]; n: number[] } {
  const p: number[] = [],
    n: number[] = [];
  const tri = (a: Vec3, b: Vec3, c: Vec3, na?: Vec3, nb?: Vec3, nc?: Vec3) => {
    p.push(...a, ...b, ...c);
    if (na) n.push(...na, ...(nb ?? na), ...(nc ?? na));
    else {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const f: Vec3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const l = Math.hypot(...f) || 1;
      const g: Vec3 = [f[0] / l, f[1] / l, f[2] / l];
      n.push(...g, ...g, ...g);
    }
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const N = 32;
  const ring = (r: number, y: number, i: number): Vec3 => [Math.cos((i / N) * Math.PI * 2) * r, y, -Math.sin((i / N) * Math.PI * 2) * r];
  const side = (i: number): Vec3 => [Math.cos((i / N) * Math.PI * 2), 0, -Math.sin((i / N) * Math.PI * 2)];
  switch (kind) {
    case 'box':
    case 'rbox':
      // (The sink draws these two itself.)
      break;
    case 'cylinder':
    case 'tube': {
      const ri = kind === 'tube' ? 0.5 * (1 - Math.min(0.95, Math.max(0.02, t))) : 0;
      for (let i = 0; i < N; i++) {
        const j = i + 1;
        tri(ring(0.5, -0.5, i), ring(0.5, -0.5, j), ring(0.5, 0.5, j), side(i), side(j), side(j));
        tri(ring(0.5, -0.5, i), ring(0.5, 0.5, j), ring(0.5, 0.5, i), side(i), side(j), side(i));
        if (ri > 0) {
          const ni = side(i).map((v) => -v) as Vec3,
            nj = side(j).map((v) => -v) as Vec3;
          tri(ring(ri, -0.5, j), ring(ri, -0.5, i), ring(ri, 0.5, i), nj, ni, ni);
          tri(ring(ri, -0.5, j), ring(ri, 0.5, i), ring(ri, 0.5, j), nj, ni, nj);
          quad(ring(ri, 0.5, i), ring(0.5, 0.5, i), ring(0.5, 0.5, j), ring(ri, 0.5, j));
          quad(ring(ri, -0.5, j), ring(0.5, -0.5, j), ring(0.5, -0.5, i), ring(ri, -0.5, i));
        } else {
          tri([0, 0.5, 0], ring(0.5, 0.5, i), ring(0.5, 0.5, j));
          tri([0, -0.5, 0], ring(0.5, -0.5, j), ring(0.5, -0.5, i));
        }
      }
      break;
    }
    case 'cone':
      for (let i = 0; i < N; i++) {
        const j = i + 1;
        // Side normals lean up by the slope (height 1, radius 0.5).
        const sn = (k: number): Vec3 => {
          const s = side(k);
          const l = Math.hypot(1, 0.5);
          return [s[0] / l, 0.5 / l, s[2] / l];
        };
        tri(ring(0.5, -0.5, i), ring(0.5, -0.5, j), [0, 0.5, 0], sn(i), sn(j), sn(i + 0.5));
        tri([0, -0.5, 0], ring(0.5, -0.5, j), ring(0.5, -0.5, i));
      }
      break;
    case 'pyramid': {
      const c: Vec3[] = [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]];
      for (let i = 0; i < 4; i++) tri(c[i]!, c[(i + 1) % 4]!, [0, 0.5, 0]);
      tri(c[0]!, c[2]!, c[1]!);
      tri(c[0]!, c[3]!, c[2]!);
      break;
    }
    case 'sphere': {
      const M = 16;
      const pt = (i: number, k: number): Vec3 => {
        const th = (k / M) * Math.PI,
          ph = (i / N) * Math.PI * 2;
        return [Math.sin(th) * Math.cos(ph) * 0.5, Math.cos(th) * 0.5, -Math.sin(th) * Math.sin(ph) * 0.5];
      };
      const nm = (q: Vec3): Vec3 => [q[0] * 2, q[1] * 2, q[2] * 2];
      for (let k = 0; k < M; k++)
        for (let i = 0; i < N; i++) {
          const a = pt(i, k),
            b = pt(i, k + 1),
            c = pt(i + 1, k + 1),
            d = pt(i + 1, k);
          if (k > 0) tri(a, b, d, nm(a), nm(b), nm(d));
          if (k < M - 1) tri(b, c, d, nm(b), nm(c), nm(d));
        }
      break;
    }
    case 'torus': {
      const r = 0.5 * Math.min(0.9, Math.max(0.05, t));
      const R = 0.5 - r;
      const M = 16;
      const pt = (i: number, k: number): [Vec3, Vec3] => {
        const ph = (i / N) * Math.PI * 2,
          v = (k / M) * Math.PI * 2;
        const dir: Vec3 = [Math.cos(ph), 0, -Math.sin(ph)];
        const nr: Vec3 = [dir[0] * Math.cos(v), Math.sin(v), dir[2] * Math.cos(v)];
        // The tube is as tall as the box (its height scales it).
        return [[dir[0] * (R + r * Math.cos(v)), 0.5 * Math.sin(v), dir[2] * (R + r * Math.cos(v))], nr];
      };
      for (let k = 0; k < M; k++)
        for (let i = 0; i < N; i++) {
          const [a, na] = pt(i, k),
            [b, nb] = pt(i + 1, k),
            [c, nc] = pt(i + 1, k + 1),
            [d, nd] = pt(i, k + 1);
          tri(a, b, c, na, nb, nc);
          tri(a, c, d, na, nc, nd);
        }
      break;
    }
    case 'wedge': {
      // A ramp: full height at the back (−z), nothing at the front (+z).
      const A: Vec3 = [-0.5, -0.5, 0.5],
        B: Vec3 = [0.5, -0.5, 0.5],
        C: Vec3 = [0.5, -0.5, -0.5],
        D: Vec3 = [-0.5, -0.5, -0.5],
        E: Vec3 = [0.5, 0.5, -0.5],
        F: Vec3 = [-0.5, 0.5, -0.5];
      quad(A, D, C, B);
      quad(D, F, E, C);
      quad(A, B, E, F);
      tri(B, C, E);
      tri(A, F, D);
      break;
    }
  }
  return { p, n };
}

/** Draws one shape into the sink, in the object's frame. */
export function drawShape(out: PartSink, s: Shape): void {
  const m = shapeMat(s);
  const size: Vec3 = [Math.max(0.005, s.size[0]), Math.max(0.005, s.size[1]), Math.max(0.005, s.size[2])];
  if (s.kind === 'box') return out.box(m, s.at, size, s.rot);
  if (s.kind === 'rbox') return out.rbox(m, s.at, size, Math.min(...size) * 0.5 * Math.min(0.9, Math.max(0.05, s.t ?? 0.3)), s.rot);
  const { p, n } = unit(s.kind, s.t ?? 0.3);
  const R = rotation(s.rot);
  const pos: number[] = new Array(p.length),
    nrm: number[] = new Array(n.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i]! * size[0],
      y = p[i + 1]! * size[1],
      z = p[i + 2]! * size[2];
    pos[i] = R[0]! * x + R[1]! * y + R[2]! * z + s.at[0];
    pos[i + 1] = R[3]! * x + R[4]! * y + R[5]! * z + s.at[1];
    pos[i + 2] = R[6]! * x + R[7]! * y + R[8]! * z + s.at[2];
    // Normals through the inverse scale, then the turn.
    const a = n[i]! / size[0],
      b = n[i + 1]! / size[1],
      c = n[i + 2]! / size[2];
    const nx = R[0]! * a + R[1]! * b + R[2]! * c,
      ny = R[3]! * a + R[4]! * b + R[5]! * c,
      nz = R[6]! * a + R[7]! * b + R[8]! * c;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm[i] = nx / l;
    nrm[i + 1] = ny / l;
    nrm[i + 2] = nz / l;
  }
  out.mesh(m, pos, nrm);
}

/** The box around every shape (turned shapes by their turned corners). */
export function shapesBox(list: Shape[]): { lo: Vec3; hi: Vec3 } {
  const lo: Vec3 = [Infinity, Infinity, Infinity],
    hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of list) {
    const R = rotation(s.rot);
    for (const sx of [-0.5, 0.5])
      for (const sy of [-0.5, 0.5])
        for (const sz of [-0.5, 0.5]) {
          const x = sx * s.size[0],
            y = sy * s.size[1],
            z = sz * s.size[2];
          const q: Vec3 = [R[0]! * x + R[1]! * y + R[2]! * z + s.at[0], R[3]! * x + R[4]! * y + R[5]! * z + s.at[1], R[6]! * x + R[7]! * y + R[8]! * z + s.at[2]];
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k]!, q[k]!);
            hi[k] = Math.max(hi[k]!, q[k]!);
          }
        }
  }
  return list.length ? { lo, hi } : { lo: [-0.5, 0, -0.5], hi: [0.5, 1, 0.5] };
}

/** A first object: a small side table (four legs and a top), to change into anything. */
export const STARTER: Shape[] = [
  { kind: 'rbox', name: 'Tabletop', at: [0, 0.72, 0], size: [0.8, 0.04, 0.5], t: 0.4, color: '#9c6b43', finish: 'wood' },
  { kind: 'cylinder', name: 'Leg', at: [-0.34, 0.35, -0.19], size: [0.04, 0.7, 0.04], color: '#2b2b2b', finish: 'steel' },
  { kind: 'cylinder', name: 'Leg', at: [0.34, 0.35, -0.19], size: [0.04, 0.7, 0.04], color: '#2b2b2b', finish: 'steel' },
  { kind: 'cylinder', name: 'Leg', at: [-0.34, 0.35, 0.19], size: [0.04, 0.7, 0.04], color: '#2b2b2b', finish: 'steel' },
  { kind: 'cylinder', name: 'Leg', at: [0.34, 0.35, 0.19], size: [0.04, 0.7, 0.04], color: '#2b2b2b', finish: 'steel' },
];

export const ASSEMBLY: Family = {
  id: 'assembly',
  name: 'Your own object',
  category: 'furniture',
  host: 'free',
  tags: ['custom', 'object', 'shapes', 'primitives', 'model', 'sculpt', 'own', 'make', 'anything'],
  params: [{ key: 'shapes', label: 'Shapes', kind: 'text', default: JSON.stringify(STARTER), scope: 'type', group: 'detail' }],
  size(p) {
    const b = shapesBox(readShapes(p));
    return [b.hi[0] - b.lo[0], b.hi[1] - Math.min(0, b.lo[1]), b.hi[2] - b.lo[2]];
  },
  build(p, out) {
    for (const s of readShapes(p)) drawShape(out, s);
  },
};
