// Facade: the visible part of each side (after the booleans) defines where
// components fit. Facade rules distribute types per level with four
// modes (fixed distance, max spacing, count, fit), like the curtain wall
// of Revit and Archicad; free occurrences attached to a face use the
// same frame. No three.
import type { Building3, ComponentType, FacadeRule, Item, LevelPick, Project3, Solid, Vec2, Vec3 } from '../model/schema';
import { keyParts, pickLevels, solidLevels } from '../model/levelpick';
import { topRing } from '../model/ops';
import { offsetRing } from '../model/plan';
export { pickLevels, solidLevels };
import type { Family, Opening, Params } from '../families/family';
import { resolveParams } from '../families/family';
import { family, typeById } from '../families/index';
import type { FaceFrame, FaceInfo } from './faces';
import type { Shell } from './evaluate';
import { faceMatrix, mul, rotationYXZ, translation, type M4, type PartTag } from './parts';

/** Visible side of a solid in unrolled coordinates (s along, y up the face). */
export interface EdgeRegion {
  solid: string;
  edge: string;
  /** Visible triangles [s, y] (unrolled). */
  tris: Vec2[][];
  /** Side segments, in s order. */
  segs: FaceFrame[];
  length: number;
  bbox: { s0: number; s1: number; y0: number; y1: number };
}

export interface Placement {
  family: Family;
  params: Params;
  /** Part frame (right-handed): origin at the base center, x to the right of a viewer facing the face, y up, z outward. */
  frame: M4;
  opening: Opening | null;
  tag: PartTag;
  length: number;
  /** Face point (for selection) and source side. */
  host?: { solid: string; edge: string; s: number; y: number };
  path?: Vec3[];
}

const key = (solid: string, edge: string) => `${solid}|${edge}`;

/** Groups the visible triangles by side. */
export function edgeRegions(shell: Shell, faces: FaceInfo[]): Map<string, EdgeRegion> {
  const out = new Map<string, EdgeRegion>();
  const P = shell.positions,
    I = shell.indices;
  for (let t = 0; t < I.length / 3; t++) {
    const f = faces[shell.faceOf[t]!];
    // Rounded and chamfered corners are sides too (`<vertex>:c`): a rule takes them when a part fits
    // (audit D27: the arc of a rounded corner never got a window).
    if (!f || f.kind !== 'side' || !f.frame || !f.edge) continue;
    const k = key(f.solid, f.edge);
    let r = out.get(k);
    if (!r) out.set(k, (r = { solid: f.solid, edge: f.edge, tris: [], segs: [], length: 0, bbox: { s0: Infinity, s1: -Infinity, y0: Infinity, y1: -Infinity } }));
    if (!r.segs.includes(f.frame)) r.segs.push(f.frame);
    const fr = f.frame;
    const tri: Vec2[] = [];
    for (let j = 0; j < 3; j++) {
      const i = I[t * 3 + j]! * 3;
      const dx = P[i]! - fr.o[0],
        dy = P[i + 1]! - fr.o[1],
        dz = P[i + 2]! - fr.o[2];
      const s = fr.s0 + dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2];
      const y = dx * fr.v[0] + dy * fr.v[1] + dz * fr.v[2];
      tri.push([s, y]);
      r.bbox.s0 = Math.min(r.bbox.s0, s);
      r.bbox.s1 = Math.max(r.bbox.s1, s);
      r.bbox.y0 = Math.min(r.bbox.y0, y);
      r.bbox.y1 = Math.max(r.bbox.y1, y);
    }
    r.tris.push(tri);
  }
  for (const r of out.values()) {
    r.segs.sort((a, b) => a.s0 - b.s0);
    r.length = Math.max(...r.segs.map((s) => s.s1));
  }
  return out;
}

function inTri(p: Vec2, t: Vec2[]): boolean {
  const [a, b, c] = t as [Vec2, Vec2, Vec2];
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  const neg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const pos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(neg && pos);
}

