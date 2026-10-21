// Stairs and ramps derived from the height (like FreeCAD and Revit): the number of
// steps comes from the rise and the maximum riser, n = ceil(rise / max
// riser); the ramp comes from the maximum slope, with a landing every 0.8 m of
// rise. Railing generated along. Free frame: x width, z
// forward (the stair climbs toward +z), y up.
import type { Family, PartMat, PartSink, Params } from './family';
import { bool, num, P, str } from './family';
import { railOpts, railParams, railRun } from './kit';

const STRUCT: [string, string][] = [
  ['solid', 'Solid (concrete)'],
  ['stringers', 'Two stringers'],
  ['center', 'Central stringer'],
];

export function stairCount(rise: number, maxRiser: number): number {
  return Math.max(1, Math.ceil(rise / Math.max(0.1, maxRiser) - 1e-9));
}

function flight(out: PartSink, n: number, r: number, g: number, w: number, y0: number, mat: { tread: PartMat; struct: PartMat }, kind: string): void {
  for (let i = 0; i < n; i++) {
    const z = (i + 0.5) * g;
    const top = y0 + (i + 1) * r;
    if (kind === 'solid') out.box(mat.struct, [0, (y0 + top) / 2 - 0.01, z], [w, top - y0 + 0.02, g]);
    out.box(mat.tread, [0, top - 0.025, z - 0.02], [w + 0.02, 0.05, g + 0.04]);
  }
  if (kind !== 'solid') {
    const L = n * g,
      rise = n * r;
    const xs = kind === 'center' ? [0] : [-w / 2 + 0.05, w / 2 - 0.05];
    const ang = (-Math.atan2(rise, L) * 180) / Math.PI;
    for (const x of xs) out.box(mat.struct, [x, y0 + rise / 2 - 0.15, L / 2], [0.08, 0.28, Math.hypot(L, rise)], [0, ang, 0]);
  }
}

export const STAIR: Family = {
  id: 'stair',
  name: 'Stair',
  category: 'stairs',
  host: 'free',
  tags: ['stair', 'steps', 'flight', 'spiral', 'landing', 'exterior'],
  params: [
    { ...P.len('rise', 'Rise', 3, 0.3, 12, 'instance'), group: 'size' },
    P.len('width', 'Width', 1.2, 0.6, 4),
    P.len('maxRiser', 'Max riser', 0.18, 0.12, 0.22, 'type', 'divisions', 0.005),
    P.len('going', 'Tread depth', 0.28, 0.22, 0.4, 'type', 'divisions', 0.01),
    P.pick('shape', 'Shape', 'straight', [
      ['straight', 'Straight'],
      ['L', 'L-shaped'],
      ['U', 'U-shaped'],
      ['spiral', 'Spiral'],
    ]),
    P.pick('turn', 'Turn (L)', 'landing', [
      ['landing', 'Landing'],
      ['winders', 'Winders'],
    ]),
    P.pick('structure', 'Structure', 'solid', STRUCT),
    P.pick('rails', 'Railing', 'both', [
      ['both', 'Both sides'],
      ['left', 'On the left'],
      ['right', 'On the right'],
      ['none', 'Without'],
    ]),
    ...railParams('bars', 0.95),
    P.color('treadColor', 'Step color', '#b9b1a4'),
    P.finish('treadFinish', 'Step material', 'stone'),
    P.color('structColor', 'Structure color', '#a7a39c'),
  ],
  size: (p) => {
    const n = stairCount(num(p, 'rise'), num(p, 'maxRiser'));
    const w = num(p, 'width'),
      g = num(p, 'going');
    const sh = str(p, 'shape');
    if (sh === 'spiral') return [w * 2 + 0.3, num(p, 'rise'), w * 2 + 0.3];
    if (sh === 'L') return [w + Math.ceil(n / 2) * g, num(p, 'rise'), Math.floor(n / 2) * g + w];
    if (sh === 'U') return [w * 2 + 0.1, num(p, 'rise'), Math.ceil(n / 2) * g + w];
    return [w, num(p, 'rise'), n * g];
  },
  build(p, out) {
    const rise = num(p, 'rise'),
      w = num(p, 'width'),
      g = num(p, 'going');
    const n = stairCount(rise, num(p, 'maxRiser'));
    const r = rise / n;
    const kind = str(p, 'structure');
    const m = { tread: { slot: 'stone', color: str(p, 'treadColor'), finish: str(p, 'treadFinish') } as PartMat, struct: { slot: 'concrete', color: str(p, 'structColor'), finish: 'concrete' } as PartMat };
    const rails = str(p, 'rails');
    const o = railOpts(p);
    const sides = rails === 'both' ? [-1, 1] : rails === 'left' ? [-1] : rails === 'right' ? [1] : [];
    // Railing of one flight: runs toward +z rising `run.rise`.
    const railOf = (s: PartSink, L: number, y0: number, x: number, rr: number) => railRun(s.placed(x, y0, 0, -90), L, rr, o);
    const shape = str(p, 'shape');
    if (shape === 'spiral') {
      const R = w + 0.15;
      const turn = Math.min(360, Math.max(240, n * 22));
      out.cylinder(m.struct, [0, 0, 0], 0.09, rise + 0.9, 16);
      for (let i = 0; i < n; i++) {
        const a = (turn * (i + 0.5)) / n;
        const s = out.placed(0, (i + 1) * r - 0.03, 0, a);
        s.prism(m.tread, [[0.05, -0.05], [R, -((R * Math.PI * turn) / 180 / n) / 2 - 0.05], [R, ((R * Math.PI * turn) / 180 / n) / 2 + 0.05]], -0.03, 0.03);
      }
      if (sides.length) for (let i = 0; i <= n; i++) {
        const a = ((turn * i) / n) * (Math.PI / 180);
        out.rod(o.post, [Math.cos(-a) * R * 0.98, i * r, Math.sin(-a) * R * 0.98], [Math.cos(-a) * R * 0.98, i * r + o.h, Math.sin(-a) * R * 0.98], 0.012, 6);
      }
      return;
    }
    if (shape === 'straight') {
      flight(out, n, r, g, w, 0, m, kind);
      for (const sd of sides) railOf(out, n * g, 0, (sd * w) / 2, rise);
      return;
    }
    // L and U: two flights with a landing (an L may turn on three winders instead).
    const winders = shape === 'L' && str(p, 'turn') === 'winders' && n >= 5;
    const n1 = winders ? Math.ceil((n - 3) / 2) : Math.ceil(n / 2),
      n2 = n - n1 - (winders ? 3 : 0);
    const y1 = n1 * r;
    flight(out, n1, r, g, w, 0, m, kind);
    const landZ = n1 * g;
    for (const sd of sides) railOf(out, n1 * g, 0, (sd * w) / 2, y1);
    if (winders) {
      // Three treads fanning from the inner corner of the turn, 30° each, one riser apart.
      const t = w * Math.tan(Math.PI / 6);
      const c: [number, number] = [w / 2, landZ];
      const fans: [number, number][][] = [
        [c, [-w / 2, landZ], [-w / 2, landZ + t]],
        [c, [-w / 2, landZ + t], [-w / 2, landZ + w], [w / 2 - t, landZ + w]],
        [c, [w / 2 - t, landZ + w], [w / 2, landZ + w]],
      ];
      fans.forEach((poly, k) => {
        const yk = y1 + (k + 1) * r;
        out.slab(m.struct, poly, 0, yk - 0.05);
        out.slab(m.tread, poly, yk - 0.05, yk);
      });
      const s2 = out.placed(w / 2, 0, landZ + w / 2, 90);
      flight(s2.translated(0, 0, 0), n2, r, g, w, y1 + 3 * r, m, kind);
      for (const sd of sides) railOf(s2, n2 * g, y1 + 3 * r, (sd * w) / 2, n2 * r);
      return;
    }
    out.box(m.struct, [0, y1 / 2 - 0.01, landZ + w / 2], [w, y1 + 0.02, w]);
    out.box(m.tread, [0, y1 - 0.025, landZ + w / 2], [w + 0.02, 0.05, w + 0.02]);
    if (shape === 'L') {
      // Second flight toward +x, from the landing.
      const s2 = out.placed(w / 2, 0, landZ + w / 2, 90);
      flight(s2.translated(0, 0, 0), n2, r, g, w, y1, m, kind);
      for (const sd of sides) railOf(s2, n2 * g, y1, (sd * w) / 2, n2 * r);
    } else {
      // U: turns back, beside the first flight.
      const s2 = out.placed(w + 0.1, 0, landZ, 180);
      flight(s2, n2, r, g, w, y1, m, kind);
      for (const sd of sides) railOf(s2, n2 * g, y1, (sd * w) / 2, n2 * r);
    }
  },
};

