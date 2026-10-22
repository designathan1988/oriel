// Floor plan of one level of a building (the drawing an architect calls the plan): the horizontal cut
// 1.2 m above the floor, seen from above, as Revit draws a floor plan (its cut plane:
// https://help.autodesk.com/cloudhelp/2023/ENU/RevitLT-DocumentPresent/files/GUID-58711292-AB78-4C8F-BAA1-0855DDB518BF.htm)
// and as the Brazilian drawing rules ask (NBR 6492): cut walls filled, doors drawn open with their
// swing, windows closed, every room with its name and area, the dimensions outside.
//
// What is cut: the exterior walls of every adding volume that crosses the cut height (its outline minus
// the outline inset by the wall thickness, the same rule as the interior view in eval/interior.ts),
// less the cutters, plus the interior walls of the level, less every opening of that floor. The rooms
// are the free floor left inside: each one gets the name of the room drawn there (Building3.interiors)
// or none, and its area. All in the building's own plan frame [x, z], metres. Pure (no three, no DOM).
import type { Building3, ID, Solid, Vec2 } from '../model/schema';
import { kernel, type CrossSection } from '../kernel/kernel';
import { solidRings } from './body';
import { ringsAt } from './parapet';
import { interiorDoors } from './interiorwalls';
import { PLAN_CUT, WALL } from './interior';
import type { Placement } from './facade';
import { planSymbol, type PlanSymbol } from './plansymbols';

export interface PlanWindow {
  /** Ends on the outer face of the wall, the outward normal and the wall thickness. */
  a: Vec2;
  b: Vec2;
  n: Vec2;
  depth: number;
  /** Opening size (m): width along the wall and height. */
  w: number;
  h: number;
}

export interface PlanDoor {
  /** Hinge on the face the door opens to, the jamb it closes against, the leaf open (90°). */
  hinge: Vec2;
  jamb: Vec2;
  leaf: Vec2;
  width: number;
  /** Opening between the two faces of the wall (the threshold is drawn across it). */
  a: Vec2;
  b: Vec2;
  n: Vec2;
  depth: number;
}

export interface PlanRoom {
  /** Room drawn on this level whose area this is (null: free floor without a name). */
  id: ID | null;
  name: string;
  area: number;
  /** Where the label goes (inside the room). */
  at: Vec2;
  rings: Vec2[][];
}

export interface PlanDim {
  a: Vec2;
  b: Vec2;
  /** Side of the drawing it stands on and how far out (0 nearest the wall: openings, then the corners, the overall size outermost). */
  side: 'top' | 'bottom' | 'left' | 'right';
  tier: number;
}

export interface FloorPlan {
  building: string;
  level: string;
  levelIndex: number;
  /** Floor elevation and cut height (m above the building origin). */
  elevation: number;
  cutY: number;
  /** Cut walls (rings, even-odd: an outline and its holes). */
  walls: Vec2[][];
  /** Boundaries between the layers of the cut walls (thin bands inside them, rings even-odd). */
  layers: Vec2[][];
  windows: PlanWindow[];
  doors: PlanDoor[];
  rooms: PlanRoom[];
  /** Outlines of the volumes on this floor (the outer face of the walls), for the dimensions. */
  outline: Vec2[][];
  /** Built area of the floor (inside the outer face of the walls) and its free floor (m²). */
  grossArea: number;
  netArea: number;
  dims: PlanDim[];
  /** Furniture and stairs seen from above (plansymbols.ts). */
  symbols: PlanSymbol[];
  bbox: { x0: number; z0: number; x1: number; z1: number };
}

const DOOR_CATS = new Set(['doors', 'gates']);

const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];

/** Every point of a ring set (for the box of a room label). */
function centroid(rings: Vec2[][]): Vec2 {
  let A = 0,
    x = 0,
    z = 0;
  for (const r of rings)
    for (let i = 0; i < r.length; i++) {
      const p = r[i]!,
        q = r[(i + 1) % r.length]!;
      const c = p[0] * q[1] - q[0] * p[1];
      A += c;
      x += (p[0] + q[0]) * c;
      z += (p[1] + q[1]) * c;
    }
  if (Math.abs(A) < 1e-9) return rings[0]?.[0] ?? [0, 0];
  return [x / (3 * A), z / (3 * A)];
}

