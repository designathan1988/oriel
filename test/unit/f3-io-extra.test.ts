import { describe, expect, it } from 'vitest';
import { building, levelsFor, planVertices, project, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { oriented, sampleRing, signedArea2 } from '../../src/f3/model/plan';
import { SUN_PRESETS, sunPosition, sunriseSunset } from '../../src/f3/model/sun';
import { buildingAreas, lotIndices, rectLot } from '../../src/f3/model/lots';
import { dxfToPolylines, planToDxf, polylinesToBuildings } from '../../src/f3/io/dxf';
import { areasTable, planSvg } from '../../src/f3/io/plansvg';

describe('sun', () => {
  it('is nearly overhead at the equator on the equinox at noon', () => {
    const s = sunPosition({ date: { year: 2026, month: 3, day: 20 }, hour: 12, latitude: 0, longitude: 0, utcOffset: 0, north: 0 });
    expect(s.altitude).toBeGreaterThan(85);
    expect(s.altitude).toBeLessThanOrEqual(90);
    expect(Math.hypot(s.dir[0], s.dir[1], s.dir[2])).toBeCloseTo(1, 6);
  });

  it('is due south at solar noon in London on the June solstice', () => {
    // longitude = 0 with utcOffset = 0 keeps clock noon next to solar noon.
    const s = sunPosition({ date: { year: 2026, month: 6, day: 21 }, hour: 12, latitude: 51.5, longitude: 0, utcOffset: 0, north: 0 });
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(1);
    expect(s.altitude).toBeCloseTo(62, 0);
  });

  it('is due north at solar noon south of the Tropic of Capricorn in June', () => {
    const s = sunPosition({ date: { year: 2026, month: 6, day: 21 }, hour: 12, latitude: -33.87, longitude: 0, utcOffset: 0, north: 0 });
    const off = Math.min(s.azimuth, 360 - s.azimuth);
    expect(off).toBeLessThan(2);
    expect(s.altitude).toBeCloseTo(32.7, 0);
  });

  it('is nearly overhead at São Paulo on the December solstice', () => {
    const s = sunPosition({ date: { year: 2026, month: 12, day: 21 }, hour: 12, latitude: -23.55, longitude: -46.63, utcOffset: -3, north: 0 });
    expect(s.altitude).toBeGreaterThan(85);
    expect(s.dir[1]).toBeGreaterThan(0.99);
  });

  it('turns the sun with the project north', () => {
    const base = { date: { year: 2026, month: 6, day: 21 }, hour: 12, latitude: 51.5, longitude: 0, utcOffset: 0 };
    const a = sunPosition({ ...base, north: 0 });
    const b = sunPosition({ ...base, north: 90 });
    // Due south: +Z with north = 0; with north = +X (90°) the same sun is at −X.
    expect(a.dir[2]).toBeGreaterThan(0.4);
    expect(b.dir[0]).toBeLessThan(-0.4);
    expect(a.altitude).toBeCloseTo(b.altitude, 6);
  });

  it('rises near 6h and sets near 18h at the equator on the equinox', () => {
    const t = sunriseSunset({ date: { year: 2026, month: 3, day: 20 }, latitude: 0, longitude: 0, utcOffset: 0 });
    expect(t.polar).toBeNull();
    expect(t.sunrise).toBeCloseTo(6, 0);
    expect(t.sunset).toBeCloseTo(18, 0);
    expect(t.dayLength).toBeGreaterThan(11.5);
    expect(t.dayLength).toBeLessThan(12.5);
  });

  it('reports the polar night above the Arctic circle in December', () => {
    const t = sunriseSunset({ date: { year: 2026, month: 12, day: 21 }, latitude: 78.2, longitude: 15.6, utcOffset: 1 });
    expect(t.polar).toBe('night');
    expect(Number.isNaN(t.sunrise)).toBe(true);
  });

  it('ships the expected city presets', () => {
    expect(SUN_PRESETS).toHaveLength(6);
    const ids = SUN_PRESETS.map((c) => c.id);
    for (const id of ['sao-paulo', 'rio', 'lisbon', 'new-york', 'london', 'tokyo']) expect(ids).toContain(id);
  });
});

describe('dxf', () => {
  const oneBuilding = () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
    return project({ lots: [], buildings: [building({ name: 'House', solids: [s] })] });
  };

  it('exports a closed polyline of the volume plan and reads it back', () => {
    const dxf = planToDxf(oneBuilding());
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    const polys = dxfToPolylines(dxf);
    expect(polys).toHaveLength(1);
    const pl = polys[0]!;
    expect(pl.closed).toBe(true);
    expect(pl.layer).toBe('House');
    expect(pl.points).toHaveLength(4);
    expect(Math.abs(signedArea2(pl.points))).toBeCloseTo(80, 6);
  });

  it('turns a closed outline into a building of the same area', () => {
    const p = oneBuilding();
    const bs = polylinesToBuildings(dxfToPolylines(planToDxf(p)), { height: 6, levels: 2 });
    expect(bs).toHaveLength(1);
    const b = bs[0]!;
    expect(b.solids).toHaveLength(1);
    const ring = sampleRing(oriented(b.solids[0]!.plan.outer, 1)).pts;
    expect(Math.abs(signedArea2(ring))).toBeCloseTo(80, 6);
    // The plan is local to the centroid: the origin stays the middle of the outline.
    expect(b.position[0]).toBeCloseTo(0, 3);
    expect(b.position[1]).toBeCloseTo(0, 3);
  });

  it('draws the lots on their own layer and skips them when rebuilding', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
    const p = project({ lots: [rectLot('lot1', 30, 30)], buildings: [building({ name: 'House', solids: [s] })] });
    const polys = dxfToPolylines(planToDxf(p));
    expect(polys.some((x) => x.layer === 'LOTS')).toBe(true);
    expect(polylinesToBuildings(polys, { height: 6, levels: 2 })).toHaveLength(1);
  });

  it('chains LINE entities that meet', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'WALL', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'LINE', '8', 'WALL', '10', '10', '20', '0', '11', '10', '21', '10',
      '0', 'LINE', '8', 'WALL', '10', '10', '20', '10', '11', '0', '21', '10',
      '0', 'LINE', '8', 'WALL', '10', '0', '20', '10', '11', '0', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const polys = dxfToPolylines(dxf);
    expect(polys).toHaveLength(1);
    expect(polys[0]!.closed).toBe(true);
    expect(polys[0]!.points).toHaveLength(4);
    expect(Math.abs(signedArea2(polys[0]!.points))).toBeCloseTo(100, 6);
  });
});

