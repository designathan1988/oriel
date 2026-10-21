// Building tools of the editor: walls, interior walls and rooms, slabs, columns and beams, terrain sculpting and the mirror line.
import * as THREE from 'three';
import type { Building3, ID, Item, Solid, Vec2, Vec3 } from '../model/schema';
import { building as newBuilding, levelsFor, planVertices, roofSpec, solid as newSolid, uid } from '../model/defaults';
import { inside, findSolid, toLocal, toWorld } from '../model/ops';
import { tr } from '../ui/i18n';
import { addInteriorWall, interiorDoors, type InteriorWithDoors } from '../eval/interiorwalls';
import { offsetRing, ringValid, sampleRing, signedArea2 } from '../model/plan';
import { type Handle } from './handles';
import { addRoomRect, interiorOf, loopAround, roomArea } from '../eval/interiorwalls';
import { fillLevels } from '../model/quick';
import { column, grow } from './elements';
import { type Drag, fmt, parseLength, parseFloors } from './support';
import type { Editor3 } from './editor';
import type { WallHit, WallTarget } from './tools/walls';
import { buildingHidden, buildingLocked } from '../model/layers';

/**
 * The wall chain being drawn (Walls tool): outside a building every piece is a wall volume of a building
 * made for the chain; inside one, an interior wall of the floor shown.
 */
export interface WallChain {
  bid: ID | null;
  levelId: ID | null;
  interior: boolean;
  /** The building was made by this chain (a closed chain may become one hollow volume). */
  own: boolean;
}

/**
 * The walls a new one may start or end on (world plan): the walls drawn by this tool, the centre line of
 * hollow buildings (walls of their own, closed) and the interior walls of the floor shown.
 */
export function wallTargets(ed: Editor3): WallTarget[] {
  const out: WallTarget[] = [];
  const p = ed.project;
  for (const b of p.buildings) {
    if (buildingHidden(p, b) || buildingLocked(p, b)) continue;
    const w = (q: Vec2) => toWorld(b, q);
    for (const s of b.solids) {
      if (s.hidden || s.op !== 'add') continue;
      const ax = wallAxisOf(s);
      if (ax) out.push({ a: w(ax[0]), b: w(ax[1]), bid: b.id, interior: false });
      else if (s.shell && !s.loft && !s.revolve) {
        const r = sampleRing(s.plan.outer).pts;
        const ccw = signedArea2(r) > 0 ? r : [...r].reverse();
        const mid = offsetRing(ccw, ccw.map(() => s.shell! / 2));
        mid.forEach((q, i) => out.push({ a: w(q), b: w(mid[(i + 1) % mid.length]!), bid: b.id, interior: false, enclosing: true }));
      }
    }
    const lv = ed.workLevel(b);
    const it = lv && b.interiors[lv.id];
    if (it && p.view?.cutLevel !== undefined) {
      const node = new Map(it.nodes.map((n) => [n.id, n.p]));
      for (const wl of it.walls) {
        const a = node.get(wl.a),
          c = node.get(wl.b);
        if (a && c) out.push({ a: w(a), b: w(c), bid: b.id, interior: true });
      }
    }
  }
  return out;
}

/** The centre line of a wall volume: the one it was drawn with, or that of a thin rectangle (older walls). */
export function wallAxisOf(s: Solid): [Vec2, Vec2] | null {
  if (s.wallAxis) return s.wallAxis;
  const o = s.plan.outer;
  if (o.length !== 4 || o.some((v) => v.bulge || v.round || v.chamfer) || s.op !== 'add' || s.shell || s.roof.kind !== 'flat') return null;
  const P = o.map((v) => v.p);
  const len = (i: number) => Math.hypot(P[(i + 1) % 4]![0] - P[i]![0], P[(i + 1) % 4]![1] - P[i]![1]);
  const l0 = len(0),
    l1 = len(1);
  const short = Math.min(l0, l1),
    long = Math.max(l0, l1);
  if (short > 0.8 || long < 2 * short) return null;
  const m = (i: number): Vec2 => [(P[i]![0] + P[(i + 1) % 4]![0]) / 2, (P[i]![1] + P[(i + 1) % 4]![1]) / 2];
  return l0 < l1 ? [m(3), m(1)] : [m(0), m(2)];
}

/** Thickness of a wall volume: twice the farthest corner from its centre line. */
function wallThick(s: Solid, ax: [Vec2, Vec2]): number {
  const [a, b] = ax;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / L,
    nz = (b[0] - a[0]) / L;
  return Math.max(0.05, 2 * Math.max(...s.plan.outer.map((v) => Math.abs((v.p[0] - a[0]) * nx + (v.p[1] - a[1]) * nz))));
}

/** Where two offset lines meet: through p along d and through q along e (null when parallel). */
function meet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Joins the walls of a building drawn with the Walls tool (ArchiCAD and Revit wall joins): where exactly two
 * walls meet end to end their faces are mitred (the corner closes at any angle); a free end, or an end on the
 * middle of another wall (a T), runs half the thickness past its point. The corners move in place, so the
 * vertex IDs (and the doors and windows on the faces) stay.
 */
