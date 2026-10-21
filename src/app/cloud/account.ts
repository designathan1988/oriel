// Account, plan and cloud saving (app layer). The account button at the right of the top bar opens a dialog to
// sign in (a link by e-mail, or Google), see the plan and subscribe to Pro (Stripe page: card or Pix) or manage
// the subscription. Signed in, the open project is also saved in the cloud a few seconds after each change,
// with its thumbnail, and an automatic cloud version every 15 minutes while it changes. When another computer
// changed the cloud copy since this one last saw it, that copy is kept as a version before it is replaced.
// Without the cloud configured (api.ts) nothing here shows and every feature stays open.
import type { Editor3 } from '../../f3/editor/editor';
import { icon } from '../../f3/ui/icons';
import { tr } from '../../f3/ui/i18n';
import { cloud, cloudEnabled, type CloudApi, type CloudUser, type LimitError } from './api';
import { allowed, LIMITS, planOf, PRO_FEATURES, subscriptionNote, versionsToPrune, type Plan, type ProFeature, type SubscriptionRow } from './plans';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const env = import.meta.env as Record<string, string | undefined>;
const PRICE_MONTH = env.VITE_PRO_PRICE_MONTH || 'R$ 49';
const PRICE_YEAR = env.VITE_PRO_PRICE_YEAR || 'R$ 490';
// Pix in the subscription only where the Stripe account has Pix Automático (not for companies based in Brazil:
// https://docs.stripe.com/payments/pix): the dialog never promises it otherwise.
const PIX = env.VITE_PAYMENT_PIX === '1';

export type SyncState = 'off' | 'saving' | 'saved' | 'local' | 'error';

export interface Account {
  readonly enabled: boolean;
  user(): CloudUser | null;
  plan(): Plan;
  /** Whether a Pro feature can be used now; when not, the upgrade dialog opens and the answer is false. */
  gate(feature: ProFeature): boolean;
  open(): void;
  /** The cloud backend, when signed in (the start screen and the versions dialog use it). */
  api(): Promise<CloudApi | null>;
  /** Saves the project now (after a local save). */
  push(id: string, json: string): void;
  /** Saves a named version in the cloud (the oldest automatic ones make room under the plan cap). */
  saveVersion(id: string, label: string, json: string): Promise<void>;
  /** Forget the sync record of a project (opened from the cloud: what is there is what this computer has). */
  synced(id: string, at: number): void;
  /** Called when the user or the plan changes. */
  onChange(fn: () => void): void;
}

const SYNC_KEY = 'oriel_cloud_synced';
function syncedMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}
function setSynced(id: string, at: number): void {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ ...syncedMap(), [id]: at }));
  } catch {
    /* only the conflict guard is weaker */
  }
}

/** A small picture of the current view for the project lists (320×200 WebP). */
async function thumbnail(ed: Editor3): Promise<Blob | null> {
  try {
    const v = ed.view;
    v.renderer.render(v.scene, v.camera);
    const src = v.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 200;
    const g = c.getContext('2d')!;
    const k = Math.max(320 / src.width, 200 / src.height);
    const w = 320 / k,
      h = 200 / k;
    g.drawImage(src, (src.width - w) / 2, (src.height - h) / 2, w, h, 0, 0, 320, 200);
    return await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/webp', 0.8));
  } catch {
    return null;
  }
}

