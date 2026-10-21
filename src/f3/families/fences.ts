// Walls, fences, gates and hedges. Walls, fences and hedges follow a
// path (each run in its own frame, x along); the gate is free, with
// the opening along x centered on the origin.
import type { Family, PartMat, PartSink, Params } from './family';
import { bool, num, P, str } from './family';
import { distribute, hash01, mat, pathOf, segments, segSink, slopedBox, isClosed, type Justify } from './kit';
import type { Pt } from './shapes';

const FINISHES: [string, string][] = [
  ['plaster', 'Painted plaster'],
  ['brick', 'Exposed brick'],
  ['stone', 'Stone'],
  ['concrete', 'Concrete'],
  ['block', 'Concrete block'],
];

const wallMat = (p: Params): PartMat => {
  const f = str(p, 'finish');
  return mat(f === 'plaster' ? 'wall' : f === 'stone' ? 'stone' : f === 'brick' ? 'wall' : 'concrete', str(p, 'wallColor'), f);
};

export const WALL_RUN: Family = {
  id: 'wallrun',
  name: 'Wall',
  category: 'walls',
  host: 'path',
  tags: ['wall', 'boundary', 'masonry', 'pilaster', 'low wall', 'brick', 'stone'],
  params: [
    P.len('height', 'Height', 1.8, 0.3, 4),
    P.len('thickness', 'Thickness', 0.2, 0.1, 0.6, 'type', 'size', 0.01),
    P.pick('finish', 'Finish', 'plaster', FINISHES, 'material'),
    P.color('wallColor', 'Wall color', '#e9e2d3'),
    P.flag('coping', 'Coping (stone)', true),
    P.len('copingOver', 'Coping projection', 0.03, 0, 0.12, 'type', 'detail', 0.01),
    P.color('copingColor', 'Coping color', '#cfc7b8'),
    P.len('pilasterSpacing', 'Pilasters every', 3, 0, 8, 'type', 'divisions', 0.5),
    P.len('pilasterSize', 'Pilaster width', 0.35, 0.2, 0.8, 'type', 'profile', 0.01),
    P.pick('justify', 'Pilaster layout', 'fit', [
      ['fit', 'Spread to fit'],
      ['center', 'Centered'],
      ['start', 'From the start'],
    ], 'divisions'),
    P.flag('plinth', 'Kick plate', true),
    P.color('plinthColor', 'Plinth color', '#9d968a'),
  ],
  size: (p) => [1, num(p, 'height') + (bool(p, 'coping') ? 0.06 : 0) + 0.08, num(p, 'thickness') + 2 * (num(p, 'pilasterSpacing') > 0 ? 0.08 : 0)],
  build(p, out, ctx) {
    const path = pathOf(ctx);
    const h = num(p, 'height'),
      t = num(p, 'thickness');
    const wm = wallMat(p);
    const cop = mat('stone', str(p, 'copingColor'), 'stone');
    const co = num(p, 'copingOver');
    const ps = num(p, 'pilasterSize'),
      pe = num(p, 'pilasterSpacing');
    const segs = segments(path, 4);
    const closed = isClosed(path);
    segs.forEach((s, i) => {
      const o = segSink(out, s);
      const k = s.rise / s.len;
      // Each run goes half a thickness past the vertex to close the corner.
      const x0 = -t / 2,
        x1 = s.len + t / 2;
      const quad = (y0: number, y1: number, a = x0, b = x1): Pt[] => [[a, a * k + y0], [b, b * k + y0], [b, b * k + y1], [a, a * k + y1]];
      // Foundation slightly below the ground so it does not float on a slope.
      o.prism(wm, quad(-0.1, h), -t / 2, t / 2);
      if (bool(p, 'plinth')) o.prism(mat('stone', str(p, 'plinthColor'), 'stone'), quad(-0.1, 0.3), -t / 2 - 0.015, t / 2 + 0.015);
      if (bool(p, 'coping')) o.prism(cop, quad(h, h + 0.06, x0 - co, x1 + co), -t / 2 - co, t / 2 + co);
      if (pe > 0.5) {
        const xs = distribute(s.len, pe, str(p, 'justify') as Justify);
        xs.forEach((x, j) => {
          if (j === 0 && i > 0) return;
          if (j === xs.length - 1 && closed && i === segs.length - 1) return;
          const y = x * k;
          o.box(wm, [x, y + (h + 0.06) / 2 - 0.05, 0], [ps, h + 0.16, t + 0.16]);
          o.box(cop, [x, y + h + 0.11 + 0.04, 0], [ps + 0.08, 0.08, t + 0.24]);
        });
      }
    });
  },
};

