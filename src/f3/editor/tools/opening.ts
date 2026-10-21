// Opening tool (O), after the one of Estúdio de Construção: a click on a wall puts a window on that
// floor; a rectangle dragged on a wall asks what it is (window, door, balcony door, shopfront, balcony,
// canopy, annex, niche), with the likely answer chosen from its shape (standing on the floor: a door; wide
// on the ground floor: a shopfront). Windows and doors are free parts with the rectangle's size; an annex
// or a niche is a volume made on that stretch of the wall (model/modeling.ts, sideVolume).
import * as THREE from 'three';
import type { Building3, ID, Item, Project3, Solid } from '../../model/schema';
import type { FaceFrame } from '../../eval/faces';
import type { Hit, View } from '../view';
import { findSolid } from '../../model/ops';
import { edgeLength, sideVolume } from '../../model/modeling';
import { uid } from '../../model/defaults';
import { family, typeById } from '../../families/index';
import { resolveParams } from '../../families/family';
import { choose } from '../../ui/chooser';

/** What the tool needs from the editor. */
export interface OpeningHost {
  view: View;
  root: HTMLElement;
  overlay: THREE.Group;
  project(): Project3;
  building(id: ID): Building3 | undefined;
  pickBody(e: { clientX: number; clientY: number }): Hit | null;
  change(bid: ID, fn: (b: Building3) => void | boolean, message: string): boolean;
  selectItem(bid: ID, item: ID): void;
  selectSolid(bid: ID, solid: ID): void;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
  toast(msg: string): void;
}

