// Roof items and industrial parts. Roof: base at the support point
// (y = 0 on the surface), x/z on the plane. Free parts: on the ground.
import type { Family, PartMat } from './family';
import { bool, num, P, str } from './family';
import { cone, dome, gable } from './kit';

export const CHIMNEY: Family = {
  id: 'chimney',
  name: 'Chimney',
  category: 'roofgear',
  host: 'roof',
  tags: ['chimney', 'fireplace', 'brick', 'roof'],
  params: [
    P.len('width', 'Width', 0.7, 0.3, 2),
    P.len('depth', 'Depth', 0.5, 0.3, 2),
    P.len('height', 'Height above the roof', 1.4, 0.4, 5),
    P.count('pots', 'Pots', 2, 0, 4),
    P.color('color', 'Color', '#9c4f36'),
    P.finish('finish', 'Material', 'brick'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height');
    const m: PartMat = { slot: 'wall', color: str(p, 'color'), finish: str(p, 'finish') };
    const cap: PartMat = { slot: 'stone', color: '#bdb5a6', finish: 'stone' };
    // Goes below the surface so it does not float on sloped roofs.
    out.slab(m, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], -1.2, h);
    out.box(cap, [0, h + 0.05, 0], [w + 0.12, 0.1, d + 0.12]);
    const n = Math.round(num(p, 'pots'));
    for (let i = 0; i < n; i++) cone(out, { slot: 'stone', color: '#b06a48', finish: 'paint' }, [-w / 2 + ((i + 0.5) * w) / n, h + 0.1, 0], 0.09, 0.07, 0.3);
  },
};

export const SKYLIGHT: Family = {
  id: 'skylight',
  name: 'Skylight',
  category: 'roofgear',
  host: 'roof',
  tags: ['skylight', 'dome', 'rooflight', 'glass', 'roof'],
  params: [
    P.len('width', 'Width', 1.2, 0.4, 6),
    P.len('depth', 'Length', 1.2, 0.4, 12),
    P.pick('kind', 'Type', 'pyramid', [
      ['flat', 'Flat'],
      ['pyramid', 'Pyramid'],
      ['dome', 'Dome'],
      ['gable', 'Gable'],
    ]),
    P.color('frameColor', 'Frame color', '#3a3e41'),
  ],
  size: (p) => [num(p, 'width'), 0.6, num(p, 'depth')],
  // The roof is opened inside the curb.
  roofOpening: (p) => ({ w: num(p, 'width') - 0.16, d: num(p, 'depth') - 0.16 }),
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth');
    const fr: PartMat = { slot: 'metal', color: str(p, 'frameColor'), finish: 'metal' };
    const glass: PartMat = { slot: 'glass', color: '#86a6b0' };
    out.slab(fr, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], -0.6, 0.15, [[[-w / 2 + 0.08, -d / 2 + 0.08], [w / 2 - 0.08, -d / 2 + 0.08], [w / 2 - 0.08, d / 2 - 0.08], [-w / 2 + 0.08, d / 2 - 0.08]]]);
    const k = str(p, 'kind');
    if (k === 'flat') out.box(glass, [0, 0.12, 0], [w - 0.16, 0.03, d - 0.16]);
    else if (k === 'dome') {
      const s = out.translated(0, 0.12, 0);
      dome(s, glass, [0, 0, 0], Math.min(w, d) / 2 - 0.08, Math.min(w, d) * 0.3);
    } else if (k === 'gable') gable(out, glass, w - 0.12, d - 0.12, 0.12, w * 0.3, 0.02);
    else {
      const s = out.translated(0, 0.12, 0);
      s.lathe(glass, [[Math.min(w, d) / 2 * 1.38, 0], [0.001, Math.min(w, d) * 0.35]], 4);
    }
  },
};

