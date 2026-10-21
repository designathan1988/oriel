// Ready massing blocks (model in an instant): each block is a solid with a
// plan, height and roof, built in the block's local frame (x width, z depth,
// origin at the middle of the front, back at z = 0 to attach to a
// face). No three.
import type { RoofKind, Solid, Vec2 } from './schema';
import { facadeRule, planVertices, roofSpec, solid } from './defaults';

export interface BlockDef {
  id: string;
  name: string;
  icon: string;
  /** Default width, depth (m). */
  w: number;
  d: number;
  /** Height in floors (multiplies the building floor height). */
  levels: number;
  roof: RoofKind;
  /** Normalized plan (0..1 in x and z) or a special shape. */
  plan: 'rect' | 'L' | 'U' | 'T' | 'cross' | 'circle' | 'hex' | 'oct' | 'tri';
  /** Solid of revolution: a profile [radius fraction, height fraction] turned around the center. */
  revolve?: [number, number][];
  /** Twisted volume (degrees, top against base). */
  twist?: number;
}

const arc = (n: number, a0: number, a1: number, r = 1, y0 = 0): [number, number][] => Array.from({ length: n + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / n;
  return [Math.max(0, r * Math.cos(a)), y0 + r * Math.sin(a)] as [number, number];
});

export const BLOCKS: BlockDef[] = [
  { id: 'box', name: 'Box', icon: 'cube', w: 8, d: 8, levels: 1, roof: 'flat', plan: 'rect' },
  { id: 'slab-tall', name: 'Tower', icon: 'layers', w: 8, d: 8, levels: 6, roof: 'flat', plan: 'rect' },
  { id: 'house', name: 'Gable house', icon: 'gable', w: 9, d: 7, levels: 1, roof: 'gable', plan: 'rect' },
  { id: 'hipblock', name: 'Hip', icon: 'hip', w: 10, d: 8, levels: 1, roof: 'hip', plan: 'rect' },
  { id: 'shed', name: 'Shed roof', icon: 'shed', w: 8, d: 6, levels: 1, roof: 'shed', plan: 'rect' },
  { id: 'L', name: 'L block', icon: 'l', w: 14, d: 12, levels: 2, roof: 'flat', plan: 'L' },
  { id: 'U', name: 'U block', icon: 'u', w: 18, d: 14, levels: 2, roof: 'flat', plan: 'U' },
  { id: 'T', name: 'T block', icon: 'top', w: 16, d: 12, levels: 2, roof: 'flat', plan: 'T' },
  { id: 'cross', name: 'Cross', icon: 'add', w: 14, d: 14, levels: 2, roof: 'flat', plan: 'cross' },
  { id: 'cyl', name: 'Cylinder', icon: 'circle', w: 8, d: 8, levels: 2, roof: 'flat', plan: 'circle' },
  { id: 'rotunda', name: 'Domed rotunda', icon: 'dome', w: 10, d: 10, levels: 2, roof: 'dome', plan: 'circle' },
  { id: 'hex', name: 'Hexagon', icon: 'polygon', w: 9, d: 9, levels: 1, roof: 'pyramid', plan: 'hex' },
  { id: 'oct', name: 'Octagon', icon: 'polygon', w: 9, d: 9, levels: 2, roof: 'flat', plan: 'oct' },
  { id: 'vault', name: 'Vaulted shed', icon: 'vault', w: 12, d: 20, levels: 2, roof: 'vault', plan: 'rect' },
  { id: 'saw', name: 'Sawtooth shed', icon: 'sawtooth', w: 20, d: 16, levels: 2, roof: 'sawtooth', plan: 'rect' },
  { id: 'gambrel', name: 'Barn', icon: 'gambrel', w: 10, d: 14, levels: 1, roof: 'gambrel', plan: 'rect' },
  { id: 'mansard', name: 'Mansard', icon: 'mansard', w: 12, d: 10, levels: 1, roof: 'mansard', plan: 'rect' },
  { id: 'prism', name: 'Prism', icon: 'pyramid', w: 8, d: 7, levels: 1, roof: 'flat', plan: 'tri' },
  { id: 'arch', name: 'Arch (to subtract)', icon: 'vault', w: 3, d: 2, levels: 1, roof: 'vault', plan: 'rect' },
  // Shapes of revolution and a twisted tower (Estúdio de Construção v3): edit the profile or the twist in the panel.
  { id: 'sphere', name: 'Sphere', icon: 'dome', w: 8, d: 8, levels: 3, roof: 'flat', plan: 'circle', revolve: arc(12, -Math.PI / 2, Math.PI / 2, 0.5, 0.5).map(([r, y]) => [r * 2, y]) },
  { id: 'dome', name: 'Dome', icon: 'dome', w: 10, d: 10, levels: 2, roof: 'flat', plan: 'circle', revolve: arc(10, 0, Math.PI / 2) },
  { id: 'spire', name: 'Pinnacle', icon: 'pyramid', w: 3, d: 3, levels: 3, roof: 'flat', plan: 'circle', revolve: [[1, 0], [1, 0.15], [0.7, 0.2], [0.55, 0.55], [0.25, 0.9], [0, 1]] },
  { id: 'silo-tower', name: 'Round tower', icon: 'circle', w: 6, d: 6, levels: 5, roof: 'flat', plan: 'circle', revolve: [[1, 0], [1, 0.85], [1.15, 0.87], [1.15, 0.9], [0.7, 0.9], [0, 1]] },
  { id: 'twisted', name: 'Twisted tower', icon: 'rotate', w: 10, d: 10, levels: 10, roof: 'flat', plan: 'rect', twist: 60 },
];

