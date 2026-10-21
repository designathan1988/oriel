import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { building, circlePlan, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import type { RoofKind } from '../../src/f3/model/schema';

beforeAll(async () => {
  await loadKernel();
});

/** Volume and maximum height of the evaluated shell (closed mesh → volume by the divergence theorem). */
function measure(ev: ReturnType<typeof evaluateBuilding>) {
  const p = ev.shell.positions,
    ix = ev.shell.indices;
  let vol = 0,
    maxY = -Infinity;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3,
      b = ix[i + 1]! * 3,
      c = ix[i + 2]! * 3;
    vol += (p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) - p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) + p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!)) / 6;
  }
  for (let i = 1; i < p.length; i += 3) maxY = Math.max(maxY, p[i]!);
  return { vol, maxY, tris: ix.length / 3 };
}

describe('forma/3 evaluation', () => {
  it('a flat box without a parapet has the box volume', () => {
    const b = building({ solids: [solid({ plinth: 0, plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) })] });
    const ev = evaluateBuilding(b);
    expect(ev.warnings).toEqual([]);
    expect(measure(ev).vol).toBeCloseTo(480, 1);
  });

  it('two overlapping volumes become one solid (union, without counting the overlap twice)', () => {
    const b = building({
      solids: [
        solid({ plinth: 0, plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) }),
        solid({ plinth: 0, plan: { outer: rectPlan(10, 8, 5, 0), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) }),
      ],
    });
    expect(measure(evaluateBuilding(b)).vol).toBeCloseTo(15 * 8 * 6, 1);
  });

  it('subtraction opens a courtyard and intersection trims', () => {
    const base = solid({ plinth: 0, plan: { outer: rectPlan(20, 20), holes: [] }, height: 6, roof: roofSpec('flat', { parapet: 0 }) });
    const court = solid({ plinth: 0, op: 'subtract', plan: { outer: rectPlan(8, 8), holes: [] }, base: -1, height: 10, roof: roofSpec('flat', { parapet: 0 }) });
    expect(measure(evaluateBuilding(building({ solids: [base, court] }))).vol).toBeCloseTo((400 - 64) * 6, 1);
    const cap = solid({ plinth: 0, op: 'intersect', plan: { outer: rectPlan(10, 30), holes: [] }, base: 0, height: 3, roof: roofSpec('flat', { parapet: 0 }) });
    expect(measure(evaluateBuilding(building({ solids: [base, cap] }))).vol).toBeCloseTo(10 * 20 * 3, 1);
  });

  it('taper shrinks the top', () => {
    const b = building({ solids: [solid({ plinth: 0, plan: { outer: rectPlan(10, 10), holes: [] }, height: 10, taper: 2, roof: roofSpec('flat', { parapet: 0 }) })] });
    // Truncated pyramid: h/3 (A1 + A2 + √(A1·A2)) = 10/3 (100 + 36 + 60)
    expect(measure(evaluateBuilding(b)).vol).toBeCloseTo((10 / 3) * (100 + 36 + 60), 0);
  });

  it.each<RoofKind>(['gable', 'hip', 'mansard', 'gambrel', 'shed', 'pyramid', 'dome', 'vault', 'sawtooth', 'terrace', 'flat'])('%s roof closes and rises above the walls', (kind) => {
    const b = building({ solids: [solid({ plinth: 0, plan: { outer: rectPlan(12, 9), holes: [] }, height: 6, roof: roofSpec(kind) })] });
    const ev = evaluateBuilding(b);
    const m = measure(ev);
    expect(ev.warnings).toEqual([]);
    expect(m.vol).toBeGreaterThan(12 * 9 * 6 - 1);
    expect(m.maxY).toBeGreaterThan(6.3);
  });

  it('a dome on a circular base rises by the radius', () => {
    const b = building({ solids: [solid({ plan: { outer: circlePlan(6), holes: [] }, height: 8, roof: roofSpec('dome') })] });
    const m = measure(evaluateBuilding(b));
    expect(m.maxY).toBeGreaterThan(8 + 5.5);
  });

  it('a taller volume through a gable roof merges (a single solid)', () => {
    const house = solid({ plan: { outer: rectPlan(12, 8), holes: [] }, height: 5, roof: roofSpec('gable') });
    const tower = solid({ plan: { outer: rectPlan(3, 3, 2, 0), holes: [] }, height: 12, roof: roofSpec('flat', { parapet: 0 }) });
    const ev = evaluateBuilding(building({ solids: [house, tower] }));
    const p = ev.shell.positions;
    // No house roof triangle stays inside the tower (the union removed it).
    let inside = 0;
    for (let t = 0; t < ev.shell.indices.length; t += 3) {
      const f = ev.faces[ev.shell.faceOf[t / 3]!]!;
      if (f.solid !== house.id || f.kind !== 'roof') continue;
      let cx = 0,
        cz = 0;
      for (let j = 0; j < 3; j++) {
        cx += p[ev.shell.indices[t + j]! * 3]! / 3;
        cz += p[ev.shell.indices[t + j]! * 3 + 2]! / 3;
      }
      if (cx > 0.6 && cx < 3.4 && cz > -1.4 && cz < 1.4) inside++;
    }
    expect(inside).toBe(0);
  });
});

