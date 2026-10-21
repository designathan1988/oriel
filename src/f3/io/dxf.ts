// DXF (ASCII, AC1009/R12) export and import of forma/3 plans (pure: no three).
//
// Source: Autodesk "DXF Reference" (group codes 0/1/2/6/8/10/20/30/62/66/70).
// The exported file keeps only what a CAD reader needs: an AC1009 HEADER with
// the extents, a LAYER table and an ENTITIES section of closed POLYLINEs
// (R12 has no LWPOLYLINE; the importer accepts POLYLINE, LWPOLYLINE and LINE).
//
// Plans are written in world meters with X east and Y = −Z of the scene, so the
// drawing reads as a plan seen from above (scene +Z points down the sheet).
// Volumes are drawn on a layer named after the building, the lots on 'LOTS'.
// Holes are not written: R12 has no nested polyline and a HATCH would be a
// different entity; an outline is enough for a plan reference.
import type { Building3, Project3, Vec2 } from '../model/schema';
import { oriented, sampleRing, signedArea2 } from '../model/plan';
import { toWorld } from '../model/ops';
import { building, levelsFor, planVertices, roofSpec, solid } from '../model/defaults';

export const LOTS_LAYER = 'LOTS';

export interface DxfPolyline {
  layer: string;
  points: [number, number][];
  closed: boolean;
}

/** Group value of a real number (DXF wants a decimal point). */
const num = (v: number): string => (Number.isFinite(v) ? v.toFixed(6) : '0.000000');

/**
 * DXF layer name: no `< > / \ " : ; ? * | = , ``, never empty, at most 31
 * characters, and never the reserved 'LOTS' layer.
 */
function layerName(name: string): string {
  const clean = name.replace(/[<>/\\":;?*|=,`]/g, '_').trim().slice(0, 31);
  const l = clean.length ? clean : 'BUILDING';
  return l.toUpperCase() === LOTS_LAYER ? `${l}_B` : l;
}

/** One closed POLYLINE with its VERTEX list and SEQEND. */
function writePolyline(g: (code: number, value: string | number) => void, layer: string, pts: [number, number][]): void {
  g(0, 'POLYLINE');
  g(8, layer);
  g(66, 1); // vertices follow
  g(70, 1); // closed
  g(10, 0);
  g(20, 0);
  g(30, 0); // unused start point
  for (const q of pts) {
    g(0, 'VERTEX');
    g(8, layer);
    g(10, q[0]);
    g(20, q[1]);
    g(30, 0);
  }
  g(0, 'SEQEND');
  g(8, layer);
}

/**
 * Plan of the whole project as DXF text: one closed POLYLINE per additive
 * volume (on a layer named after its building) and one per lot (layer 'LOTS').
 * `cutY`: a horizontal cut at that elevation (building frame, m) — only the
 * volumes covering it are written, which is what a floor plan drawing wants.
 */
export function planToDxf(p: Project3, opts: { cutY?: number } = {}): string {
  const lotRings: [number, number][][] = p.lots.map((l) => l.polygon.map((q): [number, number] => [q[0], -q[1]]));
  const bodies: { layer: string; pts: [number, number][] }[] = [];
  for (const b of p.buildings) {
    const layer = layerName(b.name);
    for (const s of b.solids) {
      if (s.op !== 'add' || s.hidden) continue;
      const cut = opts.cutY;
      if (cut !== undefined && !(s.base <= cut && cut < s.base + s.height)) continue;
      const pts = sampleRing(oriented(s.plan.outer, 1))
        .pts.map((q) => toWorld(b, q))
        .map((q): [number, number] => [q[0], -q[1]]);
      if (pts.length >= 3) bodies.push({ layer, pts });
    }
  }
  const layers: string[] = [];
  if (lotRings.length) layers.push(LOTS_LAYER);
  for (const r of bodies) if (!layers.includes(r.layer)) layers.push(r.layer);

  // Extents of the drawing (empty project: the origin).
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (q: [number, number]): void => {
    x0 = Math.min(x0, q[0]);
    y0 = Math.min(y0, q[1]);
    x1 = Math.max(x1, q[0]);
    y1 = Math.max(y1, q[1]);
  };
  for (const r of lotRings) r.forEach(grow);
  for (const r of bodies) r.pts.forEach(grow);
  if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 0;
    y1 = 0;
  }

  const out: string[] = [];
  const g = (code: number, value: string | number): void => {
    out.push(String(code));
    out.push(typeof value === 'number' ? num(value) : value);
  };

  // HEADER: only the version and the extents.
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSBASE');
  g(10, 0);
  g(20, 0);
  g(30, 0);
  g(9, '$EXTMIN');
  g(10, x0);
  g(20, y0);
  g(30, 0);
  g(9, '$EXTMAX');
  g(10, x1);
  g(20, y1);
  g(30, 0);
  g(0, 'ENDSEC');

  // TABLES: the layer table (color 8 for the lots, 7 for the buildings).
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, layers.length);
  for (const name of layers) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, name === LOTS_LAYER ? 8 : 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // ENTITIES.
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const r of lotRings) writePolyline(g, LOTS_LAYER, r);
  for (const r of bodies) writePolyline(g, r.layer, r.pts);
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}

