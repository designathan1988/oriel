// Real bounds of what was evaluated (building frame): the shell after the
// booleans (a cutter never enlarges the box; roof and overhangs count) and
// the component parts (balconies, canopies). It is what the selection box, the
// gizmo, the handles and the dimensions use. No three.
import type { ID } from '../model/schema';
import type { Evaluated } from './evaluate';
import type { PartTag } from './parts';

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

const cache = new WeakMap<Evaluated, Map<string, Bounds | null>>();

/**
 * Box of what is in view. `solids` restricts it to the faces of those solids and
 * the parts attached to them (`partOf` says which solid a part belongs to);
 * without `solids`, the whole building counts; `bodyOnly` leaves the parts out. Nothing in view returns null.
 */
export function evaluatedBounds(ev: Evaluated, solids?: ReadonlySet<ID>, partOf?: (tag: PartTag) => ID | undefined, bodyOnly = false): Bounds | null {
  const key = (solids ? [...solids].sort().join(',') : '*') + (bodyOnly ? '|body' : '');
  let per = cache.get(ev);
  if (!per) cache.set(ev, (per = new Map()));
  if (per.has(key)) return per.get(key)!;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (z < min[2]) min[2] = z;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
    if (z > max[2]) max[2] = z;
  };
  const { positions: P, indices: I, faceOf } = ev.shell;
  for (let t = 0; t < faceOf.length; t++) {
    if (solids) {
      const f = ev.faces[faceOf[t]!];
      if (!f || !solids.has(f.solid)) continue;
    }
    for (let j = 0; j < 3; j++) {
      const i = I[t * 3 + j]! * 3;
      add(P[i]!, P[i + 1]!, P[i + 2]!);
    }
  }
  // The body alone (walls, roof and eave): what a building's dimensions measure (audit D3), the parts
  // (awnings, balconies) left out.
  const wants = (tag: number) => {
    if (bodyOnly) return false;
    if (!solids) return true;
    const t = ev.parts.tags[tag];
    const sid = t && (t.solid ?? partOf?.(t));
    return !!sid && solids.has(sid);
  };
  // Instanced primitives fit the centered unit cube (box and cylinders of radius 0.5 and height 1).
  for (const p of ev.parts.inst) {
    if (!wants(p.tag)) continue;
    const m = p.m;
    for (let c = 0; c < 8; c++) {
      const x = c & 1 ? 0.5 : -0.5,
        y = c & 2 ? 0.5 : -0.5,
        z = c & 4 ? 0.5 : -0.5;
      add(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
    }
  }
  for (const mp of ev.parts.meshes) {
    if (!wants(mp.tag)) continue;
    const q = mp.positions;
    for (let i = 0; i < q.length; i += 3) add(q[i]!, q[i + 1]!, q[i + 2]!);
  }
  const out = min[0] <= max[0] ? { min, max } : null;
  per.set(key, out);
  return out;
}
