// The ground's shape. Heights are set at points (Revit's topography from points, ArchiCAD's mesh): the
// surface passes through each point and comes back to the base ground (0) away from them: modified
// Shepard weights ((R − d) / (R·d))², Franke and Nielson 1980, which reach zero at R, with the base
// ground as one more weight, so 40 m away from every point the ground is flat at 0 again. Under every building and
// street the ground is a flat pad at its level, joined to the natural ground by a slope (SketchUp's Stamp
// with its offset): the house never floats nor sinks. Pure, no three.
import type { Project3, Vec2 } from './schema';
import { outerRing } from './lots';
import { insideRing, ribbon } from './site';

/** Reach of a point's influence (m), and the weight of the base ground (that of a point 15 m off). */
const R = 40,
  BASE_W = ((R - 15) / (R * 15)) ** 2;
/** Flat margin of a pad around the footprint, and the run of its slope per metre of height (1:2). */
const MARGIN = 0.6,
  RUN = 2;

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
}

/** Distance from a point to a ring (0 inside). */
function ringDist(q: Vec2, r: Vec2[]): number {
  if (insideRing(q, r)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length; i++) d = Math.min(d, segDist(q, r[i]!, r[(i + 1) % r.length]!));
  return d;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export interface TerrainField {
  /** Ground height at a world point. */
  at(x: number, z: number): number;
  /** World box the shaped ground covers: [x0, z0, x1, z1]. */
  box: [number, number, number, number];
}

/** The ground of a project, or null when it is flat (no terrain points). */
export function terrainField(p: Project3): TerrainField | null {
  const pts = p.terrain?.points ?? [];
  if (!pts.length) return null;
  const pads: { rings: Vec2[][]; y: number; box: [number, number, number, number] }[] = [];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    const rings = b.solids.filter((s) => s.op === 'add' && !s.hidden && s.base <= 0.05).map((s) => outerRing(b, s));
    if (!rings.length) continue;
    const xs = rings.flat().map((q) => q[0]),
      zs = rings.flat().map((q) => q[1]);
    pads.push({ rings, y: b.elevation ?? 0, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
  }
  for (const st of p.streets ?? []) {
    const rings = ribbon(st.points, 0, st.width / 2 + st.sidewalk);
    const xs = rings.flat().map((q) => q[0]),
      zs = rings.flat().map((q) => q[1]);
    if (rings.length) pads.push({ rings, y: 0, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] });
  }
  const natural = (x: number, z: number) => {
    let sw = BASE_W,
      sy = 0;
    for (const q of pts) {
      const d = Math.hypot(q.p[0] - x, q.p[1] - z);
      if (d < 1e-3) return q.y;
      if (d >= R) continue;
      const w = ((R - d) / (R * d)) ** 2;
      sw += w;
      sy += w * q.y;
    }
    return sy / sw;
  };
  const at = (x: number, z: number) => {
    let h = natural(x, z);
    for (const pad of pads) {
      const reach = MARGIN + Math.max(1, Math.abs(h - pad.y) * RUN);
      if (x < pad.box[0] - reach || x > pad.box[2] + reach || z < pad.box[1] - reach || z > pad.box[3] + reach) continue;
      const d = Math.min(...pad.rings.map((r) => ringDist([x, z], r)));
      if (d >= reach) continue;
      h = pad.y + (h - pad.y) * smooth((d - MARGIN) / (reach - MARGIN));
    }
    return h;
  };
  const xs = pts.map((q) => q.p[0]),
    zs = pts.map((q) => q.p[1]);
  // The shaped ground reaches where the points' influence has faded (the base ground takes over).
  const m = R;
  return { at, box: [Math.min(...xs) - m, Math.min(...zs) - m, Math.max(...xs) + m, Math.max(...zs) + m] };
}
