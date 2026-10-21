// Trees, shrubs and planting. Free families rooted at y = 0, grown by the plant kit
// (plantkit.ts): branch skeletons meshed into bark tubes and leaf cards cut out of the
// foliage atlas. Each species is a set of growth rules; the seed gives the variation
// (never Math.random), and the size parameters scale the grown plant exactly. No three.
import type { Vec3 } from '../model/schema';
import type { Family, Foliage, PartMat, PartSink } from './family';
import { bool, num, P, str } from './family';
import { clamp, hash01, mat } from './kit';
import { frond, grow, meshPlant, type PlantSpec, type Skeleton } from './plantkit';

const leafMat = (color: string, foliage: Foliage): PartMat => ({ slot: 'green', color, foliage });
const DETAIL: [string, string][] = [
  ['low', 'Low (far, many plants)'],
  ['medium', 'Medium'],
  ['high', 'High (close up)'],
];
const detailOf = (p: Record<string, unknown>) => ({ low: 0.35, medium: 0.65, high: 1 })[String(p.detail ?? 'medium')] ?? 0.65;

/** Grown skeletons by species and seed: a street of the same tree grows it once. */
const grown = new Map<string, Skeleton>();
function skeleton(key: string, spec: PlantSpec, seed: number): Skeleton {
  const k = `${key}|${seed}`;
  let s = grown.get(k);
  if (!s) {
    if (grown.size > 200) grown.clear();
    grown.set(k, (s = grow(spec, seed)));
  }
  return s;
}

type Rule = Omit<PlantSpec, 'leaves'> & { leaves: Omit<PlantSpec['leaves'], 'kind'> & { kind: Foliage } };

/** Broadleaf species: trunk, limbs and leafy twigs. */
const BROADLEAF: Record<string, Rule> = {
  oak: {
    levels: 2, length: [1, 0.72, 0.42], radius: [0.075, 0.55, 0.5], sections: [8, 6, 4], segments: [10, 6, 4], taper: [0.55, 0.7, 0.8],
    gnarl: [0.04, 0.14, 0.22], twist: [0, 0.05, 0], children: [7, 6, 0], start: [0.38, 0.15, 0], angle: [0, 0.95, 0.85],
    force: [0, 1, 0], strength: 0.015,
    leaves: { kind: 'broad', count: 14, start: 0.05, angle: 0.9, size: 0.18, vary: 0.3, double: true },
  },
  maple: {
    levels: 2, length: [1, 0.66, 0.4], radius: [0.065, 0.55, 0.5], sections: [8, 6, 4], segments: [10, 6, 4], taper: [0.55, 0.7, 0.8],
    gnarl: [0.03, 0.1, 0.18], twist: [0, 0, 0], children: [8, 6, 0], start: [0.32, 0.15, 0], angle: [0, 0.75, 0.8],
    force: [0, 1, 0], strength: 0.03,
    leaves: { kind: 'maple', count: 14, start: 0.05, angle: 0.8, size: 0.18, vary: 0.3, double: true },
  },
  birch: {
    levels: 2, length: [1.25, 0.42, 0.45], radius: [0.04, 0.5, 0.5], sections: [10, 5, 4], segments: [9, 5, 3], taper: [0.75, 0.7, 0.8],
    gnarl: [0.02, 0.1, 0.18], twist: [0, 0, 0], children: [11, 5, 0], start: [0.35, 0.15, 0], angle: [0, 0.7, 0.8],
    force: [0, -1, 0], strength: 0.012,
    leaves: { kind: 'small', count: 9, start: 0.1, angle: 0.9, size: 0.22, vary: 0.3, double: true },
  },
  willow: {
    levels: 2, length: [1.4, 0.55, 0.7], radius: [0.08, 0.5, 0.45], sections: [8, 6, 7], segments: [10, 6, 3], taper: [0.55, 0.7, 0.85],
    gnarl: [0.05, 0.1, 0.06], twist: [0, 0, 0], children: [8, 7, 0], start: [0.55, 0.2, 0], angle: [0, 0.75, 0.6],
    force: [0, -1, 0], strength: 1.2,
    leaves: { kind: 'small', count: 14, start: 0.1, angle: 0.3, size: 0.23, vary: 0.25, double: true },
  },
  poplar: {
    levels: 2, length: [1.3, 0.34, 0.35], radius: [0.05, 0.45, 0.5], sections: [10, 5, 3], segments: [9, 5, 3], taper: [0.8, 0.7, 0.8],
    gnarl: [0.01, 0.06, 0.15], twist: [0, 0, 0], children: [14, 4, 0], start: [0.12, 0.2, 0], angle: [0, 0.32, 0.6],
    force: [0, 1, 0], strength: 0.06,
    leaves: { kind: 'small', count: 9, start: 0.1, angle: 0.7, size: 0.2, vary: 0.3, double: true },
  },
  cherry: {
    levels: 2, length: [0.75, 0.75, 0.42], radius: [0.07, 0.55, 0.5], sections: [7, 6, 4], segments: [10, 6, 4], taper: [0.5, 0.7, 0.8],
    gnarl: [0.06, 0.14, 0.2], twist: [0, 0, 0], children: [6, 6, 0], start: [0.45, 0.15, 0], angle: [0, 1.0, 0.8],
    force: [0, 1, 0], strength: 0.01,
    leaves: { kind: 'broad', count: 14, start: 0.05, angle: 0.9, size: 0.17, vary: 0.3, double: true },
  },
  olive: {
    levels: 2, length: [0.7, 0.7, 0.4], radius: [0.1, 0.5, 0.5], sections: [8, 6, 4], segments: [10, 6, 4], taper: [0.45, 0.7, 0.8],
    gnarl: [0.12, 0.18, 0.22], twist: [0.08, 0.05, 0], children: [6, 6, 0], start: [0.4, 0.15, 0], angle: [0, 1.0, 0.9],
    force: [0, 1, 0], strength: 0.01,
    leaves: { kind: 'small', count: 10, start: 0.05, angle: 0.9, size: 0.23, vary: 0.3, double: true },
  },
};

