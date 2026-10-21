// Lot geometry: edge classification (front, sides, back) and
// buildable area with different setbacks per edge.
//
// Buildable area = lot − (setback band of each edge ∪ disc at each
// vertex). The band is the rectangle inward from the edge with the width of its
// setback; the disc (16-sided polygon) covers the wedge next to the reflex
// vertices, where the bands alone would leave points too close to the boundary.
import type { Lot, LotRules, Vec2 } from '../core/schema';
import { area, clean, signedArea } from './polygon';
import { difference, intersection, union, netArea, type PolygonWithHoles } from './boolean';

export type EdgeKind = 'front' | 'side' | 'back';

/** Lot polygon oriented counterclockwise (like the masses). */
export const lotPolygon = (lot: Lot): Vec2[] => (signedArea(lot.polygon) < 0 ? [...lot.polygon].reverse() : lot.polygon.map((p) => [p[0], p[1]] as Vec2));

/** Edge indices in the order of the oriented polygon. */
function orientedFront(lot: Lot): Set<number> {
  const n = lot.polygon.length;
  if (signedArea(lot.polygon) >= 0) return new Set(lot.frontEdges);
  // When the order is reversed, edge i (p_i → p_i+1) becomes edge n−2−i.
  return new Set(lot.frontEdges.map((i) => (((n - 2 - i) % n) + n) % n));
}

const outwardNormal = (a: Vec2, b: Vec2): Vec2 => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
};

/** Classifies each edge of the oriented polygon: front, side or back. */
export function edgeKinds(lot: Lot): EdgeKind[] {
  const p = lotPolygon(lot),
    n = p.length,
    front = orientedFront(lot);
  if (!front.size) return p.map(() => 'side');
  // Mean street direction: sum of the outward normals of the frontage edges.
  let fx = 0,
    fz = 0;
  for (const i of front) {
    const nn = outwardNormal(p[i]!, p[(i + 1) % n]!);
    fx += nn[0];
    fz += nn[1];
  }
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;
  return p.map((a, i) => {
    if (front.has(i)) return 'front';
    const nn = outwardNormal(a, p[(i + 1) % n]!);
    return nn[0] * fx + nn[1] * fz < -0.7 ? 'back' : 'side';
  });
}

function disc(c: Vec2, r: number, sides = 16): Vec2[] {
  return Array.from({ length: sides }, (_, k) => {
    const t = (k / sides) * Math.PI * 2;
    return [c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r] as Vec2;
  });
}

/** Area where one may build, respecting the setbacks (parts in world coordinates). */
export function buildableArea(lot: Lot, rules: LotRules | undefined = lot.rules): PolygonWithHoles[] {
  const p = lotPolygon(lot);
  if (!rules) return [[p]];
  const kinds = edgeKinds(lot),
    n = p.length;
  const setback = (k: EdgeKind) => Math.max(0, rules.setbacks[k]);
  const pieces: PolygonWithHoles[] = [];
  for (let i = 0; i < n; i++) {
    const s = setback(kinds[i]!);
    if (s <= 0) continue;
    const a = p[i]!,
      b = p[(i + 1) % n]!,
      [nx, nz] = outwardNormal(a, b);
    // Inward band (outward normal reversed), slightly past the ends.
    // The outer edge sits 1 cm outside the lot: outlines that coincide
    // exactly with the boundary break polygon-clipping.
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      l = Math.hypot(dx, dz) || 1,
      ex = (dx / l) * 0.01,
      ez = (dz / l) * 0.01,
      ox = nx * 0.01,
      oz = nz * 0.01;
    pieces.push([
      clean([
        [a[0] - ex + ox, a[1] - ez + oz],
        [b[0] + ex + ox, b[1] + ez + oz],
        [b[0] + ex - nx * s, b[1] + ez - nz * s],
        [a[0] - ex - nx * s, a[1] - ez - nz * s],
      ]),
    ]);
  }
  for (let i = 0; i < n; i++) {
    const r = Math.max(setback(kinds[(i - 1 + n) % n]!), setback(kinds[i]!));
    if (r > 0) pieces.push([disc(p[i]!, r)]);
  }
  if (!pieces.length) return [[p]];
  const band = union(pieces);
  let out: PolygonWithHoles[] = [[p]];
  for (const piece of band) {
    const next: PolygonWithHoles[] = [];
    for (const part of out) {
      // Subtracts the piece's outer ring; the piece's holes become buildable again.
      let rest = difference(part, piece[0]!);
      for (const h of piece.slice(1)) rest = [...rest, ...intersection(part, [h])];
      next.push(...rest);
    }
    out = next.filter((x) => netArea(x) > 0.01);
  }
  return out;
}

export const lotArea = (lot: Lot): number => area(lot.polygon);

/** Lot containing the point (a building center), if any. */
export function lotAt(lots: Lot[], x: number, z: number): Lot | undefined {
  return lots.find((l) => {
    const p = l.polygon;
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[i]!,
        b = p[j]!;
      if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  });
}
