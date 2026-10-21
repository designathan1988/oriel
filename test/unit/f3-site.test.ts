import { describe, expect, it } from 'vitest';
import { building, levelsFor, project, rectPlan, solid } from '../../src/f3/model/defaults';
import { signedArea2 } from '../../src/f3/model/plan';
import { planArea } from '../../src/f3/model/lots';
import { buildableArea, buildingOverlaps, buildOnLot, frontTowardStreet, lotAt, lotOverlaps, lotsAlongStreet, rectLotFrom, ribbon, setbackWarnings, sideSetbacks, splitLot, streetAt, treeItems, treesAlong } from '../../src/f3/model/site';
import { toWorld } from '../../src/f3/model/ops';
import { validateForma3 } from '../../src/f3/io/migrate';
import type { Street, Vec2 } from '../../src/f3/model/schema';

let n = 0;
const id = () => `t${n++}`;

describe('lots', () => {
  it('a rectangle from two corners is counterclockwise with its front on the +z side', () => {
    const l = rectLotFrom([10, 0], [0, 20], 'l1', 'Lot 1');
    expect(signedArea2(l.polygon)).toBeGreaterThan(0);
    const [a, b] = [l.polygon[0]!, l.polygon[1]!];
    expect(a[1]).toBe(20);
    expect(b[1]).toBe(20);
    expect(sideSetbacks(l)).toEqual([4, 1.5, 3, 1.5]);
  });

  it('the buildable area leaves the front, side and back setbacks', () => {
    const l = rectLotFrom([0, 0], [12, 30], 'l1', 'Lot');
    const area = buildableArea(l)!;
    const xs = area.map((p) => p[0]),
      zs = area.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(1.5, 6);
    expect(Math.max(...xs)).toBeCloseTo(10.5, 6);
    // Front on +z (z = 30): 4 m; back on z = 0: 3 m.
    expect(Math.max(...zs)).toBeCloseTo(26, 6);
    expect(Math.min(...zs)).toBeCloseTo(3, 6);
    expect(Math.abs(planArea(area))).toBeCloseTo(9 * 23, 4);
  });

  it('a clockwise lot gives the same buildable area (sides follow their setbacks)', () => {
    const l = rectLotFrom([0, 0], [12, 30], 'l1', 'Lot');
    const cw = { ...l, polygon: [...l.polygon].reverse(), frontEdges: [2] };
    // Reversed, side 0 (the +z front) is side n-2-0 = 2.
    const a = buildableArea(l)!,
      b = buildableArea(cw)!;
    expect(Math.abs(planArea(b))).toBeCloseTo(Math.abs(planArea(a)), 6);
  });

  it('setbacks bigger than the lot leave nothing to build', () => {
    const l = rectLotFrom([0, 0], [4, 6], 'l1', 'Small');
    expect(buildableArea(l)).toBeNull();
    expect(buildOnLot(l, 'house', 'H')).toBeNull();
  });

  it('a ready building fills the buildable area, belongs to the lot and turns with the front', () => {
    const l = rectLotFrom([0, 0], [12, 30], 'l1', 'Lot');
    for (const kind of ['house', 'residential', 'commercial'] as const) {
      const b = buildOnLot(l, kind, 'B')!;
      expect(b.lotId).toBe('l1');
      expect(b.solids).toHaveLength(1);
      const s = b.solids[0]!;
      const world = s.plan.outer.map((v) => toWorld(b, v.p));
      expect(Math.abs(planArea(world))).toBeCloseTo(9 * 23, 3);
      for (const q of world) {
        expect(q[0]).toBeGreaterThanOrEqual(1.5 - 1e-6);
        expect(q[0]).toBeLessThanOrEqual(10.5 + 1e-6);
      }
      expect(b.levels.length).toBe(kind === 'house' ? 1 : kind === 'residential' ? 5 : 3);
      expect(s.height).toBeCloseTo(b.levels.reduce((a, x) => a + x.height, 0), 6);
      const p = project({ lots: [l], buildings: [b] });
      expect(validateForma3(p)).toEqual([]);
      expect(setbackWarnings(p)).toEqual([]);
    }
  });

  it('the door and the shopfronts go on the street front only', () => {
    const l = rectLotFrom([0, 0], [12, 30], 'l1', 'Lot');
    for (const kind of ['house', 'commercial'] as const) {
      const b = buildOnLot(l, kind, 'B')!;
      const s = b.solids[0]!;
      const rule = s.facade[0]!;
      expect(rule.edges).toHaveLength(1);
      const i = s.plan.outer.findIndex((v) => v.id === rule.edges[0]);
      const a = toWorld(b, s.plan.outer[i]!.p),
        c = toWorld(b, s.plan.outer[(i + 1) % 4]!.p);
      // The lot's front is its +z side (z = 30), 4 m of setback: the side at z = 26.
      expect(a[1]).toBeCloseTo(26, 6);
      expect(c[1]).toBeCloseTo(26, 6);
    }
  });

  it('a building in the setbacks or past the lot edge is warned about, never moved', () => {
    const l = rectLotFrom([0, 0], [12, 30], 'l1', 'Lot');
    const b = buildOnLot(l, 'house', 'House')!;
    b.position = [b.position[0], b.position[1] + 3];
    const p = project({ lots: [l], buildings: [b] });
    expect(setbackWarnings(p)).toEqual(['House stands in the setbacks of Lot.']);
    b.position = [b.position[0] + 20, b.position[1]];
    expect(setbackWarnings(p)).toEqual(['House goes past the edge of Lot.']);
  });

  it('side setback 0 lets the building touch the neighbour (semi-detached)', () => {
    const l = rectLotFrom([0, 0], [10, 30], 'l1', 'Lot');
    l.rules!.setbacks.side = 0;
    const xs = buildableArea(l)!.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
  });

  it('splits a lot in equal fronts that cover it exactly', () => {
    const l = rectLotFrom([0, 0], [30, 25], 'l1', 'Lot');
    const parts = splitLot(l, 3, id);
    expect(parts).toHaveLength(3);
    const total = parts.reduce((a, q) => a + Math.abs(planArea(q.polygon)), 0);
    expect(total).toBeCloseTo(30 * 25, 6);
    for (const q of parts) {
      expect(signedArea2(q.polygon)).toBeGreaterThan(0);
      expect(Math.hypot(q.polygon[1]![0] - q.polygon[0]![0], q.polygon[1]![1] - q.polygon[0]![1])).toBeCloseTo(10, 6);
      expect(q.frontEdges).toEqual([0]);
    }
    expect(new Set(parts.map((q) => q.name)).size).toBe(3);
  });

  it('finds the lot under a point', () => {
    const p = project({ lots: [rectLotFrom([0, 0], [10, 10], 'a', 'A'), rectLotFrom([20, 0], [30, 10], 'b', 'B')] });
    expect(lotAt(p, [5, 5])?.id).toBe('a');
    expect(lotAt(p, [25, 5])?.id).toBe('b');
    expect(lotAt(p, [15, 5])).toBeUndefined();
  });
});