/** Conifers: a straight trunk and whorls of branches that shorten going up (cone). */
const CONIFER: Record<string, Rule> = {
  spruce: {
    levels: 1, length: [1, 0.3], radius: [0.03, 0.45], sections: [10, 5], segments: [8, 4], taper: [0.92, 0.85],
    gnarl: [0, 0.05], twist: [0, 0], children: [26, 0], start: [0.08, 0], angle: [0, 1.75],
    force: [0, -1, 0], strength: 0.02, cone: true,
    leaves: { kind: 'needle', count: 10, start: 0.05, angle: 0.5, size: 0.15, vary: 0.25, double: true },
  },
  fir: {
    levels: 1, length: [1, 0.28], radius: [0.03, 0.45], sections: [10, 5], segments: [8, 4], taper: [0.92, 0.85],
    gnarl: [0, 0.04], twist: [0, 0], children: [24, 0], start: [0.1, 0], angle: [0, 1.45],
    force: [0, 1, 0], strength: 0.01, cone: true,
    leaves: { kind: 'needle', count: 10, start: 0.05, angle: 0.6, size: 0.15, vary: 0.25, double: true },
  },
  pine: {
    levels: 2, length: [1, 0.36, 0.45], radius: [0.035, 0.45, 0.5], sections: [10, 5, 3], segments: [9, 5, 3], taper: [0.8, 0.8, 0.8],
    gnarl: [0.02, 0.12, 0.15], twist: [0, 0, 0], children: [12, 4, 0], start: [0.55, 0.3, 0], angle: [0, 1.2, 0.7],
    force: [0, 1, 0], strength: 0.03, cone: true,
    leaves: { kind: 'needle', count: 7, start: 0.2, angle: 0.6, size: 0.17, vary: 0.25, double: true },
  },
  cypress: {
    levels: 1, length: [1, 0.2], radius: [0.025, 0.45], sections: [10, 4], segments: [8, 3], taper: [0.9, 0.85],
    gnarl: [0, 0.05], twist: [0, 0], children: [30, 0], start: [0.04, 0], angle: [0, 0.38],
    force: [0, 1, 0], strength: 0.02, cone: true,
    leaves: { kind: 'needle', count: 9, start: 0.05, angle: 0.4, size: 0.12, vary: 0.25, double: true },
  },
};

