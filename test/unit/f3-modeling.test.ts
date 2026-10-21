import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { building, circlePlan, facadeRule, levelsFor, planVertices, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { addBands, extrudeSide, hostedFrame, insetSide, insetTop, offsetCopy, offsetPlan, offsetSolid, setSideDepth, setSolidSize, splitAtHeight, splitByLine, splitSideAt } from '../../src/f3/model/modeling';
import { sampleRing, signedArea2, oriented } from '../../src/f3/model/plan';
import { podiumUnder, presetRules, setbackOn } from '../../src/f3/model/quick';
import type { Solid } from '../../src/f3/model/schema';

beforeAll(async () => {
  await loadKernel();
});

function volume(b: ReturnType<typeof building>) {
  const ev = evaluateBuilding(b);
  const p = ev.shell.positions,
    ix = ev.shell.indices;
  let vol = 0;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3,
      c1 = ix[i + 1]! * 3,
      c2 = ix[i + 2]! * 3;
    vol += (p[a]! * (p[c1 + 1]! * p[c2 + 2]! - p[c1 + 2]! * p[c2 + 1]!) - p[a + 1]! * (p[c1]! * p[c2 + 2]! - p[c1 + 2]! * p[c2]!) + p[a + 2]! * (p[c1]! * p[c2 + 1]! - p[c1 + 1]! * p[c2]!)) / 6;
  }
  return { vol, warnings: ev.warnings };
}

const box = (extra: Partial<Solid> = {}) => solid({ plinth: 0, plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }), ...extra });
const area = (s: Solid) => Math.abs(signedArea2(sampleRing(oriented(s.plan.outer, 1)).pts));

describe('bevel (volume parameter)', () => {
  it('a straight 1 m chamfer on every top edge removes the truncated pyramid', () => {
    const b = building({ solids: [box({ bevel: { top: 1, bottom: 0, segments: 1, profile: 0 } })] });
    // 5 m straight + a 1 m frustum from 10×8 to 8×6 (prismatoid: h/6·(A1 + 4Am + A2)).
    expect(volume(b).vol).toBeCloseTo(80 * 5 + (80 + 4 * 63 + 48) / 6, 1);
  });

  it('rounded removes less than the chamfer; a base bevel also counts', () => {
    const round = volume(building({ solids: [box({ bevel: { top: 1, bottom: 0, segments: 8, profile: 1 } })] })).vol;
    expect(round).toBeGreaterThan(463.4);
    expect(round).toBeLessThan(480);
    const both = volume(building({ solids: [box({ bevel: { top: 1, bottom: 1, segments: 1, profile: 0 } })] })).vol;
    expect(both).toBeCloseTo(80 * 4 + 2 * ((80 + 4 * 63 + 48) / 6), 1);
  });

  it('bevel on one side only: a triangular prism along that side', () => {
    const s = box();
    s.edges[s.plan.outer[0]!.id] = { bevel: 1 };
    expect(volume(building({ solids: [s] })).vol).toBeCloseTo(480 - 0.5 * 10, 1);
  });

  it('a seam with another volume gets no bevel (no groove): annex + box = bigger box', () => {
    const bev = { top: 1, bottom: 0, segments: 1, profile: 0 };
    const s = box({ bevel: bev });
    const b = building({ solids: [s] });
    const n = extrudeSide(b, s, s.plan.outer[0]!.id, 4)!;
    n.bevel = { ...bev };
    const one = volume(building({ solids: [box({ bevel: bev, plan: { outer: rectPlan(10, 12, 0, -2), holes: [] } })] })).vol;
    expect(volume(b).vol).toBeCloseTo(one, 3);
  });

  it('the facade puts no window on the bevel band', () => {
    const s = box({ bevel: { top: 2.5, bottom: 0, segments: 1, profile: 0 }, facade: [] });
    const ev = evaluateBuilding(building({ solids: [s] }));
    expect(ev.faces.some((f) => f.kind === 'bevel')).toBe(true);
    expect(ev.faces.filter((f) => f.kind === 'side').every((f) => f.frame)).toBe(true);
  });
});