export const SOLAR: Family = {
  id: 'solar',
  name: 'Solar panels',
  category: 'roofgear',
  host: 'roof',
  tags: ['solar', 'photovoltaic', 'panel', 'energy', 'roof'],
  params: [
    P.count('cols', 'Columns', 4, 1, 30),
    P.count('rows', 'Rows', 2, 1, 20),
    P.angle('tilt', 'Pitch', 15, 0, 45),
    P.len('gap', 'Row gap', 0.6, 0, 3, 'type', 'divisions'),
  ],
  size: (p) => [num(p, 'cols') * 1.05, 0.6, num(p, 'rows') * (1.7 + num(p, 'gap'))],
  build(p, out) {
    const cols = Math.round(num(p, 'cols')),
      rows = Math.round(num(p, 'rows'));
    const tilt = num(p, 'tilt'),
      gap = num(p, 'gap');
    const cell: PartMat = { slot: 'glass', color: '#1d2a3a' };
    const fr: PartMat = { slot: 'metal', color: '#b9bec2', finish: 'metal' };
    const pw = 1.0,
      pl = 1.7;
    const depth = rows * (pl + gap);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * (pw + 0.05);
        const z = -depth / 2 + r * (pl + gap) + pl / 2;
        const y = Math.sin((tilt * Math.PI) / 180) * (pl / 2) + 0.15;
        out.box(fr, [x, y, z], [pw, 0.04, pl], [0, -tilt, 0]);
        out.box(cell, [x, y + 0.022, z], [pw - 0.04, 0.005, pl - 0.04], [0, -tilt, 0]);
        out.box(fr, [x, (y + 0.15) / 2, z + pl / 2 - 0.1], [0.04, y + 0.1, 0.04]);
      }
  },
};

