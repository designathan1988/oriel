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