describe('forma/3 facade', () => {
  it('ground and upper rules count the building floors: a raised volume (setback, inset top, upper half) gets windows, never the shops', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const { pickLevels, solidLevels } = await import('../../src/f3/eval/facade');
    const rules = () => [facadeRule('shopfront', { levels: 'ground', mode: 'max', value: 4.6, sill: 0 }), facadeRule('win-casement', { levels: 'upper', mode: 'spacing', value: 2.5 })];
    const levels = levelsFor(4, 3, 3.5);
    // Podium on the ground floors and a tower on top with the same rules (what split and inset copy).
    const podium = solid({ plan: { outer: rectPlan(16, 12), holes: [] }, height: 6.5, roof: roofSpec('flat'), facade: rules() });
    const tower = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, base: 6.5, height: 6, roof: roofSpec('flat'), facade: rules() });
    const b = building({ levels, solids: [podium, tower] });
    const ev = evaluateBuilding(b);
    const on = (s: string, family: string) => ev.placements.filter((p) => p.tag.solid === s && p.tag.family === family);
    expect(on(podium.id, 'shopfront').length).toBeGreaterThan(0);
    expect(on(tower.id, 'shopfront')).toEqual([]);
    expect(new Set(on(tower.id, 'window').map((p) => p.tag.key!.split(':')[1])).size).toBe(2);
    // The picks themselves, on the tower's floors (building floors 2 and 3).
    const tl = solidLevels(b, tower);
    expect(tl.map((l) => l.index)).toEqual([2, 3]);
    expect(pickLevels('ground', tl)).toEqual([]);
    expect(pickLevels('upper', tl).map((l) => l.index)).toEqual([2, 3]);
    expect(pickLevels('top', tl).map((l) => l.index)).toEqual([3]);
    expect(pickLevels('middle', tl).map((l) => l.index)).toEqual([2]);
    expect(pickLevels([0, 3], tl).map((l) => l.index)).toEqual([3]);
    // A volume on the ground keeps its ground floor.
    expect(pickLevels('ground', solidLevels(b, podium)).map((l) => l.index)).toEqual([0]);
  });

  it('a curved wall gets windows on every level (continuous segments)', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const b = building({ levels: levelsFor(2, 4.2, 4.6), solids: [solid({ plan: { outer: circlePlan(6.5), holes: [] }, height: 9, roof: roofSpec('dome'), facade: [facadeRule('win-arched', { mode: 'spacing', value: 3 })] })] });
    const ev = evaluateBuilding(b);
    const byLevel = new Set(ev.placements.map((p) => p.tag.key!.split(':')[1]));
    expect(ev.placements.length).toBeGreaterThanOrEqual(8);
    expect(byLevel.size).toBe(2);
  });

  it('a tapering tower distributes over the visible span of each row', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const tw = rectPlan(9, 9);
    const tower = solid({ plan: { outer: tw, holes: [] }, height: 30, taper: 2, roof: roofSpec('flat'), facade: [facadeRule('win-casement', { mode: 'spacing', value: 2 })] });
    tower.edges[tw[0]!.id] = { lean: 8 };
    const ev = evaluateBuilding(building({ levels: levelsFor(9, 3.3, 3.6), solids: [tower] }));
    const levels = new Set(ev.placements.map((p) => p.tag.key!.split(':')[1]));
    expect(levels.size).toBe(9);
    expect(ev.warnings).toEqual([]);
  });

  it('a window cuts the wall (open gap) and makes a frame', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const plain = evaluateBuilding(building({ levels: levelsFor(1, 3, 3), solids: [solid({ plan: { outer: rectPlan(6, 6), holes: [] }, height: 3, roof: roofSpec('flat', { parapet: 0 }) })] }));
    const withWin = evaluateBuilding(building({ levels: levelsFor(1, 3, 3), solids: [solid({ plan: { outer: rectPlan(6, 6), holes: [] }, height: 3, roof: roofSpec('flat', { parapet: 0 }), facade: [facadeRule('win-casement', { mode: 'count', value: 1 })] })] }));
    expect(withWin.placements).toHaveLength(4);
    expect(withWin.shell.indices.length).toBeGreaterThan(plain.shell.indices.length);
    expect(withWin.parts.inst.length + withWin.parts.meshes.length).toBeGreaterThan(8);
  });
  it('face parts sit in a right-handed frame (instance never mirrored) with z outward', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const det = (m: number[]) => m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) - m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) + m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
    const ev = evaluateBuilding(
      building({
        levels: levelsFor(3, 3, 3),
        solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 9, roof: roofSpec('flat'), facade: [facadeRule('win-casement', { mode: 'spacing', value: 2.5 }), facadeRule('balcony-glass', { mode: 'count', value: 1 })] })],
      }),
    );
    expect(ev.placements.length).toBeGreaterThan(8);
    for (const pl of ev.placements) {
      expect(det(pl.frame)).toBeCloseTo(1, 5);
      // local z points away from the plan center (origin in the middle of the rectangle).
      expect(pl.frame[8]! * pl.frame[12]! + pl.frame[10]! * pl.frame[14]!).toBeGreaterThan(0);
    }
    expect(ev.parts.inst.length).toBeGreaterThan(0);
    for (const it of ev.parts.inst) expect(det(it.m)).toBeGreaterThan(0);
  });
  it('a building copy keeps the components attached to the copied faces', async () => {
    const { cloneBuilding } = await import('../../src/f3/model/ops');
    const plan = rectPlan(8, 6);
    const s = solid({ plan: { outer: plan, holes: [] }, height: 6, roof: roofSpec('flat') });
    const b = building({ solids: [s] });
    b.items.push({ id: 'sconce', type: 'lamp-lantern', params: {}, host: { kind: 'face', solid: s.id, edge: plan[0]!.id, u: 2, y: 2 } });
    const c = cloneBuilding(b);
    expect(c.items[0]!.host).toMatchObject({ solid: c.solids[0]!.id, edge: c.solids[0]!.plan.outer[0]!.id });
    const ev = evaluateBuilding(c);
    expect(ev.warnings).toEqual([]);
    expect(ev.placements.some((p) => p.tag.item === c.items[0]!.id)).toBe(true);
  });
  it('a saved project with a component on a lost face opens repaired (with a note), without falling back to the samples', async () => {
    const { project } = await import('../../src/f3/model/defaults');
    const { migrateForma3 } = await import('../../src/f3/io/migrate');
    const plan = rectPlan(8, 6);
    const s = solid({ plan: { outer: plan, holes: [] }, height: 6, roof: roofSpec('flat') });
    const b = building({ solids: [s] });
    b.items.push({ id: 'ok', type: 'lamp-lantern', params: {}, host: { kind: 'face', solid: s.id, edge: plan[1]!.id, u: 1, y: 2 } });
    b.items.push({ id: 'loose', type: 'lamp-lantern', params: {}, host: { kind: 'face', solid: s.id, edge: 'missing-side', u: 1, y: 2 } });
    const m = migrateForma3(JSON.parse(JSON.stringify(project({ buildings: [b] }))));
    expect(m.project.buildings[0]!.items.map((x) => x.id)).toEqual(['ok']);
    expect(m.notes).toHaveLength(1);
  });
  it('real bounds: a tall cutter does not enlarge the box; roof and eave count', async () => {
    const { evaluatedBounds } = await import('../../src/f3/eval/bounds');
    const body = solid({ plan: { outer: rectPlan(18, 18), holes: [] }, height: 12, roof: roofSpec('flat', { parapet: 0.8 }) });
    const court = solid({ op: 'subtract', plan: { outer: rectPlan(8, 8), holes: [] }, base: -1, height: 30 });
    const ev = evaluateBuilding(building({ solids: [body, court] }));
    const bb = evaluatedBounds(ev)!;
    // 12 m walls + 0.8 m parapet with coping; the 29 m cutter does not count.
    expect(bb.max[1]).toBeGreaterThan(12.79);
    expect(bb.max[1]).toBeLessThan(13.2);
    expect(bb.max[0] - bb.min[0]).toBeGreaterThanOrEqual(18);
    expect(bb.max[0] - bb.min[0]).toBeLessThan(18.3);
    const hip = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3, roof: roofSpec('hip', { pitch: 30, overhang: 1 }) });
    const ev2 = evaluateBuilding(building({ solids: [hip] }));
    const b2 = evaluatedBounds(ev2, new Set([hip.id]))!;
    expect(b2.max[1]).toBeGreaterThan(4.5);
    expect(b2.max[0] - b2.min[0]).toBeGreaterThan(11.5);
    expect(evaluatedBounds(ev2, new Set([hip.id]))).toBe(b2);
  });
  it('the saved samples reopen (round trip through saving)', async () => {
    const { project } = await import('../../src/f3/model/defaults');
    const { sampleBuildings } = await import('../../src/f3/model/samples');
    const { migrateForma3 } = await import('../../src/f3/io/migrate');
    const saved = JSON.parse(JSON.stringify(project({ name: 'Samples', buildings: sampleBuildings() })));
    const m = migrateForma3(saved);
    expect(m.project.buildings.length).toBe(saved.buildings.length);
    expect(m.notes).toEqual([]);
  });
  it('a short color (#rgb) becomes the long form; an unreadable color becomes gray with a note, without rejecting the project', async () => {
    const { project } = await import('../../src/f3/model/defaults');
    const { migrateForma3 } = await import('../../src/f3/io/migrate');
    const plan = rectPlan(8, 6);
    const s = solid({ plan: { outer: plan, holes: [] }, height: 6, roof: roofSpec('flat') });
    s.materials.roof = { finish: 'membrane', color: '#7A7' };
    s.materials.trim = { finish: 'paint', color: 'blue' };
    s.edges[plan[0]!.id] = { material: { finish: 'brick', color: '#abc', color2: '#123' } };
    const m = migrateForma3(JSON.parse(JSON.stringify(project({ buildings: [building({ solids: [s] })] }))));
    const r = m.project.buildings[0]!.solids[0]!;
    expect(r.materials.roof.color).toBe('#77aa77');
    expect(r.materials.trim.color).toBe('#9a9a9a');
    expect(r.edges[plan[0]!.id]!.material).toMatchObject({ color: '#aabbcc', color2: '#112233' });
    expect(m.notes).toHaveLength(1);
  });
  it('an element detached from the rule (free with an origin) does not reflow the rule: the others stay where they were', async () => {
    const { facadeRule, levelsFor } = await import('../../src/f3/model/defaults');
    const plan = rectPlan(8, 8);
    const mk = () => solid({ plan: { outer: plan, holes: [] }, height: 6, roof: roofSpec('flat'), facade: [facadeRule('balcony-glass', { mode: 'count', value: 2, levels: 'upper', edges: [plan[0]!.id] })] });
    const before = evaluateBuilding(building({ levels: levelsFor(2, 3, 3), solids: [mk()] }));
    const balc = before.placements.filter((p) => p.family.id === 'balcony');
    expect(balc).toHaveLength(2);
    // Detach the first: a "none" exception on the rule + a free part in the same place, with the origin.
    const s = mk();
    const b = building({ levels: levelsFor(2, 3, 3), solids: [s] });
    const first = balc[0]!;
    const key = first.tag.key!;
    s.facade[0]!.except[key] = 'none';
    b.items.push({ id: 'detached', type: 'balcony-glass', params: {}, host: { kind: 'face', solid: s.id, edge: first.host!.edge, u: first.host!.s, y: first.host!.y }, origin: { solid: s.id, rule: s.facade[0]!.id, key } });
    const after = evaluateBuilding(b);
    expect(after.warnings).toEqual([]);
    const rest = after.placements.filter((p) => p.family.id === 'balcony' && p.tag.rule);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.host!.s).toBeCloseTo(balc[1]!.host!.s, 5);
    expect(after.placements.some((p) => p.tag.item === 'detached')).toBe(true);
  });
});

