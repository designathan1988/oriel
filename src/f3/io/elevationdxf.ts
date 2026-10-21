// The four elevations as a CAD drawing (DXF, metres), side by side: only the lines that are seen. The
// SVG paints near faces over far ones, which a CAD file cannot do, so the hidden lines are removed with a
// depth buffer (the classic z-buffer test): every face is rasterized at 5 cm keeping the nearest depth,
// and each crease is kept where it is not behind that depth. Layers: A-ELEV (outlines), A-ELEV-GLAZ
// (glass), A-ELEV-GRND (ground line), A-ANNO-TEXT (titles, levels). Written with @tarikjabiri/dxf.
import { DxfWriter, Units, point3d } from '@tarikjabiri/dxf';
import type { Project3 } from '../model/schema';
import { optionHidden } from '../model/layers';
import { creaseTest, elevationFaces, ELEVATION_NAMES, type ElevationFace, type Side } from './elevationsvg';

const CELL = 0.05;

type Seg = [number, number, number, number];

/** The visible parts of the creases of a side (drawing coordinates, metres), split glass / the rest. */
export function visibleElevationLines(p: Project3, side: Side): { lines: Seg[]; glass: Seg[]; box: [number, number, number, number] } | null {
  const { drawn } = elevationFaces(p, side);
  if (!drawn.length) return null;
  const xs = drawn.flatMap((f) => f.pts.map((q) => q.x)),
    ys = drawn.flatMap((f) => f.pts.map((q) => q.y));
  const x0 = Math.min(...xs),
    y0 = Math.min(0, ...ys),
    x1 = Math.max(...xs),
    y1 = Math.max(...ys);
  // At most 4000 cells a side: a long street front is drawn coarser rather than run out of memory.
  const cell = Math.max(CELL, (x1 - x0) / 4000, (y1 - y0) / 4000);
  const W = Math.ceil((x1 - x0) / cell) + 1,
    H = Math.ceil((y1 - y0) / cell) + 1;
  const zb = new Float32Array(W * H).fill(Infinity);
  const raster = (f: ElevationFace) => {
    const [a, b, c] = f.pts as [ElevationFace['pts'][0], ElevationFace['pts'][0], ElevationFace['pts'][0]];
    const ax = (a.x - x0) / cell, ay = (a.y - y0) / cell, bx = (b.x - x0) / cell, by = (b.y - y0) / cell, cx = (c.x - x0) / cell, cy = (c.y - y0) / cell;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) return;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / den;
        const l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / den;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-3 || l2 < -1e-3 || l3 < -1e-3) continue;
        const d = l1 * a.d + l2 * b.d + l3 * c.d;
        const k = j * W + i;
        if (d < zb[k]!) zb[k] = d;
      }
  };
  for (const f of drawn) raster(f);
  const crease = creaseTest(drawn);
  const lines: Seg[] = [],
    glass: Seg[] = [];
  const seen = new Set<string>();
  // A point of a line is hidden when something is clearly nearer all around it (8 cm, on every cell of its
  // 3×3 neighbourhood): a receding roof slope changes its own depth from cell to cell, a face in front
  // covers the whole neighbourhood.
  const visible = (x: number, y: number, d: number) => {
    const i = Math.round((x - x0) / cell),
      j = Math.round((y - y0) / cell);
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = i + di,
          jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        if (zb[jj * W + ii]! >= d - 0.08) return true;
      }
    return false;
  };
  for (const f of drawn)
    for (let e = 0; e < 3; e++) {
      const A3 = f.p3[e]!,
        B3 = f.p3[(e + 1) % 3]!;
      if (!crease(A3, B3)) continue;
      const a = f.pts[e]!,
        b = f.pts[(e + 1) % 3]!;
      const key = [a.x, a.y, b.x, b.y].map((v) => Math.round(v * 100)).join(',');
      const rev = [b.x, b.y, a.x, a.y].map((v) => Math.round(v * 100)).join(',');
      if (seen.has(key) || seen.has(rev)) continue;
      seen.add(key);
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
      let start = -1;
      const out = f.kind === 'glass' ? glass : lines;
      const at = (k: number) => [a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n] as const;
      for (let k = 0; k <= n; k++) {
        const [x, y] = at(k);
        const v = visible(x, y, a.d + ((b.d - a.d) * k) / n);
        if (v && start < 0) start = k;
        if ((!v || k === n) && start >= 0) {
          const end = v ? k : k - 1;
          if (end > start) out.push([...at(start), ...at(end)]);
          start = -1;
        }
      }
    }
  return { lines, glass, box: [x0, y0, x1, y1] };
}

/** The four elevations side by side (a 10 m gap), each with its ground line, levels and title. */
export function elevationsDxf(p: Project3, dec = '.', t: (s: string) => string = (x) => x): string | null {
  const dxf = new DxfWriter();
  dxf.setUnits(Units.Meters);
  for (const [n, c] of [['A-ELEV', 7], ['A-ELEV-GLAZ', 5], ['A-ELEV-GRND', 8], ['A-ANNO-TEXT', 7]] as const) dxf.addLayer(n, c);
  let dx = 0,
    any = false;
  const levels = [...new Set(p.buildings.filter((b) => !b.hidden && !optionHidden(p, b)).flatMap((b) => b.levels.map((l) => Math.round((l.elevation + (b.elevation ?? 0)) * 100) / 100)))].sort((a, b) => a - b);
  for (const side of Object.keys(ELEVATION_NAMES) as Side[]) {
    const v = visibleElevationLines(p, side);
    if (!v) continue;
    any = true;
    const [x0, , x1] = v.box;
    const ox = dx - x0;
    const L = (s: Seg, layer: string) => dxf.addLine(point3d(s[0] + ox, s[1], 0), point3d(s[2] + ox, s[3], 0), { layerName: layer });
    for (const s of v.lines) L(s, 'A-ELEV');
    for (const s of v.glass) L(s, 'A-ELEV-GLAZ');
    L([x0 - 2, 0, x1 + 2, 0], 'A-ELEV-GRND');
    for (const l of levels) dxf.addText(point3d(x1 + 2.5 + ox, l + 0.05, 0), 0.25, `${l >= 0 ? '+' : ''}${l.toFixed(2).replace('.', dec)}`, { layerName: 'A-ANNO-TEXT' });
    dxf.addText(point3d(x0 + ox, -1.5, 0), 0.45, t(ELEVATION_NAMES[side]), { layerName: 'A-ANNO-TEXT' });
    dx += x1 - x0 + 10;
  }
  return any ? dxf.stringify() : null;
}
