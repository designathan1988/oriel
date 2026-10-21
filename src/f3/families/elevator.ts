// Elevator core (Revit's and ArchiCAD's elevator objects): a concrete shaft as tall as the floors it
// serves, its car door on the front at every floor (sliding doors in a steel frame), the machine-room-less
// head above the top floor. Free family: x across, z toward the front (the doors), y up. The shaft opens
// every slab it passes through (eval/modifiers.ts, shaftOpenings).
import type { Family, PartMat } from './family';
import { num, P, str } from './family';

export const ELEVATOR: Family = {
  id: 'elevator',
  name: 'Elevator',
  category: 'stairs',
  host: 'free',
  tags: ['elevator', 'lift', 'elevador', 'shaft', 'core', 'poço'],
  params: [
    P.len('width', 'Shaft width', 2, 1.4, 4, 'type'),
    P.len('depth', 'Shaft depth', 2, 1.4, 4, 'type'),
    P.len('height', 'Height (floors served)', 6, 2.5, 200, 'instance'),
    P.len('floorH', 'Floor to floor', 3, 2.5, 6, 'instance'),
    P.len('wall', 'Shaft wall', 0.15, 0.1, 0.3, 'type', 'profile', 0.01),
    P.color('wallColor', 'Shaft color', '#d9d5cc'),
    P.color('doorColor', 'Door color', '#9aa1a6'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + 0.4, num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      H = num(p, 'height'),
      t = num(p, 'wall'),
      fh = num(p, 'floorH');
    const wall: PartMat = { slot: 'wall', color: str(p, 'wallColor'), finish: 'concrete' };
    const door: PartMat = { slot: 'frame', color: str(p, 'doorColor'), finish: 'metal' };
    const top = H + 0.4;
    // Back and sides, whole height; the front between and above the doors.
    out.box(wall, [0, top / 2, -d / 2 + t / 2], [w, top, t]);
    out.box(wall, [-w / 2 + t / 2, top / 2, 0], [t, top, d]);
    out.box(wall, [w / 2 - t / 2, top / 2, 0], [t, top, d]);
    out.box(wall, [0, top - 0.2, 0], [w, 0.4, d]);
    const dw = Math.min(1.1, w - 2 * t - 0.3),
      dh = 2.1;
    const floors = Math.max(1, Math.floor(H / fh + 1e-6));
    for (let i = 0; i < floors; i++) {
      const y = i * fh;
      const side = (w - dw) / 2;
      out.box(wall, [-w / 2 + side / 2, y + fh / 2, d / 2 - t / 2], [side, fh, t]);
      out.box(wall, [w / 2 - side / 2, y + fh / 2, d / 2 - t / 2], [side, fh, t]);
      out.box(wall, [0, y + dh + (fh - dh) / 2, d / 2 - t / 2], [dw, fh - dh, t]);
      // Two sliding leaves and their frame.
      out.box(door, [-dw / 4, y + dh / 2, d / 2 - t / 2], [dw / 2 - 0.01, dh, 0.04]);
      out.box(door, [dw / 4, y + dh / 2, d / 2 - t / 2], [dw / 2 - 0.01, dh, 0.04]);
      out.box(door, [0, y + dh + 0.03, d / 2], [dw + 0.12, 0.06, 0.06]);
      out.box(door, [-dw / 2 - 0.03, y + dh / 2, d / 2], [0.06, dh, 0.06]);
      out.box(door, [dw / 2 + 0.03, y + dh / 2, d / 2], [0.06, dh, 0.06]);
    }
  },
};
