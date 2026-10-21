// Composition: joining a building into another (mergeInto) and separating volumes back into a building of
// their own (separateSolids): the inverse keeps every volume and part where it is in the world.
import { describe, expect, it } from 'vitest';
import { building, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { mergeInto, separateSolids, worldParts } from '../../src/f3/model/compose';

describe('join and separate', () => {
  it('a joined building separated again is where it was, with its parts', () => {
    const a = building({ name: 'A', position: [0, 0], solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat') })] });
    const b = building({ name: 'B', position: [7, 3], rotation: 30, solids: [solid({ name: 'Tower', plan: { outer: rectPlan(4, 4), holes: [] }, height: 12, roof: roofSpec('flat') })] });
    b.items.push({ id: 'w', type: 'win-casement', params: {}, host: { kind: 'face', solid: b.solids[0]!.id, edge: b.solids[0]!.plan.outer[0]!.id, u: 2, y: 1 } });
    const before = worldParts(b)[0]!.ring;
    const ids = b.solids.map((s) => s.id);
    mergeInto(a, b);
    expect(a.solids).toHaveLength(2);
    a.solids[1]!.op = 'subtract';
    const c = separateSolids(a, ids, (input) => building(input))!;
    expect(a.solids).toHaveLength(1);
    expect(c.solids.map((s) => s.name)).toEqual(['Tower']);
    expect(c.solids[0]!.op).toBe('add');
    expect(c.items.map((i) => i.id)).toEqual(['w']);
    const after = worldParts(c)[0]!.ring;
    after.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(before[i]![0], 6);
      expect(p[1]).toBeCloseTo(before[i]![1], 6);
    });
  });

  it('a building keeps at least one volume', () => {
    const a = building({ solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] } })] });
    expect(separateSolids(a, [a.solids[0]!.id], (input) => building(input))).toBeNull();
  });
});
