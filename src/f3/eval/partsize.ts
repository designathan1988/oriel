// Size handles for any component, whatever its family: the part is built once into a bare sink to
// read its real box (in its own frame: x width, y height, z depth), and each numeric length parameter is
// nudged to see which side of that box it moves (a finite difference). A handle on that side then
// drives that parameter: dragging the side by d changes it by d / slope. Families need no extra code
// (a tree's crown, a sofa's depth, a pool's length, a lamp's height all come out of the same probe).
// No three.
import type { Family, Params } from '../families/family';
import { emptyParts3, FrameSink, identity, apply, type M4 } from './parts';
import type { Vec3 } from '../model/schema';

export interface Box3D {
  min: Vec3;
  max: Vec3;
}

/** Corners of the unit shapes the instances scale (a box or a cylinder of size 1 around its center). */
const UNIT: Vec3[] = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z] as Vec3)));

/** The box of a part built with these parameters, in its own frame; null when it builds nothing. */
export function partBox(f: Family, p: Params, length = 1): Box3D | null {
  const parts = emptyParts3();
  try {
    f.build(p, new FrameSink(parts, identity(), 0), { length, reveal: 0, index: 0 });
  } catch {
    return null;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (q: Vec3) => {
    for (let k = 0; k < 3; k++) {
      if (q[k]! < min[k]!) min[k] = q[k]!;
      if (q[k]! > max[k]!) max[k] = q[k]!;
    }
  };
  for (const it of parts.inst) for (const c of UNIT) add(apply(it.m as M4, c));
  for (const m of parts.meshes) for (let i = 0; i < m.positions.length; i += 3) add([m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!]);
  return Number.isFinite(min[0]) ? { min, max } : null;
}

export interface DimParam {
  /** 0: width (x), 1: height (y), 2: depth (z). */
  axis: 0 | 1 | 2;
  /** The side the handle sits on: +1 (max) or −1 (min) along the axis. */
  side: 1 | -1;
  key: string;
  label: string;
  /** Change of that side per unit of the parameter (m per m), positive. */
  slope: number;
  /** How fast each side moves out with the parameter: the max side and the min side (m per m, ≥ 0). */
  up: number;
  down: number;
  min: number;
  max: number;
}

const cache = new Map<string, DimParam[]>();

/**
 * For each axis of the part, the length parameter that moves it most (and which side it moves),
 * from the current values. Cached by family and values.
 */
export function dimParams(f: Family, p: Params): DimParam[] {
  const k = f.id + JSON.stringify(p);
  const hit = cache.get(k);
  if (hit) return hit;
  const base = partBox(f, p);
  const out: DimParam[] = [];
  if (base) {
    const best: (DimParam | null)[] = [null, null, null];
    for (const d of f.params) {
      if (d.kind !== 'length') continue;
      const v = p[d.key];
      if (typeof v !== 'number') continue;
      const h = Math.max(0.01, Math.abs(v) * 0.05);
      const up = Math.min(d.max ?? Infinity, v + h);
      const dv = up - v;
      if (dv < 1e-6) continue;
      const nb = partBox(f, { ...p, [d.key]: up });
      if (!nb) continue;
      for (const axis of [0, 1, 2] as const) {
        const dMax = (nb.max[axis]! - base.max[axis]!) / dv,
          dMin = (base.min[axis]! - nb.min[axis]!) / dv;
        const side: 1 | -1 = dMax >= dMin ? 1 : -1;
        const slope = Math.max(dMax, dMin);
        // A side that follows the parameter at least half as fast (a hidden detail does not count).
        if (slope < 0.3) continue;
        const cur = best[axis];
        // The size parameters (width, height, depth…) win over details that also widen the box (a trim).
        const rank = (x: { slope: number; key: string }) => x.slope + (f.params.find((q) => q.key === x.key)?.group === 'size' ? 10 : 0);
        if (!cur || rank({ slope, key: d.key }) > rank(cur) + 1e-6) best[axis] = { axis, side, key: d.key, label: d.label, slope, up: Math.max(0, dMax), down: Math.max(0, dMin), min: d.min ?? 0.01, max: d.max ?? Infinity };
      }
    }
    // One parameter drives one handle (a radius growing a crown both ways: the widest axis keeps it).
    const used = new Set<string>();
    for (const b of best) if (b && !used.has(b.key)) {
      used.add(b.key);
      out.push(b);
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(k, out);
  return out;
}