/** Is the rectangle [s0,s1]×[y0,y1] fully inside the visible part? (grid samples). */
export function fits(r: EdgeRegion, s0: number, s1: number, y0: number, y1: number): boolean {
  // The shell comes in float32 (3.4 becomes 3.4000001): edges with a 2 mm slack,
  // otherwise a part starting exactly at the top of another volume is refused.
  const E = 2e-3;
  if (s0 < r.bbox.s0 - E || s1 > r.bbox.s1 + E || y0 < r.bbox.y0 - E || y1 > r.bbox.y1 + E) return false;
  const a0 = Math.max(s0, r.bbox.s0) + E,
    a1 = Math.min(s1, r.bbox.s1) - E,
    b0 = Math.max(y0, r.bbox.y0) + E,
    b1 = Math.min(y1, r.bbox.y1) - E;
  const nx = Math.max(2, Math.ceil((a1 - a0) / 0.4)),
    ny = Math.max(2, Math.ceil((b1 - b0) / 0.4));
  for (let i = 0; i <= nx; i++)
    for (let j = 0; j <= ny; j++) {
      const p: Vec2 = [a0 + ((a1 - a0) * i) / nx, b0 + ((b1 - b0) * j) / ny];
      if (!r.tris.some((t) => inTri(p, t))) return false;
    }
  return true;
}

/** Visible s spans [a, b] on a horizontal line y (triangle cuts, merged). */
function lineIntervals(r: EdgeRegion, y: number): [number, number][] {
  const segs: [number, number][] = [];
  for (const t of r.tris) {
    const xs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = t[i]!,
        b = t[(i + 1) % 3]!;
      if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue;
      xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length >= 2) segs.push([Math.min(...xs), Math.max(...xs)]);
  }
  segs.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const g of segs) {
    const last = out[out.length - 1];
    if (last && g[0] <= last[1] + 0.005) last[1] = Math.max(last[1], g[1]);
    else out.push([g[0], g[1]]);
  }
  return out;
}

/** s spans visible across the whole band [y0, y1] (intersection of several lines). */
export function rowIntervals(r: EdgeRegion, y0: number, y1: number): [number, number][] {
  let acc: [number, number][] | null = null;
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n + (i === 0 ? 1e-4 : i === n ? -1e-4 : 0);
    const line = lineIntervals(r, y);
    if (!acc) acc = line;
    else {
      const next: [number, number][] = [];
      for (const a of acc) for (const b of line) {
        const lo = Math.max(a[0], b[0]),
          hi = Math.min(a[1], b[1]);
        if (hi - lo > 1e-4) next.push([lo, hi]);
      }
      acc = next;
    }
    if (!acc.length) break;
  }
  return acc ?? [];
}

/** Frame at point (s, y) of the side: the segment containing s. */
export function frameAt(r: EdgeRegion, s: number, y: number): M4 {
  let seg = r.segs[0]!;
  for (const g of r.segs) if (s >= g.s0 - 1e-6) seg = g;
  const ds = s - seg.s0;
  const p: Vec3 = [seg.o[0] + seg.u[0] * ds + seg.v[0] * y, seg.o[1] + seg.u[1] * ds + seg.v[1] * y, seg.o[2] + seg.u[2] * ds + seg.v[2] * y];
  return faceMatrix(p, seg.u, seg.v, seg.n);
}

/** Narrowest a part of a fixed-count rule gets when it narrows to fit its face (m). */
const MIN_FIT = 0.6;

/** Centers along [a, b] for a component of width w (four modes). */
export function distribute(rule: Pick<FacadeRule, 'mode' | 'value' | 'justify'>, a: number, b: number, w: number): number[] {
  const avail = b - a;
  if (avail < w - 1e-6) return [];
  const v = Math.max(0.01, rule.value);
  if (rule.mode === 'spacing') {
    const d = Math.max(v, w + 0.05);
    const n = Math.floor((avail - w) / d) + 1;
    const span = (n - 1) * d;
    const start = rule.justify === 'start' ? a + w / 2 : rule.justify === 'end' ? b - w / 2 - span : (a + b) / 2 - span / 2;
    return Array.from({ length: n }, (_, i) => start + i * d);
  }
  let n: number;
  if (rule.mode === 'count') n = Math.max(1, Math.round(v));
  else if (rule.mode === 'max') n = Math.max(1, Math.ceil(avail / v));
  else n = Math.max(1, Math.floor(avail / Math.max(w + 0.1, v)));
  // Never more parts than fit side by side.
  n = Math.min(n, Math.floor(avail / (w + 0.05)) || 1);
  // A single part honours the justification (a door at the start or the end of its wall); several
  // share the span evenly. Before, Place: Start/End did nothing on a rule with one part (audit A4).
  if (n === 1 && rule.justify !== 'center') return [rule.justify === 'start' ? a + w / 2 : b - w / 2];
  return Array.from({ length: n }, (_, i) => a + ((i + 0.5) * avail) / n);
}

