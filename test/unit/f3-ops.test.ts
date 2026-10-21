import { describe, expect, it } from 'vitest';
import { building, rectPlan, solid } from '../../src/f3/model/defaults';
import { bendEdge, cloneSolid, mirrorSolid, moveVertex, planValid, pushEdge, removeVertex, rotateSolid, splitEdge, toLocal, toWorld } from '../../src/f3/model/ops';
import { oriented, sampleRing, signedArea2 } from '../../src/f3/model/plan';

const area = (s: ReturnType<typeof solid>) => Math.abs(signedArea2(sampleRing(oriented(s.plan.outer, 1)).pts));

describe('forma/3 operations', () => {
  it('local ↔ world are inverses with rotation', () => {
    const b = building({ position: [10, -4], rotation: 37 });
    const w = toWorld(b, [3, 5]);
    const l = toLocal(b, w);
    expect(l[0]).toBeCloseTo(3);
    expect(l[1]).toBeCloseTo(5);
  });

  it('pushing a side outward grows the area by length × distance', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    expect(pushEdge(s, s.plan.outer[0]!.id, 2)).toBe(true);
    expect(area(s)).toBeCloseTo(100);
    expect(pushEdge(s, s.plan.outer[1]!.id, -3)).toBe(true);
    expect(area(s)).toBeCloseTo(70);
  });

  it('pulling too far is refused (invalid plan)', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    expect(pushEdge(s, s.plan.outer[0]!.id, -9)).toBe(false);
    expect(area(s)).toBeCloseTo(80);
  });

  it('dragging the middle of a side outward bends the side outward', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    // Side 0 goes from (-5,-4) to (5,-4); outward is negative z.
    expect(bendEdge(s, s.plan.outer[0]!.id, [0, -6])).toBe(true);
    expect(area(s)).toBeGreaterThan(80 + 10);
    expect(bendEdge(s, s.plan.outer[0]!.id, [0, -2])).toBe(true);
    expect(area(s)).toBeLessThan(80 - 10);
  });

  it('splitting, moving and removing a vertex keeps the plan valid', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    const v = splitEdge(s, s.plan.outer[0]!.id)!;
    expect(s.plan.outer).toHaveLength(5);
    expect(moveVertex(s, v, [0, -7])).toBe(true);
    expect(area(s)).toBeCloseTo(80 + 15);
    expect(removeVertex(s, v)).toBe(true);
    expect(area(s)).toBeCloseTo(80);
  });

  it('splitting a curved side gives two arcs of the same circle (same area) and keeps its rules on both', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    const e = s.plan.outer[0]!.id;
    s.plan.outer[0]!.bulge = 0.4;
    s.facade = [{ id: 'r', type: 'win-casement', levels: 'all', edges: [e], mode: 'max', value: 3, margin: 0.8, sill: NaN, justify: 'center', except: {}, params: {} }];
    const a0 = area(s);
    const v = splitEdge(s, e)!;
    expect(s.plan.outer).toHaveLength(5);
    expect(area(s)).toBeCloseTo(a0, 1);
    expect(s.facade[0]!.edges).toEqual([e, v]);
  });

  it('mirror keeps an arc bulging outward (the same area)', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    s.plan.outer[0]!.bulge = 0.4;
    const a0 = area(s);
    mirrorSolid(s, 'x');
    expect(area(s)).toBeCloseTo(a0, 3);
    mirrorSolid(s, 'z');
    expect(area(s)).toBeCloseTo(a0, 3);
  });

  it('rotate, mirror and clone keep the area and validity', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] } });
    rotateSolid(s, 30);
    mirrorSolid(s, 'x');
    expect(planValid(s.plan)).toBe(true);
    expect(area(s)).toBeCloseTo(80);
    const c = cloneSolid(s);
    expect(c.id).not.toBe(s.id);
    expect(c.plan.outer.map((v) => v.id)).not.toEqual(s.plan.outer.map((v) => v.id));
    expect(area(c)).toBeCloseTo(80);
  });
});

