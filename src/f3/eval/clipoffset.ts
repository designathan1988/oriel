// Robust plan offset with Clipper2 (through Manifold's CrossSection.offset, the ClipperOffset class):
// used when the exact offset (concentric arcs, side IDs kept) cannot keep the shape — a part
// vanishes or the outline splits. Clipper drops what collapses and returns what is left, each
// connected piece with its holes. Arcs come back sampled. No three.
import type { Solid, Vec2 } from '../model/schema';
import { oriented, sampleRing } from '../model/plan';
import { kernel } from '../kernel/kernel';

export type OffsetCorner = 'sharp' | 'round' | 'chamfer';

/** Pieces left after offsetting the plan by `d` (m; > 0 grows). Empty: nothing is left. */
export function clipperOffset(plan: Solid['plan'], d: number, corner: OffsetCorner): { outer: Vec2[]; holes: Vec2[][] }[] {
  const k = kernel();
  const rings = [sampleRing(oriented(plan.outer, 1)).pts, ...plan.holes.map((h) => sampleRing(oriented(h, -1)).pts)];
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  try {
    const cs = keep(new k.CrossSection(rings.map((r) => r.map((p) => [p[0], p[1]] as [number, number])), 'EvenOdd'));
    // Clipper2 joins: Miter (sharp, default miter limit 2), Round, Square (a chamfer at the offset distance).
    const off = keep(cs.offset(d, corner === 'round' ? 'Round' : corner === 'chamfer' ? 'Square' : 'Miter', 2));
    const pieces = off.decompose().map(keep);
    const out: { outer: Vec2[]; holes: Vec2[][] }[] = [];
    for (const piece of pieces) {
      const polys = piece.toPolygons().map((poly) => poly.map((p) => [p[0], p[1]] as Vec2));
      if (!polys.length) continue;
      // The outline is the ring with the largest area; the others are its holes.
      const area = (r: Vec2[]) => r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * p[1], 0) / 2;
      polys.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
      if (Math.abs(area(polys[0]!)) < 0.25) continue;
      out.push({ outer: polys[0]!, holes: polys.slice(1).filter((h) => Math.abs(area(h)) > 0.05) });
    }
    return out;
  } finally {
    for (const x of temp) x.delete();
  }
}
