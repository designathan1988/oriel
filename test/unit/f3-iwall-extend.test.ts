import { describe, expect, it } from 'vitest';
import { building, levelsFor, rectPlan, solid } from '../../src/f3/model/defaults';
import { addInteriorWall, extendInteriorWall, interiorDoors, type InteriorWithDoors } from '../../src/f3/eval/interiorwalls';

let n = 0;
const id = () => `w${n++}`;

describe('extendInteriorWall', () => {
  it('reaches the next wall and splits it there, keeping its door', () => {
    const b = building({ levels: levelsFor(1), solids: [solid({ plan: { outer: rectPlan(10, 8), holes: [] }, height: 3 })] });
    const lv = b.levels[0]!.id;
    addInteriorWall(b, lv, [-4, 0], [4, 0], 0.12, id);
    const w = addInteriorWall(b, lv, [0, -3], [0, -1], 0.12, id);
    const it = b.interiors[lv] as InteriorWithDoors;
    it.doors = [{ wall: w, u: 1, width: 0.8, height: 2.1 }];
    expect(extendInteriorWall(b, lv, w, 'b', [], id)).toBe(true);
    // The long wall now ends at (0, 0): split in two, and the extended one reaches it.
    const nodes = new Map(it.nodes.map((x) => [x.id, x.p]));
    expect(it.walls.some((x) => [nodes.get(x.a), nodes.get(x.b)].some((p) => p && Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6))).toBe(true);
    expect(it.walls.length).toBe(3);
    expect(interiorDoors(it)).toHaveLength(1);
    expect(interiorDoors(it)[0]!.u).toBeCloseTo(1);
  });
  it('nothing in the way: no change', () => {
    const b = building({ levels: levelsFor(1), solids: [] });
    const lv = b.levels[0]!.id;
    const w = addInteriorWall(b, lv, [0, 0], [2, 0], 0.12, id);
    expect(extendInteriorWall(b, lv, w, 'b', [], id)).toBe(false);
  });
});
