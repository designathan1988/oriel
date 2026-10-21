// Every window and door opens its wall: a ray from just outside the middle of each opening, going
// in, crosses no shell triangle before the room behind it. The Bungalow's short sides once kept their
// wall (the window frame showed, the sash and glass were hidden behind an uncut wall).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { sampleBuildings } from '../../src/f3/model/samples';

beforeAll(async () => {
  await loadKernel();
});

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Distance along the ray to the nearest triangle of the shell (Möller–Trumbore), or Infinity. */
function firstHit(P: Float32Array, I: Uint32Array, o: V, d: V): number {
  let best = Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const a: V = [P[I[t]! * 3]!, P[I[t]! * 3 + 1]!, P[I[t]! * 3 + 2]!];
    const b: V = [P[I[t + 1]! * 3]!, P[I[t + 1]! * 3 + 1]!, P[I[t + 1]! * 3 + 2]!];
    const c: V = [P[I[t + 2]! * 3]!, P[I[t + 2]! * 3 + 1]!, P[I[t + 2]! * 3 + 2]!];
    const e1 = sub(b, a),
      e2 = sub(c, a);
    const p = cross(d, e2);
    const det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(o, a);
    const u = dot(s, p) / det;
    if (u < 0 || u > 1) continue;
    const q = cross(s, e1);
    const v = dot(d, q) / det;
    if (v < 0 || u + v > 1) continue;
    const dist = dot(e2, q) / det;
    if (dist > 1e-6 && dist < best) best = dist;
  }
  return best;
}

describe('openings are cut through their wall', () => {
  for (const b of sampleBuildings()) {
    it(b.name, () => {
      const ev = evaluateBuilding(b);
      const blocked: string[] = [];
      let checked = 0;
      for (const pl of ev.placements) {
        if (!pl.host || !pl.opening) continue;
        checked++;
        const f = pl.frame;
        const n: V = [f[8]!, f[9]!, f[10]!];
        // The middle of the opening, 5 cm in front of the wall face, looking in.
        const y = pl.opening.h / 2;
        const o: V = [f[12]! + f[4]! * y + n[0] * 0.05, f[13]! + f[5]! * y + n[1] * 0.05, f[14]! + f[6]! * y + n[2] * 0.05];
        const hit = firstHit(ev.shell.positions, ev.shell.indices, o, [-n[0], -n[1], -n[2]]);
        // The ray must at least reach the back of the opening (a blind one, shallower than the wall,
        // stops there; one that goes through reaches its room, ≥ 0.6 m behind). Hitting the wall face
        // means the opening was not cut.
        const back = Math.min(pl.opening.depth, 0.5) + 0.05 - 0.02;
        if (hit < back) blocked.push(`${pl.family.id} side ${pl.host.edge.slice(0, 6)} s=${pl.host.s.toFixed(2)} hit at ${hit.toFixed(3)} m`);
      }
      expect(blocked).toEqual([]);
      if (b.name === 'Bungalow') expect(checked).toBe(16);
      expect(ev.warnings.filter((w) => /could not be cut/.test(w))).toEqual([]);
    });
  }
});
