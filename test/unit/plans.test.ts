// Plan rules of the subscription (src/app/cloud/plans.ts): the same as the database's (supabase/migrations).
import { describe, expect, it } from 'vitest';
import { allowed, LIMITS, mergeProjects, planOf, subscriptionNote, versionsToPrune } from '../../src/app/cloud/plans';

const DAY = 864e5;
const now = Date.parse('2026-10-21T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

describe('planOf', () => {
  it('is free without a subscription or with an ended one', () => {
    expect(planOf(null, now)).toBe('free');
    expect(planOf({ status: 'canceled', current_period_end: iso(now + DAY) }, now)).toBe('free');
    expect(planOf({ status: 'incomplete', current_period_end: null }, now)).toBe('free');
    expect(planOf({ status: 'unpaid', current_period_end: iso(now + DAY) }, now)).toBe('free');
  });
  it('is Pro while active, on trial or with a payment being retried', () => {
    for (const status of ['active', 'trialing', 'past_due']) expect(planOf({ status, current_period_end: iso(now + 10 * DAY) }, now)).toBe('pro');
  });
  it('keeps Pro three days past the period end (a Pix charge is debited days after the cycle), not more', () => {
    expect(planOf({ status: 'active', current_period_end: iso(now - 2 * DAY) }, now)).toBe('pro');
    expect(planOf({ status: 'active', current_period_end: iso(now - 4 * DAY) }, now)).toBe('free');
  });
});

describe('allowed', () => {
  it('opens everything when the app has no cloud, and Pro features only to Pro with one', () => {
    expect(allowed('free', 'ifc', false)).toBe(true);
    expect(allowed('free', 'ifc', true)).toBe(false);
    expect(allowed('pro', 'ifc', true)).toBe(true);
    expect(allowed('free', null, true)).toBe(true);
  });
});

describe('subscriptionNote', () => {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  it('says when it renews, when a cancelled one ends, and when a payment is pending', () => {
    expect(subscriptionNote({ status: 'active', current_period_end: '2026-11-21T00:00:00Z' }, fmt)).toBe('Renews on 2026-11-21.');
    expect(subscriptionNote({ status: 'active', current_period_end: '2026-11-21T00:00:00Z', cancel_at_period_end: true }, fmt)).toBe('Cancelled: Pro until 2026-11-21.');
    expect(subscriptionNote({ status: 'past_due', current_period_end: '2026-11-21T00:00:00Z' }, fmt)).toMatch(/Payment pending/);
    expect(subscriptionNote(null, fmt)).toBe('');
  });
});

describe('versionsToPrune', () => {
  const v = (n: number, auto: boolean) => ({ n, auto });
  it('removes nothing under the cap', () => {
    expect(versionsToPrune([v(1, true)], LIMITS.free.versions)).toEqual([]);
  });
  it('removes the oldest automatic versions to make room, never named ones', () => {
    // Newest first: 10 versions on the free cap of 10 → one goes, the oldest automatic.
    const vs = [v(10, false), v(9, true), v(8, true), v(7, false), v(6, true), v(5, false), v(4, false), v(3, true), v(2, false), v(1, false)];
    expect(versionsToPrune(vs, 10)).toEqual([v(3, true)]);
    expect(versionsToPrune(vs, 8).map((x) => x.n)).toEqual([8, 6, 3]);
  });
  it('removes none when every version is named (the database then refuses the new one)', () => {
    expect(versionsToPrune([v(2, false), v(1, false)], 2)).toEqual([]);
  });
});

describe('mergeProjects', () => {
  it('gives one row per project, newest first, with where it is kept', () => {
    const rows = mergeProjects([{ id: 'a', at: 10 }, { id: 'b', at: 30 }], [{ id: 'a', at: 50 }, { id: 'c', at: 20 }]);
    expect(rows.map((r) => [r.id, r.at, !!r.local, !!r.cloud])).toEqual([
      ['a', 50, true, true],
      ['b', 30, true, false],
      ['c', 20, false, true],
    ]);
  });
});
