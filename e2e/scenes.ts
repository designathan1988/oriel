// Fixed scenes of the visual check (e2e/visual.spec.ts): a project built here from the same model
// code the editor uses, with ids from a counter (the same document on every run), and a camera.
import { building, facadeRule, levelsFor, mat, project, rectPlan, roofSpec, solid, uid } from '../src/f3/model/defaults';
import { FINISHES } from '../src/f3/render/finishes';
import { sampleBuildings } from '../src/f3/model/samples';
import type { Project3, ViewState } from '../src/f3/model/schema';

export interface Scene {
  name: string;
  /** What the picture shows (the test title). */
  what: string;
  project: Project3;
  camera: { theta: number; phi: number; zoom: number };
  /** A building selected by name (panels, handles, dimensions), or none. */
  select?: string;
}

/** Runs `make` with ids from a counter instead of crypto (ids are part of the saved document). */
function counted<T>(make: () => T): T {
  const c = globalThis.crypto as Crypto & { randomUUID: () => string };
  const real = c.randomUUID;
  let n = 0;
  Object.defineProperty(c, 'randomUUID', { value: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`, configurable: true, writable: true });
  try {
    return make();
  } finally {
    Object.defineProperty(c, 'randomUUID', { value: real, configurable: true, writable: true });
  }
}

const view = (v: Partial<ViewState> = {}): ViewState => ({ hiddenCategories: [], time: 13, ...v });
const only = (name: string) => sampleBuildings().filter((b) => b.name === name);

function tower20() {
  const s = solid({ plan: { outer: rectPlan(30, 30), holes: [] }, height: 3.4 + 19 * 3, roof: roofSpec('flat', { parapet: 1 }), facade: [facadeRule('win-casement', { mode: 'max', value: 3 }), facadeRule('balcony-glass', { levels: 'upper', mode: 'max', value: 6 })] });
  return building({ name: 'Tower', levels: levelsFor(20, 3, 3.4), solids: [s] });
}

/**
 * One block per finish of the editor (procedural and photographed), so no finish is left out of the
 * pictures: the samples use only some of them, and the photographed ones none (a change there passed
 * unseen). A new finish gets its block by itself.
 */
function finishBlocks() {
  return FINISHES.map((f, i) =>
    building({
      name: f.name,
      levels: levelsFor(1, 4, 4),
      solids: [solid({ plan: { outer: rectPlan(5, 5, (i % 6) * 7, Math.floor(i / 6) * 7), holes: [] }, height: 4, roof: roofSpec('flat'), materials: { wall: mat(f.id, '#c8bfae'), roof: mat(f.id, '#8f8a82'), trim: mat('paint', '#f4f1ea'), base: mat(f.id, '#b5ae9f') } })],
    }),
  );
}

/** Every planting type in rows (grown trees, shrubs, beds): the leaf cards, their atlas and the bark. */
export const PLANTS = ['tree-oak', 'tree-maple', 'tree-birch', 'tree-willow', 'tree-poplar', 'tree-cherry', 'tree-olive', 'tree-pine', 'tree-spruce', 'tree-fir', 'tree-cypress', 'palm-coconut', 'bush', 'bush-boxwood', 'bush-flowering', 'bush-upright', 'grass-pampas', 'grass-ornamental', 'fern', 'flower-bed', 'meadow', 'planter'];
/** Types laid out in rows of `cols`, `step` metres apart, as the free items of one building. */
function showroom(name: string, types: string[], step: number, cols = 6) {
  const rows = Math.ceil(types.length / cols);
  return building({
    name,
    levels: levelsFor(1),
    items: types.map((type, i) => ({ id: uid(), type, params: {}, host: { kind: 'free' as const, p: [((i % cols) - (cols - 1) / 2) * step, 0, (Math.floor(i / cols) - (rows - 1) / 2) * step] as [number, number, number], rot: 0 } })),
  });
}
export const garden = () => showroom('Garden', PLANTS, 9);

/** Every furniture and sanitary type (rounded boxes, lofted ceramics, soft edges, textured tops). */
export const FURNITURE = ['sofa-3', 'armchair', 'bed-double', 'table-dining', 'table-round', 'chair', 'desk', 'office-chair', 'kitchen-counter', 'wardrobe', 'bookshelf', 'tv-unit', 'toilet', 'sink-vanity', 'sink-pedestal', 'bathtub', 'fridge', 'stove'];

export const SCENES: Scene[] = counted(() => [
  { name: 'samples', what: 'the 11 samples at midday', project: project({ name: 'Samples', buildings: sampleBuildings(), view: view() }), camera: { theta: 0.75, phi: 0.95, zoom: 1 } },
  { name: 'night', what: 'the 11 samples at night (lit windows, bloom)', project: project({ name: 'Samples', buildings: sampleBuildings(), view: view({ time: 21 }) }), camera: { theta: 0.75, phi: 0.95, zoom: 1 } },
  { name: 'tower', what: 'a 20-floor tower close (800 windows, rooms behind the glass)', project: project({ name: 'Tower', buildings: [tower20()], view: view() }), camera: { theta: 0.55, phi: 1.2, zoom: 0.5 } },
  { name: 'close', what: 'house with tower up close (brick, tile, plaster textures)', project: project({ name: 'House', buildings: only('House with tower'), view: view() }), camera: { theta: 0.9, phi: 1.15, zoom: 0.6 } },
  { name: 'finishes', what: `every finish on its own block (${FINISHES.length}: procedural and photographed)`, project: project({ name: 'Finishes', buildings: finishBlocks(), view: view() }), camera: { theta: 0.75, phi: 1.0, zoom: 0.95 } },
  { name: 'cutaway', what: 'courtyard block in cutaway (walls cut away, roofs hidden)', project: project({ name: 'Cutaway', buildings: only('Courtyard block'), view: view({ hiddenBody: ['walls', 'roofs'] }) }), camera: { theta: 0.75, phi: 0.85, zoom: 1 } },
  { name: 'exploded', what: 'curved building with its floors apart', project: project({ name: 'Exploded', buildings: only('Curved building'), view: view({ explode: 4 }) }), camera: { theta: 0.75, phi: 1.0, zoom: 1 } },
  { name: 'garden', what: `every planting type (${PLANTS.length}: grown trees, shrubs, grasses, beds)`, project: project({ name: 'Garden', buildings: [garden()], view: view() }), camera: { theta: 0.6, phi: 1.1, zoom: 0.62 } },
  { name: 'furniture', what: `every furniture and sanitary type (${FURNITURE.length})`, project: project({ name: 'Furniture', buildings: [showroom('Furniture', FURNITURE, 3, 9)], view: view() }), camera: { theta: 0.6, phi: 0.95, zoom: 0.8 } },
  { name: 'selected', what: 'a building selected: panel, contextual bar, handles and dimensions', project: project({ name: 'Samples', buildings: sampleBuildings(), view: view() }), camera: { theta: 0.75, phi: 0.95, zoom: 1 }, select: 'Courtyard block' },
]);
