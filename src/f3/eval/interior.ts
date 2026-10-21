// Hollow buildings for the interior view (Revit-style cutaway): every visible
// adding volume gets one void per floor, inset by the wall thickness, from the
// top of the slab to the underside of the next one; the last floor stops under
// the roof slab. Cutters (courtyards) keep their own wall around them. The voids
// carry their own faces (floor, ceiling, inner wall), so the view can hide the
// exterior walls, roofs, floors or ceilings without redoing the booleans. No three.
import type { Building3, Solid } from '../model/schema';
import { kernel, type Manifold, type Scope } from '../kernel/kernel';
import { solidRings } from './body';
import { ringsAt } from './parapet';
import { heightPrism, MeshBuilder } from './mesh';
import type { FaceKind, FaceTable } from './faces';
import type { InstPart, Parts3 } from './parts';
import type { BodyCategory } from '../model/layers';
import { slabOpeningFor } from '../model/stairs';
import { STAIR_OPENING } from './modifiers';
import { typeById } from '../families/index';

/** Which part of the body a face belongs to (null: always drawn, like the section cut). */
export function bodyCategory(kind: FaceKind): BodyCategory | null {
  switch (kind) {
    case 'side':
    case 'gable':
    case 'bevel':
    case 'band':
    case 'plinth':
    case 'parapet':
    case 'coping':
    case 'cutter':
    case 'reveal':
      return 'walls';
    case 'roof':
    case 'top':
    case 'glazing':
    case 'fascia':
    case 'soffit':
    case 'roofCut':
      return 'roofs';
    case 'floor':
    case 'bottom':
      return 'floors';
    case 'ceiling':
      return 'ceilings';
    case 'innerWall':
      return 'innerWalls';
    default:
      return null;
  }
}

/** Exterior wall thickness and slab thickness (m), shared with the rooms behind windows. */
export const WALL = 0.2;
export const SLAB = 0.25;
/** Lowest room worth hollowing (m). */
const MIN_ROOM = 1.8;


/**
 * A plan cross-section (x, z) extruded from `lo` to `hi` (Y up) by Manifold itself — always a valid
 * solid, even where a hole touches the outline — with our face IDs set by the triangle normals.
 */
function extrudeSection(k: ReturnType<typeof kernel>, cs: InstanceType<ReturnType<typeof kernel>['CrossSection']>, lo: number, hi: number, ids: { top: number; bottom: number; side: number }, keep: <X extends { delete(): void }>(x: X) => X): Manifold | null {
  if (cs.isEmpty() || hi - lo < 1e-4) return null;
  // (x, z) → mirror z → extrude along +Z → rotate −90° about X: (x, h, z); then lift to lo.
  const m = keep(keep(keep(cs.mirror([0, 1])).extrude(hi - lo)).rotate([-90, 0, 0]));
  const mesh = m.getMesh();
  const P = mesh.vertProperties,
    T = mesh.triVerts,
    np = mesh.numProp;
  const pos = new Float32Array((P.length / np) * 3);
  for (let i = 0, v = 0; i < P.length; i += np, v += 3) {
    pos[v] = P[i]!;
    pos[v + 1] = P[i + 1]! + lo;
    pos[v + 2] = P[i + 2]!;
  }
  const face = new Uint32Array(T.length / 3);
  for (let t = 0; t < face.length; t++) {
    const a = T[t * 3]! * 3,
      b = T[t * 3 + 1]! * 3,
      c = T[t * 3 + 2]! * 3;
    const ny = (pos[b + 2]! - pos[a + 2]!) * (pos[c]! - pos[a]!) - (pos[b]! - pos[a]!) * (pos[c + 2]! - pos[a + 2]!);
    const len = Math.hypot(
      (pos[b + 1]! - pos[a + 1]!) * (pos[c + 2]! - pos[a + 2]!) - (pos[b + 2]! - pos[a + 2]!) * (pos[c + 1]! - pos[a + 1]!),
      ny,
      (pos[b]! - pos[a]!) * (pos[c + 1]! - pos[a + 1]!) - (pos[b + 1]! - pos[a + 1]!) * (pos[c]! - pos[a]!),
    ) || 1;
    face[t] = ny / len > 0.5 ? ids.top : ny / len < -0.5 ? ids.bottom : ids.side;
  }
  const out = keep(k.Manifold.ofMesh(new k.Mesh({ numProp: 3, vertProperties: pos, triVerts: new Uint32Array(T), faceID: face })));
  return out.status() === 'NoError' && !out.isEmpty() ? out : null;
}

