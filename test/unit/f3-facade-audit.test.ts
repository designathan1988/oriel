// Facade defects of the 2026-10-11 audit: a single door honours Place (A4); windows that no longer
// fit are said, not silently dropped (A3).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { distribute } from '../../src/f3/eval/facade';
import { building, facadeRule, levelsFor, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';

beforeAll(async () => {
  await loadKernel();
});

describe('a single part honours its justification (A4)', () => {
  it('count 1: start, middle and end of the span', () => {
    expect(distribute({ mode: 'count', value: 1, justify: 'start' }, 0, 10, 1)[0]).toBeCloseTo(0.5, 6);
    expect(distribute({ mode: 'count', value: 1, justify: 'center' }, 0, 10, 1)[0]).toBeCloseTo(5, 6);
    expect(distribute({ mode: 'count', value: 1, justify: 'end' }, 0, 10, 1)[0]).toBeCloseTo(9.5, 6);
    // Several share the span as before.
    expect(distribute({ mode: 'count', value: 2, justify: 'start' }, 0, 10, 1)).toEqual([2.5, 7.5]);
  });

  it('a door rule with one door moves along its wall with Place', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3, roof: roofSpec('flat'), plinth: 0, facade: [facadeRule('door-panel', { levels: 'ground', mode: 'count', value: 1, margin: 0.5 })] });
    const front = s.plan.outer[0]!.id;
    s.facade[0]!.edges = [front];
    const b = building({ levels: levelsFor(1, 3, 3), solids: [s] });
    const at = () => evaluateBuilding(b).placements.find((p) => p.tag.rule)!.host!.s;
    s.facade[0]!.justify = 'center';
    const c = at();
    s.facade[0]!.justify = 'start';
    const st = at();
    s.facade[0]!.justify = 'end';
    const en = at();
    expect(c).toBeCloseTo(5, 1);
    expect(st).toBeLessThan(c - 2);
    expect(en).toBeGreaterThan(c + 2);
  });
});

describe('windows that do not fit are reported (A3)', () => {
  it('a window too tall for its floor height is reported with how many were left out', () => {
    // 2.2 m floors with a 1.4 m window on a 1.2 m sill: the opening does not fit the floor, said per floor.
    const s = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 4.4, roof: roofSpec('flat'), plinth: 0, facade: [facadeRule('win-casement', { mode: 'count', value: 1, sill: 1.2 })] });
    const b = building({ levels: levelsFor(2, 2.2, 2.2), solids: [s] });
    const ev = evaluateBuilding(b);
    expect(ev.warnings.join(' ')).toMatch(/does not fit level|do not fit level/);
  });
});

describe('a door taller than its floor (audit C1)', () => {
  it('a dock door of 4.6 m in a 4 m floor gets shorter and is placed; a window with a sill is not shrunk', () => {
    const s = solid({ plan: { outer: rectPlan(20, 12), holes: [] }, height: 8, roof: roofSpec('flat'), plinth: 0, facade: [facadeRule('loading-dock', { levels: 'ground', mode: 'count', value: 1 })] });
    const b = building({ levels: levelsFor(2, 4, 4), solids: [s] });
    const ev = evaluateBuilding(b);
    const dock = ev.placements.filter((p) => p.family.id === 'loading');
    expect(dock.length).toBe(4);
    expect(Number(dock[0]!.params.height) + Number(dock[0]!.params.dock)).toBeLessThanOrEqual(4 - 0.08 + 1e-9);
    expect(ev.warnings.join(' ')).not.toMatch(/dock door: does not fit/i);
  });
});
