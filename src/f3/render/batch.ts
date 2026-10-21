// Buildings at rest drawn in batches: THREE.BatchedMesh per material (three.js r170, multi-draw),
// so 200 buildings cost a few dozen draw calls per pass instead of ~2 700 (their shells split by
// material, their window frames, glass, sills… as instances). Measured on the 200-building scene:
// two passes (scene + the normals of the ambient occlusion) of ~2 700 calls each took most of the
// frame on the CPU. The buildings' own meshes stay in the scene, hidden: picking (the ray does not
// look at visibility), outlines, hover and the exploded gap keep working on them. The active
// building (selected, being edited) is drawn by its own meshes, so every edit shows at once.
import * as THREE from 'three';
import { foliageMeshes } from './foliage';

/**
 * Largest batch, in vertices (9.4 MB of attributes). Growing a batch replaces its attributes, and
 * three.js uploads them whole (bufferData): one batch per material grew to millions of vertices and
 * each growth stalled a frame (885 ms of bufferData in an exploded view of 200 buildings). Past this
 * size a material gets another batch: one more draw call, never a big upload.
 */
const CHUNK_VERTS = 1 << 18;
/**
 * Largest batch, in instances. Its matrices live in a texture that three.js uploads whole on every
 * change (texSubImage2D): a batch of 16 384 instances sent 1 MB each time a building was added to it.
 */
const CHUNK_INSTS = 1 << 11;
/** A new batch starts small (72 batches of 65 536 vertices held 170 MB before anything was in them). */
const FIRST_VERTS = 4096;
const FIRST_INSTS = 64;

/** Attributes every batched geometry has (the batch requires the same set). */
const ATTRS: [string, number][] = [
  ['position', 3],
  ['normal', 3],
  ['uv', 2],
  ['aRoom', 1],
];

interface Item {
  batch: Batch;
  inst: number;
  /** Own geometry (deleted with the building); -1 when shared (a primitive shape). */
  geom: number;
  /** Matrix relative to the building group. */
  local: THREE.Matrix4;
  /** Category of a part (switched off with it); none for the shell. */
  cat?: string;
}

interface Entry {
  shell: unknown;
  parts: unknown;
  group: THREE.Object3D;
  matrix: THREE.Matrix4;
  items: Item[];
  visible: boolean;
  /** Gap of the exploded floors when copied (the lift is in the geometry). */
  gap: number;
  /** The batches its items are in (drawn by them only when all are ready). */
  batches: Batch[];
  /** Its items in each batch (to switch them per render pass and per category). */
  byBatch: Map<Batch, Item[]>;
  /** Categories hidden in its drawing. */
  hidden: ReadonlySet<string>;
  hiddenKey: string;
  /** Bounds in the building frame, and the world sphere (frustum test). */
  box: THREE.Box3;
  sphere: THREE.Sphere;
  /** In the camera's / the sun shadow's frustum (both true until the first cull). */
  inMain: boolean;
  inShadow: boolean;
  /** Small on screen: its detail (furniture behind the windows, ornaments) is not drawn (LOD). */
  far: boolean;
}

/**
 * Categories left out of a building that is small on screen (a level of detail by screen size, like
 * Unreal's per-primitive cull distance): pieces that would be a few pixels behind glass or on a ledge.
 */
const DETAIL = new Set(['furniture', 'ornament']);
/** A building whose bounding sphere spans less than this share of the view height is far. */
const FAR_SHARE = 0.12;

interface Batch {
  mesh: THREE.BatchedMesh;
  /** Vertex capacity (BatchedMesh has no public getter for it). */
  cap: number;
  shared: Map<THREE.BufferGeometry, number>;
  freed: number;
  /** Its shader program is compiled (see `prepare`). */
  ready: boolean;
  /** The pass its draw list was made for: 0 camera, 1 sun shadow, 2 any other camera (no culling). */
  pass: 0 | 1 | 2;
  entries: Set<Entry>;
}

/** A geometry with exactly the batch attributes, without index (shared primitives are cached). */
function normalize(g: THREE.BufferGeometry, start = 0, count = -1): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const n = count < 0 ? src.getAttribute('position').count : count;
  const out = new THREE.BufferGeometry();
  for (const [name, size] of ATTRS) {
    const a = src.getAttribute(name) as THREE.BufferAttribute | undefined;
    const arr = new Float32Array(n * size);
    if (a) {
      for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.array[(start + i) * a.itemSize + k] as number;
    } else if (name === 'aRoom') arr.fill(1);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src !== g) src.dispose();
  return out;
}