export function joinWalls(b: Building3): void {
  const walls = b.solids.flatMap((s) => {
    const ax = s.hidden ? null : wallAxisOf(s);
    if (!ax) return [];
    if (!s.wallAxis) s.wallAxis = [ax[0], ax[1]];
    return [{ s, a: ax[0], b: ax[1], h: wallThick(s, ax) / 2 }];
  });
  const near = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.02;
  for (const w of walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 1e-6) continue;
    const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const n: Vec2 = [-d[1], d[0]];
    // The two corners (left, right of a → b) at end E: mitred with the one wall meeting there end to end.
    const corners = (E: Vec2, atB: boolean): [Vec2, Vec2] => {
      const dIn: Vec2 = atB ? d : [-d[0], -d[1]];
      const nIn: Vec2 = [-dIn[1], dIn[0]];
      const others = walls.filter((o) => o !== w && (near(o.a, E) || near(o.b, E)));
      const ext = (): [Vec2, Vec2] => {
        const c: Vec2 = [E[0] + dIn[0] * w.h, E[1] + dIn[1] * w.h];
        const l: Vec2 = [c[0] + nIn[0] * w.h, c[1] + nIn[1] * w.h],
          r: Vec2 = [c[0] - nIn[0] * w.h, c[1] - nIn[1] * w.h];
        return atB ? [l, r] : [r, l];
      };
      if (others.length !== 1) return ext();
      const o = others[0]!;
      const F = near(o.a, E) ? o.b : o.a;
      const LO = Math.hypot(F[0] - E[0], F[1] - E[1]);
      if (LO < 1e-6) return ext();
      const dOut: Vec2 = [(F[0] - E[0]) / LO, (F[1] - E[1]) / LO];
      const nOut: Vec2 = [-dOut[1], dOut[0]];
      const cross = dIn[0] * dOut[1] - dIn[1] * dOut[0],
        dot = dIn[0] * dOut[0] + dIn[1] * dOut[1];
      let l: Vec2 | null, r: Vec2 | null;
      if (Math.abs(cross) < 0.02) {
        if (dot < 0) return ext();
        // In line: the faces meet flush at the point.
        l = [E[0] + nIn[0] * w.h, E[1] + nIn[1] * w.h];
        r = [E[0] - nIn[0] * w.h, E[1] - nIn[1] * w.h];
      } else {
        l = meet([E[0] + nIn[0] * w.h, E[1] + nIn[1] * w.h], dIn, [E[0] + nOut[0] * o.h, E[1] + nOut[1] * o.h], dOut);
        r = meet([E[0] - nIn[0] * w.h, E[1] - nIn[1] * w.h], dIn, [E[0] - nOut[0] * o.h, E[1] - nOut[1] * o.h], dOut);
      }
      // A very sharp angle would send the mitre far away: the plain end instead.
      const far = (q: Vec2 | null) => !q || Math.hypot(q[0] - E[0], q[1] - E[1]) > 6 * Math.max(w.h, o.h);
      if (far(l) || far(r)) return ext();
      return atB ? [l!, r!] : [r!, l!];
    };
    // corners() answers in a → b terms at both ends (left, right).
    const [aL, aR] = corners(w.a, false);
    const [bL, bR] = corners(w.b, true);
    const ring: Vec2[] = [aL, bL, bR, aR];
    const ordered = signedArea2(ring) > 0 ? ring : [...ring].reverse();
    if (w.s.plan.outer.length === 4) w.s.plan.outer.forEach((v, i) => (v.p = [Math.round(ordered[i]![0] * 1e4) / 1e4, Math.round(ordered[i]![1] * 1e4) / 1e4]));
    else w.s.plan.outer = planVertices(ordered);
  }
}

/**
 * Starts a chain at the first click. On a wall already there it goes on with that building (an interior
 * wall: that floor); inside a closed building it divides the floor shown; elsewhere it makes a new one.
 */
export function startWallChain(ed: Editor3, e: { clientX: number; clientY: number }, hit: WallHit | null = null): void {
  if (hit) {
    const b = ed.store.building(hit.target.bid);
    if (b) {
      // On an interior wall, or on the wall of a closed building: a wall that divides that floor.
      if (hit.target.interior || hit.target.enclosing) {
        ed.openFloorFor(b);
        ed.wallChain = { bid: b.id, levelId: ed.workLevel(b)?.id ?? null, interior: true, own: false };
      } else ed.wallChain = { bid: b.id, levelId: null, interior: false, own: false };
      return;
    }
  }
  const inside = ed.buildingUnderWall(e);
  if (inside) {
    ed.openFloorFor(inside);
    ed.wallChain = { bid: inside.id, levelId: ed.workLevel(inside)?.id ?? null, interior: true, own: false };
  } else ed.wallChain = { bid: null, levelId: null, interior: false, own: true };
}

/** Height of the chain's drawing plane (world y): the floor shown inside a building, else the ground. */
export function wallChainY(ed: Editor3): number {
  const c = ed.wallChain;
  const b = c?.interior ? ed.store.building(c.bid) : undefined;
  const lv = b && b.levels.find((l) => l.id === c!.levelId);
  return b && lv ? lv.elevation + (b.elevation ?? 0) : 0;
}

