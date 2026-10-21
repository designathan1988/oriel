// Exposed structure: columns (square, round, classical with base, shaft and
// capital, I-beam, tapered), beams along a path, pergolas and
// classical porticoes (colonnade, entablature and pediment).
import type { Family, PartMat, PartSink, Params } from './family';
import { bool, num, P, str } from './family';
import { cone, mat, pathOf, segments, segSink, slopedBox, spread, taperBox, toDeg } from './kit';

const COLUMN_KINDS: [string, string][] = [
  ['square', 'Square'],
  ['round', 'Round'],
  ['classical', 'Classical (base, shaft and capital)'],
  ['ibeam', 'Steel I-beam'],
  ['tapered', 'Tapered'],
];

/** Column of height H and width/diameter D with the base at (x, y0, z). */
export function column(out: PartSink, kind: string, x: number, y0: number, z: number, H: number, D: number, m: PartMat, opts: { plinth: boolean; capital: boolean; fluted?: boolean }): void {
  let y = y0;
  let top = y0 + H;
  if (opts.plinth && kind !== 'ibeam') {
    const ph = Math.min(0.25, H * 0.08);
    out.box(m, [x, y + ph / 2, z], [D * 1.35, ph, D * 1.35]);
    y += ph;
  }
  if (kind === 'square') {
    if (opts.capital) {
      const ch = Math.min(0.15, H * 0.05);
      out.box(m, [x, top - ch / 2, z], [D * 1.2, ch, D * 1.2]);
      top -= ch;
    }
    out.box(m, [x, (y + top) / 2, z], [D, top - y, D]);
  } else if (kind === 'round') {
    if (opts.capital) {
      const ch = Math.min(0.12, H * 0.04);
      out.box(m, [x, top - ch / 2, z], [D * 1.15, ch, D * 1.15]);
      top -= ch;
    }
    out.cylinder(m, [x, y, z], D / 2, top - y, 20);
  } else if (kind === 'classical') {
    // Simplified Attic base: two tori and a scotia.
    const r = D / 2;
    out.cylinder(m, [x, y, z], r * 1.22, r * 0.25, 20);
    out.cylinder(m, [x, y + r * 0.25, z], r * 1.08, r * 0.12, 20);
    out.cylinder(m, [x, y + r * 0.37, z], r * 1.15, r * 0.2, 20);
    y += r * 0.57;
    // Doric capital: echinus (widening) and abacus.
    const ab = r * 0.3,
      ech = r * 0.35;
    if (opts.capital) {
      out.box(m, [x, top - ab / 2, z], [D * 1.3, ab, D * 1.3]);
      cone(out, m, [x, top - ab - ech, z], r * 0.86, r * 1.18, ech, 4, 20);
      out.cylinder(m, [x, top - ab - ech - r * 0.1, z], r * 0.9, r * 0.1, 20);
      top -= ab + ech + r * 0.1;
    }
    // Shaft with entasis: lower 1/3 straight, then tapers to 0.84 r.
    const fh = top - y;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t = (i + 0.5) / n;
      const rr = t < 1 / 3 ? r : r * (1 - 0.16 * ((t - 1 / 3) / (2 / 3)) ** 1.4);
      out.cylinder(m, [x, y + fh * t0, z], rr, fh / n, 20);
    }
    if (opts.fluted) {
      // Flutes suggested by projecting fillets.
      const k = 16;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        const rr = r * 0.92;
        out.box(m, [x + Math.cos(a) * rr, y + fh * 0.5, z + Math.sin(a) * rr], [0.02, fh * 0.92, 0.02], [toDeg(-a), 0, 0]);
      }
    }
  } else if (kind === 'ibeam') {
    const tf = Math.max(0.01, D * 0.08),
      tw = Math.max(0.008, D * 0.05);
    out.box(m, [x, y + 0.01, z], [D * 1.6, 0.02, D * 1.6]);
    y += 0.02;
    if (opts.capital) {
      out.box(m, [x, top - 0.01, z], [D * 1.2, 0.02, D * 1.2]);
      top -= 0.02;
    }
    const h = top - y;
    out.box(m, [x, y + h / 2, z - D / 2 + tf / 2], [D, h, tf]);
    out.box(m, [x, y + h / 2, z + D / 2 - tf / 2], [D, h, tf]);
    out.box(m, [x, y + h / 2, z], [tw, h, D - 2 * tf]);
  } else {
    if (opts.capital) {
      out.box(m, [x, top - 0.06, z], [D * 0.9, 0.12, D * 0.9]);
      top -= 0.12;
    }
    taperBox(out, m, [x, y, z], D, D * 0.65, top - y, 12);
  }
}

