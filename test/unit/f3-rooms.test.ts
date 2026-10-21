import { describe, expect, it } from 'vitest';
import { loopAround, roomArea, addRoomRect, addInteriorWall } from '../../src/f3/eval/interiorwalls';
import { building, levelsFor } from '../../src/f3/model/defaults';
import type { Vec2 } from '../../src/f3/model/schema';

let n = 0;
const uid = () => `u${n++}`;

describe('rooms from walls', () => {
  it('a closed loop of interior walls is the room around a point', () => {
    const b = building({ levels: levelsFor(1) });
    const lv = b.levels[0]!.id;
    addRoomRect(b, lv, [0, 0], [4, 3], 0.12, 'A', uid);
    const r = loopAround(b.interiors[lv]!, [1, 1])!;
    expect(roomArea(r.polygon)).toBeCloseTo(12, 6);
  });

  it('the outer walls close a room together with interior walls', () => {
    const b = building({ levels: levelsFor(1) });
    const lv = b.levels[0]!.id;
    const inner: Vec2[] = [[-7.875, -5.875], [7.875, -5.875], [7.875, 5.875], [-7.875, 5.875]];
    addRoomRect(b, lv, [-7.8, -5.8], [-1, 0], 0.12, 'A', uid);
    addInteriorWall(b, lv, [-1, 0], [-1, 5.5], 0.12, uid);
    const r = loopAround(b.interiors[lv]!, [4, 2], [inner]);
    expect(r).not.toBeNull();
    // East part: 8.875 × 11.75.
    expect(roomArea(r!.polygon)).toBeCloseTo(8.875 * 11.75, 0);
  });
});

describe('rooms with walls drawn past the inner face', () => {
  it('ends outside the face are taken onto it', () => {
    const b = building({ levels: levelsFor(1) });
    const lv = b.levels[0]!.id;
    const inner: Vec2[] = [[-7.875, -5.875], [7.875, -5.875], [7.875, 5.875], [-7.875, 5.875]];
    addRoomRect(b, lv, [-8, -6], [-1, 0], 0.12, 'A', uid);
    addInteriorWall(b, lv, [-1, 0], [-1, 5.5], 0.12, uid);
    const r = loopAround(b.interiors[lv]!, [4, 2], [inner]);
    expect(r).not.toBeNull();
    expect(roomArea(r!.polygon)).toBeCloseTo(8.875 * 11.75, 0);
    const west = loopAround(b.interiors[lv]!, [-5, 3], [inner]);
    expect(roomArea(west!.polygon)).toBeCloseTo(6.875 * 5.875, 0);
  });
});