describe('building use', () => {
  it('Commercial changes heights (CTBUH), the ground floor becomes a shopfront and windows become sliding; the volume follows', async () => {
    const { applyUse } = await import('../../src/f3/model/quick');
    const { facadeRule, levelsFor, roofSpec } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 9, roof: roofSpec('flat'), facade: [facadeRule('door-panel', { levels: 'ground', mode: 'count', value: 1 }), facadeRule('win-casement', { mode: 'max', value: 3 }), facadeRule('balcony-glass', { levels: 'upper', mode: 'max', value: 3 })] });
    const b = building({ solids: [s], levels: levelsFor(3, 3, 3) });
    const msg = applyUse(b, 'commercial', (t) => t.startsWith('win-'));
    expect(b.use).toBe('commercial');
    expect(b.levels.map((l) => l.height)).toEqual([4.5, 3.9, 3.9]);
    expect(b.solids[0]!.height).toBeCloseTo(12.3);
    const types = b.solids[0]!.facade.map((r) => r.type);
    expect(types).toEqual(['shopfront', 'win-sliding', 'balcony-glass']);
    expect(msg).toContain('Commercial');
  });
  it('a tower that rose above the roof still does after the heights change', async () => {
    const { applyUse } = await import('../../src/f3/model/quick');
    const { levelsFor, roofSpec } = await import('../../src/f3/model/defaults');
    const house = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('gable') });
    const tower = solid({ plan: { outer: rectPlan(3, 3), holes: [] }, height: 11, roof: roofSpec('pyramid') });
    const b = building({ solids: [house, tower], levels: levelsFor(2, 3, 3) });
    applyUse(b, 'commercial', () => false);
    const [h, t] = b.solids;
    expect(h!.height).toBeCloseTo(8.4);
    // The 5 m above the roof stay 5 m (Revit Top Offset): before they were scaled by the floor ratio,
    // an excess nobody asked for.
    expect(t!.height).toBeCloseTo(13.4);
    expect(t!.height - h!.height).toBeCloseTo(5);
  });

  it('industrial: a shed up to 12 m becomes one floor of its own height (audit C1), the tower above it stays', async () => {
    const { applyUse } = await import('../../src/f3/model/quick');
    const { levelsFor, roofSpec } = await import('../../src/f3/model/defaults');
    const shed = solid({ plan: { outer: rectPlan(20, 12), holes: [] }, height: 8, roof: roofSpec('flat') });
    const tower = solid({ plan: { outer: rectPlan(3, 3), holes: [] }, height: 13, roof: roofSpec('pyramid') });
    const b = building({ solids: [shed, tower], levels: levelsFor(2, 4, 4) });
    const msg = applyUse(b, 'industrial', () => false);
    expect(b.levels).toHaveLength(1);
    expect(b.levels[0]!.height).toBeCloseTo(8);
    expect(b.solids[0]!.height).toBeCloseTo(8);
    expect(b.solids[1]!.height).toBeCloseTo(13);
    expect(msg).toMatch(/one floor of 8 m/);
  });
});

describe('editor history', () => {
  it('revert without a change notifies nothing; with a change it re-evaluates only the changed building', async () => {
    const { Store } = await import('../../src/f3/editor/store');
    const { project } = await import('../../src/f3/model/defaults');
    const a = building({ name: 'A' }),
      b = building({ name: 'B' });
    const st = new Store(project({ buildings: [a, b] }));
    const events: (string[] | null)[] = [];
    st.on((e) => e.kind === 'change' && events.push(e.ids));
    st.revert();
    expect(events).toEqual([]);
    st.project.buildings[1]!.position = [5, 5];
    st.revert();
    expect(events).toEqual([[b.id]]);
    expect(st.project.buildings[1]!.position).toEqual([0, 0]);
  });
});