/** One void solid with every floor of every visible adding volume; null when nothing fits. */
export function floorVoids(b: Building3, hidden: (s: Solid) => boolean, table: FaceTable, scope: Scope): Manifold | null {
  const k = kernel();
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  const levels = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  // One manifold per room, then a union: overlapping volumes (a tower on a house) give overlapping
  // rooms, and one mesh with overlapping parts is not a valid boolean input.
  const rooms: Manifold[] = [];
  try {
    // Plan section of a volume at an absolute height, as a cross-section (holes included).
    const section = (s: Solid, y: number, grow: number) => {
      const r = solidRings(s);
      const rings = ringsAt(r, Math.max(0, Math.min(s.height, y - s.base))).map((ring) => ring.map((p) => [p[0], p[1]] as [number, number]));
      const cs = keep(new k.CrossSection(rings, 'EvenOdd'));
      return grow ? keep(cs.offset(grow, 'Miter', 2)) : cs;
    };
    const cutters = b.solids.filter((s) => s.op === 'subtract' && !s.id.includes(STAIR_OPENING));
    for (const s of b.solids) {
      if (s.op !== 'add' || hidden(s)) continue;
      const top = s.base + s.height;
      const ids = { floor: table.add({ kind: 'floor', solid: s.id }), ceil: table.add({ kind: 'ceiling', solid: s.id }), wall: table.add({ kind: 'innerWall', solid: s.id }) };
      for (let i = 0; i < levels.length; i++) {
        const e0 = levels[i]!.elevation,
          e1 = levels[i + 1]?.elevation ?? Infinity;
        if (e1 <= s.base + 0.05 || e0 >= top - 0.05) continue;
        const y0 = Math.max(e0, s.base) + SLAB;
        const y1 = Math.min(e1, top - SLAB);
        if (y1 - y0 < MIN_ROOM) continue;
        // The room fits the narrower of its floor and ceiling sections (tapered and leaning volumes).
        let cs = keep(section(s, y0, -WALL).intersect(section(s, y1, -WALL)));
        for (const c of cutters) {
          if (c.base >= y1 || c.base + c.height <= y0) continue;
          cs = keep(cs.subtract(keep(section(c, y0, WALL).add(section(c, y1, WALL)))));
        }
        const room = extrudeSection(k, cs, y0, y1, { top: ids.ceil, bottom: ids.floor, side: ids.wall }, (x) => scope.keep(x));
        if (room) rooms.push(room);
      }
    }
    // Slab openings: each stair opens the slab it climbs through, over its footprint (the stair tool and
    // "Stair up" make flights that end at a floor; the opening follows the flight wherever it moves).
    if (rooms.length) {
      const id = table.add({ kind: 'innerWall', solid: b.solids.find((s) => s.op === 'add')?.id ?? '' });
      for (const it of b.items) {
        if (it.host.kind !== 'free' || typeById(it.type)?.family !== 'stair') continue;
        const rise = typeof it.params.rise === 'number' ? it.params.rise : 3;
        const going = typeof it.params.going === 'number' ? it.params.going : 0.28;
        const top = it.host.p[1] + rise;
        // Only a flight that reaches a floor (within 15 cm) opens it.
        if (!levels.some((l) => Math.abs(l.elevation - top) < 0.15)) continue;
        const run = Math.max(1, Math.ceil(rise / 0.18 - 1e-9)) * going;
        const ring = slabOpeningFor(it, run).outer.map((q) => [q[0], q[1]] as [number, number]);
        const cs = keep(new k.CrossSection([ring], 'EvenOdd'));
        const hole = extrudeSection(k, cs, top - SLAB - 0.02, top + SLAB + 0.02, { top: id, bottom: id, side: id }, (x) => scope.keep(x));
        if (hole) rooms.push(hole);
      }
    }
  } finally {
    for (const x of temp) x.delete();
  }
  if (!rooms.length) return null;
  return rooms.length === 1 ? rooms[0]! : scope.keep(k.Manifold.union(rooms));
}

