// Interior furniture: seating, beds, tables, storage, kitchen and bathroom
// fixtures. All are free families: x across, y up from the floor and z towards
// the front of the piece (the viewer stands at +z). No three.
import type { Vec3 } from '../model/schema';
import type { Family, PartMat, PartSink } from './family';
import { bool, num, P, str } from './family';
import { clamp, hash01, mat, oval, soft, toRad } from './kit';

/** Four legs between y0 and y1 at the corners of a w × d footprint. */
function legs4(out: PartSink, m: PartMat, w: number, d: number, y0: number, y1: number, s = 0.06, inset = 0.06): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.box(m, [sx * (w / 2 - inset), (y0 + y1) / 2, sz * (d / 2 - inset)], [s, y1 - y0, s]);
}

/** Upholstered body shared by the sofa and the armchair: tapered legs, a rounded frame, arms and back,
 * and soft seat and back cushions (rounded boxes: the light runs round their edges). */
function couch(out: PartSink, w: number, d: number, h: number, seats: number, body: PartMat, cushion: PartMat, wood: PartMat, arms = 'rounded'): void {
  const legH = 0.12;
  const seatTop = 0.45;
  const armT = arms === 'none' ? 0 : arms === 'slim' ? 0.09 : 0.17;
  const backT = 0.2;
  const inner = w - 2 * armT;
  const frameTop = seatTop - 0.15;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.lathe(wood, [[0.018, 0], [0.026, legH]], 10, [sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)]);
  out.rbox(body, [0, (legH + frameTop) / 2, 0], [w, frameTop - legH, d], 0.03);
  const armH = Math.min(h, seatTop + 0.22);
  if (armT) for (const sx of [-1, 1]) out.rbox(body, [(sx * (w - armT)) / 2, (frameTop + armH) / 2 + 0.0, 0], [armT, armH - frameTop + 0.02, d], arms === 'slim' ? 0.035 : 0.07);
  out.rbox(body, [0, (frameTop + h) / 2, -(d - backT) / 2], [inner + 0.02, h - frameTop, backT], 0.06);
  const z0 = -d / 2 + backT - 0.01;
  const z1 = d / 2 - 0.02;
  const cw = inner / seats;
  for (let i = 0; i < seats; i++) out.rbox(cushion, [-inner / 2 + (i + 0.5) * cw, seatTop - 0.075, (z0 + z1) / 2], [cw - 0.012, 0.16, z1 - z0], 0.06);
  // Back cushions leaning on the back rest (the top tips towards −z).
  const bh = h - seatTop;
  for (let i = 0; i < seats; i++) out.rbox(cushion, [-inner / 2 + (i + 0.5) * cw, seatTop + bh * 0.46, -d / 2 + backT + 0.07], [cw - 0.02, bh * 0.82, 0.17], 0.07, [0, -12, 0]);
}