/** Shrubs: several stems from the ground. */
const SHRUB: Record<string, Rule> = {
  round: {
    levels: 1, length: [1, 0.55], radius: [0.03, 0.6], sections: [5, 4], segments: [5, 3], taper: [0.6, 0.8],
    gnarl: [0.08, 0.15], twist: [0, 0], children: [6, 0], start: [0.25, 0], angle: [0, 0.9],
    force: [0, 1, 0], strength: 0.01, stems: 5, stemAngle: 0.55,
    leaves: { kind: 'broad', count: 10, start: 0.1, angle: 0.9, size: 0.5, vary: 0.25, double: true },
  },
  boxwood: {
    levels: 1, length: [1, 0.5], radius: [0.03, 0.6], sections: [5, 4], segments: [5, 3], taper: [0.6, 0.8],
    gnarl: [0.08, 0.15], twist: [0, 0], children: [7, 0], start: [0.2, 0], angle: [0, 1.0],
    force: [0, 1, 0], strength: 0.01, stems: 6, stemAngle: 0.6,
    leaves: { kind: 'small', count: 15, start: 0.05, angle: 1.0, size: 0.43, vary: 0.2, double: true },
  },
  upright: {
    levels: 1, length: [1, 0.4], radius: [0.025, 0.6], sections: [6, 4], segments: [5, 3], taper: [0.6, 0.8],
    gnarl: [0.04, 0.12], twist: [0, 0], children: [5, 0], start: [0.3, 0], angle: [0, 0.6],
    force: [0, 1, 0], strength: 0.03, stems: 6, stemAngle: 0.3,
    leaves: { kind: 'small', count: 12, start: 0.1, angle: 0.7, size: 0.4, vary: 0.25, double: true },
  },
};

function plant(out: PartSink, key: string, rule: Rule, seed: number, bark: PartMat, leafColor: string, w: number, h: number, detail: number, bloomColor?: string, every = 3): void {
  const sk = skeleton(key, rule, seed);
  meshPlant(out, sk, { bark, leaf: leafMat(leafColor, rule.leaves.kind) }, w, h, detail, 0.004, bloomColor ? { mat: leafMat(bloomColor, 'flower'), every } : undefined);
}

export const TREE_DECIDUOUS: Family = {
  id: 'tree-deciduous',
  name: 'Deciduous tree',
  category: 'vegetation',
  host: 'free',
  tags: ['tree', 'deciduous', 'oak', 'birch', 'maple', 'willow', 'poplar', 'cherry', 'olive', 'garden', 'park'],
  params: [
    P.pick('species', 'Species', 'oak', [
      ['oak', 'Oak (broad, round)'],
      ['maple', 'Maple'],
      ['birch', 'Birch (slender)'],
      ['willow', 'Weeping willow'],
      ['poplar', 'Poplar (columnar)'],
      ['cherry', 'Cherry'],
      ['olive', 'Olive (gnarled)'],
    ]),
    P.len('height', 'Height', 6, 1.5, 25, 'instance'),
    P.len('crown', 'Crown diameter', 5, 0.8, 20),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.pick('detail', 'Detail', 'medium', DETAIL, 'detail'),
    P.flag('blossom', 'Blossom', false),
    P.color('leafColor', 'Leaves', '#4e7a3a'),
    P.color('trunkColor', 'Bark', '#6b5340'),
    P.color('flowerColor', 'Blossom', '#f2b8c8'),
  ],
  size: (p) => [num(p, 'crown'), num(p, 'height'), num(p, 'crown')],
  build(p, out) {
    const sp = str(p, 'species');
    const rule = BROADLEAF[sp] ?? BROADLEAF.oak!;
    const h = num(p, 'height'),
      cd = num(p, 'crown'),
      seed = Math.round(num(p, 'seed'));
    plant(out, `tree:${sp}`, rule, seed, mat('wood', str(p, 'trunkColor'), 'wood'), str(p, 'leafColor'), cd, h, detailOf(p), bool(p, 'blossom') ? str(p, 'flowerColor') : undefined, 2);
  },
};

