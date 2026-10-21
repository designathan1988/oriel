// Quick building tools: floors, top setback, podium,
// courtyard and facade presets. They operate on the document (no three).
import type { Building3, BuildingUse, FacadeRule, Level, MaterialRef, RoofKind, Solid, Vec2 } from './schema';
import { facadeRule, levelsFor, planVertices, roofSpec, solid, uid } from './defaults';
import { offsetRing, oriented, ringValid, sampleRing, signedArea2 } from './plan';
import { levelsUpTo } from './modeling';
import { resolveBuilding } from './relations';
import { inside, planCenter } from './ops';

const levelsSorted = (b: Building3) => [...b.levels].sort((p, q) => p.elevation - q.elevation);
/** A floor name the editor wrote (it follows the numbering); any other was given by the user. */
const DEFAULT_LEVEL_NAME = /^(Ground|Floor \d+|Térreo|\d+º pavimento)$/;

/** Interiors hang on a floor by its ID: those of floors that are gone go too (a saved file refuses an interior on a missing level). */
function pruneInteriors(b: Building3): void {
  const ids = new Set(b.levels.map((l) => l.id));
  for (const id of Object.keys(b.interiors ?? {})) if (!ids.has(id)) delete b.interiors[id];
}

/**
 * New floors that stay the same floors: floor i keeps the ID (and a name the user
 * gave) of the old floor i, so what hangs on it stays; floors past the old count
 * are new, and those that are gone take their interiors with them.
 */
export function adoptLevels(b: Building3, next: Level[]): void {
  const old = levelsSorted(b);
  next.forEach((l, i) => {
    const o = old[i];
    if (!o) return;
    l.id = o.id;
    if (o.name && !DEFAULT_LEVEL_NAME.test(o.name)) l.name = o.name;
  });
  b.levels = next;
  pruneInteriors(b);
}
const topOf = (b: Building3) => {
  const lv = levelsSorted(b);
  const last = lv[lv.length - 1];
  return last ? last.elevation + last.height : 0;
};

/**
 * Possible tops for a volume rising floor by floor: the top of each floor above
 * the base and, past the last one, more floors of the typical height (up to 60
 * in the building).
 */
export function floorTops(b: Building3, base: number): number[] {
  const lv = levelsSorted(b);
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  const tops = lv.map((l) => l.elevation + l.height).filter((t) => t > base + 0.3);
  let t = topOf(b);
  for (let i = lv.length; i < 60; i++) {
    t += typ;
    if (t > base + 0.3) tops.push(t);
  }
  return tops;
}

/** The floor top closest to `want` (at least one floor above the base). */
export function snapToFloor(b: Building3, base: number, want: number): number {
  const tops = floorTops(b, base);
  let best = tops[0] ?? base + 3;
  for (const t of tops) if (Math.abs(t - want) < Math.abs(best - want)) best = t;
  return best;
}

/** How many floors a volume spans. */
export function floorsIn(b: Building3, s: Solid): number {
  return b.levels.filter((l) => l.elevation >= s.base - 0.05 && l.elevation < s.base + s.height - 0.05).length;
}

/**
 * Adds (delta > 0) or removes (delta < 0) floors on the building body: the
 * tallest volume standing on the ground grows (or shrinks) floor by floor and
 * everything on top of it (setback, crown, roof) moves along. It never goes
 * below the ground floor; the remaining floors keep their ID.
 */