describe('plan offset', () => {
  it('a rectangle grows 1 m on each side; with round corners it loses (4 − π)', () => {
    const s = box();
    expect(offsetSolid(s, 1)).toBe(true);
    expect(area(s)).toBeCloseTo(120, 3);
    const r = box();
    const plan = offsetPlan(r, 1, 'round')!;
    // Arc sampled with a 2 cm chord tolerance: slightly less than exact.
    expect(area({ ...r, plan })).toBeCloseTo(120 - (4 - Math.PI), 0);
    const c = box();
    expect(area({ ...c, plan: offsetPlan(c, 1, 'chamfer')! })).toBeCloseTo(120 - 4 * 0.5, 3);
  });

  it('a circle stays a circle (concentric arcs)', () => {
    const s = solid({ plan: { outer: circlePlan(5), holes: [] } });
    expect(offsetSolid(s, 1)).toBe(true);
    expect(area(s)).toBeCloseTo(Math.PI * 36, 0);
    expect(s.plan.outer.every((v) => Math.abs(Math.hypot(v.p[0], v.p[1]) - 6) < 1e-6)).toBe(true);
  });

  it('an L plan shrinks correctly at the concave corner; shrinking too much is refused', () => {
    const L = solid({ plan: { outer: planVertices([[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]), holes: [] } });
    const before = area(L);
    expect(offsetSolid(L, -1)).toBe(true);
    // L 10×10 with a 4 m arm: offset −1 → 2 m arms: area = 8·2 + 2·6 = 28... by the outline: (8×2)+(2×6).
    expect(area(L)).toBeCloseTo(8 * 2 + 2 * 6, 3);
    expect(before).toBeCloseTo(64, 3);
    expect(offsetSolid(L, -3)).toBe(false);
  });

  it('an offset copy becomes a new volume with its own IDs', () => {
    const s = box();
    const b = building({ solids: [s] });
    const c = offsetCopy(b, s, 0.5)!;
    expect(b.solids).toHaveLength(2);
    expect(c.plan.outer.some((v) => s.plan.outer.some((w) => w.id === v.id))).toBe(false);
  });

  it('an offset copy goes on top of the source, one floor high, visible (not inside it)', () => {
    const s = box();
    const b = building({ solids: [s], levels: levelsFor(2, 3, 3) });
    const c = offsetCopy(b, s, -1)!;
    expect(c.base).toBeCloseTo(s.base + s.height, 6);
    expect(c.height).toBeCloseTo(3, 6);
    expect(area(c)).toBeCloseTo(8 * 6, 3);
    expect(c.name).toBe(`${s.name} (offset)`);
  });
});

describe('side face extrude and inset', () => {
  it('extruding outward adds an annex the size of the face; inward cuts', () => {
    const s = box();
    const b = building({ solids: [s] });
    const edge = s.plan.outer[0]!.id; // 10 m side
    expect(extrudeSide(b, s, edge, 3)).not.toBeNull();
    expect(volume(b).vol).toBeCloseTo(480 + 10 * 3 * 6, 0);
    const s2 = box();
    const b2 = building({ solids: [s2] });
    extrudeSide(b2, s2, s2.plan.outer[0]!.id, -2);
    expect(volume(b2).vol).toBeCloseTo(480 - 10 * 2 * 6, 0);
    // Touching without overlap: exact sizes and one closed solid.
    const s3 = box();
    const b3 = building({ solids: [s3] });
    const n = extrudeSide(b3, s3, s3.plan.outer[0]!.id, 3)!;
    const ys = n.plan.outer.map((v) => v.p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 9);
    const r = volume(b3);
    expect(r.warnings).toEqual([]);
    expect(r.vol).toBeCloseTo(660, 6);
  });

  it('inset with a margin and negative depth opens a niche (loggia)', () => {
    const s = box();
    const b = building({ solids: [s] });
    insetSide(b, s, s.plan.outer[0]!.id, 1, -1.5);
    expect(volume(b).vol).toBeCloseTo(480 - 8 * 4 * 1.5, 0);
  });

  it('a niche pulled out through its wall becomes a projection and back (SketchUp Push/Pull)', () => {
    const s = box();
    const b = building({ solids: [s] });
    const n = insetSide(b, s, s.plan.outer[0]!.id, 1, -1.5)!;
    expect(n.host).toEqual({ solid: s.id, edge: s.plan.outer[0]!.id });
    expect(hostedFrame(n)!.depth).toBeCloseTo(-1.5, 9);
    // Out 2 m: it adds, with the wall's rules and finishes, and the building grows by the projection.
    expect(setSideDepth(n, 2, s)).toBe(true);
    expect(n.op).toBe('add');
    expect(n.name).toMatch(/\(annex\)$/);
    expect(hostedFrame(n)!.depth).toBeCloseTo(2, 9);
    expect(volume(b).vol).toBeCloseTo(480 + 8 * 4 * 2, 0);
    // Back in 0.5 m: a niche again, nothing left outside.
    expect(setSideDepth(n, -0.5, s)).toBe(true);
    expect(n.op).toBe('subtract');
    expect(n.facade).toEqual([]);
    expect(volume(b).vol).toBeCloseTo(480 - 8 * 4 * 0.5, 0);
    // At the wall it is neither.
    expect(setSideDepth(n, 0.01, s)).toBe(false);
  });

  it('on a curved side the annex follows the arc', () => {
    const s = solid({ plinth: 0, plan: { outer: circlePlan(5), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) });
    const b = building({ solids: [s] });
    const before = volume(b).vol;
    const n = extrudeSide(b, s, s.plan.outer[0]!.id, 1)!;
    expect(n.plan.outer.filter((v) => v.bulge).length).toBe(2);
    // Quarter ring from 5 to 6 m: π/4·(36 − 25)·6.
    expect(volume(b).vol - before).toBeCloseTo((Math.PI / 4) * 11 * 6, 0);
  });
});

describe('bands swept along the outline', () => {
  it('a straight band adds the outer ring; a stepped cornice adds less than the full band', () => {
    const flat = box({ bands: [{ id: 'f', y: 2, height: 0.5, depth: 0.1, profile: 'flat' }] });
    expect(volume(building({ solids: [flat] })).vol).toBeCloseTo(480 + (10.2 * 8.2 - 80) * 0.5, 2);
    const corn = box({ bands: [{ id: 'c', y: 5.4, height: 0.6, depth: 0.3, profile: 'cornice' }] });
    const v = volume(building({ solids: [corn] })).vol - 480;
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan((10.6 * 8.6 - 80) * 0.6);
  });

  it('preset bands: one per slab inside the volume', () => {
    const s = box({ height: 9.4 });
    const b = building({ solids: [s], levels: [] });
    b.levels = [
      { id: 'a', name: 'T', elevation: 0, height: 3.4 },
      { id: 'b', name: '1', elevation: 3.4, height: 3 },
      { id: 'c', name: '2', elevation: 6.4, height: 3 },
    ];
    expect(addBands(b, s, 'floors')).toBe(2);
  });
});

describe('top setback', () => {
  it('does not stretch the lower volume and the setback starts on its top', () => {
    const s = box({ height: 18 });
    const b = building({ solids: [s], levels: levelsFor(6, 3, 3.4) });
    const n = setbackOn(b, s)!;
    expect(s.height).toBe(18);
    expect(n.base).toBe(18);
    const top = Math.max(...b.levels.map((l) => l.elevation + l.height));
    expect(top).toBeGreaterThanOrEqual(n.base + n.height - 0.5);
  });
});

describe('a part starting on top of another volume', () => {
  it('a 2nd floor balcony right above the podium fits (float32 precision)', () => {
    const s = box({ plan: { outer: rectPlan(8, 8), holes: [] }, height: 9.4 });
    const b = building({ solids: [s], levels: levelsFor(3, 3, 3.4) });
    podiumUnder(b, s);
    s.facade = [facadeRule('balcony-glass', { levels: 'upper', mode: 'max', value: 3.6 })];
    const ev = evaluateBuilding(b);
    const lv2 = ev.placements.filter((p) => p.family.category === 'balconies' && Math.abs(p.frame[13]! - 3.4) < 0.01);
    expect(lv2.length).toBeGreaterThan(0);
    expect(ev.warnings.filter((w) => w.includes('nothing fit'))).toEqual([]);
  });
});

describe('a free part in the middle of the facade', () => {
  it('"1 door" stays a single door when a sign splits the row', () => {
    const s = box({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6.4, roof: roofSpec('gable') });
    const b = building({ solids: [s] });
    s.facade = presetRules('col', s);
    const front = s.facade.find((r) => r.mode === 'count')!.edges[0]!;
    b.items.push({ id: 'p', type: 'area-stone', params: { width: 1.5, height: 2.5 }, host: { kind: 'face', solid: s.id, edge: front, u: 6, y: 0 } });
    const ev = evaluateBuilding(b);
    expect(ev.placements.filter((p) => p.family.category === 'doors')).toHaveLength(1);
  });
});

describe('preset facade', () => {
  it('a door only at the front and windows redistributed beside it on the ground floor', () => {
    const s = box({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 6.4, roof: roofSpec('gable') });
    const b = building({ solids: [s] });
    s.facade = presetRules('col', s);
    const ev = evaluateBuilding(b);
    const doors = ev.placements.filter((p) => p.family.category === 'doors');
    expect(doors).toHaveLength(1);
    const front = doors[0]!.host!.edge;
    const groundWins = ev.placements.filter((p) => p.family.category === 'windows' && p.host!.edge === front && p.frame[13]! < 3);
    expect(groundWins.length).toBeGreaterThanOrEqual(2);
    // No window touches the door.
    for (const w of groundWins) expect(Math.abs(w.host!.s - doors[0]!.host!.s)).toBeGreaterThan((w.length + doors[0]!.length) / 2 + 0.3);
  });
});

describe('parapet of merged volumes', () => {
  it('an annex of the same height: the parapet follows the union, with no low wall at the seam', () => {
    const withParapet = (extra: Partial<Solid> = {}) => box({ roof: roofSpec('flat', { parapet: 1 }), ...extra });
    const s = withParapet();
    const b = building({ solids: [s] });
    extrudeSide(b, s, s.plan.outer[0]!.id, 4);
    const merged = volume(b).vol;
    // A single 10 × 12 volume with the same parapet.
    const one = volume(building({ solids: [withParapet({ plan: { outer: rectPlan(10, 12, 0, -2), holes: [] } })] })).vol;
    expect(merged).toBeCloseTo(one, 3);
  });
});

describe('rooms behind the windows', () => {
  it('they pierce neither the slab of a volume lower than the floor nor the opposite wall', () => {
    // 3 m volume (3.4 m floor) only 2.4 m deep: windows on both sides.
    const s = box({ plan: { outer: rectPlan(10, 2.4), holes: [] }, height: 3, roof: roofSpec('flat', { parapet: 0 }), facade: [facadeRule('win-casement', { mode: 'max', value: 3 })] });
    const b = building({ solids: [s] });
    const ev = evaluateBuilding(b);
    const P = ev.shell.positions;
    let maxY = 0;
    for (let i = 1; i < P.length; i += 3) maxY = Math.max(maxY, P[i]!);
    // The top stays closed: no room triangle above the slab, no hole.
    const top = ev.faces.findIndex((f) => f.kind === 'top' && f.solid === s.id);
    let topArea = 0;
    for (let t = 0; t < ev.shell.indices.length / 3; t++) {
      if (ev.shell.faceOf[t] !== top) continue;
      const [a, c1, c2] = [0, 1, 2].map((j) => ev.shell.indices[t * 3 + j]! * 3);
      const ux = P[c1!]! - P[a!]!, uz = P[c1! + 2]! - P[a! + 2]!, vx = P[c2!]! - P[a!]!, vz = P[c2! + 2]! - P[a! + 2]!;
      topArea += Math.abs(ux * vz - uz * vx) / 2;
    }
    expect(topArea).toBeCloseTo(24, 3);
    expect(maxY).toBeCloseTo(3, 6);
    // No holes: the mesh stays closed with a volume close to the box minus openings and rooms.
    expect(volume(b).vol).toBeGreaterThan(0);
  });
});

describe('top inset, scale and split', () => {
  it('a top inset with height raises the inset part; with negative depth it sinks', () => {
    const s = box();
    const b = building({ solids: [s] });
    insetTop(b, s, 2, 3);
    expect(b.solids).toHaveLength(2);
    expect(b.solids[1]!.base).toBe(6);
    expect(area(b.solids[1]!)).toBeCloseTo(6 * 4, 3);
    const s2 = box();
    const b2 = building({ solids: [s2] });
    insetTop(b2, s2, 2, -2);
    expect(volume(b2).vol).toBeCloseTo(480 - 6 * 4 * 2, 0);
  });

  it('exact width and depth', () => {
    const s = box();
    expect(setSolidSize(s, 12, 8)).toBe(true);
    expect(area(s)).toBeCloseTo(96, 3);
  });

  it('splitting at a height keeps the volume and carries the upper parts', () => {
    const s = box({ taper: 1 });
    const b = building({ solids: [s], items: [{ id: 'w', type: 'win-casement', params: {}, host: { kind: 'face', solid: s.id, edge: s.plan.outer[0]!.id, u: 5, y: 4 } }] });
    const before = volume(b).vol;
    const up = splitAtHeight(b, s, 2.5)!;
    expect(b.solids).toHaveLength(2);
    expect(volume(b).vol).toBeCloseTo(before, 1);
    const h = b.items[0]!.host;
    expect(h.kind === 'face' && h.solid === up.id && Math.abs(h.y - (4 - 2.5 * Math.hypot(1, 1 / 6))) < 1e-6 && up.plan.outer.some((v) => v.id === h.edge)).toBe(true);
  });
});

describe('cutting a curved side (audit F5)', () => {
  it('splitSideAt on an arc makes two arcs, the cut where asked along the arc', async () => {
    const { sideCurve } = await import('../../src/f3/model/modeling');
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
    const e = s.plan.outer[0]!.id;
    s.plan.outer[0]!.bulge = 0.3;
    const b = building({ solids: [s] });
    const a0 = Math.abs(signedArea2(sampleRing(oriented(s.plan.outer, 1)).pts));
    const len = sideCurve(s, e)!.len;
    const id = splitSideAt(b, s, e, len / 4)!;
    expect(id).toBeTruthy();
    expect(Math.abs(signedArea2(sampleRing(oriented(s.plan.outer, 1)).pts))).toBeCloseTo(a0, 1);
    expect(sideCurve(s, e)!.len).toBeCloseTo(len / 4, 3);
    expect(sideCurve(s, id)!.len).toBeCloseTo((3 * len) / 4, 3);
  });
});

describe('split pieces (audit B3)', () => {
  it('keep their own names and only the rules and exceptions of their floors', () => {
    const s = solid({ name: 'Block', plan: { outer: rectPlan(12, 8), holes: [] }, height: 12, roof: roofSpec('flat') });
    const side = s.plan.outer[0]!.id;
    s.facade = [facadeRule('door-panel', { levels: 'ground' }), facadeRule('win-casement', { levels: 'upper', except: { [`${side}:1:0`]: 'none', [`${side}:3:1`]: 'none' } }), facadeRule('win-casement', { levels: 'top' })];
    const b = building({ solids: [s], levels: levelsFor(4, 3, 3) });
    const up = splitAtHeight(b, s, 6)!;
    expect(up.name).toBe('Block (upper)');
    // Below: the shops and the upper windows of floor 1 (its exception); above: windows of floors 2–3 and the attic.
    expect(s.facade.map((r) => r.levels)).toEqual(['ground', 'upper']);
    expect(Object.keys(s.facade[1]!.except)).toEqual([`${side}:1:0`]);
    expect(up.facade.map((r) => r.levels)).toEqual(['upper', 'top']);
    expect(Object.keys(up.facade[0]!.except).map((k) => k.split(':').slice(1).join(':'))).toEqual(['3:1']);
    // Splitting the upper piece again: "Block (upper 2)", not "(upper) (upper)".
    const up2 = splitAtHeight(b, up, 3)!;
    expect(up2.name).toBe('Block (upper 2)');
  });
});

describe('floors by the height arrow', () => {
  it('rises floor by floor, adds and removes floors and counts the floors of the volume', async () => {
    const { building, levelsFor, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { floorsIn, snapToFloor } = await import('../../src/f3/model/quick');
    const { resolveBuilding } = await import('../../src/f3/model/relations');
    const { uid } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(8, 8), holes: [] }, height: 9.4, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(3, 3, 3.4), solids: [s] });
    const ids = b.levels.map((l) => l.id);
    resolveBuilding(b, undefined, uid);
    // 3 floors (3.4 + 3 + 3 = 9.4 m); pulling to 15 m snaps to 15.4 (5 floors).
    let before = structuredClone(b);
    s.height = snapToFloor(b, s.base, 15) - s.base;
    expect(s.height).toBeCloseTo(15.4, 5);
    resolveBuilding(b, before, uid);
    expect(b.levels).toHaveLength(5);
    expect(b.levels.slice(0, 3).map((l) => l.id)).toEqual(ids);
    expect(floorsIn(b, s)).toBe(5);
    // Going down to 6 m snaps to 6.4 (2 floors) and the upper ones go.
    before = structuredClone(b);
    s.height = snapToFloor(b, s.base, 6) - s.base;
    resolveBuilding(b, before, uid);
    expect(s.height).toBeCloseTo(6.4, 5);
    expect(b.levels).toHaveLength(2);
    // Never below one floor.
    expect(snapToFloor(b, s.base, -5)).toBeCloseTo(3.4, 5);
  });
});

