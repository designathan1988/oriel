// Properties that must hold for any sequence of edits, not only the ones a test author thought of:
// fast-check draws random sequences of model operations (push a side, move a corner, change a height,
// move, turn, copy and delete buildings) on the samples, each one recorded as a history step, and
// checks after them that
//   - the document stays valid (what f3/io/migrate.ts validateForma3 accepts opens again);
//   - undo all of them gives back the first document byte for byte, redo all gives the last;
//   - saving and opening is stable (open → save → open → save gives the same text twice);
//   - every edited building evaluates without throwing, to finite numbers.
// A time limit caps each property (a few seconds); a failure prints its seed and the shrunk sequence,
// which `fc.assert(..., { seed, path })` replays.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { Store } from '../../src/f3/editor/store';
import { project } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { cloneBuilding, moveVertex, pushEdge, rotateSolid, translateSolid } from '../../src/f3/model/ops';
import { toForma3, validateForma3 } from '../../src/f3/io/migrate';
import type { Project3 } from '../../src/f3/model/schema';

beforeAll(async () => {
  await loadKernel();
});

const LIMIT = { numRuns: 40, interruptAfterTimeLimit: 4_000 } as const;

/** One edit: which building, solid and corner it picks (by index, wrapped) and how much. */
type Edit =
  | { kind: 'push'; b: number; s: number; v: number; d: number }
  | { kind: 'corner'; b: number; s: number; v: number; dx: number; dz: number }
  | { kind: 'height'; b: number; s: number; h: number }
  | { kind: 'move'; b: number; s: number; dx: number; dz: number }
  | { kind: 'turn'; b: number; s: number; deg: number }
  | { kind: 'copy'; b: number }
  | { kind: 'delete'; b: number };

const i = fc.nat(50);
const len = fc.double({ min: -6, max: 6, noNaN: true });
const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant('push' as const), b: i, s: i, v: i, d: len }),
  fc.record({ kind: fc.constant('corner' as const), b: i, s: i, v: i, dx: len, dz: len }),
  fc.record({ kind: fc.constant('height' as const), b: i, s: i, h: fc.double({ min: 0.5, max: 60, noNaN: true }) }),
  fc.record({ kind: fc.constant('move' as const), b: i, s: i, dx: len, dz: len }),
  fc.record({ kind: fc.constant('turn' as const), b: i, s: i, deg: fc.integer({ min: -180, max: 180 }) }),
  fc.record({ kind: fc.constant('copy' as const), b: i }),
  fc.record({ kind: fc.constant('delete' as const), b: i }),
);

/** Applies an edit to the store's project and records it; the ids of the buildings it changed. */
function apply(st: Store, e: Edit): string[] {
  const bs = st.project.buildings;
  if (!bs.length) return [];
  const b = bs[e.b % bs.length]!;
  if (e.kind === 'copy') {
    const c = cloneBuilding(b);
    c.position = [b.position[0] + 40, b.position[1]];
    bs.push(c);
    st.commit([c.id], 'copy');
    return [c.id];
  }
  if (e.kind === 'delete') {
    st.project.buildings = bs.filter((x) => x !== b);
    st.commit(null, 'delete');
    return [];
  }
  const s = b.solids[e.s % Math.max(1, b.solids.length)];
  if (!s) return [];
  const ring = s.plan.outer;
  if (e.kind === 'push') pushEdge(s, ring[e.v % ring.length]!.id, e.d);
  else if (e.kind === 'corner') {
    const v = ring[e.v % ring.length]!;
    moveVertex(s, v.id, [v.p[0] + e.dx, v.p[1] + e.dz]);
  }
  else if (e.kind === 'height') s.height = e.h;
  else if (e.kind === 'move') translateSolid(s, e.dx, e.dz);
  else rotateSolid(s, e.deg);
  st.commit([b.id], e.kind);
  return [b.id];
}

const fresh = (): Project3 => project({ name: 'Samples', buildings: sampleBuildings() });

describe('properties of editing (fast-check)', () => {
  it('any sequence of edits keeps the document valid, and undo/redo walk it back and forth exactly', () => {
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 12 }), (edits) => {
        const st = new Store(fresh());
        const first = st.json();
        let steps = 0;
        for (const e of edits) {
          const seq = st.seq;
          apply(st, e);
          if (st.seq !== seq) steps++;
          expect(validateForma3(JSON.parse(st.json())), `after ${e.kind}`).toEqual([]);
        }
        const last = st.json();
        for (let k = 0; k < steps; k++) expect(st.undo()).toBe(true);
        expect(st.json()).toBe(first);
        for (let k = 0; k < steps; k++) expect(st.redo()).toBe(true);
        expect(st.json()).toBe(last);
      }),
      LIMIT,
    );
  });

  it('saving and opening an edited project is stable', () => {
    fc.assert(
      fc.property(fc.array(edit, { minLength: 1, maxLength: 8 }), (edits) => {
        const st = new Store(fresh());
        for (const e of edits) apply(st, e);
        const once = JSON.stringify(toForma3(JSON.parse(st.json())));
        const twice = JSON.stringify(toForma3(JSON.parse(once)));
        expect(twice).toBe(once);
      }),
      LIMIT,
    );
  });

  it('every edited building evaluates to finite geometry', () => {
    fc.assert(
      fc.property(fc.array(edit.filter((e) => e.kind !== 'copy' && e.kind !== 'delete'), { minLength: 1, maxLength: 4 }), (edits) => {
        const st = new Store(fresh());
        const touched = new Set<string>();
        for (const e of edits) for (const id of apply(st, e)) touched.add(id);
        for (const id of touched) {
          const b = st.building(id)!;
          const ev = evaluateBuilding(b, {}, st.project);
          expect(ev.shell.positions.every(Number.isFinite), `${b.name}: positions`).toBe(true);
          expect(ev.shell.indices.length % 3).toBe(0);
        }
      }),
      { numRuns: 15, interruptAfterTimeLimit: 5_000 },
    );
  });
});
