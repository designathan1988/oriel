// One roof over adjacent volumes. Two volumes side by side with the same top and the
// same sloped roof (an L made of two blocks, a wing against a body) used to get a roof
// each: where they met there was a V gap (hip) or a gable end against the other slope
// (gable). They now get a single roof over the outline of their union, from the same
// weighted straight skeleton that already roofs an L drawn as one plan (valley at the
// inner corner, hip at the outer one). Overhang only on the outside. No three.
import * as clipNs from 'polygon-clipping';
import type { Building3, PlanVertex, Solid, Vec2 } from '../model/schema';
import { solidRings } from './body';
import { simplifyRing } from '../../geometry/polygon';

const clip = ((clipNs as unknown as { default?: typeof clipNs }).default ?? clipNs) as typeof clipNs;

/** Roofs made by the straight skeleton (the ones that can continue over a neighbor). */
const SLOPED = new Set(['gable', 'hip', 'mansard', 'gambrel']);

export interface RoofGroup {
  members: Solid[];
  /** Volume standing for the group: the union outline at the top of the members, their roof. */
  roofSolid: Solid;
}

const key = (s: Solid) => `${Math.round((s.base + s.height) * 50)}|${s.roof.kind}|${s.roof.pitch.toFixed(2)}|${s.roof.overhang.toFixed(2)}|${s.roof.thickness.toFixed(2)}|${s.roof.direction.toFixed(1)}`;

type Poly = [number, number][][];

function union(a: Poly[], b: Poly): Poly[] | null {
  try {
    return clip.union(a as never, [b] as never) as unknown as Poly[];
  } catch {
    return null;
  }
}

/** Distance from p to segment ab. */
function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
}

/**
 * Groups of additive volumes that share a roof: same top, same sloped roof settings, and
 * top outlines that touch or overlap (one polygon when joined). Groups of one are left out.
 */
export function roofGroups(b: Building3, hidden: (s: Solid) => boolean): RoofGroup[] {
  const buckets = new Map<string, Solid[]>();
  for (const s of b.solids) {
    if (s.op !== 'add' || hidden(s) || !SLOPED.has(s.roof.kind) || s.revolve || s.loft) continue;
    const k = key(s);
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(s);
  }
  const out: RoofGroup[] = [];
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const tops = new Map(list.map((s) => [s, solidRings(s).topOuter.map((p) => [p[0], p[1]] as [number, number])]));
    // Connected components: a volume joins a group when the union stays one polygon.
    const groups: { members: Solid[]; poly: Poly[] }[] = [];
    for (const s of list) {
      const ring = tops.get(s)!;
      const hit: number[] = [];
      groups.forEach((g, i) => {
        const u = union(g.poly, [ring]);
        if (u && u.length === g.poly.length) hit.push(i);
      });
      if (!hit.length) {
        groups.push({ members: [s], poly: [[ring]] });
        continue;
      }
      // Joins every group it touches (they become one).
      const first = groups[hit[0]!]!;
      first.members.push(s);
      first.poly = union(first.poly, [ring]) ?? first.poly;
      for (const i of hit.slice(1).reverse()) {
        const g = groups[i]!;
        first.members.push(...g.members);
        for (const p of g.poly) first.poly = union(first.poly, p) ?? first.poly;
        groups.splice(i, 1);
      }
    }
    for (const g of groups) {
      if (g.members.length < 2 || g.poly.length !== 1) continue;
      const [outer, ...holes] = g.poly[0]!.map((r) => {
        const pts = r.slice(0, r.length > 1 && r[0]![0] === r.at(-1)![0] && r[0]![1] === r.at(-1)![1] ? -1 : undefined) as Vec2[];
        return simplifyRing(pts, 0.01, 1e-5);
      });
      const first = [...g.members].sort((p, q) => b.solids.indexOf(p) - b.solids.indexOf(q))[0]!;
      const vert = (pts: Vec2[], prefix: string): PlanVertex[] => pts.map((p, i) => ({ id: `${first.id}~${prefix}${i}`, p: [p[0], p[1]] }));
      const plan = { outer: vert(outer!, 'o'), holes: holes.map((h, k) => vert(h, `h${k}_`)) };
      // A side marked as a gable on a member stays a gable on the joined outline.
      const edges: Solid['edges'] = {};
      for (const ring of [plan.outer, ...plan.holes])
        ring.forEach((v, i) => {
          const w = ring[(i + 1) % ring.length]!;
          const m: Vec2 = [(v.p[0] + w.p[0]) / 2, (v.p[1] + w.p[1]) / 2];
          for (const s of g.members) {
            const r = s.plan.outer;
            r.forEach((a, j) => {
              if (!s.edges[a.id]?.gable) return;
              if (segDist(m, a.p, r[(j + 1) % r.length]!.p) < 1e-3) edges[v.id] = { gable: true };
            });
          }
        });
      const top = first.base + first.height;
      const roofSolid: Solid = { ...first, plan, base: top - 1, height: 1, taper: 0, edges, plinth: 0, facade: [], bands: [] };
      delete roofSolid.bevel;
      out.push({ members: g.members, roofSolid });
    }
  }
  return out;
}
