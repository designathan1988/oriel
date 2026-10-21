import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { building, facadeRule, levelsFor, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { dimParams, partBox } from '../../src/f3/eval/partsize';
import { shellCutter, withModifiers } from '../../src/f3/eval/modifiers';
import { family } from '../../src/f3/families/index';
import { resolveParams } from '../../src/f3/families/family';
import { parseProfile } from '../../src/f3/families/fences';

beforeAll(async () => {
  await loadKernel();
});

describe('size handles for any part', () => {
  it('find the parameter behind each side of a tree, a bench and a pool', () => {
    for (const id of ['tree-deciduous', 'bench', 'pool']) {
      const f = family(id);
      if (!f) continue;
      const p = resolveParams(f, {});
      const box = partBox(f, p)!;
      expect(box.max[1]).toBeGreaterThan(box.min[1]);
      const dims = dimParams(f, p);
      expect(dims.length).toBeGreaterThan(0);
      for (const d of dims) {
        // Nudging the parameter moves that side by about slope × change.
        const nb = partBox(f, { ...p, [d.key]: (p[d.key] as number) + 0.1 })!;
        const moved = d.side > 0 ? nb.max[d.axis]! - box.max[d.axis]! : box.min[d.axis]! - nb.min[d.axis]!;
        expect(moved).toBeCloseTo(d.slope * 0.1, 1);
      }
    }
  });
});

describe('one rule element sized at its position only', () => {
  it('changes that window and no other', () => {
    const s = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('flat') });
    s.facade = [facadeRule('win-casement', { levels: 'all', mode: 'count', value: 3 })];
    const b = building({ solids: [s] });
    const ev = evaluateBuilding(b);
    const one = ev.placements.find((q) => q.tag.rule === s.facade[0]!.id)!;
    s.facade[0]!.sizes = { [one.tag.key!]: { width: 0.6 } };
    const ev2 = evaluateBuilding(b);
    const widths = ev2.placements.filter((q) => q.tag.rule === s.facade[0]!.id).map((q) => q.params.width);
    expect(widths.filter((w) => w === 0.6)).toHaveLength(1);
    expect(widths.filter((w) => w !== 0.6).length).toBe(widths.length - 1);
  });
});

describe('hollow shell and sweep', () => {
  it('a hollow volume keeps its outside and loses its inside', () => {
    const s = solid({ plan: { outer: rectPlan(10, 10), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) });
    s.shell = 0.3;
    const cut = shellCutter(s)!;
    expect(cut.op).toBe('subtract');
    expect(cut.base).toBeCloseTo(0.3, 6);
    expect(cut.height).toBeCloseTo(5.4, 6);
    expect(Math.max(...cut.plan.outer.map((v) => v.p[0]))).toBeCloseTo(4.7, 6);
    // One floor: one cutter. Two floors (3.4 m apart): a cutter per floor, the slab between them kept.
    expect(withModifiers(building({ solids: [s], levels: levelsFor(1, 6, 6) })).solids).toHaveLength(2);
    const two = withModifiers(building({ solids: [s] })).solids.filter((x) => x.op === 'subtract');
    expect(two.map((x) => [x.base, x.base + x.height].map((v) => +v.toFixed(2)))).toEqual([[0.3, 3.4], [3.7, 5.7]]);
    const ev = evaluateBuilding(building({ solids: [s] }));
    expect(ev.warnings).toEqual([]);
  });

  it('a typed profile reads as points; the sweep builds along a path', () => {
    expect(parseProfile('0,0; 0,0.3; 0.2,0.3')).toEqual([[0, 0], [0, 0.3], [0.2, 0.3]]);
    expect(parseProfile('0,0; x')).toBeNull();
    const f = family('sweep')!;
    const box = partBox(f, resolveParams(f, {}), 4)!;
    expect(box.max[1]).toBeCloseTo(0.8, 2);
  });
});

describe('structure and floors', () => {
  it('a column grid stays inside the volume and repeats on every floor', async () => {
    const { columnGrid, gridPoints } = await import('../../src/f3/model/structure');
    const { levelsFor } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(24, 18), holes: [] }, height: 9, roof: roofSpec('flat') });
    const pts = gridPoints(s, 6);
    expect(pts).toHaveLength(3 * 2);
    for (const p of pts) expect(Math.abs(p[0]) < 12 && Math.abs(p[1]) < 9).toBe(true);
    const b = building({ solids: [s], levels: levelsFor(3, 3, 3) });
    const cols = columnGrid(b, s, 6, 'column-square', () => Math.random().toString(36));
    expect(cols).toHaveLength(18);
    expect(cols[0]!.params.height).toBeCloseTo(2.75, 6);
  });

  it('one floor taller moves the floors above', async () => {
    const { setOneLevelHeight } = await import('../../src/f3/model/quick');
    const { levelsFor } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(10, 10), holes: [] }, height: 9, roof: roofSpec('flat') });
    const b = building({ solids: [s], levels: levelsFor(3, 3, 3) });
    setOneLevelHeight(b, 1, 4);
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    expect(lv.map((l) => l.elevation)).toEqual([0, 3, 7]);
    expect(lv[1]!.height).toBe(4);
  });
});

describe('project material library', () => {
  it('changes every face that carries a material at once', async () => {
    const { replaceMaterial, materialUses } = await import('../../src/f3/model/matlib');
    const { project } = await import('../../src/f3/model/defaults');
    const a = solid({ plan: { outer: rectPlan(10, 10), holes: [] }, height: 6, roof: roofSpec('flat') });
    const brick = { finish: 'brick', color: '#a0522d' };
    a.materials.wall = { ...brick };
    a.edges[a.plan.outer[0]!.id] = { material: { ...brick } };
    const p = project({ buildings: [building({ solids: [a] })] });
    expect(materialUses(p, brick)).toBe(2);
    const r = replaceMaterial(p, brick, { finish: 'plaster', color: '#eeeeee' });
    expect(r.count).toBe(2);
    expect(materialUses(p, brick)).toBe(0);
    expect(a.materials.wall.finish).toBe('plaster');
  });
});