/** A building's drawing as View keeps it (the current one, or one kept for another view). */
export interface Drawing {
  group: THREE.Group;
  shell: { mesh: THREE.Mesh };
  parts: { group: THREE.Group; hidden?: ReadonlySet<string>; hiddenKey?: string };
  gap: number;
}

export class Batcher {
  readonly root = new THREE.Group();
  /** By material and shadow flags: one batch, or several when one would pass CHUNK_VERTS. */
  private batches = new Map<string, Batch[]>();
  /** By drawing: a building has one per view it was seen in (whole, cutaway, exploded). */
  private entries = new Map<Drawing, Entry>();
  private primCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  private m = new THREE.Matrix4();
  private inv = new THREE.Matrix4();

  /** Material keys whose batched program is compiled or compiling. */
  private prepared = new Map<string, Promise<unknown> | true>();
  /** Called when a batch that was compiling is ready (sync again to use it). */
  onReady: (() => void) | null = null;

  /**
   * `prepare`: compiles a new batch's shader program without blocking (WebGLRenderer.compileAsync,
   * KHR_parallel_shader_compile). A material drawn in a BatchedMesh needs its own program variant;
   * compiled on first draw, it blocked frames for up to 430 ms (getProgramInfoLog) when a view change
   * brought new materials. Until ready, the batch stays hidden and its buildings keep their meshes.
   * `chunkVerts`: largest batch in vertices (tests use a small one).
   */
  constructor(
    private readonly prepare: ((mesh: THREE.BatchedMesh) => Promise<unknown> | null) | null = null,
    private readonly chunkVerts = CHUNK_VERTS,
  ) {
    this.root.name = 'batches';
  }

