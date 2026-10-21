// Live modifiers of a volume (like Blender's Array and Mirror modifiers, Estúdio de Construção's "Line ×",
// "Ring ×", "Helix" and "Mirror X/Z"): copies are made at every evaluation from the source volume, so changing the
// source (its plan, height, roof, facade rules) changes them all; removing the modifier removes them.
// The copies are volumes of their own for the evaluation, with the source's side IDs (its facade rules and
// exceptions apply to them) and an ID `<source>~<n>`; picking one selects the source (sourceId).
// No three.
import type { Building3, ID, Solid } from '../model/schema';
import { mirrorSolid, translateSolid } from '../model/ops';
import { offsetRing, ringValid, signedArea2 } from '../model/plan';

/** The volume an evaluated face belongs to: a copy made by a modifier answers for its source. */
export const sourceId = (id: ID): ID => {
  const i = id.indexOf('~');
  return i < 0 ? id : id.slice(0, i);
};

/** Rotates a plan about a point of the building (degrees, counterclockwise seen from above). */
function spinAbout(s: Solid, cx: number, cz: number, deg: number): void {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    n = Math.sin(a);
  for (const ring of [s.plan.outer, ...s.plan.holes])
    for (const v of ring) {
      const x = v.p[0] - cx,
        z = v.p[1] - cz;
      v.p = [cx + x * c + z * n, cz - x * n + z * c];
    }
  s.roof = { ...s.roof, direction: s.roof.direction - deg };
}

/** The volumes the modifiers make for one source volume (not the source itself). */
export function modifierCopies(s: Solid): Solid[] {
  const out: Solid[] = [];
  const copy = (n: number): Solid => {
    const c = structuredClone(s);
    c.id = `${s.id}~${n}`;
    delete c.repeat;
    delete c.mirror;
    delete c.on;
    delete c.host;
    delete c.through;
    return c;
  };
  const r = s.repeat;
  const base: Solid[] = [s];
  if (r && r.count > 1) {
    for (let i = 1; i < Math.min(64, Math.round(r.count)); i++) {
      const c = copy(out.length + 1);
      if (r.kind === 'line') translateSolid(c, r.dx * i, r.dz * i);
      else if (r.kind === 'ring') spinAbout(c, r.cx, r.cz, (360 / r.count) * i);
      else {
        // A helix (Blender's Screw / an array with a rotating, rising offset): a spiral stair of slabs.
        spinAbout(c, r.cx, r.cz, r.turn * i);
        c.base = s.base + r.rise * i;
      }
      out.push(c);
      base.push(c);
    }
  }
  if (s.mirror) {
    for (const src of base) {
      const c = copy(out.length + 1);
      c.plan = structuredClone(src.plan);
      c.roof = { ...src.roof };
      // Across the building's own axis: x = 0 (mirror X) or z = 0 (mirror Z).
      mirrorSolid(c, s.mirror, [0, 0]);
      out.push(c);
    }
  }
  return out;
}

/**
 * Hollow shell (like Blender's Solidify on a closed mesh, SketchUp's "Shell"): the inside of a volume as a
 * cutter right after it, its plan offset in by the thickness, from the floor plate to under the top. Null
 * when the volume is too thin for it.
 */
export function shellCutter(s: Solid): Solid | null {
  const t = s.shell ?? 0;
  if (!(t > 0) || s.op !== 'add' || s.height <= 2 * t + 0.05) return null;
  const inset = (ring: Solid['plan']['outer'], sign: number) => {
    const pts = offsetRing(ring.map((v) => v.p), ring.map(() => t));
    return ringValid(pts, sign) ? ring.map((v, i) => ({ ...v, id: `${v.id}~s`, p: pts[i]!, round: v.round ? Math.max(0, v.round - t) : undefined, chamfer: undefined })) : null;
  };
  const outer = inset(s.plan.outer, Math.sign(signedArea2(s.plan.outer.map((v) => v.p))) || 1);
  if (!outer) return null;
  const holes = s.plan.holes.map((h) => inset(h, Math.sign(signedArea2(h.map((v) => v.p))) || -1)).filter((h): h is NonNullable<typeof h> => !!h);
  const c = structuredClone(s);
  c.id = `${s.id}~shell`;
  c.op = 'subtract';
  c.plan = { outer, holes };
  c.base = s.base + t;
  c.height = s.height - 2 * t;
  c.roof = { ...s.roof, kind: 'flat', parapet: 0, overhang: 0 };
  c.facade = [];
  c.edges = {};
  for (const k of ['repeat', 'mirror', 'shell', 'on', 'host', 'through', 'revolve'] as const) delete (c as Partial<Solid>)[k];
  return c;
}

/** The building as the evaluation sees it: each volume followed by its modifiers' copies. */
export function withModifiers(b: Building3): Building3 {
  if (!b.solids.some((s) => (s.repeat && s.repeat.count > 1) || s.mirror || s.shell)) return b;
  return {
    ...b,
    solids: b.solids.flatMap((s) => {
      const copies = [s, ...modifierCopies(s)];
      const cut = shellCutter(s);
      return cut ? [...copies, cut] : copies;
    }),
  };
}