/** Normalized plan (0..1) of each shape, counterclockwise in (x, z). */
function normPlan(kind: BlockDef['plan']): Vec2[] | null {
  switch (kind) {
    case 'rect':
      return [[0, 0], [1, 0], [1, 1], [0, 1]];
    case 'L':
      return [[0, 0], [1, 0], [1, 0.45], [0.45, 0.45], [0.45, 1], [0, 1]];
    case 'U':
      return [[0, 0], [1, 0], [1, 1], [0.7, 1], [0.7, 0.4], [0.3, 0.4], [0.3, 1], [0, 1]];
    case 'T':
      return [[0, 0], [1, 0], [1, 0.4], [0.65, 0.4], [0.65, 1], [0.35, 1], [0.35, 0.4], [0, 0.4]];
    case 'cross':
      return [[0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67], [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33]];
    case 'tri':
      return [[0, 0], [1, 0], [0.5, 1]];
    case 'hex':
    case 'oct': {
      const n = kind === 'hex' ? 6 : 8;
      return Array.from({ length: n }, (_, i) => {
        const a = Math.PI / n + (i / n) * Math.PI * 2;
        return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)] as Vec2;
      });
    }
    default:
      return null;
  }
}

export interface BlockPlacement {
  /** Origin (middle of the block front) and directions on the building plane. */
  origin: Vec2;
  /** Width direction (block x) and depth direction (block z, "inward"). */
  ux: Vec2;
  uz: Vec2;
  base: number;
  levelHeight: number;
  op: Solid['op'];
  w?: number;
  d?: number;
  /** Attached to a face: the front is the side opposite the wall. */
  attached?: boolean;
}

/** Builds the solid of the block placed in the building. */
export function blockSolid(def: BlockDef, at: BlockPlacement): Solid {
  const w = at.w ?? def.w,
    d = at.d ?? def.d;
  const local = (p: Vec2): Vec2 => {
    const x = (p[0] - 0.5) * w,
      z = p[1] * d;
    return [at.origin[0] + at.ux[0] * x + at.uz[0] * z, at.origin[1] + at.ux[1] * x + at.uz[1] * z];
  };
  let pts: Vec2[];
  let bulges: (number | undefined)[] = [];
  if (def.plan === 'circle') {
    const c = local([0.5, 0.5]);
    const r = Math.min(w, d) / 2;
    pts = [
      [c[0] + r, c[1]],
      [c[0], c[1] + r],
      [c[0] - r, c[1]],
      [c[0], c[1] - r],
    ];
    bulges = [1, 1, 1, 1].map(() => Math.tan(Math.PI / 8));
  } else pts = normPlan(def.plan)!.map(local);
  // The frame may be mirrored (ux × uz): ensures a counterclockwise ring.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!,
      b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) {
    pts = [...pts].reverse();
    bulges = [...bulges].reverse();
  }
  const height = def.id === 'arch' ? at.levelHeight * 0.75 : def.levels * at.levelHeight;
  const made = solid({
    name: def.name,
    op: at.op,
    plan: { outer: planVertices(pts, (i) => (bulges[i] ? { bulge: bulges[i] } : {})), holes: [] },
    base: at.base,
    height,
    roof: roofSpec(def.roof, def.roof === 'vault' ? { direction: def.id === 'arch' ? 90 : 0 } : def.roof === 'flat' ? { parapet: at.op === 'add' ? 0.6 : 0 } : {}),
    plinth: at.base < 0.3 && at.op === 'add' ? 0.4 : 0,
  });
  if (def.revolve) {
    const R = Math.min(w, d) / 2;
    made.revolve = { profile: def.revolve.map(([r, y]) => [r * R, y * height]), segments: 48 };
    made.plinth = 0;
    made.roof = { ...made.roof, parapet: 0 };
    return made;
  }
  if (def.twist) made.twist = def.twist;
  if (at.op === 'add' && !def.twist) made.facade = defaultFacade(def, made, at);
  return made;
}

/** Initial facade of each block: model in an instant (all editable later). */
function defaultFacade(def: BlockDef, s: Solid, at: BlockPlacement): Solid['facade'] {
  // Front: the side whose middle is closest to the block origin.
  const o = s.plan.outer;
  let front = o[0]!.id,
    best = Infinity;
  o.forEach((v, i) => {
    const n = o[(i + 1) % o.length]!;
    const m: Vec2 = [(v.p[0] + n.p[0]) / 2, (v.p[1] + n.p[1]) / 2];
    const dd = Math.hypot(m[0] - at.origin[0], m[1] - at.origin[1]);
    const score = at.attached ? -dd : dd;
    if (score < best) {
      best = score;
      front = v.id;
    }
  });
  const door = (type: string) => facadeRule(type, { levels: 'ground', edges: [front], mode: 'count', value: 1 });
  const onGround = at.base < 0.3;
  switch (def.id) {
    case 'arch':
      return [];
    case 'house':
    case 'hipblock':
    case 'mansard':
      return [...(onGround ? [door('door-panel')] : []), facadeRule('win-casement', { mode: 'max', value: 3.2 })];
    case 'gambrel':
      return [...(onGround ? [door('garage-carriage')] : []), facadeRule('win-sash', { mode: 'max', value: 4 })];
    case 'vault':
    case 'saw':
      return [...(onGround ? [door('loading-dock')] : []), facadeRule('win-industrial', { mode: 'max', value: 4.5 })];
    case 'rotunda':
      return [facadeRule('win-arched', { mode: 'spacing', value: 3 })];
    case 'slab-tall':
      return [...(onGround ? [door('door-glass')] : []), facadeRule('win-sliding', { mode: 'spacing', value: 2.6 })];
    default:
      return [...(onGround ? [door('door-double')] : []), facadeRule('win-casement', { mode: 'max', value: 3 })];
  }
}
