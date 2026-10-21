import { describe, expect, it } from 'vitest';
import { building, levelsFor, project, rectPlan, solid } from '../../src/f3/model/defaults';
import { roomRows, roomScheduleCsv } from '../../src/f3/io/schedule';

describe('room schedule', () => {
  const house = () => {
    const b = building({ name: 'H', levels: levelsFor(1, 3, 3), solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3 })] });
    const lv = b.levels[0]!.id;
    b.interiors = { [lv]: { nodes: [], walls: [], rooms: [{ id: 'r1', name: 'Living', wallIds: [], polygon: [[0, 0], [5, 0], [5, 4], [0, 4]], use: 'living' }, { id: 'r2', name: 'Store', wallIds: [], polygon: [[5, 0], [7, 0], [7, 2], [5, 2]], ceiling: 2.2 }] } };
    const p = project();
    p.buildings = [b];
    return p;
  };
  it('area, perimeter, ceiling and volume per room', () => {
    const [a, b] = roomRows(house());
    expect(a).toMatchObject({ room: 'Living', use: 'living', area: 20, perimeter: 18, ceiling: 2.5, volume: 50 });
    expect(b).toMatchObject({ room: 'Store', area: 4, ceiling: 2.2, volume: 8.8 });
  });
  it('CSV with ";" and the decimal comma, totals by use', () => {
    const csv = roomScheduleCsv(house(), ',');
    expect(csv).toContain('H;Ground;Living;Living;20,00;18,00;2,50;50,00');
    expect(csv).toContain('Total;;;;24,00;;;58,80');
  });
});
