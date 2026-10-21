// Saved views (SketchUp's scenes, Revit's saved 3D views, ArchiCAD's view map): a button on the view bar
// opens the list. "Save this view" keeps the camera, the time of day, the interior view, the floor cut,
// the exploded floors and which layers are shown; a click on a scene flies there and puts all of that
// back. The scenes are part of the project (Project3.scenes), each one renamed in place or updated.
import type { Editor3 } from '../editor/editor';
import type { Scene } from '../model/schema';
import { viewOf } from '../model/layers';
import { uid } from '../model/defaults';
import { icon } from './icons';
import { tr } from './i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const KEYS = ['time', 'hiddenBody', 'cutLevel', 'onlyLevel', 'explode', 'style'] as const;

export function mountScenes(ed: Editor3): void {
  const bar = ed.shell.viewbar;
  const btn = document.createElement('button');
  btn.className = 'f3-tb';
  btn.title = 'Scenes';
  btn.setAttribute('aria-label', 'Scenes');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = icon('bookmark');
  bar.querySelector('[data-interior]')?.after(btn) ?? bar.appendChild(btn);
  const pop = document.createElement('div');
  pop.className = 'f3-interior f3-island';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Scenes');
  pop.hidden = true;
  bar.parentElement!.appendChild(pop);

  /** The view as it is now, as a scene. */
  const capture = (name: string, id = uid()): Scene => {
    const v = ed.project.view;
    const view: Scene['view'] = {};
    for (const k of KEYS) if (v?.[k] !== undefined) (view as Record<string, unknown>)[k] = structuredClone(v[k]);
    const layers = ed.project.layers?.length ? Object.fromEntries(ed.project.layers.map((l) => [l.id, l.visible])) : undefined;
    return { id, name, camera: ed.view.cameraState(), view, ...(layers ? { layers } : {}) };
  };

  const go = (sc: Scene) => {
    const p = ed.store.project;
    const v = viewOf(p);
    for (const k of KEYS) {
      if (sc.view[k] === undefined) delete v[k];
      else (v as unknown as Record<string, unknown>)[k] = structuredClone(sc.view[k]);
    }
    if (sc.layers) for (const l of p.layers ?? []) if (l.id in sc.layers) l.visible = sc.layers[l.id]!;
    ed.store.commit(null, '', false);
    ed.view.flyTo(sc.camera);
    ed.toast(`${sc.name}.`);
  };

  let last = '';
  let editing: string | null = null;
  const render = () => {
    btn.setAttribute('aria-pressed', String(!pop.hidden));
    if (pop.hidden) return;
    const list = ed.project.scenes ?? [];
    const key = JSON.stringify([list.map((s) => [s.id, s.name]), editing]);
    if (key === last) return;
    last = key;
    pop.innerHTML = `<div class="hd">Scenes</div>
      <div class="f3-interior-list">${
        list.length
          ? list
              .map((s) =>
                editing === s.id
                  ? `<div class="f3-lrow"><span class="kind">${icon('bookmark')}</span><input class="nm" data-rename="${s.id}" value="${esc(s.name)}" maxlength="60" aria-label="Scene name" data-i18n-skip></div>`
                  : `<div class="f3-lrow"><span class="kind">${icon('bookmark')}</span><button class="nm f3-link" data-go="${s.id}" title="Go to this scene (double click renames)" data-i18n-skip>${esc(s.name)}</button><button class="ic" data-update="${s.id}" title="Save the current view in it">${icon('restore')}</button><button class="ic" data-del="${s.id}" title="Delete">${icon('trash')}</button></div>`,
              )
              .join('')
          : `<p class="f3-empty" style="padding:4px 4px 0">No scene yet.</p>`
      }</div>
      <div class="f3-btns n2" style="margin-top:8px"><button class="f3-btn" data-save>${icon('add')}<span>Save this view</span></button></div>`;
    const rn = pop.querySelector<HTMLInputElement>('[data-rename]');
    if (rn) {
      rn.focus();
      rn.select();
      const done = (keep: boolean) => {
        const id = editing;
        editing = null;
        const name = rn.value.trim().slice(0, 60);
        if (keep && id && name) ed.changeSite((p) => void (p.scenes!.find((s) => s.id === id)!.name = name), '');
        last = '';
        render();
      };
      rn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
        e.stopPropagation();
      });
      rn.addEventListener('blur', () => editing && done(true));
    }
  };

  pop.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const goB = t.closest<HTMLElement>('[data-go]');
    if (goB) {
      const sc = ed.project.scenes?.find((s) => s.id === goB.dataset.go);
      if (sc) go(sc);
      return;
    }
    const up = t.closest<HTMLElement>('[data-update]');
    if (up) {
      const id = up.dataset.update!;
      ed.changeSite((p) => {
        const i = p.scenes!.findIndex((s) => s.id === id);
        if (i >= 0) p.scenes![i] = capture(p.scenes![i]!.name, id);
      }, 'Scene updated.');
      return;
    }
    const del = t.closest<HTMLElement>('[data-del]');
    if (del) {
      ed.changeSite((p) => {
        p.scenes = p.scenes!.filter((s) => s.id !== del.dataset.del);
        if (!p.scenes.length) delete p.scenes;
      }, 'Scene deleted.');
      return;
    }
    if (t.closest('[data-save]')) {
      const n = (ed.project.scenes?.length ?? 0) + 1;
      if (n > 100) return ed.toast('At most 100 scenes.');
      const sc = capture(tr(`Scene ${n}`));
      ed.changeSite((p) => void (p.scenes ??= []).push(sc), `${sc.name} saved.`);
    }
  });
  pop.addEventListener('dblclick', (e) => {
    const goB = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!goB) return;
    editing = goB.dataset.go!;
    last = '';
    render();
  });

  const place = () => {
    const r = bar.getBoundingClientRect(),
      pr = bar.parentElement!.getBoundingClientRect(),
      br = btn.getBoundingClientRect();
    pop.style.right = `${pr.right - r.left + 6}px`;
    pop.style.top = `${br.top - pr.top}px`;
  };
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    last = '';
    render();
    if (!pop.hidden) place();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      pop.hidden = true;
      render();
    }
  });
  ed.onChange(render);
}
