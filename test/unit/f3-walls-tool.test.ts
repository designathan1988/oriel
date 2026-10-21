import { describe, expect, it } from 'vitest';
import { lockSegment } from '../../src/f3/editor/tools/walls';

describe('walls tool', () => {
  it('turns a slanted click to the nearest angle step and rounds the length to the grid', () => {
    // 14.41 m drawn about 3° off the X axis (a click in perspective) becomes 14.5 m along X.
    const p = lockSegment([0, 0], [14.39, 0.75], 15, 0.5);
    expect(p[0]).toBeCloseTo(14.5, 6);
    expect(p[1]).toBeCloseTo(0, 6);
  });

  it('keeps a 45° segment at 45° and never shrinks a segment to nothing', () => {
    const p = lockSegment([1, 1], [3.1, 2.9], 15, 0.5);
    expect(p[0] - 1).toBeCloseTo(p[1] - 1, 6);
    expect(lockSegment([0, 0], [0.1, 0], 15, 0.5)).toEqual([0.5, 0]);
  });

  it('draws free without steps', () => {
    expect(lockSegment([0, 0], [1.23, 0.45], 0, 0)).toEqual([1.23, 0.45]);
  });
});
