// Align and distribute volumes (in the building frame) and buildings (in the
// world), by their bounding boxes. No three.
import type { Building3, Solid, Vec2 } from './schema';
import { oriented, sampleRing } from './plan';
import { toWorld, translateSolid } from './ops';

export type AlignOp = 'left' | 'centerX' | 'right' | 'front' | 'centerZ' | 'back' | 'base' | 'top' | 'distX' | 'distZ' | 'height';

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function boxOf(pts: Vec2[]): Box {
  const xs = pts.map((p) => p[0]),
    zs = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

const solidBox = (s: Solid): Box => boxOf(sampleRing(oriented(s.plan.outer, 1)).pts);

/** Offsets [dx, dz] per item to align/distribute the boxes. The first is the reference. */
export function alignDeltas(boxes: Box[], op: AlignOp): Vec2[] {
  const ref = boxes[0]!;
  if (op === 'distX' || op === 'distZ') {
    // Equal gaps between the items, keeping the end ones.
    const ax = op === 'distX';
    const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => (ax ? p.b.x0 - q.b.x0 : p.b.z0 - q.b.z0));
    const first = order[0]!.b,
      last = order[order.length - 1]!.b;
    const span = ax ? last.x1 - first.x0 : last.z1 - first.z0;
    const total = order.reduce((s, o) => s + (ax ? o.b.x1 - o.b.x0 : o.b.z1 - o.b.z0), 0);
    const gap = order.length > 1 ? (span - total) / (order.length - 1) : 0;
    const out: Vec2[] = boxes.map(() => [0, 0]);
    let cur = ax ? first.x0 : first.z0;
    for (const o of order) {
      const start = ax ? o.b.x0 : o.b.z0;
      out[o.i] = ax ? [cur - start, 0] : [0, cur - start];
      cur += (ax ? o.b.x1 - o.b.x0 : o.b.z1 - o.b.z0) + gap;
    }
    return out;
  }
  return boxes.map((b) => {
    switch (op) {
      case 'left':
        return [ref.x0 - b.x0, 0];
      case 'right':
        return [ref.x1 - b.x1, 0];
      case 'centerX':
        return [(ref.x0 + ref.x1) / 2 - (b.x0 + b.x1) / 2, 0];
      case 'front':
        return [0, ref.z0 - b.z0];
      case 'back':
        return [0, ref.z1 - b.z1];
      case 'centerZ':
        return [0, (ref.z0 + ref.z1) / 2 - (b.z0 + b.z1) / 2];
      default:
        return [0, 0];
    }
  });
}

/** Aligns volumes of a building (the first of the list is the reference). */
export function alignSolids(solids: Solid[], op: AlignOp): void {
  if (solids.length < 2) return;
  const ref = solids[0]!;
  if (op === 'base') {
    for (const s of solids) s.base = ref.base;
    return;
  }
  if (op === 'top') {
    for (const s of solids) s.base = ref.base + ref.height - s.height;
    return;
  }
  if (op === 'height') {
    for (const s of solids) s.height = ref.base + ref.height - s.base;
    return;
  }
  const d = alignDeltas(solids.map(solidBox), op);
  solids.forEach((s, i) => translateSolid(s, d[i]![0], d[i]![1]));
}

/**
 * Where a copy of a group goes: the nearest free place beside it (right, left, front, back, then two
 * and more steps away), by steps of the group's size plus `gap`, so that it touches none of `others`
 * (with `gap` around them). Used by Duplicate for buildings and volumes (audit D34: the copy crossed
 * the original).
 */
export function freeShift(group: Box[], others: Box[], gap: number): Vec2 {
  if (!group.length) return [gap, 0];
  const gx0 = Math.min(...group.map((q) => q.x0)),
    gx1 = Math.max(...group.map((q) => q.x1)),
    gz0 = Math.min(...group.map((q) => q.z0)),
    gz1 = Math.max(...group.map((q) => q.z1));
  const m = gap / 2;
  const free = (dx: number, dz: number) => !others.some((q) => gx0 + dx < q.x1 + m && gx1 + dx > q.x0 - m && gz0 + dz < q.z1 + m && gz1 + dz > q.z0 - m);
  const W = gx1 - gx0 + gap,
    D = gz1 - gz0 + gap;
  for (let k = 1; k <= 8; k++) for (const t of [[W * k, 0], [-W * k, 0], [0, D * k], [0, -D * k]] as Vec2[]) if (free(t[0], t[1])) return t;
  return [W, 0];
}

/** Plan box of a volume in its building frame. */
export const volumeBox = solidBox;

/** Plan box of a building in the world (its adding volumes). */
export function buildingBox(b: Building3): Box | null {
  const pts = b.solids.filter((s) => s.op === 'add').flatMap((s) => sampleRing(oriented(s.plan.outer, 1)).pts.map((p) => toWorld(b, p)));
  return pts.length ? boxOf(pts) : null;
}

export type { Box as PlanBox };

/** Aligns buildings in the world by their plan boxes. */
export function alignBuildings(bs: Building3[], op: AlignOp): void {
  if (bs.length < 2 || op === 'base' || op === 'top' || op === 'height') return;
  const boxes = bs.map((b) => boxOf(b.solids.filter((s) => s.op === 'add').flatMap((s) => sampleRing(oriented(s.plan.outer, 1)).pts.map((p) => toWorld(b, p)))));
  const d = alignDeltas(boxes, op);
  bs.forEach((b, i) => (b.position = [b.position[0] + d[i]![0], b.position[1] + d[i]![1]]));
}
