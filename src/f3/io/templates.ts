// Starting projects (the start screen): a blank site and ready buildings of the kinds people make most
// (a single-storey house with its rooms, a two-storey house, a warehouse, an apartment block), so a new
// project opens on something to edit instead of an empty grid. No three.
import type { Building3, Item, Project3, Vec2 } from '../model/schema';
import { building, facadeRule, levelsFor, mat, project, rectPlan, roofSpec, solid, uid } from '../model/defaults';
import { sampleBuildings } from '../model/samples';
import { addInteriorWall, interiorDoors, interiorOf, loopAround, roomArea, type InteriorWithDoors } from '../eval/interiorwalls';

export interface Template {
  id: string;
  name: string;
  /** One line under the name on the start screen. */
  note: string;
  make(): Project3;
}

/** Rooms closed by the interior walls and the inner faces of a rectangular outline (w × d, walls t thick). */
function roomsAt(b: Building3, levelId: string, w: number, d: number, t: number, rooms: { name: string; at: Vec2 }[]): void {
  const it = interiorOf(b, levelId);
  const x = w / 2 - t,
    z = d / 2 - t;
  const inner: Vec2[] = [[-x, -z], [x, -z], [x, z], [-x, z]];
  for (const r of rooms) {
    const loop = loopAround(it, r.at, [inner]);
    if (!loop) continue;
    it.rooms.push({ id: uid(), name: r.name, wallIds: loop.wallIds, polygon: loop.polygon, area: Math.round(roomArea(loop.polygon) * 100) / 100 });
  }
}

/** A door in the interior wall that passes through `at` (within a few centimetres), opening toward `into`. */
function doorAt(b: Building3, levelId: string, at: Vec2, into: Vec2, width = 0.8): void {
  const it = interiorOf(b, levelId) as InteriorWithDoors;
  const node = new Map(it.nodes.map((n) => [n.id, n.p]));
  for (const w of it.walls) {
    const a = node.get(w.a)!,
      c = node.get(w.b)!;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const u = ((at[0] - a[0]) * (c[0] - a[0]) + (at[1] - a[1]) * (c[1] - a[1])) / L;
    const off = Math.abs((at[0] - a[0]) * (c[1] - a[1]) - (at[1] - a[1]) * (c[0] - a[0])) / L;
    if (off < 0.05 && u > width / 2 && u < L - width / 2) {
      const side = (c[0] - a[0]) * (into[1] - a[1]) - (c[1] - a[1]) * (into[0] - a[0]);
      it.doors = [...interiorDoors(it), { wall: w.id, u, width, height: 2.1, swing: side > 0 ? 1 : -1 }];
      return;
    }
  }
}

/** A piece of furniture standing free on the floor: `rot` turns it (degrees; 0 has its back to −z). */
const free = (type: string, x: number, z: number, rot = 0): Item => ({ id: uid(), type, params: {}, host: { kind: 'free', p: [x, 0, z], rot } });

const tiles = { wall: mat('plaster', '#efe9de'), roof: mat('tile', '#a4583a'), trim: mat('paint', '#ffffff'), base: mat('stone', '#a29a8c') };

/** Single-storey house, 12 × 9 m, hip roof, living and kitchen, two bedrooms and a bathroom. */
function house(): Project3 {
  const W = 12,
    D = 9,
    T = 0.15;
  const plan = rectPlan(W, D);
  const s = solid({ name: 'Paredes', plan: { outer: plan, holes: [] }, height: 2.8, roof: roofSpec('hip', { pitch: 30, overhang: 0.6 }), materials: tiles, facade: [facadeRule('door-panel', { levels: 'ground', edges: [plan[0]!.id], mode: 'count', value: 1 }), facadeRule('win-sliding', { mode: 'max', value: 3.4 })] });
  s.shell = T;
  const b = building({ name: 'Casa térrea', use: 'residential', levels: levelsFor(1, 2.8, 2.8), solids: [s] });
  const lv = b.levels[0]!.id;
  const x = W / 2 - T,
    z = D / 2 - T;
  addInteriorWall(b, lv, [1.2, -z], [1.2, z], 0.12, uid);
  addInteriorWall(b, lv, [1.2, 0], [x, 0], 0.12, uid);
  addInteriorWall(b, lv, [3.2, 0], [3.2, z], 0.12, uid);
  addInteriorWall(b, lv, [1.2, 1.3], [3.2, 1.3], 0.12, uid);
  roomsAt(b, lv, W, D, T, [
    { name: 'Sala e cozinha', at: [-3, 0] },
    { name: 'Quarto 1', at: [3.2, -2] },
    { name: 'Circulação', at: [2.2, 0.6] },
    { name: 'Banheiro', at: [2.2, 2.8] },
    { name: 'Quarto 2', at: [4.2, 2] },
  ]);
  // Every room opens on the living room or the hall.
  doorAt(b, lv, [1.2, -0.7], [2, -0.7]);
  doorAt(b, lv, [1.2, 0.65], [0, 0.65]);
  doorAt(b, lv, [3.2, 0.65], [4, 0.65]);
  doorAt(b, lv, [2.2, 1.3], [2.2, 2], 0.7);
  b.items.push(
    // Living and kitchen.
    free('sofa-3', -5.4, -2.2, 90),
    free('tv-unit', 0.89, -2.2, -90),
    free('table-dining', -2.6, 1.2),
    free('chair', -3.1, 0.45),
    free('chair', -2.1, 0.45),
    free('chair', -3.1, 1.95, 180),
    free('chair', -2.1, 1.95, 180),
    free('kitchen-counter', -3.6, 4.05, 180),
    free('stove', -2.05, 4.05, 180),
    free('fridge', -5.4, 4.0, 180),
    // Bedroom 1.
    free('bed-double', 2.31, -2.4, 90),
    free('wardrobe', 4.6, -0.36, 180),
    // Bathroom.
    free('toilet', 1.6, 3.0, 90),
    free('sink-vanity', 2.89, 2.4, -90),
    free('shower', 2.69, 3.9),
    // Bedroom 2.
    free('bed-single', 4.31, 2.8, 90),
    free('wardrobe', 4.94, 0.36),
    free('desk', 5.0, 4.05, 180),
  );
  return project({ name: 'Casa térrea', buildings: [b] });
}

