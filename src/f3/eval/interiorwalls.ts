// Interior walls of a building (the plan drawn per level in `Building3.interiors`):
// one prism per wall, from the level floor to just under the slab above, built by
// hand so no boolean is needed. A door is a notch in the wall's own profile — the
// parts before the opening, above it and after it are one closed polygon, because
// two prisms that only touch are not a valid Manifold input and joining them would
// take the very boolean this avoids. Pure (no three); runs in a worker or in Node.
import type { Building3, ID, Interior, Vec2 } from '../model/schema';
import type { FaceTable } from './faces';
import { heightPrism, MeshBuilder, prismMesh } from './mesh';
import { offsetRing, ringValid, sampleRing, signedArea2 } from '../model/plan';
import { enclosureAt, type JoinWall } from '../model/walljoins';

/** The drawn walls (Walls tool) standing on a floor of a building, as lines with half their thickness. */
export function drawnWallsOn(b: Building3, elevation: number): JoinWall[] {
  return b.solids.flatMap((s) =>
    s.wallAxis && !s.hidden && s.base <= elevation + 0.1 && s.base + s.height > elevation + 0.5 ? [{ id: s.id, a: s.wallAxis[0], b: s.wallAxis[1], half: (s.wallThickness ?? 0.2) / 2 }] : [],
  );
}

/** The room the drawn walls of a floor close around a point (model/walljoins.ts enclosureAt). */
export function drawnWallRoomAt(b: Building3, elevation: number, at: Vec2): { polygon: Vec2[]; wallIds: ID[] } | null {
  const ws = drawnWallsOn(b, elevation);
  return ws.length >= 3 ? enclosureAt(ws, at) : null;
}

/** Slab thickness (m): the wall stops under the slab of the level above (eval/interior.ts). */
const SLAB = 0.25;
/** Shortest wall worth building (m). */
const MIN_WALL = 0.05;
/** Two nodes closer than this are the same node (m). */
const SNAP = 0.05;
/** Least material kept above a door (m). */
const MIN_LINTEL = 0.05;

/**
 * Door in an interior wall. An `Item` hosted on a face cannot address a wall drawn from
 * `Building3.interiors` (nothing of the body is there yet), so an opening is part of the
 * wall's own plan instead.
 */
export interface InteriorDoor {
  /** Wall the opening belongs to. */
  wall: ID;
  /** Distance from node `a` of the wall to the center of the opening (m). */
  u: number;
  width: number;
  height: number;
  /** Side the leaf opens to: 1 (absent) toward the wall's left normal (−u.z, u.x) going from `a` to `b`, −1 the other. */
  swing?: 1 | -1;
  /** false: a passage (the opening with no door leaf). */
  leaf?: false;
  /** How far the leaf stands open (degrees, 0 closed): opened in walk mode. */
  open?: number;
}

/** `Interior` with the doors of its walls (the document schema does not type them yet). */
export type InteriorWithDoors = Interior & { doors?: InteriorDoor[] };

/** Doors of an interior (empty when it has none). */
export function interiorDoors(it: Interior): InteriorDoor[] {
  return (it as InteriorWithDoors).doors ?? [];
}

/** Interior of a level, made empty when the level has none. */
export function interiorOf(b: Building3, levelId: ID): Interior {
  return (b.interiors[levelId] ??= { nodes: [], walls: [], rooms: [] });
}

/** Node at a plan point, reusing one already within `SNAP` (so corners share it). */
function nodeAt(it: Interior, p: Vec2, uid: () => string): ID {
  for (const n of it.nodes) if (Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) <= SNAP) return n.id;
  const id = uid();
  it.nodes.push({ id, p: [p[0], p[1]] });
  return id;
}

/** An end this close to a wall lands on it (a T): the wall is split there (m). */
const ON_WALL = 0.15;

/**
 * Splits wall `wid` at plan point `p` (on it): the first part keeps the id, the second is new, and the
 * doors go to the part they stand on. Returns the node at `p`.
 */
function splitWall(it: Interior, wid: ID, p: Vec2, uid: () => string): ID {
  const w = it.walls.find((x) => x.id === wid)!;
  const node = new Map(it.nodes.map((n) => [n.id, n.p]));
  const a = node.get(w.a)!;
  const t = Math.hypot(p[0] - a[0], p[1] - a[1]);
  const mid = nodeAt(it, p, uid);
  if (mid === w.a || mid === w.b) return mid;
  const nid = uid();
  const end = w.b;
  w.b = mid;
  it.walls.push({ id: nid, a: mid, b: end, thickness: w.thickness });
  const doors = (it as InteriorWithDoors).doors;
  if (doors) for (const d of doors) if (d.wall === wid && d.u > t) Object.assign(d, { wall: nid, u: d.u - t });
  return mid;
}