const FENCES: [string, string][] = [
  ['picket', 'Wooden pickets'],
  ['slats', 'Horizontal slats'],
  ['mesh', 'Welded mesh'],
  ['palisade', 'Steel palisade'],
  ['wrought', 'Wrought iron with spears'],
];

/** A fence bay between two posts (a..b on the run x, slope k). */
function fenceBay(o: PartSink, style: string, a: number, b: number, k: number, h: number, m: PartMat, rail: PartMat): void {
  const bay = b - a;
  if (bay < 0.05) return;
  const ry = (x: number, y: number) => x * k + y;
  if (style === 'picket' || style === 'palisade' || style === 'wrought') {
    const rails = style === 'wrought' ? [0.12, h - 0.12] : [0.25, h - 0.3];
    for (const y of rails) slopedBox(o, rail, a, ry(a, y), b, ry(b, y), style === 'picket' ? 0.08 : 0.04, style === 'picket' ? 0.03 : 0.025, style === 'picket' ? -0.025 : 0);
    const step = style === 'picket' ? 0.13 : style === 'palisade' ? 0.11 : 0.12;
    const n = Math.max(1, Math.floor(bay / step));
    for (let i = 0; i < n; i++) {
      const x = a + (bay * (i + 0.5)) / n;
      const y0 = ry(x, 0.05);
      const top = ry(x, h);
      if (style === 'picket') {
        const pw = 0.075;
        o.prism(m, [[x - pw / 2, y0], [x + pw / 2, y0], [x + pw / 2, top - 0.06], [x, top], [x - pw / 2, top - 0.06]], 0, 0.02);
      } else if (style === 'palisade') {
        const pw = 0.065;
        o.prism(m, [[x - pw / 2, y0], [x + pw / 2, y0], [x + pw / 2, top - 0.05], [x + pw / 4, top - 0.02], [x, top - 0.05], [x - pw / 4, top], [x - pw / 2, top - 0.05]], -0.01, 0.01);
      } else {
        o.cylinder(m, [x, y0, 0], 0.008, top - y0 - 0.06, 6);
        // Spear: a rhombus on the xy plane.
        o.prism(m, [[x, top - 0.08], [x + 0.022, top - 0.035], [x, top], [x - 0.022, top - 0.035]], -0.005, 0.005);
      }
    }
  } else if (style === 'slats') {
    const sh = 0.12,
      gap = 0.02;
    const n = Math.max(2, Math.floor((h - 0.05) / (sh + gap)));
    for (let i = 0; i < n; i++) {
      const y = 0.05 + i * (sh + gap) + sh / 2;
      slopedBox(o, m, a, ry(a, y), b, ry(b, y), sh, 0.02, 0.04);
    }
  } else {
    // Mesh: vertical and horizontal wires with a top tube.
    slopedBox(o, rail, a, ry(a, h - 0.02), b, ry(b, h - 0.02), 0.04, 0.04);
    const nv = Math.max(2, Math.round(bay / 0.15));
    for (let i = 1; i < nv; i++) {
      const x = a + (bay * i) / nv;
      o.box(m, [x, ry(x, (h - 0.04 + 0.05) / 2), 0], [0.005, h - 0.09, 0.005]);
    }
    const nh = Math.max(2, Math.round(h / 0.2));
    for (let j = 0; j <= nh; j++) {
      const y = 0.05 + ((h - 0.09) * j) / nh;
      slopedBox(o, m, a, ry(a, y), b, ry(b, y), 0.005, 0.005);
    }
  }
}

