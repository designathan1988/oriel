import { describe, expect, it } from 'vitest';
import { building, levelsFor, project, rectPlan, solid } from '../../src/f3/model/defaults';
import { terrainField } from '../../src/f3/model/terrain';
import { validateForma3 } from '../../src/f3/io/migrate';

describe('terrainField', () => {
  it('flat without points', () => {
    expect(terrainField(project())).toBeNull();
  });
  it('passes through its points and comes back to 0 far away', () => {
    const p = project();
    p.terrain = { points: [{ id: 'a', p: [0, 0], y: 4 }, { id: 'b', p: [20, 0], y: -2 }] };
    const t = terrainField(p)!;
    expect(t.at(0, 0)).toBeCloseTo(4);
    expect(t.at(20, 0)).toBeCloseTo(-2);
    expect(t.at(0, 100)).toBeCloseTo(0);
    expect(t.at(10, 0)).toBeGreaterThan(-2);
    expect(t.at(10, 0)).toBeLessThan(4);
  });
  it('a building keeps a flat pad at its level, sloping out to the natural ground', () => {
    const p = project();
    p.terrain = { points: [{ id: 'a', p: [0, 0], y: 4 }] };
    p.buildings = [building({ position: [0, 0], levels: levelsFor(1), solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3 })] })];
    const t = terrainField(p)!;
    expect(t.at(0, 0)).toBeCloseTo(0);
    expect(t.at(5.3, 0)).toBeCloseTo(0);
    expect(t.at(14, 0)).toBeGreaterThan(1);
  });
  it('the document check accepts a terrain and refuses a bad point', () => {
    const p = project();
    p.terrain = { points: [{ id: 'a', p: [0, 0], y: 4 }] };
    expect(validateForma3(p).filter((x) => /terrain/i.test(x))).toEqual([]);
    p.terrain.points[0]!.y = Number.NaN;
    expect(validateForma3(p).some((x) => /terrain/i.test(x))).toBe(true);
  });
});
