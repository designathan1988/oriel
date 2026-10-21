// Plan symbols of the furniture and the stairs: what a floor plan shows of them seen from above, in
// thin lines, as the drawing rules for architecture ask (NBR 6492): a bed with its pillows and the fold
// of the sheet, a sofa with its back and arms, the bowl of a toilet, the burners of a stove. Whatever
// stands above the cut plane (a wall cabinet) is drawn dashed. A stair is drawn as far as the cut, with
// the break line across it, the rest dashed, and the walking line with the arrow pointing up. Each
// symbol is drawn in the part's own frame (x across, z forward, the back of the furniture at −z) and
// placed with its frame. Pure.
import type { Vec2 } from '../model/schema';
import type { Placement } from './facade';
import { num, str, bool } from '../families/family';
import { stairCount } from '../families/stairs';

export interface PlanStroke {
  pts: Vec2[];
  closed: boolean;
  /** Above the cut plane (drawn dashed). */
  above: boolean;
}

export interface PlanSymbol {
  strokes: PlanStroke[];
  /** Where a text goes ("UP" of a stair) in the plan frame. */
  label?: { at: Vec2; text: string };
}

const rect = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];
const ellipse = (cx: number, cz: number, rx: number, rz: number, n = 24): Vec2[] => Array.from({ length: n }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / n), cz + rz * Math.sin((2 * Math.PI * i) / n)] as Vec2);

/** Symbols in the local frame, before the frame is applied. */
type Local = { pts: Vec2[]; closed: boolean; above?: boolean }[];

function furniture(id: string, p: Placement['params'], size: [number, number, number]): Local {
  const [w, , d] = size;
  const x0 = -w / 2,
    x1 = w / 2,
    z0 = -d / 2,
    z1 = d / 2;
  const box: Local = [{ pts: rect(x0, z0, x1, z1), closed: true }];
  const line = (a: Vec2, b: Vec2) => ({ pts: [a, b], closed: false });
  switch (id) {
    case 'bed': {
      const L = num(p, 'length');
      const out: Local = [...box];
      const head = z0 + (bool(p, 'headboard') ? 0.1 : 0);
      if (bool(p, 'headboard')) out.push(line([x0, head], [x1, head]));
      const n = w > 1.2 ? 2 : 1;
      const pw = (w - 0.14) / n;
      for (let i = 0; i < n; i++) {
        const cx = x0 + 0.07 + (i + 0.5) * pw;
        out.push({ pts: rect(cx - pw / 2 + 0.03, head + 0.13, cx + pw / 2 - 0.03, head + 0.59), closed: true });
      }
      // The fold of the duvet.
      const fold = head + L * 0.3;
      out.push(line([x0, fold], [x1, fold]), line([x0, fold + 0.24], [x1, fold + 0.24]));
      return out;
    }
    case 'sofa':
    case 'armchair': {
      const arm = str(p, 'arms') === 'none' ? 0 : Math.min(0.2, w * 0.12);
      const back = Math.min(0.22, d * 0.25);
      const out: Local = [...box, line([x0 + arm, z0 + back], [x1 - arm, z0 + back])];
      if (arm) out.push(line([x0 + arm, z0 + back], [x0 + arm, z1]), line([x1 - arm, z0 + back], [x1 - arm, z1]));
      const seats = id === 'sofa' ? Math.max(1, Math.min(Math.round(num(p, 'seats')), Math.floor(w / 0.6))) : 1;
      for (let i = 1; i < seats; i++) {
        const x = x0 + arm + ((w - 2 * arm) * i) / seats;
        out.push(line([x, z0 + back], [x, z1]));
      }
      return out;
    }
    case 'dining-table':
      return str(p, 'shape') === 'round' ? [{ pts: ellipse(0, 0, w / 2, w / 2, 40), closed: true }] : box;
    case 'chair':
    case 'office-chair':
      return [...box, line([x0, z0 + 0.08], [x1, z0 + 0.08])];
    case 'kitchen-counter': {
      const out: Local = [...box, line([x0, z1 - 0.03], [x1, z1 - 0.03])];
      if (bool(p, 'sink')) out.push({ pts: rect(-0.25, z0 + 0.1, 0.25, z1 - 0.12), closed: true }, { pts: ellipse(0, z0 + 0.2, 0.025, 0.025, 10), closed: true });
      return out;
    }
    case 'wardrobe':
      // The hanging rail along the middle, and the doors on the front.
      return [...box, line([x0 + 0.05, 0], [x1 - 0.05, 0]), line([x0, z1 - 0.03], [x1, z1 - 0.03])];
    case 'bookshelf':
    case 'tv-unit':
    case 'desk':
      return box;
    case 'toilet': {
      const tank = 0.18;
      return [
        { pts: rect(-w * 0.4, z0, w * 0.4, z0 + tank), closed: true },
        { pts: ellipse(0, z0 + tank + (d - tank) / 2, w / 2 - 0.01, (d - tank) / 2), closed: true },
        { pts: ellipse(0, z0 + tank + (d - tank) / 2 + 0.02, w / 2 - 0.07, (d - tank) / 2 - 0.08), closed: true },
      ];
    }
    case 'sink':
      return [...box, { pts: ellipse(0, 0.03, w / 2 - 0.08, d / 2 - 0.1), closed: true }, { pts: ellipse(0, z0 + 0.07, 0.02, 0.02, 10), closed: true }];
    case 'bathtub':
      return [...box, { pts: ellipse(0, 0, w / 2 - 0.08, d / 2 - 0.08, 36), closed: true }];
    case 'shower':
      return [...box, line([x0, z0], [x1, z1]), line([x1, z0], [x0, z1]), { pts: ellipse(0, 0, 0.05, 0.05, 12), closed: true }];
    case 'fridge':
      return [...box, line([x0, z1 - 0.06], [x1, z1 - 0.06])];
    case 'stove': {
      const out: Local = [...box];
      const r = Math.min(w, d) * 0.14;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ pts: ellipse(sx * w * 0.24, sz * d * 0.22, r, r, 18), closed: true });
      return out;
    }
    default:
      return box;
  }
}

