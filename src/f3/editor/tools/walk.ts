// Walk mode (first person inside the building): the view's camera becomes the eye,
// pointer lock turns the mouse into look, WASD walks (Shift runs), gravity keeps the
// feet on the floor found by a ray cast downward, a wall in the way stops the step.
// Leaving restores the orbit camera exactly (target, distance, angles, projection).
import * as THREE from 'three';
import type { Project3 } from '../../model/schema';
import { buildingHidden } from '../../model/layers';
import type { View } from '../view';

/** What the walk needs from the editor. */
export interface WalkHost {
  view: View;
  /** Element the HUD is added to (the canvas wrapper). */
  root: HTMLElement;
  project: () => Project3;
  /** Called once the camera is back where it was. */
  onExit: () => void;
  /** E: opens or closes the door the eye looks at (within reach); false when there is none. */
  interact?: () => boolean;
}

/** Eye height above the feet (m). */
const EYE = 1.65;
/** Walking and running speed (m/s). */
const WALK = 1.4,
  RUN = 4;
/** Highest step climbed without jumping (m). */
const STEP_UP = 0.45;
/** How close a wall stops the walker (m). */
const CLEARANCE = 0.3;
/** Heights the wall check looks at (m above the feet): knee and chest. */
const KNEE = 0.5,
  CHEST = 1.4;
/** Gravity and the jump impulse (m/s², m/s). */
const GRAVITY = 9.8,
  JUMP = 4.2;
/** Look sensitivity (rad per device pixel) and the pitch limit (never straight up or down). */
const LOOK = 0.0025,
  MAX_PITCH = (85 * Math.PI) / 180;

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
const DOWN = new THREE.Vector3(0, -1, 0);

export class WalkMode {
  private running = false;
  /** True once the pointer was locked: only then can losing it mean leaving. */
  private locked = false;
  private saved: { target: THREE.Vector3; distance: number; phi: number; theta: number; parallel: boolean } | null = null;
  private x = 0;
  private z = 0;
  /** Height of the feet (m); the eye is EYE above them. */
  private feet = 0;
  private vy = 0;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly hud: HTMLDivElement;

  constructor(private readonly h: WalkHost) {
    this.hud = document.createElement('div');
    this.hud.className = 'f3-walk-hud';
    this.hud.style.cssText =
      'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);padding:6px 12px;border-radius:6px;background:rgba(18,20,24,0.72);color:#f4f3ef;font:12px/1.4 system-ui,sans-serif;pointer-events:none;white-space:nowrap;z-index:30';
    this.hud.textContent = 'Walking · WASD move · Shift run · E opens a door or window · Esc leaves';
  }

  /** Whether the walk is on (the editor routes its gestures elsewhere meanwhile). */
  get active(): boolean {
    return this.running;
  }