/** Unit primitives of the instanced parts as triangles (three.js BoxGeometry(1,1,1) and CylinderGeometry(0.5, 0.5, 1, n)). */
export function primitiveTris(shape: InstPart['shape']): number[] {
  const out: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => out.push(...a, ...b, ...c);
  if (shape === 'box') {
    const h = 0.5;
    for (const ax of [0, 1, 2])
      for (const s of [-1, 1]) {
        const u = (ax + 1) % 3,
          v = (ax + 2) % 3;
        const P = (a: number, b: number) => {
          const p = [0, 0, 0];
          p[ax] = s * h;
          p[u] = a * h;
          p[v] = b * h;
          return p;
        };
        // Outward winding: (u, v) is right-handed with the axis for s = +1.
        if (s > 0) {
          tri(P(-1, -1), P(1, -1), P(1, 1));
          tri(P(-1, -1), P(1, 1), P(-1, 1));
        } else {
          tri(P(-1, -1), P(1, 1), P(1, -1));
          tri(P(-1, -1), P(-1, 1), P(1, 1));
        }
      }
    return out;
  }
  const n = shape === 'cyl6' ? 6 : shape === 'cyl12' ? 12 : 20;
  for (let i = 0; i < n; i++) {
    // CylinderGeometry starts at +Z and turns toward +X.
    const a0 = (i / n) * Math.PI * 2,
      a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [0.5 * Math.sin(a0), 0, 0.5 * Math.cos(a0)],
      p1 = [0.5 * Math.sin(a1), 0, 0.5 * Math.cos(a1)];
    const at = (p: number[], y: number) => [p[0]!, y, p[2]!];
    tri(at(p0, -0.5), at(p1, -0.5), at(p1, 0.5));
    tri(at(p0, -0.5), at(p1, 0.5), at(p0, 0.5));
    tri([0, 0.5, 0], at(p0, 0.5), at(p1, 0.5));
    tri([0, -0.5, 0], at(p1, -0.5), at(p0, -0.5));
  }
  return out;
}

/** Keeps the part of a triangle list below `y` (Sutherland–Hodgman against one plane, fan back to triangles). */
function clipBelow(pos: readonly number[], y: number, out: number[], nrm?: readonly number[], outN?: number[], uv?: readonly number[], outU?: number[]): void {
  for (let t = 0; t < pos.length; t += 9) {
    // Each polygon corner: position, normal and UV, interpolated along the cut edges.
    const poly: number[][] = [];
    const corner = (j: number) => {
      const i = t + j * 3,
        u = (t / 3 + j) * 2;
      return [pos[i]!, pos[i + 1]!, pos[i + 2]!, nrm?.[i] ?? 0, nrm?.[i + 1] ?? 0, nrm?.[i + 2] ?? 0, uv?.[u] ?? 0, uv?.[u + 1] ?? 0];
    };
    for (let j = 0; j < 3; j++) {
      const a = corner(j),
        b = corner((j + 1) % 3);
      const ain = a[1]! <= y,
        bin = b[1]! <= y;
      if (ain) poly.push(a);
      if (ain !== bin) {
        const k = (y - a[1]!) / (b[1]! - a[1]!);
        poly.push(a.map((v, q) => (q === 1 ? y : v + (b[q]! - v) * k)));
      }
    }
    for (let i = 1; i + 1 < poly.length; i++)
      for (const p of [poly[0]!, poly[i]!, poly[i + 1]!]) {
        out.push(p[0]!, p[1]!, p[2]!);
        if (outN) outN.push(p[3]!, p[4]!, p[5]!);
        if (outU) outU.push(p[6]!, p[7]!);
      }
  }
}