export const TREE_CONIFER: Family = {
  id: 'tree-conifer',
  name: 'Conifer',
  category: 'vegetation',
  host: 'free',
  tags: ['tree', 'conifer', 'pine', 'spruce', 'fir', 'cypress', 'forest'],
  params: [
    P.pick('species', 'Species', 'spruce', [
      ['spruce', 'Spruce (drooping whorls)'],
      ['fir', 'Fir'],
      ['pine', 'Pine (high crown)'],
      ['cypress', 'Cypress (narrow)'],
    ]),
    P.len('height', 'Height', 9, 2, 30, 'instance'),
    P.len('crown', 'Base diameter', 3.5, 0.6, 12),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.pick('detail', 'Detail', 'medium', DETAIL, 'detail'),
    P.color('leafColor', 'Needles', '#33583c'),
    P.color('trunkColor', 'Bark', '#5c4634'),
  ],
  size: (p) => [num(p, 'crown'), num(p, 'height'), num(p, 'crown')],
  build(p, out) {
    const sp = str(p, 'species');
    const rule = CONIFER[sp] ?? CONIFER.spruce!;
    plant(out, `conifer:${sp}`, rule, Math.round(num(p, 'seed')), mat('wood', str(p, 'trunkColor'), 'wood'), str(p, 'leafColor'), num(p, 'crown'), num(p, 'height'), detailOf(p));
  },
};

export const PALM: Family = {
  id: 'palm',
  name: 'Palm',
  category: 'vegetation',
  host: 'free',
  tags: ['palm', 'tree', 'tropical', 'coconut', 'date', 'beach'],
  params: [
    P.len('height', 'Height', 6, 2, 16, 'instance'),
    P.len('trunk', 'Trunk diameter', 0.35, 0.15, 0.8, 'type', 'size', 0.01),
    P.len('bend', 'Trunk bend', 0.6, 0, 3, 'type', 'profile'),
    P.count('fronds', 'Fronds', 12, 4, 24, 'divisions'),
    P.len('frond', 'Frond length', 2.6, 0.8, 5, 'type', 'profile'),
    P.flag('coconuts', 'Coconuts', false),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.color('leafColor', 'Fronds', '#4f7f3a'),
    P.color('trunkColor', 'Trunk', '#8a7550'),
  ],
  size: (p) => {
    const h = num(p, 'height');
    const spread = num(p, 'frond') * 1.7 + num(p, 'bend');
    return [spread, h + num(p, 'frond') * 0.35, spread];
  },
  build(p, out) {
    const h = num(p, 'height'),
      td = num(p, 'trunk'),
      bend = num(p, 'bend'),
      nf = clamp(Math.round(num(p, 'fronds')), 4, 24),
      fl = num(p, 'frond'),
      seed = Math.round(num(p, 'seed'));
    const wood = mat('wood', str(p, 'trunkColor'), 'wood');
    // Curved, ringed trunk: a smooth tube along x = bend · t², with a slight bulge at every ring.
    const steps = 18,
      segs = 10;
    const pt = (t: number): Vec3 => [bend * t * t, h * t, 0];
    const pos: number[] = [],
      nrm: number[] = [];
    const ring = (t: number) => {
      const c = pt(t);
      const r = td * 0.5 * (1.15 - 0.4 * t) * (1 + 0.05 * Math.cos(t * steps * Math.PI));
      return Array.from({ length: segs + 1 }, (_, j) => {
        const a = (j / segs) * Math.PI * 2;
        return { p: [c[0] + Math.cos(a) * r, c[1], c[2] + Math.sin(a) * r] as Vec3, n: [Math.cos(a), 0, Math.sin(a)] as Vec3 };
      });
    };
    let prev = ring(0);
    for (let i = 1; i <= steps; i++) {
      const cur = ring(i / steps);
      for (let j = 0; j < segs; j++) {
        const q = [prev[j]!, prev[j + 1]!, cur[j + 1]!, cur[j]!];
        for (const k of [0, 2, 1, 0, 3, 2]) {
          pos.push(...q[k]!.p);
          nrm.push(...q[k]!.n);
        }
      }
      prev = cur;
    }
    out.mesh(wood, pos, nrm);
    const top = pt(1);
    out.lathe(wood, [[td * 0.42, 0], [td * 0.36, 0.25], [0.05, 0.42]], 10, [top[0], top[1] - 0.02, top[2]]);
    // Fronds: arching strips of frond cards, two crowns (upper rising, lower drooping).
    const lp: number[] = [],
      ln: number[] = [],
      lu: number[] = [];
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2 * 1.618 + hash01(seed, i) * 0.4;
      const upper = i % 3 !== 0;
      const L = fl * (0.8 + 0.3 * hash01(seed, i + 40));
      frond(lp, ln, lu, 'palm', [top[0], top[1] + 0.3, top[2]], [Math.cos(a), upper ? 0.75 : 0.25, Math.sin(a)], L, L * 0.42, upper ? 0.95 : 1.1, 6);
    }
    out.mesh(leafMat(str(p, 'leafColor'), 'palm'), lp, ln, lu);
    if (bool(p, 'coconuts')) {
      const nut = mat('wood', '#6a4a2a');
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        out.lathe(nut, Array.from({ length: 7 }, (_, k) => [Math.sin((k / 6) * Math.PI) * 0.11, -Math.cos((k / 6) * Math.PI) * 0.12] as [number, number]), 8, [top[0] + Math.cos(a) * 0.2, top[1] + 0.05, top[2] + Math.sin(a) * 0.2]);
      }
    }
  },
};

