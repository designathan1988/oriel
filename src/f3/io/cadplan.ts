// The floor plans as a CAD drawing (DXF, metres): every floor of every building side by side, each with
// its cut walls, doors (leaf and swing), windows, room names and areas and its dimension chains, on the
// layers a CAD office expects (AIA style: A-WALL, A-DOOR, A-GLAZ, A-AREA-IDEN, A-ANNO-DIMS, A-ANNO-TEXT).
// The drawing is the same plan the editor and the PDF sheets show (eval/floorplan.ts): one source.
// Written with @tarikjabiri/dxf (AutoCAD 2007 format). Y = −Z of the scene, as in cad.ts.
import { DxfWriter, LWPolylineFlags, Units, point2d, point3d } from '@tarikjabiri/dxf';
import type { ID, Project3, Vec2 } from '../model/schema';
import { floorPlan, sortedLevels, type FloorPlan } from '../eval/floorplan';
import { floorPlanSvg } from '../eval/floorplansvg';
import { siteContext, type SiteContext } from '../eval/sitecontext';
import type { Placement } from '../eval/facade';

/** Every floor of every visible building that has walls cut on it, with its title. */
export function collectFloorPlans(p: Project3, placementsOf: (id: ID) => Placement[], t: (s: string) => string = (s) => s): { fp: FloorPlan; title: string; site: SiteContext | null }[] {
  const out: { fp: FloorPlan; title: string; site: SiteContext | null }[] = [];
  for (const b of p.buildings) {
    if (b.hidden || !b.solids.some((s) => s.op === 'add')) continue;
    sortedLevels(b).forEach((lv, i) => {
      try {
        const fp = floorPlan(b, i, placementsOf(b.id));
        if (fp.walls.length) out.push({ fp, title: `${b.name} · ${t(lv.name)}`, site: i === 0 ? siteContext(p, b) : null });
      } catch {
        /* a floor that cannot be cut is left out */
      }
    });
  }
  return out;
}

/** One floor plan as an SVG file (the drawing of the plan view). */
export function floorPlanSvgFile(fp: FloorPlan, title: string, decimal: string, t: (s: string) => string, site: SiteContext | null = null): string {
  return floorPlanSvg(fp, { title, decimal, t, site }).svg;
}

const LAYERS: [string, number][] = [
  ['A-WALL', 7],
  ['A-DOOR', 3],
  ['A-GLAZ', 5],
  ['A-AREA-IDEN', 2],
  ['A-ANNO-DIMS', 1],
  ['A-ANNO-TEXT', 7],
  // The surroundings of the ground floor (AIA site layers): lot lines, streets, contour lines.
  ['C-PROP', 8],
  ['C-ROAD', 9],
  ['C-TOPO', 34],
];

/** A segment cut to a box (Liang–Barsky), or null when it lies outside. */
function clip(a: Vec2, b: Vec2, x0: number, z0: number, x1: number, z1: number): [Vec2, Vec2] | null {
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dz, a[1] - z0], [dz, z1 - a[1]]] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [[a[0] + dx * t0, a[1] + dz * t0], [a[0] + dx * t1, a[1] + dz * t1]];
}

