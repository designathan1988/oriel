// Editor handles drawn over the model (constant screen size) and the
// pixel hit test. The manipulator follows the Rhino Gumball: red/blue
// arrows move on the ground, the ring rotates in Y, the green arrow moves vertically;
// on a face the orange arrow pushes/pulls; vertex and side-midpoint dots edit the plan.
import * as THREE from 'three';
import type { ID } from '../model/schema';
import type { View } from './view';

export type HandleKind = 'move-x' | 'move-z' | 'move-xz' | 'move-y' | 'lift' | 'rotate' | 'push' | 'height' | 'vertex' | 'bend' | 'taper' | 'cwidth' | 'cheight' | 'csill' | 'size' | 'pdim' | 'twist' | 'pmove' | 'pscale';

export interface Handle {
  kind: HandleKind;
  /** Anchor point in the world. */
  at: THREE.Vector3;
  /** Arrow direction (world). */
  dir?: THREE.Vector3;
  /** Polyline for the hit test (rotation ring). */
  ring?: THREE.Vector3[];
  solid?: ID;
  edge?: ID;
  vertex?: ID;
  /** Size handle: which side of the box it pulls (-1, 0 or 1 in local x and z). */
  sx?: number;
  sz?: number;
  /** Face handle: outward normal (world); hidden when the face turns its back to the camera. */
  normal?: THREE.Vector3;
  /** Plane square (move on the ground): the two plane axes; it sits between the arrows, off center. */
  plane?: [THREE.Vector3, THREE.Vector3];
  /** Gizmo raised this many pixels above the point (above the height square, never on top of it). */
  liftPx?: number;
  /** Drawn as a white square (size handle), even when not 'size'. */
  square?: boolean;
  /** Part size handle ('pdim'): the parameter it drives and how fast the side follows it. */
  param?: { key: string; slope: number; min: number; max: number; label: string; up?: number; down?: number; side?: 1 | -1; axis?: 0 | 1 | 2 };
  /** A handle of the selected street or lot: one of its points, or the whole of it (`index` −1). */
  site?: { index: number };
  /** Interior walls tool: a node of the level's walls (drag moves it with its walls) or a wall (Alt+click deletes it). */
  iwall?: { level: ID; node?: ID; wall?: ID };
  /** A point of a part drawn as a path (wall, fence, hedge): its index. */
  pathPt?: number;
  /** …a midpoint: dragging it inserts a new point after `pathPt`. */
  pathMid?: boolean;
  /** Part move arrow ('pmove'): the part's own axis it slides along (0: across, 1: up). */
  pmove?: 0 | 1;
  /** …of one element of a facade rule: written in `sizes[pos]` of that rule. */
  rule?: { id: ID; pos: string; v0: number };
  /** Push arrow of a volume made on a face: its depth from that wall (out adds, in cuts). */
  hosted?: boolean;
  color: string;
  label: string;
}

const COLORS = { x: '#e0453a', z: '#2f7de1', y: '#1f9d55', push: '#ffb020', vertex: '#ffffff', bend: '#18a6c9', ring: '#e6a521', plane: '#f2c94c' };

export { COLORS as HANDLE_COLORS };

const ARROW_PX = 90;
/** Plane square: center 26 px from the gizmo center on each axis, 18 px wide (TransformControls r170: 0.15 of 0.5). */
const PLANE_OFF_PX = 26;
const PLANE_PX = 18;

export class Handles {
  readonly group = new THREE.Group();
  list: Handle[] = [];
  hover: Handle | null = null;
  private cone = new THREE.ConeGeometry(0.5, 1.4, 14);
  private sphere = new THREE.SphereGeometry(0.5, 14, 10);
  private box = new THREE.BoxGeometry(1, 1, 1);
  private shaft = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  private quad = new THREE.PlaneGeometry(1, 1);
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  private lineMats = new Map<string, THREE.LineBasicMaterial>();

  constructor(private view: View) {
    this.group.name = 'handles';
    this.group.renderOrder = 30;
    view.overlay.add(this.group);
  }

