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
  /** Angle step (degrees) for each new segment, measured from the plan axes (Revit "angular dimension snap
   * increments"); absent or 0 = free. Alt held draws free. */
  angleStep?(): number;
  /** Length step (m) for each new segment (Revit "length dimension snap increments"); absent or 0 = free. */
  lengthStep?(): number;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
  /** The line is done: closed (a building) or open (a free-standing wall). */
  done(points: Vec2[], closed: boolean): void;
}

const NAME = 'walls-draft';
/** On-screen angle (radians) within which a segment locks on an axis or on the previous edge's direction. */
const AXIS_LOCK = (12 * Math.PI) / 180;
/** Distance (m) within which a locked segment ends in line with an earlier corner. */
const ALIGN = 0.6;
const MAT = new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false });

/**
 * The end of a segment drawn from `from` towards `to`: its direction turned to the nearest multiple of
 * `angleStep` degrees and its length rounded to `lengthStep` (a click in perspective lands on the plane
 * where the cursor is, so without this a rectangle drawn on screen becomes a trapezoid with odd sides).
 */
export function lockSegment(from: Vec2, to: Vec2, angleStep: number, lengthStep: number): Vec2 {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  let len = Math.hypot(dx, dz);
  if (len < 1e-9) return [from[0], from[1]];
  let a = Math.atan2(dz, dx);
  if (angleStep > 0) {
    const st = (angleStep * Math.PI) / 180;
    a = Math.round(a / st) * st;
  }
  if (lengthStep > 0) len = Math.max(lengthStep, Math.round(len / lengthStep) * lengthStep);
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [r(from[0] + Math.cos(a) * len), r(from[1] + Math.sin(a) * len)];
}

export class WallsTool {
  private pts: Vec2[] = [];

  constructor(private readonly h: WallsHost) {}

  get busy(): boolean {
    return this.pts.length > 0;
  }

  private at(e: { clientX: number; clientY: number; altKey?: boolean }): Vec2 | null {
    const p = this.h.view.onPlane(e, this.h.y?.() ?? 0);
    if (!p) return null;
    const last = this.pts[this.pts.length - 1];
    if (!last || e.altKey) return this.h.snap([p.x, p.z]);
    const step = this.h.lengthStep?.() ?? 0;
    // Axis inference judged on screen (SketchUp: a line drawn close to the red or green axis as seen
    // locks on it; magenta: parallel or perpendicular to the previous edge). In a perspective view a
    // line that looks straight across the screen is far from the axis in the plan: on screen it is close.
    const y = this.h.y?.() ?? 0;
    const prev = this.pts[this.pts.length - 2];
    const dirs: Vec2[] = [[1, 0], [0, 1]];
    if (prev) {
      const dx = last[0] - prev[0],
        dz = last[1] - prev[1],
        l = Math.hypot(dx, dz);
      if (l > 1e-6) dirs.push([dx / l, dz / l], [-dz / l, dx / l]);
    }
    const r = this.h.view.renderer.domElement.getBoundingClientRect();
    const L = this.h.view.toScreen(new THREE.Vector3(last[0], y, last[1]));
    const cx = e.clientX - r.left - L.x,
      cy = e.clientY - r.top - L.y;
    if (Math.hypot(cx, cy) > 8) {
      let best: { d: Vec2; off: number } | null = null;
      for (const d of dirs) {
        const S = this.h.view.toScreen(new THREE.Vector3(last[0] + d[0], y, last[1] + d[1]));
        const sx = S.x - L.x,
          sy = S.y - L.y;
        const sl = Math.hypot(sx, sy);
        if (sl < 1e-6) continue;
        // Angle between the cursor and the axis on screen, either way along the axis.
        const off = Math.abs(Math.asin(Math.max(-1, Math.min(1, (sx * cy - sy * cx) / (sl * Math.hypot(cx, cy))))));
        if (off < AXIS_LOCK && (!best || off < best.off)) best = { d, off };
      }
      if (best) {
        const d = best.d;
        let t = (p.x - last[0]) * d[0] + (p.z - last[1]) * d[1];
        if (step > 0) t = Math.sign(t || 1) * Math.max(step, Math.round(Math.abs(t) / step) * step);
        // In line with an earlier corner (the first one above all: the outline then closes square).
        const raw = (p.x - last[0]) * d[0] + (p.z - last[1]) * d[1];
        for (const c of this.pts.slice(0, -1)) {
          const tc = (c[0] - last[0]) * d[0] + (c[1] - last[1]) * d[1];
          if (Math.abs(tc) > 1e-6 && Math.abs(tc - raw) < ALIGN) {
            t = tc;
            break;
          }
        }
        const q = (v: number) => Math.round(v * 1e6) / 1e6;
        return [q(last[0] + d[0] * t), q(last[1] + d[1] * t)];
      }
    }
    return lockSegment(last, [p.x, p.z], this.h.angleStep?.() ?? 0, step);
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
