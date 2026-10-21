// Relations kept after every edit (model/relations.ts through the Store): the defects found by
// the 2026-10-11 audit (B1, C1/A1, D3, D2, E2) as checks.
import { describe, expect, it } from 'vitest';
import { building, levelsFor, project, rectPlan, roofSpec, solid, uid, facadeRule } from '../../src/f3/model/defaults';
import { Store } from '../../src/f3/editor/store';
import { changeLevels, setLevelHeights, setbackOn } from '../../src/f3/model/quick';
import { relationWarnings, resolveBuilding, nearestAnchor } from '../../src/f3/model/relations';
import type { Building3, Solid } from '../../src/f3/model/schema';

const bodyTop = (b: Building3) => Math.max(...b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height));
const edit = (st: Store, b: Building3, fn: (b: Building3) => void) => {
  fn(b);
  st.commit([b.id]);
};

describe('volumes resting on another (D3)', () => {
  it('the upper volume goes up with the bar when the bar height changes, by any path, and keeps its own height', () => {
    const bar = solid({ plan: { outer: rectPlan(24, 12), holes: [] }, height: 9, roof: roofSpec('flat') });
    const up = solid({ plan: { outer: rectPlan(12, 8, 6, 0), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(5, 3, 3), solids: [bar, up] });
    const st = new Store(project({ buildings: [b] }));
    const B = st.project.buildings[0]!;
    expect(B.solids[1]!.on).toBe(B.solids[0]!.id);
    edit(st, B, (x) => void (x.solids[0]!.height = 11));
    expect(B.solids[1]!.base).toBeCloseTo(11, 6);
    expect(B.solids[1]!.height).toBeCloseTo(6, 6);
    // Moving it sideways keeps it on the bar; half off the bar it still rests on it.
    edit(st, B, (x) => x.solids[1]!.plan.outer.forEach((v) => (v.p = [v.p[0] + 6, v.p[1]])));
    expect(B.solids[1]!.on).toBe(B.solids[0]!.id);
    edit(st, B, (x) => void (x.solids[0]!.height = 8));
    expect(B.solids[1]!.base).toBeCloseTo(8, 6);
    // Undo walks back exactly.
    st.undo();
    expect(st.project.buildings[0]!.solids[1]!.base).toBeCloseTo(11, 6);
  });

  it('a rider lifted on its own leaves the support (it is not pulled back)', () => {
    const bar = solid({ plan: { outer: rectPlan(24, 12), holes: [] }, height: 9, roof: roofSpec('flat') });
    const up = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') });
    const st = new Store(project({ buildings: [building({ levels: levelsFor(3, 3, 3), solids: [bar, up] })] }));
    const B = st.project.buildings[0]!;
    edit(st, B, (x) => void (x.solids[1]!.base = 12));
    expect(B.solids[1]!.base).toBe(12);
    expect(B.solids[1]!.on).toBeUndefined();
  });

  it('a support that goes leaves an identified relation that comes back with undo', () => {
    const bar = solid({ plan: { outer: rectPlan(24, 12), holes: [] }, height: 9, roof: roofSpec('flat') });
    const up = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') });
    const st = new Store(project({ buildings: [building({ levels: levelsFor(3, 3, 3), solids: [bar, up] })] }));
    const B = st.project.buildings[0]!;
    const supId = B.solids[0]!.id;
    edit(st, B, (x) => void x.solids.splice(0, 1));
    const after = st.project.buildings[0]!;
    expect(after.solids[0]!.on).toBe(supId);
    expect(after.solids[0]!.base).toBe(9);
    expect(relationWarnings(after).join(' ')).toMatch(/rested on is gone/);
    st.undo();
    const back = st.project.buildings[0]!;
    expect(relationWarnings(back)).toEqual([]);
    edit(st, back, (x) => void (x.solids[0]!.height = 10));
    expect(back.solids[1]!.base).toBeCloseTo(10, 6);
  });
});

describe('floors and volume heights (B1, B4, C2)', () => {
  it('more floors on a building with a setback: the body grows and the setback rides on it', () => {
    const body = solid({ plan: { outer: rectPlan(20, 15), holes: [] }, height: 31.8, roof: roofSpec('flat'), facade: [facadeRule('win-sliding', { mode: 'spacing', value: 2.4 })] });
    const b = building({ levels: [4.5, ...Array(7).fill(3.9)].reduce((acc: { id: string; name: string; elevation: number; height: number }[], h: number, i) => (acc.push({ id: uid(), name: i ? `Floor ${i}` : 'Ground', elevation: acc.length ? acc[acc.length - 1]!.elevation + acc[acc.length - 1]!.height : 0, height: h }), acc), []), solids: [body] });
    const st = new Store(project({ buildings: [b] }));
    const B = st.project.buildings[0]!;
    edit(st, B, (x) => void setbackOn(x, x.solids[0]!));
    const set = B.solids[1]!;
    expect(set.on).toBe(B.solids[0]!.id);
    const n0 = B.levels.length;
    const top0 = bodyTop(B);
    edit(st, B, (x) => void changeLevels(x, 12 - n0));
    expect(B.levels).toHaveLength(12);
    // Every floor added is a typical floor of 3.9 m: the drawing has the floors the bar says.
    expect(bodyTop(B) - top0).toBeCloseTo((12 - n0) * 3.9, 4);
    expect(B.solids[1]!.base).toBeCloseTo(B.solids[0]!.base + B.solids[0]!.height, 6);
  });

  it('a new ground floor height moves the volumes with their floors, with no excess growing', () => {
    const house = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('gable') });
    const tower = solid({ plan: { outer: rectPlan(3, 3), holes: [] }, height: 11, roof: roofSpec('pyramid') });
    const st = new Store(project({ buildings: [building({ solids: [house, tower], levels: levelsFor(2, 3, 3) })] }));
    const B = st.project.buildings[0]!;
    edit(st, B, (x) => setLevelHeights(x, 2, 5, 3));
    expect(B.solids[0]!.height).toBeCloseTo(8, 6);
    // The tower keeps its 5 m above the roof.
    expect(B.solids[1]!.height - B.solids[0]!.height).toBeCloseTo(5, 6);
  });

  it('opening a project changes no floor and no height', () => {
    const house = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('gable') });
    const tower = solid({ plan: { outer: rectPlan(3, 3), holes: [] }, height: 11, roof: roofSpec('pyramid') });
    const p = project({ buildings: [building({ solids: [house, tower], levels: levelsFor(2, 3, 3) })] });
    const json = JSON.stringify(p.buildings[0]!.levels);
    const st = new Store(p);
    const B = st.project.buildings[0]!;
    expect(JSON.stringify(B.levels)).toBe(json);
    expect(B.solids.map((s) => s.height)).toEqual([6, 11]);
  });
});