export const BUSH: Family = {
  id: 'bush',
  name: 'Bush',
  category: 'vegetation',
  host: 'free',
  tags: ['bush', 'shrub', 'boxwood', 'garden', 'plant'],
  params: [
    P.pick('shape', 'Shape', 'round', [
      ['round', 'Round, broad leaves'],
      ['boxwood', 'Boxwood (dense, small leaves)'],
      ['upright', 'Upright'],
    ]),
    P.len('width', 'Width', 1.2, 0.3, 4),
    P.len('height', 'Height', 0.9, 0.2, 3),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.pick('detail', 'Detail', 'medium', DETAIL, 'detail'),
    P.flag('flowers', 'Flowers', false, 'detail'),
    P.color('leafColor', 'Leaves', '#48703c'),
    P.color('flowerColor', 'Flowers', '#c86a86'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'width')],
  build(p, out) {
    const sh = str(p, 'shape');
    const rule = SHRUB[sh] ?? SHRUB.round!;
    const w = num(p, 'width'),
      h = num(p, 'height'),
      seed = Math.round(num(p, 'seed'));
    plant(out, `shrub:${sh}`, rule, seed, mat('wood', '#5a4636', 'wood'), str(p, 'leafColor'), w, h, detailOf(p), bool(p, 'flowers') ? str(p, 'flowerColor') : undefined, 3);
  },
};

/** Grass blades: a fan of grass cards (tufts, ornamental grass, the leaves of a bed). */
function tuft(lp: number[], ln: number[], lu: number[], kind: Foliage, x: number, y: number, z: number, h: number, w: number, n: number, seed: number, spread = 0.35): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + hash01(seed, i) * 0.6;
    frond(lp, ln, lu, kind, [x, y, z], [Math.cos(a) * spread, 1, Math.sin(a) * spread], h, w, 0.05, 1);
  }
}

