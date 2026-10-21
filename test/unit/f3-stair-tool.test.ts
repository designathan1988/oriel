import { describe, expect, it } from 'vitest';
import { flightFor } from '../../src/f3/editor/tools/stair';

describe('stair tool', () => {
  it('spreads the treads over the clicked run, risers by the family rule', () => {
    const f = flightFor(3, 4.8);
    expect(f.risers).toBe(17);
    expect(f.going).toBeCloseTo(4.8 / 17, 6);
    expect(f.fits).toBe(true);
  });

  it('keeps the tread in its range and says when the run does not fit', () => {
    const short = flightFor(3, 2);
    expect(short.going).toBe(0.22);
    expect(short.fits).toBe(false);
    const long = flightFor(0.5, 4);
    expect(long.going).toBe(0.4);
    expect(long.fits).toBe(false);
  });
});
