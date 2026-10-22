// FORMA 3 editor: ties together document, view, handles, inference and interface.
// Two-level selection (like SketchUp groups): outside a building, a click
// picks the whole building; inside it (double click), it picks a volume,
// face or component. Drags start from a copy of the initial state and are only
// recorded in the history on release.
import * as THREE from 'three';
import type { Building3, ID, Item, MaterialRef, Project3, Solid, Vec2, Vec3, NoteRef } from '../model/schema';
import { building as newBuilding, circlePlan, facadeRule, levelsFor, planVertices, project as newProject, roofSpec, solid as newSolid, uid } from '../model/defaults';
import { bendEdge, cloneBuilding, inside, mirrorSolidAbout, reflect, locateVertex, cloneSolid, dirToLocal, edgeNormal, findSolid, mirrorSolid, moveVertex, planCenter, planValid as planValidOps, pushEdge, removeVertex, rotateSolid, splitEdge, toLocal, topRing, toWorld, topAt, translateSolid } from '../model/ops';
import { solidRings } from '../eval/body';
import { stairClashes } from '../eval/clashes';
import { modifierCopies } from '../eval/modifiers';
import { TOOL_GROUPS, toolForKey, type ToolDef } from './commands';
import { terrainField, type TerrainField } from '../model/terrain';
import { adoptOffsetSides, sideCurve, stackOnTop, edgeLength, extrudeSide, hostedFrame, insetSide, insetTop, offsetCopy, offsetSolid, setSideDepth, setSolidSize, splitAtHeight, splitByLine, splitSideAt } from '../model/modeling';
import { activeLayer, buildingHidden, buildingLocked, ensureLayers, explodeGap, itemHidden, itemLocked, solidHidden, solidLocked, viewOf, optionHidden } from '../model/layers';
import { boxPicks, combine, marqueeRect, selMode } from './selection';
import { convertSub, segDistance, subElements, type ElemMode, type SubEdge, type SubVertex } from '../eval/subelements';
import { invert, nextSetName, pickableBuildings, pickableSolids, recallSet, saveSet, similarBuildings, similarSolids } from '../model/selsets';
import { Store } from './store';
import { OpeningTool } from './tools/opening';
import { SiteTools } from './tools/site';
import { StairTool } from './tools/stair';
import { WallsTool } from './tools/walls';
import { decimal, tr } from '../ui/i18n';
import { PolylineTool, pointsAlong } from './tools/polyline';
import { buildingOverlaps, lotAt, lotOverlaps, replantStreetTrees, setbackWarnings, streetAt } from '../model/site';
import { WalkMode } from './tools/walk';
import { addInteriorWall, interiorDoors, replicateLevel, type InteriorWithDoors } from '../eval/interiorwalls';
import { stairBetween } from '../model/stairs';
import { alignBuildings, alignSolids, buildingBox, freeShift, volumeBox, type AlignOp, type PlanBox } from '../model/align';
import { arcOf, cornerLimit, offsetRing, oriented, ringValid, sampleRing, signedArea2 } from '../model/plan';
import { BLOCKS, blockSolid, type BlockPlacement } from '../model/blocks';
import { View, type Hit } from './view';
import { Handles, HANDLE_COLORS, type Handle, type HandleKind } from './handles';
import { Inference, SNAP_COLORS, type Snap } from './infer';
import { createShell3, type Shell3 } from '../ui/shell';
import { icon } from '../ui/icons';
import { family, typeById } from '../families/index';
import { CATEGORY_NAMES, resolveParams } from '../families/family';
import { columnGrid as columnGridOf, freeSpot } from '../model/structure';
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
import { type Tool, type Selection, type Mods, type Measure, type OpParam, type LastOp, type Drag, rad, fmt, arcSample, parseLength, parseFloors, floorsHeight, parseOffset, clampInside, esc, midOf, partHostFace, halfway, ringCenter, polyArea, screenDist, faceSelOf, hasParapet, hasPlinth, cutEdgePoint, simplifyClosed } from './support';
import * as keysMod from './keys';
import * as dragMod from './drag';
import * as selviewMod from './selview';
import * as modelcmdsMod from './modelcmds';
import * as drawingMod from './drawing';
import * as annotateMod from './annotate';
import * as constructMod from './construct';
import * as placeMod from './place';
import * as pointerMod from './pointer';
import * as selcmdsMod from './selcmds';
export type { Tool, Selection, OpParam, LastOp } from './support';
export { arcSample, parseLength, parseFloors, floorsHeight, parseOffset } from './support';

export interface EditorOptions {
  project?: Project3;
  autosave?: boolean;
}

/** A tuple without its first element (the delegates of the methods moved to their own modules). */
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;

export class Editor3 {
  readonly shell: Shell3;
  readonly store: Store;
  readonly view: View;
  readonly handles: Handles;
  readonly infer: Inference;
  readonly opening: OpeningTool;
  readonly site: SiteTools;
  readonly stair: StairTool;
  readonly wallsTool: WallsTool;
  readonly slabTool: WallsTool;
  beamFrom: Vec3 | null = null;
  /** Interior: the wall or room selected (panel on the side), the thickness new walls get. */
  iwallSel: { level: ID; wall: ID } | null = null;
  roomSel: { level: ID; room: ID } | null = null;
  iwallThickness = 0.12;
  /** Thickness of the walls a building is drawn with (Walls tool). */
  wallThickness = 0.25;
  /** Height of new walls (the tool options in the top bar). */
  wallHeight = 3;
  private terrainCache: { seq: number; field: TerrainField | null } | null = null;
  /** The project's shaped ground (model/terrain.ts), kept until the next history step. */
  terrain(): TerrainField | null {
    if (this.terrainCache?.seq !== this.store.seq) this.terrainCache = { seq: this.store.seq, field: terrainField(this.store.project) };
    return this.terrainCache.field;
  }
  /** Height the Terrain tool gives the ground at a new point (the tool options in the top bar). */
  terrainHeight = 1;
  /**
   * Where the clicked line runs in a closed run of walls (Revit's location line): the walls' centre, their
   * outer face (drawing over a site plan's outline) or their inner face (drawing the rooms' sizes).
   */
  wallLine: 'center' | 'outside' | 'inside' = 'center';
  /** Thickness of new slabs. */
  slabThickness = 0.2;
  /** Sizes set in the top bar for the next door or window placed (over its type's own). */
  placeParams: Record<string, number> = {};
  readonly polyline: PolylineTool;
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
  drag: Drag | null = null;
  /** Where a drag was refused (floors drawn apart): the reason shows only if the pointer really moves. */
  blockedAt: { x: number; y: number } | null = null;
  /** Selection box in progress (from, to, modifiers at the start). */
  marquee: { ax: number; ay: number; bx: number; by: number; active: boolean; hit: Hit | null; ev: Mods } | null = null;
  marqueeEl: HTMLElement | null = null;
  draft: { points: THREE.Vector3[]; y: number; bid: ID | null; hover: THREE.Vector3 | null } | null = null;
  /** Message of a volume that was drawn through another building and joined it. */
  composedNote: string | null = null;
  selOverlay = new THREE.Group();
  snapOverlay = new THREE.Group();
  ghost: { mesh: PartsMesh; key: string } | null = null;
  lastSnap: Snap | null = null;
  private clipboard: { kind: 'solid' | 'building' | 'item'; json: string } | null = null;
  private listeners = new Set<() => void>();
  private toastTimer = 0;
  private saveTimer = 0;
  /** Buildings in preview (no facade) during a drag. */
  preview = new Set<ID>();

