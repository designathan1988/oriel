// The Oriel cloud: accounts, projects, versions and the subscription, on Supabase (https://supabase.com/docs/reference/javascript).
// Configured at build time by VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (.env): without them the
// app runs alone in the browser, as before, with every feature open. The client library is loaded only
// when the cloud is configured (a dynamic import: the offline app does not carry it).
// Tables and storage: supabase/migrations. Payments: supabase/functions (Stripe Checkout and portal).
// Tests give their own backend in globalThis.__orielCloud (the same interface, kept in memory).
import type { SubscriptionRow } from './plans';

export interface CloudUser {
  id: string;
  email: string;
}

export interface CloudProject {
  id: string;
  name: string;
  buildings: number;
  bytes: number;
  /** Last change (ms since 1970). */
  at: number;
  /** Signed address of the thumbnail (an hour), when there is one. */
  thumb?: string;
}

export interface CloudVersion {
  vid: number;
  label: string;
  auto: boolean;
  bytes: number;
  at: number;
}

export interface CloudApi {
  user(): CloudUser | null;
  /** Called at once with the current user, then on every sign in and sign out. */
  onUser(fn: (u: CloudUser | null) => void): void;
  signInEmail(email: string, redirect: string): Promise<void>;
  signInGoogle(redirect: string): Promise<void>;
  signOut(): Promise<void>;
  subscription(): Promise<SubscriptionRow | null>;
  /** Address of the Stripe page to subscribe ('month' or 'year'), or of the portal to manage the subscription. */
  checkout(interval: 'month' | 'year', back: string): Promise<string>;
  portal(back: string): Promise<string>;
  listProjects(): Promise<CloudProject[]>;
  /** Saves the project text (and its thumbnail): creates the project row the first time. */
  putProject(id: string, info: { name: string; buildings: number }, json: string, thumb?: Blob | null): Promise<void>;
  getProject(id: string): Promise<string>;
  /** When the cloud copy last changed (ms), or null when it is not in the cloud. */
  projectAt(id: string): Promise<number | null>;
  deleteProject(id: string): Promise<void>;
  listVersions(id: string): Promise<CloudVersion[]>;
  putVersion(id: string, label: string, auto: boolean, json: string): Promise<void>;
  getVersion(id: string, vid: number): Promise<string>;
  deleteVersion(id: string, vid: number): Promise<void>;
}

/** An error the database raised for a plan cap (supabase/migrations: oriel_limit_projects / _versions).
 *  Recognised by its `what` (a test backend throws a plain object with it). */
export class LimitError extends Error {
  constructor(readonly what: 'projects' | 'versions') {
    super(what === 'projects' ? 'Project limit of the plan' : 'Version limit of the plan');
  }
}

const env = import.meta.env as Record<string, string | undefined>;
const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const injected = (globalThis as { __orielCloud?: CloudApi }).__orielCloud;

/** Whether this build has a cloud (a configured project, or the backend a test injected). */
export const cloudEnabled = !!injected || !!(URL_ && KEY);

let api: Promise<CloudApi> | null = null;
/** The cloud backend (Supabase, loaded on first use). Only when cloudEnabled. */
export function cloud(): Promise<CloudApi> {
  if (injected) return Promise.resolve(injected);
  return (api ??= supabaseApi(URL_!, KEY!));
}

const BUCKET = 'projects';

