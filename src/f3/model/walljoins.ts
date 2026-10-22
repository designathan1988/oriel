// Wall joins: the body of every drawn wall made from its centre line and thickness, mitred against the
// walls it meets. Ported from Pascal Editor's wall mitering (packages/core/src/systems/wall/wall-mitering.ts,
// https://github.com/pascalorg/editor, MIT License, Copyright (c) 2026 Pascal Group Inc.).
//
// The method: the ends of all walls are grouped into junctions (points where ends meet, plus the walls whose
// middle a junction lies on: a T or an X); at each junction the walls are sorted by the angle they leave it
// at, and each one's left face is met with the next one's right face. That one rule closes an L, a T, an X
// or any number of walls at any angle and with different thicknesses. A joint that would land far away (two
// walls almost in line) is dropped for a square end. No three.

import type { Vec2 } from './schema';

/** A wall for the joins: its centre line from a to b and half its thickness. */
export interface JoinWall {
  id: string;
  a: Vec2;
  b: Vec2;
  half: number;
}

/** The outline of a wall: its four corners and, where its faces do not meet in one straight end, the junction point. */
export interface WallOutline {
  /** Corners on the left and right of a → b at each end. */
  aL: Vec2;
  aR: Vec2;
  bL: Vec2;
  bR: Vec2;
  /** The junction point closing the end when the corners alone would leave a notch (an X, other thicknesses). */
  aC?: Vec2;
  bC?: Vec2;
}

/** Ends this close are the same point (m). */
const TOL = 0.02;
/** A mitre farther than this many half thicknesses from its junction becomes a square end. */
const MITER_LIMIT = 10;

interface Line {
  a: number;
  b: number;
  c: number;
}

const lineThrough = (p: Vec2, v: Vec2): Line => {
  const a = -v[1],
    b = v[0];
  return { a, b, c: -(a * p[0] + b * p[1]) };
};

interface Junction {
  at: Vec2;
  walls: { w: JoinWall; end: 'a' | 'b' | 'through' }[];
}

/** The junctions: ends that meet (within TOL) and the walls whose middle they lie on. */
function findJunctions(walls: JoinWall[]): Junction[] {
  const js: Junction[] = [];
  for (const w of walls)
    for (const end of ['a', 'b'] as const) {
      const p = w[end];
      let j = js.find((q) => Math.hypot(q.at[0] - p[0], q.at[1] - p[1]) < TOL);
      if (!j) js.push((j = { at: [p[0], p[1]], walls: [] }));
      j.walls.push({ w, end });
    }
  for (const j of js)
    for (const w of walls) {
      if (j.walls.some((c) => c.w === w)) continue;
      const v: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
      const L2 = v[0] * v[0] + v[1] * v[1];
      if (L2 < 1e-12) continue;
      const t = ((j.at[0] - w.a[0]) * v[0] + (j.at[1] - w.a[1]) * v[1]) / L2;
      const L = Math.sqrt(L2);
      if (t * L < TOL || (1 - t) * L < TOL) continue;
      const q: Vec2 = [w.a[0] + v[0] * t, w.a[1] + v[1] * t];
      if (Math.hypot(q[0] - j.at[0], q[1] - j.at[1]) < TOL) j.walls.push({ w, end: 'through' });
    }
  return js.filter((j) => j.walls.length >= 2);
}

interface Edge {
  id: string;
  angle: number;
  left: Line;
  right: Line;
  half: number;
  through: boolean;
}

/** Corners at one junction: for each wall ending there, where its left and right faces meet the neighbours. */
function junctionCorners(j: Junction): Map<string, { left?: Vec2; right?: Vec2 }> {
  const edges: Edge[] = [];
  const add = (w: JoinWall, v: Vec2, through: boolean) => {
    const L = Math.hypot(v[0], v[1]);
    if (L < 1e-9) return;
    const n: Vec2 = [-v[1] / L, v[0] / L];
    const pl: Vec2 = [j.at[0] + n[0] * w.half, j.at[1] + n[1] * w.half];
    const pr: Vec2 = [j.at[0] - n[0] * w.half, j.at[1] - n[1] * w.half];
    edges.push({ id: w.id, angle: Math.atan2(v[1], v[0]), left: lineThrough(pl, v), right: lineThrough(pr, v), half: w.half, through });
  };
  for (const { w, end } of j.walls) {
    const v: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    if (end === 'through') {
      // A wall passing through: both of its directions, so the walls ending on it meet its faces.
      add(w, v, true);
      add(w, [-v[0], -v[1]], true);
    } else add(w, end === 'a' ? v : [-v[0], -v[1]], false);
  }
  edges.sort((p, q) => p.angle - q.angle || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const out = new Map<string, { left?: Vec2; right?: Vec2 }>();
  const n = edges.length;
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const e1 = edges[i]!,
      e2 = edges[(i + 1) % n]!;
    const det = e1.left.a * e2.right.b - e2.right.a * e1.left.b;
    if (Math.abs(det) < 1e-9) continue;
    const p: Vec2 = [(e1.left.b * e2.right.c - e2.right.b * e1.left.c) / det, (e2.right.a * e1.left.c - e1.left.a * e2.right.c) / det];
    const lim = MITER_LIMIT * Math.max(e1.half, e2.half);
    if (!(Number.isFinite(p[0]) && Number.isFinite(p[1])) || Math.hypot(p[0] - j.at[0], p[1] - j.at[1]) > lim) continue;
    if (!e1.through) (out.get(e1.id) ?? out.set(e1.id, {}).get(e1.id)!).left = p;
    if (!e2.through) (out.get(e2.id) ?? out.set(e2.id, {}).get(e2.id)!).right = p;
  }
  return out;
}

