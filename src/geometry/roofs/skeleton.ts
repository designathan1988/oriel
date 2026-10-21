// Weighted straight skeleton by wavefront simulation,
// in the spirit of Felkel & Obdržálek (1998). Our own implementation.
//
// Each edge moves inward with speed equal to its weight (0 = stationary
// edge, used for gables). Vertices travel along the bisectors; events:
//  - edge: two neighboring vertices meet and the edge between them vanishes;
//  - split: a reflex vertex touches a non-neighboring edge and the front splits.
// Output: one face per original edge, as a 3D polygon (x, z, t), where t is the
// time (the height is a function of t chosen by the roof kind).
import type { Vec2 } from '../../core/schema';
import { signedArea } from '../polygon';

export type P3 = [number, number, number];

export interface SkeletonFace {
  /** Original edge index (in order: outer ring, then holes). */
  edge: number;
  /** Face outline: [x, z, t]. */
  points: P3[];
  weight: number;
}

export interface SkeletonResult {
  faces: SkeletonFace[];
  /** Internal skeleton arcs (ridges and hips). */
  arcs: [P3, P3][];
  maxTime: number;
}

interface Edge {
  a: Vec2;
  b: Vec2;
  d: Vec2;
  n: Vec2;
  c: number;
  w: number;
}

interface Node {
  id: number;
  p: Vec2;
  t: number;
}

interface Vtx {
  id: number;
  p: Vec2;
  t: number;
  v: Vec2;
  L: number;
  R: number;
  prev: Vtx;
  next: Vtx;
  active: boolean;
  /** Stationary vertex (opposite parallel edges): only ends when the loop closes. */
  stuck: boolean;
  origin: Node;
}

interface Arc {
  a: Node;
  b: Node;
  L: number;
  R: number;
}

type Ev = { t: number; kind: 0; a: Vtx; b: Vtx } | { t: number; kind: 1; r: Vtx; e: number };

