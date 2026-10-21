// The floor plan (floorplan.ts) as SVG text: what the plan view shows and what the drawing sheets print.
// Drawn in metres in the building's plan frame, x to the right and z down the sheet (the top view of the
// scene). Line weights follow the usual hierarchy of a plan: cut walls filled and outlined heavy, doors
// and windows thin, dimensions finest with slashed ticks, each room with its name and area. Pure text.
import type { Vec2 } from '../model/schema';
import type { FloorPlan } from './floorplan';
import type { SiteContext } from './sitecontext';

export interface PlanSvgOptions {
  /** Title over the drawing ("Ground floor plan"); empty: none. */
  title?: string;
  /** Decimal separator of the numbers (',' in Portuguese). */
  decimal?: string;
  /** Room selected in the view (outlined). */
  selectedRoom?: string | null;
  /** Interactive view: rooms carry data-room / data-i to be clicked. */
  interactive?: boolean;
  /** Translation of the words drawn ("UP" on a stair). */
  t?: (english: string) => string;
  /** The surroundings drawn light under the plan (the ground floor): lots, streets, contours. */
  site?: SiteContext | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pt = (p: Vec2) => `${r3(p[0])},${r3(p[1])}`;
const path = (rings: Vec2[][]) => rings.map((r) => `M${r.map(pt).join('L')}Z`).join('');

/** Margin around the outline for the dimensions and the labels (m). */
const MARGIN = 2.6;

export function floorPlanSvg(fp: FloorPlan, o: PlanSvgOptions = {}): { svg: string; viewBox: [number, number, number, number] } {
  const dec = o.decimal ?? '.';
  const num = (v: number, d = 2) => v.toFixed(d).replace('.', dec);
  const { x0, z0, x1, z1 } = fp.bbox;
  const vb: [number, number, number, number] = [x0 - MARGIN, z0 - MARGIN - (o.title ? 0.8 : 0), x1 - x0 + 2 * MARGIN, z1 - z0 + 2 * MARGIN + (o.title ? 0.8 : 0)];
  const s: string[] = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(r3).join(' ')}" font-family="Inter, Helvetica, Arial, sans-serif">`);
  s.push('<style>.rm{fill:transparent}.rm:hover{fill:rgba(217,119,87,.08)}.rm.sel{fill:rgba(217,119,87,.14);stroke:#d97757;stroke-width:.04}</style>');
  // The surroundings first, light and thin (clipped by the sheet): streets, lot lines, contour lines.
  if (o.site) {
    if (o.site.streets.length) s.push(`<path d="${path(o.site.streets)}" fill="#eeede9" stroke="#b5b2aa" stroke-width="0.02"/>`);
    if (o.site.lots.length) s.push(`<path d="${path(o.site.lots)}" fill="none" stroke="#8a8a8a" stroke-width="0.025" stroke-dasharray="0.3 0.15"/>`);
    if (o.site.contours.length) s.push(`<path d="${o.site.contours.map((c) => `M${pt(c[0])}L${pt(c[1])}`).join('')}" fill="none" stroke="#b9ae93" stroke-width="0.02"/>`);
    // Grid axes: a dash-dot line and its label in a circle at each end (inside the sheet).
    for (const x of o.site.axes ?? []) {
      // Cut to the sheet (less the label's radius): the labels sit at the ends that are seen.
      const seg = clipSeg(x.a, x.b, vb[0] + 0.35, vb[1] + 0.35, vb[0] + vb[2] - 0.35, vb[1] + vb[3] - 0.35);
      if (!seg) continue;
      s.push(`<path d="M${pt(seg[0])}L${pt(seg[1])}" stroke="#c0392b" stroke-width="0.02" stroke-dasharray="0.6 0.15 0.08 0.15" fill="none"/>`);
      for (const c of seg) s.push(`<circle cx="${r3(c[0])}" cy="${r3(c[1])}" r="0.3" fill="#fff" stroke="#c0392b" stroke-width="0.025"/><text x="${r3(c[0])}" y="${r3(c[1] + 0.1)}" font-size="0.28" font-weight="bold" text-anchor="middle" fill="#c0392b">${esc(x.label)}</text>`);
    }
  }
  // Rooms (under everything: the floor of each, clickable).
  fp.rooms.forEach((r, i) => {
    const attrs = o.interactive ? ` data-i="${i}"${r.id ? ` data-room="${esc(r.id)}"` : ''}` : '';
    s.push(`<path class="rm${r.id && r.id === o.selectedRoom ? ' sel' : ''}" fill-rule="evenodd" d="${path(r.rings)}"${attrs}/>`);
  });
  // Furniture and stairs, thin; dashed above the cut.
  for (const sym of fp.symbols) {
    for (const k of [false, true]) {
      const d = sym.strokes
        .filter((x) => x.above === k)
        .map((x) => `M${x.pts.map(pt).join('L')}${x.closed ? 'Z' : ''}`)
        .join('');
      if (d) s.push(`<path d="${d}" fill="none" stroke="#6b6760" stroke-width="0.01" stroke-linejoin="round"${k ? ' stroke-dasharray="0.08 0.05"' : ''}/>`);
    }
    if (sym.label) s.push(`<text x="${r3(sym.label.at[0])}" y="${r3(sym.label.at[1])}" font-size="0.16" text-anchor="middle" fill="#55524d">${esc((o.t ?? ((x: string) => x))(sym.label.text))}</text>`);
  }
  // Cut walls: poche with a heavy outline.
  s.push(`<path d="${path(fp.walls)}" fill="#2b2a28" fill-rule="evenodd" stroke="#111" stroke-width="0.02" stroke-linejoin="miter"/>`);
  // The boundaries between the layers of a wall type, light on the poché.
  if (fp.layers?.length) s.push(`<path d="${path(fp.layers)}" fill="#9d978c" fill-rule="evenodd"/>`);
  // Windows: the two faces of the sill and the glass between them.
  for (const w of fp.windows) {
    const ia = [w.a[0] - w.n[0] * w.depth, w.a[1] - w.n[1] * w.depth] as Vec2,
      ib = [w.b[0] - w.n[0] * w.depth, w.b[1] - w.n[1] * w.depth] as Vec2;
    const ma = [w.a[0] - (w.n[0] * w.depth) / 2, w.a[1] - (w.n[1] * w.depth) / 2] as Vec2,
      mb = [w.b[0] - (w.n[0] * w.depth) / 2, w.b[1] - (w.n[1] * w.depth) / 2] as Vec2;
    s.push(`<path d="M${pt(w.a)}L${pt(w.b)}M${pt(ia)}L${pt(ib)}M${pt(w.a)}L${pt(ia)}M${pt(w.b)}L${pt(ib)}" fill="none" stroke="#2b2a28" stroke-width="0.015"/>`);
    s.push(`<path d="M${pt(ma)}L${pt(mb)}" stroke="#3a7bd5" stroke-width="0.025"/>`);
  }
  // Doors: the leaf open at 90° and its swing as a quarter arc, the threshold across the wall.
  for (const d of fp.doors) {
    const sweep = cross(sub(d.jamb, d.hinge), sub(d.leaf, d.hinge)) > 0 ? 0 : 1;
    s.push(`<path d="M${pt(d.hinge)}L${pt(d.leaf)}" stroke="#2b2a28" stroke-width="0.03"/>`);
    s.push(`<path d="M${pt(d.leaf)}A${r3(d.width)} ${r3(d.width)} 0 0 ${sweep} ${pt(d.jamb)}" fill="none" stroke="#2b2a28" stroke-width="0.012" stroke-dasharray="0.06 0.04"/>`);
  }
  // Room labels: the name (when it has one) over the area.
  for (const r of fp.rooms) {
    const [x, y] = r.at;
    if (r.name) s.push(`<text x="${r3(x)}" y="${r3(y - 0.06)}" font-size="0.32" font-weight="bold" text-anchor="middle" fill="#1d1d1f">${esc(r.name)}</text>`);
    s.push(`<text x="${r3(x)}" y="${r3(y + (r.name ? 0.36 : 0.12))}" font-size="0.26" text-anchor="middle" fill="#55524d">${num(r.area)} m²</text>`);
  }
  // Dimensions.
  for (const d of fp.dims) {
    const off = 0.9 + d.tier * 0.7;
    const horiz = d.side === 'top' || d.side === 'bottom';
    const sgn = d.side === 'bottom' || d.side === 'right' ? 1 : -1;
    const shift = (p: Vec2): Vec2 => (horiz ? [p[0], (d.side === 'bottom' ? z1 : z0) + sgn * off] : [(d.side === 'right' ? x1 : x0) + sgn * off, p[1]]);
    const a = shift(d.a),
      b = shift(d.b);
    const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
    const ext = (p: Vec2, q: Vec2) => `M${pt(p)}L${pt(horiz ? [q[0], q[1] + sgn * 0.12] : [q[0] + sgn * 0.12, q[1]])}`;
    const tick = (p: Vec2) => `M${r3(p[0] - 0.09)},${r3(p[1] + 0.09)}L${r3(p[0] + 0.09)},${r3(p[1] - 0.09)}`;
    // Extension lines from just off the wall, the line, the ticks.
    const fromA: Vec2 = horiz ? [d.a[0], d.a[1] + sgn * 0.25] : [d.a[0] + sgn * 0.25, d.a[1]];
    const fromB: Vec2 = horiz ? [d.b[0], d.b[1] + sgn * 0.25] : [d.b[0] + sgn * 0.25, d.b[1]];
    s.push(`<path d="${ext(fromA, a)}${ext(fromB, b)}M${pt(a)}L${pt(b)}${tick(a)}${tick(b)}" fill="none" stroke="#6b6760" stroke-width="0.01"/>`);
    const mx = (a[0] + b[0]) / 2,
      my = (a[1] + b[1]) / 2;
    const fs = len < 0.9 ? 0.16 : 0.2;
    s.push(
      horiz
        ? `<text x="${r3(mx)}" y="${r3(my - 0.07)}" font-size="${fs}" text-anchor="middle" fill="#3d3a35">${num(len)}</text>`
        : `<text x="${r3(mx - 0.07)}" y="${r3(my)}" font-size="${fs}" text-anchor="middle" fill="#3d3a35" transform="rotate(-90 ${r3(mx - 0.07)} ${r3(my)})">${num(len)}</text>`,
    );
  }
  if (o.title) s.push(`<text x="${r3(x0)}" y="${r3(z0 - MARGIN)}" font-size="0.42" font-weight="bold" fill="#1d1d1f">${esc(o.title)}</text>`);
  s.push('</svg>');
  return { svg: s.join(''), viewBox: vb };
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

/** A segment cut to a box (Liang–Barsky), or null when it lies outside. */
function clipSeg(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): [Vec2, Vec2] | null {
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}