/**
 * A straight flight of `n` treads `g` deep and `w` wide from z = z0 toward +z (x centred on cx): the
 * treads up to the step at the cut height solid, the rest dashed, the break line between them.
 */
function flight(out: Local, n: number, g: number, w: number, cx: number, z0: number, rise: number, y0: number, cut: number): number {
  const x0 = cx - w / 2,
    x1 = cx + w / 2;
  // The tread whose riser passes the cut: there the stair is broken.
  const br = Math.max(0, Math.min(n, Math.floor((cut - y0) / rise)));
  out.push({ pts: [[x0, z0], [x0, z0 + n * g]], closed: false, above: br === 0 });
  out.push({ pts: [[x1, z0], [x1, z0 + n * g]], closed: false, above: br === 0 });
  for (let i = 0; i <= n; i++) out.push({ pts: [[x0, z0 + i * g], [x1, z0 + i * g]], closed: false, above: i > br });
  if (br > 0 && br < n) {
    const z = z0 + br * g;
    out.push({ pts: [[x0, z + g * 0.8], [cx - w * 0.05, z + g * 0.8], [cx, z + g * 0.3], [cx + w * 0.05, z + g * 1.3], [x1, z + g * 0.8]], closed: false });
  }
  return br;
}

function stair(p: Placement['params'], cutY: number, baseY: number): { local: Local; walk: Vec2[] } {
  const rise = num(p, 'rise'),
    w = num(p, 'width'),
    g = num(p, 'going');
  const n = stairCount(rise, num(p, 'maxRiser'));
  const r = rise / n;
  const cut = cutY - baseY;
  const out: Local = [];
  const shape = str(p, 'shape');
  if (shape === 'spiral') {
    const R = w + 0.15;
    const turn = Math.min(360, Math.max(240, n * 22));
    out.push({ pts: ellipse(0, 0, R, R, 48), closed: true }, { pts: ellipse(0, 0, 0.09, 0.09, 12), closed: true });
    for (let i = 0; i <= n; i++) {
      const a = (-(turn * i) / n) * (Math.PI / 180);
      out.push({ pts: [[Math.cos(a) * 0.09, Math.sin(a) * 0.09], [Math.cos(a) * R, Math.sin(a) * R]], closed: false, above: i * r > cut });
    }
    const walk: Vec2[] = Array.from({ length: 13 }, (_, i) => {
      const a = (-(turn * i) / 12) * (Math.PI / 180);
      return [Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6] as Vec2;
    });
    return { local: out, walk };
  }
  if (shape === 'straight') {
    flight(out, n, g, w, 0, 0, r, 0, cut);
    return { local: out, walk: [[0, 0], [0, n * g]] };
  }
  const n1 = Math.ceil(n / 2),
    n2 = n - n1;
  const y1 = n1 * r;
  flight(out, n1, g, w, 0, 0, r, 0, cut);
  const landZ = n1 * g;
  const landAbove = y1 > cut;
  if (shape === 'L') {
    out.push({ pts: rect(-w / 2, landZ, w / 2, landZ + w), closed: true, above: landAbove });
    // Second flight toward +x from the landing: the same flight turned a quarter.
    const second: Local = [];
    flight(second, n2, g, w, 0, 0, r, y1, cut);
    for (const s of second) out.push({ ...s, pts: s.pts.map(([x, z]) => [w / 2 + z, landZ + w / 2 - x] as Vec2) });
    return { local: out, walk: [[0, 0], [0, landZ + w / 2], [w / 2 + n2 * g, landZ + w / 2]] };
  }
  // U: the landing across both flights, the second one coming back beside the first.
  const cx2 = w + 0.1;
  out.push({ pts: rect(-w / 2, landZ, cx2 + w / 2, landZ + w), closed: true, above: landAbove });
  const second: Local = [];
  flight(second, n2, g, w, 0, 0, r, y1, cut);
  for (const s of second) out.push({ ...s, pts: s.pts.map(([x, z]) => [cx2 - x, landZ - z] as Vec2) });
  return { local: out, walk: [[0, 0], [0, landZ + w / 2], [cx2, landZ + w / 2], [cx2, landZ - n2 * g]] };
}

