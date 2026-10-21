// Rooms behind the windows of one facade row as one closed mesh, with no boolean.
// The rooms of neighboring windows overlap (each is up to the window + 1.8 m wide and
// 1.8 m deep, windows are ~3 m apart), so Manifold had to join them by booleans: a
// 20-floor tower spent 170 ms of 340 in that union. On a flat wall the rooms of a row
// share their plane, floor, ceiling and front, so their union is exact in 2D: along
// the wall, each stretch takes the depth of the deepest room over it (a skyline).
//
// The mesh is cut in vertical slabs at every x where anything changes (room edges,
// depth steps, the owner of a stretch, the vertices of the opening profiles). Each
// slab of the front face is a trapezoid above and below its opening; every face of a
// slab gets every vertex that lies on its vertical sides, and is fanned from its
// center, so the mesh is closed with no T-junction (a triangulator that drops
// collinear points, like earcut, left the back wall split where the floor was not).
// Each stretch belongs to the room whose opening is nearest (the middle of the gap
// between two openings), and its faces keep that room's IDs: night lights stay per
// room. Openings are convex profiles; a row that breaks that falls back to booleans.
// No three.
import type { Vec2, Vec3 } from '../model/schema';
import { MeshBuilder } from './mesh';

export interface RoomCut {
  /** Part frame (column-major 4×4): x along the wall, y up, z out of the wall. */
  frame: number[];
  /** Opening profile in the part frame (x, y), convex. */
  profile: Vec2[];
  hx: number;
  y0: number;
  y1: number;
  /** Back of the room and its front (2 mm inside the wall). */
  z0: number;
  z1: number;
  ids: { reveal: number; floor: number; ceil: number; wall: number };
}

const R = (x: number) => Math.round(x * 1e4);
const EPS = 1e-7;
/**
 * Every coordinate along the row on one grid (0.1 µm). The slab borders were rounded to it while the
 * openings kept their float noise (a window at s = 2.2 sat at -3.399999707…): the right side of an
 * opening fell outside its own range, its tunnel lost three sides, the mesh was open and Manifold
 * refused it — the wall stayed uncut behind the window frame.
 */
const snap = (x: number) => Math.round(x * 1e7) / 1e7;

/**
 * Groups rooms that can be joined in 2D: same wall plane and orientation, same floor, ceiling
 * and front. Returns the groups (index lists); a room alone is a group of one.
 */
export function roomRows(rooms: RoomCut[]): number[][] {
  const by = new Map<string, number[]>();
  rooms.forEach((r, i) => {
    const m = r.frame;
    const u = [m[0]!, m[1]!, m[2]!],
      v = [m[4]!, m[5]!, m[6]!],
      n = [m[8]!, m[9]!, m[10]!];
    const o = [m[12]!, m[13]!, m[14]!];
    const dv = o[0]! * v[0]! + o[1]! * v[1]! + o[2]! * v[2]!;
    const dn = o[0]! * n[0]! + o[1]! * n[1]! + o[2]! * n[2]!;
    const key = [...u, ...v, ...n].map((x) => Math.round(x * 1e6)).join(',') + `|${R(dn)}|${R(dv + r.y0)}|${R(dv + r.y1)}|${R(r.z1)}`;
    let l = by.get(key);
    if (!l) by.set(key, (l = []));
    l.push(i);
  });
  return [...by.values()];
}