/** Parts cut at height `y` (building frame): what is above goes, what crosses is clipped (nothing floats above the cut). */
export function clipPartsBelow(parts: Parts3, y: number): Parts3 {
  const out: Parts3 = { inst: [], meshes: [], tags: parts.tags };
  const prim = new Map<InstPart['shape'], number[]>();
  for (const it of parts.inst) {
    const m = it.m;
    // Height range of the unit cube corners (it also bounds the unit cylinder).
    let lo = Infinity,
      hi = -Infinity;
    for (const cx of [-0.5, 0.5]) for (const cy of [-0.5, 0.5]) for (const cz of [-0.5, 0.5]) {
      const wy = m[1]! * cx + m[5]! * cy + m[9]! * cz + m[13]!;
      lo = Math.min(lo, wy);
      hi = Math.max(hi, wy);
    }
    if (hi <= y) out.inst.push(it);
    else if (lo < y) {
      let unit = prim.get(it.shape);
      if (!unit) prim.set(it.shape, (unit = primitiveTris(it.shape)));
      const world: number[] = [];
      for (let i = 0; i < unit.length; i += 3) {
        const [x, yy, z] = [unit[i]!, unit[i + 1]!, unit[i + 2]!];
        world.push(m[0]! * x + m[4]! * yy + m[8]! * z + m[12]!, m[1]! * x + m[5]! * yy + m[9]! * z + m[13]!, m[2]! * x + m[6]! * yy + m[10]! * z + m[14]!);
      }
      const positions: number[] = [];
      clipBelow(world, y, positions);
      if (positions.length) out.meshes.push({ mat: it.mat, positions, tag: it.tag });
    }
  }
  for (const mp of parts.meshes) {
    let all = true;
    for (let i = 1; i < mp.positions.length; i += 3) if (mp.positions[i]! > y) all = false;
    if (all) {
      out.meshes.push(mp);
      continue;
    }
    const positions: number[] = [];
    const normals: number[] | undefined = mp.normals ? [] : undefined;
    const uvs: number[] | undefined = mp.uvs ? [] : undefined;
    clipBelow(mp.positions, y, positions, mp.normals, normals, mp.uvs, uvs);
    if (positions.length) out.meshes.push({ mat: mp.mat, positions, ...(normals ? { normals } : {}), ...(uvs ? { uvs } : {}), tag: mp.tag });
  }
  return out;
}

/** Solid above the cut plane (up to `hi`), subtracted from or intersected with the building: its faces become the section ('cut'). */
export function cutBox(y: number, table: FaceTable, scope: Scope, hi = y + 2000): Manifold {
  const k = kernel();
  const id = table.add({ kind: 'cut', solid: '' });
  const R = 2000;
  const mb = new MeshBuilder();
  heightPrism(mb, [[-R, -R], [R, -R], [R, R], [-R, R]], [], [], () => hi, y, { top: () => id, bottom: id, side: () => id });
  return scope.keep(mb.toManifold(k));
}

/** Plan cut height above a floor (m): the usual plan cut plane. */
export const PLAN_CUT = 1.2;

export interface FloorBand {
  /** Band index (lift = index × gap). */
  index: number;
  lo: number;
  hi: number;
}

/**
 * Floor bands of a building: floor i goes from its slab to its plan cut, the roof band from the
 * top floor's cut up. The walls between a cut and the next slab are left out (stacked plans).
 */
export function floorBands(b: Building3, levels: number[], top: boolean): FloorBand[] {
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const out: FloorBand[] = [];
  for (const i of levels) {
    if (i >= lv.length) continue;
    // 1 mm above the slab underside: never coplanar with the ceiling of the floor below.
    out.push({ index: i, lo: i === 0 ? -1000 : lv[i]!.elevation + 0.001, hi: lv[i]!.elevation + PLAN_CUT });
  }
  if (top && lv.length) out.push({ index: lv.length, lo: lv[lv.length - 1]!.elevation + PLAN_CUT, hi: 2000 });
  return out;
}

