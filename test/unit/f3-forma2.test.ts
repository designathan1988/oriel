import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/core/schema';
import { fromForma2, validateForma3 } from '../../src/f3/io/migrate';
import { interiorDoors } from '../../src/f3/eval/interiorwalls';

/** A forma/2 house: two storeys, one mass with brises and a cornice, a slab, a stair and an interior door. */
function house(): Project {
  const ring = (pts: [number, number][], tag: string) => ({ vertices: pts.map((p, i) => ({ id: `${tag}${i}`, p })) });
  return {
    schema: 'forma/2',
    name: 'House',
    lots: [],
    styles: [],
    meta: { createdWith: 'forma 2' },
    buildings: [
      {
        id: 'b',
        name: 'House',
        lotId: null,
        position: [0, 0],
        rotation: 0,
        storeys: [
          { id: 's0', name: 'Ground', elevation: 0, height: 3, slabThickness: 0.2, graph: { nodes: [{ id: 'n0', p: [5, 0] }, { id: 'n1', p: [5, 8] }], walls: [{ id: 'w', a: 'n0', b: 'n1', thickness: 0.12 }] }, rooms: [] },
          { id: 's1', name: 'Upper', elevation: 3, height: 3, slabThickness: 0.2, graph: { nodes: [], walls: [] }, rooms: [] },
        ],
        masses: [
          {
            id: 'm',
            name: 'Body',
            outer: ring([[0, 0], [10, 0], [10, 8], [0, 8]], 'v'),
            holes: [],
            fromStorey: 's0',
            toStorey: 's1',
            roof: { kind: 'flat', height: 0, color: '#888888' },
            facade: { pattern: 'regular', windowWidth: 1.2, windowHeight: 1.4, spacing: 3 },
            finish: { wall: '#eeeeee', trim: '#ffffff' },
            flags: { balconies: false, brise: true, cornice: true, garden: false, pilotis: false },
            edges: {},
          },
        ],
        openings: [{ id: 'o', host: { kind: 'wall', storeyId: 's0', wallId: 'w' }, storeyId: 's0', offset: 4, sill: 0, width: 0.9, height: 2.1, fill: { type: 'door' } }],
        slabs: [{ id: 'sl', storeyId: 's1', outline: [[0, 0], [10, 0], [10, 8], [0, 8]], cutouts: [[[1, 1], [2, 1], [2, 4], [1, 4]]] }],
        stairs: [{ id: 'st', fromStorey: 's0', toStorey: 's1', path: [[1.5, 1], [1.5, 4]], width: 1 }],
      },
    ],
  } as unknown as Project;
}

describe('forma/2 migration of what was left out', () => {
  const { project, notes } = fromForma2(house());
  const b = project.buildings[0]!;

  it('brises become a facade rule and the cornice a band', () => {
    const body = b.solids.find((s) => s.name === 'Body')!;
    expect(body.facade.some((r) => r.type === 'brise-h')).toBe(true);
    expect(body.bands?.length).toBeGreaterThan(0);
  });

  it('a slab becomes a thin volume on its floor with its cut-out', () => {
    const slab = b.solids.find((s) => s.name === 'Slab')!;
    expect(slab.base).toBe(3);
    expect(slab.height).toBeCloseTo(0.2);
    expect(slab.plan.holes).toHaveLength(1);
  });

  it('a stair climbs between its floors and an interior door lands on its wall', () => {
    const st = b.items.find((i) => i.type === 'stair-straight')!;
    expect(st.params.rise).toBeCloseTo(3);
    expect(interiorDoors(b.interiors.s0!)).toEqual([{ wall: 'w', u: 4, width: 0.9, height: 2.1 }]);
    expect(validateForma3(project)).toEqual([]);
    expect(notes.join(' ')).not.toMatch(/slabs and stairs|interior doors|brises|cornices/);
  });
});