/** Two-storey house, 8 × 10 m, gable roof. */
function townhouse(): Project3 {
  const plan = rectPlan(8, 10);
  const s = solid({ name: 'Paredes', plan: { outer: plan, holes: [] }, height: 5.8, roof: roofSpec('gable', { pitch: 30, overhang: 0.5 }), materials: tiles, facade: [facadeRule('door-panel', { levels: 'ground', edges: [plan[0]!.id], mode: 'count', value: 1 }), facadeRule('win-casement', { mode: 'max', value: 3 })] });
  s.shell = 0.15;
  return project({ name: 'Sobrado', buildings: [building({ name: 'Sobrado', use: 'residential', levels: levelsFor(2, 2.9, 2.9), solids: [s] })] });
}

/** Warehouse, 30 × 20 m, 9 m high, metal gable roof, loading doors. */
function warehouse(): Project3 {
  const plan = rectPlan(30, 20);
  const s = solid({ name: 'Galpão', plan: { outer: plan, holes: [] }, height: 9, roof: roofSpec('gable', { pitch: 10, overhang: 0.8 }), materials: { wall: mat('concrete', '#cfccc4'), roof: mat('metal', '#9aa3a6'), trim: mat('paint', '#e8e8e4'), base: mat('concrete', '#9a9893') }, facade: [facadeRule('loading-dock', { levels: 'ground', edges: [plan[0]!.id], mode: 'count', value: 3 }), facadeRule('win-industrial', { mode: 'max', value: 6 })] });
  return project({ name: 'Galpão', buildings: [building({ name: 'Galpão', use: 'industrial', levels: levelsFor(1, 9, 9), solids: [s] })] });
}

/** Apartment block, 16 × 12 m, ground floor and five upper floors, flat roof with parapet. */
function apartments(): Project3 {
  const plan = rectPlan(16, 12);
  const s = solid({ name: 'Torre', plan: { outer: plan, holes: [] }, height: 18.4, roof: roofSpec('flat', { parapet: 1 }), materials: { wall: mat('plaster', '#e9e4da'), roof: mat('membrane', '#8a8a88'), trim: mat('paint', '#ffffff'), base: mat('stone', '#8f8a80') }, facade: [facadeRule('door-glass', { levels: 'ground', edges: [plan[0]!.id], mode: 'count', value: 1 }), facadeRule('win-sliding', { levels: 'upper', mode: 'spacing', value: 2.6 })] });
  return project({ name: 'Prédio residencial', buildings: [building({ name: 'Prédio residencial', use: 'residential', levels: levelsFor(6, 2.9, 3.9), solids: [s] })] });
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Em branco', note: 'Terreno vazio para começar do zero', make: () => project({ name: 'Projeto sem título' }) },
  { id: 'house', name: 'Casa térrea', note: '12 × 9 m, 4 cômodos mobiliados, telhado de quatro águas', make: house },
  { id: 'townhouse', name: 'Sobrado', note: '8 × 10 m, 2 pavimentos, telhado de duas águas', make: townhouse },
  { id: 'warehouse', name: 'Galpão', note: '30 × 20 m, 9 m de altura, docas de carga', make: warehouse },
  { id: 'apartments', name: 'Prédio residencial', note: 'Térreo + 5 pavimentos, cobertura plana', make: apartments },
  { id: 'samples', name: 'Exemplos', note: 'Onze edifícios para explorar as ferramentas', make: () => project({ name: 'Exemplos', buildings: sampleBuildings() }) },
];
