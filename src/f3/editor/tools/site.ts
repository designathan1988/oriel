// Site tools (after Estúdio de Construção v4): Lot (drag a rectangle on the ground, or click two
// opposite corners) and Street (click the points of its center line; Enter or a double click ends,
// Esc drops it). The lots and streets are `Project3.lots` / `Project3.streets` (model/site.ts); the
// ready buildings, the split and the lots and trees along a street are actions of their panels.
import * as THREE from 'three';
import type { ID, Project3, Street, Vec2 } from '../../model/schema';
import type { View } from '../view';
import { DEFAULT_SETBACKS, frontTowardStreet } from '../../model/site';
import { signedArea2 } from '../../model/plan';
import { uid } from '../../model/defaults';
import { decimal, tr } from '../../ui/i18n';

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
  toast(text: string): void;
}

const fmt = (n: number) => decimal(Math.round(n * 10) / 10);
const DRAFT = 'site-draft';

export class SiteTools {
  private lotFrom: Vec2 | null = null;
  /** Direction of the lot's sides: along the nearest street (within 40 m), else the world axes. */
  private lotDir: Vec2 = [1, 0];
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
    this.lotDir = this.streetDir(p);
    this.dragged = false;
  }

  /** The direction of the street segment nearest to `p` (within 40 m), else +x. */
  private streetDir(p: Vec2): Vec2 {
    let best: Vec2 = [1, 0],
      bestD = 40;
    for (const st of this.h.project().streets ?? [])
      for (let i = 0; i + 1 < st.points.length; i++) {
        const a = st.points[i]!,
          b = st.points[i + 1]!;
        const dx = b[0] - a[0],
          dz = b[1] - a[1];
        const L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (L * L)));
        const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]);
        if (d < bestD) {
          bestD = d;
          best = [dx / L, dz / L];
        }
      }
    // The sides closest to the world axes (a street drawn left to right or right to left gives the same lot).
    return Math.abs(best[0]) >= Math.abs(best[1]) ? (best[0] < 0 ? [-best[0], -best[1]] : best) : best[1] < 0 ? [best[1], -best[0]] : [-best[1], best[0]];
  }

  /** The lot's rectangle from its first corner to `p`: its sides along `lotDir`; width and depth. */
  private lotRect(p: Vec2): { ring: Vec2[]; w: number; d: number } {
    const a = this.lotFrom!,
      t = this.lotDir,
      n: Vec2 = [-t[1], t[0]];
    const u = (p[0] - a[0]) * t[0] + (p[1] - a[1]) * t[1],
      v = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
    const at = (x: number, y: number): Vec2 => [a[0] + t[0] * x + n[0] * y, a[1] + t[1] * x + n[1] * y];
    const ring = [a, at(u, 0), at(u, v), at(0, v)];
    return { ring: signedArea2(ring) >= 0 ? ring : ring.reverse(), w: Math.abs(u), d: Math.abs(v) };
  }

  lotMove(e: PointerEvent, pressed: boolean): void {
    const p = this.ground(e);
    if (!p) return;
    if (!this.lotFrom) return this.h.showDim('Drag a rectangle on the ground (or click two corners)', e);
    const { ring, w, d } = this.lotRect(p);
    if (pressed && Math.max(w, d) > 0.5) this.dragged = true;
    this.draw(ring, true);
    this.h.showDim(`${fmt(w)} × ${fmt(d)} m · ${fmt(w * d)} m²`, e);
  }

  lotUp(e: PointerEvent): void {
    if (!this.lotFrom || !this.dragged) return;
    const p = this.ground(e);
    if (p) this.finishLot(p);
  }

  private finishLot(p: Vec2): void {
    const { ring, w, d } = this.lotRect(p);
    this.cancel();
    if (w < 2 || d < 2) return this.h.toast('A lot is at least 2 × 2 m.');
    const n = this.h.project().lots.length + 1;
    // Its front faces the nearest street (the setbacks and the ready buildings follow it).
    const lot = frontTowardStreet({ id: uid(), name: tr(`Lot ${n}`), polygon: ring, frontEdges: [0], rules: { setbacks: { ...DEFAULT_SETBACKS }, enforcement: 'warn' } }, this.h.project().streets ?? []);
    this.h.changeSite((pr) => void pr.lots.push(lot), `Lot ${n}: ${fmt(w)} × ${fmt(d)} m.`);
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
    const st: Street = { id: uid(), name: tr(`Street ${n}`), points: pts, width: 7, sidewalk: 2.5 };
    this.h.changeSite((pr) => void (pr.streets ??= []).push(st), `Street ${n}: 7 m of asphalt and 2.5 m sidewalks.`);
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
