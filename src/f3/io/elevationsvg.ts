// Elevations (facades) of the project as SVG drawings in metres, one per side (front = seen from the
// south, then the right, back and left sides): the evaluated buildings and their parts (windows, doors,
// balconies, roofs) projected on a vertical plane, painted far to near (each face over the ones behind
// it), each face with its creases drawn, so what is hidden stays hidden without a ray tracer. The
// ground line, the floor levels (ABNT level marks) and a scale bar complete the sheet.
import type { Project3 } from '../model/schema';
import { evaluateBuilding } from '../eval/evaluate';
import { primitiveTris } from '../eval/interior';
import { apply, type M4 } from '../eval/parts';
import { family as familyOf } from '../families/index';

/** What is never seen from outside (furniture, fittings, stairs): left out of the elevations. */
const INSIDE = new Set(['furniture', 'sanitary', 'kitchen', 'stairs', 'lighting', 'interior']);

export type Side = 'front' | 'right' | 'back' | 'left';

/** For each side: the horizontal axis of the drawing and the direction the viewer looks (world x, z). */
const SIDES: Record<Side, { h: [number, number]; look: [number, number] }> = {
  front: { h: [1, 0], look: [0, -1] },
  right: { h: [0, -1], look: [-1, 0] },
  back: { h: [-1, 0], look: [0, 1] },
  left: { h: [0, 1], look: [1, 0] },
};

