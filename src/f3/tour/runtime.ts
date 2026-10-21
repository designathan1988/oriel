// The published tour (a site or an installable app made by io/tour.ts): the model to turn around or to
// walk through in first person, with collisions against the walls and the feet on the floors and stairs
// (rays sped up by three-mesh-bvh, https://github.com/gkjohnson/three-mesh-bvh); the stops of the tour
// one after the other or playing by themselves; numbered points of interest; the rooms to jump to; a
// minimap of the floor being walked; the floor plans and the area table; a link to the very view being
// seen (#p=stop, #w=walk position, #o=orbit view) to share; a photo; full screen; and virtual reality
// where the browser has WebXR (three.js VRButton, https://threejs.org/docs/#manual/en/introduction/How-to-create-VR-content).
// Everything it needs is in the page: this file is bundled with three.js into one script (vite.config).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import type { TourData, TourDataPlan, V3 } from './types';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

/** Eye height, walking and running speed (m/s), the step climbed (and how far ahead it is looked for), how close a wall stops the walker. */
const EYE = 1.6,
  WALK = 1.5,
  RUN = 3.2,
  STEP = 0.42,
  AHEAD = 0.22,
  SILL = 0.06,
  CLEAR = 0.32;
const LOOK = 0.0042;
const MAX_PITCH = 1.35;

const CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#1b1c1f;font:14px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#f4f2ee;-webkit-tap-highlight-color:transparent}
canvas.view{position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none}
.ui{position:fixed;z-index:5}
.glass{background:rgba(24,25,28,.72);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.top{left:12px;right:12px;top:12px;display:flex;align-items:flex-start;gap:10px;pointer-events:none}
.title{padding:10px 14px;pointer-events:auto;max-width:min(520px,60vw)}
.title h1{margin:0;font-size:17px;font-weight:650;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.title p{margin:2px 0 0;color:#c9c5bd;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tools{margin-left:auto;display:flex;gap:6px;padding:6px;pointer-events:auto;flex-wrap:wrap;justify-content:flex-end}
button{font:inherit;color:inherit;cursor:pointer}
.ib{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border-radius:10px;border:0;background:transparent;font-size:13px;font-weight:550;white-space:nowrap}
.ib:hover{background:rgba(255,255,255,.1)}.ib[aria-pressed=true]{background:#e86a1e;color:#fff}
.ib svg{width:18px;height:18px;flex:none}
.ib.only{width:36px;padding:0;justify-content:center}
.bar{left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:6px;max-width:calc(100vw - 24px)}
.bar .count{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;color:#d9d5cd;font-size:12.5px}
.modes{display:flex;gap:2px;padding:3px;border-radius:11px;background:rgba(255,255,255,.07);margin-left:6px}
.caption{left:50%;bottom:72px;transform:translateX(-50%);width:min(560px,calc(100vw - 24px));padding:12px 16px;transition:opacity .3s}
.caption h2{margin:0;font-size:16px;font-weight:650}.caption p{margin:4px 0 0;color:#d6d2ca;font-size:13.5px;white-space:pre-wrap}
.caption[hidden]{display:block;opacity:0;pointer-events:none}
.side{left:12px;top:84px;bottom:290px;width:min(300px,calc(100vw - 24px));display:flex;flex-direction:column;padding:10px;transform:translateX(-120%);transition:transform .25s}
.side.open{transform:none}
.side h3{margin:4px 6px 8px;font-size:13px;color:#c9c5bd;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.side .list{overflow:auto;flex:1}
.side .room{display:flex;width:100%;justify-content:space-between;gap:10px;padding:9px 10px;border-radius:9px;border:0;background:transparent;text-align:left}
.side .room:hover{background:rgba(255,255,255,.09)}.side .room small{color:#aaa59c}
.side .room b{font-weight:600}.side .where{margin:10px 8px 4px;font-size:11.5px;color:#9f9a91}
.map{left:12px;bottom:76px;width:220px;height:200px;padding:6px;overflow:hidden}
.map.big{width:min(560px,calc(100vw - 24px));height:min(480px,calc(100vh - 170px))}
.map svg{width:100%;height:100%;display:block;cursor:crosshair}
.map .mapbar{position:absolute;left:8px;right:8px;top:6px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#3d3a35;pointer-events:none}
.map .mapbar>:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;margin-right:6px}
.map .mapbar button{flex:none;pointer-events:auto;background:rgba(255,255,255,.85);border:1px solid #ddd;border-radius:7px;color:#333;height:24px;width:24px;padding:0;font-size:14px}
.map .paper{position:absolute;inset:6px;background:#fbfaf7;border-radius:9px}
.hot{position:fixed;z-index:4;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:2px solid #fff;background:#e86a1e;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);transition:opacity .2s;padding:0}
.hot.dim{opacity:.35}.hot:hover{transform:scale(1.12)}
.card{left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 32px));padding:16px 18px;z-index:8}
.card h2{margin:0 30px 6px 0;font-size:17px}.card p{margin:0;color:#dcd8d0;white-space:pre-wrap}
.x{position:absolute;right:10px;top:10px;width:30px;height:30px;border-radius:8px;border:0;background:rgba(255,255,255,.08);font-size:18px;line-height:1}
.sheet{inset:0;z-index:9;background:rgba(14,15,17,.6);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:20px 12px}
.sheet>.glass{position:relative;width:min(1000px,100%);padding:18px 20px;background:rgba(28,29,33,.94)}
.sheet h2{margin:0 0 12px;font-size:18px}
.sheet figure{margin:0 0 16px;background:#fbfaf7;border-radius:12px;padding:10px;color:#222}
.sheet figcaption{font-weight:600;margin:0 0 6px;color:#333}
.sheet figure svg{width:100%;height:auto;max-height:75vh;display:block}
.sheet table{width:100%;border-collapse:collapse;margin-top:6px}.sheet td{padding:7px 10px;border-top:1px solid rgba(255,255,255,.1)}
.sheet td:last-child{text-align:right;font-variant-numeric:tabular-nums}.sheet tr.lv td{font-weight:650}.sheet td.in{padding-left:26px}
.help dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}.help dt{color:#f0b48c;font-weight:600}.help dd{margin:0;color:#dcd8d0}
.contact{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap}.contact a{color:#fff;background:#e86a1e;padding:8px 12px;border-radius:9px;text-decoration:none;font-weight:600;font-size:13px}
.toast{left:50%;top:76px;transform:translateX(-50%);padding:9px 14px;z-index:10;font-size:13px;transition:opacity .3s}
.toast[hidden]{display:block;opacity:0;pointer-events:none}
.joy{left:24px;bottom:96px;width:120px;height:120px;border-radius:50%;background:rgba(24,25,28,.45);border:1px solid rgba(255,255,255,.18);touch-action:none;display:none}
.joy i{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;border-radius:50%;background:rgba(255,255,255,.75)}
body.walking.touch .joy{display:block}
body.walking.touch .map{bottom:230px}
.loading{inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#1b1c1f;transition:opacity .4s}
.loading .bar2{width:220px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}.loading .bar2 i{display:block;height:100%;width:0;background:#e86a1e;transition:width .2s}
.loading b{font-size:13px;letter-spacing:.3em;color:#e86a1e}
.cross{left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.3);display:none;pointer-events:none}
body.walking .cross{display:block}
#VRButton{position:fixed!important;bottom:76px!important;right:14px!important;left:auto!important;z-index:6!important}
@media (max-width:1100px){.caption{left:244px;right:12px;width:auto;max-width:560px;transform:none}}
@media (max-width:700px){.ib .lb{display:none}.ib{padding:0 7px;height:34px}.tools{gap:0;padding:4px;flex-wrap:nowrap}.title{max-width:none;min-width:0;flex:1;padding:8px 11px}.title h1{font-size:15px}.title p{font-size:11.5px}body.walking.touch .joy{bottom:176px}.map{width:150px;height:140px;top:84px;bottom:auto}body.walking.touch .map{bottom:auto}.caption{left:12px;bottom:68px}}
`;

const ICON: Record<string, string> = {
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
  orbit: '<circle cx="12" cy="12" r="3"/><path d="M3 12c0-3 4-5 9-5s9 2 9 5-4 5-9 5"/><path d="M9 14l3 3-3 3"/>',
  walk: '<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6-2-3 1-4 4 3 3 1M8 9l3-1M14 15l2 6"/>',
  rooms: '<path d="M3 3h18v18H3zM12 3v9h9M3 12h5"/>',
  plans: '<path d="M4 4h16v16H4z"/><path d="M4 10h7v10M11 4v4M15 10h5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  photo: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17h.01"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
};
const svgIcon = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] ?? ''}</svg>`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function startTour(data: TourData): void {
  const tr = (s: string) => data.t[s] ?? s;
  const num = (v: number) => v.toFixed(2).replace('.', data.decimal);
  document.documentElement.lang = data.lang;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) document.body.classList.add('touch');

  // ── Loading screen ───────────────────────────────────────────────────
  const loading = el('div', 'ui loading', `<b>${esc(data.title.toUpperCase())}</b><div class="bar2"><i></i></div><span>${esc(tr('Loading the model…'))}</span>`);
  document.body.appendChild(loading);
  const progress = (f: number) => ((loading.querySelector('.bar2 i') as HTMLElement).style.width = `${Math.round(f * 100)}%`);

  // ── Renderer, scene, light ───────────────────────────────────────────
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    loading.querySelector('span')!.textContent = tr('This browser cannot show 3D (WebGL is off).');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = data.options.vr;
  const canvas = renderer.domElement;
  canvas.className = 'view';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', tr('3D view of the project'));
  document.body.prepend(canvas);

  const scene = new THREE.Scene();
  const sky = document.createElement('canvas');
  sky.width = 2;
  sky.height = 256;
  const sg = sky.getContext('2d')!;
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#9fbcd8');
  grad.addColorStop(0.55, '#dfe6ea');
  grad.addColorStop(1, '#efe9de');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0xe3ecf7, 0x8c7c68, 0.55));
  const sun = new THREE.DirectionalLight(0xfff1df, 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const box = new THREE.Box3(new THREE.Vector3(...data.box.min), new THREE.Vector3(...data.box.max));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(4, size.length() / 2);
  {
    const sd = new THREE.Vector3(...data.sun).normalize();
    sun.position.copy(center).addScaledVector(sd, radius * 3);
    sun.target.position.copy(center);
    const c = sun.shadow.camera;
    c.left = c.bottom = -radius * 1.3;
    c.right = c.top = radius * 1.3;
    c.near = 0.5;
    c.far = radius * 7;
    c.updateProjectionMatrix();
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(Math.max(200, radius * 12), 64), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = Math.min(0, box.min.y) - 0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 5000);
  const rig = new THREE.Group();
  rig.add(camera);
  scene.add(rig);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 0.5;
  controls.maxDistance = radius * 8;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 1.25, radius * 0.85, radius * 1.45));
  controls.update();

  // ── The model ────────────────────────────────────────────────────────
  /** What stops the walker (walls, slabs, roofs: the shell) and what the feet stand on (everything). */
  const walls: THREE.Object3D[] = [];
  const solid: THREE.Object3D[] = [ground];

  // ── Interface ────────────────────────────────────────────────────────
  const top = el('div', 'ui top', `<div class="glass title"><h1></h1><p></p></div><div class="glass tools"></div>`);
  top.querySelector('h1')!.textContent = data.title;
  const sub = [data.subtitle, data.author].filter(Boolean).join(' · ');
  top.querySelector('p')!.textContent = sub || data.date;
  const tools = top.querySelector('.tools') as HTMLElement;
  const tool = (k: string, label: string, act: () => void, show = true) => {
    if (!show) return null;
    const b = el('button', 'ib', `${svgIcon(k)}<span class="lb">${esc(tr(label))}</span>`) as HTMLButtonElement;
    b.title = tr(label);
    b.setAttribute('aria-label', tr(label));
    b.dataset.k = k;
    b.addEventListener('click', act);
    tools.appendChild(b);
    return b;
  };
  const roomsBtn = tool('rooms', 'Rooms', () => toggleSide(), data.rooms.length > 0);
  tool('plans', 'Plans', () => openPlans(), data.options.plans && data.plans.length > 0);
  tool('share', 'Share', () => share());
  tool('photo', 'Photo', () => photo());
  tool('full', 'Full screen', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()), !!document.documentElement.requestFullscreen);
  tool('help', 'Help', () => openHelp());
  document.body.appendChild(top);

  const bar = el('div', 'ui glass bar', '');
  const btn = (k: string, label: string, act: () => void) => {
    const b = el('button', 'ib only', svgIcon(k)) as HTMLButtonElement;
    b.title = tr(label);
    b.setAttribute('aria-label', tr(label));
    b.dataset.k = k;
    b.addEventListener('click', act);
    return b;
  };
  const hasStops = data.stops.length > 0;
  const prevB = btn('prev', 'Previous stop', () => go(cur - 1));
  const playB = btn('play', 'Play the tour', () => setPlaying(!playing));
  const nextB = btn('next', 'Next stop', () => go(cur + 1));
  const count = el('span', 'count', '');
  if (hasStops) bar.append(prevB, count, nextB, playB);
  const modes = el('div', 'modes', '');
  const orbitB = el('button', 'ib', `${svgIcon('orbit')}<span class="lb">${esc(tr('Turn around'))}</span>`) as HTMLButtonElement;
  const walkB = el('button', 'ib', `${svgIcon('walk')}<span class="lb">${esc(tr('Walk'))}</span>`) as HTMLButtonElement;
  orbitB.dataset.k = 'orbit';
  walkB.dataset.k = 'walk';
  orbitB.title = tr('Turn around the model');
  walkB.title = tr('Walk inside in first person');
  orbitB.addEventListener('click', () => setMode('orbit', true));
  walkB.addEventListener('click', () => setMode('walk', true));
  modes.append(orbitB);
  if (data.options.walk) modes.append(walkB);
  bar.append(modes);
  document.body.appendChild(bar);

  const caption = el('div', 'ui glass caption', '<h2></h2><p></p>');
  caption.hidden = true;
  document.body.appendChild(caption);
  const toastEl = el('div', 'ui glass toast', '');
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  let toastT = 0;
  const toast = (s: string) => {
    toastEl.textContent = s;
    toastEl.hidden = false;
    clearTimeout(toastT);
    toastT = window.setTimeout(() => (toastEl.hidden = true), 2600);
  };
  const cross = el('div', 'ui cross', '');
  document.body.appendChild(cross);

  // Rooms list.
  const side = el('div', 'ui glass side', `<h3>${esc(tr('Rooms'))}</h3><div class="list"></div>`);
  {
    const list = side.querySelector('.list')!;
    let where = '';
    data.rooms.forEach((r, i) => {
      if (r.where !== where) {
        where = r.where;
        list.appendChild(el('div', 'where', esc(where)));
      }
      const b = el('button', 'room', `<b></b><small>${num(r.area)} m²</small>`) as HTMLButtonElement;
      b.querySelector('b')!.textContent = r.name;
      b.dataset.i = String(i);
      b.addEventListener('click', () => {
        goRoom(i);
        if (innerWidth < 800) toggleSide(false);
      });
      list.appendChild(b);
    });
  }
  document.body.appendChild(side);
  const toggleSide = (on?: boolean) => {
    const open = on ?? !side.classList.contains('open');
    side.classList.toggle('open', open);
    roomsBtn?.setAttribute('aria-pressed', String(open));
  };

  // Points of interest.
  const hots = data.hotspots.map((h, i) => {
    const b = el('button', 'hot', String(i + 1)) as HTMLButtonElement;
    b.title = h.title;
    b.setAttribute('aria-label', h.title);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openCard(h.title, h.text ?? '');
    });
    document.body.appendChild(b);
    return { b, at: new THREE.Vector3(...h.at), dim: false };
  });
  let cardEl: HTMLElement | null = null;
  const openCard = (title: string, text: string) => {
    cardEl?.remove();
    cardEl = el('div', 'ui glass card', `<button class="x" aria-label="${esc(tr('Close'))}">×</button><h2></h2><p></p>`);
    cardEl.querySelector('h2')!.textContent = title;
    cardEl.querySelector('p')!.textContent = text;
    cardEl.querySelector('.x')!.addEventListener('click', () => {
      cardEl?.remove();
      cardEl = null;
    });
    document.body.appendChild(cardEl);
  };

  // Sheets: plans and help.
  const openSheet = (html: string, cls = '') => {
    const s = el('div', `ui sheet ${cls}`, `<div class="glass"><button class="x" aria-label="${esc(tr('Close'))}">×</button>${html}</div>`);
    const close = () => s.remove();
    s.addEventListener('click', (e) => {
      if (e.target === s || (e.target as HTMLElement).closest('.x')) close();
    });
    document.body.appendChild(s);
    return s;
  };
  const openPlans = () => {
    const figs = data.plans.map((p) => `<figure><figcaption>${esc(p.title)}</figcaption>${p.svg}</figure>`).join('');
    const rows = data.areas.map((r) => `<tr${r.level ? ' class="lv"' : ''}><td${r.level ? '' : ' class="in"'}>${esc(r.name)}</td><td>${num(r.area)} m²</td></tr>`).join('');
    openSheet(`<h2>${esc(tr('Floor plans'))}</h2>${figs}<h2>${esc(tr('Area table'))}</h2><table>${rows}<tr class="lv"><td>${esc(tr('Total built area'))}</td><td>${num(data.gross)} m²</td></tr></table>`, 'plans');
  };
  const openHelp = () => {
    const wa = (data.phone ?? '').replace(/\D/g, '');
    const contact = [
      wa ? `<a href="https://wa.me/${wa.length <= 11 ? '55' + wa : wa}" target="_blank" rel="noopener">WhatsApp</a>` : '',
      data.phone ? `<a href="tel:${esc(data.phone.replace(/[^\d+]/g, ''))}">${esc(data.phone)}</a>` : '',
      data.email ? `<a href="mailto:${esc(data.email)}">${esc(data.email)}</a>` : '',
    ].join('');
    const rows: [string, string][] = touch
      ? [
          [tr('Drag'), tr('turns the model, or looks around when walking')],
          [tr('Pinch'), tr('zooms in and out')],
          [tr('Circle at the bottom left'), tr('walks, when walking')],
          [tr('Tap the floor'), tr('walks there')],
        ]
      : [
          [tr('Drag'), tr('turns the model, or looks around when walking')],
          [tr('Wheel'), tr('zooms in and out')],
          ['W A S D / ↑ ↓', tr('walk (Shift runs)')],
          [tr('Click the floor'), tr('walks there')],
          ['← →', tr('previous and next stop')],
          [tr('Space'), tr('plays or pauses the tour')],
        ];
    openSheet(`<div class="help"><h2>${esc(tr('How to explore'))}</h2><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${data.author || contact ? `<h2 style="margin-top:18px">${esc(data.author ?? tr('Contact'))}</h2><div class="contact">${contact}</div>` : ''}</div>`, 'helpsheet');
  };

  // Minimap.
  const map = el('div', 'ui glass map', `<div class="paper"></div><div class="mapbar"><span></span><button aria-label="${esc(tr('Bigger map'))}">⤢</button></div>`);
  const mapPaper = map.querySelector('.paper') as HTMLElement;
  const mapTitle = map.querySelector('.mapbar span') as HTMLElement;
  map.querySelector('.mapbar button')!.addEventListener('click', () => map.classList.toggle('big'));
  map.hidden = true;
  document.body.appendChild(map);
  let mapPlan = -1;
  let marker: SVGGElement | null = null;
  const toPlan = (p: TourDataPlan, x: number, z: number): [number, number] => {
    const [a, b, c, d, e, f] = p.toWorld;
    const det = a * d - b * c || 1;
    const X = x - e,
      Z = z - f;
    return [(d * X - c * Z) / det, (-b * X + a * Z) / det];
  };
  const toWorld = (p: TourDataPlan, x: number, z: number): [number, number] => {
    const [a, b, c, d, e, f] = p.toWorld;
    return [a * x + c * z + e, b * x + d * z + f];
  };
  const showPlan = (i: number) => {
    if (i === mapPlan) return;
    mapPlan = i;
    const p = data.plans[i];
    map.hidden = !p;
    if (!p) return;
    mapPaper.innerHTML = p.svg;
    mapTitle.textContent = p.title;
    const svg = mapPaper.querySelector('svg')!;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    marker.innerHTML = '<path d="M0,0 L-0.9,-2.2 A2.4,2.4 0 0 1 0.9,-2.2 Z" fill="rgba(232,106,30,.35)"/><circle r="0.28" fill="#e86a1e" stroke="#fff" stroke-width="0.08"/>';
    svg.appendChild(marker);
    svg.addEventListener('click', (e) => {
      const m = svg.getScreenCTM();
      if (!m) return;
      const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      const [wx, wz] = toWorld(p, q.x, q.y);
      walkTo(wx, wz, p.floor);
    });
  };
  const planAt = (y: number) => {
    let best = -1;
    data.plans.forEach((p, i) => {
      if (y >= p.floor - 0.6 && y < p.top - 0.2 && (best < 0 || p.floor > data.plans[best]!.floor)) best = i;
    });
    return best;
  };

  // Joystick (touch, walking).
  const joy = el('div', 'ui joy', '<i></i>');
  document.body.appendChild(joy);
  const stick = { x: 0, y: 0, id: -1 };
  joy.addEventListener('pointerdown', (e) => {
    stick.id = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  const moveStick = (e: PointerEvent) => {
    if (e.pointerId !== stick.id) return;
    const r = joy.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2),
      y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    stick.x = x;
    stick.y = y;
    (joy.querySelector('i') as HTMLElement).style.transform = `translate(${x * 34}px,${y * 34}px)`;
  };
  joy.addEventListener('pointermove', moveStick);
  const endStick = () => {
    stick.id = -1;
    stick.x = stick.y = 0;
    (joy.querySelector('i') as HTMLElement).style.transform = '';
  };
  joy.addEventListener('pointerup', endStick);
  joy.addEventListener('pointercancel', endStick);

  // ── State ────────────────────────────────────────────────────────────
  let mode: 'orbit' | 'walk' = 'orbit';
  const w = { x: 0, z: 0, feet: 0, vy: 0, yaw: 0, pitch: 0 };
  const keys = new Set<string>();
  let cur = -1;
  let playing = false;
  let playT = 0;
  /** Where a click sent the walker, and the closest it has come so far (it gives up when it stops getting closer). */
  let goal: { x: number; z: number; best: number; at: number } | null = null;
  let fly: { p0: THREE.Vector3; t0v: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; start: number; dur: number; walk: boolean; done?: () => void } | null = null;
  const lookTarget = new THREE.Vector3().copy(controls.target);
  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;

  const setMode = (m: 'orbit' | 'walk', move = false) => {
    if (m === 'walk' && !data.options.walk) return;
    if (m === mode && !move) return;
    const was = mode;
    mode = m;
    document.body.classList.toggle('walking', m === 'walk');
    orbitB.setAttribute('aria-pressed', String(m === 'orbit'));
    walkB.setAttribute('aria-pressed', String(m === 'walk'));
    controls.enabled = m === 'orbit';
    if (!move || m === was) {
      if (m === 'walk') fromCamera();
      return;
    }
    if (m === 'walk') {
      // Into the room nearest to what is looked at (the first room when nothing is near).
      let best = -1,
        bd = Infinity;
      data.rooms.forEach((r, i) => {
        const d = Math.hypot(r.eye[0] - controls.target.x, r.eye[2] - controls.target.z) + Math.abs(r.floor - controls.target.y) * 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      const walkStop = data.stops.findIndex((s) => s.walk);
      if (best >= 0) goRoom(best);
      else if (walkStop >= 0) go(walkStop);
      else {
        const e = new THREE.Vector3(center.x, box.min.y + EYE, box.max.z + 3);
        flyTo(e, new THREE.Vector3(center.x, box.min.y + EYE, center.z), true);
      }
    } else {
      const t = new THREE.Vector3(center.x, center.y * 0.6, center.z);
      const dir = new THREE.Vector3().subVectors(camera.position, t).setY(0).normalize();
      if (dir.lengthSq() < 0.5) dir.set(1, 0, 1).normalize();
      flyTo(t.clone().addScaledVector(dir, radius * 1.7).setY(t.y + radius * 0.9), t, false);
    }
  };

  /** The walker from the camera (after a flight). */
  const fromCamera = () => {
    const p = camera.position;
    w.x = p.x;
    w.z = p.z;
    w.feet = groundUnder(p.x, p.z, p.y - EYE + STEP) ?? p.y - EYE;
    w.vy = 0;
    const d = new THREE.Vector3();
    camera.getWorldDirection(d);
    w.yaw = Math.atan2(-d.x, -d.z);
    w.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.asin(Math.max(-1, Math.min(1, d.y)))));
  };

  /** Height of the floor under (x, z), looking down from `from` (null: nothing), and whether it is the
   *  building's own floor (a slab, the ground) or a part standing on it (a stair, a bed, a table). */
  const groundHit = (x: number, z: number, from: number): { y: number; floor: boolean } | null => {
    ray.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0));
    ray.far = 80;
    const h = ray.intersectObjects(solid, false)[0];
    return h ? { y: h.point.y, floor: h.object === ground || walls.includes(h.object) } : null;
  };
  const groundUnder = (x: number, z: number, from: number): number | null => groundHit(x, z, from)?.y ?? null;
  /** Whether (x, z) at the height y is on a stair. */
  const onStair = (x: number, z: number, y: number) =>
    (data.stairs ?? []).some((s) => x >= s.min[0] && x <= s.max[0] && z >= s.min[1] && z <= s.max[1] && y >= s.y0 - 0.3 && y <= s.y1);
  /** Whether stepping onto the floor `g` from the feet is allowed: a step up to STEP on a floor or a stair,
   *  only a threshold onto anything else (a bed, a sofa, a table is in the way). */
  const canStand = (g: { y: number; floor: boolean } | null, x: number, z: number) => {
    if (!g) return true;
    const rise = g.y - w.feet;
    if (rise > STEP) return false;
    return rise <= SILL || g.floor || onStair(x, z, w.feet);
  };
  /** Whether a step from (x, z) by (dx, dz) hits a wall at the knee or the chest. */
  const blocked = (x: number, z: number, dx: number, dz: number): boolean => {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const dir = new THREE.Vector3(dx / len, 0, dz / len);
    for (const h of [0.5, 1.3]) {
      ray.set(new THREE.Vector3(x, w.feet + h, z), dir);
      ray.far = len + CLEAR;
      if (ray.intersectObjects(walls, false).length) return true;
    }
    return false;
  };
  const tryMove = (dx: number, dz: number) => {
    const ok = (mx: number, mz: number) => {
      if (blocked(w.x, w.z, mx, mz)) return false;
      const nx = w.x + mx,
        nz = w.z + mz;
      // Too high a step stops the walker like a wall. The floor a little further on is looked at too: a
      // rounded edge rises slowly and would be climbed bit by bit, while a stair never rises more than a
      // step in that distance.
      if (!canStand(groundHit(nx, nz, w.feet + STEP + 0.6), nx, nz)) return false;
      const k = AHEAD / Math.hypot(mx, mz);
      const ax = w.x + mx * (1 + k),
        az = w.z + mz * (1 + k);
      if (!canStand(groundHit(ax, az, w.feet + STEP + 0.6), ax, az)) return false;
      w.x += mx;
      w.z += mz;
      return true;
    };
    // Sliding along a wall: the whole step, else each axis alone.
    return ok(dx, dz) || ok(dx, 0) || ok(0, dz);
  };

  const flyTo = (eye: THREE.Vector3, target: THREE.Vector3, walk: boolean, done?: () => void, dur?: number) => {
    const cur0 = new THREE.Vector3();
    if (mode === 'walk') camera.getWorldDirection(cur0).add(camera.position);
    else cur0.copy(controls.target);
    const dist = camera.position.distanceTo(eye);
    fly = { p0: camera.position.clone(), t0v: cur0, p1: eye.clone(), t1: target.clone(), start: performance.now(), dur: dur ?? Math.min(2600, 700 + dist * 70), walk, done };
    goal = null;
    if (walk !== (mode === 'walk')) {
      mode = walk ? 'walk' : 'orbit';
      document.body.classList.toggle('walking', walk);
      orbitB.setAttribute('aria-pressed', String(!walk));
      walkB.setAttribute('aria-pressed', String(walk));
    }
    controls.enabled = false;
  };

  const go = (i: number) => {
    if (!data.stops.length) return;
    const n = data.stops.length;
    cur = ((i % n) + n) % n;
    const s = data.stops[cur]!;
    flyTo(new THREE.Vector3(...s.eye), new THREE.Vector3(...s.target), !!s.walk && data.options.walk, () => {
      playT = performance.now();
    });
    caption.querySelector('h2')!.textContent = s.name;
    (caption.querySelector('p') as HTMLElement).textContent = s.note ?? '';
    (caption.querySelector('p') as HTMLElement).hidden = !s.note;
    caption.hidden = false;
    count.textContent = `${cur + 1} / ${n}`;
    setHash(`p=${cur + 1}`);
  };
  const goRoom = (i: number) => {
    const r = data.rooms[i];
    if (!r) return;
    if (r.view) flyTo(new THREE.Vector3(...r.view.eye), new THREE.Vector3(...r.view.look), true);
    else {
      const eye = new THREE.Vector3(...r.eye);
      const out = new THREE.Vector3(eye.x - center.x, 0, eye.z - center.z);
      if (out.lengthSq() < 0.01) out.set(0, 0, -1);
      out.normalize();
      flyTo(eye, eye.clone().add(out), true);
    }
    caption.querySelector('h2')!.textContent = r.name;
    (caption.querySelector('p') as HTMLElement).textContent = `${r.where} · ${num(r.area)} m²`;
    (caption.querySelector('p') as HTMLElement).hidden = false;
    caption.hidden = false;
    setPlaying(false);
  };
  const walkTo = (x: number, z: number, floor: number) => {
    if (mode !== 'walk') {
      const eye = new THREE.Vector3(x, floor + EYE, z);
      flyTo(eye, eye.clone().add(new THREE.Vector3(center.x - x, 0, center.z - z).normalize()), true);
      return;
    }
    goal = { x, z, best: Infinity, at: performance.now() };
  };
  const setPlaying = (on: boolean) => {
    playing = on && data.stops.length > 0;
    playB.innerHTML = svgIcon(playing ? 'pause' : 'play');
    playB.title = tr(playing ? 'Pause the tour' : 'Play the tour');
    playB.setAttribute('aria-pressed', String(playing));
    if (playing) {
      if (cur < 0) go(0);
      playT = performance.now();
    }
  };

  // ── Links ────────────────────────────────────────────────────────────
  let hashT = 0;
  const setHash = (h: string) => {
    clearTimeout(hashT);
    hashT = window.setTimeout(() => {
      try {
        history.replaceState(null, '', `#${h}`);
      } catch {
        // A page opened from a file may refuse: the link is still built on demand.
      }
    }, 150);
  };
  const viewHash = (): string => {
    if (cur >= 0 && !fly && camera.position.distanceTo(new THREE.Vector3(...data.stops[cur]!.eye)) < 0.05) return `p=${cur + 1}`;
    const r = (v: number) => Math.round(v * 100) / 100;
    if (mode === 'walk') return `w=${[w.x, w.feet, w.z, w.yaw, w.pitch].map(r).join(',')}`;
    return `o=${[...camera.position.toArray(), ...controls.target.toArray()].map(r).join(',')}`;
  };
  const readHash = (): boolean => {
    const h = location.hash.slice(1);
    const [k, v] = h.split('=');
    if (!k || !v) return false;
    const n = v.split(',').map(Number);
    if (k === 'p' && Number.isInteger(n[0]) && n[0]! >= 1 && n[0]! <= data.stops.length) {
      go(n[0]! - 1);
      return true;
    }
    if (k === 'w' && n.length === 5 && n.every(Number.isFinite) && data.options.walk) {
      const [x, feet, z, yaw, pitch] = n as [number, number, number, number, number];
      const eye = new THREE.Vector3(x, feet + EYE, z);
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      flyTo(eye, eye.clone().add(dir), true);
      return true;
    }
    if (k === 'o' && n.length === 6 && n.every(Number.isFinite)) {
      flyTo(new THREE.Vector3(n[0], n[1], n[2]), new THREE.Vector3(n[3], n[4], n[5]), false);
      return true;
    }
    return false;
  };
  const share = async () => {
    const url = `${location.href.split('#')[0]}#${viewHash()}`;
    if (location.protocol === 'file:') toast(tr('Publish the site to share a link that opens here; the link was copied.'));
    try {
      if (touch && navigator.share) {
        await navigator.share({ title: data.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      if (location.protocol !== 'file:') toast(tr('Link to this view copied.'));
    } catch {
      prompt(tr('Copy the link:'), url);
    }
    (window as unknown as { __tourLastLink?: string }).__tourLastLink = url;
  };
  const photo = () => {
    renderer.render(scene, camera);
    canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${data.title.replace(/[^\w\-]+/g, '_') || 'tour'}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    }, 'image/png');
  };

  // ── Input ────────────────────────────────────────────────────────────
  let drag: { x: number; y: number; id: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    if (fly && mode === 'orbit') return;
    if (mode === 'walk') canvas.setPointerCapture(e.pointerId);
    if (playing) setPlaying(false);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (mode === 'walk' && !fly && drag.moved) {
      w.yaw += dx * LOOK * (touch ? 1.4 : 1);
      w.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, w.pitch + dy * LOOK * (touch ? 1.4 : 1)));
      drag.x = e.clientX;
      drag.y = e.clientY;
      goal = null;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    if (!d || d.moved || e.pointerId !== d.id) return;
    // A click: on the floor walks there; in orbit, on the model brings the turning point there.
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ray.far = 1000;
    const h = ray.intersectObjects(solid, false)[0];
    if (!h) return;
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    if (mode === 'walk') {
      if (n.y > 0.7 && h.point.y < w.feet + STEP + 0.05 && h.point.y > w.feet - 3) goal = { x: h.point.x, z: h.point.z, best: Infinity, at: performance.now() };
    } else if (e.detail >= 2 || touch) {
      const eye = camera.position.clone().sub(controls.target).multiplyScalar(0.6).add(h.point);
      flyTo(eye, h.point, false);
    }
  });
  canvas.addEventListener('dblclick', (e) => e.preventDefault());
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest?.('input,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      document.querySelector('.sheet')?.remove();
      cardEl?.remove();
      cardEl = null;
      return;
    }
    if (mode === 'walk' && ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) {
      keys.add(k);
      goal = null;
      if (playing) setPlaying(false);
      e.preventDefault();
      return;
    }
    if (k === 'arrowright' || k === 'pagedown') go(cur + 1);
    else if (k === 'arrowleft' || k === 'pageup') go(cur - 1);
    else if (k === ' ') {
      setPlaying(!playing);
      e.preventDefault();
    } else if (k === 'm' && data.options.walk) setMode(mode === 'walk' ? 'orbit' : 'walk', true);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ── VR ───────────────────────────────────────────────────────────────
  // The button only where a headset can actually start a session (WebXR isSessionSupported).
  const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
  if (data.options.vr && xr) void xr.isSessionSupported('immersive-vr').then((ok) => {
    if (ok) document.body.appendChild(VRButton.createButton(renderer));
  }, () => {});
  if (data.options.vr && xr) {
    renderer.xr.addEventListener('sessionstart', () => {
      // The headset's own height is added to the rig: the rig stands on the floor under the walker.
      if (mode !== 'walk') fromCamera();
      rig.position.set(w.x, w.feet, w.z);
      rig.rotation.set(0, w.yaw, 0);
      camera.position.set(0, 0, 0);
      camera.rotation.set(0, 0, 0);
    });
    renderer.xr.addEventListener('sessionend', () => {
      rig.position.set(0, 0, 0);
      rig.rotation.set(0, 0, 0);
      setMode('orbit', true);
    });
  }

  // ── Frame loop ───────────────────────────────────────────────────────
  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let last = performance.now();
  let occT = 0;
  const tmp = new THREE.Vector3();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (renderer.xr.isPresenting) {
      xrMove(dt);
    } else if (fly) {
      const t = Math.min(1, (now - fly.start) / fly.dur);
      const k = ease(t);
      camera.position.lerpVectors(fly.p0, fly.p1, k);
      lookTarget.lerpVectors(fly.t0v, fly.t1, k);
      camera.lookAt(lookTarget);
      if (t >= 1) {
        const f = fly;
        fly = null;
        if (f.walk) {
          camera.position.copy(f.p1);
          camera.lookAt(f.t1);
          fromCamera();
        } else {
          controls.target.copy(f.t1);
          controls.enabled = true;
          controls.update();
        }
        f.done?.();
      }
    } else if (mode === 'walk') {
      // Keys, stick or a clicked goal.
      let fx = 0,
        fz = 0;
      if (keys.has('w') || keys.has('arrowup')) fz += 1;
      if (keys.has('s') || keys.has('arrowdown')) fz -= 1;
      if (keys.has('a')) fx -= 1;
      if (keys.has('d')) fx += 1;
      if (keys.has('arrowleft')) w.yaw += 1.8 * dt;
      if (keys.has('arrowright')) w.yaw -= 1.8 * dt;
      if (stick.id >= 0) {
        fz -= stick.y;
        w.yaw -= stick.x * 1.6 * dt;
      }
      const speed = keys.has('shift') ? RUN : WALK;
      let mx = 0,
        mz = 0;
      if (fx || fz) {
        const l = Math.max(1, Math.hypot(fx, fz));
        const s = Math.sin(w.yaw),
          c = Math.cos(w.yaw);
        mx = ((-s * fz + c * fx) / l) * speed * dt;
        mz = ((-c * fz - s * fx) / l) * speed * dt;
      } else if (goal) {
        const gx = goal.x - w.x,
          gz = goal.z - w.z;
        const d = Math.hypot(gx, gz);
        if (d < goal.best - 0.05) {
          goal.best = d;
          goal.at = now;
        }
        // Arrived, or held up (sliding along a bed, a wall) for a second and a half.
        if (d < 0.08 || now - goal.at > 1500) goal = null;
        else {
          const st = Math.min(d, WALK * 1.2 * dt);
          mx = (gx / d) * st;
          mz = (gz / d) * st;
          // Turn toward where it goes, gently.
          const want = Math.atan2(-gx, -gz);
          let dy = want - w.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          w.yaw += dy * Math.min(1, dt * 4);
        }
      }
      if ((mx || mz) && !tryMove(mx, mz)) goal = null;
      // Gravity: the feet go to the floor under them (stairs climbed step by step).
      const g = groundUnder(w.x, w.z, w.feet + STEP + 0.05);
      const floor = g ?? ground.position.y;
      if (floor >= w.feet - 0.02) {
        w.feet = floor;
        w.vy = 0;
      } else {
        w.vy -= 9.8 * dt;
        w.feet = Math.max(floor, w.feet + w.vy * dt);
      }
      camera.position.set(w.x, w.feet + EYE, w.z);
      camera.rotation.set(w.pitch, w.yaw, 0, 'YXZ');
    } else controls.update();
    if (playing && !fly && data.options.autoplay > 0 && now - playT > data.options.autoplay * 1000) go(cur + 1);
    // Points of interest follow the model on the screen; hidden behind a wall they fade.
    const occl = now - occT > 250;
    if (occl) occT = now;
    for (const h of hots) {
      tmp.copy(h.at).project(camera);
      const on = tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05 && !renderer.xr.isPresenting;
      h.b.style.display = on ? '' : 'none';
      if (!on) continue;
      h.b.style.left = `${((tmp.x + 1) / 2) * innerWidth}px`;
      h.b.style.top = `${((1 - tmp.y) / 2) * innerHeight}px`;
      if (occl) {
        const d = camera.position.distanceTo(h.at);
        ray.set(camera.position, tmp.copy(h.at).sub(camera.position).normalize());
        ray.far = d - 0.15;
        h.dim = ray.intersectObjects(walls, false).length > 0;
        h.b.classList.toggle('dim', h.dim);
      }
    }
    // The minimap shows the floor being walked (or looked at) and where the eye is.
    const eyeY = mode === 'walk' ? w.feet + 0.1 : controls.target.y;
    const pi = planAt(eyeY);
    showPlan(pi >= 0 ? pi : data.plans.length ? 0 : -1);
    const p = data.plans[mapPlan];
    if (p && marker) {
      const [px, pz] = toPlan(p, camera.position.x, camera.position.z);
      const d = new THREE.Vector3();
      camera.getWorldDirection(d);
      const [qx, qz] = toPlan(p, camera.position.x + d.x, camera.position.z + d.z);
      const ang = (Math.atan2(qx - px, -(qz - pz)) * 180) / Math.PI;
      marker.setAttribute('transform', `translate(${px.toFixed(3)} ${pz.toFixed(3)}) rotate(${ang.toFixed(1)})`);
    }
    renderer.render(scene, camera);
  };

  // VR walking: the left stick moves (with the walls in the way), the right one turns by steps.
  let snapReady = true;
  const xrMove = (dt: number) => {
    const s = renderer.xr.getSession();
    if (!s) return;
    for (const src of s.inputSources) {
      const ax = src.gamepad?.axes;
      if (!ax || ax.length < 4) continue;
      const x = ax[2]!,
        y = ax[3]!;
      if (src.handedness === 'right') {
        if (Math.abs(x) > 0.7 && snapReady) {
          rig.rotation.y -= Math.sign(x) * (Math.PI / 6);
          snapReady = false;
        } else if (Math.abs(x) < 0.3) snapReady = true;
      } else if (Math.abs(x) + Math.abs(y) > 0.15) {
        const head = new THREE.Vector3();
        camera.getWorldDirection(head);
        head.y = 0;
        head.normalize();
        const right = new THREE.Vector3(-head.z, 0, head.x);
        const mv = head.multiplyScalar(-y * WALK * dt).add(right.multiplyScalar(x * WALK * dt));
        w.x = rig.position.x;
        w.z = rig.position.z;
        w.feet = rig.position.y;
        if (tryMove(mv.x, mv.z)) rig.position.set(w.x, w.feet, w.z);
      }
    }
    const g = groundUnder(rig.position.x, rig.position.z, rig.position.y + STEP + 0.05);
    if (g !== null) rig.position.y = g;
  };

  // ── Load ─────────────────────────────────────────────────────────────
  const bytes = b64ToBytes(data.glb);
  progress(0.4);
  new GLTFLoader().parse(
    bytes.buffer as ArrayBuffer,
    '',
    (gltf) => {
      progress(0.8);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const glass = mats.every((x) => (x as THREE.MeshStandardMaterial).transparent && (x as THREE.MeshStandardMaterial).opacity < 0.9);
        if (glass) m.castShadow = false;
        m.geometry.computeBoundsTree();
        solid.push(m);
        // The shell (walls, slabs, roofs) stops the walker; components (doors, furniture) are judged by the floor test.
        // GLTFLoader cleans the node names ('/' removed, https://threejs.org/docs/#api/en/animation/PropertyBinding.sanitizeNodeName);
        // the name as written in the file stays in userData.name (of the node, the parent of a multi-material mesh).
        const name = String(m.userData.name ?? m.parent?.userData.name ?? '');
        if (!/\/components(\/|$)/.test(name)) walls.push(m);
      });
      scene.add(gltf.scene);
      scene.updateMatrixWorld(true);
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      loading.style.opacity = '0';
      setTimeout(() => loading.remove(), 450);
      setMode('orbit');
      orbitB.setAttribute('aria-pressed', 'true');
      if (!readHash() && data.stops.length) go(0);
      if (data.options.autoplay > 0 && data.stops.length > 1 && !location.hash.startsWith('#w') && !location.hash.startsWith('#o')) setPlaying(true);
      (window as unknown as { __tourReady?: boolean }).__tourReady = true;
      renderer.setAnimationLoop(loop);
    },
    (err) => {
      loading.querySelector('span')!.textContent = `${tr('The model could not be read.')} ${String((err as unknown as Error)?.message ?? err)}`;
    },
  );

  // For the browser tests and for whoever embeds the page: the state and the actions.
  (window as unknown as { __tour?: unknown }).__tour = {
    data,
    get state() {
      return { mode, stop: cur, playing, flying: !!fly, going: !!goal, walker: { ...w }, eye: camera.position.toArray(), target: controls.target.toArray(), map: mapPlan, link: viewHash() };
    },
    go,
    goRoom,
    setMode: (m: 'orbit' | 'walk') => setMode(m, true),
    walkTo,
    keys,
    /** Puts the walker at (x, z) with its feet at `feet` (tests). */
    place: (x: number, z: number, feet: number) => {
      w.x = x;
      w.z = z;
      w.feet = feet;
      w.vy = 0;
    },
    /** Whether one step of (dx, dz) from where the walker is would be taken (tests; the walker stays). */
    tryStep: (dx: number, dz: number) => {
      const s0 = { ...w };
      const ok = tryMove(dx, dz);
      const to = { x: w.x, z: w.z };
      Object.assign(w, s0);
      return { ok, to };
    },
    /** The floor under a point and whether the walker could stand there from where it is. */
    probe: (x: number, z: number, from: number) => {
      const g = groundHit(x, z, from);
      return { g, ok: canStand(g, x, z), stair: onStair(x, z, w.feet) };
    },
    /** What stops a step of (dx, dz) from (x, z) with the feet at `feet` (the hit's height and distance). */
    wallHit: (x: number, z: number, feet: number, dx: number, dz: number) => {
      const len = Math.hypot(dx, dz);
      const out: { h: number; d: number; y: number; n: string }[] = [];
      for (const h of [0.5, 1.3]) {
        ray.set(new THREE.Vector3(x, feet + h, z), new THREE.Vector3(dx / len, 0, dz / len));
        ray.far = len + CLEAR;
        const hit = ray.intersectObjects(walls, false)[0];
        if (hit) out.push({ h, d: hit.distance, y: hit.point.y, n: String(hit.object.userData.name ?? hit.object.parent?.userData.name ?? '') });
      }
      return out;
    },
  };

  // Installed as an app (PWA): the service worker keeps it working without the network.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel="manifest"]')) navigator.serviceWorker.register('sw.js').catch(() => undefined);
}

function el(tag: string, cls: string, html: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}

// Started by the page: the data is in <script type="application/json" id="oriel-data">.
const node = typeof document !== 'undefined' ? document.getElementById('oriel-data') : null;
if (node?.textContent) startTour(JSON.parse(node.textContent) as TourData);