export function changeLevels(b: Building3, delta: number): boolean {
  const lv = levelsSorted(b);
  if (!lv.length || !delta) return false;
  const typ = lv[1]?.height ?? lv[0]?.height ?? 3;
  const add = b.solids.filter((x) => x.op === 'add');
  const ground = add.filter((x) => x.base < 0.05);
  const pool = ground.length ? ground : add;
  // Where floors go in: at the top of the body, rounded to the nearest floor boundary.
  const bodyTop = pool.length ? Math.max(...pool.map((x) => x.base + x.height)) : topOf(b);
  const bounds = [...lv.map((l) => l.elevation), topOf(b)];
  let j = 0;
  bounds.forEach((y, i) => {
    if (Math.abs(y - bodyTop) < Math.abs(bounds[j]! - bodyTop)) j = i;
  });
  const E = bounds[j]!;
  let D: number;
  if (delta > 0) {
    if (lv.length + delta > 60) return false;
    D = delta * typ;
    const fresh = Array.from({ length: delta }, (_, i) => ({ id: uid(), name: '', elevation: E + i * typ, height: typ }));
    for (const l of lv.slice(j)) l.elevation += D;
    lv.splice(j, 0, ...fresh);
  } else {
    // Removes the floors right below the boundary, without touching the ground floor.
    const k = Math.min(-delta, j - 1);
    if (k < 1) return false;
    const gone = lv.splice(j - k, k);
    D = -gone.reduce((a, l) => a + l.height, 0);
    for (const l of lv.slice(j - k)) l.elevation += D;
  }
  // Default names follow the numbering; a name given by the user stays.
  lv.forEach((l, i) => {
    if (!l.name || DEFAULT_LEVEL_NAME.test(l.name)) l.name = i === 0 ? 'Ground' : `Floor ${i}`;
  });
  b.levels = lv;
  pruneInteriors(b);
  // What grows and what moves up is decided by the real top of the body (it may not fall on a boundary).
  const T = Math.min(E, bodyTop);
  for (const x of b.solids) {
    if (x.base >= T - 0.05) x.base += D;
    else if (x.base + x.height >= T - 0.05) x.height = Math.max(0.5, x.height + D);
  }
  return true;
}

/** Top setback: a set-back volume on the solid; the one below becomes a terrace. */
export function setbackOn(b: Building3, s: Solid, inset = 2, levels = 1): Solid | null {
  const r = sampleRing(oriented(s.plan.outer, 1));
  const top = offsetRing(r.pts, r.pts.map(() => inset + s.taper));
  if (!ringValid(top, 1)) return null;
  const typ = levelsSorted(b)[1]?.height ?? 3;
  const n = solid({
    name: `${s.name} (setback)`,
    plan: { outer: planVertices(top), holes: [] },
    base: s.base + s.height,
    height: typ * levels,
    roof: structuredClone(s.roof.kind === 'terrace' ? roofSpec('flat') : s.roof),
    // The setback is an upper floor: ground floor rules (doors, shops) stay on the volume below.
    facade: s.facade.filter((f) => f.levels !== 'ground').map((f) => ({ ...structuredClone(f), id: uid(), edges: [], except: {} })),
    materials: structuredClone(s.materials),
    plinth: 0,
  });
  s.roof = roofSpec('terrace');
  b.solids.push(n);
  // New levels without stretching anything (the volume below keeps its height).
  levelsUpTo(b, n.base + n.height);
  return n;
}

/** Podium: a wider base on the ground floor, with shops, joined to the building. */
export function podiumUnder(b: Building3, s: Solid, grow = 2.5): Solid | null {
  const r = sampleRing(oriented(s.plan.outer, 1));
  const ring = offsetRing(r.pts, r.pts.map(() => -grow));
  if (!ringValid(ring, 1)) return null;
  const ground = levelsSorted(b)[0]?.height ?? 3.4;
  const n = solid({
    name: 'Podium',
    plan: { outer: planVertices(ring), holes: [] },
    base: 0,
    height: ground,
    roof: roofSpec('terrace'),
    facade: [facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 5, margin: 0.6 })],
    materials: { ...structuredClone(s.materials), wall: { finish: 'stone', color: '#b9b1a3' } },
  });
  b.solids.unshift(n);
  // A volume no taller than the podium would vanish inside it: it stands on the podium instead (one floor more).
  if (s.base + s.height <= ground + 0.3) {
    s.base += ground;
    levelsUpTo(b, s.base + s.height);
  }
  // The rules of the upper volume stop placing windows on the ground floor (now it is the podium).
  for (const f of s.facade) if (f.levels === 'all') f.levels = 'upper';
  return n;
}