/** One piece of the chain, made at once (from world point `a` to `b`). */
export function wallSegment(ed: Editor3, a: Vec2, bw: Vec2): void {
  const c = ed.wallChain;
  if (!c) return;
  const len = Math.hypot(bw[0] - a[0], bw[1] - a[1]);
  if (len < 0.05) return;
  if (c.interior) {
    const b = ed.store.building(c.bid);
    if (!b || !c.levelId) return;
    const la = toLocal(b, a),
      lb = toLocal(b, bw);
    const lid = c.levelId;
    ed.change(b.id, (x) => void addInteriorWall(x, lid, la, lb, ed.iwallThickness, uid), `Wall ${fmt(len)} m · Ctrl+Z takes it back · Esc ends.`);
    return;
  }
  // A wall volume along the segment, as thick as the wall and long enough to close the corners.
  const t = ed.wallThickness;
  let b = c.bid ? ed.store.building(c.bid) : undefined;
  const fresh = !b;
  if (!b) {
    b = newBuilding({ name: tr(`Building ${ed.project.buildings.length + 1}`), position: [a[0], a[1]], levels: levelsFor(1, ed.wallHeight, ed.wallHeight) });
    c.bid = b.id;
  }
  const la = toLocal(b, a),
    lb = toLocal(b, bw);
  const dx = (lb[0] - la[0]) / len,
    dz = (lb[1] - la[1]) / len;
  const nx = -dz * (t / 2),
    nz = dx * (t / 2);
  const ex = dx * (t / 2),
    ez = dz * (t / 2);
  const ring: Vec2[] = [
    [la[0] - ex + nx, la[1] - ez + nz],
    [lb[0] + ex + nx, lb[1] + ez + nz],
    [lb[0] + ex - nx, lb[1] + ez - nz],
    [la[0] - ex - nx, la[1] - ez - nz],
  ];
  const s = newSolid({ name: tr('Wall'), plan: { outer: planVertices(signedArea2(ring) > 0 ? ring : [...ring].reverse()), holes: [] }, height: ed.wallHeight, roof: roofSpec('flat', { parapet: 0 }) });
  s.plinth = 0;
  s.wallAxis = [la, lb];
  if (fresh) {
    b.solids.push(s);
    joinWalls(b);
    ed.store.project.buildings.push(b);
    ed.store.commit([b.id], `Wall ${fmt(len)} m · Ctrl+Z takes it back · Esc ends.`);
  } else
    ed.change(
      b.id,
      (x) => {
        x.solids.push(s);
        joinWalls(x);
      },
      `Wall ${fmt(len)} m · Ctrl+Z takes it back · Esc ends.`,
    );
  ed.context = b.id;
}

/** Ctrl+Z or Backspace while drawing: the last piece goes back. */
export function wallUnsegment(ed: Editor3): void {
  ed.store.undo();
  const c = ed.wallChain;
  if (c && !c.interior && c.bid && !ed.store.building(c.bid)) c.bid = null;
}

/** The chain ends: closed outside a building it becomes one building with hollow walls (rooms inside). */
export function wallChainDone(ed: Editor3, pts: Vec2[], closed: boolean): void {
  const c = ed.wallChain;
  ed.wallChain = null;
  if (!c) return;
  if (c.interior) {
    if (closed && pts.length >= 3) {
      ed.wallChain = c;
      wallSegment(ed, pts[pts.length - 1]!, pts[0]!);
      ed.wallChain = null;
    }
    ed.toast(closed ? 'Room closed.' : 'Wall chain ended: click to start another.');
    return;
  }
  const own = c.own && (!c.bid || (ed.store.building(c.bid)?.solids.every((s) => !!s.wallAxis) ?? true));
  if (closed && pts.length >= 3 && own) {
    // The pieces are replaced by one volume hollow by the wall thickness (a building with its rooms).
    if (c.bid) ed.store.project.buildings = ed.store.project.buildings.filter((x) => x.id !== c.bid);
    ed.wallsDone(pts, true);
    return;
  }
  // Closed onto walls that were already there: the last piece closes it, the walls stay walls.
  if (closed && pts.length >= 3) {
    ed.wallChain = c;
    wallSegment(ed, pts[pts.length - 1]!, pts[0]!);
    ed.wallChain = null;
  }
  if (c.bid && ed.store.building(c.bid)) {
    ed.select({ building: c.bid });
    ed.toast('Walls made: click a wall with Door (D) or Window (J); W again for more.');
  }
}

/**
 * Interior walls tool: each click on the floor of the level shown adds a wall from the previous
 * point (a new start after Enter); Shift+click on a wall puts a 0.9 m door there. The walls are
 * `Building3.interiors` (eval/interiorwalls.ts), drawn in the interior view.
 */
export function iwallAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const b = ed.store.building(ed.context) ?? ed.activeBuilding();
  if (!b) return ed.showDim('Enter a building first (double click)', e);
  const lv = ed.workLevel(b);
  if (!lv) return;
  const w = ed.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
  if (!w) return;
  let l = toLocal(b, [w.x, w.z]);
  if (ed.infer.enabled) l = [Math.round(l[0] / ed.infer.grid) * ed.infer.grid, Math.round(l[1] / ed.infer.grid) * ed.infer.grid];
  ed.iwallHover = l;
  if (ed.iwallLast) {
    const d = Math.hypot(l[0] - ed.iwallLast[0], l[1] - ed.iwallLast[1]);
    ed.showDim(`${fmt(d)} m · Enter ends`, e);
  } else ed.showDim(e.shiftKey ? 'Shift+click on a wall: a door' : 'Click the start of the wall', e);
  if (!commit) return;
  if (e.shiftKey) {
    // A door on the nearest interior wall of this level.
    const it = b.interiors[lv.id];
    if (!it) return ed.toast('No interior wall on ed floor yet.');
    const node = new Map(it.nodes.map((n) => [n.id, n.p]));
    let best: { id: ID; u: number; d: number } | null = null;
    for (const wl of it.walls) {
      const a = node.get(wl.a), c = node.get(wl.b);
      if (!a || !c) continue;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      const u = Math.max(0, Math.min(len, ((l[0] - a[0]) * (c[0] - a[0]) + (l[1] - a[1]) * (c[1] - a[1])) / len));
      const d = Math.hypot(a[0] + ((c[0] - a[0]) * u) / len - l[0], a[1] + ((c[1] - a[1]) * u) / len - l[1]);
      if (!best || d < best.d) best = { id: wl.id, u, d };
    }
    if (!best || best.d > 0.5) return ed.toast('Shift+click on an interior wall to put a door in it.');
    const pick = best;
    ed.change(b.id, (x) => {
      const ix = x.interiors[lv.id] as InteriorWithDoors;
      ix.doors = [...interiorDoors(ix), { wall: pick.id, u: pick.u, width: 0.9, height: 2.1 }];
    }, 'Door added to the interior wall.');
    return;
  }
  const from = ed.iwallLast;
  ed.iwallLast = l;
  if (from && Math.hypot(l[0] - from[0], l[1] - from[1]) > 0.05) ed.change(b.id, (x) => void addInteriorWall(x, lv.id, from, l, ed.iwallThickness, uid), `Interior wall ${fmt(Math.hypot(l[0] - from[0], l[1] - from[1]))} m (floor ${lv.elevation.toFixed(1)} m).`);
}

