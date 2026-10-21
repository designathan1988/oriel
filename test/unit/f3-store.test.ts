import { describe, expect, it } from 'vitest';
import { Store } from '../../src/f3/editor/store';
import { project } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { viewOf } from '../../src/f3/model/layers';

describe('store guard (editing locked while the floors are drawn apart)', () => {
  it('undoes and reports any change but the view state', () => {
    const st = new Store(project({ name: 'P', buildings: sampleBuildings() }));
    const n = st.project.buildings.length;
    const blocked: string[] = [];
    st.guard = () => 'locked';
    st.onBlocked = (why) => blocked.push(why);
    // An edit: removed, and the reason is reported.
    st.project.buildings.pop();
    expect(st.commit(null, 'Building deleted.')).toBe(false);
    expect(st.project.buildings.length).toBe(n);
    expect(blocked).toEqual(['locked']);
    expect(st.canUndo).toBe(false);
    // The view may change (that is how the gap or the cut are set).
    viewOf(st.project).explode = 6;
    expect(st.commit(null, '', false)).toBe(true);
    expect(st.project.view?.explode).toBe(6);
    // Without the guard, edits record again.
    st.guard = null;
    st.project.buildings.pop();
    expect(st.commit(null, 'Building deleted.')).toBe(true);
    expect(st.project.buildings.length).toBe(n - 1);
  });
});

describe('undo and redo re-evaluate only what changed', () => {
  const touched = (st: Store, step: () => void): string[] | null => {
    const before = new Map(st.revision);
    step();
    const ids = st.project.buildings.filter((b) => st.revision.get(b.id) !== before.get(b.id)).map((b) => b.id);
    return ids.length === st.project.buildings.length ? null : ids;
  };

  it('touches the edited building, a returning one, or all when something shared changed', () => {
    const st = new Store(project({ name: 'P', buildings: sampleBuildings() }));
    const [a, b] = st.project.buildings;
    // One building edited: undo and redo touch only it.
    a!.solids[0]!.height += 1;
    st.commit([a!.id], 'Taller.');
    expect(touched(st, () => st.undo())).toEqual([a!.id]);
    expect(st.project.buildings[0]!.solids[0]!.height).toBe(a!.solids[0]!.height - 1);
    expect(touched(st, () => st.redo())).toEqual([a!.id]);
    // A deleted building: undo brings it back and draws only it; redo drops it without redrawing the rest.
    const n = st.project.buildings.length;
    st.project.buildings = st.project.buildings.filter((x) => x.id !== b!.id);
    st.commit(null, 'Building deleted.');
    expect(touched(st, () => st.undo())).toEqual([b!.id]);
    expect(st.project.buildings.length).toBe(n);
    expect(touched(st, () => st.redo())).toEqual([]);
    expect(st.project.buildings.length).toBe(n - 1);
    // A view step (the exploded gap): nothing re-evaluated, the view compares its own keys.
    viewOf(st.project).explode = 6;
    st.commit(null, '', false);
    expect(touched(st, () => st.undo())).toEqual([]);
    expect(st.project.view?.explode).toBeUndefined();
    // A shared change (component types): every building again.
    st.project.types.push({ id: 't1', name: 'Mine', family: 'win-casement', params: {} } as never);
    st.commit(null, 'Type added.');
    expect(touched(st, () => st.undo())).toBeNull();
  });
});

describe('a commit that changes nothing', () => {
  it('records no step, re-evaluates nothing and says so (audit F11: the same roof chosen again)', () => {
    const st = new Store(project({ name: 'P', buildings: sampleBuildings() }));
    const seq = st.seq;
    const rev = new Map(st.revision);
    let events = 0;
    st.on(() => events++);
    st.project.buildings[0]!.solids[0]!.roof.kind = st.project.buildings[0]!.solids[0]!.roof.kind;
    expect(st.commit([st.project.buildings[0]!.id], 'Roof changed.')).toBe(true);
    expect(st.changed).toBe(false);
    expect(st.seq).toBe(seq);
    expect(st.canUndo).toBe(false);
    expect(new Map(st.revision)).toEqual(rev);
    expect(events).toBe(0);
    st.project.buildings[0]!.solids[0]!.height += 1;
    st.commit([st.project.buildings[0]!.id], 'Taller.');
    expect(st.changed).toBe(true);
    expect(st.seq).toBe(seq + 1);
  });
});

describe('saved niches get their wall back', () => {
  it('a recess whose first side lies on a wall is hosted by that volume when the project opens', async () => {
    const { toForma3 } = await import('../../src/f3/io/migrate');
    const { building, rectPlan, roofSpec, solid } = await import('../../src/f3/model/defaults');
    const { insetSide } = await import('../../src/f3/model/modeling');
    const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6, roof: roofSpec('flat') });
    const b = building({ solids: [s] });
    const n = insetSide(b, s, s.plan.outer[0]!.id, 1, -1)!;
    delete n.host;
    const p = toForma3(JSON.parse(JSON.stringify(project({ name: 'Old', buildings: [b] }))));
    expect(p.buildings[0]!.solids[1]!.host).toEqual({ solid: s.id, edge: s.plan.outer[0]!.id });
    // A volume the user drew is never taken for one.
    expect(p.buildings[0]!.solids[0]!.host).toBeUndefined();
  });
});