export const FENCE: Family = {
  id: 'fence',
  name: 'Fence',
  category: 'fences',
  host: 'path',
  tags: ['fence', 'railing', 'pickets', 'slats', 'mesh', 'chain link', 'palisade', 'iron'],
  params: [
    P.len('height', 'Height', 1.2, 0.4, 3),
    P.pick('style', 'Style', 'picket', FENCES),
    P.len('postSpacing', 'Post spacing', 2.2, 0.8, 4, 'type', 'divisions'),
    P.len('postSize', 'Post section', 0.09, 0.04, 0.3, 'type', 'profile', 0.01),
    P.flag('postCaps', 'Post caps', true),
    P.color('fenceColor', 'Color', '#f2efe8'),
    P.finish('fenceFinish', 'Material', 'paint'),
    P.color('postColor', 'Post color', '#f2efe8'),
  ],
  size: (p) => [1, num(p, 'height') + 0.12, num(p, 'postSize') + 0.04],
  build(p, out, ctx) {
    const path = pathOf(ctx);
    const style = str(p, 'style');
    const h = num(p, 'height'),
      ps = num(p, 'postSize');
    const metal = style === 'mesh' || style === 'palisade' || style === 'wrought';
    const m = mat(metal ? 'metal' : 'wood', str(p, 'fenceColor'), str(p, 'fenceFinish'));
    const post = mat(metal ? 'metal' : 'wood', str(p, 'postColor'), str(p, 'fenceFinish'));
    const segs = segments(path, 4);
    const closed = isClosed(path);
    segs.forEach((s, i) => {
      const o = segSink(out, s);
      const k = s.rise / s.len;
      const xs = distribute(s.len, num(p, 'postSpacing'), 'fit');
      xs.forEach((x, j) => {
        if (j === 0 && i > 0) return;
        if (j === xs.length - 1 && closed && i === segs.length - 1) return;
        // Post buried 0.3 m: never floats on a slope.
        const y0 = x * k - 0.3,
          y1 = x * k + h + 0.06;
        if (style === 'mesh') o.cylinder(post, [x, y0, 0], ps / 2, y1 - y0, 12);
        else o.box(post, [x, (y0 + y1) / 2, 0], [ps, y1 - y0, ps]);
        if (bool(p, 'postCaps')) {
          if (style === 'wrought' || style === 'mesh') o.cylinder(post, [x, y1, 0], ps * 0.6, 0.05, 12);
          else o.prism(post, [[x - ps * 0.65, y1], [x + ps * 0.65, y1], [x, y1 + ps * 0.6]], -ps * 0.65, ps * 0.65);
        }
      });
      for (let j = 0; j + 1 < xs.length; j++) fenceBay(o, style, xs[j]! + ps / 2, xs[j + 1]! - ps / 2, k, h, m, post);
    });
  },
};