/** Every floor plan given, side by side (a 6 m gap), as DXF text. `decimal` writes the numbers. */
export function floorPlansToDxf(plans: { fp: FloorPlan; title: string; site?: SiteContext | null }[], decimal: (v: string) => string = (v) => v): string {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Meters);
  for (const [n, c] of LAYERS) dxf.addLayer(n, c);
  let dx = 0;
  for (const { fp, title, site } of plans) {
    const { x0, z0, x1, z1 } = fp.bbox;
    const ox = dx - x0;
    const P = (p: Vec2) => point2d(p[0] + ox, -p[1]);
    const P3 = (p: Vec2) => point3d(p[0] + ox, -p[1], 0);
    const line = (a: Vec2, b: Vec2, layerName: string) => dxf.addLine(P3(a), P3(b), { layerName });
    const n2 = (v: number) => decimal(v.toFixed(2));
    if (site) {
      // Kept inside the plan's own margin: the next plan starts 6 m away.
      const M = 2.6;
      const cut = (a: Vec2, b: Vec2, layer: string) => {
        const c = clip(a, b, x0 - M, z0 - M, x1 + M, z1 + M);
        if (c) line(c[0], c[1], layer);
      };
      for (const r of site.lots) r.forEach((q, i) => cut(q, r[(i + 1) % r.length]!, 'C-PROP'));
      for (const r of site.streets) r.forEach((q, i) => cut(q, r[(i + 1) % r.length]!, 'C-ROAD'));
      for (const c of site.contours) cut(c[0], c[1], 'C-TOPO');
    }
    for (const r of fp.walls) dxf.addLWPolyline(r.map((q) => ({ point: P(q) })), { flags: LWPolylineFlags.Closed, layerName: 'A-WALL' });
    for (const w of fp.windows) {
      // The glass line in the middle of the wall and the two faces of the opening.
      const m = (k: number): [Vec2, Vec2] => [
        [w.a[0] - w.n[0] * w.depth * k, w.a[1] - w.n[1] * w.depth * k],
        [w.b[0] - w.n[0] * w.depth * k, w.b[1] - w.n[1] * w.depth * k],
      ];
      for (const k of [0, 0.5, 1]) line(...m(k), 'A-GLAZ');
    }
    for (const d of fp.doors) {
      line(d.hinge, d.leaf, 'A-DOOR');
      const r = Math.hypot(d.leaf[0] - d.hinge[0], d.leaf[1] - d.hinge[1]);
      // Angles in the drawing (Y up): the swing from the open leaf to the jamb, the short way round.
      const ang = (p: Vec2) => (Math.atan2(-(p[1] - d.hinge[1]), p[0] - d.hinge[0]) * 180) / Math.PI;
      let a0 = ang(d.leaf),
        a1 = ang(d.jamb);
      const sweep = ((a1 - a0 + 540) % 360) - 180;
      if (sweep < 0) [a0, a1] = [a1, a0];
      dxf.addArc(P3(d.hinge), r, (a0 + 360) % 360, (a1 + 360) % 360, { layerName: 'A-DOOR' });
    }
    for (const r of fp.rooms) {
      if (r.name) dxf.addText(point3d(r.at[0] + ox, -r.at[1] + 0.1, 0), 0.3, r.name, { layerName: 'A-AREA-IDEN' });
      dxf.addText(point3d(r.at[0] + ox, -r.at[1] - 0.35, 0), 0.22, `${n2(r.area)} m²`, { layerName: 'A-AREA-IDEN' });
    }
    for (const d of fp.dims) {
      const off = 0.9 + d.tier * 0.7;
      const horiz = d.side === 'top' || d.side === 'bottom';
      const sgn = d.side === 'bottom' || d.side === 'right' ? 1 : -1;
      const shift = (p: Vec2): Vec2 => (horiz ? [p[0], (d.side === 'bottom' ? z1 : z0) + sgn * off] : [(d.side === 'right' ? x1 : x0) + sgn * off, p[1]]);
      const a = shift(d.a),
        b = shift(d.b);
      line(d.a, a, 'A-ANNO-DIMS');
      line(d.b, b, 'A-ANNO-DIMS');
      line(a, b, 'A-ANNO-DIMS');
      for (const t of [a, b]) line([t[0] - 0.09, t[1] + 0.09], [t[0] + 0.09, t[1] - 0.09], 'A-ANNO-DIMS');
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      const mx = (a[0] + b[0]) / 2,
        my = (a[1] + b[1]) / 2;
      dxf.addText(point3d(mx + ox + (horiz ? -0.25 : -0.1), -my + (horiz ? 0.08 : 0), 0), 0.18, n2(len), { layerName: 'A-ANNO-DIMS' });
    }
    dxf.addText(point3d(x0 + ox, -(z1 + 3), 0), 0.45, title, { layerName: 'A-ANNO-TEXT' });
    dx += x1 - x0 + 6;
  }
  return dxf.stringify();
}
