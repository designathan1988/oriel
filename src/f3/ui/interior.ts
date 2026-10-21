// Interior view (Revit Visibility/Graphics model categories and section box): a button on
// the View island opens a panel that hides the exterior walls, interior walls, roofs, floors
// or ceilings of every building — the buildings become hollow, with slabs per floor — and cuts
// them by floor. Hiding is only a view state: saving and exporting take everything.
import type { Editor3 } from '../editor/editor';
import { BODY_CATEGORIES, bandedView, bodyHidden, explodeGap, interiorView, viewOf, type BodyCategory } from '../model/layers';
import { icon } from './icons';
import { prow } from './kit';

/** Row icon of each body category (panel standard). */
const BODY_ICON: Record<BodyCategory, string> = { walls: 'wall', innerWalls: 'cut', roofs: 'gable', floors: 'floors', ceilings: 'top' };

export function mountInteriorView(ed: Editor3): void {
  const bar = ed.shell.viewbar;
  const btn = document.createElement('button');
  btn.className = 'f3-tb';
  btn.title = 'Interior view: hide walls, roofs, floors or ceilings; cut by floor';
  btn.setAttribute('aria-label', 'Interior view');
  btn.dataset.interior = '';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = icon('cutaway');
  bar.appendChild(btn);
  const pop = document.createElement('div');
  pop.className = 'f3-interior f3-island';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Interior view');
  pop.hidden = true;
  bar.parentElement!.appendChild(pop);

  const commit = (msg: string) => {
    ed.store.commit(null, msg, false);
    if (ed.store.changed) ed.toast(msg);
  };
  const setHidden = (list: BodyCategory[], msg: string) => {
    const v = viewOf(ed.store.project);
    if (list.length) v.hiddenBody = list;
    else delete v.hiddenBody;
    commit(msg);
  };
  const levelsMax = () => Math.max(1, ...ed.project.buildings.map((b) => b.levels.length));

  let last = '';
  const render = () => {
    const p = ed.project;
    btn.setAttribute('aria-pressed', String(interiorView(p)));
    if (pop.hidden) return;
    const key = JSON.stringify([p.view?.hiddenBody, p.view?.cutLevel, p.view?.onlyLevel, p.view?.explode, levelsMax()]);
    if (key === last) return;
    last = key;
    const rows = BODY_CATEGORIES.map(([c, name]) => {
      const on = !bodyHidden(p, c);
      return `<div class="f3-lrow"><span class="kind">${icon(BODY_ICON[c])}</span><span class="nm">${name}</span><button class="ic" data-body="${c}" aria-pressed="${on}" title="${on ? 'Hide' : 'Show'}">${icon(on ? 'eye' : 'eyeoff')}</button></div>`;
    }).join('');
    const cut = p.view?.cutLevel;
    const gap = explodeGap(p);
    pop.innerHTML = `<div class="hd">Interior view</div>
      <div class="f3-btns n3"><button class="f3-btn" data-preset="cutaway" title="Cuts every wall 1.2 m above the floor shown, like a plan: the rooms, doors and windows in view">${icon('cutaway')}<span>Cutaway</span></button><button class="f3-btn" data-preset="explode" title="Every floor apart, each cut 1.2 m above its floor">${icon('floorUp')}<span>Exploded</span></button><button class="f3-btn" data-preset="all" title="Shows every part and the whole building">${icon('eye')}<span>Show all</span></button></div>
      <div class="f3-interior-list">${rows}</div>
      <div class="f3-interior-ctl">
      ${prow('Apart', 'floorUp', [`<label class="f3-cell rng" title="${p.view?.onlyLevel ? 'One floor is shown: there is nothing to move apart (untick Only this floor)' : 'Floors apart: each floor cut 1.2 m above its floor and lifted by this gap (0 = together)'}"><input type="range" data-explode min="0" max="10" step="0.5" value="${gap}" aria-label="Gap between floors"${p.view?.onlyLevel ? ' disabled' : ''}><output>${gap} m</output></label>`], { wide: true, title: 'Floors apart' })}
      ${prow('Show', 'level', [`<label class="f3-check" title="${cut === undefined ? 'Choose a floor in the floor switcher first' : 'Only the chosen floor (the others hidden)'}"><input type="checkbox" data-only ${p.view?.onlyLevel ? 'checked' : ''} ${cut === undefined ? 'disabled' : ''}><span>Only this floor</span></label>`], { wide: true })}
      </div>`;
    pop.querySelectorAll<HTMLButtonElement>('[data-body]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = b.dataset.body as BodyCategory;
        const cur = new Set((ed.project.view?.hiddenBody ?? []) as BodyCategory[]);
        const name = BODY_CATEGORIES.find((x) => x[0] === c)![1];
        if (cur.has(c)) cur.delete(c);
        else cur.add(c);
        setHidden([...cur], `${name}: ${cur.has(c) ? 'hidden' : 'visible'}.`);
      }),
    );
    // Presets replace each other: one look at a time.
    pop.querySelector('[data-preset="cutaway"]')!.addEventListener('click', () => {
      delete viewOf(ed.store.project).explode;
      // A real cutaway (ArchiCAD 3D cutaway, Revit section box): every wall and slab cut 1.2 m above the
      // floor shown, doors and windows in their walls, nothing above. Hiding the exterior walls instead
      // left the interior walls floating on the grid.
      const v = viewOf(ed.store.project);
      if (v.cutLevel === undefined) v.cutLevel = 0;
      setHidden([], 'Cutaway: the floor shown is cut 1.2 m above it.');
    });
    pop.querySelector('[data-preset="explode"]')!.addEventListener('click', () => {
      // Walls stay: cut 1.2 m above each floor they show every room like a plan. Every floor: a cut
      // or "only this floor" left from before would show a single floor that never moves apart.
      const v = viewOf(ed.store.project);
      v.explode = 4;
      delete v.cutLevel;
      delete v.onlyLevel;
      setHidden([], 'Exploded floors: each floor apart, cut 1.2 m above its floor.');
    });
    pop.querySelector('[data-preset="all"]')!.addEventListener('click', () => {
      const v = viewOf(ed.store.project);
      delete v.cutLevel;
      delete v.onlyLevel;
      delete v.explode;
      setHidden([], 'Whole buildings visible.');
    });
    // Dragging the gap only moves the floors already cut (no evaluation, no new mesh, even
    // through 0); releasing records it once (at 0 the buildings come back whole).
    const range = pop.querySelector<HTMLInputElement>('[data-explode]')!;
    const out = range.nextElementSibling as HTMLOutputElement;
    range.addEventListener('input', () => {
      const v = Number(range.value);
      out.textContent = `${v} m`;
      const view = viewOf(ed.store.project);
      if (bandedView(ed.project)) {
        if (v > 0) view.explode = v;
        ed.view.moveFloors(v);
      } else if (v > 0) {
        // Floors still together: they are cut once, then they only move.
        view.explode = v;
        ed.view.sync(ed.project, ed.store.revision);
      }
    });
    range.addEventListener('change', () => {
      const v = Number(range.value);
      const view = viewOf(ed.store.project);
      if (v > 0) view.explode = v;
      else delete view.explode;
      commit(v > 0 ? `Floors ${v} m apart.` : 'Floors together.');
    });
    pop.querySelector<HTMLInputElement>('[data-only]')!.addEventListener('change', (e) => {
      const view = viewOf(ed.store.project);
      if ((e.target as HTMLInputElement).checked) view.onlyLevel = true;
      else delete view.onlyLevel;
      commit(view.onlyLevel ? 'Only the chosen floor.' : 'Every floor up to the chosen one.');
    });
  };
  const place = () => {
    const r = bar.getBoundingClientRect(),
      pr = bar.parentElement!.getBoundingClientRect(),
      br = btn.getBoundingClientRect();
    // Under its button (in the top bar), or beside the view bar when the button is there.
    const inTop = br.bottom <= pr.top + 2;
    pop.style.right = `${inTop ? Math.max(6, pr.right - br.right) : pr.right - r.left + 6}px`;
    pop.style.top = `${inTop ? 6 : br.top - pr.top}px`;
  };
  btn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
    last = '';
    render();
    if (!pop.hidden) place();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node) && !btn.contains(e.target as Node)) {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  });
  ed.onChange(render);
  render();
}
