// Parking along a path (Revit's parking component in a row, SketchUp's parking plugins): stalls laid along
// each run of a drawn line, square to it or at 60° or 45°, on one side or both, with the paved strip,
// the painted lines and a wheel stop in each stall. Local frame of each run: x along, z across.
import type { Family } from './family';
import { bool, num, P, str } from './family';
import { mat, pathOf, segments, segSink } from './kit';

const ANGLES: [string, string][] = [
  ['90', 'Square (90°)'],
  ['60', 'Angled 60°'],
  ['45', 'Angled 45°'],
];

const SIDES: [string, string][] = [
  ['left', 'One side'],
  ['both', 'Both sides'],
];

export const PARKING: Family = {
  id: 'parking',
  name: 'Parking',
  category: 'street',
  host: 'path',
  tags: ['parking', 'car park', 'stalls', 'estacionamento', 'vagas', 'garagem'],
  params: [
    P.len('stallW', 'Stall width', 2.5, 2, 4, 'type', 'size', 0.05),
    P.len('stallD', 'Stall depth', 5, 4, 7, 'type', 'size', 0.1),
    P.pick('angle', 'Angle', '90', ANGLES),
    P.pick('sides', 'Sides', 'left', SIDES),
    P.flag('stops', 'Wheel stops', true),
    P.color('paveColor', 'Paving color', '#55585c'),
    P.color('lineColor', 'Line color', '#f2f2ee'),
  ],
  size: (p) => [num(p, 'stallW'), 0.1, num(p, 'stallD')],
  build(p, out, ctx) {
    const w = num(p, 'stallW'),
      d = num(p, 'stallD');
    const a = (Number(str(p, 'angle')) * Math.PI) / 180;
    const pave = mat('concrete', str(p, 'paveColor'), 'asphalt');
    const line = mat('concrete', str(p, 'lineColor'), 'paint');
    const stop = mat('concrete', '#c9c4b8', 'concrete');
    // Along the run each stall takes w / sin(a); across, the stall reaches d·sin(a) (plus its slanted end).
    const pitch = w / Math.sin(a),
      reach = d * Math.sin(a),
      slant = d * Math.cos(a);
    const sides = str(p, 'sides') === 'both' ? [1, -1] : [1];
    for (const s of segments(pathOf(ctx), 10)) {
      const o = segSink(out, s);
      const n = Math.floor((s.len - slant) / pitch + 1e-6);
      if (n < 1) continue;
      const used = n * pitch + slant,
        x0 = (s.len - used) / 2;
      for (const side of sides) {
        // A stall line runs (slant, side·reach) from the run: its turn around y from the box's z axis.
        const turn = (Math.atan2(Math.cos(a), side * Math.sin(a)) * 180) / Math.PI;
        // The paved strip under the stalls (1 cm high).
        o.box(pave, [s.len / 2, 0.005, (side * reach) / 2], [used, 0.01, reach]);
        for (let i = 0; i <= n; i++) {
          // A stall line from the run outwards, leaning by the angle.
          const x = x0 + i * pitch;
          const cx = x + slant / 2,
            cz = (side * reach) / 2;
          o.box(line, [cx, 0.015, cz], [0.1, 0.005, d], [turn, 0, 0]);
        }
        if (bool(p, 'stops'))
          for (let i = 0; i < n; i++) {
            const x = x0 + (i + 0.5) * pitch + slant * (1 - 0.6 / d);
            o.box(stop, [x, 0.06, side * (reach - 0.6 * Math.sin(a))], [Math.min(1.8, w * 0.7), 0.12, 0.15], [turn, 0, 0]);
          }
      }
    }
  },
};
