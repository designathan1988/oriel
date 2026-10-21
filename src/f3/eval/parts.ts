// Component parts already in the building frame: instanced primitives
// (box, cylinder) with a 4×4 matrix and free meshes (profiles). No three.
import earcut from 'earcut';
import type { ID, Vec3 } from '../model/schema';
import type { PartMat, PartSink } from '../families/family';

/** Column-major 4×4 matrix (same order as three.js Matrix4.elements). */
export type M4 = number[];

export interface PartTag {
  family: string;
  item?: ID;
  rule?: ID;
  /** Position in the facade rule ("side:level:index") or in the array. */
  key?: string;
  solid?: ID;
}

export interface InstPart {
  shape: 'box' | 'cyl6' | 'cyl12' | 'cyl20';
  mat: PartMat;
  m: M4;
  tag: number;
  /** Floor band in an exploded view (lifted by floor × gap when drawn). */
  floor?: number;
}

export interface MeshPart3 {
  mat: PartMat;
  positions: number[];
  /** Own normals and UVs (bark, leaf cards); absent = flat normals and metric UVs. */
  normals?: number[];
  uvs?: number[];
  tag: number;
  floor?: number;
}

export interface Parts3 {
  inst: InstPart[];
  meshes: MeshPart3[];
  tags: PartTag[];
}

export const emptyParts3 = (): Parts3 => ({ inst: [], meshes: [], tags: [] });

export const identity = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

/** Basis (u, v, n) with origin p: carries the part's local frame to the building. */
export function frameMatrix(p: Vec3, u: Vec3, v: Vec3, n: Vec3): M4 {
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, n[0], n[1], n[2], 0, p[0], p[1], p[2], 1];
}

/**
 * Part frame on a side face: z outward (n), y up (v) and x = v × n, to the right
 * of a viewer facing the facade. The face basis (u, v, n) is left-handed (det −1)
 * and three.js only flips the front face by the object determinant, never by
 * each instance matrix: a part instanced on it comes out mirrored, with swapped
 * winding and normal (the glass turned opaque).
 */
export function faceMatrix(p: Vec3, u: Vec3, v: Vec3, n: Vec3): M4 {
  return frameMatrix(p, [-u[0], -u[1], -u[2]], v, n);
}

