// Composition by contact: a volume drawn or a building dropped where it passes
// through another building becomes part of that building, so their solids are
// joined by the booleans (one body, one roof seam, no walls through each other).
// Touching side by side is not passing through: an annex against a wall stays a
// building of its own (it may have other floors). No three.
import * as clipNs from 'polygon-clipping';
import type { Building3, Project3, Solid, Vec2 } from './schema';
import { oriented, sampleRing } from './plan';
import { dirToLocal, toLocal, toWorld } from './ops';

// The package only has a default export in ESM, but the types declare named exports.
const clip = ((clipNs as unknown as { default?: typeof clipNs }).default ?? clipNs) as typeof clipNs;

/** Overlap below this area (m²) is a touch, not a pass-through (float noise of shared walls). */
const MIN_OVERLAP = 0.25;

function ringArea(r: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!,
      b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** World footprint of a building's additive volumes, with the height range of each. */
export function worldParts(b: Building3): { ring: Vec2[]; y0: number; y1: number }[] {
  const e = b.elevation ?? 0;
  return b.solids
    .filter((s) => s.op === 'add' && !s.hidden)
    .map((s) => ({ ring: sampleRing(oriented(s.plan.outer, 1)).pts.map((p) => toWorld(b, p)), y0: e + s.base, y1: e + s.base + s.height }));
}

/** Area (m²) where two sets of parts pass through each other (plan overlap of parts whose heights overlap). */
export function passThrough(a: { ring: Vec2[]; y0: number; y1: number }[], b: { ring: Vec2[]; y0: number; y1: number }[]): number {
  let total = 0;
  for (const p of a)
    for (const q of b) {
      if (Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) < 0.05) continue;
      try {
        for (const poly of clip.intersection([p.ring], [q.ring])) total += ringArea(poly[0] as Vec2[]) - poly.slice(1).reduce((s, h) => s + ringArea(h as Vec2[]), 0);
      } catch {
        // A degenerate ring: no overlap counted.
      }
    }
  return total;
}

/** The building that the parts pass through the most (none if they only touch). */
export function buildingPassedThrough(p: Project3, parts: { ring: Vec2[]; y0: number; y1: number }[], except?: string): Building3 | null {
  let best: { b: Building3; a: number } | null = null;
  for (const b of p.buildings) {
    if (b.id === except || b.hidden) continue;
    const a = passThrough(parts, worldParts(b));
    if (a > MIN_OVERLAP && (!best || a > best.a)) best = { b, a };
  }
  return best?.b ?? null;
}

/** A plan point and direction of `src` in the frame of `dst`. */
const pointTo = (src: Building3, dst: Building3, q: Vec2): Vec2 => toLocal(dst, toWorld(src, q));
const dirTo = (src: Building3, dst: Building3, d: Vec2): Vec2 => {
  const w = toWorld(src, d),
    o = toWorld(src, [0, 0]);
  return dirToLocal(dst, [w[0] - o[0], w[1] - o[1]]);
};

/** Moves a volume of `src` into the frame of `dst` (plan, base, roof direction). */
function moveSolid(src: Building3, dst: Building3, s: Solid): void {
  for (const ring of [s.plan.outer, ...s.plan.holes]) for (const v of ring) v.p = pointTo(src, dst, v.p);
  s.base += (src.elevation ?? 0) - (dst.elevation ?? 0);
  const a = (s.roof.direction * Math.PI) / 180;
  const d = dirTo(src, dst, [Math.cos(a), Math.sin(a)]);
  s.roof.direction = Math.round(((Math.atan2(d[1], d[0]) * 180) / Math.PI) * 1e6) / 1e6;
}

/**
 * Joins building `src` into `dst`: its volumes and components keep their place in the world
 * and their IDs (what hangs on a face stays on it); `dst` keeps its floors. `src` is emptied
 * (the caller removes it from the project).
 */
export function mergeInto(dst: Building3, src: Building3): void {
  const dy = (src.elevation ?? 0) - (dst.elevation ?? 0);
  const drot = src.rotation - dst.rotation;
  for (const s of src.solids) {
    moveSolid(src, dst, s);
    dst.solids.push(s);
  }
  for (const it of src.items) {
    const h = it.host;
    if (h.kind === 'free') {
      const q = pointTo(src, dst, [h.p[0], h.p[2]]);
      h.p = [q[0], h.p[1] + dy, q[1]];
      h.rot += drot;
    } else if (h.kind === 'roof') {
      h.p = pointTo(src, dst, h.p);
      h.rot += drot;
    } else if (h.kind === 'path') {
      h.points = h.points.map((q) => {
        const r = pointTo(src, dst, [q[0], q[2]]);
        return [r[0], q[1] + dy, r[1]];
      });
    }
    dst.items.push(it);
  }
  src.solids = [];
  src.items = [];
}

/**
 * The volumes `ids` of `src` become a building of their own at the same place in the world (the inverse
 * of mergeInto: "Separate", "Keep apart"), with the parts hosted on them; `make` builds the new building
 * (the caller adds it to the project). Floors are copied.
 */
export function separateSolids(src: Building3, ids: readonly string[], make: (input: Partial<Building3>) => Building3): Building3 | null {
  const set = new Set(ids);
  const moving = src.solids.filter((s) => set.has(s.id));
  if (!moving.length || moving.length === src.solids.length) return null;
  const dst = make({ name: moving.length === 1 ? moving[0]!.name : `${src.name} (part)`, position: [...src.position] as Vec2, rotation: src.rotation, elevation: src.elevation, use: src.use, levels: structuredClone(src.levels), layer: src.layer });
  src.solids = src.solids.filter((s) => !set.has(s.id));
  for (const s of moving) {
    s.op = 'add';
    delete s.on;
    delete s.host;
    delete s.through;
    dst.solids.push(s);
  }
  const hosted = src.items.filter((it) => (it.host.kind === 'face' || it.host.kind === 'roof') && set.has(it.host.solid));
  src.items = src.items.filter((it) => !hosted.includes(it));
  dst.items.push(...hosted);
  return dst;
}