/** Courtyard: a cut in the middle of the volume, set back `margin` from the edges. */
export function courtyardIn(b: Building3, s: Solid, margin = 6): Solid | null {
  const r = sampleRing(oriented(s.plan.outer, 1));
  // The wing depth fits the plan (6 m on a big block, less on a smaller or irregular one: before, a 17 m
  // hexagon said it was too small), down to 3 m wings and a 3 × 3 m courtyard.
  // The wings take about half of the plan's inradius (2·area / perimeter), at most `margin`.
  const per = r.pts.reduce((acc, p, i) => acc + Math.hypot(r.pts[(i + 1) % r.pts.length]![0] - p[0], r.pts[(i + 1) % r.pts.length]![1] - p[1]), 0);
  const inradius = Math.abs(signedArea2(r.pts)) / (per || 1);
  let ring: Vec2[] | null = null;
  for (let m = Math.min(margin, Math.max(3, Math.round(inradius * 0.45 * 2) / 2)); m >= 3 - 1e-9 && !ring; m -= 0.5) {
    const o = offsetRing(r.pts, r.pts.map(() => m));
    if (ringValid(o, 1) && Math.abs(signedArea2(o)) / 2 >= 9) ring = o;
  }
  if (!ring) return null;
  const n = solid({ name: 'Courtyard', op: 'subtract', plan: { outer: planVertices(ring), holes: [] }, base: s.base + (levelsSorted(b)[0]?.height ?? 0) * 0, height: s.height + 2, roof: roofSpec('flat', { parapet: 0 }), plinth: 0 });
  n.base = s.base - 0.5;
  b.solids.push(n);
  return n;
}

/**
 * Front side of a volume: that of the existing door (a door rule with a chosen
 * side) or the longest straight side facing the front (+z).
 */
