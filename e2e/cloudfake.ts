// A cloud kept in the page's memory for the tests of src/app/cloud: the same interface as Supabase (CloudApi),
// given in globalThis.__orielCloud before the app starts. __cloud shows its state; __signIn(email) signs in.
import type { Page } from '@playwright/test';

export interface Seed {
  user?: { id: string; email: string } | null;
  sub?: { status: string; current_period_end: string | null } | null;
  projects?: { id: string; name: string; buildings: number; json: string; at: number }[];
  synced?: Record<string, number>;
}

export async function open(page: Page, seed: Seed, errors: string[], lang = 'en') {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript((seed: Seed) => {
    if (!sessionStorage.getItem('cloud_test_started')) {
      localStorage.clear();
      if (seed.synced) localStorage.setItem('oriel_cloud_synced', JSON.stringify(seed.synced));
      sessionStorage.setItem('cloud_test_started', '1');
    }
    localStorage.setItem('oriel_lang', (seed as { lang?: string }).lang ?? 'en');
    localStorage.setItem('oriel_guide_off', '1');
    (globalThis as any).__orielNoStart = true;
    // Every message shown, in order (a later one replaces the text on screen): from the editor's first moment.
    const toasts: string[] = ((globalThis as any).__toasts = []);
    const watch = setInterval(() => {
      const ed = (globalThis as any).forma3;
      if (!ed) return;
      clearInterval(watch);
      const show = ed.toast.bind(ed);
      ed.toast = (m: string) => {
        toasts.push(m);
        show(m);
      };
    }, 5);
    const st = {
      user: seed.user ?? null,
      // A test may change the subscription for the next load (as the server would after a payment).
      sub: JSON.parse(sessionStorage.getItem('cloud_test_sub') ?? 'null') ?? seed.sub ?? null,
      projects: new Map((seed.projects ?? []).map((p) => [p.id, { ...p, bytes: p.json.length }])),
      versions: [] as { id: string; vid: number; label: string; auto: boolean; json: string; at: number; bytes: number }[],
      calls: [] as unknown[][],
      vid: 1,
    };
    const subs: ((u: unknown) => void)[] = [];
    const pro = () => !!st.sub && ['active', 'trialing', 'past_due'].includes(st.sub.status);
    (globalThis as any).__cloud = st;
    (globalThis as any).__signIn = (email: string) => {
      st.user = { id: 'u1', email };
      subs.forEach((f) => f(st.user));
    };
    (globalThis as any).__orielCloud = {
      user: () => st.user,
      onUser(fn: (u: unknown) => void) {
        subs.push(fn);
        fn(st.user);
      },
      async signInEmail(email: string) {
        st.calls.push(['email', email]);
      },
      async signInGoogle() {
        st.calls.push(['google']);
      },
      async signOut() {
        st.user = null;
        subs.forEach((f) => f(null));
      },
      async subscription() {
        return st.sub;
      },
      async checkout(interval: string) {
        st.calls.push(['checkout', interval]);
        return '#checkout';
      },
      async portal() {
        st.calls.push(['portal']);
        return '#portal';
      },
      async listProjects() {
        return [...st.projects.values()].map(({ id, name, buildings, bytes, at }) => ({ id, name, buildings, bytes, at })).sort((a, b) => b.at - a.at);
      },
      async putProject(id: string, info: { name: string; buildings: number }, json: string) {
        if (!st.projects.has(id) && !pro() && st.projects.size >= 3) throw Object.assign(new Error('oriel_limit_projects'), { what: 'projects' });
        st.projects.set(id, { id, name: info.name, buildings: info.buildings, json, at: Date.now(), bytes: json.length });
      },
      async getProject(id: string) {
        return st.projects.get(id)!.json;
      },
      async projectAt(id: string) {
        return st.projects.get(id)?.at ?? null;
      },
      async deleteProject(id: string) {
        st.projects.delete(id);
      },
      async listVersions(id: string) {
        return st.versions.filter((v) => v.id === id).sort((a, b) => b.at - a.at || b.vid - a.vid);
      },
      async putVersion(id: string, label: string, auto: boolean, json: string) {
        st.versions.push({ id, vid: st.vid++, label, auto, json, at: Date.now(), bytes: json.length });
      },
      async getVersion(id: string, vid: number) {
        return st.versions.find((v) => v.id === id && v.vid === vid)!.json;
      },
      async deleteVersion(_id: string, vid: number) {
        st.versions = st.versions.filter((v) => v.vid !== vid);
      },
    };
  }, { ...seed, lang } as Seed);
  await page.goto('/editor.html');
  await page.waitForFunction(() => !!(globalThis as any).forma3);
  // The samples drawn once (the first frames take the main thread on SwiftShader): clicks land after them.
  await page.waitForFunction(() => (globalThis as any).forma3.view.settled, null, { timeout: 60_000 });
  await page.evaluate(() => (globalThis as any).forma3.view.look.setAO(false));
}