describe('lots', () => {
  const house = () => {
    const s = solid({ plan: { outer: rectPlan(10, 10), holes: [] }, height: 6 });
    return building({ name: 'House', lotId: 'lot1', levels: levelsFor(2, 3, 3), solids: [s] });
  };

  it('computes occupancy, FAR and the setbacks of a lot', () => {
    const p = project({ lots: [rectLot('lot1', 20, 20)], buildings: [house()] });
    const idx = lotIndices(p, 'lot1');
    expect(idx).not.toBeNull();
    expect(idx!.lotArea).toBeCloseTo(400, 6);
    expect(idx!.footprint).toBeCloseTo(100, 6);
    expect(idx!.occupancy).toBeCloseTo(0.25, 6);
    expect(idx!.gfa).toBeCloseTo(200, 6);
    expect(idx!.far).toBeCloseTo(0.5, 6);
    expect(idx!.permeable).toBeCloseTo(0.75, 6);
    expect(idx!.setbacks.min).toBeCloseTo(5, 3);
    expect(idx!.setbacks.perSide).toHaveLength(4);
    expect(lotIndices(p, 'nope')).toBeNull();
  });

  it('reports the areas of one building', () => {
    const a = buildingAreas(house());
    expect(a.footprint).toBeCloseTo(100, 6);
    expect(a.gfa).toBeCloseTo(200, 6);
    expect(a.volume).toBeCloseTo(600, 6);
    expect(a.perLevel).toHaveLength(2);
    expect(a.perLevel[0]!.area).toBeCloseTo(100, 6);
  });

  it('ignores volumes that do not reach a level', () => {
    // A mezzanine from 3 m to 6 m: the ground floor of 3 m has nothing on it.
    const s = solid({ plan: { outer: rectPlan(10, 10), holes: [] }, base: 3, height: 3 });
    const b = building({ name: 'Tower', levels: levelsFor(2, 3, 3), solids: [s] });
    expect(buildingAreas(b).perLevel[0]!.area).toBeCloseTo(0, 6);
    expect(buildingAreas(b).perLevel[1]!.area).toBeCloseTo(100, 6);
  });
});

describe('plansvg', () => {
  it('draws the volumes, the names, the scale bar and the north arrow', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
    const b = building({ name: 'House', solids: [s] });
    const p = project({ lots: [rectLot('lot1', 20, 20)], buildings: [b] });
    const svg = planSvg(p);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('10 m');
    expect(svg).toContain('>N</text>');
    expect(svg).toContain('House');
    expect(svg).toContain('stroke-dasharray');
  });

  it('lists the building areas', () => {
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
    const p = project({ buildings: [building({ name: 'House', levels: levelsFor(2, 3, 3), solids: [s] })] });
    const t = areasTable(p);
    expect(t).toHaveLength(1);
    expect(t[0]!.building).toBe('House');
    expect(t[0]!.footprint).toBeCloseTo(80, 2);
    expect(t[0]!.gfa).toBeCloseTo(160, 2);
    expect(t[0]!.volume).toBeCloseTo(480, 2);
  });

  it('reuses the plan helpers without losing the outline', () => {
    const vs = planVertices([
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]);
    const s = solid({ plan: { outer: vs, holes: [] }, roof: roofSpec('flat') });
    expect(Math.abs(signedArea2(sampleRing(oriented(s.plan.outer, 1)).pts))).toBeCloseTo(12, 6);
  });
});

