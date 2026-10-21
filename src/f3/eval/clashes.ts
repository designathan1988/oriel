// Clashes the drawing should not have (Revit's interference check, ArchiCAD's collision detection, kept
// to what a house plan gets wrong most): a straight stair whose flight crosses an interior wall of its
// floor, or runs through the building's outer wall. Plan only, in the building frame; one warning each.
import type { Building3, Vec2 } from '../model/schema';
import { sampleRing } from '../model/plan';
import { inside } from '../model/ops';
import { slabOpeningFor, stairRun } from '../model/stairs';
import { typeById } from '../families/index';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
}

/** Does a wall (centre line a→b, `t` thick) cut into a convex ring, 2 cm of tolerance? */
function wallInRing(a: Vec2, b: Vec2, t: number, ring: Vec2[]): boolean {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(L / 0.05));
  for (let i = 0; i <= n; i++) {
    const q: Vec2 = [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n];
    const edge = Math.min(...ring.map((r, j) => segDist(q, r, ring[(j + 1) % ring.length]!)));
    if (inside(q, ring) ? edge > 0.02 : edge < t / 2 - 0.02) return true;
  }
  return false;
}

export function stairClashes(b: Building3): string[] {
  const out: string[] = [];
  const levels = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  for (const it of b.items) {
    if (it.host.kind !== 'free') continue;
    const ty = typeById(it.type);
    if (ty?.family !== 'stair' || (ty.params.shape && ty.params.shape !== 'straight') || (it.params.shape && it.params.shape !== 'straight')) continue;
    const y = it.host.p[1];
    const lv = levels.find((l) => Math.abs(l.elevation - y) < 0.15);
    if (!lv) continue;
    const ring = slabOpeningFor(it, stairRun(num(it.params.rise, 3), num(it.params.going, 0.28), num(it.params.maxRiser, 0.18))).outer;
    const plan = b.interiors?.[lv.id];
    if (plan) {
      const node = new Map(plan.nodes.map((n) => [n.id, n.p]));
      if (plan.walls.some((w) => node.has(w.a) && node.has(w.b) && wallInRing(node.get(w.a)!, node.get(w.b)!, w.thickness, ring))) out.push(`A stair crosses an interior wall on ${lv.name}.`);
    }
    // Through the outer walls: a corner of the flight outside every volume of that floor, or inside its wall.
    const vols = b.solids.filter((s) => s.op === 'add' && !s.hidden && s.base <= y + 0.05 && s.base + s.height > y + 0.5);
    if (!vols.length) continue;
    const clear = (q: Vec2) =>
      vols.some((s) => {
        const r = sampleRing(s.plan.outer).pts;
        const wall = s.shell ?? 0;
        return inside(q, r) && r.every((p, j) => segDist(q, p, r[(j + 1) % r.length]!) >= wall - 0.02);
      });
    if (ring.some((q) => !clear(q))) out.push(`A stair runs into the outer wall on ${lv.name}.`);
  }
  return out;
}
