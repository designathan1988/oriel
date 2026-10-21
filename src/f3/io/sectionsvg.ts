// SVG section of a forma/3 project: a vertical cut along the world X axis at z = `at`, seen from the
// south (+z toward the viewer): X to the right, height up. Each building's evaluated shell (walls,
// floors, roofs, the same geometry as the view) is cut by the plane triangle by triangle; the cut edges
// are drawn as heavy lines, with the ground line, the floor levels of the buildings cut, their names,
// a 10 m scale bar and the cut position. Needs the loaded kernel (the shells are evaluated). No three.
import type { Project3 } from '../model/schema';
import { evaluateBuilding } from '../eval/evaluate';
import { terrainField } from '../model/terrain';
import { offsetRing, oriented, sampleRing } from '../model/plan';
import { kernel } from '../kernel/kernel';

/**
 * The cut as closed polygons (Manifold slice: https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html):
 * the shell made solid again, placed in the world, turned so the plane z = at is its XY plane, sliced.
 * Null when the shell is not a closed solid (then the triangle cut below is used).
 */
function slicePolys(pos: Float32Array, idx: Uint32Array, m: number[], at: number): [number, number][][] | null {
  const k = kernel();
  const kept: { delete(): void }[] = [];
  try {
    const mesh = new k.Mesh({ numProp: 3, vertProperties: new Float32Array(pos), triVerts: new Uint32Array(idx) });
    mesh.merge();
    const solid = k.Manifold.ofMesh(mesh);
    kept.push(solid);
    // World placement (column-major), then the world z axis onto the slicing axis: (x, y, z) → (x, y, z − at).
    const placed = solid.transform(m as never).translate([0, 0, -at]);
    kept.push(placed);
    const cs = placed.slice(0);
    kept.push(cs);
    const polys = cs.toPolygons().map((p) => p.map((q) => [q[0], q[1]] as [number, number]));
    return polys.length ? polys : [];
  } catch {
    return null;
  } finally {
    for (const x of kept) x.delete();
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Seg = [number, number, number, number];

/** Segments where the plane z = at cuts the triangles (world x, y). */
function cutTriangles(pos: Float32Array | number[], idx: Uint32Array | number[], toWorld: (x: number, y: number, z: number) => [number, number, number], at: number): Seg[] {
  const out: Seg[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const p = [0, 1, 2].map((j) => toWorld(pos[idx[t + j]! * 3]!, pos[idx[t + j]! * 3 + 1]!, pos[idx[t + j]! * 3 + 2]!));
    const hits: [number, number][] = [];
    for (let j = 0; j < 3; j++) {
      const a = p[j]!,
        b = p[(j + 1) % 3]!;
      const da = a[2] - at,
        db = b[2] - at;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const k = da / (da - db);
        hits.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      }
    }
    if (hits.length === 2) out.push([hits[0]![0], hits[0]![1], hits[1]![0], hits[1]![1]]);
  }
  return out;
}

/** The section drawing (SVG text); `at` is the world z of the cut (default: the middle of the buildings). */
export function sectionSvg(p: Project3, at?: number, dec = '.', t: (s: string) => string = (x) => x): string {
  const zs = p.buildings.map((b) => b.position[1]);
  const z0 = at ?? (zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0);
  // Each building evaluated once (hollow: walls and slabs with the rooms between them).
  const evs = new Map<string, ReturnType<typeof evaluateBuilding>>();
  for (const b of p.buildings) {
    if (b.hidden) continue;
    try {
      evs.set(b.id, evaluateBuilding(b, { hidden: () => false, hollow: true }, p));
    } catch {
      /* left out of the section */
    }
  }
  const toW = (b: Project3['buildings'][number]) => {
    const a = (b.rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const e = b.elevation ?? 0;
    return (x: number, y: number, z: number): [number, number, number] => [b.position[0] + x * c + z * s, y + e, b.position[1] - x * s + z * c];
  };
  // Where to cut, near the place asked: the line that crosses the most wall height (an architect cuts
  // through the walls, not along a row of windows and doors that would leave the floors floating).
  const wallHeight = (z: number) => {
    let h = 0;
    for (const b of p.buildings) {
      const ev = evs.get(b.id);
      if (!ev) continue;
      for (const q of cutTriangles(ev.shell.positions, ev.shell.indices, toW(b), z)) if (Math.abs(q[3] - q[1]) > Math.abs(q[2] - q[0])) h += Math.abs(q[3] - q[1]);
    }
    return h;
  };
  let zc = z0,
    best = wallHeight(z0);
  for (const d of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
    const h = wallHeight(z0 + d);
    if (h > best * 1.15) {
      best = h;
      zc = z0 + d;
    }
  }
  const segs: Seg[] = [];
  const fills: [number, number][][][] = [];
  /** Boundaries between the layers of typed walls, where the poché is (thin light lines over it). */
  const layerSegs: Seg[] = [];
  const labels: { x: number; y: number; name: string }[] = [];
  const levels: { x0: number; x1: number; y: number }[] = [];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    const a = (b.rotation * Math.PI) / 180,
      c = Math.cos(a),
      s = Math.sin(a);
    const e = b.elevation ?? 0;
    const W = (x: number, y: number, z: number): [number, number, number] => [b.position[0] + x * c + z * s, y + e, b.position[1] - x * s + z * c];
    const ev = evs.get(b.id);
    if (!ev) continue;
    const mine = cutTriangles(ev.shell.positions, ev.shell.indices, W, zc);
    if (!mine.length) continue;
    segs.push(...mine);
    // The cut walls, slabs and roofs filled (poché) when the shell closes into a solid.
    const polys = slicePolys(ev.shell.positions, ev.shell.indices, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, b.position[0], e, b.position[1], 1], zc);
    // Poché only when the slice reads as walls and slabs: when its filled area is most of the building's
    // outline, the rooms came out solid (an opening cut by the plane joins a room to the outside) and the
    // drawing keeps the cut lines alone rather than a black block.
    if (polys?.length) {
      const area = (r: [number, number][]) => Math.abs(r.reduce((a, q, i) => a + q[0] * r[(i + 1) % r.length]![1] - r[(i + 1) % r.length]![0] * q[1], 0)) / 2;
      const sorted = polys.map(area).sort((x, y) => y - x);
      const outer = sorted[0] ?? 0;
      const filled = outer - sorted.slice(1).reduce((a, v) => a + v, 0);
      if (outer > 0 && filled / outer < 0.55) {
        fills.push(polys);
        // Inside the poché (even-odd over its rings): where a layer line is drawn.
        const inPoche = (x: number, y: number) => {
          let n = false;
          for (const r of polys)
            for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
              const [xi, yi] = r[i]!,
                [xj, yj] = r[j]!;
              if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n = !n;
            }
          return n;
        };
        for (const so of b.solids) {
          if (so.op !== 'add' || so.hidden || !so.wallLayers || so.wallLayers.length < 2) continue;
          const base = sampleRing(oriented(so.plan.outer, 1)).pts;
          let at = 0;
          for (const l of so.wallLayers.slice(0, -1)) {
            at += l.thickness;
            const ring = offsetRing(base, base.map(() => at)).map((q) => W(q[0], 0, q[1]));
            for (let i = 0; i < ring.length; i++) {
              const A = ring[i]!,
                B = ring[(i + 1) % ring.length]!;
              if ((A[2] - zc) * (B[2] - zc) > 0 || A[2] === B[2]) continue;
              const x = A[0] + ((B[0] - A[0]) * (zc - A[2])) / (B[2] - A[2]);
              // The vertical line through the wall, kept where the wall is cut solid (not across an opening).
              let from = -1;
              const y0 = so.base + e,
                y1 = so.base + so.height + e;
              const n = Math.max(2, Math.ceil((y1 - y0) / 0.05));
              for (let k = 0; k <= n; k++) {
                const y = y0 + ((y1 - y0) * k) / n;
                const inside = inPoche(x, y);
                if (inside && from < 0) from = y;
                if ((!inside || k === n) && from >= 0) {
                  if (y - from > 0.1) layerSegs.push([x, from, x, inside ? y : y - (y1 - y0) / n]);
                  from = -1;
                }
              }
            }
          }
        }
      }
    }
    const xs = mine.flatMap((q) => [q[0], q[2]]),
      ys = mine.flatMap((q) => [q[1], q[3]]);
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs);
    const top = Math.max(...ys);
    labels.push({ x: (x0 + x1) / 2, y: top, name: b.name });
    // The floor levels inside what the plane cuts (a tapered tower cut near its edge stops low).
    for (const l of b.levels) if (l.elevation > 0.05 && l.elevation + e < top - 0.3) levels.push({ x0, x1, y: l.elevation + e });
  }
  if (!segs.length) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><text x="4" y="12" font-size="5" font-family="sans-serif">The cut at z = ${r2(zc)} m crosses no building.</text></svg>`;
  const xs = segs.flatMap((q) => [q[0], q[2]]),
    ys = segs.flatMap((q) => [q[1], q[3]]);
  const M = 5;
  const X0 = Math.min(...xs) - M,
    X1 = Math.max(...xs) + M;
  // The ground cut by the plane: the terrain's profile where there is one (a point every 25 cm), else flat.
  const field = terrainField(p);
  const profile: [number, number][] = field ? Array.from({ length: Math.ceil((X1 - X0) / 0.25) + 1 }, (_, i) => Math.min(X1, X0 + i * 0.25)).map((x) => [x, field.at(x, zc)]) : [[X0, 0], [X1, 0]];
  const gy = profile.map((q) => q[1]);
  const Ytop = Math.max(...ys, ...gy) + M + 3,
    Ybot = Math.min(0, ...ys, ...gy) - M - 4;
  // Sheet coordinates: x as is, height up → y down (−y).
  const line = (q: Seg, w: number, col = '#111', dash = '') => `<line x1="${r2(q[0])}" y1="${r2(-q[1])}" x2="${r2(q[2])}" y2="${r2(-q[3])}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const body = [
    `<polyline points="${profile.map((q) => `${r2(q[0])},${r2(-q[1])}`).join(' ')}" fill="none" stroke="#555" stroke-width="0.12" stroke-linejoin="round"/>`,
    ...levels.map((l) => line([l.x0 - 1, l.y, l.x1 + 1, l.y], 0.04, '#8a8a8a', '0.6 0.4')),
    // Level marks (ABNT: the elevation of each floor, the ground at +0,00).
    ...[{ x0: Math.min(...levels.map((l) => l.x0), X0 + M), y: 0 }, ...levels].map((l) => `<text x="${r2(l.x0 - 1.4)}" y="${r2(-l.y - 0.25)}" font-size="0.7" text-anchor="end" font-family="sans-serif" fill="#333">${l.y >= 0 ? '+' : ''}${l.y.toFixed(2).replace('.', dec)}</text>`),
    // Filled cut (one path per building, even-odd for the holes), then the cut lines over it.
    ...fills.map((polys) => `<path d="${polys.map((r) => `M${r.map((q) => `${r2(q[0])} ${r2(-q[1])}`).join('L')}Z`).join('')}" fill="#3a3d42" fill-rule="evenodd" stroke="none"/>`),
    ...layerSegs.map((q) => line(q, 0.025, '#9d978c')),
    ...segs.map((q) => line(q, 0.08)),
    ...labels.map((l) => `<text x="${r2(l.x)}" y="${r2(-l.y - 1.2)}" font-size="1.4" text-anchor="middle" font-family="sans-serif" fill="#333">${esc(l.name)}</text>`),
    // 10 m scale bar and the cut position.
    `<g transform="translate(${r2(X0 + 1)} ${r2(-Ybot - 2)})"><rect width="10" height="0.4" fill="#111"/><rect x="5" width="5" height="0.4" fill="#fff" stroke="#111" stroke-width="0.05"/><text y="1.6" font-size="1" font-family="sans-serif">0</text><text x="9.4" y="1.6" font-size="1" font-family="sans-serif">10 m</text></g>`,
    `<text x="${r2(X1 - 1)}" y="${r2(-Ybot - 3)}" font-size="1.1" text-anchor="end" font-family="sans-serif" fill="#555">${esc(p.name)} · ${esc(t('Section'))}</text>`,
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(X0)} ${r2(-Ytop)} ${r2(X1 - X0)} ${r2(Ytop - Ybot)}" width="${Math.round((X1 - X0) * 20)}" height="${Math.round((Ytop - Ybot) * 20)}"><rect x="${r2(X0)}" y="${r2(-Ytop)}" width="${r2(X1 - X0)}" height="${r2(Ytop - Ybot)}" fill="#fff"/>${body.join('')}</svg>`;
}
