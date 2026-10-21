// Photographic render (Export → "Photorealistic render", Ctrl+K "Render", stage 6 Present): the view as
// it is, path traced on the canvas (render/pathtrace.ts) until the picture converges, then saved as a
// PNG. A bar over the view with the quality (samples), the indirect light (bounces: an interior lit by
// its windows needs more), the exposure, the progress and the time; the camera stays where it was while
// the picture forms (changing a setting starts it again). Esc or Close gives the view back.
import type { Editor3 } from '../editor/editor';
import { floorPlan, sortedLevels } from '../eval/floorplan';
import type { PhotoLight, PhotoSession } from '../render/pathtrace';
import { tr } from './i18n';
import { icon } from './icons';

const CSS = `
.f3-photo{position:absolute;z-index:16;left:50%;top:12px;transform:translateX(-50%);width:min(760px,calc(100% - 24px));background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px #0005;font-size:12.5px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.f3-photo .top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.f3-photo h2{margin:0;font-size:14px;flex:1;min-width:160px}
.f3-photo label{display:flex;align-items:center;gap:6px;color:var(--muted)}
.f3-photo select,.f3-photo input[type=range]{background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:6px;height:28px;font:inherit}
.f3-photo input[type=range]{width:110px;padding:0}
.f3-photo .bar{height:6px;border-radius:3px;background:var(--field);overflow:hidden}
.f3-photo .bar i{display:block;height:100%;width:0;background:var(--accent,#e86a1e);transition:width .2s}
.f3-photo .status{display:flex;justify-content:space-between;gap:10px;color:var(--muted);font-variant-numeric:tabular-nums}
.f3-photo .btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.f3-photo button{height:30px;padding:0 12px;border-radius:7px;border:1px solid var(--line);background:var(--field);color:var(--ink);font:inherit;cursor:pointer}
.f3-photo button.primary{background:var(--accent,#e86a1e);border-color:transparent;color:#fff;font-weight:600}
.f3-photo button:disabled{opacity:.5;cursor:default}
.f3-photo-shield{position:absolute;inset:0;z-index:15;cursor:progress}
`;

/** Quality presets: samples per pixel. */
const QUALITY: [number, string][] = [
  [64, 'Draft'],
  [256, 'Good'],
  [1024, 'Excellent'],
  [4096, 'Maximum'],
];
/** Indirect light: bounces of the light between surfaces. */
const LIGHT: [number, string][] = [
  [4, 'Outside (fast)'],
  [7, 'Outside and inside'],
  [12, 'Interior lit by windows'],
];

let current: { close(): void } | null = null;

/**
 * A ceiling light in every room of every floor drawn (the rooms of the plans, named or not): a square
 * panel under the ceiling at the middle of the room, larger in a larger room.
 */
export function roomLights(ed: Editor3): PhotoLight[] {
  const out: PhotoLight[] = [];
  for (const b of ed.project.buildings) {
    if (b.hidden) continue;
    const ev = ed.view.built.get(b.id)?.ev;
    const r = (b.rotation * Math.PI) / 180;
    const c = Math.cos(r),
      sn = Math.sin(r);
    sortedLevels(b).forEach((lv, i) => {
      let fp;
      try {
        fp = floorPlan(b, i, ev?.placements ?? []);
      } catch {
        return;
      }
      const top = (b.elevation ?? 0) + fp.elevation + lv.height;
      for (const room of fp.rooms) {
        if (room.area < 2) continue;
        const [x, z] = room.at;
        out.push({ at: [c * x + sn * z + b.position[0], top - 0.03, -sn * x + c * z + b.position[1]], size: Math.min(1.2, Math.max(0.4, Math.sqrt(room.area) * 0.18)) });
      }
    });
  }
  return out;
}