/**
 * The outlines of all the walls, joined. A free end is square at its point (Revit: the wall ends where its
 * line ends); an end on another wall's middle stops at that wall's face.
 */
export function joinOutlines(walls: JoinWall[]): Map<string, WallOutline> {
  const js = findJunctions(walls);
  const at = new Map<string, { j: Junction; c: { left?: Vec2; right?: Vec2 } }>();
  for (const j of js) {
    const cs = junctionCorners(j);
    for (const { w, end } of j.walls) if (end !== 'through' && cs.has(w.id)) at.set(`${w.id}|${end}`, { j, c: cs.get(w.id)! });
  }
  const out = new Map<string, WallOutline>();
  for (const w of walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 1e-9) continue;
    const n: Vec2 = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L];
    const off = (p: Vec2, s: number): Vec2 => [p[0] + n[0] * w.half * s, p[1] + n[1] * w.half * s];
    const A = at.get(`${w.id}|a`),
      B = at.get(`${w.id}|b`);
    // Seen from the junction, "left" is the left of the direction leaving it: at a that is a → b's left,
    // at b it is a → b's right.
    const o: WallOutline = {
      aL: A?.c.left ?? off(w.a, 1),
      aR: A?.c.right ?? off(w.a, -1),
      bL: B?.c.right ?? off(w.b, 1),
      bR: B?.c.left ?? off(w.b, -1),
    };
    // The junction point closes an end whose corners do not make one straight cut through it (an X, walls of
    // other thicknesses); never at a T (the end stops flat on the wall it meets).
    const notch = (J: typeof A, l: Vec2, r: Vec2): Vec2 | undefined => {
      if (!J || J.j.walls.some((c) => c.end === 'through')) return undefined;
      const p = J.j.at;
      const d = Math.hypot(r[0] - l[0], r[1] - l[1]);
      if (d < 1e-9) return undefined;
      const off = Math.abs((p[0] - l[0]) * (r[1] - l[1]) - (p[1] - l[1]) * (r[0] - l[0])) / d;
      return off > 1e-3 ? [p[0], p[1]] : undefined;
    };
    const aC = notch(A, o.aL, o.aR),
      bC = notch(B, o.bL, o.bR);
    if (aC) o.aC = aC;
    if (bC) o.bC = bC;
    out.set(w.id, o);
  }
  return out;
}

/**
 * The room the walls close around a point (Revit's room-bounding walls; the method of planar-dual and
 * planar-face-discovery): the centre lines are split where they meet or cross (a T, an X), the faces of that
 * planar graph are walked, and the smallest one around the point is the room, its sides moved in by half
 * the thickness of each wall (the room ends at the wall faces). Null when no walls close around it.
 */