const colMat = (p: Params): PartMat => {
  const k = str(p, 'kind');
  return k === 'ibeam' ? mat('metal', str(p, 'color'), 'metal') : mat(k === 'classical' ? 'stone' : 'concrete', str(p, 'color'), str(p, 'finish'));
};

export const COLUMN: Family = {
  id: 'column',
  name: 'Column',
  category: 'structure',
  host: 'free',
  tags: ['pillar', 'column', 'classical', 'doric', 'I-beam', 'steel', 'concrete'],
  params: [
    P.pick('kind', 'Section', 'square', COLUMN_KINDS),
    P.len('height', 'Height', 3, 0.5, 20, 'instance'),
    P.len('size', 'Width / diameter', 0.3, 0.08, 2, 'type', 'size', 0.01),
    P.flag('plinth', 'Base (plinth)', true),
    P.flag('capital', 'Capital', true),
    P.flag('fluted', 'Fluting', false),
    P.color('color', 'Color', '#e8e2d6'),
    P.finish('finish', 'Finish', 'plaster'),
  ],
  size: (p) => {
    const D = num(p, 'size');
    const k = str(p, 'kind');
    const w = k === 'classical' ? D * 1.35 : k === 'ibeam' ? D * 1.6 : bool(p, 'plinth') ? D * 1.35 : bool(p, 'capital') ? D * 1.2 : D;
    return [w, num(p, 'height'), w];
  },
  build(p, out) {
    column(out, str(p, 'kind'), 0, 0, 0, num(p, 'height'), num(p, 'size'), colMat(p), { plinth: bool(p, 'plinth'), capital: bool(p, 'capital'), fluted: bool(p, 'fluted') });
  },
};

export const BEAM: Family = {
  id: 'beam',
  name: 'Beam',
  category: 'structure',
  host: 'path',
  tags: ['beam', 'I-beam', 'wood', 'concrete', 'rail', 'pipe'],
  params: [
    P.pick('profile', 'Profile', 'rect', [
      ['rect', 'Rectangular'],
      ['ibeam', 'I-beam'],
      ['round', 'Tube / round'],
    ]),
    P.len('depth', 'Section height', 0.4, 0.05, 2, 'type', 'size', 0.01),
    P.len('width', 'Section width', 0.2, 0.04, 1, 'type', 'size', 0.01),
    P.pick('align', 'Path points at', 'bottom', [
      ['bottom', 'Bottom face'],
      ['center', 'Center line'],
      ['top', 'Top face'],
    ]),
    P.len('elevation', 'Base elevation', 0, -1, 30, 'instance'),
    P.color('color', 'Color', '#cfc9bd'),
    P.finish('finish', 'Finish', 'concrete'),
  ],
  size: (p) => [1, num(p, 'depth') + Math.max(0, num(p, 'elevation')), num(p, 'width')],
  build(p, out, ctx) {
    const d = num(p, 'depth'),
      w = num(p, 'width');
    const al = str(p, 'align');
    const yc = num(p, 'elevation') + (al === 'bottom' ? d / 2 : al === 'top' ? -d / 2 : 0);
    const prof = str(p, 'profile');
    const m = prof === 'ibeam' ? mat('metal', str(p, 'color'), 'metal') : mat('concrete', str(p, 'color'), str(p, 'finish'));
    for (const s of segments(pathOf(ctx), 4)) {
      const o = segSink(out, s);
      if (prof === 'round') o.rod(m, [0, yc, 0], [s.len, s.rise + yc, 0], Math.min(d, w) / 2, 12);
      else if (prof === 'ibeam') {
        const tf = Math.max(0.01, d * 0.08);
        slopedBox(o, m, 0, yc + d / 2 - tf / 2, s.len, s.rise + yc + d / 2 - tf / 2, tf, w);
        slopedBox(o, m, 0, yc - d / 2 + tf / 2, s.len, s.rise + yc - d / 2 + tf / 2, tf, w);
        slopedBox(o, m, 0, yc, s.len, s.rise + yc, d - 2 * tf, Math.max(0.008, w * 0.08));
      } else slopedBox(o, m, 0, yc, s.len, s.rise + yc, d, w);
    }
  },
};

