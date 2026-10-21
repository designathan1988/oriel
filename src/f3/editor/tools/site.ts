// Site tools (after Estúdio de Construção v4): Lot (drag a rectangle on the ground, or click two
// opposite corners) and Street (click the points of its center line; Enter or a double click ends,
// Esc drops it). The lots and streets are `Project3.lots` / `Project3.streets` (model/site.ts); the
// ready buildings, the split and the lots and trees along a street are actions of their panels.
import * as THREE from 'three';
import type { ID, Project3, Street, Vec2 } from '../../model/schema';
import type { View } from '../view';
import { frontTowardStreet, rectLotFrom } from '../../model/site';
import { uid } from '../../model/defaults';

/** What the tools need from the editor. */
export interface SiteHost {
  view: View;
  overlay: THREE.Group;
  project(): Project3;
  /** Records a change of the lots or streets (made in `fn` on the project). */
  changeSite(fn: (p: Project3) => void, message: string): void;
  pickSite(pick: { lot?: ID; street?: ID }): void;
  snap(p: Vec2): Vec2;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const DRAFT = 'site-draft';

export class SiteTools {
  private lotFrom: Vec2 | null = null;
  private dragged = false;
  private street: Vec2[] = [];

  constructor(private readonly h: SiteHost) {}

  get busy(): boolean {
    return !!this.lotFrom || this.street.length > 0;
  }

  private ground(e: { clientX: number; clientY: number }): Vec2 | null {
    const p = this.h.view.onPlane(e, 0);
    return p ? this.h.snap([p.x, p.z]) : null;
  }

  // ── Lot ──────────────────────────────────────────────────────────────
  lotDown(e: PointerEvent): void {
    const p = this.ground(e);
    if (!p) return;
    // The second click of a click-click rectangle.
    if (this.lotFrom && !this.dragged) return this.finishLot(p);
    this.lotFrom = p;
    this.dragged = false;
  }

  lotMove(e: PointerEvent, pressed: boolean): void {
    const p = this.ground(e);
    if (!p) return;
    if (!this.lotFrom) return this.h.showDim('Drag a rectangle on the ground (or click two corners)', e);
    const w = Math.abs(p[0] - this.lotFrom[0]),
      d = Math.abs(p[1] - this.lotFrom[1]);
    if (pressed && Math.max(w, d) > 0.5) this.dragged = true;
    this.draw([this.lotFrom, [p[0], this.lotFrom[1]], p, [this.lotFrom[0], p[1]]], true);
    this.h.showDim(`${fmt(w)} × ${fmt(d)} m · ${fmt(w * d)} m²`, e);
  }

  lotUp(e: PointerEvent): void {
    if (!this.lotFrom || !this.dragged) return;
    const p = this.ground(e);
    if (p) this.finishLot(p);
  }

  private finishLot(p: Vec2): void {
    const a = this.lotFrom!;
    this.cancel();
    if (Math.abs(p[0] - a[0]) < 2 || Math.abs(p[1] - a[1]) < 2) return;
    const n = this.h.project().lots.length + 1;
    // Its front faces the nearest street (the setbacks and the ready buildings follow it).
    const lot = frontTowardStreet(rectLotFrom(a, p, uid(), `Lot ${n}`), this.h.project().streets ?? []);
    this.h.changeSite((pr) => void pr.lots.push(lot), `Lot ${n}: ${fmt(Math.abs(p[0] - a[0]))} × ${fmt(Math.abs(p[1] - a[1]))} m. Its panel builds on it.`);
    this.h.pickSite({ lot: lot.id });
  }

  // ── Street ───────────────────────────────────────────────────────────
  streetDown(e: PointerEvent): void {
    const p = this.ground(e);
    if (!p) return;
    const last = this.street[this.street.length - 1];
    // A double click (or a click on the last point) ends the street.
    if (last && (e.detail >= 2 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.3)) return this.finishStreet();
    this.street.push(p);
  }

  streetMove(e: PointerEvent): void {
    const p = this.ground(e);
    if (!p) return;
    const last = this.street[this.street.length - 1];
    if (!last) return this.h.showDim('Click the start of the street', e);
    this.draw([...this.street, p], false);
    this.h.showDim(`${fmt(Math.hypot(p[0] - last[0], p[1] - last[1]))} m · Enter ends`, e);
  }

  finishStreet(): void {
    const pts = this.street.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1]![0], q[1] - a[i - 1]![1]) > 0.3);
    this.cancel();
    if (pts.length < 2) return;
    const n = (this.h.project().streets?.length ?? 0) + 1;
    const st: Street = { id: uid(), name: `Street ${n}`, points: pts, width: 7, sidewalk: 2.5 };
    this.h.changeSite((pr) => void (pr.streets ??= []).push(st), `Street ${n}: 7 m of asphalt and 2.5 m sidewalks. Its panel lays lots and trees along it.`);
    this.h.pickSite({ street: st.id });
  }

  /** Enter: ends the street being drawn. */
  enter(): boolean {
    if (!this.street.length) return false;
    this.finishStreet();
    return true;
  }

  cancel(): void {
    this.lotFrom = null;
    this.dragged = false;
    this.street = [];
    const o = this.h.overlay.getObjectByName(DRAFT);
    if (o) {
      this.h.overlay.remove(o);
      (o as THREE.Line).geometry.dispose();
    }
    this.h.hideDim();
    this.h.view.mark();
  }

  private draw(pts: Vec2[], closed: boolean): void {
    const old = this.h.overlay.getObjectByName(DRAFT);
    if (old) {
      this.h.overlay.remove(old);
      (old as THREE.Line).geometry.dispose();
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], 0.25, p[1])));
    const l = closed ? new THREE.LineLoop(g, MAT) : new THREE.Line(g, MAT);
    l.name = DRAFT;
    l.renderOrder = 10;
    this.h.overlay.add(l);
    this.h.view.mark();
  }
}

const MAT = new THREE.LineBasicMaterial({ color: '#3b82f6', depthTest: false });