/** Where segment p–q crosses segment a–c, strictly inside both (as the fraction along p–q), or null. */
function crossing(p: Vec2, q: Vec2, a: Vec2, c: Vec2): number | null {
  const rx = q[0] - p[0],
    rz = q[1] - p[1],
    sx = c[0] - a[0],
    sz = c[1] - a[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den;
  const u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / den;
  const lp = Math.hypot(rx, rz),
    la = Math.hypot(sx, sz);
  return t * lp > SNAP && (1 - t) * lp > SNAP && u * la > SNAP && (1 - u) * la > SNAP ? t : null;
}

/** The wall whose middle passes within ON_WALL of `p` (not near its ends), with the point on it. */
function wallUnder(it: Interior, p: Vec2): { id: ID; at: Vec2 } | null {
  const node = new Map(it.nodes.map((n) => [n.id, n.p]));
  let best: { id: ID; at: Vec2; d: number } | null = null;
  for (const w of it.walls) {
    const a = node.get(w.a),
      c = node.get(w.b);
    if (!a || !c) continue;
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < MIN_WALL) continue;
    const u = ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / len;
    if (u <= SNAP || u >= len - SNAP) continue;
    const at: Vec2 = [a[0] + ((c[0] - a[0]) * u) / len, a[1] + ((c[1] - a[1]) * u) / len];
    const d = Math.hypot(at[0] - p[0], at[1] - p[1]);
    if (d <= ON_WALL && (!best || d < best.d)) best = { id: w.id, at, d };
  }
  return best;
}

/**
 * Adds a wall between two plan points and keeps the walls a connected plan (what makes a room a closed
 * loop of walls, ArchiCAD-like): an end on the middle of a wall splits it there (a T), the walls the new
 * one crosses are split at the crossing (an X), and the new wall is split at every node it passes over.
 * Nodes already within `SNAP` are reused. Returns the id of the first piece of the new wall.
 */
export function addInteriorWall(b: Building3, levelId: ID, a: Vec2, c: Vec2, thickness = 0.12, uid: () => string): ID {
  const it = interiorOf(b, levelId);
  const ends: Vec2[] = [a, c].map((p) => {
    if (it.nodes.some((n) => Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) <= SNAP)) return p;
    const on = wallUnder(it, p);
    if (!on) return p;
    splitWall(it, on.id, on.at, uid);
    return on.at;
  });
  const [p, q] = ends as [Vec2, Vec2];
  // Crossings with the walls there now (each split once, at its crossing).
  const node = () => new Map(it.nodes.map((n) => [n.id, n.p]));
  const stops: { t: number; p: Vec2 }[] = [];
  for (const w of [...it.walls]) {
    const nm = node();
    const wa = nm.get(w.a),
      wc = nm.get(w.b);
    if (!wa || !wc) continue;
    const t = crossing(p, q, wa, wc);
    if (t === null) continue;
    const x: Vec2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    splitWall(it, w.id, x, uid);
    stops.push({ t, p: x });
  }
  // Nodes lying on the new wall.
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (len >= MIN_WALL)
    for (const n of it.nodes) {
      const t = ((n.p[0] - p[0]) * (q[0] - p[0]) + (n.p[1] - p[1]) * (q[1] - p[1])) / (len * len);
      if (t * len <= SNAP || (1 - t) * len <= SNAP) continue;
      const d = Math.hypot(p[0] + (q[0] - p[0]) * t - n.p[0], p[1] + (q[1] - p[1]) * t - n.p[1]);
      if (d <= SNAP) stops.push({ t, p: n.p });
    }
  stops.sort((x, y) => x.t - y.t);
  const pts = [p, ...stops.map((s) => s.p), q];
  let first: ID | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const na = nodeAt(it, pts[i]!, uid),
      nb = nodeAt(it, pts[i + 1]!, uid);
    if (na === nb || it.walls.some((w) => (w.a === na && w.b === nb) || (w.a === nb && w.b === na))) continue;
    const id = uid();
    it.walls.push({ id, a: na, b: nb, thickness });
    first ??= id;
  }
  return first ?? '';
}

