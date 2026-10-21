import { describe, expect, it } from 'vitest';
import { evalExpr } from '../../src/f3/model/expr';
import { parseLength } from '../../src/f3/editor/editor';

describe('typed arithmetic', () => {
  it('reads sums, products, brackets and units', () => {
    expect(evalExpr('3*2.5')).toBeCloseTo(7.5, 9);
    expect(evalExpr('(4+2)/3')).toBeCloseTo(2, 9);
    expect(evalExpr('250cm + 1m')).toBeCloseTo(3.5, 9);
    expect(evalExpr('-2 + 5')).toBe(3);
    expect(evalExpr('2,5 * 2')).toBe(5);
    expect(evalExpr('1/0')).toBeNull();
    expect(evalExpr('alert(1)')).toBeNull();
    expect(evalExpr('3 +')).toBeNull();
  });

  it('the measurements box takes them', () => {
    expect(parseLength('10/4')).toBeCloseTo(2.5, 9);
    expect(parseLength('3m')).toBe(3);
    expect(parseLength('-1.5')).toBe(-1.5);
  });
});

describe('parameter formulas', () => {
  it('a number parameter written as a formula of the others', async () => {
    const { family } = await import('../../src/f3/families/index');
    const { resolveParams } = await import('../../src/f3/families/family');
    expect(evalExpr('width/2', { width: 3 })).toBe(1.5);
    expect(evalExpr('Width*2', { width: 3 })).toBe(6);
    expect(evalExpr('depth', { width: 3 })).toBeNull();
    const f = family('bench')!;
    const p = resolveParams(f, { width: 2.4, depth: '=width/4' });
    expect(p.depth).toBeCloseTo(0.6, 9);
    // A formula that does not read keeps the default.
    const q = resolveParams(f, { depth: '=nothing*2' });
    expect(q.depth).toBe(resolveParams(f, {}).depth);
  });
});

describe('arc through three points', () => {
  it('passes through the middle point and ends at both chord ends', async () => {
    const THREE = await import('three');
    const { arcSample } = await import('../../src/f3/editor/editor');
    const pts = arcSample(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 0, 0), new THREE.Vector3(10, 0, -10), 4)!;
    expect(pts[0]!.x).toBeCloseTo(0, 6);
    expect(pts[4]!.x).toBeCloseTo(20, 6);
    expect(pts[2]!.x).toBeCloseTo(10, 6);
    expect(pts[2]!.z).toBeCloseTo(-10, 6);
    expect(arcSample(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(2, 0, 0), 4)).toBeNull();
  });
});
