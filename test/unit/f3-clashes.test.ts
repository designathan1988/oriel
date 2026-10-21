import { describe, expect, it } from 'vitest';
import { building, levelsFor, rectPlan, solid } from '../../src/f3/model/defaults';
import { addInteriorWall } from '../../src/f3/eval/interiorwalls';
import { stairClashes } from '../../src/f3/eval/clashes';

let n = 0;
const id = () => `c${n++}`;
const house = () => {
  const s = solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 6 });
  s.shell = 0.25;
  return building({ levels: levelsFor(2, 3, 3), solids: [s] });
};
const stair = (p: [number, number, number]) => ({ id: id(), type: 'stair-straight', params: { rise: 3 }, host: { kind: 'free' as const, p, rot: 0 } });

describe('stairClashes', () => {
  it('a flight clear of every wall: nothing', () => {
    const b = house();
    b.items.push(stair([-3, 0, -3]));
    expect(stairClashes(b)).toEqual([]);
  });
  it('a flight through the outer wall', () => {
    const b = house();
    b.items.push(stair([-3, 0, 0]));
    expect(stairClashes(b)).toEqual(['A stair runs into the outer wall on Ground.']);
  });
  it('a flight across an interior wall', () => {
    const b = house();
    b.items.push(stair([-3, 0, -3]));
    addInteriorWall(b, b.levels[0]!.id, [-5, 0], [5, 0], 0.12, id);
    expect(stairClashes(b)).toEqual(['A stair crosses an interior wall on Ground.']);
  });
});
