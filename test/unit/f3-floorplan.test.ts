import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { floorPlan } from '../../src/f3/eval/floorplan';
import { floorPlanSvg } from '../../src/f3/eval/floorplansvg';
import { TEMPLATES } from '../../src/f3/io/templates';

beforeAll(async () => {
  await loadKernel();
});

describe('floor plan', () => {
  it('the single-storey house: cut walls, its four rooms by name with their areas, openings and dimensions', () => {
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    const b = p.buildings[0]!;
    const ev = evaluateBuilding(b, {}, p);
    const fp = floorPlan(b, 0, ev.placements);
    expect(fp.walls.length).toBeGreaterThan(0);
    const names = fp.rooms.map((r) => r.name).filter(Boolean).sort();
    expect(names).toEqual(['Banheiro', 'Quarto 1', 'Quarto 2', 'Sala e cozinha']);
    const total = fp.rooms.reduce((s, r) => s + r.area, 0);
    // 12 × 9 outside, 15 cm walls: under the inner area, over 90 % of it.
    expect(total).toBeLessThan(11.7 * 8.7);
    expect(total).toBeGreaterThan(0.9 * 11.7 * 8.7);
    expect(fp.windows.length + fp.doors.length).toBeGreaterThan(2);
    const overall = fp.dims.filter((d) => d.tier === 1).map((d) => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1])).sort((a, c) => a - c);
    expect(overall[0]).toBeCloseTo(9, 1);
    expect(overall[1]).toBeCloseTo(12, 1);
    const { svg } = floorPlanSvg(fp, { title: 'Planta', decimal: ',' });
    expect(svg).toContain('Quarto 1');
    expect(svg).toContain('12,00');
  });
});

describe('interior walls stay a connected plan', () => {
  it('a wall started on the middle of another splits it (T); a wall across another splits both (X)', async () => {
    const { building, rectPlan, solid } = await import('../../src/f3/model/defaults');
    const { addInteriorWall, interiorOf } = await import('../../src/f3/eval/interiorwalls');
    let n = 0;
    const uid = () => `id${n++}`;
    const b = building({ name: 'B', solids: [solid({ name: 'S', plan: { outer: rectPlan(10, 10), holes: [] }, height: 3 })] });
    const lv = b.levels[0]!.id;
    addInteriorWall(b, lv, [0, -4], [0, 4], 0.12, uid);
    addInteriorWall(b, lv, [0.08, 0], [4, 0], 0.12, uid);
    const it = interiorOf(b, lv);
    expect(it.walls.length).toBe(3);
    expect(it.nodes.some((x) => x.p[0] === 0 && x.p[1] === 0)).toBe(true);
    addInteriorWall(b, lv, [2, -3], [2, 3], 0.12, uid);
    // The horizontal one split at x = 2, the new one split at z = 0: 3 + 1 + 2.
    expect(it.walls.length).toBe(6);
  });
});