export const GATE: Family = {
  id: 'gate',
  name: 'Gate',
  category: 'gates',
  host: 'free',
  tags: ['gate', 'grade', 'entrance', 'garage', 'sliding', 'swing', 'pillar'],
  params: [
    P.len('width', 'Opening width', 3, 0.8, 8),
    P.len('height', 'Height', 1.8, 0.8, 3.5),
    P.pick('operation', 'Opening', 'double', [
      ['double', 'Swing, two leaves'],
      ['single', 'Swing, one leaf'],
      ['sliding', 'Sliding'],
    ]),
    P.pick('style', 'Leaf', 'bars', [
      ['bars', 'Bars'],
      ['slats', 'Horizontal boards'],
      ['solid', 'Solid sheet'],
      ['mesh', 'Mesh'],
    ]),
    P.len('barSpacing', 'Bar spacing', 0.12, 0.06, 0.3, 'type', 'divisions', 0.01),
    P.pick('pillars', 'Posts', 'masonry', [
      ['masonry', 'Masonry'],
      ['steel', 'Steel tube'],
      ['none', 'No pillars'],
    ]),
    P.len('pillarSize', 'Pillar width', 0.4, 0.1, 0.8, 'type', 'profile', 0.01),
    P.flag('arch', 'Arched top', false),
    P.color('gateColor', 'Gate color', '#2e3336'),
    P.finish('gateFinish', 'Material', 'steel'),
    P.color('pillarColor', 'Post color', '#e6dfd0'),
  ],
  size: (p) => {
    const w = num(p, 'width'),
      pw = str(p, 'pillars') === 'none' ? 0 : num(p, 'pillarSize');
    return [w + 2 * pw + (str(p, 'operation') === 'sliding' ? w : 0), num(p, 'height') + 0.25 + (bool(p, 'arch') ? w * 0.08 : 0), Math.max(pw, 0.12)];
  },
  build(p, root) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    const op = str(p, 'operation');
    const pillars = str(p, 'pillars');
    const pw = pillars === 'none' ? 0 : num(p, 'pillarSize');
    // Sliding: the run-back (on the right) counts in the width; everything recentered.
    const out = root.translated(op === 'sliding' ? -w / 2 : 0, 0, 0);
    const g = mat('metal', str(p, 'gateColor'), str(p, 'gateFinish'));
    const pm = mat(pillars === 'masonry' ? 'wall' : 'metal', pillars === 'masonry' ? str(p, 'pillarColor') : str(p, 'gateColor'), pillars === 'masonry' ? 'plaster' : 'metal');
    const ph = h + 0.2;
    const pillarXs = [-w / 2 - pw / 2, w / 2 + pw / 2];
    if (pw > 0)
      for (const x of pillarXs) {
        if (pillars === 'masonry') {
          out.box(pm, [x, ph / 2 - 0.05, 0], [pw, ph + 0.1, pw]);
          out.box(mat('stone', '#cfc7b8', 'stone'), [x, ph + 0.05 + 0.03, 0], [pw + 0.06, 0.06, pw + 0.06]);
        } else {
          out.box(pm, [x, ph / 2 - 0.15, 0], [pw * 0.6, ph + 0.3, pw * 0.6]);
          out.box(pm, [x, ph + 0.015, 0], [pw * 0.8, 0.03, pw * 0.8]);
        }
      }
    const clearance = 0.05;
    const leaves = op === 'double' ? 2 : 1;
    const lw = (w - 0.02 * leaves) / leaves;
    const archRise = bool(p, 'arch') ? w * 0.08 : 0;
    const topAt = (x: number) => h + (archRise > 0 ? archRise * (1 - (x / (w / 2)) ** 2) : 0);
    for (let i = 0; i < leaves; i++) {
      const cx = -w / 2 + 0.01 + lw * (i + 0.5) + 0.02 * i;
      const x0 = cx - lw / 2,
        x1 = cx + lw / 2;
      const y0 = clearance;
      // Leaf frame (the top follows the arch).
      out.box(g, [x0 + 0.025, (y0 + topAt(x0)) / 2, 0], [0.05, topAt(x0) - y0, 0.05]);
      out.box(g, [x1 - 0.025, (y0 + topAt(x1)) / 2, 0], [0.05, topAt(x1) - y0, 0.05]);
      out.box(g, [cx, y0 + 0.025, 0], [lw, 0.05, 0.05]);
      const nArc = archRise > 0 ? 6 : 1;
      for (let k = 0; k < nArc; k++) {
        const a = x0 + (lw * k) / nArc,
          b = x0 + (lw * (k + 1)) / nArc;
        slopedBox(out, g, a, topAt(a) - 0.025, b, topAt(b) - 0.025, 0.05, 0.05);
      }
      const style = str(p, 'style');
      const ix0 = x0 + 0.05,
        ix1 = x1 - 0.05;
      if (style === 'bars') {
        const n = Math.max(1, Math.round((ix1 - ix0) / num(p, 'barSpacing')));
        for (let j = 1; j < n; j++) {
          const x = ix0 + ((ix1 - ix0) * j) / n;
          out.box(g, [x, (y0 + topAt(x)) / 2, 0], [0.02, topAt(x) - y0 - 0.05, 0.02]);
        }
        out.box(g, [cx, y0 + 0.35, 0], [lw - 0.1, 0.04, 0.03]);
      } else if (style === 'slats') {
        const n = Math.max(3, Math.round((h - 0.1) / 0.14));
        for (let j = 0; j < n; j++) out.box(g, [cx, y0 + 0.05 + ((h - 0.1 - y0) * (j + 0.5)) / n, 0], [lw - 0.1, ((h - 0.1 - y0) / n) * 0.8, 0.02]);
      } else if (style === 'solid') {
        const prof: Pt[] = [[ix0, y0 + 0.05], [ix1, y0 + 0.05]];
        for (let k = 0; k <= 6; k++) {
          const x = ix1 - ((ix1 - ix0) * k) / 6;
          prof.push([x, topAt(x) - 0.05]);
        }
        out.prism(g, prof, -0.012, 0.012);
      } else {
        const n = Math.max(2, Math.round((ix1 - ix0) / 0.1));
        for (let j = 1; j < n; j++) {
          const x = ix0 + ((ix1 - ix0) * j) / n;
          out.box(g, [x, (y0 + topAt(x)) / 2, 0], [0.006, topAt(x) - y0 - 0.05, 0.006]);
        }
        const m = Math.max(2, Math.round((h - y0) / 0.1));
        for (let j = 1; j < m; j++) out.box(g, [cx, y0 + ((h - 0.05 - y0) * j) / m, 0], [lw - 0.1, 0.006, 0.006]);
      }
      // Hardware: hinges on the pillar side or wheels on the track.
      if (op !== 'sliding') {
        const hx = i === 0 ? x0 : x1;
        for (const y of [0.3, h - 0.3]) out.cylinder(mat('metal', '#55595c', 'metal'), [hx, y - 0.06, 0], 0.02, 0.12, 6);
      } else {
        for (const x of [x0 + 0.2, x1 - 0.2]) out.cylinder(mat('metal', '#55595c', 'metal'), [x, 0, 0], 0.04, clearance, 12);
      }
    }
    if (op === 'double') out.box(mat('metal', '#55595c', 'metal'), [0, 1.0, 0.03], [0.04, 0.12, 0.02]);
    if (op === 'sliding') {
      // Floor track from the opening to the run-back and the top guide on the end pillar.
      out.box(mat('metal', '#55595c', 'metal'), [w / 2 + pw / 2, 0.01, 0], [w * 2 + pw, 0.02, 0.05]);
      if (pw > 0) out.box(pm, [w * 1.5 + pw / 2, (h + 0.1) / 2 - 0.05, -0.08], [Math.min(pw, 0.12), h + 0.2, 0.08]);
    }
  },
};

