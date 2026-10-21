// The project published for the web: a virtual tour in one HTML file (the model, the stops, the points
// of interest, the plans and the viewer all inside it: it opens from a file, from any host, offline), or
// the same tour as an installable app (a PWA: the page, its manifest with the icons and a service worker
// that keeps it working without the network; https://developer.mozilla.org/docs/Web/Progressive_web_apps/Guides/Making_PWAs_Installable).
// Publishing it is copying the folder to any static host (Netlify Drop, GitHub Pages, the office site):
// its address is the link to share, and #p=3 at the end of it opens the third stop.
import { BRAND } from '../model/brand';
import type { Building3, Project3, TourSpec, TourStop, Vec3 } from '../model/schema';
import { sortedLevels } from '../eval/floorplan';
import { floorPlanSvg } from '../eval/floorplansvg';
import { SLAB } from '../eval/interior';
import type { TourData, TourDataPlan, TourDataRoom } from '../tour/types';
import { projectPlans } from './pdf';
import { siteContext } from '../eval/sitecontext';
import { zipStore } from './zip';

/** Eye height of a walking stop (m above the floor). */
const EYE = 1.6;

export interface TourOptions {
  t?: (english: string) => string;
  decimal?: string;
  lang?: string;
  /** Direction the sun comes from (world); default: from the north-west, high. */
  sun?: Vec3;
}

/** The plan frame of a building to the world, as an SVG matrix (x' = a·x + c·z + e, z' = b·x + d·z + f). */
export function buildingToWorld(b: Building3): [number, number, number, number, number, number] {
  const r = (b.rotation * Math.PI) / 180;
  const c = Math.cos(r),
    s = Math.sin(r);
  return [c, -s, s, c, b.position[0], b.position[1]];
}

const apply = (m: [number, number, number, number, number, number], x: number, z: number): [number, number] => [m[0] * x + m[2] * z + m[4], m[1] * x + m[3] * z + m[5]];

type P2 = [number, number];
/**
 * Where to stand to show a room (plan frame): in a corner, a little in from the walls and clear of the
 * furniture, looking across to the farthest corner, the way a room is photographed. Null when no
 * corner is free.
 */
export function roomView(rings: P2[][], boxes: { lo: P2; hi: P2 }[]): { eye: P2; look: P2 } | null {
  const ring = rings[0];
  if (!ring || ring.length < 3) return null;
  let cx = 0,
    cz = 0;
  for (const q of ring) {
    cx += q[0];
    cz += q[1];
  }
  cx /= ring.length;
  cz /= ring.length;
  const inside = (x: number, z: number) => {
    let c = false;
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, zi] = r[i]!,
          [xj, zj] = r[j]!;
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
      }
    return c;
  };
  const free = (x: number, z: number) => inside(x, z) && !boxes.some((b) => x > b.lo[0] - 0.25 && x < b.hi[0] + 0.25 && z > b.lo[1] - 0.25 && z < b.hi[1] + 0.25);
  let best: { eye: P2; look: P2; score: number } | null = null;
  for (const v of ring) {
    const dx = cx - v[0],
      dz = cz - v[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.8) continue;
    // Inward from the corner, nearer the walls in a small room.
    for (const k of [0.75, 1.05, 1.4]) {
      const e: P2 = [v[0] + (dx / L) * k, v[1] + (dz / L) * k];
      if (!free(e[0], e[1])) continue;
      // The far corner: the vertex farthest from where one stands.
      let far = ring[0]!,
        fd = -1;
      for (const q of ring) {
        const d = Math.hypot(q[0] - e[0], q[1] - e[1]);
        if (d > fd) {
          fd = d;
          far = q;
        }
      }
      // Halfway between the far corner and the middle of the room: both walls in the frame.
      const look: P2 = [(far[0] + cx) / 2, (far[1] + cz) / 2];
      const score = fd - k * 0.3;
      if (!best || score > best.score) best = { eye: e, look, score };
      break;
    }
  }
  return best && { eye: best.eye, look: best.look };
}

