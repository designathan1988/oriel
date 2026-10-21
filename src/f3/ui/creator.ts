// Component creator: a new window, door, balcony, stair, tree, bench… or any other component made from
// one of the procedural families, with every one of its parameters in view and a live picture; saved as
// a project type (it appears in the library and places like any other). The same dialog edits a type
// that exists (every occurrence follows). Families: families/index.ts; picture: render/thumbs.ts.
import type { Editor3 } from '../editor/editor';
import type { ComponentType } from '../model/schema';
import { allFamilies, family as familyOf } from '../families/index';
import { CATEGORY_NAMES, resolveParams, type Family, type ParamDef, type Params } from '../families/family';
import { FINISHES } from '../render/finishes';
import { createThumbnailer, type Thumbnailer } from '../render/thumbs';
import { uid } from '../model/defaults';
import { evalExpr } from '../model/expr';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const GROUPS: Record<ParamDef['group'], string> = { size: 'Size', divisions: 'Divisions', profile: 'Profile', material: 'Materials', detail: 'Details' };

function field(d: ParamDef, v: unknown): string {
  const id = `data-cp="${d.key}"`;
  if (d.kind === 'enum') return `<select ${id}>${(d.options ?? []).map((o) => `<option value="${esc(o.value)}"${String(v) === o.value ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  if (d.kind === 'bool') return `<input type="checkbox" ${id}${v === true ? ' checked' : ''}>`;
  if (d.kind === 'color') return `<input type="color" ${id} value="${esc(String(v))}">`;
  if (d.kind === 'finish') return `<select ${id}>${FINISHES.map((f) => `<option value="${f.id}"${String(v) === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`;
  if (d.kind === 'text') return `<input ${id} value="${esc(String(v ?? ''))}">`;
  const unit = d.kind === 'length' ? 'm' : d.kind === 'angle' ? '°' : '';
  // A number, or a formula of the other parameters ("=width/2").
  return `<span class="num"><input inputmode="decimal" ${id} value="${typeof v === 'number' ? Math.round(v * 1000) / 1000 : esc(String(v ?? ''))}" title="A number, or a formula of the other parameters: =width/2"><em>${unit}</em></span>`;
}

/** Opens the creator: a new type (optionally of one family), or `edit` an existing project type. */
export function openCreator(ed: Editor3, opts: { family?: string; edit?: ComponentType; start?: { name: string; params: Params } } = {}): void {
  const fams = allFamilies().sort((a, b) => (CATEGORY_NAMES[a.category] ?? a.category).localeCompare(CATEGORY_NAMES[b.category] ?? b.category) || a.name.localeCompare(b.name));
  let fam: Family = (opts.edit && familyOf(opts.edit.family)) || (opts.family && familyOf(opts.family)) || fams[0]!;
  let params: Params = resolveParams(fam, opts.edit?.params ?? opts.start?.params ?? {});
  let name = opts.edit?.name ?? opts.start?.name ?? `My ${fam.name.toLowerCase()}`;
  let thumbs: Thumbnailer | null = null;
  const m = document.createElement('div');
  m.className = 'f3-modal';
  m.innerHTML = `<div class="f3-creator" role="dialog" aria-label="${opts.edit ? 'Edit component' : 'New component'}">
    <header><h2>${opts.edit ? 'Edit component' : 'New component'}</h2><button class="f3-x" data-close aria-label="Close">×</button></header>
    <div class="cols">
      <nav aria-label="Families"${opts.edit ? ' hidden' : ''}><input type="search" placeholder="Find a family…" aria-label="Find a family"><ul></ul></nav>
      <section class="form"></section>
      <aside><img alt="Preview"><label>Name <input data-name maxlength="60"></label>
        <p class="note"></p>
        <div class="acts"><button class="f3-btn" data-close>Cancel</button><button class="f3-btn primary" data-save>${opts.edit ? 'Save (every copy follows)' : 'Create and place'}</button></div></aside>
    </div></div>`;
  ed.shell.root.appendChild(m);
  const list = m.querySelector<HTMLUListElement>('nav ul')!;
  const form = m.querySelector<HTMLElement>('.form')!;
  const img = m.querySelector<HTMLImageElement>('aside img')!;
  const nameIn = m.querySelector<HTMLInputElement>('[data-name]')!;
  const note = m.querySelector<HTMLElement>('.note')!;
  const find = m.querySelector<HTMLInputElement>('nav input')!;

  const drawList = () => {
    const q = find.value.trim().toLowerCase();
    let cat = '';
    list.innerHTML = fams
      .filter((f) => !q || f.name.toLowerCase().includes(q) || (f.tags ?? []).some((t) => t.includes(q)) || (CATEGORY_NAMES[f.category] ?? '').toLowerCase().includes(q))
      .map((f) => {
        const head = f.category !== cat ? `<li class="cat">${esc(CATEGORY_NAMES[f.category] ?? f.category)}</li>` : '';
        cat = f.category;
        return `${head}<li><button data-fam="${f.id}" aria-pressed="${f.id === fam.id}">${esc(f.name)}</button></li>`;
      })
      .join('');
  };
  let pending = 0;
  const preview = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      thumbs ??= createThumbnailer(ed.view.renderer, ed.view.ctx, { project: ed.project, width: 320, height: 260 });
      const key = `creator:${fam.id}`;
      void thumbs.get(key, resolveParams(fam, params), fam).then((url) => (img.src = url)).catch(() => (note.textContent = 'No picture for these values.'));
    });
  };
  const drawForm = () => {
    const groups = new Map<string, ParamDef[]>();
    for (const d of fam.params) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
    form.innerHTML = `<p class="fam">${esc(CATEGORY_NAMES[fam.category] ?? fam.category)} · ${esc(fam.name)} · ${fam.host === 'face' ? 'on a wall' : fam.host === 'roof' ? 'on a roof' : fam.host === 'path' ? 'along a path' : 'free'}</p>` +
      [...groups.entries()].map(([g, ds]) => `<fieldset><legend>${GROUPS[g as ParamDef['group']] ?? g}</legend>${ds.map((d) => `<label title="${esc(d.label)}${d.scope === 'instance' ? ' (each copy can change it)' : ''}"><span>${esc(d.label)}</span>${field(d, params[d.key])}</label>`).join('')}</fieldset>`).join('');
    nameIn.value = name;
    note.textContent = '';
    preview();
  };
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fam]');
    if (!b) return;
    const f = familyOf(b.dataset.fam!);
    if (!f) return;
    const auto = name === `My ${fam.name.toLowerCase()}`;
    fam = f;
    params = resolveParams(f, {});
    if (auto) name = `My ${f.name.toLowerCase()}`;
    drawList();
    drawForm();
  });
  find.addEventListener('input', drawList);
  form.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const k = el.dataset.cp;
    if (!k) return;
    const d = fam.params.find((x) => x.key === k)!;
    if (d.kind === 'bool') params[k] = (el as HTMLInputElement).checked;
    else if (d.kind === 'enum' || d.kind === 'color' || d.kind === 'finish' || d.kind === 'text') params[k] = el.value;
    else if (el.value.trim().startsWith('=')) {
      // A formula: it must read with the other parameters' values to be kept.
      const vars: Record<string, number> = {};
      for (const [pk, pv] of Object.entries(resolveParams(fam, params))) if (typeof pv === 'number') vars[pk] = pv;
      if (evalExpr(el.value.trim().slice(1), vars) === null) return void (note.textContent = `“${el.value}” does not read: use the parameter keys (${fam.params.filter((q) => q.kind === 'length').map((q) => q.key).slice(0, 4).join(', ')}…).`);
      params[k] = el.value.trim();
      note.textContent = '';
    } else {
      const v = evalExpr(el.value);
      if (v === null) return;
      params[k] = Math.max(d.min ?? -Infinity, Math.min(d.max ?? Infinity, d.kind === 'count' ? Math.round(v) : v));
    }
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
    const nm = (name.trim() || fam.name).slice(0, 60);
    // Only what differs from the family defaults is stored (the type keeps following family updates).
    const def = resolveParams(fam, {});
    const own: Params = {};
    for (const [k, v] of Object.entries(params)) if (v !== def[k]) own[k] = v;
    const p = ed.store.project;
    if (opts.edit && p.types.some((t) => t.id === opts.edit!.id)) {
      const t = p.types.find((x) => x.id === opts.edit!.id)!;
      t.name = nm;
      t.params = own;
      ed.store.commit(null, `${nm} saved: every copy follows.`);
      ed.toast(`${nm} saved: every copy follows.`);
      close();
      return;
    }
    const t: ComponentType = { id: uid(), family: fam.id, name: nm, params: own, user: true };
    p.types.push(t);
    ed.store.commit([], `${nm} created.`);
    close();
    ed.startPlacing(t.id);
    ed.toast(`${nm} created: ${fam.host === 'face' ? 'click a wall' : 'click where it goes'} (it is also in the library).`);
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
  drawList();
  drawForm();
  (opts.edit ? nameIn : find).focus();
}