  constructor(container: HTMLElement, opts: EditorOptions = {}) {
    this.shell = createShell3(container);
    this.view = new View(this.shell.view);
    // A view change drawn building by building says how far it got (the interface stays usable meanwhile).
    this.view.onProgress = (done, total) => {
      const p = this.store.project;
      this.shell.status.stats.textContent = total && done < total ? `Drawing the view: ${done}/${total} buildings…` : `${p.buildings.length} building(s) · ${this.view.lastEvalMs.toFixed(0)} ms`;
    };
    this.view.freeRect = () => this.freeRect();
    // Buildings drawn by the workers after opening: warnings, labels and the selection catch up.
    this.view.onDrawn = () => this.sync();
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
    this.walk = new WalkMode({ view: this.view, root: this.shell.view, project: () => this.store.project, onExit: () => this.toast('Back to the model view.'), interact: () => this.toggleDoorAhead() });
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
      toast: (t) => this.toast(t),
    });
    this.stair = new StairTool({
      view: this.view,
      overlay: this.snapOverlay,
      context: () => this.store.building(this.context),
      ownerAt: (x, z) => this.ownerAt(x, z),
      floorPoint: (e) => {
        const at = this.levelPoint(e);
        if (!at) return null;
        const w = toWorld(at.b, at.p);
        return new THREE.Vector3(w[0], at.lv.elevation + (at.b.elevation ?? 0), w[1]);
      },
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
      snapOn: () => this.infer.enabled,
      y: () => constructMod.wallChainY(this),
      words: { start: 'Click the start of the wall', close: 'Click: close', open: 'Esc ends' },
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      segment: (a, b) => constructMod.wallSegment(this, a, b),
      unsegment: () => constructMod.wallUnsegment(this),
      targets: () => constructMod.wallTargets(this),
      done: (pts, closed) => constructMod.wallChainDone(this, pts, closed),
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
      snapOn: () => this.infer.enabled,
      showDim: (t, e) => this.showDim(t, e),
      hideDim: () => void (this.shell.dim.hidden = true),
      done: (pts, closed) => this.slabDone(pts, closed),
    });
    this.infer = new Inference(this.view);
    this.view.overlay.add(this.selOverlay, this.snapOverlay);
    // A pinned dimension or label: Alt+click deletes it.
    this.shell.view.addEventListener('pointerdown', (e) => {
      const ax = (e.target as HTMLElement).closest<HTMLElement>('.f3-axislbl[data-axis]');
      if (ax && e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const aid = ax.dataset.axis!;
        return void this.changeSite((p) => {
          p.axes = (p.axes ?? []).filter((x) => x.id !== aid);
          if (!p.axes.length) delete p.axes;
        }, 'Deleted.');
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>('.f3-dimlbl[data-note]');
      if (!el || !e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      const id = el.dataset.note!;
      this.changeSite((p) => {
        p.notes = (p.notes ?? []).filter((n) => n.id !== id);
        if (!p.notes.length) delete p.notes;
      }, 'Deleted.');
    });
    this.view.onCamera = () => {
      this.handles.draw();
      this.drawRoomLabels();
      this.placeCtxBar();
      if (this.project.notes?.length || this.project.axes?.length) this.drawDims();
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
    this.shell.name.value = tr(this.store.project.name);
    this.sync();
    this.view.frame();
  }

  // ── Events for the interface ─────────────────────────────────────────
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
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
    // A hover highlight drawn before the model changed (the face under the cursor before a rotation or a
    // move) would stay where the face was: it goes, and the next pointer move draws it again.
    if (this.hoverKey) this.drawHover(null);
    // The name field follows the project (undo of a rename, another project put in place), unless typed in.
    if (document.activeElement !== this.shell.name && this.shell.name.value !== tr(p.name)) this.shell.name.value = tr(p.name);
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
    this.infer.refresh(p, [...this.store.revision.entries()].map(([k, v]) => k + v).join(',') + p.buildings.map((x) => x.position.join() + x.rotation).join() + JSON.stringify([p.guides ?? null, p.axes ?? null]));
    this.warnings = [];
    for (const [id, built] of this.view.built) if (!this.context || id === this.context) this.warnings.push(...built.ev.warnings);
    this.drawRoomLabels();
    if (p.notes?.length || p.axes?.length || p.guides?.length || this.shell.view.querySelector('.f3-dimlbl') || this.snapOverlay.getObjectByName('guides')) this.drawDims();
    if (p.lots.length) {
      const own = this.store.building(this.context)?.name;
      this.warnings.push(...setbackWarnings(p).filter((w) => !own || w.startsWith(own + ' ')));
      if (!own) this.warnings.push(...lotOverlaps(p));
    }
    if (!this.context && p.buildings.length > 1) this.warnings.push(...buildingOverlaps(p));
    for (const b of p.buildings) if (!this.context || b.id === this.context) this.warnings.push(...stairClashes(b));
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
    // Each warning in the interface language before they are joined (a joined text matches no pattern).
    const text = uniq.slice(0, 3).map(tr).join(' · ') + (uniq.length > 3 ? ` (+${uniq.length - 3})` : '');
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
  replantTrees(): ID[] {
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
  pickSiteAt(e: { clientX: number; clientY: number }): boolean {
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
  refreshActive(): void {
    const ids = new Set<ID>([this.context, this.sel.building, ...this.sel.others].filter((x): x is ID => !!x));
    const cur = this.view.activeIds;
    if (ids.size === cur.size && [...ids].every((i) => cur.has(i))) return;
    this.view.activeIds = ids;
    this.view.refreshBatches();
  }

  syncSelection(): void {
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
  drawSelection(...a: Tail<Parameters<typeof selviewMod.drawSelection>>): ReturnType<typeof selviewMod.drawSelection> {
    return selviewMod.drawSelection(this, ...a);
  }

  /** Tools in which handles respond to clicks (and therefore show). */
  handlesLive(): boolean {
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
  sizeHandles(b: Building3, bb: Bounds): Handle[] {
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
  ownerAt(x: number, z: number): Building3 {
    // Inside a building's outline: that building. Outside every building: the site (a slab, a column, a
    // fence or a tree on open ground never becomes part of the house next to it, nor of its area).
    const inside = this.footprintAt(x, z);
    if (inside) return inside;
    const sites = this.project.buildings.filter((q) => /^Site( \d+)?$/.test(q.name));
    const site = sites.sort((p, q) => Math.hypot(p.position[0] - x, p.position[1] - z) - Math.hypot(q.position[0] - x, q.position[1] - z))[0];
    if (site && Math.hypot(site.position[0] - x, site.position[1] - z) < 80) return site;
    const n = this.project.buildings.filter((q) => /^Site( \d+)?$/.test(q.name)).length;
    return newBuilding({ name: n ? `Site ${n + 1}` : 'Site', position: [x, z], use: 'public', levels: levelsFor(1) });
  }

  /** The building whose outline (any adding volume) contains a world point on the ground. */
  footprintAt(x: number, z: number): Building3 | null {
    for (const b of this.project.buildings) {
      if (buildingHidden(this.project, b) || buildingLocked(this.project, b) || /^Site( \d+)?$/.test(b.name)) continue;
      const l = toLocal(b, [x, z]);
      if (b.solids.some((so) => so.op === 'add' && !so.hidden && inside(l, sampleRing(so.plan.outer).pts))) return b;
    }
    return null;
  }

  /** Adds a building made by `ownerAt` to the project (no-op for one already in it). */
  adopt(b: Building3): void {
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
  orbitPivot(e: { clientX: number; clientY: number }): THREE.Vector3 {
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
  worldBox(b: Building3): THREE.Box3 | null {
    const bb = this.boundsOf(b);
    if (!bb) return null;
    const M = this.view.buildingMatrix(b);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) box.expandByPoint(v.set(i & 1 ? bb.max[0] : bb.min[0], i & 2 ? bb.max[1] : bb.min[1], i & 4 ? bb.max[2] : bb.min[2]).applyMatrix4(M));
    return box;
  }

  /** Declared prism of the solids: plan outline, from the base to the top of the walls. */
  prismBounds(_b: Building3, solids: Solid[]): Bounds | null {
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

  /**
   * What a selection carries to be moved: with Select, only the square to drag it on the ground (dragging
   * the object itself moves it too) and its size handles; the axis arrows with Move, the ring with Rotate.
   * Every kind of handle at once made a selected building unreadable.
   */
  gizmo(c: THREE.Vector3, ax: THREE.Vector3, az: THREE.Vector3, R: number): Handle[] {
    if (this.tool === 'rotate') return [this.rotateHandle(c, R)];
    const mv = this.moveHandles(c, ax, az);
    return this.tool === 'move' ? mv : mv.filter((h) => h.kind === 'move-xz');
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
  /** A tool filter and a look-only mode (none is set since the stage tabs were removed: every tool is offered). */
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
  /** Opens the quantities and cost estimate (ui/quantities.ts). */
  quantitiesRequested: (() => void) | null = null;
  /** Opens the virtual tour panel (ui/tour.ts). */
  tourRequested: (() => void) | null = null;
  /** Mouse navigation preset (ui/prefs.ts): which middle-button drag pans and which orbits. */
  navPreset: 'forma' | 'sketchup' | 'blender' = 'forma';

  frameSelection(): void {
    const b = this.activeBuilding();
    const g = b && this.view.built.get(b.id)?.group;
    this.view.frame(g ? new THREE.Box3().setFromObject(g) : undefined);
  }

  duplicate(...a: Tail<Parameters<typeof modelcmdsMod.duplicate>>): ReturnType<typeof modelcmdsMod.duplicate> {
    return modelcmdsMod.duplicate(this, ...a);
  }

  /** The building leaves its group of linked copies (it is edited on its own from now on). */
  unlink(...a: Tail<Parameters<typeof modelcmdsMod.unlink>>): ReturnType<typeof modelcmdsMod.unlink> {
    return modelcmdsMod.unlink(this, ...a);
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
        // The walls that met a deleted wall get plain ends again (no mitre into nothing).
        if (x.solids.some((s) => s.wallAxis)) constructMod.joinWalls(x);
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
  modelOp(...a: Tail<Parameters<typeof modelcmdsMod.modelOp>>): ReturnType<typeof modelcmdsMod.modelOp> {
    return modelcmdsMod.modelOp(this, ...a);
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
  islands(): DOMRect[] {
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
  drawSelDims(...a: Tail<Parameters<typeof selviewMod.drawSelDims>>): ReturnType<typeof selviewMod.drawSelDims> {
    return selviewMod.drawSelDims(this, ...a);
  }

  /**
   * Labeling like map renderers (`labels.ts`): the height first, then each side, takes
   * the nearest free spot around its anchor, clear of the handles (a dimension never sits
   * under an arrow, point or square), the panels and the dimensions already placed. With
   * no free spot within reach it hides: never one label over another.
   * All rectangles are read before any label moves (one layout, no reflow per label).
   */
  declutterDims(...a: Tail<Parameters<typeof selviewMod.declutterDims>>): ReturnType<typeof selviewMod.declutterDims> {
    return selviewMod.declutterDims(this, ...a);
  }

  /** A dimension label being edited (the labels are not rebuilt meanwhile: orbiting never loses the typing). */
  dimEditing = false;

  /**
   * Editable dimension (Revit temporary dimensions): click the value, type, Enter applies
   * (Tab applies and goes to the next one, Esc cancels). Values with a point or a comma.
   */
  makeDimEditable(...a: Tail<Parameters<typeof selviewMod.makeDimEditable>>): ReturnType<typeof selviewMod.makeDimEditable> {
    return selviewMod.makeDimEditable(this, ...a);
  }

  placeSelDims(...a: Tail<Parameters<typeof selviewMod.placeSelDims>>): ReturnType<typeof selviewMod.placeSelDims> {
    return selviewMod.placeSelDims(this, ...a);
  }

  /** Scales every volume plan of the building around `c` (building frame); invalid result: nothing changes. */
  scaleBuildingPlan(bid: ID, c: Vec2, sx: number, sz: number, msg: string): boolean {
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

  /**
   * Scale tool, a typed factor (SketchUp Scale: click, type 2, Enter): the selected volumes, or the whole
   * building, grow by that factor in plan and height about their middle; "2;1" scales the plan only.
   */
  scaleSelection(t: string): boolean {
    const b = this.activeBuilding();
    if (!b) return false;
    const m = /^\s*([\d.,]+)\s*(?:;\s*([\d.,]+))?\s*$/.exec(t);
    const f = m ? parseFloat(m[1]!.replace(',', '.')) : NaN;
    const fh = m?.[2] !== undefined ? parseFloat(m[2]!.replace(',', '.')) : f;
    if (!(f > 0.05 && f < 50) || !(fh > 0.05 && fh < 50)) return false;
    const ids = this.context === b.id && this.sel.solids.length ? this.sel.solids : b.solids.map((s) => s.id);
    return this.change(
      b.id,
      (x) => {
        const ss = x.solids.filter((s) => ids.includes(s.id));
        const pts = ss.flatMap((s) => s.plan.outer.map((v) => v.p));
        if (!pts.length) return false;
        const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2,
          cz = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
        const base = Math.min(...ss.map((s) => s.base));
        const before = structuredClone(ss.map((s) => [s.plan, s.base, s.height] as const));
        for (const s of ss) {
          for (const ring of [s.plan.outer, ...s.plan.holes])
            for (const v of ring) {
              v.p = [cx + (v.p[0] - cx) * f, cz + (v.p[1] - cz) * f];
              if (v.round) v.round *= f;
              if (v.chamfer) v.chamfer *= f;
            }
          if (s.wallAxis) s.wallAxis = s.wallAxis.map((q) => [cx + (q[0] - cx) * f, cz + (q[1] - cz) * f]) as [Vec2, Vec2];
          s.base = base + (s.base - base) * fh;
          s.height = Math.max(0.3, s.height * fh);
        }
        if (ss.every((s) => planValidOps(s.plan))) return;
        ss.forEach((s, i) => {
          s.plan = before[i]![0];
          s.base = before[i]![1];
          s.height = before[i]![2];
        });
        return false;
      },
      `Scaled ×${decimal(f)}${fh !== f ? ` (height ×${decimal(fh)})` : ''}.`,
    );
  }

  /** Scales the building vertically: volume bases and heights, and the levels with them. */
  scaleBuildingHeight(bid: ID, k: number, msg: string): boolean {
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
  pendingClick: Hit | null = null;

  /** Is the pressed point already selected (with `multi`, in a selection of several)? */
  inSelection(hit: Hit, multi: boolean): boolean {
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
  elemBoxes(...a: Tail<Parameters<typeof selcmdsMod.elemBoxes>>): ReturnType<typeof selcmdsMod.elemBoxes> {
    return selcmdsMod.elemBoxes(this, ...a);
  }

  /** Automatic groups of the elements of the building being edited (category → type → variant). */
  elementGroups(...a: Tail<Parameters<typeof selcmdsMod.elementGroups>>): ReturnType<typeof selcmdsMod.elementGroups> {
    return selcmdsMod.elementGroups(this, ...a);
  }

  /** Selects a group (with the click modifiers: Ctrl adds, Shift toggles, Ctrl+Shift removes). */
  selectGroup(...a: Tail<Parameters<typeof selcmdsMod.selectGroup>>): ReturnType<typeof selcmdsMod.selectGroup> {
    return selcmdsMod.selectGroup(this, ...a);
  }

  groupHover = new THREE.Group();
  /** Pre-highlight in the model of what a panel group would add to the selection (null clears). */
  previewElems(...a: Tail<Parameters<typeof selcmdsMod.previewElems>>): ReturnType<typeof selcmdsMod.previewElems> {
    return selcmdsMod.previewElems(this, ...a);
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
  openContext(e: PointerEvent): void {
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
  /** Component mode (4): clicks pick only parts (windows, doors, furniture), through the volumes in front. */
  partsMode = false;

  /** Component mode on or off (4; again goes back to volumes). */
  setPartsMode(on = !this.partsMode): void {
    if (on && this.elemMode !== 'object') this.setElemMode('object');
    this.partsMode = on;
    const box = this.shell.modes;
    delete box.dataset.mode;
    this.renderModes();
    if (on) this.toast('Components: a click picks a window, a door or a piece of furniture, even behind a wall.');
  }
  subCache = new Map<string, { verts: SubVertex[]; edges: SubEdge[] }>();
  subHover = new THREE.Group();
  subHoverKey = '';

  /** Switches the mode (the same key again goes back to volumes); the selection converts like Blender's. */
  setElemMode(m: ElemMode): void {
    if (m === this.elemMode && m !== 'object') m = 'object';
    this.partsMode = false;
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
    const key = this.partsMode ? 'parts' : this.elemMode;
    if (box.dataset.mode === key && box.childElementCount) return;
    box.dataset.mode = key;
    const modes: [ElemMode, string, string, string][] = [
      ['object', 'modeObject', 'Volumes', 'Volumes: pick whole volumes'],
      ['vertex', 'modeVertex', 'Vertex', 'Vertices · 1'],
      ['edge', 'modeEdge', 'Edge', 'Edges · 2'],
      ['face', 'modeFace', 'Face', 'Faces · 3'],
    ];
    box.innerHTML =
      modes.map(([m, ic, label, title]) => `<button data-mode="${m}" aria-pressed="${m === key}" title="${title}" aria-label="${label}">${icon(ic)}</button>`).join('') +
      `<button data-mode="parts" aria-pressed="${key === 'parts'}" title="Components · 4" aria-label="Components">${icon('catalog')}</button>`;
    box.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((bt) => bt.addEventListener('click', () => (bt.dataset.mode === 'parts' ? this.setPartsMode() : this.setElemMode(bt.dataset.mode as ElemMode))));
  }

  subOf(...a: Tail<Parameters<typeof selcmdsMod.subOf>>): ReturnType<typeof selcmdsMod.subOf> {
    return selcmdsMod.subOf(this, ...a);
  }

  /** Corner or side under the cursor (screen distance; what the model hides is not picked). */
  subPickAt(...a: Tail<Parameters<typeof selcmdsMod.subPickAt>>): ReturnType<typeof selcmdsMod.subPickAt> {
    return selcmdsMod.subPickAt(this, ...a);
  }

  /** Press in a sub-element mode: picks (Shift toggles, Ctrl adds) and starts dragging what was pressed. */
  subDown(...a: Tail<Parameters<typeof selcmdsMod.subDown>>): ReturnType<typeof selcmdsMod.subDown> {
    return selcmdsMod.subDown(this, ...a);
  }

  /** Pre-highlight of the corner or side under the cursor. */
  drawSubHover(...a: Tail<Parameters<typeof selviewMod.drawSubHover>>): ReturnType<typeof selviewMod.drawSubHover> {
    return selviewMod.drawSubHover(this, ...a);
  }

  // ── Selection commands (docs/SELECTION.md) ──────────────────────────
  // Blender: Ctrl+A all, Ctrl+I invert, Shift+G similar, H hide, Shift+H hide the rest, Alt+H show all.
  // Revit: named selection sets saved in the project.

  /** Everything in the current context: elements (when elements are selected), the building's volumes inside it, buildings outside. */
  selectAll(...a: Tail<Parameters<typeof selcmdsMod.selectAll>>): ReturnType<typeof selcmdsMod.selectAll> {
    return selcmdsMod.selectAll(this, ...a);
  }

  /** Same type (elements), same shape (volumes: operation, corners, height) or same use (buildings). */
  selectSimilar(...a: Tail<Parameters<typeof selcmdsMod.selectSimilar>>): ReturnType<typeof selcmdsMod.selectSimilar> {
    return selcmdsMod.selectSimilar(this, ...a);
  }

  /** Hides the selection (H); Alt+H brings it back. */
  hideSelected(...a: Tail<Parameters<typeof selcmdsMod.hideSelected>>): ReturnType<typeof selcmdsMod.hideSelected> {
    return selcmdsMod.hideSelected(this, ...a);
  }

  /** Hides everything else (Shift+H): the other volumes inside a building, the other buildings outside it. */
  isolateSelection(...a: Tail<Parameters<typeof selcmdsMod.isolateSelection>>): ReturnType<typeof selcmdsMod.isolateSelection> {
    return selcmdsMod.isolateSelection(this, ...a);
  }

  /** Shows every building, volume, component, layer and category (Alt+H). */
  showAll(...a: Tail<Parameters<typeof selcmdsMod.showAll>>): ReturnType<typeof selcmdsMod.showAll> {
    return selcmdsMod.showAll(this, ...a);
  }

  /** Saves the selection as a named set (a new default name when none is given). */
  saveSelectionSet(...a: Tail<Parameters<typeof selcmdsMod.saveSelectionSet>>): ReturnType<typeof selcmdsMod.saveSelectionSet> {
    return selcmdsMod.saveSelectionSet(this, ...a);
  }

  /** Selects a saved set again (entering its building when it holds volumes or elements). */
  recallSelectionSet(...a: Tail<Parameters<typeof selcmdsMod.recallSelectionSet>>): ReturnType<typeof selcmdsMod.recallSelectionSet> {
    return selcmdsMod.recallSelectionSet(this, ...a);
  }

  renameSelectionSet(...a: Tail<Parameters<typeof selcmdsMod.renameSelectionSet>>): ReturnType<typeof selcmdsMod.renameSelectionSet> {
    return selcmdsMod.renameSelectionSet(this, ...a);
  }

  deleteSelectionSet(...a: Tail<Parameters<typeof selcmdsMod.deleteSelectionSet>>): ReturnType<typeof selcmdsMod.deleteSelectionSet> {
    return selcmdsMod.deleteSelectionSet(this, ...a);
  }

  moveMarquee(...a: Tail<Parameters<typeof selcmdsMod.moveMarquee>>): ReturnType<typeof selcmdsMod.moveMarquee> {
    return selcmdsMod.moveMarquee(this, ...a);
  }

  endMarquee(...a: Tail<Parameters<typeof selcmdsMod.endMarquee>>): ReturnType<typeof selcmdsMod.endMarquee> {
    return selcmdsMod.endMarquee(this, ...a);
  }

  /** What the box picks: buildings outside a building; inside, elements (or volumes when there are none). */
  applyMarquee(...a: Tail<Parameters<typeof selcmdsMod.applyMarquee>>): ReturnType<typeof selcmdsMod.applyMarquee> {
    return selcmdsMod.applyMarquee(this, ...a);
  }

  // ── Facade elements ──────────────────────────────────────────────────
  /** Elements (windows, doors…) of the building being edited. */
  elements(...a: Tail<Parameters<typeof selcmdsMod.elements>>): ReturnType<typeof selcmdsMod.elements> {
    return selcmdsMod.elements(this, ...a);
  }

  /** Element selection: row, column, grow, shrink, same type, face, shift. */
  selectElems(...a: Tail<Parameters<typeof selcmdsMod.selectElems>>): ReturnType<typeof selcmdsMod.selectElems> {
    return selcmdsMod.selectElems(this, ...a);
  }

  /** Batch actions on the selected elements. */
  elemAction(...a: Tail<Parameters<typeof selcmdsMod.elemAction>>): ReturnType<typeof selcmdsMod.elemAction> {
    return selcmdsMod.elemAction(this, ...a);
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
  editElemsParam(...a: Tail<Parameters<typeof selcmdsMod.editElemsParam>>): ReturnType<typeof selcmdsMod.editElemsParam> {
    return selcmdsMod.editElemsParam(this, ...a);
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
    // Another type starts from its own sizes.
    if (this.placing !== typeId) this.placeParams = {};
    this.placing = typeId;
    const t = typeById(typeId, this.project);
    const f = t && family(t.family);
    this.updateHint(f ? (f.host === 'face' ? `${t!.name}: click a wall to place it. Esc finishes.` : f.host === 'path' ? `${t!.name}: click the path points; Enter finishes.` : `${t!.name}: click the ground or a roof.`) : undefined);
    this.emit();
  }

  /**
   * Walk mode, E: the door or window the eye looks at (within 3 m) opens or closes. A part keeps it as
   * its own parameter, a door of a facade rule as a size of that position, an interior door in its wall.
   */
  toggleDoorAhead(): boolean {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    const hit = this.view.pick(this.store.project, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    const tag = hit?.part;
    if (!hit || !tag || (tag.family !== 'door' && tag.family !== 'window') || hit.point.distanceTo(this.view.persp.position) > 3) return false;
    // A door opens to 90°, a window all the way (its `open` is a share); again closes it.
    const full = tag.family === 'door' ? 90 : 1;
    const flip = (v: unknown) => (typeof v === 'number' && v > 0 ? 0 : full);
    return this.change(
      hit.building.id,
      (b) => {
        if (tag.item) {
          const it = b.items.find((x) => x.id === tag.item);
          if (!it) return false;
          it.params = { ...it.params, open: flip(it.params.open) };
        } else if (tag.key?.startsWith('idoor:')) {
          const [, level, i] = tag.key.split(':');
          const d = interiorDoors(b.interiors[level!] ?? { nodes: [], walls: [], rooms: [] })[Number(i)];
          if (!d) return false;
          d.open = flip(d.open);
        } else if (tag.rule && tag.solid && tag.key) {
          const rule = b.solids.find((x) => x.id === tag.solid)?.facade.find((x) => x.id === tag.rule);
          if (!rule) return false;
          const sz = ((rule.sizes ??= {})[tag.key] ??= {});
          sz.open = flip(sz.open);
        } else return false;
      },
      '',
    );
  }

  /** Starts a tool of the registry (`editor/commands.ts`): the bar, the keys and the command search. */
  runTool(id: string): void {
    if (id === 'catalog') this.toggleLibrary();
    else if (id === 'door') this.startPlacing('door-panel');
    else if (id === 'window') this.startPlacing('win-casement');
    else this.setTool(id as Tool);
  }

  /** The tool shown on each toolbar group (the last one used in it, as in Photoshop and Revit). */
  private toolPick = new Map<string, string>();

  private renderTools(): void {
    type T = ToolDef;
    const groups = TOOL_GROUPS;
    const placingFamily = () => (this.tool === 'place' && this.placing ? (typeById(this.placing, this.project)?.family ?? null) : null);
    const pressed = (t: T) =>
      t.id === 'catalog' ? !this.shell.cat.classList.contains('closed') : t.id === 'door' ? placingFamily() === 'door' : t.id === 'window' ? placingFamily() === 'window' : this.tool === t.id;
    const cell = (g: { id: string; tools: T[] }) => {
      const cur = g.tools.find(pressed) ?? g.tools.find((t) => t.id === this.toolPick.get(g.id)) ?? g.tools[0]!;
      const many = g.tools.length > 1;
      const on = g.tools.some(pressed);
      return `<button class="f3-tool${many ? ' grp' : ''}" data-tool="${cur.id}" data-group="${g.id}" title="${tr(cur.label)} (${cur.key})" aria-label="${tr(cur.label)}" aria-pressed="${on}">${icon(cur.ic)}</button>`;
    };
    const sep = new Set(['move', 'walls', 'shape', 'site', 'catalog']);
    this.shell.tools.innerHTML = groups.map((g) => `${sep.has(g.id) ? '<hr>' : ''}${cell(g)}`).join('');
    const snapBtn = this.shell.viewbar.querySelector('[data-cmd="snap"]');
    snapBtn?.setAttribute('aria-pressed', String(this.infer.enabled));
    const libBtn = this.shell.status.bar.querySelector('[data-cmd="library"]');
    libBtn?.setAttribute('aria-pressed', String(!this.shell.cat.classList.contains('closed')));
    const run = (id: string) => this.runTool(id);
    const flyout = (b: HTMLButtonElement) => {
      const g = groups.find((x) => x.id === b.dataset.group)!;
      this.shell.root.querySelector('.f3-flyout')?.remove();
      const m = document.createElement('div');
      m.className = 'f3-flyout';
      m.setAttribute('role', 'menu');
      m.innerHTML = g.tools.map((t) => `<button role="menuitem" data-pick="${t.id}" aria-pressed="${pressed(t)}">${icon(t.ic)}<span>${tr(t.label)}</span><kbd>${t.key}</kbd></button>`).join('');
      const r = b.getBoundingClientRect(),
        root = this.shell.root.getBoundingClientRect();
      m.style.left = `${r.right - root.left + 4}px`;
      m.style.top = `${r.top - root.top}px`;
      this.shell.root.appendChild(m);
      const close = (e: PointerEvent) => {
        if (m.contains(e.target as Node)) return;
        m.remove();
        document.removeEventListener('pointerdown', close, true);
      };
      document.addEventListener('pointerdown', close, true);
      m.addEventListener('click', (e) => {
        const p = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]');
        if (!p) return;
        this.toolPick.set(g.id, p.dataset.pick!);
        m.remove();
        document.removeEventListener('pointerdown', close, true);
        run(p.dataset.pick!);
      });
    };
    this.shell.tools.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      let hold = 0;
      let held = false;
      const many = b.classList.contains('grp');
      b.addEventListener('pointerdown', () => {
        held = false;
        if (many) hold = window.setTimeout(() => ((held = true), flyout(b)), 350);
      });
      b.addEventListener('pointerup', () => clearTimeout(hold));
      b.addEventListener('pointerleave', () => clearTimeout(hold));
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (many) flyout(b);
      });
      b.addEventListener('click', () => {
        if (held) return;
        this.toolPick.set(b.dataset.group!, b.dataset.tool!);
        run(b.dataset.tool!);
      });
    });
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
        select: "Click: select · Ctrl adds · drag: box · double click: enter",
        move: "Drag · type the distance · Ctrl copies",
        rotate: "Drag the ring · type the angle",
        scale: "Drag a corner · Shift keeps proportions",
        push: "Drag a face · type the distance",
        extrude: "Drag a face · type the depth",
        cut: "Click a wall to split it · on a top, two points cut the volume",
        tape: "Click two points · Ctrl on the second: a guide line · Shift+click: label · Alt+click a dimension deletes it",
        rect: "Two corners · or type 10x8",
        circle: "Centre, then radius · or type the radius",
        polygon: "Click the corners · type the lengths · Enter closes",
        spline: "Click the points · Enter closes · or drag a free-hand outline",
        arc: "Two ends, then a point of the arc",
        opening: "Drag a rectangle on a wall",
        iwall: "Click point to point · type the length · Enter ends",
        slab: "Click the corners · type the lengths · click the first to close",
        column: "Click to place",
        beam: "Click the two ends",
        walls: "Click point to point · type the length · click the first point to close",
        room: "Click inside walls · or drag a rectangle",
        stair: "Click the foot, then the end",
        lot: "Drag the lot",
        street: "Click the centre line · Enter ends",
        terrain: "Click the ground: a point at the height in the bar · drag a point up or down · Alt+click removes",
        axis: "Click the two ends of the grid line · type its label after · Alt+click a label deletes it",
        mirror: "Click two points of the mirror line · Ctrl keeps the original",
        block: "Click the ground, a roof or a wall",
        place: "Click to place",
        paint: "Click a face · Alt picks the material",
      } as Record<Tool, string>)[this.tool];
    this.shell.status.hint.textContent = t;
    // In a narrow window the hint may be cut: the full text shows on hover.
    this.shell.status.hint.title = t;
  }

  setMeasure(label: string, apply: Measure['apply']): void {
    this.measure = { label, apply };
    this.shell.status.vcbLabel.textContent = label;
  }

  /**
   * What a typed value means while a drawing is in progress (SketchUp's VCB, Revit's typed length, Sweet
   * Home 3D's editable tooltip): the length of the next wall or side towards the cursor, the size of the
   * rectangle (10x8, or 10 for a square side along the cursor), the radius of the circle. It wins over a
   * pending measure of the last action, and the digits never switch the selection mode meanwhile.
   */
  draftInput(...a: Tail<Parameters<typeof drawingMod.draftInput>>): ReturnType<typeof drawingMod.draftInput> {
    return drawingMod.draftInput(this, ...a);
  }

  /**
   * The building whose floor the cursor is over (on the plane of the floor shown), for the wall tool:
   * inside an outline, a new wall divides that floor. Hidden and locked buildings are left alone.
   */
  buildingUnderWall(e: { clientX: number; clientY: number }): Building3 | null {
    for (const b of this.project.buildings) {
      if (buildingHidden(this.project, b) || buildingLocked(this.project, b)) continue;
      const lv = this.workLevel(b);
      const w = this.view.onPlane(e, (lv?.elevation ?? 0) + (b.elevation ?? 0));
      if (!w) continue;
      const l = toLocal(b, [w.x, w.z]);
      for (const so of b.solids) {
        // A wall drawn on its own is not a floor to divide (its line is where new walls join it).
        if (so.op !== 'add' || so.hidden || constructMod.wallAxisOf(so)) continue;
        const ring = sampleRing(so.plan.outer).pts;
        if (inside(l, ring)) return b;
      }
    }
    return null;
  }

  iwallHint(): string {
    return 'Click to start a wall inside this floor';
  }

  /**
   * The floor the new walls go on is cut open (1.2 m above it, the roof hidden) so they are seen while
   * they are drawn: the plan cut of ArchiCAD and Revit, the automatic cutaway of Chief Architect.
   */
  openFloorFor(b: Building3): void {
    this.context = b.id;
    const v = viewOf(this.store.project);
    if (v.cutLevel !== undefined) return;
    v.cutLevel = 0;
    this.store.commit(null, '', false);
    this.toast('Floor cut open: the walls you draw divide it. Esc ends; the floor switcher (All floors) shows the whole building again.');
  }

  /** A typed length for the interior wall being drawn: from its last point towards the cursor. */
  iwallTyped(...a: Tail<Parameters<typeof constructMod.iwallTyped>>): ReturnType<typeof constructMod.iwallTyped> {
    return constructMod.iwallTyped(this, ...a);
  }

  /** Nothing to correct by typing any more: the box goes back to its idle state (and loses half-typed text). */
  clearMeasure(): void {
    this.measure = null;
    this.shell.status.vcbLabel.textContent = 'Size';
    this.shell.status.vcb.value = '';
  }

  // ── Pointer ──────────────────────────────────────────────────────────
  private bindCanvas(...a: Tail<Parameters<typeof pointerMod.bindCanvas>>): ReturnType<typeof pointerMod.bindCanvas> {
    return pointerMod.bindCanvas(this, ...a);
  }

  pickAt(...a: Tail<Parameters<typeof pointerMod.pickAt>>): ReturnType<typeof pointerMod.pickAt> {
    return pointerMod.pickAt(this, ...a);
  }

  /**
   * The wall or top under the pointer, through the windows and parts in front of it: a ray that goes in
   * through an opening (its reveal, the room behind the glass) counts as the wall it is in, the side of
   * that volume nearest to the point.
   */
  pickBody(...a: Tail<Parameters<typeof pointerMod.pickBody>>): ReturnType<typeof pointerMod.pickBody> {
    return pointerMod.pickBody(this, ...a);
  }

  /** Move or rotate by two clicks (SketchUp, Revit): the drag stays on after a still click; the next click ends it. */
  stickyDrag = false;
  downAt: { x: number; y: number } | null = null;

  onDown(...a: Tail<Parameters<typeof pointerMod.onDown>>): ReturnType<typeof pointerMod.onDown> {
    return pointerMod.onDown(this, ...a);
  }

  /** The last plain click on the model (where, when, how deep): a click again there picks what is behind. */
  lastPick: { x: number; y: number; t: number; depth: number } | null = null;

  clickSelect(...a: Tail<Parameters<typeof pointerMod.clickSelect>>): ReturnType<typeof pointerMod.clickSelect> {
    return pointerMod.clickSelect(this, ...a);
  }

  /** When a click on a selected building last went into it (the first click of a double click does). */
  drilledAt = -Infinity;

  onDouble(...a: Tail<Parameters<typeof pointerMod.onDouble>>): ReturnType<typeof pointerMod.onDouble> {
    return pointerMod.onDouble(this, ...a);
  }

  /** A rule element pressed: dragging it past a few pixels detaches it and moves the new part. */
  pendingDetach: { x: number; y: number; e: PointerEvent } | null = null;

  onMove(...a: Tail<Parameters<typeof pointerMod.onMove>>): ReturnType<typeof pointerMod.onMove> {
    return pointerMod.onMove(this, ...a);
  }

  hoverKey = '';
  hoverOverlay = new THREE.Group();

  /**
   * Pre-highlight: shows what the next click will select (building, volume,
   * face or element), like SketchUp, before clicking.
   */
  drawHover(...a: Tail<Parameters<typeof selviewMod.drawHover>>): ReturnType<typeof selviewMod.drawHover> {
    return selviewMod.drawHover(this, ...a);
  }

  onUp(...a: Tail<Parameters<typeof pointerMod.onUp>>): ReturnType<typeof pointerMod.onUp> {
    return pointerMod.onUp(this, ...a);
  }

  cancel(...a: Tail<Parameters<typeof pointerMod.cancel>>): ReturnType<typeof pointerMod.cancel> {
    return pointerMod.cancel(this, ...a);
  }

  // ── Drags ────────────────────────────────────────────────────────────
  startDrag(...a: Tail<Parameters<typeof dragMod.startDrag>>): ReturnType<typeof dragMod.startDrag> {
    return dragMod.startDrag(this, ...a);
  }

  /** Dragging a point of the selected street or lot, or the whole of it. */
  siteDrag: { index: number; axis: THREE.Vector3 | null; from: THREE.Vector3; pts: Vec2[] } | null = null;

  beginSiteDrag(...a: Tail<Parameters<typeof dragMod.beginSiteDrag>>): ReturnType<typeof dragMod.beginSiteDrag> {
    return dragMod.beginSiteDrag(this, ...a);
  }

  moveSiteDrag(...a: Tail<Parameters<typeof dragMod.moveSiteDrag>>): ReturnType<typeof dragMod.moveSiteDrag> {
    return dragMod.moveSiteDrag(this, ...a);
  }

  endSiteDrag(...a: Tail<Parameters<typeof dragMod.endSiteDrag>>): ReturnType<typeof dragMod.endSiteDrag> {
    return dragMod.endSiteDrag(this, ...a);
  }

  beginHandle(...a: Tail<Parameters<typeof dragMod.beginHandle>>): ReturnType<typeof dragMod.beginHandle> {
    return dragMod.beginHandle(this, ...a);
  }

  lastPush: number | null = null;

  beginMoveBuilding(...a: Tail<Parameters<typeof dragMod.beginMoveBuilding>>): ReturnType<typeof dragMod.beginMoveBuilding> {
    return dragMod.beginMoveBuilding(this, ...a);
  }

  beginMoveSolids(...a: Tail<Parameters<typeof dragMod.beginMoveSolids>>): ReturnType<typeof dragMod.beginMoveSolids> {
    return dragMod.beginMoveSolids(this, ...a);
  }

  beginMoveItem(...a: Tail<Parameters<typeof dragMod.beginMoveItem>>): ReturnType<typeof dragMod.beginMoveItem> {
    return dragMod.beginMoveItem(this, ...a);
  }

  setMoveMeasure(...a: Tail<Parameters<typeof dragMod.setMoveMeasure>>): ReturnType<typeof dragMod.setMoveMeasure> {
    return dragMod.setMoveMeasure(this, ...a);
  }

  lastMove: THREE.Vector3 | null = null;
  lastMoved: { kind: 'building' | 'solids'; bid: ID; ids: ID[]; delta: THREE.Vector3; copied: boolean } | null = null;

  /** Serial copies after moving with Ctrl (5x) or division (5/), like SketchUp. */
  arrayLast(...a: Tail<Parameters<typeof dragMod.arrayLast>>): ReturnType<typeof dragMod.arrayLast> {
    return dragMod.arrayLast(this, ...a);
  }

  angleAt(...a: Tail<Parameters<typeof dragMod.angleAt>>): ReturnType<typeof dragMod.angleAt> {
    return dragMod.angleAt(this, ...a);
  }

  applyRotation(...a: Tail<Parameters<typeof dragMod.applyRotation>>): ReturnType<typeof dragMod.applyRotation> {
    return dragMod.applyRotation(this, ...a);
  }

  updateDrag(...a: Tail<Parameters<typeof dragMod.updateDrag>>): ReturnType<typeof dragMod.updateDrag> {
    return dragMod.updateDrag(this, ...a);
  }

  /**
   * Scales the volume plans by the box, with the side opposite to the handle
   * fixed (anchor). On the whole building, the free parts follow.
   */
  applySize(...a: Tail<Parameters<typeof dragMod.applySize>>): ReturnType<typeof dragMod.applySize> {
    return dragMod.applySize(this, ...a);
  }

  /** Floor elevation of the storey under a face part (relative to the solid base). */
  levelBelow(...a: Tail<Parameters<typeof dragMod.levelBelow>>): ReturnType<typeof dragMod.levelBelow> {
    return dragMod.levelBelow(this, ...a);
  }

  /** Offset correction to snap vertices of what moves onto vertices/edges of the others. */
  blockSnap(...a: Tail<Parameters<typeof dragMod.blockSnap>>): ReturnType<typeof dragMod.blockSnap> {
    return dragMod.blockSnap(this, ...a);
  }

  /** Offsets what is being moved (from the initial state). */
  applyMoveDelta(...a: Tail<Parameters<typeof dragMod.applyMoveDelta>>): ReturnType<typeof dragMod.applyMoveDelta> {
    return dragMod.applyMoveDelta(this, ...a);
  }

  /** Ctrl when starting to move: the original stays, the copy moves. */
  makeDragCopy(...a: Tail<Parameters<typeof dragMod.makeDragCopy>>): ReturnType<typeof dragMod.makeDragCopy> {
    return dragMod.makeDragCopy(this, ...a);
  }

  /** Offset along the line since where the drag started (grabbing the arrow tip does not jump). */
  dragAlong(...a: Tail<Parameters<typeof dragMod.dragAlong>>): ReturnType<typeof dragMod.dragAlong> {
    return dragMod.dragAlong(this, ...a);
  }

  /** Distance along a line (in the world) to the point closest to the mouse ray. */
  alongLine(...a: Tail<Parameters<typeof dragMod.alongLine>>): ReturnType<typeof dragMod.alongLine> {
    return dragMod.alongLine(this, ...a);
  }

  finishDrag(...a: Tail<Parameters<typeof dragMod.finishDrag>>): ReturnType<typeof dragMod.finishDrag> {
    return dragMod.finishDrag(this, ...a);
  }

  endDrag(...a: Tail<Parameters<typeof dragMod.endDrag>>): ReturnType<typeof dragMod.endDrag> {
    return dragMod.endDrag(this, ...a);
  }

  /**
   * After volumes joined a building by being dropped through it: Join (done), Subtract (they carve it),
   * Intersect (only the common part) or Keep apart (they become their building again). Esc keeps the join.
   */
  composeChooser(e: { clientX: number; clientY: number }, bid: ID, moved: ID[], name: string): void {
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
  separate(...a: Tail<Parameters<typeof modelcmdsMod.separate>>): ReturnType<typeof modelcmdsMod.separate> {
    return modelcmdsMod.separate(this, ...a);
  }

  /** The level the interior tools work on: the one cut in the interior view, else the ground floor. */
  workLevel(b: Building3): { id: ID; elevation: number; height: number } | null {
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    return lv[Math.min(lv.length - 1, Math.max(0, this.project.view?.cutLevel ?? 0))] ?? null;
  }

  iwallLast: Vec2 | null = null;
  /** The wall chain being drawn by the Walls tool (editor/construct.ts). */
  wallChain: constructMod.WallChain | null = null;
  /** The cursor on the floor while drawing interior walls: the direction of a typed length. */
  iwallHover: Vec2 | null = null;

  /**
   * Interior walls tool: each click on the floor of the level shown adds a wall from the previous
   * point (a new start after Enter); Shift+click on a wall puts a 0.9 m door there. The walls are
   * `Building3.interiors` (eval/interiorwalls.ts), drawn in the interior view.
   */
  iwallAt(...a: Tail<Parameters<typeof constructMod.iwallAt>>): ReturnType<typeof constructMod.iwallAt> {
    return constructMod.iwallAt(this, ...a);
  }

  /** Columns every `spacing` m inside the chosen volume (or the first), on each of its floors (model/structure.ts). */
  columnGrid(...a: Tail<Parameters<typeof modelcmdsMod.columnGrid>>): ReturnType<typeof modelcmdsMod.columnGrid> {
    return modelcmdsMod.columnGrid(this, ...a);
  }

  /** The interior walls of the floor shown copied to every floor above it. */
  replicateFloor(...a: Tail<Parameters<typeof modelcmdsMod.replicateFloor>>): ReturnType<typeof modelcmdsMod.replicateFloor> {
    return modelcmdsMod.replicateFloor(this, ...a);
  }

  /**
   * Copies of the selected free part along a line drawn on the ground (lamps along a path, trees along a
   * drive, bollards): one every `spacing` m, each turned along the line.
   */
  arrayAlongPath(...a: Tail<Parameters<typeof modelcmdsMod.arrayAlongPath>>): ReturnType<typeof modelcmdsMod.arrayAlongPath> {
    return modelcmdsMod.arrayAlongPath(this, ...a);
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
  importOsm(...a: Tail<Parameters<typeof modelcmdsMod.importOsm>>): ReturnType<typeof modelcmdsMod.importOsm> {
    return modelcmdsMod.importOsm(this, ...a);
  }

  /** Walls tool finished: a building with walls of the thickness (closed) or a free-standing wall (open). */
  /** Walls drawn in the floor plan (world points): closed, a building; open, a free-standing wall. */
  wallsFromPlan(...a: Tail<Parameters<typeof constructMod.wallsFromPlan>>): ReturnType<typeof constructMod.wallsFromPlan> {
    return constructMod.wallsFromPlan(this, ...a);
  }

  wallsDone(...a: Tail<Parameters<typeof constructMod.wallsDone>>): ReturnType<typeof constructMod.wallsDone> {
    return constructMod.wallsDone(this, ...a);
  }

  /** Slab tool finished: a 20 cm slab volume on the floor shown. */
  private slabDone(...a: Tail<Parameters<typeof constructMod.slabDone>>): ReturnType<typeof constructMod.slabDone> {
    return constructMod.slabDone(this, ...a);
  }

  /** Column tool: a column on the floor shown, up to the slab above. */
  columnAt(...a: Tail<Parameters<typeof constructMod.columnAt>>): ReturnType<typeof constructMod.columnAt> {
    return constructMod.columnAt(this, ...a);
  }

  /**
   * Beam tool: two clicks on the floor shown (where the eye is, as beams are drawn in plan in ArchiCAD
   * and Revit), the beam goes under the slab above; a typed length ends it towards the cursor. In a
   * building (the one under the pointer) or on open ground (the site, like a pergola beam).
   */
  beamAt(...a: Tail<Parameters<typeof constructMod.beamAt>>): ReturnType<typeof constructMod.beamAt> {
    return constructMod.beamAt(this, ...a);
  }

  beamB: Building3 | null = null;
  beamHover: Vec2 | null = null;

  /** The floor point (building frame) under the pointer for the beam: the beam's building once started. */
  beamPoint(...a: Tail<Parameters<typeof constructMod.beamPoint>>): ReturnType<typeof constructMod.beamPoint> {
    return constructMod.beamPoint(this, ...a);
  }

  /** Ends the beam being drawn at `l` (building frame). */
  beamTo(...a: Tail<Parameters<typeof constructMod.beamTo>>): ReturnType<typeof constructMod.beamTo> {
    return constructMod.beamTo(this, ...a);
  }

  /** A typed length for the beam being drawn: from its first end towards the cursor. */
  beamTyped(...a: Tail<Parameters<typeof constructMod.beamTyped>>): ReturnType<typeof constructMod.beamTyped> {
    return constructMod.beamTyped(this, ...a);
  }

  /**
   * The beam being drawn (its line at its height and the same line on the floor, joined at the ends) and
   * the beams already on this floor, which the floor cut (1.2 m) hides: their lines on the floor, the way
   * a plan shows the beams above it.
   */
  drawBeamDraft(...a: Tail<Parameters<typeof constructMod.drawBeamDraft>>): ReturnType<typeof constructMod.drawBeamDraft> {
    return constructMod.drawBeamDraft(this, ...a);
  }

  clearBeamDraft(...a: Tail<Parameters<typeof constructMod.clearBeamDraft>>): ReturnType<typeof constructMod.clearBeamDraft> {
    return constructMod.clearBeamDraft(this, ...a);
  }

  /**
   * Terrain tool (Revit's topography points, ArchiCAD's mesh points): a click on the ground sets its height
   * there (the height in the top bar; typed afterwards it changes that point), a click on a point picks it
   * to type its height again, Alt+click removes it. The buildings and streets keep a flat pad.
   */
  terrainAt(...a: Tail<Parameters<typeof constructMod.terrainAt>>): ReturnType<typeof constructMod.terrainAt> {
    return constructMod.terrainAt(this, ...a);
  }

  terrainDrag: { id: ID; y0: number; sy: number; moved: boolean } | null = null;

  axisFrom: THREE.Vector3 | null = null;
  mirrorFrom: THREE.Vector3 | null = null;

  /**
   * Mirror tool (SketchUp's Flip along a line, Revit's Mirror – Draw Axis): two clicks draw the mirror line;
   * the selected volumes (inside a building) or the selected buildings are reflected across it; with Ctrl
   * a reflected copy is made and the original stays.
   */
  mirrorAt(...a: Tail<Parameters<typeof constructMod.mirrorAt>>): ReturnType<typeof constructMod.mirrorAt> {
    return constructMod.mirrorAt(this, ...a);
  }

  /** Reflects the selection across the world line through `a` along `d`; `copy` keeps the original. */
  mirrorAcross(...a: Tail<Parameters<typeof modelcmdsMod.mirrorAcross>>): ReturnType<typeof modelcmdsMod.mirrorAcross> {
    return modelcmdsMod.mirrorAcross(this, ...a);
  }

  /**
   * Grid axis tool (Revit's Grid): two clicks on the ground draw a grid line; it is numbered (1, 2, 3…)
   * when it runs mostly front to back and lettered (A, B, C…) across, the next free one; a typed label
   * renames it.
   */
  axisAt(...a: Tail<Parameters<typeof annotateMod.axisAt>>): ReturnType<typeof annotateMod.axisAt> {
    return annotateMod.axisAt(this, ...a);
  }

  terrainDragMove(...a: Tail<Parameters<typeof constructMod.terrainDragMove>>): ReturnType<typeof constructMod.terrainDragMove> {
    return constructMod.terrainDragMove(this, ...a);
  }

  terrainDragEnd(...a: Tail<Parameters<typeof constructMod.terrainDragEnd>>): ReturnType<typeof constructMod.terrainDragEnd> {
    return constructMod.terrainDragEnd(this, ...a);
  }

  /** The terrain points while the tool is in hand: a short post at each, the one under the pointer orange. */
  drawTerrainMarks(...a: Tail<Parameters<typeof constructMod.drawTerrainMarks>>): ReturnType<typeof constructMod.drawTerrainMarks> {
    return constructMod.drawTerrainMarks(this, ...a);
  }

  clearTerrainMarks(...a: Tail<Parameters<typeof constructMod.clearTerrainMarks>>): ReturnType<typeof constructMod.clearTerrainMarks> {
    return constructMod.clearTerrainMarks(this, ...a);
  }

  roomFrom: Vec2 | null = null;

  /** The level plane point (building frame) under the pointer, for the interior tools. */
  levelPoint(...a: Tail<Parameters<typeof constructMod.levelPoint>>): ReturnType<typeof constructMod.levelPoint> {
    return constructMod.levelPoint(this, ...a);
  }

  roomDown(...a: Tail<Parameters<typeof constructMod.roomDown>>): ReturnType<typeof constructMod.roomDown> {
    return constructMod.roomDown(this, ...a);
  }
  /** Start of a room dragged on open ground (world), or null for one inside a building. */
  roomGround: Vec2 | null = null;

  /** The ground point under the pointer, on the grid when snapping. */
  groundPoint(...a: Tail<Parameters<typeof constructMod.groundPoint>>): ReturnType<typeof constructMod.groundPoint> {
    return constructMod.groundPoint(this, ...a);
  }

  roomGroundMove(...a: Tail<Parameters<typeof constructMod.roomGroundMove>>): ReturnType<typeof constructMod.roomGroundMove> {
    return constructMod.roomGroundMove(this, ...a);
  }

  /** A room dragged on open ground: walls around it (their inner faces on the rectangle) and the room. */
  roomGroundUp(...a: Tail<Parameters<typeof constructMod.roomGroundUp>>): ReturnType<typeof constructMod.roomGroundUp> {
    return constructMod.roomGroundUp(this, ...a);
  }
  roomStart: { x: number; y: number } | null = null;

  roomMove(...a: Tail<Parameters<typeof constructMod.roomMove>>): ReturnType<typeof constructMod.roomMove> {
    return constructMod.roomMove(this, ...a);
  }

  roomUp(...a: Tail<Parameters<typeof constructMod.roomUp>>): ReturnType<typeof constructMod.roomUp> {
    return constructMod.roomUp(this, ...a);
  }

  /** Name and area of each room of the floor shown, on the floor (only with the interior tools or the cut view). */
  drawRoomLabels(...a: Tail<Parameters<typeof annotateMod.drawRoomLabels>>): ReturnType<typeof annotateMod.drawRoomLabels> {
    return annotateMod.drawRoomLabels(this, ...a);
  }

  beginIwallHandle(...a: Tail<Parameters<typeof constructMod.beginIwallHandle>>): ReturnType<typeof constructMod.beginIwallHandle> {
    return constructMod.beginIwallHandle(this, ...a);
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
  bridgeSelected(...a: Tail<Parameters<typeof modelcmdsMod.bridgeSelected>>): ReturnType<typeof modelcmdsMod.bridgeSelected> {
    return modelcmdsMod.bridgeSelected(this, ...a);
  }

  combineSelected(...a: Tail<Parameters<typeof modelcmdsMod.combineSelected>>): ReturnType<typeof modelcmdsMod.combineSelected> {
    return modelcmdsMod.combineSelected(this, ...a);
  }

  /**
   * A free part on a wall becomes a facade rule of its type on every floor of that side (at its sill and
   * with its own values), like "Repeat on facade" in Estúdio de Construção; the part itself goes.
   */
  repeatOnFacade(...a: Tail<Parameters<typeof modelcmdsMod.repeatOnFacade>>): ReturnType<typeof modelcmdsMod.repeatOnFacade> {
    return modelcmdsMod.repeatOnFacade(this, ...a);
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  drawPlane(...a: Tail<Parameters<typeof drawingMod.drawPlane>>): ReturnType<typeof drawingMod.drawPlane> {
    return drawingMod.drawPlane(this, ...a);
  }

  drawDown(...a: Tail<Parameters<typeof drawingMod.drawDown>>): ReturnType<typeof drawingMod.drawDown> {
    return drawingMod.drawDown(this, ...a);
  }

  /** Inferences for the second point: a rectangle corner or a circle radius are not directions from the first. */
  secondPointSnap(...a: Tail<Parameters<typeof drawingMod.secondPointSnap>>): ReturnType<typeof drawingMod.secondPointSnap> {
    return drawingMod.secondPointSnap(this, ...a);
  }

  /** A free-hand stroke of the Curve tool is going on. */
  freehand = false;

  drawMove(...a: Tail<Parameters<typeof drawingMod.drawMove>>): ReturnType<typeof drawingMod.drawMove> {
    return drawingMod.drawMove(this, ...a);
  }

  drawDraft(...a: Tail<Parameters<typeof drawingMod.drawDraft>>): ReturnType<typeof drawingMod.drawDraft> {
    return drawingMod.drawDraft(this, ...a);
  }

  /** Points of the drawing in progress (rectangle in the building frame). */
  shapePoints(...a: Tail<Parameters<typeof drawingMod.shapePoints>>): ReturnType<typeof drawingMod.shapePoints> {
    return drawingMod.shapePoints(this, ...a);
  }

  finishPolygon(...a: Tail<Parameters<typeof drawingMod.finishPolygon>>): ReturnType<typeof drawingMod.finishPolygon> {
    return drawingMod.finishPolygon(this, ...a);
  }

  finishShape(...a: Tail<Parameters<typeof drawingMod.finishShape>>): ReturnType<typeof drawingMod.finishShape> {
    return drawingMod.finishShape(this, ...a);
  }

  // ── Components ───────────────────────────────────────────────────────
  // ── Massing blocks ───────────────────────────────────────────────────
  startBlock(...a: Tail<Parameters<typeof drawingMod.startBlock>>): ReturnType<typeof drawingMod.startBlock> {
    return drawingMod.startBlock(this, ...a);
  }

  /** Where the block would land: ground, top (stacks) or face (attaches aligned). */
  blockPlacement(...a: Tail<Parameters<typeof drawingMod.blockPlacement>>): ReturnType<typeof drawingMod.blockPlacement> {
    return drawingMod.blockPlacement(this, ...a);
  }

  snapLocal(...a: Tail<Parameters<typeof drawingMod.snapLocal>>): ReturnType<typeof drawingMod.snapLocal> {
    return drawingMod.snapLocal(this, ...a);
  }

  blockAt(...a: Tail<Parameters<typeof drawingMod.blockAt>>): ReturnType<typeof drawingMod.blockAt> {
    return drawingMod.blockAt(this, ...a);
  }

  // ── Tape and dimensions ──────────────────────────────────────────────
  tapeFrom: THREE.Vector3 | null = null;
  /** The building the first point of the tape was on (the dimension follows it). */
  tapeOn: ID | null = null;

  /** The pinned dimensions and labels in the world (project.notes, with their buildings' moves). */
  get dims(): { id: ID; a: THREE.Vector3; b: THREE.Vector3 }[] {
    return (this.project.notes ?? []).flatMap((n) => (n.kind === 'dim' ? [{ id: n.id, a: this.noteWorld(this.refPoint(n.building, n.aRef) ?? n.a, n.building), b: this.noteWorld(this.refPoint(n.building, n.bRef) ?? n.b, n.building) }] : []));
  }

  /** Where a tied dimension end is now (building frame), or null when its corner is gone. */
  private refPoint(...a: Tail<Parameters<typeof annotateMod.refPoint>>): ReturnType<typeof annotateMod.refPoint> {
    return annotateMod.refPoint(this, ...a);
  }

  /** The corner of a volume a point (building frame) lies on, at its base or top, within 3 cm. */
  refAt(...a: Tail<Parameters<typeof annotateMod.refAt>>): ReturnType<typeof annotateMod.refAt> {
    return annotateMod.refAt(this, ...a);
  }

  noteWorld(...a: Tail<Parameters<typeof annotateMod.noteWorld>>): ReturnType<typeof annotateMod.noteWorld> {
    return annotateMod.noteWorld(this, ...a);
  }

  /** A world point in the frame of `building` (or the world when none). */
  noteLocal(...a: Tail<Parameters<typeof annotateMod.noteLocal>>): ReturnType<typeof annotateMod.noteLocal> {
    return annotateMod.noteLocal(this, ...a);
  }

  tapePoint(...a: Tail<Parameters<typeof annotateMod.tapePoint>>): ReturnType<typeof annotateMod.tapePoint> {
    return annotateMod.tapePoint(this, ...a);
  }

  tapeAt(...a: Tail<Parameters<typeof annotateMod.tapeAt>>): ReturnType<typeof annotateMod.tapeAt> {
    return annotateMod.tapeAt(this, ...a);
  }

  /** First point of a cut across a top (local plan point on its edge). */
  cutFrom: { bid: ID; sid: ID; a: Vec2; y: number } | null = null;

  /**
   * Cut tool (SketchUp: a line across a face splits it; Blender Knife). On a
   * wall: a vertical line through the pointer splits the side in two faces
   * (Shift: a horizontal one splits the volume at that height). On a top: two
   * points of its edge cut the volume in two. Snaps to the middle, the grid and
   * the floors; the measure box takes the exact value.
   */
  cutAt(...a: Tail<Parameters<typeof drawingMod.cutAt>>): ReturnType<typeof drawingMod.cutAt> {
    return drawingMod.cutAt(this, ...a);
  }

  /** Draws the pinned dimensions (lines with ticks and labels). */
  drawDims(...a: Tail<Parameters<typeof annotateMod.drawDims>>): ReturnType<typeof annotateMod.drawDims> {
    return annotateMod.drawDims(this, ...a);
  }

  placeHover(...a: Tail<Parameters<typeof placeMod.placeHover>>): ReturnType<typeof placeMod.placeHover> {
    return placeMod.placeHover(this, ...a);
  }

  removeGhost(...a: Tail<Parameters<typeof placeMod.removeGhost>>): ReturnType<typeof placeMod.removeGhost> {
    return placeMod.removeGhost(this, ...a);
  }

  /** Where the component would land under the pointer (face, ground or roof). */
  placementAt(...a: Tail<Parameters<typeof placeMod.placementAt>>): ReturnType<typeof placeMod.placementAt> {
    return placeMod.placementAt(this, ...a);
  }

  /** The path part being drawn: its points (world) and, when it started on a flat top, its height and building. */
  pathDraft: { pts: Vec3[]; y: number; bid: ID | null } | null = null;

  /** Where a path part starts: on the flat top under the pointer (a terrace, a slab), else on the ground. */
  pathStart(...a: Tail<Parameters<typeof placeMod.pathStart>>): ReturnType<typeof placeMod.pathStart> {
    return placeMod.pathStart(this, ...a);
  }

  /**
   * A curtain wall over the whole selected side (Revit's curtain wall): it replaces the wall there, and the
   * side stops taking the facade rule's windows (blank) so nothing sits behind the glass.
   */
  curtainWall(...a: Tail<Parameters<typeof modelcmdsMod.curtainWall>>): ReturnType<typeof modelcmdsMod.curtainWall> {
    return modelcmdsMod.curtainWall(this, ...a);
  }

  /**
   * Beams between the columns of a building (Revit's beam system on the grid): each column joined to its
   * nearest neighbour on the same line (the same x or z, 5 cm of tolerance) up to 8 m away and on the same
   * floor, at the columns' top; beams already there are not repeated.
   */
  beamsBetweenColumns(...a: Tail<Parameters<typeof modelcmdsMod.beamsBetweenColumns>>): ReturnType<typeof modelcmdsMod.beamsBetweenColumns> {
    return modelcmdsMod.beamsBetweenColumns(this, ...a);
  }

  /** The look copied from a volume (Copy properties), to paste on others. */
  matchSource: (Pick<Solid, 'roof' | 'facade' | 'materials' | 'plinth' | 'bands' | 'bevel' | 'shell' | 'wallLayers'> & { dirs: Map<ID, Vec2> }) | null = null;

  /** Outward direction of each side of a volume (plan, unit), by its edge ID. */
  sideDirs(...a: Tail<Parameters<typeof modelcmdsMod.sideDirs>>): ReturnType<typeof modelcmdsMod.sideDirs> {
    return modelcmdsMod.sideDirs(this, ...a);
  }

  /**
   * Copy properties (SketchUp's Match, Revit's Match Type): the look of the selected volume — roof, facade
   * rules, materials, plinth, bands, bevel, walls — kept to paste on other volumes. Nothing of its shape.
   */
  copyProperties(...a: Tail<Parameters<typeof modelcmdsMod.copyProperties>>): ReturnType<typeof modelcmdsMod.copyProperties> {
    return modelcmdsMod.copyProperties(this, ...a);
  }

  /** Paste properties on the selected volumes (or every volume of the selected buildings). */
  pasteProperties(...a: Tail<Parameters<typeof modelcmdsMod.pasteProperties>>): ReturnType<typeof modelcmdsMod.pasteProperties> {
    return modelcmdsMod.pasteProperties(this, ...a);
  }

  /**
   * A corner window at the selected corner of a volume (on the floor shown): a window on each of the two
   * sides meeting there, each running to the corner, so the wall's corner is open from sill to head and
   * the two frames meet as the corner post.
   */
  cornerWindow(...a: Tail<Parameters<typeof modelcmdsMod.cornerWindow>>): ReturnType<typeof modelcmdsMod.cornerWindow> {
    return modelcmdsMod.cornerWindow(this, ...a);
  }

  /**
   * A new design option of the selected building (Revit's design options): a copy in the same place,
   * the next option of its set (A, B, C…), shown at once; the original becomes option A of a new set.
   */
  newDesignOption(...a: Tail<Parameters<typeof modelcmdsMod.newDesignOption>>): ReturnType<typeof modelcmdsMod.newDesignOption> {
    return modelcmdsMod.newDesignOption(this, ...a);
  }

  /** Keeps the shown option of the selected building's set and deletes the others (Revit's Accept Primary). */
  acceptDesignOption(...a: Tail<Parameters<typeof modelcmdsMod.acceptDesignOption>>): ReturnType<typeof modelcmdsMod.acceptDesignOption> {
    return modelcmdsMod.acceptDesignOption(this, ...a);
  }

  /**
   * Applies the live copies of the selected volume (repeat, mirror; Blender's Apply modifier): each copy
   * becomes a volume of its own with new IDs, right after the source, and the source keeps no modifier.
   */
  applyModifiers(...a: Tail<Parameters<typeof modelcmdsMod.applyModifiers>>): ReturnType<typeof modelcmdsMod.applyModifiers> {
    return modelcmdsMod.applyModifiers(this, ...a);
  }

  /** Saves the selected buildings as a component of the project's library (Library → My types). */
  saveAsComponent(...a: Tail<Parameters<typeof modelcmdsMod.saveAsComponent>>): ReturnType<typeof modelcmdsMod.saveAsComponent> {
    return modelcmdsMod.saveAsComponent(this, ...a);
  }

  /** Inserts a copy of a saved component at the middle of the view, selected (M moves it). */
  insertComponent(...a: Tail<Parameters<typeof modelcmdsMod.insertComponent>>): ReturnType<typeof modelcmdsMod.insertComponent> {
    return modelcmdsMod.insertComponent(this, ...a);
  }

  /** A railing around the selected flat top (a terrace, a slab edge), 8 cm in from its edge. */
  railAround(...a: Tail<Parameters<typeof modelcmdsMod.railAround>>): ReturnType<typeof modelcmdsMod.railAround> {
    return modelcmdsMod.railAround(this, ...a);
  }

  /**
   * Drawing a path part (fence, wall, railing): the points so far and the segment to the pointer as a
   * line, with the segment length and the total next to the cursor (before, a ghost part and the
   * meaningless "0; 0" of a building not made yet).
   */
  pathHover(...a: Tail<Parameters<typeof placeMod.pathHover>>): ReturnType<typeof placeMod.pathHover> {
    return placeMod.pathHover(this, ...a);
  }

  clearPathDraft(...a: Tail<Parameters<typeof placeMod.clearPathDraft>>): ReturnType<typeof placeMod.clearPathDraft> {
    return placeMod.clearPathDraft(this, ...a);
  }

  placeAt(...a: Tail<Parameters<typeof placeMod.placeAt>>): ReturnType<typeof placeMod.placeAt> {
    return placeMod.placeAt(this, ...a);
  }

  lastItem: ID | null = null;

  /** The sizes set in the top bar that the family takes (its parameters), for a new occurrence. */
  instanceParams(...a: Tail<Parameters<typeof placeMod.instanceParams>>): ReturnType<typeof placeMod.instanceParams> {
    return placeMod.instanceParams(this, ...a);
  }

  finishPath(...a: Tail<Parameters<typeof placeMod.finishPath>>): ReturnType<typeof placeMod.finishPath> {
    return placeMod.finishPath(this, ...a);
  }

  // ── Painting ─────────────────────────────────────────────────────────
  paintAt(...a: Tail<Parameters<typeof placeMod.paintAt>>): ReturnType<typeof placeMod.paintAt> {
    return placeMod.paintAt(this, ...a);
  }

  /**
   * The bucket on a window, door, awning or free part paints its main color (and finish) like SketchUp
   * paints a component: a facade part paints its rule (every one placed by it), a free part only itself.
   * Alt copies the part's color into the bucket. (It used to do nothing, without a word.)
   */
  paintPart(...a: Tail<Parameters<typeof placeMod.paintPart>>): ReturnType<typeof placeMod.paintPart> {
    return placeMod.paintPart(this, ...a);
  }

  // ── On-screen inference ──────────────────────────────────────────────
  showSnap(s: Snap, e: { clientX: number; clientY: number }): void {
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

  clearSnap(hideTip = true): void {
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

  showDim(text: string, e: { clientX: number; clientY: number }): void {
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
  pointerAt: { clientX: number; clientY: number } | null = null;

  private bindKeys(...a: Tail<Parameters<typeof keysMod.bindKeys>>): ReturnType<typeof keysMod.bindKeys> {
    return keysMod.bindKeys(this, ...a);
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