/** Splits n integers proportionally to the weights (largest remainder; the sum is n). */
export function apportion(n: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (n * w) / total);
  const out = exact.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as [number, number]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]![1]]!++;
  return out;
}

/**
 * Shading in front of the wall (brise-soleil, louvers) that cuts no opening: it may stand over a window
 * (that is what it is for), so it neither blocks nor is blocked by the parts that pierce the wall.
 */
const overlay = (f: Family): boolean => f.category === 'shading' && !f.opening;

/** Removes the occupied intervals from the spans [a, b]. */
export function carve(spans: { a: number; b: number }[], cuts: [number, number][]): { a: number; b: number }[] {
  let out = spans;
  for (const [c0, c1] of cuts) {
    const next: { a: number; b: number }[] = [];
    for (const q of out) {
      if (c1 <= q.a || c0 >= q.b) next.push(q);
      else {
        if (c0 > q.a) next.push({ a: q.a, b: c0 });
        if (c1 < q.b) next.push({ a: c1, b: q.b });
      }
    }
    out = next;
  }
  return out;
}

export interface TypeResolver {
  (id: string): { type: ComponentType; family: Family } | null;
}

export function typeResolver(project?: Pick<Project3, 'types'>): TypeResolver {
  return (id) => {
    const type = typeById(id, project);
    const fam = type ? family(type.family) : undefined;
    return type && fam ? { type, family: fam } : null;
  };
}

/**
 * Anchored locators of position i in a row of n (Lipp, Wonka, Wimmer 2008, "Interactive Visual Editing
 * of Grammars for Procedural Architecture", anchor points): counted from the start (`s`), from the end
 * (`e`) or from the middle (`c`). The first is the nearest anchor (ties go to the ends):
 * it is the key a new exception gets, so a window near a corner keeps its place when the spacing or the
 * width changes the count, and the middle one stays the middle one. A key without a letter (older
 * files) counts from the start.
 */
export function rowLocators(i: number, n: number): string[] {
  const c = i - (n - 1) / 2;
  const ds = i,
    de = n - 1 - i,
    dc = Math.abs(c);
  const S = `s${i}`,
    E = `e${de}`,
    C = `c${c}`;
  // The middle anchor only for a window on the middle line (an odd count): with an even count there is
  // no middle window and the nearest end holds better when the count changes.
  if (Number.isInteger(c) && dc < Math.min(ds, de)) return [C, ds <= de ? S : E, ds <= de ? E : S];
  return ds <= de ? [S, E, C] : [E, S, C];
}

