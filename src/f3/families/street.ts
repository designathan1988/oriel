// Street furniture and outdoor elements: benches, bins, bike racks, bus
// shelters, bollards, fountains and the swimming pool shell. Free families:
// x across, y up from the ground and z towards the front. The pool is built
// below y = 0 (in the ground) and its coping ring sits at ground level.
import type { Vec3 } from '../model/schema';
import type { Family } from './family';
import { bool, num, P, str } from './family';
import { clamp, dome, mat } from './kit';

export const BENCH: Family = {
  id: 'bench',
  name: 'Bench',
  category: 'street',
  host: 'free',
  tags: ['bench', 'seat', 'park', 'street', 'public'],
  params: [
    P.len('width', 'Width', 1.8, 0.8, 4),
    P.len('depth', 'Depth', 0.55, 0.35, 0.9),
    P.len('seatH', 'Seat height', 0.45, 0.3, 0.6, 'type', 'size', 0.01),
    P.len('backH', 'Back height', 0.45, 0.2, 0.9, 'type', 'size', 0.01),
    P.count('slats', 'Seat slats', 4, 1, 12),
    P.flag('back', 'Back rest', true, 'profile'),
    P.pick('material', 'Seat material', 'wood', [
      ['wood', 'Wood'],
      ['metal', 'Metal'],
      ['concrete', 'Concrete'],
    ]),
    P.color('color', 'Color', '#8a6240'),
    P.color('legColor', 'Leg color', '#3a3e41'),
    P.finish('finish', 'Finish', 'wood'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'seatH') + (bool(p, 'back') ? 0.12 + num(p, 'backH') : 0.06), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      sh = num(p, 'seatH');
    const k = str(p, 'material');
    const m = mat(k === 'metal' ? 'metal' : k === 'concrete' ? 'concrete' : 'wood', str(p, 'color'), str(p, 'finish'));
    const legs = mat('metal', str(p, 'legColor'), 'metal');
    // Two side frames carry both the seat and the back.
    for (const sx of [-1, 1]) {
      out.box(legs, [(sx * (w / 2 - 0.12)), sh / 2, -d / 2 + 0.05], [0.06, sh, 0.06]);
      out.box(legs, [(sx * (w / 2 - 0.12)), sh / 2, d / 2 - 0.05], [0.06, sh, 0.06]);
      out.box(legs, [(sx * (w / 2 - 0.12)), sh - 0.05, 0], [0.06, 0.06, d - 0.12]);
    }
    const n = clamp(Math.round(num(p, 'slats')), 1, 12);
    for (let i = 0; i < n; i++) out.box(m, [0, sh + 0.02, -d / 2 + (d * (i + 0.5)) / n], [w, 0.04, (d / n) * 0.7]);
    if (!bool(p, 'back')) return;
    const bh = num(p, 'backH');
    for (const sx of [-1, 1]) out.rod(legs, [(sx * (w / 2 - 0.12)), sh, -d / 2 + 0.06], [(sx * (w / 2 - 0.12)), sh + 0.12 + bh, -d / 2 + 0.06 - (bh + 0.12) * 0.22], 0.022, 6);
    for (let i = 0; i < 3; i++) {
      const y = sh + 0.18 + ((bh - 0.12) * i) / 2;
      out.box(m, [0, y, -d / 2 + 0.05 - (y - sh) * 0.22], [w, 0.06, 0.03], [0, -12.4, 0]);
    }
  },
};

export const TRASH_BIN: Family = {
  id: 'trash-bin',
  name: 'Litter bin',
  category: 'street',
  host: 'free',
  tags: ['bin', 'trash', 'litter', 'waste', 'street', 'public'],
  params: [
    P.len('diameter', 'Width / diameter', 0.4, 0.2, 1, 'type', 'size', 0.01),
    P.len('height', 'Height', 0.9, 0.4, 1.6, 'type', 'size', 0.05),
    P.pick('shape', 'Shape', 'round', [
      ['round', 'Round'],
      ['square', 'Square'],
    ]),
    P.color('color', 'Color', '#4f5559'),
    P.color('linerColor', 'Liner color', '#1c1f21'),
    P.finish('finish', 'Finish', 'steel'),
  ],
  size: (p) => [num(p, 'diameter') * 1.05, num(p, 'height') + 0.1, num(p, 'diameter') * 1.05],
  build(p, out) {
    const dia = num(p, 'diameter'),
      h = num(p, 'height');
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const rim = mat('metal', '#7f868a', 'metal');
    const dark = mat('dark', str(p, 'linerColor'));
    if (str(p, 'shape') === 'square') {
      out.box(m, [0, h / 2, 0], [dia, h, dia]);
      out.box(rim, [0, h + 0.02, 0], [dia + 0.04, 0.04, dia + 0.04]);
      out.box(dark, [0, h + 0.045, 0], [dia - 0.08, 0.02, dia - 0.08]);
      for (const sx of [-1, 1]) out.box(rim, [(sx * dia) / 2, h * 0.5, 0], [0.02, h * 0.6, 0.03]);
      return;
    }
    const r = dia / 2;
    out.lathe(m, [[r * 0.62, 0], [r * 0.92, 0.05], [r, 0.12], [r, h]], 20);
    out.cylinder(rim, [0, h, 0], r * 1.04, 0.05, 20);
    out.cylinder(dark, [0, h + 0.005, 0], r * 0.95, 0.04, 20);
    out.box(dark, [0, h + 0.045, 0], [r * 1.1, 0.01, 0.12]);
  },
};

