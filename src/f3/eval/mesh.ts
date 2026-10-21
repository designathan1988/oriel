// Closed meshes built by hand (with the source face on each triangle)
// to enter Manifold. Equal vertices are merged by position, so the
// solids come out closed (manifold) when the edges coincide. No three.
import earcut from 'earcut';
import type { Vec2, Vec3 } from '../model/schema';
import type { Kernel, Manifold } from '../kernel/kernel';

const Q = 1e5;

export class MeshBuilder {
  readonly pos: number[] = [];
  readonly tri: number[] = [];
  readonly face: number[] = [];
  /** Vertices by their rounded coordinates (x → y → z → index): numeric keys, no string per vertex. */
  private index = new Map<number, Map<number, Map<number, number>>>();

  vertex(p: Vec3): number {
    const kx = Math.round(p[0] * Q),
      ky = Math.round(p[1] * Q),
      kz = Math.round(p[2] * Q);
    let my = this.index.get(kx);
    if (!my) this.index.set(kx, (my = new Map()));
    let mz = my.get(ky);
    if (!mz) my.set(ky, (mz = new Map()));
    let i = mz.get(kz);
    if (i === undefined) {
      i = this.pos.length / 3;
      this.pos.push(p[0], p[1], p[2]);
      mz.set(kz, i);
    }
    return i;
  }

  /** Triangle with the given face, turned toward `want` (approximate desired normal). */
  triangle(a: Vec3, b: Vec3, c: Vec3, faceId: number, want?: Vec3): void {
    const ia = this.vertex(a),
      ib = this.vertex(b),
      ic = this.vertex(c);
    if (ia === ib || ib === ic || ia === ic) return;
    if (want) {
      const n = normal(a, b, c);
      if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
        this.tri.push(ia, ic, ib);
        this.face.push(faceId);
        return;
      }
    }
    this.tri.push(ia, ib, ic);
    this.face.push(faceId);
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, faceId: number, want: Vec3): void {
    this.triangle(a, b, c, faceId, want);
    this.triangle(a, c, d, faceId, want);
  }

  get empty(): boolean {
    return this.tri.length === 0;
  }

  /** Closed: every edge is shared by exactly two triangles (what Manifold accepts). */
  closed(): boolean {
    const n = this.pos.length / 3;
    const count = new Map<number, number>();
    for (let t = 0; t < this.tri.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = this.tri[t + k]!,
          b = this.tri[t + ((k + 1) % 3)]!;
        const key = a < b ? a * n + b : b * n + a;
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    for (const c of count.values()) if (c !== 2) return false;
    return true;
  }

  /** Adds another mesh (a separate component: the two must not touch, or their vertices would merge). */
  append(o: MeshBuilder): void {
    const map: number[] = [];
    for (let i = 0; i < o.pos.length; i += 3) map.push(this.vertex([o.pos[i]!, o.pos[i + 1]!, o.pos[i + 2]!]));
    for (let t = 0; t < o.tri.length; t++) this.tri.push(map[o.tri[t]!]!);
    this.face.push(...o.face);
  }

  /** Bounding box [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds(): number[] {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i + k]!;
        if (v < b[k]!) b[k] = v;
        if (v > b[k + 3]!) b[k + 3] = v;
      }
    return b;
  }

  toManifold(k: Kernel): Manifold {
    const mesh = new k.Mesh({
      numProp: 3,
      vertProperties: new Float32Array(this.pos),
      triVerts: new Uint32Array(this.tri),
      faceID: new Uint32Array(this.face),
    });
    return k.Manifold.ofMesh(mesh);
  }
}

export function normal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  const n: Vec3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Triangulation of a polygon with holes and inner points (earcut accepts one-point holes). */
export function triangulatePlan(outer: Vec2[], holes: Vec2[][], steiner: Vec2[] = []): { pts: Vec2[]; tris: number[] } {
  const pts: Vec2[] = [...outer];
  const holeIdx: number[] = [];
  for (const h of holes) {
    holeIdx.push(pts.length);
    pts.push(...h);
  }
  for (const s of steiner) {
    holeIdx.push(pts.length);
    pts.push(s);
  }
  const flat: number[] = [];
  for (const p of pts) flat.push(p[0], p[1]);
  return { pts, tris: earcut(flat, holeIdx) };
}

export interface PrismFaces {
  top: (i: number) => number;
  bottom: number;
  /** Side between border points a and b (indices in the ring). */
  side: (ring: number, i: number) => number;
}

/**
 * Prism under a height surface: flat base at yBase, top at y = heights[i] (one
 * per triangulation point), vertical sides at the borders. Closed by
 * construction (the same triangulation on top and at the bottom).
 */
export function heightPrism(mb: MeshBuilder, outer: Vec2[], holes: Vec2[][], steiner: Vec2[], height: (p: Vec2, i: number) => number, yBase: number, faces: PrismFaces): void {
  const { pts, tris } = triangulatePlan(outer, holes, steiner);
  const hs = pts.map((p, i) => height(p, i));
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!,
      b = tris[t + 1]!,
      c = tris[t + 2]!;
    const pa = pts[a]!,
      pb = pts[b]!,
      pc = pts[c]!;
    mb.triangle([pa[0], hs[a]!, pa[1]], [pb[0], hs[b]!, pb[1]], [pc[0], hs[c]!, pc[1]], faces.top(t / 3), [0, 1, 0]);
    mb.triangle([pa[0], yBase, pa[1]], [pb[0], yBase, pb[1]], [pc[0], yBase, pc[1]], faces.bottom, [0, -1, 0]);
  }
  const rings = [outer, ...holes];
  let off = 0;
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = ring[i]!,
        b = ring[j]!;
      const ha = hs[off + i]!,
        hb = hs[off + j]!;
      const dx = b[0] - a[0],
        dz = b[1] - a[1];
      // Normal out of the material: to the right of the ring direction (counterclockwise outer, clockwise holes).
      const want: Vec3 = [dz, 0, -dx];
      mb.quad([a[0], yBase, a[1]], [b[0], yBase, b[1]], [b[0], hb, b[1]], [a[0], ha, a[1]], faces.side(r, i), want);
    }
    off += ring.length;
  });
}

/** Closed prism: a profile on the local xy plane extruded from z0 to z1, carried by the matrix (cut openings). */
export function prismMesh(mb: MeshBuilder, profile: Vec2[], z0: number, z1: number, m: number[], faceId: number): void {
  const P = (x: number, y: number, z: number): Vec3 => [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
  let area = 0;
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i]!,
      b = profile[(i + 1) % profile.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ring = area > 0 ? profile : [...profile].reverse();
  const flat: number[] = [];
  for (const p of ring) flat.push(p[0], p[1]);
  const tri = earcut(flat);
  // Normals in the local frame (the matrix is a rotation + translation).
  const n = (x: number, y: number, z: number): Vec3 => [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
  for (let t = 0; t < tri.length; t += 3) {
    const a = ring[tri[t]!]!,
      b = ring[tri[t + 1]!]!,
      c = ring[tri[t + 2]!]!;
    mb.triangle(P(a[0], a[1], z1), P(b[0], b[1], z1), P(c[0], c[1], z1), faceId, n(0, 0, 1));
    mb.triangle(P(a[0], a[1], z0), P(b[0], b[1], z0), P(c[0], c[1], z0), faceId, n(0, 0, -1));
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    mb.quad(P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1), faceId, n(b[1] - a[1], -(b[0] - a[0]), 0));
  }
}
