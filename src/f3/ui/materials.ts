// Material library: ready presets (procedural and photographed) with
// real thumbnails, and the panel of the active bucket material (finish,
// colors and generator parameters). Clicking a material arms the bucket; clicking
// a face paints only it, Shift paints the whole volume, Alt copies.
import type { Editor3 } from '../editor/editor';
import type { MaterialRef } from '../model/schema';
import { FINISHES } from '../render/finishes';
import { PROC, procParams, procThumb } from '../render/procedural';
import { PBR_SETS } from '../render/pbr';
import { numCell, prow, selectCell } from './kit';
import { icon } from './icons';
import { materialUses, replaceMaterial, sameMaterial } from '../model/matlib';
import { uid } from '../model/defaults';
import { bindSurface, surfaceRows } from './mateditor';

export interface MaterialPreset {
  id: string;
  name: string;
  group: 'Walls' | 'Floors and paving' | 'Roofing' | 'Metals and wood' | 'Photographed';
  ref: MaterialRef;
}

const P = (id: string, name: string, group: MaterialPreset['group'], finish: string, color: string, color2?: string, params?: Record<string, number>): MaterialPreset => ({
  id,
  name,
  group,
  ref: { finish, color, ...(color2 ? { color2 } : {}), ...(params ? { params } : {}) },
});

export const MATERIAL_PRESETS: MaterialPreset[] = [
  P('plaster-white', 'White plaster', 'Walls', 'plaster', '#ece7dd'),
  P('plaster-sand', 'Sand plaster', 'Walls', 'plaster', '#d9c6a2'),
  P('plaster-terracotta', 'Terracotta plaster', 'Walls', 'plaster', '#c47a52'),
  P('plaster-ochre', 'Ochre plaster', 'Walls', 'plaster', '#d7a54e'),
  P('paint-gray', 'Gray paint', 'Walls', 'paint', '#9ea3a6'),
  P('paint-sea-green', 'Sea green paint', 'Walls', 'paint', '#9fc2b3'),
  P('brick-exposed', 'Exposed brick', 'Walls', 'brick', '#a8553a', '#d8d2c6'),
  P('brick-light', 'Light brick', 'Walls', 'brick', '#c9a27a', '#ece6da'),
  P('brick-english-dark', 'Dark English bond brick', 'Walls', 'brick', '#6e3b2a', '#bdb3a4', { bond: 2 }),
  P('brick-painted', 'Painted brick', 'Walls', 'brick', '#ece8e0', '#d6d0c5', { vary: 0.15 }),
  P('stone-limestone', 'Limestone', 'Walls', 'stone', '#cfc4ae', '#bdb3a0'),
  P('stone-dark', 'Dark stone', 'Walls', 'stone', '#7d7a73', '#5d5a54', { h: 0.3, len: 0.5 }),
  P('concrete-exposed', 'Exposed concrete', 'Walls', 'concrete', '#b9b6ae', undefined, { ties: 1 }),
  P('concrete-smooth', 'Smooth concrete', 'Walls', 'concrete', '#c7c4bc', undefined, { ties: 0, w: 2.4, h: 1.2 }),
  P('floor-ceramic', 'Ceramic tile', 'Floors and paving', 'floor', '#d8d1c4', '#a39b8e'),
  P('floor-porcelain', 'Light porcelain tile', 'Floors and paving', 'floor', '#e5e2dc', '#c9c4bb', { w: 0.9, gloss: 0.8 }),
  P('floor-terracotta', 'Terracotta tile', 'Floors and paving', 'floor', '#b86a45', '#d8cbb8', { w: 0.3, vary: 0.6, gloss: 0.1 }),
  P('paving-interlock', 'Interlocking paving', 'Floors and paving', 'paving', '#9a8f80', '#7c746a'),
  P('deck', 'Wood deck', 'Floors and paving', 'wood', '#8a5f3e', '#2c241d', { w: 0.14 }),
  P('roof-tile', 'Clay roof tile', 'Roofing', 'tile', '#a3593a', '#5a3424'),
  P('roof-tile-aged', 'Aged roof tile', 'Roofing', 'tile', '#7d4b36', '#3f2a20', { vary: 0.9 }),
  P('slate', 'Slate', 'Roofing', 'slate', '#4b5258', '#1c1f22'),
  P('membrane', 'Membrane', 'Roofing', 'membrane', '#8f9290'),
  P('roof-metal', 'Metal roofing', 'Roofing', 'metal', '#9aa3a9'),
  P('panel-seam', 'Seamed panel', 'Metals and wood', 'panel', '#5f6870'),
  P('panel-copper', 'Copper panel', 'Metals and wood', 'panel', '#a86b45'),
  P('wood-natural', 'Natural boards', 'Metals and wood', 'wood', '#9b6a43', '#2c241d'),
  P('wood-dark', 'Dark boards', 'Metals and wood', 'wood', '#5a3b26', '#1d150f'),
  ...Object.keys(PBR_SETS).map((id) => P(id, FINISHES.find((f) => f.id === id)?.name ?? id, 'Photographed', id, id.startsWith('tile') ? '#b9714f' : id.startsWith('brick') ? '#c47a5a' : '#d9d4ca')),
];

