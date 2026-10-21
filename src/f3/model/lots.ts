// Lots and urban indices on forma/3 (pure: no three).
//
// The legacy src/core/indices.ts works on forma/2 data (masses, storeys); this is
// the same idea rebuilt on forma/3 solids: plans are sampled with model/plan.ts,
// moved to the world with model/ops.ts (toWorld) and combined with
// polygon-clipping (the same ESM workaround as model/compose.ts).
//
// Definitions
// ───────────
// footprint  built plan area: union of the additive volumes, clipped to the lot.
// gfa        gross floor area: for each level, the union of the plans of the
//            volumes that cover its floor elevation (a volume covers a level when
//            base ≤ level.elevation < base + height), summed over the levels and
//            the buildings.
// volume     Σ additive plan area × height − Σ subtractive plan area × height.
// maxHeight  top of the highest volume (with an approximate roof rise) above the
//            building base elevation.
// setbacks   distance from the buildings' outlines to each side of the lot.
import * as clipNs from 'polygon-clipping';
import type { Lot } from '../../core/schema';
import type { Building3, PlanVertex, Project3, Solid, Vec2 } from './schema';
import { oriented, sampleRing, signedArea2 } from './plan';
import { toWorld } from './ops';

// The package has named exports in its types but only a default export in ESM.
const clip = ((clipNs as unknown as { default?: typeof clipNs }).default ?? clipNs) as typeof clipNs;

type ClipRing = Vec2[];
/** Outer ring plus holes. */
type ClipPoly = ClipRing[];
type ClipMulti = ClipPoly[];

/** Height (m) tolerance of "a volume covers this level". */
const EPS = 1e-6;

export interface LotIndices {
  lotArea: number;
  footprint: number;
  occupancy: number;
  gfa: number;
  far: number;
  permeable: number;
  maxHeight: number;
  setbacks: { min: number; perSide: number[] };
}

/** Lot used by the tests and by the tools: a rectangle, counterclockwise in [x, z]. */
export function rectLot(id: string, w: number, d: number, cx = 0, cz = 0): Lot {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  return {
    id,
    name: id,
    polygon: [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ],
    frontEdges: [0],
  };
}

/** Signed area of a ring (m²); positive on a counterclockwise ring. */
function ringArea(r: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Net area (m²) of a polygon with holes. */
function polyArea(p: ClipPoly): number {
  const outer = p[0] as Vec2[] | undefined;
  if (!outer) return 0;
  return Math.abs(ringArea(outer)) - p.slice(1).reduce((s, h) => s + Math.abs(ringArea(h as Vec2[])), 0);
}

function multiArea(m: ClipMulti): number {
  return m.reduce((s, p) => s + polyArea(p), 0);
}

/** Union of a set of polygons; an empty or broken set gives no area. */
function unionAll(polys: ClipPoly[]): ClipMulti {
  if (polys.length === 0) return [];
  try {
    return clip.union(polys[0]!, ...polys.slice(1));
  } catch {
    // A degenerate ring (self-touching, zero area): no area is counted.
    return [];
  }
}

/** World plan of a ring: sampled (arcs and corners) and moved by the building frame. */
function worldRing(b: Building3, ring: PlanVertex[]): Vec2[] {
  return sampleRing(oriented(ring, 1)).pts.map((p) => toWorld(b, p));
}

/** Additive volume that takes part in the plans (a hidden cutter still cuts). */
const isAdd = (s: Solid): boolean => s.op === 'add' && !s.hidden;

/** Does this volume cover the floor elevation `y` (building frame)? */
const covers = (s: Solid, y: number): boolean => s.base <= y + EPS && y < s.base + s.height - EPS;

/** Lot polygon in world coordinates (`Lot.polygon` is already counterclockwise in the world). */
function lotRing(lot: Lot): Vec2[] {
  return lot.polygon;
}

/** Bounding box of the plan, in the building frame (m). */
function planSpan(s: Solid): [number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const v of s.plan.outer) {
    x0 = Math.min(x0, v.p[0]);
    x1 = Math.max(x1, v.p[0]);
    z0 = Math.min(z0, v.p[1]);
    z1 = Math.max(z1, v.p[1]);
  }
  return x1 >= x0 ? [x1 - x0, z1 - z0] : [0, 0];
}

/** Extra height (m) of the roof above the top of the walls (approximate: a flat roof keeps its parapet). */
function roofRise(s: Solid): number {
  const r = s.roof;
  if (r.kind === 'flat' || r.kind === 'terrace') return Math.max(0, r.parapet);
  const half = Math.min(planSpan(s)[0], planSpan(s)[1]) / 2;
  if (r.kind === 'dome' || r.kind === 'vault') return r.rise > 0 ? r.rise : half;
  if (r.kind === 'pyramid' || r.kind === 'hip' || r.kind === 'gable' || r.kind === 'shed' || r.kind === 'mansard' || r.kind === 'gambrel' || r.kind === 'sawtooth')
    return Math.max(0, Math.tan((r.pitch * Math.PI) / 180) * half);
  return 0;
}