export const PERGOLA: Family = {
  id: 'pergola',
  name: 'Pergola',
  category: 'structure',
  host: 'free',
  tags: ['pergola', 'arbor', 'slatted', 'garden', 'wood', 'shade'],
  params: [
    P.len('width', 'Width', 4, 1.5, 12),
    P.len('depth', 'Depth', 3, 1.5, 8),
    P.len('height', 'Clear height', 2.5, 2, 4),
    P.len('postSize', 'Post section', 0.15, 0.08, 0.4, 'type', 'profile', 0.01),
    P.len('postSpacing', 'Max span between posts', 3, 1.5, 6, 'type', 'divisions'),
    P.len('rafterSpacing', 'Rafter spacing', 0.5, 0.2, 1.2, 'type', 'divisions'),
    P.len('overhang', 'Rafter overhang', 0.3, 0, 1),
    P.flag('slats', 'Battens on the rafters', true),
    P.pick('material', 'Material', 'wood', [
      ['wood', 'Wood'],
      ['steel', 'Steel'],
      ['concrete', 'Concrete'],
    ]),
    P.color('color', 'Color', '#8a6240'),
    P.flag('vines', 'Climbing plant', false),
  ],
  size: (p) => {
    const ov = num(p, 'overhang');
    return [num(p, 'width') + 2 * ov, num(p, 'height') + 0.5, num(p, 'depth') + 2 * ov];
  },
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      H = num(p, 'height');
    const ps = num(p, 'postSize'),
      ov = num(p, 'overhang');
    const kind = str(p, 'material');
    const m = mat(kind === 'steel' ? 'metal' : kind === 'concrete' ? 'concrete' : 'wood', str(p, 'color'), kind === 'steel' ? 'metal' : kind);
    const xs = spread(w - ps, num(p, 'postSpacing')).map((x) => x - (w - ps) / 2);
    const zs = [-d / 2 + ps / 2, d / 2 - ps / 2];
    for (const x of xs)
      for (const z of zs) {
        out.box(mat('concrete', '#a7a196', 'concrete'), [x, 0.05, z], [ps + 0.1, 0.1, ps + 0.1]);
        out.box(m, [x, 0.1 + (H - 0.1) / 2, z], [ps, H - 0.1, ps]);
      }
    // Beams along x (pairs hugging the posts), rafters along z, battens on top.
    const bh = Math.max(0.15, ps * 1.4),
      bt = ps * 0.35;
    for (const z of zs) for (const s of [-1, 1]) out.box(m, [0, H + bh / 2, z + (s * (ps + bt)) / 2], [w + 2 * ov, bh, bt]);
    const rh = bh * 0.9,
      rt = Math.max(0.04, ps * 0.3);
    const rx = spread(w + 2 * ov - rt, num(p, 'rafterSpacing')).map((x) => x - (w + 2 * ov - rt) / 2);
    for (const x of rx) out.box(m, [x, H + bh + rh / 2, 0], [rt, rh, d + 2 * ov]);
    const top = H + bh + rh;
    if (bool(p, 'slats')) {
      const n = Math.max(3, Math.round((d + 2 * ov) / 0.25));
      for (let i = 0; i < n; i++) out.box(m, [0, top + 0.02, -d / 2 - ov + ((d + 2 * ov) * (i + 0.5)) / n], [w + 2 * ov, 0.04, 0.05]);
    }
    if (bool(p, 'vines')) {
      const g = mat('green', '#4c7a3a');
      for (const x of [xs[0]!, xs[xs.length - 1]!]) out.box(g, [x, H / 2, zs[1]! + ps / 2 + 0.06], [ps * 2, H, 0.12]);
      out.box(g, [0, top + 0.08, 0], [w * 0.8, 0.1, d * 0.7]);
    }
  },
};