export const RAMP: Family = {
  id: 'ramp',
  name: 'Ramp',
  category: 'stairs',
  host: 'free',
  tags: ['ramp', 'accessibility', 'accessible', 'wheelchair', 'landing'],
  params: [
    { ...P.len('rise', 'Rise', 0.8, 0.1, 4, 'instance'), group: 'size' },
    P.len('width', 'Width', 1.5, 0.9, 4),
    { ...P.ratio('slope', 'Max slope (%)', 0.0833, 'type'), min: 0.03, max: 0.125, group: 'divisions' },
    P.len('landing', 'Landing', 1.5, 1.2, 3, 'type', 'divisions'),
    P.flag('rails', 'Railing on both sides', true),
    ...railParams('bars', 0.92),
    P.color('slabColor', 'Floor color', '#b8b3a8'),
  ],
  size: (p) => {
    const rise = num(p, 'rise'),
      sl = Math.max(0.03, num(p, 'slope'));
    const runs = Math.max(1, Math.ceil(rise / 0.8 - 1e-9));
    return [num(p, 'width'), rise, rise / sl + (runs - 1) * num(p, 'landing')];
  },
  build(p, out) {
    const rise = num(p, 'rise'),
      w = num(p, 'width'),
      sl = Math.max(0.03, num(p, 'slope')),
      land = num(p, 'landing');
    const runs = Math.max(1, Math.ceil(rise / 0.8 - 1e-9));
    const rr = rise / runs,
      L = rr / sl;
    const m: PartMat = { slot: 'concrete', color: str(p, 'slabColor'), finish: 'concrete' };
    const o = railOpts(p);
    let z = 0,
      y = 0;
    for (let i = 0; i < runs; i++) {
      // Ramp: a (y, z) profile swept across the width.
      // (y, z) profile of the run: from the ground up to the sloped surface.
      const prof: [number, number][] = y > 0.001 ? [[0, z], [y, z], [y + rr, z + L], [0, z + L]] : [[0, z], [rr, z + L], [0, z + L]];
      out.sweepX(m, prof, -w / 2, w / 2);
      if (bool(p, 'rails')) for (const sd of [-1, 1]) railRun(out.placed((sd * w) / 2, y, z, -90), L, rr, o);
      y += rr;
      z += L;
      if (i < runs - 1) {
        out.box(m, [0, y / 2, z + land / 2], [w, y, land]);
        if (bool(p, 'rails')) for (const sd of [-1, 1]) railRun(out.placed((sd * w) / 2, y, z, -90), land, 0, o);
        z += land;
      }
    }
  },
};

export type { Params };
