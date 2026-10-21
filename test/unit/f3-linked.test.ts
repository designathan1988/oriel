import { describe, expect, it } from 'vitest';
import { building, levelsFor, project, rectPlan, solid } from '../../src/f3/model/defaults';
import { Store } from '../../src/f3/editor/store';

describe('linked buildings', () => {
  it('an edit of one member is made on the others; position stays each one’s own', () => {
    const a = building({ name: 'A', position: [0, 0], levels: levelsFor(1), solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3 })] });
    a.linked = a.id;
    const b = { ...structuredClone(a), id: 'b2', name: 'B', position: [30, 0] as [number, number] };
    const p = project();
    p.buildings = [a, b];
    const st = new Store(p);
    st.project.buildings[1]!.solids[0]!.height = 9;
    st.commit(['b2'], 'taller');
    expect(st.project.buildings[0]!.solids[0]!.height).toBe(9);
    expect(st.project.buildings[0]!.position).toEqual([0, 0]);
    st.undo();
    expect(st.project.buildings.map((x) => x.solids[0]!.height)).toEqual([3, 3]);
  });
});
