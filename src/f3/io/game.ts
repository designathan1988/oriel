// Export for the Roadcraft game: a stable JSON (same input → same
// text), no three. It needs the geometry kernel loaded (`loadKernel`),
// because the entrances come from the facade evaluation.
//
// Format `roadcraft-building` version 1
// ─────────────────────────────────────
// Units in meters; Y up; plan in [x, z]. Numbers rounded to the
// millimeter (directions to 1e-4). Keys always in the same order.
//
// {
//   "format": "roadcraft-building", "version": 1, "units": "m",
//   "name": string,
//   "lots": [{ "id", "name", "polygon": [[x, z], …] (world, counterclockwise), "frontEdges": [i, …] }],
//   "buildings": [{
//     "id", "name", "lotId": string | null,
//     "use": "residential" | "commercial" | "industrial" | "public" | "mixed",
//     "position": [x, z]            building origin in the world,
//     "elevation": m                building base elevation (0 = on the ground; added to y),
//     "rotation": degrees           around Y; local → world:
//                                   x' = x·cos + z·sen + px,  z' = −x·sen + z·cos + pz
//                                   (same as THREE.Object3D.rotation.y in radians),
//     "height": m                   highest point of the evaluated shell (with roof),
//     "levels": [{ "id", "name", "elevation", "height" }]   sorted by elevation,
//     "solids": [{
//       "id", "name", "op": "add" | "subtract" | "intersect",
//       "base", "height"            elevations in the building frame,
//       "outer": [[x, z], …]        local plan already sampled (arcs and corners become a polygon),
//                                   counterclockwise,
//       "holes": [[[x, z], …], …]   holes, clockwise,
//       "roof": { "kind", "pitch" (degrees), "rise", "overhang", "direction" (degrees), "parapet" },
//       "materials": { "wall" | "roof" | "trim" | "base": { "finish", "color" } }
//     }],
//     "entrances": [{
//       "id"                        "<rule or component>:<position>",
//       "kind": "door" | "garage" | "shopfront" | "loading"   family,
//       "type": string              component type ID,
//       "level": index into levels (by the sill elevation) or -1,
//       "position": [x, y, z]       world; threshold center, on the wall face,
//       "normal": [x, 0, z]         world; horizontal, pointing outward,
//       "width", "height"           occupied width and opening height
//     }],
//     "components": [{             every part (windows, doors, balconies, furniture, trees, lamps…),
//       "id", "family", "category", "type", "host": "face" | "roof" | "free" | "path",
//       "position": [x, y, z]       world; the part's origin (base center),
//       "rotation": degrees         around Y, world (the part faces its +z),
//       "size": [w, h, d]           box of the family
//     }],
//     "model": path               only in the game package (.zip, export.ts): the building's GLB,
//                                   in its own frame (placed by position, rotation, elevation),
//   }]
// }
import type { Building3, ID, Project3, Solid, Vec2, Vec3 } from '../model/schema';
import { evaluateBuilding } from '../eval/evaluate';
import type { Placement } from '../eval/facade';
import { oriented, sampleRing } from '../model/plan';

export const GAME_FORMAT = 'roadcraft-building' as const;
export const GAME_VERSION = 1 as const;
export const ENTRANCE_FAMILIES = ['door', 'garage', 'shopfront', 'loading'] as const;
export type EntranceKind = (typeof ENTRANCE_FAMILIES)[number];

export interface GameEntrance {
  id: string;
  kind: EntranceKind;
  type: ID;
  level: number;
  position: Vec3;
  normal: Vec3;
  width: number;
  height: number;
}

export interface GameSolid {
  id: ID;
  name: string;
  op: Solid['op'];
  base: number;
  height: number;
  outer: Vec2[];
  holes: Vec2[][];
  roof: { kind: string; pitch: number; rise: number; overhang: number; direction: number; parapet: number };
  materials: Record<'wall' | 'roof' | 'trim' | 'base', { finish: string; color: string }>;
}

export interface GameComponent {
  id: string;
  family: string;
  category: string;
  type: ID;
  host: 'face' | 'roof' | 'free' | 'path';
  position: Vec3;
  rotation: number;
  size: Vec3;
}

export interface GameBuilding {
  id: ID;
  name: string;
  lotId: ID | null;
  use: Building3['use'];
  position: Vec2;
  elevation: number;
  rotation: number;
  height: number;
  levels: { id: ID; name: string; elevation: number; height: number }[];
  solids: GameSolid[];
  entrances: GameEntrance[];
  components: GameComponent[];
  /** Only in the game package: the path of the building's GLB in the archive. */
  model?: string;
}

export interface GameProject {
  format: typeof GAME_FORMAT;
  version: typeof GAME_VERSION;
  units: 'm';
  name: string;
  lots: { id: ID; name: string; polygon: Vec2[]; frontEdges: number[] }[];
  buildings: GameBuilding[];
}

const mm = (v: number) => Math.round(v * 1000) / 1000 + 0;
const dir4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const pt2 = (p: Vec2): Vec2 => [mm(p[0]), mm(p[1])];