/** One shell from several, with the band of each triangle. */
export function mergeShells(shells: { positions: Float32Array; indices: Uint32Array; faceOf: Uint32Array }[], bands?: number[]): { positions: Float32Array; indices: Uint32Array; faceOf: Uint32Array; floorOf: Uint16Array } {
  let nv = 0,
    nt = 0;
  for (const s of shells) {
    nv += s.positions.length;
    nt += s.faceOf.length;
  }
  const positions = new Float32Array(nv),
    indices = new Uint32Array(nt * 3),
    faceOf = new Uint32Array(nt),
    floorOf = new Uint16Array(nt);
  let ov = 0,
    ot = 0;
  shells.forEach((s, k) => {
    positions.set(s.positions, ov);
    for (let i = 0; i < s.indices.length; i++) indices[ot * 3 + i] = s.indices[i]! + ov / 3;
    faceOf.set(s.faceOf, ot);
    floorOf.fill(bands?.[k] ?? k, ot, ot + s.faceOf.length);
    ov += s.positions.length;
    ot += s.faceOf.length;
  });
  return { positions, indices, faceOf, floorOf };
}

/** Parts cut into the floor bands, each piece marked with its band. */
export function bandParts(parts: Parts3, bands: FloorBand[]): Parts3 {
  const out: Parts3 = { inst: [], meshes: [], tags: parts.tags };
  for (const bd of bands) {
    const below = clipPartsBelow(parts, bd.hi);
    const band = clipPartsAbove(below, bd.lo);
    for (const it of band.inst) out.inst.push({ ...it, floor: bd.index });
    for (const m of band.meshes) out.meshes.push({ ...m, floor: bd.index });
  }
  return out;
}

/** Parts above height `y` (the mirror of clipPartsBelow). */
function clipPartsAbove(parts: Parts3, y: number): Parts3 {
  // Mirror in Y, keep below −y, mirror back (the winding flips twice).
  const flipM = (m: number[]) => [m[0]!, -m[1]!, m[2]!, m[3]!, m[4]!, -m[5]!, m[6]!, m[7]!, m[8]!, -m[9]!, m[10]!, m[11]!, m[12]!, -m[13]!, m[14]!, m[15]!];
  const flipP = (pos: number[]) => pos.map((v, i) => (i % 3 === 1 ? -v : v));
  const flipMesh = (m: Parts3['meshes'][number]) => ({ ...m, positions: flipP(m.positions), ...(m.normals ? { normals: flipP(m.normals) } : {}) });
  const mirrored: Parts3 = { tags: parts.tags, inst: parts.inst.map((it) => ({ ...it, m: flipM(it.m) })), meshes: parts.meshes.map(flipMesh) };
  const kept = clipPartsBelow(mirrored, -y);
  return { tags: parts.tags, inst: kept.inst.map((it) => ({ ...it, m: flipM(it.m) })), meshes: kept.meshes.map(flipMesh) };
}

/** Cut height of a building for a level index (1.2 m above that floor, the usual plan cut plane); undefined past its top floor. */
export function cutHeight(b: Building3, level: number | undefined): number | undefined {
  if (level === undefined || level >= b.levels.length) return undefined;
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  return lv[level]!.elevation + 1.2;
}

/**
 * The exterior walls as a solid to subtract (interior view with the walls hidden): per floor, the
 * outline grown well past bands and plinths minus the room region inset slightly more than the
 * wall (2 cm into the room: never coplanar with the room sides). What it leaves — slab edges, wall
 * ends — comes out as the section ('cut'): walls and slabs keep their thickness on screen.
 */
