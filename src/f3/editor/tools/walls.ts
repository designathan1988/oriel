// Walls tool (ArchiCAD Wall, Revit Wall chain, SketchUp drawing walls): click the points of the wall's
// line; with a `segment` host every click builds that piece of wall at once (Revit's chain), Ctrl+Z or
// Backspace takes the last one back, Enter, Esc or a double click ends the chain. Clicking the first point
// again closes it (a building, or a closed room inside one). The cursor sticks to the points already
// clicked; a typed "5" is 5 m towards the cursor, "5<30" is 5 m at 30° (counterclockwise from +x, seen
// from above). Without a `segment` host (the Slab tool) the outline is only drawn until it closes.
import * as THREE from 'three';
import type { Vec2 } from '../../model/schema';
import type { View } from '../view';
import { decimal } from '../../ui/i18n';

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
  /** Snap on (G, the magnet): off, the points follow the cursor with no axis lock or alignment. */
  snapOn?(): boolean;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
  /** The line is done: closed (a building) or open (a free-standing wall). */
  done(points: Vec2[], closed: boolean): void;
  /** A piece of the chain is made at once, from `a` to `b` (world plan points). */
  segment?(a: Vec2, b: Vec2): void;
  /** The last piece made by `segment` is taken back (Ctrl+Z, Backspace while drawing). */
  unsegment?(): void;
}

const NAME = 'walls-draft';
/** On-screen angle (radians) within which a segment locks on an axis or on the previous edge's direction. */
const AXIS_LOCK = (12 * Math.PI) / 180;
/** Distance (m) within which a locked segment ends in line with an earlier corner. */
const ALIGN = 0.6;
const MAT = new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false });
/** Screen distance (px) within which the cursor sticks to a point already clicked. */
const STICK_PX = 20;