/** Lower and upper chains of a convex profile as functions of x (null outside it). */
function chains(p: Vec2[]): { x0: number; x1: number; lo: (x: number) => number; hi: (x: number) => number; xs: number[] } {
  const xs = p.map((q) => q[0]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  const at = (x: number, pick: (a: number, b: number) => number) => {
    let best: number | null = null;
    for (let i = 0; i < p.length; i++) {
      const a = p[i]!,
        b = p[(i + 1) % p.length]!;
      const lo = Math.min(a[0], b[0]),
        hi = Math.max(a[0], b[0]);
      if (x < lo - EPS || x > hi + EPS) continue;
      const ys = Math.abs(b[0] - a[0]) < EPS ? [a[1], b[1]] : [a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
      for (const y of ys) best = best === null ? y : pick(best, y);
    }
    return best ?? 0;
  };
  return { x0, x1, lo: (x) => at(x, Math.min), hi: (x) => at(x, Math.max), xs };
}

function convex(p: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!,
      b = p[(i + 1) % p.length]!,
      c = p[(i + 2) % p.length]!;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-12) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

/**
 * Builds the rooms of a row (same plane, floor, ceiling and front: see roomRows) with their
 * openings, out to `zOut`. Returns false (nothing added) when it cannot: a profile that is not
 * convex, does not fit its room's front, or shares its stretch with another opening.
 */
export function roomRowMesh(mb: MeshBuilder, rooms: RoomCut[], zOut: number): boolean {
  const f = rooms[0]!.frame;
  const u = [f[0]!, f[1]!, f[2]!],
    v = [f[4]!, f[5]!, f[6]!];
  const O = [f[12]!, f[13]!, f[14]!];
  const Y0 = rooms[0]!.y0,
    Y1 = rooms[0]!.y1,
    z1 = rooms[0]!.z1;
  const items = rooms.map((r) => {
    const d = [r.frame[12]! - O[0]!, r.frame[13]! - O[1]!, r.frame[14]! - O[2]!];
    const dx = d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
    const dy = d[0]! * v[0]! + d[1]! * v[1]! + d[2]! * v[2]!;
    const profile = r.profile.map((p) => [snap(p[0] + dx), snap(p[1] + dy)] as Vec2);
    return { r, x0: snap(dx - r.hx), x1: snap(dx + r.hx), depth: r.z0, profile, ch: chains(profile) };
  });
  for (const it of items) {
    if (!convex(it.profile)) return false;
    if (!it.profile.every((q) => q[0] > it.x0 + 1e-3 && q[0] < it.x1 - 1e-3 && q[1] > Y0 + 1e-3 && q[1] < Y1 - 1e-3)) return false;
  }
  // Openings left to right must not share a stretch.
  const byX = [...items].sort((a, b) => a.ch.x0 - b.ch.x0);
  for (let i = 1; i < byX.length; i++) if (byX[i]!.ch.x0 < byX[i - 1]!.ch.x1 + 1e-3) return false;
  // Owner borders: the middle of the gap between neighboring openings.
  const cuts = byX.slice(1).map((it, i) => snap((byX[i]!.ch.x1 + it.ch.x0) / 2));
  const ownerOf = (x: number) => {
    let k = 0;
    while (k < cuts.length && x > cuts[k]!) k++;
    return items.indexOf(byX[k]!);
  };
  // Every x where something changes.
  const xs = [...new Set([...items.flatMap((it) => [it.x0, it.x1, ...it.ch.xs]), ...cuts])].sort((a, b) => a - b);
  type Slab = { a: number; b: number; depth: number; owner: number; hole: number };
  const slabs: Slab[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k]!,
      b = xs[k + 1]!;
    if (b - a < 1e-6) continue;
    const m = (a + b) / 2;
    let depth = Infinity;
    for (const it of items) if (it.x0 <= m && it.x1 >= m) depth = Math.min(depth, it.depth);
    if (depth === Infinity) continue;
    const hole = items.findIndex((it) => it.ch.x0 < m && it.ch.x1 > m);
    slabs.push({ a, b, depth, owner: ownerOf(m), hole });
  }
  if (!slabs.length) return false;
  // Neighboring slabs where nothing changes are one (fewer triangles to cut and to draw): same depth,
  // owner and opening, with the opening's edges straight across the joint.
  const straight = (h: number, a: number, m: number, b: number) => {
    const ch = items[h]!.ch;
    const t = (m - a) / (b - a);
    return Math.abs(ch.lo(m) - (ch.lo(a) + (ch.lo(b) - ch.lo(a)) * t)) < 1e-9 && Math.abs(ch.hi(m) - (ch.hi(a) + (ch.hi(b) - ch.hi(a)) * t)) < 1e-9;
  };
  for (let i = slabs.length - 1; i > 0; i--) {
    const p = slabs[i - 1]!,
      q = slabs[i]!;
    if (Math.abs(p.b - q.a) > 1e-9 || p.depth !== q.depth || p.owner !== q.owner || p.hole !== q.hole) continue;
    if (q.hole >= 0 && !straight(q.hole, p.a, q.a, q.b)) continue;
    p.b = q.b;
    slabs.splice(i, 1);
  }
  const P = (x: number, y: number, z: number): Vec3 => [f[0]! * x + f[4]! * y + f[8]! * z + f[12]!, f[1]! * x + f[5]! * y + f[9]! * z + f[13]!, f[2]! * x + f[6]! * y + f[10]! * z + f[14]!];
  const Nw = (x: number, y: number, z: number): Vec3 => [f[0]! * x + f[4]! * y + f[8]! * z, f[1]! * x + f[5]! * y + f[9]! * z, f[2]! * x + f[6]! * y + f[10]! * z];
  const ids = (i: number) => items[i]!.r.ids;
  // Points every face must have on a vertical line x (front: y values; floor and ceiling: z values).
  const frontPts = new Map<number, Set<number>>();
  const planPts = new Map<number, Set<number>>();
  const addPt = (m: Map<number, Set<number>>, x: number, y: number) => {
    const k = Math.round(x * 1e7);
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(Math.round(y * 1e7) / 1e7);
  };
  const ptsOn = (m: Map<number, Set<number>>, x: number, lo: number, hi: number) => [...(m.get(Math.round(x * 1e7)) ?? [])].filter((y) => y > lo + 1e-7 && y < hi - 1e-7);
  for (const s of slabs) {
    for (const x of [s.a, s.b]) {
      addPt(frontPts, x, Y0);
      addPt(frontPts, x, Y1);
      addPt(planPts, x, z1);
      addPt(planPts, x, s.depth);
      if (s.hole >= 0) {
        const ch = items[s.hole]!.ch;
        addPt(frontPts, x, ch.lo(x));
        addPt(frontPts, x, ch.hi(x));
      }
    }
  }
  /**
   * The region of a slab between a lower line y = lo(x) and an upper line hi(x), with every point
   * that lies on its two vertical sides, triangulated as a ladder between the left side and the
   * right side (each triangle has a vertex on each side: none is a sliver, no point is skipped).
   */
  const ladder = (m: Map<number, Set<number>>, a: number, b: number, lo: (x: number) => number, hi: (x: number) => number, to3: (p: Vec2) => Vec3, id: number, want: Vec3) => {
    const L: Vec2[] = [[a, lo(a)], ...ptsOn(m, a, lo(a), hi(a)).sort((p, q) => p - q).map((y) => [a, y] as Vec2), [a, hi(a)]];
    const Rr: Vec2[] = [[b, lo(b)], ...ptsOn(m, b, lo(b), hi(b)).sort((p, q) => p - q).map((y) => [b, y] as Vec2), [b, hi(b)]];
    let i = 0,
      j = 0;
    while (i < L.length - 1 || j < Rr.length - 1) {
      // Advance on the side whose next point is lower (a monotone merge of the two chains).
      const upL = i < L.length - 1 ? L[i + 1]![1] : Infinity,
        upR = j < Rr.length - 1 ? Rr[j + 1]![1] : Infinity;
      if (upL <= upR) {
        mb.triangle(to3(L[i]!), to3(Rr[j]!), to3(L[i + 1]!), id, want);
        i++;
      } else {
        mb.triangle(to3(L[i]!), to3(Rr[j]!), to3(Rr[j + 1]!), id, want);
        j++;
      }
    }
  };
  // Runs: neighboring slabs of one room at one depth.
  type Run = { a: number; b: number; depth: number; owner: number; slabs: Slab[]; hole: number };
  const runs: Run[] = [];
  for (let i = 0; i < slabs.length; ) {
    let k = i;
    while (k + 1 < slabs.length && Math.abs(slabs[k + 1]!.a - slabs[k]!.b) < 1e-9 && slabs[k + 1]!.owner === slabs[i]!.owner && slabs[k + 1]!.depth === slabs[i]!.depth) k++;
    const run = slabs.slice(i, k + 1);
    const holes = [...new Set(run.map((sl) => sl.hole).filter((h) => h >= 0))];
    runs.push({ a: run[0]!.a, b: run[run.length - 1]!.b, depth: run[0]!.depth, owner: run[0]!.owner, slabs: run, hole: holes.length === 1 ? holes[0]! : holes.length ? -2 : -1 });
    i = k + 1;
  }
  const sideFree = (r: Run) => !ptsOn(planPts, r.a, r.depth, z1).length && !ptsOn(planPts, r.b, r.depth, z1).length;
  // Each run's front as one frame around its opening (no vertex along its edges but its corners), when
  // every run holds its opening whole and meets no depth step; otherwise the slab ladders.
  const framed = runs.every((r) => r.hole !== -2 && sideFree(r) && (r.hole < 0 || (items[r.hole]!.ch.x0 > r.a + 1e-9 && items[r.hole]!.ch.x1 < r.b - 1e-9)));
  /** The opening boundary points the tunnel uses: at every slab border inside the opening. */
  const holeXs = (h: number) => {
    const ch = items[h]!.ch;
    return [...new Set(slabs.flatMap((sl) => [sl.a, sl.b]))].filter((x) => x >= ch.x0 - 1e-9 && x <= ch.x1 + 1e-9).sort((p, q) => p - q);
  };
  /**
   * A run's front, a rectangle with its convex opening, in four parts tied to its corners: left and
   * right of the opening, and below and above it, each fanned from the nearer bottom (or top) corner
   * to the opening's chain, split at the opening's middle (a corner sees the near half of a convex
   * chain from outside).
   */
  const frameFront = (r: Run, id: number) => {
    const want = Nw(0, 0, 1);
    const F = (p: Vec2) => P(p[0], p[1], z1);
    const BL: Vec2 = [r.a, Y0],
      BR: Vec2 = [r.b, Y0],
      TR: Vec2 = [r.b, Y1],
      TL: Vec2 = [r.a, Y1];
    if (r.hole < 0) return void mb.quad(F(BL), F(BR), F(TR), F(TL), id, want);
    const ch = items[r.hole]!.ch;
    const xsH = holeXs(r.hole);
    const lo = xsH.map((x) => [x, ch.lo(x)] as Vec2),
      hi = xsH.map((x) => [x, ch.hi(x)] as Vec2);
    const mid = (ch.x0 + ch.x1) / 2;
    const fan = (cL: Vec2, cR: Vec2, chain: Vec2[]) => {
      let m = 0;
      while (m + 1 < chain.length && chain[m + 1]![0] <= mid) m++;
      for (let j = 0; j < m; j++) mb.triangle(F(cL), F(chain[j]!), F(chain[j + 1]!), id, want);
      mb.triangle(F(cL), F(chain[m]!), F(cR), id, want);
      for (let j = m; j + 1 < chain.length; j++) mb.triangle(F(cR), F(chain[j]!), F(chain[j + 1]!), id, want);
    };
    fan(BL, BR, lo);
    fan(TL, TR, hi);
    // Left and right of the opening (a triangle when the opening has a single extreme point).
    mb.triangle(F(BL), F(lo[0]!), F(hi[0]!), id, want);
    mb.triangle(F(BL), F(hi[0]!), F(TL), id, want);
    mb.triangle(F(BR), F(TR), F(hi[hi.length - 1]!), id, want);
    mb.triangle(F(BR), F(hi[hi.length - 1]!), F(lo[lo.length - 1]!), id, want);
  };
  if (framed) for (const r of runs) frameFront(r, ids(r.owner).wall);
  else
    for (const s of slabs) {
      const id = ids(s.owner);
      // Front face (z = z1): below and above the opening, or whole.
      const front = (p: Vec2) => P(p[0], p[1], z1);
      if (s.hole >= 0) {
        const ch = items[s.hole]!.ch;
        ladder(frontPts, s.a, s.b, () => Y0, ch.lo, front, id.wall, Nw(0, 0, 1));
        ladder(frontPts, s.a, s.b, ch.hi, () => Y1, front, id.wall, Nw(0, 0, 1));
      } else ladder(frontPts, s.a, s.b, () => Y0, () => Y1, front, id.wall, Nw(0, 0, 1));
    }
  /**
   * Floor, ceiling and back wall by run (neighboring slabs of one room at one depth), not by slab:
   * those faces do not change where the front is split around an opening. A run's floor (and
   * ceiling) is a strip between its back edge (only its two corners) and its front edge (a vertex
   * wherever the front face has one), triangulated as a ladder along x: one triangle per front
   * vertex, no T-junction. By slab it took two per slab: a 20-floor tower had 5 120 floor triangles
   * (2 464 with the old boolean union), now one fewer per slab. A run whose side meets a depth step
   * (a vertex on that side) keeps the slab ladders.
   */
  const strip = (xsF: number[], depth: number, y: number, id: number, want: Vec3) => {
    const B: Vec3[] = [P(xsF[0]!, y, depth), P(xsF[xsF.length - 1]!, y, depth)];
    const F: Vec3[] = xsF.map((x) => P(x, y, z1));
    const bx = [xsF[0]!, xsF[xsF.length - 1]!];
    let i = 0,
      j = 0;
    while (i < B.length - 1 || j < F.length - 1) {
      const nb = i < B.length - 1 ? bx[i + 1]! : Infinity,
        nf = j < F.length - 1 ? xsF[j + 1]! : Infinity;
      if (nf <= nb) {
        mb.triangle(B[i]!, F[j]!, F[j + 1]!, id, want);
        j++;
      } else {
        mb.triangle(B[i]!, F[j]!, B[i + 1]!, id, want);
        i++;
      }
    }
  };
  for (const r of runs) {
    const run = r.slabs;
    const { a, b, depth } = r;
    const id = ids(r.owner);
    if (sideFree(r)) {
      // Framed fronts have no vertex along their bottom and top edges: the strip is two triangles.
      const xsF = framed ? [a, b] : [a, ...run.slice(1).map((sl) => sl.a), b];
      strip(xsF, depth, Y0, id.floor, Nw(0, -1, 0));
      strip(xsF, depth, Y1, id.ceil, Nw(0, 1, 0));
      mb.quad(P(a, Y0, depth), P(b, Y0, depth), P(b, Y1, depth), P(a, Y1, depth), id.wall, Nw(0, 0, -1));
    } else
      for (const sl of run) {
        // Floor and ceiling: (x, z) from the back of the slab to the front.
        ladder(planPts, sl.a, sl.b, () => sl.depth, () => z1, (p) => P(p[0], Y0, p[1]), id.floor, Nw(0, -1, 0));
        ladder(planPts, sl.a, sl.b, () => sl.depth, () => z1, (p) => P(p[0], Y1, p[1]), id.ceil, Nw(0, 1, 0));
        mb.quad(P(sl.a, Y0, sl.depth), P(sl.b, Y0, sl.depth), P(sl.b, Y1, sl.depth), P(sl.a, Y1, sl.depth), id.wall, Nw(0, 0, -1));
      }
  }
  // Side walls: at each end of a run (from the front to the back) and at each depth step (between depths).
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i]!,
      prev = slabs[i - 1],
      next = slabs[i + 1];
    const prevTouch = prev && Math.abs(prev.b - s.a) < 1e-9;
    const nextTouch = next && Math.abs(next.a - s.b) < 1e-9;
    const wall = (x: number, zA: number, zB: number, nx: number, id: number) => {
      if (Math.abs(zA - zB) < 1e-9) return;
      mb.quad(P(x, Y0, zA), P(x, Y0, zB), P(x, Y1, zB), P(x, Y1, zA), id, Nw(nx, 0, 0));
    };
    if (!prevTouch) wall(s.a, z1, s.depth, -1, ids(s.owner).wall);
    else if (s.depth < prev!.depth) wall(s.a, prev!.depth, s.depth, -1, ids(s.owner).wall);
    if (!nextTouch) wall(s.b, z1, s.depth, 1, ids(s.owner).wall);
    else if (s.depth < next!.depth) wall(s.b, next!.depth, s.depth, 1, ids(s.owner).wall);
  }
  // Tunnels from the front face out to zOut, split where the front is, and their caps (fanned).
  for (let h = 0; h < items.length; h++) {
    const it = items[h]!;
    const reveal = it.r.ids.reveal;
    const ch = it.ch;
    const xsIn = [...new Set(slabs.flatMap((sl) => [sl.a, sl.b]))].filter((x) => x >= ch.x0 - 1e-9 && x <= ch.x1 + 1e-9).sort((p, q) => p - q);
    // Boundary of the opening, counterclockwise: lower chain left to right, upper chain right to left.
    const ring: Vec2[] = [];
    for (const x of xsIn) {
      ring.push([x, ch.lo(x)]);
    }
    for (const x of [...xsIn].reverse()) ring.push([x, ch.hi(x)]);
    const clean: Vec2[] = [];
    for (const p of ring) {
      const q = clean[clean.length - 1];
      if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) clean.push(p);
    }
    if (clean.length > 1 && Math.abs(clean[0]![0] - clean[clean.length - 1]![0]) < 1e-9 && Math.abs(clean[0]![1] - clean[clean.length - 1]![1]) < 1e-9) clean.pop();
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i]!,
        b = clean[(i + 1) % clean.length]!;
      mb.quad(P(a[0], a[1], z1), P(b[0], b[1], z1), P(b[0], b[1], zOut), P(a[0], a[1], zOut), reveal, Nw(b[1] - a[1], -(b[0] - a[0]), 0));
    }
    // Cap: a quad (or triangle) per stretch between the lower and the upper chain.
    for (let i = 0; i + 1 < xsIn.length; i++) {
      const a = xsIn[i]!,
        b = xsIn[i + 1]!;
      if (b - a < 1e-9) continue;
      const q = [[a, ch.lo(a)], [b, ch.lo(b)], [b, ch.hi(b)], [a, ch.hi(a)]] as Vec2[];
      const to = (p: Vec2) => P(p[0], p[1], zOut);
      if (Math.abs(q[1]![1] - q[2]![1]) > 1e-9) mb.triangle(to(q[0]!), to(q[1]!), to(q[2]!), reveal, Nw(0, 0, 1));
      if (Math.abs(q[0]![1] - q[3]![1]) > 1e-9) mb.triangle(to(q[0]!), to(q[2]!), to(q[3]!), reveal, Nw(0, 0, 1));
    }
  }
  return true;
}
