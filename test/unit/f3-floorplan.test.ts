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
  it('the single-storey house: cut walls, its five rooms by name, furniture seen from above with their areas, openings and dimensions', () => {
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    const b = p.buildings[0]!;
    const ev = evaluateBuilding(b, {}, p);
    const fp = floorPlan(b, 0, ev.placements);
    expect(fp.walls.length).toBeGreaterThan(0);
    const names = fp.rooms.map((r) => r.name).filter(Boolean).sort();
    expect(names).toEqual(['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Hall', 'Living and kitchen']);
    const total = fp.rooms.reduce((s, r) => s + r.area, 0);
    // 12 × 9 outside, 15 cm walls: under the inner area, over 90 % of it.
    expect(total).toBeLessThan(11.7 * 8.7);
    expect(total).toBeGreaterThan(0.9 * 11.7 * 8.7);
    expect(fp.windows.length + fp.doors.length).toBeGreaterThan(2);
    const len = (d: (typeof fp.dims)[number]) => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
    const outer = (side: string) => Math.max(...fp.dims.filter((d) => d.side === side).map((d) => d.tier));
    const overall = fp.dims.filter((d) => (d.side === 'bottom' || d.side === 'right') && d.tier === outer(d.side)).map(len).sort((a, c) => a - c);
    // The openings chain next to the wall: jamb to jamb, adding up to the whole side.
    for (const side of ['bottom', 'top', 'left', 'right']) {
      const chain = fp.dims.filter((d) => d.side === side && d.tier === 0);
      if (chain.length) expect(chain.reduce((s, d) => s + len(d), 0)).toBeCloseTo(side === 'bottom' || side === 'top' ? 12 : 9, 1);
    }
    expect(fp.dims.filter((d) => d.tier === 0).length).toBeGreaterThan(6);
    expect(overall[0]).toBeCloseTo(9, 1);
    expect(overall[1]).toBeCloseTo(12, 1);
    // Furniture: one symbol per piece (sofa, beds, table and chairs, kitchen, bathroom), all in the outline.
    expect(fp.symbols.length).toBe(b.items.length);
    for (const sym of fp.symbols) for (const st of sym.strokes) for (const p2 of st.pts) {
      expect(p2[0]).toBeGreaterThan(-6);
      expect(p2[0]).toBeLessThan(6);
      expect(p2[1]).toBeGreaterThan(-4.5);
      expect(p2[1]).toBeLessThan(4.5);
    }
    expect(fp.doors.length).toBeGreaterThanOrEqual(5);
    const { svg } = floorPlanSvg(fp, { title: 'Planta', decimal: ',' });
    expect(svg).toContain('Bedroom 1');
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

describe('quantities', () => {
  it('the single-storey house: areas, walls less openings, roof bigger than the plan, openings counted', async () => {
    const { buildingQuantities } = await import('../../src/f3/eval/quantities');
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    const b = p.buildings[0]!;
    const ev = evaluateBuilding(b, {}, p);
    const q = buildingQuantities(b, ev, [floorPlan(b, 0, ev.placements)]);
    const get = (k: string) => q.find((l) => l.key === k)!.qty;
    expect(get('gross')).toBeCloseTo(108, 0);
    // 42 m around × 2.8 m high, less the openings.
    expect(get('wall-ext')).toBeLessThan(42 * 2.8);
    expect(get('wall-ext')).toBeGreaterThan(42 * 2.8 * 0.6);
    expect(get('roof')).toBeGreaterThan(108);
    expect(q.filter((l) => l.group === 'Windows and doors').reduce((s, l) => s + l.qty, 0)).toBe(19);
  });
});

describe('code check', () => {
  it('reads the use from the name and flags a bedroom without enough window', async () => {
    const { checkFloor, roomUse } = await import('../../src/f3/eval/compliance');
    expect(roomUse('Quarto 2')).toBe('bedroom');
    expect(roomUse('Suíte master')).toBe('bedroom');
    expect(roomUse('Lavabo')).toBe('bath');
    expect(roomUse('Sala e cozinha')).toBe('living');
    expect(roomUse('Lavatory and laundry')).toBe('bath');
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    const b = p.buildings[0]!;
    const ev = evaluateBuilding(b, {}, p);
    const fp = floorPlan(b, 0, ev.placements);
    expect(checkFloor(b, fp).every((c) => c.ok)).toBe(true);
    // Without the facade windows the bedrooms have none.
    const bare = floorPlan(b, 0, []);
    const fails = checkFloor(b, bare).filter((c) => !c.ok);
    expect(fails.some((c) => c.rule === 'window' && c.room.name === 'Bedroom 1')).toBe(true);
  });
});

describe('stairs in the plan', () => {
  it('a straight stair: treads up to the cut drawn, the rest dashed, the walking line with its arrow, UP', () => {
    const p = TEMPLATES.find((t) => t.id === 'townhouse')!.make();
    const b = p.buildings[0]!;
    for (const shape of ['stair-straight', 'stair-L', 'stair-U', 'stair-spiral']) {
      b.items = [{ id: 's1', type: shape, params: { rise: 2.9 }, host: { kind: 'free', p: [0, 0, -2], rot: 0 } }];
      const ev = evaluateBuilding(b, {}, p);
      const fp = floorPlan(b, 0, ev.placements);
      expect(fp.symbols.length).toBe(1);
      const st = fp.symbols[0]!;
      expect(st.strokes.some((s) => s.above)).toBe(true);
      expect(st.strokes.some((s) => !s.above)).toBe(true);
      expect(st.label?.text).toBe('UP');
      // Upstairs, the flight that arrives from below: every tread drawn, DOWN at its top.
      const up = floorPlan(b, 1, ev.placements).symbols;
      expect(up.length).toBe(1);
      expect(up[0]!.label?.text).toBe('DOWN');
      expect(up[0]!.strokes.every((s) => !s.above)).toBe(true);
    }
  });
});
