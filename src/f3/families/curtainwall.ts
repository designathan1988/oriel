// Curtain wall (Revit's curtain wall, ArchiCAD's curtain wall tool): a whole face of glass hung in front of
// the structure. Vertical and horizontal grids spread evenly at most the given spacing apart (Revit's
// "maximum spacing" layout), border and interior mullions of their own width and depth, glass panels, and
// optionally an opaque spandrel panel at each floor line (the band that hides the slab edge).
import type { Family, PartMat } from './family';
import { bool, num, P, str } from './family';

export const CURTAIN_WALL: Family = {
  id: 'curtainwall',
  name: 'Curtain wall',
  category: 'windows',
  host: 'face',
  tags: ['curtain wall', 'glass facade', 'glazing', 'pele de vidro', 'fachada de vidro', 'mullion'],
  params: [
    P.len('width', 'Width', 6, 1, 300, 'instance'),
    P.len('height', 'Height', 6, 1, 300, 'instance'),
    { ...P.len('sillH', 'Sill (height)', 0, 0, 300, 'instance'), group: 'size' },
    P.len('gridU', 'Vertical grid (at most)', 1.5, 0.4, 6, 'type', 'divisions', 0.1),
    P.len('gridV', 'Horizontal grid (at most)', 3, 0.4, 6, 'type', 'divisions', 0.1),
    P.len('mullionW', 'Mullion width', 0.06, 0.03, 0.3, 'type', 'profile', 0.01),
    P.len('mullionD', 'Mullion depth', 0.18, 0.05, 0.6, 'type', 'profile', 0.01),
    P.flag('spandrel', 'Opaque band at each floor', true),
    P.len('spandrelH', 'Opaque band height', 0.9, 0.2, 2, 'type', 'divisions', 0.05),
    P.color('frameColor', 'Mullion color', '#3a3e44'),
    P.color('glassColor', 'Glass color', '#5d7a8a'),
    P.color('spandrelColor', 'Opaque band color', '#2f3438'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'mullionD')],
  sill: (p) => num(p, 'sillH'),
  // The whole face opens: the curtain wall stands in front of the slabs.
  opening: (p) => ({ w: num(p, 'width'), h: num(p, 'height'), shape: 'rect', depth: 0.3, room: 1.8 }),
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    const mw = num(p, 'mullionW'),
      md = num(p, 'mullionD');
    const nu = Math.max(1, Math.ceil(w / Math.max(0.4, num(p, 'gridU')) - 1e-6)),
      nv = Math.max(1, Math.ceil(h / Math.max(0.4, num(p, 'gridV')) - 1e-6));
    const du = w / nu,
      dv = h / nv;
    const frame: PartMat = { slot: 'frame', color: str(p, 'frameColor'), finish: 'metal' };
    const glass: PartMat = { slot: 'glass', color: str(p, 'glassColor') };
    const solid: PartMat = { slot: 'frame', color: str(p, 'spandrelColor'), finish: 'metal' };
    // The glass sits 10 cm into the opening; the mullions stand 5 cm proud of the wall.
    const zg = -0.1,
      zm = 0.05 - md / 2;
    const band = bool(p, 'spandrel') ? Math.min(num(p, 'spandrelH'), dv - mw * 2 - 0.1) : 0;
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const x = -w / 2 + du * (i + 0.5),
          y0 = dv * j + mw / 2,
          y1 = dv * (j + 1) - mw / 2;
        // Every panel above the ground row gets its opaque band at the bottom (the floor line behind it).
        const sb = j > 0 && band > 0 ? band : 0;
        if (sb) out.box(solid, [x, y0 + sb / 2, zg], [du - mw, sb, 0.03]);
        out.box(glass, [x, (y0 + sb + y1) / 2, zg], [du - mw, y1 - y0 - sb, 0.02]);
      }
    for (let i = 0; i <= nu; i++) out.box(frame, [-w / 2 + du * i, h / 2, zm], [i === 0 || i === nu ? mw * 1.4 : mw, h, md]);
    for (let j = 0; j <= nv; j++) out.box(frame, [0, dv * j, zm], [w, j === 0 || j === nv ? mw * 1.4 : mw, md]);
  },
};