/** Opens the bar and starts the picture from the current view. */
export function openPhoto(ed: Editor3): void {
  current?.close();
  if (!document.getElementById('f3-photo-css')) {
    const st = document.createElement('style');
    st.id = 'f3-photo-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const host = ed.shell.view;
  const shield = document.createElement('div');
  shield.className = 'f3-photo-shield';
  shield.title = tr('The picture is forming: close the render to move the camera.');
  const bar = document.createElement('div');
  bar.className = 'f3-photo';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', tr('Photorealistic render'));
  const opt = (list: [number, string][], v: number) => list.map(([n, l]) => `<option value="${n}"${n === v ? ' selected' : ''}>${tr(l)}</option>`).join('');
  bar.innerHTML = `<div class="top"><h2>${tr('Photorealistic render')}</h2>
    <label>${tr('Quality')} <select data-q>${opt(QUALITY, 256)}</select></label>
    <label>${tr('Light')} <select data-b>${opt(LIGHT, 7)}</select></label>
    <label>${tr('Exposure')} <input type="range" data-e min="-2" max="2" step="0.25" value="0"></label>
    <label title="${tr('A ceiling light in every room (on by default at night)')}"><input type="checkbox" data-l${ed.view.look.skyState().dark > 0.5 ? ' checked' : ''}> ${tr('Lights on inside')}</label></div>
    <div class="bar"><i></i></div>
    <div class="status"><span data-s></span><div class="btns"><button data-again>${tr('Start again')}</button><button class="primary" data-save>${tr('Save image (PNG)')}</button><button data-close>${tr('Close')}</button></div></div>`;
  host.append(shield, bar);
  const $ = <T extends HTMLElement>(s: string) => bar.querySelector(s) as T;
  const fill = $<HTMLElement>('.bar i');
  const status = $<HTMLElement>('[data-s]');
  let session: PhotoSession | null = null;
  let started = 0;
  let total = 256;
  let run = 0;
  const time = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const start = async () => {
    const id = ++run;
    total = Number($<HTMLSelectElement>('[data-q]').value);
    const bounces = Number($<HTMLSelectElement>('[data-b]').value);
    const ev = Number($<HTMLInputElement>('[data-e]').value);
    const lights = $<HTMLInputElement>('[data-l]').checked ? roomLights(ed) : [];
    status.textContent = tr('Preparing the scene…');
    fill.style.width = '0';
    started = performance.now();
    const s = await ed.view.startPhoto({ samples: total, bounces, exposure: Math.pow(2, ev), lights }, (n, done) => {
      if (id !== run) return;
      fill.style.width = `${Math.min(100, (n / total) * 100)}%`;
      const el = performance.now() - started;
      const left = n > 0 && !done ? (el / n) * (total - n) : 0;
      status.textContent = done ? `${tr('Done')}: ${n} ${tr('samples')} · ${time(el)}` : `${n} / ${total} ${tr('samples')} · ${time(el)}${n > 2 ? ` · ${tr('about')} ${time(left)} ${tr('left')}` : ''}`;
    });
    if (id === run) session = s;
  };
  const save = async () => {
    if (!session) return;
    const blob = await session.snapshot();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(ed.project.name || 'project').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_')}-render.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  };
  const close = () => {
    run++;
    ed.view.stopPhoto();
    session = null;
    shield.remove();
    bar.remove();
    removeEventListener('keydown', onKey, true);
    current = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  addEventListener('keydown', onKey, true);
  for (const s of ['[data-q]', '[data-b]', '[data-e]', '[data-l]']) bar.querySelector(s)!.addEventListener('change', () => void start());
  $('[data-again]').addEventListener('click', () => void start());
  $('[data-save]').addEventListener('click', () => void save());
  $('[data-close]').addEventListener('click', close);
  current = { close };
  void start();
}

/** The button on the View island (beside the interior view). */
export function mountPhoto(ed: Editor3): void {
  const btn = document.createElement('button');
  btn.className = 'f3-tb';
  btn.title = 'Photorealistic render: the view path traced (sun, sky, bounced light, glass), saved as an image';
  btn.setAttribute('aria-label', 'Photorealistic render');
  btn.dataset.photo = '';
  btn.innerHTML = icon('camera');
  btn.addEventListener('click', () => openPhoto(ed));
  ed.shell.viewbar.appendChild(btn);
}
