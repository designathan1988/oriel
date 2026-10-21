// Command search (Ctrl+K), like Shapr3D's and the VS Code/Figma palette:
// any tool, action, block, component or inspector section by name.
import { openCreator } from './creator';
import type { Editor3, Tool } from '../editor/editor';
import { BLOCKS } from '../model/blocks';
import { BUILTIN_TYPES, family } from '../families/index';
import { CATEGORY_NAMES } from '../families/family';
import { icon } from './icons';
import { actionsFor, transformActions } from './actions';

interface Cmd {
  label: string;
  group: string;
  ic: string;
  key?: string;
  run(): void;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function mountPalette(ed: Editor3): void {
  const root = ed.shell.root;
  const top = (cmd: string) => (ed.topCommand?.(cmd) ? undefined : ed.command(cmd));
  /** Opens the inspector at the requested section (tools with fields). */
  const section = (title: string) => () => {
    ed.shell.aside.classList.remove('min');
    ed.shell.tabs.querySelector<HTMLButtonElement>('[data-tab="props"]')?.click();
    const h = [...ed.shell.side.querySelectorAll<HTMLElement>('.f3-sec>h3')].find((x) => (x.textContent ?? '').trim().startsWith(title));
    if (!h) return ed.toast(`Select a volume to use "${title}".`);
    const sec = h.parentElement!;
    if (sec.classList.contains('closed')) h.click();
    sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  /** Runs a contextual-bar operation (same command, same last-operation panel). */
  const op = (id: string, label: string) => () => {
    const a = actionsFor(ed).find((x) => x.id === id);
    if (a) a.run();
    else ed.toast(`Enter a building and select a volume to use "${label}".`);
  };
  const commands = (): Cmd[] => {
    const tool = (t: Tool, label: string, ic: string, key: string): Cmd => ({ label, group: 'Tool', ic, key, run: () => ed.setTool(t) });
    // What the contextual bar offers for the current selection comes from the same registry (one function,
    // one name): Courtyard, Podium, Round, Floor ±, Move… are found here exactly as on the bar and in "More".
    const fromBar: Cmd[] = [...transformActions(ed), ...actionsFor(ed)].map((a) => ({ label: a.label, group: a.group, ic: a.icon, run: () => a.run() }));
    const mode = (m: 'vertex' | 'edge' | 'face', label: string, ic: string, key: string): Cmd => ({ label, group: 'Select', ic, key, run: () => ed.setElemMode(m) });
    const list: Cmd[] = [
      tool('select', 'Select and move', 'cursor', 'V'),
      tool('move', 'Move', 'move', 'M'),
      tool('rotate', 'Rotate', 'rotate', 'Q'),
      tool('scale', 'Scale and size', 'scale', 'S'),
      tool('push', 'Push / pull face', 'push', 'P'),
      tool('extrude', 'Extrude face (tool)', 'extrude', 'E'),
      tool('rect', 'Draw rectangle', 'rect', 'R'),
      tool('circle', 'Draw circle', 'circle', 'C'),
      tool('polygon', 'Draw polygon', 'polygon', 'L'),
      tool('spline', 'Draw spline (smooth outline through the points)', 'path', 'Shift+P'),
      tool('arc', 'Draw arc (chord ends, then a point of the arc)', 'arc', 'Shift+C'),
      tool('paint', 'Paint', 'paint', 'B'),
      tool('tape', 'Tape and dimensions', 'tape', 'T'),
      tool('cut', 'Cut a face or a volume', 'knife', 'U'),
      { label: 'Library', group: 'Tool', ic: 'catalog', key: 'K', run: () => ed.toggleLibrary(true) },
      tool('opening', 'Opening on a wall (window, door, balcony, annex, niche)', 'opening', 'O'),
      tool('iwall', 'Interior walls (Shift+click: a door)', 'draw', 'I'),
      tool('stair', 'Stair (foot, end, then the height)', 'floorUp', 'Shift+I'),
      tool('lot', 'Lot (drag a rectangle on the ground)', 'lot', 'Shift+L'),
      tool('street', 'Street (click its points, Enter ends)', 'street', 'Shift+S'),
      { label: 'Walk inside (first person)', group: 'View', ic: 'enter', run: () => ed.startWalk() },
      { label: 'Stair to the floor above', group: 'Interior', ic: 'floorUp', run: () => ed.stairUp() },
      { label: 'Neighbourhood from OpenStreetMap (buildings within 200 m of the place)', group: 'Site', ic: 'home', run: () => void ed.importOsm(200) },
      { label: 'Structural grid (columns every 6 m)', group: 'Interior', ic: 'grid', run: () => ed.columnGrid(6) },
      { label: 'Copy the interior walls of this floor to the floors above', group: 'Interior', ic: 'floors', run: () => ed.replicateFloor() },
      { label: 'New component (window, door, balcony, stair, tree, furniture…)', group: 'Library', ic: 'add', run: () => openCreator(ed) },
      { label: 'Preferences (theme, navigation)', group: 'View', ic: 'props', run: () => ed.prefsRequested?.() },
      ...(['model', 'components', 'materials', 'interior', 'present'] as const).map((w) => ({ label: `Workspace: ${w[0]!.toUpperCase()}${w.slice(1)}`, group: 'View', ic: 'layers', key: 'Alt PgUp/PgDn', run: () => ed.workspaceRequested?.(w) })),
      { label: 'Parallel / perspective view', group: 'View', ic: 'grid', key: 'Numpad 5', run: () => ed.view.setParallel(!ed.view.parallel) },
      { label: 'Undo', group: 'Edit', ic: 'undo', key: 'Ctrl Z', run: () => ed.command('undo') },
      { label: 'Redo', group: 'Edit', ic: 'redo', key: 'Ctrl Y', run: () => ed.command('redo') },
      { label: 'Duplicate selection', group: 'Edit', ic: 'copy', key: 'Ctrl D', run: () => ed.duplicate() },
      { label: 'Delete selection', group: 'Edit', ic: 'trash', key: 'Del', run: () => ed.remove() },
      { label: 'Mirror volume', group: 'Edit', ic: 'mirror', run: () => ed.command('mirror') },
      { label: 'Frame', group: 'View', ic: 'focus', key: 'F', run: () => ed.frameSelection() },
      { label: 'Select all', group: 'Select', ic: 'catalog', key: 'Ctrl A', run: () => ed.selectAll() },
      mode('vertex', 'Vertex mode', 'modeVertex', '1'),
      mode('edge', 'Edge mode', 'modeEdge', '2'),
      mode('face', 'Face mode', 'modeFace', '3'),
      { label: 'Interior view', group: 'View', ic: 'cutaway', run: () => ed.shell.viewbar.querySelector<HTMLButtonElement>('[aria-label="Interior view"]')?.click() },
      { label: 'Invert selection', group: 'Select', ic: 'swap', key: 'Ctrl I', run: () => ed.selectAll(true) },
      { label: 'Select similar', group: 'Select', ic: 'template', key: 'Shift G', run: () => ed.selectSimilar() },
      { label: 'Save selection set', group: 'Select', ic: 'bookmark', run: () => ed.saveSelectionSet() },
      { label: 'Hide selection', group: 'View', ic: 'eyeoff', key: 'H', run: () => ed.hideSelected() },
      { label: 'Isolate selection', group: 'View', ic: 'focus', key: 'Shift H', run: () => ed.isolateSelection() },
      { label: 'Show all', group: 'View', ic: 'eye', key: 'Alt H', run: () => ed.showAll() },
      { label: 'Snap on/off', group: 'View', ic: 'magnet', key: 'G', run: () => ed.toggleSnap() },
      { label: 'Extrude face', group: 'Model', ic: 'extrude', run: section('Selected face') },
      { label: 'Inset face / top', group: 'Model', ic: 'inset', run: section('Selected face') },
      { label: 'Outline offset', group: 'Model', ic: 'offset', run: op('offset', 'Outline offset') },
      { label: 'Split volume at height', group: 'Model', ic: 'split', run: op('split', 'Split volume at height') },
      { label: 'Edge bevel', group: 'Model', ic: 'bevel', run: op('bevel', 'Edge bevel') },
      { label: 'Bands, cornice and plinth band', group: 'Model', ic: 'cornice', run: section('Bands and cornice') },
      { label: 'Roof', group: 'Model', ic: 'gable', run: section('Roof') },
      { label: 'Facade rules', group: 'Model', ic: 'window', run: section('Facade') },
      { label: 'New project', group: 'Project', ic: 'folder', run: () => top('new') },
      { label: 'Open project', group: 'Project', ic: 'open', run: () => top('open') },
      { label: 'Save project', group: 'Project', ic: 'save', key: 'Ctrl S', run: () => top('save') },
      { label: 'Export', group: 'Project', ic: 'export', run: () => top('export') },
      { label: 'Templates', group: 'Project', ic: 'template', run: () => top('templates') },
      { label: 'Versions (save, open earlier ones)', group: 'Project', ic: 'layers', run: () => top('versions') },
      { label: 'Shortcuts', group: 'Help', ic: 'help', key: '?', run: () => top('help') },
    ];
    // The bar's entries first; a hand-written entry with the same name (offset, split, bevel…) only stays
    // when the bar does not offer it now (it then says what to select).
    const have = new Set(fromBar.map((c) => norm(c.label)));
    list.splice(0, list.length, ...fromBar, ...list.filter((c) => !have.has(norm(c.label))));
    for (const b of BLOCKS) list.push({ label: b.name, group: 'Block', ic: b.icon, run: () => ed.startBlock(b.id) });
    for (const st of ed.project.selectionSets ?? []) list.push({ label: st.name, group: 'Selection set', ic: 'bookmark', run: () => ed.recallSelectionSet(st.id) });
    for (const t of [...BUILTIN_TYPES, ...ed.project.types.filter((x) => x.user)]) {
      const f = family(t.family);
      if (f) list.push({ label: t.name, group: CATEGORY_NAMES[f.category], ic: 'catalog', run: () => ed.startPlacing(t.id) });
    }
    return list;
  };

  let modal: HTMLElement | null = null;
  const close = () => {
    modal?.remove();
    modal = null;
    ed.view.renderer.domElement.focus();
  };
  ed.paletteRequested = () => {
    if (modal) return close();
    const all = commands();
    modal = document.createElement('div');
    modal.className = 'f3-modal';
    modal.innerHTML = `<div class="f3-pal" role="dialog" aria-label="Search commands"><input placeholder="Search tool, command, block or component…" aria-label="Search"><ul role="listbox"></ul></div>`;
    root.appendChild(modal);
    const input = modal.querySelector('input')!;
    const ul = modal.querySelector('ul')!;
    let shown: Cmd[] = [];
    let cur = 0;
    const draw = () => {
      const q = norm(input.value.trim());
      const words = q.split(/\s+/).filter(Boolean);
      shown = all.filter((c) => words.every((w) => norm(`${c.label} ${c.group}`).includes(w))).slice(0, 60);
      cur = Math.min(cur, Math.max(0, shown.length - 1));
      ul.innerHTML = shown.length
        ? shown.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === cur}">${icon(c.ic)}<span>${c.label}</span><em>${c.group}</em>${c.key ? `<small><kbd>${c.key}</kbd></small>` : ''}</li>`).join('')
        : '<li aria-disabled="true"><span style="color:var(--faint)">Nothing found.</span></li>';
      ul.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    };
    const run = (i: number) => {
      const c = shown[i];
      if (!c) return;
      close();
      c.run();
    };
    input.addEventListener('input', () => {
      cur = 0;
      draw();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') cur = Math.min(shown.length - 1, cur + 1);
      else if (e.key === 'ArrowUp') cur = Math.max(0, cur - 1);
      else if (e.key === 'Enter') return run(cur);
      else if (e.key === 'Escape') return close();
      else return;
      e.preventDefault();
      draw();
    });
    ul.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
      if (li) run(Number(li.dataset.i));
    });
    modal.addEventListener('pointerdown', (e) => {
      if (e.target === modal) close();
    });
    draw();
    input.focus();
  };

  ed.helpRequested = () => {
    const m = document.createElement('div');
    m.className = 'f3-modal';
    const k = (keys: string, what: string) => `<span>${keys.split(' ').map((x) => `<kbd>${x}</kbd>`).join(' ')}</span><span>${what}</span>`;
    m.innerHTML = `<div class="f3-help" role="dialog" aria-label="Shortcuts"><h2>Shortcuts</h2><div class="cols">
      <div class="f3-keys" style="margin:0"><h3>Tools</h3>${k('V', 'Select (everything on the selection)')}${k('M', 'Move')}${k('Q', 'Rotate')}${k('S', 'Scale and size')}${k('P', 'Push face')}${k('E', 'Extrude face')}${k('R', 'Rectangle')}${k('C', 'Circle')}${k('L', 'Polygon')}${k('X', 'Add / subtract')}${k('K', 'Library')}${k('B', 'Paint (Alt: eyedropper)')}${k('T', 'Tape and dimensions')}</div>
      <div class="f3-keys" style="margin:0"><h3>Commands</h3>${k('Ctrl K', 'Search commands')}${k('Ctrl Z', 'Undo')}${k('Ctrl Y', 'Redo')}${k('Ctrl D', 'Duplicate')}${k('Del', 'Delete')}${k('F', 'Frame')}${k('G', 'Snap')}${k('Esc', 'Leave / cancel')}${k('10x8', 'Measure (type and Enter)')}${k('5x 5/', 'Repeat / divide copies')}</div>
      <div class="f3-keys" style="margin:0"><h3>Selection</h3>${k('Ctrl click', 'Add to the selection')}${k('Shift click', 'Toggle (add or remove)')}${k('Ctrl Shift click', 'Remove from the selection')}${k('Alt click', 'Row span up to here')}${k('Drag →', 'Box: only what is fully inside')}${k('Drag ←', 'Box: everything it touches')}${k('Ctrl A', 'Select all (in the context)')}${k('Ctrl I', 'Invert the selection')}${k('Shift G', 'Select similar')}${k('H', 'Hide the selection')}${k('Shift H', 'Isolate (hide the rest)')}${k('Alt H', 'Show all')}${k('Ctrl drag', 'Copy what is selected')}${k('← → ↑ ↓', 'Walk the selection on the facade')}${k('Right button', 'Menu with the object actions')}</div>
    </div><p class="f3-empty" style="padding:12px 0 0">Middle button pans, Shift + middle orbits around the point under the cursor, the wheel zooms on it. Right button: a click opens the menu, dragging orbits. Double click enters a building.</p></div>`;
    root.appendChild(m);
    const close = () => m.remove();
    m.addEventListener('pointerdown', (e) => e.target === m && close());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        close();
        window.removeEventListener('keydown', onKey, true);
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
  };
}
