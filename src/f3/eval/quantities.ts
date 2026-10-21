// Quantities of a building, read from the same model the drawings come from (a quantity takeoff, the
// list a budget starts from): walls by area less their openings, floors and ceilings by the free floor
// of the rooms, the roof by its sloped area, windows and doors counted by type and size. Each line has
// its unit so it can be priced (a unit cost per line, or the whole by the built area times the CUB/m²,
// the reference cost per m² the Brazilian builders' unions publish every month). Pure (no three, no DOM).
import type { Building3 } from '../model/schema';
import type { Evaluated } from './evaluate';
import type { FloorPlan } from './floorplan';
import { sortedLevels } from './floorplan';
import { SLAB } from './interior';

export interface QuantityLine {
  /** Stable key of the line (unit costs are kept by it). */
  key: string;
  group: 'Walls' | 'Floors and ceilings' | 'Roof' | 'Windows and doors' | 'Areas';
  item: string;
  /** Size or note shown after the item (a window's width × height). */
  detail?: string;
  unit: 'm²' | 'm' | 'un';
  qty: number;
}

const ring = (r: [number, number][]) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!,
      b = r[(i + 1) % r.length]!;
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
};

/**
 * The quantities of one building: `ev` is its evaluation (openings and roof), `plans` its floor plans
 * by level index (floorplan.ts).
 */
export function buildingQuantities(b: Building3, ev: Evaluated | null, plans: FloorPlan[]): QuantityLine[] {
  const levels = sortedLevels(b);
  let extWall = 0,
    intWallLen = 0,
    intWall = 0,
    floor = 0,
    gross = 0,
    openArea = 0,
    doorArea = 0;
  plans.forEach((fp) => {
    const lv = levels[fp.levelIndex];
    if (!lv) return;
    gross += fp.grossArea;
    floor += fp.netArea;
    // Exterior walls: the outer face all around, one floor high.
    extWall += fp.outline.reduce((s, r) => s + ring(r as [number, number][]), 0) * lv.height;
    const it = b.interiors[lv.id];
    if (it) {
      const node = new Map(it.nodes.map((n) => [n.id, n.p]));
      for (const w of it.walls) {
        const a = node.get(w.a),
          c = node.get(w.b);
        if (!a || !c) continue;
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        intWallLen += L;
        intWall += L * Math.max(0, lv.height - SLAB);
      }
      for (const d of (it as { doors?: { width: number; height: number }[] }).doors ?? []) doorArea += d.width * d.height;
    }
  });
  // Openings by family and size.
  const count = new Map<string, { item: string; detail: string; n: number }>();
  for (const pl of ev?.placements ?? []) {
    if (!pl.opening) continue;
    openArea += pl.opening.w * pl.opening.h;
    const size = `${pl.opening.w.toFixed(2)} × ${pl.opening.h.toFixed(2)} m`;
    const k = `${pl.family.id}|${size}`;
    const c = count.get(k) ?? { item: pl.family.name, detail: size, n: 0 };
    c.n++;
    count.set(k, c);
  }
  // Interior doors (drawn in the plan) by size.
  for (const lv of levels)
    for (const d of (b.interiors[lv.id] as { doors?: { width: number; height: number }[] } | undefined)?.doors ?? []) {
      const size = `${d.width.toFixed(2)} × ${d.height.toFixed(2)} m`;
      const k = `interior-door|${size}`;
      const c = count.get(k) ?? { item: 'Interior door', detail: size, n: 0 };
      c.n++;
      count.set(k, c);
    }
  // Roof: the area of the roof faces (sloped, as laid).
  let roof = 0;
  if (ev) {
    const { positions: P, indices: I, faceOf } = ev.shell;
    for (let t = 0; t < faceOf.length; t++) {
      const f = ev.faces[faceOf[t]!];
      if (!f || (f.kind !== 'roof' && f.kind !== 'top')) continue;
      const a = I[t * 3]! * 3,
        bb = I[t * 3 + 1]! * 3,
        c = I[t * 3 + 2]! * 3;
      const ux = P[bb]! - P[a]!,
        uy = P[bb + 1]! - P[a + 1]!,
        uz = P[bb + 2]! - P[a + 2]!;
      const vx = P[c]! - P[a]!,
        vy = P[c + 1]! - P[a + 1]!,
        vz = P[c + 2]! - P[a + 2]!;
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      // Faces looking up only (the underside of an eave is not laid with tiles).
      if (ny <= 0) continue;
      roof += Math.hypot(nx, ny, nz) / 2;
    }
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: QuantityLine[] = [
    { key: 'gross', group: 'Areas', item: 'Built area', unit: 'm²', qty: r2(gross) },
    { key: 'net', group: 'Areas', item: 'Free floor area', unit: 'm²', qty: r2(floor) },
    { key: 'wall-ext', group: 'Walls', item: 'Exterior walls (less openings)', unit: 'm²', qty: r2(Math.max(0, extWall - openArea)) },
    { key: 'wall-int', group: 'Walls', item: 'Interior walls (less doors)', unit: 'm²', qty: r2(Math.max(0, intWall - doorArea)) },
    { key: 'wall-int-len', group: 'Walls', item: 'Interior walls, length', unit: 'm', qty: r2(intWallLen) },
    { key: 'paint-int', group: 'Walls', item: 'Inside paint (both faces of interior walls and the inner face of the exterior ones)', unit: 'm²', qty: r2(Math.max(0, 2 * (intWall - doorArea) + extWall - openArea)) },
    { key: 'floor', group: 'Floors and ceilings', item: 'Floor finish', unit: 'm²', qty: r2(floor) },
    { key: 'ceiling', group: 'Floors and ceilings', item: 'Ceiling', unit: 'm²', qty: r2(floor) },
    { key: 'roof', group: 'Roof', item: 'Roof (sloped area)', unit: 'm²', qty: r2(roof) },
  ];
  for (const [k, c] of [...count].sort((x, y) => (x[1].item + x[1].detail).localeCompare(y[1].item + y[1].detail))) out.push({ key: `open:${k}`, group: 'Windows and doors', item: c.item, detail: c.detail, unit: 'un', qty: c.n });
  return out.filter((l) => l.qty > 0 || l.group === 'Areas');
}