/** A typed length for the interior wall being drawn: from its last point towards the cursor. */
export function iwallTyped(ed: Editor3, len: number): boolean {
  const b = ed.store.building(ed.context) ?? ed.activeBuilding();
  const lv = b && ed.workLevel(b);
  const from = ed.iwallLast;
  if (!b || !lv || !from || !(len > 0)) return false;
  const h = ed.iwallHover ?? [from[0] + 1, from[1]];
  let dx = h[0] - from[0],
    dz = h[1] - from[1];
  const l = Math.hypot(dx, dz);
  [dx, dz] = l < 1e-6 ? [1, 0] : [dx / l, dz / l];
  const to: Vec2 = [Math.round((from[0] + dx * len) * 1e6) / 1e6, Math.round((from[1] + dz * len) * 1e6) / 1e6];
  ed.iwallLast = to;
  ed.iwallHover = [to[0] + dx, to[1] + dz];
  return ed.change(b.id, (x) => void addInteriorWall(x, lv.id, from, to, ed.iwallThickness, uid), `Interior wall ${fmt(len)} m (floor ${lv.elevation.toFixed(1)} m).`);
}

/** Walls tool finished: a building with walls of the thickness (closed) or a free-standing wall (open). */
/** Walls drawn in the floor plan (world points): closed, a building; open, a free-standing wall. */
export function wallsFromPlan(ed: Editor3, pts: Vec2[], closed: boolean): void {
  ed.wallsDone(pts, closed);
}

export function wallsDone(ed: Editor3, pts: Vec2[], closed: boolean, line = ed.wallLine): void {
  const t = ed.wallThickness;
  if (!closed) {
    const b = ed.ownerAt(pts[0]![0], pts[0]![1]);
    const it: Item = { id: uid(), type: 'wall-run', params: { thickness: t, height: 2.2 }, host: { kind: 'path', points: pts.map((p) => { const l = toLocal(b, p); return [l[0], 0, l[1]] as Vec3; }) } };
    ed.adopt(b);
    ed.change(b.id, (x) => void x.items.push(it), `Free-standing wall ${fmt(t)} m thick: its points and height are editable.`);
    ed.context = b.id;
    ed.select({ building: b.id, item: it.id });
    return;
  }
  // The volume reaches the outer face, hollow by the thickness; the clicked line is its centre, its
  // outer face or its inner face (the location line).
  const ccw = signedArea2(pts) > 0 ? pts : [...pts].reverse();
  const grow = line === 'outside' ? 0 : line === 'inside' ? t : t / 2;
  const outer = grow ? offsetRing(ccw, ccw.map(() => -grow)) : ccw;
  if (!ringValid(outer, 1)) return ed.toast('Those walls cross each other: draw them again.');
  const c: Vec2 = [outer.reduce((a, p) => a + p[0], 0) / outer.length, outer.reduce((a, p) => a + p[1], 0) / outer.length];
  const wh = ed.wallHeight;
  const b = newBuilding({ name: tr(`Building ${ed.project.buildings.length + 1}`), position: c, levels: levelsFor(1, wh, wh) });
  // Walls and nothing else: no parapet, no stone plinth (a wall drawing is not a massing study); the
  // roof slab closes the top until a roof is chosen.
  const s = newSolid({ name: tr('Walls'), plan: { outer: planVertices(outer.map((p) => [p[0] - c[0], p[1] - c[1]] as Vec2)), holes: [] }, height: wh, roof: roofSpec('flat', { parapet: 0 }) });
  s.shell = t;
  s.plinth = 0;
  b.solids.push(s);
  ed.store.project.buildings.push(b);
  if (!ed.store.commit([b.id], 'Building from walls.')) return;
  ed.context = b.id;
  ed.select({ building: b.id, solids: [s.id] });
  ed.toast(`Building from walls ${fmt(t)} m thick. Type the height (or "3f" for floors) and Enter; then click a wall with Door (D) or Window (J).`);
  const bid = b.id,
    sid = s.id;
  ed.setMeasure('Height', (txt) => {
    const nf = parseFloors(txt);
    const v = nf !== null ? nf * 3 : parseLength(txt);
    if (v === null || v <= 0.5) return false;
    return ed.change(bid, (x) => {
      const so = findSolid(x, sid)!;
      so.height = v;
      fillLevels(x, v);
    }, `Walls ${fmt(v)} m high.`);
  });
}

/** Slab tool finished: a 20 cm slab volume on the floor shown. */
export function slabDone(ed: Editor3, pts: Vec2[], closed: boolean): void {
  if (!closed) return ed.toast('Click the first corner to close the slab.');
  const b = ed.ownerAt(pts[0]![0], pts[0]![1]);
  const lv = ed.workLevel(b);
  const local = pts.map((p) => toLocal(b, p));
  const ring = signedArea2(local) > 0 ? local : [...local].reverse();
  const s = newSolid({ name: 'Slab', plan: { outer: planVertices(ring), holes: [] }, base: lv?.elevation ?? 0, height: ed.slabThickness, roof: roofSpec('flat', { parapet: 0 }) });
  ed.adopt(b);
  ed.change(b.id, (x) => void x.solids.push(s), 'Slab 20 cm: its corners, height and edges are editable like any volume.');
  ed.context = b.id;
  ed.select({ building: b.id, solids: [s.id] });
}