export function mountAccount(ed: Editor3, currentId: () => string): Account {
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((f) => f());
  let user: CloudUser | null = null;
  let sub: SubscriptionRow | null = null;
  let state: SyncState = 'off';
  let stateNote = '';
  // Projects that stay in this browser this session (the free plan is full).
  const localOnly = new Set<string>();

  const disabled: Account = {
    enabled: false,
    user: () => null,
    plan: () => 'pro',
    gate: () => true,
    open: () => undefined,
    api: async () => null,
    push: () => undefined,
    saveVersion: async () => undefined,
    synced: () => undefined,
    onChange: () => undefined,
  };
  if (!cloudEnabled) return disabled;

  const btn = document.createElement('button');
  btn.className = 'f3-tb f3-acctbtn';
  btn.dataset.cmd = 'account';
  ed.shell.top.querySelector('[data-cmd="export"]')?.after(btn);
  const paint = () => {
    const plan = planOf(sub);
    const s = state === 'saving' ? 'Saving in the cloud…' : state === 'saved' ? 'Saved in the cloud' : state === 'local' ? 'Kept only in this browser' : state === 'error' ? 'Cloud saving failed' : '';
    btn.dataset.state = state;
    btn.innerHTML = user
      ? `<span class="av" aria-hidden="true">${esc((user.email[0] ?? '?').toUpperCase())}</span>${plan === 'pro' ? '<b class="pro">PRO</b>' : ''}<i class="cl">${icon(state === 'local' || state === 'error' ? 'cloudoff' : 'cloud')}</i>`
      : `${icon('user')}<span>Sign in</span>`;
    const t = user ? `${user.email} · ${plan === 'pro' ? 'Pro' : tr('Free plan')}${s ? ' · ' + tr(s) : ''}${stateNote ? ' · ' + stateNote : ''}` : tr('Sign in to save in the cloud and subscribe');
    btn.title = t;
    btn.setAttribute('aria-label', t);
  };
  const setState = (s: SyncState, note = '') => {
    state = s;
    stateNote = note;
    paint();
  };
  paint();

  const refreshPlan = async () => {
    const a = await cloud();
    try {
      sub = a.user() ? await a.subscription() : null;
    } catch {
      /* the plan stays as it was */
    }
    paint();
    changed();
  };

  void cloud().then((a) =>
    a.onUser((u) => {
      const was = user?.id;
      user = u;
      if (!u) sub = null;
      setState(u ? 'saved' : 'off');
      if (u && u.id !== was) {
        void refreshPlan();
        // Signed in now: the open project goes to the cloud (if it has anything in it).
        // Through the app's save: kept in this browser too, then sent.
        if (ed.project.buildings.length) void Promise.resolve(ed.persist(ed.store.json())).catch(() => undefined);
      }
      changed();
    }),
  );

  // Back from Stripe (?assinatura=ok|cancelada): the webhook may take a moment, so the plan is read a few times.
  const q = new URLSearchParams(location.search);
  const back = q.get('assinatura');
  const authError = q.get('error_description');
  if (back || authError) {
    q.delete('assinatura');
    ['error', 'error_code', 'error_description'].forEach((k) => q.delete(k));
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  }
  if (authError) ed.toast(`${tr('Sign in failed')}: ${authError}`);
  if (back === 'cancelada') ed.toast('Subscription not completed: nothing was charged.');
  if (back === 'ok') {
    ed.toast('Payment received: activating Pro…');
    let n = 0;
    const tick = async () => {
      await refreshPlan();
      if (planOf(sub) === 'pro') return ed.toast('Pro is active. Thank you!');
      if (++n < 15) setTimeout(tick, 2000);
      else ed.toast('The payment is being confirmed (Pix can take a few minutes). Pro turns on by itself.');
    };
    setTimeout(tick, 800);
  }

  // ── Saving in the cloud ──
  let timer = 0;
  let pending: { id: string; json: string } | null = null;
  let lastThumb = 0;
  let lastVersion = Date.now();
  let lastVersionJson = '';
  const flush = async () => {
    const job = pending;
    pending = null;
    if (!job || !user || localOnly.has(job.id)) return;
    const a = await cloud();
    setState('saving');
    try {
      // Changed elsewhere since this computer last saw it: that copy is kept as a version first.
      const known = syncedMap()[job.id];
      const there = await a.projectAt(job.id);
      if (there !== null && known !== undefined && there > known + 1000) {
        await a.putVersion(job.id, tr('Copy from another computer'), true, await a.getProject(job.id)).catch(() => undefined);
      }
      const thumb = Date.now() - lastThumb > 60_000 ? await thumbnail(ed) : null;
      if (thumb) lastThumb = Date.now();
      await a.putProject(job.id, { name: ed.project.name, buildings: ed.project.buildings.length }, job.json, thumb);
      setSynced(job.id, Date.now());
      setState('saved', new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
      // The automatic cloud version, every 15 minutes while the project changes.
      if (Date.now() - lastVersion > 15 * 60_000 && job.json !== lastVersionJson) {
        lastVersion = Date.now();
        lastVersionJson = job.json;
        await saveVersion(a, job.id, tr(`Automatic ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`), true, job.json).catch(() => undefined);
      }
    } catch (e) {
      if ((e as Partial<LimitError>).what === 'projects') {
        localOnly.add(job.id);
        setState('local');
        ed.toast(`The free plan keeps ${LIMITS.free.projects} projects in the cloud: this one stays in this browser. Pro keeps them all.`);
      } else setState('error', (e as Error).message);
    }
  };

  /** Saves a version under the plan cap: the oldest automatic ones make room; named ones are never removed. */
  async function saveVersion(a: CloudApi, id: string, label: string, auto: boolean, json: string): Promise<void> {
    const cap = LIMITS[planOf(sub)].versions;
    const vs = await a.listVersions(id);
    for (const v of versionsToPrune(vs, cap)) await a.deleteVersion(id, v.vid);
    await a.putVersion(id, label, auto, json);
  }

  // ── Dialog ──
  const openDialog = (why?: ProFeature) => {
    ed.shell.root.querySelector('.f3-modal.f3-acct-modal')?.remove();
    const m = document.createElement('div');
    m.className = 'f3-modal f3-acct-modal';
    const plan = planOf(sub);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: 'medium' });
    const note = subscriptionNote(sub, fmt);
    const proCard = `<div class="plan pro${plan === 'pro' ? ' cur' : ''}"><h4>Pro ${plan === 'pro' ? '<em>Your plan</em>' : ''}</h4>
      <p class="price"><b data-i18n-skip>${esc(PRICE_MONTH)}</b> <span>/month</span> <small>${tr('or')} <span data-i18n-skip>${esc(PRICE_YEAR)}</span> ${tr('per year')}</small></p>
      <ul><li>Everything in Free</li><li>Unlimited projects in the cloud, 200 versions each</li><li>Virtual tour: site and installable app</li><li>Presentation for the client</li><li>IFC, DXF and game engine exports</li></ul>
      ${
        !user
          ? '<p class="hint">Sign in above to subscribe.</p>'
          : plan === 'pro'
            ? `<button class="f3-btn" data-portal>Manage subscription</button>${note ? `<p class="hint">${esc(tr(note))}</p>` : ''}`
            : `<div class="buy"><button class="f3-btn primary" data-buy="month">Subscribe monthly</button><button class="f3-btn" data-buy="year">Subscribe yearly</button></div><p class="hint">${PIX ? 'Card or Pix. Cancel at any time.' : 'Card. Cancel at any time.'}</p>`
      }</div>`;
    const freeCard = `<div class="plan${plan === 'free' ? ' cur' : ''}"><h4>Free ${plan === 'free' && user ? '<em>Your plan</em>' : ''}</h4><p class="price"><b data-i18n-skip>R$ 0</b></p>
      <ul><li>The whole editor and the catalog</li><li>Drawings in PDF, SVG, quantities</li><li>Photorealistic images, GLB and OBJ</li><li>${LIMITS.free.projects} projects in the cloud, ${LIMITS.free.versions} versions each</li></ul></div>`;
    m.innerHTML = `<div class="f3-acct" role="dialog" aria-label="Account">
      <header><h2>${user ? 'Your account' : 'Sign in to Oriel'}</h2><button class="f3-x" data-close aria-label="Close">×</button></header>
      ${why ? `<p class="why">${icon('lock')}<span><b>${esc(tr(PRO_FEATURES[why]))}</b> ${tr('is part of Oriel Pro.')}</span></p>` : ''}
      ${
        user
          ? `<div class="me"><span class="av">${esc((user.email[0] ?? '?').toUpperCase())}</span><div><b data-i18n-skip>${esc(user.email)}</b><small>${plan === 'pro' ? 'Pro' : tr('Free plan')} · ${esc(tr(state === 'local' ? 'Kept only in this browser' : state === 'error' ? 'Cloud saving failed' : 'Projects saved in the cloud'))}</small></div><button class="f3-btn" data-signout>Sign out</button></div>`
          : `<p class="lead">Your projects in the cloud, on any computer, and the Pro deliveries for your clients.</p>
             <form class="in" data-email><input type="email" required autocomplete="email" placeholder="your@email.com" aria-label="E-mail"><button class="f3-btn primary" type="submit">Send sign-in link</button></form>
             <button class="f3-btn google" data-google><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 01-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.7H2.1v2.8A11 11 0 0012 23z"/><path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7H2.1a11 11 0 000 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 002.1 7l3.6 2.8C6.6 7.3 9.1 5.4 12 5.4z"/></svg>Continue with Google</button>`
      }
      <div class="plans">${freeCard}${proCard}</div>
      <p class="note">Without an account everything you do is saved in this browser, as always.</p></div>`;
    ed.shell.root.appendChild(m);
    const before = document.activeElement as HTMLElement | null;
    const close = () => {
      m.remove();
      window.removeEventListener('keydown', onKey, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
    const busy = (b: HTMLButtonElement, on: boolean) => {
      b.disabled = on;
      b.classList.toggle('busy', on);
    };
    const here = () => location.origin + location.pathname;
    m.querySelector<HTMLFormElement>('[data-email]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget as HTMLFormElement;
      const email = f.querySelector('input')!.value.trim();
      const b = f.querySelector('button')!;
      busy(b, true);
      try {
        await (await cloud()).signInEmail(email, here());
        f.outerHTML = `<p class="sent">${icon('cloud')}<span>${tr('Link sent to')} <b data-i18n-skip>${esc(email)}</b>. ${tr('Open it on this computer to sign in.')}</span></p>`;
      } catch (err) {
        busy(b, false);
        ed.toast(`${tr('Could not send the link')}: ${(err as Error).message}`);
      }
    });
    m.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === m || t.closest('[data-close]')) return close();
      const b = t.closest<HTMLButtonElement>('button');
      if (!b) return;
      const a = await cloud();
      try {
        if (b.dataset.google !== undefined) {
          busy(b, true);
          await a.signInGoogle(here());
        } else if (b.dataset.signout !== undefined) {
          await a.signOut();
          close();
          ed.toast('Signed out. The projects stay in this browser.');
        } else if (b.dataset.buy) {
          busy(b, true);
          location.href = await a.checkout(b.dataset.buy === 'year' ? 'year' : 'month', here());
        } else if (b.dataset.portal !== undefined) {
          busy(b, true);
          location.href = await a.portal(here());
        }
      } catch (err) {
        busy(b, false);
        const msg = (err as Error).message;
        if (msg === 'already_subscribed') {
          await refreshPlan();
          close();
          return ed.toast('This account already has Pro.');
        }
        ed.toast(`${tr('Failed')}: ${msg}`);
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if ((e.target as HTMLElement).closest?.('input')) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    (m.querySelector<HTMLElement>('input, [data-buy], [data-portal], [data-close]') ?? m).focus();
  };
  btn.addEventListener('click', () => openDialog());

  const account: Account = {
    enabled: true,
    user: () => user,
    plan: () => planOf(sub),
    gate(feature) {
      if (allowed(planOf(sub), feature, true)) return true;
      openDialog(feature);
      return false;
    },
    open: () => openDialog(),
    api: async () => (user ? cloud() : null),
    push(id, json) {
      if (!user || localOnly.has(id)) return;
      pending = { id, json };
      clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), 3000);
    },
    async saveVersion(id, label, json) {
      if (!user) return;
      const a = await cloud();
      // The version hangs from the project row: the project goes to the cloud first.
      if ((await a.projectAt(id)) === null) await a.putProject(id, { name: ed.project.name, buildings: ed.project.buildings.length }, json, await thumbnail(ed));
      await saveVersion(a, id, label, false, json);
    },
    synced: (id, at) => setSynced(id, at),
    onChange: (fn) => void listeners.push(fn),
  };
  // Leaving the page with a save waiting: it goes at once (the request may still finish after the page closes).
  addEventListener('pagehide', () => {
    if (pending) void flush();
  });
  return account;
}
