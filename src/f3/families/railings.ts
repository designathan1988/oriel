// Railings: the path one follows the Revit pattern (start,
// corner and end posts; intermediate posts with max spacing and justification;
// infill between them) and the window railing (Juliet balcony) attached to the face.
import type { Vec3 } from '../model/schema';
import type { Family } from './family';
import { bool, num, P, str } from './family';
import { mat, railAlong, railOpts, railParams, railRun } from './kit';

export const RAILING: Family = {
  id: 'railing',
  name: 'Railing',
  category: 'railings',
  host: 'path',
  tags: ['railing', 'handrail', 'grille', 'parapet', 'baluster', 'glass', 'steel cable'],
  params: [
    ...railParams('bars', 1.1),
    P.len('baseH', 'Base height', 0, 0, 2, 'instance'),
    P.flag('curb', 'Base wall', false),
    P.len('curbH', 'Base wall height', 0.2, 0.05, 0.8, 'type', 'detail'),
    P.color('curbColor', 'Parapet color', '#c9c2b4'),
  ],
  size: (p) => [1, num(p, 'railH') + num(p, 'baseH') + (bool(p, 'curb') ? num(p, 'curbH') : 0), Math.max(num(p, 'postSize'), bool(p, 'curb') ? 0.2 : 0)],
  build(p, out, ctx) {
    const L = ctx.length > 0 ? ctx.length : 3;
    const path: Vec3[] = ctx.path && ctx.path.length >= 2 ? ctx.path : [[-L / 2, 0, 0], [L / 2, 0, 0]];
    let y = num(p, 'baseH');
    if (bool(p, 'curb')) {
      const ch = num(p, 'curbH');
      // The base wall follows each run; at the corners the blocks overlap (it stays closed).
      const cm = mat('concrete', str(p, 'curbColor'), 'concrete');
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!;
        const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
        if (len < 1e-4) continue;
        const rot = (Math.atan2(-(b[2] - a[2]), b[0] - a[0]) * 180) / Math.PI;
        const s = out.placed(a[0], a[1], a[2], rot);
        const k = (b[1] - a[1]) / len;
        // Prism on the run's xy plane: the top follows the slope.
        s.prism(cm, [[-0.1, -0.1 * k + y], [len + 0.1, (len + 0.1) * k + y], [len + 0.1, (len + 0.1) * k + y + ch], [-0.1, -0.1 * k + y + ch]], -0.1, 0.1);
        if (y > 0.001) s.prism(cm, [[-0.1, -0.1 * k], [len + 0.1, (len + 0.1) * k], [len + 0.1, (len + 0.1) * k + y], [-0.1, -0.1 * k + y]], -0.1, 0.1);
      }
      y += ch;
    }
    // Without a base wall, the base is the height it rests on (wall top or slab).
    railAlong(out, path.map(([x, py, z]) => [x, py + y, z] as Vec3), railOpts(p));
  },
};

/** Juliet balcony railing: a grille in front of a balcony door, fixed to the jambs. */
export const JULIETTE: Family = {
  id: 'juliette',
  name: 'Juliet balcony',
  category: 'railings',
  host: 'face',
  tags: ['juliet balcony', 'railing', 'juliette', 'window railing', 'sill'],
  params: [
    P.len('width', 'Width', 1.4, 0.6, 4),
    { ...P.len('sillH', 'Base height', 0.05, 0, 2, 'instance'), group: 'size' },
    P.len('projection', 'Distance from the wall', 0.15, 0.05, 0.6),
    P.flag('ledge', 'Stone threshold', true),
    P.flag('scrolls', 'Scrolls on top', false),
    ...railParams('bars', 0.95),
  ],
  size: (p) => [num(p, 'width') + 0.1, num(p, 'railH') + (bool(p, 'scrolls') ? 0.15 : 0), num(p, 'projection') + 0.05],
  sill: (p) => num(p, 'sillH'),
  build(p, out) {
    const w = num(p, 'width'),
      pr = num(p, 'projection');
    const o = railOpts(p);
    o.postSpacing = Math.max(o.postSpacing, w);
    // Front: one run from jamb to jamb; sides returning to the wall.
    railRun(out.translated(-w / 2, 0, pr), w, 0, o);
    railRun(out.placed(-w / 2, 0, 0, -90), pr, 0, { ...o, infill: o.infill === 'glass' ? 'glass' : 'bars', postSpacing: 10 }, true, false);
    railRun(out.placed(w / 2, 0, 0, -90), pr, 0, { ...o, infill: o.infill === 'glass' ? 'glass' : 'bars', postSpacing: 10 }, true, false);
    // Wall anchors.
    for (const s of [-1, 1]) for (const y of [0.15, o.h - 0.1]) out.box(o.post, [(s * w) / 2, y, 0.01], [0.08, 0.08, 0.02]);
    if (bool(p, 'ledge')) out.box(mat('stone', '#d3ccbd', 'stone'), [0, -0.04, pr / 2], [w + 0.1, 0.08, pr + 0.05]);
    if (bool(p, 'scrolls')) {
      // Scrolls: bar arcs over the handrail.
      const n = Math.max(2, Math.round(w / 0.3));
      for (let i = 0; i < n; i++) {
        const cx = -w / 2 + (w * (i + 0.5)) / n;
        const r = Math.min(0.07, w / n / 2 - 0.01);
        let prev: Vec3 | null = null;
        for (let k = 0; k <= 8; k++) {
          const a = (k / 8) * Math.PI;
          const q: Vec3 = [cx + Math.cos(a) * r, o.h + Math.sin(a) * r * 1.4, pr];
          if (prev) out.rod(o.rail, prev, q, 0.006, 6);
          prev = q;
        }
      }
    }
  },
};