interface Wall {
  bid: ID;
  sid: ID;
  edge: ID;
  frame: FaceFrame;
  /** Building matrix (local → world) when the gesture began. */
  M: THREE.Matrix4;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export class OpeningTool {
  private wall: Wall | null = null;
  private a: { s: number; y: number; x: number; yScreen: number } | null = null;
  private b: { s: number; y: number } | null = null;

  constructor(private readonly h: OpeningHost) {}

  /** The wall under the pointer (a side face with a frame), or null. */
  private wallAt(e: { clientX: number; clientY: number }): (Wall & { s: number; y: number }) | null {
    const hit = this.h.pickBody(e);
    const f = hit?.face;
    if (!hit || !f || f.kind !== 'side' || !f.frame || !f.edge || f.edge.endsWith(':c')) return null;
    const M = this.h.view.buildingMatrix(hit.building);
    const p = hit.point.clone().applyMatrix4(M.clone().invert());
    const { s, y } = this.coords(f.frame, p);
    return { bid: hit.building.id, sid: f.solid, edge: f.edge, frame: f.frame, M, s, y };
  }

  private coords(fr: FaceFrame, p: THREE.Vector3): { s: number; y: number } {
    const d = [p.x - fr.o[0], p.y - fr.o[1], p.z - fr.o[2]] as const;
    return { s: fr.s0 + d[0] * fr.u[0] + d[1] * fr.u[1] + d[2] * fr.u[2], y: d[0] * fr.v[0] + d[1] * fr.v[1] + d[2] * fr.v[2] };
  }

  /** The point of the wall plane under the pointer (wall coordinates), during a drag. */
  private onWall(e: { clientX: number; clientY: number }): { s: number; y: number } | null {
    const w = this.wall!;
    const fr = w.frame;
    const ray = this.h.view.rayFrom(e).ray;
    const inv = w.M.clone().invert();
    const o = ray.origin.clone().applyMatrix4(inv),
      dir = ray.direction.clone().transformDirection(inv);
    const n = new THREE.Vector3(...fr.n),
      po = new THREE.Vector3(...fr.o);
    const den = dir.dot(n);
    if (Math.abs(den) < 1e-6) return null;
    const t = po.clone().sub(o).dot(n) / den;
    if (t < 0) return null;
    return this.coords(fr, o.addScaledVector(dir, t));
  }

  private world(s: number, y: number): THREE.Vector3 {
    const fr = this.wall!.frame;
    const ds = s - fr.s0;
    const at = (k: number) => fr.o[k]! + fr.u[k]! * ds + fr.v[k]! * y + fr.n[k]! * 0.03;
    return new THREE.Vector3(at(0), at(1), at(2)).applyMatrix4(this.wall!.M);
  }

  private clearDraft(): void {
    const old = this.h.overlay.getObjectByName('opening');
    if (!old) return;
    this.h.overlay.remove(old);
    (old as THREE.Line).geometry.dispose();
    this.h.view.mark();
  }

  private drawRect(s0: number, y0: number, s1: number, y1: number): void {
    this.clearDraft();
    const pts = [this.world(s0, y0), this.world(s1, y0), this.world(s1, y1), this.world(s0, y1)];
    const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#2f9bff', depthTest: false }));
    l.name = 'opening';
    l.renderOrder = 27;
    this.h.overlay.add(l);
    this.h.view.mark();
  }

  hover(e: PointerEvent): void {
    if (this.a && this.wall) {
      const p = this.onWall(e);
      if (!p) return;
      this.b = p;
      const s0 = Math.min(this.a.s, p.s),
        s1 = Math.max(this.a.s, p.s),
        y0 = Math.min(this.a.y, p.y),
        y1 = Math.max(this.a.y, p.y);
      this.drawRect(s0, y0, s1, y1);
      this.h.showDim(`${fmt(s1 - s0)} × ${fmt(y1 - y0)} m`, e);
      return;
    }
    this.h.showDim(this.wallAt(e) ? 'Click: a window here · drag a rectangle: choose what it is' : 'Point at a wall', e);
  }

  /** 'pull': the rectangle tool drawing on a wall (the rectangle is pulled out or carved in). */
  private mode: 'opening' | 'pull' = 'opening';

  /** Is there a wall under the pointer (for the rectangle tool to draw on it)? */
  onAWall(e: { clientX: number; clientY: number }): boolean {
    return !!this.wallAt(e);
  }

  down(e: PointerEvent, mode: 'opening' | 'pull' = 'opening'): void {
    const w = this.wallAt(e);
    if (!w) return this.h.toast('Point at a wall.');
    this.mode = mode;
    this.wall = w;
    this.a = { s: w.s, y: w.y, x: e.clientX, yScreen: e.clientY };
    this.b = null;
  }

  /** Whether a gesture is going on (the editor routes the moves and the release here). */
  get active(): boolean {
    return !!this.a;
  }

  up(e: PointerEvent): void {
    const a = this.a,
      w = this.wall;
    this.a = null;
    this.clearDraft();
    this.h.hideDim();
    if (!a || !w) return;
    const b = this.h.building(w.bid);
    const s = b && findSolid(b, w.sid);
    if (!b || !s) return;
    const moved = Math.hypot(e.clientX - a.x, e.clientY - a.yScreen) > 8 && this.b;
    if (!moved && this.mode === 'pull') return this.h.toast('Drag a rectangle on the wall, then choose: pull it out or carve it in.');
    if (!moved) return this.placeWindow(b, s, w, a.s, a.y);
    const len = edgeLength(s, w.edge);
    const r = { s0: Math.max(0, Math.min(a.s, this.b!.s)), s1: Math.min(len, Math.max(a.s, this.b!.s)), y0: Math.max(0, Math.min(a.y, this.b!.y)), y1: Math.min(s.height, Math.max(a.y, this.b!.y)) };
    if (r.s1 - r.s0 < 0.3 || r.y1 - r.y0 < 0.3) return this.placeWindow(b, s, w, a.s, a.y);
    const floor = this.floorAt(b, s, r.y0);
    const onFloor = r.y0 - floor.y < 0.35;
    const def = onFloor ? (r.s1 - r.s0 > 2.2 && floor.index === 0 ? 'shopfront' : 'door') : 'window';
    if (this.mode === 'pull') {
      choose(this.h.root, e.clientX, e.clientY, 'The rectangle on the wall', [
        { id: 'annex', label: 'Pull out', hint: 'A volume coming out of the wall (drag its face for the depth)' },
        { id: 'niche', label: 'Carve in', hint: 'Carved into the wall' },
      ], 'annex', (id) => {
        if (id) this.make(b.id, s.id, w, id, r, floor, len);
      });
      return;
    }
    choose(this.h.root, e.clientX, e.clientY, 'This rectangle is', [
      { id: 'window', label: 'Window' },
      { id: 'archwin', label: 'Arched window', hint: 'A round arch at the top of the rectangle' },
      { id: 'door', label: 'Door' },
      { id: 'archdoor', label: 'Arched door' },
      { id: 'french', label: 'Balcony door' },
      { id: 'shopfront', label: 'Shopfront' },
      { id: 'balcony', label: 'Balcony', hint: 'A slab with a railing on this floor' },
      { id: 'canopy', label: 'Canopy', hint: 'At the top of the rectangle' },
      { id: 'annex', label: 'Annex', hint: 'A volume coming out of the wall' },
      { id: 'niche', label: 'Niche', hint: 'The rectangle carved into the wall' },
    ], def, (id) => {
      if (id) this.make(b.id, s.id, w, id, r, floor, len);
    });
  }

  cancel(): void {
    this.a = null;
    this.clearDraft();
  }

  /** The floor (building level) a height of the volume is on, as a height above the volume base. */
  private floorAt(b: Building3, s: Solid, y: number): { index: number; y: number } {
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    let index = 0;
    lv.forEach((l, i) => {
      if (l.elevation - s.base <= y + 0.01) index = i;
    });
    return { index, y: Math.max(0, (lv[index]?.elevation ?? s.base) - s.base) };
  }

  /** The window type of this volume's facade (its first window rule), else the casement. */
  private windowType(s: Solid): ID {
    for (const r of s.facade) if (family(typeById(r.type, this.h.project())?.family ?? '')?.category === 'windows') return r.type;
    return 'win-casement';
  }

  private placeWindow(b: Building3, s: Solid, w: Wall, at: number, y: number): void {
    const type = this.windowType(s);
    const t = typeById(type, this.h.project());
    const f = t && family(t.family);
    const sill = f ? (f.sill?.(resolveParams(f, t!.params)) ?? 0.9) : 0.9;
    const floor = this.floorAt(b, s, y);
    const it: Item = { id: uid(), type, params: {}, host: { kind: 'face', solid: s.id, edge: w.edge, u: at, y: floor.y + sill } };
    if (this.h.change(b.id, (x) => void x.items.push(it), `${t?.name ?? 'Window'} placed on floor ${floor.index + 1}.`)) this.h.selectItem(b.id, it.id);
  }

  private make(bid: ID, sid: ID, w: Wall, id: string, r: { s0: number; s1: number; y0: number; y1: number }, floor: { index: number; y: number }, len: number): void {
    const b = this.h.building(bid);
    const s = b && findSolid(b, sid);
    if (!b || !s) return;
    const cx = (r.s0 + r.s1) / 2,
      wd = r.s1 - r.s0;
    const cm = (v: number) => Math.round(v * 100) / 100;
    const part = (type: ID, params: Record<string, number | string>, y: number, msg: string) => {
      // Sizes and positions kept to the centimetre (the drag gives float noise).
      for (const k of Object.keys(params)) if (typeof params[k] === 'number') params[k] = cm(params[k] as number);
      const it: Item = { id: uid(), type, params, host: { kind: 'face', solid: sid, edge: w.edge, u: cm(cx), y: cm(y) } };
      if (this.h.change(bid, (x) => void x.items.push(it), msg)) this.h.selectItem(bid, it.id);
    };
    const doorH = r.y1 - floor.y;
    if (id === 'window') return part(this.windowType(s), { width: wd, height: r.y1 - r.y0 }, r.y0, `Window ${fmt(wd)} × ${fmt(r.y1 - r.y0)} m.`);
    if (id === 'archwin') return part(this.windowType(s), { width: wd, height: r.y1 - r.y0, shape: 'arch' }, r.y0, `Arched window ${fmt(wd)} × ${fmt(r.y1 - r.y0)} m.`);
    if (id === 'archdoor') return part('door-panel', { width: wd, height: doorH, shape: 'arch' }, floor.y, `Arched door ${fmt(wd)} × ${fmt(doorH)} m.`);
    if (id === 'door') return part('door-panel', { width: wd, height: doorH }, floor.y, `Door ${fmt(wd)} × ${fmt(doorH)} m.`);
    if (id === 'french') return part('door-french', { width: wd, height: doorH }, floor.y, `Balcony door ${fmt(wd)} × ${fmt(doorH)} m.`);
    if (id === 'shopfront') return part('shopfront-plain', { width: wd, height: doorH }, floor.y, `Shopfront ${fmt(wd)} m wide.`);
    if (id === 'balcony') return part('balcony-bars', { width: wd }, floor.y, `Balcony ${fmt(wd)} m wide.`);
    if (id === 'canopy') return part('canopy-concrete', { width: wd }, r.y1, `Canopy ${fmt(wd)} m wide.`);
    let made: ID | null = null;
    const ok = this.h.change(bid, (x) => {
      const so = findSolid(x, sid)!;
      const v = sideVolume(x, so, w.edge, id === 'annex' ? 2.5 : -0.6, { left: r.s0, right: Math.max(0, len - r.s1), bottom: r.y0, top: Math.max(0, so.height - r.y1) });
      made = v?.id ?? null;
      return !!v;
    }, id === 'annex' ? 'Annex made on the wall (drag its face to change its depth).' : 'Niche carved into the wall.');
    if (ok && made) this.h.selectSolid(bid, made);
  }
}