export const BIKE_RACK: Family = {
  id: 'bike-rack',
  name: 'Bike rack',
  category: 'street',
  host: 'free',
  tags: ['bike', 'bicycle', 'rack', 'hoop', 'street'],
  params: [
    P.count('hoops', 'Hoops', 4, 1, 12),
    P.len('spacing', 'Hoop spacing', 0.8, 0.5, 1.5, 'type', 'divisions', 0.05),
    P.len('height', 'Height', 0.8, 0.5, 1.1, 'type', 'size', 0.05),
    P.len('hoopWidth', 'Hoop width', 0.6, 0.4, 1, 'type', 'size', 0.05),
    P.len('tube', 'Tube diameter', 0.035, 0.015, 0.08, 'type', 'profile', 0.005),
    P.color('color', 'Color', '#4a5055'),
    P.finish('finish', 'Finish', 'steel'),
  ],
  size: (p) => [Math.max(0, Math.round(num(p, 'hoops')) - 1) * num(p, 'spacing') + num(p, 'hoopWidth'), num(p, 'height'), num(p, 'hoopWidth')],
  build(p, out) {
    const n = clamp(Math.round(num(p, 'hoops')), 1, 12);
    const s = num(p, 'spacing'),
      h = num(p, 'height'),
      hw = num(p, 'hoopWidth'),
      r = num(p, 'tube') / 2;
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const R = hw / 2;
    const legTop = Math.max(R, h - R);
    // Each hoop is a staple: two legs and a semicircular top of rods.
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * s;
      out.rod(m, [x, 0, -R], [x, legTop, -R], r, 8);
      out.rod(m, [x, 0, R], [x, legTop, R], r, 8);
      let prev: Vec3 = [x, legTop, -R];
      for (let j = 1; j <= 4; j++) {
        const th = (j / 4) * Math.PI;
        const q: Vec3 = [x, legTop + Math.sin(th) * R, -Math.cos(th) * R];
        out.rod(m, prev, q, r, 8);
        prev = q;
      }
    }
  },
};

export const BUS_SHELTER: Family = {
  id: 'bus-shelter',
  name: 'Bus shelter',
  category: 'street',
  host: 'free',
  tags: ['shelter', 'bus', 'stop', 'glass', 'roof', 'street', 'public'],
  params: [
    P.len('width', 'Length', 4, 1.6, 10),
    P.len('depth', 'Depth', 1.5, 1, 3),
    P.len('height', 'Height', 2.4, 2, 3.5, 'type', 'size', 0.05),
    P.flag('glass', 'Glass back', true, 'profile'),
    P.flag('bench', 'Bench', true, 'detail'),
    P.color('color', 'Frame color', '#3f4448'),
    P.color('roofColor', 'Roof color', '#5a6065'),
    P.color('glassColor', 'Glass color', '#8fb0b8'),
    P.finish('finish', 'Frame finish', 'steel'),
  ],
  size: (p) => [num(p, 'width') + 0.3, num(p, 'height') + 0.12, num(p, 'depth') + 0.3],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const roof = mat('metal', str(p, 'roofColor'), 'metal');
    out.box(mat('concrete', '#b9b4a8', 'concrete'), [0, 0.03, 0], [w, 0.06, d]);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) out.box(m, [(sx * (w / 2 - 0.06)), h / 2, (sz * (d / 2 - 0.06))], [0.1, h, 0.1]);
    out.box(roof, [0, h + 0.07, 0], [w + 0.3, 0.09, d + 0.3], [0, -4, 0]);
    if (bool(p, 'glass')) {
      out.box(mat('glass', str(p, 'glassColor')), [0, (h + 0.12) / 2, -d / 2 + 0.03], [w - 0.2, h - 0.1, 0.012]);
      out.box(m, [0, h - 0.02, -d / 2 + 0.03], [w - 0.2, 0.06, 0.05]);
    }
    if (bool(p, 'bench')) {
      const bz = -d / 2 + 0.32;
      out.box(m, [0, 0.45, bz], [w - 0.7, 0.06, 0.42]);
      for (const sx of [-1, 1]) out.box(m, [(sx * (w - 0.9)) / 2, 0.22, bz], [0.06, 0.44, 0.36]);
    }
  },
};