/** Column tool: a column on the floor shown, up to the slab above. */
export function columnAt(ed: Editor3, e: PointerEvent): void {
  const at = ed.levelPoint(e);
  const g = at ? null : ed.view.onPlane(e, 0);
  const b = at?.b ?? (g ? ed.ownerAt(g.x, g.z) : null);
  if (!b) return;
  const lv = at?.lv ?? ed.workLevel(b);
  const p = at?.p ?? toLocal(b, [g!.x, g!.z]);
  const h = Math.max(1, (lv?.height ?? 3) - 0.25);
  const it: Item = { id: uid(), type: 'column-square', params: { height: Math.round(h * 100) / 100, plinth: false, capital: false }, host: { kind: 'free', p: [p[0], lv?.elevation ?? 0, p[1]], rot: 0 } };
  ed.adopt(b);
  ed.change(b.id, (x) => void x.items.push(it), `Column ${fmt(h)} m high (click again for another; Esc ends).`);
  ed.context = b.id;
}

/**
 * Beam tool: two clicks on the floor shown (where the eye is, as beams are drawn in plan in ArchiCAD
 * and Revit), the beam goes under the slab above; a typed length ends it towards the cursor. In a
 * building (the one under the pointer) or on open ground (the site, like a pergola beam).
 */
export function beamAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const p = ed.beamPoint(e);
  if (!p) return;
  const { b, lv, l } = p;
  const top = lv.elevation + lv.height - 0.25;
  if (!ed.beamFrom) {
    if (!commit) {
      ed.drawBeamDraft(b, null, null);
      return ed.showDim('Click the first end of the beam', e);
    }
    ed.beamFrom = [l[0], top, l[1]];
    ed.beamB = b;
    return;
  }
  ed.beamHover = l;
  const a = ed.beamFrom;
  ed.drawBeamDraft(b, a, [l[0], a[1], l[1]]);
  const len = Math.hypot(l[0] - a[0], l[1] - a[2]);
  if (!commit) return ed.showDim(`${fmt(len)} m · type a length`, e);
  ed.beamTo(l);
}

/** The floor point (building frame) under the pointer for the beam: the beam's building once started. */
export function beamPoint(ed: Editor3, e: { clientX: number; clientY: number }): { b: Building3; lv: { id: ID; elevation: number; height: number }; l: Vec2 } | null {
  let b = ed.beamFrom ? ed.beamB : ed.buildingUnderWall(e);
  if (!b) {
    const g = ed.view.onPlane(e, 0);
    if (!g) return null;
    b = ed.ownerAt(g.x, g.z);
  }
  const lv = ed.workLevel(b) ?? { id: '', elevation: 0, height: 3 };
  const w = ed.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
  if (!w) return null;
  let l = toLocal(b, [w.x, w.z]);
  if (ed.infer.enabled) l = [Math.round(l[0] / ed.infer.grid) * ed.infer.grid, Math.round(l[1] / ed.infer.grid) * ed.infer.grid];
  // Snaps to 15° steps from the first end when close, like the wall tools.
  if (ed.beamFrom) {
    const a = ed.beamFrom;
    const len = Math.hypot(l[0] - a[0], l[1] - a[2]);
    const ang = Math.atan2(l[1] - a[2], l[0] - a[0]);
    const st = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
    if (Math.abs(ang - st) < 0.05) l = [a[0] + Math.cos(st) * len, a[2] + Math.sin(st) * len];
  }
  return { b, lv, l };
}

/** Ends the beam being drawn at `l` (building frame). */
export function beamTo(ed: Editor3, l: Vec2): boolean {
  const a = ed.beamFrom,
    b = ed.beamB;
  if (!a || !b) return false;
  const len = Math.hypot(l[0] - a[0], l[1] - a[2]);
  if (len < 0.3) return false;
  ed.beamFrom = null;
  ed.beamB = null;
  ed.clearBeamDraft();
  const it: Item = { id: uid(), type: 'beam', params: { align: 'top' }, host: { kind: 'path', points: [a, [l[0], a[1], l[1]]] } };
  ed.adopt(b);
  ed.change(b.id, (x) => void x.items.push(it), `Beam ${fmt(len)} m under the slab.`);
  ed.context = b.id;
  ed.shell.dim.hidden = true;
  const nb = ed.store.building(b.id);
  if (nb) ed.drawBeamDraft(nb, null, null);
  return true;
}

/** A typed length for the beam being drawn: from its first end towards the cursor. */
export function beamTyped(ed: Editor3, len: number): boolean {
  const a = ed.beamFrom;
  if (!a || !(len > 0.3)) return false;
  const h = ed.beamHover ?? [a[0] + 1, a[2]];
  let dx = h[0] - a[0],
    dz = h[1] - a[2];
  const d = Math.hypot(dx, dz);
  [dx, dz] = d < 1e-6 ? [1, 0] : [dx / d, dz / d];
  return ed.beamTo([Math.round((a[0] + dx * len) * 1e6) / 1e6, Math.round((a[2] + dz * len) * 1e6) / 1e6]);
}

/**
 * The beam being drawn (its line at its height and the same line on the floor, joined at the ends) and
 * the beams already on this floor, which the floor cut (1.2 m) hides: their lines on the floor, the way
 * a plan shows the beams above it.
 */
export function drawBeamDraft(ed: Editor3, b: Building3, a: Vec3 | null, c: Vec3 | null): void {
  ed.clearBeamDraft();
  const lv = ed.workLevel(b);
  const fy = (lv?.elevation ?? 0) + 0.02;
  const W = (p: Vec3, y: number) => {
    const q = toWorld(b, [p[0], p[2]]);
    return new THREE.Vector3(q[0], y + (b.elevation ?? 0), q[1]);
  };
  const pts = a && c ? [W(a, a[1]), W(c, a[1]), W(a, fy), W(c, fy), W(a, fy), W(a, a[1]), W(c, fy), W(c, a[1])] : [];
  const lo = lv?.elevation ?? 0,
    hi = lo + (lv?.height ?? 3);
  for (const it of b.items) {
    if (it.type !== 'beam' || it.host.kind !== 'path') continue;
    const q = it.host.points;
    for (let i = 0; i + 1 < q.length; i++) if (q[i]![1] > lo && q[i]![1] <= hi + 0.01) pts.push(W(q[i]!, fy), W(q[i + 1]!, fy));
  }
  if (!pts.length) return;
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false, transparent: true, opacity: 0.9 }));
  line.name = 'beam-draft';
  line.renderOrder = 10;
  ed.snapOverlay.add(line);
  ed.view.mark();
}

