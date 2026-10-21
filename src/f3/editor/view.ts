// Editor 3D view: renderer, orbit camera (navigation lives in editor.ts:
// middle pans, Shift+middle orbits, the wheel zooms on the cursor), environment,
// building drawing cached by revision and ray picking.
import * as THREE from 'three';

/** Farthest camera distance (m): the whole 3 km ground still fills the view. */
const MAX_DISTANCE = 600;
/** Lowest camera height (m) that orbit and pan allow: the eye never goes under the ground. */
const MIN_EYE = 0.3;
/** Pitch limits (rad from straight down): a true top view, and never under the horizon. */
export const MIN_PHI = 0.001,
  MAX_PHI = Math.PI / 2 - 0.02;
import type { Building3, ID, Project3 } from '../model/schema';
import { evaluateBuilding, type Evaluated } from '../eval/evaluate';
import type { FaceInfo } from '../eval/faces';
import type { PartTag } from '../eval/parts';
import { buildShellMesh, type ShellMesh } from '../render/shell';
import { buildPartsMesh, type PartsMesh } from '../render/parts';
import type { RenderContext } from '../../render/context';
import { createLook, createLookContext, type Look } from '../render/look';
import { sourceId } from '../eval/modifiers';
import { onPbrLoad, pbrPending, setPbrAnisotropy } from '../render/pbr';
import { onProcBaked, setProcRenderer } from '../render/procedural';
import { onImageLoad, setProjectImages } from '../render/images';
import { bandedView, bodyHidden, buildingHidden, buildingLocked, explodeGap, interiorView, itemHidden, itemLocked, solidHidden, solidLocked, visibilityKeys, type BodyCategory } from '../model/layers';
import { bodyCategory, cutHeight } from '../eval/interior';
import { family } from '../families/index';
import { Batcher } from '../render/batch';
import { EvalPool } from '../eval/pool';
import { SiteLayer } from '../render/site';
import { installBvh } from '../render/bvh';

// Picking through bounding volume hierarchies (render/bvh.ts).
installBvh();

/** Drawings kept per building (whole, cutaway, exploded…): going back to a view finds them. */
const MAX_VARIANTS = 3;
/**
 * Main-thread work per frame on a view change (meshes from evaluated buildings, batching): with the
 * render (~12 ms on 200 buildings) a frame stays under 33 ms.
 */
const DRAW_BUDGET_MS = 8;
const BATCH_BUDGET_MS = 4;

export interface Built {
  revision: number;
  /** The building without its finishes: equal means the same geometry (a material edit draws, it does not evaluate). */
  geomKey: string;
  /** Visible layers when it was evaluated / categories when the parts were built. */
  visSolids: string;
  visParts: string;
  /** Hidden body parts when the shell mesh was built. */
  visBody: string;
  /** Gap the floors are lifted by (exploded view). */
  gap: number;
  group: THREE.Group;
  ev: Evaluated;
  shell: ShellMesh;
  parts: PartsMesh;
}