/**
 * Extends an interior wall from one of its ends (Revit's and AutoCAD's Extend): along its line to the
 * nearest wall it meets, or to the inner face of the building's walls, at most 30 m. The wall is drawn
 * again from its other end (so the wall it reaches is split there and the rooms close), its doors kept
 * where they were. Returns false when nothing is in the way.
 */
export function extendInteriorWall(b: Building3, levelId: ID, wallId: ID, end: 'a' | 'b', boundary: Vec2[][], uid: () => string): boolean {
  const it = b.interiors[levelId] as InteriorWithDoors | undefined;
  const w = it?.walls.find((x) => x.id === wallId);
  if (!it || !w) return false;
  const node = new Map(it.nodes.map((n) => [n.id, n.p]));
  const E = node.get(end === 'a' ? w.a : w.b),
    O = node.get(end === 'a' ? w.b : w.a);
  if (!E || !O) return false;
  const L = Math.hypot(E[0] - O[0], E[1] - O[1]);
  if (L < 1e-6) return false;
  const d: Vec2 = [(E[0] - O[0]) / L, (E[1] - O[1]) / L];
  // The nearest hit ahead of the end: another wall's axis or a side of the boundary.
  let best = 30;
  const hit = (p: Vec2, q: Vec2) => {
    const ex = q[0] - p[0],
      ez = q[1] - p[1];
    const den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-9) return;
    const s = ((p[0] - E[0]) * ez - (p[1] - E[1]) * ex) / den;
    const r = ((p[0] - E[0]) * d[1] - (p[1] - E[1]) * d[0]) / den;
    if (s > 0.02 && s < best && r >= -1e-6 && r <= 1 + 1e-6) best = s;
  };
  const endNode = end === 'a' ? w.a : w.b;
  for (const o of it.walls) {
    if (o.id === w.id || o.a === endNode || o.b === endNode) continue;
    const p = node.get(o.a),
      q = node.get(o.b);
    if (p && q) hit(p, q);
  }
  for (const r of boundary) for (let i = 0; i < r.length; i++) hit(r[i]!, r[(i + 1) % r.length]!);
  if (best >= 30) return false;
  const to: Vec2 = [E[0] + d[0] * best, E[1] + d[1] * best];
  // The doors on it, by where they are (they go back on the wall found there after the redraw).
  const doors = interiorDoors(it).filter((x) => x.wall === w.id);
  const keep = interiorDoors(it).filter((x) => x.wall !== w.id);
  const nodeA = node.get(w.a)!;
  const dirAB: Vec2 = end === 'b' ? d : [-d[0], -d[1]];
  const at = doors.map((x) => ({ door: x, p: [nodeA[0] + dirAB[0] * x.u, nodeA[1] + dirAB[1] * x.u] as Vec2 }));
  it.walls = it.walls.filter((x) => x.id !== w.id);
  // The end node goes when no other wall uses it.
  if (!it.walls.some((x) => x.a === endNode || x.b === endNode)) it.nodes = it.nodes.filter((n) => n.id !== endNode);
  it.doors = keep;
  const before = new Set(it.walls.map((x) => x.id));
  addInteriorWall(b, levelId, O, to, w.thickness, uid);
  const added = it.walls.filter((x) => !before.has(x.id));
  const nm = new Map(it.nodes.map((n) => [n.id, n.p]));
  for (const { door, p } of at)
    for (const nw of added) {
      const a = nm.get(nw.a)!,
        c = nm.get(nw.b)!;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u = ((p[0] - a[0]) * (c[0] - a[0]) + (p[1] - a[1]) * (c[1] - a[1])) / (len || 1);
      const off = Math.abs((p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0])) / (len || 1);
      if (u >= 0 && u <= len && off < 0.01) {
        // The new wall may run the other way: the swing side follows.
        const same = (c[0] - a[0]) * dirAB[0] + (c[1] - a[1]) * dirAB[1] > 0;
        it.doors.push({ ...door, wall: nw.id, u, ...(same ? {} : { swing: door.swing === -1 ? 1 : -1 }) });
        break;
      }
    }
  return true;
}

/**
 * Curves an interior wall: an arc through its two ends that bulges `sagitta` m from the middle of the
 * straight wall (positive to the left going from `a` to `b`), made of short straight pieces (one every
 * 30 cm or so, 6 to 24), so rooms, plans and exports take it as they take any wall. Its doors go (they
 * were set on a straight wall). Returns the ids of the pieces.
 */