export function enclosureAt(walls: JoinWall[], at: Vec2): { polygon: Vec2[]; wallIds: string[] } | null {
  // Points along each wall where it is split: its ends, other walls' ends on it, crossings.
  const cuts = new Map<string, Vec2[]>(walls.map((w) => [w.id, [w.a, w.b]]));
  const onSeg = (w: JoinWall, p: Vec2) => {
    const v: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const L2 = v[0] * v[0] + v[1] * v[1];
    if (L2 < 1e-12) return false;
    const t = ((p[0] - w.a[0]) * v[0] + (p[1] - w.a[1]) * v[1]) / L2;
    if (t <= 0 || t >= 1) return false;
    return Math.hypot(w.a[0] + v[0] * t - p[0], w.a[1] + v[1] * t - p[1]) < TOL;
  };
  for (const w of walls)
    for (const o of walls) {
      if (o === w) continue;
      for (const p of [o.a, o.b]) if (onSeg(w, p)) cuts.get(w.id)!.push(p);
      // A proper crossing of the two lines.
      const r: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]],
        s: Vec2 = [o.b[0] - o.a[0], o.b[1] - o.a[1]];
      const den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-9) continue;
      const t = ((o.a[0] - w.a[0]) * s[1] - (o.a[1] - w.a[1]) * s[0]) / den,
        u = ((o.a[0] - w.a[0]) * r[1] - (o.a[1] - w.a[1]) * r[0]) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) cuts.get(w.id)!.push([w.a[0] + r[0] * t, w.a[1] + r[1] * t]);
    }
  // Nodes (points within TOL are one) and the pieces between them.
  const nodes: Vec2[] = [];
  const node = (p: Vec2) => {
    const i = nodes.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < TOL);
    return i >= 0 ? i : nodes.push([p[0], p[1]]) - 1;
  };
  const adj = new Map<number, { to: number; wall: JoinWall; ang: number }[]>();
  for (const w of walls) {
    const v: Vec2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
    const L2 = v[0] * v[0] + v[1] * v[1] || 1;
    const ts = cuts.get(w.id)!.map((p) => ({ t: ((p[0] - w.a[0]) * v[0] + (p[1] - w.a[1]) * v[1]) / L2, n: node(p) })).sort((p, q) => p.t - q.t);
    for (let i = 0; i + 1 < ts.length; i++) {
      const u = ts[i]!.n,
        x = ts[i + 1]!.n;
      if (u === x || adj.get(u)?.some((e) => e.to === x)) continue;
      const pu = nodes[u]!,
        px = nodes[x]!;
      (adj.get(u) ?? adj.set(u, []).get(u)!).push({ to: x, wall: w, ang: Math.atan2(px[1] - pu[1], px[0] - pu[0]) });
      (adj.get(x) ?? adj.set(x, []).get(x)!).push({ to: u, wall: w, ang: Math.atan2(pu[1] - px[1], pu[0] - px[0]) });
    }
  }
  for (const l of adj.values()) l.sort((p, q) => p.ang - q.ang);
  const area2 = (P: Vec2[]) => P.reduce((s, p, i) => s + p[0] * P[(i + 1) % P.length]![1] - P[(i + 1) % P.length]![0] * p[1], 0) / 2;
  const inPoly = (p: Vec2, P: Vec2[]) => {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const a = P[i]!,
        b = P[j]!;
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  // Walk every face: arrive at a node, leave by the edge just before the way back (the next one clockwise).
  const seen = new Set<string>();
  let best: { poly: number[]; ws: JoinWall[]; area: number } | null = null;
  for (const [from, list] of adj)
    for (const e0 of list) {
      if (seen.has(`${from}>${e0.to}`)) continue;
      const poly: number[] = [];
      const ws: JoinWall[] = [];
      let u = from,
        e = e0,
        ok = false;
      for (let step = 0; step < 1000; step++) {
        seen.add(`${u}>${e.to}`);
        poly.push(u);
        ws.push(e.wall);
        const v = e.to;
        const out = adj.get(v)!;
        const back = out.findIndex((q) => q.to === u);
        u = v;
        e = out[(back - 1 + out.length) % out.length]!;
        if (u === from && e.to === e0.to) {
          ok = true;
          break;
        }
      }
      if (!ok || poly.length < 3) continue;
      const P = poly.map((i) => nodes[i]!);
      const A = area2(P);
      if (A <= 1e-6 || !inPoly(at, P)) continue;
      if (!best || A < best.area) best = { poly, ws, area: A };
    }
  if (!best) return null;
  // Each side moved in by half its wall's thickness; corners where the moved sides meet.
  const P = best.poly.map((i) => nodes[i]!);
  const n = P.length;
  const lines = P.map((p, i) => {
    const q = P[(i + 1) % n]!;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const d: Vec2 = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    // Inward for a positive-area ring: the left of each side.
    const nIn: Vec2 = [-d[1], d[0]];
    const h = best!.ws[i]!.half;
    return { p: [p[0] + nIn[0] * h, p[1] + nIn[1] * h] as Vec2, d, nIn, h };
  });
  const polygon: Vec2[] = P.map((p, i) => {
    const l0 = lines[(i - 1 + n) % n]!,
      l1 = lines[i]!;
    const den = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0];
    if (Math.abs(den) < 1e-9) return [p[0] + l1.nIn[0] * l1.h, p[1] + l1.nIn[1] * l1.h];
    const t = ((l1.p[0] - l0.p[0]) * l1.d[1] - (l1.p[1] - l0.p[1]) * l1.d[0]) / den;
    return [l0.p[0] + l0.d[0] * t, l0.p[1] + l0.d[1] * t];
  });
  if (area2(polygon) <= 1e-6) return null;
  return { polygon, wallIds: [...new Set(best.ws.map((w) => w.id))] };
}
