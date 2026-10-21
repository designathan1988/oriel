import { describe, expect, it } from 'vitest';
import { convertSub, edgeEnds, segDistance, subElements } from '../../src/f3/eval/subelements';
import { rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { parapetTop } from '../../src/f3/eval/parapet';

const box = () => solid({ plan: { outer: rectPlan(10, 6), holes: [] }, height: 9, roof: roofSpec('flat') });

describe('vertex / edge / face sub-elements', () => {
  it('a box has 4 corners (base and top, the top on the seen parapet) and 4 sides (base and top segments)', () => {
    const s = box();
    const { verts, edges } = subElements(s);
    expect(verts.length).toBe(4);
    expect(edges.length).toBe(4);
    for (const v of verts) {
      expect(v.base[1]).toBeCloseTo(0);
      expect(v.top[1]).toBeCloseTo(9 + parapetTop(s.roof.parapet));
    }
    for (const e of edges) expect(e.segs.length).toBe(2);
  });

  it('a tapered volume puts the top corners inside the base ones', () => {
    const s = box();
    s.taper = 1;
    const v = subElements(s).verts[0]!;
    expect(Math.hypot(v.top[0], v.top[2])).toBeLessThan(Math.hypot(v.base[0], v.base[2]));
  });

  it('a curved side is one edge with several segments; a rounded corner keeps its vertex', () => {
    const s = box();
    s.plan.outer[0]!.bulge = 0.4;
    s.plan.outer[2]!.round = 1;
    const { verts, edges } = subElements(s);
    expect(edges.find((e) => e.id === s.plan.outer[0]!.id)!.segs.length).toBeGreaterThan(4);
    expect(verts.map((v) => v.id).sort()).toEqual(s.plan.outer.map((v) => v.id).sort());
  });

  it('conversions: vertices up to edges keep only complete sides, a side down gives its two ends, all sides up give the top', () => {
    const s = box();
    const [a, b, c, d] = s.plan.outer.map((v) => v.id) as [string, string, string, string];
    expect(edgeEnds(s, a)).toEqual([a, b]);
    expect(convertSub(s, { verts: [a, b], edges: [], face: null }, 'edge').edges).toEqual([a]);
    expect(convertSub(s, { verts: [a, c], edges: [], face: null }, 'edge').edges).toEqual([]);
    expect(convertSub(s, { verts: [], edges: [b], face: null }, 'vertex').verts).toEqual([b, c]);
    expect(convertSub(s, { verts: [], edges: [a, b, c, d], face: null }, 'face').face).toEqual({ kind: 'top' });
    expect(convertSub(s, { verts: [], edges: [c], face: null }, 'face').face).toEqual({ kind: 'side', edge: c });
    expect(convertSub(s, { verts: [], edges: [], face: { kind: 'side', edge: d } }, 'vertex').verts).toEqual([a, d]);
  });

  it('segment distance in pixels', () => {
    expect(segDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(segDistance(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});