export function curveInteriorWall(b: Building3, levelId: ID, wallId: ID, sagitta: number, uid: () => string): ID[] {
  const it = b.interiors[levelId] as InteriorWithDoors | undefined;
  const w = it?.walls.find((x) => x.id === wallId);
  if (!it || !w || Math.abs(sagitta) < 0.01) return [];
  const node = new Map(it.nodes.map((n) => [n.id, n.p]));
  const A = node.get(w.a),
    B = node.get(w.b);
  if (!A || !B) return [];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const s = Math.max(-L / 2 + 0.01, Math.min(L / 2 - 0.01, sagitta));
  // The circle through A, B and the bulge point: radius from the chord and the sagitta.
  const r = (L * L) / (8 * Math.abs(s)) + Math.abs(s) / 2;
  const ux = (B[0] - A[0]) / L,
    uz = (B[1] - A[1]) / L;
  const nx = -uz * Math.sign(s),
    nz = ux * Math.sign(s);
  const mx = (A[0] + B[0]) / 2,
    mz = (A[1] + B[1]) / 2;
  const cx = mx - nx * (r - Math.abs(s)),
    cz = mz - nz * (r - Math.abs(s));
  const a0 = Math.atan2(A[1] - cz, A[0] - cx),
    a1 = Math.atan2(B[1] - cz, B[0] - cx);
  // The arc on the bulge's side (the short way round when the sagitta is under half the chord).
  let da = a1 - a0;
  const mid = Math.atan2(mz + nz * Math.abs(s) - cz, mx + nx * Math.abs(s) - cx);
  const between = (x: number) => {
    let t = x - a0;
    while (t < 0) t += 2 * Math.PI;
    let e = da;
    while (e < 0) e += 2 * Math.PI;
    return t <= e;
  };
  if (da < 0) da += 2 * Math.PI;
  if (!between(mid)) da -= 2 * Math.PI;
  const n = Math.max(6, Math.min(24, Math.round((Math.abs(da) * r) / 0.3)));
  it.walls = it.walls.filter((x) => x.id !== w.id);
  if (it.doors) it.doors = it.doors.filter((d) => d.wall !== w.id);
  const ids: ID[] = [];
  let prev = w.a;
  for (let i = 1; i <= n; i++) {
    let cur: ID;
    if (i === n) cur = w.b;
    else {
      cur = uid();
      const t = a0 + (da * i) / n;
      it.nodes.push({ id: cur, p: [Math.round((cx + r * Math.cos(t)) * 1e4) / 1e4, Math.round((cz + r * Math.sin(t)) * 1e4) / 1e4] });
    }
    const id = uid();
    it.walls.push({ id, a: prev, b: cur, thickness: w.thickness });
    ids.push(id);
    prev = cur;
  }
  return ids;
}

/** Copies the interior of a level (nodes, walls, rooms and doors) to other levels, all with new ids. */
export function replicateLevel(b: Building3, fromLevel: ID, toLevels: ID[], uid: () => string): void {
  const src = b.interiors[fromLevel];
  if (!src) return;
  const doors = interiorDoors(src);
  for (const to of toLevels) {
    if (to === fromLevel) continue;
    const nodes = src.nodes.map((n) => ({ id: uid(), p: [n.p[0], n.p[1]] as Vec2 }));
    const nodeOf = new Map(src.nodes.map((n, i) => [n.id, nodes[i]!.id]));
    const walls = src.walls.map((w) => {
      const nw: Interior['walls'][number] = { id: uid(), a: nodeOf.get(w.a) ?? w.a, b: nodeOf.get(w.b) ?? w.b, thickness: w.thickness };
      // `splitFrom` may name a node the copy does not have: it is dropped rather than left dangling.
      const split = w.splitFrom ? nodeOf.get(w.splitFrom) : undefined;
      if (split) nw.splitFrom = split;
      return nw;
    });
    const wallOf = new Map(src.walls.map((w, i) => [w.id, walls[i]!.id]));
    const it: InteriorWithDoors = {
      nodes,
      walls,
      rooms: src.rooms.map((r) => ({
        ...r,
        id: uid(),
        wallIds: r.wallIds.map((x) => wallOf.get(x) ?? x),
        ...(r.polygon ? { polygon: r.polygon.map((p) => [p[0], p[1]] as Vec2) } : {}),
      })),
    };
    if (doors.length) it.doors = doors.map((d) => ({ ...d, wall: wallOf.get(d.wall) ?? d.wall }));
    b.interiors[to] = it;
  }
}

