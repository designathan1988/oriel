// Exploded floors lifted in place: the Y of each vertex is its height as built plus
// its floor × the gap. Only the Y of the positions is written (no new mesh, normals
// or UVs), and the bounds come from each floor's own Y range instead of another pass
// over the vertices (that pass cost more than the lift itself on 200 buildings).
import * as THREE from 'three';

/**
 * Lift for a geometry whose vertex `v` belongs to floor `floors[v]` (an index ≥ 0).
 * Returns the function that applies a gap; the bounding box stays exact and the
 * bounding sphere is the one around it (it holds every vertex, which is all that
 * ray picking and frustum culling ask of it).
 */
export function floorLift(geo: THREE.BufferGeometry, attr: THREE.BufferAttribute, floors: ArrayLike<number>): (gap: number) => void {
  const pos = attr.array as Float32Array;
  const n = floors.length;
  const baseY = new Float32Array(n);
  let top = 0;
  for (let v = 0; v < n; v++) {
    baseY[v] = pos[v * 3 + 1]!;
    top = Math.max(top, floors[v]! | 0);
  }
  const lo = new Float32Array(top + 1).fill(Infinity),
    hi = new Float32Array(top + 1).fill(-Infinity);
  for (let v = 0; v < n; v++) {
    const k = floors[v]! | 0,
      y = baseY[v]!;
    if (y < lo[k]!) lo[k] = y;
    if (y > hi[k]!) hi[k] = y;
  }
  // X and Z never change.
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  return (gap) => {
    for (let v = 0; v < n; v++) pos[v * 3 + 1] = baseY[v]! + (floors[v]! | 0) * gap;
    attr.needsUpdate = true;
    box.min.y = Infinity;
    box.max.y = -Infinity;
    // Rounded like the stored positions (Float32), so the box is exactly theirs.
    for (let k = 0; k <= top; k++) {
      if (lo[k]! > hi[k]!) continue;
      box.min.y = Math.min(box.min.y, Math.fround(lo[k]! + k * gap));
      box.max.y = Math.max(box.max.y, Math.fround(hi[k]! + k * gap));
    }
    box.getBoundingSphere((geo.boundingSphere ??= new THREE.Sphere()));
  };
}
