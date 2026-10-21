// Stair tool (after Estúdio de Construção v4): click the foot of the flight, click where it ends (the
// direction and the run): it climbs to the floor above the foot (its height is the storey's). The treads are
// spread to fill the run (the stair family's rule: risers ⌈rise / 0.18⌉, the tread between 0.22 and
// 0.40 m). The flight is a free stair part of the building it is in or next to (families/stairs.ts).
import * as THREE from 'three';
import type { Building3, Item } from '../../model/schema';
import type { View } from '../view';
import { toLocal } from '../../model/ops';
import { uid } from '../../model/defaults';
import { STAIR_TYPE } from '../../model/stairs';
import { decimal } from '../../ui/i18n';

export interface StairHost {
  view: View;
  overlay: THREE.Group;
  /** The building being edited (entered), if any. */
  context(): Building3 | undefined;
  /** The building a part at (x, z) belongs to (made when there is none; `commit` adds it). */
  ownerAt(x: number, z: number): Building3;
  /** Adds the stair to its building (and the building to the project when new) and selects it. */
  commit(b: Building3, item: Item, message: string): void;
  showDim(text: string, e: { clientX: number; clientY: number }): void;
  hideDim(): void;
  toast(msg: string): void;
}

const MAX_RISER = 0.18,
  MIN_GOING = 0.22,
  MAX_GOING = 0.4,
  WIDTH = 1.1;
const fmt = (n: number) => decimal(Math.round(n * 100) / 100);
const NAME = 'stair-draft';

/** Risers and tread of a flight of `rise` over `run` (the family's rule, the tread kept in its range). */
export function flightFor(rise: number, run: number): { risers: number; going: number; fits: boolean } {
  const risers = Math.max(1, Math.ceil(rise / MAX_RISER - 1e-9));
  const g = run / risers;
  return { risers, going: Math.max(MIN_GOING, Math.min(MAX_GOING, g)), fits: g >= MIN_GOING - 1e-6 && g <= MAX_GOING + 1e-6 };
}

export class StairTool {
  private foot: THREE.Vector3 | null = null;
  private end: THREE.Vector3 | null = null;
  private y0 = 0;
  private height = 0;

  constructor(private readonly h: StairHost) {}

  get busy(): boolean {
    return !!this.foot;
  }

  private plane(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
    return this.h.view.onPlane(e, this.foot!.y);
  }

  /** Floor elevations (world) of the building the stair goes in, for the height to snap to. */
  private floors(): number[] {
    const b = this.foot ? this.h.ownerAt(this.foot.x, this.foot.z) : this.h.context();
    return b ? b.levels.map((l) => l.elevation + (b.elevation ?? 0)) : [];
  }

  down(e: PointerEvent): void {
    if (!this.foot) {
      const p = this.h.view.pointAt(e);
      if (!p) return;
      this.foot = p;
      return;
    }
    if (!this.end) {
      const p = this.plane(e);
      if (!p || p.distanceTo(this.foot) < 0.6) return this.h.toast('Click farther from the foot: where the flight ends.');
      this.end = p;
      this.y0 = e.clientY;
      // The stair reaches the floor above the foot (ArchiCAD, Revit, Chief Architect: base level to
      // top level): two clicks and it is done. With no floor above, a storey of 2.8 m.
      const above = this.floors().filter((f) => f - this.foot!.y > 0.3).sort((x, y) => x - y)[0];
      this.height = above !== undefined ? above - this.foot.y : 2.8;
      this.finish();
      return;
    }
    this.finish();
  }

  move(e: PointerEvent): void {
    if (!this.foot) return this.h.showDim('Click the foot of the stair', e);
    if (!this.end) {
      const p = this.plane(e);
      if (!p) return;
      this.draw(p);
      return this.h.showDim(`${fmt(p.distanceTo(this.foot))} m run · click where it ends`, e);
    }
    const run = this.end.distanceTo(this.foot);
    const auto = (run / 0.28) * 0.175;
    let hgt = Math.max(0.3, Math.min(12, auto + (this.y0 - e.clientY) * this.h.view.worldPerPixel(this.end)));
    // Snaps to a floor above the foot when within 25 cm (the stair meets the slab).
    for (const f of this.floors()) if (f - this.foot.y > 0.3 && Math.abs(this.foot.y + hgt - f) < 0.25) hgt = f - this.foot.y;
    this.height = hgt;
    this.draw();
    const fl = flightFor(hgt, run);
    this.h.showDim(`${fmt(hgt)} m · ${fl.risers} × ${fmt(hgt / fl.risers)} m${fl.fits ? '' : fl.going <= MIN_GOING ? ' · too steep for the run' : ' · too low for the run'}`, e);
  }

  /** Enter: takes the height shown. */
  enter(): boolean {
    if (!this.end) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    const foot = this.foot!,
      end = this.end!;
    const b = this.h.ownerAt(foot.x, foot.z);
    const a = toLocal(b, [foot.x, foot.z]),
      c = toLocal(b, [end.x, end.z]);
    const dx = c[0] - a[0],
      dz = c[1] - a[1];
    const run = Math.hypot(dx, dz);
    const fl = flightFor(this.height, run);
    // The family climbs toward its own +z; the part's turn takes +z to the clicked direction.
    const rot = Math.round(((Math.atan2(dx, dz) * 180) / Math.PI) * 100) / 100;
    const item: Item = {
      id: uid(),
      type: STAIR_TYPE,
      params: { rise: Math.round(this.height * 1000) / 1000, width: WIDTH, going: Math.round(fl.going * 1000) / 1000 },
      host: { kind: 'free', p: [a[0], foot.y - (b.elevation ?? 0), a[1]], rot },
    };
    const height = this.height;
    this.cancel();
    this.h.commit(b, item, `Stair: ${fmt(height)} m, ${fl.risers} risers.`);
  }

  cancel(): void {
    this.foot = null;
    this.end = null;
    const o = this.h.overlay.getObjectByName(NAME);
    if (o) {
      this.h.overlay.remove(o);
      (o as THREE.LineSegments).geometry.dispose();
    }
    this.h.hideDim();
    this.h.view.mark();
  }

  private draw(to?: THREE.Vector3): void {
    const old = this.h.overlay.getObjectByName(NAME);
    if (old) {
      this.h.overlay.remove(old);
      (old as THREE.LineSegments).geometry.dispose();
    }
    const f = this.foot!;
    const e = this.end ?? to!;
    const pts = [f, e];
    if (this.end) {
      const top = e.clone().setY(f.y + this.height);
      // The run, the rise at its end and the slope of the flight.
      pts.push(e, top, f, top);
    }
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), MAT);
    l.name = NAME;
    l.renderOrder = 10;
    this.h.overlay.add(l);
    this.h.view.mark();
  }
}

const MAT = new THREE.LineBasicMaterial({ color: '#3b82f6', depthTest: false });