/** The rooms of every floor plan (named ones first, by floor), with the eye in the middle of each. */
export function tourRooms(p: Project3, all = projectPlans(p), t: (s: string) => string = (s) => s): { rooms: TourDataRoom[]; plans: (TourDataPlan & { b: Building3; levelIndex: number })[] } {
  const plans: (TourDataPlan & { b: Building3; levelIndex: number })[] = [];
  const rooms: TourDataRoom[] = [];
  for (const f of all) {
    const b = f.b;
    const m = buildingToWorld(b);
    const lv = sortedLevels(b)[f.plan.levelIndex];
    const floor = (b.elevation ?? 0) + f.plan.elevation;
    const pi = plans.length;
    plans.push({ title: `${t(f.level)} · ${f.building}`, svg: '', toWorld: m, floor, top: floor + (lv?.height ?? 3), b, levelIndex: f.plan.levelIndex });
    // The furniture on the floor (plan symbols below the cut), as boxes to keep clear of.
    const boxes = f.plan.symbols
      .filter((sym) => !sym.stair && sym.strokes.some((st) => !st.above))
      .map((sym) => {
        const lo: P2 = [Infinity, Infinity],
          hi: P2 = [-Infinity, -Infinity];
        for (const st of sym.strokes)
          for (const q of st.pts) {
            lo[0] = Math.min(lo[0], q[0]);
            lo[1] = Math.min(lo[1], q[1]);
            hi[0] = Math.max(hi[0], q[0]);
            hi[1] = Math.max(hi[1], q[1]);
          }
        return { lo, hi };
      });
    const y = floor + SLAB + EYE;
    for (const r of f.plan.rooms) {
      if (!r.name || r.area < 1.5) continue;
      const [x, z] = apply(m, r.at[0], r.at[1]);
      const v = roomView(r.rings as P2[][], boxes);
      let view: TourDataRoom['view'];
      if (v) {
        const [ex, ez] = apply(m, v.eye[0], v.eye[1]);
        const [lx, lz] = apply(m, v.look[0], v.look[1]);
        view = { eye: [ex, y, ez], look: [lx, y - 0.25, lz] };
      }
      rooms.push({ name: r.name, area: Math.round(r.area * 100) / 100, where: `${t(f.level)} · ${f.building}`, eye: [x, y, z], floor: floor + SLAB, plan: pi, view });
    }
  }
  return { rooms, plans };
}

/**
 * A first tour when none was made: the project seen from the front and from above, then each named
 * room walking. The stops are ordinary ones: the author renames, moves and removes them.
 */
