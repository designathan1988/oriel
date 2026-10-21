// Types and helpers of the editor shared by its modules (editor.ts and the modules split from it).
import * as THREE from 'three';
import type { Building3, ID, Solid, Vec2, Vec3 } from '../model/schema';
import { removeVertex, splitEdge } from '../model/ops';
import { decimal } from '../ui/i18n';
import { keyParts } from '../model/levelpick';
import type { View } from './view';
import { evalExpr } from '../model/expr';
import type { FaceInfo } from '../eval/faces';
import type { Editor3 } from './editor';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'push' | 'extrude' | 'cut' | 'opening' | 'iwall' | 'room' | 'walls' | 'slab' | 'column' | 'beam' | 'stair' | 'lot' | 'street' | 'terrain' | 'axis' | 'mirror' | 'rect' | 'arc' | 'circle' | 'polygon' | 'spline' | 'place' | 'paint' | 'block' | 'tape';

export interface Selection {
  building: ID | null;
  solids: ID[];
  /** Selected face of the first solid: side (edge) or top. */
  /** Side, top, or the plinth / parapet (with its coping) of the volume. */
  face: { kind: 'side' | 'top' | 'plinth' | 'parapet'; edge?: ID } | null;
  item: ID | null;
  /** Selected facade elements (keys from elements.ts). */
  elems: string[];
  /** Other buildings selected together (Shift+click). */
  others: ID[];
  /** Corner (plan vertex) selected on the first solid. */
  vertex?: ID | null;
  /** Vertex mode: corners of the first solid (`vertex` is the first of them). */
  verts?: ID[];
  /** Edge mode: sides of the first solid. */
  edges?: ID[];
}

/** Modifiers of a gesture (click or box). */
export type Mods = { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean };

export interface Measure {
  label: string;
  apply(text: string): boolean;
}

/** Last operation panel parameter: a number (with unit) or a choice. */
export interface OpParam {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  step?: number;
  options?: [string, string][];
}

export interface LastOp {
  label: string;
  params: OpParam[];
  values: Record<string, number | string>;
  run: (v: Record<string, number | string>) => boolean;
  sel: Selection;
  ctx: ID | null;
  /** History step right after applying (another recording ends the adjustment). */
  seq: number;
}

export interface Drag {
  kind: string;
  /** Affected building. */
  bid: ID;
  start: { x: number; y: number };
  moved: boolean;
  origBuilding: Building3;
  data: Record<string, unknown>;
  geometry: boolean;
}

export const rad = (d: number) => (d * Math.PI) / 180;
export const fmt = (n: number) => decimal(Math.round(n * 100) / 100);

/** Reads a number with a comma or a dot and an optional unit (m, cm). */
/**
 * Points along the circular arc from `a` to `b` through `c` (n + 1 points, a first, b last), on the plane
 * of `a`; null when the three are in a line.
 */
export function arcSample(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: number): THREE.Vector3[] | null {
  const ax = a.x,
    az = a.z,
    bx = b.x,
    bz = b.z,
    cx = c.x,
    cz = c.z;
  const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d;
  const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, az - uz);
  const ang = (x: number, z: number) => Math.atan2(z - uz, x - ux);
  const t0 = ang(ax, az),
    t1 = ang(bx, bz),
    tc = ang(cx, cz);
  // Sweep from a to b the way that passes through c.
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(t1 - t0);
  if (norm(tc - t0) > sweep) sweep -= 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + (sweep * i) / n;
    return new THREE.Vector3(ux + Math.cos(t) * r, a.y, uz + Math.sin(t) * r);
  });
}

export function parseLength(s: string): number | null {
  const t = s.trim().toLowerCase().replace(',', '.');
  const m = /^(-?\d*\.?\d+)\s*(mm|cm|m)?$/.exec(t);
  // Arithmetic too ("3*2.5", "250cm + 1m"): model/expr.ts.
  if (!m) return /[-+*/()×÷]/.test(t.slice(1)) || t.startsWith('(') ? evalExpr(t) : null;
  const v = parseFloat(m[1]!);
  return m[2] === 'cm' ? v / 100 : m[2] === 'mm' ? v / 1000 : v;
}