function insideRings(p: Vec2, rings: Vec2[][]): boolean {
  let c = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i]![1] > p[1] !== r[j]![1] > p[1] && p[0] < ((r[j]![0] - r[i]![0]) * (p[1] - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) c = !c;
  return c;
}

/**
 * A point well inside a room for its label: the centroid when it falls inside, else the middle of the
 * widest horizontal run through the room at the centroid's height (an L-shaped room).
 */
function labelPoint(rings: Vec2[][]): Vec2 {
  const c = centroid(rings);
  if (insideRings(c, rings)) return c;
  const xs: number[] = [];
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j]!,
        b = r[i]!;
      if (a[1] > c[1] !== b[1] > c[1]) xs.push(a[0] + ((c[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
  xs.sort((p, q) => p - q);
  let best: Vec2 = rings[0]?.[0] ?? c,
    w = -1;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1]! - xs[i]! > w) {
      w = xs[i + 1]! - xs[i]!;
      best = [(xs[i]! + xs[i + 1]!) / 2, c[1]];
    }
  return best;
}

type Box = [number, number, number, number];

/**
 * Where the label of a room goes when the furniture is in the way of `at`: the nearest point of the room
 * whose label box (`w` × the two lines, name over area) stays inside it and covers the least furniture.
 */
function clearLabel(rings: Vec2[][], at: Vec2, w: number, boxes: Box[]): Vec2 {
  const up = 0.38,
    down = 0.44;
  const cover = (p: Vec2) => {
    let s = 0;
    for (const b of boxes) {
      const ox = Math.min(p[0] + w / 2, b[2]) - Math.max(p[0] - w / 2, b[0]),
        oz = Math.min(p[1] + down, b[3]) - Math.max(p[1] - up, b[1]);
      if (ox > 0 && oz > 0) s += ox * oz;
    }
    return s;
  };
  if (cover(at) < 1e-6) return at;
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity;
  for (const r of rings)
    for (const p of r) {
      x0 = Math.min(x0, p[0]);
      z0 = Math.min(z0, p[1]);
      x1 = Math.max(x1, p[0]);
      z1 = Math.max(z1, p[1]);
    }
  let best = at,
    score = cover(at) * 100;
  for (let x = x0 + w / 2 + 0.05; x <= x1 - w / 2 - 0.05; x += 0.1)
    for (let z = z0 + up + 0.05; z <= z1 - down - 0.05; z += 0.1) {
      const p: Vec2 = [x, z];
      const corners: Vec2[] = [
        [x - w / 2, z - up],
        [x + w / 2, z - up],
        [x + w / 2, z + down],
        [x - w / 2, z + down],
      ];
      if (!corners.every((c) => insideRings(c, rings))) continue;
      const sc = cover(p) * 100 + Math.hypot(x - at[0], z - at[1]) * 0.05;
      if (sc < score) {
        score = sc;
        best = p;
      }
    }
  return best;
}

/** Rectangle `len` long along `u` from `o`, from `d0` to `d1` across it (along `n`). */
function rect(o: Vec2, u: Vec2, n: Vec2, len: number, d0: number, d1: number): [number, number][] {
  const p = (s: number, d: number): [number, number] => [o[0] + u[0] * s + n[0] * d, o[1] + u[1] * s + n[1] * d];
  return [p(0, d0), p(len, d0), p(len, d1), p(0, d1)];
}

/** Levels of a building from the ground up. */
export function sortedLevels(b: Building3): Building3['levels'] {
  return [...b.levels].sort((p, q) => p.elevation - q.elevation);
}

/**
 * The plan of level `levelIndex` (0 = ground floor). `placements`: the components where the evaluation
 * put them (Evaluated.placements: windows and doors on the facades); `hidden`: volumes left out.
 */
export function floorPlan(b: Building3, levelIndex: number, placements: readonly Placement[] = [], hidden: (s: Solid) => boolean = (s) => !!s.hidden): FloorPlan {
  const k = kernel();
  const levels = sortedLevels(b);
  const lv = levels[Math.max(0, Math.min(levels.length - 1, levelIndex))];
  const elevation = lv?.elevation ?? 0;
  const top = lv ? elevation + lv.height : Infinity;
  const cutY = elevation + PLAN_CUT;
  const temp: { delete(): void }[] = [];
  const keep = <X extends { delete(): void }>(x: X): X => (temp.push(x), x);
  const out: FloorPlan = {
    building: b.name,
    level: lv?.name ?? '',
    levelIndex,
    elevation,
    cutY,
    walls: [],
    layers: [],
    windows: [],
    doors: [],
    rooms: [],
    outline: [],
    grossArea: 0,
    netArea: 0,
    dims: [],
    symbols: [],
    bbox: { x0: 0, z0: 0, x1: 0, z1: 0 },
  };
  const polys = (cs: CrossSection): Vec2[][] => cs.toPolygons().map((r) => r.map((p) => [p[0], p[1]] as Vec2));
  try {
    const section = (s: Solid, grow: number): CrossSection => {
      const rings = ringsAt(solidRings(s), Math.max(0, Math.min(s.height, cutY - s.base))).map((ring) => ring.map((p) => [p[0], p[1]] as [number, number]));
      const cs = keep(new k.CrossSection(rings, 'EvenOdd'));
      return grow ? keep(cs.offset(grow, 'Miter', 2)) : cs;
    };
    const cuts = (s: Solid) => s.base <= cutY && cutY < s.base + s.height;
    const adds = b.solids.filter((s) => s.op === 'add' && !hidden(s) && cuts(s));
    const cutters = b.solids.filter((s) => s.op === 'subtract' && cuts(s));
    if (!adds.length) return out;
    let outer = keep(k.CrossSection.union(adds.map((s) => section(s, 0))));
    let inner = keep(k.CrossSection.union(adds.map((s) => section(s, -(s.shell ?? WALL)))));
    for (const c of cutters) {
      const hole = section(c, 0);
      outer = keep(outer.subtract(hole));
      inner = keep(inner.subtract(keep(hole.offset(s0(c), 'Miter', 2))));
    }
    out.outline = polys(outer);
    out.grossArea = outer.area();
    let walls = keep(outer.subtract(inner));

    // Interior walls of the level: one rectangle per wall, half a thickness past each node.
    const it = lv ? b.interiors[lv.id] : undefined;
    const node = new Map((it?.nodes ?? []).map((n) => [n.id, n.p]));
    const iw: [number, number][][] = [];
    const wallAxis = new Map<ID, { a: Vec2; u: Vec2; n: Vec2; len: number; t: number }>();
    for (const w of it?.walls ?? []) {
      const a = node.get(w.a),
        c = node.get(w.b);
      if (!a || !c) continue;
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 0.05) continue;
      const u: Vec2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
      const n: Vec2 = [-u[1], u[0]];
      wallAxis.set(w.id, { a, u, n, len, t: w.thickness });
      iw.push(rect(add(a, u, -w.thickness / 2), u, n, len + w.thickness, -w.thickness / 2, w.thickness / 2));
    }
    if (iw.length) walls = keep(walls.add(keep(new k.CrossSection(iw, 'Positive'))));
    // Free floor (before the openings are cut: a door does not join two rooms).
    let floor = iw.length ? keep(inner.subtract(keep(new k.CrossSection(iw, 'Positive')))) : inner;
    // Rooms closed by walls drawn with the Walls tool (no hollow volume around them): their outline is free floor.
    const drawnRooms = (it?.rooms ?? []).filter((r) => r.polygon && r.polygon.length >= 3 && r.wallIds.some((id) => b.solids.some((s) => s.id === id && s.wallAxis)));
    if (drawnRooms.length) floor = keep(keep(floor.add(keep(new k.CrossSection(drawnRooms.map((r) => r.polygon!.map((p) => [p[0], p[1]] as [number, number])), 'Positive')))).subtract(walls));

    // Openings on the facades of this floor.
    const gaps: [number, number][][] = [];
    const facade: { a: Vec2; b: Vec2; n: Vec2 }[] = [];
    for (const pl of placements) {
      if (!pl.opening) {
        const sym = planSymbol(pl, elevation, top, cutY);
        if (sym) out.symbols.push(sym);
        continue;
      }
      const m = pl.frame;
      const y0 = m[13]!,
        y1 = y0 + pl.opening.h;
      if (y1 <= elevation + 0.05 || y0 >= top - 0.05) continue;
      const u: Vec2 = [m[0]!, m[2]!],
        n: Vec2 = [m[8]!, m[10]!];
      const ul = Math.hypot(u[0], u[1]),
        nl = Math.hypot(n[0], n[1]);
      if (ul < 1e-6 || nl < 1e-6) continue;
      u[0] /= ul;
      u[1] /= ul;
      n[0] /= nl;
      n[1] /= nl;
      const o: Vec2 = [m[12]!, m[14]!];
      const w = pl.opening.w;
      const depth = WALL;
      const a = add(o, u, -w / 2),
        bb = add(o, u, w / 2);
      gaps.push(rect(a, u, n, w, -depth - 0.05, 0.3));
      facade.push({ a, b: bb, n });
      if (DOOR_CATS.has(pl.family.category) || y0 < elevation + 0.4) {
        // Exterior doors open in: the hinge on the inner face, the leaf into the room.
        const inA = add(a, n, -depth),
          inB = add(bb, n, -depth);
        out.doors.push({ hinge: inA, jamb: inB, leaf: add(inA, n, -w), width: w, a, b: bb, n, depth });
      } else out.windows.push({ a, b: bb, n, depth, w, h: pl.opening.h });
    }
    // Interior doors.
    for (const d of it ? interiorDoors(it) : []) {
      const ax = wallAxis.get(d.wall);
      if (!ax) continue;
      const c = add(ax.a, ax.u, d.u);
      const a = add(c, ax.u, -d.width / 2),
        bb = add(c, ax.u, d.width / 2);
      gaps.push(rect(a, ax.u, ax.n, d.width, -ax.t / 2 - 0.01, ax.t / 2 + 0.01));
      // A passage: the gap alone, no leaf and no swing.
      if (d.leaf === false) continue;
      const n: Vec2 = d.swing === -1 ? [-ax.n[0], -ax.n[1]] : ax.n;
      const hinge = add(a, n, ax.t / 2);
      out.doors.push({ hinge, jamb: add(bb, n, ax.t / 2), leaf: add(hinge, n, d.width), width: d.width, a: add(a, n, ax.t / 2), b: add(bb, n, ax.t / 2), n, depth: ax.t });
    }
    if (gaps.length) walls = keep(walls.subtract(keep(new k.CrossSection(gaps, 'Positive'))));
    out.walls = polys(walls);
    // The layers of a wall type: a 1 cm band at each boundary between two layers, kept inside the cut walls
    // (so it stops at the openings like the walls do).
    const bands: CrossSection[] = [];
    for (const s of adds) {
      if (!s.wallLayers || s.wallLayers.length < 2) continue;
      let at = 0;
      for (const l of s.wallLayers.slice(0, -1)) {
        at += l.thickness;
        bands.push(keep(section(s, -at + 0.005).subtract(section(s, -at - 0.005))));
      }
    }
    if (bands.length) out.layers = polys(keep(keep(k.CrossSection.union(bands)).intersect(walls)));

    // Rooms: each piece of free floor, named after the room drawn inside it.
    // What each label keeps clear of: the furniture (cut-plane symbols; the dashed ones above are no obstacle).
    const furnitureBoxes: Box[] = out.symbols.map((sym) => {
      const ps = sym.strokes.filter((st) => !st.above).flatMap((st) => st.pts);
      return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))] as Box;
    }).filter((bx) => Number.isFinite(bx[0]));
    // And the swing of the doors.
    for (const d of out.doors) {
      const ps = [d.hinge, d.jamb, d.leaf, [d.leaf[0] + d.jamb[0] - d.hinge[0], d.leaf[1] + d.jamb[1] - d.hinge[1]] as Vec2];
      furnitureBoxes.push([Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))]);
    }
    const named = (it?.rooms ?? []).filter((r) => r.polygon && r.polygon.length >= 3);
    out.netArea = floor.area();
    for (const piece of floor.decompose()) {
      keep(piece);
      const area = piece.area();
      if (area < 0.5) continue;
      const rings = polys(piece);
      const r = named.find((x) => insideRings(labelPoint([x.polygon!]), rings));
      const name = r?.name ?? '';
      const at = clearLabel(rings, labelPoint(rings), Math.max(name.length * 0.19, 1.15), furnitureBoxes);
      out.rooms.push({ id: r?.id ?? null, name, area, at, rings });
    }

    // Dimensions: on the bottom and the right, a chain through the outline corners and the overall size.
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    for (const r of out.outline)
      for (const p of r) {
        x0 = Math.min(x0, p[0]);
        z0 = Math.min(z0, p[1]);
        x1 = Math.max(x1, p[0]);
        z1 = Math.max(z1, p[1]);
      }
    if (x0 < x1 && z0 < z1) {
      out.bbox = { x0, z0, x1, z1 };
      const stops = (vals: number[], lo: number, hi: number) => {
        const s = [...new Set(vals.map((v) => Math.round(v * 100) / 100))].filter((v) => v > lo + 0.05 && v < hi - 0.05).sort((p, q) => p - q);
        return [lo, ...s, hi];
      };
      const xs = stops(out.outline.flat().map((p) => p[0]), x0, x1);
      const zs = stops(out.outline.flat().map((p) => p[1]), z0, z1);
      // Innermost, on each side that has them: the openings of the façades facing it (jamb to jamb).
      const sides = [
        ['bottom', [0, 1]],
        ['top', [0, -1]],
        ['right', [1, 0]],
        ['left', [-1, 0]],
      ] as const;
      const tier0 = { bottom: 0, top: 0, right: 0, left: 0 };
      for (const [side, dir] of sides) {
        const horiz = dir[0] === 0;
        const ends = facade.filter((f) => f.n[0] * dir[0] + f.n[1] * dir[1] > 0.95).flatMap((f) => (horiz ? [f.a[0], f.b[0]] : [f.a[1], f.b[1]]));
        if (!ends.length) continue;
        const cs = horiz ? stops(ends, x0, x1) : stops(ends, z0, z1);
        const at = side === 'bottom' ? z1 : side === 'top' ? z0 : side === 'right' ? x1 : x0;
        for (let i = 0; i + 1 < cs.length; i++) out.dims.push(horiz ? { a: [cs[i]!, at], b: [cs[i + 1]!, at], side, tier: 0 } : { a: [at, cs[i]!], b: [at, cs[i + 1]!], side, tier: 0 });
        tier0[side] = 1;
      }
      const tb = tier0.bottom,
        tr = tier0.right;
      if (xs.length > 2) for (let i = 0; i + 1 < xs.length; i++) out.dims.push({ a: [xs[i]!, z1], b: [xs[i + 1]!, z1], side: 'bottom', tier: tb });
      if (zs.length > 2) for (let i = 0; i + 1 < zs.length; i++) out.dims.push({ a: [x1, zs[i]!], b: [x1, zs[i + 1]!], side: 'right', tier: tr });
      out.dims.push({ a: [x0, z1], b: [x1, z1], side: 'bottom', tier: tb + (xs.length > 2 ? 1 : 0) });
      out.dims.push({ a: [x1, z0], b: [x1, z1], side: 'right', tier: tr + (zs.length > 2 ? 1 : 0) });
    }
  } finally {
    for (const x of temp) x.delete();
  }
  return out;
}

/** Wall left around a cutter (a courtyard keeps its own wall). */
function s0(c: Solid): number {
  return c.shell ?? WALL;
}