describe('streets', () => {
  const st: Street = { id: 's1', name: 'Main', points: [[0, 0], [100, 0]], width: 8, sidewalk: 2 };

  it('lays lots on both sides behind the sidewalks, fronts on the street, never overlapping', () => {
    const lots = lotsAlongStreet(st, 12, 30, id, 'Main');
    // 100 m of street: 8 lots of 12 m on each side.
    expect(lots).toHaveLength(16);
    for (const l of lots) {
      expect(signedArea2(l.polygon)).toBeGreaterThan(0);
      expect(Math.abs(planArea(l.polygon))).toBeCloseTo(360, 6);
      const front = [l.polygon[0]!, l.polygon[1]!];
      // The front side runs along the edge of the sidewalk (|z| = 4 + 2).
      for (const q of front) expect(Math.abs(q[1])).toBeCloseTo(6, 6);
      const zs = l.polygon.map((q) => Math.abs(q[1]));
      expect(Math.max(...zs)).toBeCloseTo(36, 6);
    }
    // Every lot's buildable area is on its own side of the street.
    const p = project({ lots, streets: [st] });
    expect(validateForma3(p)).toEqual([]);
    for (const l of lots) {
      const a = buildableArea(l)!;
      const zs = a.map((q) => Math.abs(q[1]));
      expect(Math.min(...zs)).toBeCloseTo(10, 6);
    }
  });

  it('keeps clear of the corner of a bent street', () => {
    const bent: Street = { id: 's2', name: 'Bent', points: [[0, 0], [60, 0], [60, 60]], width: 8, sidewalk: 2 };
    const lots = lotsAlongStreet(bent, 10, 20, id, 'Bent');
    // Both stretches get lots on both sides.
    expect(lots.filter((l) => l.polygon.every((q) => q[0] <= 60)).length).toBeGreaterThan(4);
    expect(lots.filter((l) => l.polygon.every((q) => q[1] >= 0 && q[0] >= 54)).length).toBeGreaterThan(4);
    const box = (l: { polygon: Vec2[] }) => [Math.min(...l.polygon.map((q) => q[0])), Math.max(...l.polygon.map((q) => q[0])), Math.min(...l.polygon.map((q) => q[1])), Math.max(...l.polygon.map((q) => q[1]))];
    // No two lots overlap (axis-aligned here: box overlap with a tolerance).
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++) {
        const [a0, a1, a2, a3] = box(lots[i]!),
          [b0, b1, b2, b3] = box(lots[j]!);
        const overlap = Math.min(a1!, b1!) - Math.max(a0!, b0!) > 1e-6 && Math.min(a3!, b3!) - Math.max(a2!, b2!) > 1e-6;
        expect(overlap, `${lots[i]!.name} × ${lots[j]!.name}`).toBe(false);
      }
  });

  it('leaves out lots that would overlap the ones already there', () => {
    const first = lotsAlongStreet(st, 12, 30, id, 'Main');
    expect(lotsAlongStreet(st, 12, 30, id, 'Main', first.map((l) => l.polygon))).toHaveLength(0);
    expect(lotsAlongStreet(st, 12, 30, id, 'Main', first.slice(0, 8).map((l) => l.polygon))).toHaveLength(8);
  });

  it('the asphalt and sidewalk ribbons and the street under a point', () => {
    expect(ribbon(st.points, 0, 4)).toHaveLength(1);
    expect(ribbon(st.points, 4, 6)).toHaveLength(2);
    const p = project({ streets: [st] });
    expect(streetAt(p, [50, 5])?.id).toBe('s1');
    expect(streetAt(p, [50, 7])).toBeUndefined();
  });

  it('plants trees on both sidewalks, evenly spaced and centered', () => {
    const pts = treesAlong(st, 10);
    expect(pts).toHaveLength(20);
    const north = pts.filter((q) => q[1] > 0).map((q) => q[0]);
    expect(north[0]).toBeCloseTo(5, 6);
    expect(north[north.length - 1]).toBeCloseTo(95, 6);
    for (const q of pts) expect(Math.abs(q[1])).toBeCloseTo(4 + 2 * 0.55, 6);
    const b = building({ name: 'Main trees', position: [0, 0], solids: [], levels: [] });
    b.items = treeItems(b, pts, 'tree-maple', id);
    const p = project({ streets: [st], buildings: [b] });
    expect(validateForma3(p)).toEqual([]);
  });

  it('at a bend no tree stands on the asphalt or next to another tree', () => {
    const bent: Street = { id: 's2', name: 'Bent', points: [[60, 40], [140, 40], [140, 105]], width: 7, sidewalk: 2.5 };
    const pts = treesAlong(bent, 8);
    const asphalt = ribbon(bent.points, 0, 3.5);
    for (const q of pts) for (const r of asphalt) expect(!(q[0] > Math.min(...r.map((v) => v[0])) + 1e-6 && q[0] < Math.max(...r.map((v) => v[0])) - 1e-6 && q[1] > Math.min(...r.map((v) => v[1])) + 1e-6 && q[1] < Math.max(...r.map((v) => v[1])) - 1e-6)).toBe(true);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1])).toBeGreaterThan(4.7);
  });

  it('a lot drawn next to a street faces it; overlapping lots are reported', () => {
    const l = frontTowardStreet(rectLotFrom([10, 6], [22, 36], 'l', 'L'), [st]);
    // The street runs along z = 0: the lot's side at z = 6 (the third of rectLotFrom) is the front.
    const i = l.frontEdges[0]!;
    expect(l.polygon[i]![1]).toBe(6);
    expect(l.polygon[(i + 1) % 4]![1]).toBe(6);
    const p = project({ lots: [l, rectLotFrom([20, 10], [30, 20], 'm', 'M'), rectLotFrom([22, 6], [30, 9], 'k', 'K')] });
    expect(lotOverlaps(p)).toEqual(['M overlaps L.']);
  });

  it('rejects a street with one point or a bad width', () => {
    expect(validateForma3(project({ streets: [{ ...st, points: [[0, 0]] }] })).join()).toMatch(/center line/);
    expect(validateForma3(project({ streets: [{ ...st, width: 1 }] })).join()).toMatch(/width/);
  });
});