/** The typical colors of a finish: those of its first preset. */
export function finishDefaults(finish: string): { color: string; color2?: string } | undefined {
  const p = MATERIAL_PRESETS.find((m) => m.ref.finish === finish);
  return p ? { color: p.ref.color, ...(p.ref.color2 ? { color2: p.ref.color2 } : {}) } : undefined;
}

/**
 * Another finish on a material slot brings its own colors and drops the old finish's pattern settings
 * (audit A2: brick kept the plaster's white and looked painted). The color field next to it changes it
 * afterwards (painted brick), as a material does in SketchUp and Revit.
 */
export function switchFinish(ref: MaterialRef, finish: string): void {
  if (ref.finish === finish) return;
  const d1 = finishDefaults(finish);
  ref.finish = finish;
  delete ref.params;
  if (d1) {
    ref.color = d1.color;
    if (d1.color2) ref.color2 = d1.color2;
    else delete ref.color2;
  }
}

const thumbs = new Map<string, string>();

/** Thumbnail of a material (generated once). */
export function materialThumb(ref: MaterialRef): string | null {
  const key = JSON.stringify(ref);
  const got = thumbs.get(key);
  if (got) return got;
  let url: string | null = null;
  if (PROC[ref.finish]) url = procThumb(ref.finish, ref.params, ref.color, ref.color2 ?? PROC[ref.finish]!.color2);
  else if (PBR_SETS[ref.finish]) url = `./tex/${PBR_SETS[ref.finish]!.dir}/color.jpg`;
  if (url) thumbs.set(key, url);
  return url;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => String(Math.round(v * 1000) / 1000);

/** Panel of the active bucket material (in the inspector while painting). */
export function paintPanel(ed: Editor3): string {
  const m = ed.paintMat;
  const proc = PROC[m.finish];
  const p = proc ? procParams(m.finish, m.params) : {};
  const thumb = materialThumb(m);
  const opts = FINISHES.filter((f) => f.id !== 'glass')
    .map((f) => `<option value="${f.id}" ${f.id === m.finish ? 'selected' : ''}>${esc(f.name)}</option>`)
    .join('');
  // Panel standard: one row per pattern value (lengths in meters, without a written unit).
  const params = proc
    ? proc.params
        .map((d) =>
          d.options
            ? prow(d.label, 'segments', [selectCell(`data-mp="${d.key}"`, d.label, d.options.map((o, i) => [String(i), o] as const), String(Math.round(p[d.key]!)))], { wide: true })
            : prow(d.label, ['vary', 'grain', 'gloss', 'stain', 'stains', 'wear'].includes(d.key) ? 'palette' : 'scale', [numCell({ attr: `data-mp="${d.key}"`, name: d.label, value: num(p[d.key]!), glyph: '', step: d.step })]),
        )
        .join('')
    : '';
  return `<div class="f3-title"><span>Bucket material</span><span class="f3-kind">Paint</span></div>
  <div class="f3-sec" style="padding-top:10px">
    <div style="display:flex;gap:10px;align-items:center">
      <div style="width:64px;height:64px;border-radius:8px;flex:none;background:${thumb ? `url('${thumb}') center/cover` : m.color};box-shadow:inset 0 0 0 1px #ffffff14"></div>
      <div style="display:grid;gap:4px;flex:1;min-width:0">
        ${prow('Finish', 'material', [`<label class="f3-cell sel" title="Finish"><select data-mk="finish" aria-label="Finish">${opts}</select></label>`], { wide: true })}
        ${prow('Color', 'palette', [`<label class="f3-cell col" title="Main color"><input type="color" data-mk="color" value="${m.color}" aria-label="Main color"></label>`, ...(proc && proc.color2 !== '#ffffff' ? [`<label class="f3-cell col" title="Joint, mortar, grout"><input type="color" data-mk="color2" value="${m.color2 ?? proc.color2}" aria-label="Joint color"></label>`] : [])], { title: proc && proc.color2 !== '#ffffff' ? 'Main color and joint color' : 'Main color' })}
      </div>
    </div>
  </div>
  ${params ? `<div class="f3-sec"><h3>Pattern</h3>${params}</div>` : ''}
  <div class="f3-sec"><h3>Surface</h3>${surfaceRows(ed, m)}</div>
  <div class="f3-sec"><h3>Project materials</h3>
    <div class="f3-matlib">${(ed.project.materials ?? []).map((pm) => {
      const th = materialThumb(pm.ref);
      const n = materialUses(ed.project, pm.ref);
      return `<div class="f3-matrow"><button class="sw" data-lib="${pm.id}" title="Take ${esc(pm.name)} in the bucket" style="background:${th ? `url('${th}') center/cover` : pm.ref.color}"></button><input data-libname="${pm.id}" value="${esc(pm.name)}" aria-label="Material name" maxlength="60"><small title="Faces that carry it">${n}</small><button class="f3-btn ic" data-libset="${pm.id}" title="Change it everywhere to the bucket material (${n} face${n === 1 ? '' : 's'})">${icon('restore')}</button><button class="f3-btn ic danger" data-libdel="${pm.id}" title="Remove from the library (the faces keep it)">${icon('trash')}</button></div>`;
    }).join('') || '<p class="f3-empty" style="padding:0">Save the bucket material to reuse it, and to change every face that has it at once.</p>'}</div>
    <div class="f3-btns n1"><button class="f3-btn" data-libadd title="Keep the bucket material in this project">${icon('add')}Save bucket material</button></div>
  </div>
  <div class="f3-sec"><p class="f3-empty" style="padding:6px 0 0">Click a face to paint only it · <kbd>Shift</kbd> the whole volume · a window or door paints its frames (every one of its rule) · <kbd>Alt</kbd> copies the material.</p></div>`;
}

export function bindPaintPanel(ed: Editor3, root: HTMLElement): void {
  const parse = (s: string) => parseFloat(s.replace(',', '.'));
  const set = (fn: (m: MaterialRef) => void) => {
    const m = structuredClone(ed.paintMat);
    fn(m);
    ed.paintMat = m;
    ed.select({ ...ed.sel });
  };
  root.querySelector<HTMLSelectElement>('[data-mk="finish"]')?.addEventListener('change', (e) =>
    set((m) => {
      m.finish = (e.target as HTMLSelectElement).value;
      delete m.params;
      delete m.color2;
    }),
  );
  root.querySelector<HTMLInputElement>('[data-mk="color"]')?.addEventListener('change', (e) => set((m) => void (m.color = (e.target as HTMLInputElement).value)));
  root.querySelector<HTMLInputElement>('[data-mk="color2"]')?.addEventListener('change', (e) => set((m) => void (m.color2 = (e.target as HTMLInputElement).value)));
  bindSurface(ed, root, (fn) => set(fn));
  // Project material library (model/matlib.ts).
  const lib = () => (ed.store.project.materials ??= []);
  const commit = (msg: string, ids: string[] | null = []) => {
    ed.store.commit(ids, msg);
    if (msg) ed.toast(msg);
    ed.select({ ...ed.sel });
  };
  root.querySelector<HTMLButtonElement>('[data-libadd]')?.addEventListener('click', () => {
    const m = ed.paintMat;
    if (lib().some((x) => sameMaterial(x.ref, m))) return ed.toast('That material is already in the library.');
    const f = FINISHES.find((x) => x.id === m.finish);
    lib().push({ id: uid(), name: `${f?.name ?? m.finish} ${lib().length + 1}`, ref: structuredClone(m) });
    commit('Material saved in the project library.');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-lib]').forEach((b) =>
    b.addEventListener('click', () => {
      const pm = lib().find((x) => x.id === b.dataset.lib);
      if (!pm) return;
      ed.paintMat = structuredClone(pm.ref);
      ed.select({ ...ed.sel });
      ed.toast(`${pm.name} in the bucket: click a face to paint.`);
    }),
  );
  root.querySelectorAll<HTMLInputElement>('[data-libname]').forEach((el) =>
    el.addEventListener('change', () => {
      const pm = lib().find((x) => x.id === el.dataset.libname);
      if (pm) pm.name = el.value.trim().slice(0, 60) || pm.name;
      commit('');
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-libset]').forEach((b) =>
    b.addEventListener('click', () => {
      const pm = lib().find((x) => x.id === b.dataset.libset);
      if (!pm) return;
      const to = structuredClone(ed.paintMat);
      const r = replaceMaterial(ed.store.project, pm.ref, to);
      pm.ref = to;
      commit(`${pm.name}: ${r.count} face${r.count === 1 ? '' : 's'} changed in ${r.buildings.length} building${r.buildings.length === 1 ? '' : 's'}.`, r.buildings);
    }),
  );
  root.querySelectorAll<HTMLButtonElement>('[data-libdel]').forEach((b) =>
    b.addEventListener('click', () => {
      ed.store.project.materials = lib().filter((x) => x.id !== b.dataset.libdel);
      commit('Material removed from the library (the faces keep it).');
    }),
  );
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-mp]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = parse(el.value);
      if (Number.isFinite(v)) set((m) => void (m.params = { ...(m.params ?? {}), [el.dataset.mp!]: v }));
    }),
  );
}
