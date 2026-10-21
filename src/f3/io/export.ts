// FORMA 3 3D export (GLB and OBJ) and the game JSON. The exported scene is
// built from scratch from the document, in full detail (no LOD and no
// floor section), with each building's position and rotation.
//  - GLB: repeated parts stay as InstancedMesh (extension
//    EXT_mesh_gpu_instancing, marked required by the GLTFExporter);
//    `expandInstances` merges the instances into plain meshes for programs that
//    do not read the extension.
//  - OBJ: OBJExporter only reads the base geometry of an InstancedMesh, so the
//    instances are always merged; meshes with several materials are split
//    by material (one `o`/`usemtl` each).
import { BRAND } from '../model/brand';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import type { Project3 } from '../model/schema';
import { evaluateBuilding } from '../eval/evaluate';
import { kernelReady, loadKernel } from '../kernel/kernel';
import { buildShellMesh, type ShellMesh } from '../render/shell';
import { buildPartsMesh, type PartsMesh } from '../render/parts';
import { terrainMesh } from '../render/site';
import { terrainField } from '../model/terrain';
import { createRenderContext, type RenderContext } from '../../render/context';

import { gameData } from './game';
import { zipStore, type ZipEntry } from './zip';
import { optimizeGlb } from './glbopt';

export { exportGameJSON, gameData } from './game';

export interface ExportOptions {
  /** Material context; without it, a temporary one is created and freed at the end. */
  ctx?: RenderContext;
  /** Merges the instances into plain meshes (default: false; OBJ always merges). */
  expandInstances?: boolean;
  /** URL of the kernel .wasm, if not loaded yet. */
  wasmUrl?: string;
  /** Texture limit in the GLB (px). */
  maxTextureSize?: number;
  /** Hollow buildings: walls with their thickness, a slab per floor and the interior walls (to walk inside). */
  hollow?: boolean;
}

export interface ExportScene {
  scene: THREE.Scene;
  /** Evaluation warnings (per building). */
  warnings: string[];
  dispose(): void;
}

/** Merges the copies of an InstancedMesh into one mesh (its own geometry). */
export function mergeInstances(im: THREE.InstancedMesh): THREE.Mesh {
  const src = im.geometry;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const nor = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const uv = src.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const index = src.getIndex();
  const nv = pos.count,
    n = im.count;
  const P = new Float32Array(nv * n * 3);
  const N = nor ? new Float32Array(nv * n * 3) : null;
  const U = uv ? new Float32Array(nv * n * 2) : null;
  const ni = index ? index.count : 0;
  const I = index ? new Uint32Array(ni * n) : null;
  const m = new THREE.Matrix4(),
    nm = new THREE.Matrix3(),
    v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    im.getMatrixAt(k, m);
    nm.getNormalMatrix(m);
    for (let i = 0; i < nv; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      v.toArray(P, (k * nv + i) * 3);
      if (N && nor) {
        v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        v.toArray(N, (k * nv + i) * 3);
      }
      if (U && uv) {
        U[(k * nv + i) * 2] = uv.getX(i);
        U[(k * nv + i) * 2 + 1] = uv.getY(i);
      }
    }
    if (I && index) for (let j = 0; j < ni; j++) I[k * ni + j] = index.getX(j) + k * nv;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (I) g.setIndex(new THREE.BufferAttribute(I, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, im.material);
  mesh.name = im.name;
  mesh.position.copy(im.position);
  mesh.quaternion.copy(im.quaternion);
  mesh.scale.copy(im.scale);
  return mesh;
}

/** Splits a multi-material mesh (non-indexed geometry with groups) into one mesh per group. */
export function splitByMaterial(mesh: THREE.Mesh): THREE.Mesh[] {
  const mats = mesh.material;
  if (!Array.isArray(mats)) return [mesh];
  const g = mesh.geometry;
  const out: THREE.Mesh[] = [];
  for (const grp of g.groups) {
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
      if (g.index) continue;
      const s = attr.itemSize;
      sub.setAttribute(name, new THREE.BufferAttribute((attr.array as Float32Array).slice(grp.start * s, (grp.start + grp.count) * s), s));
    }
    if (g.index) {
      // Does not happen with the shell (non-indexed); keeps the whole mesh.
      sub.dispose();
      return [mesh];
    }
    const material = mats[grp.materialIndex ?? 0]!;
    const m = new THREE.Mesh(sub, material);
    m.name = `${mesh.name}/${material.name || 'material'}`;
    m.userData = { ...mesh.userData };
    out.push(m);
  }
  return out;
}