describe('rooms behind windows on tapered and leaning volumes', () => {
  it('away from its own opening, every room point keeps 10 cm inside the volume at its height (no holes in the neighbouring faces)', async () => {
    const THREE = await import('three');
    const { sampleBuildings } = await import('../../src/f3/model/samples');
    const { solidRings } = await import('../../src/f3/eval/body');
    const { ringsAt } = await import('../../src/f3/eval/parapet');
    const { offsetRing } = await import('../../src/f3/model/plan');
    const { inside } = await import('../../src/f3/model/ops');
    const tower = sampleBuildings().find((b) => b.name === 'Tapered tower')!;
    const s = tower.solids[0]!;
    expect(s.taper).toBeGreaterThan(0);
    expect(Object.values(s.edges).some((e) => (e.lean ?? 0) !== 0)).toBe(true);
    const ev = evaluateBuilding(tower);
    const rings = solidRings(s);
    // Room n belongs to the n-th glazed placement (rooms are numbered in placement order).
    const glazed = ev.placements.filter((p) => p.opening && (p.opening.room ?? 0) > 0.2 && p.host);
    const P = ev.shell.positions,
      I = ev.shell.indices;
    const v = new THREE.Vector3();
    let checked = 0;
    for (let t = 0; t < ev.shell.faceOf.length; t++) {
      const f = ev.faces[ev.shell.faceOf[t]!]!;
      if (f.kind !== 'roomFloor' && f.kind !== 'roomCeil' && f.kind !== 'roomWall') continue;
      const pl = glazed[f.room!]!;
      const inv = new THREE.Matrix4().fromArray(pl.frame).invert();
      for (let j = 0; j < 3; j++) {
        const i = I[t * 3 + j]! * 3;
        v.set(P[i]!, P[i + 1]!, P[i + 2]!).applyMatrix4(inv);
        if (v.z > -(pl.opening!.depth + 0.06)) continue; // its own opening: meets the wall there
        const [outer] = ringsAt(rings, Math.max(0, Math.min(s.height, P[i + 1]! - s.base)));
        const inner = offsetRing(outer!, outer!.map(() => 0.1));
        expect(inside([P[i]!, P[i + 2]!], inner), `room ${f.room} vertex at y ${P[i + 1]!.toFixed(2)} reaches a face`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('samples', () => {
  it('Tapered tower: a fixed count narrows its windows to fit the faces that shrink, instead of leaving floors blank', async () => {
    const { sampleBuildings } = await import('../../src/f3/model/samples');
    const b = sampleBuildings().find((x) => x.name === 'Tapered tower')!;
    const ev = evaluateBuilding(b);
    const perLevel = new Map<number, number>();
    let narrowed = 0;
    for (const p of ev.placements) {
      const lv = Number(p.tag.key!.split(':')[1]);
      perLevel.set(lv, (perLevel.get(lv) ?? 0) + 1);
      if (p.length < 3.4 - 1e-6) narrowed++;
    }
    // Every floor but the last on all four faces (before: from floor 6 up only two); the top floor of the
    // two faces next to the leaning wall is 0.3 m wide, too narrow for any window.
    for (let lv = 0; lv < b.levels.length - 1; lv++) expect(perLevel.get(lv)).toBe(4);
    expect(perLevel.get(b.levels.length - 1)).toBeGreaterThanOrEqual(2);
    expect(narrowed).toBeGreaterThan(0);
  });
});

describe('live modifiers, twist and revolve (Estúdio de Construção v3 ideas)', () => {
  it('repeat in a row and mirror make copies that follow the source; a copy answers for its source', async () => {
    const { building, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { withModifiers, sourceId } = await import('../../src/f3/eval/modifiers');
    const s = solid({ plan: { outer: rectPlan(4, 4, 6, 0), holes: [] }, height: 6, roof: roofSpec('flat') });
    s.repeat = { kind: 'line', count: 3, dx: 6, dz: 0 };
    s.mirror = 'x';
    const b = building({ solids: [s] });
    const m = withModifiers(b);
    expect(m.solids).toHaveLength(6);
    expect(sourceId(m.solids[3]!.id)).toBe(s.id);
    const ev = evaluateBuilding(b);
    expect(ev.warnings).toEqual([]);
    expect(ev.shell.indices.length).toBeGreaterThan(evaluateBuilding(building({ solids: [solid({ ...s, repeat: undefined, mirror: undefined })] })).shell.indices.length * 5);
  });

  it('a helix turns and raises each copy: a spiral of slabs as tall as the copies', async () => {
    const { withModifiers } = await import('../../src/f3/eval/modifiers');
    const { validateForma3 } = await import('../../src/f3/io/migrate');
    const { project } = await import('../../src/f3/model/defaults');
    const s = solid({ plan: { outer: rectPlan(4, 1.2, 2, 0), holes: [] }, height: 0.2, roof: roofSpec('flat', { parapet: 0 }) });
    s.repeat = { kind: 'helix', count: 12, cx: 0, cz: 0, rise: 0.25, turn: 30 };
    const b = building({ solids: [s] });
    const m = withModifiers(b);
    expect(m.solids).toHaveLength(12);
    expect(m.solids[11]!.base).toBeCloseTo(11 * 0.25, 6);
    // The seventh copy (i = 6) is turned 180°: its plan sits on the other side of the center.
    const xs = m.solids[6]!.plan.outer.map((v) => v.p[0]);
    expect(Math.max(...xs)).toBeCloseTo(0, 6);
    expect(Math.min(...xs)).toBeCloseTo(-4, 6);
    const ev = evaluateBuilding(b);
    expect(ev.warnings).toEqual([]);
    expect(measure(ev).maxY).toBeCloseTo(11 * 0.25 + 0.2, 2);
    expect(validateForma3(project({ buildings: [b] }))).toEqual([]);
  });

  it('a twisted volume and a revolved one evaluate to closed solids', async () => {
    const { building, circlePlan, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const tw = solid({ plan: { outer: rectPlan(8, 8), holes: [] }, height: 30, roof: roofSpec('flat'), twist: 45 });
    const ev = evaluateBuilding(building({ solids: [tw] }));
    expect(ev.warnings).toEqual([]);
    expect(ev.shell.indices.length).toBeGreaterThan(100);
    const dome = solid({ plan: { outer: circlePlan(5), holes: [] }, height: 5, roof: roofSpec('flat'), revolve: { profile: Array.from({ length: 9 }, (_, i) => [5 * Math.cos((i / 8) * (Math.PI / 2)), 5 * Math.sin((i / 8) * (Math.PI / 2))]), segments: 32 } });
    const ev2 = evaluateBuilding(building({ solids: [dome] }));
    expect(ev2.warnings).toEqual([]);
    expect(ev2.shell.indices.length / 3).toBeGreaterThan(200);
  });
});
