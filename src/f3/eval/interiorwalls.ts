// Interior walls of a building (the plan drawn per level in `Building3.interiors`):
// one prism per wall, from the level floor to just under the slab above, built by
// hand so no boolean is needed. A door is a notch in the wall's own profile — the
// parts before the opening, above it and after it are one closed polygon, because
// two prisms that only touch are not a valid Manifold input and joining them would
// take the very boolean this avoids. Pure (no three); runs in a worker or in Node.
import type { Building3, ID, Interior, Vec2 } from '../model/schema';
import type { FaceTable } from './faces';
import { heightPrism, MeshBuilder, prismMesh } from './mesh';

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
}

/** `Interior` with the doors of its walls (the document schema does not type them yet). */
export type InteriorWithDoors = Interior & { doors?: InteriorDoor[] };

/** Doors of an interior (empty when it has none). */
export function interiorDoors(it: Interior): InteriorDoor[] {
  return (it as InteriorWithDoors).doors ?? [];
}

/** Interior of a level, made empty when the level has none. */
function interiorOf(b: Building3, levelId: ID): Interior {
  return (b.interiors[levelId] ??= { nodes: [], walls: [], rooms: [] });
}

/** Node at a plan point, reusing one already within `SNAP` (so corners share it). */
function nodeAt(it: Interior, p: Vec2, uid: () => string): ID {
  for (const n of it.nodes) if (Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) <= SNAP) return n.id;
  const id = uid();
  it.nodes.push({ id, p: [p[0], p[1]] });
  return id;
}

/** Adds a wall between two plan points, reusing the nodes already there; returns the wall id. */
export function addInteriorWall(b: Building3, levelId: ID, a: Vec2, c: Vec2, thickness = 0.12, uid: () => string): ID {
  const it = interiorOf(b, levelId);
  const id = uid();
  it.walls.push({ id, a: nodeAt(it, a, uid), b: nodeAt(it, c, uid), thickness });
  return id;
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
 * drops a level (a floor switched off in the view).
 */
export function interiorWallMeshes(b: Building3, table: FaceTable, opts: { hidden?: (levelId: ID) => boolean } = {}): MeshBuilder | null {
  const mb = new MeshBuilder();
  for (const level of [...b.levels].sort((p, q) => p.elevation - q.elevation)) {
    if (opts.hidden?.(level.id)) continue;
    const it = b.interiors[level.id];
    if (!it || (!it.walls.length && !it.rooms.length)) continue;
    // Room floors with a finish: a 1 cm plate on the slab, one face per room (its material, render/shell.ts).
    for (const r of it.rooms) {
      if (!r.finish || !r.polygon || r.polygon.length < 3) continue;
      const rf = table.add({ kind: 'floor', solid: `room:${level.id}:${r.id}` });
      const ring = area2(r.polygon) > 0 ? r.polygon : [...r.polygon].reverse();
      const y0 = level.elevation + SLAB;
      heightPrism(mb, ring, [], [], () => y0 + 0.01, y0, { top: () => rf, bottom: rf, side: () => rf });
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
