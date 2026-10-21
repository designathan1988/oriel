// A line drawn on the ground point by point (click, click…; Enter or a double click ends, Esc drops it),
// for commands that need a path: copies of a part along it ("Along a path"). The points are world
// [x, z]; what is done with them is the caller's.
import * as THREE from 'three';
import type { Vec2 } from '../../model/schema';
import type { View } from '../view';

export interface PolylineHost {
  view: View;
  overlay: THREE.Group;
  /** The ground height the line is drawn on (world y). */
  y(): number;
  snap(p: Vec2): Vec2;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
}

const NAME = 'polyline-draft';
const MAT = new THREE.LineBasicMaterial({ color: '#3b82f6', depthTest: false });

export class PolylineTool {
  private pts: Vec2[] = [];
  private done: ((pts: Vec2[]) => void) | null = null;
  private prompt = '';

  constructor(private readonly h: PolylineHost) {}

  get active(): boolean {
    return !!this.done;
  }

  start(prompt: string, done: (pts: Vec2[]) => void): void {
    this.cancel();
    this.prompt = prompt;
    this.done = done;
  }

  private at(e: { clientX: number; clientY: number }): Vec2 | null {
    const p = this.h.view.onPlane(e, this.h.y());
    return p ? this.h.snap([p.x, p.z]) : null;
  }

  down(e: PointerEvent): void {
    const p = this.at(e);
    if (!p) return;
    const last = this.pts[this.pts.length - 1];
    if (last && (e.detail >= 2 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.2)) return void this.finish();
    this.pts.push(p);
  }

  move(e: PointerEvent): void {
    const p = this.at(e);
    if (!p) return;
    const last = this.pts[this.pts.length - 1];
    let len = 0;
    for (let i = 1; i < this.pts.length; i++) len += Math.hypot(this.pts[i]![0] - this.pts[i - 1]![0], this.pts[i]![1] - this.pts[i - 1]![1]);
    if (last) len += Math.hypot(p[0] - last[0], p[1] - last[1]);
    this.draw(last ? [...this.pts, p] : []);
    this.h.showDim(last ? `${Math.round(len * 10) / 10} m · Enter ends` : this.prompt, e);
  }

  /** Enter: ends the line. */
  finish(): boolean {
    if (!this.done) return false;
    const pts = this.pts,
      done = this.done;
    this.cancel();
    if (pts.length >= 2) done(pts);
    return true;
  }

  cancel(): void {
    this.pts = [];
    this.done = null;
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
    if (pts.length < 2) return void this.h.view.mark();
    const y = this.h.y() + 0.05;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], y, p[1]))), MAT);
    l.name = NAME;
    l.renderOrder = 10;
    this.h.overlay.add(l);
    this.h.view.mark();
  }
}

/** Points every `spacing` m along a polyline (from its start; the end too when it lands near), with the direction there (degrees, the yaw a part takes to face along). */
export function pointsAlong(pts: Vec2[], spacing: number): { p: Vec2; yaw: number }[] {
  const out: { p: Vec2; yaw: number }[] = [];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    const yaw = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
    let s = carry;
    while (s <= L + 1e-6) {
      out.push({ p: [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L], yaw });
      s += spacing;
    }
    carry = s - L;
  }
  return out;
}
