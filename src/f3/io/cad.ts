// DXF with mature libraries: written with @tarikjabiri/dxf (https://dxf.vercel.app/, MIT: LWPOLYLINE with
// bulge, layers with colour, text, units) and read with dxf (https://github.com/skymakerolof/dxf, MIT:
// LWPOLYLINE/POLYLINE with bulge, CIRCLE, ARC, SPLINE, INSERT of blocks with their transforms). Arcs go
// both ways as arcs: a curved wall is written as a bulge and read back as one (the hand-written R12
// writer and reader in dxf.ts dropped the bulge). Plans are in world metres, X east, Y = −Z of the scene.
import { DxfWriter, LWPolylineFlags, Units, point2d, point3d, type LWPolylineVertex } from '@tarikjabiri/dxf';
import type { PlanVertex, Project3, Vec2 } from '../model/schema';
import { oriented, sampleRing } from '../model/plan';
import { toWorld } from '../model/ops';
import { LOTS_LAYER, type DxfPolyline } from './dxf';

/** Layer name DXF accepts (no `< > / \ " : ; ? * | = , ``), at most 31 characters, never 'LOTS'. */
function layerName(name: string): string {
  const clean = name.replace(/[<>/\\":;?*|=,`]/g, '_').trim().slice(0, 31) || 'BUILDING';
  return clean.toUpperCase() === LOTS_LAYER ? `${clean}_B` : clean;
}

/**
 * Vertices of a ring for an LWPOLYLINE: exact (with bulges) when the ring is made of straight sides and
 * arcs only; sampled points when it has rounded/chamfered corners or spline points.
 */
function ringVertices(vs: PlanVertex[], world: (p: Vec2) => Vec2): LWPolylineVertex[] {
  const exact = vs.every((v) => !v.round && !v.chamfer && !v.smooth);
  if (exact) {
    // Y = −Z mirrors the plan, so an arc turning one way in the scene turns the other way in the drawing.
    return vs.map((v) => {
      const q = world(v.p);
      return { point: point2d(q[0], -q[1]), ...(v.bulge ? { bulge: -v.bulge } : {}) };
    });
  }
  return sampleRing(vs).pts.map((p) => {
    const q = world(p);
    return { point: point2d(q[0], -q[1]) };
  });
}

/** The plan of the project as DXF text (AutoCAD 2007 format, metres). */
export function planToCadDxf(p: Project3, opts: { cutY?: number } = {}): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Meters);
  if (p.lots.length) {
    dxf.addLayer(LOTS_LAYER, 8);
    for (const l of p.lots) dxf.addLWPolyline(l.polygon.map((q) => ({ point: point2d(q[0], -q[1]) })), { flags: LWPolylineFlags.Closed, layerName: LOTS_LAYER });
  }
  if (p.streets?.length) {
    dxf.addLayer('STREETS', 9);
    for (const st of p.streets) dxf.addLWPolyline(st.points.map((q) => ({ point: point2d(q[0], -q[1]) })), { flags: LWPolylineFlags.None, layerName: 'STREETS', constantWidth: st.width });
  }
  const used = new Set<string>();
  for (const b of p.buildings) {
    if (b.hidden) continue;
    let layer = layerName(b.name);
    for (let i = 2; used.has(layer); i++) layer = layerName(`${b.name} ${i}`);
    const world = (q: Vec2) => toWorld(b, q);
    let drawn = 0;
    for (const s of b.solids) {
      if (s.op !== 'add' || s.hidden) continue;
      const cut = opts.cutY;
      if (cut !== undefined && !(s.base <= cut && cut < s.base + s.height)) continue;
      if (!drawn++) {
        used.add(layer);
        dxf.addLayer(layer, 7);
      }
      dxf.addLWPolyline(ringVertices(oriented(s.plan.outer, 1), world), { flags: LWPolylineFlags.Closed, layerName: layer });
      for (const h of s.plan.holes) dxf.addLWPolyline(ringVertices(oriented(h, -1), world), { flags: LWPolylineFlags.Closed, layerName: layer });
    }
    if (drawn) {
      const c = world([0, 0]);
      dxf.addText(point3d(c[0], -c[1], 0), 1, b.name, { layerName: layer });
    }
  }
  return dxf.stringify();
}

/** One polyline of the drawing, with its bulges when the source had arcs. */
export type CadPolyline = DxfPolyline & { bulges?: number[] };

interface DxfVertex {
  x: number;
  y: number;
  z?: number;
  bulge?: number;
}
interface DxfEntity {
  type: string;
  layer?: string;
  elevation?: number;
  closed?: boolean;
  vertices?: DxfVertex[];
  x?: number;
  y?: number;
  r?: number;
  transforms?: unknown[];
}

/**
 * Reads a DXF: polylines exactly (bulges kept), circles as two half-circle arcs; everything else
 * (blocks inserted with their transforms, arcs, splines, lines) as the library's interpolated polylines,
 * whose ends are chained when they meet.
 */
export async function readCadDxf(text: string): Promise<CadPolyline[]> {
  const { Helper } = (await import('dxf')) as unknown as { Helper: new (s: string) => { denormalised: DxfEntity[]; toPolylines(): { polylines: { layer?: { name?: string }; vertices: [number, number][] }[] } } };
  const h = new Helper(text);
  const out: CadPolyline[] = [];
  let other = false;
  for (const e of h.denormalised) {
    const plain = !e.transforms || e.transforms.length === 0;
    const layer = e.layer ?? '0';
    if (plain && (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.vertices && e.vertices.length >= 2) {
      const pts = e.vertices.map((v) => [v.x, v.y] as [number, number]);
      const bulges = e.vertices.map((v) => v.bulge ?? 0);
      // A closed polyline written with its first point repeated at the end.
      if (pts.length > 2 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < 1e-6) {
        pts.pop();
        bulges.pop();
      }
      // The elevation of a contour line: LWPOLYLINE's own (group 38), else the Z of its first vertex.
      const z = typeof e.elevation === 'number' ? e.elevation : e.vertices[0]?.z;
      out.push({ layer, points: pts, closed: !!e.closed || pts.length > 2 && e.vertices.length > pts.length, ...(bulges.some((b) => b) ? { bulges } : {}), ...(z ? { z } : {}) });
    } else if (plain && e.type === 'CIRCLE' && e.x !== undefined && e.y !== undefined && e.r) {
      out.push({ layer, points: [[e.x - e.r, e.y], [e.x + e.r, e.y]], closed: true, bulges: [1, 1] });
    } else other = true;
  }
  if (other) {
    // The rest, interpolated by the library (its entities, in the same order, minus what was read above).
    const done = new Set(out.map((q) => JSON.stringify(q.points[0])));
    const segs = h.toPolylines().polylines.filter((pl) => pl.vertices.length >= 2 && !done.has(JSON.stringify(pl.vertices[0])));
    for (const pl of segs) {
      const pts = pl.vertices.map((v) => [v[0], v[1]] as [number, number]);
      const closed = pts.length > 2 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < 1e-3;
      if (closed) pts.pop();
      out.push({ layer: pl.layer?.name ?? '0', points: pts, closed });
    }
  }
  return out;
}