export function clearBeamDraft(ed: Editor3): void {
  const o = ed.snapOverlay.getObjectByName('beam-draft') as THREE.LineSegments | undefined;
  if (!o) return;
  ed.snapOverlay.remove(o);
  o.geometry.dispose();
  (o.material as THREE.Material).dispose();
  ed.view.mark();
}

/**
 * Terrain tool (Revit's topography points, ArchiCAD's mesh points): a click on the ground sets its height
 * there (the height in the top bar; typed afterwards it changes that point), a click on a point picks it
 * to type its height again, Alt+click removes it. The buildings and streets keep a flat pad.
 */
export function terrainAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const g = ed.view.onGround(e);
  if (!g) return;
  const pts = ed.project.terrain?.points ?? [];
  const near = pts.find((q) => Math.hypot(q.p[0] - g.x, q.p[1] - g.z) < Math.max(1, 14 * ed.view.worldPerPixel(new THREE.Vector3(q.p[0], q.y, q.p[1]))));
  ed.drawTerrainMarks(near?.id ?? null);
  if (!commit) return ed.showDim(near ? `${fmt(near.y)} m · ${e.altKey ? 'click removes' : 'click to change'}` : `${fmt(ed.terrainHeight)} m`, e);
  if (near && e.altKey) {
    ed.changeSite((p) => {
      const left = p.terrain!.points.filter((q) => q.id !== near.id);
      if (left.length) p.terrain!.points = left;
      else delete p.terrain;
    }, 'Terrain point removed.');
    return ed.drawTerrainMarks(null);
  }
  // Pressing on a point and dragging up or down raises or lowers the ground there (sculpting).
  if (near) ed.terrainDrag = { id: near.id, y0: near.y, sy: e.clientY, moved: false };
  let id = near?.id;
  if (!id) {
    const q = { id: uid(), p: ed.infer.enabled ? ([Math.round(g.x / ed.infer.grid) * ed.infer.grid, Math.round(g.z / ed.infer.grid) * ed.infer.grid] as Vec2) : ([g.x, g.z] as Vec2), y: ed.terrainHeight };
    if ((ed.project.terrain?.points.length ?? 0) >= 2000) return ed.toast('At most 2000 terrain points.');
    ed.changeSite((p) => void (p.terrain ??= { points: [] }).points.push(q), `Ground at ${fmt(q.y)} m there: type another height and Enter.`);
    id = q.id;
  } else ed.toast(`Point at ${fmt(near!.y)} m: type its height and Enter.`);
  const pid = id;
  ed.setMeasure('Height', (txt) => {
    const v = parseLength(txt);
    if (v === null || Math.abs(v) > 500) return false;
    return ed.changeSite((p) => {
      const q = p.terrain?.points.find((x) => x.id === pid);
      if (q) q.y = v;
    }, `Ground at ${fmt(v)} m there.`);
  });
  ed.drawTerrainMarks(pid);
}

export function terrainDragMove(ed: Editor3, e: PointerEvent): void {
  const d = ed.terrainDrag!;
  const q = ed.store.project.terrain?.points.find((x) => x.id === d.id);
  if (!q) return;
  if (Math.abs(e.clientY - d.sy) > 3) d.moved = true;
  if (!d.moved) return;
  // 1 px of the pointer: the size of a pixel at the point (snapped to 10 cm).
  const k = ed.view.worldPerPixel(new THREE.Vector3(q.p[0], q.y, q.p[1]));
  q.y = Math.round((d.y0 + (d.sy - e.clientY) * k) * 10) / 10;
  ed.store.touch([], '');
  ed.drawTerrainMarks(d.id);
  ed.showDim(`${fmt(q.y)} m`, e);
}

export function terrainDragEnd(ed: Editor3): void {
  const d = ed.terrainDrag!;
  ed.terrainDrag = null;
  if (!d.moved) return;
  const q = ed.store.project.terrain?.points.find((x) => x.id === d.id);
  ed.store.commit([], q ? `Ground at ${fmt(q.y)} m there.` : '');
  if (q) ed.toast(`Ground at ${fmt(q.y)} m there.`);
}