/**
 * Profile of a wall in its own section (along, height) with the door openings notched out
 * of the foot. The parts before a door, above it and after it are one polygon: separate
 * prisms that only touch share their vertices and stop being a closed mesh.
 */
function wallOutline(len: number, thickness: number, height: number, doors: InteriorDoor[]): Vec2[] | null {
  // The wall runs half a thickness past both nodes, so the corners of a pair meeting there close.
  const W = len + thickness;
  const x0 = thickness / 2;
  const notches: { a: number; b: number; h: number }[] = [];
  let end = 0;
  for (const d of [...doors].sort((p, q) => p.u - q.u)) {
    const a = Math.max(0, Math.min(W, d.u - d.width / 2 + x0));
    const b = Math.max(0, Math.min(W, d.u + d.width / 2 + x0));
    const h = Math.min(height - MIN_LINTEL, d.height);
    // An opening that has no room left, or that overlaps the one before it, is dropped.
    if (b - a < 0.01 || h < 0.01 || a < end - 1e-6) continue;
    notches.push({ a, b, h });
    end = b;
  }
  if (W - notches.reduce((s, n) => s + (n.b - n.a), 0) < MIN_WALL) return null;
  const out: Vec2[] = [[0, 0]];
  for (const n of notches) out.push([n.a, 0], [n.a, n.h], [n.b, n.h], [n.b, 0]);
  out.push([W, 0], [W, height], [0, height]);
  // Consecutive duplicates (an opening reaching an end of the wall) would leave degenerate triangles.
  const pts: Vec2[] = [];
  for (const p of out) {
    const q = pts[pts.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) continue;
    pts.push(p);
  }
  while (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** One wall between plan points `a` and `c`, from `y0` up `height`, with its doors as notches. */
function wallPrism(mb: MeshBuilder, a: Vec2, c: Vec2, thickness: number, y0: number, height: number, face: number, doors: InteriorDoor[]): void {
  const dx = c[0] - a[0],
    dz = c[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < MIN_WALL || height < MIN_WALL) return;
  const ux = dx / len,
    uz = dz / len;
  // Across the wall, in plan.
  const px = -uz,
    pz = ux;
  const prof = wallOutline(len, thickness, height, doors);
  if (!prof) return;
  const h = thickness / 2;
  // Local x: along the wall (node a at x = thickness/2), y: up from the floor, z: across it.
  const m = [ux, 0, uz, 0, 0, 1, 0, 0, px, 0, pz, 0, a[0] - ux * h, y0, a[1] - uz * h, 1];
  prismMesh(mb, prof, -h, h, m, face);
}

/**
 * Interior walls of every level as one mesh, or null when the building has none. `hidden`
 * drops a level (a floor switched off in the view). The room floors lie on the slab, or on the
 * bottom of a hollow volume (shell) standing on that level: its own thickness, not a slab's.
 */
export function interiorWallMeshes(b: Building3, table: FaceTable, opts: { hidden?: (levelId: ID) => boolean } = {}): MeshBuilder | null {
  const mb = new MeshBuilder();
  for (const level of [...b.levels].sort((p, q) => p.elevation - q.elevation)) {
    if (opts.hidden?.(level.id)) continue;
    const it = b.interiors[level.id];
    if (!it || (!it.walls.length && !it.rooms.length)) continue;
    // Room floors with a finish: a 1 cm plate on the slab, one face per room (its material, render/shell.ts).
    for (const r of it.rooms) {
      if (!r.polygon || r.polygon.length < 3) continue;
      const ring = area2(r.polygon) > 0 ? r.polygon : [...r.polygon].reverse();
      const y0 = floorTop(b, level.elevation);
      if (r.finish) {
        const rf = table.add({ kind: 'floor', solid: `room:${level.id}:${r.id}` });
        heightPrism(mb, ring, [], [], () => y0 + 0.01, y0, { top: () => rf, bottom: rf, side: () => rf });
      }
      // A room with its own ceiling height: a lowered ceiling (2 cm board) at that height, under the slab.
      const top = level.elevation + level.height - SLAB;
      if (r.ceiling !== undefined && y0 + r.ceiling < top - 0.05) {
        const cf = table.add({ kind: 'ceiling', solid: `room:${level.id}:${r.id}` });
        const yc = y0 + r.ceiling;
        heightPrism(mb, ring, [], [], () => yc + 0.02, yc, { top: () => cf, bottom: cf, side: () => cf });
      }
    }
    if (!it.walls.length) continue;
    const doors = interiorDoors(it);
    // One face for the whole level: the walls of a floor share a finish and hide together.
    const face = table.add({ kind: 'innerWall', solid: `interior:${level.id}` });
    const node = new Map(it.nodes.map((n) => [n.id, n]));
    const height = level.height - SLAB;
    for (const w of it.walls) {
      const a = node.get(w.a),
        c = node.get(w.b);
      if (!a || !c) continue;
      wallPrism(mb, a.p, c.p, w.thickness, level.elevation, height, face, doors.filter((d) => d.wall === w.id));
    }
  }
  return mb.empty ? null : mb;
}

/** Top of the floor of a level: the bottom of a hollow volume based there, else the slab. */
function floorTop(b: Building3, elevation: number): number {
  for (const s of b.solids) if (s.op === 'add' && !s.hidden && (s.shell ?? 0) > 0 && Math.abs(s.base - elevation) < 0.01) return s.base + s.shell!;
  return elevation + SLAB;
}

/** Signed area of a plan ring (positive counterclockwise, in the plan's own sense). */
function area2(r: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!,
      c = r[(i + 1) % r.length]!;
    s += a[0] * c[1] - c[0] * a[1];
  }
  return s / 2;
}

function inside(p: Vec2, r: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i]![1] > p[1] !== r[j]![1] > p[1] && p[0] < ((r[j]![0] - r[i]![0]) * (p[1] - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) c = !c;
  return c;
}

/**
 * The room a point is in, found from the walls of the level (ArchiCAD's zone by clicking inside): the
 * smallest closed loop of walls around the point, by walking the planar graph (at each node, the next
 * wall turning most to one side), or null when the walls do not close around it.
 */
export function loopAround(it0: Interior, at: Vec2, boundary: Vec2[][] = []): { polygon: Vec2[]; wallIds: ID[] } | null {
  // The building's inner faces count as walls too: each boundary ring is split where an interior wall
  // ends on it (or within 0.6 m of it, a grid step: a short link joins the end to the face).
  // Interior wall ends just outside a face (drawn to the outer face, or snapped past it) are moved onto it.
  const nodes = it0.nodes.map((n) => ({ ...n, p: [n.p[0], n.p[1]] as Vec2 }));
  for (const ring of boundary) {
    for (const n of nodes) {
      if (inside(n.p, ring)) continue;
      let best: Vec2 | null = null,
        bd = 0.6;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!,
          c = ring[(i + 1) % ring.length]!;
        const L2 = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((n.p[0] - a[0]) * (c[0] - a[0]) + (n.p[1] - a[1]) * (c[1] - a[1])) / L2));
        const q: Vec2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
        const dd = Math.hypot(q[0] - n.p[0], q[1] - n.p[1]);
        if (dd < bd) {
          bd = dd;
          best = q;
        }
      }
      if (best) n.p = best;
    }
  }
  const it: Interior = { nodes, walls: [...it0.walls], rooms: [] };
  let k = 0;
  const same = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-4;
  for (const ring of boundary) {
    // Corner ids: an interior node sitting on the corner stands for it.
    const cornerId = ring.map((q) => nodes.find((n) => same(n.p, q))?.id ?? (it.nodes.push({ id: `~b${k}`, p: q }), `~b${k++}`));
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!,
        c = ring[(i + 1) % ring.length]!;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      // Interior wall ends on or near this side, by their distance along it.
      const on: { t: number; p: Vec2; node: ID; link: boolean }[] = [];
      for (const n of nodes) {
        const t = ((n.p[0] - a[0]) * (c[0] - a[0]) + (n.p[1] - a[1]) * (c[1] - a[1])) / (L * L);
        if (t <= 0.0001 || t >= 0.9999) continue;
        const q: Vec2 = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
        const dd = Math.hypot(q[0] - n.p[0], q[1] - n.p[1]);
        if (dd < 0.6) on.push({ t, p: q, node: n.id, link: dd > 1e-4 });
      }
      on.sort((x, y) => x.t - y.t);
      let prev = cornerId[i]!;
      for (const o of on) {
        let pid = o.node;
        if (o.link) {
          pid = `~b${k++}`;
          it.nodes.push({ id: pid, p: o.p });
          it.walls.push({ id: `~l${k++}`, a: pid, b: o.node, thickness: 0 });
        }
        if (pid !== prev) it.walls.push({ id: `~e${k++}`, a: prev, b: pid, thickness: 0 });
        prev = pid;
      }
      const next = cornerId[(i + 1) % ring.length]!;
      if (prev !== next) it.walls.push({ id: `~e${k++}`, a: prev, b: next, thickness: 0 });
    }
  }
  const pos = new Map(it.nodes.map((n) => [n.id, n.p]));
  const adj = new Map<ID, { to: ID; wall: ID; ang: number }[]>();
  for (const w of it.walls) {
    const a = pos.get(w.a),
      c = pos.get(w.b);
    if (!a || !c || w.a === w.b) continue;
    (adj.get(w.a) ?? adj.set(w.a, []).get(w.a)!).push({ to: w.b, wall: w.id, ang: Math.atan2(c[1] - a[1], c[0] - a[0]) });
    (adj.get(w.b) ?? adj.set(w.b, []).get(w.b)!).push({ to: w.a, wall: w.id, ang: Math.atan2(a[1] - c[1], a[0] - c[0]) });
  }
  for (const l of adj.values()) l.sort((p, q) => p.ang - q.ang);
  const seen = new Set<string>();
  let best: { polygon: Vec2[]; wallIds: ID[]; area: number } | null = null;
  for (const [from, list] of adj)
    for (const e0 of list) {
      const key0 = `${from}>${e0.to}`;
      if (seen.has(key0)) continue;
      // Walk one face: arrive at a node, leave by the edge just before the reverse one (turning left).
      const poly: Vec2[] = [];
      const walls: ID[] = [];
      let u = from,
        e = e0,
        ok = false;
      for (let step = 0; step < 400; step++) {
        seen.add(`${u}>${e.to}`);
        poly.push(pos.get(u)!);
        walls.push(e.wall);
        const v = e.to;
        const out = adj.get(v)!;
        const back = out.findIndex((q) => q.to === u && q.wall === e.wall);
        const next = out[(back - 1 + out.length) % out.length]!;
        u = v;
        e = next;
        if (u === from && e.to === e0.to && e.wall === e0.wall) {
          ok = true;
          break;
        }
      }
      if (!ok || poly.length < 3) continue;
      const A = area2(poly);
      if (A <= 1e-6 || !inside(at, poly)) continue;
      if (!best || A < best.area) best = { polygon: poly.map((q) => [q[0], q[1]] as Vec2), wallIds: [...new Set(walls)].filter((w) => !w.startsWith('~')), area: A };
    }
  return best ? { polygon: best.polygon, wallIds: best.wallIds } : null;
}