/** Point and direction from the building frame to the world. */
export function buildingToWorld(b: Pick<Building3, 'position' | 'rotation' | 'elevation'>) {
  const a = (b.rotation * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return {
    point: (p: Vec3): Vec3 => [p[0] * c + p[2] * s + b.position[0], p[1] + (b.elevation ?? 0), -p[0] * s + p[2] * c + b.position[1]],
    dir: (d: Vec3): Vec3 => [d[0] * c + d[2] * s, d[1], -d[0] * s + d[2] * c],
  };
}

function typeOf(b: Building3, pl: Placement): ID {
  const t = pl.tag;
  if (t.item) return b.items.find((i) => i.id === t.item)?.type ?? '';
  if (t.rule) {
    for (const s of b.solids) {
      const r = s.facade.find((x) => x.id === t.rule);
      if (r) return (t.key && r.except[t.key] && r.except[t.key] !== 'none' ? r.except[t.key] : r.type) ?? r.type;
    }
  }
  return '';
}

/** Evaluated entrances (doors, garages, shopfronts, docks) of a building, in the world. */
export function entrancesOf(b: Building3, placements: Placement[]): GameEntrance[] {
  const levels = [...b.levels].sort((x, y) => x.elevation - y.elevation);
  const w = buildingToWorld(b);
  const out: GameEntrance[] = [];
  for (const pl of placements) {
    const kind = pl.family.id as EntranceKind;
    if (!ENTRANCE_FAMILIES.includes(kind)) continue;
    const m = pl.frame;
    const local: Vec3 = [m[12]!, m[13]!, m[14]!];
    // Face normal (frame z axis), flattened onto the plane (leaning walls).
    let n: Vec3 = [m[8]!, 0, m[10]!];
    const l = Math.hypot(n[0], n[2]) || 1;
    n = [n[0] / l, 0, n[2] / l];
    const y = local[1];
    const level = levels.findIndex((lv) => y >= lv.elevation - 0.05 && y < lv.elevation + lv.height - 0.05);
    const p = w.point(local),
      d = w.dir(n);
    out.push({
      id: `${pl.tag.item ?? pl.tag.rule ?? '?'}:${pl.tag.key ?? '0'}`,
      kind,
      type: typeOf(b, pl),
      level,
      position: [mm(p[0]), mm(p[1]), mm(p[2])],
      normal: [dir4(d[0]), 0, dir4(d[2])],
      width: mm(pl.length),
      height: mm(pl.opening?.h ?? pl.family.size(pl.params)[1]),
    });
  }
  // Stable order: by ID (rule/component and position).
  return out.sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
}

/** Every evaluated part of a building, in the world (stable order by ID). */
export function componentsOf(b: Building3, placements: Placement[]): GameComponent[] {
  const w = buildingToWorld(b);
  return placements
    .map((pl) => {
      const m = pl.frame;
      const p = w.point([m[12]!, m[13]!, m[14]!]);
      const z = w.dir([m[8]!, 0, m[10]!]);
      const sz = pl.family.size(pl.params);
      return {
        id: `${pl.tag.item ?? pl.tag.rule ?? '?'}:${pl.tag.key ?? '0'}`,
        family: pl.family.id,
        category: pl.family.category,
        type: typeOf(b, pl),
        host: pl.family.host,
        position: [mm(p[0]), mm(p[1]), mm(p[2])] as Vec3,
        rotation: mm(((Math.atan2(z[0], z[2]) * 180) / Math.PI + 360) % 360),
        size: [mm(sz[0]), mm(sz[1]), mm(sz[2])] as Vec3,
      };
    })
    .sort((a, c) => (a.id < c.id ? -1 : a.id > c.id ? 1 : 0));
}

function gameSolid(s: Solid): GameSolid {
  return {
    id: s.id,
    name: s.name,
    op: s.op,
    base: mm(s.base),
    height: mm(s.height),
    outer: sampleRing(oriented(s.plan.outer, 1)).pts.map(pt2),
    holes: s.plan.holes.map((h) => sampleRing(oriented(h, -1)).pts.map(pt2)),
    roof: { kind: s.roof.kind, pitch: mm(s.roof.pitch), rise: mm(s.roof.rise), overhang: mm(s.roof.overhang), direction: mm(s.roof.direction), parapet: mm(s.roof.parapet) },
    materials: {
      wall: { finish: s.materials.wall.finish, color: s.materials.wall.color },
      roof: { finish: s.materials.roof.finish, color: s.materials.roof.color },
      trim: { finish: s.materials.trim.finish, color: s.materials.trim.color },
      base: { finish: s.materials.base.finish, color: s.materials.base.color },
    },
  };
}

/** Game data (object). Requires the loaded kernel. */
export function gameData(project: Project3): GameProject {
  return {
    format: GAME_FORMAT,
    version: GAME_VERSION,
    units: 'm',
    name: project.name,
    lots: project.lots.map((l) => ({ id: l.id, name: l.name, polygon: l.polygon.map(pt2), frontEdges: [...l.frontEdges] })),
    buildings: project.buildings.map((b) => {
      const ev = evaluateBuilding(b, { hidden: () => false }, project);
      let top = 0;
      for (let i = 1; i < ev.shell.positions.length; i += 3) top = Math.max(top, ev.shell.positions[i]!);
      return {
        id: b.id,
        name: b.name,
        lotId: b.lotId,
        use: b.use,
        position: pt2(b.position),
        elevation: mm(b.elevation ?? 0),
        rotation: mm(b.rotation),
        height: mm(top),
        levels: [...b.levels].sort((x, y) => x.elevation - y.elevation).map((l) => ({ id: l.id, name: l.name, elevation: mm(l.elevation), height: mm(l.height) })),
        solids: b.solids.map(gameSolid),
        entrances: entrancesOf(b, ev.placements),
        components: componentsOf(b, ev.placements),
      };
    }),
  };
}

/** Game JSON (stable, indented text). Requires the loaded kernel. */
export function exportGameJSON(project: Project3): string {
  return JSON.stringify(gameData(project), null, 2);
}