export function frontEdge(s: Solid): string | undefined {
  const door = s.facade.find((f) => f.mode === 'count' && f.edges.length);
  if (door) return door.edges[0];
  const r = sampleRing(oriented(s.plan.outer, 1));
  let best: { id: string; score: number } | undefined;
  r.segs.forEach((seg, i) => {
    if (seg.edge.endsWith(':c') || seg.curved) return;
    const a = r.pts[i]!,
      b = r.pts[(i + 1) % r.pts.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Outward normal (counterclockwise ring): (dz, −dx)/l; prefer the one facing +z.
    const nz = -(b[0] - a[0]) / (l || 1);
    const score = l * (1.5 + nz);
    if (!best || score > best.score + 1e-6) best = { id: seg.edge, score };
  });
  return best?.id;
}

/** Rules of a facade preset for the volume (the door only on the front side). */
export function presetRules(id: string, s: Solid): FacadeRule[] {
  const pr = FACADE_PRESETS.find((f) => f.id === id);
  if (!pr) return s.facade;
  const front = frontEdge(s);
  return pr.rules().map((r) => (r.mode === 'count' && r.levels === 'ground' && front ? { ...r, edges: [front] } : r));
}

export const FACADE_PRESETS: { id: string; name: string; rules: () => FacadeRule[] }[] = [
  { id: 'res', name: 'Residential', rules: () => [facadeRule('door-panel', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-casement', { mode: 'max', value: 3 })] },
  { id: 'com', name: 'Commercial', rules: () => [facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 5, margin: 0.6 }), facadeRule('win-sliding', { levels: 'upper', mode: 'spacing', value: 2.4 })] },
  { id: 'off', name: 'Offices', rules: () => [facadeRule('door-glass', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-ribbon', { mode: 'max', value: 5, margin: 0.4 })] },
  { id: 'col', name: 'Colonial', rules: () => [facadeRule('door-arched', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-sash', { mode: 'spacing', value: 2.6 })] },
  { id: 'mod', name: 'Modern', rules: () => [facadeRule('door-glass', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-tall', { mode: 'spacing', value: 2.2 })] },
  { id: 'bal', name: 'With balconies', rules: () => [facadeRule('door-double', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-casement', { levels: 'ground', mode: 'max', value: 3 }), facadeRule('balcony-glass', { levels: 'upper', mode: 'max', value: 3.6 })] },
  { id: 'ind', name: 'Industrial', rules: () => [facadeRule('loading-dock', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-industrial', { mode: 'max', value: 4.5 })] },
  { id: 'blank', name: 'Blank (no openings)', rules: () => [] },
];

/**
 * New floor heights (count, ground, others); the floors keep their IDs. What stands on
 * the floors follows them through its relations (model/relations.ts): a volume whose top
 * is on a floor slab stays on it, one that rose above the roof keeps the same height above
 * it (Revit Top Offset), and what rests on another volume goes up and down with it. Before,
 * every elevation was remapped in proportion, so the height above the last floor grew by
 * the floor ratio and nobody could tell why.
 */
export function setLevelHeights(b: Building3, n: number, ground: number, typical: number): void {
  // Relations for a building that never went through the store (a model call alone).
  resolveBuilding(b, undefined, uid);
  const before = structuredClone(b);
  adoptLevels(b, levelsFor(n, typical, ground));
  resolveBuilding(b, before, uid);
}

/** One floor's height (floor to floor); the floors above move with it, and so do the volumes tied to them. */
export function setOneLevelHeight(b: Building3, index: number, height: number): void {
  resolveBuilding(b, undefined, uid);
  const before = structuredClone(b);
  const lv = levelsSorted(b).map((l) => ({ ...l }));
  if (!lv[index]) return;
  lv[index]!.height = height;
  let e = lv[0]!.elevation;
  for (const l of lv) {
    l.elevation = Math.round(e * 1e4) / 1e4;
    e += l.height;
  }
  b.levels = lv;
  resolveBuilding(b, before, uid);
}

/**
 * Floors of a building that has only the volume just drawn: as many floors of at least
 * 3 m as fit the height, all the same, filling it exactly (a 3 m house is one 3 m floor,
 * not a 3.4 m floor in a 3 m wall; 25 m are eight floors of 3.125 m).
 */
export function fillLevels(b: Building3, height: number): void {
  // A shed (industrial use) is one tall floor up to 12 m; the other uses get floors of at least 3 m.
  const n = b.use === 'industrial' ? Math.max(1, Math.ceil(height / 12 - 1e-6)) : Math.max(1, Math.min(60, Math.floor(height / 3 + 1e-6)));
  const h = Math.round((height / n) * 1e4) / 1e4;
  adoptLevels(b, levelsFor(n, h, h));
}

/**
 * What each use changes in the building. Floor-to-floor heights from the CTBUH
 * height calculator (office 3.9 m, residential 3.1 m, mixed 3.5 m; a taller
 * ground floor with shops, lobby or shed); ground floor and windows from the facade presets.
 */
export const USE_PRESETS: Record<BuildingUse, { name: string; ground: number; typical: number; groundRule: () => FacadeRule; window: string }> = {
  residential: { name: 'Residential', ground: 3.1, typical: 3.1, groundRule: () => facadeRule('door-panel', { levels: 'ground', mode: 'count', value: 1 }), window: 'win-casement' },
  commercial: { name: 'Commercial', ground: 4.5, typical: 3.9, groundRule: () => facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 5, margin: 0.6 }), window: 'win-sliding' },
  industrial: { name: 'Industrial', ground: 6, typical: 4.5, groundRule: () => facadeRule('loading-dock', { levels: 'ground', mode: 'count', value: 1 }), window: 'win-industrial' },
  public: { name: 'Public', ground: 4.5, typical: 3.9, groundRule: () => facadeRule('door-glass', { levels: 'ground', mode: 'count', value: 1 }), window: 'win-tall' },
  mixed: { name: 'Mixed', ground: 4.5, typical: 3.1, groundRule: () => facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 5, margin: 0.6 }), window: 'win-casement' },
};

/**
 * Changes the building use and applies what it implies: ground and other floor
 * heights (volumes reaching the top of the floors follow), the ground floor rule
 * of each volume with a facade (door, shopfront, dock) and the window type.
 * Free parts, balconies and rules of other types stay as they are. `isWindow`
 * says whether a type is a window. Returns what changed, for the toast.
 */
export function applyUse(b: Building3, use: BuildingUse, isWindow: (type: string) => boolean): string {
  const pr = USE_PRESETS[use];
  b.use = use;
  const lv = levelsSorted(b);
  const tall = () => Math.max(0, ...b.solids.filter((x) => x.op === 'add').map((x) => x.base + x.height));
  const h0 = tall();
  // A shed up to 12 m is one tall floor of its own height (audit C1: an 8 m shed became 6 + 4.5 m, its
  // height changed); a taller industrial building gets the industrial floor heights. The shed is the main
  // body: the ground volume with the largest plan (a tower beside the roof is not the shed).
  const area = (x: Building3['solids'][number]) => Math.abs(signedArea2(sampleRing(oriented(x.plan.outer, 1)).pts)) / 2;
  const main = b.solids.filter((x) => x.op === 'add' && x.base < 0.05).sort((p, q) => area(q) - area(p))[0];
  const floorsTop = main ? main.base + main.height : lv.length ? lv[lv.length - 1]!.elevation + lv[lv.length - 1]!.height : h0;
  const shed = use === 'industrial' && floorsTop > 0 && floorsTop <= 12.05;
  if (shed) setLevelHeights(b, 1, floorsTop, floorsTop);
  else if (lv.length) setLevelHeights(b, lv.length, pr.ground, pr.typical);
  const h1 = tall();
  let facades = 0;
  for (const so of b.solids) {
    if (so.op !== 'add' || !so.facade.length) continue;
    // This use's ground floor: the previous ground rule goes, the new one comes in (door at the front).
    const g = pr.groundRule();
    const front = frontEdge(so);
    if (g.mode === 'count' && front) g.edges = [front];
    so.facade = [g, ...so.facade.filter((r) => r.levels !== 'ground')];
    for (const r of so.facade) if (r !== g && isWindow(r.type)) r.type = pr.window;
    facades++;
  }
  // The height follows the floors: the message says so (before, 25 m became 32.58 m without a word).
  const lvTxt = shed ? `one floor of ${+floorsTop.toFixed(2)} m` : lv.length ? `ground ${pr.ground} m, others ${pr.typical} m${Math.abs(h1 - h0) > 0.005 ? `, height ${+h0.toFixed(2)} → ${+h1.toFixed(2)} m` : ''}` : '';
  // Sentences the dictionary has patterns for (the floors part is translated inside them).
  return [`Use: ${pr.name}.`, lvTxt ? `${lvTxt[0]!.toUpperCase()}${lvTxt.slice(1)}.` : '', facades ? `Facade of ${facades} volume(s) adjusted.` : '', 'Ctrl+Z undoes.'].filter(Boolean).join(' ');
}

/** Building styles (the style packs of styles/builtin.ts, as presets for forma/3 volumes). */
export const BUILDING_STYLES: { id: string; name: string; facade: string; wall: MaterialRef; roof: MaterialRef; trim: MaterialRef; roofKind: RoofKind }[] = [
  { id: 'colonial', name: 'Colonial', facade: 'col', wall: { finish: 'plaster', color: '#f2ede2' }, roof: { finish: 'tile', color: '#b0603b' }, trim: { finish: 'paint', color: '#2f5d8a' }, roofKind: 'hip' },
  { id: 'modern', name: 'Modern', facade: 'mod', wall: { finish: 'concrete', color: '#d3d1cc' }, roof: { finish: 'membrane', color: '#8a8d90' }, trim: { finish: 'metal', color: '#2a2d2f' }, roofKind: 'flat' },
  { id: 'artdeco', name: 'Art deco', facade: 'res', wall: { finish: 'plaster', color: '#e6d9bf' }, roof: { finish: 'membrane', color: '#8a8d90' }, trim: { finish: 'paint', color: '#5d4d36' }, roofKind: 'flat' },
  { id: 'industrial', name: 'Industrial', facade: 'ind', wall: { finish: 'brick', color: '#a65a40' }, roof: { finish: 'metal', color: '#6f777a' }, trim: { finish: 'metal', color: '#33393b' }, roofKind: 'sawtooth' },
  { id: 'commercial', name: 'Commercial', facade: 'com', wall: { finish: 'plaster', color: '#c7b29c' }, roof: { finish: 'membrane', color: '#8a8d90' }, trim: { finish: 'paint', color: '#3b3f40' }, roofKind: 'flat' },
  { id: 'tower', name: 'Metal and glass', facade: 'off', wall: { finish: 'metal', color: '#4d5a60' }, roof: { finish: 'membrane', color: '#7d8285' }, trim: { finish: 'metal', color: '#9aa3a6' }, roofKind: 'flat' },
];

/** Applies a style to every adding volume of the building: wall, roof and trim finishes, roof kind, facade rules. */
export function applyStyle(b: Building3, id: string): string {
  const st = BUILDING_STYLES.find((x) => x.id === id);
  if (!st) return '';
  for (const s of b.solids) {
    if (s.op !== 'add') continue;
    s.materials.wall = structuredClone(st.wall);
    s.materials.roof = structuredClone(st.roof);
    s.materials.trim = structuredClone(st.trim);
    // A tall volume keeps a flat roof whatever the style (a hip roof on a tower reads wrong).
    // …and so does a volume with a courtyard or a cut in it (a pitched roof would bridge the courtyard).
    const cut = b.solids.some((c) => c.op === 'subtract');
    s.roof.kind = (s.height > 15 || cut) && st.roofKind !== 'flat' ? 'flat' : st.roofKind;
    if (s.roof.kind === 'flat') s.roof.parapet = s.roof.parapet || 0.6;
    else s.roof.overhang = s.roof.overhang || 0.5;
    for (const e of Object.values(s.edges)) delete e.material;
    s.facade = presetRules(st.facade, s);
  }
  return `${st.name} style: finishes, roof and facade of every volume.`;
}