export const SOFA: Family = {
  id: 'sofa',
  name: 'Sofa',
  category: 'furniture',
  host: 'free',
  tags: ['sofa', 'couch', 'seating', 'living room', 'interior'],
  params: [
    P.len('width', 'Width', 2.1, 1, 4),
    P.len('depth', 'Depth', 0.9, 0.6, 1.4),
    P.len('height', 'Back height', 0.85, 0.6, 1.2),
    P.count('seats', 'Seats', 3, 1, 5, 'size'),
    P.pick('arms', 'Arms', 'rounded', [
      ['rounded', 'Rounded'],
      ['slim', 'Slim'],
      ['none', 'None'],
    ]),
    P.color('color', 'Color', '#7d8a92'),
    P.color('cushionColor', 'Cushion color', '#8c979e'),
    P.color('legColor', 'Leg color', '#4a3a2a'),
    P.finish('finish', 'Upholstery', 'fabric'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width');
    // One cushion per seat, but never a cushion narrower than ~0.6 m.
    const seats = clamp(Math.round(num(p, 'seats')), 1, Math.max(1, Math.floor(w / 0.6)));
    couch(out, w, num(p, 'depth'), num(p, 'height'), seats, mat('fabric', str(p, 'color'), str(p, 'finish')), mat('fabric', str(p, 'cushionColor'), str(p, 'finish')), mat('wood', str(p, 'legColor'), 'wood'), str(p, 'arms'));
  },
};

export const ARMCHAIR: Family = {
  id: 'armchair',
  name: 'Armchair',
  category: 'furniture',
  host: 'free',
  tags: ['armchair', 'chair', 'seating', 'living room', 'interior'],
  params: [
    P.len('width', 'Width', 0.95, 0.6, 1.6),
    P.len('depth', 'Depth', 0.9, 0.6, 1.4),
    P.len('height', 'Back height', 0.82, 0.6, 1.2),
    P.pick('arms', 'Arms', 'rounded', [
      ['rounded', 'Rounded'],
      ['slim', 'Slim'],
      ['none', 'None'],
    ]),
    P.color('color', 'Color', '#8d7a6c'),
    P.color('cushionColor', 'Cushion color', '#9c8b7d'),
    P.color('legColor', 'Leg color', '#4a3a2a'),
    P.finish('finish', 'Upholstery', 'fabric'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    couch(out, num(p, 'width'), num(p, 'depth'), num(p, 'height'), 1, mat('fabric', str(p, 'color'), str(p, 'finish')), mat('fabric', str(p, 'cushionColor'), str(p, 'finish')), mat('wood', str(p, 'legColor'), 'wood'), str(p, 'arms'));
  },
};

export const BED: Family = {
  id: 'bed',
  name: 'Bed',
  category: 'furniture',
  host: 'free',
  tags: ['bed', 'bedroom', 'single', 'double', 'mattress', 'interior'],
  params: [
    P.len('width', 'Width', 1.6, 0.8, 2.2),
    P.len('length', 'Length', 2, 1.6, 2.4),
    P.len('height', 'Mattress height', 0.5, 0.3, 0.8),
    P.flag('headboard', 'Headboard', true, 'profile'),
    P.pick('board', 'Headboard style', 'upholstered', [
      ['upholstered', 'Upholstered'],
      ['wood', 'Wood panel'],
      ['slats', 'Slats'],
    ]),
    P.color('frameColor', 'Frame color', '#8a6240'),
    P.color('sheetColor', 'Sheets', '#f2efe8'),
    P.color('duvetColor', 'Duvet', '#b9c6cc'),
    P.color('boardColor', 'Headboard fabric', '#8e8a84'),
  ],
  size: (p) => [num(p, 'width') + 0.04, num(p, 'height') + (bool(p, 'headboard') ? 0.7 : 0.15), num(p, 'length') + (bool(p, 'headboard') ? 0.1 : 0)],
  build(p, out) {
    const w = num(p, 'width'),
      L = num(p, 'length'),
      h = num(p, 'height');
    const frame = mat('wood', str(p, 'frameColor'), 'wood');
    const sheet = mat('fabric', str(p, 'sheetColor'), 'fabric');
    const duvet = mat('fabric', str(p, 'duvetColor'), 'fabric');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.lathe(frame, [[0.025, 0], [0.032, 0.16]], 10, [sx * (w / 2 - 0.09), 0, sz * (L / 2 - 0.09)]);
    out.rbox(frame, [0, 0.24, 0], [w, 0.16, L], 0.015);
    out.rbox(sheet, [0, (0.32 + h) / 2, 0], [w - 0.05, h - 0.32, L - 0.05], 0.05);
    // Duvet from the waist down, hanging over the sides and the foot, with a folded band at the top.
    const z0 = -L / 2 + L * 0.3;
    const z1 = L / 2 + 0.02;
    out.rbox(duvet, [0, h - 0.06, (z0 + z1) / 2], [w + 0.04, 0.22, z1 - z0], 0.07);
    out.rbox(duvet, [0, h + 0.05, z0 + 0.12], [w + 0.03, 0.07, 0.26], 0.03);
    const n = w > 1.2 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const pw = (w - 0.14) / n;
      out.rbox(sheet, [-w / 2 + 0.07 + (i + 0.5) * pw, h + 0.09, -L / 2 + 0.36], [pw - 0.06, 0.17, 0.46], 0.08, [0, -12, 0]);
    }
    if (bool(p, 'headboard')) {
      const bh = h + 0.5;
      const style = str(p, 'board');
      if (style === 'slats') {
        const k = Math.max(4, Math.round(w / 0.16));
        for (let i = 0; i < k; i++) out.rbox(frame, [-w / 2 + (w * (i + 0.5)) / k, bh / 2 + 0.12, -L / 2 - 0.04], [w / k - 0.03, bh, 0.05], 0.008);
        out.rbox(frame, [0, bh + 0.14, -L / 2 - 0.04], [w + 0.04, 0.05, 0.07], 0.01);
      } else if (style === 'wood') out.rbox(frame, [0, bh / 2 + 0.15, -L / 2 - 0.04], [w + 0.04, bh, 0.06], 0.012);
      else out.rbox(mat('fabric', str(p, 'boardColor'), 'fabric'), [0, bh / 2 + 0.16, -L / 2 - 0.05], [w + 0.06, bh, 0.1], 0.05);
    }
  },
};

export const DINING_TABLE: Family = {
  id: 'dining-table',
  name: 'Table',
  category: 'furniture',
  host: 'free',
  tags: ['table', 'dining', 'kitchen', 'interior'],
  params: [
    P.len('width', 'Width', 1.8, 0.6, 3.6),
    P.len('depth', 'Depth', 0.9, 0.6, 2),
    P.len('height', 'Height', 0.75, 0.4, 1.1),
    P.len('top', 'Top thickness', 0.04, 0.02, 0.12, 'type', 'profile', 0.01),
    P.pick('shape', 'Top', 'rect', [
      ['rect', 'Rectangular'],
      ['round', 'Round'],
    ]),
    P.pick('material', 'Material', 'wood', [
      ['wood', 'Wood'],
      ['stone', 'Stone'],
      ['metal', 'Metal'],
    ]),
    P.color('color', 'Color', '#8a6240'),
    P.finish('finish', 'Finish', 'wood'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), str(p, 'shape') === 'round' ? num(p, 'width') : num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height'),
      t = num(p, 'top');
    const k = str(p, 'material');
    const m = mat(k === 'stone' ? 'stone' : k === 'metal' ? 'metal' : 'wood', str(p, 'color'), str(p, 'finish'));
    if (str(p, 'shape') === 'round') {
      // Pedestal table: foot, column and top in a single solid of revolution.
      const r = w / 2;
      out.lathe(m, [[Math.min(0.45, r * 0.55), 0], [Math.min(0.4, r * 0.5), 0.04], [0.07, 0.09], [0.07, h - t], [r, h - t], [r, h]], 28);
      return;
    }
    out.box(m, [0, h - t / 2, 0], [w, t, d]);
    const ay = h - t - 0.04;
    for (const sz of [-1, 1]) out.box(m, [0, ay, (sz * (d - 0.16)) / 2], [w - 0.16, 0.08, 0.03]);
    for (const sx of [-1, 1]) out.box(m, [(sx * (w - 0.16)) / 2, ay, 0], [0.03, 0.08, d - 0.16]);
    legs4(out, m, w, d, 0, h - t, 0.07, 0.09);
  },
};

export const CHAIR: Family = {
  id: 'chair',
  name: 'Chair',
  category: 'furniture',
  host: 'free',
  tags: ['chair', 'seat', 'dining', 'kitchen', 'interior'],
  params: [
    P.len('width', 'Width', 0.45, 0.3, 0.7),
    P.len('depth', 'Depth', 0.48, 0.3, 0.7),
    P.len('seatH', 'Seat height', 0.45, 0.3, 0.6, 'type', 'size', 0.01),
    P.len('backH', 'Back height', 0.85, 0.5, 1.2, 'type', 'size', 0.01),
    P.angle('tilt', 'Back tilt', 6, 0, 20),
    P.flag('back', 'Back rest', true, 'profile'),
    P.pick('material', 'Material', 'wood', [
      ['wood', 'Wood'],
      ['metal', 'Metal'],
      ['plastic', 'Plastic'],
    ]),
    P.color('color', 'Color', '#9a6a42'),
    P.finish('finish', 'Finish', 'wood'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'backH'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      sh = num(p, 'seatH'),
      bh = num(p, 'backH');
    const k = str(p, 'material');
    const m = mat(k === 'metal' ? 'metal' : k === 'plastic' ? 'panel' : 'wood', str(p, 'color'), str(p, 'finish'));
    legs4(out, m, w, d, 0, sh - 0.04, 0.035, 0.045);
    out.box(m, [0, sh - 0.02, 0], [w, 0.04, d]);
    if (!bool(p, 'back')) return;
    const lean = -num(p, 'tilt');
    const zb = -d / 2 + 0.035;
    for (const sx of [-1, 1]) out.rod(m, [sx * (w / 2 - 0.035), sh, zb], [sx * (w / 2 - 0.035), bh, zb + Math.sin(toRad(lean)) * (bh - sh)], 0.018, 6);
    const rows = 3;
    for (let i = 0; i < rows; i++) {
      const y = sh + 0.08 + ((bh - sh - 0.14) * i) / (rows - 1);
      out.box(m, [0, y, zb + Math.sin(toRad(lean)) * (y - sh)], [w - 0.05, 0.07, 0.03], [0, lean, 0]);
    }
  },
};

export const DESK: Family = {
  id: 'desk',
  name: 'Desk',
  category: 'furniture',
  host: 'free',
  tags: ['desk', 'table', 'office', 'study', 'drawers', 'interior'],
  params: [
    P.len('width', 'Width', 1.4, 0.8, 2.4),
    P.len('depth', 'Depth', 0.7, 0.4, 1),
    P.len('height', 'Height', 0.75, 0.6, 1.1),
    P.count('drawers', 'Drawers', 3, 1, 5),
    P.color('color', 'Color', '#c9b28f'),
    P.finish('finish', 'Finish', 'wood'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const n = clamp(Math.round(num(p, 'drawers')), 1, 5);
    const m = mat('wood', str(p, 'color'), str(p, 'finish'));
    const steel = mat('metal', '#6f767b', 'metal');
    out.box(m, [0, h - 0.02, 0], [w, 0.04, d]);
    out.box(m, [0, h * 0.55, -d / 2 + 0.02], [w - 0.12, h * 0.35, 0.03]);
    // Panel leg on the left, drawer block on the right.
    out.box(m, [-w / 2 + 0.02, (h - 0.04) / 2, 0], [0.04, h - 0.04, d - 0.06]);
    const dw = Math.min(0.45, w * 0.34);
    const dx = w / 2 - dw / 2 - 0.03;
    out.box(m, [dx, (0.1 + h - 0.04) / 2, -0.02], [dw, h - 0.14, d - 0.06]);
    const ph = (h - 0.2) / n;
    for (let i = 0; i < n; i++) {
      const y = 0.1 + ph * (i + 0.5);
      out.box(m, [dx, y, d / 2 - 0.03], [dw - 0.02, ph - 0.02, 0.02]);
      out.rod(steel, [dx - dw / 2 + 0.08, y + ph * 0.3, d / 2 - 0.005], [dx + dw / 2 - 0.08, y + ph * 0.3, d / 2 - 0.005], 0.008, 6);
    }
  },
};

export const OFFICE_CHAIR: Family = {
  id: 'office-chair',
  name: 'Office chair',
  category: 'furniture',
  host: 'free',
  tags: ['chair', 'office', 'swivel', 'wheels', 'interior'],
  params: [
    P.len('width', 'Seat width', 0.48, 0.4, 0.7, 'type', 'size', 0.01),
    P.len('seatH', 'Seat height', 0.46, 0.35, 0.6, 'type', 'size', 0.01),
    P.len('backH', 'Back height', 0.55, 0.3, 0.9, 'type', 'size', 0.01),
    P.flag('arms', 'Arm rests', true, 'profile'),
    P.color('color', 'Color', '#43494e'),
    P.finish('finish', 'Upholstery', 'fabric'),
  ],
  size: (p) => [num(p, 'width') + 0.2, num(p, 'seatH') + num(p, 'backH') + 0.35, num(p, 'width') + 0.4],
  build(p, out) {
    const sw = num(p, 'width'),
      sh = num(p, 'seatH'),
      bh = num(p, 'backH');
    const m = mat('fabric', str(p, 'color'), str(p, 'finish'));
    const steel = mat('metal', '#8e959a', 'metal');
    const dark = mat('dark', '#1e2022');
    // Five-star base: spokes, casters and the gas lift.
    const R = 0.32;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const ex = Math.cos(a) * R,
        ez = Math.sin(a) * R;
      out.rod(steel, [0, 0.1, 0], [ex, 0.08, ez], 0.022, 8);
      out.cylinder(dark, [ex, 0, ez], 0.035, 0.08, 10);
    }
    out.cylinder(steel, [0, 0.08, 0], 0.03, sh - 0.14, 12);
    out.box(steel, [0, sh - 0.05, 0], [0.2, 0.06, 0.2]);
    out.box(m, [0, sh + 0.06, 0], [sw, 0.12, sw * 0.95]);
    const tilt = -12;
    out.box(m, [0, sh + 0.16 + bh / 2, -0.2 - Math.sin(toRad(tilt)) * (bh / 2)], [sw * 0.95, bh, 0.09], [0, tilt, 0]);
    out.rod(steel, [0, sh + 0.08, 0.02], [0, sh + 0.16 + bh * 0.6, -0.22], 0.022, 8);
    if (bool(p, 'arms'))
      for (const sx of [-1, 1]) {
        out.rod(steel, [sx * 0.26, sh + 0.1, 0], [sx * 0.26, sh + 0.3, -0.06], 0.02, 8);
        out.box(m, [sx * 0.26, sh + 0.32, -0.03], [0.06, 0.05, 0.32]);
      }
  },
};

/**
 * Kitchen counter as a joiner makes it (planned kitchen): base cabinets in modules of a chosen width, the
 * sink and the cooktop where they are asked for along the run, and wall cabinets above if wanted. The
 * usual sizes: the counter 0.90 m high and 0.60 m deep, the wall cabinets 0.70 m high and 0.35 m deep
 * with 0.58 m clear over the counter, never less than 0.65 m over a cooktop
 * (https://planner5d.com/blog/pt/altura-de-armario-de-cozinha/): with less, the wall cabinet over the
 * cooktop is left out (a hood goes there instead).
 */
export const KITCHEN_COUNTER: Family = {
  id: 'kitchen-counter',
  name: 'Kitchen counter',
  category: 'furniture',
  host: 'free',
  tags: ['kitchen', 'counter', 'cabinet', 'sink', 'cooktop', 'wall cabinet', 'joinery', 'planned', 'interior'],
  params: [
    P.len('width', 'Length', 2.4, 0.6, 6),
    P.len('depth', 'Depth', 0.6, 0.4, 1.2),
    P.len('height', 'Height', 0.9, 0.7, 1.1, 'type', 'size', 0.01),
    P.len('module', 'Module width', 0.6, 0.3, 1, 'type', 'divisions', 0.05),
    P.flag('sink', 'Sink', true, 'detail'),
    P.ratio('sinkAt', 'Sink position along', 0.25, 'type'),
    P.flag('cooktop', 'Cooktop', false, 'detail'),
    P.ratio('cooktopAt', 'Cooktop position along', 0.75, 'type'),
    P.flag('upper', 'Wall cabinets', false, 'detail'),
    P.len('upperH', 'Wall cabinet height', 0.7, 0.3, 1.05, 'type', 'size', 0.05),
    P.len('upperGap', 'Clear over the counter', 0.58, 0.45, 0.9, 'type', 'size', 0.01),
    P.len('upperD', 'Wall cabinet depth', 0.35, 0.25, 0.45, 'type', 'size', 0.01),
    P.color('cabinetColor', 'Cabinet color', '#dfd8cb'),
    P.color('topColor', 'Countertop color', '#4a4f52'),
    P.finish('cabinetFinish', 'Cabinet finish', 'paint'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + (bool(p, 'upper') ? num(p, 'upperGap') + num(p, 'upperH') : 0), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const cab = mat('wood', str(p, 'cabinetColor'), str(p, 'cabinetFinish'));
    const top = mat('stone', str(p, 'topColor'), 'stone');
    const steel = mat('metal', '#9aa0a4', 'metal');
    out.box(cab, [0, 0.05, -0.02], [w - 0.1, 0.1, d - 0.12]);
    out.box(cab, [0, (0.1 + h - 0.04) / 2, -0.01], [w, h - 0.14, d - 0.02]);
    out.box(top, [0, h - 0.02, 0], [w + 0.02, 0.04, d + 0.02]);
    const lay = kitchenLayout(p);
    const dh = h - 0.22;
    lay.mods.forEach((m, i) => {
      out.box(cab, [m.x, 0.14 + dh / 2, d / 2 - 0.02], [m.w - 0.02, dh, 0.02]);
      // Under the cooktop: drawers (three fronts); elsewhere a door with its handle on the side away from the next.
      if (lay.cooktop !== null && Math.abs(m.x - lay.cooktop) < m.w / 2) {
        for (let k = 1; k < 3; k++) out.box(mat('dark', '#2b2f31'), [m.x, 0.14 + (dh * k) / 3, d / 2 - 0.005], [m.w - 0.02, 0.006, 0.006]);
        for (let k = 0; k < 3; k++) out.rod(steel, [m.x - 0.09, 0.14 + (dh * (k + 0.8)) / 3, d / 2 + 0.01], [m.x + 0.09, 0.14 + (dh * (k + 0.8)) / 3, d / 2 + 0.01], 0.008, 6);
      } else {
        const hx = m.x + (i % 2 === 0 ? m.w / 2 - 0.05 : -m.w / 2 + 0.05);
        out.rod(steel, [hx, 0.14 + dh * 0.5, d / 2 + 0.01], [hx, 0.14 + dh * 0.5 + 0.18, d / 2 + 0.01], 0.009, 6);
      }
    });
    if (lay.sink !== null) {
      const sx = lay.sink;
      out.box(mat('metal', '#5d6469', 'metal'), [sx, h - 0.005, 0.03], [0.5, 0.03, 0.4]);
      out.box(mat('dark', '#2b2f31'), [sx, h + 0.007, 0.03], [0.42, 0.01, 0.32]);
      out.rod(steel, [sx, h, -0.14], [sx, h + 0.26, -0.14], 0.016, 8);
      out.rod(steel, [sx, h + 0.26, -0.14], [sx, h + 0.24, 0], 0.014, 8);
    }
    if (lay.cooktop !== null) {
      const cx = lay.cooktop;
      const glass = mat('dark', '#1e2123');
      out.box(glass, [cx, h + 0.004, 0], [0.58, 0.008, 0.5]);
      for (const bx of [-0.14, 0.14]) for (const bz of [-0.11, 0.11]) out.cylinder(steel, [cx + bx, h + 0.008, bz], 0.06, 0.012, 16);
    }
    if (lay.upper) {
      const { y0, uh, ud } = lay.upper;
      const z = -d / 2 + ud / 2;
      for (const m of lay.upperMods) {
        out.box(cab, [m.x, y0 + uh / 2, z - 0.01], [m.w - 0.01, uh, ud - 0.02]);
        out.box(cab, [m.x, y0 + uh / 2, z + ud / 2 - 0.01], [m.w - 0.02, uh - 0.01, 0.02]);
        out.rod(steel, [m.x - 0.08, y0 + 0.04, z + ud / 2 + 0.01], [m.x + 0.08, y0 + 0.04, z + ud / 2 + 0.01], 0.008, 6);
      }
      // Over the cooktop when the wall cabinet is left out: a hood.
      if (lay.hood !== null) {
        out.box(steel, [lay.hood, y0 + 0.05, -d / 2 + 0.25], [0.6, 0.1, 0.5]);
        out.box(steel, [lay.hood, y0 + uh / 2 + 0.05, -d / 2 + 0.13], [0.26, uh - 0.1, 0.26]);
      }
    }
  },
};

/** Where the modules, the sink and the cooktop of a kitchen counter fall along its length (x from −w/2). */
export function kitchenLayout(p: Parameters<Family['size']>[0]): {
  mods: { x: number; w: number }[];
  sink: number | null;
  cooktop: number | null;
  upper: { y0: number; uh: number; ud: number } | null;
  upperMods: { x: number; w: number }[];
  hood: number | null;
} {
  const w = num(p, 'width'),
    h = num(p, 'height');
  const n = Math.max(1, Math.round(w / Math.max(0.3, num(p, 'module') || 0.6)));
  const mods = Array.from({ length: n }, (_, i) => ({ x: -w / 2 + (i + 0.5) * (w / n), w: w / n }));
  // Each sits centred on the module nearest to where it is asked for (a sink or a cooktop takes one module).
  const at = (r: number, half: number) => {
    const want = -w / 2 + clamp(r, 0, 1) * w;
    const m = mods.reduce((b, x) => (Math.abs(x.x - want) < Math.abs(b.x - want) ? x : b));
    return Math.max(-w / 2 + half, Math.min(w / 2 - half, m.x));
  };
  const sink = bool(p, 'sink') ? at(p.sinkAt === undefined ? 0.25 : num(p, 'sinkAt'), 0.25) : null;
  let cooktop = bool(p, 'cooktop') ? at(p.cooktopAt === undefined ? 0.75 : num(p, 'cooktopAt'), 0.3) : null;
  // The sink and the cooktop never share the same place on the counter.
  if (cooktop !== null && sink !== null && Math.abs(cooktop - sink) < 0.6) cooktop = null;
  if (!bool(p, 'upper')) return { mods, sink, cooktop, upper: null, upperMods: [], hood: null };
  const gap = num(p, 'upperGap') || 0.58;
  const upper = { y0: h + gap, uh: num(p, 'upperH') || 0.7, ud: num(p, 'upperD') || 0.35 };
  const hood = cooktop !== null && gap < 0.65 ? cooktop : null;
  // Without the 0.65 m over the cooktop, the wall cabinets stop either side of its 0.60 m hood.
  const upperMods = hood === null ? mods : mods.filter((m) => m.x + m.w / 2 <= hood - 0.3 + 1e-6 || m.x - m.w / 2 >= hood + 0.3 - 1e-6);
  return { mods, sink, cooktop, upper, upperMods, hood };
}

/** Wardrobe: hinged doors, or sliding doors running in two tracks (each panel overlapping the next). */
export const WARDROBE: Family = {
  id: 'wardrobe',
  name: 'Wardrobe',
  category: 'furniture',
  host: 'free',
  tags: ['wardrobe', 'closet', 'storage', 'bedroom', 'sliding', 'joinery', 'planned', 'interior'],
  params: [
    P.len('width', 'Width', 1.8, 0.6, 3.6),
    P.len('depth', 'Depth', 0.6, 0.4, 1),
    P.len('height', 'Height', 2.2, 1.4, 3, 'type', 'size', 0.05),
    P.count('doors', 'Doors', 2, 1, 4),
    P.pick('doorKind', 'Door type', 'hinged', [
      ['hinged', 'Hinged'],
      ['sliding', 'Sliding'],
    ]),
    P.flag('mirror', 'Mirror on the doors', false, 'detail'),
    P.color('color', 'Color', '#e6e1d6'),
    P.color('handleColor', 'Handle color', '#8e959a'),
    P.finish('finish', 'Finish', 'paint'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const sliding = str(p, 'doorKind') === 'sliding';
    const n = clamp(Math.round(num(p, 'doors')), sliding ? 2 : 1, 4);
    const m = mat('panel', str(p, 'color'), str(p, 'finish'));
    const hnd = mat('metal', str(p, 'handleColor'), 'metal');
    const mirror: PartMat = { slot: 'glass', color: '#c9d3d6' };
    out.box(m, [0, 0.05, -0.02], [w - 0.06, 0.1, d - 0.06]);
    out.box(m, [0, (0.1 + h - 0.06) / 2, sliding ? -0.04 : 0], [w, h - 0.16, sliding ? d - 0.08 : d]);
    out.box(m, [0, h - 0.03, 0], [w + 0.02, 0.06, d + 0.02]);
    const dh = h - 0.24;
    for (let i = 0; i < n; i++) {
      const dw = sliding ? w / n + 0.03 : w / n;
      const x = sliding ? -w / 2 + dw / 2 + (i * (w - dw)) / Math.max(1, n - 1) : -w / 2 + (i + 0.5) * dw;
      // Sliding panels alternate between the front and the back track.
      const z = sliding ? d / 2 - 0.02 - (i % 2) * 0.035 : d / 2 + 0.012;
      out.box(m, [x, 0.12 + dh / 2, z], [dw - 0.014, dh, 0.024]);
      if (bool(p, 'mirror') && (!sliding || i % 2 === 0)) out.box(mirror, [x, 0.12 + dh / 2, z + 0.013], [dw - 0.12, dh - 0.2, 0.004]);
      if (sliding) {
        const hx = i === 0 ? x - dw / 2 + 0.04 : i === n - 1 ? x + dw / 2 - 0.04 : x + dw / 2 - 0.04;
        out.box(hnd, [hx, h * 0.5, z + 0.014], [0.02, 0.5, 0.008]);
      } else {
        const hx = x + (i < n / 2 ? dw / 2 - 0.05 : -dw / 2 + 0.05);
        out.rod(hnd, [hx, h * 0.5, d / 2 + 0.04], [hx, h * 0.5 + 0.4, d / 2 + 0.04], 0.01, 6);
      }
    }
  },
};

/** Book spines: the renderer has no textures, the colors carry the detail. */
const BOOK_COLORS = ['#8c3b34', '#3b5a8c', '#4c7a3a', '#c8a45a', '#6b4a7a', '#2e5d5a', '#a8563a', '#5a5f66'];

export const BOOKSHELF: Family = {
  id: 'bookshelf',
  name: 'Bookshelf',
  category: 'furniture',
  host: 'free',
  tags: ['bookshelf', 'shelf', 'library', 'storage', 'interior'],
  params: [
    P.len('width', 'Width', 0.9, 0.4, 2.4),
    P.len('depth', 'Depth', 0.32, 0.2, 0.5),
    P.len('height', 'Height', 2, 0.8, 3, 'type', 'size', 0.05),
    P.count('shelves', 'Compartments', 4, 1, 8),
    P.flag('books', 'Books', true, 'detail'),
    P.color('color', 'Color', '#b08a5e'),
    P.finish('finish', 'Finish', 'wood'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const n = clamp(Math.round(num(p, 'shelves')), 1, 8);
    const t = 0.025;
    const m = mat('wood', str(p, 'color'), str(p, 'finish'));
    for (const sx of [-1, 1]) out.box(m, [(sx * (w - t)) / 2, h / 2, 0], [t, h, d]);
    out.box(m, [0, t / 2, 0], [w, t, d]);
    out.box(m, [0, h - t / 2, 0], [w, t, d]);
    out.box(m, [0, h / 2, -d / 2 + t / 2], [w, h, t]);
    const cH = (h - 2 * t) / n;
    for (let i = 1; i < n; i++) out.box(m, [0, t + i * cH, 0], [w - 2 * t, t, d - 0.02]);
    if (!bool(p, 'books')) return;
    for (let i = 0; i < n; i++) {
      const y0 = t + i * cH;
      let x = -w / 2 + t + 0.03;
      for (let k = 0; k < 40; k++) {
        const r1 = hash01(i * 40 + k, k);
        const bw = 0.018 + r1 * 0.03;
        if (x + bw > w / 2 - t - 0.03) break;
        const bh = Math.min(cH - 0.06, 0.16 + hash01(i * 40 + k, k + 7) * 0.1);
        const ci = Math.floor(hash01(i * 40 + k, k + 3) * BOOK_COLORS.length);
        out.box(mat('panel', BOOK_COLORS[ci]!, 'paint'), [x + bw / 2, y0 + bh / 2, 0.005], [bw, bh, d * 0.55]);
        x += bw + 0.004;
      }
    }
  },
};

export const TV_UNIT: Family = {
  id: 'tv-unit',
  name: 'TV unit',
  category: 'furniture',
  host: 'free',
  tags: ['tv', 'sideboard', 'media', 'living room', 'storage', 'interior'],
  params: [
    P.len('width', 'Width', 1.8, 0.8, 3.2),
    P.len('depth', 'Depth', 0.42, 0.3, 0.7),
    P.len('height', 'Height', 0.45, 0.25, 0.8, 'type', 'size', 0.01),
    P.count('doors', 'Doors', 2, 1, 4),
    P.flag('tv', 'TV on top', true, 'detail'),
    P.color('color', 'Color', '#e2ddd2'),
    P.finish('finish', 'Finish', 'paint'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + (bool(p, 'tv') ? 0.85 : 0.03), num(p, 'depth') + 0.05],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const n = clamp(Math.round(num(p, 'doors')), 1, 4);
    const m = mat('panel', str(p, 'color'), str(p, 'finish'));
    const dark = mat('dark', '#1c1f21');
    const steel = mat('metal', '#8e959a', 'metal');
    out.box(m, [0, (0.06 + h) / 2, 0], [w, h - 0.06, d]);
    out.box(m, [0, h + 0.015, 0], [w + 0.02, 0.03, d + 0.02]);
    out.box(dark, [0, 0.03, -0.02], [w - 0.1, 0.06, d - 0.08]);
    const dh = h - 0.2;
    for (let i = 0; i < n; i++) {
      const cw = w / n;
      const x = -w / 2 + (i + 0.5) * cw;
      out.box(m, [x, 0.13 + dh / 2, d / 2 + 0.01], [cw - 0.02, dh, 0.02]);
      const hx = x + (i < n - 1 ? cw / 2 - 0.05 : -cw / 2 + 0.05);
      out.rod(steel, [hx, h * 0.5, d / 2 + 0.03], [hx, h * 0.5 + 0.16, d / 2 + 0.03], 0.008, 6);
    }
    if (bool(p, 'tv')) {
      const tw = Math.min(w * 0.6, 1.3);
      const th = tw * 0.58;
      out.box(dark, [0, h + 0.06, -0.02], [tw * 0.3, 0.04, 0.2]);
      out.box(dark, [0, h + 0.1 + th / 2, -0.02], [tw, th, 0.05]);
      out.box(mat('light', '#39424a'), [0, h + 0.1 + th / 2, 0.006], [tw - 0.06, th - 0.06, 0.006]);
    }
  },
};

export const TOILET: Family = {
  id: 'toilet',
  name: 'Toilet',
  category: 'furniture',
  host: 'free',
  tags: ['toilet', 'wc', 'bathroom', 'sanitary', 'interior'],
  params: [
    P.pick('kind', 'Type', 'close', [
      ['close', 'Close-coupled (cistern)'],
      ['wall', 'Wall-hung (flush plate)'],
    ]),
    P.len('width', 'Width', 0.38, 0.32, 0.5, 'type', 'size', 0.01),
    P.len('depth', 'Depth', 0.66, 0.5, 0.8),
    P.len('height', 'Height', 0.78, 0.6, 0.95, 'type', 'size', 0.01),
    P.flag('lid', 'Lid closed', false, 'detail'),
    P.color('color', 'Ceramic', '#f6f6f2'),
    P.color('seatColor', 'Seat', '#f0efea'),
  ],
  size: (p) => [num(p, 'width') + 0.02, num(p, 'height') + 0.05, num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const wall = str(p, 'kind') === 'wall';
    const cer = mat('stone', str(p, 'color'), 'ceramic');
    const seatM = mat('panel', str(p, 'seatColor'), 'paint');
    const rim = 0.41;
    const a = w / 2,
      b = Math.min(0.27, (d - 0.14) / 2);
    const zc = d / 2 - b - 0.01;
    // Bowl: one skin from the foot up the outside, over the rim and down into the bowl.
    const foot: Vec3[][] = wall
      ? [oval(a * 0.55, b * 0.6, 0.3, 3, 40, 0, zc - b * 0.2), oval(a * 0.85, b * 0.85, 0.34, 3, 40, 0, zc - b * 0.1)]
      : [oval(0.1, 0.15, 0, 3, 40, 0, zc - 0.03), oval(0.1, 0.15, 0.1, 3, 40, 0, zc - 0.03), oval(0.13, 0.19, 0.22, 3, 40, 0, zc - 0.02)];
    out.loft(
      cer,
      [
        ...foot,
        oval(a * 0.92, b * 0.92, rim - 0.06, 2.4, 40, 0, zc),
        oval(a, b, rim - 0.015, 2.4, 40, 0, zc),
        oval(a - 0.01, b - 0.01, rim, 2.4, 40, 0, zc),
        oval(a - 0.04, b - 0.045, rim, 2.4, 40, 0, zc + 0.005),
        oval(a * 0.66, b * 0.66, rim - 0.08, 2.2, 40, 0, zc + 0.02),
        oval(0.07, 0.08, rim - 0.2, 2, 40, 0, zc + 0.04),
      ],
      [true, true],
    );
    out.slab(mat('glass', '#9fb7bd'), oval(0.085, 0.1, 0, 2, 20, 0, zc + 0.035).map(([x, , z]) => [x, z] as [number, number]), rim - 0.19, rim - 0.185);
    // Seat ring (a flattened torus) and, closed, the lid.
    const sy = rim + 0.005,
      st = 0.025;
    out.loft(seatM, [oval(a, b, sy, 2.4, 40, 0, zc), oval(a + 0.004, b + 0.004, sy + st * 0.6, 2.4, 40, 0, zc), oval(a - 0.005, b - 0.005, sy + st, 2.4, 40, 0, zc), oval(a - 0.06, b - 0.07, sy + st, 2.4, 40, 0, zc + 0.01), oval(a - 0.065, b - 0.075, sy, 2.4, 40, 0, zc + 0.01), oval(a, b, sy, 2.4, 40, 0, zc)]);
    if (bool(p, 'lid')) out.loft(seatM, [oval(a - 0.002, b - 0.002, sy + st, 2.4, 40, 0, zc), oval(a, b, sy + st + 0.015, 2.4, 40, 0, zc), oval(a - 0.02, b - 0.02, sy + st + 0.025, 2.4, 40, 0, zc)], [false, true]);
    if (wall) {
      out.rbox(cer, [0, 0.36, -d / 2 + 0.06], [w * 0.75, 0.18, 0.12], 0.04);
      out.rbox(mat('metal', '#d6d8d8', 'metal'), [0, 1.05, -d / 2 + 0.005], [0.24, 0.16, 0.012], 0.008);
      return;
    }
    // Cistern with its lid and push button.
    const tw = w * 0.95;
    out.rbox(cer, [0, (rim - 0.02 + h) / 2, -d / 2 + 0.09], [tw, h - rim + 0.02, 0.17], 0.03);
    out.rbox(cer, [0, h + 0.015, -d / 2 + 0.09], [tw + 0.02, 0.035, 0.19], 0.012);
    out.lathe(mat('metal', '#c8ccce', 'metal'), [[0.028, 0], [0.028, 0.008], [0.024, 0.012]], 16, [0, h + 0.032, -d / 2 + 0.09]);
  },
};

export const SINK: Family = {
  id: 'sink',
  name: 'Sink',
  category: 'furniture',
  host: 'free',
  tags: ['sink', 'basin', 'bathroom', 'vanity', 'sanitary', 'interior'],
  params: [
    P.pick('kind', 'Type', 'vanity', [
      ['vanity', 'Vanity unit'],
      ['pedestal', 'Pedestal basin'],
      ['wall', 'Wall-hung basin'],
      ['vessel', 'Vessel on a counter'],
    ]),
    P.len('width', 'Width', 0.6, 0.4, 1.4),
    P.len('depth', 'Depth', 0.5, 0.35, 0.7),
    P.len('height', 'Height', 0.85, 0.7, 1, 'type', 'size', 0.01),
    P.count('drawers', 'Drawers', 0, 0, 3, 'divisions'),
    P.color('color', 'Ceramic', '#f6f6f2'),
    P.color('cabinetColor', 'Cabinet', '#7a6a58'),
    P.color('metalColor', 'Tap', '#c8ccce'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + 0.25, num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const kind = str(p, 'kind');
    const cer = mat('stone', str(p, 'color'), 'ceramic');
    const steel = mat('metal', str(p, 'metalColor'), 'metal');
    const cab = mat('panel', str(p, 'cabinetColor'), 'paint');
    const a = w / 2,
      b = d / 2;
    if (kind === 'vanity' || kind === 'vessel') {
      // Carcass on a recessed plinth, fronts with 3 mm gaps (doors, or drawers stacked) and bar handles.
      const top = kind === 'vessel' ? h - 0.14 : h - 0.12;
      out.rbox(cab, [0, 0.05, -0.02], [w - 0.06, 0.1, d - 0.08], 0.004);
      out.rbox(cab, [0, (0.1 + top) / 2, -0.01], [w, top - 0.1, d - 0.02], 0.006);
      const nd = Math.round(num(p, 'drawers'));
      const fh = top - 0.12;
      if (nd > 0) {
        for (let i = 0; i < nd; i++) {
          const y0 = 0.11 + (fh * i) / nd,
            y1 = 0.11 + (fh * (i + 1)) / nd - 0.003;
          out.rbox(cab, [0, (y0 + y1) / 2, d / 2 - 0.005], [w - 0.006, y1 - y0, 0.02], 0.004);
          out.rod(steel, [-w * 0.2, y1 - 0.05, d / 2 + 0.02], [w * 0.2, y1 - 0.05, d / 2 + 0.02], 0.006, 8);
        }
      } else
        for (const sx of w > 0.7 ? [-1, 1] : [1]) {
          const dw = w > 0.7 ? w / 2 - 0.004 : w - 0.006;
          const cx = w > 0.7 ? (sx * w) / 4 : 0;
          out.rbox(cab, [cx, 0.11 + fh / 2, d / 2 - 0.005], [dw, fh, 0.02], 0.004);
          const hx = cx - sx * (dw / 2 - 0.05);
          out.rod(steel, [hx, 0.11 + fh - 0.22, d / 2 + 0.02], [hx, 0.11 + fh - 0.06, d / 2 + 0.02], 0.006, 8);
        }
      if (kind === 'vessel') {
        out.rbox(mat('stone', '#dcd8d0', 'stone'), [0, top + 0.015, 0], [w + 0.02, 0.03, d], 0.006);
        const r = Math.min(a, b) * 0.78;
        out.loft(cer, [oval(r * 0.55, r * 0.55, top + 0.03, 2, 36), oval(r * 0.95, r * 0.95, top + 0.08, 2, 36), oval(r, r, top + 0.14, 2, 36), oval(r - 0.012, r - 0.012, top + 0.145, 2, 36), oval(r * 0.88, r * 0.88, top + 0.09, 2, 36), oval(r * 0.3, r * 0.3, top + 0.045, 2, 36)], [true, true]);
        out.rod(steel, [0, top + 0.03, -b + 0.06], [0, top + 0.3, -b + 0.06], 0.014, 12);
        out.rod(steel, [0, top + 0.3, -b + 0.06], [0, top + 0.29, -b + 0.2], 0.012, 12);
        return;
      }
    } else if (kind === 'pedestal') out.lathe(cer, [[0.12, 0], [0.13, 0.015], [0.1, 0.05], [0.075, 0.2], [0.07, h - 0.3], [0.1, h - 0.17], [0.14, h - 0.13]], 28, [0, 0, -b * 0.25]);
    // Basin: a rounded rectangle skin from its underside up, over the rim and down into the bowl.
    const y0 = h - 0.17;
    out.loft(
      cer,
      [
        oval(a - 0.05, b - 0.06, y0, 4, 48),
        oval(a - 0.005, b - 0.005, h - 0.04, 5, 48),
        oval(a, b, h - 0.01, 5, 48),
        oval(a - 0.01, b - 0.01, h, 5, 48),
        oval(a - 0.05, b - 0.06, h, 4, 48, 0, 0.01),
        oval(a - 0.07, b - 0.09, h - 0.06, 3, 48, 0, 0.02),
        oval(0.06, 0.05, h - 0.14, 2, 48, 0, 0.03),
      ],
      [true, true],
    );
    out.cylinder(mat('metal', '#9aa0a4', 'metal'), [0, h - 0.142, 0.03], 0.025, 0.004, 16);
    // Mixer tap: base, spout bent towards the bowl, lever.
    out.lathe(steel, [[0.026, 0], [0.024, 0.04], [0.018, 0.16]], 16, [0, h, -b + 0.06]);
    out.rod(steel, [0, h + 0.15, -b + 0.06], [0, h + 0.13, -b + 0.18], 0.011, 12);
    out.rod(steel, [0, h + 0.16, -b + 0.06], [0, h + 0.2, -b + 0.02], 0.007, 8);
  },
};

export const BATHTUB: Family = {
  id: 'bathtub',
  name: 'Bathtub',
  category: 'furniture',
  host: 'free',
  tags: ['bathtub', 'tub', 'bathroom', 'sanitary', 'interior'],
  params: [
    P.pick('kind', 'Type', 'built', [
      ['built', 'Built-in (apron)'],
      ['free', 'Freestanding'],
      ['clawfoot', 'Clawfoot'],
    ]),
    P.len('width', 'Length', 1.7, 1.2, 2.2),
    P.len('depth', 'Depth', 0.8, 0.6, 1.1),
    P.len('height', 'Rim height', 0.6, 0.4, 0.9, 'type', 'size', 0.01),
    P.flag('water', 'Water', true, 'detail'),
    P.color('color', 'Color', '#f4f3ee'),
    P.color('waterColor', 'Water color', '#6fa6b8'),
    P.color('metalColor', 'Taps and feet', '#c8ccce'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const kind = str(p, 'kind');
    const shell = mat('stone', str(p, 'color'), 'ceramic');
    const steel = mat('metal', str(p, 'metalColor'), 'metal');
    const a = w / 2,
      b = d / 2;
    const n = kind === 'built' ? 6 : 2.6;
    const lift = kind === 'clawfoot' ? 0.14 : 0;
    // Outer wall up (a slab-sided apron, or a tub swelling out to its rim), the rim, the bowl down to its floor.
    const outer = kind === 'built' ? [oval(a, b, 0, n, 56), oval(a, b, h - 0.03, n, 56)] : [oval(a * 0.8, b * 0.72, lift, n, 56), oval(a * 0.9, b * 0.86, lift + (h - lift) * 0.35, n, 56), oval(a - 0.01, b - 0.01, h - 0.03, n, 56)];
    out.loft(
      shell,
      [
        ...outer,
        oval(a, b, h - 0.012, n, 56),
        oval(a - 0.015, b - 0.015, h, n, 56),
        oval(a - 0.06, b - 0.06, h, Math.max(2.4, n - 1), 56),
        oval(a - 0.075, b - 0.08, h - 0.08, Math.max(2.4, n - 1.5), 56),
        oval(a - 0.14, b - 0.14, lift + 0.12, Math.max(2.2, n - 2), 56),
        oval(a - 0.3, b - 0.22, lift + 0.07, 2.2, 56),
      ],
      [true, true],
    );
    if (bool(p, 'water')) out.slab(mat('glass', str(p, 'waterColor')), oval(a - 0.09, b - 0.1, 0, Math.max(2.4, n - 1.4), 40).map(([x, , z]) => [x, z] as [number, number]), lift + 0.2, h - 0.16);
    if (kind === 'clawfoot')
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const x = sx * a * 0.62,
            z = sz * b * 0.5;
          out.lathe(steel, [[0.05, 0], [0.04, 0.02], [0.025, 0.06], [0.035, 0.12], [0.05, lift + 0.03]], 12, [x, 0, z]);
        }
    // Mixer with a spout on the long side and two handles.
    const dx = kind === 'built' ? a - 0.25 : 0;
    const dz = kind === 'built' ? -b + 0.035 : -b + 0.02;
    out.lathe(steel, [[0.03, 0], [0.026, 0.05]], 16, [dx, h, dz]);
    out.rod(steel, [dx, h + 0.045, dz], [dx, h + 0.03, dz + 0.16], 0.014, 12);
    for (const sx of [-1, 1]) out.lathe(steel, [[0.022, 0], [0.018, 0.035], [0.028, 0.045], [0, 0.05]], 12, [dx + sx * 0.1, h, dz]);
  },
};

export const SHOWER: Family = {
  id: 'shower',
  name: 'Shower',
  category: 'furniture',
  host: 'free',
  tags: ['shower', 'bathroom', 'tray', 'glass', 'sanitary', 'interior'],
  params: [
    P.len('width', 'Width', 0.9, 0.7, 1.6),
    P.len('depth', 'Depth', 0.9, 0.7, 1.6),
    P.len('height', 'Height', 2, 1.8, 2.4, 'type', 'size', 0.05),
    P.flag('glass', 'Glass panels', true, 'profile'),
    P.color('trayColor', 'Tray color', '#eae7df'),
    P.color('glassColor', 'Glass color', '#8fb0b8'),
    P.finish('finish', 'Tray finish', 'floor'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const tray = mat('stone', str(p, 'trayColor'), str(p, 'finish'));
    const glass = mat('glass', str(p, 'glassColor'));
    const steel = mat('metal', '#9aa0a4', 'metal');
    out.box(tray, [0, 0.04, 0], [w, 0.08, d]);
    out.box(tray, [0, 0.09, 0], [w - 0.1, 0.02, d - 0.1]);
    out.cylinder(steel, [0, 0.1, 0.02], 0.04, 0.006, 12);
    if (bool(p, 'glass')) {
      // Back and side panels, each closed by a metal profile on top.
      out.box(glass, [0, h / 2, -d / 2 + 0.006], [w, h, 0.012]);
      out.box(glass, [-w / 2 + 0.006, h / 2, 0], [0.012, h, d]);
      out.box(steel, [0, h - 0.01, -d / 2 + 0.006], [w, 0.03, 0.03]);
      out.box(steel, [-w / 2 + 0.006, h - 0.01, 0], [0.03, 0.03, d]);
    }
    out.rod(steel, [-w / 2 + 0.08, 0.1, -d / 2 + 0.08], [-w / 2 + 0.08, h - 0.3, -d / 2 + 0.08], 0.016, 8);
    out.rod(steel, [-w / 2 + 0.08, h - 0.3, -d / 2 + 0.08], [0, h - 0.28, -d / 2 + 0.28], 0.016, 8);
    out.lathe(steel, [[0.09, 0], [0.11, 0.03]], 16, [0, h - 0.31, -d / 2 + 0.3]);
    out.cylinder(steel, [-w / 2 + 0.08, 1, -d / 2 + 0.08], 0.03, 0.06, 10);
  },
};

export const FRIDGE: Family = {
  id: 'fridge',
  name: 'Fridge',
  category: 'furniture',
  host: 'free',
  tags: ['fridge', 'refrigerator', 'freezer', 'kitchen', 'appliance', 'interior'],
  params: [
    P.len('width', 'Width', 0.7, 0.5, 1.2),
    P.len('depth', 'Depth', 0.68, 0.5, 0.9),
    P.len('height', 'Height', 1.85, 1.2, 2.2, 'type', 'size', 0.05),
    P.color('color', 'Color', '#dcdedf'),
    P.finish('finish', 'Finish', 'steel'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const steel = mat('metal', '#8e959a', 'metal');
    const dark = mat('dark', '#1e2022');
    out.box(m, [0, h / 2, 0], [w, h, d]);
    out.box(dark, [0, h * 0.65, d / 2 + 0.003], [w - 0.02, 0.012, 0.006]);
    for (const sz of [-1, 1]) out.box(dark, [(sz * (w - 0.01)) / 2, h / 2, d / 2 + 0.003], [0.008, h - 0.04, 0.006]);
    out.rod(steel, [w / 2 - 0.06, h * 0.65 + 0.06, d / 2 + 0.05], [w / 2 - 0.06, h - 0.12, d / 2 + 0.05], 0.013, 6);
    out.rod(steel, [w / 2 - 0.06, 0.28, d / 2 + 0.05], [w / 2 - 0.06, h * 0.65 - 0.06, d / 2 + 0.05], 0.013, 6);
    out.box(dark, [0, 0.05, -0.03], [w - 0.08, 0.1, d - 0.12]);
  },
};

export const STOVE: Family = {
  id: 'stove',
  name: 'Stove',
  category: 'furniture',
  host: 'free',
  tags: ['stove', 'oven', 'cooker', 'kitchen', 'appliance', 'interior'],
  params: [
    P.len('width', 'Width', 0.6, 0.5, 1.2),
    P.len('depth', 'Depth', 0.6, 0.5, 0.8),
    P.len('height', 'Height', 0.9, 0.8, 1.1, 'type', 'size', 0.01),
    P.count('burners', 'Burners', 4, 2, 6, 'detail'),
    P.color('color', 'Color', '#c9ccce'),
    P.finish('finish', 'Finish', 'steel'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + 0.15, num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const n = clamp(Math.round(num(p, 'burners')), 2, 6);
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const steel = mat('metal', '#8e959a', 'metal');
    const dark = mat('dark', '#1e2022');
    out.box(m, [0, h / 2, 0], [w, h, d]);
    out.box(m, [0, h * 0.32, d / 2 + 0.01], [w - 0.02, h * 0.56, 0.02]);
    out.box(dark, [0, h * 0.32, d / 2 + 0.022], [w - 0.14, h * 0.36, 0.006]);
    out.rod(steel, [-w / 2 + 0.08, h * 0.63, d / 2 + 0.06], [w / 2 - 0.08, h * 0.63, d / 2 + 0.06], 0.014, 8);
    // Cooktop with the burners on a grid and the knobs on the front rail.
    out.box(dark, [0, h + 0.01, 0], [w, 0.02, d]);
    const cols = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const bx = -w / 2 + (w * ((i % cols) + 0.5)) / cols;
      const bz = (i < cols ? 1 : -1) * d * 0.22;
      out.cylinder(dark, [bx, h + 0.02, bz], 0.075, 0.012, 14);
      out.cylinder(steel, [bx, h + 0.032, bz], 0.03, 0.008, 10);
      out.box(steel, [bx, h * 0.86, d / 2 + 0.02], [0.05, 0.05, 0.02]);
    }
    out.box(m, [0, h + 0.09, -d / 2 + 0.03], [w, 0.16, 0.05]);
  },
};

// Every piece drawn with softened edges (kit.soft): the light runs along the edges of tops, doors and frames.
for (const f of [SOFA, ARMCHAIR, BED, DINING_TABLE, CHAIR, DESK, OFFICE_CHAIR, KITCHEN_COUNTER, WARDROBE, BOOKSHELF, TV_UNIT, TOILET, SINK, BATHTUB, SHOWER, FRIDGE, STOVE]) {
  const build = f.build;
  f.build = (p, out, ctx) => build(p, soft(out), ctx);
}
