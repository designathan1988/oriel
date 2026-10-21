// Layers and visibility (like SketchUp Tags, Rhino layers and Revit
// Visibility/Graphics). Hidden and locked only apply to the view:
// saving and exporting take everything. A hidden cutter keeps cutting (like the
// hidden cutter object of the Blender Boolean). No three.
import type { Building3, ID, Item, Layer, Project3, Solid, ViewState } from './schema';
import { uid } from './defaults';

/** Layer of whatever has no layer (SketchUp's "Untagged"). */
export const DEFAULT_LAYER: Layer = { id: 'padrao', name: 'Default', color: '#9aa3ad', visible: true, locked: false };

export const LAYER_COLORS = ['#e07a3f', '#3f8fe0', '#4fae6a', '#b05cc8', '#d6b440', '#d0566b', '#3fb8b0', '#7d6cd8'];

export function layersOf(p: Project3): Layer[] {
  const list = p.layers ?? [];
  return list.some((l) => l.id === DEFAULT_LAYER.id) ? list : [{ ...DEFAULT_LAYER }, ...list];
}

/** Ensures the list in the project (with the default layer) and returns it for editing. */
export function ensureLayers(p: Project3): Layer[] {
  if (!p.layers || !p.layers.some((l) => l.id === DEFAULT_LAYER.id)) p.layers = [{ ...DEFAULT_LAYER }, ...(p.layers ?? [])];
  return p.layers;
}

export function viewOf(p: Project3): ViewState {
  return (p.view ??= { hiddenCategories: [] });
}

export function layerById(p: Project3, id: ID | undefined): Layer {
  return layersOf(p).find((l) => l.id === (id ?? DEFAULT_LAYER.id)) ?? layersOf(p)[0]!;
}

export function addLayer(p: Project3, name?: string): Layer {
  const list = ensureLayers(p);
  const l: Layer = { id: uid(), name: name ?? `Layer ${list.length}`, color: LAYER_COLORS[(list.length - 1) % LAYER_COLORS.length]!, visible: true, locked: false };
  list.push(l);
  return l;
}

/** Deletes the layer; what was on it goes back to the default one. */
export function removeLayer(p: Project3, id: ID): boolean {
  if (id === DEFAULT_LAYER.id) return false;
  const list = ensureLayers(p);
  const i = list.findIndex((l) => l.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  for (const b of p.buildings) {
    if (b.layer === id) delete b.layer;
    for (const s of b.solids) if (s.layer === id) delete s.layer;
    for (const it of b.items) if (it.layer === id) delete it.layer;
  }
  const v = viewOf(p);
  if (v.activeLayer === id) delete v.activeLayer;
  return true;
}

/** Layer that receives what is created (undefined = default). */
export function activeLayer(p: Project3): ID | undefined {
  const id = p.view?.activeLayer;
  return id && id !== DEFAULT_LAYER.id && layersOf(p).some((l) => l.id === id) ? id : undefined;
}

export const buildingHidden = (p: Project3, b: Building3) => !!b.hidden || !layerById(p, b.layer).visible;
export const buildingLocked = (p: Project3, b: Building3) => !!b.locked || layerById(p, b.layer).locked;
/** Hidden by the phase filter: the existing state leaves out the new work, the proposal what is demolished. */
export const phaseHidden = (p: Project3, phase: 'existing' | 'demolished' | undefined): boolean => (p.view?.phases === 'existing' ? !phase : p.view?.phases === 'proposal' ? phase === 'demolished' : false);
export const solidHidden = (p: Project3, s: Solid) => !!s.hidden || !layerById(p, s.layer).visible || phaseHidden(p, s.phase);
export const solidLocked = (p: Project3, s: Solid) => !!s.locked || layerById(p, s.layer).locked;
export const itemHidden = (p: Project3, it: Item) => !!it.hidden || !layerById(p, it.layer).visible || phaseHidden(p, it.phase);
export const itemLocked = (p: Project3, it: Item) => !!it.locked || layerById(p, it.layer).locked;

/** Parts of the building body the view can hide (the interior view hollows the building). */
export type BodyCategory = 'walls' | 'innerWalls' | 'roofs' | 'floors' | 'ceilings';
export const BODY_CATEGORIES: [BodyCategory, string][] = [
  ['walls', 'Exterior walls'],
  ['innerWalls', 'Interior walls'],
  ['roofs', 'Roofs'],
  ['floors', 'Floors and slabs'],
  ['ceilings', 'Ceilings'],
];

export const bodyHidden = (p: Project3, c: BodyCategory) => !!p.view?.hiddenBody?.includes(c);

/** The view needs hollow buildings: a body part is hidden or the building is cut by floor. */
export const interiorView = (p: Project3) => !!p.view?.hiddenBody?.length || p.view?.cutLevel !== undefined || explodeGap(p) > 0 || !!p.view?.section;

/** Gap between exploded floors (0 = not exploded). */
export const explodeGap = (p: Project3) => Math.max(0, p.view?.explode ?? 0);

/** Floors evaluated one by one (exploded, or a single floor shown). */
export const bandedView = (p: Project3) => explodeGap(p) > 0 || (p.view?.cutLevel !== undefined && !!p.view?.onlyLevel);

export function categoryHidden(p: Project3, category: string): boolean {
  return !!p.view?.hiddenCategories.includes(category);
}

/** Key of what changes the evaluation (visible layers) and of what changes only the parts (categories). */
export function visibilityKeys(p: Project3): { solids: string; parts: string; body: string } {
  const layers =
    layersOf(p)
      .map((l) => `${l.id}:${l.visible ? 1 : 0}`)
      .join(',') + `|${p.view?.phases ?? ''}`;
  return {
    solids: `${layers}|${interiorView(p) ? 'hollow' : 'solid'}|${p.view?.cutLevel ?? ''}|${bandedView(p) ? 'bands' : ''}|${p.view?.onlyLevel ? 'only' : ''}|${bodyHidden(p, 'walls') ? 'nowalls' : ''}`,
    // Hidden categories are not here: they switch meshes on and off (PartsMesh.setHidden), nothing is built.
    parts: `${layers}|${(p.view?.hiddenBody ?? []).join(',')}|${p.view?.onlyLevel ? 'only' : ''}`,
    body: `${(p.view?.hiddenBody ?? []).join(',')}|${p.view?.onlyLevel ? 'only' : ''}`,
  };
}
