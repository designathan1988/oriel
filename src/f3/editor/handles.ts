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
  /** Size handle of a box in a turned frame (frameAngle, radians): x and z are that frame's. */
  frame?: number;
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

// Scratch values reused by every redraw (the handles redraw with the camera: no allocation per frame).
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _m4 = new THREE.Matrix4(),
  _a = new THREE.Vector2(),
  _b = new THREE.Vector2(),
  _p = new THREE.Vector2(),
  _pos = new THREE.Vector3();

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
  /** Meshes kept between redraws, taken in order by each redraw (the rest are hidden). */
  private pool: THREE.Mesh[] = [];
  private used = 0;
  /** The ring line of each rotate handle, made once per ring. */
  private rings = new WeakMap<THREE.Vector3[], THREE.LineLoop>();

  constructor(private view: View) {
    this.group.name = 'handles';
    this.group.renderOrder = 30;
    view.overlay.add(this.group);
  }

  /** A pooled mesh with this geometry, material and draw order, at `at`, unturned. */
  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, order: number, at: THREE.Vector3): THREE.Mesh {
    let m = this.pool[this.used];
    if (!m) {
      m = new THREE.Mesh();
      this.pool.push(m);
      this.group.add(m);
    }
    this.used++;
    m.visible = true;
    m.geometry = geo;
    m.material = mat;
    m.renderOrder = order;
    m.position.copy(at);
    m.quaternion.identity();
    return m;
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
    if (h.normal && h.normal.dot(_v.copy(this.view.camera.position).sub(h.at)) <= 0) return false;
    // An arrow seen almost end-on is a dot over the object that steals its drags (three.js
    // TransformControls hides such axes): in a top view the vertical arrow pointed at the camera, covered
    // the building's center and a drag meant to move it lifted it 270 m instead.
    if (h.dir && !h.square && h.kind !== 'push' && h.kind !== 'rotate') {
      const toCam = _v.copy(this.view.camera.position).sub(h.at).normalize();
      if (Math.abs(toCam.dot(_d.copy(h.dir).normalize())) > 0.97) return false;
    }
    // The gizmo wins: a size square that falls under one of its arrows on screen (the back corner right
    // behind the green arrow in the default view) steps aside until the view turns, instead of hiding
    // under the arrow and stealing or losing its clicks.
    if (h.kind === 'size' || h.square) {
      const p = this.view.toScreen(this.posOf(h, _pos));
      _p.set(p.x, p.y);
      for (const g of this.list) {
        if (!g.dir || g.square || g.kind === 'push' || g.kind === 'rotate' || (g.normal && g.normal.dot(_v.copy(this.view.camera.position).sub(g.at)) <= 0)) continue;
        const at = this.posOf(g, _pos);
        const len = this.view.worldPerPixel(at) * ARROW_PX;
        const a = this.view.toScreen(_w.copy(at).addScaledVector(g.dir, len * 0.15));
        _a.set(a.x, a.y);
        const b = this.view.toScreen(_w.copy(at).addScaledVector(g.dir, len * 1.15));
        _b.set(b.x, b.y);
        if (segDist(_p, _a, _b) < 9) return false;
      }
    }
    return true;
  }

  /** Where the handle is drawn (the plane square leaves the center, in constant pixels). */
  posOf(h: Handle, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(h.at);
    if (h.liftPx) out.y += this.view.worldPerPixel(h.at) * h.liftPx;
    if (!h.plane) return out;
    const k = this.view.worldPerPixel(out) * PLANE_OFF_PX;
    return out.addScaledVector(h.plane[0], k).addScaledVector(h.plane[1], k);
  }

  set(list: Handle[]): void {
    this.list = list;
    // The highlight of a handle that left the list does not stay behind.
    if (this.hover && !list.includes(this.hover)) this.hover = null;
    this.draw();
  }

  /** Redraws (sizes depend on the camera): pooled meshes and scratch values, nothing made per frame. */
  draw(): void {
    this.used = 0;
    for (const c of this.group.children) if ((c as THREE.Line).isLine) c.visible = false;
    for (const h of this.list) {
      if (!this.shown(h)) continue;
      const wpp = this.view.worldPerPixel(h.at);
      const hot = this.hover === h;
      // Yellow highlight under the pointer, like three.js TransformControls.
      const color = hot ? '#ffd23f' : h.color;
      if (h.kind === 'rotate' && h.ring) {
        let l = this.rings.get(h.ring);
        if (!l) {
          l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(h.ring), this.lineMat(color));
          l.renderOrder = 31;
          this.rings.set(h.ring, l);
        }
        l.material = this.lineMat(color);
        l.visible = true;
        if (l.parent !== this.group) this.group.add(l);
        this.mesh(this.sphere, this.mat(color), 32, h.at).scale.setScalar(wpp * (hot ? 14 : 11));
        continue;
      }
      if (h.dir && !h.square) {
        const at = this.posOf(h, _pos);
        const len = wpp * ARROW_PX;
        // Thick shaft (cylinder with fixed screen width) and dark outline: visible over any background.
        _q.setFromUnitVectors(UP, _d.copy(h.dir).normalize());
        _w.copy(at).addScaledVector(h.dir, len / 2);
        for (const [w, c, ord] of [[7, '#1f2326', 30], [4, color, 31]] as const) {
          const sh = this.mesh(this.shaft, this.mat(c), ord, _w);
          sh.quaternion.copy(_q);
          sh.scale.set(wpp * w * (hot ? 1.3 : 1), len, wpp * w * (hot ? 1.3 : 1));
        }
        const c = this.mesh(this.cone, this.mat(color), 32, _w.copy(at).addScaledVector(h.dir, len));
        c.quaternion.copy(_q);
        c.scale.setScalar(wpp * (hot ? 17 : 14));
        continue;
      }
      if (h.kind === 'size' || h.square) {
        // Flat square facing the screen, fixed size in pixels (corners 9 px, sides 7 px),
        // white with a dark border: reads over any background without looking like a model block.
        const px = (h.sx && h.sz ? 9 : h.square ? 9 : 7) * (hot ? 1.3 : 1);
        const q = this.view.camera.quaternion;
        const o = this.mesh(this.quad, this.mat('#1f2326'), 31, h.at);
        o.quaternion.copy(q);
        o.scale.set(wpp * (px + 3), wpp * (px + 3), 1);
        const f = this.mesh(this.quad, this.mat(hot ? '#ffd23f' : '#ffffff'), 32, h.at);
        f.quaternion.copy(q);
        f.scale.set(wpp * px, wpp * px, 1);
        continue;
      }
      if (h.kind === 'move-xz' && h.plane) {
        // Plane square between the arrows, lying on the building ground plane.
        const at = this.posOf(h, _pos);
        const [u, v] = h.plane;
        _q.setFromRotationMatrix(_m4.makeBasis(u, _d.copy(v).cross(u).normalize(), v));
        const px = PLANE_PX * (hot ? 1.2 : 1);
        for (const [c, k, ord] of [['#1f2326', px + 4, 31], [color, px, 32]] as const) {
          const m = this.mesh(this.box, this.mat(c), ord, at);
          m.quaternion.copy(_q);
          m.scale.set(wpp * k, wpp * 2, wpp * k);
        }
        continue;
      }
      const geo = h.kind === 'move-xz' ? this.box : this.sphere;
      if (h.kind !== 'vertex') {
        const op = (h.kind === 'bend' ? 9 : h.kind === 'move-xz' ? 16 : 11) + 3;
        this.mesh(geo, this.mat('#1f2326'), 31, h.at).scale.set(wpp * op, h.kind === 'move-xz' ? wpp * 4 : wpp * op, wpp * op);
      }
      const px = h.kind === 'vertex' ? 11 : h.kind === 'bend' ? 9 : h.kind === 'move-xz' ? 16 : 11;
      const k = wpp * px * (hot ? 1.3 : 1);
      this.mesh(geo, this.mat(color), 32, h.at).scale.set(k, h.kind === 'move-xz' ? wpp * 3 : k, k);
      if (h.kind === 'vertex') this.mesh(this.sphere, this.mat('#2b2f31'), 31, h.at).scale.setScalar(wpp * (px + 4) * (hot ? 1.3 : 1));
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    // Rings of handles that left the list leave the group.
    for (let i = this.group.children.length - 1; i >= 0; i--) {
      const c = this.group.children[i]!;
      if ((c as THREE.Line).isLine && !c.visible) {
        this.group.remove(c);
        (c as THREE.Line).geometry.dispose();
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
  const abx = b.x - a.x,
    aby = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y);
}