export function translation(x: number, y: number, z: number): M4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function scaling(x: number, y: number, z: number): M4 {
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Rotation in degrees: y, then x, then z (applied to the object in that order). */
export function rotationYXZ(r: Vec3): M4 {
  const [ry, rx, rz] = [rad(r[0]), rad(r[1]), rad(r[2])];
  const Y: M4 = [Math.cos(ry), 0, -Math.sin(ry), 0, 0, 1, 0, 0, Math.sin(ry), 0, Math.cos(ry), 0, 0, 0, 0, 1];
  const X: M4 = [1, 0, 0, 0, 0, Math.cos(rx), Math.sin(rx), 0, 0, -Math.sin(rx), Math.cos(rx), 0, 0, 0, 0, 1];
  const Z: M4 = [Math.cos(rz), Math.sin(rz), 0, 0, -Math.sin(rz), Math.cos(rz), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return mul(Y, mul(X, Z));
}

export function apply(m: M4, p: Vec3): Vec3 {
  return [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];
}

const CREASE = Math.cos((35 * Math.PI) / 180);

/**
 * Creased normals of loose triangles (three.js BufferGeometryUtils.toCreasedNormals, per primitive):
 * each corner takes the mean of the face normals around its point that lie within 35° of its own
 * face, so a lathe or a curved profile shades round while its rims and corners stay sharp.
 */
export function creaseNormals(pos: readonly number[]): number[] {
  const nt = pos.length / 9;
  const fn = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const o = t * 9;
    const ux = pos[o + 3]! - pos[o]!,
      uy = pos[o + 4]! - pos[o + 1]!,
      uz = pos[o + 5]! - pos[o + 2]!;
    const vx = pos[o + 6]! - pos[o]!,
      vy = pos[o + 7]! - pos[o + 1]!,
      vz = pos[o + 8]! - pos[o + 2]!;
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    fn[t * 3] = x / l;
    fn[t * 3 + 1] = y / l;
    fn[t * 3 + 2] = z / l;
  }
  const at = new Map<string, number[]>();
  const key = (i: number) => `${Math.round(pos[i]! * 1e4)},${Math.round(pos[i + 1]! * 1e4)},${Math.round(pos[i + 2]! * 1e4)}`;
  const keys: string[] = new Array(nt * 3);
  for (let v = 0; v < nt * 3; v++) {
    const k = (keys[v] = key(v * 3));
    const l = at.get(k);
    if (l) l.push(Math.floor(v / 3));
    else at.set(k, [Math.floor(v / 3)]);
  }
  const out = new Array<number>(pos.length);
  for (let v = 0; v < nt * 3; v++) {
    const t = Math.floor(v / 3);
    const ax = fn[t * 3]!,
      ay = fn[t * 3 + 1]!,
      az = fn[t * 3 + 2]!;
    let x = 0,
      y = 0,
      z = 0;
    for (const s of at.get(keys[v]!)!) {
      const bx = fn[s * 3]!,
        by = fn[s * 3 + 1]!,
        bz = fn[s * 3 + 2]!;
      if (ax * bx + ay * by + az * bz >= CREASE) {
        x += bx;
        y += by;
        z += bz;
      }
    }
    const l = Math.hypot(x, y, z) || 1;
    out[v * 3] = x / l;
    out[v * 3 + 1] = y / l;
    out[v * 3 + 2] = z / l;
  }
  return out;
}

/** Part sink that transforms everything by the frame matrix. */
export class FrameSink implements PartSink {
  constructor(
    private out: Parts3,
    private frame: M4,
    private tag: number,
  ) {}

  box(m: PartMat, c: Vec3, s: Vec3, rot?: Vec3): void {
    if (s[0] <= 1e-4 || s[1] <= 1e-4 || s[2] <= 1e-4) return;
    let local = translation(c[0], c[1], c[2]);
    if (rot && (rot[0] || rot[1] || rot[2])) local = mul(local, rotationYXZ(rot));
    this.out.inst.push({ shape: 'box', mat: m, m: mul(this.frame, mul(local, scaling(s[0], s[1], s[2]))), tag: this.tag });
  }

  cylinder(m: PartMat, base: Vec3, r: number, h: number, sides = 12): void {
    if (r <= 1e-4 || h <= 1e-4) return;
    const shape = sides <= 6 ? 'cyl6' : sides <= 12 ? 'cyl12' : 'cyl20';
    this.out.inst.push({ shape, mat: m, m: mul(this.frame, mul(translation(base[0], base[1] + h / 2, base[2]), scaling(r * 2, h, r * 2))), tag: this.tag });
  }

  rod(m: PartMat, a: Vec3, b: Vec3, r: number, sides = 6): void {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    if (L < 1e-4 || r <= 1e-4) return;
    const y: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
    const ref: Vec3 = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let x: Vec3 = [y[1] * ref[2] - y[2] * ref[1], y[2] * ref[0] - y[0] * ref[2], y[0] * ref[1] - y[1] * ref[0]];
    const xl = Math.hypot(x[0], x[1], x[2]) || 1;
    x = [x[0] / xl, x[1] / xl, x[2] / xl];
    const z: Vec3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const local = mul(frameMatrix(mid, x, y, z), scaling(r * 2, L, r * 2));
    const shape = sides <= 6 ? 'cyl6' : sides <= 12 ? 'cyl12' : 'cyl20';
    this.out.inst.push({ shape, mat: m, m: mul(this.frame, local), tag: this.tag });
  }

  prism(m: PartMat, profile: [number, number][], z0: number, z1: number, holes: [number, number][][] = []): void {
    if (profile.length < 3 || Math.abs(z1 - z0) < 1e-5) return;
    if (z1 < z0) [z0, z1] = [z1, z0];
    const pos: number[] = [];
    const P = (x: number, y: number, z: number) => apply(this.frame, [x, y, z]);
    const push = (...ps: Vec3[]) => {
      for (const q of ps) pos.push(q[0], q[1], q[2]);
    };
    // Counterclockwise outer ring and clockwise holes (normals out of the material).
    const outer = area2(profile) > 0 ? profile : [...profile].reverse();
    const hs = holes.filter((h) => h.length >= 3).map((h) => (area2(h) < 0 ? h : [...h].reverse()));
    const all = [outer, ...hs];
    const flat: number[] = [];
    const holeIdx: number[] = [];
    for (const r of all) {
      if (r !== outer) holeIdx.push(flat.length / 2);
      for (const q of r) flat.push(q[0], q[1]);
    }
    const pts = all.flat();
    const tri = earcut(flat, holeIdx);
    for (let t = 0; t < tri.length; t += 3) {
      const a = pts[tri[t]!]!;
      let [b, c] = [pts[tri[t + 1]!]!, pts[tri[t + 2]!]!];
      if (area2([a, b, c]) < 0) [b, c] = [c, b];
      push(P(a[0], a[1], z1), P(b[0], b[1], z1), P(c[0], c[1], z1));
      push(P(a[0], a[1], z0), P(c[0], c[1], z0), P(b[0], b[1], z0));
    }
    for (const r of all)
      for (let i = 0; i < r.length; i++) {
        const a = r[i]!,
          b = r[(i + 1) % r.length]!;
        push(P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1));
        push(P(a[0], a[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1));
      }
    this.out.meshes.push({ mat: m, positions: pos, normals: creaseNormals(pos), tag: this.tag });
  }

  slab(m: PartMat, plan: [number, number][], y0: number, y1: number, holes: [number, number][][] = []): void {
    // Rotation (det = 1): prism x → x, prism y → −z, prism z → y.
    const rot = mul(this.frame, [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
    new FrameSink(this.out, rot, this.tag).prism(m, plan.map(([x, z]) => [x, -z] as [number, number]), y0, y1, holes.map((h) => h.map(([x, z]) => [x, -z] as [number, number])));
  }

  lathe(m: PartMat, profile: [number, number][], sides = 24, c: Vec3 = [0, 0, 0]): void {
    if (profile.length < 2) return;
    const pos: number[] = [];
    const P = (r: number, y: number, a: number): Vec3 => apply(this.frame, [c[0] + Math.cos(a) * r, c[1] + y, c[2] + Math.sin(a) * r]);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2,
        a1 = ((i + 1) / sides) * Math.PI * 2;
      for (let j = 0; j + 1 < profile.length; j++) {
        const [r0, y0] = profile[j]!,
          [r1, y1] = profile[j + 1]!;
        const A = P(r0, y0, a0),
          B = P(r0, y0, a1),
          C = P(r1, y1, a1),
          D = P(r1, y1, a0);
        // Outward normal (profile going up): A, D, C and A, C, B.
        pos.push(...A, ...D, ...C, ...A, ...C, ...B);
      }
    }
    // Caps where the profile starts or ends off the axis.
    const cap = (r: number, y: number, up: boolean) => {
      if (r < 1e-4) return;
      const ctr = apply(this.frame, [c[0], c[1] + y, c[2]]);
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2,
          a1 = ((i + 1) / sides) * Math.PI * 2;
        const A = P(r, y, a0),
          B = P(r, y, a1);
        if (up) pos.push(...ctr, ...B, ...A);
        else pos.push(...ctr, ...A, ...B);
      }
    };
    cap(profile[0]![0], profile[0]![1], false);
    cap(profile[profile.length - 1]![0], profile[profile.length - 1]![1], true);
    this.out.meshes.push({ mat: m, positions: pos, normals: creaseNormals(pos), tag: this.tag });
  }

  translated(x: number, y: number, z: number): FrameSink {
    return new FrameSink(this.out, mul(this.frame, translation(x, y, z)), this.tag);
  }

  placed(x: number, y: number, z: number, rotY: number): FrameSink {
    return new FrameSink(this.out, mul(this.frame, mul(translation(x, y, z), rotationYXZ([rotY, 0, 0]))), this.tag);
  }

  mesh(m: PartMat, positions: number[], normals: number[], uvs?: number[]): void {
    if (positions.length < 9) return;
    const f = this.frame;
    const pos = new Array<number>(positions.length);
    const nrm = new Array<number>(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const [x, y, z] = [positions[i]!, positions[i + 1]!, positions[i + 2]!];
      pos[i] = f[0]! * x + f[4]! * y + f[8]! * z + f[12]!;
      pos[i + 1] = f[1]! * x + f[5]! * y + f[9]! * z + f[13]!;
      pos[i + 2] = f[2]! * x + f[6]! * y + f[10]! * z + f[14]!;
      const [a, b, c] = [normals[i] ?? 0, normals[i + 1] ?? 1, normals[i + 2] ?? 0];
      const nx = f[0]! * a + f[4]! * b + f[8]! * c,
        ny = f[1]! * a + f[5]! * b + f[9]! * c,
        nz = f[2]! * a + f[6]! * b + f[10]! * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm[i] = nx / l;
      nrm[i + 1] = ny / l;
      nrm[i + 2] = nz / l;
    }
    this.out.meshes.push({ mat: m, positions: pos, normals: nrm, ...(uvs ? { uvs } : {}), tag: this.tag });
  }

  rbox(m: PartMat, c: Vec3, s: Vec3, r: number, rot?: Vec3): void {
    const h: Vec3 = [s[0] / 2, s[1] / 2, s[2] / 2];
    r = Math.min(r, h[0], h[1], h[2]);
    if (r < 1e-3) return this.box(m, c, s, rot);
    let local = translation(c[0], c[1], c[2]);
    if (rot && (rot[0] || rot[1] || rot[2])) local = mul(local, rotationYXZ(rot));
    const sink = new FrameSink(this.out, mul(this.frame, local), this.tag);
    // three.js RoundedBoxGeometry: a grid on each face whose outer rows follow the corner arcs; each
    // point is pushed to the inner box plus r along its offset (exact round normals).
    const n = r < 0.012 ? 1 : 2;
    const inner: Vec3 = [h[0] - r, h[1] - r, h[2] - r];
    const axis = (k: number) => {
      const v: number[] = [];
      for (let j = 0; j <= n; j++) v.push(-inner[k]! - r * Math.cos((j / n) * (Math.PI / 2)));
      for (let j = n; j >= 0; j--) v.push(inner[k]! + r * Math.cos((j / n) * (Math.PI / 2)));
      return v;
    };
    const pos: number[] = [],
      nrm: number[] = [];
    const vert = (p: Vec3) => {
      const cc: Vec3 = [Math.max(-inner[0], Math.min(inner[0], p[0])), Math.max(-inner[1], Math.min(inner[1], p[1])), Math.max(-inner[2], Math.min(inner[2], p[2]))];
      const d: Vec3 = [p[0] - cc[0], p[1] - cc[1], p[2] - cc[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const nn: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
      return { p: [cc[0] + nn[0] * r, cc[1] + nn[1] * r, cc[2] + nn[2] * r] as Vec3, n: nn };
    };
    for (let k = 0; k < 3; k++)
      for (const sg of [-1, 1]) {
        const a = (k + 1) % 3,
          b = (k + 2) % 3;
        const A = axis(a),
          B = axis(b);
        for (let i = 0; i + 1 < A.length; i++)
          for (let j = 0; j + 1 < B.length; j++) {
            const q = [
              [A[i]!, B[j]!],
              [A[i + 1]!, B[j]!],
              [A[i + 1]!, B[j + 1]!],
              [A[i]!, B[j + 1]!],
            ].map(([u, v]) => {
              const p: Vec3 = [0, 0, 0];
              p[k] = sg * h[k]!;
              p[a] = u!;
              p[b] = v!;
              return vert(p);
            });
            // Axis order (k, a, b) is cyclic: (a, b) turns about +k, so the +k face is counterclockwise.
            const order = sg > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
            for (const o of order) {
              pos.push(...q[o]!.p);
              nrm.push(...q[o]!.n);
            }
          }
      }
    sink.mesh(m, pos, nrm);
  }

  loft(m: PartMat, rings: Vec3[][], caps: [boolean, boolean] = [false, false]): void {
    if (rings.length < 2) return;
    const k = rings[0]!.length;
    if (k < 3 || rings.some((r) => r.length !== k)) return;
    const pos: number[] = [];
    for (let s = 0; s + 1 < rings.length; s++) {
      const A = rings[s]!,
        B = rings[s + 1]!;
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        pos.push(...A[i]!, ...B[i]!, ...B[j]!, ...A[i]!, ...B[j]!, ...A[j]!);
      }
    }
    const cap = (R: Vec3[], first: boolean) => {
      const c: Vec3 = [0, 0, 0];
      for (const p of R) for (let q = 0; q < 3; q++) c[q] = c[q]! + p[q]! / R.length;
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        if (first) pos.push(...c, ...R[i]!, ...R[j]!);
        else pos.push(...c, ...R[j]!, ...R[i]!);
      }
    };
    if (caps[0]) cap(rings[0]!, true);
    if (caps[1]) cap(rings[rings.length - 1]!, false);
    this.mesh(m, pos, creaseNormals(pos));
  }

  sweepX(m: PartMat, profile: [number, number][], x0: number, x1: number): void {
    if (profile.length < 3 || x1 - x0 < 1e-5) return;
    // Profile (y, z) → prism along x: axis swap with a frame of its own.
    // Rotation (det = 1): prism x → −z, y → y, prism z → x.
    const rot = mul(this.frame, [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
    const inner = new FrameSink(this.out, rot, this.tag);
    inner.prism(m, profile.map(([y, z]) => [-z, y] as [number, number]), x0, x1);
  }
}

function area2(p: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!,
      b = p[(i + 1) % p.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}