/** The plan symbol of a placed part on the level from `elevation` (cut at `cutY`), or null when it has none there. */
export function planSymbol(pl: Placement, elevation: number, top: number, cutY: number): PlanSymbol | null {
  const cat = pl.family.category;
  if (cat !== 'furniture' && cat !== 'stairs') return null;
  if (pl.family.host !== 'free') return null;
  const m = pl.frame;
  const baseY = m[13]!;
  if (baseY < elevation - 0.05 || baseY >= top - 0.05) return null;
  const above = baseY > cutY;
  const ux = m[0]!,
    uz = m[2]!,
    vx = m[8]!,
    vz = m[10]!,
    ox = m[12]!,
    oz = m[14]!;
  const place = (q: Vec2): Vec2 => [ox + ux * q[0] + vx * q[1], oz + uz * q[0] + vz * q[1]];
  if (pl.family.id === 'stair') {
    const { local, walk } = stair(pl.params, cutY, baseY);
    const strokes: PlanStroke[] = local.map((s) => ({ pts: s.pts.map(place), closed: s.closed, above: above || !!s.above }));
    const wk = walk.map(place);
    // The walking line: a dot at the foot, an arrow at the top.
    if (wk.length >= 2) {
      const a = wk[wk.length - 2]!,
        b = wk[wk.length - 1]!;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / L,
        dz = (b[1] - a[1]) / L;
      strokes.push({ pts: wk, closed: false, above: false });
      strokes.push({ pts: [[b[0] - dx * 0.2 - dz * 0.08, b[1] - dz * 0.2 + dx * 0.08], b, [b[0] - dx * 0.2 + dz * 0.08, b[1] - dz * 0.2 - dx * 0.08]], closed: false, above: false });
      const s0 = wk[0]!;
      strokes.push({ pts: ellipse(s0[0], s0[1], 0.05, 0.05, 10), closed: true, above: false });
      return { strokes, label: { at: [s0[0] + dx * 0.35, s0[1] + dz * 0.35], text: 'UP' } };
    }
    return { strokes };
  }
  const size = pl.family.size(pl.params) as [number, number, number];
  const local = furniture(pl.family.id, pl.params, size);
  return { strokes: local.map((s) => ({ pts: s.pts.map(place), closed: s.closed, above: above || !!s.above })) };
}