export const HEDGE: Family = {
  id: 'hedge',
  name: 'Hedge',
  category: 'fences',
  host: 'path',
  tags: ['hedge', 'shrub', 'bush', 'boxwood', 'garden', 'green'],
  params: [
    P.len('height', 'Height', 1.2, 0.3, 3),
    P.len('width', 'Width', 0.6, 0.2, 1.5),
    P.pick('trim', 'Pruning', 'clipped', [
      ['clipped', 'Trimmed (straight)'],
      ['rounded', 'Rounded top'],
      ['natural', 'Natural (irregular)'],
    ]),
    P.flag('planter', 'Masonry planter', false),
    P.color('leafColor', 'Leaf color', '#3f6b35'),
    P.color('planterColor', 'Planter color', '#b9b0a0'),
  ],
  size: (p) => [1, num(p, 'height') + (bool(p, 'planter') ? 0.45 : 0) + (str(p, 'trim') === 'natural' ? 0.15 : 0), num(p, 'width') + (bool(p, 'planter') ? 0.12 : 0) + 0.1],
  build(p, out, ctx) {
    const path = pathOf(ctx);
    const h = num(p, 'height'),
      w = num(p, 'width');
    const leaf = mat('green', str(p, 'leafColor'));
    const trim = str(p, 'trim');
    const base = bool(p, 'planter') ? 0.45 : 0;
    segments(path, 4).forEach((s, si) => {
      const o = segSink(out, s);
      const k = s.rise / s.len;
      const ang = (Math.atan(k) * 180) / Math.PI;
      // (y, z) profile swept along the run; the slope becomes a tilt of the part.
      const r = trim === 'clipped' ? 0.06 : Math.min(w / 2, h * 0.5);
      const prof: [number, number][] = [[0, -w / 2], [0, w / 2], [h - r, w / 2]];
      for (let i = 1; i < 6; i++) {
        const a = (i / 6) * (Math.PI / 2);
        prof.push([h - r + Math.sin(a) * r, w / 2 - r + Math.cos(a) * r]);
      }
      prof.push([h, w / 2 - r], [h, -w / 2 + r]);
      for (let i = 1; i < 6; i++) {
        const a = Math.PI / 2 + (i / 6) * (Math.PI / 2);
        prof.push([h - r + Math.sin(a) * r, -w / 2 + r + Math.cos(a) * r]);
      }
      prof.push([h - r, -w / 2]);
      const L3 = Math.hypot(s.len, s.rise);
      const inner = o.translated(0, base - 0.05, 0);
      if (Math.abs(ang) < 0.5) inner.sweepX(leaf, prof, -w / 2, s.len + w / 2);
      else {
        // No z rotation in sweepX: sloped runs in short steps.
        const n = Math.max(1, Math.ceil(L3 / 0.5));
        for (let i = 0; i < n; i++) {
          const xa = (s.len * i) / n,
            xb = (s.len * (i + 1)) / n;
          inner.translated(0, xa * k, 0).sweepX(leaf, prof, xa - 0.05, xb + 0.05);
        }
      }
      if (trim === 'natural') {
        const n = Math.max(2, Math.round(s.len / 0.45));
        for (let i = 0; i <= n; i++) {
          const x = (s.len * i) / n;
          const u = hash01(si * 997 + i, 7),
            v = hash01(si * 997 + i, 13);
          const bs = w * (0.55 + 0.35 * u);
          inner.box(leaf, [x, x * k + h - bs * 0.25 + 0.1 * v, (v - 0.5) * w * 0.2], [bs, bs * 0.7, bs], [u * 90, 0, 0]);
        }
      }
      if (base > 0) {
        const pm = mat('stone', str(p, 'planterColor'), 'stone');
        o.prism(pm, [[-w / 2 - 0.06, (-w / 2 - 0.06) * k - 0.05], [s.len + w / 2 + 0.06, (s.len + w / 2 + 0.06) * k - 0.05], [s.len + w / 2 + 0.06, (s.len + w / 2 + 0.06) * k + base], [-w / 2 - 0.06, (-w / 2 - 0.06) * k + base]], -w / 2 - 0.06, w / 2 + 0.06);
      }
    });
  },
};