export const PLANTER: Family = {
  id: 'planter',
  name: 'Planter',
  category: 'vegetation',
  host: 'free',
  tags: ['planter', 'pot', 'box', 'garden', 'terrace', 'plant'],
  params: [
    P.len('width', 'Width', 1, 0.3, 3),
    P.len('depth', 'Depth', 0.45, 0.25, 1.5),
    P.len('height', 'Pot height', 0.45, 0.2, 1, 'type', 'size', 0.01),
    P.len('plantHeight', 'Plant height', 0.7, 0.2, 2, 'type', 'size', 0.05),
    P.pick('plant', 'Plant', 'shrub', [
      ['shrub', 'Shrub'],
      ['boxwood', 'Boxwood'],
      ['grass', 'Ornamental grass'],
      ['fern', 'Fern'],
      ['flowers', 'Flowers'],
    ]),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.pick('material', 'Pot material', 'concrete', [
      ['concrete', 'Concrete'],
      ['stone', 'Stone'],
      ['wood', 'Wood'],
    ]),
    P.color('color', 'Color', '#c4beb1'),
    P.color('leafColor', 'Leaves', '#48703c'),
    P.color('flowerColor', 'Flowers', '#d8506a'),
    P.finish('finish', 'Finish', 'concrete'),
  ],
  size: (p) => [num(p, 'width') + 0.04, num(p, 'height') + num(p, 'plantHeight'), num(p, 'depth') + 0.04],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height'),
      ph = num(p, 'plantHeight'),
      seed = Math.round(num(p, 'seed'));
    const k = str(p, 'material');
    const pot = mat(k === 'stone' ? 'stone' : k === 'wood' ? 'wood' : 'concrete', str(p, 'color'), str(p, 'finish'));
    const t = Math.max(0.03, h * 0.1);
    for (const sz of [-1, 1]) out.box(pot, [0, h / 2, (sz * (d - t)) / 2], [w, h, t]);
    for (const sx of [-1, 1]) out.box(pot, [(sx * (w - t)) / 2, h / 2, 0], [t, h, d - 2 * t]);
    out.box(pot, [0, t / 2, 0], [w, t, d]);
    out.box(pot, [0, h - 0.02, 0], [w + 0.04, 0.05, d + 0.04]);
    out.box(mat('dark', '#3a2f26'), [0, h - 0.04, 0], [w - 2 * t, 0.08, d - 2 * t]);
    bedPlants(out.translated(0, h - 0.02, 0), str(p, 'plant'), w - 2 * t, d - 2 * t, ph, seed, str(p, 'leafColor'), str(p, 'flowerColor'));
  },
};

/** Plants filling a w × d bed whose soil is at y = 0. */
function bedPlants(out: PartSink, kind: string, w: number, d: number, ph: number, seed: number, leafColor: string, flowerColor: string): void {
  const n = clamp(Math.round((w * d) / 0.05), 1, 60);
  const at = (i: number): [number, number] => {
    // Jittered grid over the bed.
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
    const rows = Math.ceil(n / cols);
    const c = i % cols,
      r = Math.floor(i / cols);
    return [-w / 2 + (w * (c + 0.25 + 0.5 * hash01(seed, i))) / cols, -d / 2 + (d * (r + 0.25 + 0.5 * hash01(seed, i + 50))) / rows];
  };
  if (kind === 'shrub' || kind === 'boxwood') {
    const rule = SHRUB[kind === 'boxwood' ? 'boxwood' : 'round']!;
    const m = Math.max(1, Math.min(4, Math.round(w / Math.max(0.3, ph))));
    for (let i = 0; i < m; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / m;
      plant(out.translated(x, 0, 0), `shrub:${kind}`, rule, seed + i, mat('wood', '#5a4636', 'wood'), leafColor, Math.max(w / m, d) * 1.1, ph, 0.6);
    }
    return;
  }
  const lp: number[] = [],
    ln: number[] = [],
    lu: number[] = [];
  const fp: number[] = [],
    fn: number[] = [],
    fu: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = at(i);
    const s = 0.75 + 0.5 * hash01(seed, i + 9);
    if (kind === 'fern') {
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + hash01(seed, i * 7 + k);
        frond(lp, ln, lu, 'fern', [x, 0, z], [Math.cos(a), 0.9, Math.sin(a)], ph * 1.1 * s, ph * 0.45 * s, 0.7, 3);
      }
    } else if (kind === 'flowers') {
      tuft(lp, ln, lu, 'grass', x, 0, z, ph * 0.7 * s, ph * 0.5, 3, seed + i);
      // Flower heads: a near-flat card seen from above and an upright one seen from the side.
      const a = hash01(seed, i + 4) * Math.PI * 2;
      frond(fp, fn, fu, 'flower', [x - Math.cos(a) * ph * 0.25, ph * 0.6 * s, z - Math.sin(a) * ph * 0.25], [Math.cos(a), 0.15, Math.sin(a)], ph * 0.5, ph * 0.5, 0, 1);
      frond(fp, fn, fu, 'flower', [x, ph * 0.35 * s, z], [Math.cos(a + 1.6) * 0.3, 1, Math.sin(a + 1.6) * 0.3], ph * 0.55, ph * 0.5, 0, 1);
    } else tuft(lp, ln, lu, 'grass', x, 0, z, ph * s, ph * 0.6, 5, seed + i, 0.45);
  }
  out.mesh(leafMat(leafColor, kind === 'fern' ? 'fern' : 'grass'), lp, ln, lu);
  if (fp.length) out.mesh(leafMat(flowerColor, 'flower'), fp, fn, fu);
}

