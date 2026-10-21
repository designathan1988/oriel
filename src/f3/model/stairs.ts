// Stairs tied to the levels of a building: the flight between two floors as a free
// component, and the plan opening it needs in the slab above (so the caller can cut
// it). The rise comes from the elevation difference, the tread count from the
// family's own rule. Pure (no three).
import { uid } from './defaults';
import type { Building3, ID, Item, ParamValue, Vec2, Vec3 } from './schema';

/** Built-in type of the straight stair (families/stairs.ts). */
export const STAIR_TYPE = 'stair-straight';
/** Tread depth and largest riser the family is asked for (m), its own defaults. */
const GOING = 0.28;
const MAX_RISER = 0.18;
/** Default width of a flight (m). */
const WIDTH = 1.1;
/** Shortest flight worth placing (m). */
const MIN_RISE = 0.1;

/** A number parameter of an item, or `fallback` when it is missing. */
function num(v: ParamValue | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Risers a flight needs (the stair family's rule, families/stairs.ts: n = ⌈rise / max riser⌉; the model layer cannot import the families). */
const stairCount = (rise: number, maxRiser: number): number => Math.max(1, Math.ceil(rise / maxRiser - 1e-9));

/** Length of a flight (m): as many treads as the rise needs at the largest riser. */
export function stairRun(rise: number, going = GOING, maxRiser = MAX_RISER): number {
  return stairCount(rise, maxRiser) * going;
}

/**
 * Flight between two levels, hosted free at the floor of `fromLevel`: the rise is the
 * elevation difference, so moving a level moves the stair with it. The caller pushes
 * the item into the building.
 */
export function stairBetween(b: Building3, fromLevel: ID, toLevel: ID, at: Vec2, rot: number, width = WIDTH): Item {
  const from = b.levels.find((l) => l.id === fromLevel);
  const to = b.levels.find((l) => l.id === toLevel);
  const rise = Math.max(MIN_RISE, (to?.elevation ?? 0) - (from?.elevation ?? 0));
  return {
    id: uid(),
    type: STAIR_TYPE,
    params: { rise, width, going: GOING },
    host: { kind: 'free', p: [at[0], from?.elevation ?? 0, at[1]], rot },
  };
}

/**
 * Plan rectangle the stair occupies (building frame), for cutting the opening in the slab
 * above: the family builds the flight forward on its own +z, so the footprint starts at
 * the host and runs `run` along the flight (the caller gets that from `stairRun`).
 */
export function slabOpeningFor(item: Item, run: number): { outer: Vec2[] } {
  const host = item.host;
  const p: Vec3 = host.kind === 'free' ? host.p : [0, 0, 0];
  const rot = host.kind === 'free' ? host.rot : 0;
  const w = num(item.params.width, WIDTH);
  const c = Math.cos((rot * Math.PI) / 180),
    s = Math.sin((rot * Math.PI) / 180);
  // The same turn the view applies to a building (view.buildingMatrix): a Y rotation of `rot` degrees.
  const at = (x: number, z: number): Vec2 => [p[0] + x * c + z * s, p[2] - x * s + z * c];
  return { outer: [at(-w / 2, 0), at(w / 2, 0), at(w / 2, run), at(-w / 2, run)] };
}