describe('more and fewer floors in the building body', () => {
  it('tower with a setback: the body grows and the setback moves up with it; removing does the opposite without going past the ground floor', async () => {
    const { building, levelsFor, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { changeLevels } = await import('../../src/f3/model/quick');
    const base = solid({ plan: { outer: rectPlan(13, 13), holes: [] }, height: 3.4, roof: roofSpec('flat') });
    const torre = solid({ plan: { outer: rectPlan(8, 8), holes: [] }, height: 18, roof: roofSpec('flat') });
    const recuo = solid({ plan: { outer: rectPlan(4, 4), holes: [] }, base: 18, height: 4.3, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(7, 3, 3.4), solids: [base, torre, recuo] });
    const ids = b.levels.map((l) => l.id);
    expect(changeLevels(b, 2)).toBe(true);
    expect(b.levels).toHaveLength(9);
    expect(torre.height).toBeCloseTo(24, 5);
    expect(recuo.base).toBeCloseTo(24, 5);
    expect(recuo.height).toBeCloseTo(4.3, 5);
    expect(base.height).toBeCloseTo(3.4, 5);
    // The previous floors stay (same ID), with continuous elevations.
    for (const id of ids) expect(b.levels.some((l) => l.id === id)).toBe(true);
    b.levels.forEach((l, i) => i && expect(l.elevation).toBeCloseTo(b.levels[i - 1]!.elevation + b.levels[i - 1]!.height, 5));
    expect(changeLevels(b, -3)).toBe(true);
    expect(torre.height).toBeCloseTo(15, 5);
    expect(recuo.base).toBeCloseTo(15, 5);
    expect(b.levels).toHaveLength(6);
    // Does not go past the ground floor.
    changeLevels(b, -50);
    expect(b.levels).toHaveLength(2); // ground floor + the setback floor, which sits on top of the body
    expect(b.levels[0]!.name).toBe('Ground');
    // The tower was 0.4 m lower than the boundary: it keeps the ground floor minus that.
    expect(torre.height).toBeCloseTo(3, 5);
    expect(recuo.base).toBeCloseTo(3, 5);
  });

  it('single-volume house: the volume grows one floor', async () => {
    const { building, levelsFor, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { changeLevels } = await import('../../src/f3/model/quick');
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6.4, roof: roofSpec('gable') });
    const b = building({ levels: levelsFor(2, 3, 3.4), solids: [s] });
    changeLevels(b, 1);
    expect(s.height).toBeCloseTo(9.4, 5);
    expect(b.levels).toHaveLength(3);
  });

  it('floors keep their ID, a given name and their interior; a floor that goes takes its interior', async () => {
    const { building, levelsFor, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { adoptLevels, changeLevels, setLevelHeights } = await import('../../src/f3/model/quick');
    const empty = () => ({ nodes: [], walls: [], rooms: [] });
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 12.4, roof: roofSpec('flat') });
    const b = building({ levels: levelsFor(4, 3, 3.4), solids: [s] });
    const ids = b.levels.map((l) => l.id);
    b.levels[1]!.name = 'Mezzanine';
    b.interiors = { [ids[1]!]: empty(), [ids[3]!]: empty() };
    // New heights: the same floors.
    setLevelHeights(b, 4, 3.6, 3.2);
    expect(b.levels.map((l) => l.id)).toEqual(ids);
    expect(b.levels[1]!.name).toBe('Mezzanine');
    expect(b.levels[2]!.name).toBe('Floor 2');
    expect(Object.keys(b.interiors).sort()).toEqual([ids[1]!, ids[3]!].sort());
    // One floor less from the top: its interior goes, the others stay.
    expect(changeLevels(b, -1)).toBe(true);
    expect(b.levels.map((l) => l.id)).toEqual(ids.slice(0, 3));
    expect(Object.keys(b.interiors)).toEqual([ids[1]!]);
    // Rebuilt to 2 floors (the panel's floor count): the first two keep who they are.
    adoptLevels(b, levelsFor(2, 3, 3.4));
    expect(b.levels.map((l) => l.id)).toEqual(ids.slice(0, 2));
    expect(Object.keys(b.interiors)).toEqual([ids[1]!]);
    adoptLevels(b, levelsFor(1, 3, 3.4));
    expect(b.interiors).toEqual({});
  });
});