export const WATER_TANK: Family = {
  id: 'watertank',
  name: 'Water tank',
  category: 'roofgear',
  host: 'roof',
  tags: ['water tank', 'reservoir', 'tank', 'tower', 'roof'],
  params: [
    P.len('width', 'Diameter', 1.6, 0.6, 6),
    P.len('height', 'Height', 1.4, 0.5, 6),
    P.len('stand', 'Stand', 0.4, 0, 6),
    P.pick('shape', 'Shape', 'round', [
      ['round', 'Cylindrical'],
      ['box', 'Rectangular'],
    ]),
    P.color('color', 'Color', '#4f7cab'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + num(p, 'stand'), num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      st = num(p, 'stand');
    const m: PartMat = { slot: 'metal', color: str(p, 'color'), finish: 'paint' };
    const steel: PartMat = { slot: 'metal', color: '#6b6f72', finish: 'metal' };
    if (st > 0.05) for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.box(steel, [sx * w * 0.35, st / 2 - 0.3, sz * w * 0.35], [0.08, st + 0.6, 0.08]);
    if (st > 0.05) out.box(steel, [0, st, 0], [w * 0.85, 0.06, w * 0.85]);
    if (str(p, 'shape') === 'box') {
      out.box(m, [0, st + h / 2, 0], [w, h, w]);
      out.box(m, [0, st + h + 0.03, 0], [w + 0.05, 0.06, w + 0.05]);
    } else {
      out.lathe(m, [[w / 2, st], [w / 2, st + h], [w * 0.45, st + h + 0.12], [0.001, st + h + 0.18]], 28);
    }
  },
};

export const VENT: Family = {
  id: 'vent',
  name: 'Vent / air conditioning',
  category: 'roofgear',
  host: 'roof',
  tags: ['vent', 'ventilation', 'air conditioning', 'condenser', 'turbine'],
  params: [
    P.pick('kind', 'Type', 'turbine', [
      ['turbine', 'Wind turbine vent'],
      ['ac', 'AC condenser'],
      ['duct', 'Vent pipe'],
    ]),
    P.len('width', 'Size', 0.7, 0.3, 3),
    P.color('color', 'Color', '#b8bcbf'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'width'), num(p, 'width')],
  build(p, out) {
    const s = num(p, 'width');
    const m: PartMat = { slot: 'metal', color: str(p, 'color'), finish: 'metal' };
    const k = str(p, 'kind');
    if (k === 'ac') {
      out.box(m, [0, s * 0.35, 0], [s * 1.3, s * 0.7, s * 0.5]);
      out.lathe({ slot: 'dark', color: '#2a2d2f' }, [[s * 0.25, 0], [s * 0.25, 0.01]], 20, [0, s * 0.35, s * 0.26]);
      out.box(m, [0, 0.05, 0], [s * 1.2, 0.1, s * 0.45]);
    } else if (k === 'duct') {
      out.cylinder(m, [0, -0.3, 0], s / 4, s + 0.3, 16);
      out.lathe(m, [[s / 2.5, s], [s / 2.5, s + 0.03], [0.001, s + 0.2]], 16);
    } else {
      out.cylinder(m, [0, -0.3, 0], s / 4, 0.6, 16);
      out.lathe(m, [[s / 3, 0.3], [s / 2, 0.45], [s / 2, s * 0.7], [s / 3, s * 0.9], [0.001, s]], 20);
    }
  },
};

export const CUPOLA: Family = {
  id: 'cupola',
  name: 'Lantern / cupola / bell tower',
  category: 'roofgear',
  host: 'roof',
  tags: ['lantern', 'cupola', 'tower', 'bell', 'pinnacle', 'spire', 'flag'],
  params: [
    P.len('width', 'Width', 1.6, 0.6, 8),
    P.len('height', 'Body height', 1.6, 0.5, 8),
    P.pick('top', 'Top', 'dome', [
      ['dome', 'Dome'],
      ['spire', 'Spire'],
      ['pyramid', 'Pyramid'],
      ['onion', 'Onion'],
    ]),
    P.count('sides', 'Sides', 8, 4, 24),
    P.flag('flag', 'Flag', false),
    P.color('color', 'Body color', '#efe9dc'),
    P.color('roofColor', 'Top color', '#5f8a7a'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + num(p, 'width') * 1.5, num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    const n = Math.round(num(p, 'sides'));
    const body: PartMat = { slot: 'wall', color: str(p, 'color'), finish: 'paint' };
    const roof: PartMat = { slot: 'roof', color: str(p, 'roofColor'), finish: 'metal' };
    const r = w / 2;
    out.lathe(body, [[r * 1.08, -0.6], [r * 1.08, 0.25], [r, 0.25], [r, h]], n);
    // Dark openings (louvers) on each side of the body.
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const s = out.placed(Math.cos(a) * r * 0.97, 0, Math.sin(a) * r * 0.97, (-a * 180) / Math.PI + 90);
      s.box({ slot: 'dark', color: '#2b2a28' }, [0, h * 0.55, 0], [(Math.PI * w) / n * 0.5, h * 0.5, 0.04]);
    }
    out.lathe(body, [[r * 1.15, h], [r * 1.15, h + 0.12]], n);
    const t = str(p, 'top');
    const s = out.translated(0, h + 0.12, 0);
    let tipY = h + 0.12;
    if (t === 'dome') {
      dome(s, roof, [0, 0, 0], r * 1.05, r * 0.9);
      tipY += r * 0.9;
    } else if (t === 'spire') {
      cone(s, roof, [0, 0, 0], r * 1.08, 0, w * 2.2, 1, n);
      tipY += w * 2.2;
    } else if (t === 'pyramid') {
      cone(s, roof, [0, 0, 0], r * 1.12, 0, w * 0.8, 1, n);
      tipY += w * 0.8;
    } else {
      const prof: [number, number][] = [];
      for (let i = 0; i <= 14; i++) {
        const k = i / 14;
        prof.push([r * (0.9 + 0.35 * Math.sin(k * Math.PI * 0.9)) * (1 - k) + 0.001, k * w * 1.4]);
      }
      s.lathe(roof, prof, n);
      tipY += w * 1.4;
    }
    out.cylinder({ slot: 'metal', color: '#c8a85a', finish: 'metal' }, [0, tipY - 0.05, 0], 0.025, 0.6, 8);
    if (bool(p, 'flag')) out.box({ slot: 'fabric', color: '#2f6b4f' }, [0.25, tipY + 0.4, 0], [0.45, 0.28, 0.01]);
  },
};

export const DORMER: Family = {
  id: 'dormer',
  name: 'Dormer',
  category: 'roofgear',
  host: 'roof',
  tags: ['dormer', 'attic window', 'mansard', 'roof window', 'attic'],
  params: [
    P.len('width', 'Width', 1.6, 0.8, 5),
    P.len('height', 'Front height', 1.5, 0.8, 3),
    P.len('depth', 'Depth', 2, 0.8, 5),
    P.pick('roof', 'Roof', 'gable', [
      ['gable', 'Gable'],
      ['shed', 'Shed'],
      ['round', 'Rounded'],
    ]),
    P.color('color', 'Color', '#efe9dc'),
    P.color('roofColor', 'Roof color', '#4a4f55'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + 0.8, num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      d = num(p, 'depth');
    const body: PartMat = { slot: 'wall', color: str(p, 'color'), finish: 'paint' };
    const roof: PartMat = { slot: 'roof', color: str(p, 'roofColor'), finish: 'slate' };
    const glass: PartMat = { slot: 'glass', color: '#46606c' };
    const frame: PartMat = { slot: 'frame', color: '#ffffff', finish: 'paint' };
    // Body sunk into the roof (front toward +z).
    out.slab(body, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], -1.5, h);
    const ww = w * 0.6,
      wh = h * 0.65;
    out.box(frame, [0, h * 0.45, d / 2 + 0.01], [ww + 0.12, wh + 0.12, 0.06]);
    out.box(glass, [0, h * 0.45, d / 2 + 0.04], [ww, wh, 0.02]);
    out.box(frame, [0, h * 0.45, d / 2 + 0.05], [0.04, wh, 0.03]);
    const k = str(p, 'roof');
    if (k === 'gable') gable(out, roof, w + 0.2, d + 0.25, h, w * 0.45, 0.06, 0.1);
    else if (k === 'shed') out.sweepX(roof, [[h + 0.5, -d / 2 - 0.1], [h, d / 2 + 0.2], [h + 0.07, d / 2 + 0.2], [h + 0.57, -d / 2 - 0.1]], -w / 2 - 0.1, w / 2 + 0.1);
    else {
      const prof: [number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI;
        prof.push([Math.cos(a) * (w / 2 + 0.1), h + Math.sin(a) * (w / 2) * 0.7]);
      }
      // (x, y) arch extruded along z.
      out.prism(roof, prof.concat([[-(w / 2 + 0.1), h - 0.05], [w / 2 + 0.1, h - 0.05]].reverse() as [number, number][]), -d / 2, d / 2 + 0.2);
    }
  },
};

export const SILO: Family = {
  id: 'silo',
  name: 'Silo',
  category: 'industrial',
  host: 'free',
  tags: ['silo', 'grain', 'storage', 'industrial', 'farm'],
  params: [
    P.len('width', 'Diameter', 5, 1.5, 15),
    P.len('height', 'Height', 12, 3, 40),
    P.pick('top', 'Top', 'cone', [
      ['cone', 'Cone'],
      ['dome', 'Dome'],
    ]),
    P.flag('ladder', 'Ship ladder', true),
    P.color('color', 'Color', '#c9cdcf'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + num(p, 'width') * 0.4, num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      r = w / 2;
    const m: PartMat = { slot: 'metal', color: str(p, 'color'), finish: 'metal' };
    out.lathe(m, [[r, 0], [r, h]], 32);
    for (let y = 1.2; y < h; y += 1.2) out.lathe(m, [[r + 0.03, y], [r + 0.03, y + 0.06]], 32);
    if (str(p, 'top') === 'dome') dome(out, m, [0, h, 0], r, r * 0.6, 10, 32);
    else cone(out, m, [0, h, 0], r * 1.02, 0.3, r * 0.45, 1, 32);
    if (bool(p, 'ladder')) {
      const steel: PartMat = { slot: 'metal', color: '#4e5356', finish: 'metal' };
      for (const sx of [-0.22, 0.22]) out.rod(steel, [sx, 0, r + 0.15], [sx, h, r + 0.15], 0.02, 6);
      for (let y = 0.3; y < h; y += 0.3) out.rod(steel, [-0.22, y, r + 0.15], [0.22, y, r + 0.15], 0.012, 6);
    }
  },
};

export const STACK: Family = {
  id: 'stack',
  name: 'Industrial chimney',
  category: 'industrial',
  host: 'free',
  tags: ['chimney', 'factory', 'industrial', 'brick', 'smoke'],
  params: [
    P.len('width', 'Base diameter', 3, 1, 10),
    P.len('height', 'Height', 30, 8, 120),
    { ...P.ratio('taper', 'Taper', 0.45, 'type'), group: 'profile' },
    P.color('color', 'Color', '#9c4f36'),
    P.finish('finish', 'Material', 'brick'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    const m: PartMat = { slot: 'wall', color: str(p, 'color'), finish: str(p, 'finish') };
    const top = (w / 2) * (1 - num(p, 'taper'));
    out.slab({ ...m, slot: 'stone', color: '#a39b8d', finish: 'stone' }, [[-w * 0.65, -w * 0.65], [w * 0.65, -w * 0.65], [w * 0.65, w * 0.65], [-w * 0.65, w * 0.65]], 0, 1.2);
    out.lathe(m, [[w / 2, 1.2], [top, h]], 28);
    out.lathe({ slot: 'stone', color: '#3a3533', finish: 'stone' }, [[top * 1.18, h - 0.6], [top * 1.18, h], [top * 0.8, h]], 28);
    for (let y = h * 0.3; y < h - 1; y += h * 0.25) {
      const rr = w / 2 + (top - w / 2) * ((y - 1.2) / (h - 1.2));
      out.lathe({ slot: 'metal', color: '#2f3133', finish: 'metal' }, [[rr + 0.04, y], [rr + 0.04, y + 0.15]], 28);
    }
  },
};

export const LADDER: Family = {
  id: 'ladder',
  name: 'Ship ladder',
  category: 'industrial',
  host: 'face',
  tags: ['ship ladder', 'access', 'roof', 'industrial', 'cage'],
  params: [
    P.len('height', 'Height', 6, 1, 40),
    { ...P.len('sillH', 'Base (m)', 0, 0, 30, 'instance'), group: 'size' },
    P.flag('cage', 'Safety cage', true),
    P.color('color', 'Color', '#e0b23a'),
  ],
  size: (p) => [0.8, num(p, 'height'), 0.8],
  sill: (p) => num(p, 'sillH'),
  build(p, out) {
    const h = num(p, 'height');
    const m: PartMat = { slot: 'metal', color: str(p, 'color'), finish: 'paint' };
    for (const sx of [-0.22, 0.22]) out.rod(m, [sx, 0, 0.18], [sx, h + 1, 0.18], 0.02, 6);
    for (let y = 0.3; y < h; y += 0.3) out.rod(m, [-0.22, y, 0.18], [0.22, y, 0.18], 0.012, 6);
    for (let y = 0.5; y < h; y += 1.5) for (const sx of [-0.22, 0.22]) out.rod(m, [sx, y, 0], [sx, y, 0.18], 0.015, 6);
    if (bool(p, 'cage') && h > 2.5) {
      for (let y = 2.2; y < h + 1; y += 0.9) {
        const pts: [number, number, number][] = [];
        for (let k = 0; k <= 10; k++) {
          const a = Math.PI * (k / 10);
          pts.push([Math.cos(a) * 0.38, y, 0.18 + Math.sin(a) * 0.38]);
        }
        for (let k = 0; k < pts.length - 1; k++) out.rod(m, pts[k]!, pts[k + 1]!, 0.012, 6);
      }
      for (const a of [0.15, 0.5, 0.85]) out.rod(m, [Math.cos(Math.PI * a) * 0.38, 2.2, 0.18 + Math.sin(Math.PI * a) * 0.38], [Math.cos(Math.PI * a) * 0.38, h + 1, 0.18 + Math.sin(Math.PI * a) * 0.38], 0.012, 6);
    }
  },
};

export const TANK: Family = {
  id: 'tank',
  name: 'Industrial tank',
  category: 'industrial',
  host: 'free',
  tags: ['tank', 'reservoir', 'gas', 'industrial', 'horizontal'],
  params: [
    P.len('width', 'Diameter', 2.5, 0.8, 10),
    P.len('length', 'Length', 8, 1, 30),
    P.color('color', 'Color', '#e8e8e4'),
  ],
  size: (p) => [num(p, 'length') + num(p, 'width') * 0.5, num(p, 'width') + 0.6, num(p, 'width')],
  build(p, out) {
    const d = num(p, 'width'),
      L = num(p, 'length'),
      r = d / 2;
    const m: PartMat = { slot: 'metal', color: str(p, 'color'), finish: 'paint' };
    const yc = r + 0.6;
    // Lying body: a circular section swept along the length, caps at the ends.
    for (const x of [-L / 3, L / 3]) out.box({ slot: 'concrete', color: '#a5a29b', finish: 'concrete' }, [x, 0.3, 0], [0.5, 0.6 + r * 0.4, d * 0.8]);
    out.sweepX(m, Array.from({ length: 24 }, (_, k) => [yc + Math.sin((k / 24) * Math.PI * 2) * r, Math.cos((k / 24) * Math.PI * 2) * r] as [number, number]), -L / 2, L / 2);
    for (const sx of [-1, 1]) out.box(m, [sx * (L / 2 + r * 0.2), yc, 0], [r * 0.4, d * 0.92, d * 0.92]);
  },
};
