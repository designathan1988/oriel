// FORMA 3 editor: ties together document, view, handles, inference and interface.
// Two-level selection (like SketchUp groups): outside a building, a click
// picks the whole building; inside it (double click), it picks a volume,
// face or component. Drags start from a copy of the initial state and are only
// recorded in the history on release.
import * as THREE from 'three';
import type { Building3, ID, Item, MaterialRef, Project3, Solid, Vec2, Vec3 } from '../model/schema';
import { building as newBuilding, circlePlan, facadeRule, levelsFor, planVertices, project as newProject, roofSpec, solid as newSolid, uid } from '../model/defaults';
import { bendEdge, cloneBuilding, locateVertex, cloneSolid, dirToLocal, edgeNormal, findSolid, mirrorSolid, moveVertex, planCenter, planValid as planValidOps, pushEdge, removeVertex, rotateSolid, splitEdge, toLocal, topRing, toWorld, topAt, translateSolid } from '../model/ops';
import { solidRings } from '../eval/body';
import { adoptOffsetSides, sideCurve, stackOnTop, edgeLength, extrudeSide, hostedFrame, insetSide, insetTop, offsetCopy, offsetSolid, setSideDepth, setSolidSize, splitAtHeight, splitByLine, splitSideAt } from '../model/modeling';
import { activeLayer, buildingHidden, buildingLocked, ensureLayers, explodeGap, itemHidden, itemLocked, solidHidden, solidLocked, viewOf } from '../model/layers';
import { boxPicks, combine, marqueeRect, selMode } from './selection';
import { convertSub, segDistance, subElements, type ElemMode, type SubEdge, type SubVertex } from '../eval/subelements';
import { invert, nextSetName, pickableBuildings, pickableSolids, recallSet, saveSet, similarBuildings, similarSolids } from '../model/selsets';
import { Store } from './store';
import { OpeningTool } from './tools/opening';
import { SiteTools } from './tools/site';
import { StairTool } from './tools/stair';
import { WallsTool } from './tools/walls';
import { tr } from '../ui/i18n';
import { PolylineTool, pointsAlong } from './tools/polyline';
import { lotAt, lotOverlaps, replantStreetTrees, setbackWarnings, streetAt } from '../model/site';
import { WalkMode } from './tools/walk';
import { addInteriorWall, interiorDoors, replicateLevel, type InteriorWithDoors } from '../eval/interiorwalls';
import { stairBetween } from '../model/stairs';
import { keyParts } from '../model/levelpick';
import { alignBuildings, alignSolids, buildingBox, freeShift, volumeBox, type AlignOp, type PlanBox } from '../model/align';
import { arcOf, cornerLimit, offsetRing, ringValid, sampleRing, signedArea2 } from '../model/plan';
import { BLOCKS, blockSolid, type BlockPlacement } from '../model/blocks';
import { View, type Hit } from './view';
import { Handles, HANDLE_COLORS, type Handle, type HandleKind } from './handles';
import { Inference, SNAP_COLORS, type Snap } from './infer';
import { createShell3, type Shell3 } from '../ui/shell';
import { icon } from '../ui/icons';
import { family, typeById } from '../families/index';
import { CATEGORY_NAMES, resolveParams } from '../families/family';
import { columnGrid, freeSpot } from '../model/structure';
import { osmToBuildings, overpassQuery } from '../model/osm';
import { addRoomRect, interiorOf, loopAround, roomArea } from '../eval/interiorwalls';
import { evalExpr } from '../model/expr';
import { dimParams, partBox } from '../eval/partsize';
import { FINISHES } from '../render/finishes';
import { buildingPassedThrough, mergeInto, separateSolids, worldParts } from '../model/compose';
import { choose } from '../ui/chooser';
import { adoptLevels, changeLevels, courtyardIn, fillLevels, floorsIn, podiumUnder, setbackOn, snapToFloor } from '../model/quick';
import { emptyParts3, faceMatrix, FrameSink } from '../eval/parts';
import { buildPartsMesh, type PartsMesh } from '../render/parts';
import type { FaceInfo } from '../eval/faces';
import { evaluatedBounds, type Bounds } from '../eval/bounds';
import { clipperOffset } from '../eval/clipoffset';
import { between, column, elemKey, elementsOf, groupElements, grow, row, rowOnFace, sameFace, sameType, shift, shrink, type Elem, type GroupRow } from './elements';
import { placeLabels } from './labels';

export type Tool = 'select' | 'move' | 'rotate' | 'scale' | 'push' | 'extrude' | 'cut' | 'opening' | 'iwall' | 'room' | 'walls' | 'slab' | 'column' | 'beam' | 'stair' | 'lot' | 'street' | 'rect' | 'arc' | 'circle' | 'polygon' | 'spline' | 'place' | 'paint' | 'block' | 'tape';

export interface Selection {
  building: ID | null;
  solids: ID[];
  /** Selected face of the first solid: side (edge) or top. */
  /** Side, top, or the plinth / parapet (with its coping) of the volume. */
  face: { kind: 'side' | 'top' | 'plinth' | 'parapet'; edge?: ID } | null;
  item: ID | null;
  /** Selected facade elements (keys from elements.ts). */
  elems: string[];
  /** Other buildings selected together (Shift+click). */
  others: ID[];
  /** Corner (plan vertex) selected on the first solid. */
  vertex?: ID | null;
  /** Vertex mode: corners of the first solid (`vertex` is the first of them). */
  verts?: ID[];
  /** Edge mode: sides of the first solid. */
  edges?: ID[];
}

/** Modifiers of a gesture (click or box). */
type Mods = { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean };

interface Measure {
  label: string;
  apply(text: string): boolean;
}

/** Last operation panel parameter: a number (with unit) or a choice. */
export interface OpParam {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  step?: number;
  options?: [string, string][];
}

export interface LastOp {
  label: string;
  params: OpParam[];
  values: Record<string, number | string>;
  run: (v: Record<string, number | string>) => boolean;
  sel: Selection;
  ctx: ID | null;
  /** History step right after applying (another recording ends the adjustment). */
  seq: number;
}

interface Drag {
  kind: string;
  /** Affected building. */
  bid: ID;
  start: { x: number; y: number };
  moved: boolean;
  origBuilding: Building3;
  data: Record<string, unknown>;
  geometry: boolean;
}

const rad = (d: number) => (d * Math.PI) / 180;
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** Reads a number with a comma or a dot and an optional unit (m, cm). */
/**
 * Points along the circular arc from `a` to `b` through `c` (n + 1 points, a first, b last), on the plane
 * of `a`; null when the three are in a line.
 */
export function arcSample(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: number): THREE.Vector3[] | null {
  const ax = a.x,
    az = a.z,
    bx = b.x,
    bz = b.z,
    cx = c.x,
    cz = c.z;
  const d = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / d;
  const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, az - uz);
  const ang = (x: number, z: number) => Math.atan2(z - uz, x - ux);
  const t0 = ang(ax, az),
    t1 = ang(bx, bz),
    tc = ang(cx, cz);
  // Sweep from a to b the way that passes through c.
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let sweep = norm(t1 - t0);
  if (norm(tc - t0) > sweep) sweep -= 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + (sweep * i) / n;
    return new THREE.Vector3(ux + Math.cos(t) * r, a.y, uz + Math.sin(t) * r);
  });
}

export function parseLength(s: string): number | null {
  const t = s.trim().toLowerCase().replace(',', '.');
  const m = /^(-?\d*\.?\d+)\s*(mm|cm|m)?$/.exec(t);
  // Arithmetic too ("3*2.5", "250cm + 1m"): model/expr.ts.
  if (!m) return /[-+*/()×÷]/.test(t.slice(1)) || t.startsWith('(') ? evalExpr(t) : null;
  const v = parseFloat(m[1]!);
  return m[2] === 'cm' ? v / 100 : m[2] === 'mm' ? v / 1000 : v;
}

/** "5f", "5 floors" (also "5a", "5 andares"): a number of floors, or null. */
export function parseFloors(s: string): number | null {
  const m = /^\s*(\d+)\s*(f|floors?|a|andares?)\s*$/i.exec(s);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Height from `base` that takes `n` floors of the building (more floors than it has: the typical height). */
export function floorsHeight(b: Building3, base: number, n: number): number {
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation >= base - 0.05);
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  let h = 0;
  for (let i = 0; i < n; i++) h += lv[i]?.height ?? typ;
  return h;
}

/** "3;4", "3 4", "3,5;-2": a move by dx and dz (m), or null. A comma is a decimal point here. */
export function parseOffset(s: string): [number, number] | null {
  const m = /^\s*(-?[\d.,]+)\s*[;\s]\s*(-?[\d.,]+)\s*$/.exec(s);
  if (!m) return null;
  const a = parseLength(m[1]!),
    b = parseLength(m[2]!);
  return a === null || b === null ? null : [a, b];
}

export interface EditorOptions {
  project?: Project3;
  autosave?: boolean;
}

export class Editor3 {
  readonly shell: Shell3;
  readonly store: Store;
  readonly view: View;
  readonly handles: Handles;
  readonly infer: Inference;
  private readonly opening: OpeningTool;
  readonly site: SiteTools;
  private readonly stair: StairTool;
  private readonly wallsTool: WallsTool;
  private readonly slabTool: WallsTool;
  private beamFrom: Vec3 | null = null;
  /** Interior: the wall or room selected (panel on the side), the thickness new walls get. */
  iwallSel: { level: ID; wall: ID } | null = null;
  roomSel: { level: ID; room: ID } | null = null;
  iwallThickness = 0.12;
  /** Thickness of the walls a building is drawn with (Walls tool). */
  wallThickness = 0.25;
  private readonly polyline: PolylineTool;
  /** First-person walk (editor/tools/walk.ts). */
  readonly walk: WalkMode;
  tool: Tool = 'select';
  drawMode: 'add' | 'subtract' = 'add';
  sel: Selection = { building: null, solids: [], face: null, item: null, elems: [], others: [] };
  context: ID | null = null;
  /** Component type being placed. */
  placing: ID | null = null;
  /** Massing block being placed. */
  blockId: string | null = null;
  paintMat: MaterialRef = { finish: 'brick', color: '#a8553a', color2: '#d8d2c6' };
  /** Volume size fields keep the proportions (W, D and H together). */
  sizeLock = false;
  measure: Measure | null = null;
  warnings: string[] = [];
  private drag: Drag | null = null;
  /** Where a drag was refused (floors drawn apart): the reason shows only if the pointer really moves. */
  private blockedAt: { x: number; y: number } | null = null;
  /** Selection box in progress (from, to, modifiers at the start). */
  private marquee: { ax: number; ay: number; bx: number; by: number; active: boolean; hit: Hit | null; ev: Mods } | null = null;
  private marqueeEl: HTMLElement | null = null;
  private draft: { points: THREE.Vector3[]; y: number; bid: ID | null; hover: THREE.Vector3 | null } | null = null;
  /** Message of a volume that was drawn through another building and joined it. */
  private composedNote: string | null = null;
  private selOverlay = new THREE.Group();
  private snapOverlay = new THREE.Group();
  private ghost: { mesh: PartsMesh; key: string } | null = null;
  private lastSnap: Snap | null = null;
  private clipboard: { kind: 'solid' | 'building' | 'item'; json: string } | null = null;
  private listeners = new Set<() => void>();
  private toastTimer = 0;
  private saveTimer = 0;
  /** Buildings in preview (no facade) during a drag. */
  private preview = new Set<ID>();

  constructor(container: HTMLElement, opts: EditorOptions = {}) {
    this.shell = createShell3(container);
    this.view = new View(this.shell.view);
    // A view change drawn building by building says how far it got (the interface stays usable meanwhile).
    this.view.onProgress = (done, total) => {
      const p = this.store.project;
      this.shell.status.stats.textContent = total && done < total ? `Drawing the view: ${done}/${total} buildings…` : `${p.buildings.length} building(s) · ${this.view.lastEvalMs.toFixed(0)} ms`;
    };
    this.view.freeRect = () => this.freeRect();
    this.store = new Store(opts.project ?? newProject());
    // Floors drawn apart are not where they are: nothing but the view may change meanwhile.
    this.store.guard = () => (explodeGap(this.project) > 0 ? 'Exploded view: set "Floors apart" to 0 (Interior view) to edit.' : null);
    this.store.onBlocked = (why) => {
      this.blockedNote = null;
      this.toast(why);
      this.blockedNote = why;
      queueMicrotask(() => (this.blockedNote = null));
    };
    this.handles = new Handles(this.view);
    this.walk = new WalkMode({ view: this.view, root: this.shell.view, project: () => this.store.project, onExit: () => this.toast('Back to the model view.') });
    this.opening = new OpeningTool({
      view: this.view,
      root: this.shell.root,
      overlay: this.snapOverlay,
      project: () => this.store.project,
      building: (id) => this.store.building(id),
      pickBody: (e) => this.pickBody(e),
      change: (bid, fn, msg) => this.change(bid, fn, msg),
      selectItem: (bid, item) => {
        this.context = bid;
        this.select({ building: bid, item });
      },
      selectSolid: (bid, solid) => {
        this.context = bid;
        this.select({ building: bid, solids: [solid] });
      },
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      toast: (m) => this.toast(m),
    });
    this.site = new SiteTools({
      view: this.view,
      overlay: this.snapOverlay,
      project: () => this.store.project,
      changeSite: (fn, msg) => void this.changeSite(fn, msg),
      // After a lot or a street is made: back to Select, with it selected (its points and arrows ready).
      pickSite: (p) => {
        this.setTool('select');
        this.selectSite(p);
      },
      snap: (p) => (this.infer.enabled ? [Math.round(p[0] / this.infer.grid) * this.infer.grid, Math.round(p[1] / this.infer.grid) * this.infer.grid] : p),
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
    });
    this.stair = new StairTool({
      view: this.view,
      overlay: this.snapOverlay,
      context: () => this.store.building(this.context),
      ownerAt: (x, z) => this.ownerAt(x, z),
      commit: (b, it, msg) => {
        this.adopt(b);
        this.change(b.id, (x) => void x.items.push(it), msg);
        this.context = b.id;
        this.select({ building: b.id, item: it.id });
      },
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      toast: (m) => this.toast(m),
    });
    this.polyline = new PolylineTool({
      view: this.view,
      overlay: this.snapOverlay,
      y: () => (this.store.building(this.context)?.elevation ?? 0),
      snap: (p) => (this.infer.enabled ? [Math.round(p[0] / this.infer.grid) * this.infer.grid, Math.round(p[1] / this.infer.grid) * this.infer.grid] : p),
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
    });
    this.wallsTool = new WallsTool({
      view: this.view,
      overlay: this.snapOverlay,
      thickness: () => this.wallThickness,
      snap: (p) => (this.infer.enabled ? [Math.round(p[0] / this.infer.grid) * this.infer.grid, Math.round(p[1] / this.infer.grid) * this.infer.grid] : p),
      angleStep: () => (this.infer.enabled ? this.rotSnap : 0),
      lengthStep: () => (this.infer.enabled ? this.infer.grid : 0),
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      done: (pts, closed) => this.wallsDone(pts, closed),
    });
    this.slabTool = new WallsTool({
      view: this.view,
      overlay: this.snapOverlay,
      thickness: () => 0.2,
      y: () => {
        const b = this.store.building(this.context) ?? this.activeBuilding();
        const lv = b && this.workLevel(b);
        return lv ? lv.elevation + (b!.elevation ?? 0) : 0;
      },
      words: { start: 'Click the corners of the slab on the floor shown (click the first to close)', close: 'Click: close the slab', open: 'click the first point to close' },
      snap: (p) => (this.infer.enabled ? [Math.round(p[0] / this.infer.grid) * this.infer.grid, Math.round(p[1] / this.infer.grid) * this.infer.grid] : p),
      angleStep: () => (this.infer.enabled ? this.rotSnap : 0),
      lengthStep: () => (this.infer.enabled ? this.infer.grid : 0),
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      done: (pts, closed) => this.slabDone(pts, closed),
    });
    this.infer = new Inference(this.view);
    this.view.overlay.add(this.selOverlay, this.snapOverlay);
    this.view.onCamera = () => {
      this.handles.draw();
      this.drawRoomLabels();
      this.placeCtxBar();
      if (this.dims.length) this.drawDims();
      this.drawSelDims();
    };
    this.store.on((e) => {
      if (e.kind === 'change') {
        // A corner or side pre-highlight drawn before the change marks where it was: it goes, the next move redraws it.
        if (this.subHoverKey) this.drawSubHover(null);
        // A chosen plinth or parapet that the change took away (pitched roof, height 0): the volume stays chosen.
        const fs = this.sel.face,
          so = this.activeSolid();
        if (fs && so && ((fs.kind === 'parapet' && !hasParapet(so)) || (fs.kind === 'plinth' && !hasPlinth(so)))) this.select({ ...this.sel, face: null });
        this.sync();
        if (opts.autosave !== false) this.scheduleSave();
      } else {
        this.refreshTop();
        // Another step was recorded (a drag, an undo): the last operation panel would show old values.
        if (this.lastOp && !this.opBusy && this.lastOp.seq !== this.store.seq) this.clearLastOp();
      }
    });
    this.bindCanvas();
    this.bindKeys();
    this.bindTop();
    // Grid and rotation step (view island).
    const gridSel = this.shell.root.querySelector<HTMLSelectElement>('[data-grid]')!;
    const rotSel = this.shell.root.querySelector<HTMLSelectElement>('[data-rot]')!;
    gridSel.addEventListener('change', () => {
      this.infer.grid = parseFloat(gridSel.value);
      this.view.setGrid(Math.max(0.5, this.infer.grid));
      this.toast(`Grid ${gridSel.options[gridSel.selectedIndex]!.text}.`);
    });
    rotSel.addEventListener('change', () => {
      this.rotSnap = parseFloat(rotSel.value);
      this.toast(`Rotation in ${this.rotSnap}° steps.`);
    });
    this.renderTools();
    this.updateHint();
    this.shell.name.value = this.store.project.name;
    this.sync();
    this.view.frame();
  }

  // ── Events for the interface ─────────────────────────────────────────
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get project(): Project3 {
    return this.store.project;
  }

  activeBuilding(): Building3 | undefined {
    return this.store.building(this.sel.building ?? this.context);
  }

  activeSolid(): Solid | undefined {
    const b = this.activeBuilding();
    return b ? findSolid(b, this.sel.solids[0]) : undefined;
  }

  activeItem(): Item | undefined {
    return this.activeBuilding()?.items.find((i) => i.id === this.sel.item);
  }

  // ── Synchronization ──────────────────────────────────────────────────
  sync(): void {
    const p = this.store.project;
    this.view.activeIds = new Set([this.context, this.sel.building, ...this.sel.others].filter((x): x is ID => !!x));
    this.view.sync(p, this.store.revision, this.preview);
    // Selection that vanished (undo, delete).
    const b = this.store.building(this.sel.building);
    if (this.sel.building && !b) this.sel = { building: null, solids: [], face: null, item: null, elems: [], others: [] };
    if (b) {
      this.sel.solids = this.sel.solids.filter((id) => b.solids.some((s) => s.id === id));
      if (this.sel.item && !b.items.some((i) => i.id === this.sel.item)) this.sel.item = null;
    }
    if (this.context && !this.store.building(this.context)) this.context = null;
    const ctxB = this.store.building(this.context);
    this.infer.axisAngle = ctxB?.rotation ?? 0;
    this.infer.refresh(p, [...this.store.revision.entries()].map(([k, v]) => k + v).join(',') + p.buildings.map((x) => x.position.join() + x.rotation).join());
    this.warnings = [];
    for (const [id, built] of this.view.built) if (!this.context || id === this.context) this.warnings.push(...built.ev.warnings);
    this.drawRoomLabels();
    if (p.lots.length) {
      const own = this.store.building(this.context)?.name;
      this.warnings.push(...setbackWarnings(p).filter((w) => !own || w.startsWith(own + ' ')));
      if (!own) this.warnings.push(...lotOverlaps(p));
    }
    this.drawSelection();
    this.refreshTop();
    this.renderCrumb();
    this.renderWarnings();
    this.shell.status.stats.textContent = `${p.buildings.length} building(s) · ${this.view.lastEvalMs.toFixed(0)} ms`;
    this.emit();
  }

  private refreshTop(): void {
    const q = (c: string) => this.shell.top.querySelector<HTMLButtonElement>(`[data-cmd="${c}"]`)!;
    q('undo').disabled = !this.store.canUndo;
    q('redo').disabled = !this.store.canRedo;
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    const sv = this.shell.top.querySelector('.f3-saved');
    if (sv) sv.textContent = 'Saving…';
    this.saveTimer = window.setTimeout(async () => {
      try {
        await this.persist(this.store.json());
        const sv = this.shell.top.querySelector('.f3-saved');
        if (sv) sv.textContent = 'Saved';
      } catch {
        this.toast('Could not save in this browser (no space): save to a file (Ctrl+S).');
      }
    }, 400);
  }

  /** Where the autosave goes (the app sets the project store; by default the browser's localStorage). */
  persist: (json: string) => Promise<void> | void = (json) => localStorage.setItem('forma3_project', json);

  /** Reason of an edit the store just undid: it stays on screen over the success message that follows it. */
  private blockedNote: string | null = null;

  toast(msg: string): void {
    if (this.blockedNote && msg !== this.blockedNote) return;
    const t = this.shell.toast;
    t.textContent = msg;
    t.classList.add('on');
    // The dimension labels step aside while the message shows, and come back when it goes.
    this.drawSelDims();
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      t.classList.remove('on');
      this.drawSelDims();
    }, 2600);
  }

  private renderWarnings(): void {
    const w = this.shell.warn;
    const uniq = [...new Set(this.warnings)];
    w.classList.toggle('on', uniq.length > 0);
    const text = uniq.slice(0, 3).join(' · ') + (uniq.length > 3 ? ` (+${uniq.length - 3})` : '');
    if (text === w.textContent) return;
    w.textContent = text;
    // The contextual bar steps aside from the warning (it covered it right after placing a part).
    this.placeCtxBar();
  }

  // ── Document changes ─────────────────────────────────────────────────
  /** Changes a building and records it (message in the toast). */
  change(bid: ID, fn: (b: Building3) => void | boolean, message = '', geometry = true): boolean {
    const b = this.store.building(bid);
    if (!b) return false;
    const known = new Set([...b.solids.map((x) => x.id), ...b.items.map((x) => x.id)]);
    const r = fn(b);
    // What was born in this change goes to the active layer.
    const layer = activeLayer(this.project);
    if (layer && r !== false) for (const x of [...b.solids, ...b.items]) if (!known.has(x.id) && !x.layer) x.layer = layer;
    if (r === false) {
      this.store.revert();
      if (message) this.toast('Not possible: the shape would become invalid.');
      return false;
    }
    if (!this.store.commit([bid], message, geometry)) return false;
    if (message && this.store.changed) this.toast(message);
    return true;
  }

  /** Changes the lots or streets (or adds buildings) and records it; only the site and new buildings redraw. */
  changeSite(fn: (p: Project3) => void, message = ''): boolean {
    const before = new Set(this.project.buildings.map((b) => b.id));
    fn(this.store.project);
    const trees = this.replantTrees();
    const born = [...new Set([...this.project.buildings.filter((b) => !before.has(b.id)).map((b) => b.id), ...trees])];
    if (!this.store.commit(born, message)) return false;
    if (message && this.store.changed) this.toast(message);
    return true;
  }

  /** Trees of the streets planted again along their current lines (model/site.ts). */
  private replantTrees(): ID[] {
    return replantStreetTrees(this.store.project, (name, at) => newBuilding({ name, position: at, solids: [], levels: [] }), 'tree-maple', uid);
  }

  /** The selected lot or street (outlined; its panel on the side), or none. */
  get sitePick(): { lot: ID | null; street: ID | null } {
    return this.view.sitePicked;
  }

  selectSite(p: { lot?: ID; street?: ID }): void {
    this.select({});
    this.view.sitePicked = { lot: p.lot ?? null, street: p.street ?? null };
    this.view.site.sync(this.project, this.view.sitePicked);
    this.drawSelection();
    this.view.mark();
    this.emit();
  }

  /** A click on empty ground: the street or lot under it (streets over lots), else nothing. */
  private pickSiteAt(e: { clientX: number; clientY: number }): boolean {
    const g = this.view.onPlane(e, 0);
    if (!g) return false;
    const st = streetAt(this.project, [g.x, g.z]);
    const lot = st ? undefined : lotAt(this.project, [g.x, g.z]);
    if (!st && !lot) return false;
    this.context = null;
    this.selectSite(st ? { street: st.id } : { lot: lot!.id });
    return true;
  }

  /** Deletes the selected lot or street (the buildings on a lot stay, no longer tied to it). */
  deleteSite(): boolean {
    const { lot, street } = this.view.sitePicked;
    if (!lot && !street) return false;
    this.changeSite((p) => {
      if (lot) {
        p.lots = p.lots.filter((l) => l.id !== lot);
        for (const b of p.buildings) if (b.lotId === lot) b.lotId = null;
      }
      if (street) {
        // Its trees go with it.
        const tb = (p.streets ?? []).find((s) => s.id === street)?.treesBuilding;
        if (tb) p.buildings = p.buildings.filter((b) => b.id !== tb);
        p.streets = (p.streets ?? []).filter((s) => s.id !== street);
      }
    }, lot ? 'Lot deleted (its buildings stay). Ctrl+Z undoes.' : 'Street deleted with its trees. Ctrl+Z undoes.');
    this.selectSite({});
    return true;
  }

  changeSolid(fn: (s: Solid, b: Building3) => void | boolean, message = ''): boolean {
    const b = this.activeBuilding(),
      s = this.activeSolid();
    if (!b || !s) return false;
    return this.change(b.id, () => fn(s, b), message);
  }

  // ── Selection ────────────────────────────────────────────────────────
  select(next: Partial<Selection>): void {
    const sel: Selection = { building: null, solids: [], face: null, item: null, elems: [], others: [], vertex: null, verts: [], edges: [], ...next };
    // One corner or several: `vertex` is always the first selected corner.
    if (next.vertex && !next.verts) sel.verts = [next.vertex];
    sel.vertex = sel.verts![0] ?? null;
    // New selection: the pending measure (from the previous action) does not apply to it.
    if (JSON.stringify(sel) !== JSON.stringify(this.sel) && this.measure && !this.drag) {
      this.measure = null;
      this.shell.status.vcbLabel.textContent = 'Size';
    }
    // Another selection (by the user) ends the last operation adjustment.
    if (!this.opBusy && this.lastOp && JSON.stringify(sel) !== JSON.stringify(this.sel)) this.clearLastOp();
    this.sel = sel;
    if (this.view.sitePicked.lot || this.view.sitePicked.street) {
      this.view.sitePicked = { lot: null, street: null };
      this.view.site.sync(this.project, this.view.sitePicked);
      this.view.mark();
    }
    this.syncSelection();
  }

  /** The buildings drawn by their own meshes (not batched): the one being edited and the selected ones. */
  private refreshActive(): void {
    const ids = new Set<ID>([this.context, this.sel.building, ...this.sel.others].filter((x): x is ID => !!x));
    const cur = this.view.activeIds;
    if (ids.size === cur.size && [...ids].every((i) => cur.has(i))) return;
    this.view.activeIds = ids;
    this.view.refreshBatches();
  }

  private syncSelection(): void {
    this.refreshActive();
    // The hint follows the context (outside or inside the building).
    if (!this.handles.hover) this.updateHint();
    this.drawSelection();
    this.renderCrumb();
    this.emit();
  }

  enter(bid: ID | null): void {
    this.context = bid;
    if (!bid && this.elemMode !== 'object') this.elemMode = 'object';
    const b = this.store.building(bid);
    this.infer.axisAngle = b?.rotation ?? 0;
    this.select(bid ? { building: bid } : {});
  }

  exitContext(): void {
    if (this.drag || this.draft) return this.cancel();
    if (this.sel.item || this.sel.elems.length || this.sel.face) return this.select({ building: this.sel.building, solids: this.sel.solids });
    if (this.sel.solids.length) return this.select({ building: this.sel.building });
    if (this.context) {
      const id = this.context;
      this.context = null;
      return this.select({ building: id });
    }
    this.select({});
  }

  private renderCrumb(): void {
    const c = this.shell.crumb;
    const b = this.store.building(this.context);
    const parts: string[] = [];
    parts.push(`<button data-crumb="root" ${!b ? 'aria-current="true"' : ''}>Project</button>`);
    if (b) parts.push(`<button data-crumb="building" aria-current="${!this.sel.solids.length && !this.sel.item}">${esc(b.name)}</button>`);
    const s = this.activeSolid();
    const many = this.sel.solids.length;
    if (b && s) parts.push(many > 1 ? `<button aria-current="true">${many} volumes</button>` : `<button data-crumb="solid" aria-current="${!this.sel.face}">${esc(s.name)}</button>`);
    if (b && s && this.sel.face) parts.push(`<button data-crumb="face" aria-current="true">${{ top: 'Top', side: 'Face', plinth: 'Plinth', parapet: 'Parapet' }[this.sel.face.kind]}</button>`);
    if (this.sel.item) parts.push(`<button aria-current="true">Component</button>`);
    c.innerHTML = parts.join('<i>›</i>');
    this.renderModes();
    c.querySelectorAll<HTMLButtonElement>('button').forEach((btn) =>
      btn.addEventListener('click', () => {
        const k = btn.dataset.crumb;
        if (k === 'root') {
          const id = this.context;
          this.context = null;
          this.select(id ? { building: id } : {});
        } else if (k === 'building' && b) this.select({ building: b.id });
        else if (k === 'solid' && b && s) this.select({ building: b.id, solids: [s.id] });
      }),
    );
  }

  /** Selection outlines and handles. */
  drawSelection(): void {
    // Screen-space outline of the selected buildings (not while editing inside one: its own lines show
    // the volume or face chosen there).
    const outlined = !this.context && this.sel.building ? [this.sel.building, ...this.sel.others].map((id) => this.view.built.get(id)?.group).filter((g): g is THREE.Group => !!g) : [];
    this.view.look.setOutline(outlined);
    for (const c of [...this.selOverlay.children]) {
      this.selOverlay.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      if (m.material && !Array.isArray(m.material)) (m.material as THREE.Material).dispose();
    }
    const handles: Handle[] = [];
    const b = this.activeBuilding();
    // A street or a lot selected: a dot on each of its points (drag to reshape) and arrows to move it.
    const sp = this.view.sitePicked;
    if (!b && (sp.lot || sp.street)) {
      const pts = sp.street ? this.project.streets?.find((x) => x.id === sp.street)?.points : this.project.lots.find((x) => x.id === sp.lot)?.polygon;
      if (pts?.length) {
        pts.forEach((p, i) => handles.push({ kind: 'vertex', at: new THREE.Vector3(p[0], 0.3, p[1]), color: HANDLE_COLORS.vertex, label: sp.street ? 'Street point: drag it' : 'Lot corner: drag it', site: { index: i } }));
        const c = new THREE.Vector3(pts.reduce((a, p) => a + p[0], 0) / pts.length, 0.3, pts.reduce((a, p) => a + p[1], 0) / pts.length);
        handles.push({ kind: 'move-x', at: c.clone(), dir: new THREE.Vector3(1, 0, 0), color: HANDLE_COLORS.x, label: 'Move (X)', site: { index: -1 } });
        handles.push({ kind: 'move-z', at: c.clone(), dir: new THREE.Vector3(0, 0, 1), color: HANDLE_COLORS.z, label: 'Move (Z)', site: { index: -1 } });
      }
      this.handles.set(this.tool === 'select' || this.tool === 'move' ? handles : []);
      this.placeCtxBar();
      return;
    }
    // Interior walls tool: the nodes of the walls of the floor shown (drag) and each wall's middle
    // (Alt+click deletes the wall), in the building being edited.
    const iwb = this.tool === 'iwall' ? (this.store.building(this.context) ?? b) : undefined;
    if (iwb) {
      const lv = this.workLevel(iwb);
      const it = lv ? iwb.interiors[lv.id] : undefined;
      const hs: Handle[] = [];
      if (lv && it) {
        const IM = this.view.buildingMatrix(iwb);
        const y = lv.elevation + 0.05;
        const at = (q: Vec2) => new THREE.Vector3(q[0], y, q[1]).applyMatrix4(IM);
        const pos = new Map(it.nodes.map((n) => [n.id, n.p]));
        for (const n of it.nodes) hs.push({ kind: 'vertex', at: at(n.p), color: HANDLE_COLORS.vertex, label: 'Wall corner: drag it (its walls follow)', iwall: { level: lv.id, node: n.id } });
        for (const w of it.walls) {
          const a = pos.get(w.a),
            c = pos.get(w.b);
          if (a && c) hs.push({ kind: 'bend', at: at([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]), color: HANDLE_COLORS.bend, label: 'Wall: Alt+click deletes it', iwall: { level: lv.id, wall: w.id } });
        }
      }
      this.handles.set(hs);
      this.placeCtxBar();
      return;
    }
    // Floors drawn apart are not where the building is: its box, handles and dimensions would cross them
    // (and nothing can be edited meanwhile). The selection stays; the panel still shows it.
    if (!b || explodeGap(this.project) > 0) {
      this.handles.set([]);
      this.placeCtxBar();
      this.drawSelDims();
      return;
    }
    const M = this.view.buildingMatrix(b);
    const W = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]).applyMatrix4(M);
    // Outline with depth test: strong where it is in view, faint where
    // it passes behind walls and roofs (never a line crossing the facade).
    const line = (pts: THREE.Vector3[], color: string, closed = true, opacity = 1) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const Kind = closed ? THREE.LineLoop : THREE.Line;
      const front = new Kind(g, new THREE.LineBasicMaterial({ color, depthTest: true, transparent: opacity < 1, opacity }));
      const behind = new Kind(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.16 * opacity }));
      front.renderOrder = 20;
      behind.renderOrder = 19;
      this.selOverlay.add(front, behind);
    };
    // Box of the real bounds (local → world by the building matrix).
    const boxLines = (bb: Bounds, color: string, BM = M) => {
      const [x0, y0, z0] = bb.min,
        [x1, y1, z1] = bb.max;
      const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(BM);
      line([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], color);
      line([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], color);
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) line([P(x, y0, z), P(x, y1, z)], color, false);
    };
    const [ax, az] = [new THREE.Vector3(1, 0, 0).transformDirection(M), new THREE.Vector3(0, 0, 1).transformDirection(M)];
    // Other buildings selected together: the same box as the main one (every selected building reads as selected).
    for (const oid of this.sel.others) {
      const ob = this.store.building(oid);
      if (!ob) continue;
      const OM = this.view.buildingMatrix(ob);
      for (const s of ob.solids) if (s.op === 'add') line(solidRings(s).outer.pts.map((p) => new THREE.Vector3(p[0], s.base + 0.03, p[1]).applyMatrix4(OM)), '#2f7de1', true, 1);
      const ob3 = this.boundsOf(ob);
      if (ob3) boxLines(ob3, '#2f7de1', OM);
    }
    // Outline of each solid of the building (the selected one highlighted).
    const inCtx = this.context === b.id;
    for (const s of b.solids) {
      const r = solidRings(s);
      const sel = this.sel.solids.includes(s.id);
      if (!inCtx && !sel) {
        if (s.op !== 'add') continue;
        line(r.outer.pts.map((p) => W(p, s.base + 0.03)), '#2f7de1', true, 0.9);
        continue;
      }
      const color = sel ? '#e2702a' : s.op === 'add' ? '#2f7de1' : '#c026d3';
      const op = sel ? 1 : 0.45;
      // A cutter is outlined where it cuts something: between the lowest base and the highest top of the
      // adding volumes (a courtyard cutter 30 m tall left a square in the sky, 16 m over the roof).
      let lo = r.base,
        hi = r.top;
      if (s.op !== 'add' && !sel) {
        const adds = b.solids.filter((x) => x.op === 'add');
        if (adds.length) {
          lo = Math.max(lo, Math.min(...adds.map((x) => x.base)));
          hi = Math.min(hi, Math.max(...adds.map((x) => x.base + x.height)));
        }
      }
      const at = (y: number) => {
        const f = r.top > r.base ? Math.max(0, Math.min(1, (y - r.base) / (r.top - r.base))) : 0;
        return r.outer.pts.map((p, i) => {
          const q = r.topOuter[i] ?? p;
          return W([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], y);
        });
      };
      if (hi <= lo) continue;
      line(lo === r.base ? r.outer.pts.map((p) => W(p, r.base)) : at(lo), color, true, op);
      // Selected: the box wraps everything the volume generates (roof, overhang, parts).
      if (sel) {
        const bb = this.boundsOf(b, [s.id]);
        if (bb) boxLines(bb, color);
      } else line(hi === r.top ? r.topOuter.map((p) => W(p, r.top)) : at(hi), color, true, op);
    }
    // Whole building selected: the box of the real bounds.
    // Edge mode: the selected sides, at the base and at the top, in the selection color.
    const sEdges = inCtx ? this.activeSolid() : undefined;
    if (sEdges && this.sel.edges?.length)
      for (const ed of this.subOf(b, sEdges).edges)
        if (this.sel.edges.includes(ed.id)) for (const [a, c] of ed.segs) line([new THREE.Vector3(a[0], a[1], a[2]).applyMatrix4(M), new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(M)], '#e2702a', false);
    const whole = !inCtx ? this.boundsOf(b) : null;
    if (whole) boxLines(whole, '#2f7de1');
    // Slab lines (like FormIt levels): every floor visible on the facade.
    for (const lv of b.levels) {
      if (lv.elevation < 0.05) continue;
      for (const s of b.solids) {
        if (s.op !== 'add' || lv.elevation <= s.base + 0.05 || lv.elevation >= s.base + s.height - 0.05) continue;
        const r = solidRings(s);
        const f = (lv.elevation - s.base) / s.height;
        const pts = r.outer.pts.map((p, i) => {
          const q = r.topOuter[i] ?? p;
          return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f] as Vec2;
        });
        // Slightly outside the wall (does not fight it in depth).
        const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
        const out = pts.map((p) => {
          const dx = p[0] - c[0],
            dz = p[1] - c[1],
            l = Math.hypot(dx, dz) || 1;
          return W([p[0] + (dx / l) * 0.05, p[1] + (dz / l) * 0.05], lv.elevation);
        });
        line(out, '#ffffff', true, 0.55);
      }
    }
    // Selected face: translucent highlight of its triangles.
    const s0 = this.activeSolid();
    const built = this.view.built.get(b.id);
    if (s0 && this.sel.face && built) {
      const fk = this.sel.face.kind;
      const want = (f: FaceInfo | undefined) =>
        !!f && f.solid === s0.id && (fk === 'top' ? f.kind === 'top' || f.kind === 'roof' : fk === 'plinth' ? f.kind === 'plinth' : fk === 'parapet' ? f.kind === 'parapet' || f.kind === 'coping' : f.kind === 'side' && f.edge === this.sel.face!.edge);
      const { positions: P, indices: I, faceOf } = built.ev.shell;
      const pos: number[] = [];
      for (let t = 0; t < I.length / 3; t++) {
        if (!want(built.ev.faces[faceOf[t]!])) continue;
        for (let j = 0; j < 3; j++) {
          const i = I[t * 3 + j]! * 3;
          pos.push(P[i]!, P[i + 1]!, P[i + 2]!);
        }
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#e2702a', transparent: true, opacity: 0.28, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        m.applyMatrix4(M);
        m.renderOrder = 15;
        this.selOverlay.add(m);
      }
    }
    // Selected elements: an outline box on each.
    if (this.sel.elems.length && built) {
      const pos = this.elemBoxes(b, new Set(this.sel.elems));
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        // Strong where the element shows; faint where it is hidden (courtyard, another face).
        const front = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: true }));
        const behind = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false, transparent: true, opacity: 0.22 }));
        front.renderOrder = 22;
        behind.renderOrder = 21;
        this.selOverlay.add(front, behind);
      }
    }
    if (this.drag) {
      this.handles.set(this.handles.list.filter((h) => h.kind === (this.drag!.data.handle as string)));
      this.placeCtxBar();
      return;
    }
    if (!inCtx) {
      // Whole building: move on the ground and rotate.
      const bb = whole ?? this.prismBounds(b, b.solids.filter((x) => x.op === 'add'));
      if (bb) {
        // Above the highest point (roof included): visible from any angle, without crossing the model.
        const c = new THREE.Vector3((bb.min[0] + bb.max[0]) / 2, bb.max[1] + 0.6, (bb.min[2] + bb.max[2]) / 2).applyMatrix4(M);
        const R = Math.max(Math.hypot(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2 + 1.5, 4);
        handles.push(...this.moveHandles(c, ax, az), this.rotateHandle(c, R));
        handles.push(...this.sizeHandles(b, bb));
        // Green = move vertically (Rhino Gumball, TransformControls): the building leaves the ground and
        // snaps onto the top of another. Floors are not on the gizmo (contextual bar and panel).
        handles.push({ kind: 'move-y', at: c.clone(), dir: new THREE.Vector3(0, 1, 0), color: HANDLE_COLORS.y, label: 'Move vertically (snaps to the ground and to the top of other buildings; Alt: free)' });
      }
    } else if (this.sel.item) {
      const it = this.activeItem();
      if (it && (it.host.kind === 'free' || it.host.kind === 'roof')) {
        // Real height of the part (on a roof, that of the surface it is on).
        const pl = built?.ev.placements.find((q) => q.tag.item === it.id);
        const y = pl ? pl.frame[13]! : it.host.kind === 'free' ? it.host.p[1] : 0;
        const p = it.host.kind === 'free' ? it.host.p : [it.host.p[0], y, it.host.p[1]];
        const c = W([p[0]!, p[2]!], y + 0.05);
        handles.push(...this.moveHandles(c, ax, az), this.rotateHandle(c, 2.5));
      }
      // Part attached to a face: width, height and sill handles on it.
      if (it && it.host.kind === 'face' && built) {
        const pl = built.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
        if (pl) {
          const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
          const [w, h] = pl.family.size(pl.params);
          const op = pl.opening;
          const ow = op?.w ?? w,
            oh = op?.h ?? h;
          const P = (x: number, y: number) => new THREE.Vector3(x, y, 0.15).applyMatrix4(F);
          const U = new THREE.Vector3(1, 0, 0).transformDirection(F),
            V = new THREE.Vector3(0, 1, 0).transformDirection(F);
          // Slide it along the wall and up or down (the size handles on each side come below).
          handles.push({ kind: 'pmove', at: P(0, oh / 2).addScaledVector(U, -Math.max(0.6, ow / 2 + 0.35)), dir: U.clone().negate(), color: HANDLE_COLORS.x, label: 'Slide along the wall', pmove: 0 });
          handles.push({ kind: 'pmove', at: P(0, oh / 2).addScaledVector(U, Math.max(0.6, ow / 2 + 0.35)), dir: U.clone(), color: HANDLE_COLORS.x, label: 'Slide along the wall', pmove: 0 });
          handles.push({ kind: 'pmove', at: P(0, oh + 0.45), dir: V.clone(), color: HANDLE_COLORS.y, label: 'Up or down the wall', pmove: 1 });
        }
      }
      // A part drawn as a path: a dot on each of its points (drag to reshape); dragging the part moves it.
      if (it && it.host.kind === 'path') {
        const ps = it.host.points;
        ps.forEach((q, i) => handles.push({ kind: 'vertex', at: new THREE.Vector3(q[0], q[1] + 0.05, q[2]).applyMatrix4(M), color: HANDLE_COLORS.vertex, label: 'Path point: drag it (Alt+click removes it)', pathPt: i }));
        // Midpoints of the runs: dragging one adds a point there (Blender's edge slide / SketchUp's divide).
        const runs = it.host.closed ? ps.length : ps.length - 1;
        for (let i = 0; i < runs; i++) {
          const a = ps[i]!,
            c2 = ps[(i + 1) % ps.length]!;
          handles.push({ kind: 'bend', at: new THREE.Vector3((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 + 0.05, (a[2] + c2[2]) / 2).applyMatrix4(M), color: HANDLE_COLORS.bend, label: 'Drag to add a point here', pathPt: i, pathMid: true });
        }
      }
      // Any part, whatever its family: a handle on each side of its box that a length parameter moves
      // (eval/partsize.ts). On a wall, width and height keep the handles above.
      // A path part (wall, fence, hedge): the box of its first run, in that run's frame (x along it).
      if (it && built) {
        const pl = built.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
        const isPath = it.host.kind === 'path';
        const pts = it.host.kind === 'path' ? it.host.points : [];
        const runLen = isPath && pts.length >= 2 ? Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![2] - pts[0]![2]) : pl?.length ?? 1;
        const bx = pl && partBox(pl.family, pl.params, runLen);
        if (pl && bx && (!isPath || pts.length >= 2)) {
          let F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
          if (isPath) {
            const a = pts[0]!,
              c2 = pts[1]!;
            const ang = Math.atan2(-(c2[2] - a[2]), c2[0] - a[0]);
            F = new THREE.Matrix4().makeRotationY(ang).setPosition((a[0] + c2[0]) / 2, a[1], (a[2] + c2[2]) / 2).premultiply(M);
          }
          const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
          const c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
          // A handle on BOTH sides of each axis a parameter drives: the part grows toward the side dragged,
          // the opposite side stays where it is (the part slides by what that side would have moved).
          // Depth on a wall only grows outward (the wall is behind it).
          for (const d of dimParams(pl.family, pl.params)) {
            for (const side of [1, -1] as const) {
              if (it.host.kind === 'face' && d.axis === 2 && side < 0) continue;
              // A path part grows from its line (the length is its points): only the outer sides, no length.
              if (isPath && (side < 0 || d.axis === 0)) continue;
              // Only on a side that moves with this measure (a slab thickness grows downward only).
              if ((side > 0 ? d.up : d.down) < 0.25) continue;
              const q = [...c] as [number, number, number];
              q[d.axis] = side > 0 ? bx.max[d.axis]! : bx.min[d.axis]!;
              // Depth sits at a lower corner of the front, never over the middle of the part (where a drag moves it).
              if (d.axis === 2 && !isPath) {
                q[0] = bx.max[0];
                q[1] = bx.min[1];
              }
              const at = new THREE.Vector3(...q).applyMatrix4(F);
              const dir = axes[d.axis]!.clone().multiplyScalar(side).transformDirection(F);
              handles.push({ kind: 'pdim', at, dir, color: '#e2702a', label: `${d.label}: drag this side (type the value)`, square: true, param: { key: d.key, slope: d.slope, min: d.min, max: d.max, label: d.label, up: d.up, down: d.down, side, axis: d.axis } });
            }
          }
          // Scale it all together: the top corner (every size parameter by the same ratio).
          const dps = dimParams(pl.family, pl.params);
          if (dps.length) {
            const corner = new THREE.Vector3(bx.max[0], bx.max[1], it.host.kind === 'face' ? bx.max[2] : bx.max[2]).applyMatrix4(F);
            const ctr = new THREE.Vector3(c[0], bx.min[1], c[2]).applyMatrix4(F);
            handles.push({ kind: 'pscale', at: corner, dir: corner.clone().sub(ctr).normalize(), color: '#e2702a', label: 'Scale it all (proportions kept)', square: true });
          }
          // Free parts also go up and down (a lamp on a wall, a sign, a shelf).
          if (it.host.kind === 'free') handles.push({ kind: 'pmove', at: new THREE.Vector3(c[0], bx.max[1] + 0.6, c[2]).applyMatrix4(F), dir: new THREE.Vector3(0, 1, 0), color: HANDLE_COLORS.y, label: 'Up or down', pmove: 1 });
        }
      }
    } else if (this.sel.elems.length === 1 && this.sel.elems[0]!.startsWith('r|') && built) {
      // One element of a facade rule: the same size handles, written for this position only.
      const [, sid, rid, pos] = this.sel.elems[0]!.split('|');
      const pl = built.ev.placements.find((q) => q.tag.rule === rid && q.tag.key === pos && q.tag.solid === sid);
      const bx = pl && partBox(pl.family, pl.params, pl.length);
      if (pl && bx) {
        const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
        const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
        const c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
        for (const d of dimParams(pl.family, pl.params)) {
          const q = [...c] as [number, number, number];
          q[d.axis] = d.side > 0 ? bx.max[d.axis]! : bx.min[d.axis]!;
          if (d.axis === 2) {
            q[0] = bx.max[0];
            q[1] = bx.min[1];
          }
          handles.push({ kind: 'pdim', at: new THREE.Vector3(...q).applyMatrix4(F), dir: axes[d.axis]!.clone().multiplyScalar(d.side).transformDirection(F), color: '#e2702a', label: `${d.label} here only (drag; type the value)`, square: true, solid: sid, param: { key: d.key, slope: d.slope, min: d.min, max: d.max, label: d.label }, rule: { id: rid!, pos: pos!, v0: Number(pl.params[d.key] ?? 1) } });
        }
      }
    } else if (s0) {
      const r = solidRings(s0);
      const ctr = planCenter(s0);
      const base = W(ctr, s0.base + 0.05);
      const top = W(ctr, r.top);
      const faceMode = !!this.sel.face;
      // Move and rotate above the top of the volume (without crossing the walls); with a face chosen, only the face arrow.
      const sb = this.boundsOf(b, [s0.id]);
      // Gizmo raised in pixels above the real top: the height square (on top) always stays below it.
      const over = W(ctr, sb ? sb.max[1] : r.top);
      if (!faceMode) {
        handles.push(...this.moveHandles(over, ax, az).map((h) => ({ ...h, liftPx: 46 })));
        handles.push({ kind: 'move-y', at: over.clone(), dir: new THREE.Vector3(0, 1, 0), liftPx: 46, color: HANDLE_COLORS.y, label: 'Move vertically: base elevation (snaps to tops, bases and floors; Alt: free)' });
        handles.push({ kind: 'height', at: over.clone(), square: true, color: '#ffffff', label: 'Volume height: drag the top (floor by floor; Alt: free; type the value)' });
        const R = Math.max(...r.outer.pts.map((p) => Math.hypot(p[0] - ctr[0], p[1] - ctr[1]))) + 1.2;
        handles.push(this.rotateHandle(over, R));
        // Corners resize; each side has its own push/pull arrow (below).
        if (sb) handles.push(...this.sizeHandles(b, sb).filter((h) => h.sx && h.sz));
        // Made on a face: one depth arrow on its free face, measured from the wall (out adds, in cuts);
        // the wall side has none (pulling it only stretched a cutter into the air).
        const hf = hostedFrame(s0);
        const along = hf ? [s0.plan.outer[0]!.id, s0.plan.outer[2]!.id] : [];
        if (hf) {
          const mid: Vec2 = [(hf.a[0] + hf.z[0]) / 2 + hf.n[0] * hf.depth, (hf.a[1] + hf.z[1]) / 2 + hf.n[1] * hf.depth];
          const dir = new THREE.Vector3(hf.n[0], 0, hf.n[1]).transformDirection(M);
          handles.push({ kind: 'push', hosted: true, at: W(mid, s0.base + s0.height / 2), dir, normal: dir.clone(), solid: s0.id, color: HANDLE_COLORS.push, label: 'Depth from the wall: pull out for a projection, push in for a niche (type the value; − = niche)' });
        }
        for (const ring of [s0.plan.outer, ...s0.plan.holes])
          ring.forEach((v, k) => {
            if (along.includes(v.id)) return;
            const n = edgeNormal(s0, v.id);
            if (!n) return;
            const mid = midOf(v, ring[(k + 1) % ring.length]!);
            const dir = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
            handles.push({ kind: 'push', at: W(mid, s0.base + s0.height / 2), dir, normal: dir.clone(), solid: s0.id, edge: v.id, color: HANDLE_COLORS.push, label: 'Push/pull this side (Ctrl: extrude)' });
          });
      }
      // Top chosen: orange push/pull arrow, like the side faces (Ctrl: extrude).
      if (faceMode && this.sel.face?.kind === 'top') handles.push({ kind: 'height', at: top, dir: new THREE.Vector3(0, 1, 0), solid: s0.id, color: HANDLE_COLORS.push, label: 'Push/pull the top (floor by floor; Alt: free; Ctrl: extrude)' });
      void base;
      // Vertices and side midpoints (bend), at the base when tapered, otherwise on top.
      const yv = s0.taper > 0.01 || s0.loft ? r.base : r.top;
      for (const ring of [s0.plan.outer, ...s0.plan.holes])
        ring.forEach((v, i) => {
          const n = ring[(i + 1) % ring.length]!;
          handles.push({ kind: 'vertex', at: W(v.p, yv), solid: s0.id, vertex: v.id, color: this.sel.verts?.includes(v.id) ? HANDLE_COLORS.push : HANDLE_COLORS.vertex, label: 'Vertex' });
          const mid = midOf(v, n);
          handles.push({ kind: 'bend', at: W(mid, yv), solid: s0.id, edge: v.id, color: HANDLE_COLORS.bend, label: 'Bend (snaps to straight and to a half circle; Alt: free)' });
        });
      // Twist: a dot on the top, toward the first corner; dragging it around turns the top against the base.
      if (!faceMode && s0.op === 'add' && !s0.revolve) {
        const v0 = s0.plan.outer[0]!.p;
        const tp: Vec2 = [ctr[0] + (v0[0] - ctr[0]) * 0.55, ctr[1] + (v0[1] - ctr[1]) * 0.55];
        handles.push({ kind: 'twist', at: W(tp, r.top + 0.02), solid: s0.id, color: HANDLE_COLORS.ring, label: 'Twist: drag around to turn the top (5° steps; Alt: free)' });
      }
      if (this.sel.face?.kind === 'side' && this.sel.face.edge) {
        const n = edgeNormal(s0, this.sel.face.edge);
        const loc = s0.plan.outer.concat(...s0.plan.holes);
        const vi = loc.findIndex((v) => v.id === this.sel.face!.edge);
        if (n && vi >= 0) {
          const ringOf = [s0.plan.outer, ...s0.plan.holes].find((rg) => rg.some((v) => v.id === this.sel.face!.edge))!;
          const k = ringOf.findIndex((v) => v.id === this.sel.face!.edge);
          const mid = midOf(ringOf[k]!, ringOf[(k + 1) % ringOf.length]!);
          const at = W(mid, s0.base + s0.height / 2);
          const dir = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
          handles.push({ kind: 'push', at, dir, normal: dir.clone(), solid: s0.id, edge: this.sel.face.edge, color: HANDLE_COLORS.push, label: 'Push/pull (Ctrl: extrude)' });
        }
      }
    }
    // A visible handle is a clickable handle: only the manipulating tools (Select and Push) show them.
    // Move, Rotate and Scale show only the handles of that action (like W/E/R in Blender and three.js).
    const only: Partial<Record<Tool, HandleKind[]>> = {
      move: ['move-x', 'move-z', 'move-xz', 'move-y', 'pmove'],
      rotate: ['rotate'],
      scale: ['size', 'height', 'push', 'cwidth', 'cheight', 'pdim', 'pscale'],
    };
    const keep = only[this.tool];
    this.handles.set(!this.handlesLive() ? [] : keep ? handles.filter((h) => keep.includes(h.kind)) : handles);
    this.placeCtxBar();
    this.drawSelDims();
  }

  /** Tools in which handles respond to clicks (and therefore show). */
  private handlesLive(): boolean {
    if (this.presenting) return false;
    return this.selectLike() || this.pushLike();
  }

  /** Select and the transform tools (Move, Rotate, Scale): they click, select and drag alike. */
  selectLike(): boolean {
    return this.tool === 'select' || this.tool === 'move' || this.tool === 'rotate' || this.tool === 'scale';
  }

  /** Push/pull and Extrude: a click on a face starts changing it right away. */
  pushLike(): boolean {
    return this.tool === 'push' || this.tool === 'extrude';
  }

  /**
   * Size handles on the bounding box (building axes): sides pull one axis,
   * corners both; the opposite side stays put. Shift keeps the proportion.
   */
  private sizeHandles(b: Building3, bb: Bounds): Handle[] {
    const [x0, y, z0] = [bb.min[0], bb.max[1], bb.min[2]],
      [x1, z1] = [bb.max[0], bb.max[2]];
    const M = this.view.buildingMatrix(b);
    const out: Handle[] = [];
    // At the corners and midpoints of the real box top (where the box is drawn).
    for (const sx of [-1, 0, 1])
      for (const sz of [-1, 0, 1]) {
        if (!sx && !sz) continue;
        const x = sx < 0 ? x0 : sx > 0 ? x1 : (x0 + x1) / 2;
        const z = sz < 0 ? z0 : sz > 0 ? z1 : (z0 + z1) / 2;
        out.push({ kind: 'size', at: new THREE.Vector3(x, y, z).applyMatrix4(M), sx, sz, color: '#ffffff', label: sx && sz ? 'Size (drag the corner; Shift keeps the proportion; type 12x8)' : sx ? 'Width (drag; type the value)' : 'Depth (drag; type the value)' });
      }
    return out;
  }

  /** Real bounds (building frame) of the whole building or of some solids. */
  /** The visible, unlocked building whose box is nearest to a ground point (world x, z). */
  /**
   * The building a part placed at a world point outside every building belongs to: the one being edited,
   * else the nearest within 30 m, else a new "Site" building there (not yet in the project: whoever places
   * the part adds it). Before, a fence drawn in an empty corner went to the first building of the project.
   */
  private ownerAt(x: number, z: number): Building3 {
    const b = this.store.building(this.context) ?? this.nearestBuilding(x, z, 30);
    if (b) return b;
    const n = this.project.buildings.filter((q) => /^Site( \d+)?$/.test(q.name)).length;
    return newBuilding({ name: n ? `Site ${n + 1}` : 'Site', position: [x, z], use: 'public', levels: levelsFor(1) });
  }

  /** Adds a building made by `ownerAt` to the project (no-op for one already in it). */
  private adopt(b: Building3): void {
    if (!this.store.building(b.id)) this.store.project.buildings.push(b);
  }

  private nearestBuilding(x: number, z: number, within = Infinity): Building3 | undefined {
    let best: Building3 | undefined;
    let bd = within;
    for (const b of this.project.buildings) {
      if (buildingHidden(this.project, b) || buildingLocked(this.project, b)) continue;
      const bb = this.boundsOf(b);
      const l = toLocal(b, [x, z]);
      const d = bb ? Math.hypot(Math.max(bb.min[0] - l[0], 0, l[0] - bb.max[0]), Math.max(bb.min[2] - l[1], 0, l[1] - bb.max[2])) : Math.hypot(l[0], l[1]);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  boundsOf(b: Building3, solids?: ID[], bodyOnly = false): Bounds | null {
    const built = this.view.built.get(b.id);
    const set = solids ? new Set(solids) : undefined;
    // A free part attached to a face or roof belongs to the solid that hosts it.
    const host = (t: { item?: ID }) => {
      const it = t.item ? b.items.find((x) => x.id === t.item) : undefined;
      return it && (it.host.kind === 'face' || it.host.kind === 'roof') ? it.host.solid : undefined;
    };
    // A cutter is edited for what it is (the cutting prism), not for the hole it left.
    const cutters = !!solids && solids.every((id) => b.solids.find((s) => s.id === id)?.op !== 'add');
    const bb = built && !cutters ? evaluatedBounds(built.ev, set, host, bodyOnly) : null;
    if (bb) return bb;
    // Cutter (not in the shell) or not evaluated yet: the declared prism.
    return this.prismBounds(b, solids ? b.solids.filter((s) => set!.has(s.id)) : b.solids.filter((s) => s.op === 'add'));
  }

  /** Orbit pivot: the model under the cursor, else the active building, else every visible building. */
  private orbitPivot(e: { clientX: number; clientY: number }): THREE.Vector3 {
    const hit = this.view.modelAt(e);
    if (hit) return hit;
    const b = this.activeBuilding();
    const box = b ? this.worldBox(b) : null;
    if (box) return box.getCenter(new THREE.Vector3());
    const all = new THREE.Box3();
    for (const x of this.project.buildings) {
      if (x.hidden) continue;
      const bb = this.worldBox(x);
      if (bb) all.union(bb);
    }
    return all.isEmpty() ? this.view.target.clone() : all.getCenter(new THREE.Vector3());
  }

  /** Building box in the world (real bounds, with rotation and elevation). */
  private worldBox(b: Building3): THREE.Box3 | null {
    const bb = this.boundsOf(b);
    if (!bb) return null;
    const M = this.view.buildingMatrix(b);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) box.expandByPoint(v.set(i & 1 ? bb.max[0] : bb.min[0], i & 2 ? bb.max[1] : bb.min[1], i & 4 ? bb.max[2] : bb.min[2]).applyMatrix4(M));
    return box;
  }

  /** Declared prism of the solids: plan outline, from the base to the top of the walls. */
  private prismBounds(_b: Building3, solids: Solid[]): Bounds | null {
    if (!solids.length) return null;
    const min: Bounds['min'] = [Infinity, Infinity, Infinity],
      max: Bounds['max'] = [-Infinity, -Infinity, -Infinity];
    for (const s of solids)
      for (const v of s.plan.outer) {
        min[0] = Math.min(min[0], v.p[0]);
        max[0] = Math.max(max[0], v.p[0]);
        min[2] = Math.min(min[2], v.p[1]);
        max[2] = Math.max(max[2], v.p[1]);
        min[1] = Math.min(min[1], s.base);
        max[1] = Math.max(max[1], s.base + s.height);
      }
    return { min, max };
  }

  private moveHandles(c: THREE.Vector3, ax: THREE.Vector3, az: THREE.Vector3): Handle[] {
    return [
      { kind: 'move-x', at: c, dir: ax, color: HANDLE_COLORS.x, label: 'Move on the red axis' },
      { kind: 'move-z', at: c, dir: az, color: HANDLE_COLORS.z, label: 'Move on the blue axis' },
      { kind: 'move-xz', at: c, plane: [ax.clone().normalize(), az.clone().normalize()], color: HANDLE_COLORS.plane, label: 'Move on the ground' },
    ];
  }

  private rotateHandle(c: THREE.Vector3, R: number): Handle {
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) ring.push(new THREE.Vector3(c.x + Math.cos((i / 64) * Math.PI * 2) * R, c.y, c.z + Math.sin((i / 64) * Math.PI * 2) * R));
    return { kind: 'rotate', at: new THREE.Vector3(c.x + R * Math.cos(-0.6), c.y, c.z + R * Math.sin(-0.6)), ring, color: HANDLE_COLORS.ring, label: 'Rotate' };
  }

  // ── Contextual bar ───────────────────────────────────────────────────
  /**
   * Selection rectangle in the view (view pixels): the projected real box plus
   * the handles (gizmo, arrows), so the bar covers none of them.
   */
  private selectionScreenRect(): { left: number; top: number; right: number; bottom: number } | null {
    const b = this.activeBuilding();
    if (!b) return null;
    const bb = this.context === b.id && this.sel.solids.length ? this.boundsOf(b, this.sel.solids) : this.boundsOf(b);
    if (!bb) return null;
    const M = this.view.buildingMatrix(b);
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max[0] : bb.min[0], i & 2 ? bb.max[1] : bb.min[1], i & 4 ? bb.max[2] : bb.min[2]).applyMatrix4(M);
      const sp = this.view.toScreen(v);
      if (sp.behind) continue;
      left = Math.min(left, sp.x);
      right = Math.max(right, sp.x);
      top = Math.min(top, sp.y);
      bottom = Math.max(bottom, sp.y);
    }
    // The gizmo stands on the top centre at a constant screen size (lifted 46 px, arrow ~104 px, tip): its
    // room is kept for every tool, so the bar stays put when Move, Rotate or Scale show different handles
    // (before, it jumped ~27 px between them). The other handles only widen the sides and the bottom.
    const tc = this.view.toScreen(v.set((bb.min[0] + bb.max[0]) / 2, bb.max[1], (bb.min[2] + bb.max[2]) / 2).applyMatrix4(M));
    if (!tc.behind) top = Math.min(top, tc.y - 160);
    const vr = this.shell.view.getBoundingClientRect();
    for (const f of this.handles.footprints()) {
      left = Math.min(left, f.left - vr.left);
      right = Math.max(right, f.right - vr.left);
      bottom = Math.max(bottom, f.bottom - vr.top);
    }
    return left <= right ? { left, top, right, bottom } : null;
  }

  /**
   * Places the contextual bar (ui/actions.ts) above the selection, centered;
   * below when it does not fit; inside the view. Called on every camera or
   * selection change (it only positions: it notifies no one, so orbiting does
   * not redraw panels).
   */
  placeCtxBar(): void {
    const bar = this.shell.ctxbar;
    if (bar.hidden) return;
    // Out of the way while something is dragged (as Figma does): it followed the growing selection and
    // jumped from above the building to below it in the middle of a height drag.
    const dragging = !!this.drag?.moved;
    bar.style.visibility = dragging ? 'hidden' : '';
    if (dragging) return;
    const vw = this.shell.view.clientWidth,
      vh = this.shell.view.clientHeight;
    const w = bar.offsetWidth,
      h = bar.offsetHeight;
    const r = this.selectionScreenRect();
    const gap = 12,
      pad = 8;
    let x = (vw - w) / 2,
      y = pad;
    if (r) {
      x = (r.left + r.right) / 2 - w / 2;
      y = r.top - h - gap;
      if (y < pad) y = r.bottom + gap <= vh - h - pad ? r.bottom + gap : pad;
    }
    x = Math.max(pad, Math.min(vw - w - pad, x));
    y = Math.max(pad, Math.min(vh - h - pad, y));
    // Never over an island of the view (breadcrumb, selection modes, View island, last operation panel,
    // interior view): slide sideways past it, else below it, else above it — a few passes, as moving off
    // one island can land on another.
    const v = this.shell.view.getBoundingClientRect();
    const rects = [...this.shell.view.querySelectorAll<HTMLElement>('.f3-island, .f3-warn.on')]
      .filter((el) => !el.hidden && el.getClientRects().length > 0)
      .map((el) => {
        const q = el.getBoundingClientRect();
        return { L: q.left - v.left - gap, R: q.right - v.left + gap, T: q.top - v.top - gap, B: q.bottom - v.top + gap };
      });
    const hits = (px: number, py: number) => rects.find((q) => px < q.R && px + w > q.L && py < q.B && py + h > q.T);
    for (let pass = 0; pass < 4; pass++) {
      const q = hits(x, y);
      if (!q) break;
      if (q.R + w + pad <= vw && !hits(q.R, y)) x = q.R;
      else if (q.L - w >= pad && !hits(q.L - w, y)) x = q.L - w;
      else if (q.B + h + pad <= vh) y = q.B;
      else y = Math.max(pad, q.T - h);
    }
    bar.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ── Commands ─────────────────────────────────────────────────────────
  command(cmd: string): void {
    const b = this.activeBuilding();
    const s = this.activeSolid();
    switch (cmd) {
      case 'enter':
        if (b) this.enter(b.id);
        break;
      case 'exit':
        this.exitContext();
        break;
      case 'op-add':
      case 'op-subtract':
      case 'op-intersect':
        if (s) this.changeSolid((x) => void (x.op = cmd.slice(3) as Solid['op']), cmd === 'op-add' ? 'The volume adds to the building.' : cmd === 'op-subtract' ? 'The volume now cuts the building.' : 'Only the common part remains.');
        break;
      case 'dup':
        this.duplicate();
        break;
      case 'mirror':
        // Several volumes mirror together about the middle of their box (Blender's median point), so the
        // group flips as one; one volume about its own center.
        if (b && s && this.sel.solids.length > 1) {
          const boxes = this.sel.solids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x).map(volumeBox);
          const cx = (Math.min(...boxes.map((q) => q.x0)) + Math.max(...boxes.map((q) => q.x1))) / 2;
          this.change(b.id, (x) => this.sel.solids.forEach((id) => { const v = findSolid(x, id); if (v) mirrorSolid(v, 'x', [cx, 0]); }), `${this.sel.solids.length} volumes mirrored.`);
        } else if (s) this.changeSolid((x) => mirrorSolid(x, 'x'), 'Volume mirrored.');
        break;
      case 'mirror-copy-x':
      case 'mirror-copy-z': {
        // A mirrored copy next to the original, across the right (X) or back (Z) side of the selection box
        // (SketchUp/Blender "mirror copy"): a symmetric wing in one step.
        if (!b || !s) break;
        const axis = cmd.endsWith('x') ? 'x' : 'z';
        const ids = this.sel.solids.length ? this.sel.solids : [s.id];
        const boxes = ids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x).map(volumeBox);
        const c: Vec2 = [Math.max(...boxes.map((q) => q.x1)), Math.max(...boxes.map((q) => q.z1))];
        const made: ID[] = [];
        this.change(b.id, (x) => {
          for (const id of ids) {
            const src = findSolid(x, id);
            if (!src) continue;
            const cp = cloneSolid(src);
            cp.name = `${src.name} (mirror)`;
            mirrorSolid(cp, axis, c);
            x.solids.push(cp);
            made.push(cp.id);
          }
        }, `Mirrored copy across the ${axis === 'x' ? 'right' : 'back'} side.`);
        if (made.length) this.select({ building: b.id, solids: made });
        break;
      }
      case 'rot90':
        if (b && this.context !== b.id && this.sel.others.length) this.rotateBuildings(90);
        else if (b) this.change(b.id, (x) => void (x.rotation = (x.rotation + 90) % 360), 'Rotated 90°.', false);
        break;
      case 'del':
        this.remove();
        break;
      case 'undo':
        // Like Blender: undo/redo closes the last operation panel (its values no longer apply), and the
        // measure box no longer corrects the operation that was undone.
        this.clearLastOp();
        this.clearMeasure();
        if (this.store.undo()) this.toast('Undone.');
        break;
      case 'redo':
        this.clearLastOp();
        this.clearMeasure();
        if (this.store.redo()) this.toast('Redone.');
        break;
      case 'frame':
        this.frameSelection();
        break;
      case 'snap':
        this.toggleSnap();
        break;
      case 'library':
        this.toggleLibrary();
        break;
      case 'palette':
        this.paletteRequested?.();
        break;
      case 'help':
        this.helpRequested?.();
        break;
    }
  }

  /** The command search (ui/palette.ts) listens to this. */
  paletteRequested: (() => void) | null = null;
  /** Workspace (ui/workspaces.ts): the tools it offers (null: all) and whether it only presents. */
  workspace = 'model';
  private wsTools: Set<Tool> | null = null;
  presenting = false;
  workspaceRequested: ((id: string) => void) | null = null;
  /** A workspace switch: never a project edit; it filters tools, handles and the contextual bar. */
  setWorkspace(id: string, tools: Set<Tool> | null, present: boolean): void {
    this.workspace = id;
    this.wsTools = tools;
    this.presenting = present;
    if (tools && !tools.has(this.tool)) this.setTool('select');
    this.renderTools();
    this.drawSelection();
    this.emit();
  }

  /** Whether the current workspace offers a tool. */
  toolOffered(t: Tool): boolean {
    return !this.wsTools || this.wsTools.has(t);
  }

  /** The preferences dialog (ui/prefs.ts). */
  prefsRequested: (() => void) | null = null;
  /** Opens (true), closes (false) or toggles the plan view (ui/planview.ts). */
  planRequested: ((on?: boolean) => void) | null = null;
  /** Shows the guide of the current stage again (ui/workspaces.ts). */
  guideRequested: (() => void) | null = null;
  /** Mouse navigation preset (ui/prefs.ts): which middle-button drag pans and which orbits. */
  navPreset: 'forma' | 'sketchup' | 'blender' = 'forma';

  frameSelection(): void {
    const b = this.activeBuilding();
    const g = b && this.view.built.get(b.id)?.group;
    this.view.frame(g ? new THREE.Box3().setFromObject(g) : undefined);
  }

  duplicate(): void {
    const b = this.activeBuilding();
    if (!b) return;
    if (this.context === b.id && this.sel.item) {
      const it = this.activeItem()!;
      const c = structuredClone(it);
      c.id = uid();
      // Beside the original, one part width (and a hand) away: along the side, back the other way when the
      // side ends (before, 1.5 m: a wide part landed on itself).
      const t = typeById(it.type, this.project);
      const f = t && family(t.family);
      const pr = f ? resolveParams(f, t!.params, it.params) : {};
      const w = Math.max(0.5, Number(pr.width ?? pr.w ?? 1)) + 0.4;
      if (c.host.kind === 'face') {
        const hs = findSolid(b, c.host.solid);
        const len = hs ? edgeLength(hs, c.host.edge) : Infinity;
        c.host.u = c.host.u + w + w / 2 <= len ? c.host.u + w : Math.max(w / 2, c.host.u - w);
      } else if (c.host.kind === 'free') c.host.p = [c.host.p[0] + w, c.host.p[1], c.host.p[2]];
      else if (c.host.kind === 'roof') c.host.p = [c.host.p[0] + w, c.host.p[1]];
      else if (c.host.kind === 'path') c.host.points = c.host.points.map((p) => [p[0] + 2, p[1], p[2] + 2] as Vec3);
      this.change(b.id, (x) => void x.items.push(c), 'Component duplicated.');
      this.select({ building: b.id, item: c.id });
      return;
    }
    if (this.context === b.id && this.sel.solids.length) {
      const ids: ID[] = [];
      // The copies keep their arrangement and go beside the selected volumes, on a free spot of the
      // building (before, 2 m off: the copy went through the original).
      const chosen = this.sel.solids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x);
      // The other volumes and the other buildings (their boxes seen from this building's frame).
      const rest = b.solids.filter((x) => x.op === 'add' && !chosen.includes(x)).map(volumeBox);
      for (const o of this.project.buildings) {
        if (o === b) continue;
        const ob = buildingBox(o);
        if (!ob) continue;
        const cs = [[ob.x0, ob.z0], [ob.x1, ob.z0], [ob.x1, ob.z1], [ob.x0, ob.z1]].map((q) => toLocal(b, q as Vec2));
        rest.push({ x0: Math.min(...cs.map((q) => q[0])), x1: Math.max(...cs.map((q) => q[0])), z0: Math.min(...cs.map((q) => q[1])), z1: Math.max(...cs.map((q) => q[1])) });
      }
      const [dx, dz] = freeShift(chosen.map(volumeBox), rest, 2);
      this.change(
        b.id,
        (x) => {
          for (const sid of this.sel.solids) {
            const src = findSolid(x, sid);
            if (!src) continue;
            const c = cloneSolid(src);
            translateSolid(c, dx, dz);
            c.name = src.name.replace(/( \(copy\))+$/, '') + ' (copy)';
            x.solids.push(c);
            ids.push(c.id);
          }
        },
        ids.length > 1 || this.sel.solids.length > 1 ? `${this.sel.solids.length} volumes duplicated.` : 'Volume duplicated.',
      );
      this.select({ building: b.id, solids: ids });
      return;
    }
    // Every selected building (the arrangement between them is kept), on the nearest free ground beside the
    // group: right, left, front or back, by steps of the group's real size plus 3 m, touching no building
    // (before, 4 m away: the copy went through the original).
    const sel = this.selectedBuildings().map((id) => this.store.building(id)).filter((x): x is Building3 => !!x);
    const box = (bx: Building3): PlanBox | null => {
      const bb = this.boundsOf(bx);
      if (!bb) return null;
      const r = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
      for (const cx of [bb.min[0], bb.max[0]])
        for (const cz of [bb.min[2], bb.max[2]]) {
          const w = toWorld(bx, [cx, cz]);
          r.x0 = Math.min(r.x0, w[0]);
          r.x1 = Math.max(r.x1, w[0]);
          r.z0 = Math.min(r.z0, w[1]);
          r.z1 = Math.max(r.z1, w[1]);
        }
      return r;
    };
    const group = sel.map(box).filter((q): q is PlanBox => !!q);
    const others = this.project.buildings.filter((o) => !sel.includes(o)).map(box).filter((q): q is PlanBox => !!q);
    const [shiftX, shiftZ] = freeShift(group, others, 3);
    const copies = sel.flatMap((src) => {
      const c = cloneBuilding(src);
      c.position = [src.position[0] + shiftX, src.position[1] + shiftZ];
      c.name = src.name + ' (copy)';
      this.store.project.buildings.push(c);
      return [c.id];
    });
    const msg = copies.length > 1 ? `${copies.length} buildings duplicated.` : 'Building duplicated.';
    if (!this.store.commit(copies, msg)) return;
    this.toast(msg);
    this.selectBuildings(copies);
  }

  remove(): void {
    const b = this.activeBuilding();
    if (!b) return;
    if (this.context === b.id && this.sel.verts?.length) {
      const ids = this.sel.verts;
      // Every selected corner (a volume keeps at least 3).
      if (this.changeSolid((s) => ids.every((vid) => removeVertex(s, vid)), ids.length > 1 ? `${ids.length} vertices deleted.` : 'Vertex deleted.')) this.select({ building: b.id, solids: this.sel.solids });
      else this.toast('Not possible: a volume keeps at least 3 corners.');
      return;
    }
    if (this.context === b.id && this.sel.item) {
      this.change(b.id, (x) => void (x.items = x.items.filter((i) => i.id !== this.sel.item)), 'Component deleted.');
      return this.select({ building: b.id });
    }
    if (this.context === b.id && this.sel.elems.length) return this.elemAction('remove');
    if (this.context === b.id && this.sel.solids.length) {
      const del = new Set(this.sel.solids);
      this.change(b.id, (x) => {
        x.solids = x.solids.filter((s) => !del.has(s.id));
        x.items = x.items.filter((i) => !((i.host.kind === 'face' || i.host.kind === 'roof') && del.has(i.host.solid)));
      }, 'Volume deleted.');
      return this.select({ building: b.id });
    }
    const del = new Set(this.context === b.id ? [b.id] : this.selectedBuildings());
    this.store.project.buildings = this.store.project.buildings.filter((x) => !del.has(x.id));
    if (this.context && del.has(this.context)) this.context = null;
    const msg = del.size > 1 ? `${del.size} buildings deleted.` : 'Building deleted.';
    if (!this.store.commit(null, msg)) return;
    this.toast(`${msg} Ctrl+Z undoes.`);
    this.select({});
  }

  /**
   * Modeling operations on the selection (panel, measure box): face extrude
   * and inset, offset, split, size, bevel, corners.
   */
  modelOp(op: string, a: Record<string, number | string | boolean> = {}): boolean {
    const b = this.activeBuilding(),
      s = this.activeSolid();
    if (!b || !s) return false;
    const n = (k: string, d = 0) => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : d);
    let created: Solid | null = null;
    let cornerLimited: number | null = null;
    const edge = this.sel.face?.kind === 'side' ? this.sel.face.edge : undefined;
    // Edge mode: every selected side; otherwise the side of the chosen face.
    const edgeList = this.sel.edges?.length ? this.sel.edges : edge ? [edge] : [];
    const msgs: Record<string, string> = {
      extrude: n('depth') >= 0 ? 'Face extruded (new volume).' : 'Face pushed in.',
      'inset-side': n('depth') >= 0 ? 'Projection created.' : 'Niche created (cutter).',
      'inset-top': n('depth') >= 0 ? 'Volume on the top created.' : 'Recess in the top created (cutter).',
      offset: a.copy ? 'Offset copy created.' : 'Outline offset.',
      split: 'Volume split in two.',
      size: 'Size applied.',
      bevel: (() => {
        // Without a width (here or on a side) segments and profile have nothing to shape yet: say so.
        const cur = s.bevel ?? { top: 0, bottom: 0 };
        const w = Math.max(n('top', cur.top), n('bottom', cur.bottom), ...Object.values(s.edges).map((e) => e.bevel ?? 0));
        return w > 0 ? 'Bevel applied.' : 'Segments and profile kept: give the bevel a width (Top or Base) to see them.';
      })(),
      'edge-bevel': 'Side bevel applied.',
      'edge-offset': 'Edge moved.',
      'edge-curve': n('sag') ? 'Edge curved.' : 'Edge straightened.',
      'edge-split': 'Edge split in two.',
      corner: 'Corner adjusted.',
    };
    const layer = activeLayer(this.project);
    const run = (x: Building3): boolean => {
        const so = findSolid(x, s.id)!;
        switch (op) {
          case 'extrude':
            if (!edge) return false;
            // Sinking the whole face is pushing it in: the wall keeps its windows, shops and parapet (a
            // full-face cutter left a blank cut face). A niche with margins is Inset.
            if (n('depth') < 0) return pushEdge(so, edge, n('depth'));
            created = extrudeSide(x, so, edge, n('depth'));
            return !!created;
          case 'inset-side':
            if (!edge) return false;
            created = insetSide(x, so, edge, n('margin', 1), n('depth', -1), !!a.keepBottom);
            return !!created;
          case 'inset-top':
            created = insetTop(x, so, n('inset'), n('depth'));
            return !!created;
          case 'offset': {
            const corner = (a.corner as 'sharp' | 'round' | 'chamfer' | undefined) ?? 'sharp';
            const before = structuredClone(so);
            if (a.copy) {
              created = offsetCopy(x, so, n('d'), corner);
              if (created) return true;
              const pieces = clipperOffset(so.plan, n('d'), corner);
              if (!pieces.length) return false;
              const roof0 = structuredClone(so.roof);
              const made = pieces.map((pc) => {
                const c = cloneSolid(so);
                c.plan = { outer: planVertices(pc.outer), holes: pc.holes.map((h) => planVertices(h)) };
                c.edges = {};
                so.roof = structuredClone(roof0);
                stackOnTop(x, so, c);
                x.solids.push(c);
                return c;
              });
              // The copies take the settings and rules of the sides they come from (new IDs: the source keeps its own).
              adoptOffsetSides(before, made, n('d'));
              const own = new Set([before.plan.outer, ...before.plan.holes].flat().map((v) => v.id));
              for (const c of made) {
                const ids = new Map<ID, ID>();
                for (const ring of [c.plan.outer, ...c.plan.holes]) for (const v of ring) if (own.has(v.id)) ids.set(v.id, uid());
                for (const ring of [c.plan.outer, ...c.plan.holes]) for (const v of ring) if (ids.has(v.id)) v.id = ids.get(v.id)!;
                c.edges = Object.fromEntries(Object.entries(c.edges).map(([k, e]) => [ids.get(k) ?? k, e]));
                c.facade = c.facade.map((r) => ({ ...r, id: uid(), edges: r.edges.map((e) => ids.get(e) ?? e), except: {} }));
              }
              created = made[made.length - 1]!;
              return true;
            }
            if (offsetSolid(so, n('d'), corner)) return true;
            // The exact offset cannot keep the shape (a part vanishes or the outline splits): Clipper2 gives
            // what is left, each piece as a volume (arcs sampled); each new side gets the identity, settings and
            // rules of the side it comes from (model/modeling.ts, adoptOffsetSides).
            const pieces = clipperOffset(so.plan, n('d'), corner);
            if (!pieces.length) return false;
            const vols = pieces.map((pc, i) => {
              const t = i === 0 ? so : cloneSolid(so);
              t.plan = { outer: planVertices(pc.outer), holes: pc.holes.map((h) => planVertices(h)) };
              t.edges = {};
              if (i > 0) {
                t.name = `${so.name} ${i + 1}`;
                x.solids.push(t);
              }
              return t;
            });
            adoptOffsetSides(before, vols, n('d'), x.items);
            return true;
          }
          case 'split':
            created = splitAtHeight(x, so, n('y'));
            return !!created;
          case 'size':
            return setSolidSize(so, n('w'), n('d'));
          case 'bevel': {
            const cur = so.bevel ?? { top: 0, bottom: 0, segments: 1, profile: 0 };
            so.bevel = { top: Math.max(0, n('top', cur.top)), bottom: Math.max(0, n('bottom', cur.bottom)), segments: Math.max(1, Math.round(n('segments', cur.segments))), profile: Math.max(0, Math.min(1, n('profile', cur.profile))) };
            // Segments and profile also shape the bevel of single sides: kept even without a width here.
            if (so.bevel.top <= 0 && so.bevel.bottom <= 0 && so.bevel.segments === 1 && so.bevel.profile === 0) delete so.bevel;
            return true;
          }
          case 'edge-bevel': {
            if (!edgeList.length) return false;
            // 0 is valid too: removes the bevel from these sides only.
            for (const e of edgeList) (so.edges[e] ??= {}).bevel = Math.max(0, n('w'));
            return true;
          }
          case 'edge-offset': {
            // Each side moves along its own normal (+ out, − in), its neighbours follow.
            return edgeList.length > 0 && edgeList.every((e) => pushEdge(so, e, n('d')));
          }
          case 'edge-curve': {
            // Sagitta at the middle of the side, along its outward normal (0 straightens).
            for (const e of edgeList) {
              const ring = [so.plan.outer, ...so.plan.holes].find((rg) => rg.some((v) => v.id === e));
              const i = ring ? ring.findIndex((v) => v.id === e) : -1;
              const nrm = edgeNormal(so, e);
              if (!ring || i < 0 || !nrm) return false;
              const a = ring[i]!.p,
                c = ring[(i + 1) % ring.length]!.p;
              if (!n('sag')) {
                delete ring[i]!.bulge;
                continue;
              }
              if (!bendEdge(so, e, [(a[0] + c[0]) / 2 + nrm[0] * n('sag'), (a[1] + c[1]) / 2 + nrm[1] * n('sag')])) return false;
            }
            return edgeList.length > 0;
          }
          case 'edge-split': {
            const made = edgeList.map((e) => splitEdge(so, e));
            return made.length > 0 && made.every(Boolean);
          }
          case 'corner': {
            // One chosen corner, or every corner of the outline when none is chosen.
            const vids = this.sel.verts ?? [];
            const vs = vids.length ? [so.plan.outer, ...so.plan.holes].flat().filter((q) => vids.includes(q.id)) : so.plan.outer;
            if (!vs.length) return false;
            for (const v of vs) {
              const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.includes(v))!;
              // Never more than half the shorter side of the corner.
              const max = cornerLimit(ring, ring.indexOf(v));
              const want = (k: string) => Math.min(n(k), max);
              if ('round' in a) {
                if (n('round') > max) cornerLimited = max;
                if (want('round') > 0) v.round = want('round');
                else delete v.round;
              }
              if ('chamfer' in a) {
                if (n('chamfer') > max) cornerLimited = max;
                if (want('chamfer') > 0) v.chamfer = want('chamfer');
                else delete v.chamfer;
              }
            }
            return true;
          }
        }
        return false;
    };
    const ok = this.change(
      b.id,
      (x) => {
        const r = run(x);
        const c = created as Solid | null;
        if (r && c && layer && !c.layer) c.layer = layer;
        return r;
      },
      msgs[op] ?? '',
    );
    if (ok && created) this.select({ building: b.id, solids: [(created as Solid).id] });
    if (ok && cornerLimited !== null) this.toast(`Limited to ${fmt(cornerLimited)} m: half the shorter side of the corner.`);
    return ok;
  }

  copy(): void {
    const b = this.activeBuilding();
    if (!b) return;
    if (this.context === b.id && this.sel.item) this.clipboard = { kind: 'item', json: JSON.stringify(this.activeItem()) };
    else if (this.context === b.id && this.activeSolid()) this.clipboard = { kind: 'solid', json: JSON.stringify(this.activeSolid()) };
    else this.clipboard = { kind: 'building', json: JSON.stringify(b) };
    this.toast('Copied.');
  }

  paste(): void {
    const c = this.clipboard;
    if (!c) return;
    const target = this.store.building(this.context);
    if (c.kind === 'building' || !target) {
      if (c.kind !== 'building') return;
      const b = cloneBuilding(JSON.parse(c.json) as Building3);
      b.position = [b.position[0] + 5, b.position[1] + 5];
      this.store.project.buildings.push(b);
      if (!this.store.commit([b.id], 'Pasted.')) return;
      return this.select({ building: b.id });
    }
    if (c.kind === 'solid') {
      const s = cloneSolid(JSON.parse(c.json) as Solid);
      translateSolid(s, 2, 2);
      if (!this.change(target.id, (x) => void x.solids.push(s), 'Pasted.')) return;
      return this.select({ building: target.id, solids: [s.id] });
    }
    const it = JSON.parse(c.json) as Item;
    it.id = uid();
    this.change(target.id, (x) => void x.items.push(it), 'Pasted.');
  }

  /** Rotation step (degrees) with snapping on. */
  rotSnap = 15;

  // ── Align and distribute ─────────────────────────────────────────────
  /** Volumes (inside a building) or buildings (outside): the first selected is the reference. */
  align(op: AlignOp): void {
    const b = this.activeBuilding();
    if (!b) return;
    const label: Record<AlignOp, string> = { left: 'to the left', centerX: 'to the center (x)', right: 'to the right', front: 'to the front', centerZ: 'to the center (z)', back: 'to the back', base: 'on the same base', top: 'to the same top', height: 'with the same top (height)', distX: 'distributed in x', distZ: 'distributed in z' };
    const dist = op === 'distX' || op === 'distZ';
    const verb = (what: string) => (dist ? `${what} ${label[op]}.` : `${what} aligned ${label[op]}.`);
    // Distributing keeps the two ends: with fewer than three there is nothing in between to spread.
    const few = (n: number) => dist && n < 3 && (this.toast('Distribute needs three or more: the two ends stay, the ones between are spread.'), true);
    if (this.context === b.id && this.sel.solids.length > 1) {
      if (few(this.sel.solids.length)) return;
      this.change(b.id, (x) => alignSolids(this.sel.solids.map((id) => findSolid(x, id)!).filter(Boolean), op), verb('Volumes'));
      return;
    }
    if (this.sel.others.length) {
      const list = [b, ...this.sel.others.map((id) => this.store.building(id)!).filter(Boolean)];
      if (few(list.length)) return;
      alignBuildings(list, op);
      this.store.commit(list.map((x) => x.id), verb('Buildings'), false);
      if (this.store.changed) this.toast(verb('Buildings'));
    }
  }

  /** Interface islands over the view (client coordinates): nothing of the model should sit under them. */
  private islands(): DOMRect[] {
    const sh = this.shell;
    // The fixed panels plus whatever floats over the view now: last operation panel, selection modes,
    // interior view, menus (dimensions used to sit under them, covered).
    const floating = [...sh.root.querySelectorAll<HTMLElement>('.f3-island, .f3-menu, .f3-toast.on')];
    const els = [sh.tools, sh.ctxbar, sh.aside, sh.status.bar, sh.viewbar, sh.crumb, sh.cat, ...floating];
    return els.filter((el) => !el.hidden && el.offsetParent !== null && el.getClientRects().length).map((el) => el.getBoundingClientRect());
  }

  /**
   * Free rectangle of the view (relative to the canvas): what is left around
   * the breadcrumb and the view island.
   */
  freeRect(): { left: number; top: number; right: number; bottom: number } {
    // Panels are fixed outside the view; what remains is the breadcrumb (top left), the
    // View island (top right) and room for the contextual bar above the selection.
    const v = this.shell.view.getBoundingClientRect();
    const sh = this.shell;
    const vis = (el: HTMLElement) => !el.hidden && el.getClientRects().length > 0;
    const gap = 12;
    let top = v.top + gap + 44,
      right = v.right - gap;
    if (vis(sh.crumb)) top = Math.max(top, sh.crumb.getBoundingClientRect().bottom + gap + 40);
    if (vis(sh.viewbar)) right = Math.min(right, sh.viewbar.getBoundingClientRect().left - gap);
    return { left: gap, top: top - v.top, right: right - v.left, bottom: v.height - gap };
  }

  /** Selection dimensions: each side of the volume and the height, always visible and never touching each other. */
  private drawSelDims(): void {
    this.placeSelDims();
    this.declutterDims();
  }

  /**
   * Labeling like map renderers (`labels.ts`): the height first, then each side, takes
   * the nearest free spot around its anchor, clear of the handles (a dimension never sits
   * under an arrow, point or square), the panels and the dimensions already placed. With
   * no free spot within reach it hides: never one label over another.
   * All rectangles are read before any label moves (one layout, no reflow per label).
   */
  private declutterDims(): void {
    const els = [...this.shell.view.querySelectorAll<HTMLElement>('.f3-sdim')];
    if (!els.length) return;
    els.sort((a, b) => Number(a.dataset.prio ?? 1) - Number(b.dataset.prio ?? 1));
    const v = this.shell.view.getBoundingClientRect();
    const boxes = els.map((el) => el.getBoundingClientRect());
    const obstacles = [...this.handles.footprints(), ...this.islands()];
    const at = placeLabels(boxes, obstacles, { left: v.left, top: v.top, right: v.right, bottom: v.bottom });
    els.forEach((el, i) => {
      const o = at[i];
      if (!o) {
        el.hidden = true;
        return;
      }
      if (o[0]) el.style.left = `${parseFloat(el.style.left) + o[0]}px`;
      if (o[1]) el.style.top = `${parseFloat(el.style.top) + o[1]}px`;
    });
  }

  /** A dimension label being edited (the labels are not rebuilt meanwhile: orbiting never loses the typing). */
  private dimEditing = false;

  /**
   * Editable dimension (Revit temporary dimensions): click the value, type, Enter applies
   * (Tab applies and goes to the next one, Esc cancels). Values with a point or a comma.
   */
  private makeDimEditable(el: HTMLElement, value: number, apply: (v: number) => boolean | void, prefix = ''): void {
    el.classList.add('edit');
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.querySelector('input')) return;
      this.dimEditing = true;
      el.textContent = prefix;
      const input = document.createElement('input');
      input.value = fmt(value);
      input.setAttribute('aria-label', 'Dimension value in meters');
      el.append(input, ' m');
      input.focus();
      input.select();
      let done = false;
      const close = (ok: boolean, next: boolean) => {
        if (done) return;
        done = true;
        const order = [...this.shell.view.querySelectorAll<HTMLElement>('.f3-sdim.edit:not([hidden])')];
        const at = order.indexOf(el);
        this.dimEditing = false;
        if (ok) {
          const v = parseFloat(input.value.replace(',', '.'));
          if (!(v > 0.05 && v < 2000)) this.toast('Type a length in meters, like 12 or 12.5.');
          else if (Math.abs(v - value) > 1e-4 && apply(v) === false) this.toast('That value does not fit here.');
        }
        this.drawSelDims();
        if (next) [...this.shell.view.querySelectorAll<HTMLElement>('.f3-sdim.edit:not([hidden])')][at + 1]?.click();
      };
      input.addEventListener('keydown', (k) => {
        k.stopPropagation();
        if (k.key === 'Enter') close(true, false);
        else if (k.key === 'Tab') {
          k.preventDefault();
          close(true, true);
        } else if (k.key === 'Escape') close(false, false);
      });
      input.addEventListener('blur', () => close(false, false));
    });
  }

  private placeSelDims(): void {
    if (this.dimEditing) return;
    this.shell.view.querySelectorAll('.f3-sdim').forEach((x) => x.remove());
    const b = this.activeBuilding();
    // The cut tool measures at the pointer: the selection's dimensions would sit under its label.
    if (!b || this.drag || explodeGap(this.project) > 0 || this.tool === 'cut') return;
    const M = this.view.buildingMatrix(b);
    // `prio` 0 is placed before the others when they crowd (the height of the whole volume or building).
    const put = (p: THREE.Vector3, text: string, edit?: { value: number; apply: (v: number) => boolean | void; prefix?: string }, dx = 0, prio = 1) => {
      const sp = this.view.toScreen(p);
      if (sp.behind) return;
      const el = document.createElement('div');
      el.className = 'f3-dim f3-sdim';
      el.textContent = text;
      el.style.left = `${sp.x + dx}px`;
      el.style.top = `${sp.y}px`;
      if (prio !== 1) el.dataset.prio = String(prio);
      if (edit) this.makeDimEditable(el, edit.value, edit.apply, edit.prefix);
      this.shell.view.appendChild(el);
    };
    const solids = this.context === b.id ? this.sel.solids.map((id) => findSolid(b, id)).filter((s): s is Solid => !!s) : [];
    if (solids.length === 1 && !this.sel.elems.length && !this.sel.item) {
      const s = solids[0]!;
      const r = solidRings(s);
      // Length of each side between its plan vertices (the virtual corner, like the Width field: rounding
      // or chamfering a corner does not shorten what the side measures); an arc by its arc length.
      const ring0 = s.plan.outer;
      const arcs = ring0.map((v, k) => (v.bulge ? arcOf(v.p, ring0[(k + 1) % ring0.length]!.p, v.bulge) : null));
      const sides = new Map<string, { len: number }>();
      ring0.forEach((v, k) => {
        const c = ring0[(k + 1) % ring0.length]!.p;
        const arc = arcs[k];
        sides.set(v.id, { len: arc ? arc.r * Math.abs(arc.theta) : Math.hypot(c[0] - v.p[0], c[1] - v.p[1]) });
      });
      const eye = this.view.camera.position;
      // A circle (every side an arc of one center and radius) has one size: its diameter.
      const a0 = arcs[0];
      if (a0 && arcs.every((q) => q && Math.hypot(q.c[0] - a0.c[0], q.c[1] - a0.c[1]) < 1e-3 * a0.r + 1e-6 && Math.abs(q.r - a0.r) < 1e-3 * a0.r + 1e-6)) {
        const toEye = new THREE.Vector3().copy(eye).applyMatrix4(M.clone().invert());
        const dx = toEye.x - a0.c[0],
          dz = toEye.z - a0.c[1];
        const l = Math.hypot(dx, dz) || 1;
        const D = 2 * a0.r;
        put(new THREE.Vector3(a0.c[0] + (dx / l) * (a0.r + 0.9), s.base + 0.05, a0.c[1] + (dz / l) * (a0.r + 0.9)).applyMatrix4(M), `⌀ ${fmt(D)} m`, {
          value: D,
          prefix: '⌀ ',
          apply: (v) => this.modelOp('size', { w: v, d: v }),
        });
        sides.clear();
      }
      const sub = this.subOf(b, s);
      for (const [edge, v] of sides) {
        const ring = s.plan.outer;
        const k = ring.findIndex((q) => q.id === edge);
        if (k < 0) continue;
        const m = midOf(ring[k]!, ring[(k + 1) % ring.length]!);
        const n = edgeNormal(s, edge) ?? [0, 0];
        let at = new THREE.Vector3(m[0] + n[0] * 0.9, s.base + 0.05, m[1] + n[1] * 0.9);
        // A side facing away is measured on its top edge, the one seen: its base is behind the
        // volume and the label would float over the front facade.
        const nW = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
        if (nW.dot(eye.clone().sub(new THREE.Vector3(m[0], s.base, m[1]).applyMatrix4(M))) < 0) {
          const top = halfway(sub.edges.find((e) => e.id === edge)?.segs.filter((_, i) => i % 2 === 1) ?? []);
          if (top) at = new THREE.Vector3(top[0] + n[0] * 0.9, top[1] + 0.05, top[2] + n[1] * 0.9);
        }
        // New length: the next side moves (Revit moves the referenced element; this side's start stays).
        const nextEdge = ring[(k + 1) % ring.length]!.id;
        put(at.applyMatrix4(M), `${fmt(v.len)} m`, {
          value: v.len,
          apply: (L) => this.changeSolid((x) => pushEdge(x, nextEdge, L - v.len), `Side set to ${fmt(L)} m.`),
        });
      }
      // Height next to the right-most corner on screen, at half height (the center belongs to the gizmo).
      let best: THREE.Vector3 | null = null;
      let bx = -Infinity;
      for (const p of r.outer.pts) {
        const w = new THREE.Vector3(p[0], s.base + s.height / 2, p[1]).applyMatrix4(M);
        const sp = this.view.toScreen(w);
        if (!sp.behind && sp.x > bx) {
          bx = sp.x;
          best = w;
        }
      }
      if (best)
        put(best, `↕ ${fmt(s.height)} m`, { value: s.height, prefix: '↕ ', apply: (h) => this.changeSolid((x) => void (x.height = Math.max(0.3, h)), `Height set to ${fmt(h)} m.`) }, 30, 0);
      return;
    }
    if (this.context !== b.id) {
      const pts = b.solids.filter((s) => s.op === 'add').flatMap((s) => solidRings(s).outer.pts);
      if (!pts.length) return;
      const xs = pts.map((p) => p[0]),
        zs = pts.map((p) => p[1]);
      // Real total height (roof included; cutters do not count). The dimensions measure the body: walls,
      // roof and eave, not the awnings and balconies that stick out (audit D3: 20.55 m on an 18 m block);
      // the box still wraps everything.
      const bb = this.boundsOf(b, undefined, true);
      const top = bb ? bb.max[1] : Math.max(...b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height));
      // Plan of the walls (what scales) and the body bounds (walls with the eaves).
      const pw = Math.max(...xs) - Math.min(...xs),
        pd = Math.max(...zs) - Math.min(...zs);
      const x0 = bb ? bb.min[0] : Math.min(...xs),
        x1 = bb ? bb.max[0] : Math.max(...xs),
        z0 = bb ? bb.min[2] : Math.min(...zs),
        z1 = bb ? bb.max[2] : Math.max(...zs);
      const W = x1 - x0,
        D = z1 - z0;
      const c: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
      // Like the height: the label measures the box and the walls take the whole difference (what sticks
      // out stays the same), so the box lands exactly on the typed value.
      const fit = (v: number, total: number, plan: number) => (v - (total - plan)) / plan;
      put(new THREE.Vector3((x0 + x1) / 2, 0.1, z1 + 1.2).applyMatrix4(M), `${fmt(W)} m`, { value: W, apply: (v) => fit(v, W, pw) > 0.05 && this.scaleBuildingPlan(b.id, c, fit(v, W, pw), 1, `Width set to ${fmt(v)} m.`) });
      put(new THREE.Vector3(x1 + 1.2, 0.1, (z0 + z1) / 2).applyMatrix4(M), `${fmt(D)} m`, { value: D, apply: (v) => fit(v, D, pd) > 0.05 && this.scaleBuildingPlan(b.id, c, 1, fit(v, D, pd), `Depth set to ${fmt(v)} m.`) });
      // Height on a vertical corner (the top center belongs to the gizmo).
      // The total includes the roof, whose rise comes from its pitch and span (not from the height): the
      // walls take the whole difference, so the result is exactly the typed value.
      const wallTop = Math.max(...b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height));
      const roof = top - wallTop;
      put(new THREE.Vector3(x1 + 1.2, top / 2, z1 + 1.2).applyMatrix4(M), `↕ ${fmt(top)} m`, {
        value: top,
        prefix: '↕ ',
        apply: (v) => (v - roof > 0.6 ? this.scaleBuildingHeight(b.id, (v - roof) / wallTop, `Height set to ${fmt(v)} m.`) : false),
      }, 0, 0);
    }
  }

  /** Scales every volume plan of the building around `c` (building frame); invalid result: nothing changes. */
  private scaleBuildingPlan(bid: ID, c: Vec2, sx: number, sz: number, msg: string): boolean {
    return this.change(bid, (b) => {
      const before = structuredClone(b.solids.map((s) => s.plan));
      for (const s of b.solids)
        for (const ring of [s.plan.outer, ...s.plan.holes])
          for (const v of ring) {
            v.p = [c[0] + (v.p[0] - c[0]) * sx, c[1] + (v.p[1] - c[1]) * sz];
            if (v.round) v.round *= Math.min(sx, sz);
            if (v.chamfer) v.chamfer *= Math.min(sx, sz);
          }
      if (b.solids.every((s) => planValidOps(s.plan))) return;
      b.solids.forEach((s, i) => (s.plan = before[i]!));
      return false;
    }, msg);
  }

  /** Scales the building vertically: volume bases and heights, and the levels with them. */
  private scaleBuildingHeight(bid: ID, k: number, msg: string): boolean {
    if (!(k > 0.05 && k < 50)) return false;
    return this.change(bid, (b) => {
      for (const s of b.solids) {
        s.base *= k;
        s.height = Math.max(0.3, s.height * k);
      }
      for (const l of b.levels) {
        l.elevation *= k;
        l.height = Math.max(2, l.height * k);
      }
    }, msg);
  }

  // ── Multiple selection (docs/SELECTION.md) ───────────────────────────
  /** Pending still click (inside a multiple selection, without a drag). */
  private pendingClick: Hit | null = null;

  /** Is the pressed point already selected (with `multi`, in a selection of several)? */
  private inSelection(hit: Hit, multi: boolean): boolean {
    const b = hit.building;
    if (this.context !== b.id) return (!multi || this.sel.others.length > 0) && this.selectedBuildings().includes(b.id);
    const p = hit.part;
    const key = p ? (p.rule ? `r|${p.solid}|${p.rule}|${p.key}` : p.item ? `i|${p.item}|${p.key ?? '0'}` : null) : null;
    if (key) return multi ? this.sel.elems.length > 1 && this.sel.elems.includes(key) : this.sel.item === p!.item || this.sel.elems.includes(key);
    return (!multi || this.sel.solids.length > 1) && !!hit.face && this.sel.solids.includes(hit.face.solid);
  }

  /** Rotates the selected buildings together around the common center (each rotates and moves on the circle). */
  rotateBuildings(deg: number): void {
    const bs = this.selectedBuildings().map((id) => this.store.building(id)).filter((x): x is Building3 => !!x);
    if (!bs.length) return;
    const centers = bs.map((x) => {
      const add = x.solids.filter((s) => s.op === 'add');
      const c = add.map((s) => planCenter(s));
      return toWorld(x, c.length ? [c.reduce((a, q) => a + q[0], 0) / c.length, c.reduce((a, q) => a + q[1], 0) / c.length] : [0, 0]);
    });
    const G: Vec2 = [centers.reduce((a, q) => a + q[0], 0) / centers.length, centers.reduce((a, q) => a + q[1], 0) / centers.length];
    const a = rad(deg);
    for (const x of bs) {
      const dx = x.position[0] - G[0],
        dz = x.position[1] - G[1];
      // Same rotation as buildingMatrix/toWorld: (x, z) → (x cos a + z sin a, −x sin a + z cos a).
      x.position = [G[0] + dx * Math.cos(a) + dz * Math.sin(a), G[1] - dx * Math.sin(a) + dz * Math.cos(a)];
      x.rotation = (((x.rotation + deg) % 360) + 360) % 360;
    }
    this.store.commit(bs.map((x) => x.id), `${bs.length} buildings rotated ${deg}°.`, false);
    this.toast(`${bs.length} buildings rotated ${deg}°.`);
    this.drawSelection();
  }

  /** Edges (point pairs) of the boxes of elements `keys` of building `b`, in the world. */
  private elemBoxes(b: Building3, keys: Set<string>): number[] {
    const built = this.view.built.get(b.id);
    if (!built) return [];
    const M = this.view.buildingMatrix(b);
    const pos: number[] = [];
    const mm = new THREE.Matrix4();
    for (const pl of built.ev.placements) {
      const k = elemKey(pl);
      if (!k || !keys.has(k)) continue;
      const [w, h, dd] = pl.family.size(pl.params);
      mm.fromArray(pl.frame).premultiply(M);
      const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(mm);
      const xs = [-w / 2 - 0.05, w / 2 + 0.05],
        ys = [-0.05, h + 0.05],
        zs = pl.host ? [-0.05, Math.max(0.12, dd) + 0.05] : [-dd / 2 - 0.05, dd / 2 + 0.05];
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(xs[i & 1]!, ys[(i >> 1) & 1]!, zs[(i >> 2) & 1]!));
      for (const [a, b2] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as [number, number][]) pos.push(...corners[a]!.toArray(), ...corners[b2]!.toArray());
    }
    return pos;
  }

  /** Automatic groups of the elements of the building being edited (category → type → variant). */
  elementGroups(): GroupRow[] {
    return groupElements(
      this.elements(),
      (t) => {
        const ty = typeById(t, this.project);
        const f = ty && family(ty.family);
        return ty && f ? { name: ty.name, category: f.category, ...(ty.base ? { base: ty.base } : {}) } : undefined;
      },
      (c) => CATEGORY_NAMES[c as keyof typeof CATEGORY_NAMES] ?? c,
      Object.keys(CATEGORY_NAMES),
    );
  }

  /** Selects a group (with the click modifiers: Ctrl adds, Shift toggles, Ctrl+Shift removes). */
  selectGroup(id: string, e: Mods): void {
    const b = this.activeBuilding();
    const g = this.elementGroups().find((x) => x.id === id);
    if (!b || !g) return;
    const next = combine(this.sel.elems, g.keys, selMode(e));
    this.selectElemKeys(b.id, next);
    this.toast(`${next.length} element(s) selected.`);
  }

  private groupHover = new THREE.Group();
  /** Pre-highlight in the model of what a panel group would add to the selection (null clears). */
  previewElems(keys: string[] | null): void {
    if (!keys && !this.groupHover.children.length) return;
    if (!this.groupHover.parent) this.view.overlay.add(this.groupHover);
    for (const c of [...this.groupHover.children]) {
      this.groupHover.remove(c);
      const m = c as THREE.LineSegments;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    const b = this.activeBuilding();
    // Only what the click would add: what is already selected has the orange highlight.
    const sel = new Set(this.sel.elems);
    const add = keys?.filter((k) => !sel.has(k)) ?? [];
    const pos = b && add.length ? this.elemBoxes(b, new Set(add)) : [];
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const front = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#5b9cff', depthTest: true }));
      const behind = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#5b9cff', depthTest: false, transparent: true, opacity: 0.3 }));
      front.renderOrder = 24;
      behind.renderOrder = 23;
      this.groupHover.add(front, behind);
    }
    this.view.mark();
  }

  /**
   * Action with a value (SketchUp): applies right away with the default value
   * and leaves it adjustable in the last operation panel and the measure box.
   */
  applyMeasured(label: string, def: number, apply: (v: number) => boolean): boolean {
    return this.applyOp(label, [{ key: 'v', label: 'Value', value: def, unit: 'm' }], (v) => apply(Number(v.v)));
  }

  // ── Last operation (Blender, "Adjust Last Operation") ─────────────────
  /** Operation just done with parameters that can still change (panel in the view corner). */
  lastOp: LastOp | null = null;
  /** The last operation panel listens to this. */
  lastOpChanged: (() => void) | null = null;
  private opBusy = false;

  /**
   * Applies an operation with parameters and keeps it adjustable: the last
   * operation panel shows the values; changing one undoes and redoes on the same
   * selection (a single history step). The measure box changes the first value.
   */
  applyOp(label: string, params: OpParam[], run: (v: Record<string, number | string>) => boolean): boolean {
    const before = structuredClone(this.sel);
    const ctx = this.context;
    const values = Object.fromEntries(params.map((p) => [p.key, p.value]));
    this.opBusy = true;
    const ok = run(values);
    this.opBusy = false;
    if (!ok) {
      this.toast('Not possible here: the volume is too small or a face must be chosen.');
      return false;
    }
    this.lastOp = { label, params, values, run, sel: before, ctx, seq: this.store.seq };
    const first = params.find((p) => !p.options);
    if (first) this.setMeasure(label, (t) => {
      const v = parseLength(t);
      return v !== null && this.redoLastOp({ [first.key]: v });
    });
    this.lastOpChanged?.();
    return true;
  }

  /** Redoes the last operation with new values (only if nothing was recorded after it). */
  redoLastOp(change: Record<string, number | string>): boolean {
    const op = this.lastOp;
    if (!op || op.seq !== this.store.seq) {
      this.clearLastOp();
      return false;
    }
    const values = { ...op.values, ...change };
    this.opBusy = true;
    this.store.undo();
    this.context = op.ctx;
    this.select(op.sel);
    const ok = op.run(values);
    this.opBusy = false;
    if (!ok) {
      // Did not fit: restores what was there and warns (the panel keeps the old values).
      this.opBusy = true;
      this.select(op.sel);
      op.run(op.values);
      this.opBusy = false;
      op.seq = this.store.seq;
      this.toast(`${op.label}: that value does not fit here.`);
      this.lastOpChanged?.();
      return false;
    }
    op.values = values;
    op.seq = this.store.seq;
    this.lastOpChanged?.();
    return true;
  }

  clearLastOp(): void {
    if (!this.lastOp) return;
    this.lastOp = null;
    this.lastOpChanged?.();
  }

  /** Ready massing on the chosen volume: top setback, podium or courtyard. */
  quick(kind: 'setback' | 'podium' | 'court'): void {
    const b = this.activeBuilding(),
      s = this.activeSolid();
    if (!b || !s) return void this.toast('Choose a volume first.');
    let made: string | null = null;
    const ok = this.change(b.id, (x) => {
      const so = findSolid(x, s.id)!;
      const n = kind === 'setback' ? setbackOn(x, so) : kind === 'podium' ? podiumUnder(x, so) : courtyardIn(x, so);
      if (!n) return false;
      made = n.id;
    }, kind === 'setback' ? 'Setback created; the volume below became a terrace.' : kind === 'podium' ? 'Podium with shops created.' : 'Courtyard cut.');
    if (ok && made) this.select({ building: b.id, solids: [made] });
    else if (!ok) this.toast('Does not fit: the volume is too small for that.');
  }

  /** More (+) or fewer (−) floors on every selected building (inside one, only on it). */
  floorsDelta(delta: number): void {
    const ids = this.context ? [this.context] : this.selectedBuildings();
    if (!ids.length) return;
    let n = 0;
    const tall = (b: Building3) => Math.max(0, ...b.solids.filter((q) => q.op === 'add').map((q) => q.base + q.height));
    const h0 = ids.map((id) => tall(this.store.building(id)!));
    for (const id of ids) {
      const b = this.store.building(id);
      if (b && changeLevels(b, delta)) n++;
    }
    if (!n) return void this.toast(delta > 0 ? 'Already at the maximum number of floors.' : 'Already at the ground floor.');
    this.store.commit(ids, '');
    // What took effect, not only that something did: floors and the resulting height.
    const one = ids.length === 1 ? this.store.building(ids[0]) : undefined;
    this.toast(one ? `${one.levels.length} floors · height ${+h0[0]!.toFixed(2)} → ${+tall(one).toFixed(2)} m.` : delta > 0 ? `One more floor on ${n} buildings.` : `One floor less on ${n} buildings.`);
    this.drawSelection();
  }

  /** The interface (ui/actions.ts) opens the context menu with the selection actions. */
  contextRequested: ((x: number, y: number) => void) | null = null;

  /** Right button: selects what is under the cursor (if not yet) and asks for the menu. */
  private openContext(e: PointerEvent): void {
    this.cancel();
    const hit = this.pickAt(e);
    if (hit && !this.inSelection(hit, false)) {
      if (this.tool !== 'select' && !this.selectLike()) this.setTool('select');
      this.clickSelect(hit, { ctrlKey: false, shiftKey: false, metaKey: false, altKey: false });
    }
    if (!this.activeBuilding()) return;
    this.contextRequested?.(e.clientX, e.clientY);
  }

  /** Selected buildings, the main one first. */
  selectedBuildings(): ID[] {
    return this.sel.building ? [this.sel.building, ...this.sel.others] : [];
  }

  selectBuildings(ids: ID[]): void {
    if (!ids.length) return this.select({});
    this.select({ building: ids[0]!, others: ids.slice(1) });
  }

  /** Selects elements by key; a single component opens its panel. */
  selectElemKeys(bid: ID, keys: string[]): void {
    if (!keys.length) return this.select({ building: bid });
    const only = keys.length === 1 && keys[0]!.startsWith('i|') ? keys[0]!.split('|')[1]! : null;
    this.select({ building: bid, elems: keys, item: only });
  }

  // ── Vertex / edge / face modes (Blender edit mode: 1, 2, 3) ──────────
  /** What a click picks inside a building: whole volumes, corners, sides or faces. */
  elemMode: ElemMode = 'object';
  private subCache = new Map<string, { verts: SubVertex[]; edges: SubEdge[] }>();
  private subHover = new THREE.Group();
  private subHoverKey = '';

  /** Switches the mode (the same key again goes back to volumes); the selection converts like Blender's. */
  setElemMode(m: ElemMode): void {
    if (m === this.elemMode && m !== 'object') m = 'object';
    if (m !== 'object' && !this.context) {
      const b = this.activeBuilding();
      if (!b) return this.toast('Select a building first: the modes edit its volumes.');
      const s = this.sel.solids;
      this.enter(b.id);
      if (s.length) this.select({ building: b.id, solids: s });
    }
    this.elemMode = m;
    // A new mode starts clean: nothing half-typed is applied to the operation of the previous mode.
    this.clearMeasure();
    const b = this.activeBuilding(),
      s = this.activeSolid();
    if (b && s) {
      const fs = this.sel.face;
      const c = convertSub(s, { verts: this.sel.verts ?? [], edges: this.sel.edges ?? [], face: fs && (fs.kind === 'side' || fs.kind === 'top') ? { kind: fs.kind, ...(fs.edge ? { edge: fs.edge } : {}) } : null }, m);
      this.select(m === 'object' ? { building: b.id, solids: this.sel.solids } : { building: b.id, solids: [s.id], verts: c.verts, edges: c.edges, face: c.face });
    } else this.syncSelection();
    this.drawSubHover(null);
    const hint: Record<ElemMode, string> = {
      object: 'Volumes: a click picks a volume.',
      vertex: 'Vertices: click a corner (Shift adds or removes), drag it to move it.',
      edge: 'Edges: click a side (Shift adds or removes), drag it to move it.',
      face: 'Faces: click a face, drag it to push or pull.',
    };
    this.toast(hint[m]);
  }

  /** Mode switch under the breadcrumb (inside a building only). */
  private renderModes(): void {
    const box = this.shell.modes;
    box.hidden = !this.context;
    if (box.hidden) return;
    const key = this.elemMode;
    if (box.dataset.mode === key && box.childElementCount) return;
    box.dataset.mode = key;
    const modes: [ElemMode, string, string, string][] = [
      ['object', 'modeObject', 'Volumes', 'Volumes: pick whole volumes'],
      ['vertex', 'modeVertex', 'Vertex', 'Vertices · 1'],
      ['edge', 'modeEdge', 'Edge', 'Edges · 2'],
      ['face', 'modeFace', 'Face', 'Faces · 3'],
    ];
    box.innerHTML = modes.map(([m, ic, label, title]) => `<button data-mode="${m}" aria-pressed="${m === key}" title="${title}" aria-label="${label}">${icon(ic)}</button>`).join('');
    box.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((bt) => bt.addEventListener('click', () => this.setElemMode(bt.dataset.mode as ElemMode)));
  }

  private subOf(b: Building3, s: Solid): { verts: SubVertex[]; edges: SubEdge[] } {
    const key = `${b.id}|${s.id}|${this.store.revision.get(b.id) ?? 0}|${JSON.stringify(s.plan)}|${s.height}|${s.base}|${s.taper}`;
    let v = this.subCache.get(key);
    if (!v) {
      if (this.subCache.size > 64) this.subCache.clear();
      this.subCache.set(key, (v = subElements(s)));
    }
    return v;
  }

  /** Corner or side under the cursor (screen distance; what the model hides is not picked). */
  private subPickAt(e: { clientX: number; clientY: number }, b: Building3): { sid: ID; id: ID } | null {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    const M = this.view.buildingMatrix(b);
    const hit = this.pickAt(e, b.id);
    const cam = this.view.camera.position;
    // A point farther than the surface under the cursor is behind it (Blender picks only what is seen).
    const limit = hit ? hit.point.distanceTo(cam) + 1 : Infinity;
    const w = new THREE.Vector3();
    const screen = (p: Vec3) => {
      w.set(p[0], p[1], p[2]).applyMatrix4(M);
      const d = w.distanceTo(cam);
      const q = this.view.toScreen(w);
      return { x: q.x, y: q.y, ok: !q.behind && d <= limit };
    };
    let best: { sid: ID; id: ID } | null = null;
    let bestD = this.elemMode === 'vertex' ? 20 : 12;
    for (const s of b.solids) {
      if (solidHidden(this.project, s) || solidLocked(this.project, s)) continue;
      const sub = this.subOf(b, s);
      // The volume under the cursor wins a tie (its own corners and sides first).
      const bias = hit?.face?.solid === s.id ? 3 : 0;
      if (this.elemMode === 'vertex')
        for (const v of sub.verts)
          for (const p of [v.base, v.top]) {
            const q = screen(p);
            const d = Math.hypot(q.x - x, q.y - y) - bias;
            if (q.ok && d < bestD) {
              bestD = d;
              best = { sid: s.id, id: v.id };
            }
          }
      else
        for (const ed of sub.edges)
          for (const [a, c] of ed.segs) {
            const qa = screen(a),
              qc = screen(c);
            if (!qa.ok && !qc.ok) continue;
            const d = segDistance(x, y, qa.x, qa.y, qc.x, qc.y) - bias;
            if (d < bestD) {
              bestD = d;
              best = { sid: s.id, id: ed.id };
            }
          }
    }
    return best;
  }

  /** Press in a sub-element mode: picks (Shift toggles, Ctrl adds) and starts dragging what was pressed. */
  private subDown(e: PointerEvent): boolean {
    const b = this.store.building(this.context);
    if (!b) return false;
    const mode = selMode(e);
    if (this.elemMode === 'face') {
      const hit = this.pickAt(e, b.id);
      // A window, door or awning lies on its wall: in face mode it picks that wall.
      const f = hit?.building.id === b.id ? (hit.face ?? (hit.part ? partHostFace(b, hit.part) : undefined)) : undefined;
      const face = f ? faceSelOf(f) : null;
      if (!f || !face) {
        if (mode === 'replace') this.select(f ? { building: b.id, solids: [f.solid] } : { building: b.id });
        return true;
      }
      this.select({ building: b.id, solids: [f.solid], face });
      const fh = this.handles.list.find((h) => (face.kind === 'side' ? h.kind === 'push' && h.edge === face.edge : face.kind === 'top' && h.kind === 'height' && !!h.dir));
      if (fh) {
        this.beginHandle(fh, e);
        if (this.drag) this.drag.data.sub = true;
      }
      return true;
    }
    const p = this.subPickAt(e, b);
    if (!p) {
      // Empty: a plain click clears the corners or sides (the volume stays chosen).
      if (mode === 'replace') this.select({ building: b.id, solids: this.sel.solids.slice(0, 1) });
      return true;
    }
    const verts = this.elemMode === 'vertex';
    const cur = this.sel.solids[0] === p.sid ? ((verts ? this.sel.verts : this.sel.edges) ?? []) : [];
    // Pressing one already selected keeps the group (to drag it); otherwise the modifiers apply.
    const next = mode === 'replace' && cur.includes(p.id) ? cur : combine(cur, [p.id], mode);
    this.select(verts ? { building: b.id, solids: [p.sid], verts: next } : { building: b.id, solids: [p.sid], edges: next });
    if (!next.includes(p.id) || mode === 'toggle' || mode === 'remove') return true;
    const h = this.handles.list.find((x) => (verts ? x.kind === 'vertex' && x.vertex === p.id : x.kind === 'push' && x.edge === p.id));
    if (h) {
      this.beginHandle(h, e);
      if (this.drag) this.drag.data.sub = true;
    }
    return true;
  }

  /** Pre-highlight of the corner or side under the cursor. */
  private drawSubHover(p: { sid: ID; id: ID } | null): void {
    if (!this.subHover.parent) this.view.overlay.add(this.subHover);
    const b = this.store.building(this.context);
    const key = p && b ? `${this.elemMode}|${p.sid}|${p.id}|${this.store.revision.get(b.id)}` : '';
    if (key === this.subHoverKey) return;
    this.subHoverKey = key;
    for (const c of [...this.subHover.children]) {
      this.subHover.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    if (!p || !b) return this.view.mark();
    const s = b.solids.find((x) => x.id === p.sid);
    if (!s) return;
    const M = this.view.buildingMatrix(b);
    const sub = this.subOf(b, s);
    const color = '#5b9cff';
    if (this.elemMode === 'vertex') {
      const v = sub.verts.find((x) => x.id === p.id);
      if (v) {
        const g = new THREE.BufferGeometry().setFromPoints([v.base, v.top].map((q) => new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M)));
        const dots = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }));
        dots.renderOrder = 30;
        const edge = new THREE.Line(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 }));
        edge.renderOrder = 29;
        this.subHover.add(dots, edge);
      }
    } else {
      const ed = sub.edges.find((x) => x.id === p.id);
      if (ed) {
        const pts = ed.segs.flatMap(([a, c]) => [a, c]).map((q) => new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M));
        const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false }));
        lines.renderOrder = 30;
        this.subHover.add(lines);
      }
    }
    this.view.mark();
  }

  // ── Selection commands (docs/SELECTION.md) ──────────────────────────
  // Blender: Ctrl+A all, Ctrl+I invert, Shift+G similar, H hide, Shift+H hide the rest, Alt+H show all.
  // Revit: named selection sets saved in the project.

  /** Everything in the current context: elements (when elements are selected), the building's volumes inside it, buildings outside. */
  selectAll(invertSel = false): void {
    const p = this.project;
    if (this.sel.elems.length && this.sel.building) {
      const all = this.elements().map((e) => e.key);
      return this.selectElemKeys(this.sel.building, invertSel ? invert(all, this.sel.elems) : all);
    }
    const b = this.store.building(this.context);
    if (b) {
      const all = pickableSolids(p, b).map((x) => x.id);
      const next = invertSel ? invert(all, this.sel.solids) : all;
      return this.select(next.length ? { building: b.id, solids: next } : { building: b.id });
    }
    const all = pickableBuildings(p).map((x) => x.id);
    this.selectBuildings(invertSel ? invert(all, this.selectedBuildings()) : all);
  }

  /** Same type (elements), same shape (volumes: operation, corners, height) or same use (buildings). */
  selectSimilar(): void {
    if (this.sel.elems.length) return this.selectElems('type');
    const b = this.activeBuilding();
    if (b && this.sel.solids.length) {
      const ids = similarSolids(this.project, b, this.sel.solids);
      const first = this.sel.solids[0]!;
      this.select({ building: b.id, solids: [first, ...ids.filter((i) => i !== first)] });
      return this.toast(`${ids.length} volume(s) with the same shape and height.`);
    }
    const ref = this.selectedBuildings();
    if (!ref.length) return this.toast('Select something first.');
    const ids = similarBuildings(this.project, ref);
    this.selectBuildings([ref[0]!, ...ids.filter((i) => i !== ref[0])]);
    this.toast(`${ids.length} building(s) with the same use.`);
  }

  /** Hides the selection (H); Alt+H brings it back. */
  hideSelected(): void {
    const b = this.activeBuilding();
    if (b && this.sel.item) {
      const id = this.sel.item;
      this.change(b.id, (x) => {
        const it = x.items.find((i) => i.id === id);
        if (it) it.hidden = true;
      }, 'Hidden · Alt+H shows everything.');
      return this.select({ building: b.id });
    }
    if (b && this.sel.solids.length) {
      const ids = this.sel.solids;
      this.change(b.id, (x) => {
        for (const q of x.solids) if (ids.includes(q.id)) q.hidden = true;
      }, 'Hidden · Alt+H shows everything.');
      return this.select({ building: b.id });
    }
    if (this.sel.elems.length) return this.toast('Facade elements follow their rule: hide the volume, or the category in the Layers tab.');
    const ids = this.selectedBuildings();
    if (!ids.length) return this.toast('Select something to hide.');
    for (const o of this.project.buildings) if (ids.includes(o.id)) o.hidden = true;
    this.select({});
    this.store.commit(null, 'Hidden', false);
    this.toast(`${ids.length} building(s) hidden · Alt+H shows everything.`);
  }

  /** Hides everything else (Shift+H): the other volumes inside a building, the other buildings outside it. */
  isolateSelection(): void {
    const b = this.activeBuilding();
    if (b && this.sel.solids.length) {
      const ids = this.sel.solids;
      // Hidden cutters keep cutting, so only adding volumes are hidden.
      if (!b.solids.some((q) => !ids.includes(q.id) && q.op === 'add' && !q.hidden)) return this.toast('Nothing else to hide in this building (cutters keep cutting, so they stay).');
      this.change(b.id, (x) => {
        for (const q of x.solids) if (!ids.includes(q.id) && q.op === 'add') q.hidden = true;
      }, 'Selection isolated · Alt+H shows everything.');
      return;
    }
    const ids = this.selectedBuildings();
    if (!ids.length) return this.toast('Select a volume or building to isolate.');
    if (!this.project.buildings.some((o) => !ids.includes(o.id) && !o.hidden)) return this.toast('Nothing else to hide: the other buildings are already hidden.');
    for (const o of this.project.buildings) if (!ids.includes(o.id)) o.hidden = true;
    this.store.commit(null, 'Isolated', false);
    this.toast('Selection isolated · Alt+H shows everything.');
  }

  /** Shows every building, volume, component, layer and category (Alt+H). */
  showAll(): void {
    const p = this.store.project;
    for (const b of p.buildings) {
      delete b.hidden;
      b.solids.forEach((s) => delete s.hidden);
      b.items.forEach((i) => delete i.hidden);
    }
    for (const l of ensureLayers(p)) l.visible = true;
    const v = viewOf(p);
    v.hiddenCategories = [];
    delete v.hiddenBody;
    delete v.cutLevel;
    delete v.onlyLevel;
    delete v.explode;
    this.store.commit(null, 'Everything visible.', true);
    this.toast('Everything visible.');
  }

  /** Saves the selection as a named set (a new default name when none is given). */
  saveSelectionSet(name?: string): void {
    const s = this.sel;
    if (!s.building) return this.toast('Select something to save as a set.');
    const set = saveSet(this.store.project, name?.trim() || nextSetName(this.project), { building: s.building, others: s.others, solids: s.solids, elems: s.elems, item: s.item });
    this.store.commit(null, '', false);
    this.toast(`Selection saved as "${set.name}" (Structure tab).`);
  }

  /** Selects a saved set again (entering its building when it holds volumes or elements). */
  recallSelectionSet(id: ID): void {
    const set = this.project.selectionSets?.find((x) => x.id === id);
    if (!set) return;
    const sel = recallSet(this.project, set);
    if (!sel || !sel.building) return this.toast(`Nothing of "${set.name}" is left to select (deleted, hidden or locked).`);
    const inside = sel.solids.length > 0 || sel.elems.length > 0 || !!sel.item;
    if (inside && this.context !== sel.building) this.enter(sel.building);
    else if (!inside && this.context) this.enter(null);
    this.select(sel);
  }

  renameSelectionSet(id: ID, name: string): void {
    const set = this.store.project.selectionSets?.find((x) => x.id === id);
    if (!set || !name.trim()) return;
    set.name = name.trim().slice(0, 60);
    this.store.commit(null, '', false);
  }

  deleteSelectionSet(id: ID): void {
    const p = this.store.project;
    p.selectionSets = (p.selectionSets ?? []).filter((x) => x.id !== id);
    this.store.commit(null, '', false);
  }

  private moveMarquee(e: { clientX: number; clientY: number }): void {
    const m = this.marquee!;
    m.bx = e.clientX;
    m.by = e.clientY;
    if (!m.active && Math.hypot(m.bx - m.ax, m.by - m.ay) < 5) return;
    m.active = true;
    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement('div');
      this.marqueeEl.className = 'f3-marquee';
      this.shell.view.appendChild(this.marqueeEl);
    }
    const el = this.marqueeEl;
    const rv = this.shell.view.getBoundingClientRect();
    const { rect, window: win } = marqueeRect(m.ax, m.ay, m.bx, m.by);
    el.hidden = false;
    el.classList.toggle('cross', !win);
    el.style.left = `${rect.x0 - rv.left}px`;
    el.style.top = `${rect.y0 - rv.top}px`;
    el.style.width = `${rect.x1 - rect.x0}px`;
    el.style.height = `${rect.y1 - rect.y0}px`;
    this.drawHover(null);
    this.shell.status.hint.textContent = win ? 'Window (→): picks only what is fully inside' : 'Crossing (←): picks everything the box touches';
  }

  private endMarquee(): void {
    const m = this.marquee!;
    this.marquee = null;
    if (this.marqueeEl) this.marqueeEl.hidden = true;
    if (!m.active) {
      // Empty ground: the street or lot under it, even from inside a building (it leaves the building).
      if (!m.hit && selMode(m.ev) === 'replace' && this.pickSiteAt({ clientX: m.ax, clientY: m.ay })) return;
      return this.clickSelect(m.hit, m.ev);
    }
    this.applyMarquee(m);
    this.updateHint();
  }

  /** What the box picks: buildings outside a building; inside, elements (or volumes when there are none). */
  private applyMarquee(m: { ax: number; ay: number; bx: number; by: number; ev: Mods }): void {
    const cr = this.view.renderer.domElement.getBoundingClientRect();
    const { rect, window: win } = marqueeRect(m.ax - cr.left, m.ay - cr.top, m.bx - cr.left, m.by - cr.top);
    const mode = selMode(m.ev);
    const scr = (v: THREE.Vector3) => this.view.toScreen(v);
    const solidPts = (s: Solid, M: THREE.Matrix4) => s.plan.outer.flatMap((v) => [new THREE.Vector3(v.p[0], s.base, v.p[1]).applyMatrix4(M), new THREE.Vector3(v.p[0], s.base + s.height, v.p[1]).applyMatrix4(M)]);
    const b = this.context ? this.store.building(this.context) : null;
    if (!b) {
      const ids = this.project.buildings
        .filter((x) => !buildingHidden(this.project, x) && !buildingLocked(this.project, x))
        .filter((x) => {
          const M = this.view.buildingMatrix(x);
          return boxPicks(x.solids.filter((s) => s.op === 'add').flatMap((s) => solidPts(s, M)).map(scr), rect, win);
        })
        .map((x) => x.id);
      const next = combine(this.selectedBuildings(), ids, mode);
      this.selectBuildings(next);
      if (next.length) this.toast(`${next.length} building(s) selected.`);
      return;
    }
    const M = this.view.buildingMatrix(b);
    const cam = this.view.camera.position;
    const mm = new THREE.Matrix4(),
      n = new THREE.Vector3(),
      c = new THREE.Vector3();
    const keys: string[] = [];
    for (const el of this.elements()) {
      const pl = el.pl;
      const it = pl.tag.item ? b.items.find((x) => x.id === pl.tag.item) : undefined;
      if (it && (itemHidden(this.project, it) || itemLocked(this.project, it))) continue;
      const [w, h, d] = pl.family.size(pl.params);
      mm.fromArray(pl.frame).premultiply(M);
      if (pl.host) {
        // Only faces facing the camera: the box does not pick the back of the building.
        n.setFromMatrixColumn(mm, 2);
        c.setFromMatrixPosition(mm);
        if (n.dot(c.sub(cam).negate()) <= 0) continue;
      }
      let pts: THREE.Vector3[];
      if (pl.path) pts = pl.path.flatMap((p) => [new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(p[0], p[1] + h, p[2])].map((v) => v.applyMatrix4(mm)));
      else {
        const zs = pl.host ? [0, Math.max(0.05, d)] : [-d / 2, d / 2];
        pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? w / 2 : -w / 2, i & 2 ? h : 0, zs[(i >> 2) & 1]!).applyMatrix4(mm));
      }
      if (boxPicks(pts.map(scr), rect, win)) keys.push(el.key);
    }
    if (keys.length) {
      const next = combine(this.sel.elems, keys, mode);
      this.selectElemKeys(b.id, next);
      this.toast(`${next.length} element(s) selected.`);
      return;
    }
    // No element in the box: volumes.
    const sids = b.solids.filter((s) => !solidHidden(this.project, s) && !solidLocked(this.project, s) && boxPicks(solidPts(s, M).map(scr), rect, win)).map((s) => s.id);
    if (!sids.length && mode !== 'replace') return;
    const next = combine(this.sel.solids, sids, mode);
    this.select({ building: b.id, solids: next });
    if (next.length) this.toast(`${next.length} volume(s) selected.`);
  }

  // ── Facade elements ──────────────────────────────────────────────────
  /** Elements (windows, doors…) of the building being edited. */
  elements(): Elem[] {
    const b = this.store.building(this.context ?? this.sel.building);
    const built = b && this.view.built.get(b.id);
    if (!b || !built) return [];
    return elementsOf(built.ev.placements, (pl) => {
      if (pl.tag.item) return b.items.find((i) => i.id === pl.tag.item)?.type ?? '';
      const rule = findSolid(b, pl.tag.solid)?.facade.find((f) => f.id === pl.tag.rule);
      const ex = rule?.except[pl.tag.key!];
      return ex && ex !== 'none' ? ex : (rule?.type ?? '');
    }, (pl) => {
      // Floor by the real elevation of the part (rules, free parts and free components in the same numbering).
      const y = (pl.path ? (pl.path[0]?.[1] ?? 0) : pl.frame[13]!) + 0.05;
      const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
      let i = 0;
      lv.forEach((l, k) => {
        if (l.elevation <= y) i = k;
      });
      return i;
    });
  }

  /** Element selection: row, column, grow, shrink, same type, face, shift. */
  selectElems(op: 'row' | 'rowFace' | 'column' | 'grow' | 'shrink' | 'type' | 'face' | 'left' | 'right' | 'up' | 'down'): void {
    const all = this.elements();
    const cur = new Set(this.sel.elems);
    if (!cur.size) return;
    const next =
      op === 'row' ? row(all, cur) : op === 'rowFace' ? rowOnFace(all, cur) : op === 'column' ? column(all, cur) : op === 'grow' ? grow(all, cur) : op === 'shrink' ? shrink(all, cur) : op === 'type' ? sameType(all, cur) : op === 'face' ? sameFace(all, cur) : shift(all, cur, op);
    if (!next.size) return this.toast('Nothing left to shrink.');
    this.select({ building: this.sel.building ?? this.context, elems: [...next] });
    this.toast(`${next.size} element(s) selected.`);
  }

  /** Batch actions on the selected elements. */
  elemAction(kind: 'remove' | 'restore' | 'swap' | 'vary' | 'detach', typeId?: ID): void {
    const b = this.activeBuilding();
    if (!b || !this.sel.elems.length) return;
    const keys = this.sel.elems;
    let varied: ID | null = null;
    if (kind === 'vary') {
      // Type variant only for these elements (the others follow the original type).
      const first = this.elements().find((e) => e.key === keys[0]);
      const base = first && typeById(first.type, this.project);
      if (!base) return;
      const v = { id: uid(), family: base.family, name: base.name + ' (variant)', params: structuredClone(base.params), user: true, base: base.base ?? base.id };
      this.store.project.types.push(v);
      varied = v.id;
    }
    // Back to rule only where something left it (an exception or a detached part).
    if (kind === 'restore') {
      const back = keys.some((k) => {
        const parts = k.split('|');
        if (parts[0] === 'r') return findSolid(b, parts[1]!)?.facade.find((f) => f.id === parts[2])?.except[parts[3]!] !== undefined;
        return !!b.items.find((i) => i.id === parts[1])?.origin;
      });
      if (!back) return this.toast('Nothing to bring back: these elements already follow their rule.');
    }
    // Detach from rule: each element becomes a free component in the same place (Figma: detach).
    const detached: string[] = [];
    const placed = kind === 'detach' ? new Map(this.elements().map((e) => [e.key, e])) : null;
    this.change(b.id, (x) => {
      for (const k of keys) {
        const parts = k.split('|');
        if (parts[0] === 'r') {
          const rule = findSolid(x, parts[1]!)?.facade.find((f) => f.id === parts[2]);
          if (!rule) continue;
          const pos = parts[3]!;
          if (kind === 'detach') {
            const el = placed!.get(k);
            if (!el?.pl.host) continue;
            const ex = rule.except[pos];
            const id = uid();
            x.items.push({ id, type: ex && ex !== 'none' ? ex : rule.type, params: structuredClone(rule.params), host: { kind: 'face', solid: el.pl.host.solid, edge: el.pl.host.edge, u: el.pl.host.s, y: el.pl.host.y }, origin: { solid: parts[1]!, rule: rule.id, key: pos, ...(ex && ex !== 'none' ? { prev: ex } : {}) } });
            rule.except[pos] = 'none';
            detached.push(`i|${id}|0`);
          } else if (kind === 'remove') rule.except[pos] = 'none';
          else if (kind === 'restore') {
            delete rule.except[pos];
            if (rule.sizes) {
              delete rule.sizes[pos];
              if (!Object.keys(rule.sizes).length) delete rule.sizes;
            }
          }
          else if (kind === 'swap' && typeId) rule.except[pos] = typeId;
          else if (kind === 'vary' && varied) rule.except[pos] = varied;
        } else if (parts[0] === 'i') {
          if (kind === 'restore') {
            // A free part that came from a rule: it goes, and the rule takes the position again.
            const it = x.items.find((i) => i.id === parts[1]);
            const o = it?.origin;
            if (!o) continue;
            const rule = findSolid(x, o.solid)?.facade.find((f) => f.id === o.rule);
            if (rule) {
              // The position goes back to what it was before detaching (with the type variant, if any).
              if (o.prev) rule.except[o.key] = o.prev;
              else delete rule.except[o.key];
            }
            x.items = x.items.filter((i) => i.id !== it.id);
          } else if (kind === 'remove') x.items = x.items.filter((i) => i.id !== parts[1]);
          else if ((kind === 'swap' && typeId) || (kind === 'vary' && varied)) {
            const it = x.items.find((i) => i.id === parts[1]);
            if (it) it.type = (typeId ?? varied)!;
          }
        }
      }
    }, kind === 'remove' ? `${keys.length} element(s) removed.` : kind === 'restore' ? 'Elements went back to the rule.' : kind === 'vary' ? 'Variant created: edit the fields to change only these.' : kind === 'detach' ? `${keys.filter((k) => k.startsWith('r|')).length} element(s) detached from the rule: they move and change on their own.` : 'Type swapped.');
    if (kind === 'remove' || kind === 'restore') this.select({ building: b.id });
    else if (kind === 'detach') this.selectElemKeys(b.id, detached);
    else if (varied) this.variation = varied;
  }

  /** Variant type being edited (after "Edit only these"). */
  variation: ID | null = null;
  /** Whether the parameters of the selected elements apply to the whole type or only to them. */
  elemScope: 'type' | 'sel' = 'type';

  /**
   * Changes a parameter of the selected elements: on the type (every occurrence
   * and rule) or, with "only the selected", on a type variant created on the
   * first change (like duplicating the type in Revit).
   */
  editElemsParam(key: string, value: unknown): void {
    const picked = this.elements().filter((e) => this.sel.elems.includes(e.key));
    const types = [...new Set(picked.map((e) => e.type))];
    if (types.length !== 1) return;
    const tid = types[0]!;
    if (this.elemScope === 'type') return this.editType(tid, key, value);
    // The variant already belongs only to these when no other element uses the type.
    const others = this.elements().some((e) => e.type === tid && !this.sel.elems.includes(e.key));
    if (others || this.project.types.every((t) => t.id !== tid)) {
      this.elemAction('vary');
      if (!this.variation) return;
      return this.editType(this.variation, key, value);
    }
    this.editType(tid, key, value);
  }

  // ── Tools ────────────────────────────────────────────────────────────
  setTool(t: Tool): void {
    if (!this.toolOffered(t)) {
      this.toast('That tool is in the Model workspace (Alt+PageUp/PageDown or the tabs at the top).');
      return;
    }
    this.cancel();
    this.shell.dim.hidden = true;
    // A pending measure belongs to the last tool (the cut's height, a stair's height): another tool starts clean.
    if (this.measure && t !== this.tool) this.clearMeasure();
    if (t !== 'iwall' && t !== 'room') {
      this.iwallSel = null;
      this.roomSel = null;
    }
    // The thickness of new walls is typed in the measure box.
    if (t === 'iwall' || t === 'room' || t === 'walls')
      queueMicrotask(() =>
        this.setMeasure('Wall thickness', (txt) => {
          const v = parseLength(txt);
          if (v === null || v < 0.05 || v > 1.5) return false;
          if (this.tool === 'walls') this.wallThickness = v;
          else this.iwallThickness = v;
          this.toast(`New walls ${fmt(v)} m thick.`);
          this.emit();
          return true;
        }),
      );
    this.tool = t;
    if (t !== 'place') this.placing = null;
    // Subtracting is a mode of the drawing tools: going back to selecting (after a shape is drawn, or by
    // choice) leaves it, so the next drawing adds again (audit D4: it stayed on, unseen).
    if (t !== 'rect' && t !== 'circle' && t !== 'polygon' && t !== 'spline' && t !== 'arc' && t !== 'block') this.drawMode = 'add';
    this.renderTools();
    this.updateHint();
    // Handles and bar according to the new tool (a visible handle is a clickable handle).
    this.drawSelection();
    this.emit();
  }

  /** Starts placing a component type. */
  startPlacing(typeId: ID): void {
    this.setTool('place');
    this.placing = typeId;
    const t = typeById(typeId, this.project);
    const f = t && family(t.family);
    this.updateHint(f ? (f.host === 'face' ? `${t!.name}: click a wall to place it. Esc finishes.` : f.host === 'path' ? `${t!.name}: click the path points; Enter finishes.` : `${t!.name}: click the ground or a roof.`) : undefined);
    this.emit();
  }

  private renderTools(): void {
    type T = { id: string; ic: string; label: string; key: string };
    // Everything in view, in groups (like the Blender toolbar): nothing hidden in a submenu.
    const groups: T[][] = [
      [
        { id: 'select', ic: 'cursor', label: 'Select: move, rotate and size right on the selection', key: 'V' },
        { id: 'move', ic: 'move', label: 'Move', key: 'M' },
        { id: 'rotate', ic: 'rotate', label: 'Rotate', key: 'Q' },
        { id: 'scale', ic: 'scale', label: 'Scale and size', key: 'S' },
      ],
      [
        { id: 'push', ic: 'push', label: 'Push/pull faces', key: 'P' },
        { id: 'extrude', ic: 'extrude', label: 'Extrude face (new volume)', key: 'E' },
        { id: 'cut', ic: 'knife', label: 'Cut: a wall in two faces (Shift: across, at a height); two clicks on a top cut the volume', key: 'U' },
        { id: 'iwall', ic: 'draw', label: 'Interior walls: click points on the floor that is cut open (Shift+click on a wall: a door); Enter or Esc ends', key: 'I' },
        { id: 'walls', ic: 'wall', label: 'Walls: click the centre line on the ground; click the first point to close it into a building with walls of real thickness; Enter: a free-standing wall', key: 'W' },
        { id: 'slab', ic: 'flat', label: 'Slab: click the corners of a floor slab on the floor shown (a balcony, a mezzanine, a landing)', key: 'Shift+F' },
        { id: 'column', ic: 'pillar', label: 'Column: click on the floor shown; it reaches the slab above', key: 'Shift+K' },
        { id: 'beam', ic: 'row', label: 'Beam: click its two ends; it runs under the slab above', key: 'Shift+B' },
        { id: 'room', ic: 'lot', label: 'Room: click inside walls to make a room (name and area), or drag a rectangle: four walls and the room', key: 'Shift+R' },
        { id: 'stair', ic: 'floorUp', label: 'Stair: click the foot, click where it ends, then move up or down for the height and click (it snaps to the floors)', key: 'Shift+I' },
        { id: 'opening', ic: 'opening', label: 'Opening: a click on a wall puts a window; a rectangle dragged on it asks what it is (door, balcony, canopy, annex, niche…)', key: 'O' },
      ],
      [
        { id: 'rect', ic: 'rect', label: 'Rectangle', key: 'R' },
        { id: 'circle', ic: 'circle', label: 'Circle', key: 'C' },
        { id: 'polygon', ic: 'polygon', label: 'Polygon', key: 'L' },
        { id: 'spline', ic: 'path', label: 'Spline: click the points of a smooth outline; click the first point or Enter closes it (its points stay editable)', key: 'Shift+P' },
        { id: 'arc', ic: 'arc', label: 'Arc: click the two ends of the chord, then a point of the arc', key: 'Shift+C' },
        { id: 'lot', ic: 'lot', label: 'Lot: drag a rectangle on the ground (or click two corners); its panel builds a house or a block in what the setbacks leave', key: 'Shift+L' },
        { id: 'street', ic: 'street', label: 'Street: click the points of its center line; Enter or a double click ends', key: 'Shift+S' },
        { id: 'mode', ic: this.drawMode === 'add' ? 'add' : 'subtract', label: this.drawMode === 'add' ? 'Drawing adds (switch to subtract)' : 'Drawing subtracts (switch to add)', key: 'X' },
      ],
      [
        { id: 'catalog', ic: 'catalog', label: 'Library of blocks and components', key: 'K' },
        { id: 'paint', ic: 'paint', label: 'Paint (Alt: eyedropper)', key: 'B' },
        { id: 'tape', ic: 'tape', label: 'Tape and dimensions (Shift+Delete clears)', key: 'T' },
      ],
    ];
    // The workspace shows only its tools (the library and paint follow their own tools).
    const offered = (t: T) => t.id === 'catalog' ? this.toolOffered('place') || this.workspace === 'materials' : t.id === 'mode' ? this.toolOffered('rect') : this.toolOffered(t.id as Tool);
    for (let i = 0; i < groups.length; i++) groups[i] = groups[i]!.filter(offered);
    for (let i = groups.length - 1; i >= 0; i--) if (!groups[i]!.length) groups.splice(i, 1);
    const pressed = (t: T) => (t.id === 'mode' ? this.drawMode === 'subtract' : t.id === 'catalog' ? !this.shell.cat.classList.contains('closed') : this.tool === t.id);
    this.shell.tools.innerHTML = groups
      .map((g) => g.map((t) => `<button class="f3-tool" data-tool="${t.id}" title="${tr(t.label)} · ${t.key}" aria-label="${t.label}" aria-pressed="${pressed(t)}">${icon(t.ic)}</button>`).join(''))
      .join('<hr>');
    const snapBtn = this.shell.viewbar.querySelector('[data-cmd="snap"]');
    snapBtn?.setAttribute('aria-pressed', String(this.infer.enabled));
    const libBtn = this.shell.status.bar.querySelector('[data-cmd="library"]');
    libBtn?.setAttribute('aria-pressed', String(!this.shell.cat.classList.contains('closed')));
    this.shell.tools.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.tool!;
        if (id === 'mode') this.toggleDrawMode();
        else if (id === 'catalog') this.toggleLibrary();
        else this.setTool(id as Tool);
      }),
    );
  }


  /** Opens or closes the library panel. */
  toggleLibrary(open?: boolean): void {
    const cat = this.shell.cat;
    const willOpen = open ?? cat.classList.contains('closed');
    cat.classList.toggle('closed', !willOpen);
    if (willOpen) this.emitCatalog();
    this.renderTools();
  }

  toggleDrawMode(): void {
    this.drawMode = this.drawMode === 'add' ? 'subtract' : 'add';
    this.renderTools();
    this.toast(this.drawMode === 'add' ? 'Drawing adds volumes.' : 'Drawing subtracts: courtyards, openings, niches, arches.');
  }

  toggleSnap(): void {
    this.infer.enabled = !this.infer.enabled;
    this.renderTools();
    this.toast(this.infer.enabled ? 'Snap on.' : 'Snap off (free movement).');
  }

  /** The catalog listens to this to open/focus the search. */
  catalogRequested: (() => void) | null = null;
  private emitCatalog(): void {
    this.catalogRequested?.();
  }

  updateHint(text?: string): void {
    const t =
      text ??
      ({
        select: this.context ? 'Click: volume, face or part · Ctrl adds · Shift toggles · drag on empty space: box · double click: row' : 'Click: building · Ctrl adds · Shift toggles · drag on empty space: box · double click: enter',
        move: 'Move: drag the object or an arrow (type the distance and Enter). Ctrl copies.',
        rotate: 'Rotate: drag the ring (type the angle and Enter).',
        scale: 'Scale: drag a corner (Shift keeps the proportion), a side arrow or the top square (height).',
        push: 'Drag a face to push or pull it. Type the distance and Enter.',
        extrude: 'Extrude: drag a face to create a new volume from it. Type the depth and Enter.',
        cut: 'Cut: click a wall to split it in two faces (Shift: across, at a height) · on a top, click two points of the edge to cut the volume · Esc cancels.',
        tape: 'Click two points to measure; the dimension stays in the model.',
        rect: 'Click two corners (on the ground or on a flat roof). Then type 10x8 and Enter for width × depth, or a number for the height.',
        circle: 'Click the center and then the radius.',
        polygon: 'Click the points; click the first one or Enter to close. Backspace removes a point.',
        spline: 'Click the points of a smooth outline; click the first one or Enter to close. Its points stay editable.',
        arc: 'Click the two ends of the chord, then a point the arc passes through.',
        opening: 'Click a wall: a window there · drag a rectangle on a wall: choose window, door, balcony, canopy, annex or niche.',
        iwall: 'Click points on the floor that is cut open (Interior view) to draw walls; drag a corner dot to move it; Alt+click a wall dot deletes it; Shift+click a wall: a door.',
        slab: 'Click the corners of a slab on the floor shown (Interior view picks the floor); click the first corner to close it.',
        column: 'Click on the floor shown: a column from the floor to the slab above (size and shape in its panel).',
        beam: 'Click the two ends of the beam: it runs under the slab above the floor shown.',
        walls: 'Click the centre line of the walls; click the first point to close it into a building (type the thickness: 0.25); Enter: a free-standing wall.',
        room: 'Click inside walls: a room with its name and area · drag a rectangle: four walls and the room (type the wall thickness).',
        stair: 'Click the foot of the stair, click where it ends, then move up or down for the height and click (it snaps to the floors).',
        lot: 'Drag a rectangle on the ground (or click two corners): a lot with setbacks; its panel builds on it.',
        street: 'Click the points of the street’s center line; Enter or a double click ends.',
        block: 'Click the ground to create, a roof to stack, a wall to attach. X: add or subtract.',
        place: 'Click to place.',
        paint: 'Click a face to paint. Alt+click copies the material.',
      } as Record<Tool, string>)[this.tool];
    this.shell.status.hint.textContent = t;
    // In a narrow window the hint may be cut: the full text shows on hover.
    this.shell.status.hint.title = t;
  }

  private setMeasure(label: string, apply: Measure['apply']): void {
    this.measure = { label, apply };
    this.shell.status.vcbLabel.textContent = label;
  }

  /** Nothing to correct by typing any more: the box goes back to its idle state (and loses half-typed text). */
  private clearMeasure(): void {
    this.measure = null;
    this.shell.status.vcbLabel.textContent = 'Size';
    this.shell.status.vcb.value = '';
  }

  // ── Pointer ──────────────────────────────────────────────────────────
  private bindCanvas(): void {
    const el = this.view.renderer.domElement;
    el.tabIndex = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Middle button: no Windows autoscroll and no link opening (MDN: mousedown/auxclick default actions).
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener('auxclick', (e) => e.preventDefault());
    // Navigation (Revit/AutoCAD): middle drag pans, Shift+middle orbits, the wheel zooms on the
    // point under the cursor; dragging the right button also orbits (still, it opens the menu).
    let orbit: { x: number; y: number; pan: boolean; right: boolean; x0: number; y0: number; pivot: THREE.Vector3 } | null = null;
    // Touch: the fingers down; with two, their middle pans and their spread zooms there.
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { mx: number; my: number; d: number; pivot: THREE.Vector3 } | null = null;
    const pinchMove = () => {
      const [a, b] = [...touches.values()];
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2,
        d = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinch) {
        const at = { clientX: mx, clientY: my };
        pinch = { mx, my, d, pivot: this.view.modelAt(at) ?? this.view.nearGroundAt(at) ?? this.view.target.clone() };
        return;
      }
      this.view.panBy(mx - pinch.mx, my - pinch.my, pinch.pivot);
      if (d > 10 && pinch.d > 10) this.view.zoomAt(pinch.pivot, pinch.d / d);
      pinch.mx = mx;
      pinch.my = my;
      pinch.d = d;
    };
    const touchUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return false;
      const was = touches.size;
      touches.delete(e.pointerId);
      if (was >= 2) {
        if (touches.size < 2) pinch = null;
        return true;
      }
      return false;
    };
    el.addEventListener('pointerdown', (e) => {
      el.focus();
      this.view.stopAnim();
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          // Two fingers: whatever one finger began is cancelled; they pan and pinch (Estúdio de Construção).
          this.cancel();
          pinch = null;
        }
        if (touches.size >= 2) return;
      }
      if (e.button === 2 || e.button === 1) {
        // Middle drag: FORMA/Revit pans (Shift orbits); SketchUp and Blender orbit (Shift pans).
        const pan = e.button === 1 && (this.navPreset === 'forma' ? !e.shiftKey : e.shiftKey);
        // Pivot (Blender Auto Depth + Orbit Around Selection): the model under the cursor, else the
        // selection, else the whole model, never empty ground (the model would swing off screen).
        // Panning grabs the point under the cursor at its depth (near ground counts).
        const pivot = pan ? (this.view.modelAt(e) ?? this.view.nearGroundAt(e) ?? this.orbitPivot(e)) : this.orbitPivot(e);
        if (!pan) this.view.showPivot(pivot);
        orbit = { x: e.clientX, y: e.clientY, pan, right: e.button === 2, x0: e.clientX, y0: e.clientY, pivot };
        el.setPointerCapture(e.pointerId);
        if (e.button === 1) e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      this.onDown(e);
    });
    // A navigation drag ends however the pointer is released (Pointer Events: pointercancel and
    // lostpointercapture); without this a lost release left the view orbiting with every move.
    const endNav = () => {
      if (!orbit) return;
      orbit = null;
      this.view.showPivot(null);
    };
    el.addEventListener('pointercancel', (e) => {
      touchUp(e);
      endNav();
    });
    el.addEventListener('lostpointercapture', endNav);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) return pinchMove();
      }
      if (orbit && (e.buttons & 6) === 0) endNav();
      if (orbit) {
        const dx = e.clientX - orbit.x,
          dy = e.clientY - orbit.y;
        orbit.x = e.clientX;
        orbit.y = e.clientY;
        if (orbit.pan) this.view.panBy(dx, dy, orbit.pivot);
        else {
          // 0.35° per pixel (Blender turntable sensitivity is of this order).
          this.view.orbitAround(orbit.pivot, -dx * 0.006, -dy * 0.006);
          this.view.showPivot(orbit.pivot);
        }
        return;
      }
      this.onMove(e);
    });
    el.addEventListener('pointerup', (e) => {
      if (touchUp(e)) return;
      if (orbit) {
        // Right button without dragging: context menu of what is under the cursor (dragging still orbits).
        const click = orbit.right && Math.hypot(e.clientX - orbit.x0, e.clientY - orbit.y0) < 5;
        orbit = null;
        this.view.showPivot(null);
        if (click) this.openContext(e);
        return;
      }
      if (e.button === 0) this.onUp(e);
    });
    el.addEventListener('dblclick', (e) => this.onDouble(e));
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.view.stopAnim();
        const k = Math.exp(Math.max(-300, Math.min(300, e.deltaY)) * 0.0011);
        // Zooms on the point under the cursor (it stays still on screen): the model, or the ground
        // when it is near; over the sky or the far horizon, on the view center.
        const p = this.view.modelAt(e) ?? this.view.nearGroundAt(e) ?? this.view.target.clone();
        this.view.zoomAt(p, k);
      },
      { passive: false },
    );
    // Drag from the catalog onto the view.
    this.shell.view.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('text/forma-type')) {
        e.preventDefault();
        this.tool = 'place';
        this.placing = this.placing ?? null;
        this.onMove(e as unknown as PointerEvent);
      }
    });
    this.shell.view.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData('text/forma-type');
      if (!id) return;
      e.preventDefault();
      this.startPlacing(id);
      this.placeAt(e as unknown as PointerEvent);
    });
  }

  private pickAt(e: { clientX: number; clientY: number }, only?: ID | null): Hit | null {
    return this.view.pick(this.store.project, e, only);
  }

  /**
   * The wall or top under the pointer, through the windows and parts in front of it: a ray that goes in
   * through an opening (its reveal, the room behind the glass) counts as the wall it is in, the side of
   * that volume nearest to the point.
   */
  private pickBody(e: { clientX: number; clientY: number }): Hit | null {
    const hit = this.view.pick(this.store.project, e, null, true);
    const f = hit?.face;
    if (!hit || !f || !/^(reveal|room)/.test(f.kind)) return hit;
    const s = findSolid(hit.building, f.solid);
    if (!s) return hit;
    const lp = hit.point.clone().applyMatrix4(this.view.buildingMatrix(hit.building).invert());
    const r = solidRings(s).outer;
    let best = '',
      bd = Infinity;
    r.pts.forEach((a, i) => {
      const b = r.pts[(i + 1) % r.pts.length]!;
      const d = segDistance(lp.x, lp.z, a[0], a[1], b[0], b[1]);
      if (d < bd) {
        bd = d;
        best = r.segs[i]!.edge;
      }
    });
    return best ? { ...hit, face: { kind: 'side', solid: s.id, edge: best } as FaceInfo } : hit;
  }

  private onDown(e: PointerEvent): void {
    if (this.polyline.active) return this.polyline.down(e);
    if (this.tool === 'select' && this.elemMode !== 'object' && this.context && this.subDown(e)) return;
    if (this.selectLike() || this.pushLike()) {
      const h = this.handles.hit(e);
      if (h) {
        this.beginHandle(h, e);
        if (this.drag) this.drag.data.viaHandle = true;
        return;
      }
      // Alt+click outside a building: the building behind the selected one (Blender/Maya "select through").
      const behind = e.altKey && !this.context && this.sel.building ? this.view.pick(this.store.project, e, undefined, false, new Set([this.sel.building, ...this.sel.others])) : null;
      const hit = behind ?? this.pickAt(e);
      if (this.pushLike()) {
        if (hit?.face && (hit.face.kind === 'side' || hit.face.kind === 'top' || hit.face.kind === 'roof') && hit.building) {
          if (this.context !== hit.building.id) this.context = hit.building.id;
          this.select({ building: hit.building.id, solids: [hit.face.solid], face: hit.face.kind === 'side' ? { kind: 'side', edge: hit.face.edge! } : { kind: 'top' } });
          const fh = this.handles.list.find((x) => x.kind === (hit.face!.kind === 'side' ? 'push' : 'height'));
          if (fh) this.beginHandle(fh, e);
        } else if (hit?.face?.kind === 'cutter' && hit.building) {
          // The back of a niche: pushing or pulling it changes the niche's depth (through the wall it becomes a projection).
          const so = findSolid(hit.building, hit.face.solid);
          if (so && hostedFrame(so)) {
            if (this.context !== hit.building.id) this.context = hit.building.id;
            this.select({ building: hit.building.id, solids: [so.id] });
            const fh = this.handles.list.find((x) => x.hosted);
            if (fh) this.beginHandle(fh, e);
          }
        }
        return;
      }
      // Ctrl on what is already selected: dragging copies (SketchUp); still, nothing changes.
      const copyGrab = !!hit && (e.ctrlKey || e.metaKey) && !e.shiftKey && this.inSelection(hit, false);
      // Empty space, or Ctrl/Shift anywhere: selection box; still, it counts as a click on release.
      if (this.selectLike() && !copyGrab && (!hit || e.ctrlKey || e.shiftKey || e.metaKey)) {
        this.marquee = { ax: e.clientX, ay: e.clientY, bx: e.clientX, by: e.clientY, active: false, hit, ev: { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey } };
        return;
      }
      // Pressing something already in a multiple selection does not break it: dragging moves the
      // group; releasing without dragging selects only that (like SketchUp and Figma).
      if (hit && (copyGrab || this.inSelection(hit, true))) {
        const b0 = this.activeBuilding()!;
        if (this.context !== b0.id) this.beginMoveBuilding(b0, e, hit);
        else if (this.sel.item && !this.sel.elems.length) this.beginMoveItem(b0, e, hit);
        else if (this.sel.solids.length && !this.sel.elems.length) this.beginMoveSolids(b0, e, hit);
        // One window or door of a facade rule, dragged: it leaves the rule (a part of its own) and moves.
        else if (this.sel.elems.length === 1 && this.sel.elems[0]!.startsWith('r|') && hit.part?.rule) this.pendingDetach = { x: e.clientX, y: e.clientY, e };
        const ev = { ctrlKey: copyGrab, shiftKey: false, metaKey: false, altKey: false };
        if (this.drag) this.drag.data.click = { hit, ev };
        else if (!copyGrab) this.pendingClick = hit;
        return;
      }
      // Clicking again on an already selected building (without dragging) enters it and picks the volume.
      const drill = hit && this.context !== hit.building.id && this.sel.building === hit.building.id && !e.shiftKey && !this.sel.others.length ? hit.face?.solid : undefined;
      this.clickSelect(hit, e);
      this.drawHover(null);
      // Dragging what is selected moves it (right on the model).
      const b = this.activeBuilding();
      if (hit && b && hit.building.id === b.id) {
        if (this.context !== b.id) {
          this.beginMoveBuilding(b, e, hit);
          if (this.drag && drill) this.drag.data.drill = drill;
        }
        else if (this.sel.item) this.beginMoveItem(b, e, hit);
        // A window or door of a facade rule: dragging it detaches it from the rule and moves it.
        else if (this.sel.elems.length === 1 && this.sel.elems[0]!.startsWith('r|') && hit.part?.rule) this.pendingDetach = { x: e.clientX, y: e.clientY, e };
        else if (this.sel.solids.length && !this.sel.elems.length) this.beginMoveSolids(b, e, hit);
      }
      return;
    }
    if (this.tool === 'rect' || this.tool === 'circle' || this.tool === 'polygon' || this.tool === 'spline' || this.tool === 'arc') return this.drawDown(e);
    if (this.tool === 'place') return this.placeAt(e);
    if (this.tool === 'block') return this.blockAt(e, true);
    if (this.tool === 'tape') return this.tapeAt(e, true);
    if (this.tool === 'cut') return this.cutAt(e, true);
    if (this.tool === 'opening') return this.opening.down(e);
    if (this.tool === 'iwall') {
      // A wall corner or a wall under the pointer: drag the corner, Alt+click deletes the wall.
      const h = this.handles.hit(e);
      if (h?.iwall) return this.beginIwallHandle(h, e);
      return this.iwallAt(e, true);
    }
    if (this.tool === 'stair') return this.stair.down(e);
    if (this.tool === 'walls') return this.wallsTool.down(e);
    if (this.tool === 'slab') return this.slabTool.down(e);
    if (this.tool === 'column') return this.columnAt(e);
    if (this.tool === 'beam') return this.beamAt(e, true);
    if (this.tool === 'room') return this.roomDown(e);
    if (this.tool === 'lot') return this.site.lotDown(e);
    if (this.tool === 'street') return this.site.streetDown(e);
    if (this.tool === 'paint') return this.paintAt(e);
  }

  private clickSelect(hit: Hit | null, e: Mods): void {
    const mode = selMode(e);
    // A tree or lamp planted along a street (a building with parts only) picks the street on a click;
    // inside that building (double click) the parts themselves are picked.
    if (hit && !hit.building.solids.length && this.context !== hit.building.id && mode === 'replace' && this.pointerAt && this.pickSiteAt(this.pointerAt)) return;
    if (!hit) {
      // A click on empty space with a modifier keeps the selection.
      if (mode !== 'replace') return;
      if (this.context) {
        if (this.sel.solids.length || this.sel.item) return this.select({ building: this.context });
        const id = this.context;
        this.context = null;
        return this.select({ building: id });
      }
      return this.select({});
    }
    const b = hit.building;
    if (this.context !== b.id) {
      if (this.context) this.context = null;
      // Several buildings (to align and distribute).
      if (mode !== 'replace') return this.selectBuildings(combine(this.selectedBuildings(), [b.id], mode));
      return this.select({ building: b.id });
    }
    if (hit.part) {
      const key = hit.part.rule ? `r|${hit.part.solid}|${hit.part.rule}|${hit.part.key}` : hit.part.item ? `i|${hit.part.item}|${hit.part.key ?? '0'}` : null;
      // Alt: the row span between the last selected and this one.
      if (key && e.altKey && this.sel.elems.length) return this.selectElemKeys(b.id, combine(this.sel.elems, [...between(this.elements(), this.sel.elems[this.sel.elems.length - 1]!, key)], 'add'));
      if (key && mode !== 'replace') return this.selectElemKeys(b.id, combine(this.sel.elems, [key], mode));
      if (hit.part.item) return this.select({ building: b.id, item: hit.part.item, elems: key ? [key] : [] });
      if (key) return this.select({ building: b.id, elems: [key] });
    }
    const f = hit.face;
    if (!f) return;
    const sid = f.solid;
    if (mode !== 'replace') {
      // With a modifier, a wall only joins a volume selection; with elements selected, nothing changes.
      if (this.sel.item || this.sel.elems.length) return;
      return this.select({ building: b.id, solids: combine(this.sel.solids, [sid], mode) });
    }
    // First click: the volume; another click on the same volume: the face (the plinth and the parapet too).
    const already = this.sel.solids.length === 1 && this.sel.solids[0] === sid;
    this.select({ building: b.id, solids: [sid], face: already ? faceSelOf(f) : null });
  }

  /** When a click on a selected building last went into it (the first click of a double click does). */
  private drilledAt = -Infinity;

  private onDouble(e: MouseEvent): void {
    if ((this.tool === 'polygon' || this.tool === 'spline') && this.draft) return this.finishPolygon();
    if (!this.selectLike()) return;
    const hit = this.pickAt(e);
    if (!hit) return;
    // The first click of this double click already went into the building: the double click means "enter",
    // so it ends on the volume under the cursor — not on the face (top or parapet, by a pixel).
    if (this.context === hit.building.id && performance.now() - this.drilledAt < 600) {
      const sid = hit.face?.solid ?? hit.part?.solid;
      if (sid) this.select({ building: hit.building.id, solids: [sid] });
      return;
    }
    if (this.context === hit.building.id && hit.part && (hit.part.rule || hit.part.item)) {
      // Double click on an element: the whole row (3ds Max Loop).
      if (!this.sel.elems.length) this.clickSelect(hit, e as PointerEvent);
      return this.selectElems('row');
    }
    if (this.context !== hit.building.id) {
      this.enter(hit.building.id);
      const h2 = this.pickAt(e, hit.building.id);
      // Wall: its volume; window or balcony: the volume the rule (or the component) occupies.
      const it = h2?.part?.item ? hit.building.items.find((x) => x.id === h2.part!.item) : undefined;
      const sid = h2?.face?.solid ?? h2?.part?.solid ?? (it && (it.host.kind === 'face' || it.host.kind === 'roof') ? it.host.solid : undefined);
      if (sid) this.select({ building: hit.building.id, solids: [sid] });
      this.toast('Editing the building. Esc leaves.');
    } else if (hit.face && (hit.face.kind === 'side' || hit.face.kind === 'top')) {
      this.select({ building: hit.building.id, solids: [hit.face.solid], face: hit.face.kind === 'side' ? { kind: 'side', edge: hit.face.edge! } : { kind: 'top' } });
    }
  }

  /** A rule element pressed: dragging it past a few pixels detaches it and moves the new part. */
  private pendingDetach: { x: number; y: number; e: PointerEvent } | null = null;

  private onMove(e: PointerEvent): void {
    if (this.siteDrag) return this.moveSiteDrag(e);
    if (this.polyline.active) return this.polyline.move(e);
    if (this.pendingDetach && e.buttons & 1 && Math.hypot(e.clientX - this.pendingDetach.x, e.clientY - this.pendingDetach.y) > 5) {
      const pd = this.pendingDetach;
      this.pendingDetach = null;
      this.pendingClick = null;
      this.elemAction('detach');
      const b = this.activeBuilding();
      if (b && this.sel.item) {
        this.refreshActive();
        this.beginMoveItem(b, pd.e, null);
      }
      return;
    }
    if (this.marquee) return this.moveMarquee(e);
    if (this.drag) return this.updateDrag(e);
    if (this.blockedAt && e.buttons && Math.hypot(e.clientX - this.blockedAt.x, e.clientY - this.blockedAt.y) >= 4) {
      this.blockedAt = null;
      this.toast('Exploded view: set "Floors apart" to 0 (Interior view) to edit.');
    }
    // Vertex and edge modes: the corner or side a click would pick lights up.
    if (this.tool === 'select' && this.context && (this.elemMode === 'vertex' || this.elemMode === 'edge')) {
      const b = this.store.building(this.context);
      this.drawSubHover(b ? this.subPickAt(e, b) : null);
    }
    if (this.handlesLive()) {
      this.handles.setHover(this.handles.hit(e));
      const h = this.handles.hover;
      if (h) {
        this.shell.status.hint.textContent = h.label;
        this.drawHover(null);
        this.view.renderer.domElement.style.cursor = h.kind === 'size' ? (h.sx && h.sz ? (h.sx * h.sz > 0 ? 'nwse-resize' : 'nesw-resize') : 'ew-resize') : h.kind === 'rotate' ? 'grab' : 'move';
        return;
      }
      const hit = this.pickAt(e);
      if (this.pushLike()) {
        // Push: the hand shows only where a click picks a pushable face.
        const ok = !!hit?.face && (hit.face.kind === 'side' || hit.face.kind === 'top' || hit.face.kind === 'roof');
        this.drawHover(null);
        this.updateHint();
        this.view.renderer.domElement.style.cursor = ok ? 'pointer' : 'default';
        return;
      }
      this.drawHover(hit);
      const b = this.activeBuilding();
      const onSel = !!hit && !!b && hit.building.id === b.id && (this.context !== b.id || (hit.face && this.sel.solids.includes(hit.face.solid)) || (!!hit.part?.item && hit.part.item === this.sel.item));
      this.view.renderer.domElement.style.cursor = !hit ? 'default' : onSel ? 'move' : 'pointer';
      return;
    }
    if (this.opening.active) return this.opening.hover(e);
    if (this.tool === 'rect' || this.tool === 'circle' || this.tool === 'polygon' || this.tool === 'spline' || this.tool === 'arc') return this.drawMove(e);
    if (this.tool === 'place') return this.placeHover(e);
    if (this.tool === 'block') return this.blockAt(e, false);
    if (this.tool === 'tape') return this.tapeAt(e, false);
    if (this.tool === 'cut') return this.cutAt(e, false);
    if (this.tool === 'opening') return this.opening.hover(e);
    if (this.tool === 'iwall') return this.iwallAt(e, false);
    if (this.tool === 'stair') return this.stair.move(e);
    if (this.tool === 'walls') return this.wallsTool.move(e);
    if (this.tool === 'slab') return this.slabTool.move(e);
    if (this.tool === 'column') return void this.showDim('Click to place a column on the floor shown', e);
    if (this.tool === 'beam') return this.beamAt(e, false);
    if (this.tool === 'room') return this.roomMove(e);
    if (this.tool === 'lot') return this.site.lotMove(e, (e.buttons & 1) === 1);
    if (this.tool === 'street') return this.site.streetMove(e);
  }

  private hoverKey = '';
  private hoverOverlay = new THREE.Group();

  /**
   * Pre-highlight: shows what the next click will select (building, volume,
   * face or element), like SketchUp, before clicking.
   */
  private drawHover(hit: Hit | null): void {
    if (!this.hoverOverlay.parent) this.view.overlay.add(this.hoverOverlay);
    let key = '';
    let what: { b: Building3; solids?: ID[]; face?: { solid: ID; kind: string; edge?: ID }; part?: Hit['part'] } | null = null;
    if (hit && !this.drag) {
      const b = hit.building;
      if (this.context !== b.id) {
        // Building already selected: the click enters and picks the volume under the cursor.
        if (this.sel.building === b.id && hit.face) what = { b, solids: [hit.face.solid] };
        else if (this.sel.building !== b.id) what = { b, solids: b.solids.filter((s) => s.op === 'add').map((s) => s.id) };
      } else if (this.elemMode === 'vertex' || this.elemMode === 'edge') what = null;
      else if (this.elemMode === 'face') {
        if (hit.face && faceSelOf(hit.face)) what = { b, face: { solid: hit.face.solid, kind: hit.face.kind, edge: hit.face.edge } };
      } else if (hit.part && (hit.part.item || hit.part.rule)) what = { b, part: hit.part };
      else if (hit.face) {
        const already = this.sel.solids.length === 1 && this.sel.solids[0] === hit.face.solid;
        if (already && !this.sel.face && faceSelOf(hit.face)) what = { b, face: { solid: hit.face.solid, kind: hit.face.kind, edge: hit.face.edge } };
        else if (!already) what = { b, solids: [hit.face.solid] };
      }
      if (what) key = `${b.id}|${what.solids?.join(',') ?? ''}|${what.face ? what.face.solid + what.face.kind + (what.face.edge ?? '') : ''}|${what.part ? (what.part.item ?? '') + (what.part.rule ?? '') + (what.part.key ?? '') : ''}|${this.store.revision.get(b.id)}`;
    }
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    for (const c of [...this.hoverOverlay.children]) {
      this.hoverOverlay.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    if (what) {
      const M = this.view.buildingMatrix(what.b);
      const color = '#5b9cff';
      // Like the selection outline: strong where it is in view, faint behind (never drawn through the roof).
      const addLine = (pts: THREE.Vector3[], closed = true) => {
        const g = new THREE.BufferGeometry().setFromPoints(pts);
        const front = new (closed ? THREE.LineLoop : THREE.Line)(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
        const behind = new (closed ? THREE.LineLoop : THREE.Line)(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.16 }));
        front.renderOrder = 19;
        behind.renderOrder = 18;
        this.hoverOverlay.add(behind, front);
      };
      for (const id of what.solids ?? []) {
        const s = findSolid(what.b, id);
        if (!s) continue;
        const r = solidRings(s);
        addLine(r.outer.pts.map((p) => new THREE.Vector3(p[0], r.base + 0.02, p[1]).applyMatrix4(M)));
        addLine(r.topOuter.map((p) => new THREE.Vector3(p[0], r.top, p[1]).applyMatrix4(M)));
        r.outer.pts.forEach((p, i) => {
          if (r.outer.segs[i]!.curved) return;
          addLine([new THREE.Vector3(p[0], r.base, p[1]).applyMatrix4(M), new THREE.Vector3(r.topOuter[i]![0], r.top, r.topOuter[i]![1]).applyMatrix4(M)], false);
        });
      }
      const built = this.view.built.get(what.b.id);
      // Pre-selection shows only the outline (like SketchUp): a colored veil over the whole volume changed its colors.
      if (what.face && built) {
        const f0 = what.face;
        const { positions: P, indices: I, faceOf } = built.ev.shell;
        const pos: number[] = [];
        for (let t = 0; t < I.length / 3; t++) {
          const f = built.ev.faces[faceOf[t]!];
          if (!f || f.solid !== f0.solid) continue;
          const s0 = faceSelOf(f0 as FaceInfo);
          const fs = faceSelOf(f);
          if (!s0 || !fs || fs.kind !== s0.kind || (fs.kind === 'side' && f.edge !== f0.edge)) continue;
          for (let j = 0; j < 3; j++) {
            const i = I[t * 3 + j]! * 3;
            pos.push(P[i]!, P[i + 1]!, P[i + 2]!);
          }
        }
        if (pos.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
          m.applyMatrix4(M);
          m.renderOrder = 14;
          this.hoverOverlay.add(m);
        }
      }
      if (what.part && built) {
        const tag = what.part;
        const pos: number[] = [];
        const mm = new THREE.Matrix4();
        for (const pl of built.ev.placements) {
          if (pl.tag.item !== tag.item || pl.tag.rule !== tag.rule || pl.tag.key !== tag.key) continue;
          const [w, h, dd] = pl.family.size(pl.params);
          mm.fromArray(pl.frame).premultiply(M);
          const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(mm);
          const xs = [-w / 2 - 0.04, w / 2 + 0.04],
            ys = [-0.04, h + 0.04],
            zs = [-0.04, Math.max(0.12, dd) + 0.04];
          const k = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(xs[i & 1]!, ys[(i >> 1) & 1]!, zs[(i >> 2) & 1]!));
          for (const [a, b2] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as [number, number][]) pos.push(...k[a]!.toArray(), ...k[b2]!.toArray());
        }
        if (pos.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
          l.renderOrder = 19;
          this.hoverOverlay.add(l);
        }
      }
    }
    this.view.mark();
  }

  private onUp(e: PointerEvent): void {
    this.blockedAt = null;
    this.pendingDetach = null;
    if (this.siteDrag) return this.endSiteDrag();
    if (this.marquee) return this.endMarquee();
    if (this.pendingClick) {
      const hit = this.pendingClick;
      this.pendingClick = null;
      return this.clickSelect(hit, { ctrlKey: false, shiftKey: false, metaKey: false, altKey: false });
    }
    if (this.drag) return this.finishDrag(e);
    if (this.opening.active) return this.opening.up(e);
    if (this.tool === 'lot') return this.site.lotUp(e);
    if (this.tool === 'room' && this.roomFrom) return this.roomUp(e);
    if ((this.tool === 'rect' || this.tool === 'circle') && this.draft && this.draft.points.length === 1 && this.draft.hover && this.draft.hover.distanceTo(this.draft.points[0]!) > 0.6) this.drawDown(e);
  }

  cancel(): void {
    this.opening?.cancel();
    this.site?.cancel();
    this.stair?.cancel();
    this.wallsTool?.cancel();
    this.slabTool?.cancel();
    this.beamFrom = null;
    this.roomFrom = null;
    this.marquee = null;
    if (this.marqueeEl) this.marqueeEl.hidden = true;
    if (this.drag) {
      this.store.revert();
      this.drag = null;
      this.preview.clear();
      this.placeCtxBar();
    }
    this.draft = null;
    this.tapeFrom = null;
    this.cutFrom = null;
    this.clearSnap();
    this.removeGhost();
    for (const n of ['block', 'tape', 'cut']) {
      const o = this.snapOverlay.getObjectByName(n);
      if (o) this.snapOverlay.remove(o);
    }
    this.shell.dim.hidden = true;
    this.drawSelection();
  }

  // ── Drags ────────────────────────────────────────────────────────────
  private startDrag(kind: string, b: Building3, e: { clientX: number; clientY: number }, data: Record<string, unknown>, geometry: boolean): void {
    // Exploded floors are drawn apart from where they are: editing them there would mislead.
    // A click only selects, so the reason waits for a real move (the same 4 px that make a drag).
    if (explodeGap(this.project) > 0) return void (this.blockedAt = { x: e.clientX, y: e.clientY });
    this.drag = { kind, bid: b.id, start: { x: e.clientX, y: e.clientY }, moved: false, origBuilding: structuredClone(b), data, geometry };
  }

  /** Dragging a point of the selected street or lot, or the whole of it. */
  private siteDrag: { index: number; axis: THREE.Vector3 | null; from: THREE.Vector3; pts: Vec2[] } | null = null;

  private beginSiteDrag(h: Handle, e: PointerEvent): void {
    const sp = this.view.sitePicked;
    const pts = sp.street ? this.project.streets?.find((x) => x.id === sp.street)?.points : this.project.lots.find((x) => x.id === sp.lot)?.polygon;
    const from = this.view.onPlane(e, 0);
    if (!pts || !from) return;
    this.siteDrag = { index: h.site!.index, axis: h.site!.index < 0 ? h.dir!.clone() : null, from, pts: pts.map((p) => [p[0], p[1]] as Vec2) };
  }

  private moveSiteDrag(e: PointerEvent): void {
    const d = this.siteDrag!;
    const p = this.view.onPlane(e, 0);
    if (!p) return;
    let dx = p.x - d.from.x,
      dz = p.z - d.from.z;
    if (d.axis) {
      const t = dx * d.axis.x + dz * d.axis.z;
      dx = d.axis.x * t;
      dz = d.axis.z * t;
    }
    if (this.infer.enabled && !e.altKey) {
      const g = Math.max(0.5, this.infer.grid);
      dx = Math.round(dx / g) * g;
      dz = Math.round(dz / g) * g;
    }
    const sp = this.view.sitePicked;
    const target = sp.street ? this.store.project.streets?.find((x) => x.id === sp.street)?.points : this.store.project.lots.find((x) => x.id === sp.lot)?.polygon;
    if (!target) return;
    d.pts.forEach((q, i) => {
      if (d.index < 0 || d.index === i) target[i] = [q[0] + dx, q[1] + dz];
    });
    this.view.site.sync(this.store.project, sp);
    this.drawSelection();
    this.view.mark();
    this.showDim(d.index < 0 ? `${fmt(Math.hypot(dx, dz))} m` : `${fmt(target[d.index]![0])}, ${fmt(target[d.index]![1])}`, e);
  }

  private endSiteDrag(): void {
    const d = this.siteDrag!;
    this.siteDrag = null;
    this.shell.dim.hidden = true;
    const sp = this.view.sitePicked;
    // The buildings on a lot move with it (a whole lot moved, not a corner).
    if (d.index < 0 && sp.lot) {
      const lot = this.store.project.lots.find((x) => x.id === sp.lot)!;
      const dx = lot.polygon[0]![0] - d.pts[0]![0],
        dz = lot.polygon[0]![1] - d.pts[0]![1];
      const ids: ID[] = [];
      for (const b of this.store.project.buildings)
        if (b.lotId === sp.lot) {
          b.position = [b.position[0] + dx, b.position[1] + dz];
          ids.push(b.id);
        }
      this.store.commit(ids, ids.length ? `Lot moved with its ${ids.length} building(s).` : 'Lot moved.');
    } else if (d.index < 0 && sp.street) {
      // The trees planted along the street go with it.
      this.store.commit(this.replantTrees(), 'Street moved.');
    } else this.store.commit(sp.street ? this.replantTrees() : [], sp.street ? 'Street point moved.' : 'Lot corner moved.');
    if (this.store.changed) this.toast(sp.street ? (d.index < 0 ? 'Street moved.' : 'Street point moved.') : d.index < 0 ? 'Lot moved.' : 'Lot corner moved.');
    this.emit();
  }

  private beginHandle(h: Handle, e: PointerEvent): void {
    if (h.site) return this.beginSiteDrag(h, e);
    const b = this.activeBuilding();
    if (!b) return;
    const inCtx = this.context === b.id;
    const s = this.activeSolid();
    if (h.kind === 'move-x' || h.kind === 'move-z' || h.kind === 'move-xz') {
      if (!inCtx) return this.beginMoveBuilding(b, e, null, h);
      if (this.sel.item) return this.beginMoveItem(b, e, null, h);
      if (s) return this.beginMoveSolids(b, e, null, h);
    }
    if (h.kind === 'move-y') {
      // Green arrow: vertical, along the gizmo line (where it is drawn).
      const at = this.handles.posOf(h).clone();
      if (!inCtx) {
        this.startDrag('lift-building', b, e, { handle: 'move-y', at, e0: b.elevation ?? 0 }, false);
        this.setMeasure('Elevation', (t) => {
          const v = parseLength(t);
          if (v === null) return false;
          return this.change(b.id, (x) => void (x.elevation = Math.abs(v) < 1e-6 ? undefined : v), `Elevation ${fmt(v)} m.`, false);
        });
        return;
      }
      if (s && !this.sel.item) {
        this.startDrag('lift', b, e, { handle: 'move-y', at, h0: s.height, b0: s.base, sid: s.id }, true);
        this.preview.add(b.id);
        this.setMeasure('Base elevation', (t) => {
          const v = parseLength(t);
          if (v === null) return false;
          // What rests on it goes along, the floors follow (model/relations.ts, in the store).
          return this.change(b.id, (x) => void (findSolid(x, s.id)!.base = v), `Base ${fmt(v)} m.`);
        });
      }
      return;
    }
    if (h.kind === 'size') {
      const ids = inCtx ? (s ? [s.id] : []) : b.solids.filter((x) => x.op === 'add').map((x) => x.id);
      if (!ids.length) return;
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const id of ids)
        for (const v of findSolid(b, id)!.plan.outer) {
          x0 = Math.min(x0, v.p[0]);
          x1 = Math.max(x1, v.p[0]);
          z0 = Math.min(z0, v.p[1]);
          z1 = Math.max(z1, v.p[1]);
        }
      const all = !inCtx;
      // The handle sits on the real box (overhang, balconies); the size is of the plan. How far the
      // grabbed point is outside the plan edge is discounted in the drag: the first move does not jump.
      const p0 = this.view.onPlane(e, h.at.y);
      const l0 = p0 ? toLocal(b, [p0.x, p0.z]) : null;
      const grab: Vec2 = l0 ? [h.sx ? l0[0] - (h.sx > 0 ? x1 : x0) : 0, h.sz ? l0[1] - (h.sz > 0 ? z1 : z0) : 0] : [0, 0];
      this.startDrag('size', b, e, { handle: 'size', sx: h.sx, sz: h.sz, box: [x0, x1, z0, z1], y: h.at.y, ids, all, grab }, true);
      this.preview.add(b.id);
      this.setMeasure(h.sx && h.sz ? 'Size' : h.sx ? 'Width' : 'Depth', (t) => {
        const m = /^\s*([\d.,]+)\s*(?:[x*;\s]\s*([\d.,]+))?\s*$/.exec(t);
        if (!m) return false;
        const a = parseFloat(m[1]!.replace(',', '.')),
          c = m[2] ? parseFloat(m[2].replace(',', '.')) : NaN;
        const W0 = x1 - x0,
          D0 = z1 - z0;
        const wantW = h.sx ? a : W0,
          wantD = h.sz ? (h.sx ? (Number.isFinite(c) ? c : (a / W0) * D0) : a) : D0;
        return this.change(b.id, (x) => this.applySize(x, ids, [x0, x1, z0, z1], h.sx ?? 0, h.sz ?? 0, wantW / W0, wantD / D0, all), `Size ${fmt(wantW)} × ${fmt(wantD)} m.`);
      });
      return;
    }
    if (h.kind === 'rotate') {
      const c = h.ring ? ringCenter(h.ring) : h.at;
      this.startDrag('rotate', b, e, { handle: 'rotate', center: c, a0: this.angleAt(e, c), copy: e.ctrlKey, inCtx }, inCtx);
      this.setMeasure('Angle', (t) => {
        const v = parseLength(t);
        if (v === null) return false;
        this.applyRotation(v, this.drag?.origBuilding ?? structuredClone(b));
        return true;
      });
      return;
    }
    if (h.pathPt !== undefined) {
      const it = this.activeItem();
      if (!it || it.host.kind !== 'path') return;
      // Alt+click on a point removes it (a path keeps at least two).
      if (e.altKey && !h.pathMid) {
        if (it.host.points.length <= 2) return this.toast('A path keeps at least two points.');
        const i = h.pathPt;
        this.change(b.id, (x) => {
          const y = x.items.find((q) => q.id === it.id);
          if (y?.host.kind === 'path') y.host.points.splice(i, 1);
        }, 'Point removed.');
        return;
      }
      let index = h.pathPt;
      if (h.pathMid) {
        // The new point first, then it is the one dragged.
        const ps = it.host.points;
        const a = ps[index]!,
          c2 = ps[(index + 1) % ps.length]!;
        ps.splice(index + 1, 0, [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2, (a[2] + c2[2]) / 2]);
        index += 1;
        this.store.touch([b.id]);
      }
      this.startDrag('pathpt', b, e, { handle: 'vertex', id: it.id, index }, true);
      return;
    }
    if (h.kind === 'pscale') {
      const it = this.activeItem();
      const t = it && typeById(it.type, this.project);
      const fam = t && family(t.family);
      const pl = it && this.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
      if (!it || !t || !fam || !pl) return;
      const p = resolveParams(fam, t.params, it.params);
      const keys = dimParams(pl.family, pl.params).map((d) => ({ key: d.key, v0: Number(p[d.key] ?? 1), min: d.min, max: d.max }));
      const bx = partBox(pl.family, pl.params, pl.length);
      const diag = bx ? Math.hypot(bx.max[0] - bx.min[0], bx.max[1] - bx.min[1], bx.max[2] - bx.min[2]) : 1;
      this.startDrag('pscale', b, e, { handle: 'pscale', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, keys, diag: Math.max(0.2, diag) }, true);
      this.setMeasure('Scale (×)', (txt) => {
        const r = evalExpr(txt.replace(/x$/i, ''));
        if (r === null || r <= 0) return false;
        return this.change(b.id, (x) => {
          const y = x.items.find((q) => q.id === it.id)!;
          for (const k of keys) y.params[k.key] = Math.round(Math.max(k.min, Math.min(k.max, k.v0 * r)) * 1000) / 1000;
        }, `Scaled ×${fmt(r)}.`);
      });
      return;
    }
    if (h.kind === 'pmove' && h.pmove !== undefined) {
      const it = this.activeItem();
      if (!it) return;
      this.startDrag('pmove', b, e, { handle: 'pmove', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, axis: h.pmove, host0: structuredClone(it.host) }, true);
      return;
    }
    if (h.kind === 'pdim' && h.param && h.rule && h.solid) {
      const pr = h.param,
        ru = h.rule,
        sid = h.solid;
      const write = (x: Building3, v: number) => {
        const rule = findSolid(x, sid)?.facade.find((f) => f.id === ru.id);
        if (!rule) return;
        rule.sizes ??= {};
        (rule.sizes[ru.pos] ??= {})[pr.key] = Math.round(v * 1000) / 1000;
      };
      this.startDrag('pdim', b, e, { handle: 'pdim', at: h.at.clone(), dir: h.dir!.clone(), key: pr.key, slope: pr.slope, v0: ru.v0, min: pr.min, max: pr.max, label: pr.label, write }, true);
      this.setMeasure(pr.label, (txt) => {
        const v = parseLength(txt);
        if (v === null || v <= 0) return false;
        const w = Math.max(pr.min, Math.min(pr.max, v));
        return this.change(b.id, (x) => write(x, w), `${pr.label} ${fmt(w)} m at this position only (Back to rule undoes).`);
      });
      return;
    }
    if (h.kind === 'pdim' && h.param) {
      const it = this.activeItem();
      const t = it && typeById(it.type, this.project);
      const fam = t && family(t.family);
      if (!it || !t || !fam) return;
      const pr = h.param;
      const v0 = Number(resolveParams(fam, t.params, it.params)[pr.key] ?? 1);
      // Each side's share: the dragged side and the opposite one (eval/partsize.ts, up/down).
      const sDrag = pr.side === -1 ? (pr.down ?? 0) : (pr.up ?? pr.slope),
        sOpp = pr.side === -1 ? (pr.up ?? 0) : (pr.down ?? 0);
      // The part's own axis in the building frame, to slide it by what the opposite side would move.
      const pl = this.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
      const F = pl ? new THREE.Matrix4().fromArray(pl.frame) : new THREE.Matrix4();
      const ax = new THREE.Vector3(pr.axis === 0 ? 1 : 0, pr.axis === 1 ? 1 : 0, pr.axis === 2 ? 1 : 0).transformDirection(F).multiplyScalar(pr.side ?? 1);
      this.startDrag('pdim', b, e, { handle: 'pdim', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, key: pr.key, slope: Math.max(0.05, sDrag + sOpp), sOpp, v0, min: pr.min, max: pr.max, label: pr.label, axis: pr.axis, side: pr.side ?? 1, ax, host0: structuredClone(it.host) }, true);
      this.setMeasure(pr.label, (txt) => {
        const v = parseLength(txt);
        if (v === null || v <= 0) return false;
        const w = Math.max(pr.min, Math.min(pr.max, v));
        return this.change(b.id, (x) => void (x.items.find((q) => q.id === it.id)!.params[pr.key] = w), `${pr.label} ${fmt(w)} m.`);
      });
      return;
    }
    if (h.kind === 'cwidth' || h.kind === 'cheight' || h.kind === 'csill') {
      const it = this.activeItem();
      if (!it || it.host.kind !== 'face') return;
      const t = typeById(it.type, this.project);
      const fam = t && family(t.family);
      if (!t || !fam) return;
      const p = resolveParams(fam, t.params, it.params);
      this.startDrag(h.kind, b, e, { handle: h.kind, at: h.at.clone(), dir: h.dir!.clone(), id: it.id, w0: Number(p.width ?? 1), h0: Number(p.height ?? 1), y0: it.host.y }, true);
      const label = h.kind === 'cwidth' ? 'Width' : h.kind === 'cheight' ? 'Height' : 'Sill';
      this.setMeasure(label, (txt) => {
        let v = parseLength(txt);
        if (v === null || v <= 0) return false;
        // Width and height within the parameter limits (the message says what took effect).
        const pk = h.kind === 'cwidth' ? 'width' : h.kind === 'cheight' ? 'height' : null;
        const pd = pk ? fam.params.find((q) => q.key === pk) : undefined;
        if (pd) v = Math.max(pd.min ?? 0.3, Math.min(pd.max ?? Infinity, v));
        return this.change(b.id, (x) => {
          const y = x.items.find((q) => q.id === it.id)!;
          if (h.kind === 'cwidth') y.params.width = v;
          else if (h.kind === 'cheight') y.params.height = v;
          else if (y.host.kind === 'face') {
            const lv = this.levelBelow(x, y);
            y.host.y = lv + v;
          }
        }, `${label} ${fmt(v)} m.`);
      });
      return;
    }
    if (!s) return;
    const M = this.view.buildingMatrix(b);
    // Ctrl + face arrow: extrude (new volume), like Ctrl with SketchUp Push/Pull.
    if ((h.kind === 'push' && h.edge) || (h.kind === 'height' && this.sel.face?.kind === 'top')) {
      if (e.ctrlKey || this.tool === 'extrude') {
        const side = h.kind === 'push';
        this.startDrag(side ? 'extrude-side' : 'extrude-top', b, e, { handle: h.kind, at: h.at.clone(), dir: h.dir!.clone(), edge: h.edge, sid: s.id }, true);
        this.preview.add(b.id);
        this.setMeasure(side ? 'Extrude' : 'Extrude top', (t) => {
          const v = parseLength(t);
          if (v === null || v === 0) return false;
          this.modelOp(side ? 'extrude' : 'inset-top', side ? { depth: v } : { inset: 0, depth: v });
          return true;
        });
        return;
      }
    }
    if (h.kind === 'height' || h.kind === 'lift') {
      this.startDrag(h.kind, b, e, { handle: h.kind, at: h.at.clone(), h0: s.height, b0: s.base, sid: s.id }, true);
      this.preview.add(b.id);
      this.setMeasure(h.kind === 'height' ? 'Height (or 5f)' : 'Base elevation', (t) => {
        const nf = h.kind === 'height' ? parseFloors(t) : null;
        const v = nf !== null ? floorsHeight(b, s.base, nf) : parseLength(t);
        if (v === null || v <= 0) return false;
        this.change(b.id, (x) => {
          const y = findSolid(x, s.id)!;
          if (h.kind === 'height') y.height = v;
          else y.base = v;
        }, h.kind === 'height' ? `Height ${fmt(v)} m.` : `Base ${fmt(v)} m.`);
        return true;
      });
      return;
    }
    if (h.kind === 'push' && h.hosted) {
      const hf = hostedFrame(s);
      if (!hf) return;
      this.startDrag('side-depth', b, e, { handle: 'push', at: h.at.clone(), dir: h.dir!.clone(), d0: hf.depth, sid: s.id }, true);
      this.preview.add(b.id);
      this.setMeasure('Depth', (t) => {
        const v = parseLength(t);
        if (v === null || Math.abs(v) < 0.05) return false;
        return this.change(b.id, (x) => setSideDepth(findSolid(x, s.id)!, v, x.solids.find((y) => y.id === s.host?.solid)) || false, v > 0 ? `Projection ${fmt(v)} m.` : `Niche ${fmt(-v)} m deep.`);
      });
      return;
    }
    if (h.kind === 'push') {
      const plan0 = structuredClone(s.plan);
      this.startDrag('push', b, e, { handle: 'push', at: h.at.clone(), dir: h.dir!.clone(), edge: h.edge, sid: s.id, plan: structuredClone(s.plan) }, true);
      this.preview.add(b.id);
      // The typed value is the whole distance from where the face was when the push began (SketchUp
      // Push/Pull): after dragging 3 m, typing 5 leaves the face 5 m out, not 8.
      this.setMeasure('Distance', (t) => {
        const v = parseLength(t);
        if (v === null) return false;
        const last = (this.lastPush ?? 0) >= 0 ? 1 : -1;
        return this.change(b.id, (x) => pushEdge(findSolid(x, s.id)!, h.edge!, v * last, plan0) || false, `Face moved ${fmt(v)} m.`);
      });
      return;
    }
    if (h.kind === 'twist') {
      const pc = planCenter(s);
      const c = new THREE.Vector3(pc[0], 0, pc[1]).applyMatrix4(M);
      c.y = h.at.y;
      this.startDrag('twist', b, e, { handle: 'twist', c, y: h.at.y, t0: s.twist ?? 0, sid: s.id }, true);
      this.setMeasure('Twist', (txt) => {
        const v = parseFloat(txt.replace(',', '.'));
        if (!Number.isFinite(v) || Math.abs(v) > 360) return false;
        return this.changeSolid((x) => {
          if (Math.abs(v) > 0.01) x.twist = v;
          else delete x.twist;
        }, `Twist ${fmt(v)}°.`);
      });
      return;
    }
    if (h.kind === 'vertex' || h.kind === 'bend') {
      const y = h.at.y;
      this.startDrag(h.kind, b, e, { handle: h.kind, y, vertex: h.vertex, edge: h.edge, sid: s.id, M }, true);
      this.preview.add(b.id);
      if (h.kind === 'bend') this.setMeasure('Bulge', (t) => {
        const v = parseLength(t);
        if (v === null) return false;
        this.change(b.id, (x) => {
          const so = findSolid(x, s.id)!;
          const n = edgeNormal(so, h.edge!)!;
          const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.some((q) => q.id === h.edge))!;
          const k = ring.findIndex((q) => q.id === h.edge);
          const m = midOf(ring[k]!, ring[(k + 1) % ring.length]!, true);
          return bendEdge(so, h.edge!, [m[0] + n[0] * v, m[1] + n[1] * v]);
        }, 'Side bent.');
        return true;
      });
    }
  }

  private lastPush: number | null = null;

  private beginMoveBuilding(b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
    // Through a gizmo handle, the drag runs on the horizontal plane through it (TransformControls):
    // the building follows the cursor. Through the building body, on the ground, as before.
    const planeY = h ? h.at.y : 0;
    const p0 = this.view.onPlane(e, planeY) ?? new THREE.Vector3(b.position[0], 0, b.position[1]);
    // The other selected buildings move along (each from its starting position).
    const others = this.sel.building === b.id ? this.sel.others.flatMap((id) => {
      const o = this.store.building(id);
      return o ? [[id, [...o.position]] as [ID, number[]]] : [];
    }) : [];
    this.startDrag('move-building', b, e, { handle: h?.kind ?? 'move-xz', p0, axis: h?.dir?.clone() ?? null, copy: e.ctrlKey, hitY: hit?.point.y ?? 0, others, y: planeY }, false);
    this.setMoveMeasure();
  }

  private beginMoveSolids(b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
    const s = this.activeSolid()!;
    const p0 = this.view.onPlane(e, s.base) ?? new THREE.Vector3();
    this.startDrag('move-solids', b, e, { handle: h?.kind ?? 'move-xz', p0, axis: h?.dir?.clone() ?? null, copy: e.ctrlKey, ids: [...this.sel.solids], y: s.base }, true);
    void hit;
    this.preview.add(b.id);
    this.setMoveMeasure();
  }

  private beginMoveItem(b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
    const it = this.activeItem();
    if (!it) return;
    void hit;
    // Real height of the part (on a roof, that of its surface): the drag runs at that height.
    const pl = this.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id);
    const y0 = pl ? pl.frame[13]! : it.host.kind === 'free' ? it.host.p[1] : 0;
    // On a face: the drag runs on the plane of the face itself, from the grabbed point (the part
    // covers the wall where it is held, so it cannot rely on hitting the wall under the cursor).
    let face: Record<string, unknown> | null = null;
    if (it.host.kind === 'face' && pl) {
      const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(this.view.buildingMatrix(b));
      const n = new THREE.Vector3().setFromMatrixColumn(F, 2).normalize();
      const o = new THREE.Vector3().setFromMatrixPosition(F);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
      const p0 = this.view.rayFrom(e).ray.intersectPlane(plane, new THREE.Vector3());
      const s = findSolid(b, it.host.solid);
      const [w, hh] = pl.family.size(pl.params);
      if (p0 && s) face = { plane, p0, ux: new THREE.Vector3().setFromMatrixColumn(F, 0).normalize().negate(), vy: new THREE.Vector3().setFromMatrixColumn(F, 1).normalize(), u0: it.host.u, yf0: it.host.y, len: edgeLength(s, it.host.edge), w, h: hh, top: s.height };
    }
    this.startDrag('move-item', b, e, { handle: h?.kind ?? 'move-xz', axis: h?.dir?.clone() ?? null, at: h?.at.clone() ?? null, id: it.id, y0, face }, true);
  }

  private setMoveMeasure(): void {
    this.setMeasure('Distance (or dx;dz)', (t) => {
      const m = /^(\d+)\s*([x*/])$/.exec(t.trim());
      if (m) return this.arrayLast(parseInt(m[1]!, 10), m[2] === '/');
      // "dx;dz": the move by those amounts in the world (east, south), whatever the drag was.
      const off = parseOffset(t);
      if (off && this.lastMove) {
        this.applyMoveDelta(new THREE.Vector3(off[0], 0, off[1]), true);
        return true;
      }
      const v = parseLength(t);
      if (v === null || !this.lastMove) return false;
      const d = this.lastMove.clone().normalize().multiplyScalar(v);
      this.applyMoveDelta(d, true);
      return true;
    });
  }

  private lastMove: THREE.Vector3 | null = null;
  private lastMoved: { kind: 'building' | 'solids'; bid: ID; ids: ID[]; delta: THREE.Vector3; copied: boolean } | null = null;

  /** Serial copies after moving with Ctrl (5x) or division (5/), like SketchUp. */
  private arrayLast(n: number, divide: boolean): boolean {
    const lm = this.lastMoved;
    if (!lm || !lm.copied || n < 2) {
      this.toast('Move with Ctrl (copy) and then type 5x.');
      return false;
    }
    const step = divide ? lm.delta.clone().divideScalar(n) : lm.delta.clone();
    if (lm.kind === 'building') {
      const src = this.store.building(lm.bid);
      if (!src) return false;
      if (divide) {
        src.position = [src.position[0] - lm.delta.x + step.x, src.position[1] - lm.delta.z + step.z];
      }
      for (let i = 1; i < n; i++) {
        const c = cloneBuilding(src);
        c.position = [src.position[0] + step.x * i, src.position[1] + step.z * i];
        this.store.project.buildings.push(c);
      }
      this.store.commit(null, `${n} copies.`);
      this.toast(`${divide ? n : n} copies.`);
      return true;
    }
    return this.change(lm.bid, (b) => {
      const local = dirToLocal(b, [step.x, step.z]);
      for (const sid of lm.ids) {
        const src = findSolid(b, sid);
        if (!src) continue;
        if (divide) translateSolid(src, -dirToLocal(b, [lm.delta.x, lm.delta.z])[0] + local[0], -dirToLocal(b, [lm.delta.x, lm.delta.z])[1] + local[1]);
        for (let i = 1; i < n; i++) {
          const c = cloneSolid(src);
          translateSolid(c, local[0] * i, local[1] * i);
          b.solids.push(c);
        }
      }
    }, `${n} copies.`);
  }

  private angleAt(e: { clientX: number; clientY: number }, c: THREE.Vector3): number {
    const p = this.view.onPlane(e, c.y);
    return p ? Math.atan2(-(p.z - c.z), p.x - c.x) : 0;
  }

  private applyRotation(deg: number, orig: Building3): void {
    const d = this.drag;
    const b = this.store.building(orig.id);
    if (!b) return;
    if (!d || !(d.data.inCtx as boolean)) {
      // Whole building: rotates around the center of its volumes.
      const c = (d?.data.center as THREE.Vector3) ?? new THREE.Vector3(b.position[0], 0, b.position[1]);
      const a = rad(deg);
      const ox = orig.position[0] - c.x,
        oz = orig.position[1] - c.z;
      b.position = [c.x + ox * Math.cos(a) + oz * Math.sin(a), c.z - ox * Math.sin(a) + oz * Math.cos(a)];
      b.rotation = (((orig.rotation + deg) % 360) + 360) % 360;
      if (!d) this.store.commit([b.id], `Rotated ${fmt(deg)}°.`, false);
      else this.store.touch([]);
      return;
    }
    if (this.sel.item) {
      const it = b.items.find((i) => i.id === this.sel.item);
      const io = orig.items.find((i) => i.id === this.sel.item);
      if (it && io && (it.host.kind === 'free' || it.host.kind === 'roof') && (io.host.kind === 'free' || io.host.kind === 'roof')) it.host.rot = io.host.rot + deg;
      return;
    }
    const c = (d.data.center as THREE.Vector3).clone();
    const cl = toLocal(b, [c.x, c.z]);
    for (const sid of this.sel.solids) {
      const so = findSolid(orig, sid),
        s = findSolid(b, sid);
      if (!so || !s) continue;
      s.plan = structuredClone(so.plan);
      rotateSolid(s, deg, cl);
    }
  }

  private updateDrag(e: PointerEvent): void {
    const d = this.drag!;
    if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
    if (!d.moved && d.data.copy) this.makeDragCopy();
    // The dimension labels would show the old sizes for the whole drag: they go (the live label says the
    // value) and come back with the result.
    if (!d.moved) this.drawSelDims();
    d.moved = true;
    const b = this.store.building(d.bid);
    if (!b) return;
    const orig = d.origBuilding;
    if (d.kind === 'size') {
      const p = this.view.onPlane(e, d.data.y as number);
      if (!p) return;
      const [x0, x1, z0, z1] = d.data.box as number[];
      const grab = (d.data.grab as Vec2 | undefined) ?? [0, 0];
      const l0 = toLocal(b, [p.x, p.z]);
      const l: Vec2 = [l0[0] - grab[0], l0[1] - grab[1]];
      const g = !e.altKey && this.infer.enabled ? this.infer.grid : 0;
      const q = (v: number) => (g ? Math.round(v / g) * g : v);
      const sx = d.data.sx as number,
        sz = d.data.sz as number;
      const W0 = x1! - x0!,
        D0 = z1! - z0!;
      let w = sx > 0 ? q(l[0] - x0!) : sx < 0 ? q(x1! - l[0]) : W0;
      let dd = sz > 0 ? q(l[1] - z0!) : sz < 0 ? q(z1! - l[1]) : D0;
      w = Math.max(0.3, w);
      dd = Math.max(0.3, dd);
      let fx = w / W0,
        fz = dd / D0;
      if (e.shiftKey && sx && sz) fx = fz = Math.max(fx, fz);
      b.solids = structuredClone(orig.solids);
      b.items = structuredClone(orig.items);
      if (this.applySize(b, d.data.ids as ID[], [x0!, x1!, z0!, z1!], sx, sz, fx, fz, !!d.data.all)) this.store.touch([b.id]);
      this.showDim(`${fmt(W0 * fx)} × ${fmt(D0 * fz)} m`, e);
      this.drawSelection();
      return;
    }
    if (d.kind === 'move-building' || d.kind === 'move-solids') {
      const y = (d.data.y as number | undefined) ?? 0;
      const p0 = d.data.p0 as THREE.Vector3;
      const axis = d.data.axis as THREE.Vector3 | null;
      const snap = this.infer.snap(e, y, p0, axis, 12);
      if (!snap) return;
      this.showSnap(snap, e);
      const delta = snap.p.clone().sub(p0).setY(0);
      // Block snapping: a vertex of what moves sticks to a vertex or to an
      // edge of another volume (faces touching perfectly).
      if (this.infer.enabled && !e.altKey) {
        const fix = this.blockSnap(d, delta, this.view.worldPerPixel(p0) * 14);
        if (fix) {
          delta.add(fix.v);
          this.showSnap({ kind: fix.kind, p: fix.at, label: fix.kind === 'vertex' ? 'Snapped to vertex' : 'Face against face', color: SNAP_COLORS[fix.kind] }, e);
        }
        // Contact snapping (SketchUp/Fusion): a building moved next to another lines up with its middle
        // or its edges along the side they share, within a few pixels.
        if (d.kind === 'move-building') {
          const mb = this.worldBox(orig);
          if (mb) {
            const tol = this.view.worldPerPixel(p0) * 10;
            const moved = mb.clone().translate(delta);
            let best: { axis: 'x' | 'z'; v: number; label: string } | null = null;
            for (const o of this.project.buildings) {
              if (o.id === b.id || buildingHidden(this.project, o)) continue;
              const ob = this.worldBox(o);
              if (!ob) continue;
              // Only a neighbour across a side (close in the other axis) counts.
              const nearX = moved.min.x - ob.max.x < tol * 3 && ob.min.x - moved.max.x < tol * 3;
              const nearZ = moved.min.z - ob.max.z < tol * 3 && ob.min.z - moved.max.z < tol * 3;
              for (const axis of ['x', 'z'] as const) {
                if (!(axis === 'x' ? nearZ : nearX)) continue;
                const pairs: [number, number, string][] = [
                  [(moved.min[axis] + moved.max[axis]) / 2, (ob.min[axis] + ob.max[axis]) / 2, `Centered on ${o.name}`],
                  [moved.min[axis], ob.min[axis], `Aligned with ${o.name}`],
                  [moved.max[axis], ob.max[axis], `Aligned with ${o.name}`],
                ];
                for (const [m, t, label] of pairs) if (Math.abs(t - m) < tol && (!best || Math.abs(t - m) < Math.abs(best.v))) best = { axis, v: t - m, label };
              }
            }
            if (best) {
              if (best.axis === 'x') delta.x += best.v;
              else delta.z += best.v;
              this.showSnap({ kind: 'edge', p: snap.p.clone().add(new THREE.Vector3(best.axis === 'x' ? best.v : 0, 0, best.axis === 'z' ? best.v : 0)), label: best.label, color: SNAP_COLORS.edge }, e);
            }
          }
        }
      }
      this.applyMoveDelta(delta, false);
      this.showDim(`${fmt(delta.length())} m`, e);
      return;
    }
    if (d.kind === 'move-item') {
      const it = b.items.find((i) => i.id === d.data.id),
        io = orig.items.find((i) => i.id === d.data.id);
      if (!it || !io) return;
      if (it.host.kind === 'face' && io.host.kind === 'face' && d.data.face) {
        // On the face plane: offset from the grabbed point, within the face limits.
        const f = d.data.face as { plane: THREE.Plane; p0: THREE.Vector3; ux: THREE.Vector3; vy: THREE.Vector3; u0: number; yf0: number; len: number; w: number; h: number; top: number };
        const p = this.view.rayFrom(e).ray.intersectPlane(f.plane, new THREE.Vector3());
        if (!p) return;
        p.sub(f.p0);
        let du = p.dot(f.ux),
          dv = p.dot(f.vy);
        if (this.infer.enabled && !e.altKey) {
          // Axis inference (SketchUp): a clearly horizontal move does not change the height, and vice versa.
          if (Math.abs(dv) < 0.3 && Math.abs(du) > 3 * Math.abs(dv)) dv = 0;
          else if (Math.abs(du) < 0.3 && Math.abs(dv) > 3 * Math.abs(du)) du = 0;
        }
        let u = f.u0 + du,
          y = f.yf0 + dv;
        if (this.infer.enabled && !e.altKey) {
          if (du) u = Math.round(u / 0.1) * 0.1;
          if (dv) y = Math.round(y / 0.05) * 0.05;
        }
        it.host.u = f.len > f.w ? Math.max(f.w / 2, Math.min(f.len - f.w / 2, u)) : f.len / 2;
        it.host.y = Math.max(0, Math.min(Math.max(0, f.top - f.h), y));
        this.store.touch([b.id]);
        this.showDim(`${fmt(it.host.u)} m along · ${fmt(it.host.y)} m high`, e);
        return;
      }
      if (it.host.kind === 'face' && io.host.kind === 'face') {
        // Drags along the face: projects onto the face plane.
        const hit = this.pickAt(e, b.id);
        if (hit?.face?.kind === 'side' && hit.face.solid === io.host.solid && hit.face.edge === io.host.edge && hit.face.frame) {
          const local = new THREE.Vector3().copy(hit.point).applyMatrix4(this.view.buildingMatrix(b).invert());
          const fr = hit.face.frame;
          const s = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.y - fr.o[1]) * fr.u[1] + (local.z - fr.o[2]) * fr.u[2];
          const fam = family(typeById(io.type, this.project)?.family ?? '');
          const h = fam ? fam.size(resolveParams(fam, typeById(io.type, this.project)?.params, io.params))[1] : 1;
          let yy = (local.x - fr.o[0]) * fr.v[0] + (local.y - fr.o[1]) * fr.v[1] + (local.z - fr.o[2]) * fr.v[2] - h / 2;
          if (this.infer.enabled) yy = Math.round(yy / 0.05) * 0.05;
          it.host.u = this.infer.enabled ? Math.round(s / 0.1) * 0.1 : s;
          it.host.y = Math.max(0, yy);
          this.store.touch([b.id]);
          this.showDim(`${fmt(it.host.u)} m · ${fmt(it.host.y)} m`, e);
        }
        return;
      }
      if (it.host.kind === 'roof' && io.host.kind === 'roof') {
        // A roof part slides on the roof: what is under the cursor, or
        // the plane at its height held to the roof edge (it never falls to the ground).
        const axis = d.data.axis as THREE.Vector3 | null;
        let sid = io.host.solid;
        let local: Vec2 | null = null;
        if (axis && d.data.at) {
          let t = this.dragAlong(d, e, d.data.at as THREE.Vector3, axis);
          if (this.infer.enabled && !e.altKey) t = Math.round(t / 0.1) * 0.1;
          const dl = dirToLocal(b, [axis.x, axis.z]);
          local = [io.host.p[0] + dl[0] * t, io.host.p[1] + dl[1] * t];
        } else {
          const hit = this.pickAt(e, b.id);
          const hs = hit?.face && (hit.face.kind === 'roof' || hit.face.kind === 'top') ? findSolid(b, hit.face.solid) : undefined;
          if (hit && hs && hs.op === 'add') {
            sid = hs.id;
            local = toLocal(b, [hit.point.x, hit.point.z]);
          } else {
            const p = this.view.onPlane(e, d.data.y0 as number);
            if (p) local = toLocal(b, [p.x, p.z]);
          }
          if (local && this.infer.enabled && !e.altKey) local = [Math.round(local[0] / 0.1) * 0.1, Math.round(local[1] / 0.1) * 0.1];
        }
        const host = findSolid(b, sid);
        if (!local || !host) return;
        it.host.solid = sid;
        it.host.p = clampInside(local, topRing(host), 0.3);
        this.store.touch([b.id]);
        this.showDim('on the roof', e);
        return;
      }
      if (it.host.kind === 'free' && io.host.kind === 'free') {
        const snap = this.infer.snap(e, io.host.kind === 'free' ? io.host.p[1] : 0, null, null);
        if (!snap) return;
        const l = toLocal(b, [snap.p.x, snap.p.z]);
        it.host.p = [l[0], io.host.p[1], l[1]];
        this.store.touch([b.id]);
      }
      // A wall, fence or hedge drawn as a path: the whole path moves by the drag on its plane.
      if (it.host.kind === 'path' && io.host.kind === 'path') {
        const y = io.host.points[0]?.[1] ?? 0;
        const p0 = d.data.p0 as THREE.Vector3 | undefined;
        const p = this.view.onPlane(e, y + (b.elevation ?? 0));
        if (!p) return;
        if (!p0) d.data.p0 = p.clone();
        const s0 = (d.data.p0 as THREE.Vector3) ?? p;
        let dl = dirToLocal(b, [p.x - s0.x, p.z - s0.z]);
        if (this.infer.enabled && !e.altKey) dl = [Math.round(dl[0] / 0.1) * 0.1, Math.round(dl[1] / 0.1) * 0.1];
        it.host.points = io.host.points.map((q) => [q[0] + dl[0], q[1], q[2] + dl[1]] as Vec3);
        this.store.touch([b.id]);
        this.showDim(`${fmt(Math.hypot(dl[0], dl[1]))} m`, e);
      }
      return;
    }
    if (d.kind === 'iwallnode') {
      const it = b.interiors[d.data.level as ID];
      const node = it?.nodes.find((q) => q.id === d.data.node);
      const lv = b.levels.find((l) => l.id === d.data.level);
      if (!node || !lv) return;
      const p = this.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
      if (!p) return;
      let l = toLocal(b, [p.x, p.z]);
      if (this.infer.enabled && !e.altKey) l = [Math.round(l[0] / this.infer.grid) * this.infer.grid, Math.round(l[1] / this.infer.grid) * this.infer.grid];
      node.p = l;
      this.showDim(`${fmt(l[0])}, ${fmt(l[1])}`, e);
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'pathpt') {
      const it = b.items.find((q) => q.id === d.data.id);
      if (!it || it.host.kind !== 'path') return;
      const i = d.data.index as number;
      const y = it.host.points[i]![1];
      const snap = this.infer.snap(e, y + (b.elevation ?? 0), null, null);
      if (!snap) return;
      const l = toLocal(b, [snap.p.x, snap.p.z]);
      it.host.points[i] = [l[0], y, l[1]];
      this.showSnap(snap, e);
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'rotate') {
      const c = d.data.center as THREE.Vector3;
      let deg = ((this.angleAt(e, c) - (d.data.a0 as number)) * 180) / Math.PI;
      if (!e.shiftKey && this.infer.enabled) deg = Math.round(deg / this.rotSnap) * this.rotSnap;
      this.store.project = structuredClone(this.store.project);
      const idx = this.store.project.buildings.findIndex((x) => x.id === d.bid);
      this.store.project.buildings[idx] = structuredClone(orig);
      this.applyRotation(deg, orig);
      if (d.data.inCtx) this.store.touch([d.bid]);
      else this.view.sync(this.store.project, this.store.revision, this.preview);
      this.showDim(`${fmt(deg)}°`, e);
      this.drawSelection();
      return;
    }
    if (d.kind === 'pscale') {
      const it = b.items.find((q) => q.id === d.data.id);
      if (!it) return;
      const t = this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
      let r = Math.max(0.1, 1 + t / (d.data.diag as number));
      if (!e.altKey && this.infer.enabled) r = Math.round(r * 20) / 20;
      for (const k of d.data.keys as { key: string; v0: number; min: number; max: number }[]) it.params[k.key] = Math.round(Math.max(k.min, Math.min(k.max, k.v0 * r)) * 1000) / 1000;
      this.showDim(`×${fmt(r)}`, e);
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'pmove') {
      const it = b.items.find((q) => q.id === d.data.id);
      const h0 = d.data.host0 as Item['host'];
      if (!it) return;
      let t = this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
      if (!e.altKey && this.infer.enabled) t = Math.round(t / 0.05) * 0.05;
      const dir = d.data.dir as THREE.Vector3;
      if (it.host.kind === 'face' && h0.kind === 'face') {
        // Along the wall: the arrow's direction against the part's x (which runs against u).
        if (d.data.axis === 0) {
          const fx = new THREE.Vector3(1, 0, 0);
          const pl = this.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
          if (pl) fx.transformDirection(new THREE.Matrix4().fromArray(pl.frame).premultiply(this.view.buildingMatrix(b)));
          it.host.u = h0.u - Math.sign(dir.dot(fx) || 1) * t;
          this.showDim(`${t >= 0 ? '+' : ''}${fmt(t)} m along the wall`, e);
        } else {
          it.host.y = Math.max(0, h0.y + t);
          this.showDim(`${fmt(it.host.y - this.levelBelow(b, it))} m above the floor`, e);
        }
      } else if (it.host.kind === 'free' && h0.kind === 'free') {
        it.host.p = [h0.p[0], Math.max(0, h0.p[1] + t), h0.p[2]];
        this.showDim(`${fmt(it.host.p[1])} m up`, e);
      }
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'twist') {
      const so = findSolid(b, d.data.sid as ID);
      const p = this.view.onPlane(e, d.data.y as number);
      if (!so || !p) return;
      const c = d.data.c as THREE.Vector3;
      // Counterclockwise seen from above (x right, z toward the viewer): atan2(−dz, dx).
      const ang = (Math.atan2(-(p.z - c.z), p.x - c.x) * 180) / Math.PI;
      if (d.data.a0 === undefined) d.data.a0 = ang;
      let v = (d.data.t0 as number) + ((((ang - (d.data.a0 as number) + 540) % 360) - 180));
      if (!e.altKey) v = Math.round(v / 5) * 5;
      v = Math.max(-360, Math.min(360, v));
      if (Math.abs(v) > 0.01) so.twist = v;
      else delete so.twist;
      this.showDim(`twist ${fmt(v)}°`, e);
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'pdim') {
      const it = d.data.write ? undefined : b.items.find((q) => q.id === d.data.id);
      if (!it && !d.data.write) return;
      const t = this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3) / (d.data.slope as number);
      let v = (d.data.v0 as number) + t;
      if (!e.altKey && this.infer.enabled) v = Math.round(v / 0.05) * 0.05;
      v = Math.max(d.data.min as number, Math.min(d.data.max as number, v));
      if (it) {
        it.params[d.data.key as string] = Math.round(v * 1000) / 1000;
        // The opposite side stays put: slide the part by what that side would have moved.
        const T = ((d.data.sOpp as number | undefined) ?? 0) * (v - (d.data.v0 as number));
        const h0 = d.data.host0 as Item['host'] | undefined;
        const ax = d.data.ax as THREE.Vector3 | undefined;
        if (h0 && ax && Math.abs(T) > 1e-6) {
          if (it.host.kind === 'free' && h0.kind === 'free') it.host.p = [h0.p[0] + ax.x * T, Math.max(0, h0.p[1] + ax.y * T), h0.p[2] + ax.z * T];
          else if (it.host.kind === 'roof' && h0.kind === 'roof') it.host.p = [h0.p[0] + ax.x * T, h0.p[1] + ax.z * T];
          else if (it.host.kind === 'face' && h0.kind === 'face') {
            // On a wall: the part's x runs against the wall's u (eval/facade.ts frame), y is up.
            if (d.data.axis === 0) it.host.u = h0.u - (d.data.side as number) * T;
            if (d.data.axis === 1) it.host.y = Math.max(0, h0.y + (d.data.side as number) * T);
          }
        }
      } else (d.data.write as (x: Building3, v: number) => void)(b, v);
      this.showDim(`${(d.data.label as string).toLowerCase()} ${fmt(v)} m`, e);
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'cwidth' || d.kind === 'cheight' || d.kind === 'csill') {
      const it = b.items.find((q) => q.id === d.data.id);
      if (!it || it.host.kind !== 'face') return;
      let t = this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
      if (!e.altKey && this.infer.enabled) t = Math.round(t / 0.05) * 0.05;
      // Within the family parameter limits: the value shown is the one that takes effect.
      const fam = family(typeById(it.type, this.project)?.family ?? '');
      const lim = (k: string, v: number) => {
        const p = fam?.params.find((q) => q.key === k);
        return Math.max(p?.min ?? 0.3, Math.min(p?.max ?? Infinity, v));
      };
      if (d.kind === 'cwidth') {
        it.params.width = lim('width', (d.data.w0 as number) + 2 * t);
        this.showDim(`width ${fmt(it.params.width as number)} m`, e);
      } else if (d.kind === 'cheight') {
        it.params.height = lim('height', (d.data.h0 as number) + t);
        this.showDim(`height ${fmt(it.params.height as number)} m`, e);
      } else {
        it.host.y = Math.max(0, (d.data.y0 as number) - t);
        this.showDim(`sill ${fmt(it.host.y - this.levelBelow(b, it))} m`, e);
      }
      this.store.touch([b.id]);
      return;
    }
    if (d.kind === 'lift-building') {
      const at = d.data.at as THREE.Vector3;
      const t = this.dragAlong(d, e, at, new THREE.Vector3(0, 1, 0));
      const want = (d.data.e0 as number) + t;
      let v = want;
      let label = '';
      if (!e.altKey && this.infer.enabled) {
        // Snaps to the ground and to the top of buildings whose plan overlaps this one (stack to combine).
        const tol = this.view.worldPerPixel(at) * 14;
        const mine = this.worldBox(orig);
        const cands: [number, string][] = [[0, 'On the ground']];
        for (const o of this.store.project.buildings) {
          if (o.id === b.id) continue;
          const ob = this.worldBox(o);
          if (!mine || !ob || ob.max.x < mine.min.x || ob.min.x > mine.max.x || ob.max.z < mine.min.z || ob.min.z > mine.max.z) continue;
          cands.push([ob.max.y, `On ${o.name}`]);
        }
        const best = cands.reduce<[number, string] | null>((acc, c) => (Math.abs(c[0] - want) < tol && (!acc || Math.abs(c[0] - want) < Math.abs(acc[0] - want)) ? c : acc), null);
        if (best) [v, label] = best;
        else v = Math.round(want / 0.1) * 0.1;
      }
      b.elevation = Math.abs(v) < 1e-6 ? undefined : v;
      this.view.sync(this.store.project, this.store.revision, this.preview);
      this.drawSelection();
      this.showDim(`elevation ${fmt(v)} m${label ? ' · ' + label : ''}`, e);
      return;
    }
    const s = findSolid(b, d.data.sid as ID);
    const so = findSolid(orig, d.data.sid as ID);
    if (!s || !so) return;
    if (d.kind === 'extrude-side' || d.kind === 'extrude-top') {
      let t = this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
      if (!e.altKey && this.infer.enabled) t = Math.round(t / 0.1) * 0.1;
      // Redoes from the original on every step (the new volume is a single one).
      b.solids = structuredClone(orig.solids);
      b.levels = structuredClone(orig.levels);
      const base = findSolid(b, d.data.sid as ID)!;
      // A side dragged inward is pushed in (same as Extrude with a negative depth): the wall keeps its facade.
      const sink = d.kind === 'extrude-side' && t <= -0.05;
      if (sink) pushEdge(base, d.data.edge as ID, t);
      const n = Math.abs(t) < 0.05 || sink ? null : d.kind === 'extrude-side' ? extrudeSide(b, base, d.data.edge as ID, t) : insetTop(b, base, 0, t);
      d.data.created = n?.id;
      this.store.touch([b.id]);
      this.showDim((t >= 0 ? '+' : '') + fmt(t) + ' m' + (t < 0 && !sink ? ' (cutter)' : ''), e);
      return;
    }
    if (d.kind === 'height' || d.kind === 'lift') {
      const at = d.data.at as THREE.Vector3;
      const t = this.dragAlong(d, e, at, new THREE.Vector3(0, 1, 0));
      const tops = b.solids.filter((x) => x.id !== s.id).flatMap((x) => [x.base + x.height, x.base]).concat(b.levels.map((l) => l.elevation), b.levels.map((l) => l.elevation + l.height));
      if (d.kind === 'height') {
        const want = so.base + so.height + t;
        // Floor by floor (as in the previous editor); Alt or snap off: free height.
        const free = e.altKey || !this.infer.enabled;
        // Same height as another top (a volume of this building or another building; Fusion/SketchUp
        // inference): it wins over the floor snap when the pointer is within a few pixels of it.
        let same: { y: number; name: string } | null = null;
        if (!free) {
          const tol = this.view.worldPerPixel(at) * 10;
          const be = b.elevation ?? 0;
          const cands: { y: number; name: string }[] = [
            ...orig.solids.filter((x) => x.id !== s.id && x.op === 'add').map((x) => ({ y: x.base + x.height, name: x.name })),
            ...this.project.buildings.filter((o) => o.id !== b.id && !buildingHidden(this.project, o)).map((o) => ({ y: (o.elevation ?? 0) - be + Math.max(0, ...o.solids.filter((x) => x.op === 'add').map((x) => x.base + x.height)), name: o.name })),
          ];
          for (const c of cands) if (c.y > so.base + 0.3 && Math.abs(c.y - want) < tol && (!same || Math.abs(c.y - want) < Math.abs(same.y - want))) same = c;
        }
        s.height = Math.max(0.3, (same ? same.y : free ? want : snapToFloor(orig, so.base, want)) - so.base);
        // The floors follow (they go up with the volume and go away when nothing reaches them) and what
        // rests on it goes along: the store keeps the relations on every move (model/relations.ts).
        this.store.touch([b.id]);
        const n = floorsIn(b, s);
        this.showDim(`${fmt(s.height)} m · ${n} ${n === 1 ? 'floor' : 'floors'}${same ? ` · same height as ${same.name}` : ''}`, e);
        void tops;
        return;
      }
      const want = so.base + t;
      const sn = e.altKey ? { value: want, snapped: false } : this.infer.snapHeight(want, tops, 0.3);
      s.base = sn.value;
      this.store.touch([b.id]);
      this.showDim(`base ${fmt(s.base)} m`, e);
      return;
    }
    if (d.kind === 'side-depth') {
      let depth = (d.data.d0 as number) + this.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
      if (!e.altKey && this.infer.enabled) depth = Math.round(depth / 0.1) * 0.1;
      // At the wall it is neither: it keeps the last side until the pointer goes through.
      if (Math.abs(depth) < 0.05) return;
      Object.assign(s, structuredClone(so));
      if (setSideDepth(s, depth, b.solids.find((y) => y.id === so.host?.solid))) this.store.touch([b.id]);
      this.showDim(depth > 0 ? `projection ${fmt(depth)} m` : `niche ${fmt(-depth)} m`, e);
      return;
    }
    if (d.kind === 'push') {
      const at = d.data.at as THREE.Vector3,
        dir = d.data.dir as THREE.Vector3;
      let t = this.dragAlong(d, e, at, dir);
      if (!e.altKey && this.infer.enabled) t = Math.round(t / 0.1) * 0.1;
      s.plan = structuredClone(so.plan);
      if (pushEdge(s, d.data.edge as ID, t)) {
        this.lastPush = t;
        this.store.touch([b.id]);
      }
      this.showDim(`${t >= 0 ? '+' : ''}${fmt(t)} m`, e);
      return;
    }
    if (d.kind === 'vertex' || d.kind === 'bend') {
      const snap = this.infer.snap(e, d.data.y as number, null, null);
      if (!snap) return;
      this.showSnap(snap, e);
      let l = toLocal(b, [snap.p.x, snap.p.z]);
      s.plan = structuredClone(so.plan);
      if (d.kind === 'bend' && !e.altKey) {
        // Curving a wall snaps to straight and to a half circle (Alt: free), like Estúdio de Construção.
        const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.some((v) => v.id === d.data.edge));
        const i = ring ? ring.findIndex((v) => v.id === d.data.edge) : -1;
        if (ring && i >= 0) {
          const a = ring[i]!.p,
            c = ring[(i + 1) % ring.length]!.p;
          const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
          const m: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
          const n: Vec2 = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L];
          const sag = (l[0] - m[0]) * n[0] + (l[1] - m[1]) * n[1];
          const tol = this.view.worldPerPixel(snap.p) * 12;
          const to = Math.abs(sag) < tol ? 0 : Math.abs(Math.abs(sag) - L / 2) < tol ? Math.sign(sag) * (L / 2) : null;
          if (to !== null) {
            l = [m[0] + n[0] * to, m[1] + n[1] * to];
            this.showDim(to === 0 ? 'Straight' : 'Half circle', e);
          } else this.showDim(`bulge ${fmt(Math.abs(sag))} m`, e);
        }
      }
      const ok = d.kind === 'vertex' ? moveVertex(s, d.data.vertex as ID, l) : bendEdge(s, d.data.edge as ID, l);
      if (ok) this.store.touch([b.id]);
      this.drawSelection();
    }
  }

  /**
   * Scales the volume plans by the box, with the side opposite to the handle
   * fixed (anchor). On the whole building, the free parts follow.
   */
  private applySize(b: Building3, ids: ID[], box: number[], sx: number, sz: number, fx: number, fz: number, all: boolean): boolean {
    const [x0, x1, z0, z1] = box as [number, number, number, number];
    const ax = sx > 0 ? x0 : sx < 0 ? x1 : (x0 + x1) / 2;
    const az = sz > 0 ? z0 : sz < 0 ? z1 : (z0 + z1) / 2;
    const k = Math.min(fx, fz);
    const map = (p: Vec2): Vec2 => [ax + (p[0] - ax) * fx, az + (p[1] - az) * fz];
    for (const id of ids) {
      const s = findSolid(b, id);
      if (!s) continue;
      const before = structuredClone(s.plan);
      for (const ring of [s.plan.outer, ...s.plan.holes])
        for (const v of ring) {
          v.p = map(v.p);
          if (v.round) v.round *= k;
          if (v.chamfer) v.chamfer *= k;
        }
      if (!planValidOps(s.plan)) {
        s.plan = before;
        return false;
      }
    }
    if (all)
      for (const it of b.items) {
        if (it.host.kind === 'free') {
          const q = map([it.host.p[0], it.host.p[2]]);
          it.host.p = [q[0], it.host.p[1], q[1]];
        } else if (it.host.kind === 'roof') it.host.p = map(it.host.p);
      }
    return true;
  }

  /** Floor elevation of the storey under a face part (relative to the solid base). */
  levelBelow(b: Building3, it: Item): number {
    if (it.host.kind !== 'face') return 0;
    const s = findSolid(b, it.host.solid);
    const base = s?.base ?? 0;
    const y = base + it.host.y + 0.01;
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation <= y).pop();
    return (lv?.elevation ?? base) - base;
  }

  /** Offset correction to snap vertices of what moves onto vertices/edges of the others. */
  private blockSnap(d: Drag, delta: THREE.Vector3, tol: number): { v: THREE.Vector3; at: THREE.Vector3; kind: 'vertex' | 'edge' } | null {
    const ob = d.origBuilding;
    const moving = new Set(d.kind === 'move-solids' ? (d.data.ids as ID[]) : []);
    const mine: THREE.Vector3[] = [];
    const others: [THREE.Vector3, THREE.Vector3][] = [];
    const ring = (b: Building3, s: Solid) => {
      const r = solidRings(s);
      return r.outer.pts.filter((_, i) => !r.outer.segs[i]!.curved).map((p) => {
        const w = toWorld(b, p);
        return new THREE.Vector3(w[0], 0, w[1]);
      });
    };
    for (const b of this.project.buildings) {
      const src = b.id === ob.id ? ob : b;
      for (const s of src.solids) {
        if (s.hidden) continue;
        const pts = ring(src, s);
        const isMoving = d.kind === 'move-building' ? b.id === ob.id : b.id === ob.id && moving.has(s.id);
        if (isMoving) mine.push(...pts);
        else if (s.op === 'add') pts.forEach((p, i) => others.push([p, pts[(i + 1) % pts.length]!]));
      }
    }
    let best: { dist: number; v: THREE.Vector3; at: THREE.Vector3; kind: 'vertex' | 'edge' } | null = null;
    for (const m of mine) {
      const q = m.clone().add(delta);
      for (const [a, b2] of others) {
        const dv = a.distanceTo(q);
        if (dv < tol && (!best || dv < best.dist - 1e-6 || best.kind === 'edge')) best = { dist: dv, v: a.clone().sub(q), at: a.clone(), kind: 'vertex' };
        if (best?.kind === 'vertex') continue;
        const ab = b2.clone().sub(a);
        const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
        const proj = a.clone().addScaledVector(ab, t);
        const de = proj.distanceTo(q);
        if (de < tol * 0.8 && (!best || de < best.dist)) best = { dist: de, v: proj.clone().sub(q), at: proj, kind: 'edge' };
      }
    }
    return best ? { v: best.v, at: best.at.setY(d.kind === 'move-solids' ? (d.data.y as number) : 0), kind: best.kind } : null;
  }

  /** Offsets what is being moved (from the initial state). */
  private applyMoveDelta(delta: THREE.Vector3, commit: boolean): void {
    const d = this.drag;
    const bid = d?.bid ?? this.lastMoved?.bid;
    const b = bid ? this.store.building(bid) : undefined;
    if (!b) return;
    if ((d && d.kind === 'move-building') || (!d && this.lastMoved?.kind === 'building')) {
      // Start: the drag's or, when retyping the distance, the one before the last move.
      const moveTo = (x: Building3, orig: number[] | null) => {
        const base = orig ?? [x.position[0] - this.lastMoved!.delta.x, x.position[1] - this.lastMoved!.delta.z];
        x.position = [base[0]! + delta.x, base[1]! + delta.z];
      };
      moveTo(b, d ? d.origBuilding.position : null);
      const others = d ? ((d.data.others as [ID, number[]][] | undefined) ?? []) : this.lastMoved!.ids.map((id) => [id, null] as [ID, null]);
      for (const [id, p] of others) {
        const x = this.store.building(id);
        if (x) moveTo(x, p);
      }
      const ids = others.map((o) => o[0]);
      if (commit) {
        this.lastMoved = { kind: 'building', bid: b.id, ids, delta: delta.clone(), copied: this.lastMoved?.copied ?? false };
        this.store.commit([b.id, ...ids], `Moved ${fmt(delta.length())} m.`, false);
      } else this.view.sync(this.store.project, this.store.revision, this.preview);
      this.drawSelection();
      return;
    }
    const ids = d ? (d.data.ids as ID[]) : this.lastMoved!.ids;
    const local = dirToLocal(b, [delta.x, delta.z]);
    for (const sid of ids) {
      const s = findSolid(b, sid);
      const so = d ? findSolid(d.origBuilding, sid) : null;
      if (!s) continue;
      if (so) s.plan = structuredClone(so.plan);
      else translateSolid(s, -dirToLocal(b, [this.lastMoved!.delta.x, this.lastMoved!.delta.z])[0], -dirToLocal(b, [this.lastMoved!.delta.x, this.lastMoved!.delta.z])[1]);
      translateSolid(s, local[0], local[1]);
    }
    if (commit) {
      this.lastMoved = { kind: 'solids', bid: b.id, ids, delta: delta.clone(), copied: this.lastMoved?.copied ?? false };
      this.store.commit([b.id], `Moved ${fmt(delta.length())} m.`);
    } else this.store.touch([b.id]);
  }

  /** Ctrl when starting to move: the original stays, the copy moves. */
  private makeDragCopy(): void {
    const d = this.drag!;
    const b = this.store.building(d.bid)!;
    if (d.kind === 'move-building') {
      const c = cloneBuilding(b);
      c.name = b.name + ' (copy)';
      this.store.project.buildings.push(c);
      d.bid = c.id;
      d.origBuilding = structuredClone(c);
      this.sel.building = c.id;
      // The other selected ones become copies too, and the copies are what moves.
      const others = (d.data.others as [ID, number[]][] | undefined) ?? [];
      d.data.others = others.flatMap(([id, p]) => {
        const src = this.store.building(id);
        if (!src) return [];
        const k = cloneBuilding(src);
        k.name = src.name + ' (copy)';
        k.position = [p[0]!, p[1]!];
        this.store.project.buildings.push(k);
        return [[k.id, p] as [ID, number[]]];
      });
      this.sel.others = (d.data.others as [ID, number[]][]).map((o) => o[0]);
    } else if (d.kind === 'move-solids') {
      const ids: ID[] = [];
      for (const sid of d.data.ids as ID[]) {
        const src = findSolid(b, sid);
        if (!src) continue;
        const c = cloneSolid(src);
        b.solids.push(c);
        ids.push(c.id);
      }
      d.data.ids = ids;
      d.origBuilding = structuredClone(b);
      this.sel.solids = ids;
    }
    d.data.copied = true;
  }

  /** Offset along the line since where the drag started (grabbing the arrow tip does not jump). */
  private dragAlong(d: Drag, e: { clientX: number; clientY: number }, at: THREE.Vector3, dir: THREE.Vector3): number {
    if (d.data.t0 === undefined) d.data.t0 = this.alongLine({ clientX: d.start.x, clientY: d.start.y }, at, dir);
    return this.alongLine(e, at, dir) - (d.data.t0 as number);
  }

  /** Distance along a line (in the world) to the point closest to the mouse ray. */
  private alongLine(e: { clientX: number; clientY: number }, at: THREE.Vector3, dir: THREE.Vector3): number {
    const ray = this.view.rayFrom(e).ray;
    const d = dir.clone().normalize();
    const w0 = at.clone().sub(ray.origin);
    const a = d.dot(d),
      b = d.dot(ray.direction),
      c = ray.direction.dot(ray.direction),
      dd = d.dot(w0),
      ee = ray.direction.dot(w0);
    const den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return 0;
    return (b * ee - c * dd) / den;
  }

  private finishDrag(e: PointerEvent): void {
    const d = this.drag!;
    const drewPreview = this.preview.has(d.bid);
    this.store.changed = false;
    this.endDrag(d, e);
    // A drag that ended where it began records nothing, but its building was drawn without its facade
    // meanwhile (preview): it is drawn whole again.
    if (d.moved && drewPreview && !this.store.changed && this.store.building(d.bid)) this.store.touch([d.bid]);
  }

  private endDrag(d: Drag, e: PointerEvent): void {
    this.drag = null;
    this.placeCtxBar();
    this.preview.delete(d.bid);
    this.clearSnap();
    this.shell.dim.hidden = true;
    // A press without a drag did nothing, so typing has nothing to correct: digits and 1/2/3 keep their
    // normal meaning (SketchUp's measurements box follows the last operation, not a click).
    if (!d.moved) this.clearMeasure();
    if (!d.moved && d.data.sub) {
      // Still click in a sub-element mode: the selection made on press stays.
      this.store.revert();
      return this.syncSelection();
    }
    if (!d.moved && d.kind === 'iwallnode') {
      // A click (no drag) on a wall corner starts or continues a wall there.
      this.store.revert();
      return this.iwallAt(e, true);
    }
    if (!d.moved && d.kind === 'vertex') {
      // Click on a vertex: selects the corner (round, chamfer, delete).
      this.store.revert();
      return this.select({ building: this.sel.building, solids: this.sel.solids, vertex: d.data.vertex as ID });
    }
    if (!d.moved && d.kind === 'move-building' && d.data.drill) {
      this.store.revert();
      this.drilledAt = performance.now();
      this.enter(d.bid);
      return this.select({ building: d.bid, solids: [d.data.drill as ID] });
    }
    if (!d.moved && d.data.click) {
      // Still click on an object of the multiple selection: only it stays.
      this.store.revert();
      const c = d.data.click as { hit: Hit; ev: Mods };
      return this.clickSelect(c.hit, c.ev);
    }
    if (!d.moved) {
      this.store.revert();
      // Click without dragging on a handle: counts as a click on the model (select face, etc.).
      if (d.data.viaHandle && this.selectLike()) this.clickSelect(this.pickAt(e), e);
      else this.drawSelection();
      return;
    }
    const b = this.store.building(d.bid);
    if (d.kind === 'lift-building' && b) {
      this.store.commit([b.id], `Elevation ${fmt(b.elevation ?? 0)} m.`, false);
      return;
    }
    if (d.kind === 'move-building' && b) {
      const delta = new THREE.Vector3(b.position[0] - d.origBuilding.position[0], 0, b.position[1] - d.origBuilding.position[1]);
      this.lastMove = delta.clone();
      const ids = ((d.data.others as [ID, number[]][] | undefined) ?? []).map((o) => o[0]);
      // Dropped through another building: it joins it (one body; the booleans join the walls and roofs).
      // Alt keeps them apart. Several buildings moved together are left as they are.
      const into = !ids.length && !e.altKey ? buildingPassedThrough(this.project, worldParts(b), b.id) : null;
      if (into) {
        const moved = b.solids.map((x) => x.id);
        mergeInto(into, b);
        this.store.project.buildings = this.store.project.buildings.filter((x) => x.id !== b.id);
        this.lastMoved = null;
        const msg = `${d.origBuilding.name} joined to ${into.name}: dropped through it, so it is one building now.`;
        if (this.store.commit([into.id], msg)) {
          this.enter(null);
          this.select({ building: into.id });
          this.toast(msg);
          // Joining is the likely answer and is done; the chooser offers the others (Estúdio de Construção).
          this.composeChooser(e, into.id, moved, d.origBuilding.name);
        }
        return;
      }
      this.lastMoved = { kind: 'building', bid: b.id, ids, delta, copied: !!d.data.copied };
      this.store.commit([b.id, ...ids], d.data.copied ? 'Copied. Type 5x for more copies.' : `Moved ${fmt(delta.length())} m.`, !!d.data.copied);
      if (d.data.copied) this.toast('Copied. Type 5x for more copies.');
      return;
    }
    if (d.kind === 'move-solids' && b) {
      const s = findSolid(b, (d.data.ids as ID[])[0]!),
        so = findSolid(d.origBuilding, (d.data.ids as ID[])[0]!);
      if (s && so) {
        const a = toWorld(b, planCenter(so)),
          c = toWorld(b, planCenter(s));
        const delta = new THREE.Vector3(c[0] - a[0], 0, c[1] - a[1]);
        this.lastMove = delta;
        this.lastMoved = { kind: 'solids', bid: b.id, ids: d.data.ids as ID[], delta, copied: !!d.data.copied };
      }
    }
    if ((d.kind === 'extrude-side' || d.kind === 'extrude-top') && b) {
      const id = d.data.created as ID | undefined;
      this.store.commit([d.bid], id ? 'Volume extruded.' : '');
      if (id) {
        this.toast('Volume extruded: it is a new, editable volume.');
        this.select({ building: b.id, solids: [id] });
      }
      return;
    }
    if (d.kind === 'rotate' && !d.data.inCtx) {
      this.store.commit([d.bid], 'Rotated.', false);
      return;
    }
    if (d.kind === 'side-depth' && b) {
      const hf = hostedFrame(findSolid(b, d.data.sid as ID) ?? ({} as Solid));
      const msg = hf ? (hf.depth > 0 ? `Projection ${fmt(hf.depth)} m.` : `Niche ${fmt(-hf.depth)} m deep.`) : '';
      if (this.store.commit([d.bid], msg) && msg) this.toast(msg);
      return;
    }
    this.store.commit([d.bid], '');
    void e;
  }

  /**
   * After volumes joined a building by being dropped through it: Join (done), Subtract (they carve it),
   * Intersect (only the common part) or Keep apart (they become their building again). Esc keeps the join.
   */
  private composeChooser(e: { clientX: number; clientY: number }, bid: ID, moved: ID[], name: string): void {
    choose(this.shell.root, e.clientX, e.clientY, 'Result', [
      { id: 'add', label: 'Join', hint: 'One solid: walls and roofs meet' },
      { id: 'subtract', label: 'Subtract', hint: `${name} carves the other building` },
      { id: 'intersect', label: 'Intersect', hint: 'Only the common part stays' },
      { id: 'keep', label: 'Keep apart', hint: 'Two buildings side by side' },
    ], 'add', (id) => {
      if (!id || id === 'add') return;
      if (id === 'keep') return void this.separate(bid, moved, name);
      this.change(bid, (x) => {
        for (const s of x.solids) if (moved.includes(s.id)) s.op = id as Solid['op'];
      }, id === 'subtract' ? `${name} subtracted.` : 'Only the common part stays.');
    });
  }

  /** Volumes of a building become a building of their own, in the same place (Separate, Keep apart). */
  separate(bid: ID, ids: ID[], name?: string): boolean {
    const b = this.store.building(bid);
    if (!b) return false;
    const nb = separateSolids(b, ids, (input) => newBuilding({ ...input, ...(name ? { name } : {}) }));
    if (!nb) {
      this.toast('A building keeps at least one volume: nothing to separate.');
      return false;
    }
    this.store.project.buildings.push(nb);
    if (!this.store.commit([b.id, nb.id], 'Separated: a building of its own.')) return false;
    this.toast(`${nb.name} is a building of its own now (Ctrl+Z joins it again).`);
    this.enter(null);
    this.select({ building: nb.id });
    return true;
  }

  /** The level the interior tools work on: the one cut in the interior view, else the ground floor. */
  private workLevel(b: Building3): { id: ID; elevation: number; height: number } | null {
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    return lv[Math.min(lv.length - 1, Math.max(0, this.project.view?.cutLevel ?? 0))] ?? null;
  }

  private iwallLast: Vec2 | null = null;

  /**
   * Interior walls tool: each click on the floor of the level shown adds a wall from the previous
   * point (a new start after Enter); Shift+click on a wall puts a 0.9 m door there. The walls are
   * `Building3.interiors` (eval/interiorwalls.ts), drawn in the interior view.
   */
  private iwallAt(e: PointerEvent, commit: boolean): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return this.showDim('Enter a building first (double click)', e);
    const lv = this.workLevel(b);
    if (!lv) return;
    const w = this.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
    if (!w) return;
    let l = toLocal(b, [w.x, w.z]);
    if (this.infer.enabled) l = [Math.round(l[0] / this.infer.grid) * this.infer.grid, Math.round(l[1] / this.infer.grid) * this.infer.grid];
    if (this.iwallLast) {
      const d = Math.hypot(l[0] - this.iwallLast[0], l[1] - this.iwallLast[1]);
      this.showDim(`${fmt(d)} m · Enter ends`, e);
    } else this.showDim(e.shiftKey ? 'Shift+click on a wall: a door' : 'Click the start of the wall', e);
    if (!commit) return;
    if (e.shiftKey) {
      // A door on the nearest interior wall of this level.
      const it = b.interiors[lv.id];
      if (!it) return this.toast('No interior wall on this floor yet.');
      const node = new Map(it.nodes.map((n) => [n.id, n.p]));
      let best: { id: ID; u: number; d: number } | null = null;
      for (const wl of it.walls) {
        const a = node.get(wl.a), c = node.get(wl.b);
        if (!a || !c) continue;
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        const u = Math.max(0, Math.min(len, ((l[0] - a[0]) * (c[0] - a[0]) + (l[1] - a[1]) * (c[1] - a[1])) / len));
        const d = Math.hypot(a[0] + ((c[0] - a[0]) * u) / len - l[0], a[1] + ((c[1] - a[1]) * u) / len - l[1]);
        if (!best || d < best.d) best = { id: wl.id, u, d };
      }
      if (!best || best.d > 0.5) return this.toast('Shift+click on an interior wall to put a door in it.');
      const pick = best;
      this.change(b.id, (x) => {
        const ix = x.interiors[lv.id] as InteriorWithDoors;
        ix.doors = [...interiorDoors(ix), { wall: pick.id, u: pick.u, width: 0.9, height: 2.1 }];
      }, 'Door added to the interior wall.');
      return;
    }
    const from = this.iwallLast;
    this.iwallLast = l;
    if (from && Math.hypot(l[0] - from[0], l[1] - from[1]) > 0.05) this.change(b.id, (x) => void addInteriorWall(x, lv.id, from, l, this.iwallThickness, uid), `Interior wall ${fmt(Math.hypot(l[0] - from[0], l[1] - from[1]))} m (floor ${lv.elevation.toFixed(1)} m).`);
  }

  /** Columns every `spacing` m inside the chosen volume (or the first), on each of its floors (model/structure.ts). */
  columnGrid(spacing = 6): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return this.toast('Select a building first.');
    const s = this.activeSolid() ?? b.solids.find((q) => q.op === 'add');
    if (!s) return;
    const items = columnGrid(b, s, spacing, 'column-square', uid);
    if (!items.length) return this.toast('The volume is too small for a grid that wide.');
    this.change(b.id, (x) => void x.items.push(...items), `${items.length} columns, a grid of ${fmt(spacing)} m (each is a part: move, size or delete it).`);
  }

  /** The interior walls of the floor shown copied to every floor above it. */
  replicateFloor(): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return this.toast('Select a building first.');
    const lv = this.workLevel(b);
    if (!lv || !b.interiors[lv.id]?.walls.length) return this.toast('No interior walls on this floor to copy.');
    const above = b.levels.filter((l) => l.elevation > lv.elevation + 0.1).map((l) => l.id);
    if (!above.length) return this.toast('No floor above this one.');
    this.change(b.id, (x) => replicateLevel(x, lv.id, above, uid), `Walls of this floor copied to ${above.length} floor(s) above.`);
  }

  /**
   * Copies of the selected free part along a line drawn on the ground (lamps along a path, trees along a
   * drive, bollards): one every `spacing` m, each turned along the line.
   */
  arrayAlongPath(spacing: number): void {
    const b = this.activeBuilding();
    const it = this.activeItem();
    if (!b || !it || it.host.kind !== 'free') return this.toast('Select a free part (a lamp, a tree, a bench) first.');
    const src = structuredClone(it);
    const bid = b.id;
    this.toast('Click the points of the line on the ground; Enter ends.');
    this.polyline.start('Click the start of the line', (pts) => {
      const bb = this.store.building(bid);
      if (!bb) return;
      // The part itself counts as one: no copy right next to it.
      const own = src.host.kind === 'free' ? toWorld(bb, [src.host.p[0], src.host.p[2]]) : null;
      const at = pointsAlong(pts, Math.max(0.5, spacing)).filter((q) => !own || Math.hypot(q.p[0] - own[0], q.p[1] - own[1]) > spacing * 0.5);
      const items: Item[] = at.map((q) => {
        const l = toLocal(bb, q.p);
        return { ...structuredClone(src), id: uid(), host: { kind: 'free', p: [l[0], src.host.kind === 'free' ? src.host.p[1] : 0, l[1]], rot: Math.round((q.yaw - bb.rotation) * 100) / 100 } };
      });
      if (!items.length) return;
      this.change(bid, (x) => void x.items.push(...items), `${items.length} copies along the line, every ${fmt(spacing)} m.`);
      this.select({ building: bid, item: items[0]!.id });
    });
  }

  /** The selected corners become spline points (or sharp corners again). */
  toggleSmooth(): void {
    const b = this.activeBuilding(),
      s = this.activeSolid();
    if (!b || !s || !this.sel.verts?.length) return;
    const ids = new Set(this.sel.verts);
    const all = [...s.plan.outer, ...s.plan.holes.flat()];
    const on = !all.some((v) => ids.has(v.id) && v.smooth);
    this.change(b.id, (x) => {
      const so = findSolid(x, s.id)!;
      for (const v of [...so.plan.outer, ...so.plan.holes.flat()])
        if (ids.has(v.id)) {
          if (on) {
            v.smooth = true;
            delete v.bulge;
            delete v.round;
            delete v.chamfer;
          } else delete v.smooth;
        }
    }, on ? 'Smooth points: the outline passes through them as a spline.' : 'Sharp corners again.');
  }

  /**
   * The buildings around the project's place from OpenStreetMap (Overpass API, model/osm.ts), on a layer
   * of their own ("OpenStreetMap"), replacing an earlier import. The place is the real sun's (Time panel).
   */
  async importOsm(radius = 200): Promise<void> {
    const sun = this.project.view?.sun;
    if (!sun) return this.toast('Choose the place first: Time panel → real sun (city or latitude/longitude).');
    this.toast(`Asking OpenStreetMap for the buildings within ${radius} m of ${sun.place ?? `${sun.latitude.toFixed(4)}, ${sun.longitude.toFixed(4)}`}…`);
    let json: unknown;
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(overpassQuery(sun.latitude, sun.longitude, radius)) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      json = await r.json();
    } catch (err) {
      return this.toast(`OpenStreetMap did not answer (${(err as Error).message}). Try again in a minute.`);
    }
    const p = this.store.project;
    const layers = ensureLayers(p);
    let layer = layers.find((l) => l.name === 'OpenStreetMap');
    if (!layer) {
      layer = { id: uid(), name: 'OpenStreetMap', color: '#8a96a3', visible: true, locked: true };
      layers.push(layer);
    }
    const lid = layer.id;
    const bs = osmToBuildings(json as { elements?: [] }, sun.latitude, sun.longitude, lid);
    if (!bs.length) return this.toast('OpenStreetMap has no buildings mapped around this place.');
    p.buildings = p.buildings.filter((b) => b.layer !== lid).concat(bs);
    this.store.commit(null, `${bs.length} buildings from OpenStreetMap.`);
    this.toast(`${bs.length} buildings from OpenStreetMap (© OpenStreetMap contributors, ODbL), on the locked layer "OpenStreetMap".`);
    this.view.frameAll();
  }

  /** Walls tool finished: a building with walls of the thickness (closed) or a free-standing wall (open). */
  private wallsDone(pts: Vec2[], closed: boolean): void {
    const t = this.wallThickness;
    if (!closed) {
      const b = this.ownerAt(pts[0]![0], pts[0]![1]);
      const it: Item = { id: uid(), type: 'wall-run', params: { thickness: t, height: 2.2 }, host: { kind: 'path', points: pts.map((p) => { const l = toLocal(b, p); return [l[0], 0, l[1]] as Vec3; }) } };
      this.adopt(b);
      this.change(b.id, (x) => void x.items.push(it), `Free-standing wall ${fmt(t)} m thick: its points and height are editable.`);
      this.context = b.id;
      this.select({ building: b.id, item: it.id });
      return;
    }
    // The clicked line is the walls' centre: the volume reaches the outer face, hollow by the thickness.
    const ccw = signedArea2(pts) > 0 ? pts : [...pts].reverse();
    const outer = offsetRing(ccw, ccw.map(() => -t / 2));
    if (!ringValid(outer, 1)) return this.toast('Those walls cross each other: draw them again.');
    const c: Vec2 = [outer.reduce((a, p) => a + p[0], 0) / outer.length, outer.reduce((a, p) => a + p[1], 0) / outer.length];
    const b = newBuilding({ name: tr(`Building ${this.project.buildings.length + 1}`), position: c, levels: levelsFor(1, 3, 3) });
    const s = newSolid({ name: tr('Walls'), plan: { outer: planVertices(outer.map((p) => [p[0] - c[0], p[1] - c[1]] as Vec2)), holes: [] }, height: 3, roof: roofSpec('flat', { parapet: 0.3 }) });
    s.shell = t;
    b.solids.push(s);
    this.store.project.buildings.push(b);
    if (!this.store.commit([b.id], 'Building from walls.')) return;
    this.context = b.id;
    this.select({ building: b.id, solids: [s.id] });
    this.toast(`Building from walls ${fmt(t)} m thick. Type the height (or "3f" for floors) and Enter; add doors and windows with the Opening tool (O).`);
    const bid = b.id,
      sid = s.id;
    this.setMeasure('Height', (txt) => {
      const nf = parseFloors(txt);
      const v = nf !== null ? nf * 3 : parseLength(txt);
      if (v === null || v <= 0.5) return false;
      return this.change(bid, (x) => {
        const so = findSolid(x, sid)!;
        so.height = v;
        fillLevels(x, v);
      }, `Walls ${fmt(v)} m high.`);
    });
  }

  /** Slab tool finished: a 20 cm slab volume on the floor shown. */
  private slabDone(pts: Vec2[], closed: boolean): void {
    if (!closed) return this.toast('Click the first corner to close the slab.');
    const b0 = this.store.building(this.context) ?? this.activeBuilding();
    const b = b0 ?? this.ownerAt(pts[0]![0], pts[0]![1]);
    const lv = this.workLevel(b);
    const local = pts.map((p) => toLocal(b, p));
    const ring = signedArea2(local) > 0 ? local : [...local].reverse();
    const s = newSolid({ name: 'Slab', plan: { outer: planVertices(ring), holes: [] }, base: lv?.elevation ?? 0, height: 0.2, roof: roofSpec('flat', { parapet: 0 }) });
    this.adopt(b);
    this.change(b.id, (x) => void x.solids.push(s), 'Slab 20 cm: its corners, height and edges are editable like any volume.');
    this.context = b.id;
    this.select({ building: b.id, solids: [s.id] });
  }

  /** Column tool: a column on the floor shown, up to the slab above. */
  private columnAt(e: PointerEvent): void {
    const at = this.levelPoint(e);
    const g = at ? null : this.view.onPlane(e, 0);
    const b = at?.b ?? (g ? this.ownerAt(g.x, g.z) : null);
    if (!b) return;
    const lv = at?.lv ?? this.workLevel(b);
    const p = at?.p ?? toLocal(b, [g!.x, g!.z]);
    const h = Math.max(1, (lv?.height ?? 3) - 0.25);
    const it: Item = { id: uid(), type: 'column-square', params: { height: Math.round(h * 100) / 100, plinth: false, capital: false }, host: { kind: 'free', p: [p[0], lv?.elevation ?? 0, p[1]], rot: 0 } };
    this.adopt(b);
    this.change(b.id, (x) => void x.items.push(it), `Column ${fmt(h)} m high (click again for another; Esc ends).`);
    this.context = b.id;
  }

  /** Beam tool: two clicks, a beam under the slab above the floor shown. */
  private beamAt(e: PointerEvent, commit: boolean): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return this.showDim('Enter a building first (double click)', e);
    const lv = this.workLevel(b);
    if (!lv) return;
    const top = lv.elevation + lv.height - 0.25;
    const w = this.view.onPlane(e, top + (b.elevation ?? 0));
    if (!w) return;
    let l = toLocal(b, [w.x, w.z]);
    if (this.infer.enabled) l = [Math.round(l[0] / this.infer.grid) * this.infer.grid, Math.round(l[1] / this.infer.grid) * this.infer.grid];
    if (!commit) return this.showDim(this.beamFrom ? `${fmt(Math.hypot(l[0] - this.beamFrom[0], l[1] - this.beamFrom[2]))} m` : 'Click the first end of the beam', e);
    if (!this.beamFrom) {
      this.beamFrom = [l[0], top, l[1]];
      return;
    }
    const a = this.beamFrom;
    this.beamFrom = null;
    if (Math.hypot(l[0] - a[0], l[1] - a[2]) < 0.3) return;
    const it: Item = { id: uid(), type: 'beam', params: { align: 'top' }, host: { kind: 'path', points: [a, [l[0], top, l[1]]] } };
    this.change(b.id, (x) => void x.items.push(it), `Beam ${fmt(Math.hypot(l[0] - a[0], l[1] - a[2]))} m under the slab (its section in the panel).`);
  }

  private roomFrom: Vec2 | null = null;

  /** The level plane point (building frame) under the pointer, for the interior tools. */
  private levelPoint(e: { clientX: number; clientY: number }): { b: Building3; lv: { id: ID; elevation: number; height: number }; p: Vec2 } | null {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return null;
    const lv = this.workLevel(b);
    if (!lv) return null;
    const w = this.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
    if (!w) return null;
    let p = toLocal(b, [w.x, w.z]);
    if (this.infer.enabled) p = [Math.round(p[0] / this.infer.grid) * this.infer.grid, Math.round(p[1] / this.infer.grid) * this.infer.grid];
    return { b, lv, p };
  }

  private roomDown(e: PointerEvent): void {
    const at = this.levelPoint(e);
    if (!at) return this.showDim('Enter a building first (double click)', e);
    this.roomFrom = at.p;
    this.roomStart = { x: e.clientX, y: e.clientY };
  }
  private roomStart: { x: number; y: number } | null = null;

  private roomMove(e: PointerEvent): void {
    const at = this.levelPoint(e);
    if (!at) return this.showDim('Enter a building first (double click)', e);
    const o = this.snapOverlay.getObjectByName('room-draft');
    if (o) {
      this.snapOverlay.remove(o);
      (o as THREE.Line).geometry.dispose();
    }
    if (!this.roomFrom || !(e.buttons & 1)) return this.showDim('Click inside walls, or drag a rectangle', e);
    const a = this.roomFrom,
      c = at.p;
    const M = this.view.buildingMatrix(at.b);
    const y = at.lv.elevation + 0.08;
    const pts = [a, [c[0], a[1]], c, [a[0], c[1]], a].map((q) => new THREE.Vector3(q[0]!, y, q[1]!).applyMatrix4(M));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false }));
    l.name = 'room-draft';
    l.renderOrder = 10;
    this.snapOverlay.add(l);
    this.view.mark();
    this.showDim(`${fmt(Math.abs(c[0] - a[0]))} × ${fmt(Math.abs(c[1] - a[1]))} m · ${fmt(Math.abs((c[0] - a[0]) * (c[1] - a[1])))} m²`, e);
  }

  private roomUp(e: PointerEvent): void {
    const at = this.levelPoint(e);
    const a = this.roomFrom!;
    const moved = this.roomStart ? Math.hypot(e.clientX - this.roomStart.x, e.clientY - this.roomStart.y) > 6 : false;
    this.roomFrom = null;
    this.roomStart = null;
    const o = this.snapOverlay.getObjectByName('room-draft');
    if (o) this.snapOverlay.remove(o);
    if (!at) return;
    const { b, lv, p } = at;
    const n = Object.values(b.interiors).reduce((k, it) => k + it.rooms.length, 0) + 1;
    if (moved && Math.abs(p[0] - a[0]) > 0.6 && Math.abs(p[1] - a[1]) > 0.6) {
      let rid = '';
      this.change(b.id, (x) => void (rid = addRoomRect(x, lv.id, a, p, this.iwallThickness, tr(`Room ${n}`), uid)), `Room ${n}: ${fmt(Math.abs((p[0] - a[0]) * (p[1] - a[1])))} m² with its four walls.`);
      this.roomSel = { level: lv.id, room: rid };
      this.iwallSel = null;
      this.emit();
      return;
    }
    // A click inside walls: the room they close.
    const it = b.interiors[lv.id];
    // The inner faces of the volumes on this floor close the rooms along the outer walls.
    const inner = b.solids
      .filter((s) => s.op === 'add' && s.base <= lv.elevation + 0.1 && s.base + s.height > lv.elevation + 0.5)
      .map((s) => {
        const ring = sampleRing(s.plan.outer).pts as Vec2[];
        const ccw = signedArea2(ring) > 0 ? ring : [...ring].reverse();
        const t = s.shell ?? 0.3;
        const r = offsetRing(ccw, ccw.map(() => t));
        return ringValid(r, 1) ? r : ccw;
      });
    const loop = it ? loopAround(it, p, inner) : inner.length ? loopAround({ nodes: [], walls: [], rooms: [] }, p, inner) : null;
    if (!loop) return this.toast('The walls do not close around this point: draw the missing wall, or drag a rectangle.');
    const id = uid();
    const area = Math.round(roomArea(loop.polygon) * 100) / 100;
    this.change(b.id, (x) => void interiorOf(x, lv.id).rooms.push({ id, name: tr(`Room ${n}`), wallIds: loop.wallIds, polygon: loop.polygon, area }), `Room ${n}: ${fmt(area)} m².`);
    this.roomSel = { level: lv.id, room: id };
    this.iwallSel = null;
    this.emit();
  }

  /** Name and area of each room of the floor shown, on the floor (only with the interior tools or the cut view). */
  drawRoomLabels(): void {
    for (const el of [...this.shell.view.querySelectorAll('.f3-roomlbl')]) el.remove();
    const b = this.store.building(this.context);
    if (!b || !(this.tool === 'iwall' || this.tool === 'room' || this.project.view?.cutLevel !== undefined)) return;
    const lv = this.workLevel(b);
    const it = lv ? b.interiors[lv.id] : undefined;
    if (!lv || !it) return;
    const M = this.view.buildingMatrix(b);
    const r = this.shell.view.getBoundingClientRect(),
      cr = this.view.renderer.domElement.getBoundingClientRect();
    for (const room of it.rooms) {
      if (!room.polygon?.length) continue;
      const c = room.polygon.reduce((a, q) => [a[0] + q[0] / room.polygon!.length, a[1] + q[1] / room.polygon!.length], [0, 0]);
      const s = this.view.toScreen(new THREE.Vector3(c[0], lv.elevation + 0.3, c[1]).applyMatrix4(M));
      if (s.behind) continue;
      const el = document.createElement('button');
      el.className = 'f3-roomlbl';
      el.setAttribute('aria-pressed', String(this.roomSel?.room === room.id));
      el.innerHTML = `<b></b><small></small>`;
      el.querySelector('b')!.textContent = room.name;
      el.querySelector('small')!.textContent = `${fmt(room.area ?? roomArea(room.polygon))} m²`;
      el.style.left = `${s.x + cr.left - r.left}px`;
      el.style.top = `${s.y + cr.top - r.top}px`;
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.roomSel = { level: lv.id, room: room.id };
        this.iwallSel = null;
        this.emit();
        this.drawRoomLabels();
      });
      this.shell.view.appendChild(el);
    }
  }

  private beginIwallHandle(h: Handle, e: PointerEvent): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    const iw = h.iwall!;
    if (!b) return;
    if (iw.wall) {
      if (!e.altKey) {
        // A click on a wall's dot selects it: its panel (thickness, length, doors).
        this.iwallSel = { level: iw.level, wall: iw.wall };
        this.roomSel = null;
        this.emit();
        return;
      }
      this.change(b.id, (x) => {
        const it = x.interiors[iw.level] as InteriorWithDoors | undefined;
        if (!it) return;
        it.walls = it.walls.filter((w) => w.id !== iw.wall);
        if (it.doors) it.doors = it.doors.filter((d) => d.wall !== iw.wall);
        // Corners no wall uses any more go too.
        const used = new Set(it.walls.flatMap((w) => [w.a, w.b]));
        it.nodes = it.nodes.filter((n) => used.has(n.id));
      }, 'Interior wall deleted.');
      return;
    }
    this.startDrag('iwallnode', b, e, { handle: 'vertex', level: iw.level, node: iw.node }, true);
  }

  /** A straight stair from the level shown to the one above it, at the middle of the volume (move it after). */
  stairUp(): void {
    const b = this.store.building(this.context) ?? this.activeBuilding();
    if (!b) return this.toast('Select a building first.');
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    const i = Math.max(0, Math.min(lv.length - 2, this.project.view?.cutLevel ?? 0));
    if (lv.length < 2) return this.toast('One floor only: there is no floor above to reach.');
    const s = this.activeSolid() ?? b.solids.find((q) => q.op === 'add');
    // On the floor, near the middle, never in a courtyard (model/structure.ts).
    const c: Vec2 = s ? (freeSpot(b, s, 4) ?? planCenter(s)) : [0, 0];
    const it = stairBetween(b, lv[i]!.id, lv[i + 1]!.id, c, 0);
    this.change(b.id, (x) => void x.items.push(it), `Stair from floor ${i + 1} to floor ${i + 2}: move it where it goes.`);
    this.context = b.id;
    this.select({ building: b.id, item: it.id });
  }

  /** Walking inside (first person): Esc gives the model view back. */
  startWalk(): void {
    this.setTool('select');
    this.toast('Walking: WASD moves, the mouse looks, Shift runs, Esc leaves.');
    this.walk.start();
  }

  /**
   * Booleans between the selected volumes (the first selected is the one acted on): Join makes every one
   * add; Subtract and Intersect make the others cut it or keep only the common part, placed right after it
   * in the order (an operation acts on what comes before it).
   */
  /**
   * A bridge between the two selected volumes (Estúdio de Construção's "bridge"): a one-floor volume
   * across the gap between their facing sides, on the first floor above the ground, as wide as their
   * facing stretch allows (at most 4 m).
   */
  bridgeSelected(): void {
    const b = this.activeBuilding();
    if (!b || this.sel.solids.length !== 2) return this.toast('Select two volumes (Shift+click) to bridge.');
    const [p, q] = this.sel.solids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x).map((x) => ({ s: x, box: volumeBox(x) }));
    if (!p || !q) return;
    const A = p.box,
      B = q.box;
    const lv = [...b.levels].sort((m, n) => m.elevation - n.elevation);
    const base = lv[1] && lv[1].elevation < Math.min(p.s.base + p.s.height, q.s.base + q.s.height) - 2 ? lv[1].elevation : Math.max(p.s.base, q.s.base);
    const h = lv[1]?.height ?? lv[0]?.height ?? 3;
    let plan: Vec2[] | null = null;
    const gapX = A.x1 < B.x0 ? [A.x1, B.x0] : B.x1 < A.x0 ? [B.x1, A.x0] : null;
    const gapZ = A.z1 < B.z0 ? [A.z1, B.z0] : B.z1 < A.z0 ? [B.z1, A.z0] : null;
    if (gapX) {
      const z0 = Math.max(A.z0, B.z0),
        z1 = Math.min(A.z1, B.z1);
      if (z1 - z0 < 1.2) return this.toast('The two volumes do not face each other: nothing to bridge.');
      const w = Math.min(4, z1 - z0),
        c = (z0 + z1) / 2;
      plan = [[gapX[0]!, c - w / 2], [gapX[1]!, c - w / 2], [gapX[1]!, c + w / 2], [gapX[0]!, c + w / 2]];
    } else if (gapZ) {
      const x0 = Math.max(A.x0, B.x0),
        x1 = Math.min(A.x1, B.x1);
      if (x1 - x0 < 1.2) return this.toast('The two volumes do not face each other: nothing to bridge.');
      const w = Math.min(4, x1 - x0),
        c = (x0 + x1) / 2;
      plan = [[c - w / 2, gapZ[0]!], [c + w / 2, gapZ[0]!], [c + w / 2, gapZ[1]!], [c - w / 2, gapZ[1]!]];
    }
    if (!plan) return this.toast('The volumes touch or overlap: nothing to bridge (Join makes them one).');
    const br = newSolid({ name: 'Bridge', plan: { outer: planVertices(plan), holes: [] }, base, height: h, roof: roofSpec('flat', { parapet: 0.3 }) });
    br.facade = [facadeRule('win-sliding', { levels: 'all', mode: 'max', value: 2.2 })];
    this.change(b.id, (x) => void x.solids.push(br), `Bridge ${fmt(Math.abs((gapX ?? gapZ)![1]! - (gapX ?? gapZ)![0]!))} m long, ${fmt(h)} m high.`);
    this.select({ building: b.id, solids: [br.id] });
  }

  combineSelected(op: Solid['op']): void {
    const b = this.activeBuilding();
    if (!b || this.sel.solids.length < 2) return;
    const [first, ...rest] = this.sel.solids;
    this.change(b.id, (x) => {
      const f = findSolid(x, first!);
      if (!f) return false;
      f.op = 'add';
      const others = rest.map((id) => findSolid(x, id)).filter((q): q is Solid => !!q);
      for (const o of others) o.op = op;
      if (op !== 'add') {
        x.solids = x.solids.filter((q) => !others.includes(q));
        x.solids.splice(x.solids.indexOf(f) + 1, 0, ...others);
      }
    }, op === 'add' ? 'Volumes joined.' : op === 'subtract' ? `The others carve ${findSolid(b, first!)?.name ?? 'the first'}.` : 'Only the common part stays.');
  }

  /**
   * A free part on a wall becomes a facade rule of its type on every floor of that side (at its sill and
   * with its own values), like "Repeat on facade" in Estúdio de Construção; the part itself goes.
   */
  repeatOnFacade(): void {
    const b = this.activeBuilding(),
      it = this.activeItem();
    if (!b || !it || it.host.kind !== 'face') return this.toast('Select a part on a wall to repeat it on the facade.');
    const h = it.host;
    const s = findSolid(b, h.solid);
    if (!s) return;
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    const y = s.base + h.y;
    const floor = lv.filter((l) => l.elevation <= y + 0.01).pop();
    const t = typeById(it.type, this.project);
    const f = t && family(t.family);
    const w = f ? f.size(resolveParams(f, t!.params, it.params))[0] : 1.2;
    const rule = facadeRule(it.type, { edges: [h.edge], levels: 'all', mode: 'max', value: Math.max(w + 0.8, 2.4), sill: Math.max(0, y - (floor?.elevation ?? s.base)), params: { ...it.params } });
    this.change(b.id, (x) => {
      const so = findSolid(x, s.id)!;
      so.facade.push(rule);
      x.items = x.items.filter((q) => q.id !== it.id);
    }, 'Repeated on every floor of this side (a facade rule).');
    this.select({ building: b.id, solids: [s.id], face: { kind: 'side', edge: h.edge } });
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  private drawPlane(e: { clientX: number; clientY: number }): { y: number; bid: ID | null } {
    const hit = this.pickAt(e);
    if (hit?.face && (hit.face.kind === 'top' || hit.face.kind === 'parapet') && hit.normal.y > 0.9) return { y: hit.point.y, bid: hit.building.id };
    return { y: 0, bid: this.context };
  }

  private drawDown(e: PointerEvent): void {
    // A rectangle started on a wall: drawn on the wall, then pulled out or carved in (tools/opening.ts).
    if (!this.draft && this.tool === 'rect' && this.opening.onAWall(e)) return this.opening.down(e, 'pull');
    if (!this.draft) {
      const pl = this.drawPlane(e);
      const sn = this.infer.snap(e, pl.y, null, null);
      if (!sn) return;
      this.draft = { points: [sn.p.clone()], y: pl.y, bid: pl.bid, hover: sn.p.clone() };
      return;
    }
    const sn = this.infer.snap(e, this.draft.y, this.draft.points[this.draft.points.length - 1]!, e.shiftKey && this.lastSnap?.line ? this.lastSnap.line[1].clone().sub(this.lastSnap.line[0]) : null, 12, this.secondPointSnap());
    if (!sn) return;
    if (this.tool === 'arc' && this.draft.points.length < 2) {
      // Arc: the two ends of the chord, then the point the arc passes through.
      this.draft.points.push(sn.p.clone());
      return;
    }
    if (this.tool === 'polygon' || this.tool === 'spline') {
      const first = this.draft.points[0]!;
      if (this.draft.points.length >= 3 && this.view.toScreen(first).x !== undefined && screenDist(this.view, first, sn.p) < 12) return this.finishPolygon();
      this.draft.points.push(sn.p.clone());
      return;
    }
    this.draft.points.push(sn.p.clone());
    this.finishShape();
  }

  /** Inferences for the second point: a rectangle corner or a circle radius are not directions from the first. */
  private secondPointSnap(): { parallel?: boolean; axes?: boolean } {
    return this.tool === 'rect' ? { parallel: false, axes: false } : this.tool === 'circle' ? { parallel: false } : {};
  }

  private drawMove(e: PointerEvent): void {
    const from = this.draft?.points[this.draft.points.length - 1] ?? null;
    const y = this.draft?.y ?? this.drawPlane(e).y;
    const sn = this.infer.snap(e, y, from, null, 12, from ? this.secondPointSnap() : {});
    if (!sn) return;
    this.showSnap(sn, e);
    if (!this.draft) return;
    this.draft.hover = sn.p.clone();
    this.drawDraft();
    const a = this.draft.points[0]!;
    if (this.tool === 'rect') {
      const [ax, az] = this.infer.axes();
      const d = sn.p.clone().sub(a);
      this.showDim(`${fmt(Math.abs(d.dot(ax!)))} × ${fmt(Math.abs(d.dot(az!)))} m`, e);
    } else if (this.tool === 'circle') this.showDim(`r ${fmt(sn.p.distanceTo(a))} m`, e);
    else this.showDim(`${fmt(sn.p.distanceTo(from!))} m`, e);
  }

  private drawDraft(): void {
    const dr = this.draft;
    if (!dr || !dr.hover) return;
    const pts = this.shapePoints(dr.points.concat(this.tool === 'polygon' ? [dr.hover] : [dr.hover]));
    const g = this.snapOverlay.getObjectByName('draft') as THREE.Line | undefined;
    if (g) {
      this.snapOverlay.remove(g);
      g.geometry.dispose();
    }
    const l = new (this.tool === 'polygon' ? THREE.Line : THREE.LineLoop)(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, dr.y + 0.03, p.z))), new THREE.LineBasicMaterial({ color: this.drawMode === 'add' ? '#e2702a' : '#c026d3', depthTest: false }));
    l.name = 'draft';
    l.renderOrder = 25;
    this.snapOverlay.add(l);
    this.view.mark();
  }

  /** Points of the drawing in progress (rectangle in the building frame). */
  private shapePoints(pts: THREE.Vector3[]): THREE.Vector3[] {
    if (this.tool === 'polygon') return pts;
    if (this.tool === 'spline') {
      // The smooth closed outline through the points (model/plan.ts sampleRing, smooth vertices).
      if (pts.length < 3) return pts;
      const ring = sampleRing(planVertices(pts.map((q) => [q.x, q.z] as Vec2), () => ({ smooth: true })));
      return ring.pts.map((q) => new THREE.Vector3(q[0], pts[0]!.y, q[1]));
    }
    if (this.tool === 'arc') return pts.length >= 3 ? arcSample(pts[0]!, pts[1]!, pts[2]!, 24) ?? pts : pts;
    const a = pts[0]!,
      b = pts[pts.length - 1]!;
    if (this.tool === 'circle') {
      const r = a.distanceTo(b);
      return Array.from({ length: 48 }, (_, i) => new THREE.Vector3(a.x + Math.cos((i / 48) * Math.PI * 2) * r, a.y, a.z + Math.sin((i / 48) * Math.PI * 2) * r));
    }
    const [ax, az] = this.infer.axes();
    const d = b.clone().sub(a);
    const u = d.dot(ax!),
      v = d.dot(az!);
    return [a.clone(), a.clone().addScaledVector(ax!, u), a.clone().addScaledVector(ax!, u).addScaledVector(az!, v), a.clone().addScaledVector(az!, v)];
  }

  private finishPolygon(): void {
    const dr = this.draft;
    if (!dr || dr.points.length < 3) return;
    this.finishShape();
  }

  private finishShape(): void {
    const dr = this.draft!;
    this.draft = null;
    const g = this.snapOverlay.getObjectByName('draft');
    if (g) this.snapOverlay.remove(g);
    this.shell.dim.hidden = true;
    this.clearSnap();
    let world = this.shapePoints(dr.points);
    if (this.tool === 'circle') world = [dr.points[0]!, dr.points[1]!];
    // Arc: the chord ends and the middle of the arc (its two halves are bent into true arcs below).
    let arcMids: THREE.Vector3[] | null = null;
    if (this.tool === 'arc') {
      const sm = arcSample(dr.points[0]!, dr.points[1]!, dr.points[2]!, 4);
      if (!sm) return this.toast('The three points are in a line: no arc.');
      world = [sm[0]!, sm[4]!, sm[2]!];
      arcMids = [sm[3]!, sm[1]!];
    }
    const a = world[0]!;
    if (this.tool !== 'circle' && polyArea(world) < 0.5) return;
    if (this.tool === 'circle' && a.distanceTo(world[1]!) < 0.3) return;
    const isRectTool = this.tool === 'rect';
    let b = this.store.building(dr.bid);
    let created = false;
    let joined: Building3 | null = null;
    if (!b && this.drawMode !== 'subtract') {
      // Drawn through another building: it becomes a volume of that building (one body, joined by the
      // booleans), not a new building whose walls cross the other one's. Touching beside it is not through.
      const ring = world.map((p) => [p.x, p.z] as Vec2);
      const part = this.tool === 'circle' ? Array.from({ length: 24 }, (_, i) => [world[0]!.x + Math.cos((i / 24) * Math.PI * 2) * world[0]!.distanceTo(world[1]!), world[0]!.z + Math.sin((i / 24) * Math.PI * 2) * world[0]!.distanceTo(world[1]!)] as Vec2) : ring;
      joined = buildingPassedThrough(this.project, [{ ring: part, y0: dr.y, y1: dr.y + 3 }]);
      if (joined) b = joined;
    }
    if (!b) {
      if (this.drawMode === 'subtract') return this.toast('To subtract, draw on a building (or inside it while editing).');
      b = newBuilding({ name: tr(`Building ${this.project.buildings.length + 1}`), position: [a.x, a.z], levels: levelsFor(1) , ...(activeLayer(this.project) ? { layer: activeLayer(this.project) } : {}) });
      this.store.project.buildings.push(b);
      created = true;
    }
    const local = world.map((p) => toLocal(b!, [p.x, p.z]));
    let plan;
    if (this.tool === 'circle') {
      const r = Math.hypot(local[1]![0] - local[0]![0], local[1]![1] - local[0]![1]);
      plan = circlePlan(r, local[0]![0], local[0]![1]);
    } else plan = planVertices(this.tool === 'spline' ? dr.points.map((p) => toLocal(b!, [p.x, p.z])) : local, () => (this.tool === 'spline' ? { smooth: true } : {}));
    const sub = this.drawMode === 'subtract';
    const levelH = b.levels[0]?.height ?? 3;
    const top = topAt(b, local[0]!);
    const base = dr.y > 0.01 ? dr.y : sub ? Math.max(0, top - levelH) : 0;
    const s = newSolid({ name: sub ? 'Cutter' : `Volume ${b.solids.length + 1}`, op: sub ? 'subtract' : 'add', plan: { outer: plan, holes: [] }, base: sub && dr.y > 0.01 ? dr.y - levelH : base, height: sub ? levelH + 0.5 : levelH, roof: roofSpec('flat', { parapet: sub ? 0 : 0.6 }) });
    if (sub && dr.y > 0.01) s.height = levelH;
    if (arcMids) {
      // Sides 1 (end → middle) and 2 (middle → start) of the triangle become the two halves of the arc.
      const [m1, m2] = arcMids.map((p) => toLocal(b!, [p.x, p.z]));
      bendEdge(s, s.plan.outer[1]!.id, m1!);
      bendEdge(s, s.plan.outer[2]!.id, m2!);
    }
    b.solids.push(s);
    // Levels follow the height of the first volume.
    if (!this.store.commit([b.id], created ? 'Volume created.' : 'Volume added.')) return;
    if (joined) this.composedNote = `Joined to ${joined.name}: drawn through it, so it is one building now (Separate in the bar keeps it apart).`;
    if (created || this.context !== b.id) this.context = b.id;
    this.select({ building: b.id, solids: [s.id], face: { kind: 'top' } });
    this.toast(this.composedNote ?? (sub ? 'Cutter created. Drag the top square for the height.' : isRectTool ? 'Volume created. Type 10x8 (width × depth) or 6 (height) and Enter; or drag the top square.' : 'Volume created. Drag the top square or type the height and Enter.'));
    this.composedNote = null;
    const bid = b.id,
      sid = s.id;
    const isRect = isRectTool;
    this.setMeasure(isRect ? 'Dimensions' : 'Height', (t) => {
      // Width × depth: 10x8, 10;8, 10*8 or 10 8 (a comma is a decimal separator).
      const m = /^\s*([\d.,]+)\s*(?:[;x×*/]|\s)\s*([\d.,]+)\s*$/i.exec(t);
      if (isRect && m) {
        const w = parseLength(m[1]!),
          dd = parseLength(m[2]!);
        if (!w || !dd) return false;
        return this.change(bid, (x) => {
          const so = findSolid(x, sid)!;
          const p0 = so.plan.outer[0]!.p;
          const p1 = so.plan.outer[1]!.p,
            p3 = so.plan.outer[3]!.p;
          const ux = [p1[0] - p0[0], p1[1] - p0[1]],
            uz = [p3[0] - p0[0], p3[1] - p0[1]];
          const lu = Math.hypot(ux[0]!, ux[1]!) || 1,
            lz = Math.hypot(uz[0]!, uz[1]!) || 1;
          const U: Vec2 = [(ux[0]! / lu) * w, (ux[1]! / lu) * w],
            V: Vec2 = [(uz[0]! / lz) * dd, (uz[1]! / lz) * dd];
          so.plan.outer[1]!.p = [p0[0] + U[0], p0[1] + U[1]];
          so.plan.outer[2]!.p = [p0[0] + U[0] + V[0], p0[1] + U[1] + V[1]];
          so.plan.outer[3]!.p = [p0[0] + V[0], p0[1] + V[1]];
        }, `${fmt(w)} × ${fmt(dd)} m.`);
      }
      const nf = parseFloors(t);
      const v = nf !== null ? floorsHeight(this.store.building(bid)!, findSolid(this.store.building(bid)!, sid)!.base, nf) : parseLength(t);
      if (v === null || v <= 0) return false;
      return this.change(bid, (x) => {
        const so = findSolid(x, sid)!;
        so.height = v;
        // A building that is only this volume: its floors fill the typed height (a 3 m house is one
        // 3 m floor; before, a 3.4 m floor stood in a 3 m wall and an 8 m shed had one 3.4 m floor).
        if (created && !sub && x.solids.length === 1 && so.base < 0.05) fillLevels(x, v);
      }, `Height ${fmt(v)} m.`);
    });
    this.setTool('select');
    this.context = bid;
    this.select({ building: bid, solids: [sid], face: { kind: 'top' } });
  }

  // ── Components ───────────────────────────────────────────────────────
  // ── Massing blocks ───────────────────────────────────────────────────
  startBlock(id: string): void {
    this.setTool('block');
    this.blockId = id;
    const def = BLOCKS.find((b) => b.id === id);
    this.updateHint(def ? `${def.name}: on the ground creates a building; on a roof stacks; on a wall attaches aligned. X toggles add/subtract. Esc finishes.` : undefined);
    this.emit();
  }

  /** Where the block would land: ground, top (stacks) or face (attaches aligned). */
  private blockPlacement(e: { clientX: number; clientY: number }): { b: Building3 | null; at: BlockPlacement; label: string } | null {
    const def = BLOCKS.find((x) => x.id === this.blockId);
    if (!def) return null;
    const hit = this.pickAt(e);
    const op: Solid['op'] = this.drawMode === 'subtract' ? 'subtract' : 'add';
    const lvOf = (b: Building3) => [...b.levels].sort((p, q) => p.elevation - q.elevation)[1]?.height ?? b.levels[0]?.height ?? 3;
    if (hit?.face && hit.building) {
      const b = hit.building;
      const lvH = lvOf(b);
      const s = findSolid(b, hit.face.solid);
      const local = hit.point.clone().applyMatrix4(this.view.buildingMatrix(b).invert());
      if ((hit.face.kind === 'top' || hit.face.kind === 'parapet' || hit.face.kind === 'coping' || hit.face.kind === 'roof') && s && hit.normal.y > 0.5) {
        const p = this.snapLocal([local.x, local.z]);
        const top = s.base + s.height;
        return { b, at: { origin: [p[0], p[1] - def.d / 2], ux: [1, 0], uz: [0, 1], base: op === 'add' ? top : top - def.levels * lvH, levelHeight: lvH, op }, label: op === 'add' ? 'Stack on the volume' : 'Cut from above' };
      }
      if (hit.face.kind === 'side' && hit.face.frame && s) {
        const fr = hit.face.frame;
        // Block back on the face plane, width along it (perfect fit).
        let along = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.z - fr.o[2]) * fr.u[2];
        if (this.infer.enabled) along = Math.round(along / 0.5) * 0.5;
        const ds = along - fr.s0;
        const ox = fr.o[0] + fr.u[0] * ds,
          oz = fr.o[2] + fr.u[2] * ds;
        const nl = Math.hypot(fr.n[0], fr.n[2]) || 1;
        const n: Vec2 = [fr.n[0] / nl, fr.n[2] / nl];
        const inward = op === 'subtract';
        // Add: grows outward (wing, closed porch). Subtract: goes into the wall (arch, niche).
        const uz: Vec2 = inward ? [-n[0], -n[1]] : n;
        const ux: Vec2 = inward ? [fr.u[0], fr.u[2]] : [-fr.u[0], -fr.u[2]];
        const origin: Vec2 = inward ? [ox + n[0] * 0.3, oz + n[1] * 0.3] : [ox, oz];
        const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation <= local.y + 0.01).pop();
        const base = def.id === 'arch' ? s.base - 0.3 : (lv?.elevation ?? s.base);
        return { b, at: { origin, ux, uz, base, levelHeight: lvH, op, attached: true, ...(def.id === 'arch' ? { d: 2.5 } : {}) }, label: inward ? 'Cut into the wall' : 'Attach to the wall' };
      }
    }
    const b = this.store.building(this.context) ?? null;
    const sn = this.infer.snap(e, 0, null, null);
    if (!sn) return null;
    const p: Vec2 = b ? toLocal(b, [sn.p.x, sn.p.z]) : [sn.p.x, sn.p.z];
    return { b, at: { origin: [p[0], p[1] - def.d / 2], ux: [1, 0], uz: [0, 1], base: 0, levelHeight: b ? lvOf(b) : 3, op }, label: b ? 'On the building ground' : 'New building' };
  }

  private snapLocal(p: Vec2): Vec2 {
    if (!this.infer.enabled) return p;
    const g = this.infer.grid || 0.5;
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  }

  private blockAt(e: PointerEvent, commit: boolean): void {
    const def = BLOCKS.find((x) => x.id === this.blockId);
    const pl = this.blockPlacement(e);
    const old = this.snapOverlay.getObjectByName('block') as THREE.LineSegments | undefined;
    if (old) {
      this.snapOverlay.remove(old);
      old.geometry.dispose();
    }
    if (!def || !pl) return this.view.mark();
    const s = blockSolid(def, pl.at);
    if (!commit) {
      const r = solidRings(s);
      const M = pl.b ? this.view.buildingMatrix(pl.b) : new THREE.Matrix4();
      const W = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]).applyMatrix4(M);
      const pos: number[] = [];
      const n = r.outer.pts.length;
      for (let i = 0; i < n; i++) {
        const a = r.outer.pts[i]!,
          c = r.outer.pts[(i + 1) % n]!;
        pos.push(...W(a, r.base).toArray(), ...W(c, r.base).toArray());
        pos.push(...W(r.topOuter[i]!, r.top).toArray(), ...W(r.topOuter[(i + 1) % n]!, r.top).toArray());
        if (!r.outer.segs[i]!.curved || i % 4 === 0) pos.push(...W(a, r.base).toArray(), ...W(r.topOuter[i]!, r.top).toArray());
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: pl.at.op === 'add' ? '#e2702a' : '#c026d3', depthTest: false }));
      ls.name = 'block';
      ls.renderOrder = 25;
      this.snapOverlay.add(ls);
      this.showDim(`${pl.label} · ${fmt(def.w)} × ${fmt(pl.at.d ?? def.d)} m`, e);
      this.view.mark();
      return;
    }
    let b = pl.b;
    if (!b) {
      if (pl.at.op === 'subtract') return this.toast('To subtract, drop the block on a building.');
      b = newBuilding({ name: tr(`Building ${this.project.buildings.length + 1}`), position: [pl.at.origin[0], pl.at.origin[1] + def.d / 2], levels: levelsFor(Math.max(1, def.levels)) , ...(activeLayer(this.project) ? { layer: activeLayer(this.project) } : {}) });
      const s0 = blockSolid(def, { ...pl.at, origin: [0, -def.d / 2] });
      b.solids.push(s0);
      this.store.project.buildings.push(b);
      this.store.commit([b.id], `${def.name} created.`);
      this.context = b.id;
      this.select({ building: b.id, solids: [s0.id] });
      this.toast(`${def.name} created. Click again for one more; Esc finishes.`);
      return;
    }
    this.change(b.id, (x) => {
      x.solids.push(s);
      // More floors when the block goes beyond the building levels.
      const top = s.base + s.height;
      const lv = [...x.levels].sort((p, q) => p.elevation - q.elevation);
      const last = lv[lv.length - 1];
      const typ = lv[1]?.height ?? last?.height ?? 3;
      if (s.op === 'add' && last && top > last.elevation + last.height + 0.3) adoptLevels(x, levelsFor(Math.round((top - (lv[0]?.height ?? typ)) / typ) + 1, typ, lv[0]?.height ?? typ));
    }, `${def.name} ${s.op === 'add' ? 'added' : 'subtracted'}.`);
    this.context = b.id;
    this.select({ building: b.id, solids: [s.id] });
  }

  // ── Tape and dimensions ──────────────────────────────────────────────
  private tapeFrom: THREE.Vector3 | null = null;
  /** Dimensions pinned to the model (this session). */
  dims: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];

  private tapePoint(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const hit = this.pickAt(e);
    if (hit) {
      // Snaps to nearby vertices on the plane of the hit point.
      const sn = this.infer.snap(e, hit.point.y, this.tapeFrom, null, 10);
      if (sn && sn.kind !== 'grid' && sn.kind !== 'free') return sn.p;
      return hit.point;
    }
    return this.infer.snap(e, this.tapeFrom?.y ?? 0, this.tapeFrom, null)?.p ?? null;
  }

  private tapeAt(e: PointerEvent, commit: boolean): void {
    const p = this.tapePoint(e);
    const old = this.snapOverlay.getObjectByName('tape') as THREE.Line | undefined;
    if (old) {
      this.snapOverlay.remove(old);
      old.geometry.dispose();
    }
    if (!p) return;
    if (commit) {
      if (!this.tapeFrom) {
        this.tapeFrom = p.clone();
        return;
      }
      this.dims.push({ a: this.tapeFrom.clone(), b: p.clone() });
      this.toast(`Dimension: ${fmt(this.tapeFrom.distanceTo(p))} m. It stays in the model; Shift+Delete clears the dimensions.`);
      this.tapeFrom = null;
      this.drawDims();
      return;
    }
    if (!this.tapeFrom) {
      this.showDim('Click the first point', e);
      return;
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([this.tapeFrom, p]), new THREE.LineBasicMaterial({ color: '#1f2326', depthTest: false }));
    l.name = 'tape';
    l.renderOrder = 26;
    this.snapOverlay.add(l);
    const d = p.clone().sub(this.tapeFrom);
    this.showDim(`${fmt(d.length())} m  (Δx ${fmt(Math.abs(d.x))} · Δz ${fmt(Math.abs(d.z))} · Δy ${fmt(Math.abs(d.y))})`, e);
    this.view.mark();
  }

  /** First point of a cut across a top (local plan point on its edge). */
  private cutFrom: { bid: ID; sid: ID; a: Vec2; y: number } | null = null;

  /**
   * Cut tool (SketchUp: a line across a face splits it; Blender Knife). On a
   * wall: a vertical line through the pointer splits the side in two faces
   * (Shift: a horizontal one splits the volume at that height). On a top: two
   * points of its edge cut the volume in two. Snaps to the middle, the grid and
   * the floors; the measure box takes the exact value.
   */
  private cutAt(e: PointerEvent, commit: boolean): void {
    const old = this.snapOverlay.getObjectByName('cut') as THREE.Object3D | undefined;
    if (old) {
      this.snapOverlay.remove(old);
      old.traverse((o) => (o as THREE.Line).geometry?.dispose());
      // The line goes from the screen too when nothing replaces it (it stayed over a window).
      this.view.mark();
    }
    const show = (pts: THREE.Vector3[], dot = false) => {
      const g = new THREE.Group();
      g.name = 'cut';
      if (pts.length > 1) {
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
        l.renderOrder = 27;
        g.add(l);
      }
      if (dot)
        for (const p of [pts[0]!, pts[pts.length - 1]!]) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 * Math.max(1, this.view.worldPerPixel(p) * 8), 10, 8), new THREE.MeshBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
          m.position.copy(p);
          m.renderOrder = 27;
          g.add(m);
        }
      this.snapOverlay.add(g);
      this.view.mark();
    };
    // Second point of a cut across a top: on the same volume's edge, at the same height.
    if (this.cutFrom) {
      const cf = this.cutFrom;
      const b = this.store.building(cf.bid),
        s = b && findSolid(b, cf.sid);
      if (!b || !s) return void (this.cutFrom = null);
      const M = this.view.buildingMatrix(b);
      const W = (q: Vec2) => new THREE.Vector3(q[0], cf.y + 0.03, q[1]).applyMatrix4(M);
      const hp = this.view.onPlane(e, cf.y + (b.elevation ?? 0));
      const z = hp ? cutEdgePoint(s, toLocal(b, [hp.x, hp.z]), cf.a, this.infer.enabled ? this.infer.grid : 0) : null;
      if (!z) {
        show([W(cf.a)], true);
        return this.showDim('Click a point of the other edge (Esc cancels)', e);
      }
      show([W(cf.a), W(z.p)], true);
      this.showDim(`${fmt(Math.hypot(z.p[0] - cf.a[0], z.p[1] - cf.a[1]))} m`, e);
      if (!commit) return;
      this.cutFrom = null;
      let made: ID | null = null;
      const ok = this.change(b.id, (x) => !!(made = splitByLine(x, findSolid(x, cf.sid)!, cf.a, z.p)?.id ?? null), 'Volume cut in two (each piece is a volume of its own).');
      if (!ok) this.toast('That line does not cut this top: both ends on its edge, the line inside (no holes, no curved sides).');
      // The new piece is chosen: the cut shows (nothing draws the line between two pieces of the same finish).
      else if (made) {
        this.context = b.id;
        this.select({ building: b.id, solids: [made] });
      }
      return this.cutAt(e, false);
    }
    // Through the windows: a facade is mostly windows, and the cut is on the wall behind them.
    const hit = this.pickBody(e);
    const b = hit?.building;
    const s = b && hit?.face ? findSolid(b, hit.face.solid) : undefined;
    if (!b || !hit?.face || !s || s.op !== 'add') return this.showDim('Click a wall or a top', e);
    const M = this.view.buildingMatrix(b);
    const ly = hit.point.y - (b.elevation ?? 0);
    if (hit.face.kind === 'side' && hit.face.edge) {
      if (hit.face.edge.endsWith(':c')) return this.showDim('A rounded corner: cut one of its sides', e);
      const loc = locateVertex(s, hit.face.edge);
      const curve = sideCurve(s, hit.face.edge);
      if (!loc || !curve) return this.showDim('Click a wall or a top', e);
      const len = curve.len;
      const at = curve.at;
      const W = (q: Vec2, y: number) => new THREE.Vector3(q[0], y, q[1]).applyMatrix4(M);
      const edge = loc.ring[loc.i]!.id;
      if (e.shiftKey) {
        // Across: the volume splits at this height (floors and 10 cm snap).
        let y = ly - s.base;
        const fl = b.levels.map((l) => l.elevation - s.base).find((h) => Math.abs(h - y) < 0.3);
        y = fl ?? (this.infer.enabled ? Math.round(y / 0.1) * 0.1 : y);
        const k = Math.max(2, Math.ceil(len / 0.5));
        show(Array.from({ length: k + 1 }, (_, i) => W(at((len * i) / k), s.base + y)));
        // From the ground first (audit B2: 7.8 m on a volume raised 20 m read as the height).
        this.showDim(`${fmt(s.base + y)} m from the ground (${fmt(y)} m up this volume) · ${fmt(s.height - y)} m above`, e);
        const apply = (v: number) => {
          let made: ID | null = null;
          const ok = this.change(b.id, (x) => !!(made = splitAtHeight(x, findSolid(x, s.id)!, v)?.id ?? null), `Volume cut at ${fmt(v)} m.`);
          if (ok && made) {
            this.context = b.id;
            this.select({ building: b.id, solids: [made] });
          }
          return ok;
        };
        this.setMeasure('Cut height (above the volume base)', (t) => {
          const v = parseLength(t);
          return v !== null && apply(v);
        });
        if (commit && !apply(y)) this.toast('Too close to the base or the top to cut there.');
        return;
      }
      const lp = toLocal(b, [hit.point.x, hit.point.z]);
      let u = curve.param(lp);
      // The middle first, then the grid.
      if (Math.abs(u - len / 2) < Math.max(0.25, this.view.worldPerPixel(hit.point) * 10)) u = len / 2;
      else if (this.infer.enabled) u = Math.round(u / this.infer.grid) * this.infer.grid;
      u = Math.max(0.1, Math.min(len - 0.1, u));
      show([W(at(u), s.base), W(at(u), s.base + s.height)]);
      this.showDim(`${fmt(u)} m · ${fmt(len - u)} m${Math.abs(u - len / 2) < 1e-6 ? ' (middle)' : ''}`, e);
      const apply = (v: number) => {
        let made: ID | null = null;
        const ok = this.change(b.id, (x) => !!(made = splitSideAt(x, findSolid(x, s.id)!, edge, v)), 'Face cut in two: each part is a face of its own.');
        if (ok && made) {
          this.context = b.id;
          this.select({ building: b.id, solids: [s.id], face: { kind: 'side', edge: made } });
        }
        return ok;
      };
      this.setMeasure('Cut at', (t) => {
        const v = parseLength(t);
        return v !== null && apply(v);
      });
      if (commit && !apply(u)) this.toast('Too close to a corner to cut there.');
      return;
    }
    // The edge of a top is often its parapet: it starts the cut too.
    if (hit.face.kind === 'top' || hit.face.kind === 'roof' || hit.face.kind === 'parapet' || hit.face.kind === 'coping') {
      const y = s.base + s.height;
      const hp = this.view.onPlane(e, y + (b.elevation ?? 0));
      const p = hp ? cutEdgePoint(s, toLocal(b, [hp.x, hp.z]), null, this.infer.enabled ? this.infer.grid : 0) : null;
      if (!p) return this.showDim('Start on the edge of the top', e);
      const W = (q: Vec2) => new THREE.Vector3(q[0], y + 0.03, q[1]).applyMatrix4(M);
      show([W(p.p)], true);
      this.showDim('Click the first point of the cut', e);
      if (commit) this.cutFrom = { bid: b.id, sid: s.id, a: p.p, y };
      return;
    }
    this.showDim('Click a wall or a top', e);
  }

  /** Draws the pinned dimensions (lines with ticks and labels). */
  drawDims(): void {
    const old = this.snapOverlay.getObjectByName('dims') as THREE.LineSegments | undefined;
    if (old) {
      this.snapOverlay.remove(old);
      old.geometry.dispose();
    }
    this.shell.view.querySelectorAll('.f3-dimlbl').forEach((x) => x.remove());
    if (!this.dims.length) return this.view.mark();
    const pos: number[] = [];
    for (const d of this.dims) pos.push(...d.a.toArray(), ...d.b.toArray());
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1f2326', depthTest: false }));
    ls.name = 'dims';
    ls.renderOrder = 26;
    this.snapOverlay.add(ls);
    for (const d of this.dims) {
      const m = d.a.clone().add(d.b).multiplyScalar(0.5);
      const sp = this.view.toScreen(m);
      if (sp.behind) continue;
      const el = document.createElement('div');
      el.className = 'f3-dim f3-dimlbl';
      el.textContent = `${fmt(d.a.distanceTo(d.b))} m`;
      el.style.left = `${sp.x}px`;
      el.style.top = `${sp.y}px`;
      this.shell.view.appendChild(el);
    }
    this.view.mark();
  }

  private placeHover(e: PointerEvent): void {
    const tf = this.placing ? typeById(this.placing, this.project) : undefined;
    if (tf && family(tf.family)?.host === 'path') return this.pathHover(e);
    const pl = this.placementAt(e);
    if (!pl) {
      this.removeGhost();
      return;
    }
    const key = JSON.stringify([this.placing, pl.frame]);
    if (this.ghost?.key === key) return;
    this.removeGhost();
    const t = typeById(this.placing!, this.project)!;
    const f = family(t.family)!;
    const params = resolveParams(f, t.params);
    const parts = emptyParts3();
    f.build(params, new FrameSink(parts, pl.frame, 0), { length: f.size(params)[0], reveal: 0.3, index: 0 });
    parts.tags.push({ family: f.id });
    const mesh = buildPartsMesh(parts, this.view.ctx, false);
    mesh.group.applyMatrix4(this.view.buildingMatrix(pl.b));
    mesh.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) m.renderOrder = 5;
    });
    this.view.overlay.add(mesh.group);
    this.ghost = { mesh, key };
    this.showDim(pl.label, e);
    this.view.mark();
  }

  private removeGhost(): void {
    if (!this.ghost) return;
    this.ghost.mesh.group.removeFromParent();
    this.ghost.mesh.dispose();
    this.ghost = null;
    this.view.mark();
  }

  /** Where the component would land under the pointer (face, ground or roof). */
  private placementAt(e: { clientX: number; clientY: number }): { b: Building3; host: Item['host']; frame: number[]; label: string } | null {
    if (!this.placing) return null;
    const t = typeById(this.placing, this.project);
    const f = t && family(t.family);
    if (!t || !f) return null;
    const params = resolveParams(f, t.params);
    const hit = this.pickAt(e);
    if (f.host === 'face') {
      if (!hit?.face || hit.face.kind !== 'side' || !hit.face.frame) return null;
      const b = hit.building;
      const fr = hit.face.frame;
      const local = hit.point.clone().applyMatrix4(this.view.buildingMatrix(b).invert());
      let s = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.y - fr.o[1]) * fr.u[1] + (local.z - fr.o[2]) * fr.u[2];
      const solid = findSolid(b, hit.face.solid)!;
      // Sill from the level under the pointer.
      const yAbs = local.y;
      const lv = [...b.levels].sort((x, y) => x.elevation - y.elevation).filter((l) => l.elevation <= yAbs + 0.01).pop();
      const sill = f.sill?.(params) ?? 0.9;
      let y = (lv ? lv.elevation : solid.base) + sill - solid.base;
      if (e && 'altKey' in e && (e as PointerEvent).altKey) y = (local.x - fr.o[0]) * fr.v[0] + (local.y - fr.o[1]) * fr.v[1] + (local.z - fr.o[2]) * fr.v[2] - f.size(params)[1] / 2;
      if (this.infer.enabled) s = Math.round(s / 0.1) * 0.1;
      const ds = s - fr.s0;
      const p: Vec3 = [fr.o[0] + fr.u[0] * ds + fr.v[0] * y, fr.o[1] + fr.u[1] * ds + fr.v[1] * y, fr.o[2] + fr.u[2] * ds + fr.v[2] * y];
      return { b, host: { kind: 'face', solid: solid.id, edge: hit.face.edge!, u: s, y }, frame: faceMatrix(p, fr.u, fr.v, fr.n), label: `${fmt(s)} m along · ${fmt(y + solid.base)} m high` };
    }
    if (f.host === 'roof' && hit?.face && (hit.face.kind === 'roof' || hit.face.kind === 'top')) {
      const b = hit.building;
      const local = hit.point.clone().applyMatrix4(this.view.buildingMatrix(b).invert());
      return { b, host: { kind: 'roof', solid: hit.face.solid, p: [local.x, local.z], rot: 0 }, frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, local.x, local.y, local.z, 1], label: 'On the roof' };
    }
    // Free: on the ground (or on the flat top under the pointer). It belongs to the building under it,
    // else the one being edited, else the nearest one (before: the first of the project, wherever it was).
    const onTop = !!hit?.face && hit.normal.y > 0.9;
    const y = onTop ? hit!.point.y : 0;
    const sn = this.infer.snap(e, y, null, null);
    if (!sn) return null;
    // On a flat top it belongs to that building; on the ground the ray may have crossed a roof in front
    // of the point, so it is the building being edited or the nearest one to where it stands.
    const b = (onTop ? hit!.building : undefined) ?? this.ownerAt(sn.p.x, sn.p.z);
    const l = toLocal(b, [sn.p.x, sn.p.z]);
    return { b, host: { kind: 'free', p: [l[0], y, l[1]], rot: 0 }, frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, l[0], y, l[1], 1], label: `${fmt(l[0])}; ${fmt(l[1])}` };
  }

  private pathDraft: { pts: Vec3[] } | null = null;

  /**
   * Drawing a path part (fence, wall, railing): the points so far and the segment to the pointer as a
   * line, with the segment length and the total next to the cursor (before, a ghost part and the
   * meaningless "0; 0" of a building not made yet).
   */
  private pathHover(e: PointerEvent): void {
    const old = this.snapOverlay.getObjectByName('pathdraft');
    if (old) {
      this.snapOverlay.remove(old);
      (old as THREE.Line).geometry.dispose();
    }
    this.removeGhost();
    const sn = this.infer.snap(e, 0, this.pathDraft?.pts.length ? new THREE.Vector3(...this.pathDraft.pts[this.pathDraft.pts.length - 1]!) : null, null);
    if (!sn) return;
    const pts = [...(this.pathDraft?.pts ?? []).map((p) => new THREE.Vector3(p[0], 0.05, p[2])), new THREE.Vector3(sn.p.x, 0.05, sn.p.z)];
    if (pts.length > 1) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
      l.name = 'pathdraft';
      l.renderOrder = 27;
      this.snapOverlay.add(l);
    }
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i]!.distanceTo(pts[i - 1]!);
    const seg = pts.length > 1 ? pts[pts.length - 1]!.distanceTo(pts[pts.length - 2]!) : 0;
    this.showDim(pts.length > 1 ? `${fmt(seg)} m · total ${fmt(total)} m · Enter ends` : 'Click the first point', e);
    this.view.mark();
  }

  private clearPathDraft(): void {
    this.pathDraft = null;
    const old = this.snapOverlay.getObjectByName('pathdraft');
    if (old) {
      this.snapOverlay.remove(old);
      (old as THREE.Line).geometry.dispose();
      this.view.mark();
    }
    this.shell.dim.hidden = true;
  }

  placeAt(e: PointerEvent): void {
    if (!this.placing) return;
    const t = typeById(this.placing, this.project);
    const f = t && family(t.family);
    if (!t || !f) return;
    if (f.host === 'path') {
      // Points in the world; the owner is decided when the path ends (the building being edited, the
      // nearest one to the first point, or a new site there).
      const last = this.pathDraft?.pts[this.pathDraft.pts.length - 1];
      const sn = this.infer.snap(e, 0, last ? new THREE.Vector3(...last) : null, null);
      if (!sn) return;
      this.pathDraft ??= { pts: [] };
      this.pathDraft.pts.push([sn.p.x, 0, sn.p.z]);
      this.toast(`${this.pathDraft.pts.length} point(s). Enter finishes.`);
      this.pathHover(e);
      return;
    }
    const pl = this.placementAt(e);
    if (!pl) return this.toast(f.host === 'face' ? 'Point at a wall.' : 'Point at the ground or a roof.');
    const it: Item = { id: uid(), type: t.id, params: {}, host: pl.host };
    this.removeGhost();
    this.shell.dim.hidden = true;
    // Say where it went when it was not obvious (no building under the pointer and none being edited).
    const fresh = !this.store.building(pl.b.id);
    const owner = this.context === pl.b.id ? '' : fresh ? ` It belongs to a new building, ${pl.b.name} (no building nearby).` : ` It belongs to ${pl.b.name}.`;
    this.adopt(pl.b);
    this.change(pl.b.id, (b) => void b.items.push(it), `${t.name} placed.${owner} Click again for one more; Esc finishes.`);
    this.context = pl.b.id;
    this.select({ building: pl.b.id, item: it.id });
    this.lastItem = it.id;
    this.setMeasure('Copies', (txt) => {
      const m = /^(\d+)\s*x$/i.exec(txt.trim());
      if (!m) return false;
      const n = parseInt(m[1]!, 10);
      return this.change(pl.b.id, (b) => {
        const x = b.items.find((q) => q.id === it.id);
        if (x) x.array = { along: { mode: 'spacing', value: (f.size(resolveParams(f, t.params))[0] ?? 1) + 1, count: n } };
      }, `${n} copies in a row.`);
    });
  }

  private lastItem: ID | null = null;

  finishPath(): void {
    const pd = this.pathDraft;
    this.clearPathDraft();
    if (!pd || pd.pts.length < 2 || !this.placing) return;
    const t = typeById(this.placing, this.project)!;
    const first = pd.pts[0]!;
    const ob = this.ownerAt(first[0], first[2]);
    const fresh = !this.store.building(ob.id);
    const points = pd.pts.map((p) => {
      const l = toLocal(ob, [p[0], p[2]]);
      return [l[0], 0, l[1]] as Vec3;
    });
    const it: Item = { id: uid(), type: t.id, params: {}, host: { kind: 'path', points } };
    this.adopt(ob);
    this.context = ob.id;
    this.change(ob.id, (b) => void b.items.push(it), `${t.name} created${fresh ? ` in a new building, ${ob.name} (no building nearby)` : this.context === ob.id ? '' : ` (it belongs to ${ob.name})`}.`);
    this.select({ building: ob.id, item: it.id });
  }

  // ── Painting ─────────────────────────────────────────────────────────
  private paintAt(e: PointerEvent): void {
    const hit = this.pickAt(e);
    if (hit?.part) return this.paintPart(hit.building, hit.part, e);
    if (!hit?.face) return;
    const b = hit.building;
    const f = hit.face;
    const s = findSolid(b, f.solid);
    if (!s) return;
    // Which volume material each face kind uses (paint and eyedropper).
    const edge = f.edge ? (f.edge.endsWith(':c') ? f.edge.slice(0, -2) : f.edge) : undefined;
    const slot = (k: string): 'wall' | 'roof' | 'trim' | 'base' | 'floor' | 'edge' =>
      k === 'roof' ? 'roof' : k === 'top' ? 'floor' : k === 'fascia' || k === 'soffit' || k === 'parapet' || k === 'coping' || k === 'band' || k === 'reveal' ? 'trim' : k === 'plinth' || k === 'bottom' ? 'base' : (k === 'side' || k === 'gable' || k === 'bevel') && edge ? 'edge' : 'wall';
    const where = slot(f.kind);
    if (e.altKey) {
      const ref = where === 'edge' ? (s.edges[edge!]?.material ?? s.materials.wall) : where === 'floor' ? (s.materials.floor ?? s.materials.base) : s.materials[where];
      this.paintMat = structuredClone(ref);
      this.toast('Material copied to the bucket.');
      this.emit();
      return;
    }
    this.change(b.id, (x) => {
      const so = findSolid(x, s.id)!;
      const m = structuredClone(this.paintMat);
      // As in SketchUp: a click paints the face; Shift paints the walls of the whole volume.
      if (where === 'edge' && e.shiftKey) {
        so.materials.wall = m;
        for (const es of Object.values(so.edges)) delete es.material;
      } else if (where === 'edge') (so.edges[edge!] ??= {}).material = m;
      else so.materials[where] = m;
    }, where === 'edge' && !e.shiftKey ? 'Face painted (Shift paints the whole volume).' : 'Painted.');
  }

  /**
   * The bucket on a window, door, awning or free part paints its main color (and finish) like SketchUp
   * paints a component: a facade part paints its rule (every one placed by it), a free part only itself.
   * Alt copies the part's color into the bucket. (It used to do nothing, without a word.)
   */
  private paintPart(b: Building3, tag: { family: string; rule?: ID; solid?: ID; item?: ID }, e: PointerEvent): void {
    const fam = family(tag.family);
    const defs = fam?.params ?? [];
    const colors = defs.filter((d) => d.kind === 'color');
    const color = (['color', 'frameColor', 'bodyColor', 'postColor', 'trimColor'].map((k) => colors.find((d) => d.key === k)).find(Boolean) ?? colors[0])?.key;
    const finish = defs.find((d) => d.kind === 'finish' && color && d.key === color.replace(/Color$/, 'Finish').replace(/^color$/, 'finish'))?.key;
    if (!fam || (!color && !finish)) return this.toast('This part has no color to paint.');
    const rule = tag.rule && tag.solid ? findSolid(b, tag.solid)?.facade.find((f) => f.id === tag.rule) : undefined;
    const item = tag.item ? b.items.find((i) => i.id === tag.item) : undefined;
    if (!rule && !item) return;
    const typeId = rule?.type ?? item!.type;
    const t = typeById(typeId, this.project);
    const now = resolveParams(fam, t?.params, rule ? rule.params : item!.params);
    if (e.altKey) {
      this.paintMat = { ...structuredClone(this.paintMat), ...(color ? { color: String(now[color]) } : {}), ...(finish ? { finish: String(now[finish]) } : {}) };
      this.toast('Part color copied to the bucket.');
      this.emit();
      return;
    }
    const m = this.paintMat;
    const set = (p: Record<string, unknown>) => {
      if (color) p[color] = m.color;
      if (finish && FINISHES.some((f) => f.id === m.finish)) p[finish] = m.finish;
    };
    this.change(b.id, (x) => {
      if (rule) {
        const r = findSolid(x, tag.solid!)!.facade.find((f) => f.id === rule.id)!;
        set((r.params ??= {}) as Record<string, unknown>);
      } else set((x.items.find((i) => i.id === item!.id)!.params ??= {}) as Record<string, unknown>);
    }, rule ? `${t?.name ?? 'Parts'} painted: every one of this facade rule.` : `${t?.name ?? 'Part'} painted.`);
  }

  // ── On-screen inference ──────────────────────────────────────────────
  private showSnap(s: Snap, e: { clientX: number; clientY: number }): void {
    this.lastSnap = s;
    this.clearSnap(false);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: s.color, depthTest: false }));
    dot.position.copy(s.p);
    dot.scale.setScalar(this.view.worldPerPixel(s.p) * 5);
    dot.renderOrder = 40;
    dot.name = 'snap';
    this.snapOverlay.add(dot);
    if (s.line) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(s.line), new THREE.LineDashedMaterial({ color: s.color, dashSize: 0.4, gapSize: 0.25, depthTest: false }));
      l.computeLineDistances();
      l.renderOrder = 39;
      l.name = 'snapline';
      this.snapOverlay.add(l);
    }
    const tip = this.shell.snap;
    tip.hidden = !s.label;
    tip.textContent = s.label;
    tip.style.background = s.color;
    const r = this.shell.view.getBoundingClientRect();
    tip.style.left = `${e.clientX - r.left}px`;
    tip.style.top = `${e.clientY - r.top}px`;
    this.view.mark();
  }

  private clearSnap(hideTip = true): void {
    for (const n of ['snap', 'snapline']) {
      const o = this.snapOverlay.getObjectByName(n) as THREE.Mesh | undefined;
      if (o) {
        this.snapOverlay.remove(o);
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    }
    if (hideTip) this.shell.snap.hidden = true;
    this.view.mark();
  }

  private showDim(text: string, e: { clientX: number; clientY: number }): void {
    const d = this.shell.dim;
    const r = this.shell.view.getBoundingClientRect();
    d.hidden = false;
    d.textContent = text;
    // Kept inside the view: a long label next to an edge was cut off (it is centered on the pointer).
    const half = d.offsetWidth / 2;
    const x = Math.max(half + 6, Math.min(r.width - half - 6, e.clientX - r.left));
    d.style.left = `${x}px`;
    d.style.top = `${Math.max(d.offsetHeight / 2 + 4, e.clientY - r.top - 28)}px`;
  }

  // ── Keyboard ─────────────────────────────────────────────────────────
  /** Last pointer position over the view (the typed value shows next to it). */
  private pointerAt: { clientX: number; clientY: number } | null = null;

  private bindKeys(): void {
    const vcb = this.shell.status.vcb;
    // The value being typed shows next to the cursor too (Fusion's dynamic input, SketchUp's VCB):
    // the eyes stay on the model.
    this.view.renderer.domElement.addEventListener('pointermove', (e) => (this.pointerAt = { clientX: e.clientX, clientY: e.clientY }));
    vcb.addEventListener('input', () => {
      if (!this.pointerAt || !vcb.value.trim()) return;
      const v = parseLength(vcb.value);
      this.showDim(`${this.shell.status.vcbLabel.textContent}: ${vcb.value}${v !== null && /[-+*/()]/.test(vcb.value.slice(1)) ? ` = ${fmt(v)} m` : ''} · Enter`, { clientX: this.pointerAt.clientX, clientY: this.pointerAt.clientY + 44 });
    });
    vcb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const ok = this.measure?.apply(vcb.value) ?? false;
        if (!ok) this.toast('Value not recognized for ' + (this.measure?.label ?? 'measure') + '.');
        vcb.value = '';
        this.shell.dim.hidden = true;
        this.view.renderer.domElement.focus();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        vcb.value = '';
        this.view.renderer.domElement.focus();
      }
      e.stopPropagation();
    });
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (!this.shell.root.isConnected) return;
      // Ctrl+K opens the command search from anywhere, a text field included (VS Code, Figma, Linear).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !this.walk.active) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        this.command('palette');
        return;
      }
      if (target.closest('input,select,textarea')) return;
      // Walking owns the keyboard (WASD, Shift, Space, Esc).
      if (this.walk.active) return;
      const k = e.key.toLowerCase();
      // Numeric keypad: standard views (Blender: 1 front, 3 right, 7 top, Ctrl for the opposite side;
      // 0 the home three-quarter view). The digits of the main row keep their meaning.
      if (e.code.startsWith('Numpad') && !this.measure && /^Numpad[01357]$/.test(e.code)) {
        const n = e.code.slice(6);
        if (n === '5') {
          this.view.setParallel(!this.view.parallel);
          this.toast(this.view.parallel ? 'Parallel view (no perspective) · Numpad 5 goes back.' : 'Perspective view.');
          this.emit();
          e.preventDefault();
          return;
        }
        const back = e.ctrlKey;
        if (n === '0') this.view.animateTo(1, 0.75, 380, () => this.view.frameAll());
        // Top: north up, the plan axes square with the screen (Blender Numpad 7), not the current azimuth.
        else if (n === '7') this.view.animateTo(0.001, back ? Math.PI : 0);
        else this.view.animateTo(Math.PI / 2 - 0.02, n === '1' ? (back ? Math.PI : 0) : back ? -Math.PI / 2 : Math.PI / 2);
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') this.command(e.shiftKey ? 'redo' : 'undo');
        else if (k === 'y') this.command('redo');
        else if (k === 'd') this.duplicate();
        else if (k === 'c') this.copy();
        else if (k === 'v') this.paste();
        else if (k === 's') this.saveRequested?.();
        else if (k === 'k') this.command('palette');
        else if (k === 'a') this.selectAll();
        else if (k === 'i') this.selectAll(true);
        else return;
        e.preventDefault();
        return;
      }
      // Numbers and separators go to the measure box.
      // 1 / 2 / 3: vertex, edge, face (Blender); the same key again goes back to volumes.
      if ((e.key === '1' || e.key === '2' || e.key === '3') && !this.measure && !e.altKey) {
        this.setElemMode(e.key === '1' ? 'vertex' : e.key === '2' ? 'edge' : 'face');
        e.preventDefault();
        return;
      }
      if (/^[0-9.,;*/-]$/.test(e.key) && this.measure) {
        vcb.focus();
        return;
      }
      if (this.sel.elems.length && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown')) {
        this.selectElems(k.slice(5) as 'left');
        e.preventDefault();
        return;
      }
      if (k === 'enter' && this.polyline.finish()) return;
      if (k === 'escape' && this.polyline.active) return this.polyline.cancel();
      if (k === 'enter' && this.tool === 'street' && this.site.enter()) return;
      if (k === 'enter' && this.tool === 'stair' && this.stair.enter()) return;
      if (k === 'enter' && this.tool === 'walls' && this.wallsTool.enter()) return;
      if (k === 'enter' && this.tool === 'iwall') {
        this.iwallLast = null;
        this.toast('Wall chain ended: click to start another.');
        return;
      }
      if (k === 'escape') {
        this.iwallLast = null;
        if (this.tool !== 'select') {
          this.clearPathDraft();
          this.setTool('select');
        } else this.exitContext();
      }
      else if (k === 'delete' && e.shiftKey) {
        this.dims = [];
        this.drawDims();
        this.toast('Dimensions cleared.');
      } else if (k === 'delete' || k === 'backspace') {
        if (this.draft && (this.tool === 'polygon' || this.tool === 'spline') && this.draft.points.length > 1) this.draft.points.pop();
        else if (k === 'delete' && !this.sel.building && this.deleteSite()) return;
        else if (k === 'delete') this.remove();
      } else if (k === 'enter') {
        if (this.tool === 'polygon' || this.tool === 'spline') this.finishPolygon();
        else if (this.pathDraft) this.finishPath();
      } else if (k === 'h') {
        if (e.altKey) this.showAll();
        else if (e.shiftKey) this.isolateSelection();
        else this.hideSelected();
      } else if (k === 'g' && e.shiftKey) this.selectSimilar();
      else if (k === 'v') this.setTool('select');
      else if (k === 'm') this.setTool('move');
      else if (k === 'q') this.setTool('rotate');
      else if (k === 's' && e.shiftKey) this.setTool('street');
      else if (k === 's') this.setTool('scale');
      else if (k === 'p' && e.shiftKey) this.setTool('spline');
      else if (k === 'p') this.setTool('push');
      else if (k === 'e') this.setTool('extrude');
      else if (k === 'r' && e.shiftKey) this.setTool('room');
      else if (k === 'f' && e.shiftKey) this.setTool('slab');
      else if (k === 'k' && e.shiftKey) this.setTool('column');
      else if (k === 'b' && e.shiftKey) this.setTool('beam');
      else if (k === 'w' && !e.shiftKey) this.setTool('walls');
      else if (k === 'r') this.setTool('rect');
      else if (k === 'c' && e.shiftKey) this.setTool('arc');
      else if (k === 'c') this.setTool('circle');
      else if (k === 'l' && e.shiftKey) this.setTool('lot');
      else if (k === 'l') this.setTool('polygon');
      else if (k === 'b') this.setTool('paint');
      else if (k === 't') this.setTool('tape');
      else if (k === 'u') this.setTool('cut');
      else if (k === 'o') this.setTool('opening');
      else if (k === 'i' && !e.shiftKey) this.setTool('iwall');
      else if (k === 'i') this.setTool('stair');
      else if (k === 'x') this.toggleDrawMode();
      else if (k === 'k') this.toggleLibrary();
      else if (k === 'f') this.frameSelection();
      else if (k === 'g') this.toggleSnap();
      else if (k === '?') this.helpRequested?.();
      else return;
      e.preventDefault();
    });
  }

  saveRequested: (() => void) | null = null;
  helpRequested: (() => void) | null = null;

  private bindTop(): void {
    this.shell.top.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => b.addEventListener('click', () => (this.topCommand?.(b.dataset.cmd!) ? undefined : this.command(b.dataset.cmd!))));
    this.shell.viewbar.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => b.addEventListener('click', () => this.command(b.dataset.cmd!)));
    this.shell.name.addEventListener('change', () => {
      this.store.project.name = this.shell.name.value.trim() || 'Untitled project';
      this.store.commit(null, '', false);
    });
  }

  topCommand: ((cmd: string) => boolean) | null = null;

  /** Edits an occurrence: values for this one only (instance) or for the type (all). */
  setItemParam(key: string, value: unknown, scope: 'instance' | 'type'): void {
    const b = this.activeBuilding(),
      it = this.activeItem();
    if (!b || !it) return;
    if (scope === 'instance') {
      this.change(b.id, (x) => {
        const y = x.items.find((q) => q.id === it.id)!;
        y.params[key] = value as never;
      });
      return;
    }
    this.editType(it.type, key, value);
  }

  /** One parameter of the selected occurrence back to its type's value (audit 1.11a). */
  resetItemParam(key: string): void {
    const b = this.activeBuilding(),
      it = this.activeItem();
    if (!b || !it || !(key in it.params)) return;
    this.change(b.id, (x) => void delete x.items.find((q) => q.id === it.id)!.params[key], 'Back to the type value.');
  }

  /** Changes a type value: every occurrence and rule using the type changes. */
  editType(typeId: ID, key: string, value: unknown): void {
    const p = this.store.project;
    let t = p.types.find((x) => x.id === typeId);
    if (!t) {
      const base = typeById(typeId, p);
      if (!base) return;
      // Built-in type: becomes a project copy with the same ID (every occurrence follows).
      t = { ...structuredClone(base), user: true };
      p.types.push(t);
    }
    t.params[key] = value as never;
    this.store.commit(null, 'Type changed (every occurrence).');
  }

  /** Creates a new type from the occurrence (Make unique). */
  makeUnique(): void {
    const b = this.activeBuilding(),
      it = this.activeItem();
    if (!b || !it) return;
    const base = typeById(it.type, this.project);
    if (!base) return;
    const n = { id: uid(), family: base.family, name: base.name + ' (unique)', params: { ...structuredClone(base.params), ...structuredClone(it.params) }, user: true, base: base.base ?? base.id };
    this.store.project.types.push(n);
    this.change(b.id, (x) => {
      const y = x.items.find((q) => q.id === it.id)!;
      y.type = n.id;
      y.params = {};
    }, 'This occurrence now has a type of its own.');
  }

  dispose(): void {
    this.view.dispose();
    this.shell.root.remove();
  }
}

/** The point, or the closest one inside the polygon (inset by `inset`). */
function clampInside(p: Vec2, poly: Vec2[], inset: number): Vec2 {
  const inside = (q: Vec2) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!,
        b = poly[j]!;
      if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  };
  if (inside(p)) return p;
  let best: Vec2 = p,
    bd = Infinity;
  let cx = 0,
    cz = 0;
  for (const q of poly) {
    cx += q[0] / poly.length;
    cz += q[1] / poly.length;
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const abx = b[0] - a[0],
      abz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz || 1)));
    const q: Vec2 = [a[0] + abx * t, a[1] + abz * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  // Slightly inward, toward the center.
  const dx = cx - best[0],
    dz = cz - best[1],
    l = Math.hypot(dx, dz) || 1;
  return [best[0] + (dx / l) * inset, best[1] + (dz / l) * inset];
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Midpoint of a side (arcs: middle of the arc). */
function midOf(v: { p: Vec2; bulge?: number }, n: { p: Vec2 }, chord = false): Vec2 {
  const m: Vec2 = [(v.p[0] + n.p[0]) / 2, (v.p[1] + n.p[1]) / 2];
  if (chord || !v.bulge) return m;
  const dx = n.p[0] - v.p[0],
    dz = n.p[1] - v.p[1];
  const c = Math.hypot(dx, dz) || 1;
  const sag = (v.bulge * c) / 2;
  // Right of the direction v → n.
  return [m[0] + (dz / c) * sag, m[1] - (dx / c) * sag];
}

/** The wall a facade part sits on: rule parts carry `edge:level:i` in their key, free parts their host. */
function partHostFace(b: Building3, tag: { solid?: ID; key?: string; item?: ID; rule?: ID }): { kind: 'side'; solid: ID; edge: ID } | undefined {
  if (tag.rule && tag.solid && tag.key) return { kind: 'side', solid: tag.solid, edge: keyParts(tag.key)?.edge ?? tag.key.split(':')[0]! };
  const host = tag.item ? b.items.find((i) => i.id === tag.item)?.host : undefined;
  return host?.kind === 'face' ? { kind: 'side', solid: host.solid, edge: host.edge } : undefined;
}

/** The point halfway along a chain of segments (a side sampled into pieces when curved). */
function halfway(segs: [Vec3, Vec3][]): Vec3 | null {
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  let rest = lens.reduce((x, y) => x + y, 0) / 2;
  for (let i = 0; i < segs.length; i++) {
    const [a, b] = segs[i]!;
    const L = lens[i]!;
    if (rest <= L || i === segs.length - 1) {
      const t = L > 0 ? Math.min(1, rest / L) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    rest -= L;
  }
  return null;
}

function ringCenter(r: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of r) c.add(p);
  return c.divideScalar(r.length);
}

function polyArea(pts: THREE.Vector3[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s / 2);
}

function screenDist(view: View, a: THREE.Vector3, b: THREE.Vector3): number {
  const p = view.toScreen(a),
    q = view.toScreen(b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export { splitEdge, removeVertex };

/** The selectable face a picked face stands for: a side, the top (roof included), the plinth, the parapet (coping included). */
function faceSelOf(f: FaceInfo): Editor3['sel']['face'] {
  if (f.kind === 'side') return { kind: 'side', edge: f.edge! };
  if (f.kind === 'top' || f.kind === 'roof') return { kind: 'top' };
  if (f.kind === 'plinth') return { kind: 'plinth' };
  if (f.kind === 'parapet' || f.kind === 'coping') return { kind: 'parapet' };
  return null;
}

/** The volume draws a parapet (flat or terrace roof with a height). */
function hasParapet(s: Solid): boolean {
  return s.op === 'add' && (s.roof.kind === 'terrace' || (s.roof.kind === 'flat' && s.roof.parapet > 0.01));
}

/** The volume draws a plinth (on the ground, with a height). */
function hasPlinth(s: Solid): boolean {
  return s.op === 'add' && s.plinth > 0.05 && s.base <= 0.3;
}

/**
 * Point of a volume's outline nearest to `q` (within 1.2 m), on a straight side,
 * snapped to its middle, to the line square to `from` (a cut straight across) or
 * to the grid along the side.
 */
function cutEdgePoint(s: Solid, q: Vec2, from: Vec2 | null, grid: number): { p: Vec2 } | null {
  const V = s.plan.outer;
  let best: { p: Vec2; d: number } | null = null;
  for (let i = 0; i < V.length; i++) {
    if (V[i]!.bulge) continue;
    const a = V[i]!.p,
      z = V[(i + 1) % V.length]!.p;
    const dx = z[0] - a[0],
      dz = z[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const tx = dx / len,
      tz = dz / len;
    let u = (q[0] - a[0]) * tx + (q[1] - a[1]) * tz;
    if (Math.abs(u - len / 2) < 0.3) u = len / 2;
    else if (from) {
      // Square across from the first point (the usual cut), else the grid.
      const uf = (from[0] - a[0]) * tx + (from[1] - a[1]) * tz;
      if (Math.abs(u - uf) < 0.3) u = uf;
      else if (grid) u = Math.round(u / grid) * grid;
    } else if (grid) u = Math.round(u / grid) * grid;
    u = Math.max(0.06, Math.min(len - 0.06, u));
    const p: Vec2 = [a[0] + tx * u, a[1] + tz * u];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < 1.2 && (!best || d < best.d)) best = { p, d };
  }
  return best && { p: best.p };
}
