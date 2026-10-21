// SVG plan of a forma/3 project (pure: no three, no DOM).
//
// The drawing is a plan seen from above: X east to the right, Z down the sheet
// (screen y = −z, the usual top view of the scene). Lots are dashed, the
// additive volumes of each building are light gray with a dark outline, the
// subtractive ones are white with a dashed outline, and every building is
// labeled at the area-weighted centroid of its volumes. A 10 m scale bar and a
// north arrow sit inside the 5 m margin; the viewBox is fitted to the content.
//
// It shares the geometry of the other exports: model/plan.ts (sampleRing,
// oriented), model/ops.ts (toWorld) and model/lots.ts (buildingAreas).
import type { Building3, Project3, Vec2 } from '../model/schema';
import { oriented, sampleRing } from '../model/plan';
import { toWorld } from '../model/ops';
import { buildingAreas } from '../model/lots';
import { ribbon } from '../model/site';
import { contourSegments, terrainField } from '../model/terrain';
import { optionHidden } from '../model/layers';

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Signed area of a ring (m²). */
function ringArea(r: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Area centroid of a ring. */
function centroid(r: readonly Vec2[]): Vec2 {
  const a = ringArea(r);
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let z = 0;
    for (const q of r) {
      x += q[0];
      z += q[1];
    }
    return [x / r.length, z / r.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

interface Shape {
  d: string;
  fill: string;
  stroke: string;
  /** stroke-dasharray value; '' is a solid line. */
  dash: string;
  width: number;
}

/**
 * Plan of the project as SVG text. `scale` is px per meter (default 4);
 * `showLots` (default true) draws the lot outlines.
 */
export function planSvg(p: Project3, opts: { scale?: number; showLots?: boolean } = {}): string {
  const scale = opts.scale !== undefined && opts.scale > 0 ? opts.scale : 4;
  const showLots = opts.showLots ?? true;
  const X = (x: number): number => x * scale;
  const Y = (z: number): number => -z * scale;

  const add: Shape[] = [];
  const cut: Shape[] = [];
  const labels: { x: number; y: number; text: string }[] = [];

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  const grow = (x: number, z: number): void => {
    const px = X(x);
    const py = Y(z);
    bx0 = Math.min(bx0, px);
    by0 = Math.min(by0, py);
    bx1 = Math.max(bx1, px);
    by1 = Math.max(by1, py);
  };
  const path = (ring: Vec2[]): string => {
    if (ring.length < 3) return '';
    const parts = ring.map((q, i) => `${i === 0 ? 'M' : 'L'} ${round3(X(q[0]))} ${round3(Y(q[1]))}`);
    return `${parts.join(' ')} Z`;
  };

  // Streets (asphalt dark, sidewalks light) under everything, then the lots.
  const streets: Shape[] = [];
  for (const st of p.streets ?? []) {
    for (const q of ribbon(st.points, st.width / 2, st.width / 2 + st.sidewalk)) {
      for (const v of q) grow(v[0], v[1]);
      streets.push({ d: path(q), fill: '#ecebe7', stroke: '#9a9a9a', dash: '', width: 0.6 });
    }
    for (const q of ribbon(st.points, 0, st.width / 2)) streets.push({ d: path(q), fill: '#c9c9c9', stroke: 'none', dash: '', width: 0 });
    let best = 0,
      bi = 1;
    for (let i = 1; i < st.points.length; i++) {
      const l = Math.hypot(st.points[i]![0] - st.points[i - 1]![0], st.points[i]![1] - st.points[i - 1]![1]);
      if (l > best) [best, bi] = [l, i];
    }
    const a = st.points[bi - 1]!,
      b = st.points[bi]!;
    labels.push({ x: X((a[0] + b[0]) / 2), y: Y((a[1] + b[1]) / 2), text: st.name });
  }
  // The ground's contour lines (1 m, every fifth heavier with its height), when it is shaped.
  const field = terrainField(p);
  const contours = field ? contourSegments(field, 1, Math.max(0.5, Math.max(field.box[2] - field.box[0], field.box[3] - field.box[1]) / 160)) : [];
  const contourMarks: { x: number; y: number; text: string }[] = [];
  if (field) {
    // The terrain fills the sheet only where it is shaped near the project (its box can be wide).
    const seen = new Set<number>();
    for (const c of contours) {
      grow(c[0], c[1]);
      if (!seen.has(c[4]) && (c[4] % 5 === 0 || Math.abs(c[4]) <= 5)) {
        seen.add(c[4]);
        contourMarks.push({ x: X(c[0]), y: Y(c[1]), text: `${c[4] > 0 ? '+' : ''}${c[4]}` });
      }
    }
  }

  if (showLots) {
    for (const l of p.lots) {
      const ring: Vec2[] = l.polygon.map((q) => [q[0], q[1]]);
      for (const q of ring) grow(q[0], q[1]);
      cut.push({ d: path(ring), fill: 'none', stroke: '#8a8a8a', dash: '6 4', width: 1 });
    }
  }

  for (const b of p.buildings) {
    if (b.hidden || optionHidden(p, b)) continue;
    const adds: Vec2[][] = [];
    for (const s of b.solids) {
      const ring = sampleRing(oriented(s.plan.outer, 1)).pts.map((q) => toWorld(b, q));
      for (const q of ring) grow(q[0], q[1]);
      if (s.op === 'add' && !s.hidden) {
        adds.push(ring);
        add.push({ d: path(ring), fill: '#dcdcdc', stroke: '#2f2f2f', dash: '', width: 1 });
      } else if (s.op === 'subtract') {
        cut.push({ d: path(ring), fill: '#ffffff', stroke: '#777777', dash: '5 4', width: 1 });
      } else {
        cut.push({ d: path(ring), fill: 'none', stroke: '#3f6fa8', dash: '2 3', width: 1 });
      }
    }
    // Label at the area-weighted centroid of the additive volumes.
    let ax = 0;
    let az = 0;
    let aa = 0;
    for (const ring of adds) {
      const a = Math.abs(ringArea(ring));
      const c = centroid(ring);
      ax += c[0] * a;
      az += c[1] * a;
      aa += a;
    }
    if (aa > 1e-6) labels.push({ x: X(ax / aa), y: Y(az / aa), text: b.name });
  }

  if (!Number.isFinite(bx0)) {
    bx0 = 0;
    by0 = 0;
    bx1 = 0;
    by1 = 0;
  }
  const m = 5 * scale; // 5 m margin
  const vbX = bx0 - m;
  const vbY = by0 - m;
  const vbW = Math.max(1, bx1 - bx0) + 2 * m;
  const vbH = Math.max(1, by1 - by0) + 2 * m;
  const font = Math.max(9, Math.min(16, Math.max(vbW, vbH) / 60));

  const svg: string[] = [];
  svg.push('<?xml version="1.0" encoding="UTF-8"?>');
  svg.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round3(vbW)}" height="${round3(vbH)}" viewBox="${round3(vbX)} ${round3(vbY)} ${round3(vbW)} ${round3(vbH)}">`,
  );
  svg.push(`<rect x="${round3(vbX)}" y="${round3(vbY)}" width="${round3(vbW)}" height="${round3(vbH)}" fill="#ffffff"/>`);
  for (const s of streets) svg.push(`<path d="${s.d}" fill="${s.fill}" stroke="${s.stroke}"${s.width ? ` stroke-width="${s.width}"` : ''}/>`);
  if (contours.length) {
    svg.push('<g stroke="#a89f88" fill="none">');
    for (const c of contours) svg.push(`<line x1="${round3(X(c[0]))}" y1="${round3(Y(c[1]))}" x2="${round3(X(c[2]))}" y2="${round3(Y(c[3]))}" stroke-width="${c[4] % 5 === 0 ? 1.1 : 0.5}"/>`);
    svg.push('</g>');
    svg.push(`<g font-family="sans-serif" font-size="${round3(Math.max(6, scale * 1.6))}" fill="#7d745e">`);
    for (const m of contourMarks) svg.push(`<text x="${round3(m.x)}" y="${round3(m.y)}">${esc(m.text)}</text>`);
    svg.push('</g>');
  }
  svg.push('<g fill-rule="evenodd">');
  for (const s of add) svg.push(`<path d="${s.d}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}"/>`);
  for (const s of cut) svg.push(`<path d="${s.d}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
  svg.push('</g>');

  // Building names.
  svg.push(`<g font-family="sans-serif" font-size="${round3(font)}" text-anchor="middle" fill="#111111">`);
  for (const l of labels) svg.push(`<text x="${round3(l.x)}" y="${round3(l.y)}">${esc(l.text)}</text>`);
  svg.push('</g>');

  // Scale bar: 10 m at the bottom left, inside the margin.
  const barLen = 10 * scale;
  const barX = vbX + m * 0.55;
  const barY = vbY + vbH - m * 0.55;
  svg.push('<g stroke="#111111" stroke-width="1.5">');
  svg.push(`<line x1="${round3(barX)}" y1="${round3(barY)}" x2="${round3(barX + barLen)}" y2="${round3(barY)}"/>`);
  svg.push(`<line x1="${round3(barX)}" y1="${round3(barY - 4)}" x2="${round3(barX)}" y2="${round3(barY + 4)}"/>`);
  svg.push(`<line x1="${round3(barX + barLen)}" y1="${round3(barY - 4)}" x2="${round3(barX + barLen)}" y2="${round3(barY + 4)}"/>`);
  svg.push('</g>');
  svg.push(
    `<text x="${round3(barX + barLen / 2)}" y="${round3(barY - 8)}" font-family="sans-serif" font-size="${round3(font)}" text-anchor="middle" fill="#111111">10 m</text>`,
  );

  // North arrow: north is the scene −Z axis, which points up the sheet.
  const nx = vbX + vbW - m * 0.7;
  const tipY = vbY + m * 0.35;
  const baseY = tipY + Math.max(14, m * 0.6);
  const half = Math.max(5, m * 0.22);
  svg.push(`<path d="M ${round3(nx)} ${round3(tipY)} L ${round3(nx - half)} ${round3(baseY)} L ${round3(nx)} ${round3(baseY - half * 0.5)} L ${round3(nx + half)} ${round3(baseY)} Z" fill="#111111"/>`);
  svg.push(
    `<text x="${round3(nx)}" y="${round3(baseY + font + 2)}" font-family="sans-serif" font-size="${round3(font)}" text-anchor="middle" fill="#111111">N</text>`,
  );
  svg.push('</svg>');
  return svg.join('\n') + '\n';
}

/** Building areas for a table next to the plan (m², m³). */
export function areasTable(p: Project3): { building: string; footprint: number; gfa: number; volume: number }[] {
  return p.buildings.map((b: Building3) => {
    const a = buildingAreas(b);
    return { building: b.name, footprint: round2(a.footprint), gfa: round2(a.gfa), volume: round2(a.volume) };
  });
}
