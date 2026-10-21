// Selection commands that do not depend on the view (docs/SELECTION.md):
// select all / invert in the current context (Blender A, Ctrl+I), select similar
// (Blender Select Grouped by type) and named selection sets kept in the project
// (Revit Save/Load Selection: a recalled set drops what no longer exists). No three.
import type { Building3, ID, Project3, SelectionSet, Solid } from './schema';
import { buildingHidden, buildingLocked, solidHidden, solidLocked } from './layers';
import { uid } from './defaults';

/** Buildings that can be picked (visible and not locked). */
export function pickableBuildings(p: Project3): Building3[] {
  return p.buildings.filter((b) => !buildingHidden(p, b) && !buildingLocked(p, b));
}

/** Volumes of a building that can be picked. */
export function pickableSolids(p: Project3, b: Building3): Solid[] {
  return b.solids.filter((s) => !solidHidden(p, s) && !solidLocked(p, s));
}

/** Everything of `all` that is not in `cur`, in the order of `all`. */
export function invert<T>(all: readonly T[], cur: readonly T[]): T[] {
  const s = new Set(cur);
  return all.filter((x) => !s.has(x));
}

/** Buildings with the same use as the reference ones. */
export function similarBuildings(p: Project3, ref: readonly ID[]): ID[] {
  const uses = new Set(p.buildings.filter((b) => ref.includes(b.id)).map((b) => b.use));
  return pickableBuildings(p).filter((b) => uses.has(b.use)).map((b) => b.id);
}

/** Shape signature of a volume: operation, number of corners, height (cm). */
const shapeOf = (s: Solid) => `${s.op}|${s.plan.outer.length}|${s.plan.holes.length}|${Math.round(s.height * 100)}`;

/** Volumes of the building with the same operation, number of corners and height as the reference ones. */
export function similarSolids(p: Project3, b: Building3, ref: readonly ID[]): ID[] {
  const shapes = new Set(b.solids.filter((s) => ref.includes(s.id)).map(shapeOf));
  return pickableSolids(p, b).filter((s) => shapes.has(shapeOf(s))).map((s) => s.id);
}

/** What a set keeps of a selection. */
export type SetContent = SelectionSet['sel'];

/** Saves a named set (a repeated name replaces the old set, like saving over it). */
export function saveSet(p: Project3, name: string, sel: SetContent): SelectionSet {
  const list = (p.selectionSets ??= []);
  const old = list.find((x) => x.name === name);
  const set: SelectionSet = { id: old?.id ?? uid(), name, sel: structuredClone(sel) };
  if (old) list[list.indexOf(old)] = set;
  else list.push(set);
  return set;
}

/** Next free default name ("Set 1", "Set 2"…). */
export function nextSetName(p: Project3): string {
  const names = new Set((p.selectionSets ?? []).map((s) => s.name));
  let i = 1;
  while (names.has(`Set ${i}`)) i++;
  return `Set ${i}`;
}

/** The set's selection with only what still exists (and can be picked); null if nothing is left. */
export function recallSet(p: Project3, set: SelectionSet): SetContent | null {
  const ok = new Set(pickableBuildings(p).map((b) => b.id));
  const s = set.sel;
  if (s.building === null) return null;
  const b = p.buildings.find((x) => x.id === s.building);
  if (!b || !ok.has(b.id)) {
    // The main building is gone: the next surviving one leads (only a building set can do that).
    const rest = s.others.filter((id) => ok.has(id));
    return rest.length && !s.solids.length && !s.elems.length && !s.item ? { building: rest[0]!, others: rest.slice(1), solids: [], elems: [], item: null } : null;
  }
  const solids = s.solids.filter((id) => pickableSolids(p, b).some((x) => x.id === id));
  const item = s.item && b.items.some((x) => x.id === s.item) ? s.item : null;
  // Elements are keys into the facade rules: a key whose volume is gone is dropped.
  const elems = s.elems.filter((k) => (k.startsWith('i|') ? b.items.some((x) => x.id === k.split('|')[1]) : b.solids.some((x) => x.id === k.split('|')[1])));
  const others = s.others.filter((id) => ok.has(id));
  if ((s.solids.length && !solids.length) || (s.elems.length && !elems.length)) return null;
  return { building: b.id, others, solids, elems, item };
}