/** "5f", "5 floors" (also "5a", "5 andares"): a number of floors, or null. */
export function parseFloors(s: string): number | null {
  const m = /^\s*(\d+)\s*(f|floors?|a|andares?)\s*$/i.exec(s);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Height from `base` that takes `n` floors of the building (more floors than it has: the typical height). */
export function floorsHeight(b: Building3, base: number, n: number): number {
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation >= base - 0.05);
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  let h = 0;
  for (let i = 0; i < n; i++) h += lv[i]?.height ?? typ;
  return h;
}

/** "3;4", "3 4", "3,5;-2": a move by dx and dz (m), or null. A comma is a decimal point here. */
export function parseOffset(s: string): [number, number] | null {
  const m = /^\s*(-?[\d.,]+)\s*[;\s]\s*(-?[\d.,]+)\s*$/.exec(s);
  if (!m) return null;
  const a = parseLength(m[1]!),
    b = parseLength(m[2]!);
  return a === null || b === null ? null : [a, b];
}


/** The point, or the closest one inside the polygon (inset by `inset`). */
export function clampInside(p: Vec2, poly: Vec2[], inset: number): Vec2 {
  const inside = (q: Vec2) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!,
        b = poly[j]!;
      if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  if (inside(p)) return p;
  let best: Vec2 = p,
    bd = Infinity;
  let cx = 0,
    cz = 0;
  for (const q of poly) {
    cx += q[0] / poly.length;
    cz += q[1] / poly.length;
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const abx = b[0] - a[0],
      abz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz || 1)));
    const q: Vec2 = [a[0] + abx * t, a[1] + abz * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  // Slightly inward, toward the center.
  const dx = cx - best[0],
    dz = cz - best[1],
    l = Math.hypot(dx, dz) || 1;
  return [best[0] + (dx / l) * inset, best[1] + (dz / l) * inset];
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Midpoint of a side (arcs: middle of the arc). */
export function midOf(v: { p: Vec2; bulge?: number }, n: { p: Vec2 }, chord = false): Vec2 {
  const m: Vec2 = [(v.p[0] + n.p[0]) / 2, (v.p[1] + n.p[1]) / 2];
  if (chord || !v.bulge) return m;
  const dx = n.p[0] - v.p[0],
    dz = n.p[1] - v.p[1];
  const c = Math.hypot(dx, dz) || 1;
  const sag = (v.bulge * c) / 2;
  // Right of the direction v → n.
  return [m[0] + (dz / c) * sag, m[1] - (dx / c) * sag];
}

/** The wall a facade part sits on: rule parts carry `edge:level:i` in their key, free parts their host. */
export function partHostFace(b: Building3, tag: { solid?: ID; key?: string; item?: ID; rule?: ID }): { kind: 'side'; solid: ID; edge: ID } | undefined {
  if (tag.rule && tag.solid && tag.key) return { kind: 'side', solid: tag.solid, edge: keyParts(tag.key)?.edge ?? tag.key.split(':')[0]! };
  const host = tag.item ? b.items.find((i) => i.id === tag.item)?.host : undefined;
  return host?.kind === 'face' ? { kind: 'side', solid: host.solid, edge: host.edge } : undefined;
}

/** The point halfway along a chain of segments (a side sampled into pieces when curved). */
export function halfway(segs: [Vec3, Vec3][]): Vec3 | null {
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  let rest = lens.reduce((x, y) => x + y, 0) / 2;
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i]!;
    const L = lens[i]!;
    if (rest <= L || i === segs.length - 1) {
      const t = L > 0 ? Math.min(1, rest / L) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    rest -= L;
  }
  return null;
}

export function ringCenter(r: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of r) c.add(p);
  return c.divideScalar(r.length);
}