export interface Hit {
  building: Building3;
  point: THREE.Vector3;
  /** World normal. */
  normal: THREE.Vector3;
  face?: FaceInfo;
  part?: PartTag;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // Far plane past the ground edge even at the maximum distance (no clipped horizon band).
  readonly persp = new THREE.PerspectiveCamera(40, 1, 0.1, 6000);
  /** Parallel projection (numpad 5, like Blender): the same view, without perspective. */
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 12000);
  /** The camera the view is drawn and picked with. */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  get parallel(): boolean {
    return this.camera === this.ortho;
  }
  /** Perspective ↔ parallel; the view (target, distance, angles) stays. */
  setParallel(on: boolean): void {
    if (on === this.parallel) return;
    this.camera = on ? this.ortho : this.persp;
    this.look?.setCamera(this.camera);
    this.updateCamera();
  }
  readonly ctx: RenderContext = createLookContext();
  readonly look: Look;
  readonly root = new THREE.Group();
  readonly overlay = new THREE.Group();
  readonly built = new Map<ID, Built>();
  /** Lots and streets (render/site.ts); `picked` is the selected lot or street, outlined. */
  readonly site = new SiteLayer();
  sitePicked: { lot: ID | null; street: ID | null } = { lot: null, street: null };
  /** Buildings at rest drawn in batches (one draw per material: render/batch.ts). */
  // Without KHR_parallel_shader_compile the wait cannot be avoided (three.js checks the link status at
  // once): batches then compile on first draw, as the buildings' own meshes do.
  readonly batcher = new Batcher((mesh) => (this.renderer.extensions.has('KHR_parallel_shader_compile') ? this.look.compileAsync(mesh) : null));
  /** Buildings drawn by their own meshes (the editor sets them: context, selection). */
  activeIds: ReadonlySet<ID> = new Set();
  /**
   * Drawings a building had in other views (whole, cutaway, exploded), by view key: going back finds
   * them instead of evaluating again (before, "Show all" re-evaluated the 200 buildings of a big
   * project). Only while still current (same revision); the oldest dropped first.
   */
  private variants = new Map<ID, Map<string, Built>>();
  /** Buildings waiting to be drawn for a view change, nearest first. */
  private queue: ID[] = [];
  private pumping = 0;
  /** Called while a view change is drawn building by building (done, total). */
  onProgress: ((done: number, total: number) => void) | null = null;
  private queued = 0;
  private drawn = 0;
  /** Evaluations of a view change run in workers; the main thread only builds the meshes. */
  private pool = new EvalPool(2);
  private inflight = 0;
  private ready: { id: ID; key: string; rev: number; ev: Evaluated | null }[] = [];
  private batchPending = false;
  /** New drawings waiting for their shaders before they replace the old ones. */
  private revealing = 0;
  /** Material variants (material, instanced, receives shadow) compiled, or being compiled. */
  private compiled = new Set<string>();
  private compiling = new Map<string, Promise<unknown>>();
  /** Drawings of this frame whose shaders are compiled together at the end of the step (one compile). */
  private warmGroups: THREE.Object3D[] = [];
  /** One stand-in mesh per new variant (its material, its kind of mesh, its geometry's attributes). */
  private warmKeys: string[] = [];
  private warmDone: (() => void) | null = null;
  private warmPromise: Promise<void> | null = null;
  /** The view change being drawn: its key, what to ask the workers and how to draw a result. */
  /** Buildings whose parts are built again for the categories shown (a few per frame). */
  private partsQueue: ID[] = [];
  private pending: { key: string; parts: (id: ID) => void; rev: (id: ID) => number; request: (id: ID) => Parameters<EvalPool['evaluate']> | null; draw: (id: ID, ev: Evaluated | null, rev: number) => void } | null = null;
  private unPbr: () => void = () => undefined;
  private unProc: () => void = () => undefined;
  private unImg: () => void = () => undefined;
  readonly target = new THREE.Vector3(0, 3, 0);
  theta = 0.75;
  phi = 1.0;
  distance = 55;
  private grid: THREE.GridHelper;
  /** Farthest camera distance for this project (5× the model radius, 150 m to MAX_DISTANCE). */
  maxDistance = MAX_DISTANCE;
  /** Orbit pivot marker (a 5 px dot, like SketchUp and Fusion show while orbiting). */
  private pivotMark: THREE.Mesh;
  private ground: THREE.Mesh;
  private dirty = true;
  private raf = 0;
  private ray = new THREE.Raycaster();
  /** Evaluation done (for measuring). */
  lastEvalMs = 0;
  onRender: (() => void) | null = null;
  onCamera: (() => void) | null = null;
  /** More listeners of camera changes (view cube). */
  readonly cameraListeners: (() => void)[] = [];
  private anim = 0;

  constructor(readonly el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.className = 'f3-canvas';
    el.prepend(this.renderer.domElement);
    this.look = createLook(this.renderer, this.scene, this.camera);
    // PBR textures: the GPU's max anisotropic filter and a redraw when they arrive.
    setPbrAnisotropy(Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));
    setProcRenderer(this.renderer, Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));
    this.unImg = onImageLoad(() => this.mark());
    this.unProc = onProcBaked(() => {
      this.renderer.shadowMap.needsUpdate = true;
      this.mark();
    });
    this.unPbr = onPbrLoad(() => {
      this.renderer.shadowMap.needsUpdate = true;
      this.mark();
    });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 96), new THREE.MeshStandardMaterial({ color: '#d8d5ca', roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    this.ground.name = 'ground';
    this.grid = this.makeGrid(1);
    this.pivotMark = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff8a3d', depthTest: false, transparent: true, opacity: 0.9 }));
    this.pivotMark.renderOrder = 20;
    this.pivotMark.visible = false;
    this.scene.add(this.ground, this.grid, this.site.group, this.root, this.batcher.root, this.overlay, this.pivotMark);
    // A batch whose shader finished compiling takes over its buildings' meshes.
    this.batcher.onReady = () => this.refreshBatches();
    this.overlay.renderOrder = 10;
    // Interface only: never part of the ambient occlusion pass (render/look.ts).
    this.overlay.userData.noAO = true;
    this.pivotMark.userData.noAO = true;
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.updateCamera();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (!this.dirty) return;
      this.dirty = false;
      this.batcher.cull(this.camera, this.look.sun);
      this.look.render();
      this.onRender?.();
    };
    loop();
  }

  private makeGrid(step: number): THREE.GridHelper {
    const g = new THREE.GridHelper(240, Math.round(240 / step), '#a9aca4', '#c4c4ba');
    const m = g.material as THREE.LineBasicMaterial;
    m.transparent = true;
    // The grid has no lighting: it darkens with the night (otherwise it glows on the dark ground).
    m.opacity = 0.32 * (1 - 0.75 * this.dark);
    m.color.setScalar(1 - 0.8 * this.dark);
    m.depthWrite = false;
    g.position.y = 0.002;
    return g;
  }

  /** How dark it is (0 day, 1 night): the grid follows. */
  private dark = 0;
  setDark(dark: number): void {
    this.dark = dark;
    const m = this.grid.material as THREE.LineBasicMaterial;
    m.opacity = 0.32 * (1 - 0.75 * dark);
    m.color.setScalar(1 - 0.8 * dark);
    this.mark();
  }

  setGrid(step: number): void {
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.grid = this.makeGrid(step);
    this.scene.add(this.grid);
    this.mark();
  }

  mark(): void {
    this.dirty = true;
  }

  resize(): void {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.look?.setSize(r.width, r.height);
    this.persp.aspect = r.width / r.height;
    this.persp.updateProjectionMatrix();
    this.fitOrtho();
    this.mark();
    this.onCamera?.();
    for (const f of this.cameraListeners) f();
  }

  updateCamera(): void {
    this.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, this.phi));
    // Very close (5 cm) to see frame details; the near clipping plane follows the distance.
    this.distance = Math.max(0.05, Math.min(this.maxDistance, this.distance));
    const { target: t, distance: d, phi, theta } = this;
    const P = this.persp;
    P.position.set(t.x + d * Math.sin(phi) * Math.sin(theta), t.y + d * Math.cos(phi), t.z + d * Math.sin(phi) * Math.cos(theta));
    const near = Math.max(0.01, Math.min(0.5, d * 0.02));
    if (Math.abs(near - P.near) > 1e-4) {
      P.near = near;
      P.updateProjectionMatrix();
    }
    P.lookAt(t);
    P.updateMatrixWorld();
    // Parallel: the same direction, the eye pulled far back (nothing between it and the target is clipped)
    // and the frustum as tall as the perspective one is at the target, so switching keeps the framing.
    const back = new THREE.Vector3().subVectors(P.position, t).normalize();
    this.ortho.position.copy(t).addScaledVector(back, d + 1500);
    this.ortho.quaternion.copy(P.quaternion);
    this.fitOrtho();
    this.ortho.updateMatrixWorld();
    // The shadow follows the view center.
    this.look?.follow(new THREE.Vector3(t.x, 0, t.z), d * 0.9 + 20);
    this.mark();
    this.onCamera?.();
    for (const f of this.cameraListeners) f();
  }

  /** Parallel frustum: as tall as the perspective view is at the target distance. */
  private fitOrtho(): void {
    const h = this.distance * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2);
    const w = h * this.persp.aspect;
    const o = this.ortho;
    if (o.top === h && o.right === w) return;
    Object.assign(o, { left: -w, right: w, top: h, bottom: -h, near: 1, far: this.distance + 1500 + 8000 });
    o.updateProjectionMatrix();
  }

  /**
   * Free rectangle of the view (pixels, relative to the canvas): what remains
   * outside the interface islands. The editor provides it; without it, the whole canvas.
   */
  freeRect: (() => { left: number; top: number; right: number; bottom: number }) | null = null;

  /**
   * Frames a box (or everything) inside the free rectangle, keeping the camera
   * direction: the box corners fit the free height and width and the box center
   * goes to the center of the free area (discourse.threejs.org, "Camera Zoom To
   * Fit Object": height and width, the larger distance).
   */
  frame(box?: THREE.Box3): void {
    const b = box ?? new THREE.Box3().setFromObject(this.root);
    if (b.isEmpty()) {
      this.target.set(0, 3, 0);
      this.distance = 55;
      return this.updateCamera();
    }
    const el = this.renderer.domElement;
    const W = el.clientWidth || 1,
      H = el.clientHeight || 1;
    const fr = this.freeRect?.() ?? { left: 0, top: 0, right: W, bottom: H };
    const fw = Math.max(80, fr.right - fr.left),
      fh = Math.max(80, fr.bottom - fr.top);
    const half = THREE.MathUtils.degToRad(this.persp.fov) / 2;
    const tv = Math.tan(half) * (fh / H),
      th = Math.tan(half) * this.persp.aspect * (fw / W);
    const c = b.getCenter(new THREE.Vector3());
    this.target.copy(c);
    this.updateCamera();
    // Each box corner in the camera frame (x right, y up, z toward the camera):
    // it fits if |x| ≤ (d − z)·tan(h) and |y| ≤ (d − z)·tan(v). The largest required distance wins.
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0),
      up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1),
      back = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    let d = 0;
    const q = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      q.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c);
      const z = q.dot(back);
      d = Math.max(d, z + Math.abs(q.dot(right)) / th, z + Math.abs(q.dot(up)) / tv);
    }
    this.distance = d * 1.06;
    this.updateCamera();
    // Box center at the center of the free area (pans the view, keeps the direction).
    const dx = (fr.left + fr.right) / 2 - W / 2,
      dy = (fr.top + fr.bottom) / 2 - H / 2;
    const wpp = (2 * Math.tan(half) * this.distance) / H;
    this.target.addScaledVector(right, -dx * wpp).addScaledVector(up, dy * wpp);
    this.updateCamera();
    // Panning never takes the camera under the ground: the view is raised instead.
    if (this.camera.position.y < MIN_EYE) {
      this.target.y += MIN_EYE - this.camera.position.y;
      this.updateCamera();
    }
  }

  // ── Buildings ────────────────────────────────────────────────────────
  /** Re-evaluates and redraws what changed. */
  sync(p: Project3, revisions: Map<ID, number>, preview = new Set<ID>()): void {
    let changed = false;
    const t0 = performance.now();
    const vis = visibilityKeys(p);
    setProjectImages(p.images);
    this.site.sync(p, this.sitePicked);
    const wallsOff = p.view?.hiddenBody?.includes('walls'),
      roofsOff = p.view?.hiddenBody?.includes('roofs');
    const partVisible = (b: Building3) => (tag: PartTag) => {
      const it = tag.item ? b.items.find((x) => x.id === tag.item) : undefined;
      // What hangs on a hidden wall or roof goes with it (facade rules live on the walls).
      if (wallsOff && (tag.rule || it?.host.kind === 'face')) return false;
      if (roofsOff && it?.host.kind === 'roof') return false;
      return !(it && itemHidden(p, it));
    };
    // Body parts hidden by the interior view: only the shell mesh is rebuilt (the faces keep their kind).
    const hiddenBody = new Set((p.view?.hiddenBody ?? []) as BodyCategory[]);
    const faceOk = hiddenBody.size
      ? (f: FaceInfo) => {
          const c = bodyCategory(f.kind);
          return !c || !hiddenBody.has(c);
        }
      : undefined;
    // Interior view: hollow, walls cut away, floor bands (exploded or a single floor), lifted by the gap.
    const cutLevel = p.view?.cutLevel;
    // A single floor stays where it is (nothing to spread).
    const gap = cutLevel !== undefined && p.view?.onlyLevel ? 0 : explodeGap(p);
    const evalOpts = (b: Building3) => {
      const n = b.levels.length;
      // A building that does not reach the chosen floor stays whole (context), like the plain cut.
      const banded = bandedView(p) && !(cutLevel !== undefined && cutLevel >= n);
      const levels = cutLevel !== undefined && p.view?.onlyLevel ? [cutLevel] : Array.from({ length: cutLevel !== undefined ? Math.min(n, cutLevel + 1) : n }, (_, i) => i);
      return {
        hollow: interiorView(p),
        noWalls: interiorView(p) && bodyHidden(p, 'walls'),
        ...(banded ? { bands: { levels, top: cutLevel === undefined || cutLevel >= n } } : { cutY: cutHeight(b, cutLevel) }),
      };
    };
    // Component types and styles feed the evaluation too: a type edited re-evaluates every building.
    const typesKey = JSON.stringify([p.types, p.styles]);
    /** Evaluates one building for the current view. */
    const evaluate = (b: Building3): Evaluated => {
      try {
        return evaluateBuilding(b, { preview: preview.has(b.id), hidden: (s) => solidHidden(p, s), ...evalOpts(b) }, p);
      } catch (e) {
        // The interior view must never take a building away: it falls back to the whole building.
        console.error(`Interior view failed on ${b.name}:`, e);
        return evaluateBuilding(b, { preview: preview.has(b.id), hidden: (s) => solidHidden(p, s) }, p);
      }
    };
    /** Puts a new drawing of a building in the scene (the one it replaces is kept for its view). */
    const install = (b: Building3, nb: Built) => {
      const cur = this.built.get(b.id);
      if (cur) {
        // The drawing of the other view is kept for coming back to it; an older revision is dropped.
        this.built.delete(b.id);
        if (cur.revision === nb.revision) this.stash(b.id, cur);
        else this.drop(cur);
      }
      this.pruneVariants(b.id, nb.revision);
      this.root.add(nb.group);
      this.built.set(b.id, nb);
    };
    /** Evaluates (unless a worker did) and draws one building for the current view, at once. */
    const build = (b: Building3, rev: number, done: Evaluated | null = null) => install(b, make(b, rev, done ?? evaluate(b)));
    /** The meshes of a building (not yet in the scene). */
    const make = (b: Building3, rev: number, ev: Evaluated): Built => {
      const shell = buildShellMesh(b, ev, this.ctx, undefined, faceOk, gap);
      const parts = buildPartsMesh(ev.parts, this.ctx, true, partVisible(b), gap, catOf);
      parts.setHidden(hiddenCats);
      const group = new THREE.Group();
      group.name = b.name;
      group.userData = { buildingId: b.id };
      group.position.set(b.position[0], b.elevation ?? 0, b.position[1]);
      group.rotation.y = (b.rotation * Math.PI) / 180;
      group.add(shell.mesh, parts.group);
      group.visible = !buildingHidden(p, b);
      return { revision: rev, geomKey: geomKey(b, typesKey), visSolids: vis.solids, visParts: vis.parts, visBody: vis.body, gap, group, ev, shell, parts };
    };
    const later: Building3[] = [];
    const partsLater: ID[] = [];
    // Hidden categories switch the parts' meshes (no rebuild); every drawing gets the current set.
    const hiddenCats: ReadonlySet<string> = new Set(p.view?.hiddenCategories ?? []);
    const catOf = (tag: PartTag) => family(tag.family)?.category ?? '';
    /** A building's parts again, for the categories now shown. */
    const redoParts = (b: Building3, cur: Built) => {
      cur.parts.dispose();
      cur.parts.group.removeFromParent();
      cur.parts = buildPartsMesh(cur.ev.parts, this.ctx, true, partVisible(b), gap, catOf);
      cur.parts.setHidden(hiddenCats);
      cur.group.add(cur.parts.group);
      cur.visParts = vis.parts;
    };
    for (const b of p.buildings) {
      const rev = revisions.get(b.id) ?? 0;
      let cur = this.built.get(b.id);
      if (cur && cur.revision === rev && cur.visSolids !== vis.solids) {
        // Another view of a building that did not change: the drawing it had for that view, if kept.
        const sp = this.variants.get(b.id)?.get(vis.solids);
        if (sp && sp.revision === rev) {
          this.variants.get(b.id)!.delete(vis.solids);
          this.stash(b.id, cur);
          this.root.add(sp.group);
          this.built.set(b.id, sp);
          cur = sp;
          changed = true;
        } else {
          // A hidden building (its layer or itself) needs no drawing for a view it is not seen in: it
          // keeps the one it has, hidden (hiding a layer evaluated all its buildings for nothing).
          if (buildingHidden(p, b)) {
            cur.group.visible = false;
            continue;
          }
          // Only the view changed: drawn in the next frames, nearest first; it keeps its drawing meanwhile.
          later.push(b);
          continue;
        }
      }
      // Only finishes changed (wall, roof, trim, base, floor, a side's material): the evaluation stands,
      // only the shell mesh is drawn again with the new materials (no boolean). Before, painting a wall
      // of a 40-floor tower re-evaluated it (~0.5 s).
      if (cur && cur.revision !== rev && cur.visSolids === vis.solids && cur.geomKey === geomKey(b, typesKey)) {
        cur.shell.mesh.removeFromParent();
        cur.shell.dispose();
        cur.shell = buildShellMesh(b, cur.ev, this.ctx, undefined, faceOk, gap);
        cur.group.add(cur.shell.mesh);
        cur.revision = rev;
        cur.visBody = vis.body;
        changed = true;
      }
      if (cur && cur.revision === rev && cur.visSolids === vis.solids) {
        cur.group.position.set(b.position[0], b.elevation ?? 0, b.position[1]);
        cur.group.rotation.y = (b.rotation * Math.PI) / 180;
        cur.group.visible = !buildingHidden(p, b);
        if (cur.visBody !== vis.body) {
          cur.shell.mesh.removeFromParent();
          cur.shell.dispose();
          cur.shell = buildShellMesh(b, cur.ev, this.ctx, undefined, faceOk, gap);
          cur.group.add(cur.shell.mesh);
          cur.visBody = vis.body;
          changed = true;
        }
        if (cur.visParts !== vis.parts) {
          // Only the categories changed: the parts are built again without the booleans, the building
          // being edited at once and the others a few per frame (all 200 at once blocked 140–180 ms).
          if (this.activeIds.has(b.id)) {
            redoParts(b, cur);
            changed = true;
          } else partsLater.push(b.id);
        }
        if (cur.parts.hiddenKey !== [...hiddenCats].sort().join(',')) {
          cur.parts.setHidden(hiddenCats);
          changed = true;
        }
        // Another gap only moves the floors already cut.
        if (cur.gap !== gap) {
          cur.shell.setGap(gap);
          cur.parts.setGap(gap);
          cur.gap = gap;
        }
        continue;
      }
      // New or edited: drawn now (the user is waiting for exactly this one).
      build(b, rev);
      changed = true;
    }
    // A view change on many buildings is drawn a few per frame, nearest to the view first: the
    // interface never freezes (before, a cutaway click on 200 buildings blocked it for 6 s).
    const t = this.target;
    later.sort((a, c) => Math.hypot(a.position[0] - t.x, a.position[1] - t.z) - Math.hypot(c.position[0] - t.x, c.position[1] - t.z));
    // A newer view change replaces what was waiting; results of the old one are discarded by key.
    this.pool.clear();
    this.ready = [];
    this.queue = later.map((b) => b.id);
    this.queued = later.length;
    this.drawn = 0;
    const byId = new Map(p.buildings.map((b) => [b.id, b]));
    this.partsQueue = partsLater;
    this.pending = {
      key: vis.solids,
      parts: (id) => {
        const b = byId.get(id),
          cur = this.built.get(id);
        if (b && cur && cur.visParts !== vis.parts) redoParts(b, cur);
      },
      rev: (id) => revisions.get(id) ?? 0,
      request: (id) => {
        const b = byId.get(id);
        if (!b) return null;
        const hidden = b.solids.filter((s) => solidHidden(p, s)).map((s) => s.id);
        return [b, evalOpts(b), hidden, p.types];
      },
      draw: (id, ev, rev) => {
        const b = byId.get(id);
        // Evaluated for an older revision (edited meanwhile, and already drawn by the edit): dropped.
        if (!b || (revisions.get(id) ?? 0) !== rev) return;
        const cur = this.built.get(id);
        if (cur && cur.revision === rev && cur.visSolids === vis.solids) return;
        const nb = make(b, rev, ev ?? evaluate(b));
        // A material never drawn yet would compile its shader on first draw and stall the frame (up to
        // 160 ms): the new drawing waits off-scene for it (the old one stays in view meanwhile).
        const wait = this.warmup(nb.group);
        if (!wait) return void install(b, nb);
        this.revealing++;
        void wait.then(() => {
          this.revealing--;
          const now = this.built.get(id);
          const stale = (revisions.get(id) ?? 0) !== rev || this.pending?.key !== vis.solids || (now && now.revision === rev && now.visSolids === vis.solids);
          if (stale) this.drop(nb);
          else {
            install(b, nb);
            this.root.updateMatrixWorld(true);
            this.renderer.shadowMap.needsUpdate = true;
          }
          this.batchPending = true;
          this.pump();
        });
      },
    };
    // Buildings gone from the project first: the batches below must not keep their copies (a new
    // project showed the old buildings until the next change).
    for (const [id, b] of this.built)
      if (!byId.has(id)) {
        this.drop(b);
        this.built.delete(id);
        changed = true;
      }
    for (const id of [...this.variants.keys()]) if (!byId.has(id)) this.pruneVariants(id, -1);
    this.floorsMoving = false;
    this.batchPending = this.batcher.sync(this.built, this.activeIds, this.floorsMoving, BATCH_BUDGET_MS, this.kept());
    if (this.queue.length || this.batchPending || this.partsQueue.length) this.pump();
    else this.onProgress?.(0, 0);
    if (changed) this.lastEvalMs = performance.now() - t0;
    // Any change (even just moving a building) redoes the shadow.
    this.renderer.shadowMap.needsUpdate = true;
    this.root.updateMatrixWorld(true);
    // Zoom-out limit from the model size (like zoom extents): never a huge empty plain.
    const box = new THREE.Box3().setFromObject(this.root);
    const r = box.isEmpty() ? 0 : box.getBoundingSphere(new THREE.Sphere()).radius;
    // GTAO only around the buildings and never on the open ground: at a grazing angle the far ground
    // streaked like a wall, and the box edge showed as a darker diamond on the ground. The box starts
    // 0.75 m up (GTAO discards farther than its 0.7 m radius); the shadow gives the contact at the base.
    if (box.isEmpty()) this.look.setAOBox(null);
    else {
      const ao = box.clone().expandByVector(new THREE.Vector3(10, 2, 10));
      ao.min.y = Math.max(ao.min.y, 0.75);
      this.look.setAOBox(ao);
    }
    this.maxDistance = Math.min(MAX_DISTANCE, Math.max(150, r * 5));
    this.mark();
  }

  /** Batches in line with the buildings (after any change of drawing, selection or position). */
  refreshBatches(): void {
    this.batchPending = this.batcher.sync(this.built, this.activeIds, this.floorsMoving, BATCH_BUDGET_MS, this.kept());
    if (this.batchPending) this.pump();
    this.mark();
  }

  /** Drawings kept for other views (their batch copies stay, hidden). */
  private *kept(): Iterable<Built> {
    for (const m of this.variants.values()) yield* m.values();
  }

  /** Keeps a drawing of another view (hidden) for coming back to it. */
  private stash(id: ID, b: Built): void {
    b.group.removeFromParent();
    let m = this.variants.get(id);
    if (!m) this.variants.set(id, (m = new Map()));
    const old = m.get(b.visSolids);
    if (old && old !== b) this.drop(old);
    m.delete(b.visSolids);
    m.set(b.visSolids, b);
    // The current drawing counts as one: at most MAX_VARIANTS - 1 kept aside, oldest first out.
    while (m.size > MAX_VARIANTS - 1) {
      const [k, v] = m.entries().next().value as [string, Built];
      this.drop(v);
      m.delete(k);
    }
  }

  /** Drops the kept drawings of a building that are not of revision `rev` (all with -1). */
  private pruneVariants(id: ID, rev: number): void {
    const m = this.variants.get(id);
    if (!m) return;
    for (const [k, v] of m)
      if (v.revision !== rev) {
        this.drop(v);
        m.delete(k);
      }
    if (!m.size) this.variants.delete(id);
  }

  /**
   * The gap slider is being dragged: the floors move inside the buildings' own meshes, so the
   * batches are off until the release syncs (at rest, exploded floors are batched with their gap).
   */
  private floorsMoving = false;

  /**
   * Draws a view change a little per frame. With workers, they evaluate (nearest first, a few
   * requests ahead) and each frame builds the meshes of what came back within DRAW_BUDGET_MS;
   * without them, buildings are evaluated here within the same budget. Batching follows within
   * BATCH_BUDGET_MS. The view keeps turning and the panels answer meanwhile.
   */
  private pump(): void {
    if (this.pumping) return;
    const step = () => {
      this.pumping = 0;
      const job = this.pending;
      const t0 = performance.now();
      if (job && this.pool.threaded) {
        while (this.queue.length && this.inflight < 4) {
          const id = this.queue.shift()!;
          const req = job.request(id);
          if (!req) continue;
          const rev = job.rev(id);
          this.inflight++;
          this.pool.evaluate(...req).then(
            (ev) => {
              this.inflight--;
              this.ready.push({ id, key: job.key, rev, ev });
              this.pump();
            },
            (e: Error) => {
              this.inflight--;
              // A failure in the worker is evaluated here (with its fallback to the whole building).
              if (e.message !== 'cancelled') this.ready.push({ id, key: job.key, rev, ev: null });
              this.pump();
            },
          );
        }
        while (this.ready.length && performance.now() - t0 < DRAW_BUDGET_MS) {
          const r = this.ready.shift()!;
          if (r.key !== this.pending?.key) continue;
          this.pending.draw(r.id, r.ev, r.rev);
          this.drawn++;
        }
      } else if (job) {
        while (this.queue.length && performance.now() - t0 < DRAW_BUDGET_MS) {
          const id = this.queue.shift()!;
          job.draw(id, null, job.rev(id));
          this.drawn++;
        }
      }
      // Parts for the categories shown, within what is left of the frame's budget.
      while (job && this.partsQueue.length && performance.now() - t0 < DRAW_BUDGET_MS) job.parts(this.partsQueue.shift()!);
      this.flushWarmup();
      this.batchPending = this.batcher.sync(this.built, this.activeIds, this.floorsMoving, BATCH_BUDGET_MS, this.kept());
      this.renderer.shadowMap.needsUpdate = true;
      this.root.updateMatrixWorld(true);
      this.mark();
      this.onProgress?.(Math.min(this.drawn, this.queued), this.queued);
      // Waiting only on the workers: their answers call pump again; no idle frames meanwhile.
      if (this.queue.length || this.ready.length || this.batchPending || this.partsQueue.length) this.pumping = requestAnimationFrame(step);
    };
    this.pumping = requestAnimationFrame(step);
  }

  /** True while a view change is still being drawn. */
  get busy(): boolean {
    return this.queue.length > 0 || this.inflight > 0 || this.ready.length > 0 || this.batchPending || this.revealing > 0 || this.partsQueue.length > 0;
  }

  /**
   * The picture on screen is final: nothing left to draw, batch, compile or load, no camera animation,
   * and the last change already rendered. Tests wait for this and capture once (never a fixed wait).
   */
  get settled(): boolean {
    return !this.busy && !this.batcher.compiling && pbrPending() === 0 && !this.anim && !this.dirty;
  }

  /**
   * Shader warm-up before a drawing shows (as engines warm their shader variants up front): the
   * variants of its materials that were never compiled are compiled without blocking
   * (Look.compileAsync, KHR_parallel_shader_compile). Null when all are ready (the usual case).
   */
  private warmup(group: THREE.Object3D): Promise<unknown> | null {
    if (!this.renderer.extensions.has('KHR_parallel_shader_compile')) return null;
    const waits = new Set<Promise<unknown>>();
    const fresh: string[] = [];
    const stand: THREE.Mesh[] = [];
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const kind = `${(mesh as THREE.InstancedMesh).isInstancedMesh ? 'i' : 'm'}${mesh.receiveShadow ? 'r' : ''}`;
      for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
        const k = m.uuid + kind;
        if (this.compiled.has(k)) continue;
        const pending = this.compiling.get(k);
        if (pending) waits.add(pending);
        else if (!fresh.includes(k)) {
          fresh.push(k);
          const inst = (mesh as THREE.InstancedMesh).isInstancedMesh;
          const proxy = inst ? new THREE.InstancedMesh(mesh.geometry, m, 1) : new THREE.Mesh(mesh.geometry, m);
          if (inst) (proxy as THREE.InstancedMesh).instanceColor = (mesh as THREE.InstancedMesh).instanceColor;
          proxy.receiveShadow = mesh.receiveShadow;
          proxy.castShadow = mesh.castShadow;
          stand.push(proxy);
        }
      }
    });
    if (fresh.length) {
      // Compiled with the others of this frame (flushWarmup), by stand-ins: each compile walks the scene
      // for its lights, and compiling whole drawings weighed every material of every mesh (95 ms in the
      // first frame of a cutaway) even when its program already existed.
      this.warmPromise ??= new Promise<void>((r) => (this.warmDone = r));
      this.warmGroups.push(...stand);
      this.warmKeys.push(...fresh);
      for (const k of fresh) this.compiling.set(k, this.warmPromise);
      waits.add(this.warmPromise);
    }
    return waits.size ? Promise.all(waits) : null;
  }

  /** Compiles the shaders the drawings of this frame need, in one call, without blocking. */
  private flushWarmup(): void {
    if (!this.warmGroups.length) return;
    const holder = new THREE.Group();
    for (const g of this.warmGroups) holder.add(g);
    const keys = this.warmKeys,
      done = this.warmDone!;
    this.warmGroups = [];
    this.warmKeys = [];
    this.warmPromise = null;
    this.warmDone = null;
    // compile() creates the programs synchronously; the promise only waits for the driver.
    const p = this.look.compileAsync(holder);
    holder.clear();
    void p.then(() => {
      for (const k of keys) {
        this.compiled.add(k);
        this.compiling.delete(k);
      }
      done();
    });
  }

  /**
   * Exploded floors moved apart while the gap is dragged: only the floors already cut
   * move (no evaluation, no new mesh); the release records the gap and syncs.
   */
  moveFloors(gap: number): void {
    if (!this.floorsMoving) {
      this.floorsMoving = true;
      this.batcher.sync(this.built, this.activeIds, true, Infinity, this.kept());
    }
    for (const b of this.built.values()) {
      if (b.gap === gap) continue;
      b.shell.setGap(gap);
      b.parts.setGap(gap);
      b.gap = gap;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.mark();
  }

  private drop(b: Built): void {
    b.group.removeFromParent();
    b.shell.dispose();
    b.parts.dispose();
  }

  // ── Rays ─────────────────────────────────────────────────────────────
  rayFrom(e: { clientX: number; clientY: number }): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    return this.ray;
  }

  /** 3D point under the pointer: the model (shell and parts) or, without a model, the ground. */
  pointAt(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    return this.modelAt(e) ?? this.onPlane(e, 0);
  }

  /** Model point under the pointer (shell and parts only; null over empty ground or sky). */
  modelAt(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const ray = this.rayFrom(e);
    const groups = [...this.built.values()].filter((b) => b.group.visible).map((b) => b.group);
    const h = ray.intersectObjects(groups, true).find((x) => !x.object.userData.hidden);
    return h ? h.point.clone() : null;
  }

  /** Ground point under the pointer only when it is near (not at the horizon): null otherwise. */
  nearGroundAt(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const p = this.onPlane(e, 0);
    return p && p.distanceTo(this.camera.position) < Math.max(this.distance * 3, 30) ? p : null;
  }

  /** Shows (or hides, with null) the orbit pivot marker, at a constant screen size. */
  showPivot(p: THREE.Vector3 | null): void {
    this.pivotMark.visible = !!p;
    if (p) {
      this.pivotMark.position.copy(p);
      this.pivotMark.scale.setScalar(this.worldPerPixel(p) * 5);
    }
    this.mark();
  }

  /**
   * Zooms in (k < 1) or out (k > 1) keeping point `p` still on screen: camera
   * and target move together toward it, the direction does not change (zoom to cursor).
   */
  zoomAt(p: THREE.Vector3, k: number): void {
    // Does not go through the surface: stops a fraction of the near plane before it.
    const toP = this.camera.position.distanceTo(p);
    if (k < 1 && toP * k < this.persp.near * 3 && !this.parallel) {
      // Already at the surface: a zoom in never turns into a step back. (It used to: k became > 1 and
      // every click pushed the target further behind the wall, until zooming out hit the maximum
      // distance with the camera still near the facade.)
      k = (this.persp.near * 3) / toP;
      if (k >= 1) return;
    }
    // The factor actually applied after the distance limits: at the limit nothing slides.
    const d1 = Math.max(0.05, Math.min(this.maxDistance, this.distance * k));
    k = d1 / this.distance;
    if (Math.abs(k - 1) < 1e-6) return;
    this.target.sub(p).multiplyScalar(k).add(p);
    this.distance *= k;
    // Zooming in toward a facade that stands in front of the target would leave the target behind the
    // wall (and zooming out later would push it hundreds of metres further while the camera stayed near
    // the facade). The target comes forward to the depth of the point under the cursor, on the view axis
    // (three.js OrbitControls keeps it in front of the camera too); the view does not move.
    if (k < 1) {
      const cam = this.target.clone().addScaledVector(this.forward(), -this.distance);
      const depth = p.clone().sub(cam).dot(this.forward());
      if (depth > 0.05 && depth < this.distance) {
        this.target.copy(cam).addScaledVector(this.forward(), depth);
        this.distance = depth;
      }
    }
    this.updateCamera();
  }

  /** Unit view direction from the current angles (camera → target). */
  private forward(): THREE.Vector3 {
    const { phi, theta } = this;
    return new THREE.Vector3(-Math.sin(phi) * Math.sin(theta), -Math.cos(phi), -Math.sin(phi) * Math.cos(theta));
  }

  /** Orbits the view around a pivot (yaw on the vertical axis, pitch on the camera right axis). */
  orbitAround(pivot: THREE.Vector3, dYaw: number, dPitch: number): void {
    const phi0 = this.phi;
    const phi1 = Math.max(MIN_PHI, Math.min(MAX_PHI, phi0 + dPitch));
    const pitch = phi1 - phi0;
    const cam = this.camera.position.clone();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const turn = (p: number) => {
      // A rotation of +p around the camera right axis raises phi by p (the sign the clamp above assumes);
      // with -p the camera passed the limit and then jumped back, and at the limit it stuck.
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dYaw).multiply(new THREE.Quaternion().setFromAxisAngle(right, p));
      return { t2: this.target.clone().sub(pivot).applyQuaternion(q).add(pivot), c2: cam.clone().sub(pivot).applyQuaternion(q).add(pivot) };
    };
    let { t2, c2 } = turn(pitch);
    // Never under the ground: the vertical part that would take the camera below MIN_EYE is dropped.
    if (pitch > 0 && c2.y < MIN_EYE) ({ t2, c2 } = turn(0));
    const off = c2.clone().sub(t2);
    this.target.copy(t2);
    this.distance = off.length();
    this.phi = Math.acos(Math.max(-1, Math.min(1, off.y / (this.distance || 1))));
    this.theta = Math.atan2(off.x, off.z);
    this.updateCamera();
  }

  /** Pans the view: the grabbed point (at its depth) follows the cursor; the eye never goes under the ground. */
  panBy(dx: number, dy: number, at: THREE.Vector3): void {
    const wpp = this.worldPerPixel(at);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0),
      up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const move = right.multiplyScalar(-dx * wpp).addScaledVector(up, dy * wpp);
    // Same floor as orbiting: the part of the move that would take the eye below MIN_EYE is dropped.
    const eye = this.camera.position.y;
    if (move.y < 0 && eye + move.y < MIN_EYE) move.y = Math.min(0, MIN_EYE - eye);
    this.target.add(move);
    this.updateCamera();
  }

  /**
   * Turns the view to (phi, theta) around the current target in `ms` (the view cube, like the
   * Autodesk ViewCube: the camera moves in real time so the change of view stays readable).
   */
  animateTo(phi: number, theta: number, ms = 380, done?: () => void): void {
    this.stopAnim();
    const p0 = this.phi,
      t0 = this.theta;
    const p1 = Math.max(MIN_PHI, Math.min(MAX_PHI, phi));
    // Shortest way around.
    let dt = theta - t0;
    dt = Math.atan2(Math.sin(dt), Math.cos(dt));
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.phi = p0 + (p1 - p0) * e;
      this.theta = t0 + dt * e;
      this.updateCamera();
      if (k < 1) this.anim = requestAnimationFrame(step);
      else {
        this.anim = 0;
        done?.();
      }
    };
    this.anim = requestAnimationFrame(step);
  }

  /** Frames every building (the view cube Home). */
  frameAll(): void {
    const all = new THREE.Box3().setFromObject(this.root);
    this.frame(all.isEmpty() ? undefined : all);
  }

  /** Stops a view animation (any user navigation takes over). */
  stopAnim(): void {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = 0;
  }

  /** Point on the horizontal plane y. */
  onPlane(e: { clientX: number; clientY: number }, y = 0): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    return this.rayFrom(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
  }

  /** First building under the pointer (shell or component). */
  /** What is under the pointer. `wallsOnly`: the parts (windows, balconies) let the ray through to the body. */
  pick(p: Project3, e: { clientX: number; clientY: number }, only?: ID | null, wallsOnly = false, skip?: Set<ID>): Hit | null {
    const ray = this.rayFrom(e);
    const groups = [...this.built.entries()].filter(([id]) => (!only || id === only) && !skip?.has(id) && this.built.get(id)!.group.visible).map(([, b]) => b.group);
    const hits = ray.intersectObjects(groups, true);
    for (const h of hits) {
      // Parts of a hidden category (switched off, still in the group): the click goes through.
      if (h.object.userData.hidden) continue;
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.buildingId) o = o.parent;
      if (!o) continue;
      const id = o.userData.buildingId as ID;
      const b = p.buildings.find((x) => x.id === id);
      const built = this.built.get(id);
      if (!b || !built) continue;
      // Locked (padlock): visible, but the click goes through.
      if (buildingLocked(p, b)) continue;
      const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      if (h.object === built.shell.mesh && h.faceIndex !== undefined && h.faceIndex !== null) {
        const fi = built.shell.faceOf[h.faceIndex];
        const fs = fi !== undefined ? b.solids.find((x) => x.id === built.ev.faces[fi]?.solid) : undefined;
        if (fs && solidLocked(p, fs)) continue;
        const face = fi !== undefined ? built.ev.faces[fi] : undefined;
        // A copy made by a modifier (repeat, mirror) answers for its source volume.
        return { building: b, point: h.point.clone(), normal, face: face && face.solid.includes('~') ? { ...face, solid: sourceId(face.solid) } : face };
      }
      if (wallsOnly) continue;
      const tag = built.parts.pick(h);
      const ti = tag?.item ? b.items.find((x) => x.id === tag.item) : undefined;
      if (ti && itemLocked(p, ti)) continue;
      return { building: b, point: h.point.clone(), normal, ...(tag ? { part: tag } : {}) };
    }
    return null;
  }

  toScreen(p: THREE.Vector3): { x: number; y: number; behind: boolean } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = p.clone().project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, behind: v.z > 1 };
  }

  /**
   * Meters per pixel at a point (pan, handles of fixed screen size). The perspective scale depends on
   * the depth along the view axis, not on the straight distance (three.js OrbitControls uses the
   * on-axis target distance): with the straight distance a point near the edge of the view moved
   * faster than the cursor while panning.
   */
  worldPerPixel(at: THREE.Vector3): number {
    const h = this.renderer.domElement.clientHeight || 600;
    if (this.parallel) return (this.ortho.top - this.ortho.bottom) / h;
    const e = this.camera.matrixWorld.elements;
    // Camera forward is −Z of its matrix.
    const depth = Math.max(this.persp.near, -((at.x - e[12]!) * e[8]! + (at.y - e[13]!) * e[9]! + (at.z - e[14]!) * e[10]!));
    return (2 * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) * depth) / h;
  }

  /** Building matrix (local → world). */
  buildingMatrix(b: Building3): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(b.position[0], b.elevation ?? 0, b.position[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (b.rotation * Math.PI) / 180), new THREE.Vector3(1, 1, 1));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unPbr();
    this.unProc();
    this.unImg();
    if (this.pumping) cancelAnimationFrame(this.pumping);
    this.site.dispose();
    for (const b of this.built.values()) this.drop(b);
    for (const m of this.variants.values()) for (const b of m.values()) this.drop(b);
    this.pool.dispose();
    this.batcher.dispose();
    this.built.clear();
    this.variants.clear();
    this.look.dispose();
    this.ctx.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/**
 * What the evaluation of a building depends on: everything but the finishes of its volumes and sides
 * (those only change the materials of the shell mesh). Position and rotation never re-evaluate either.
 */
function geomKey(b: Building3, typesKey: string): string {
  return typesKey + JSON.stringify({ ...b, name: '', position: null, rotation: null, elevation: null, hidden: null, locked: null, layer: null }, (k, v) => (k === 'materials' || k === 'material' ? undefined : v));
}
