import { describe, expect, it } from 'vitest';
import { migrateForma3 } from '../../src/f3/io/migrate';
import { project } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';

describe('forma/3 opening of older saves', () => {
  it('default names saved in Portuguese become English; names the user typed stay', () => {
    const p = project({ name: 'Exemplos', buildings: sampleBuildings() });
    const barn = p.buildings.find((b) => b.name === 'Barn')!;
    barn.name = 'Celeiro';
    barn.levels[0]!.name = 'Térreo';
    if (barn.levels[1]) barn.levels[1].name = '1º pavimento';
    p.buildings[0]!.name = 'Minha casa';
    const out = migrateForma3(JSON.parse(JSON.stringify(p))).project;
    expect(out.name).toBe('Samples');
    const b = out.buildings.find((x) => x.id === barn.id)!;
    expect(b.name).toBe('Barn');
    expect(b.levels[0]!.name).toBe('Ground');
    if (b.levels[1]) expect(b.levels[1].name).toBe('Floor 1');
    expect(out.buildings[0]!.name).toBe('Minha casa');
  });

  it('a renamed built-in type keeps working in saved facade rules', () => {
    const p = project({ name: 'P', buildings: sampleBuildings() });
    p.buildings[0]!.solids[0]!.facade.push({ ...p.buildings[0]!.solids[0]!.facade[0]!, id: 'old-rule', type: 'win-basculante' });
    const out = migrateForma3(JSON.parse(JSON.stringify(p))).project;
    expect(out.buildings[0]!.solids[0]!.facade.find((r) => r.id === 'old-rule')!.type).toBe('win-hopper');
  });
});
