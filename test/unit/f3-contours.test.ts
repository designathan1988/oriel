import { describe, expect, it } from 'vitest';
import { contoursToTerrain, isContour } from '../../src/f3/io/dxf';

let n = 0;
const id = () => `c${n++}`;

describe('contour lines', () => {
  it('a polyline with an elevation or on a contour layer is a contour', () => {
    expect(isContour({ layer: '0', points: [[0, 0], [1, 0]], closed: false, z: 3 })).toBe(true);
    expect(isContour({ layer: 'CURVAS DE NIVEL', points: [[0, 0], [1, 0]], closed: false })).toBe(true);
    expect(isContour({ layer: 'WALLS', points: [[0, 0], [1, 0], [1, 1]], closed: true })).toBe(false);
  });
  it('points along each line at its elevation, the drawing Y as −Z', () => {
    const pts = contoursToTerrain([{ layer: 'TOPO', points: [[0, 10], [10, 10]], closed: false, z: 5 }], id);
    expect(pts.length).toBe(5);
    expect(pts[0]).toMatchObject({ p: [0, -10], y: 5 });
    expect(pts[1]!.p).toEqual([2, -10]);
  });
});