describe('section drawing', () => {
  it('cuts the buildings the plane crosses, with their levels and names', async () => {
    const { loadKernel } = await import('../../src/f3/kernel/kernel');
    await loadKernel();
    const { sectionSvg } = await import('../../src/f3/io/sectionsvg');
    const b = building({ name: 'Box', solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) })], levels: levelsFor(2, 3, 3) });
    const svg = sectionSvg(project({ name: 'P', buildings: [b] }), 0);
    expect(svg).toContain('<line');
    expect(svg).toContain('>Box<');
    expect(svg).toContain('P · Section<');
    expect(svg).toContain('+3.00');
    // Far away: no building.
    expect(sectionSvg(project({ name: 'P', buildings: [b] }), 50)).toContain('crosses no building');
  });
});

describe('game data', () => {
  it('lists every component of a building in the world, sorted', async () => {
    const { loadKernel } = await import('../../src/f3/kernel/kernel');
    await loadKernel();
    const { gameData } = await import('../../src/f3/io/game');
    const { facadeRule } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6, roof: roofSpec('flat') });
    s.facade = [facadeRule('win-casement', { levels: 'all', mode: 'count', value: 2 })];
    const b = building({ name: 'B', position: [100, 50], solids: [s], levels: levelsFor(2, 3, 3) });
    b.items.push({ id: 'tree1', type: 'tree-oak', params: {}, host: { kind: 'free', p: [8, 0, 0], rot: 0 } });
    const g = gameData(project({ name: 'P', buildings: [b] }));
    const cs = g.buildings[0]!.components;
    expect(cs.filter((c) => c.family === 'window').length).toBeGreaterThanOrEqual(8);
    const tree = cs.find((c) => c.id.startsWith('tree1'))!;
    expect(tree.position[0]).toBeCloseTo(108, 3);
    expect(tree.position[2]).toBeCloseTo(50, 3);
    expect(tree.host).toBe('free');
    expect([...cs].sort((a, c) => (a.id < c.id ? -1 : 1)).map((c) => c.id)).toEqual(cs.map((c) => c.id));
  });
});

describe('DXF with arcs (libraries)', () => {
  it('a curved wall goes out as a bulge and comes back as an arc', async () => {
    const { planToCadDxf, readCadDxf } = await import('../../src/f3/io/cad');
    const { arcBuilding } = { arcBuilding: () => {
      const outer = planVertices([[-5, -4], [5, -4], [5, 4], [-5, 4]], (i) => (i === 1 ? { bulge: 0.4 } : {}));
      return building({ name: 'Arc', position: [10, 20], solids: [solid({ plan: { outer, holes: [] }, height: 6, roof: roofSpec('flat') })] });
    } };
    const p = project({ name: 'P', buildings: [arcBuilding()] });
    const text = planToCadDxf(p);
    expect(text).toContain('LWPOLYLINE');
    expect(text).toMatch(/\n\s*42\s*\n/);
    const polys = await readCadDxf(text);
    const ring = polys.find((q) => q.layer === 'Arc')!;
    expect(ring.closed).toBe(true);
    expect(ring.points).toHaveLength(4);
    expect(ring.bulges?.filter((b) => b !== 0)).toHaveLength(1);
    const bs = polylinesToBuildings(polys, { height: 6, levels: 2 });
    const back = bs[0]!.solids[0]!.plan.outer;
    expect(back.filter((v) => v.bulge).map((v) => Math.abs(v.bulge!))).toEqual([0.4]);
    // Same area as the source (the arc kept).
    const { buildingAreas } = await import('../../src/f3/model/lots');
    expect(buildingAreas(bs[0]!).footprint).toBeCloseTo(buildingAreas(arcBuilding()).footprint, 1);
  });
});

describe('DXF holes', () => {
  it('a courtyard comes back as a hole; a tower inside a house stays a volume', async () => {
    const { planToCadDxf, readCadDxf } = await import('../../src/f3/io/cad');
    const court = solid({ plan: { outer: planVertices([[-10, -10], [10, -10], [10, 10], [-10, 10]]), holes: [planVertices([[-4, -4], [-4, 4], [4, 4], [4, -4]])] }, height: 9, roof: roofSpec('flat') });
    const house = solid({ plan: { outer: planVertices([[-6, -5], [6, -5], [6, 5], [-6, 5]]) , holes: [] }, height: 4, roof: roofSpec('flat') });
    const tower = solid({ plan: { outer: planVertices([[-1, -1], [1, -1], [1, 1], [-1, 1]]), holes: [] }, height: 12, roof: roofSpec('flat') });
    const p = project({ name: 'P', buildings: [building({ name: 'Court', position: [0, 0], solids: [court] }), building({ name: 'House', position: [50, 0], solids: [house, tower] })] });
    const bs = polylinesToBuildings(await readCadDxf(planToCadDxf(p)), { height: 6, levels: 2 });
    const c = bs.find((b) => b.name === 'Court')!;
    expect(c.solids[0]!.plan.holes).toHaveLength(1);
    expect(bs.filter((b) => b.name === 'House')).toHaveLength(2);
  });
});