/** Builds the export scene: one group per building, one mesh per solid and the components. */
export async function buildExportScene(project: Project3, opts: ExportOptions = {}): Promise<ExportScene> {
  if (!kernelReady()) await loadKernel(opts.wasmUrl);
  const ownCtx = !opts.ctx;
  const ctx = opts.ctx ?? createRenderContext();
  const shells: ShellMesh[] = [];
  const parts: PartsMesh[] = [];
  const created: THREE.BufferGeometry[] = [];
  const warnings: string[] = [];
  const scene = new THREE.Scene();
  scene.name = project.name;
  for (const b of project.buildings) {
    const ev = evaluateBuilding(b, { hidden: () => false, hollow: !!opts.hollow }, project);
    for (const w of ev.warnings) warnings.push(`${b.name}: ${w}`);
    const group = new THREE.Group();
    group.name = b.name;
    group.userData = { buildingId: b.id, use: b.use };
    group.position.set(b.position[0], b.elevation ?? 0, b.position[1]);
    group.rotation.y = (b.rotation * Math.PI) / 180;
    const ids = new Set(b.solids.map((s) => s.id));
    const pieces: { name: string; solidId?: string; test: (id: string) => boolean }[] = [
      ...b.solids.map((s) => ({ name: `${b.name}/${s.name}`, solidId: s.id, test: (id: string) => id === s.id })),
      // Faces without a known solid (openings of free components).
      { name: `${b.name}/openings`, test: (id: string) => !ids.has(id) },
    ];
    for (const pc of pieces) {
      const sm = buildShellMesh(b, ev, ctx, pc.test);
      if (!sm.faceOf.length) {
        sm.dispose();
        continue;
      }
      shells.push(sm);
      sm.mesh.name = pc.name;
      sm.mesh.userData = pc.solidId ? { buildingId: b.id, solidId: pc.solidId } : { buildingId: b.id };
      group.add(sm.mesh);
    }
    if (ev.parts.inst.length || ev.parts.meshes.length) {
      const pm = buildPartsMesh(ev.parts, ctx, false);
      parts.push(pm);
      pm.group.name = `${b.name}/components`;
      const children = [...pm.group.children] as THREE.Mesh[];
      for (const c of children) {
        const mat = c.material as THREE.Material;
        c.name = `${b.name}/components/${mat.name || 'material'}`;
        // Selection tags do not go into the file (huge extras in glTF).
        c.userData = { buildingId: b.id };
        if (opts.expandInstances && (c as THREE.InstancedMesh).isInstancedMesh) {
          const merged = mergeInstances(c as THREE.InstancedMesh);
          created.push(merged.geometry);
          merged.userData = { buildingId: b.id };
          pm.group.add(merged);
          pm.group.remove(c);
          (c as THREE.InstancedMesh).dispose();
        }
      }
      group.add(pm.group);
    }
    scene.add(group);
  }
  // The shaped ground (terrain) goes with the buildings, the lots tinted on it.
  const field = terrainField(project);
  let ground: THREE.Material | null = null;
  if (field) {
    const g = terrainMesh(field, project.lots.map((l) => l.polygon));
    created.push(g);
    ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, name: 'Terrain' });
    const m = new THREE.Mesh(g, ground);
    m.name = 'Terrain';
    scene.add(m);
  }
  scene.updateMatrixWorld(true);
  return {
    scene,
    warnings,
    dispose() {
      for (const s of shells) s.dispose();
      for (const p of parts) p.dispose();
      for (const g of created) g.dispose();
      ground?.dispose();
      scene.clear();
      if (ownCtx) ctx.dispose();
    },
  };
}

/** Binary GLB of the whole project. */
export async function exportGLB(project: Project3, opts: ExportOptions = {}): Promise<ArrayBuffer> {
  const es = await buildExportScene(project, opts);
  try {
    const data = await new GLTFExporter().parseAsync(es.scene, { binary: true, onlyVisible: true, ...(opts.maxTextureSize ? { maxTextureSize: opts.maxTextureSize } : {}) });
    return data as ArrayBuffer;
  } finally {
    es.dispose();
  }
}

/**
 * USDZ of the project for augmented reality (AR Quick Look on iPhone and iPad; three's USDZExporter):
 * metres, Y up, anchored on a horizontal plane. The instances are merged (USDZ takes plain meshes) and
 * the textures are at most 1024 px.
 */