/** Plan area of a room polygon (m²). */
export function roomArea(poly: Vec2[]): number {
  return Math.abs(area2(poly));
}

/** Four walls around a rectangle (opposite corners a, c) and the room they close; returns the room id. */
export function addRoomRect(b: Building3, levelId: ID, a: Vec2, c: Vec2, thickness: number, name: string, uid: () => string): ID {
  const p: Vec2[] = [[a[0], a[1]], [c[0], a[1]], [c[0], c[1]], [a[0], c[1]]];
  const ids = p.map((q, i) => addInteriorWall(b, levelId, q, p[(i + 1) % 4]!, thickness, uid));
  const it = b.interiors[levelId]!;
  const poly = area2(p) > 0 ? p : [...p].reverse();
  const id = uid();
  it.rooms.push({ id, name, wallIds: ids, polygon: poly, area: Math.round(roomArea(poly) * 100) / 100 });
  return id;
}

/**
 * Where each door of the interior walls stands, for its leaf and frame (the door family is built there
 * like a door on a facade): origin on the face of the wall it opens to, at the floor, u along the wall,
 * v up, n out of that face; `depth` is the wall thickness.
 */
export function interiorDoorFrames(b: Building3): { key: string; o: [number, number, number]; u: [number, number, number]; n: [number, number, number]; width: number; height: number; depth: number; open: number }[] {
  const out: ReturnType<typeof interiorDoorFrames> = [];
  for (const level of b.levels) {
    const it = b.interiors[level.id];
    if (!it) continue;
    const node = new Map(it.nodes.map((n) => [n.id, n.p]));
    interiorDoors(it).forEach((d, i) => {
      if (d.leaf === false) return;
      const w = it.walls.find((x) => x.id === d.wall);
      const a = w && node.get(w.a),
        c = w && node.get(w.b);
      if (!w || !a || !c) return;
      const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (L < 1e-6) return;
      const ux = (c[0] - a[0]) / L,
        uz = (c[1] - a[1]) / L;
      const side = d.swing ?? 1;
      const nx = -uz * side,
        nz = ux * side;
      // Seen from the face it opens to, "along" runs left to right: flip it on the other side.
      const sx = side > 0 ? ux : -ux,
        sz = side > 0 ? uz : -uz;
      const cx = a[0] + ux * d.u + nx * (w.thickness / 2),
        cz = a[1] + uz * d.u + nz * (w.thickness / 2);
      out.push({ key: `idoor:${level.id}:${i}`, o: [cx, level.elevation, cz], u: [sx, 0, sz], n: [nx, 0, nz], width: d.width, height: d.height, depth: w.thickness, open: d.open ?? 0 });
    });
  }
  return out;
}

