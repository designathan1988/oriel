// Facade exceptions keep their window when the layout changes (audit E1/E4): anchored locators
// (Lipp, Wonka, Wimmer 2008). A window that disappears leaves its exception reported, not moved.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { rowLocators } from '../../src/f3/eval/facade';
import { building, facadeRule, levelsFor, rectPlan, roofSpec, solid } from '../../src/f3/model/defaults';
import { splitSideAt } from '../../src/f3/model/modeling';
import type { Building3 } from '../../src/f3/model/schema';

beforeAll(async () => {
  await loadKernel();
});

/** Windows of the rule on the front side, in order along it: [s, type]. */
function row(b: Building3, edge: string) {
  const ev = evaluateBuilding(b, {}, { types: [] });
  return {
    ev,
    wins: ev.placements
      .filter((p) => p.tag.rule && p.host?.edge === edge)
      .sort((a, c) => a.host!.s - c.host!.s)
      .map((p) => ({ s: p.host!.s, fam: p.params.shape === 'arch' ? 'arched' : 'plain', key: p.tag.key! })),
  };
}

/** A front with an odd number of windows (a middle one), from 20 m up. */
function odd(spacing = 3) {
  for (let w = 20; w < 30; w += 0.5) {
    const m = make(w, spacing);
    if (row(m.b, m.edge).wins.length % 2 === 1) return m;
  }
  throw new Error('no odd row');
}

function make(width: number, spacing: number) {
  const s = solid({ plan: { outer: rectPlan(width, 10), holes: [] }, height: 3, roof: roofSpec('flat', { parapet: 0 }), plinth: 0, facade: [facadeRule('win-casement', { mode: 'spacing', value: spacing, justify: 'center', margin: 0.5 })] });
  const b = building({ levels: levelsFor(1, 3, 3), solids: [s] });
  return { b, s, edge: s.plan.outer[0]!.id };
}

describe('anchored exception locators', () => {
  it('nearest anchor first, ties to the ends', () => {
    expect(rowLocators(0, 5)[0]).toBe('s0');
    expect(rowLocators(2, 5)[0]).toBe('c0');
    expect(rowLocators(4, 5)[0]).toBe('e0');
    expect(rowLocators(1, 4)[0]).toBe('s1');
    expect(rowLocators(1, 3)[0]).toBe('c0');
  });

  it('the middle window stays the middle one when the spacing and the width change', () => {
    const { b, s, edge } = odd();
    let r = row(b, edge);
    const n = r.wins.length;
    expect(n % 2).toBe(1);
    const mid = r.wins[(n - 1) / 2]!;
    s.facade[0]!.except[mid.key] = 'win-arched';
    r = row(b, edge);
    expect(r.wins.filter((w) => w.fam === 'arched').map((w) => w.s)).toEqual([mid.s]);
    // Spacing 3 → 2.2 (more windows): still the middle one.
    s.facade[0]!.value = 2.2;
    r = row(b, edge);
    const arched = r.wins.filter((w) => w.fam === 'arched');
    expect(arched).toHaveLength(1);
    const L = s.plan.outer[1]!.p[0] - s.plan.outer[0]!.p[0];
    expect(arched[0]!.s).toBeCloseTo(L / 2, 1);
    // Width +6 m from the center: still the middle one.
    for (const v of s.plan.outer) v.p = [v.p[0] * ((L + 6) / L), v.p[1]];
    r = row(b, edge);
    const a2 = r.wins.filter((w) => w.fam === 'arched');
    expect(a2).toHaveLength(1);
    expect(a2[0]!.s).toBeCloseTo((L + 6) / 2, 1);
  });

  it('a window next to a corner stays next to it when the width changes', () => {
    const { b, s, edge } = make(20, 3);
    let r = row(b, edge);
    const last = r.wins[r.wins.length - 1]!;
    s.facade[0]!.except[last.key] = 'win-arched';
    // Width 20 → 26 (from the center).
    for (const v of s.plan.outer) v.p = [v.p[0] * 1.3, v.p[1]];
    r = row(b, edge);
    const arched = r.wins.filter((w) => w.fam === 'arched');
    expect(arched).toHaveLength(1);
    expect(arched[0]!.s).toBeCloseTo(r.wins[r.wins.length - 1]!.s, 6);
  });

  it('when the middle window is gone (even count) the exception is reported, kept, and comes back', () => {
    const { b, s, edge } = odd();
    let r = row(b, edge);
    const mid = r.wins[(r.wins.length - 1) / 2]!;
    s.facade[0]!.except[mid.key] = 'win-arched';
    // A spacing that gives an even count: no middle window.
    let spacing = 2.5;
    for (; spacing < 4; spacing += 0.05) {
      s.facade[0]!.value = spacing;
      if (row(b, edge).wins.length % 2 === 0) break;
    }
    r = row(b, edge);
    expect(r.wins.length % 2).toBe(0);
    expect(r.wins.some((w) => w.fam === 'arched')).toBe(false);
    expect(r.ev.warnings.join(' ')).toMatch(/exception has no window/);
    expect(s.facade[0]!.except[mid.key]).toBe('win-arched');
    s.facade[0]!.value = 3;
    r = row(b, edge);
    expect(r.wins.filter((w) => w.fam === 'arched').map((w) => w.s)).toEqual([mid.s]);
  });

  it('cutting the side in two: an exception counted from the end goes with the end part', () => {
    const { b, s, edge } = make(20, 3);
    let r = row(b, edge);
    const last = r.wins[r.wins.length - 1]!;
    s.facade[0]!.except[last.key] = 'win-arched';
    const id = splitSideAt(b, s, edge, 7)!;
    expect(id).toBeTruthy();
    r = row(b, id);
    const arched = r.wins.filter((w) => w.fam === 'arched');
    expect(arched).toHaveLength(1);
    expect(arched[0]!.s).toBeCloseTo(r.wins[r.wins.length - 1]!.s, 6);
  });
});