export const FLOWER_BED: Family = {
  id: 'flower-bed',
  name: 'Flower bed',
  category: 'vegetation',
  host: 'free',
  tags: ['flower', 'bed', 'garden', 'border', 'planting'],
  params: [
    P.len('width', 'Width', 2, 0.5, 8),
    P.len('depth', 'Depth', 0.8, 0.4, 3),
    P.len('borderH', 'Border height', 0.18, 0.05, 0.5, 'type', 'size', 0.01),
    P.len('plantHeight', 'Plant height', 0.4, 0.1, 1.2, 'type', 'size', 0.05),
    P.pick('plant', 'Plants', 'flowers', [
      ['flowers', 'Flowers'],
      ['grass', 'Ornamental grass'],
      ['fern', 'Ferns'],
      ['boxwood', 'Boxwood'],
    ]),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.pick('material', 'Border', 'stone', [
      ['stone', 'Stone'],
      ['wood', 'Wood'],
    ]),
    P.color('color', 'Border color', '#b8b2a6'),
    P.color('leafColor', 'Leaves', '#4c7a3a'),
    P.color('flowerColor', 'Flowers', '#c25a4a'),
    P.finish('finish', 'Border finish', 'stone'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'borderH') + num(p, 'plantHeight'), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      bh = num(p, 'borderH'),
      ph = num(p, 'plantHeight');
    const border = mat(str(p, 'material') === 'wood' ? 'wood' : 'stone', str(p, 'color'), str(p, 'finish'));
    const t = 0.06;
    for (const sz of [-1, 1]) out.box(border, [0, bh / 2, (sz * (d - t)) / 2], [w, bh, t]);
    for (const sx of [-1, 1]) out.box(border, [(sx * (w - t)) / 2, bh / 2, 0], [t, bh, d]);
    out.box(mat('dark', '#3a2f26'), [0, bh - 0.05, 0], [w - 2 * t, 0.1, d - 2 * t]);
    bedPlants(out.translated(0, bh, 0), str(p, 'plant'), w - 2 * t - 0.06, d - 2 * t - 0.06, ph, Math.round(num(p, 'seed')), str(p, 'leafColor'), str(p, 'flowerColor'));
  },
};

export const GRASS_PATCH: Family = {
  id: 'grass-patch',
  name: 'Grass patch',
  category: 'vegetation',
  host: 'free',
  tags: ['grass', 'lawn', 'green', 'garden', 'ground', 'meadow'],
  params: [
    P.len('width', 'Width', 2, 0.5, 20),
    P.len('depth', 'Depth', 2, 0.5, 20),
    P.len('height', 'Thickness', 0.05, 0.01, 0.3, 'type', 'size', 0.01),
    P.flag('tufts', 'Tufts', true, 'detail'),
    P.len('tuftHeight', 'Tuft height', 0.25, 0.05, 1, 'type', 'detail'),
    P.flag('wildflowers', 'Wildflowers', false, 'detail'),
    P.color('color', 'Color', '#5c8342'),
    P.color('flowerColor', 'Flowers', '#f1e7a0'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height') + (bool(p, 'tufts') ? num(p, 'tuftHeight') : 0), num(p, 'depth')],
  build(p, out) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      h = num(p, 'height'),
      th = num(p, 'tuftHeight');
    const grass = mat('green', str(p, 'color'));
    out.slab(grass, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]], 0, h);
    if (!bool(p, 'tufts')) return;
    // Tufts of grass cards, capped so a big patch does not explode the triangle count.
    const n = clamp(Math.round(w * d * 12), 0, 160);
    const lp: number[] = [],
      ln: number[] = [],
      lu: number[] = [];
    const fp: number[] = [],
      fn: number[] = [],
      fu: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.1 + (w - 0.2) * hash01(i, 1),
        z = -d / 2 + 0.1 + (d - 0.2) * hash01(i, 2);
      const s = 0.6 + 0.6 * hash01(i, 3);
      tuft(lp, ln, lu, 'grass', x, h - 0.01, z, th * s, th * 0.7 * s, 3, i);
      if (bool(p, 'wildflowers') && hash01(i, 5) < 0.35) frond(fp, fn, fu, 'flower', [x, h + th * 0.5 * s, z], [hash01(i, 6) - 0.5, 0.2, hash01(i, 7) - 0.5], th * 0.4, th * 0.4, 0, 1);
    }
    out.mesh(leafMat(str(p, 'color'), 'grass'), lp, ln, lu);
    if (fp.length) out.mesh(leafMat(str(p, 'flowerColor'), 'flower'), fp, fn, fu);
  },
};