export const BOLLARD: Family = {
  id: 'bollard',
  name: 'Bollard',
  category: 'street',
  host: 'free',
  tags: ['bollard', 'post', 'traffic', 'street', 'public'],
  params: [
    P.len('diameter', 'Width / diameter', 0.18, 0.08, 0.6, 'type', 'size', 0.01),
    P.len('height', 'Height', 0.9, 0.3, 1.6, 'type', 'size', 0.05),
    P.pick('shape', 'Shape', 'round', [
      ['round', 'Round'],
      ['square', 'Square'],
    ]),
    P.pick('material', 'Material', 'metal', [
      ['metal', 'Metal'],
      ['stone', 'Stone'],
      ['concrete', 'Concrete'],
      ['wood', 'Wood'],
    ]),
    P.flag('band', 'Reflective band', true, 'detail'),
    P.color('color', 'Color', '#3f4448'),
    P.color('bandColor', 'Band color', '#e8e4d8'),
    P.finish('finish', 'Finish', 'steel'),
  ],
  size: (p) => [num(p, 'diameter') * 1.2, num(p, 'height') + num(p, 'diameter') * 0.35, num(p, 'diameter') * 1.2],
  build(p, out) {
    const dia = num(p, 'diameter'),
      h = num(p, 'height');
    const k = str(p, 'material');
    const m = mat(k === 'stone' ? 'stone' : k === 'concrete' ? 'concrete' : k === 'wood' ? 'wood' : 'metal', str(p, 'color'), str(p, 'finish'));
    if (str(p, 'shape') === 'square') {
      out.box(m, [0, (h - dia * 0.4) / 2, 0], [dia, h - dia * 0.4, dia]);
      out.box(m, [0, h - dia * 0.2, 0], [dia * 1.12, dia * 0.28, dia * 1.12]);
      out.box(m, [0, h, 0], [dia * 0.9, dia * 0.16, dia * 0.9]);
    } else {
      out.lathe(m, [[dia * 0.6, 0], [dia * 0.56, h * 0.08], [dia * 0.5, h * 0.9], [dia * 0.55, h]], 18);
      dome(out, m, [0, h, 0], dia * 0.55, dia * 0.35, 5, 18);
    }
    if (bool(p, 'band')) out.cylinder(mat('light', str(p, 'bandColor')), [0, h - dia * 0.3, 0], dia * 0.58, dia * 0.16, 18);
  },
};

export const FOUNTAIN: Family = {
  id: 'fountain',
  name: 'Fountain',
  category: 'street',
  host: 'free',
  tags: ['fountain', 'water', 'basin', 'square', 'garden', 'public'],
  params: [
    P.len('diameter', 'Diameter', 2.4, 0.8, 10),
    P.len('height', 'Height', 1, 0.4, 4),
    P.flag('tiers', 'Upper tier', true, 'profile'),
    P.color('color', 'Stone color', '#d9d3c6'),
    P.color('waterColor', 'Water color', '#4a92a8'),
    P.finish('finish', 'Finish', 'stone'),
  ],
  size: (p) => [num(p, 'diameter'), num(p, 'height') * (bool(p, 'tiers') ? 1.4 : 1), num(p, 'diameter')],
  build(p, out) {
    const dia = num(p, 'diameter'),
      H = num(p, 'height');
    const R = dia / 2;
    const stone = mat('stone', str(p, 'color'), str(p, 'finish'));
    const water = mat('metal', str(p, 'waterColor'), 'glass');
    // Basin: outer face up, over the rim, inner face down to the floor.
    const rimH = H * 0.42;
    out.lathe(stone, [[R * 0.8, 0], [R * 0.94, 0.04], [R, 0.14], [R, rimH], [R * 0.95, rimH * 1.05], [R * 0.88, rimH], [R * 0.86, H * 0.16], [0, H * 0.16]], 28);
    out.cylinder(water, [0, H * 0.15, 0], R * 0.85, H * 0.12, 24);
    if (bool(p, 'tiers')) {
      out.cylinder(stone, [0, H * 0.16, 0], R * 0.12, H * 0.5, 14);
      out.lathe(stone, [[0, 0], [R * 0.42, 0], [R * 0.38, H * 0.06], [R * 0.3, H * 0.12]], 20, [0, H * 0.64, 0]);
      out.cylinder(water, [0, H * 0.65, 0], R * 0.3, H * 0.1, 16);
      dome(out, stone, [0, H * 0.76, 0], R * 0.1, R * 0.16, 5, 14);
      // Water falling from the upper bowl into the basin.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        out.rod(water, [Math.cos(a) * R * 0.3, H * 0.7, Math.sin(a) * R * 0.3], [Math.cos(a) * R * 0.7, H * 0.24, Math.sin(a) * R * 0.7], 0.012, 5);
      }
    }
  },
};