/** The terrain points while the tool is in hand: a short post at each, the one under the pointer orange. */
export function drawTerrainMarks(ed: Editor3, hot: ID | null): void {
  ed.clearTerrainMarks();
  const pts = ed.project.terrain?.points ?? [];
  if (!pts.length) return;
  const pos: number[] = [],
    hotPos: number[] = [];
  for (const q of pts) {
    const r = Math.max(0.25, 6 * ed.view.worldPerPixel(new THREE.Vector3(q.p[0], q.y, q.p[1])));
    const to = q.id === hot ? hotPos : pos;
    to.push(q.p[0], q.y, q.p[1], q.p[0], q.y + r * 4, q.p[1], q.p[0] - r, q.y, q.p[1], q.p[0] + r, q.y, q.p[1], q.p[0], q.y, q.p[1] - r, q.p[0], q.y, q.p[1] + r);
  }
  const g = new THREE.Group();
  g.name = 'terrain-marks';
  for (const [list, color] of [[pos, '#3b82f6'], [hotPos, '#e2702a']] as const) {
    if (!list.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 10;
    g.add(l);
  }
  ed.snapOverlay.add(g);
  ed.view.mark();
}

export function clearTerrainMarks(ed: Editor3): void {
  const o = ed.snapOverlay.getObjectByName('terrain-marks');
  if (!o) return;
  ed.snapOverlay.remove(o);
  o.traverse((c) => {
    const l = c as THREE.LineSegments;
    if (l.geometry) {
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  });
  ed.view.mark();
}

/**
 * Mirror tool (SketchUp's Flip along a line, Revit's Mirror – Draw Axis): two clicks draw the mirror line;
 * the selected volumes (inside a building) or the selected buildings are reflected across it; with Ctrl
 * a reflected copy is made and the original stays.
 */
export function mirrorAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const sn = ed.infer.snap(e, 0, ed.mirrorFrom, null);
  if (!sn) return;
  const p = sn.p;
  const old = ed.snapOverlay.getObjectByName('mirror-draft') as THREE.Line | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.geometry.dispose();
  }
  if (!ed.mirrorFrom) {
    if (commit) {
      if (!ed.activeBuilding()) return ed.toast('Select what to mirror first.');
      ed.mirrorFrom = p.clone();
    } else ed.showDim('Click the first point of the mirror line', e);
    return ed.view.mark();
  }
  const dir = p.clone().sub(ed.mirrorFrom);
  if (!commit) {
    const far = dir.lengthSq() > 1e-6 ? dir.clone().normalize().multiplyScalar(60) : new THREE.Vector3();
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ed.mirrorFrom.clone().sub(far), p.clone().add(far)]), new THREE.LineDashedMaterial({ color: '#7a4fd1', dashSize: 0.6, gapSize: 0.3, depthTest: false }));
    l.computeLineDistances();
    l.name = 'mirror-draft';
    l.renderOrder = 26;
    ed.snapOverlay.add(l);
    return ed.view.mark();
  }
  const a: Vec2 = [ed.mirrorFrom.x, ed.mirrorFrom.z];
  ed.mirrorFrom = null;
  ed.shell.dim.hidden = true;
  if (dir.lengthSq() < 0.01) return;
  const len = Math.hypot(dir.x, dir.z);
  ed.mirrorAcross(a, [dir.x / len, dir.z / len], e.ctrlKey || e.metaKey);
}

export function roomDown(ed: Editor3, e: PointerEvent): void {
  const at = ed.levelPoint(e);
  ed.roomStart = { x: e.clientX, y: e.clientY };
  if (at) {
    ed.roomGround = null;
    ed.roomFrom = at.p;
    return;
  }
  // On open ground: a rectangle dragged there is a room with its own walls (a building of one room).
  const p = ed.groundPoint(e);
  if (!p) return;
  ed.roomGround = p;
  ed.roomFrom = p;
}

/** The ground point under the pointer, on the grid when snapping. */
export function groundPoint(ed: Editor3, e: { clientX: number; clientY: number }): Vec2 | null {
  const g = ed.view.onPlane(e, 0);
  if (!g) return null;
  return ed.infer.enabled ? [Math.round(g.x / ed.infer.grid) * ed.infer.grid, Math.round(g.z / ed.infer.grid) * ed.infer.grid] : [g.x, g.z];
}

export function roomGroundMove(ed: Editor3, e: PointerEvent): void {
  const a = ed.roomGround!;
  const c = ed.groundPoint(e);
  const o = ed.snapOverlay.getObjectByName('room-draft');
  if (o) {
    ed.snapOverlay.remove(o);
    (o as THREE.Line).geometry.dispose();
  }
  if (!c || !(e.buttons & 1)) return;
  const pts = [a, [c[0], a[1]], c, [a[0], c[1]], a].map((q) => new THREE.Vector3(q[0]!, 0.08, q[1]!));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false }));
  l.name = 'room-draft';
  l.renderOrder = 10;
  ed.snapOverlay.add(l);
  ed.view.mark();
  ed.showDim(`${fmt(Math.abs(c[0] - a[0]))} × ${fmt(Math.abs(c[1] - a[1]))} m`, e);
}

/** A room dragged on open ground: walls around it (their inner faces on the rectangle) and the room. */
export function roomGroundUp(ed: Editor3, e: PointerEvent): void {
  const a = ed.roomGround!;
  ed.roomGround = null;
  ed.roomFrom = null;
  const o = ed.snapOverlay.getObjectByName('room-draft');
  if (o) ed.snapOverlay.remove(o);
  const c = ed.groundPoint(e);
  if (!c) return;
  if (Math.abs(c[0] - a[0]) < 0.8 || Math.abs(c[1] - a[1]) < 0.8) return ed.toast('Drag a larger rectangle for the room.');
  const t = ed.wallThickness;
  const x0 = Math.min(a[0], c[0]) - t / 2,
    x1 = Math.max(a[0], c[0]) + t / 2,
    z0 = Math.min(a[1], c[1]) - t / 2,
    z1 = Math.max(a[1], c[1]) + t / 2;
  ed.wallsDone([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], true, 'center');
  const b = ed.store.building(ed.context);
  const lv = b && ed.workLevel(b);
  if (!b || !lv) return;
  const poly = ([[x0 + t / 2, z0 + t / 2], [x1 - t / 2, z0 + t / 2], [x1 - t / 2, z1 - t / 2], [x0 + t / 2, z1 - t / 2]] as Vec2[]).map((q) => toLocal(b, q));
  const area = Math.round(roomArea(poly) * 100) / 100;
  const id = uid();
  ed.change(b.id, (x) => void interiorOf(x, lv.id).rooms.push({ id, name: tr('Room 1'), wallIds: [], polygon: poly, area }), `Room: ${fmt(area)} m² with its walls.`);
  ed.roomSel = { level: lv.id, room: id };
  ed.emit();
}