export const ORNAMENTAL_GRASS: Family = {
  id: 'ornamental-grass',
  name: 'Ornamental grass',
  category: 'vegetation',
  host: 'free',
  tags: ['grass', 'ornamental', 'pampas', 'miscanthus', 'garden', 'plant'],
  params: [
    P.len('width', 'Width', 0.9, 0.2, 3),
    P.len('height', 'Height', 1.1, 0.2, 3),
    P.count('blades', 'Clumps', 9, 3, 24, 'divisions'),
    P.flag('plumes', 'Plumes', true, 'detail'),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.color('leafColor', 'Blades', '#7d9a52'),
    P.color('plumeColor', 'Plumes', '#e8dcc0'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      n = clamp(Math.round(num(p, 'blades')), 3, 24),
      seed = Math.round(num(p, 'seed'));
    const lp: number[] = [],
      ln: number[] = [],
      lu: number[] = [];
    const fp: number[] = [],
      fn: number[] = [],
      fu: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(seed, i) * 0.8;
      const r = w * 0.12 * hash01(seed, i + 30);
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      frond(lp, ln, lu, 'grass', [x, 0, z], [Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45], h * (0.75 + 0.25 * hash01(seed, i + 9)), w * 0.55, 0.25, 3);
      if (bool(p, 'plumes') && i % 2 === 0) frond(fp, fn, fu, 'grass', [x * 1.5, h * 0.55, z * 1.5], [Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2], h * 0.45, w * 0.18, 0.1, 2);
    }
    out.mesh(leafMat(str(p, 'leafColor'), 'grass'), lp, ln, lu);
    if (fp.length) out.mesh(leafMat(str(p, 'plumeColor'), 'grass'), fp, fn, fu);
  },
};

export const FERN: Family = {
  id: 'fern',
  name: 'Fern',
  category: 'vegetation',
  host: 'free',
  tags: ['fern', 'plant', 'shade', 'garden', 'forest', 'tropical'],
  params: [
    P.len('width', 'Spread', 1.2, 0.3, 4),
    P.len('height', 'Height', 0.7, 0.2, 2.5),
    P.count('fronds', 'Fronds', 10, 4, 24, 'divisions'),
    P.count('seed', 'Seed (variation)', 1, 1, 99, 'detail'),
    P.color('leafColor', 'Fronds', '#4f7a34'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'width')],
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      n = clamp(Math.round(num(p, 'fronds')), 4, 24),
      seed = Math.round(num(p, 'seed'));
    const lp: number[] = [],
      ln: number[] = [],
      lu: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(seed, i) * 0.5;
      const rise = (h / (w * 0.5)) * (0.8 + 0.4 * hash01(seed, i + 3));
      frond(lp, ln, lu, 'fern', [0, 0.02, 0], [Math.cos(a), rise, Math.sin(a)], w * 0.55, w * 0.22, rise * 0.75, 5);
    }
    out.mesh(leafMat(str(p, 'leafColor'), 'fern'), lp, ln, lu);
  },
};
