// Object maker: any object made by hand from simple solids, without a library. Add boxes, cylinders,
// tubes, cones, spheres, rings, wedges; place, size and turn each one; give each its finish, colours and
// surface (roughness, metallic, light, opacity), or make it a lamp that lights at night; see the picture
// change as you type. Saved as a project type of the family "Your own object" (families/assembly.ts):
// it goes in the library and places, copies and arrays like any component, and editing it again
// changes every copy.
import type { Editor3 } from '../editor/editor';
import type { ComponentType, Vec3 } from '../model/schema';
import { readShapes, SHAPE_KINDS, STARTER, type Shape, type ShapeKind } from '../families/assembly';
import { family as familyOf } from '../families/index';
import { FINISHES } from '../render/finishes';
import { createThumbnailer, type Thumbnailer } from '../render/thumbs';
import { uid } from '../model/defaults';
import { evalExpr } from '../model/expr';
import { tr } from './i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => String(Math.round(v * 1000) / 1000);

const CSS = `
.f3-objm .cols{grid-template-columns:220px minmax(0,1fr) 320px}
.f3-objm .shapes{display:flex;flex-direction:column;gap:6px;min-height:0}
.f3-objm .shapes ol{list-style:none;margin:0;padding:0;overflow:auto;max-height:52vh;display:grid;gap:2px}
.f3-objm .shapes li button{width:100%;text-align:left;background:none;border:0;color:var(--ink);padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center}
.f3-objm .shapes li button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-objm .shapes li i{width:12px;height:12px;border-radius:3px;flex:none;box-shadow:inset 0 0 0 1px #0003}
.f3-objm .shapes .add{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.f3-objm .shapes .add button,.f3-objm .row button{min-height:28px;line-height:1.15;padding:3px 4px;border:1px solid var(--line);border-radius:6px;background:var(--field);color:var(--ink);cursor:pointer;font:inherit;font-size:12px}
.f3-objm .row{display:flex;gap:4px}.f3-objm .row button{flex:1}
.f3-objm .trip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.f3-objm .trip .num em{min-width:10px}
.f3-objm .form label.wide{grid-column:1/-1;grid-template-columns:150px minmax(0,1fr)}
`;

/** A new shape of a kind, next to the others (on the ground, to the right of what there is). */
function newShape(kind: ShapeKind, list: Shape[]): Shape {
  const right = list.reduce((x, s) => Math.max(x, s.at[0] + s.size[0] / 2), -0.25);
  const size: Vec3 = kind === 'cylinder' || kind === 'tube' ? [0.3, 0.6, 0.3] : kind === 'torus' ? [0.6, 0.12, 0.6] : [0.5, 0.5, 0.5];
  return { kind, name: tr(SHAPE_KINDS.find(([k]) => k === kind)![1]), at: [right + 0.05 + size[0] / 2, size[1] / 2, 0], size, color: '#c9c2b6', finish: 'paint', ...(kind === 'tube' || kind === 'torus' || kind === 'rbox' ? { t: 0.3 } : {}) };
}