  /** Takes the camera and the pointer; the orbit view is saved and comes back on exit(). */
  start(): void {
    if (this.running) return;
    const v = this.h.view;
    this.saved = { target: v.target.clone(), distance: v.distance, phi: v.phi, theta: v.theta, parallel: v.parallel };
    // Walking is a perspective view: parallel shows no depth to walk into.
    v.setParallel(false);
    const dir = new THREE.Vector3();
    v.persp.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.asin(Math.max(-1, Math.min(1, dir.y)))));
    // Starts under the orbit camera, on whatever floor is there.
    this.x = v.persp.position.x;
    this.z = v.persp.position.z;
    this.feet = this.floorAt(this.x, this.z, v.persp.position.y) ?? 0;
    this.vy = 0;
    this.keys.clear();
    this.locked = false;
    this.running = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.h.root.appendChild(this.hud);
    try {
      const lock: unknown = v.renderer.domElement.requestPointerLock();
      if (lock instanceof Promise) void lock.catch(() => undefined);
    } catch {
      // Without the lock the walk still works from the keyboard.
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
    this.place();
  }

  /** Leaves the walk and puts the orbit camera back exactly where it was. */
  exit(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.keys.clear();
    this.hud.remove();
    if (this.locked && document.pointerLockElement === this.h.view.renderer.domElement) document.exitPointerLock();
    this.locked = false;
    const v = this.h.view;
    const s = this.saved;
    this.saved = null;
    if (s) {
      v.target.copy(s.target);
      v.distance = s.distance;
      v.phi = s.phi;
      v.theta = s.theta;
      v.setParallel(s.parallel);
      v.updateCamera();
      v.mark();
    }
    this.h.onExit();
  }

  /** Points the walk camera at the current position and angle (never through view.updateCamera). */
  private place(): void {
    const v = this.h.view;
    this.euler.set(this.pitch, this.yaw, 0);
    v.persp.position.set(this.x, this.feet + EYE, this.z);
    v.persp.quaternion.setFromEuler(this.euler);
    v.persp.updateMatrixWorld();
    v.mark();
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (dt > 0) this.update(dt);
    this.place();
  };

  private update(dt: number): void {
    const targets = this.targets();
    const speed = this.keys.has('shift') ? RUN : WALK;
    let f = 0,
      r = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) f += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) r += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) r -= 1;
    if (f || r) {
      const l = Math.hypot(f, r);
      f /= l;
      r /= l;
      // Camera forward and right on the ground, from the look angles.
      const sin = Math.sin(this.yaw),
        cos = Math.cos(this.yaw);
      const dx = (-sin * f + cos * r) * speed * dt;
      const dz = (-cos * f - sin * r) * speed * dt;
      // A wall in the way stops the step; what is left slides along it, one axis at a time.
      if (!this.walk(dx, dz, targets)) {
        this.walk(dx, 0, targets);
        this.walk(0, dz, targets);
      }
    }
    // Gravity; the floor catches the walker (a step within reach is climbed, not fallen on).
    this.vy -= GRAVITY * dt;
    this.feet += this.vy * dt;
    const floor = this.floorAt(this.x, this.z, this.feet);
    if (floor !== null && this.feet <= floor + 1e-4) {
      this.feet = floor;
      this.vy = 0;
    } else if (this.feet < 0) {
      // Off the model altogether: the ground plane at y = 0 is what is left.
      this.feet = 0;
      this.vy = 0;
    }
  }

  /** Moves the feet by (dx, dz) when nothing is in the way; true when it moved. */
  private walk(dx: number, dz: number, targets: THREE.Object3D[]): boolean {
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return false;
    const dir = new THREE.Vector3(dx / d, 0, dz / d);
    for (const h of [KNEE, CHEST]) if (this.hit(new THREE.Vector3(this.x, this.feet + h, this.z), dir, d + CLEARANCE, targets)) return false;
    this.x += dx;
    this.z += dz;
    return true;
  }

  /** True when the model is within `far` along the ray. */
  private hit(o: THREE.Vector3, dir: THREE.Vector3, far: number, targets: THREE.Object3D[]): boolean {
    this.ray.set(o, dir);
    this.ray.near = 0;
    this.ray.far = far;
    return this.ray.intersectObjects(targets, true).some((h) => !h.object.userData.hidden);
  }

  /**
   * Height of the floor under the feet: the first thing of the model the ray cast down from
   * `feet + EYE + 0.5` meets that is not more than a step above them — what is higher is a
   * ledge, not a floor. Falling, the lowest thing below is returned so the walker lands.
   */
  private floorAt(x: number, z: number, feet: number): number | null {
    const targets = this.targets();
    if (!targets.length) return null;
    this.ray.set(new THREE.Vector3(x, feet + EYE + 0.5, z), DOWN);
    this.ray.near = 0;
    this.ray.far = Infinity;
    let lowest: number | null = null;
    for (const h of this.ray.intersectObjects(targets, true)) {
      if (h.object.userData.hidden) continue;
      lowest = h.point.y;
      if (h.point.y <= feet + STEP_UP + 1e-4) return h.point.y;
    }
    return lowest;
  }

  /** Buildings drawn in the view that the walker stands on and that stop him. */
  private targets(): THREE.Object3D[] {
    const p = this.h.project();
    const byId = new Map(p.buildings.map((x) => [x.id, x]));
    const out: THREE.Object3D[] = [];
    for (const [id, b] of this.h.view.built) {
      const src = byId.get(id);
      if (!b.group.visible || (src && buildingHidden(p, src))) continue;
      out.push(b.group);
    }
    return out;
  }

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.running || !this.locked) return;
    // Turning the head: right turns right (yaw decreases), down looks down.
    this.yaw -= e.movementX * LOOK;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - e.movementY * LOOK));
  };

  private onLockChange = (): void => {
    if (!this.running) return;
    if (document.pointerLockElement === this.h.view.renderer.domElement) this.locked = true;
    // Esc (the browser releases the lock itself) and any other loss of the pointer leave the walk.
    else if (this.locked) this.exit();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.running) return;
    if (e.key === 'Escape') return void this.exit();
    if (e.code === 'Space') {
      // Jump: only from the floor (the vertical speed is zeroed whenever the feet stand).
      if (this.vy === 0) this.vy = JUMP;
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'e' && !e.repeat) {
      this.h.interact?.();
      e.preventDefault();
      return;
    }
    if (k === 'shift') this.keys.add('shift');
    else if (MOVE_KEYS.has(k)) {
      this.keys.add(k);
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };
}
