// Performance gate of the evaluation (Node, the same Manifold WASM as the app): fixed scenes, the
// median of 5 runs against measured budgets. Run with `npm run perf:gate` (one worker; not part of
// `npm test`, since times depend on the machine). Budgets are 1.4× what was measured on the player's
// machine on 2026-10-12, so a real regression fails and noise does not.
// Measured: tower 30×30 m × 20 floors 155 ms (was 294), 40-floor courtyard tower 304 ms (was 541),
// the 11 samples 207 ms in all.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding, cutterStats } from '../../src/f3/eval/evaluate';
import { building, facadeRule, levelsFor, rectPlan, roofSpec, solid, uid } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { resolveBuilding } from '../../src/f3/model/relations';
import type { Building3 } from '../../src/f3/model/schema';

const BUDGET = {
  tower20Ms: 220,
  tower40Ms: 430,
  samplesMs: 300,
  /**
   * Triangles of the tower shell (rooms included): more means a meshing regression. 29 122 before the
   * room rows (2026-10-10), 35 928 with them by slab, 23 448 by run with framed fronts.
   */
  tower20Tris: 25_000,
  /** Relations of a 40-volume building resolved after an edit. */
  resolveMs: 4,
};

beforeAll(async () => {
  await loadKernel();
});

function median(f: () => void, n = 5): number {
  f();
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = performance.now();
    f();
    t.push(performance.now() - a);
  }
  t.sort((a, b) => a - b);
  return t[Math.floor(n / 2)]!;
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

describe('evaluation budgets', () => {
  it(`tower 30×30 m, 20 floors ≤ ${BUDGET.tower20Ms} ms`, () => {
    const b = tower20();
    const ms = median(() => evaluateBuilding(b));
    const ev = evaluateBuilding(b);
    console.log(`tower20 ${ms.toFixed(0)} ms, ${ev.shell.indices.length / 3} shell tris, ${ev.placements.length} parts, ${cutterStats.layers} cutter layers`);
    expect(ev.placements.length).toBe(800);
    expect(ev.shell.indices.length / 3).toBeLessThan(BUDGET.tower20Tris);
    expect(ms).toBeLessThan(BUDGET.tower20Ms);
  });

  it(`40-floor courtyard tower ≤ ${BUDGET.tower40Ms} ms`, () => {
    const b = tower40();
    const ms = median(() => evaluateBuilding(b));
    console.log(`tower40 ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(BUDGET.tower40Ms);
  });

  it(`the 11 samples ≤ ${BUDGET.samplesMs} ms`, () => {
    const all = sampleBuildings();
    const ms = median(() => {
      for (const b of all) evaluateBuilding(b);
    });
    console.log(`samples ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(BUDGET.samplesMs);
  });

  it(`relations of a 40-volume building ≤ ${BUDGET.resolveMs} ms per edit`, () => {
    const solids = [];
    for (let i = 0; i < 20; i++) {
      solids.push(solid({ plan: { outer: rectPlan(10, 10, i * 12, 0), holes: [] }, height: 9, roof: roofSpec('flat') }));
      solids.push(solid({ plan: { outer: rectPlan(6, 6, i * 12, 0), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') }));
    }
    const b = building({ levels: levelsFor(5, 3, 3), solids });
    resolveBuilding(b, undefined, uid);
    const ms = median(() => {
      const prev = structuredClone(b);
      b.solids[0]!.height = b.solids[0]!.height === 9 ? 12 : 9;
      resolveBuilding(b, prev, uid);
    }, 9);
    console.log(`resolve ${ms.toFixed(2)} ms`);
    expect(b.solids[1]!.base).toBeCloseTo(b.solids[0]!.height, 6);
    expect(ms).toBeLessThan(BUDGET.resolveMs);
  });
});
