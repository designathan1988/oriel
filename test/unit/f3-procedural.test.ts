import { describe, expect, it } from 'vitest';
import { PROC, procKey, procParams } from '../../src/f3/render/procedural';
import { FINISHES } from '../../src/f3/render/finishes';

const isMultiple = (total: number, unit: number) => Math.abs(total / unit - Math.round(total / unit)) < 1e-9;

describe('procedural materials', () => {
  it('every textured finish has a generator or a photographed set', () => {
    for (const f of FINISHES) if (f.texture && !f.id.endsWith('-photo')) expect(PROC[f.id], f.id).toBeDefined();
  });

  it('the repeat is an exact multiple of the pattern (no visible seam)', () => {
    for (const [id, d] of Object.entries(PROC)) {
      const p = procParams(id);
      const [tw, th] = d.tile(p);
      expect(tw, id).toBeGreaterThan(0);
      expect(th, id).toBeGreaterThan(0);
      if (id === 'brick' || id === 'paving') {
        expect(isMultiple(tw, p.len! + p.joint!), id).toBe(true);
        // Running bond: two courses per vertical period.
        expect(isMultiple(th, 2 * (p.h! + p.joint!)), id).toBe(true);
      }
      if (id === 'floor') expect(isMultiple(tw, p.w! + p.joint!)).toBe(true);
      if (id === 'tile' || id === 'slate') expect(isMultiple(tw, p.w!)).toBe(true);
    }
  });

  it('out-of-range parameters are clamped and the key is stable', () => {
    const p = procParams('brick', { len: 5, joint: -1 });
    expect(p.len).toBe(0.6);
    expect(p.joint).toBe(0);
    expect(procKey('brick', { len: 0.24 })).toBe(procKey('brick', {}));
  });
});
