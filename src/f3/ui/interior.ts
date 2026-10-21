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
  btn.title = 'Interior view';
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
    if (ed.store.changed && msg) ed.toast(msg);
  };
  const setHidden = (list: BodyCategory[], msg: string) => {
    const v = viewOf(ed.store.project);
    if (list.length) v.hiddenBody = list;
    else delete v.hiddenBody;
    commit(msg);
  };
  /** The buildings' extent on the ground (world x and z), for the section's slider, with 2 m of margin. */
  const extent = (): { lo: [number, number]; hi: [number, number] } => {
    const lo: [number, number] = [Infinity, Infinity],
      hi: [number, number] = [-Infinity, -Infinity];
    for (const b of ed.project.buildings) {
      const bb = ed.boundsOf(b);
      if (!bb) continue;
      const a = (b.rotation * Math.PI) / 180;
      for (const x of [bb.min[0], bb.max[0]])
        for (const z of [bb.min[2], bb.max[2]]) {
          const wx = b.position[0] + x * Math.cos(a) + z * Math.sin(a),
            wz = b.position[1] - x * Math.sin(a) + z * Math.cos(a);
          lo[0] = Math.min(lo[0], wx);
          lo[1] = Math.min(lo[1], wz);
          hi[0] = Math.max(hi[0], wx);
          hi[1] = Math.max(hi[1], wz);
        }
    }
    if (!Number.isFinite(lo[0])) return { lo: [-20, -20], hi: [20, 20] };
    return { lo: [Math.floor(lo[0] - 2), Math.floor(lo[1] - 2)], hi: [Math.ceil(hi[0] + 2), Math.ceil(hi[1] + 2)] };
  };
  const levelsMax = () => Math.max(1, ...ed.project.buildings.map((b) => b.levels.length));

  let last = '';
  const render = () => {
    const p = ed.project;
    btn.setAttribute('aria-pressed', String(interiorView(p)));
    if (pop.hidden) return;
    const key = JSON.stringify([p.view?.hiddenBody, p.view?.cutLevel, p.view?.onlyLevel, p.view?.explode, p.view?.style, p.view?.section?.axis, p.view?.section?.flip, levelsMax()]);
    if (key === last) return;
    last = key;
    const rows = BODY_CATEGORIES.map(([c, name]) => {
      const on = !bodyHidden(p, c);
      return `<div class="f3-lrow"><span class="kind">${icon(BODY_ICON[c])}</span><span class="nm">${name}</span><button class="ic" data-body="${c}" aria-pressed="${on}" title="${on ? 'Hide' : 'Show'}">${icon(on ? 'eye' : 'eyeoff')}</button></div>`;
    }).join('');
    const cut = p.view?.cutLevel;
    const gap = explodeGap(p);
    const sec = p.view?.section;
    const ext = extent();
    pop.innerHTML = `<div class="hd">Interior view</div>
      <div class="f3-btns n3"><button class="f3-btn" data-preset="cutaway" title="Cut 1.2 m above the floor shown">${icon('cutaway')}<span>Cutaway</span></button><button class="f3-btn" data-preset="explode" title="Floors apart, each cut">${icon('floorUp')}<span>Exploded</span></button><button class="f3-btn" data-preset="all" title="Whole buildings">${icon('eye')}<span>Show all</span></button></div>
      <div class="f3-interior-list">${rows}</div>
      <div class="f3-interior-ctl">
      ${prow('Style', 'palette', [`<div class="f3-seg" role="group" aria-label="View style">${([['', 'Realistic'], ['white', 'White'], ['xray', 'X-ray']] as const).map(([v, l]) => `<button data-style="${v}" aria-pressed="${(p.view?.style ?? '') === v}">${l}</button>`).join('')}</div>`], { wide: true })}
      ${prow('Section', 'section', [`<div class="f3-seg" role="group" aria-label="Live section">${([['', 'Off'], ['z', 'Front'], ['x', 'Side']] as const).map(([v, l]) => `<button data-sec="${v}" aria-pressed="${(sec?.axis ?? '') === v}">${l}</button>`).join('')}<button data-secflip aria-pressed="${!!sec?.flip}" title="Keep the other side"${sec ? '' : ' disabled'}>⇄</button></div>`], { wide: true })}
      ${sec ? prow('Position', 'distance', [`<label class="f3-cell rng" title="Where the section cuts"><input type="range" data-secat min="${ext.lo[sec.axis === 'x' ? 0 : 1]}" max="${ext.hi[sec.axis === 'x' ? 0 : 1]}" step="0.1" value="${sec.at}" aria-label="Section position"><output>${Math.round(sec.at * 10) / 10} m</output></label>`], { wide: true }) : ''}
      ${prow('Apart', 'floorUp', [`<label class="f3-cell rng" title="${p.view?.onlyLevel ? 'One floor shown: nothing to move apart' : 'Gap between floors (0 = together)'}"><input type="range" data-explode min="0" max="10" step="0.5" value="${gap}" aria-label="Gap between floors"${p.view?.onlyLevel ? ' disabled' : ''}><output>${gap} m</output></label>`], { wide: true, title: 'Floors apart' })}
      ${prow('Show', 'level', [`<label class="f3-check" title="${cut === undefined ? 'Choose a floor in the floor switcher first' : 'Hides the other floors'}"><input type="checkbox" data-only ${p.view?.onlyLevel ? 'checked' : ''} ${cut === undefined ? 'disabled' : ''}><span>Only this floor</span></label>`], { wide: true })}
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
    pop.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = viewOf(ed.store.project);
        if (b.dataset.style) v.style = b.dataset.style as 'white' | 'xray';
        else delete v.style;
        commit(b.dataset.style === 'white' ? 'White model.' : b.dataset.style === 'xray' ? 'X-ray.' : 'Realistic.');
      }),
    );
    pop.querySelectorAll<HTMLButtonElement>('[data-sec]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = viewOf(ed.store.project);
        const axis = b.dataset.sec as 'x' | 'z' | '';
        if (!axis) delete v.section;
        else {
          const i = axis === 'x' ? 0 : 1;
          const at = Math.round(((ext.lo[i]! + ext.hi[i]!) / 2) * 10) / 10;
          // The half toward the camera goes: the plane keeps the far side.
          const cam = ed.view.camera.position;
          v.section = { axis, at, ...((axis === 'x' ? cam.x : cam.z) > at ? { flip: true } : {}) };
        }
        commit(axis ? 'Live section: drag its position.' : 'Section off.');
      }),
    );
    pop.querySelector<HTMLButtonElement>('[data-secflip]')?.addEventListener('click', () => {
      const v = viewOf(ed.store.project);
      if (!v.section) return;
      v.section = { ...v.section, flip: !v.section.flip };
      commit('');
    });
    const at = pop.querySelector<HTMLInputElement>('[data-secat]');
    at?.addEventListener('input', () => {
      // Live while dragging (view state only), one step when let go.
      const v = viewOf(ed.store.project);
      if (!v.section) return;
      v.section = { ...v.section, at: Number(at.value) };
      at.nextElementSibling!.textContent = `${at.value} m`;
      ed.store.touch([], '');
    });
    at?.addEventListener('change', () => commit(''));
    // Presets replace each other: one look at a time.
    pop.querySelector('[data-preset="cutaway"]')!.addEventListener('click', () => {
      delete viewOf(ed.store.project).explode;
      // A real cutaway (ArchiCAD 3D cutaway, Revit section box): every wall and slab cut 1.2 m above the
      // floor shown, doors and windows in their walls, nothing above. Hiding the exterior walls instead
      // left the interior walls floating on the grid.
      const v = viewOf(ed.store.project);
      if (v.cutLevel === undefined) v.cutLevel = 0;
      setHidden([], 'Cutaway.');
    });
    pop.querySelector('[data-preset="explode"]')!.addEventListener('click', () => {
      // Walls stay: cut 1.2 m above each floor they show every room like a plan. Every floor: a cut
      // or "only this floor" left from before would show a single floor that never moves apart.
      const v = viewOf(ed.store.project);
      v.explode = 4;
      delete v.cutLevel;
      delete v.onlyLevel;
      setHidden([], 'Exploded floors.');
    });
    pop.querySelector('[data-preset="all"]')!.addEventListener('click', () => {
      const v = viewOf(ed.store.project);
      delete v.cutLevel;
      delete v.onlyLevel;
      delete v.explode;
      setHidden([], 'Whole buildings.');
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
