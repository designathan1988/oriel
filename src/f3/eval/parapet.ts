// Parapet of flat roofs and terraces. Volumes of the same height that
// touch form a single roof: the parapet follows the outline of the UNION of the
// tops (Manifold CrossSection), so no low wall is left at the seam between a
// volume and its extruded annex.
import type { Solid, Vec2 } from '../model/schema';
import { kernel, usable, type Manifold, type Scope } from '../kernel/kernel';
import { solidRings, type SolidRings } from './body';
import { FaceTable } from './faces';
import { MeshBuilder } from './mesh';

/** Parapet thickness and coping projection (m). */
const T = 0.22;
const CAP_OUT = 0.05;
const CAP_IN = 0.04;
const CAP_H = 0.09;

/** Height of the parapet top with its coping above the wall top (0 without a parapet). */
export const parapetTop = (parapet: number) => (parapet > 0 ? parapet + CAP_H - 0.02 : 0);

export const flatRoof = (s: Solid) => s.roof.kind === 'flat' || s.roof.kind === 'terrace';
/** Parapet height (a terrace has a guard of at least 1.05 m). */
export const parapetHeight = (s: Solid) => (s.roof.kind === 'terrace' ? Math.max(s.roof.parapet, 1.05) : s.roof.parapet);

/** Group key: top rounded to 2 cm. */
export const topKey = (s: Solid) => Math.round((s.base + s.height) * 50);

/** Manifold mesh with a single source face (parapet/coping material). */
function tagged(m: Manifold, faceId: number, scope: Scope): Manifold | null {
  const k = kernel();
  const mesh = m.getMesh();
  const P = mesh.vertProperties,
    np = mesh.numProp,
    I = mesh.triVerts;
  const mb = new MeshBuilder();
  for (let t = 0; t < I.length; t += 3) {
    const v = (i: number): [number, number, number] => [P[i * np]!, P[i * np + 1]!, P[i * np + 2]!];
    mb.triangle(v(I[t]!), v(I[t + 1]!), v(I[t + 2]!), faceId);
  }
  if (mb.empty) return null;
  const out = scope.keep(mb.toManifold(k));
  return usable(out) ? out : null;
}

/**
 * Parapet and coping of a group of flat volumes with the same top. The faces
 * belong to the first volume of the group (its material).
 */
export function groupParapet(members: Solid[], table: FaceTable, scope: Scope, coveredOf: (s: Solid) => ReadonlySet<string> | undefined = () => undefined): Manifold[] {
  const k = kernel();
  const s0 = members[0]!;
  const h = Math.max(...members.map(parapetHeight));
  if (h <= 0.01) return [];
  const y = s0.base + s0.height;
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  try {
    // Outline of each top (with holes) on the CrossSection [x, −z] plane.
    const sections = members.map((s) => {
      const r = solidRings(s, coveredOf(s));
      const polys = [r.topOuter, ...r.topHoles].map((ring) => ring.map((p) => [p[0], -p[1]] as Vec2));
      return keep(new k.CrossSection(polys, 'EvenOdd'));
    });
    const U = keep(k.CrossSection.union(sections));
    const prism = (cs: { delete(): void }, y0: number, y1: number) => keep(k.Manifold.extrude(cs as never, y1 - y0).rotate([-90, 0, 0]).translate([0, y0, 0]));
    const ring = (outerD: number, innerD: number) => keep(keep(U.offset(outerD, 'Miter', 4)).subtract(keep(U.offset(-innerD, 'Miter', 4))));
    const out: Manifold[] = [];
    const wall = tagged(prism(ring(0, T), y - 0.01, y + h), table.add({ kind: 'parapet', solid: s0.id }), scope);
    if (wall) out.push(wall);
    const cap = tagged(prism(ring(CAP_OUT, T + CAP_IN), y + h - 0.02, y + h + CAP_H - 0.02), table.add({ kind: 'coping', solid: s0.id }), scope);
    if (cap) out.push(cap);
    return out;
  } finally {
    for (const x of temp) x.delete();
  }
}

/** Volume outline (with holes) at a height `z` above the base, from the body rings. */
export function ringsAt(r: SolidRings, z: number): Vec2[][] {
  const y = r.base + z;
  const L = r.levels;
  let k = 0;
  while (k + 1 < L.length - 1 && L[k + 1]!.y < y) k++;
  const a = L[k]!,
    b = L[Math.min(k + 1, L.length - 1)]!;
  const t = b.y > a.y ? Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y))) : 0;
  const lerp = (p: Vec2[], q: Vec2[]) => p.map((v, i) => [v[0] + (q[i]![0] - v[0]) * t, v[1] + (q[i]![1] - v[1]) * t] as Vec2);
  return [lerp(a.outer, b.outer), ...a.holes.map((h, i) => lerp(h, b.holes[i]!))];
}

/**
 * Bands, cornices and plinth bands: the volume outline at the profile height,
 * offset outward and extruded (a sweep along the outline). The cornice comes in
 * three steps (40 %, 70 %, 100 % of the projection).
 */
export function bandsManifold(s: Solid, r: SolidRings, table: FaceTable, scope: Scope): Manifold[] {
  if (!s.bands?.length || s.op !== 'add') return [];
  const k = kernel();
  const id = table.add({ kind: 'band', solid: s.id });
  const out: Manifold[] = [];
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  try {
    for (const b of s.bands) {
      if (!(b.height > 0.01 && b.depth > 0.005)) continue;
      const z0 = Math.max(0, Math.min(s.height - 0.01, b.y));
      const z1 = Math.min(s.height + (s.roof.kind === 'flat' || s.roof.kind === 'terrace' ? 0 : 0.3), z0 + b.height);
      if (z1 - z0 < 0.01) continue;
      const cs = keep(new k.CrossSection(ringsAt(r, (z0 + z1) / 2).map((ring) => ring.map((p) => [p[0], -p[1]] as Vec2)), 'EvenOdd'));
      const steps = b.profile === 'cornice' ? [0.4, 0.7, 1] : [1];
      const h = (z1 - z0) / steps.length;
      steps.forEach((f, i) => {
        const ring = keep(keep(cs.offset(b.depth * f, 'Miter', 4)).subtract(keep(cs.offset(-0.02, 'Miter', 4))));
        const prism = keep(k.Manifold.extrude(ring as never, h).rotate([-90, 0, 0]).translate([0, s.base + z0 + h * i, 0]));
        const m = tagged(prism, id, scope);
        if (m) out.push(m);
      });
    }
    return out;
  } finally {
    for (const x of temp) x.delete();
  }
}