export function autoStops(p: Project3, uid: () => string, t: (s: string) => string = (s) => s): TourStop[] {
  const out: TourStop[] = [];
  let x0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    z1 = -Infinity,
    y1 = 0;
  for (const b of p.buildings) {
    if (b.hidden) continue;
    const m = buildingToWorld(b);
    for (const s of b.solids) {
      if (s.op !== 'add' || s.hidden) continue;
      for (const v of s.plan.outer) {
        const [x, z] = apply(m, v.p[0], v.p[1]);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      y1 = Math.max(y1, (b.elevation ?? 0) + s.base + s.height);
    }
  }
  if (!Number.isFinite(x0)) return out;
  const cx = (x0 + x1) / 2,
    cz = (z0 + z1) / 2;
  const R = Math.max(6, Math.hypot(x1 - x0, z1 - z0) / 2);
  const tgt: Vec3 = [cx, y1 * 0.45, cz];
  out.push({ id: uid(), name: t('The project'), eye: [cx + R * 1.1, y1 * 0.45 + R * 0.55, cz + R * 1.6], target: tgt });
  out.push({ id: uid(), name: t('Seen from above'), eye: [cx - R * 0.9, y1 + R * 1.5, cz + R * 1.0], target: tgt });
  out.push({ id: uid(), name: t('Front'), eye: [cx, 1.6, z1 + R * 1.3], target: [cx, y1 * 0.4, cz] });
  for (const r of tourRooms(p, undefined, t).rooms) {
    if (r.view) {
      out.push({ id: uid(), name: r.name, note: `${r.where} · ${r.area.toFixed(2)} m²`, eye: r.view.eye, target: r.view.look, walk: true });
      continue;
    }
    const dir = [r.eye[0] - cx, r.eye[2] - cz];
    const l = Math.hypot(dir[0]!, dir[1]!) || 1;
    // From the side of the room toward the middle of the building, the room seen across.
    const back = Math.min(1.2, l * 0.5);
    const eye: Vec3 = [r.eye[0] + (dir[0]! / l) * back, r.eye[1], r.eye[2] + (dir[1]! / l) * back];
    out.push({ id: uid(), name: r.name, note: `${r.where} · ${r.area.toFixed(2)} m²`, eye, target: [eye[0] - dir[0]! / l, r.eye[1] - 0.15, eye[2] - dir[1]! / l], walk: true });
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Words of the viewer, translated by `t` (the viewer looks them up by their English). */
export const TOUR_WORDS = [
  'Loading the model…',
  'This browser cannot show 3D (WebGL is off).',
  'The model could not be read.',
  '3D view of the project',
  'Rooms',
  'Plans',
  'Share',
  'Photo',
  'Full screen',
  'Help',
  'Previous stop',
  'Next stop',
  'Play the tour',
  'Pause the tour',
  'Turn around',
  'Walk',
  'Turn around the model',
  'Walk inside in first person',
  'Close',
  'Floor plans',
  'Area table',
  'Total built area',
  'Drag',
  'turns the model, or looks around when walking',
  'Pinch',
  'zooms in and out',
  'Circle at the bottom left',
  'walks, when walking',
  'Tap the floor',
  'walks there',
  'Wheel',
  'walk (Shift runs)',
  'Click the floor',
  'previous and next stop',
  'Space',
  'plays or pauses the tour',
  'How to explore',
  'Contact',
  'Bigger map',
  'Publish the site to share a link that opens here; the link was copied.',
  'Link to this view copied.',
  'Copy the link:',
];

/** Everything the viewer needs, from the project and its model (a GLB made hollow, to walk inside). */
export function tourData(p: Project3, glb: Uint8Array, o: TourOptions = {}): TourData {
  const t = o.t ?? ((s: string) => s);
  const dec = o.decimal ?? '.';
  const spec: TourSpec = p.tour ?? { stops: [], hotspots: [] };
  const all = projectPlans(p);
  const { rooms, plans } = tourRooms(p, all, t);
  const areas: TourData['areas'] = [];
  const stairs: NonNullable<TourData['stairs']> = [];
  let gross = 0;
  all.forEach((f, i) => {
    const pl = plans[i]!;
    for (const sym of f.plan.symbols) {
      if (!sym.stair || sym.arriving) continue;
      const lo: [number, number] = [Infinity, Infinity],
        hi: [number, number] = [-Infinity, -Infinity];
      for (const st of sym.strokes)
        for (const q of st.pts) {
          const [x, z] = apply(pl.toWorld, q[0], q[1]);
          lo[0] = Math.min(lo[0], x);
          lo[1] = Math.min(lo[1], z);
          hi[0] = Math.max(hi[0], x);
          hi[1] = Math.max(hi[1], z);
        }
      const r2 = (v: number) => Math.round(v * 100) / 100;
      if (Number.isFinite(lo[0])) stairs.push({ min: [r2(lo[0] - 0.15), r2(lo[1] - 0.15)], max: [r2(hi[0] + 0.15), r2(hi[1] + 0.15)], y0: r2(pl.floor), y1: r2(pl.top + 0.5) });
    }
    plans[i]!.svg = floorPlanSvg(f.plan, { decimal: dec, t, site: siteContext(p, f.b, f.index === 0) }).svg;
    gross += f.plan.grossArea;
    areas.push({ name: `${f.building} · ${t(f.level)}`, area: Math.round(f.plan.grossArea * 100) / 100, level: true });
    for (const r of [...f.plan.rooms].sort((a, b) => b.area - a.area)) areas.push({ name: r.name || t('Unnamed room'), area: Math.round(r.area * 100) / 100 });
  });
  // The model's bounds: the volumes of the buildings, in the world.
  const min: Vec3 = [Infinity, 0, Infinity],
    max: Vec3 = [-Infinity, 3, -Infinity];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    const m = buildingToWorld(b);
    for (const s of b.solids)
      for (const v of s.plan.outer) {
        const [x, z] = apply(m, v.p[0], v.p[1]);
        min[0] = Math.min(min[0], x);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[2] = Math.max(max[2], z);
        max[1] = Math.max(max[1], (b.elevation ?? 0) + s.base + s.height + 2);
      }
  }
  if (!Number.isFinite(min[0])) {
    min[0] = min[2] = -5;
    max[0] = max[2] = 5;
  }
  const words: Record<string, string> = {};
  for (const w of TOUR_WORDS) {
    const v = t(w);
    if (v !== w) words[w] = v;
  }
  return {
    v: 1,
    title: spec.title?.trim() || p.name,
    subtitle: spec.subtitle?.trim() || undefined,
    author: spec.author?.trim() || undefined,
    phone: spec.phone?.trim() || undefined,
    email: spec.email?.trim() || undefined,
    date: new Date().toLocaleDateString(o.lang ?? 'pt-BR'),
    lang: o.lang ?? 'pt-BR',
    t: words,
    glb: base64(glb),
    stops: spec.stops.map((s) => ({ name: s.name, note: s.note, eye: s.eye, target: s.target, walk: s.walk })),
    hotspots: spec.hotspots.map((h) => ({ title: h.title, text: h.text, at: h.at })),
    rooms,
    plans: plans.map(({ title, svg, toWorld, floor, top }) => ({ title, svg, toWorld, floor, top })),
    areas,
    gross: Math.round(gross * 100) / 100,
    decimal: dec,
    options: { walk: spec.walk !== false, vr: spec.vr !== false, plans: spec.plans !== false, autoplay: spec.autoplay ?? 0 },
    stairs,
    box: { min, max },
    sun: o.sun ?? [-0.45, 0.8, 0.4],
  };
}

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** JSON safe inside a <script> element (no "</script>", no HTML comment opener). */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const scriptCode = (code: string) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

/** The tour as one HTML page. `app`: the page of the installable app (manifest and icons beside it). */
export function tourHtml(data: TourData, runtime: string, app = false): string {
  const desc = data.subtitle ?? `${data.title} · ${BRAND}`;
  return `<!doctype html>
<html lang="${escHtml(data.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHtml(data.title)}</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:title" content="${escHtml(data.title)}">
<meta property="og:description" content="${escHtml(desc)}">
<meta property="og:type" content="website">
<meta name="theme-color" content="#1b1c1f">
<meta name="generator" content="${escHtml(BRAND)}">
${app ? '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="apple-mobile-web-app-capable" content="yes">' : ''}
</head><body>
<noscript>${escHtml(data.title)}: JavaScript is needed to show the 3D tour.</noscript>
<script type="application/json" id="oriel-data">${scriptJson(data)}</script>
<script>${scriptCode(runtime)}</script>
</body></html>
`;
}

/** The web app manifest of the installable tour. */
export function tourManifest(data: TourData): string {
  return JSON.stringify(
    {
      name: data.title,
      short_name: data.title.slice(0, 24),
      description: data.subtitle ?? data.title,
      lang: data.lang,
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      background_color: '#1b1c1f',
      theme_color: '#1b1c1f',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );
}

/** Service worker: the files of the app cached when installed, served from the cache first (offline). */
export function tourServiceWorker(version: string): string {
  return `// ${BRAND} tour: works offline once opened (cache first, then the network).
const CACHE = 'oriel-tour-${version}';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('oriel-tour-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
`;
}

/** How to put the tour online, in the package (Portuguese and English: the reader is the author). */
export function tourReadme(data: TourData, t: (s: string) => string = (s) => s): string {
  return [
    `${data.title} — ${t('virtual tour')} (${BRAND})`,
    '',
    t('To publish: upload this whole folder to any static host. Two free ways:'),
    '  1. Netlify Drop — https://app.netlify.com/drop : ' + t('drag the folder onto the page; it gives the address.'),
    '  2. GitHub Pages — ' + t('a repository with these files, Settings → Pages; the address is username.github.io/repository.'),
    '',
    t('The address is the link to share. #p=2 at its end opens the second stop.'),
    t('Opened on a phone, the browser offers to install it as an app (Add to home screen); then it works offline.'),
    '',
  ].join('\n');
}

/** The installable app: a ZIP with the page, the manifest, the icons and the service worker. */
export function tourApp(data: TourData, runtime: string, icons: { s192: Uint8Array; s512: Uint8Array }, t: (s: string) => string = (s) => s): Uint8Array {
  const enc = new TextEncoder();
  const version = String(Date.now().toString(36));
  return zipStore([
    { name: 'index.html', data: enc.encode(tourHtml(data, runtime, true)) },
    { name: 'manifest.webmanifest', data: enc.encode(tourManifest(data)) },
    { name: 'sw.js', data: enc.encode(tourServiceWorker(version)) },
    { name: 'icon-192.png', data: icons.s192 },
    { name: 'icon-512.png', data: icons.s512 },
    { name: t('HOW-TO-PUBLISH.txt'), data: enc.encode(tourReadme(data, t)) },
  ], new Date());
}

/** The viewer as one script (src/f3/tour/runtime.ts bundled with three.js by vite.config.ts), loaded when first published. */
export async function tourRuntime(): Promise<string> {
  return (await import('../tour/runtime.ts?tour-bundle')).default;
}