/** Top of the highest additive volume above the ground (m). */
function topOf(b: Building3): number {
  const e = b.elevation ?? 0;
  let top = 0;
  for (const s of b.solids) {
    if (!isAdd(s)) continue;
    top = Math.max(top, e + s.base + s.height + roofRise(s));
  }
  return top;
}

/** Area (m²) of the volumes covering each level of a building. */
function levelAreas(b: Building3): { level: string; area: number }[] {
  const add = b.solids.filter(isAdd);
  // A cutter through a floor (a shaft, an atrium, a courtyard) takes its outline out of that floor's area.
  const cut = b.solids.filter((s) => s.op === 'subtract' && !s.hidden);
  return b.levels.map((lv) => {
    const polys: ClipPoly[] = add.filter((s) => covers(s, lv.elevation)).map((s) => [worldRing(b, s.plan.outer)]);
    const holes: ClipPoly[] = cut.filter((s) => covers(s, lv.elevation)).map((s) => [worldRing(b, s.plan.outer)]);
    let area = unionAll(polys);
    if (holes.length && area.length) {
      try {
        area = clip.difference(area, ...holes);
      } catch {
        /* a degenerate ring: the floor keeps its whole area */
      }
    }
    return { level: lv.name, area: multiArea(area) };
  });
}

/** Distance (m) from a point to a segment. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t));
}

/** Distance from the buildings' outlines to every side of the lot (m). */
function setbacksOf(ring: Vec2[], buildings: Building3[]): { min: number; perSide: number[] } {
  const pts: Vec2[] = [];
  for (const b of buildings) for (const s of b.solids) if (isAdd(s)) pts.push(...worldRing(b, s.plan.outer));
  const perSide: number[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    let min = Infinity;
    for (const q of pts) min = Math.min(min, distToSegment(q, a, b));
    perSide.push(Number.isFinite(min) ? Math.round(min * 1000) / 1000 : 0);
  }
  return { min: perSide.length ? Math.min(...perSide) : 0, perSide };
}

/** Areas of one building: built footprint, gross floor area, volume and area per level. */
export function buildingAreas(b: Building3): { footprint: number; gfa: number; volume: number; perLevel: { level: string; area: number }[] } {
  const add = b.solids.filter(isAdd);
  const footprint = multiArea(unionAll(add.map((s) => [worldRing(b, s.plan.outer)])));
  const perLevel = levelAreas(b);
  let gfa = 0;
  for (const l of perLevel) gfa += l.area;
  let volume = 0;
  for (const s of b.solids) {
    if (s.op === 'intersect') continue;
    const a = Math.abs(ringArea(worldRing(b, s.plan.outer)));
    volume += (s.op === 'subtract' ? -1 : 1) * a * s.height;
  }
  return { footprint, gfa, volume, perLevel };
}

/**
 * Urban indices of a lot: everything built on it (buildings with `lotId = lotId`).
 * The footprint is clipped to the lot (what falls outside is not built area of the
 * lot); the floor area is not, so a building crossing the boundary keeps its whole
 * area (like the legacy core/indices.ts).
 */
export function lotIndices(p: Project3, lotId: string): LotIndices | null {
  const lot = p.lots.find((l) => l.id === lotId);
  if (!lot) return null;
  const ring = lotRing(lot);
  const lotArea = Math.abs(ringArea(ring));
  const lotPoly: ClipPoly = [ring];
  const buildings = p.buildings.filter((b) => b.lotId === lotId);
  // Occupancy: the union of the additive volumes, clipped to the lot.
  const prints: ClipPoly[] = [];
  for (const b of buildings) for (const s of b.solids) if (isAdd(s)) prints.push([worldRing(b, s.plan.outer)]);
  const merged = unionAll(prints);
  let footprint = 0;
  for (const poly of merged) {
    try {
      footprint += multiArea(clip.intersection(poly, lotPoly));
    } catch {
      // A degenerate ring: skipped.
    }
  }
  let gfa = 0;
  let maxHeight = 0;
  for (const b of buildings) {
    for (const l of levelAreas(b)) gfa += l.area;
    maxHeight = Math.max(maxHeight, topOf(b));
  }
  return {
    lotArea,
    footprint,
    occupancy: lotArea > 0 ? footprint / lotArea : 0,
    gfa,
    far: lotArea > 0 ? gfa / lotArea : 0,
    permeable: lotArea > 0 ? Math.max(0, lotArea - footprint) / lotArea : 1,
    maxHeight,
    setbacks: setbacksOf(ring, buildings),
  };
}

/** Area of a closed ring in world coordinates (m²); exported for tests and tools. */
export function planArea(ring: readonly Vec2[]): number {
  return Math.abs(ringArea(ring)) ;
}

/** Signed area of a ring (positive = counterclockwise); exported for tests and tools. */
export function ringSignedArea(ring: readonly Vec2[]): number {
  return ringArea(ring);
}

/** Kept next to the areas above: the oriented ring of a volume, ready for the tools. */
export function outerRing(b: Building3, s: Solid): Vec2[] {
  return worldRing(b, s.plan.outer);
}

/** Re-exported so callers do not need model/plan.ts to check an outline. */
export { signedArea2 };
