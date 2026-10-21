// Component parts → three.js: one InstancedMesh per (primitive, material)
// and one merged mesh per material for the profiles. Primitive geometries
// are shared (from the context); each building frees only what it created.
import * as THREE from 'three';
import { extraKey, type MaterialKey } from '../../geometry/parts';
import type { RenderContext } from '../../render/context';
import type { PartMat } from '../families/family';
import type { InstPart, Parts3, PartTag } from '../eval/parts';
import { metricUVs } from '../../render/build-building';
import { materialKey } from './finishes';
import { floorLift } from './lift';
import { foliageMaterial, foliageMeshes } from './foliage';

const SLOT_ROLE: Record<PartMat['slot'], MaterialKey['role']> = {
  frame: 'frame',
  glass: 'glass',
  panel: 'frame',
  metal: 'frame',
  wood: 'frame',
  stone: 'stone',
  concrete: 'stone',
  wall: 'wall',
  roof: 'roof',
  green: 'green',
  fabric: 'frame',
  light: 'frame',
  dark: 'frame',
};

const SLOT_FINISH: Partial<Record<PartMat['slot'], string>> = { glass: 'glass', metal: 'metal', wood: 'wood', stone: 'stone', concrete: 'concrete', green: 'paint', fabric: 'paint', light: 'paint', dark: 'paint' };

export function partMaterial(m: PartMat, textured = true): MaterialKey {
  if (m.foliage) return { role: 'green', color: m.color, roughness: 0.8, doubleSide: true, foliage: m.foliage };
  const finish = m.finish ?? SLOT_FINISH[m.slot] ?? 'paint';
  if (m.image !== undefined) return { role: 'frame', color: '#ffffff', roughness: 0.65, image: m.image };
  const full = materialKey({ finish, color: m.color, ...(m.color2 ? { color2: m.color2 } : {}), ...(m.surface ?? {}) }, SLOT_ROLE[m.slot]);
  // Instanced primitives have unit UVs: no texture (it would stretch the pattern).
  const { texture, textureScale, ...plain } = full;
  void textureScale;
  const key: MaterialKey = textured && texture ? full : plain;
  if (m.slot === 'glass') return { ...key, roughness: 0.08, metalness: 0.45 };
  if (m.slot === 'light') return { ...key, roughness: 0.4, lamp: true };
  // Only window curtains (awnings are fabric too, but do not light up).
  if (m.curtain) return { ...key, curtain: true };
  return key;
}

const shared = new WeakMap<RenderContext, Record<InstPart['shape'], THREE.BufferGeometry>>();

function primitives(ctx: RenderContext): Record<InstPart['shape'], THREE.BufferGeometry> {
  let p = shared.get(ctx);
  if (!p) {
    p = {
      box: ctx.boxGeometry,
      cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
      cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      cyl20: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
    };
    shared.set(ctx, p);
  }
  return p;
}

export interface PartsMesh {
  group: THREE.Group;
  /** Tag (component, rule) of each hit instance or triangle. */
  pick(hit: THREE.Intersection): PartTag | null;
  /** Exploded floors: each part rises by its floor × `gap`, in place (instance matrices, profile Y). */
  setGap(gap: number): void;
  /**
   * Categories hidden (Layers tab), when built with `category`: their meshes are switched off, nothing
   * is built again (before, a category eye rebuilt the parts of every building: 140–180 ms on 200).
   */
  setHidden(categories: ReadonlySet<string>): void;
  hidden: ReadonlySet<string>;
  /** The hidden categories as a string (equal means the same). */
  hiddenKey: string;
  dispose(): void;
}

const keyOf = (k: MaterialKey) => `${k.role}|${k.color}|${k.roughness}|${k.metalness ?? 0}|${k.texture ?? ''}|${k.textureScale ?? 1}|${k.finish ?? ''}|${k.color2 ?? ''}|${k.params ?? ''}|${k.image ?? ''}|${k.lamp ? 1 : 0}|${k.curtain ? 1 : 0}|${k.foliage ?? ''}${extraKey(k)}`;