type V3 = [number, number, number];
interface Tri {
  p: [V3, V3, V3];
  kind: 'wall' | 'roof' | 'part' | 'glass';
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function elevationSvg(p: Project3, side: Side, dec = '.', t: (s: string) => string = (x) => x): string {
  const { h, look } = SIDES[side];
  const tris: Tri[] = [];
  const levels: number[] = [];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    let ev;
    try {
      ev = evaluateBuilding(b, { hidden: () => false }, p);
    } catch {
      continue;
    }
    const a = (b.rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const e = b.elevation ?? 0;
    const W = (x: number, y: number, z: number): V3 => [b.position[0] + x * c + z * s, y + e, b.position[1] - x * s + z * c];
    const P = ev.shell.positions,
      I = ev.shell.indices;
    for (let k = 0; k < I.length; k += 3) {
      const f = ev.faces[ev.shell.faceOf[k / 3]!];
      if (!f || /^room|^cut|^cutter|^roofCut/.test(f.kind)) continue;
      const v = [0, 1, 2].map((j) => W(P[I[k + j]! * 3]!, P[I[k + j]! * 3 + 1]!, P[I[k + j]! * 3 + 2]!)) as [V3, V3, V3];
      tris.push({ p: v, kind: f.kind === 'roof' || f.kind === 'fascia' || f.kind === 'soffit' ? 'roof' : f.kind === 'glazing' ? 'glass' : 'wall' });
    }
    const prim = new Map<string, number[]>();
    const outside = (tag: number) => {
      const fam = familyOf(ev.parts.tags[tag]?.family ?? '');
      return !fam || !INSIDE.has(fam.category);
    };
    for (const it of ev.parts.inst) {
      if (!outside(it.tag)) continue;
      let tri = prim.get(it.shape);
      if (!tri) prim.set(it.shape, (tri = primitiveTris(it.shape)));
      const glass = it.mat.slot === 'glass';
      for (let i = 0; i < tri.length; i += 9) {
        const v = [0, 1, 2].map((j) => {
          const q = apply(it.m as M4, [tri![i + j * 3]!, tri![i + j * 3 + 1]!, tri![i + j * 3 + 2]!]);
          return W(q[0], q[1], q[2]);
        }) as [V3, V3, V3];
        tris.push({ p: v, kind: glass ? 'glass' : 'part' });
      }
    }
    for (const m of ev.parts.meshes) {
      if (!outside(m.tag)) continue;
      const glass = m.mat.slot === 'glass';
      for (let i = 0; i < m.positions.length; i += 9) {
        const v = [0, 1, 2].map((j) => W(m.positions[i + j * 3]!, m.positions[i + j * 3 + 1]!, m.positions[i + j * 3 + 2]!)) as [V3, V3, V3];
        tris.push({ p: v, kind: glass ? 'glass' : 'part' });
      }
    }
    for (const l of b.levels) if (l.elevation > 0.05) levels.push(l.elevation + e);
  }
  // Facing the viewer only, projected: x along the drawing, y up; depth along the look direction.
  const proj = (q: V3) => ({ x: q[0] * h[0] + q[2] * h[1], y: q[1], d: q[0] * look[0] + q[2] * look[1] });
  const drawn = tris
    .map((tr) => {
      const [A, B, C] = tr.p;
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]],
        v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      const facing = (n[0]! * look[0] + n[2]! * look[1]) / len;
      const pts = tr.p.map(proj);
      return { pts, p3: tr.p, n: [n[0]! / len, n[1]! / len, n[2]! / len] as V3, kind: tr.kind, facing, depth: Math.max(...pts.map((q) => q.d)), area: Math.abs((pts[1]!.x - pts[0]!.x) * (pts[2]!.y - pts[0]!.y) - (pts[2]!.x - pts[0]!.x) * (pts[1]!.y - pts[0]!.y)) };
    })
    // Facing the viewer, above the ground and not a sliver.
    .filter((q) => q.facing < -0.02 && q.area > 2e-4 && Math.max(...q.pts.map((r) => r.y)) > 0.01)
    .sort((x, y) => y.depth - x.depth);
  if (!drawn.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text x="4" y="12" font-size="5" font-family="sans-serif">${esc(t('Nothing to draw yet.'))}</text></svg>`;
  const xs = drawn.flatMap((q) => q.pts.map((r) => r.x)),
    ys = drawn.flatMap((q) => q.pts.map((r) => r.y));
  const M = 4;
  const X0 = Math.min(...xs) - M,
    X1 = Math.max(...xs) + M,
    Ytop = Math.max(...ys) + M,
    Ybot = Math.min(0, ...ys) - M - 3;
  const fill = { wall: '#f7f5f0', roof: '#d9d1c4', part: '#ece8e0', glass: '#cfdde6' };
  // Creases: an edge drawn where the faces on its two sides turn (or where only one face has it), so a
  // flat wall shows no triangles and a window frame shows its outline.
  const ek = (a: V3, b: V3) => {
    const k = (q: V3) => `${Math.round(q[0] * 200)},${Math.round(q[1] * 200)},${Math.round(q[2] * 200)}`;
    const x = k(a),
      y = k(b);
    return x < y ? `${x}|${y}` : `${y}|${x}`;
  };
  const edges = new Map<string, V3[]>();
  for (const q of drawn) for (let j = 0; j < 3; j++) {
    const key = ek(q.p3[j]!, q.p3[(j + 1) % 3]!);
    const l = edges.get(key);
    if (l) l.push(q.n);
    else edges.set(key, [q.n]);
  }
  const crease = (a: V3, b: V3) => {
    const ns = edges.get(ek(a, b))!;
    return ns.length === 1 || ns.some((m) => m[0] * ns[0]![0] + m[1] * ns[0]![1] + m[2] * ns[0]![2] < 0.96);
  };
  // Each face filled, then its edges in the same colour (closes the hairlines between neighbours); the
  // outline of the whole drawing comes from the faces nearest the viewer drawn last.
  const body = drawn.map((q) => {
    const d = `M${q.pts.map((r) => `${r2(r.x)} ${r2(-r.y)}`).join('L')}Z`;
    const shade = q.kind === 'wall' ? Math.round(244 - 30 * (1 + q.facing)) : 0;
    const col = q.kind === 'wall' ? `rgb(${shade},${shade - 2},${shade - 7})` : fill[q.kind];
    const lines = [0, 1, 2].filter((j) => crease(q.p3[j]!, q.p3[(j + 1) % 3]!)).map((j) => `M${r2(q.pts[j]!.x)} ${r2(-q.pts[j]!.y)}L${r2(q.pts[(j + 1) % 3]!.x)} ${r2(-q.pts[(j + 1) % 3]!.y)}`);
    return `<path d="${d}" fill="${col}" stroke="${col}" stroke-width="0.02"/>${lines.length ? `<path d="${lines.join('')}" fill="none" stroke="#2a2a2a" stroke-width="${q.kind === 'wall' || q.kind === 'roof' ? 0.035 : 0.02}" stroke-linecap="round"/>` : ''}`;
  });
  const n2 = (v: number) => v.toFixed(2).replace('.', dec);
  const out = [
    ...body,
    // Ground line and level marks (+0,00 and every floor).
    `<line x1="${r2(X0)}" y1="0" x2="${r2(X1)}" y2="0" stroke="#111" stroke-width="0.1"/>`,
    ...[0, ...[...new Set(levels.map((l) => Math.round(l * 100) / 100))]].map((l) => `<line x1="${r2(X1 - M + 0.4)}" y1="${r2(-l)}" x2="${r2(X1 - 0.6)}" y2="${r2(-l)}" stroke="#555" stroke-width="0.03"/><text x="${r2(X1 - M + 0.5)}" y="${r2(-l - 0.15)}" font-size="0.45" font-family="sans-serif" fill="#333">${l >= 0 ? '+' : ''}${n2(l)}</text>`),
    `<g transform="translate(${r2(X0 + 1)} ${r2(-Ybot - 2)})"><rect width="10" height="0.4" fill="#111"/><rect x="5" width="5" height="0.4" fill="#fff" stroke="#111" stroke-width="0.05"/><text y="1.6" font-size="1" font-family="sans-serif">0</text><text x="9.4" y="1.6" font-size="1" font-family="sans-serif">10 m</text></g>`,
    `<text x="${r2(X1 - 1)}" y="${r2(-Ybot - 3)}" font-size="1.1" text-anchor="end" font-family="sans-serif" fill="#555">${esc(p.name)} · ${esc(t(ELEVATION_NAMES[side]))}</text>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(X0)} ${r2(-Ytop)} ${r2(X1 - X0)} ${r2(Ytop - Ybot)}" width="${Math.round((X1 - X0) * 20)}" height="${Math.round((Ytop - Ybot) * 20)}"><rect x="${r2(X0)}" y="${r2(-Ytop)}" width="${r2(X1 - X0)}" height="${r2(Ytop - Ybot)}" fill="#fff"/>${out.join('')}</svg>`;
}

export const ELEVATION_NAMES: Record<Side, string> = { front: 'Front elevation', right: 'Right elevation', back: 'Back elevation', left: 'Left elevation' };
