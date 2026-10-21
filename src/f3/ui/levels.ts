// The floor being worked on (ArchiCAD's floor switcher, Revit's level views, Chief Architect's Up/Down
// one floor): a control at the top of the view bar. A floor chosen there is cut 1.2 m above it with the
// floors below it shown (the plan cut), and the wall, door, window, room, slab, column, beam and stair
// tools work on it; "All floors" shows the whole buildings. Page Up / Page Down step through the floors.
// It is the view state the interior view panel also sets (project.view.cutLevel): one state, two places.
import type { Editor3 } from '../editor/editor';
import { viewOf } from '../model/layers';
import { icon } from './icons';

export function mountLevels(ed: Editor3): void {
  const bar = ed.shell.viewbar;
  const box = document.createElement('label');
  box.className = 'f3-ctl f3-levels';
  box.title = 'Floor worked on (Page Up / Page Down)';
  box.innerHTML = `${icon('level')}<select data-level aria-label="Floor worked on"></select>`;
  // Right under the 2D button, above the view cube.
  const plan = bar.querySelector('.plan2d');
  if (plan) plan.after(box);
  else bar.prepend(box);
  const sel = box.querySelector('select')!;
  const count = () => Math.max(1, ...ed.project.buildings.map((b) => b.levels.length));
  const name = (i: number) => (i === 0 ? 'Ground floor' : `Floor ${i}`);

  let last = '';
  const render = () => {
    const n = count();
    const cut = ed.project.view?.cutLevel;
    const key = `${n}|${cut ?? ''}`;
    if (key === last) return;
    last = key;
    sel.innerHTML = `<option value="">All floors</option>${Array.from({ length: n }, (_, i) => `<option value="${i}">${name(i)}</option>`).join('')}`;
    sel.value = cut === undefined ? '' : String(Math.min(cut, n - 1));
  };

  const set = (v: number | null) => {
    const view = viewOf(ed.store.project);
    if (v === null) {
      delete view.cutLevel;
      delete view.onlyLevel;
    } else view.cutLevel = Math.max(0, Math.min(count() - 1, v));
    ed.store.commit(null, '', false);
    ed.toast(v === null ? 'All floors.' : `${name(view.cutLevel!)}: cut 1.2 m above the floor.`);
  };

  sel.addEventListener('change', () => set(sel.value === '' ? null : Number(sel.value)));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    if (e.ctrlKey || e.altKey || e.metaKey || (e.target as HTMLElement).closest('input,select,textarea')) return;
    const cut = ed.project.view?.cutLevel;
    const n = count();
    // Up from "all floors" starts at the ground floor; past the top floor it shows them all again.
    let next: number | null;
    if (e.key === 'PageUp') next = cut === undefined ? 0 : cut + 1 >= n ? null : cut + 1;
    else next = cut === undefined ? n - 1 : cut - 1 < 0 ? null : cut - 1;
    set(next);
    e.preventDefault();
  });
  ed.onChange(render);
  render();
}
