import { describe, expect, it } from 'vitest';
import { migrateForma3 } from '../../src/f3/io/migrate';
import { project } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { invert, nextSetName, pickableBuildings, recallSet, saveSet, similarBuildings, similarSolids } from '../../src/f3/model/selsets';

const sample = () => project({ name: 'P', buildings: sampleBuildings() });

describe('selection commands and sets', () => {
  it('invert keeps the order and leaves out what was selected', () => {
    expect(invert(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual(['a', 'c']);
    expect(invert(['a'], [])).toEqual(['a']);
  });

  it('hidden and locked buildings are not picked by select all', () => {
    const p = sample();
    p.buildings[0]!.hidden = true;
    p.buildings[1]!.locked = true;
    const ids = pickableBuildings(p).map((b) => b.id);
    expect(ids).not.toContain(p.buildings[0]!.id);
    expect(ids).not.toContain(p.buildings[1]!.id);
    expect(ids.length).toBe(p.buildings.length - 2);
  });

  it('similar buildings share the use; similar volumes share operation, corners and height', () => {
    const p = sample();
    const ref = p.buildings[0]!;
    const ids = similarBuildings(p, [ref.id]);
    expect(ids).toContain(ref.id);
    for (const id of ids) expect(p.buildings.find((b) => b.id === id)!.use).toBe(ref.use);
    const b = p.buildings.find((x) => x.solids.length > 1)!;
    const s = b.solids[0]!;
    const copy = { ...structuredClone(s), id: 'copy' };
    b.solids.push(copy);
    expect(similarSolids(p, b, [s.id])).toContain('copy');
    copy.height += 1;
    expect(similarSolids(p, b, [s.id])).not.toContain('copy');
  });

  it('a saved set comes back without what was deleted, and is kept when the project reopens', () => {
    const p = sample();
    const b = p.buildings.find((x) => x.solids.length > 1)!;
    const [s0, s1] = b.solids;
    const set = saveSet(p, nextSetName(p), { building: b.id, others: [], solids: [s0!.id, s1!.id], elems: [], item: null });
    expect(set.name).toBe('Set 1');
    expect(nextSetName(p)).toBe('Set 2');
    b.solids = b.solids.filter((x) => x.id !== s1!.id);
    expect(recallSet(p, set)!.solids).toEqual([s0!.id]);
    b.solids = b.solids.filter((x) => x.id !== s0!.id);
    expect(recallSet(p, set)).toBeNull();
    const out = migrateForma3(JSON.parse(JSON.stringify(p))).project;
    expect(out.selectionSets?.[0]?.name).toBe('Set 1');
  });

  it('a set of buildings survives losing its main building', () => {
    const p = sample();
    const [a, b, c] = p.buildings;
    const set = saveSet(p, 'Row', { building: a!.id, others: [b!.id, c!.id], solids: [], elems: [], item: null });
    p.buildings = p.buildings.filter((x) => x.id !== a!.id);
    expect(recallSet(p, set)).toEqual({ building: b!.id, others: [c!.id], solids: [], elems: [], item: null });
  });

  it('saving under an existing name replaces that set', () => {
    const p = sample();
    const b = p.buildings[0]!;
    saveSet(p, 'A', { building: b.id, others: [], solids: [], elems: [], item: null });
    saveSet(p, 'A', { building: p.buildings[1]!.id, others: [], solids: [], elems: [], item: null });
    expect(p.selectionSets!.length).toBe(1);
    expect(p.selectionSets![0]!.sel.building).toBe(p.buildings[1]!.id);
  });
});