describe('Clipper2 offset keeps the identity of the sides (audit E3)', () => {
  it('a dumbbell shrunk past its neck splits in two; each side keeps its material, rules and hosted parts', async () => {
    const { clipperOffset } = await import('../../src/f3/eval/clipoffset');
    const { adoptOffsetSides } = await import('../../src/f3/model/modeling');
    const { cloneSolid } = await import('../../src/f3/model/ops');
    // Two 10×10 squares joined by a 2 m neck: shrinking by 1.2 m loses the neck.
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 4], [16, 4], [16, 0], [26, 0], [26, 10], [16, 10], [16, 6], [10, 6], [10, 10], [0, 10]];
    const s = solid({ plan: { outer: planVertices(pts), holes: [] }, height: 6 });
    const west = s.plan.outer[11]!.id; // x = 0 side
    const east = s.plan.outer[5]!.id; // x = 26 side
    const south = s.plan.outer[0]!.id; // z = 0 side of the left square
    s.edges[west] = { material: { finish: 'brick', color: '#a8553a' } };
    s.facade = [facadeRule('win-casement', { edges: [west, east] }), facadeRule('door-panel', { edges: [south], except: { [`${south}:0:0`]: 'none' } })];
    const b = building({ solids: [s] });
    b.items.push({ id: 'it', type: 'win-casement', params: {}, host: { kind: 'face', solid: s.id, edge: east, u: 5, y: 1 } });
    const before = structuredClone(s);
    const pieces = clipperOffset(s.plan, -1.2, 'sharp');
    expect(pieces.length).toBe(2);
    const vols = pieces.map((pc, i) => {
      const t = i === 0 ? s : cloneSolid(s);
      t.plan = { outer: planVertices(pc.outer), holes: [] };
      t.edges = {};
      if (i) b.solids.push(t);
      return t;
    });
    adoptOffsetSides(before, vols, -1.2, b.items);
    const owner = (id: string) => vols.find((v) => v.plan.outer.some((x) => x.id === id));
    const left = owner(west)!, right = owner(east)!;
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left).not.toBe(right);
    expect(left.edges[west]?.material?.finish).toBe('brick');
    // The window rule stays on both squares, each with its own side; the door rule only on the left one.
    expect(left.facade.find((r) => r.type === 'win-casement')?.edges).toEqual([west]);
    expect(right.facade.find((r) => r.type === 'win-casement')?.edges).toEqual([east]);
    expect(right.facade.some((r) => r.type === 'door-panel')).toBe(false);
    expect(left.facade.find((r) => r.type === 'door-panel')?.except).toEqual({ [`${south}:0:0`]: 'none' });
    // The window on the east side went with its side to the other piece.
    expect(b.items[0]!.host).toMatchObject({ solid: right.id, edge: east });
  });
});
