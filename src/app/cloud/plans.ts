// Plans of Oriel sold by subscription (no DOM, no network: tested in test/unit/plans.test.ts). Free: the whole
// editor, the drawings and the images, three projects in the cloud. Pro: everything — the deliveries that
// close a job with a client (virtual tour site and app, presentation, IFC, CAD, game engines), projects and
// versions without the small caps. The database enforces the same caps (supabase/migrations).
export type Plan = 'free' | 'pro';

/** What a Pro export or feature is, by the id the app gives it. */
export type ProFeature = 'tour' | 'presentation' | 'ifc' | 'dxf' | 'game' | 'compact';

export const LIMITS: Record<Plan, { projects: number; versions: number }> = {
  free: { projects: 3, versions: 10 },
  pro: { projects: Infinity, versions: 200 },
};

export const PRO_FEATURES: Record<ProFeature, string> = {
  tour: 'Publish the virtual tour (site and installable app)',
  presentation: 'Presentation for the client (3D, plans and areas)',
  ifc: 'BIM model (IFC4)',
  dxf: 'Plan for CAD (DXF)',
  game: 'Game engine package',
  compact: 'Compact 3D model (meshopt + WebP)',
};

export interface SubscriptionRow {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
  billing_interval?: string | null;
}

// Stripe statuses that keep the plan: paying, on trial, or a payment being retried (Stripe tries again for days).
const KEEPS = new Set(['active', 'trialing', 'past_due']);
const GRACE_MS = 3 * 24 * 3600 * 1000;

/** The plan a subscription gives now (the same rule as public.oriel_plan in the database). */
export function planOf(sub: SubscriptionRow | null | undefined, now = Date.now()): Plan {
  if (!sub || !KEEPS.has(sub.status)) return 'free';
  if (sub.current_period_end && Date.parse(sub.current_period_end) <= now - GRACE_MS) return 'free';
  return 'pro';
}

/** Whether a feature can be used: without the cloud configured (the app run alone, tests) everything is open. */
export function allowed(plan: Plan, feature: ProFeature | null, cloud: boolean): boolean {
  return !cloud || !feature || plan === 'pro';
}

/** A line about the subscription for the account dialog. */
export function subscriptionNote(sub: SubscriptionRow | null | undefined, fmt: (d: Date) => string): string {
  if (!sub) return '';
  const end = sub.current_period_end ? fmt(new Date(sub.current_period_end)) : '';
  if (sub.status === 'past_due') return `Payment pending: update the payment method to keep Pro.`;
  if (sub.cancel_at_period_end && end) return `Cancelled: Pro until ${end}.`;
  if (end && KEEPS.has(sub.status)) return `Renews on ${end}.`;
  return '';
}

/** Which automatic versions to delete so a new one fits under the cap (the oldest automatic ones first;
 *  named versions are never removed by the app). `versions`: newest first. */
export function versionsToPrune<T extends { auto: boolean }>(versions: T[], cap: number): T[] {
  const over = versions.length + 1 - cap;
  if (over <= 0) return [];
  return versions.filter((v) => v.auto).slice(-over);
}

/** Local and cloud projects in one list (newest first): one row per id, with where it is kept. */
export function mergeProjects<L extends { id: string; at: number }, C extends { id: string; at: number }>(
  local: L[],
  cloud: C[],
): { id: string; at: number; local?: L; cloud?: C }[] {
  const by = new Map<string, { id: string; at: number; local?: L; cloud?: C }>();
  for (const l of local) by.set(l.id, { id: l.id, at: l.at, local: l });
  for (const c of cloud) {
    const r = by.get(c.id);
    if (r) {
      r.cloud = c;
      r.at = Math.max(r.at, c.at);
    } else by.set(c.id, { id: c.id, at: c.at, cloud: c });
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}