export async function exportUSDZ(project: Project3, opts: ExportOptions = {}): Promise<Uint8Array> {
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
  const es = await buildExportScene(project, { ...opts, expandInstances: true });
  // USDZ takes standard materials only: the others (lamp glow, basic) become standard ones with their
  // colour, texture and glow.
  const made: THREE.Material[] = [];
  // …and one material per mesh: the shells (one material per face kind) are split by material, as for OBJ.
  const multi: THREE.Mesh[] = [];
  const splitGeo: THREE.BufferGeometry[] = [];
  es.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && Array.isArray((o as THREE.Mesh).material)) multi.push(o as THREE.Mesh);
  });
  for (const m of multi) {
    const parts = splitByMaterial(m);
    for (const q of parts) {
      q.position.copy(m.position);
      q.quaternion.copy(m.quaternion);
      q.scale.copy(m.scale);
      m.parent?.add(q);
      if (q !== m) splitGeo.push(q.geometry);
    }
    m.parent?.remove(m);
  }
  es.scene.updateMatrixWorld(true);
  es.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material): THREE.Material => {
      if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
      const src = mat as THREE.MeshBasicMaterial;
      const std = new THREE.MeshStandardMaterial({ color: src.color ?? new THREE.Color('#ffffff'), map: src.map ?? null, transparent: src.transparent, opacity: src.opacity, roughness: 0.6 });
      if (src.color) std.emissive.copy(src.color).multiplyScalar(0.6);
      made.push(std);
      return std;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });
  try {
    return await new USDZExporter().parseAsync(es.scene, { quickLookCompatible: true, maxTextureSize: 1024 });
  } finally {
    for (const m of made) m.dispose();
    for (const g of splitGeo) g.dispose();
    es.dispose();
  }
}

/** OBJ of the whole project (world coordinates, meters). */
export async function exportOBJ(project: Project3, opts: Omit<ExportOptions, 'expandInstances' | 'maxTextureSize'> = {}): Promise<string> {
  const es = await buildExportScene(project, { ...opts, expandInstances: true });
  const split: THREE.BufferGeometry[] = [];
  try {
    const multi: THREE.Mesh[] = [];
    es.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && Array.isArray(m.material)) multi.push(m);
    });
    for (const m of multi) {
      const parts = splitByMaterial(m);
      if (parts.length === 1 && parts[0] === m) continue;
      const parent = m.parent!;
      for (const p of parts) {
        split.push(p.geometry);
        parent.add(p);
      }
      parent.remove(m);
    }
    es.scene.updateMatrixWorld(true);
    return `# ${BRAND} — ${project.name}\n# meters, Y up\n` + new OBJExporter().parse(es.scene);
  } finally {
    for (const g of split) g.dispose();
    es.dispose();
  }
}

/**
 * The project for the game as one .zip (Estúdio de Construção v4's "export for the game"):
 *  - `game.json`: the `roadcraft-building` data (game.ts), each building with `"model"`, the path of
 *    its GLB in the archive;
 *  - `buildings/<id>.glb`: each building alone in its own frame (origin at its position, not turned:
 *    the game places it with `position`, `rotation` and `elevation`), instances merged into plain
 *    meshes so any glTF reader takes it;
 *  - `scene.glb`: the whole project placed, for a look in any viewer.
 */
export async function exportGamePackage(project: Project3, opts: ExportOptions = {}): Promise<Uint8Array> {
  if (!kernelReady()) await loadKernel(opts.wasmUrl);
  const data = gameData(project);
  const files: ZipEntry[] = [];
  // Textures at most 1024 px: one copy per building GLB (a game loads them per building).
  const own = { maxTextureSize: 1024, ...opts, expandInstances: true };
  for (const b of project.buildings) {
    const alone: Project3 = { ...project, buildings: [{ ...b, position: [0, 0], rotation: 0, elevation: 0 }] };
    const path = `buildings/${b.id.replace(/[^\w.-]/g, '_')}.glb`;
    // Each GLB shrunk: shared parts and textures once, textures as WebP (io/glbopt.ts).
    files.push({ name: path, data: await optimizeGlb(new Uint8Array(await exportGLB(alone, own)), { maxTexture: 1024 }) });
    const gb = data.buildings.find((x) => x.id === b.id);
    if (gb) gb.model = path;
  }
  files.unshift({ name: 'game.json', data: JSON.stringify(data, null, 2) });
  files.push({ name: 'scene.glb', data: await optimizeGlb(new Uint8Array(await exportGLB(project, own)), { maxTexture: 1024 }) });
  return zipStore(files);
}