/** `category`: meshes split by the category of their parts too, so that `setHidden` can switch them. */
export function buildPartsMesh(parts: Parts3, ctx: RenderContext, shadows = true, visible?: (tag: PartTag) => boolean, gap = 0, category?: (tag: PartTag) => string): PartsMesh {
  const catOf = (tag: number) => (category ? category(parts.tags[tag]!) : '');
  const show = visible ? parts.tags.map((t) => visible(t)) : null;
  const group = new THREE.Group();
  group.name = 'components';
  const created: THREE.BufferGeometry[] = [];
  const lifters: ((g: number) => void)[] = [];
  const prim = primitives(ctx);
  // Instances.
  const batches = new Map<string, { shape: InstPart['shape']; key: MaterialKey; list: InstPart[]; cat: string }>();
  for (const it of parts.inst) {
    if (show && !show[it.tag]) continue;
    const key = partMaterial(it.mat, false);
    const cat = catOf(it.tag);
    const id = `${it.shape}|${keyOf(key)}|${cat}`;
    let b = batches.get(id);
    if (!b) batches.set(id, (b = { shape: it.shape, key, list: [], cat }));
    b.list.push(it);
  }
  const m4 = new THREE.Matrix4();
  for (const b of batches.values()) {
    const mesh = new THREE.InstancedMesh(prim[b.shape], ctx.material(b.key), b.list.length);
    b.list.forEach((it, i) => {
      m4.fromArray(it.m);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Exploded floors: the part rises with its band (the translation Y of its matrix).
    if (b.list.some((it) => it.floor)) {
      const floors = Float32Array.from(b.list, (it) => it.floor ?? 0);
      const baseTy = Float32Array.from(b.list, (it) => it.m[13]!);
      const arr = mesh.instanceMatrix.array;
      lifters.push((g) => {
        for (let i = 0; i < floors.length; i++) arr[i * 16 + 13] = baseTy[i]! + floors[i]! * g;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      });
    }
    mesh.castShadow = shadows && b.key.role !== 'glass';
    mesh.receiveShadow = shadows;
    mesh.userData = { partTags: b.list.map((it) => it.tag), ...(category ? { category: b.cat } : {}) };
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  // Profiles: one mesh per material (and apart, the meshes with their own normals and UVs).
  const byMat = new Map<string, { key: MaterialKey; pos: number[]; nrm: number[] | null; uv: number[] | null; tags: number[]; floor: number[]; cat: string }>();
  for (const m of parts.meshes) {
    if (show && !show[m.tag]) continue;
    const key = partMaterial(m.mat);
    const cat = catOf(m.tag);
    const own = m.normals ? (m.uvs ? 'nu' : 'n') : '';
    const id = `${keyOf(key)}|${cat}|${own}`;
    let b = byMat.get(id);
    if (!b) byMat.set(id, (b = { key, pos: [], nrm: own ? [] : null, uv: own === 'nu' ? [] : null, tags: [], floor: [], cat }));
    if (b.nrm) for (let i = 0; i < m.positions.length; i++) b.nrm.push(m.normals![i]!);
    if (b.uv) for (let i = 0; i < m.uvs!.length; i++) b.uv.push(m.uvs![i]!);
    for (let i = 0; i < m.positions.length; i++) b.pos.push(m.positions[i]!);
    for (let i = 0; i < m.positions.length / 3; i++) b.floor.push(m.floor ?? 0);
    for (let i = 0; i < m.positions.length / 9; i++) b.tags.push(m.tag);
  }
  for (const b of byMat.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv ?? metricUVs(b.pos), 2));
    if (b.nrm) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    else g.computeVertexNormals();
    created.push(g);
    if (b.floor.some((f) => f)) lifters.push(floorLift(g, g.getAttribute('position') as THREE.BufferAttribute, Uint16Array.from(b.floor)));
    const mat = ctx.material(b.key);
    if (b.key.foliage && !mat.userData.foliage) {
      foliageMaterial(mat);
      mat.userData.foliage = true;
    }
    const mesh = new THREE.Mesh(g, mat);
    if (b.key.foliage) foliageMeshes.add(mesh);
    mesh.castShadow = shadows && b.key.role !== 'glass';
    mesh.receiveShadow = shadows;
    mesh.userData = { triTags: b.tags, ...(category ? { category: b.cat } : {}) };
    group.add(mesh);
  }
  let lifted = 0;
  const setGap = (g: number) => {
    if (g === lifted) return;
    lifted = g;
    for (const f of lifters) f(g);
  };
  setGap(gap);
  const self: PartsMesh = {
    group,
    setGap,
    hidden: new Set(),
    hiddenKey: '',
    setHidden(categories) {
      const key = [...categories].sort().join(',');
      if (key === self.hiddenKey) return;
      self.hidden = new Set(categories);
      self.hiddenKey = key;
      for (const c of group.children) {
        const cat = c.userData.category as string | undefined;
        if (cat === undefined) continue;
        const off = categories.has(cat);
        c.visible = !off;
        // The ray ignores visibility: picking reads this to go through hidden parts.
        c.userData.hidden = off;
      }
    },
    pick(hit) {
      const o = hit.object;
      const tags = o.userData.partTags as number[] | undefined;
      if (tags && hit.instanceId !== undefined) return parts.tags[tags[hit.instanceId]!] ?? null;
      const tt = o.userData.triTags as number[] | undefined;
      if (tt && hit.faceIndex !== undefined && hit.faceIndex !== null) return parts.tags[tt[hit.faceIndex]!] ?? null;
      return null;
    },
    dispose() {
      for (const c of group.children) if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
      for (const g of created) g.dispose();
      for (const c of group.children) foliageMeshes.delete(c);
      group.clear();
    },
  };
  return self;
}
