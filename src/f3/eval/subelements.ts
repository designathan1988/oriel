// Sub-elements of a volume for the vertex / edge / face selection modes (Blender edit mode:
// 1 vertex, 2 edge, 3 face). A volume is an extruded plan, so a plan vertex is a corner (its
// base and top points) and a plan side is an edge (at the base and at the top, curved sides
// sampled). Conversions between modes follow Blender: going up keeps what is complete, going
// down keeps everything. Building frame, no three.
import type { ID, Solid, Vec3 } from '../model/schema';
import { solidRings } from './body';
import { flatRoof, parapetTop } from './parapet';

export interface SubVertex {
  id: ID;
  base: Vec3;
  top: Vec3;
}

export interface SubEdge {
  id: ID;
  /** Segments of the side at the base and at the top (several when curved). */
  segs: [Vec3, Vec3][];
}

/** Corners and sides of a volume, in the building frame. */
export function subElements(s: Solid): { verts: SubVertex[]; edges: SubEdge[] } {
  const r = solidRings(s);
  // The top corner sits where it is seen: on the parapet coping of a flat roof, else at the wall top.
  const topY = r.top + (s.op === 'add' && flatRoof(s) ? parapetTop(s.roof.parapet ?? 0) : 0);
  const verts: SubVertex[] = [];
  const edges = new Map<ID, SubEdge>();
  const rings = [
    { pts: r.outer.pts, segs: r.outer.segs, top: r.topOuter },
    ...r.holes.map((h, i) => ({ pts: h.pts, segs: h.segs, top: r.topHoles[i]! })),
  ];
  for (const ring of rings) {
    const n = ring.pts.length;
    for (let k = 0; k < n; k++) {
      const seg = ring.segs[k]!;
      const a = ring.pts[k]!,
        b = ring.pts[(k + 1) % n]!;
      const ta = ring.top[k] ?? a,
        tb = ring.top[(k + 1) % n] ?? b;
      // A rounded or chamfered corner (`id:c`) belongs to its vertex, not to a side.
      if (seg.edge.endsWith(':c')) continue;
      if (seg.s0 === 0) verts.push({ id: seg.edge, base: [a[0], r.base, a[1]], top: [ta[0], topY, ta[1]] });
      let e = edges.get(seg.edge);
      if (!e) edges.set(seg.edge, (e = { id: seg.edge, segs: [] }));
      e.segs.push([[a[0], r.base, a[1]], [b[0], r.base, b[1]]], [[ta[0], topY, ta[1]], [tb[0], topY, tb[1]]]);
    }
  }
  // A rounded corner has no straight start point: its vertex sits where the corner arc starts.
  const have = new Set(verts.map((v) => v.id));
  for (const ring of rings)
    ring.segs.forEach((seg, k) => {
      const id = seg.edge.endsWith(':c') ? seg.edge.slice(0, -2) : null;
      if (!id || have.has(id)) return;
      have.add(id);
      const a = ring.pts[k]!,
        ta = ring.top[k] ?? a;
      verts.push({ id, base: [a[0], r.base, a[1]], top: [ta[0], topY, ta[1]] });
    });
  return { verts, edges: [...edges.values()] };
}

/** The plan ring holding a vertex, and its index. */
function locate(s: Solid, id: ID): { ring: Solid['plan']['outer']; i: number } | null {
  for (const ring of [s.plan.outer, ...s.plan.holes]) {
    const i = ring.findIndex((v) => v.id === id);
    if (i >= 0) return { ring, i };
  }
  return null;
}

/** Start and end vertex of a side (the side has the ID of its start vertex). */
export function edgeEnds(s: Solid, edge: ID): [ID, ID] | null {
  const l = locate(s, edge);
  return l ? [edge, l.ring[(l.i + 1) % l.ring.length]!.id] : null;
}

export type ElemMode = 'object' | 'vertex' | 'edge' | 'face';

export interface SubSel {
  verts: ID[];
  edges: ID[];
  face: { kind: 'side' | 'top'; edge?: ID } | null;
}

/** Converts a sub-selection to another mode (Blender: up keeps what is complete, down keeps all). */
export function convertSub(s: Solid, from: SubSel, to: ElemMode): SubSel {
  const all = [s.plan.outer, ...s.plan.holes].flat();
  const out: SubSel = { verts: [], edges: [], face: null };
  // Everything as vertices and edges first.
  const verts = new Set(from.verts);
  const edges = new Set(from.edges);
  if (from.face?.kind === 'top')
    for (const v of all) {
      verts.add(v.id);
      edges.add(v.id);
    }
  else if (from.face?.edge) {
    edges.add(from.face.edge);
    for (const id of edgeEnds(s, from.face.edge) ?? []) verts.add(id);
  }
  for (const e of from.edges) for (const id of edgeEnds(s, e) ?? []) verts.add(id);
  // Up from vertices: the sides whose two ends are selected.
  const complete = all.filter((v) => {
    const ends = edgeEnds(s, v.id);
    return !!ends && verts.has(ends[0]) && verts.has(ends[1]);
  });
  if (to === 'vertex') out.verts = all.filter((v) => verts.has(v.id)).map((v) => v.id);
  else if (to === 'edge') out.edges = all.filter((v) => edges.has(v.id) || (from.verts.length > 0 && complete.includes(v))).map((v) => v.id);
  else if (to === 'face') {
    if (from.face) out.face = from.face;
    else {
      // Every side selected: the top; otherwise the first complete side.
      const sides = all.filter((v) => edges.has(v.id) || complete.includes(v));
      if (sides.length === all.length && all.length) out.face = { kind: 'top' };
      else if (sides.length) out.face = { kind: 'side', edge: sides[0]!.id };
    }
  }
  return out;
}

/** Distance (px) from a point to a screen segment. */
export function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