interface Group {
  code: number;
  value: string;
}

/** (code, value) pairs; blank code lines are skipped so a trailing empty line is harmless. */
function readGroups(text: string): Group[] {
  const lines = text.split(/\r?\n/);
  const out: Group[] = [];
  let i = 0;
  while (i < lines.length) {
    const codeLine = lines[i]!;
    if (codeLine.trim() === '') {
      i++;
      continue;
    }
    const code = Number.parseInt(codeLine.trim(), 10);
    if (!Number.isFinite(code)) {
      i++;
      continue;
    }
    out.push({ code, value: (lines[i + 1] ?? '').trim() });
    i += 2;
  }
  return out;
}

function str(body: Group[], code: number): string {
  const hit = body.find((x) => x.code === code);
  return hit ? hit.value : '';
}

function int(body: Group[], code: number): number {
  const hit = body.find((x) => x.code === code);
  const n = hit ? Number.parseInt(hit.value, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function flt(body: Group[], code: number): number | undefined {
  const hit = body.find((x) => x.code === code);
  if (!hit) return undefined;
  const n = Number.parseFloat(hit.value);
  return Number.isFinite(n) ? n : undefined;
}

/** LWPOLYLINE vertices: a code 10 opens a vertex, its code 20 sets the Y (bulge 42 is ignored). */
function lwPairs(body: Group[]): [number, number][] {
  const pts: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (const gp of body) {
    if (gp.code === 10) {
      cur = [Number.parseFloat(gp.value), 0];
      pts.push(cur);
    } else if (gp.code === 20 && cur) {
      cur[1] = Number.parseFloat(gp.value);
      cur = null;
    }
  }
  return pts.filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
}

const samePoint = (a: [number, number], b: [number, number]): boolean => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;

/** Chains LINE entities whose ends meet (tolerance 1 mm) into polylines. */
function chainLines(segs: { layer: string; a: [number, number]; b: [number, number] }[]): DxfPolyline[] {
  const used = segs.map(() => false);
  const out: DxfPolyline[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segs[i]!;
    const pts: [number, number][] = [s.a, s.b];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const t = segs[j]!;
        const last = pts[pts.length - 1]!;
        const first = pts[0]!;
        if (samePoint(last, t.a)) pts.push(t.b);
        else if (samePoint(last, t.b)) pts.push(t.a);
        else if (samePoint(first, t.b)) pts.unshift(t.a);
        else if (samePoint(first, t.a)) pts.unshift(t.b);
        else continue;
        used[j] = true;
        grew = true;
      }
    }
    const closed = pts.length > 2 && samePoint(pts[0]!, pts[pts.length - 1]!);
    if (closed) pts.pop();
    out.push({ layer: s.layer, points: pts, closed });
  }
  return out;
}

/**
 * Tolerant DXF reader: LWPOLYLINE (codes 10/20, flag 70 bit 1 = closed, bulge 42
 * ignored so the vertices are kept as drawn), POLYLINE/VERTEX/SEQEND and LINE
 * entities chained into polylines when their ends meet. Everything else is
 * skipped, so a full drawing can be fed in.
 */
export function dxfToPolylines(text: string): DxfPolyline[] {
  const g = readGroups(text);
  const out: DxfPolyline[] = [];
  const segs: { layer: string; a: [number, number]; b: [number, number] }[] = [];
  const bodyOf = (from: number): { body: Group[]; next: number } => {
    let j = from;
    const body: Group[] = [];
    while (j < g.length && g[j]!.code !== 0) {
      body.push(g[j]!);
      j++;
    }
    return { body, next: j };
  };
  let i = 0;
  while (i < g.length) {
    const cur = g[i]!;
    if (cur.code !== 0) {
      i++;
      continue;
    }
    const kind = cur.value.toUpperCase();
    i++;
    const head = bodyOf(i);
    i = head.next;
    if (kind === 'LWPOLYLINE') {
      const layer = str(head.body, 8) || '0';
      const closed = (int(head.body, 70) & 1) !== 0;
      const pts = lwPairs(head.body);
      if (pts.length >= 2) out.push({ layer, points: pts, closed });
    } else if (kind === 'POLYLINE') {
      const layer = str(head.body, 8) || '0';
      const closed = (int(head.body, 70) & 1) !== 0;
      const pts: [number, number][] = [];
      while (i < g.length && g[i]!.code === 0 && g[i]!.value.toUpperCase() === 'VERTEX') {
        const vb = bodyOf(i + 1);
        i = vb.next;
        const x = flt(vb.body, 10);
        const y = flt(vb.body, 20);
        if (x !== undefined && y !== undefined) pts.push([x, y]);
      }
      if (i < g.length && g[i]!.code === 0 && g[i]!.value.toUpperCase() === 'SEQEND') i = bodyOf(i + 1).next;
      if (pts.length >= 2) out.push({ layer, points: pts, closed });
    } else if (kind === 'LINE') {
      const layer = str(head.body, 8) || '0';
      const x1 = flt(head.body, 10);
      const y1 = flt(head.body, 20);
      const x2 = flt(head.body, 11);
      const y2 = flt(head.body, 21);
      if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) segs.push({ layer, a: [x1, y1], b: [x2, y2] });
    }
  }
  out.push(...chainLines(segs));
  return out;
}