/** Direction of a segment in degrees, counterclockwise from +x seen from above (0 to 360). */
export function planAngle(a: Vec2, b: Vec2): number {
  const d = (Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI;
  return Math.round(((d % 360) + 360) % 360 * 10) / 10;
}

/** "5", "5<30", "5;30", "5 30°": a length and an optional angle (degrees), or null. */
export function parseLengthAngle(t: string, parseLength: (s: string) => number | null): { len: number; angle: number | null } | null {
  const m = /^\s*(.+?)\s*(?:[<;@]|\s)\s*(-?[\d.,]+)\s*°?\s*$/.exec(t);
  if (m) {
    const len = parseLength(m[1]!);
    const ang = parseFloat(m[2]!.replace(',', '.'));
    if (len !== null && len > 0 && Number.isFinite(ang)) return { len, angle: ang };
  }
  const len = parseLength(t);
  return len !== null && len > 0 ? { len, angle: null } : null;
}

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
  /** Where the next point would go (the cursor, locked): the direction of a typed length. */
  private hover: Vec2 | null = null;

  constructor(private readonly h: WallsHost) {}

  get busy(): boolean {
    return this.pts.length > 0;
  }

  /** A point already clicked within STICK_PX of the cursor on screen (the first one wins). */
  private stuck(e: { clientX: number; clientY: number }): Vec2 | null {
    const r = this.h.view.renderer.domElement.getBoundingClientRect();
    const y = this.h.y?.() ?? 0;
    const order = this.pts.length >= 3 ? [this.pts[0]!, ...this.pts.slice(1, -1)] : this.pts.slice(0, -1);
    for (const q of order) {
      const s = this.h.view.toScreen(new THREE.Vector3(q[0], y, q[1]));
      if (Math.hypot(s.x + r.left - e.clientX, s.y + r.top - e.clientY) < STICK_PX) return q;
    }
    return null;
  }

  private at(e: { clientX: number; clientY: number; altKey?: boolean }): Vec2 | null {
    const p = this.h.view.onPlane(e, this.h.y?.() ?? 0);
    if (!p) return null;
    const st = this.stuck(e);
    if (st) return [st[0], st[1]];
    const last = this.pts[this.pts.length - 1];
    if (!last || e.altKey) return this.h.snap([p.x, p.z]);
    if (this.h.snapOn && !this.h.snapOn()) return [p.x, p.z];
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
    return Math.hypot(s.x + r.left - e.clientX, s.y + r.top - e.clientY) < STICK_PX;
  }

  /** The point lands on the first one (snapped there, or typed): the outline closes. */
  private atFirst(p: Vec2): boolean {
    const f = this.pts[0];
    return this.pts.length >= 3 && !!f && Math.hypot(p[0] - f[0], p[1] - f[1]) < 0.3;
  }

  down(e: PointerEvent): void {
    if (this.onFirst(e)) return this.finish(true);
    const p = this.at(e);
    if (!p) return;
    // Snapped onto the start (in line with it on both axes, or within 30 cm): closes, as the line shows.
    if (this.atFirst(p)) return this.finish(true);
    const last = this.pts[this.pts.length - 1];
    if (last && (e.detail >= 2 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.15)) return this.finish(false);
    this.add(p);
  }

  /** A new point of the chain: with a live host the piece of wall up to it is made at once. */
  private add(p: Vec2): void {
    const last = this.pts[this.pts.length - 1];
    this.pts.push(p);
    if (last) this.h.segment?.(last, p);
    this.draw(this.pts);
  }

  /** Ctrl+Z or Backspace while drawing: the last point (and the piece of wall it made) goes back. */
  back(): boolean {
    if (!this.pts.length) return false;
    if (this.pts.length >= 2) this.h.unsegment?.();
    this.pts.pop();
    if (!this.pts.length) this.cancel();
    else this.draw(this.hover ? [...this.pts, this.hover] : this.pts);
    return true;
  }

  move(e: PointerEvent): void {
    const p = this.at(e);
    if (!p) return;
    this.hover = p;
    const last = this.pts[this.pts.length - 1];
    if (!last) return this.h.showDim(this.h.words?.start ?? `Click the start of the wall (${this.h.thickness()} m thick; type another thickness)`, e);
    const closing = this.onFirst(e) || this.atFirst(p);
    this.draw(closing ? [...this.pts, this.pts[0]!] : [...this.pts, p]);
    const len = Math.round(Math.hypot(p[0] - last[0], p[1] - last[1]) * 100) / 100;
    this.h.showDim(closing ? (this.h.words?.close ?? 'Click: close into a building') : `${decimal(len)} m · ${decimal(planAngle(last, p))}° · ${this.h.words?.open ?? 'Esc ends'}`, e);
  }

  /**
   * A typed length (Revit, SketchUp, Sweet Home 3D: start the wall, point the direction, type the length,
   * Enter): the next point goes that far from the last one, towards the cursor. False before the first point.
   */
  typed(len: number, angle: number | null = null): boolean {
    const last = this.pts[this.pts.length - 1];
    if (!last || !(len > 0)) return false;
    const h = this.hover ?? [last[0] + 1, last[1]];
    let dx = h[0] - last[0],
      dz = h[1] - last[1];
    const l = Math.hypot(dx, dz);
    if (angle !== null) {
      // The typed angle: counterclockwise from +x seen from above (the plan's −z is up on screen).
      const a = (angle * Math.PI) / 180;
      [dx, dz] = [Math.cos(a), -Math.sin(a)];
    } else if (l < 1e-6) [dx, dz] = [1, 0];
    else [dx, dz] = [dx / l, dz / l];
    const q = (v: number) => Math.round(v * 1e6) / 1e6;
    const p: Vec2 = [q(last[0] + dx * len), q(last[1] + dz * len)];
    // Back on the first point: the outline closes.
    const f = this.pts[0]!;
    if (this.pts.length >= 3 && Math.hypot(p[0] - f[0], p[1] - f[1]) < 0.02) {
      this.finish(true);
      return true;
    }
    this.hover = [p[0] + dx, p[1] + dz];
    this.add(p);
    this.draw([...this.pts, this.hover]);
    return true;
  }

  /** Enter or Esc: ends the chain (the walls made stay; an open outline of the Slab tool is dropped). */
  enter(): boolean {
    if (!this.pts.length) return false;
    if (this.pts.length < 2) {
      this.cancel();
      return true;
    }
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
    this.hover = null;
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