export function polyArea(pts: THREE.Vector3[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s / 2);
}

export function screenDist(view: View, a: THREE.Vector3, b: THREE.Vector3): number {
  const p = view.toScreen(a),
    q = view.toScreen(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export { splitEdge, removeVertex };

/** The selectable face a picked face stands for: a side, the top (roof included), the plinth, the parapet (coping included). */
export function faceSelOf(f: FaceInfo): Editor3['sel']['face'] {
  if (f.kind === 'side') return { kind: 'side', edge: f.edge! };
  if (f.kind === 'top' || f.kind === 'roof') return { kind: 'top' };
  if (f.kind === 'plinth') return { kind: 'plinth' };
  if (f.kind === 'parapet' || f.kind === 'coping') return { kind: 'parapet' };
  return null;
}

/** The volume draws a parapet (flat or terrace roof with a height). */
export function hasParapet(s: Solid): boolean {
  return s.op === 'add' && (s.roof.kind === 'terrace' || (s.roof.kind === 'flat' && s.roof.parapet > 0.01));
}

/** The volume draws a plinth (on the ground, with a height). */
export function hasPlinth(s: Solid): boolean {
  return s.op === 'add' && s.plinth > 0.05 && s.base <= 0.3;
}

/**
 * Point of a volume's outline nearest to `q` (within 1.2 m), on a straight side,
 * snapped to its middle, to the line square to `from` (a cut straight across) or
 * to the grid along the side.
 */
export function cutEdgePoint(s: Solid, q: Vec2, from: Vec2 | null, grid: number): { p: Vec2 } | null {
  const V = s.plan.outer;
  let best: { p: Vec2; d: number } | null = null;
  for (let i = 0; i < V.length; i++) {
    if (V[i]!.bulge) continue;
    const a = V[i]!.p,
      z = V[(i + 1) % V.length]!.p;
    const dx = z[0] - a[0],
      dz = z[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const tx = dx / len,
      tz = dz / len;
    let u = (q[0] - a[0]) * tx + (q[1] - a[1]) * tz;
    if (Math.abs(u - len / 2) < 0.3) u = len / 2;
    else if (from) {
      // Square across from the first point (the usual cut), else the grid.
      const uf = (from[0] - a[0]) * tx + (from[1] - a[1]) * tz;
      if (Math.abs(u - uf) < 0.3) u = uf;
      else if (grid) u = Math.round(u / grid) * grid;
    } else if (grid) u = Math.round(u / grid) * grid;
    u = Math.max(0.06, Math.min(len - 0.06, u));
    const p: Vec2 = [a[0] + tx * u, a[1] + tz * u];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < 1.2 && (!best || d < best.d)) best = { p, d };
  }
  return best && { p: best.p };
}

/** Ramer–Douglas–Peucker on a closed stroke (plan x, z): the points that keep it within `tol` m. */
export function simplifyClosed(pts: THREE.Vector3[], tol: number): THREE.Vector3[] {
  if (pts.length < 5) return pts;
  const d2 = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
  };
  const keep = new Array<boolean>(pts.length).fill(false);
  const rdp = (i: number, j: number) => {
    let best = -1,
      bd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = d2(pts[k]!, pts[i]!, pts[j]!);
      if (d > bd) [best, bd] = [k, d];
    }
    if (best < 0) return;
    keep[best] = true;
    rdp(i, best);
    rdp(best, j);
  };
  // Split the loop at its farthest point from the start, then simplify both halves.
  let far = 0;
  for (let k = 1; k < pts.length; k++) if (pts[k]!.distanceTo(pts[0]!) > pts[far]!.distanceTo(pts[0]!)) far = k;
  keep[0] = keep[far] = true;
  rdp(0, far);
  rdp(far, pts.length - 1);
  keep[pts.length - 1] = pts[pts.length - 1]!.distanceTo(pts[0]!) > tol * 2;
  return pts.filter((_, k) => keep[k]);
}
