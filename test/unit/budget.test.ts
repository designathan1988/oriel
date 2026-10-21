// Work budgets of the evaluation as counts: Manifold objects made, triangles, parts placed, cutter
// layers, outlines sampled. A count is the same on every run and every machine, so it is checked in
// every `npm test` (milliseconds) and a regression fails exactly; the old gate timed medians of 5
// runs against ms budgets in its own slow run, and the clock moved by 2× between two runs here.
// A ceiling is what the code makes today. More fails: either the change was not meant to make more
// (fix it) or it was, and the new number is written here in the same change, with the reason.
import { beforeAll, describe, expect, it } from 'vitest';
import { kernelStats, loadKernel } from '../../src/f3/kernel/kernel';
import { cutterStats, evaluateBuilding } from '../../src/f3/eval/evaluate';
import { building, facadeRule, levelsFor, rectPlan, roofSpec, solid, uid } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { relationStats, resolveBuilding } from '../../src/f3/model/relations';
import type { Building3 } from '../../src/f3/model/schema';
import { PLANTS } from '../../e2e/scenes';

beforeAll(async () => {
  await loadKernel();
});

/** Evaluates `b` and returns what it cost, as counts. */
function work(b: Building3) {
  kernelStats.objects = 0;
  const ev = evaluateBuilding(b);
  return { objects: kernelStats.objects, tris: ev.shell.indices.length / 3, placements: ev.placements.length, cutterLayers: cutterStats.layers };
}

function tower20(): Building3 {
  const s = solid({ plan: { outer: rectPlan(30, 30), holes: [] }, height: 3.4 + 19 * 3, roof: roofSpec('flat', { parapet: 1 }), facade: [facadeRule('win-casement', { mode: 'max', value: 3 }), facadeRule('balcony-glass', { levels: 'upper', mode: 'max', value: 6 })] });
  return building({ levels: levelsFor(20, 3, 3.4), solids: [s] });
}

function tower40(): Building3 {
  const b = structuredClone(sampleBuildings().find((x) => x.name === 'Courtyard block')!);
  const lv = [];
  let e = 0;
  for (let i = 0; i < 40; i++) {
    const h = i === 0 ? 4.5 : 3.1;
    lv.push({ id: uid(), name: i ? `Floor ${i}` : 'Ground', elevation: +e.toFixed(2), height: h });
    e += h;
  }
  b.levels = lv;
  b.interiors = {};
  b.solids[0]!.height = +e.toFixed(2);
  b.solids[1]!.height = e + 2;
  return b;
}

/** Each key may not grow past its ceiling (fewer passes: lower the ceiling when it is kept). */
function within(name: string, got: Record<string, number>, max: Record<string, number>) {
  const over = Object.keys(max).filter((k) => got[k]! > max[k]!);
  console.log(`${name}: ${JSON.stringify(got)}`);
  expect(over.map((k) => `${name}.${k} ${got[k]} > ${max[k]}`)).toEqual([]);
}

describe('evaluation work (counts, not time)', () => {
  it('tower 30×30 m, 20 floors: 800 parts, rooms by run, cutters in 2 layers', () => {
    const w = work(tower20());
    expect(w.placements).toBe(800);
    within('tower20', w, { objects: 12, tris: 23_448, cutterLayers: 2 });
    // The same document gives the same work (nothing left over from the first run).
    expect(work(tower20())).toEqual(w);
  });

  it('40-floor courtyard tower', () => {
    within('tower40', work(tower40()), { objects: TOWER40.objects, tris: TOWER40.tris, placements: TOWER40.placements, cutterLayers: TOWER40.cutterLayers });
  });

  it('the 11 samples, each one', () => {
    const all = sampleBuildings();
    expect(all.map((b) => b.name)).toEqual(Object.keys(SAMPLES));
    for (const b of all) {
      const w = work(b);
      const [objects, tris, placements] = SAMPLES[b.name]!;
      within(b.name, w, { objects, tris, placements });
    }
  });

  it('each planting type: leaf cards and bark triangles (grown plants stay light)', () => {
    // Ceilings per plant at the default detail (medium): a street of 40 trees stays under ~200k.
    for (const type of PLANTS) {
      const b = building({ levels: levelsFor(1), items: [{ id: uid(), type, params: {}, host: { kind: 'free', p: [0, 0, 0], rot: 0 } }] });
      const parts = evaluateBuilding(b).parts;
      const tris = parts.meshes.reduce((n, m) => n + m.positions.length / 9, 0) + parts.inst.length * 12;
      within(type, { tris }, { tris: type.startsWith('tree') || type.startsWith('palm') ? 5200 : 2600 });
    }
  });

  it('an edit resolves its relations without sampling outlines again, at any building size', () => {
    for (const n of [10, 40]) {
      const solids = [];
      for (let i = 0; i < n; i++) {
        solids.push(solid({ plan: { outer: rectPlan(10, 10, i * 12, 0), holes: [] }, height: 9, roof: roofSpec('flat') }));
        solids.push(solid({ plan: { outer: rectPlan(6, 6, i * 12, 0), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') }));
      }
      const b = building({ levels: levelsFor(5, 3, 3), solids });
      resolveBuilding(b, undefined, uid);
      const prev = structuredClone(b);
      b.solids[0]!.height = 12;
      relationStats.outlines = 0;
      relationStats.compares = 0;
      resolveBuilding(b, prev, uid);
      expect(b.solids[1]!.base).toBeCloseTo(12, 6);
      // The same work for 20 and for 80 volumes: an edit never walks every pair of volumes.
      within(`resolve ${2 * n} volumes`, { ...relationStats }, { outlines: 0, compares: 1 });
    }
  });
});

/** 40-floor courtyard tower, measured 2026-10-13. */
const TOWER40 = { objects: 20, tris: 37_870, placements: 1108, cutterLayers: 4 };

/** Each sample: [Manifold objects, shell triangles, parts placed], measured 2026-10-13. */
const SAMPLES: Record<string, [number, number, number]> = {
  'House with tower': [23, 938, 24],
  'L mansard': [33, 946, 26],
  Rotunda: [8, 4040, 8],
  'Vaulted shed': [6, 1456, 0],
  Factory: [13, 662, 18],
  'Courtyard block': [20, 3882, 100],
  'Tapered tower': [14, 1560, 34],
  // 2026-10-13: its two rounded corners take windows too (audit D27): 8 more parts and their openings.
  'Curved building': [12, 4696, 80],
  Arcade: [41, 3912, 0],
  Barn: [15, 186, 4],
  Bungalow: [15, 548, 16],
};
