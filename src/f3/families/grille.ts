// Security grille and decorative bars in front of an opening. Face frame:
// x along the wall, y up from the sill, z outwards; the bars sit at `offset`
// from the wall and cut no opening. No three.
import type { Family } from './family';
import { bool, num, P, str } from './family';
import { clamp, mat, slopedBox } from './kit';

export const GRILLE: Family = {
  id: 'grille',
  name: 'Window grille',
  category: 'facade',
  host: 'face',
  tags: ['grille', 'bars', 'security', 'window', 'railing', 'facade'],
  params: [
    P.len('width', 'Width', 1.2, 0.3, 6),
    P.len('height', 'Height', 1.4, 0.3, 4),
    P.count('bars', 'Bars', 6, 1, 60),
    P.pick('style', 'Style', 'vertical', [
      ['vertical', 'Vertical bars'],
      ['grid', 'Grid'],
      ['diagonal', 'Diagonal lattice'],
    ]),
    P.len('barThick', 'Bar section', 0.02, 0.008, 0.06, 'type', 'profile', 0.002),
    P.len('offset', 'Distance from wall', 0.06, 0.02, 0.4, 'type', 'profile', 0.01),
    P.flag('frame', 'Frame', true, 'profile'),
    P.color('color', 'Color', '#2f3336'),
    P.finish('finish', 'Material', 'steel'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), 0.08],
  sill: () => 0.9,
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      t = num(p, 'barThick');
    const z = num(p, 'offset');
    const n = clamp(Math.round(num(p, 'bars')), 1, 60);
    const m = mat('metal', str(p, 'color'), str(p, 'finish'));
    const d = Math.max(0.02, t * 1.5);
    const style = str(p, 'style');
    if (style === 'grid' || style === 'vertical') {
      // Rails first (a grid gets as many rows as fit the panel), then the bars.
      const rails = style === 'grid' ? clamp(Math.round((n * h) / w), 2, 24) : 2;
      for (let j = 0; j < rails; j++) out.box(m, [0, (h * (j + 0.5)) / rails, z], [w, t, d]);
      for (let i = 0; i < n; i++) out.box(m, [-w / 2 + (w * (i + 0.5)) / n, h / 2, z], [t, h, d]);
    } else {
      // Diagonal lattice: the 45° line x − y = c is clipped to the panel, so
      // every bar starts and ends exactly on the top or the bottom edge.
      const s = Math.max(0.06, w / n);
      const c0 = -w / 2 - h;
      const count = Math.min(80, Math.ceil((w + h) / s));
      for (let i = 0; i <= count; i++) {
        const c = c0 + i * s;
        const x0 = Math.max(-w / 2, c);
        const x1 = Math.min(w / 2, c + h);
        if (x1 - x0 < 1e-3) continue;
        slopedBox(out, m, x0, x0 - c, x1, x1 - c, t, d, z);
      }
    }
    if (bool(p, 'frame')) {
      const f = t * 1.8;
      for (const sx of [-1, 1]) out.box(m, [(sx * (w - f)) / 2, h / 2, z], [f, h, d * 1.3]);
      for (const sy of [f / 2, h - f / 2]) out.box(m, [0, sy, z], [w, f, d * 1.3]);
    }
  },
};