/** Components of the facade rules of a solid. */
export function rulePlacements(b: Building3, s: Solid, regions: Map<string, EdgeRegion>, types: TypeResolver, warnings: string[], taken: Placement[] = []): Placement[] {
  const out: Placement[] = [];
  const levels = solidLevels(b, s);
  // A twisted or revolved volume has no straight wall rows to lay a rule on (yet): said, not hidden.
  if ((s.twist && Math.abs(s.twist) > 0.01) || s.revolve || s.loft) {
    if (s.facade.length) warnings.push(`${s.name}: facade rules wait while the volume is ${s.revolve ? 'a revolved shape' : s.loft ? 'a loft' : 'twisted'}.`);
    return out;
  }
  // Rules for a specific side first; each rule yields to the previous ones.
  const ordered = [...s.facade].sort((a, b) => (b.edges.length ? 1 : 0) - (a.edges.length ? 1 : 0));
  for (const rule of ordered) {
    const base = types(rule.type);
    if (!base) {
      warnings.push(`Facade rule with an unknown type (${rule.type}).`);
      continue;
    }
    // A rounded corner takes the repeating rules (windows along the facade) but not a fixed count on every
    // side (a front door per side would put one on each corner), unless the rule names it.
    const corner = (e: string) => e.endsWith(':c');
    const edges = [...regions.values()].filter((r) => r.solid === s.id && (rule.edges.length ? rule.edges.includes(r.edge) : !s.edges[r.edge]?.blank && !(corner(r.edge) && rule.mode === 'count')));
    // Exceptions that found their window (the others are reported, kept for when it comes back).
    const used = new Set<string>();
    // Free parts detached from this rule do not cut it: it keeps its layout, with their positions empty.
    const own = new Set(b.items.filter((i) => i.origin?.rule === rule.id).map((i) => i.id));
    for (const r of edges) {
      for (const lv of pickLevels(rule.levels, levels)) {
        const seg0 = r.segs[0]!;
        const vy = Math.max(0.2, seg0.v[1]);
        let params = resolveParams(base.family, base.type.params, rule.params);
        const [w, h0] = base.family.size(params);
        const sill = Number.isFinite(rule.sill) ? rule.sill : (base.family.sill?.(params) ?? 0.9);
        // Only the opening must fit the floor height; signs and canopies may pass.
        let openH = base.family.opening?.(params)?.h ?? h0;
        // A door taller than its floor (standing on the floor: no sill) gets shorter to fit, within its own
        // range of heights (a 4.6 m dock door in a 4 m floor; audit C1: the shed's facade stayed empty),
        // like a fixed count narrows. A window keeps its size and is reported (its sill was chosen).
        const room = lv.height - 0.08 - sill;
        const hd = base.family.params.find((d) => d.key === 'height' && d.kind === 'length');
        if (openH > room && sill <= 0.05 && hd && typeof params.height === 'number') {
          const want = Math.floor((params.height - (openH - room) - 0.01) * 100) / 100;
          if (want >= (hd.min ?? 0)) {
            params = { ...params, height: want };
            openH = base.family.opening?.(params)?.h ?? base.family.size(params)[1];
          }
        }
        const h = base.family.size(params)[1];
        if (sill + openH > lv.height - 0.08) {
          warnings.push(`${base.type.name}: does not fit level ${lv.index + 1} (${(sill + openH).toFixed(2)} m in ${lv.height.toFixed(2)} m).`);
          continue;
        }
        let placed = 0,
          yielded = 0,
          dropped = 0;
        const y = (lv.elevation + sill - s.base) / vy;
        // Distributes inside the visible spans of this row (tapering towers,
        // gables, a wall partly covered by another volume).
        // Parts already placed in this row (door, free parts) cut the span:
        // the rule redistributes in what remains beside them, with a gap.
        const GAP = Math.max(0.35, rule.margin * 0.6);
        const blockers = taken
          .filter((q) => !(q.tag.item && own.has(q.tag.item)) && overlay(q.family) === overlay(base.family))
          .filter((q) => q.host && q.host.solid === s.id && q.host.edge === r.edge && q.host.y < y + openH / vy + 0.05 && q.host.y + (q.family.size(q.params)[1] ?? 0) > y - 0.05)
          .map((q) => [q.host!.s - q.length / 2 - GAP, q.host!.s + q.length / 2 + GAP] as [number, number]);
        const raw = rowIntervals(r, y, y + openH / vy);
        // A row covered by another volume (podium, annex): nothing to do, no warning.
        const open = raw.reduce((acc, [a, b]) => acc + (b - a), 0);
        const free = carve(raw.map(([a, b]) => ({ a: a + rule.margin, b: b - rule.margin })), blockers);
        // A fixed count keeps its count: when the parts do not fit at their width (a face that narrows up a
        // tapered or leaning tower), they narrow to fit, down to MIN_FIT — like curtain wall panels. Before,
        // the upper floors stayed blank. The other modes already take as many as fit.
        let rowParams = params,
          rw = w;
        if (rule.mode === 'count' && base.family.params.some((d) => d.key === 'width' && d.kind === 'length')) {
          const room = Math.max(0, ...free.map((q) => q.b - q.a));
          const fitW = Math.floor((room / Math.max(1, Math.round(rule.value)) - 0.1) * 100) / 100;
          if (fitW < w && fitW >= MIN_FIT) {
            rowParams = { ...params, width: fitW };
            rw = base.family.size(rowParams)[0];
          }
        }
        const spans = free.filter((q) => q.b - q.a >= rw);
        const centers: number[] = [];
        // Fixed count: split among the spans by largest remainder (the sum is the request).
        const counts = rule.mode === 'count' && spans.length > 1 ? apportion(Math.max(1, Math.round(rule.value)), spans.map((q) => q.b - q.a)) : null;
        spans.forEach((q, i) => {
          if (counts && !counts[i]) return;
          const share = counts ? { ...rule, value: counts[i]! } : rule;
          centers.push(...distribute(share, q.a, q.b, rw));
        });
        const n = centers.length;
        centers.forEach((c, i) => {
          // The exception of this window, whatever anchor it was written with; the key a new one gets is the nearest anchor.
          const locs = rowLocators(i, n);
          const row = `${r.edge}:${lv.index}:`;
          let k = row + locs[0];
          let ex: string | undefined;
          for (const key of [...locs.map((l) => row + l), row + i]) {
            if (rule.except[key] === undefined) continue;
            ex = rule.except[key];
            used.add(key);
            // The window answers to the key its exception has (Back to rule removes that one).
            k = key;
            break;
          }
          if (ex === 'none') return;
          const t = ex ? types(ex) : base;
          if (!t) return;
          // A size changed at this position only (the handles of one selected element).
          let sz: Record<string, number> | undefined;
          for (const key of [...locs.map((l) => row + l), row + i]) {
            if (!rule.sizes?.[key]) continue;
            sz = rule.sizes[key];
            if (!ex) k = key;
            break;
          }
          const p = { ...(ex ? resolveParams(t.family, t.type.params) : rowParams), ...(sz ?? {}) };
          const [ww, hh] = t.family.size(p);
          const oh = t.family.opening?.(p)?.h ?? hh;
          if (!fits(r, c - ww / 2, c + ww / 2, y, y + oh / vy)) {
            // Said, not silently dropped (audit A3: 8 windows became 6 after a type swap, no word).
            dropped++;
            return;
          }
          // A free part in the same place has priority: the rule frees the position.
          if (taken.some((q) => overlay(q.family) === overlay(t.family) && q.host && q.host.solid === s.id && q.host.edge === r.edge && Math.abs(q.host.s - c) < (q.length + ww) / 2 + 0.05 && q.host.y < y + hh + 0.05 && q.host.y + (q.family.size(q.params)[1] ?? 0) > y - 0.05)) {
            yielded++;
            return;
          }
          placed++;
          const pl: Placement = {
            family: t.family,
            params: p,
            frame: frameAt(r, c, y),
            opening: t.family.opening?.(p) ?? null,
            tag: { family: t.family.id, rule: rule.id, key: k, solid: s.id },
            length: ww,
            host: { solid: s.id, edge: r.edge, s: c, y },
          };
          out.push(pl);
          taken.push(pl);
        });
        if (!placed && !yielded && centers.length && open >= w + 2 * rule.margin && r.length > w + 2 * rule.margin) warnings.push(`${base.type.name}: nothing fit level ${lv.index + 1} of the ${r.length.toFixed(1)} m side (something covers the wall).`);
        else if (dropped) warnings.push(`${base.type.name}: ${dropped} of ${centers.length} do not fit level ${lv.index + 1} of a ${r.length.toFixed(1)} m side (too tall or too wide for what is free there).`);
      }
    }
    const lost = Object.keys(rule.except).filter((key) => !used.has(key) && edges.some((r) => keyParts(key)?.edge === r.edge));
    if (lost.length) warnings.push(`${base.type.name}: ${lost.length} exception${lost.length > 1 ? 's have' : ' has'} no window in this layout; kept for when it returns (Reset clears).`);
  }
  return out;
}