/** Ready profiles of the sweep, (height, offset) from the path line (offset + to the outside). */
const SWEEP_PROFILES: Record<string, (w: number, h: number) => [number, number][]> = {
  lowwall: (w, h) => [[0, -w / 2], [0, w / 2], [h, w / 2], [h, -w / 2]],
  coping: (w, h) => [[0, -w / 2], [0, w / 2], [h * 0.75, w / 2], [h * 0.75, w / 2 + 0.04], [h, w / 2 + 0.04], [h, -w / 2 - 0.04], [h * 0.75, -w / 2 - 0.04], [h * 0.75, -w / 2]],
  cornice: (w, h) => [[0, 0], [h * 0.2, 0], [h * 0.25, w * 0.25], [h * 0.55, w * 0.35], [h * 0.75, w * 0.8], [h * 0.85, w], [h, w], [h, 0]],
  kerb: (w, h) => [[0, -w / 2], [0, w / 2], [h - 0.03, w / 2], [h, w / 2 - 0.03], [h, -w / 2]],
  gutter: (w, h) => [[0, -w / 2], [0, w / 2], [h, w / 2], [h, w / 2 - 0.02], [0.02, w / 2 - 0.02], [0.02, -w / 2 + 0.02], [h, -w / 2 + 0.02], [h, -w / 2]],
};