/** Area centroid of a polygon (vertex average when the area is ~0). */
function ringCentroid(ring: Vec2[]): Vec2 {
  const a = signedArea2(ring);
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let z = 0;
    for (const q of ring) {
      x += q[0];
      z += q[1];
    }
    return [x / ring.length, z / ring.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * cross;
    cz += (p[1] + q[1]) * cross;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

/**
 * Closed polylines (area ≥ 1 m²) become buildings: one volume per outline, flat
 * roof, plan local to the polygon centroid (Y flipped back to the scene Z), the
 * ring counterclockwise, the building named after its layer. The 'LOTS' layer is
 * skipped: it is the reference of the drawing, not a building.
 */
export function polylinesToBuildings(polys: (DxfPolyline & { bulges?: number[] })[], opts: { height: number; levels: number }): Building3[] {
  const out: Building3[] = [];
  // A closed ring inside a bigger one of the same layer, turning the other way, is its hole (a courtyard).
  const area = (pl: DxfPolyline) => Math.abs(signedArea2(pl.points));
  const inRing = (q: [number, number], r: [number, number][]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i]![1] > q[1] !== r[j]![1] > q[1] && q[0] < ((r[j]![0] - r[i]![0]) * (q[1] - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) c = !c;
    return c;
  };
  const closedOnes = polys.filter((pl) => pl.closed && pl.points.length >= 3 && pl.layer.toUpperCase() !== LOTS_LAYER && area(pl) >= 1);
  const holeOf = new Map<DxfPolyline, DxfPolyline>();
  for (const pl of closedOnes) {
    const probe = pl.points[0]!;
    // …drawn turning the other way (CAD convention for a hole; a second volume inside, like a tower on a
    // house, turns the same way and stays a building of its own).
    const sign = Math.sign(signedArea2(pl.points));
    const host = closedOnes.filter((o) => o !== pl && o.layer === pl.layer && area(o) > area(pl) && Math.sign(signedArea2(o.points)) === -sign && inRing(probe, o.points)).sort((a, b) => area(a) - area(b))[0];
    if (host && !holeOf.has(host)) holeOf.set(pl, host);
  }
  for (const pl of polys) {
    if (!pl.closed || pl.points.length < 3) continue;
    if (pl.layer.toUpperCase() === LOTS_LAYER) continue;
    if (holeOf.has(pl)) continue;
    const pts: Vec2[] = pl.points.map(([x, y]) => [x, -y]);
    if (Math.abs(signedArea2(pts)) < 1) continue;
    const c = ringCentroid(pts);
    // Arcs of the drawing become arcs of the plan (Y flipped back: the bulge changes sign); the ring
    // is turned counterclockwise keeping each arc on its side (model/plan.ts oriented).
    const verts = oriented(planVertices(pts.map((q): Vec2 => [q[0] - c[0], q[1] - c[1]]), (i) => (pl.bulges?.[i] ? { bulge: -pl.bulges[i]! } : {})), 1);
    const name = pl.layer || 'Building';
    const b = building({ name, position: [c[0], c[1]] });
    b.levels = levelsFor(Math.max(1, Math.round(opts.levels)));
    b.solids = [
      solid({
        name,
        plan: {
          outer: verts,
          holes: [...holeOf.entries()]
            .filter(([, host]) => host === pl)
            .map(([h]) => oriented(planVertices(h.points.map(([x, y]): Vec2 => [x - c[0], -y - c[1]]), (i) => ((h as { bulges?: number[] }).bulges?.[i] ? { bulge: -(h as { bulges?: number[] }).bulges![i]! } : {})), -1)),
        },
        height: opts.height,
        roof: roofSpec('flat'),
      }),
    ];
    out.push(b);
  }
  return out;
}