export function roomMove(ed: Editor3, e: PointerEvent): void {
  if (ed.roomGround) return ed.roomGroundMove(e);
  const at = ed.levelPoint(e);
  if (!at) return ed.showDim('Drag a rectangle: a room with its walls', e);
  const o = ed.snapOverlay.getObjectByName('room-draft');
  if (o) {
    ed.snapOverlay.remove(o);
    (o as THREE.Line).geometry.dispose();
  }
  if (!ed.roomFrom || !(e.buttons & 1)) return ed.showDim('Click inside walls, or drag a rectangle', e);
  const a = ed.roomFrom,
    c = at.p;
  const M = ed.view.buildingMatrix(at.b);
  const y = at.lv.elevation + 0.08;
  const pts = [a, [c[0], a[1]], c, [a[0], c[1]], a].map((q) => new THREE.Vector3(q[0]!, y, q[1]!).applyMatrix4(M));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false }));
  l.name = 'room-draft';
  l.renderOrder = 10;
  ed.snapOverlay.add(l);
  ed.view.mark();
  ed.showDim(`${fmt(Math.abs(c[0] - a[0]))} × ${fmt(Math.abs(c[1] - a[1]))} m · ${fmt(Math.abs((c[0] - a[0]) * (c[1] - a[1])))} m²`, e);
}

export function roomUp(ed: Editor3, e: PointerEvent): void {
  if (ed.roomGround) return ed.roomGroundUp(e);
  const at = ed.levelPoint(e);
  const a = ed.roomFrom!;
  const moved = ed.roomStart ? Math.hypot(e.clientX - ed.roomStart.x, e.clientY - ed.roomStart.y) > 6 : false;
  ed.roomFrom = null;
  ed.roomStart = null;
  const o = ed.snapOverlay.getObjectByName('room-draft');
  if (o) ed.snapOverlay.remove(o);
  if (!at) return;
  const { b, lv, p } = at;
  const n = Object.values(b.interiors).reduce((k, it) => k + it.rooms.length, 0) + 1;
  if (moved && Math.abs(p[0] - a[0]) > 0.6 && Math.abs(p[1] - a[1]) > 0.6) {
    let rid = '';
    ed.change(b.id, (x) => void (rid = addRoomRect(x, lv.id, a, p, ed.iwallThickness, tr(`Room ${n}`), uid)), `Room ${n}: ${fmt(Math.abs((p[0] - a[0]) * (p[1] - a[1])))} m² with its four walls.`);
    ed.roomSel = { level: lv.id, room: rid };
    ed.iwallSel = null;
    ed.emit();
    return;
  }
  // A click inside walls: the room they close.
  const it = b.interiors[lv.id];
  // The inner faces of the volumes on this floor close the rooms along the outer walls.
  const inner = b.solids
    .filter((s) => s.op === 'add' && s.base <= lv.elevation + 0.1 && s.base + s.height > lv.elevation + 0.5)
    .map((s) => {
      const ring = sampleRing(s.plan.outer).pts as Vec2[];
      const ccw = signedArea2(ring) > 0 ? ring : [...ring].reverse();
      const t = s.shell ?? 0.3;
      const r = offsetRing(ccw, ccw.map(() => t));
      return ringValid(r, 1) ? r : ccw;
    });
  const loop = it ? loopAround(it, p, inner) : inner.length ? loopAround({ nodes: [], walls: [], rooms: [] }, p, inner) : null;
  if (!loop) return ed.toast('The walls do not close around ed point: draw the missing wall, or drag a rectangle.');
  const id = uid();
  const area = Math.round(roomArea(loop.polygon) * 100) / 100;
  ed.change(b.id, (x) => void interiorOf(x, lv.id).rooms.push({ id, name: tr(`Room ${n}`), wallIds: loop.wallIds, polygon: loop.polygon, area }), `Room ${n}: ${fmt(area)} m².`);
  ed.roomSel = { level: lv.id, room: id };
  ed.iwallSel = null;
  ed.emit();
}

export function beginIwallHandle(ed: Editor3, h: Handle, e: PointerEvent): void {
  const b = ed.store.building(ed.context) ?? ed.activeBuilding();
  const iw = h.iwall!;
  if (!b) return;
  if (iw.wall) {
    if (!e.altKey) {
      // A click on a wall's dot selects it: its panel (thickness, length, doors).
      ed.iwallSel = { level: iw.level, wall: iw.wall };
      ed.roomSel = null;
      ed.emit();
      return;
    }
    ed.change(b.id, (x) => {
      const it = x.interiors[iw.level] as InteriorWithDoors | undefined;
      if (!it) return;
      it.walls = it.walls.filter((w) => w.id !== iw.wall);
      if (it.doors) it.doors = it.doors.filter((d) => d.wall !== iw.wall);
      // Corners no wall uses any more go too.
      const used = new Set(it.walls.flatMap((w) => [w.a, w.b]));
      it.nodes = it.nodes.filter((n) => used.has(n.id));
    }, 'Interior wall deleted.');
    return;
  }
  ed.startDrag('iwallnode', b, e, { handle: 'vertex', level: iw.level, node: iw.node }, true);
}

/** The level plane point (building frame) under the pointer, for the interior tools. */
export function levelPoint(ed: Editor3, e: { clientX: number; clientY: number }): { b: Building3; lv: { id: ID; elevation: number; height: number }; p: Vec2 } | null {
  // The building under the pointer (on its floor shown), not the one last edited.
  const b = ed.buildingUnderWall(e);
  if (!b) return null;
  const lv = ed.workLevel(b);
  if (!lv) return null;
  const w = ed.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
  if (!w) return null;
  let p = toLocal(b, [w.x, w.z]);
  if (ed.infer.enabled) p = [Math.round(p[0] / ed.infer.grid) * ed.infer.grid, Math.round(p[1] / ed.infer.grid) * ed.infer.grid];
  return { b, lv, p };
}