/** Min priority queue by time (edge events before split events on ties). */
class Heap {
  private h: Ev[] = [];
  get size() {
    return this.h.length;
  }
  private less(i: number, j: number) {
    const a = this.h[i]!,
      b = this.h[j]!;
    return a.t < b.t - 1e-12 || (Math.abs(a.t - b.t) <= 1e-12 && a.kind < b.kind);
  }
  push(e: Ev) {
    const h = this.h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): Ev | undefined {
    const h = this.h;
    if (!h.length) return undefined;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < h.length && this.less(l, m)) m = l;
        if (r < h.length && this.less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const crossV = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

export class SkeletonError extends Error {}

/**
 * Weighted straight skeleton of a polygon with holes.
 * outer: counterclockwise; holes: any orientation. weights: one per edge
 * (in outer + holes order), default 1.
 */
export function straightSkeleton(outer: Vec2[], holes: Vec2[][] = [], weights?: number[]): SkeletonResult {
  const rings = [signedArea(outer) >= 0 ? outer : [...outer].reverse(), ...holes.map((h) => (signedArea(h) <= 0 ? h : [...h].reverse()))];
  const edges: Edge[] = [];
  const ringStart: number[] = [];
  for (const ring of rings) {
    ringStart.push(edges.length);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        b = ring[(i + 1) % ring.length]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-9) throw new SkeletonError('Degenerate edge.');
      const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      const n: Vec2 = [-d[1], d[0]];
      const w = weights?.[edges.length] ?? 1;
      edges.push({ a, b, d, n, c: dot(n, a), w });
    }
  }
  const scale = Math.max(1, ...rings.flat().map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))));
  const tol = 1e-7 * scale;

  const nodes: Node[] = [];
  const nodeAt = (p: Vec2, t: number): Node => {
    for (const n of nodes) if (Math.abs(n.p[0] - p[0]) < tol * 10 && Math.abs(n.p[1] - p[1]) < tol * 10 && Math.abs(n.t - t) < tol * 10) return n;
    const n = { id: nodes.length, p: [p[0], p[1]] as Vec2, t };
    nodes.push(n);
    return n;
  };
  const arcs: Arc[] = [];
  let vid = 0;

  /** Vertex velocity between edges L and R. */
  const velocity = (L: number, R: number): Vec2 | null => {
    const nl = edges[L]!.n,
      nr = edges[R]!.n,
      wl = edges[L]!.w,
      wr = edges[R]!.w;
    const det = crossV(nl, nr);
    if (Math.abs(det) < 1e-12) {
      // Parallel: the same direction moves together; opposite, the vertex stays put.
      if (dot(nl, nr) > 0 && Math.abs(wl - wr) < 1e-12) return [nl[0] * wl, nl[1] * wl];
      return null;
    }
    return [(wl * nr[1] - wr * nl[1]) / det, (nl[0] * wr - nr[0] * wl) / det];
  };
  const pos = (v: Vtx, t: number): Vec2 => [v.p[0] + v.v[0] * (t - v.t), v.p[1] + v.v[1] * (t - v.t)];
  const isReflex = (v: Vtx) => crossV(edges[v.L]!.d, edges[v.R]!.d) < -1e-12;

  const heap = new Heap();
  let now = 0;

  const makeVtx = (p: Vec2, t: number, L: number, R: number, origin: Node): Vtx => {
    const vel = velocity(L, R);
    const v = { id: vid++, p, t, v: vel ?? [0, 0], L, R, active: true, stuck: !vel, origin } as Vtx;
    return v;
  };

  const edgeEvent = (a: Vtx, b: Vtx) => {
    if (a.stuck || b.stuck || a.R !== b.L) return;
    const d = edges[a.R]!.d;
    const den = dot(d, a.v) - dot(d, b.v);
    if (den <= 1e-12) return;
    const t = (dot(d, b.p) - dot(d, b.v) * b.t - dot(d, a.p) + dot(d, a.v) * a.t) / den;
    if (t < now - tol) return;
    heap.push({ t: Math.max(t, now), kind: 0, a, b });
  };

  const splitEvents = (r: Vtx) => {
    if (r.stuck || !isReflex(r)) return;
    for (let e = 0; e < edges.length; e++) {
      if (e === r.L || e === r.R) continue;
      const E = edges[e]!;
      const f0 = dot(E.n, r.p) - E.c - E.w * r.t;
      const rate = E.w - dot(E.n, r.v);
      if (f0 < -tol || rate <= 1e-12) continue;
      const t = r.t + f0 / rate;
      if (t < now - tol) continue;
      heap.push({ t, kind: 1, r, e });
    }
  };

  const schedule = (v: Vtx) => {
    edgeEvent(v.prev, v);
    edgeEvent(v, v.next);
    splitEvents(v);
  };

  // Initial loops.
  const all: Vtx[] = [];
  rings.forEach((ring, k) => {
    const s = ringStart[k]!,
      n = ring.length;
    const vs: Vtx[] = [];
    for (let i = 0; i < n; i++) {
      const L = s + ((i - 1 + n) % n),
        R = s + i;
      vs.push(makeVtx(ring[i]!, 0, L, R, nodeAt(ring[i]!, 0)));
    }
    vs.forEach((v, i) => {
      v.prev = vs[(i - 1 + n) % n]!;
      v.next = vs[(i + 1) % n]!;
    });
    all.push(...vs);
  });
  for (const v of all) {
    if (v.stuck) throw new SkeletonError('Initial vertex without a bisector.');
    schedule(v);
  }

  const terminate = (v: Vtx, at: Node) => {
    v.active = false;
    if (v.origin.id !== at.id) arcs.push({ a: v.origin, b: at, L: v.L, R: v.R });
  };

  /** Loop with up to 2 vertices: ends both and links the end points (ridge). */
  const closeIfSmall = (v: Vtx, t: number): boolean => {
    if (!v.active) return true;
    if (v.next === v) {
      terminate(v, nodeAt(pos(v, t), t));
      return true;
    }
    if (v.next.next === v) {
      const x = v,
        y = v.next;
      const nx = nodeAt(x.stuck ? x.p : pos(x, t), t),
        ny = nodeAt(y.stuck ? y.p : pos(y, t), t);
      terminate(x, nx);
      terminate(y, ny);
      if (nx.id !== ny.id) arcs.push({ a: nx, b: ny, L: x.L, R: x.R });
      return true;
    }
    return false;
  };

  /**
   * Puts a new vertex into play. If its edges are opposite and parallel, the
   * two fronts have just overlapped: the shared band becomes a ridge and the
   * loop "zips up" to the nearest neighbor, repeating if needed.
   */
  const settle = (c: Vtx, t: number) => {
    for (let k = 0; ; k++) {
      if (k > 10000) throw new SkeletonError('Zipper did not finish.');
      if (!c.active || closeIfSmall(c, t)) return;
      if (!c.stuck) {
        schedule(c);
        return;
      }
      if (dot(edges[c.L]!.n, edges[c.R]!.n) > 0) throw new SkeletonError('Parallel edges with different weights.');
      const p = c.prev,
        n = c.next;
      const Pp = pos(p, t),
        Pn = pos(n, t);
      const sp = Math.hypot(Pp[0] - c.p[0], Pp[1] - c.p[1]),
        sn = Math.hypot(Pn[0] - c.p[0], Pn[1] - c.p[1]);
      c.active = false;
      const ridge = (M: Node) => {
        if (M.id !== c.origin.id) arcs.push({ a: c.origin, b: M, L: c.L, R: c.R });
      };
      let m: Vtx;
      if (Math.abs(sp - sn) < tol * 100) {
        const M = nodeAt(Pp, t);
        ridge(M);
        terminate(p, M);
        terminate(n, M);
        if (p.prev === n) return; // the whole loop closed at this point
        m = makeVtx(M.p, t, p.L, n.R, M);
        m.prev = p.prev;
        m.next = n.next;
      } else if (sp < sn) {
        const M = nodeAt(Pp, t);
        ridge(M);
        terminate(p, M);
        m = makeVtx(M.p, t, p.L, c.R, M);
        m.prev = p.prev;
        m.next = n;
      } else {
        const M = nodeAt(Pn, t);
        ridge(M);
        terminate(n, M);
        m = makeVtx(M.p, t, c.L, n.R, M);
        m.prev = p;
        m.next = n.next;
      }
      m.prev.next = m;
      m.next.prev = m;
      all.push(m);
      c = m;
    }
  };

  // A limit of events, not of clock time: the same outline always succeeds or always fails (before, 250 ms
  // of wall clock decided, so a roof could fail on a slow frame and pass on a fast one). A real outline
  // needs a few events per edge; the limit allows hundreds per edge.
  let guard = 0;
  const maxIter = Math.min(200000, 4000 + 400 * edges.length);
  while (heap.size) {
    if (++guard > maxIter) throw new SkeletonError('The skeleton did not converge.');
    const ev = heap.pop()!;
    if (ev.kind === 0) {
      const { a, b } = ev;
      if (!a.active || !b.active || a.next !== b) continue;
      now = ev.t;
      const P = pos(a, ev.t);
      const N = nodeAt(P, ev.t);
      terminate(a, N);
      terminate(b, N);
      if (a.prev === b) continue; // 2-loop already closed
      const c = makeVtx(P, ev.t, a.L, b.R, N);
      c.prev = a.prev;
      c.next = b.next;
      a.prev.next = c;
      b.next.prev = c;
      all.push(c);
      settle(c, ev.t);
    } else {
      const { r, e } = ev;
      if (!r.active) continue;
      const t = ev.t;
      const P = pos(r, t);
      // Active span of the edge that contains the point.
      let u: Vtx | null = null;
      for (const cand of all) {
        if (!cand.active || cand.R !== e || cand === r || cand.next === r) continue;
        const w = cand.next;
        if (!w.active) continue;
        const A = cand.stuck ? cand.p : pos(cand, t),
          B = w.stuck ? w.p : pos(w, t);
        const d = edges[e]!.d;
        const s = dot(d, [P[0] - A[0], P[1] - A[1]]),
          len = dot(d, [B[0] - A[0], B[1] - A[1]]);
        const off = Math.abs(dot(edges[e]!.n, [P[0] - A[0], P[1] - A[1]]));
        if (off < tol * 1e3 && s > -tol * 10 && s < len + tol * 10) {
          u = cand;
          break;
        }
      }
      if (!u) continue;
      now = t;
      const w = u.next;
      const N = nodeAt(P, t);
      terminate(r, N);
      const c1 = makeVtx(P, t, r.L, e, N);
      const c2 = makeVtx(P, t, e, r.R, N);
      const rp = r.prev,
        rn = r.next;
      // ... rp → c1 → w ...   e   ... u → c2 → rn ...
      rp.next = c1;
      c1.prev = rp;
      c1.next = w;
      w.prev = c1;
      u.next = c2;
      c2.prev = u;
      c2.next = rn;
      rn.prev = c2;
      all.push(c1, c2);
      settle(c1, t);
      settle(c2, t);
    }
  }
  for (const v of all) if (v.active) throw new SkeletonError('The wavefront did not close.');

  // Builds each edge's face: the original edge + the arcs bounding it.
  const faces: SkeletonFace[] = [];
  edges.forEach((E, ei) => {
    const segs = arcs.filter((a) => a.L === ei || a.R === ei);
    const start = nodeAt(E.a, 0),
      end = nodeAt(E.b, 0);
    const used = new Set<number>();
    const loop: Node[] = [start, end];
    let cur = end;
    for (let k = 0; k <= segs.length; k++) {
      if (cur.id === start.id) break;
      const i = segs.findIndex((s, j) => !used.has(j) && (s.a.id === cur.id || s.b.id === cur.id));
      if (i < 0) throw new SkeletonError('Open face at edge ' + ei + '.');
      used.add(i);
      const s = segs[i]!;
      cur = s.a.id === cur.id ? s.b : s.a;
      if (cur.id !== start.id) loop.push(cur);
    }
    if (cur.id !== start.id) throw new SkeletonError('Face does not close at edge ' + ei + '.');
    faces.push({ edge: ei, weight: E.w, points: loop.map((n) => [n.p[0], n.p[1], n.t]) });
  });
  // Check: every face point lies on its edge's plane (n·p − c = w·t).
  for (const f of faces) {
    const E = edges[f.edge]!;
    for (const q of f.points) if (Math.abs(dot(E.n, [q[0], q[1]]) - E.c - E.w * q[2]) > tol * 1e3) throw new SkeletonError('Face off the plane at edge ' + f.edge + '.');
  }
  const maxTime = Math.max(0, ...nodes.map((n) => n.t));
  // Check: the faces of the moving edges cover the polygon area.
  const area = rings.reduce((s, r, k) => s + (k === 0 ? 1 : -1) * Math.abs(signedArea(r)), 0);
  const covered = faces.reduce((s, f) => s + Math.abs(signedArea(f.points.map((p) => [p[0], p[1]] as Vec2))), 0);
  if (Math.abs(covered - area) > Math.max(1e-6, area * 1e-4)) throw new SkeletonError(`Faces do not cover the base (${covered.toFixed(4)} of ${area.toFixed(4)}).`);
  const p3 = (n: Node): P3 => [n.p[0], n.p[1], n.t];
  return { faces, maxTime, arcs: arcs.map((a) => [p3(a.a), p3(a.b)]) };
}