describe('cutters through a curved wall (D2)', () => {
  it('when the wall bulges further out, the cutter still goes through it', () => {
    const bar = solid({ plan: { outer: rectPlan(24, 12), holes: [] }, height: 9, roof: roofSpec('flat') });
    // Front side: from (12, 6) to (-12, 6) (counterclockwise with z down is the +z side).
    const cut = solid({ op: 'subtract', plan: { outer: rectPlan(4, 10, 0, 8), holes: [] }, height: 3.5, roof: roofSpec('flat') });
    const st = new Store(project({ buildings: [building({ levels: levelsFor(3, 3, 3), solids: [bar, cut] })] }));
    const B = st.project.buildings[0]!;
    const c = B.solids[1]!;
    expect(c.through?.solid).toBe(B.solids[0]!.id);
    const front = B.solids[0]!.plan.outer.find((v) => v.id === c.through!.edge)!;
    const maxZ = (s: Solid) => Math.max(...s.plan.outer.map((v) => v.p[1]));
    const z0 = maxZ(c);
    // Bulge the front side out by 7 m at the middle: tan(θ/4) with sagitta 7 on a 24 m chord.
    const theta = 4 * Math.atan((2 * 7) / 24);
    edit(st, B, (x) => void (x.solids[0]!.plan.outer.find((v) => v.id === front.id)!.bulge = Math.tan(theta / 4)));
    // The wall reached z = 6 + 7 = 13 at the middle; the cutter end moved out by as much as the wall did inside its span.
    expect(maxZ(B.solids[1]!)).toBeGreaterThan(13.2);
    expect(maxZ(B.solids[1]!) - z0).toBeGreaterThan(6.5);
    // Its inner end stayed.
    expect(Math.min(...B.solids[1]!.plan.outer.map((v) => v.p[1]))).toBeCloseTo(3, 6);
  });
});

describe('parts on a side keep their anchor (E2)', () => {
  it('nearest anchor with ties to the ends (Lipp et al.)', () => {
    expect(nearestAnchor(1, 20)).toBe('start');
    expect(nearestAnchor(10, 20)).toBe('center');
    expect(nearestAnchor(18, 20)).toBe('end');
    expect(nearestAnchor(5, 20)).toBe('start');
  });

  it('a centered window stays centered when the width changes from the center; one near the end keeps its distance to it', () => {
    const s = solid({ plan: { outer: rectPlan(20, 10), holes: [] }, height: 3, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(1, 3, 3), solids: [s] });
    const e = s.plan.outer[0]!.id; // from (-10, -5) to (10, -5)
    b.items.push({ id: uid(), type: 'win-casement', params: {}, host: { kind: 'face', solid: s.id, edge: e, u: 10, y: 1 } });
    b.items.push({ id: uid(), type: 'win-casement', params: {}, host: { kind: 'face', solid: s.id, edge: e, u: 18, y: 1 } });
    const st = new Store(project({ buildings: [b] }));
    const B = st.project.buildings[0]!;
    // Width 20 → 30 from the center.
    edit(st, B, (x) => x.solids[0]!.plan.outer.forEach((v) => (v.p = [v.p[0] * 1.5, v.p[1]])));
    const [c, n] = B.items.map((i) => (i.host.kind === 'face' ? i.host.u : NaN));
    expect(c).toBeCloseTo(15, 6);
    expect(n).toBeCloseTo(28, 6);
  });
});

