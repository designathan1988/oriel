// Project material library (Revit's project materials, SketchUp's "In model"): named materials kept in
// the project. Faces keep their material inline (the evaluation reads it there), so "change everywhere"
// rewrites every face that carries the same material as the library entry: the walls, roofs, trims,
// bases and floors of the volumes and each side painted on its own. Pure, no three.
import type { MaterialRef, Project3 } from './schema';

const key = (m: MaterialRef) => JSON.stringify([m.finish, m.color.toLowerCase(), m.color2?.toLowerCase() ?? null, m.params ?? null, m.rough ?? null, m.metal ?? null, m.scale ?? null, m.rot ?? null, m.glow ?? null, m.opacity ?? null, m.image ?? null]);

/** Same material (finish, colors and pattern). */
export const sameMaterial = (a: MaterialRef, b: MaterialRef) => key(a) === key(b);

/** How many faces of the project carry this material. */
export function materialUses(p: Project3, m: MaterialRef): number {
  let n = 0;
  for (const b of p.buildings)
    for (const s of b.solids) {
      for (const slot of ['wall', 'roof', 'trim', 'base', 'floor'] as const) if (s.materials[slot] && sameMaterial(s.materials[slot]!, m)) n++;
      for (const e of Object.values(s.edges)) if (e.material && sameMaterial(e.material, m)) n++;
    }
  return n;
}

/** Every face with material `from` gets `to`; returns how many changed (and the buildings touched). */
export function replaceMaterial(p: Project3, from: MaterialRef, to: MaterialRef): { count: number; buildings: string[] } {
  let count = 0;
  const buildings = new Set<string>();
  for (const b of p.buildings)
    for (const s of b.solids) {
      for (const slot of ['wall', 'roof', 'trim', 'base', 'floor'] as const) {
        const cur = s.materials[slot];
        if (cur && sameMaterial(cur, from)) {
          s.materials[slot] = structuredClone(to);
          count++;
          buildings.add(b.id);
        }
      }
      for (const e of Object.values(s.edges))
        if (e.material && sameMaterial(e.material, from)) {
          e.material = structuredClone(to);
          count++;
          buildings.add(b.id);
        }
    }
  return { count, buildings: [...buildings] };
}