/** Floor to ceiling of a room (m): its own height, else from its floor up to under the slab above. */
export function roomCeiling(b: Building3, levelId: ID, room: { ceiling?: number }): number {
  const lv = b.levels.find((l) => l.id === levelId);
  if (!lv) return room.ceiling ?? 2.6;
  const free = lv.elevation + lv.height - SLAB - floorTop(b, lv.elevation);
  return Math.round(Math.min(free, room.ceiling ?? free) * 100) / 100;
}

/**
 * Rooms follow their walls (Revit's room-bounding walls): after any edit each room is found again from a
 * point inside its last outline, with the walls and the building's inner faces as they are now. A room
 * whose walls no longer close keeps its outline (it is not lost; it shows again once they close).
 */
export function refreshRooms(b: Building3): void {
  for (const lv of b.levels) {
    const it = b.interiors[lv.id];
    if (!it?.rooms.length) continue;
    const inner = b.solids
      .filter((s) => s.op === 'add' && !s.hidden && s.base <= lv.elevation + 0.1 && s.base + s.height > lv.elevation + 0.5)
      .map((s) => {
        const ring = sampleRing(s.plan.outer).pts as Vec2[];
        const ccw = signedArea2(ring) > 0 ? ring : [...ring].reverse();
        const r = offsetRing(ccw, ccw.map(() => s.shell ?? 0.3));
        return ringValid(r, 1) ? r : ccw;
      });
    for (const room of it.rooms) {
      const poly = room.polygon;
      if (!poly || poly.length < 3) continue;
      const at = interiorPointOf(poly);
      if (!at) continue;
      // A room closed by drawn walls is found again from them.
      const drawn = room.wallIds.some((id) => b.solids.some((s) => s.id === id && s.wallAxis));
      const loop = drawn ? drawnWallRoomAt(b, lv.elevation, at) : loopAround(it, at, inner);
      if (!loop) continue;
      const area = Math.round(roomArea(loop.polygon) * 100) / 100;
      if (room.area === area && sameRing(room.polygon!, loop.polygon)) continue;
      room.polygon = loop.polygon;
      room.wallIds = loop.wallIds;
      room.area = area;
    }
  }
}

