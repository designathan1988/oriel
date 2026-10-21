// Walls tool (ArchiCAD Wall, Revit Wall, SketchUp drawing walls): click the points of the wall's centre
// line on the ground. Clicking the first point again closes it: a building whose walls have that
// thickness (a volume as wide as the outer face, hollow by the thickness: Solid.shell), its height typed
// after. Enter or a double click ends an open line: a free-standing wall (the masonry wall part).
import * as THREE from 'three';
import type { Vec2 } from '../../model/schema';
import type { View } from '../view';

export interface WallsHost {
  view: View;
  overlay: THREE.Group;
  thickness(): number;
  /** Height of the drawing plane (world y; the ground when absent). */
  y?(): number;
  /** Words of the prompts (the Slab tool reuses this drawing). */
  words?: { start: string; close: string; open: string };
  snap(p: Vec2): Vec2;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
  /** The line is done: closed (a building) or open (a free-standing wall). */
  done(points: Vec2[], closed: boolean): void;
}

const NAME = 'walls-draft';
const MAT = new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false });

export class WallsTool {
  private pts: Vec2[] = [];

  constructor(private readonly h: WallsHost) {}

  get busy(): boolean {
    return this.pts.length > 0;
  }

  private at(e: { clientX: number; clientY: number }): Vec2 | null {
    const p = this.h.view.onPlane(e, this.h.y?.() ?? 0);
    return p ? this.h.snap([p.x, p.z]) : null;
  }

  /** Near the first point on screen (closing the outline). */
  private onFirst(e: { clientX: number; clientY: number }): boolean {
    if (this.pts.length < 3) return false;
    const f = this.pts[0]!;
    const s = this.h.view.toScreen(new THREE.Vector3(f[0], this.h.y?.() ?? 0, f[1]));
    const r = this.h.view.renderer.domElement.getBoundingClientRect();
    return Math.hypot(s.x + r.left - e.clientX, s.y + r.top - e.clientY) < 14;
  }

  down(e: PointerEvent): void {
    if (this.onFirst(e)) return this.finish(true);
    const p = this.at(e);
    if (!p) return;
    const last = this.pts[this.pts.length - 1];
    if (last && (e.detail >= 2 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.15)) return this.finish(false);
    this.pts.push(p);
  }

  move(e: PointerEvent): void {
    const p = this.at(e);
    if (!p) return;
    const last = this.pts[this.pts.length - 1];
    if (!last) return this.h.showDim(this.h.words?.start ?? `Click the start of the wall (${this.h.thickness()} m thick; type another thickness)`, e);
    const closing = this.onFirst(e);
    this.draw(closing ? [...this.pts, this.pts[0]!] : [...this.pts, p]);
    this.h.showDim(closing ? (this.h.words?.close ?? 'Click: close into a building') : `${Math.round(Math.hypot(p[0] - last[0], p[1] - last[1]) * 100) / 100} m · ${this.h.words?.open ?? 'Enter: free wall'}`, e);
  }

  /** Enter: ends an open line (a free-standing wall). */
  enter(): boolean {
    if (this.pts.length < 2) return false;
    this.finish(false);
    return true;
  }

  private finish(closed: boolean): void {
    const pts = this.pts;
    this.cancel();
    if (pts.length >= (closed ? 3 : 2)) this.h.done(pts, closed);
  }

  cancel(): void {
    this.pts = [];
    const o = this.h.overlay.getObjectByName(NAME);
    if (o) {
      this.h.overlay.remove(o);
      (o as THREE.Line).geometry.dispose();
    }
    this.h.hideDim();
    this.h.view.mark();
  }

  private draw(pts: Vec2[]): void {
    const old = this.h.overlay.getObjectByName(NAME);
    if (old) {
      this.h.overlay.remove(old);
      (old as THREE.Line).geometry.dispose();
    }
    const y = (this.h.y?.() ?? 0) + 0.05;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], y, p[1]))), MAT);
    l.name = NAME;
    l.renderOrder = 10;
    this.h.overlay.add(l);
    this.h.view.mark();
  }
}