/** A custom profile typed as "height, offset; height, offset; …" (at least three points), or null. */
export function parseProfile(text: string): [number, number][] | null {
  const pts = text
    .split(';')
    .map((q) => q.split(',').map((v) => parseFloat(v.trim())))
    .filter((q) => q.length === 2 && q.every(Number.isFinite)) as [number, number][];
  return pts.length >= 3 ? pts : null;
}

/**
 * Sweep: a profile carried along a path (Estúdio de Construção's "sweep a profile along a path"): low
 * walls, copings, cornices, kerbs, gutters, or any profile typed as points. Each run of the path is
 * swept in its own frame (x along); sloped runs go in short steps, like the hedge.
 */
export const SWEEP: Family = {
  id: 'sweep',
  name: 'Profile along a path',
  category: 'fences',
  host: 'path',
  tags: ['sweep', 'profile', 'cornice', 'low wall', 'coping', 'kerb', 'gutter', 'moulding', 'path'],
  params: [
    P.pick('profile', 'Profile', 'lowwall', [
      ['lowwall', 'Low wall'],
      ['coping', 'Wall with coping'],
      ['cornice', 'Cornice'],
      ['kerb', 'Kerb'],
      ['gutter', 'Gutter'],
      ['custom', 'Typed (points below)'],
    ]),
    P.len('width', 'Width', 0.25, 0.03, 3),
    P.len('height', 'Height', 0.8, 0.03, 4),
    { key: 'points', label: 'Typed profile (height, offset; …)', kind: 'text', default: '0,0; 0,0.3; 0.2,0.3; 0.3,0.15; 0.3,0', scope: 'type', group: 'profile' },
    P.pick('finish', 'Finish', 'plaster', FINISHES, 'material'),
    P.color('wallColor', 'Color', '#d9d2c3'),
  ],
  size: (p) => [1, num(p, 'height'), num(p, 'width')],
  build(p, out, ctx) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    const kind = str(p, 'profile');
    const prof = (kind === 'custom' ? parseProfile(str(p, 'points')) : null) ?? (SWEEP_PROFILES[kind] ?? SWEEP_PROFILES.lowwall!)(w, h);
    const m = wallMat(p);
    for (const s of segments(pathOf(ctx), 4)) {
      const o = segSink(out, s);
      const k = s.rise / s.len;
      // A little past each end closes the corners of a bent path.
      const ext = Math.max(...prof.map((q) => Math.abs(q[1])));
      if (Math.abs(k) < 0.01) o.sweepX(m, prof, -ext, s.len + ext);
      else {
        const n = Math.max(1, Math.ceil(Math.hypot(s.len, s.rise) / 0.5));
        for (let i = 0; i < n; i++) {
          const xa = (s.len * i) / n,
            xb = (s.len * (i + 1)) / n;
          o.translated(0, xa * k, 0).sweepX(m, prof, xa - 0.02, xb + 0.02);
        }
      }
    }
  },
};