export function exteriorWalls(b: Building3, hidden: (s: Solid) => boolean, table: FaceTable, scope: Scope, id = table.add({ kind: 'cut', solid: '' })): Manifold | null {
  const k = kernel();
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  const levels = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const pieces: Manifold[] = [];
  try {
    const section = (s: Solid, y: number, grow: number) => {
      const rings = ringsAt(solidRings(s), Math.max(0, Math.min(s.height, y - s.base))).map((ring) => ring.map((p) => [p[0], p[1]] as [number, number]));
      const cs = keep(new k.CrossSection(rings, 'EvenOdd'));
      return grow ? keep(cs.offset(grow, 'Miter', 2)) : cs;
    };
    const cutters = b.solids.filter((s) => s.op === 'subtract' && !s.id.includes(STAIR_OPENING));
    const INSET = WALL + 0.02;
    for (const s of b.solids) {
      if (s.op !== 'add' || hidden(s)) continue;
      const top = s.base + s.height;
      // Bands: the floors that cross the volume, from the foot (plinth) to the wall top.
      const cuts = [s.base - 0.5, ...levels.map((l) => l.elevation).filter((e) => e > s.base + 0.05 && e < top - 0.05), top];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const lo = cuts[i]!,
          hi = cuts[i + 1]!;
        const a = Math.max(lo, s.base),
          z = hi;
        const outer = keep(section(s, a, 3).add(section(s, z, 3)));
        let inner = keep(section(s, a, -INSET).intersect(section(s, z, -INSET)));
        for (const c of cutters) if (c.base < z && c.base + c.height > a) inner = keep(inner.subtract(keep(section(c, a, INSET).add(section(c, z, INSET)))));
        const ring = keep(outer.subtract(inner));
        const wall = extrudeSection(k, ring, lo, hi, { top: id, bottom: id, side: id }, (x) => scope.keep(x));
        if (wall) pieces.push(wall);
      }
    }
  } finally {
    for (const x of temp) x.delete();
  }
  if (!pieces.length) return null;
  return pieces.length === 1 ? pieces[0]! : scope.keep(k.Manifold.union(pieces));
}

/** Reach of the wall removal past a volume outline (its ring is grown by 3 m, plus a margin). */
const RING_REACH = 3.2;

/**
 * Section faces left by the wall removal at or above the roof slab of the volume that holds them are
 * cuts through a roof: the removal ring of a tower bites the roof of the house next to it, the
 * underside of an eave shows where the wall below went, and the roof slab keeps only its edges once its
 * top hides. They belong to the roof (`roofCut`) and hide with the roofs; the edges of the floor slabs
 * and the wall ends lie below and stay. A point inside a plan takes
 * the tallest volume holding it; outside every plan (eaves), the lowest volume whose ring reaches it.
 */
export function roofCuts(sh: { positions: Float32Array; indices: Uint32Array; faceOf: Uint32Array }, b: Building3, hidden: (s: Solid) => boolean, cutId: number, roofCutId: number): void {
  const vols = b.solids.filter((s) => s.op === 'add' && !hidden(s)).map((s) => ({ pts: solidRings(s).outer.pts, base: s.base, top: s.base + s.height }));
  if (!vols.length) return;
  const { positions: P, indices: I, faceOf: F } = sh;
  for (let t = 0; t < F.length; t++) {
    if (F[t] !== cutId) continue;
    const i0 = I[3 * t]! * 3,
      i1 = I[3 * t + 1]! * 3,
      i2 = I[3 * t + 2]! * 3;
    const x = (P[i0]! + P[i1]! + P[i2]!) / 3,
      y = (P[i0 + 1]! + P[i1 + 1]! + P[i2 + 1]!) / 3,
      z = (P[i0 + 2]! + P[i1 + 2]! + P[i2 + 2]!) / 3;
    let held = -Infinity,
      near = Infinity;
    for (const v of vols) {
      if (y < v.base - 0.05) continue;
      if (insideRing(v.pts, x, z)) held = Math.max(held, v.top);
      else if (ringDistance(v.pts, x, z) <= RING_REACH) near = Math.min(near, v.top);
    }
    const top = held > -Infinity ? held : near;
    // The roof slab (under the wall top) goes with the roof too: with its top hidden only its edges stayed, an outline in the air.
    if (top < Infinity && y >= top - SLAB - 0.02) F[t] = roofCutId;
  }
}

function insideRing(pts: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!,
      c = pts[j]!;
    if (a[1] > z !== c[1] > z && x < ((c[0] - a[0]) * (z - a[1])) / (c[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function ringDistance(pts: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j]!,
      c = pts[i]!;
    const dx = c[0] - a[0],
      dz = c[1] - a[1];
    const L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z));
  }
  return best;
}