/** A point well inside a polygon: the centroid, else the middle of its widest horizontal chord. */
function interiorPointOf(poly: Vec2[]): Vec2 | null {
  const c: Vec2 = [poly.reduce((a, p) => a + p[0], 0) / poly.length, poly.reduce((a, p) => a + p[1], 0) / poly.length];
  if (inside(c, poly)) return c;
  const zs = poly.map((p) => p[1]);
  const z0 = Math.min(...zs),
    z1 = Math.max(...zs);
  for (let k = 1; k < 8; k++) {
    const z = z0 + ((z1 - z0) * k) / 8;
    const xs: number[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      if ((p[1] - z) * (q[1] - z) < 0) xs.push(p[0] + ((z - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
    });
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const m: Vec2 = [(xs[i]! + xs[i + 1]!) / 2, z];
      if (inside(m, poly)) return m;
    }
  }
  return null;
}

const sameRing = (a: Vec2[], b: Vec2[]) => a.length === b.length && a.every((p, i) => Math.hypot(p[0] - b[i]![0], p[1] - b[i]![1]) < 1e-4);

/** Perimeter of a room outline (m). */
export function roomPerimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += Math.hypot(poly[(i + 1) % poly.length]![0] - poly[i]![0], poly[(i + 1) % poly.length]![1] - poly[i]![1]);
  return s;
}