  /** A batch of this material with room for `verts(batch)` vertices and `insts` instances. */
  private slot(mat: THREE.Material, cast: boolean, receive: boolean, verts: (b: Batch) => number, insts: number): Batch {
    const key = `${mat.uuid}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
    let list = this.batches.get(key);
    if (!list) this.batches.set(key, (list = []));
    for (let i = list.length - 1; i >= 0; i--) if (this.fit(list[i]!, verts(list[i]!), insts)) return list[i]!;
    const first = Math.min(FIRST_VERTS, this.chunkVerts);
    const mesh = new THREE.BatchedMesh(FIRST_INSTS, first, 0, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    // No per-frame culling or sorting of every instance: with both off, BatchedMesh skips rebuilding
    // its draw list on frames where nothing changed (BatchedMesh.onBeforeRender, three r170). The
    // buildings' own meshes were not culled finer than per building either.
    mesh.sortObjects = false;
    mesh.perObjectFrustumCulled = false;
    mesh.frustumCulled = false;
    mesh.name = `batch ${mat.name || mat.type}`;
    if (mat.userData.foliage) foliageMeshes.add(mesh);
    this.root.add(mesh);
    const b: Batch = { mesh, cap: first, shared: new Map(), freed: 0, ready: true, pass: 0, entries: new Set() };
    list.push(b);
    // Culling per building and per pass: the scene and ambient-occlusion passes draw what the camera
    // sees, the shadow pass what the sun's frustum holds (BatchedMesh.onBeforeShadow calls
    // onBeforeRender with the shadow camera). Only buildings inside one frustum and not the other
    // switch when the pass changes; BatchedMesh then rebuilds its draw list (no per-instance tests).
    const base = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      const want = camera === this.shadowCamera ? 1 : camera === this.mainCamera ? 0 : 2;
      if (b.pass !== want) {
        b.pass = want;
        for (const e of b.entries) if (e.visible && !(e.inMain && e.inShadow)) this.applyIn(e, b);
      }
      base.call(mesh, renderer, scene, camera, geometry, material, group);
    };
    // One program per material and shadow flags: the first batch of a key compiles it; later chunks
    // of the same key wait for the same promise (or use it at once).
    let compiling = this.prepared.get(key);
    if (!compiling && this.prepare) this.prepared.set(key, (compiling = this.prepare(mesh) ?? true));
    if (compiling && compiling !== true) {
      b.ready = false;
      mesh.visible = false;
      void compiling.then(() => {
        this.prepared.set(key, true);
        b.ready = true;
        mesh.visible = true;
        this.onReady?.();
      });
    }
    this.fit(b, verts(b), insts);
    return b;
  }

  /**
   * Makes room for `verts` vertices and `insts` instances in a batch, growing it (doubling) up to the
   * chunk size; false when it would pass it (a lone geometry bigger than a chunk still gets a batch).
   */
  private fit(b: Batch, verts: number, insts: number): boolean {
    const mesh = b.mesh;
    if (mesh.unusedVertexCount < verts) {
      if (b.freed > b.cap / 2) {
        mesh.optimize();
        b.freed = 0;
      }
      if (mesh.unusedVertexCount < verts) {
        const used = b.cap - mesh.unusedVertexCount;
        if (used > 0 && used + verts > this.chunkVerts) return false;
        b.cap = Math.max(Math.min(b.cap * 2, this.chunkVerts), used + verts);
        mesh.setGeometrySize(b.cap, 0);
      }
    }
    const n = mesh.instanceCount;
    if (n + insts > mesh.maxInstanceCount) {
      if (n > 0 && n + insts > CHUNK_INSTS) return false;
      mesh.setInstanceCount(Math.max(Math.min(mesh.maxInstanceCount * 2, CHUNK_INSTS), n + insts));
    }
    return true;
  }

  /** Adds a building (its shell and parts as they are drawn now). */
  private add(group: THREE.Object3D, shell: THREE.Mesh, parts: THREE.Object3D, shellRef: unknown, partsRef: unknown, gap: number): Entry {
    group.updateMatrixWorld(true);
    this.inv.copy(group.matrixWorld).invert();
    const items: Item[] = [];
    const box = new THREE.Box3();
    const localOf = (o: THREE.Object3D) => new THREE.Matrix4().multiplyMatrices(this.inv, o.matrixWorld);
    const grow = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(this.tmpBox.copy(g.boundingBox!).applyMatrix4(m));
    };
    /** One geometry of its own and its instance, in a batch with room for both. */
    const own = (mat: THREE.Material, cast: boolean, receive: boolean, g: THREE.BufferGeometry, local: THREE.Matrix4) => {
      const n = g.getAttribute('position').count;
      const b = this.slot(mat, cast, receive, () => n, 1);
      const geom = b.mesh.addGeometry(g);
      grow(g, local);
      g.dispose();
      items.push({ batch: b, inst: b.mesh.addInstance(geom), geom, local });
    };
    // Shell: one geometry per material group.
    const mats = ([] as THREE.Material[]).concat(shell.material as THREE.Material | THREE.Material[]);
    const sg = shell.geometry;
    const groups = sg.groups.length ? sg.groups : [{ start: 0, count: sg.getAttribute('position').count, materialIndex: 0 }];
    const sl = localOf(shell);
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || gr.count <= 0) continue;
      own(mat, shell.castShadow, shell.receiveShadow, normalize(sg, gr.start, gr.count), sl);
    }
    // Parts: instanced primitives share one geometry per batch; profile meshes have their own.
    parts.updateMatrixWorld(true);
    parts.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.Material;
      const ml = localOf(mesh);
      const cat = mesh.userData.category as string | undefined;
      const first = items.length;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        const im = mesh as THREE.InstancedMesh;
        let prim = this.primCache.get(im.geometry);
        if (!prim) this.primCache.set(im.geometry, (prim = normalize(im.geometry)));
        const pv = prim.getAttribute('position').count;
        for (let i = 0; i < im.count; i++) {
          const b = this.slot(mat, mesh.castShadow, mesh.receiveShadow, (c) => (c.shared.has(prim) ? 0 : pv), 1);
          let geom = b.shared.get(prim);
          if (geom === undefined) b.shared.set(prim, (geom = b.mesh.addGeometry(prim)));
          im.getMatrixAt(i, this.m);
          const local = new THREE.Matrix4().multiplyMatrices(ml, this.m);
          grow(prim, local);
          items.push({ batch: b, inst: b.mesh.addInstance(geom), geom: -1, local });
        }
      } else own(mat, mesh.castShadow, mesh.receiveShadow, normalize(mesh.geometry), ml);
      if (cat !== undefined) for (let i = first; i < items.length; i++) items[i]!.cat = cat;
    });
    const byBatch = new Map<Batch, Item[]>();
    for (const it of items) {
      let l = byBatch.get(it.batch);
      if (!l) byBatch.set(it.batch, (l = []));
      l.push(it);
    }
    const pr = partsRef as Drawing['parts'];
    const e: Entry = { shell: shellRef, parts: partsRef, group, matrix: new THREE.Matrix4().copy(group.matrixWorld), items, visible: true, gap, batches: [...byBatch.keys()], byBatch, hidden: pr.hidden ?? new Set(), hiddenKey: pr.hiddenKey ?? '', box, sphere: new THREE.Sphere(), inMain: true, inShadow: true, far: false };
    for (const b of e.batches) b.entries.add(e);
    this.place(e);
    // Parts of hidden categories start switched off.
    if (e.hidden.size) for (const b of e.batches) this.applyIn(e, b);
    return e;
  }

  private place(e: Entry): void {
    for (const it of e.items) it.batch.mesh.setMatrixAt(it.inst, this.m.multiplyMatrices(e.matrix, it.local));
    this.tmpBox.copy(e.box).applyMatrix4(e.matrix).getBoundingSphere(e.sphere);
    this.test(e);
  }

  private remove(e: Entry): void {
    for (const b of e.batches) b.entries.delete(e);
    for (const it of e.items) {
      it.batch.mesh.deleteInstance(it.inst);
      if (it.geom >= 0) {
        const r = it.batch.mesh.getGeometryRangeAt(it.geom);
        it.batch.freed += r?.reservedVertexCount ?? 0;
        it.batch.mesh.deleteGeometry(it.geom);
      }
    }
  }

  /**
   * Brings the batches in line with the drawn buildings: `active` ones (and all, when `off`) are
   * drawn by their own meshes; the others by the batches. `kept` are drawings of other views (not in
   * the scene): their copies stay in the batches, hidden, so going back to that view only shows them
   * again. Copying a building into the batches costs about a millisecond; past `budgetMs` the rest
   * keep their own meshes (drawn right, only more draw calls) and the call returns true: call again
   * next frame.
   */
  sync(built: ReadonlyMap<string, Drawing>, active: ReadonlySet<string>, off: boolean, budgetMs = Infinity, kept: Iterable<Drawing> = []): boolean {
    const t0 = performance.now();
    let pending = false;
    // Read once: `kept` may be a generator (a second loop over it would see nothing).
    const keptList = [...kept];
    const live = new Set<Drawing>(built.values());
    for (const k of keptList) live.add(k);
    const stale = (e: Entry, d: Drawing) => !live.has(d) || e.shell !== d.shell || e.parts !== d.parts || e.group !== d.group || e.gap !== d.gap;
    // An edit of many buildings (a component type) redraws them all. Removing them one by one is slow
    // in BatchedMesh (three r170 and dev): deleteGeometry walks every instance and the next
    // addInstance sorts the whole list of freed ids (re-adding 200 buildings took 340 ms in one
    // frame). Past a few, the batches start again empty (each add O(1)) and refill within the budget.
    let n = 0;
    for (const [d, e] of this.entries) if (stale(e, d)) n++;
    if (n > Math.max(16, this.entries.size / 4)) this.reset();
    for (const [d, e] of this.entries)
      if (stale(e, d)) {
        this.remove(e);
        this.entries.delete(d);
      }
    for (const [id, d] of built) {
      let e = this.entries.get(d);
      let batched = !off && !active.has(id) && d.group.visible;
      if (!e && batched) {
        if (performance.now() - t0 < budgetMs) this.entries.set(d, (e = this.add(d.group, d.shell.mesh, d.parts.group, d.shell, d.parts, d.gap)));
        else {
          pending = true;
          batched = false;
        }
      }
      if (e) {
        d.group.updateMatrixWorld(true);
        if (!e.matrix.equals(d.group.matrixWorld)) {
          e.matrix.copy(d.group.matrixWorld);
          this.place(e);
        }
        // A batch still compiling: the building keeps its own meshes until it is ready.
        if (batched && !e.batches.every((x) => x.ready)) batched = false;
        // Categories switched in the drawing: the same instances, shown or not.
        if ((d.parts.hiddenKey ?? '') !== e.hiddenKey) {
          e.hidden = d.parts.hidden ?? new Set();
          e.hiddenKey = d.parts.hiddenKey ?? '';
          if (e.visible) for (const b of e.batches) this.applyIn(e, b);
        }
        this.show(e, batched);
      }
      d.shell.mesh.visible = !batched;
      d.parts.group.visible = !batched;
    }
    for (const d of keptList) {
      const e = this.entries.get(d);
      if (e) this.show(e, false);
    }
    return pending;
  }

  private show(e: Entry, on: boolean): void {
    if (e.visible === on) return;
    e.visible = on;
    for (const b of e.batches) this.applyIn(e, b);
  }

  /** A building's instances in one batch, visible as its state, that batch's pass and its categories say. */
  private applyIn(e: Entry, b: Batch): void {
    const on = e.visible && (b.pass === 0 ? e.inMain : b.pass === 1 ? e.inShadow : true);
    const far = e.far && b.pass !== 2;
    for (const it of e.byBatch.get(b)!) b.mesh.setVisibleAt(it.inst, on && !(it.cat !== undefined && (e.hidden.has(it.cat) || (far && DETAIL.has(it.cat)))));
  }

  private mainCamera: THREE.Camera | null = null;
  private shadowCamera: THREE.Camera | null = null;
  private fMain = new THREE.Frustum();
  private fShadow = new THREE.Frustum();
  private culling = false;
  private hasShadow = false;
  private tmpBox = new THREE.Box3();
  private camPos = new THREE.Vector3();
  private shareK = 0;

  /**
   * Frustum culling per building, as the buildings' own meshes had: call before each render with the
   * camera and the shadow-casting sun. Without it the batches drew every building in every pass
   * (3.5 M triangles instead of 1.2 M on 200 buildings).
   */
  cull(camera: THREE.Camera, sun: THREE.DirectionalLight | null): void {
    this.mainCamera = camera;
    this.fMain.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    this.hasShadow = !!sun?.castShadow;
    if (sun && this.hasShadow) {
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      this.shadowCamera = sun.shadow.camera;
      this.fShadow.copy(sun.shadow.getFrustum());
    }
    this.culling = true;
    // Screen share of a unit radius at unit distance (perspective only; a parallel view keeps detail).
    const pc = camera as THREE.PerspectiveCamera;
    this.shareK = pc.isPerspectiveCamera ? 1 / Math.tan((pc.fov * Math.PI) / 360) : 0;
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    for (const e of this.entries.values()) this.test(e);
  }

  private test(e: Entry): void {
    if (!this.culling) return;
    const m = this.fMain.intersectsSphere(e.sphere);
    const s = this.hasShadow && this.fShadow.intersectsSphere(e.sphere);
    const d = this.camPos.distanceTo(e.sphere.center);
    const far = this.shareK > 0 && d > e.sphere.radius && (e.sphere.radius / d) * this.shareK < FAR_SHARE;
    if (m === e.inMain && s === e.inShadow && far === e.far) return;
    e.inMain = m;
    e.inShadow = s;
    e.far = far;
    if (e.visible) for (const b of e.batches) this.applyIn(e, b);
  }

  /** Instances drawn by the batches now. */
  get instances(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.visible) n += e.items.length;
    return n;
  }

  /** A batch is still compiling its program (its buildings show their own meshes meanwhile). */
  get compiling(): boolean {
    for (const l of this.batches.values()) for (const b of l) if (!b.ready) return true;
    return false;
  }

  /** Draw calls the batches make per pass (one per batch with something visible). */
  get batchCount(): number {
    let n = 0;
    for (const l of this.batches.values()) n += l.length;
    return n;
  }

  /** Every batch dropped (its buildings show their own meshes until added again). */
  private reset(): void {
    for (const l of this.batches.values())
      for (const b of l) {
        b.mesh.removeFromParent();
        foliageMeshes.delete(b.mesh);
        b.mesh.dispose();
      }
    this.batches.clear();
    this.entries.clear();
    // Compiled programs stay with the materials; a key still compiling is asked again later.
    for (const [k, v] of this.prepared) if (v !== true) this.prepared.delete(k);
  }

  dispose(): void {
    this.reset();
    for (const g of this.primCache.values()) g.dispose();
    this.root.removeFromParent();
  }
}