export const SWIMMING_POOL: Family = {
  id: 'swimming-pool',
  name: 'Swimming pool',
  category: 'street',
  host: 'free',
  tags: ['pool', 'swimming', 'water', 'garden', 'terrace'],
  params: [
    P.len('width', 'Width', 4, 1.5, 30),
    P.len('length', 'Length', 8, 2, 60),
    P.len('depth', 'Water depth', 1.5, 0.6, 4, 'type', 'size', 0.05),
    P.flag('ladder', 'Ladder', true, 'detail'),
    P.flag('steps', 'Roman steps', true, 'detail'),
    P.color('shellColor', 'Shell color', '#e4e0d6'),
    P.color('copeColor', 'Coping color', '#cfc9bc'),
    P.color('waterColor', 'Water color', '#2f7f9a'),
    P.finish('shellFinish', 'Shell finish', 'floor'),
  ],
  size: (p) => [num(p, 'width') + 0.3, num(p, 'depth'), num(p, 'length') + 0.3],
  build(p, out) {
    const w = num(p, 'width'),
      l = num(p, 'length'),
      dp = num(p, 'depth');
    const shell = mat('concrete', str(p, 'shellColor'), str(p, 'shellFinish'));
    const cope = mat('stone', str(p, 'copeColor'), 'stone');
    const water = mat('metal', str(p, 'waterColor'), 'glass');
    const steel = mat('metal', '#c8ccd0', 'metal');
    const t = 0.25;
    // Shell below ground level, wall by wall, so the volume stays hollow.
    out.box(shell, [0, -dp, 0], [w, t, l]);
    for (const sx of [-1, 1]) out.box(shell, [(sx * (w - t)) / 2, -dp / 2, 0], [t, dp, l]);
    for (const sz of [-1, 1]) out.box(shell, [0, -dp / 2, (sz * (l - t)) / 2], [w - 2 * t, dp, t]);
    // Coping ring at ground level; the four slabs overlap at the corners.
    for (const sz of [-1, 1]) out.box(cope, [0, 0.06, (sz * l) / 2], [w + 0.3, 0.12, 0.3]);
    for (const sx of [-1, 1]) out.box(cope, [(sx * w) / 2, 0.06, 0], [0.3, 0.12, l]);
    // The ground of the scene is not dug out: the water shows just above it, inside the coping (the
    // shell below stays for sections and exports).
    out.box(water, [0, 0.025, 0], [w - 0.02, 0.03, l - 0.02]);
    if (bool(p, 'steps')) {
      // Roman end: three wide steps descending from the waterline.
      const zEnd = l / 2 - t;
      for (let i = 0; i < 3; i++) {
        const len = 0.4 * (i + 1);
        out.box(shell, [-w / 2 + t + 0.6, -0.15 - i * 0.3, zEnd - len / 2], [1.2, 0.3, len]);
      }
    }
    if (bool(p, 'ladder')) {
      const z0 = l / 2 - 0.55;
      const x0 = w / 2 - 0.42;
      for (const sx of [-1, 1]) {
        const x = x0 + sx * 0.14;
        out.rod(steel, [x, -0.9, z0], [x, 0.5, z0], 0.025, 8);
        // The handhold curls forward over the coping.
        let prev: Vec3 = [x, 0.5, z0];
        for (let j = 1; j <= 3; j++) {
          const th = (j / 3) * (Math.PI / 2);
          const q: Vec3 = [x, 0.5 + Math.sin(th) * 0.24, z0 - (1 - Math.cos(th)) * 0.24];
          out.rod(steel, prev, q, 0.025, 8);
          prev = q;
        }
      }
      for (let j = 0; j < 3; j++) {
        const y = -0.7 + j * 0.35;
        out.rod(steel, [x0 - 0.14, y, z0], [x0 + 0.14, y, z0], 0.02, 8);
      }
    }
  },
};