export const PORTICO: Family = {
  id: 'portico',
  name: 'Classical portico',
  category: 'structure',
  host: 'free',
  tags: ['portico', 'colonnade', 'pediment', 'entablature', 'temple', 'classical', 'neoclassical'],
  params: [
    P.len('width', 'Width', 6, 2, 20),
    P.len('depth', 'Depth', 2.4, 0.8, 6),
    P.len('height', 'Column height', 4, 2, 12),
    P.count('columns', 'Front columns', 4, 2, 12),
    P.pick('kind', 'Column', 'classical', COLUMN_KINDS.filter(([k]) => k !== 'ibeam')),
    P.flag('fluted', 'Fluting', true),
    P.flag('pediment', 'Pediment', true),
    P.angle('pitch', 'Pediment pitch', 15, 8, 30),
    P.count('steps', 'Base steps', 3, 0, 6, 'detail'),
    P.color('color', 'Color', '#ece6d8'),
    P.finish('finish', 'Finish', 'stone'),
  ],
  size: (p) => {
    const w = num(p, 'width'),
      d = num(p, 'depth');
    const st = Math.round(num(p, 'steps'));
    const ent = num(p, 'height') * 0.25;
    const ped = bool(p, 'pediment') ? (w / 2 + 0.15) * Math.tan((num(p, 'pitch') * Math.PI) / 180) + 0.1 : 0;
    return [w + 0.3 + st * 0.6, st * 0.16 + num(p, 'height') + ent + ped, d + 0.3 + st * 0.6];
  },
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      H = num(p, 'height');
    const m = mat('stone', str(p, 'color'), str(p, 'finish'));
    const st = Math.round(num(p, 'steps'));
    // Stepped stylobate.
    for (let i = 0; i < st; i++) {
      const g = (st - i) * 0.3;
      out.box(m, [0, i * 0.16 + 0.08, 0], [w + 0.3 + g * 2, 0.16, d + 0.3 + g * 2]);
    }
    const y0 = st * 0.16;
    const n = Math.max(2, Math.round(num(p, 'columns')));
    const D = Math.min(H / 8, (w / n) * 0.55);
    const xs = Array.from({ length: n }, (_, i) => -w / 2 + D * 0.7 + ((w - 1.4 * D) * i) / (n - 1));
    const zs = [d / 2 - D * 0.7];
    const zBack = -d / 2 + D * 0.7;
    if (d > 2 * D * 1.4 + 0.5) zs.push(zBack);
    for (const z of zs)
      for (const x of z === zBack ? [xs[0]!, xs[n - 1]!] : xs) column(out, str(p, 'kind'), x, y0, z, H, D, m, { plinth: str(p, 'kind') !== 'classical', capital: true, fluted: bool(p, 'fluted') });
    // Entablature: architrave, frieze and cornice.
    const ent = H * 0.25;
    const ya = y0 + H;
    out.box(m, [0, ya + ent * 0.2, 0], [w, ent * 0.4, d]);
    out.box(m, [0, ya + ent * 0.55, 0], [w, ent * 0.3, d]);
    // Triglyphs on the frieze (suggested by projecting blocks).
    for (let i = 0; i <= n * 2 - 2; i++) out.box(m, [-w / 2 + D * 0.7 + ((w - 1.4 * D) * i) / (2 * n - 2), ya + ent * 0.55, d / 2 + 0.015], [D * 0.45, ent * 0.3, 0.03]);
    out.box(m, [0, ya + ent * 0.85, 0], [w + 0.3, ent * 0.3, d + 0.3]);
    if (bool(p, 'pediment')) {
      const rise = (w / 2 + 0.15) * Math.tan((num(p, 'pitch') * Math.PI) / 180);
      const yb = ya + ent;
      // Recessed tympanum and the sloped molding on top (prism along z).
      out.prism(m, [[-w / 2, yb], [w / 2, yb], [0, yb + rise - 0.05]], -d / 2, d / 2 - 0.08);
      out.prism(m, [[-w / 2 - 0.15, yb], [-w / 2, yb], [0, yb + rise - 0.05], [w / 2, yb], [w / 2 + 0.15, yb], [0, yb + rise + 0.1]], -d / 2 - 0.15, d / 2 + 0.15);
    }
  },
};