/** Free occurrences (with arrays). `roofY` gives the roof height at a point. */
export function itemPlacements(b: Building3, regions: Map<string, EdgeRegion>, types: TypeResolver, roofY: (x: number, z: number) => number, warnings: string[]): Placement[] {
  const out: Placement[] = [];
  for (const it of b.items) {
    const t = types(it.type);
    if (!t) {
      warnings.push(`Component with an unknown type (${it.type}).`);
      continue;
    }
    const params = resolveParams(t.family, t.type.params, it.params);
    const [w, h, d] = t.family.size(params);
    const copies = arrayOffsets(it, w, d);
    const h0 = it.host;
    if (h0.kind === 'face') {
      const r = regions.get(key(h0.solid, h0.edge));
      if (!r) {
        warnings.push(`${t.type.name}: the face it was on no longer exists.`);
        continue;
      }
      const vy = Math.max(0.2, r.segs[0]!.v[1]);
      copies.forEach(([dx, dy], i) => {
        const s = h0.u + dx,
          y = h0.y + dy / vy;
        const ok = fits(r, s - w / 2, s + w / 2, y, y + h / vy);
        if (!ok) {
          if (i === 0) warnings.push(`${t.type.name}: no longer fits the face (hidden until it fits).`);
          return;
        }
        out.push({ family: t.family, params, frame: frameAt(r, s, y), opening: t.family.opening?.(params) ?? null, tag: { family: t.family.id, item: it.id, key: String(i) }, length: w, host: { solid: h0.solid, edge: h0.edge, s, y } });
      });
    } else if (h0.kind === 'free' || h0.kind === 'roof') {
      const p: Vec3 = h0.kind === 'free' ? h0.p : [h0.p[0], roofY(h0.p[0], h0.p[1]), h0.p[1]];
      const base = mul(translation(p[0], p[1], p[2]), rotationYXZ([Number.isFinite(h0.rot) ? h0.rot : 0, 0, 0]));
      copies.forEach(([dx, , dz], i) => {
        let f = mul(base, translation(dx, 0, dz));
        if (h0.kind === 'roof') {
          const q = applyXZ(f);
          f = mul(translation(0, roofY(q[0], q[1]) - p[1], 0), f);
        }
        out.push({ family: t.family, params, frame: f, opening: null, tag: { family: t.family.id, item: it.id, key: String(i) }, length: w });
      });
    } else {
      // A path tied to a volume's top edge (Railing around) follows that edge as it is now.
      const host = h0.around ? b.solids.find((s) => s.id === h0.around) : undefined;
      let pts = h0.points;
      if (host) {
        const ring = offsetRing(topRing(host), topRing(host).map(() => 0.08));
        if (ring.length > 2) pts = [...ring, ring[0]!].map((q) => [q[0], host.base + host.height, q[1]] as Vec3);
      }
      if (pts.length < 2) continue;
      let L = 0;
      for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
      out.push({ family: t.family, params, frame: translation(0, 0, 0), opening: null, tag: { family: t.family.id, item: it.id }, length: L, path: h0.closed ? [...pts, pts[0]!] : pts });
    }
  }
  return out;
}

function applyXZ(m: M4): Vec2 {
  return [m[12]!, m[14]!];
}

/** Offsets of the copies of an array [along, up (faces) or nothing, local z (free)]. */
export function arrayOffsets(it: Item, w: number, d: number): Vec3[] {
  const a = it.array;
  if (!a) return [[0, 0, 0]];
  const n = Math.max(1, Math.round(a.along.count));
  const step = a.along.mode === 'spacing' || a.along.mode === 'max' ? Math.max(a.along.value, 0.05) : a.along.mode === 'fit' ? Math.max(a.along.value / Math.max(1, n - 1), 0.05) : Math.max(w + 0.05, a.along.value);
  const rows = Math.max(1, Math.round(a.across?.count ?? 1));
  const rs = a.across?.spacing ?? d + 0.5;
  const out: Vec3[] = [];
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < n; i++) {
      const along = i * step;
      out.push(it.host.kind === 'face' ? [along, r * rs, 0] : [along, 0, r * rs]);
    }
  return out;
}