describe('street trees follow the street', () => {
  it('a renamed street keeps one set of trees, renamed with it', async () => {
    const { replantStreetTrees } = await import('../../src/f3/model/site');
    const p = project({ streets: [{ id: 's', name: 'A', points: [[0, 0], [60, 0]], width: 8, sidewalk: 2, trees: 10 }] });
    const make = (name: string, at: Vec2) => building({ name, position: at, solids: [], levels: [] });
    replantStreetTrees(p, make, 'tree-maple', id);
    p.streets![0]!.name = 'B';
    p.streets![0]!.points[1] = [80, 0];
    replantStreetTrees(p, make, 'tree-maple', id);
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0]!.name).toBe('B trees');
    expect(p.buildings[0]!.items.length).toBe(16);
  });
});

describe('buildingOverlaps', () => {
  const mk = (name: string, at: Vec2) => building({ name, position: at, levels: levelsFor(1), solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3 })] });
  it('warns of buildings standing in each other, not of ones side by side', () => {
    const p = project();
    p.buildings = [mk('A', [0, 0]), mk('B', [4, 3]), mk('C', [-10, 0])];
    expect(buildingOverlaps(p)).toEqual(['B overlaps A.']);
  });
  it('sees a building inside another one (no side crossing)', () => {
    const p = project();
    const small = building({ name: 'S', position: [0, 0], levels: levelsFor(1), solids: [solid({ plan: { outer: rectPlan(2, 2), holes: [] }, height: 3 })] });
    p.buildings = [mk('A', [0, 0]), small];
    expect(buildingOverlaps(p)).toEqual(['S overlaps A.']);
  });
});