/** Opens the maker: a new object, or `edit` an existing one (every copy follows). */
export function openObjectMaker(ed: Editor3, opts: { edit?: ComponentType } = {}): void {
  if (!document.getElementById('f3-objm-css')) {
    const st = document.createElement('style');
    st.id = 'f3-objm-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const fam = familyOf('assembly')!;
  const starter = () => structuredClone(STARTER).map((s) => ({ ...s, name: tr(s.name ?? '') }));
  let shapes: Shape[] = opts.edit ? readShapes(opts.edit.params) : starter();
  if (!shapes.length) shapes = starter();
  let cur = 0;
  let name = opts.edit?.name ?? tr('My object');
  let thumbs: Thumbnailer | null = null;
  const m = document.createElement('div');
  m.className = 'f3-modal';
  m.innerHTML = `<div class="f3-creator f3-objm" role="dialog" aria-label="${tr(opts.edit ? 'Edit object' : 'New object')}">
    <header><h2>${tr(opts.edit ? 'Edit object' : 'New object from shapes')}</h2><button class="f3-x" data-close aria-label="${tr('Close')}">×</button></header>
    <div class="cols">
      <div class="shapes"><ol></ol>
        <div class="row"><button data-dup title="${tr('A copy of the selected shape, beside it')}">${tr('Duplicate')}</button><button data-mirror title="${tr('A copy mirrored across the middle (left ↔ right)')}">${tr('Mirror')}</button><button data-del title="${tr('Delete the selected shape')}">${tr('Delete')}</button></div>
        <p class="note" style="margin:4px 0 0">${tr('Add a shape')}:</p>
        <div class="add">${SHAPE_KINDS.map(([k, l]) => `<button data-add="${k}">${tr(l)}</button>`).join('')}</div>
      </div>
      <section class="form"></section>
      <aside><img alt="${tr('Preview')}"><label>${tr('Name')} <input data-name maxlength="60"></label>
        <p class="note"></p>
        <div class="acts"><button class="f3-btn" data-close>${tr('Cancel')}</button><button class="f3-btn primary" data-save>${tr(opts.edit ? 'Save (every copy follows)' : 'Create and place')}</button></div></aside>
    </div></div>`;
  ed.shell.root.appendChild(m);
  const list = m.querySelector<HTMLOListElement>('.shapes ol')!;
  const form = m.querySelector<HTMLElement>('.form')!;
  const img = m.querySelector<HTMLImageElement>('aside img')!;
  const nameIn = m.querySelector<HTMLInputElement>('[data-name]')!;
  const note = m.querySelector<HTMLElement>('aside .note')!;
  nameIn.value = name;

  let pending = 0;
  const preview = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      thumbs ??= createThumbnailer(ed.view.renderer, ed.view.ctx, { project: ed.project, width: 320, height: 260 });
      void thumbs
        .get('objectmaker', { shapes: JSON.stringify(shapes) }, fam)
        .then((url) => (img.src = url))
        .catch(() => (note.textContent = tr('No picture for these values.')));
    });
  };
  const drawList = () => {
    list.innerHTML = shapes.map((s, i) => `<li><button data-pick="${i}" aria-pressed="${i === cur}"><i style="background:${esc(s.color)}"></i>${esc(s.name || tr(SHAPE_KINDS.find(([k]) => k === s.kind)![1]))}</button></li>`).join('');
  };
  const numIn = (k: string, v: number, unit = 'm', title = '') => `<span class="num" title="${esc(title)}"><input inputmode="decimal" data-f="${k}" value="${num(v)}"><em>${unit}</em></span>`;
  const drawForm = () => {
    const s = shapes[cur];
    if (!s) {
      form.innerHTML = `<p class="note">${tr('Add a shape to start.')}</p>`;
      return;
    }
    const rot = s.rot ?? [0, 0, 0];
    const tLabel = s.kind === 'rbox' ? 'Rounding' : s.kind === 'tube' ? 'Wall' : s.kind === 'torus' ? 'Thickness' : '';
    form.innerHTML = `<fieldset><legend>${tr('Shape')}</legend>
      <label><span>${tr('Kind')}</span><select data-f="kind">${SHAPE_KINDS.map(([k, l]) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${tr(l)}</option>`).join('')}</select></label>
      <label><span>${tr('Name')}</span><input data-f="name" value="${esc(s.name ?? '')}" maxlength="40"></label></fieldset>
    <fieldset><legend>${tr('Place, size and turn')}</legend>
      <label class="wide"><span title="${tr('Middle of the shape: X right, Y up from the ground, Z forward')}">${tr('Position')} (X, Y, Z)</span><span class="trip">${numIn('at.0', s.at[0])}${numIn('at.1', s.at[1])}${numIn('at.2', s.at[2])}</span></label>
      <label class="wide"><span title="${tr('Width, height and depth of the shape')}">${tr('Size')} (W, H, D)</span><span class="trip">${numIn('size.0', s.size[0])}${numIn('size.1', s.size[1])}${numIn('size.2', s.size[2])}</span></label>
      <label class="wide"><span title="${tr('Turn in degrees around the vertical, then across, then front to back')}">${tr('Turn')} (Y, X, Z)</span><span class="trip">${numIn('rot.0', rot[0], '°')}${numIn('rot.1', rot[1], '°')}${numIn('rot.2', rot[2], '°')}</span></label>
      ${tLabel ? `<label><span>${tr(tLabel)}</span>${numIn('t', s.t ?? 0.3, '', tr('Share of the size: 0.05 … 0.9'))}</label>` : ''}</fieldset>
    <fieldset><legend>${tr('Material')}</legend>
      <label><span>${tr('Finish')}</span><select data-f="finish">${FINISHES.filter((f) => f.id !== 'image').map((f) => `<option value="${f.id}"${f.id === (s.finish ?? 'paint') ? ' selected' : ''}>${esc(tr(f.name))}</option>`).join('')}</select></label>
      <label><span>${tr('Color')}</span><input type="color" data-f="color" value="${esc(s.color)}"></label>
      <label><span>${tr('Roughness')}</span>${numIn('rough', s.rough ?? 0.6, '', tr('0 polished, 1 matte'))}</label>
      <label><span>${tr('Metallic')}</span>${numIn('metal', s.metal ?? 0, '', tr('0 paint, stone, wood; 1 bare metal'))}</label>
      <label><span>${tr('Light given off')}</span>${numIn('glow', s.glow ?? 0, '', tr('0 none, 1 a lit sign, 3 a lamp'))}</label>
      <label><span>${tr('Opacity')}</span>${numIn('opacity', s.opacity ?? 1, '', tr('1 solid … 0.05 almost invisible'))}</label>
      <label><span title="${tr('Glows at night and lights the rooms in the photorealistic render')}">${tr('Lamp (lights at night)')}</span><input type="checkbox" data-f="lamp"${s.lamp ? ' checked' : ''}></label></fieldset>`;
  };
  const redraw = () => {
    drawList();
    drawForm();
    preview();
  };
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]');
    if (!b) return;
    cur = Number(b.dataset.pick);
    drawList();
    drawForm();
  });
  m.querySelector('.add')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-add]');
    if (!b) return;
    shapes.push(newShape(b.dataset.add as ShapeKind, shapes));
    cur = shapes.length - 1;
    redraw();
  });
  m.querySelector('[data-dup]')!.addEventListener('click', () => {
    const s = shapes[cur];
    if (!s) return;
    const c = structuredClone(s);
    c.at = [s.at[0] + s.size[0] + 0.05, s.at[1], s.at[2]];
    shapes.push(c);
    cur = shapes.length - 1;
    redraw();
  });
  m.querySelector('[data-mirror]')!.addEventListener('click', () => {
    const s = shapes[cur];
    if (!s) return;
    const c = structuredClone(s);
    c.at = [-s.at[0], s.at[1], s.at[2]];
    if (c.rot) c.rot = [-c.rot[0], c.rot[1], -c.rot[2]];
    shapes.push(c);
    cur = shapes.length - 1;
    redraw();
  });
  m.querySelector('[data-del]')!.addEventListener('click', () => {
    if (!shapes[cur]) return;
    shapes.splice(cur, 1);
    cur = Math.max(0, Math.min(cur, shapes.length - 1));
    redraw();
  });
  form.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.f;
    const s = shapes[cur];
    if (!k || !s) return;
    if (k === 'kind') {
      s.kind = el.value as ShapeKind;
      if ((s.kind === 'tube' || s.kind === 'torus' || s.kind === 'rbox') && s.t === undefined) s.t = 0.3;
      return redraw();
    }
    if (k === 'name') s.name = el.value.slice(0, 40);
    else if (k === 'finish') s.finish = el.value;
    else if (k === 'color') s.color = el.value;
    else if (k === 'lamp') s.lamp = (el as HTMLInputElement).checked || undefined;
    else {
      const v = evalExpr(el.value);
      if (v === null || !Number.isFinite(v)) return void (note.textContent = `“${el.value}” ${tr('is not a number.')}`);
      note.textContent = '';
      const [f, i] = k.split('.') as ['at' | 'size' | 'rot' | 't' | 'rough' | 'metal' | 'glow' | 'opacity', string | undefined];
      if (f === 'at') s.at[Number(i)] = v;
      else if (f === 'size') s.size[Number(i)] = Math.max(0.005, Math.min(200, v));
      else if (f === 'rot') (s.rot ??= [0, 0, 0])[Number(i)] = v;
      else if (f === 't') s.t = Math.max(0.05, Math.min(0.9, v));
      else if (f === 'rough' || f === 'metal') s[f] = Math.max(0, Math.min(1, v));
      else if (f === 'glow') s.glow = Math.max(0, Math.min(20, v)) || undefined;
      else if (f === 'opacity') s.opacity = Math.max(0.02, Math.min(1, v));
    }
    drawList();
    preview();
  });
  nameIn.addEventListener('input', () => (name = nameIn.value));
  const close = () => {
    cancelAnimationFrame(pending);
    thumbs?.dispose();
    m.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const save = () => {
    if (!shapes.length) return void (note.textContent = tr('Add a shape to start.'));
    const nm = (name.trim() || tr('My object')).slice(0, 60);
    const params = { shapes: JSON.stringify(shapes) };
    const p = ed.store.project;
    const old = opts.edit && p.types.find((t) => t.id === opts.edit!.id);
    if (old) {
      old.name = nm;
      old.params = params;
      ed.store.commit(null, `${nm} saved: every copy follows.`);
      ed.toast(`${nm} saved: every copy follows.`);
      return close();
    }
    const t: ComponentType = { id: uid(), family: 'assembly', name: nm, params, user: true };
    p.types.push(t);
    ed.store.commit([], `${nm} created.`);
    close();
    ed.startPlacing(t.id);
    ed.toast(`${nm} created: click where it goes (it is also in the library).`);
  };
  m.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest('[data-close]')) close();
    else if (t.closest('[data-save]')) save();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  redraw();
  nameIn.focus();
}