describe('volumes made on a side follow their wall (audit C4)', () => {
  it('an annex in the middle of a wall stays in the middle when the width grows from the center, and moves out with the wall', async () => {
    const { extrudeSide, setSolidSize } = await import('../../src/f3/model/modeling');
    const { pushEdge } = await import('../../src/f3/model/ops');
    const body = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(2, 3, 3), solids: [body] });
    const st = new Store(project({ buildings: [b] }));
    const B = st.project.buildings[0]!;
    // The south side (z = -4): an annex 3 m deep over the whole side... narrowed to its middle 4 m.
    const south = B.solids[0]!.plan.outer[0]!.id;
    edit(st, B, (x) => void extrudeSide(x, x.solids[0]!, south, 3));
    const annex = B.solids[1]!;
    expect(annex.host).toEqual({ solid: B.solids[0]!.id, edge: south });
    edit(st, B, (x) => void setSolidSize(x.solids[1]!, 4, 3));
    const cx = (s: Solid) => s.plan.outer.reduce((a, v) => a + v.p[0], 0) / s.plan.outer.length;
    const minZ = (s: Solid) => Math.min(...s.plan.outer.map((v) => v.p[1]));
    const x0 = cx(B.solids[1]!),
      z0 = minZ(B.solids[1]!);
    // The body gets wider from its center (24 m): the annex keeps its place in the middle of the side.
    edit(st, B, (x) => void setSolidSize(x.solids[0]!, 24, 8));
    expect(cx(B.solids[1]!)).toBeCloseTo(x0, 6);
    // The wall moves out 2 m: the annex goes with it (not swallowed by the body).
    edit(st, B, (x) => void pushEdge(x.solids[0]!, south, 2));
    expect(minZ(B.solids[1]!)).toBeCloseTo(z0 - 2, 6);
    expect(Math.max(...B.solids[1]!.plan.outer.map((v) => v.p[1]))).toBeCloseTo(-6, 6);
    // Undo walks back.
    st.undo();
    expect(minZ(st.project.buildings[0]!.solids[1]!)).toBeCloseTo(z0, 6);
  });
});

describe('resolve is cheap when nothing changed', () => {
  it('a second resolve with the same reference changes nothing', () => {
    const bar = solid({ plan: { outer: rectPlan(24, 12), holes: [] }, height: 9, roof: roofSpec('flat') });
    const up = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, base: 9, height: 6, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(5, 3, 3), solids: [bar, up] });
    resolveBuilding(b, undefined, uid);
    const json = JSON.stringify(b);
    resolveBuilding(b, structuredClone(b), uid);
    expect(JSON.stringify(b)).toBe(json);
  });
});

describe('cut top direction (audit D1)', () => {
  it('an arch cutter through a wall turns to show its arch on that wall; alone, along its longer side', async () => {
    const { cutTopDirection } = await import('../../src/f3/model/relations');
    const { building, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const wall = solid({ plan: { outer: rectPlan(20, 10), holes: [] }, height: 6, roof: roofSpec('flat') });
    // A 4 × 10 m cutter (deep along z) through the front wall (the side along x).
    const cut = solid({ op: 'subtract', plan: { outer: rectPlan(4, 10, 0, 4), holes: [] }, height: 4, roof: roofSpec('flat') });
    const b = building({ solids: [wall, cut] });
    expect(cutTopDirection(b, cut)).toBe(90);
    const front = wall.plan.outer.find((v, i) => {
      const n = wall.plan.outer[(i + 1) % wall.plan.outer.length]!;
      return Math.abs(v.p[1] - n.p[1]) < 1e-9 && v.p[1] > 0;
    })!;
    cut.through = { solid: wall.id, edge: front.id };
    expect(cutTopDirection(b, cut)).toBe(90);
    const wide = solid({ op: 'subtract', plan: { outer: rectPlan(10, 4), holes: [] }, height: 4, roof: roofSpec('flat') });
    expect(cutTopDirection(building({ solids: [wall, wide] }), wide)).toBe(0);
  });
});
