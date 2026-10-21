// Structural grid (Revit "Grids" with columns at the crossings, Estúdio's "pilares"): columns every
// `spacing` metres inside a volume, on each of its floors, from the floor to the slab above, kept a
// little in from the walls. They are free column parts of the building (families/structure.ts).
// Pure, no three.
import type { Building3, Item, Solid, Vec2 } from './schema';
import { sampleRing } from './plan';

/** Slab thickness the columns stop under (eval/interior.ts SLAB). */
const SLAB = 0.25;

function inside(p: Vec2, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!,
      b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function nearEdge(p: Vec2, ring: Vec2[], d: number): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    if (Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) < d) return true;
  }
  return false;
}

/** Column positions of a grid over the volume's plan (building frame), centred on its box. */
export function gridPoints(s: Solid, spacing: number, clear = 0.6): Vec2[] {
  const ring = sampleRing(s.plan.outer).pts as Vec2[];
  const holes = s.plan.holes.map((h) => sampleRing(h).pts as Vec2[]);
  const xs = ring.map((p) => p[0]),
    zs = ring.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  const nx = Math.max(1, Math.round((x1 - x0) / spacing)),
    nz = Math.max(1, Math.round((z1 - z0) / spacing));
  const out: Vec2[] = [];
  for (let i = 1; i < nx; i++)
    for (let j = 1; j < nz; j++) {
      const p: Vec2 = [x0 + ((x1 - x0) * i) / nx, z0 + ((z1 - z0) * j) / nz];
      if (inside(p, ring) && !holes.some((h) => inside(p, h)) && !nearEdge(p, ring, clear) && !holes.some((h) => nearEdge(p, h, clear))) out.push(p);
    }
  return out;
}

/** Points outside the building's cutters (courtyards, notches), with a margin. */
function clearOfCutters(b: Building3, pts: Vec2[], clear: number): Vec2[] {
  const cuts = b.solids.filter((q) => q.op === 'subtract').map((q) => sampleRing(q.plan.outer).pts as Vec2[]);
  return pts.filter((p) => !cuts.some((r) => inside(p, r) || nearEdge(p, r, clear)));
}

/** A place on the floor of the volume for a part of about `size` m: nearest its middle, never in a courtyard. */
export function freeSpot(b: Building3, s: Solid, size = 3): Vec2 | null {
  const pts = clearOfCutters(b, gridPoints(s, 1.5, size / 2 + 0.3), size / 2 + 0.3);
  if (!pts.length) return null;
  const ring = sampleRing(s.plan.outer).pts as Vec2[];
  const mid: Vec2 = [(Math.min(...ring.map((p) => p[0])) + Math.max(...ring.map((p) => p[0]))) / 2, (Math.min(...ring.map((p) => p[1])) + Math.max(...ring.map((p) => p[1]))) / 2];
  return pts.reduce((best, p) => (Math.hypot(p[0] - mid[0], p[1] - mid[1]) < Math.hypot(best[0] - mid[0], best[1] - mid[1]) ? p : best));
}

/** Columns of the grid on every floor of the volume (floor to the slab above), none in a courtyard. */
export function columnGrid(b: Building3, s: Solid, spacing: number, type: string, uid: () => string): Item[] {
  const pts = clearOfCutters(b, gridPoints(s, spacing), 0.6);
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const top = s.base + s.height;
  const out: Item[] = [];
  lv.forEach((l, i) => {
    const e0 = Math.max(l.elevation, s.base),
      e1 = Math.min(lv[i + 1]?.elevation ?? top, top);
    if (e1 - e0 < 2) return;
    const h = Math.round((e1 - e0 - SLAB) * 100) / 100;
    for (const p of pts) out.push({ id: uid(), type, params: { height: h, plinth: false, capital: false }, host: { kind: 'free', p: [p[0], e0, p[1]], rot: 0 } });
  });
  return out;
}