  private mat(color: string): THREE.MeshBasicMaterial {
    let m = this.mats.get(color);
    if (!m) this.mats.set(color, (m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })));
    return m;
  }

  private lineMat(color: string): THREE.LineBasicMaterial {
    let m = this.lineMats.get(color);
    if (!m) this.lineMats.set(color, (m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 })));
    return m;
  }

  /** Is the handle in view? (face handle only when the face looks at the camera) */
  shown(h: Handle): boolean {
    if (h.normal && h.normal.dot(this.view.camera.position.clone().sub(h.at)) <= 0) return false;
    // An arrow seen almost end-on is a dot over the object that steals its drags (three.js
    // TransformControls hides such axes): in a top view the vertical arrow pointed at the camera, covered
    // the building's center and a drag meant to move it lifted it 270 m instead.
    if (h.dir && !h.square && h.kind !== 'push' && h.kind !== 'rotate') {
      const toCam = this.view.camera.position.clone().sub(h.at).normalize();
      if (Math.abs(toCam.dot(h.dir.clone().normalize())) > 0.97) return false;
    }
    // The gizmo wins: a size square that falls under one of its arrows on screen (the back corner right
    // behind the green arrow in the default view) steps aside until the view turns, instead of hiding
    // under the arrow and stealing or losing its clicks.
    if (h.kind === 'size' || h.square) {
      const p = this.view.toScreen(this.posOf(h));
      for (const g of this.list) {
        if (!g.dir || g.square || g.kind === 'push' || g.kind === 'rotate' || (g.normal && g.normal.dot(this.view.camera.position.clone().sub(g.at)) <= 0)) continue;
        const at = this.posOf(g);
        const len = this.view.worldPerPixel(at) * ARROW_PX;
        const a = this.view.toScreen(at.clone().addScaledVector(g.dir, len * 0.15)),
          b = this.view.toScreen(at.clone().addScaledVector(g.dir, len * 1.15));
        if (segDist(new THREE.Vector2(p.x, p.y), new THREE.Vector2(a.x, a.y), new THREE.Vector2(b.x, b.y)) < 9) return false;
      }
    }
    return true;
  }

  /** Where the handle is drawn (the plane square leaves the center, in constant pixels). */
  posOf(h: Handle): THREE.Vector3 {
    let at = h.at;
    if (h.liftPx) at = at.clone().setY(at.y + this.view.worldPerPixel(at) * h.liftPx);
    if (!h.plane) return at;
    const k = this.view.worldPerPixel(at) * PLANE_OFF_PX;
    return at.clone().addScaledVector(h.plane[0], k).addScaledVector(h.plane[1], k);
  }

  set(list: Handle[]): void {
    this.list = list;
    // The highlight of a handle that left the list does not stay behind.
    if (this.hover && !list.includes(this.hover)) this.hover = null;
    this.draw();
  }

  /** Redraws (sizes depend on the camera). */
  draw(): void {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if ((c as THREE.Line).isLine) (c as THREE.Line).geometry.dispose();
    }
    for (const h of this.list) {
      if (!this.shown(h)) continue;
      const wpp = this.view.worldPerPixel(h.at);
      const hot = this.hover === h;
      // Yellow highlight under the pointer, like three.js TransformControls.
      const color = hot ? '#ffd23f' : h.color;
      if (h.kind === 'rotate' && h.ring) {
        const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(h.ring), this.lineMat(color));
        l.renderOrder = 31;
        this.group.add(l);
        const grip = new THREE.Mesh(this.sphere, this.mat(color));
        grip.position.copy(h.at);
        grip.scale.setScalar(wpp * (hot ? 14 : 11));
        grip.renderOrder = 32;
        this.group.add(grip);
        continue;
      }
      if (h.dir && !h.square) {
        const at = this.posOf(h);
        const len = wpp * ARROW_PX;
        const tip = at.clone().addScaledVector(h.dir, len);
        // Thick shaft (cylinder with fixed screen width) and dark outline: visible over any background.
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir.clone().normalize());
        for (const [w, c, ord] of [[7, '#1f2326', 30], [4, color, 31]] as const) {
          const sh = new THREE.Mesh(this.shaft, this.mat(c));
          sh.position.copy(at).addScaledVector(h.dir, len / 2);
          sh.quaternion.copy(q);
          sh.scale.set(wpp * w * (hot ? 1.3 : 1), len, wpp * w * (hot ? 1.3 : 1));
          sh.renderOrder = ord;
          this.group.add(sh);
        }
        const c = new THREE.Mesh(this.cone, this.mat(color));
        c.position.copy(tip);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir.clone().normalize());
        c.scale.setScalar(wpp * (hot ? 17 : 14));
        c.renderOrder = 32;
        this.group.add(c);
        continue;
      }
      if (h.kind === 'size' || h.square) {
        // Flat square facing the screen, fixed size in pixels (corners 9 px, sides 7 px),
        // white with a dark border: reads over any background without looking like a model block.
        const px = (h.sx && h.sz ? 9 : h.square ? 9 : 7) * (hot ? 1.3 : 1);
        const q = this.view.camera.quaternion;
        const o = new THREE.Mesh(this.quad, this.mat('#1f2326'));
        o.position.copy(h.at);
        o.quaternion.copy(q);
        o.scale.set(wpp * (px + 3), wpp * (px + 3), 1);
        o.renderOrder = 31;
        const f = new THREE.Mesh(this.quad, this.mat(hot ? '#ffd23f' : '#ffffff'));
        f.position.copy(h.at);
        f.quaternion.copy(q);
        f.scale.set(wpp * px, wpp * px, 1);
        f.renderOrder = 32;
        this.group.add(o, f);
        continue;
      }
      if (h.kind === 'move-xz' && h.plane) {
        // Plane square between the arrows, lying on the building ground plane.
        const at = this.posOf(h);
        const [u, v] = h.plane;
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v.clone().cross(u).normalize(), v));
        const px = PLANE_PX * (hot ? 1.2 : 1);
        for (const [c, k, ord] of [['#1f2326', px + 4, 31], [color, px, 32]] as const) {
          const m = new THREE.Mesh(this.box, this.mat(c));
          m.position.copy(at);
          m.quaternion.copy(q);
          m.scale.set(wpp * k, wpp * 2, wpp * k);
          m.renderOrder = ord;
          this.group.add(m);
        }
        continue;
      }
      if (h.kind !== 'vertex') {
        const o = new THREE.Mesh(h.kind === 'move-xz' ? this.box : this.sphere, this.mat('#1f2326'));
        o.position.copy(h.at);
        const op = (h.kind === 'bend' ? 9 : h.kind === 'move-xz' ? 16 : 11) + 3;
        o.scale.set(wpp * op, h.kind === 'move-xz' ? wpp * 4 : wpp * op, wpp * op);
        o.renderOrder = 31;
        this.group.add(o);
      }
      const m = new THREE.Mesh(h.kind === 'move-xz' ? this.box : this.sphere, this.mat(color));
      m.position.copy(h.at);
      const px = h.kind === 'vertex' ? 11 : h.kind === 'bend' ? 9 : h.kind === 'move-xz' ? 16 : 11;
      m.scale.set(wpp * px * (hot ? 1.3 : 1), h.kind === 'move-xz' ? wpp * 3 : wpp * px * (hot ? 1.3 : 1), wpp * px * (hot ? 1.3 : 1));
      m.renderOrder = 32;
      this.group.add(m);
      if (h.kind === 'vertex') {
        const ring = new THREE.Mesh(this.sphere, this.mat('#2b2f31'));
        ring.position.copy(h.at);
        ring.scale.setScalar(wpp * (px + 4) * (hot ? 1.3 : 1));
        ring.renderOrder = 31;
        this.group.add(ring);
      }
    }
    this.view.mark();
  }

  /** Handle under the pointer (the closest within tolerance). */
  hit(e: { clientX: number; clientY: number }, tol = 18): Handle | null {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(e.clientX - r.left, e.clientY - r.top);
    let best: { d: number; h: Handle } | null = null;
    const S = (p: THREE.Vector3) => {
      const s = this.view.toScreen(p);
      return new THREE.Vector2(s.x, s.y);
    };
    for (const h of this.list) {
      if (!this.shown(h)) continue;
      let d: number;
      if (h.kind === 'rotate' && h.ring) {
        d = Infinity;
        const pts = h.ring.map(S);
        for (let i = 0; i < pts.length; i++) d = Math.min(d, segDist(m, pts[i]!, pts[(i + 1) % pts.length]!));
        d = Math.min(d, S(h.at).distanceTo(m) - 4);
      } else if (h.dir && !h.square) {
        const at = this.posOf(h);
        const len = this.view.worldPerPixel(at) * ARROW_PX;
        // The whole arrow takes the click (from base to tip, with slack past the cone).
        const a = S(at.clone().addScaledVector(h.dir, len * 0.08)),
          b = S(at.clone().addScaledVector(h.dir, len * 1.15));
        d = segDist(m, a, b);
      } else d = S(this.posOf(h)).distanceTo(m) - (h.kind === 'vertex' ? 2 : 0);
      // Dots and the plane square win over strokes on a tie.
      const bias = h.kind === 'vertex' || h.kind === 'bend' || h.kind === 'size' || h.square || h.kind === 'move-xz' ? -4 : 0;
      if (d < tol && (!best || d + bias < best.d)) best = { d: d + bias, h };
    }
    return best?.h ?? null;
  }

  /**
   * Where the handles occupy the screen (client coordinates): dots as ±9 px
   * squares, arrows sampled every 12 px (a diagonal does not become a huge
   * square). Dimension labels avoid these.
   */
  footprints(): { left: number; right: number; top: number; bottom: number }[] {
    const r = this.view.renderer.domElement.getBoundingClientRect();
    const out: { left: number; right: number; top: number; bottom: number }[] = [];
    const box = (x: number, y: number, k: number) => out.push({ left: r.left + x - k, right: r.left + x + k, top: r.top + y - k, bottom: r.top + y + k });
    for (const h of this.list) {
      if (!this.shown(h)) continue;
      const a = this.view.toScreen(this.posOf(h));
      if (a.behind) continue;
      if (h.dir && !h.square && h.kind !== 'rotate') {
        const at = this.posOf(h);
        const len = this.view.worldPerPixel(at) * ARROW_PX;
        const b = this.view.toScreen(at.clone().addScaledVector(h.dir, len * 1.15));
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 12));
        for (let i = 0; i <= n; i++) box(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, 8);
      } else box(a.x, a.y, 9);
    }
    return out;
  }

  setHover(h: Handle | null): void {
    if (h === this.hover) return;
    this.hover = h;
    this.draw();
  }
}

function segDist(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
