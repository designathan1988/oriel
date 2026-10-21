// Faster picking with three-mesh-bvh (https://github.com/gkjohnson/three-mesh-bvh): a bounding volume
// hierarchy over a mesh's triangles answers a ray in logarithmic time instead of testing every triangle.
// The editor casts rays on every hover and click, against shells of up to ~280k triangles (the tower).
// A tree is built only for a big geometry that keeps being hit (the third ray on the same geometry): a
// shell rebuilt on every frame of a drag stays on the plain test, which costs less than a tree per frame.
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';

/** Triangles (index count / 3) from which a tree pays off. */
const MIN_TRIANGLES = 3000;
/** Rays on the same geometry before its tree is built. */
const RAYS_BEFORE_TREE = 3;

let installed = false;

export function installBvh(): void {
  if (installed) return;
  installed = true;
  const geo = THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree; disposeBoundsTree: typeof disposeBoundsTree };
  geo.computeBoundsTree = computeBoundsTree;
  geo.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
    const g = this.geometry as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree?: () => void };
    if (!g.boundsTree && !(this as THREE.Object3D & { isInstancedMesh?: boolean }).isInstancedMesh) {
      const tris = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
      if (tris >= MIN_TRIANGLES) {
        const n = ((g.userData.rays as number | undefined) ?? 0) + 1;
        g.userData.rays = n;
        if (n >= RAYS_BEFORE_TREE) g.computeBoundsTree?.();
      }
    }
    return acceleratedRaycast.call(this, raycaster, hits);
  };
}
