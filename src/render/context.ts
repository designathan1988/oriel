// Resources shared between buildings (materials and the box geometry).
// Whoever creates the context owns it and must call dispose() at the end.
import * as THREE from 'three';
import type { MaterialKey } from '../geometry/parts';
import { createTextureCache } from './textures';
import { createModuleLibrary, type ModuleLibrary } from './modules';

export interface RenderContext {
  material(key: MaterialKey): THREE.MeshStandardMaterial;
  readonly boxGeometry: THREE.BoxGeometry;
  /** Style glTF modules (loaded once per URL). */
  readonly modules: ModuleLibrary;
  /** Whether the resource belongs to the context (the building must not free it). */
  owns(resource: THREE.Material | THREE.BufferGeometry): boolean;
  dispose(): void;
}

export function createRenderContext(): RenderContext {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const owned = new Set<THREE.Material | THREE.BufferGeometry>([boxGeometry]);
  const textures = createTextureCache();
  const modules = createModuleLibrary();
  return {
    boxGeometry,
    modules,
    material(key) {
      const id = `${key.role}|${key.color}|${key.roughness}|${key.metalness ?? 0}|${key.doubleSide ? 2 : 1}|${key.texture ?? ''}|${key.textureScale ?? 1}|${key.foliage ?? ''}`;
      let m = materials.get(id);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color: key.color,
          roughness: key.roughness,
          metalness: key.metalness ?? 0,
          side: key.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
        m.name = key.role;
        if (key.texture) m.map = textures.get(key.texture, key.textureScale ?? 1);
        materials.set(id, m);
        owned.add(m);
      }
      return m;
    },
    owns: (r) => owned.has(r),
    dispose() {
      for (const r of owned) r.dispose();
      owned.clear();
      materials.clear();
      textures.dispose();
      modules.dispose();
    },
  };
}
