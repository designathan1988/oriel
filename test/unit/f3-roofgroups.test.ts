// Adjacent volumes with the same sloped roof get one roof over their union (no V gap, no gable
// against the neighbor's slope): the same solid as the L drawn as one plan.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { building, levelsFor, planVertices, roofSpec, solid } from '../../src/f3/model/defaults';
import type { RoofKind, Vec2 } from '../../src/f3/model/schema';

beforeAll(async () => {
  await loadKernel();
});

function measure(ev: ReturnType<typeof evaluateBuilding>) {
  const p = ev.shell.positions,
    ix = ev.shell.indices;
  let vol = 0,
    maxY = -Infinity;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3,
      b = ix[i + 1]! * 3,
      c = ix[i + 2]! * 3;
    vol += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  for (let i = 1; i < p.length; i += 3) maxY = Math.max(maxY, p[i]!);
  return { vol, maxY };
}

const L: Vec2[] = [[0, 0], [10, 0], [10, 8], [6, 8], [6, 16], [0, 16]];
const A: Vec2[] = [[0, 0], [10, 0], [10, 8], [0, 8]];
const B: Vec2[] = [[0, 8], [6, 8], [6, 16], [0, 16]];

describe('one roof over adjacent volumes', () => {
  for (const kind of ['hip', 'gable', 'mansard'] as RoofKind[])
    it(`${kind}: two blocks of an L roof like the L drawn as one plan`, () => {
      const r = () => roofSpec(kind, { pitch: 30, overhang: 0.5, direction: 0 });
      const one = building({ levels: levelsFor(1, 3, 3), solids: [solid({ plinth: 0, plan: { outer: planVertices(L), holes: [] }, height: 3, roof: r() })] });
      const two = building({ levels: levelsFor(1, 3, 3), solids: [solid({ plinth: 0, plan: { outer: planVertices(A), holes: [] }, height: 3, roof: r() }), solid({ plinth: 0, plan: { outer: planVertices(B), holes: [] }, height: 3, roof: r() })] });
      const m1 = measure(evaluateBuilding(one));
      const m2 = measure(evaluateBuilding(two));
      expect(m2.vol).toBeCloseTo(m1.vol, 1);
      expect(m2.maxY).toBeCloseTo(m1.maxY, 3);
    });

  it('different heights keep a roof each (a step, not a seam)', () => {
    const two = building({ levels: levelsFor(2, 3, 3), solids: [solid({ plinth: 0, plan: { outer: planVertices(A), holes: [] }, height: 6, roof: roofSpec('hip') }), solid({ plinth: 0, plan: { outer: planVertices(B), holes: [] }, height: 3, roof: roofSpec('hip') })] });
    const ev = evaluateBuilding(two);
    expect(ev.warnings).toEqual([]);
    expect(measure(ev).vol).toBeGreaterThan(10 * 8 * 6 + 6 * 8 * 3);
  });
});