async function supabaseApi(url: string, key: string): Promise<CloudApi> {
  const { createClient, FunctionsHttpError } = await import('@supabase/supabase-js');
  // PKCE: the e-mail link and Google come back with ?code=…, exchanged here for the session (detectSessionInUrl).
  const sb = createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  let current: CloudUser | null = null;
  const subs: ((u: CloudUser | null) => void)[] = [];
  const set = (u: { id: string; email?: string } | null | undefined) => {
    const next = u ? { id: u.id, email: u.email ?? '' } : null;
    if (next?.id === current?.id) return;
    current = next;
    subs.forEach((f) => f(current));
  };
  const { data } = await sb.auth.getSession();
  set(data.session?.user);
  sb.auth.onAuthStateChange((_e, session) => {
    // Not awaiting inside the callback (the library warns that it can lock the client): the work runs after it.
    setTimeout(() => set(session?.user), 0);
  });
  const uid = () => {
    if (!current) throw new Error('Not signed in');
    return current.id;
  };
  const path = (id: string, file: string) => `${uid()}/${id}/${file}`;
  const fail = (e: { message: string; code?: string } | null) => {
    if (!e) return;
    if (/oriel_limit_projects/.test(e.message)) throw new LimitError('projects');
    if (/oriel_limit_versions/.test(e.message)) throw new LimitError('versions');
    throw new Error(e.message);
  };
  const invoke = async (name: string, body: object): Promise<string> => {
    const { data, error } = await sb.functions.invoke<{ url?: string; error?: string }>(name, { body });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) msg = ((await error.context.json().catch(() => ({}))) as { error?: string }).error ?? msg;
      throw new Error(msg);
    }
    if (!data?.url) throw new Error(data?.error ?? 'No address returned');
    return data.url;
  };
  const text = async (p: string) => {
    const { data, error } = await sb.storage.from(BUCKET).download(p);
    fail(error);
    return data!.text();
  };
  const self: CloudApi = {
    user: () => current,
    onUser(fn) {
      subs.push(fn);
      fn(current);
    },
    async signInEmail(email, redirect) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      fail(error);
    },
    async signInGoogle(redirect) {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect } });
      fail(error);
    },
    async signOut() {
      await sb.auth.signOut({ scope: 'local' });
      set(null);
    },
    async subscription() {
      if (!current) return null;
      const { data, error } = await sb.from('subscriptions').select('status,current_period_end,cancel_at_period_end,billing_interval').eq('user_id', current.id).maybeSingle();
      fail(error);
      return data as SubscriptionRow | null;
    },
    checkout: (interval, back) => invoke('checkout', { interval, returnUrl: back }),
    portal: (back) => invoke('billing-portal', { returnUrl: back }),
    async listProjects() {
      const { data, error } = await sb.from('projects').select('id,name,buildings,bytes,updated_at').order('updated_at', { ascending: false });
      fail(error);
      const rows = (data ?? []) as { id: string; name: string; buildings: number; bytes: number; updated_at: string }[];
      const out: CloudProject[] = rows.map((r) => ({ id: r.id, name: r.name, buildings: r.buildings, bytes: r.bytes, at: Date.parse(r.updated_at) }));
      if (out.length) {
        const signed = await sb.storage.from(BUCKET).createSignedUrls(out.map((p) => path(p.id, 'thumb.webp')), 3600);
        signed.data?.forEach((s, i) => {
          if (s.signedUrl && !s.error) out[i]!.thumb = s.signedUrl;
        });
      }
      return out;
    },
    async putProject(id, info, json, thumb) {
      const row = { owner: uid(), id, name: info.name.slice(0, 200), buildings: info.buildings, bytes: json.length, updated_at: new Date().toISOString() };
      fail((await sb.from('projects').upsert(row, { onConflict: 'owner,id' })).error);
      const up = sb.storage.from(BUCKET);
      fail((await up.upload(path(id, 'current.json'), new Blob([json], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '0' })).error);
      if (thumb) await up.upload(path(id, 'thumb.webp'), thumb, { upsert: true, contentType: 'image/webp', cacheControl: '60' });
    },
    getProject: (id) => text(path(id, 'current.json')),
    async projectAt(id) {
      const { data, error } = await sb.from('projects').select('updated_at').eq('owner', uid()).eq('id', id).maybeSingle();
      fail(error);
      return data ? Date.parse((data as { updated_at: string }).updated_at) : null;
    },
    async deleteProject(id) {
      const vs = await self.listVersions(id);
      await sb.storage.from(BUCKET).remove([path(id, 'current.json'), path(id, 'thumb.webp'), ...vs.map((v) => path(id, `v/${v.vid}.json`))]);
      fail((await sb.from('projects').delete().eq('owner', uid()).eq('id', id)).error);
    },
    async listVersions(id) {
      const { data, error } = await sb.from('project_versions').select('vid,label,auto,bytes,created_at').eq('project_id', id).order('created_at', { ascending: false });
      fail(error);
      return ((data ?? []) as { vid: number; label: string; auto: boolean; bytes: number; created_at: string }[]).map((v) => ({ vid: v.vid, label: v.label, auto: v.auto, bytes: v.bytes, at: Date.parse(v.created_at) }));
    },
    async putVersion(id, label, auto, json) {
      const { data, error } = await sb.from('project_versions').insert({ owner: uid(), project_id: id, label: label.slice(0, 80), auto, bytes: json.length }).select('vid').single();
      fail(error);
      const vid = (data as { vid: number }).vid;
      const r = await sb.storage.from(BUCKET).upload(path(id, `v/${vid}.json`), new Blob([json], { type: 'application/json' }), { contentType: 'application/json' });
      if (r.error) {
        // Without its text the version is no use: the row goes too.
        await sb.from('project_versions').delete().eq('vid', vid);
        fail(r.error);
      }
    },
    getVersion: (id, vid) => text(path(id, `v/${vid}.json`)),
    async deleteVersion(id, vid) {
      await sb.storage.from(BUCKET).remove([path(id, `v/${vid}.json`)]);
      fail((await sb.from('project_versions').delete().eq('vid', vid)).error);
    },
  };
  return self;
}
