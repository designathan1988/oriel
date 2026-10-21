// Selection actions, in a single list (docs/INTERFACE.md): the contextual bar
// next to the selection, the right-click menu and the search use the same list,
// so they never diverge. Each action says its group and what it does; the ones
// that take a value open the last operation panel with their parameters.
import type { Editor3 } from '../editor/editor';
import type { AlignOp } from '../model/align';
import { BUILTIN_TYPES, family } from '../families/index';
import { icon } from './icons';
import { closeOnOutside } from './kit';
import { explodeGap } from '../model/layers';

export interface Action {
  id: string;
  label: string;
  icon: string;
  group: string;
  title?: string;
  on?: boolean;
  danger?: boolean;
  run: (anchor?: HTMLElement) => void;
}

const ALIGN: [AlignOp, string, string][] = [
  ['left', 'Left', 'alignLeft'],
  ['centerX', 'Center X', 'alignCenterX'],
  ['right', 'Right', 'alignRight'],
  ['front', 'Front', 'alignFront'],
  ['centerZ', 'Center Z', 'alignCenterZ'],
  ['back', 'Back', 'alignBack'],
];

/** A "good" cut height: the floor boundary closest to the middle of the volume (relative to the base). */
function splitHeight(ed: Editor3): number {
  const b = ed.activeBuilding(),
    s = ed.activeSolid();
  if (!b || !s) return 3;
  const mid = s.base + s.height / 2;
  const cuts = b.levels.map((l) => l.elevation).filter((y) => y > s.base + 0.3 && y < s.base + s.height - 0.3);
  const y = cuts.length ? cuts.reduce((a, c) => (Math.abs(c - mid) < Math.abs(a - mid) ? c : a)) : mid;
  return Math.round((y - s.base) * 100) / 100;
}

/** Actions of the selection: those of what is selected, then the selection commands (under "More"). */
const N = (n: number | string | undefined) => Number(n ?? 0);

export function actionsFor(ed: Editor3): Action[] {
  const out = selectionActions(ed);
  if (!out.length) return out;
  const add = (id: string, label: string, ic: string, run: Action['run'], title: string) => out.push({ group: 'Selection', id, label, icon: ic, run, title });
  const elems = ed.sel.elems.length > 0 && !ed.sel.item;
  if (!elems && (ed.sel.solids.length || ed.context !== ed.activeBuilding()?.id)) add('similar', 'Select similar', 'template', () => ed.selectSimilar(), 'Same use (buildings) or same shape and height (volumes) · Shift+G');
  if (!elems) add('hide', 'Hide', 'eyeoff', () => ed.hideSelected(), 'Hides the selection · H (Alt+H shows everything)');
  if (!elems && !ed.sel.item) add('isolate', 'Isolate', 'focus', () => ed.isolateSelection(), 'Hides everything else · Shift+H');
  add('saveset', 'Save selection set', 'bookmark', () => ed.saveSelectionSet(), 'Saves the selection under a name (Structure tab)');
  return out;
}

function selectionActions(ed: Editor3): Action[] {
  const b = ed.activeBuilding();
  if (!b) return [];
  const out: Action[] = [];
  const add = (group: string, id: string, label: string, ic: string, run: Action['run'], extra: Partial<Action> = {}) => out.push({ group, id, label, icon: ic, run, ...extra });
  const inside = ed.context === b.id;
  const s = ed.activeSolid();
  const multiB = !inside && ed.sel.others.length > 0;
  const multiS = inside && ed.sel.solids.length > 1;

  if (!inside) {
    if (!multiB) add('Building', 'enter', 'Edit volumes', 'enter', () => ed.enter(b.id), { title: 'Enter the building (double click)' });
    add('Floors', 'lvup', 'Floor +', 'floorUp', () => ed.floorsDelta(1), { title: 'Floor + (what is on top moves up with it)' });
    add('Floors', 'lvdown', 'Floor −', 'floorDown', () => ed.floorsDelta(-1), { title: 'Floor −' });
    add('Edit', 'dup', 'Duplicate', 'copy', () => ed.duplicate(), { title: 'Duplicate · Ctrl+D' });
    add('Edit', 'rot90', 'Rotate 90°', 'rot90', () => ed.command('rot90'), { title: 'Rotate 90° around the center' });
  }
  if (multiB || multiS) {
    for (const [op, label, ic] of ALIGN) add('Align', op, label, ic, () => ed.align(op), { title: `Align ${label.toLowerCase()} (to the first selected)` });
    add('Distribute', 'distX', 'In X', 'distX', () => ed.align('distX'), { title: 'Equal spacing in X' });
    add('Distribute', 'distZ', 'In Z', 'distZ', () => ed.align('distZ'), { title: 'Equal spacing in Z' });
    if (multiS) {
      add('Height', 'base', 'Same base', 'alignFront', () => ed.align('base'));
      add('Height', 'top', 'Same top', 'alignBack', () => ed.align('top'));
      // Booleans between the chosen volumes (the first selected is the one acted on), and Separate.
      add('Combine', 'cjoin', 'Join', 'add', () => ed.combineSelected('add'), { title: 'Every selected volume adds: one solid' });
      if (ed.sel.solids.length === 2) add('Combine', 'bridge', 'Bridge', 'row', () => ed.bridgeSelected(), { title: 'A one-floor volume across the gap between the two' });
      add('Combine', 'csub', 'Subtract', 'subtract', () => ed.combineSelected('subtract'), { title: 'The other selected volumes carve the first one' });
      add('Combine', 'cint', 'Intersect', 'intersect', () => ed.combineSelected('intersect'), { title: 'Only the part common to the first one stays' });
      add('Combine', 'csep', 'Separate', 'detach', () => ed.separate(b.id, ed.sel.solids), { title: 'The selected volumes become a building of their own' });
      // Duplicate and mirror work on every selected volume, like with one (audit F13).
      add('Edit', 'dup', 'Duplicate', 'copy', () => ed.duplicate(), { title: 'Duplicate the selected volumes · Ctrl+D' });
      add('Edit', 'mirror', 'Mirror', 'mirror', () => ed.command('mirror'), { title: 'Mirror each selected volume' });
      add('Edit', 'mcx', 'Mirror copy →', 'mirror', () => ed.command('mirror-copy-x'), { title: 'A mirrored copy across the right side (X)' });
      add('Edit', 'mcz', 'Mirror copy ↓', 'mirror', () => ed.command('mirror-copy-z'), { title: 'A mirrored copy across the back side (Z)' });
    }
  }

  if (inside && ed.sel.elems.length && !(ed.sel.item && ed.sel.elems.length <= 1)) {
    const sel = (op: 'row' | 'column' | 'type' | 'face' | 'grow') => () => ed.selectElems(op);
    add('Select', 'row', 'Row', 'row', sel('row'), { title: 'The same floor on every face' });
    add('Select', 'column', 'Column', 'column', sel('column'), { title: 'The same stack on every floor' });
    add('Select', 'type', 'Same type', 'template', sel('type'));
    add('Select', 'face', 'Whole face', 'blank', sel('face'));
    add('Rule', 'detach', 'Detach from rule', 'detach', () => ed.elemAction('detach'), { title: 'Becomes a free part in the same place: moves and changes on its own' });
    add('Rule', 'restore', 'Back to rule', 'restore', () => ed.elemAction('restore'));
    add('Edit', 'swap', 'Swap type', 'swap', (a) => swapMenu(ed, a));
    add('Edit', 'removesel', 'Remove', 'trash', () => ed.elemAction('remove'), { danger: true });
    return out;
  }
  if (inside && ed.sel.item) {
    const it = ed.activeItem();
    add('Component', 'dup', 'Duplicate', 'copy', () => ed.duplicate());
    add('Component', 'unique', 'Make unique', 'unique', () => ed.makeUnique(), { title: 'A type of its own for this occurrence only' });
    if (it?.host.kind === 'free') add('Component', 'along', 'Along a line', 'path', () => ed.applyOp('Copies along a line', [{ key: 's', label: 'Every', value: 8, unit: 'm' }], (v) => (ed.arrayAlongPath(N(v.s)), true)), { title: 'Copies of this part along a line you draw on the ground' });
    if (it?.host.kind === 'face') add('Component', 'repeat', 'Repeat on facade', 'row', () => ed.repeatOnFacade(), { title: 'Becomes a facade rule: this part on every floor of the side' });
    if (it?.origin) add('Component', 'restore', 'Back to rule', 'restore', () => ed.elemAction('restore'));
    add('Component', 'del', 'Delete', 'trash', () => ed.remove(), { danger: true });
    return out;
  }
  if (inside && s && !multiS && ed.sel.edges?.length) {
    // Edge mode: the actions of the selected sides.
    const many = ed.sel.edges.length > 1 ? 's' : '';
    add('Edge', 'emove', 'Move', 'push', () => ed.applyOp(`Move edge${many}`, [{ key: 'd', label: 'Distance (− inward)', value: 1, unit: 'm' }], (v) => ed.modelOp('edge-offset', { d: N(v.d) })), { title: 'Moves the side along its normal; the neighbours follow (or drag it)' });
    add('Edge', 'ecurve', 'Curve', 'arc', () => ed.applyOp(`Curve edge${many}`, [{ key: 'sag', label: 'Bulge at the middle (− inward, 0 straight)', value: 1, unit: 'm' }], (v) => ed.modelOp('edge-curve', { sag: N(v.sag) })), { title: 'Makes the side an arc' });
    add('Edge', 'esplit', 'Split', 'split', () => ed.modelOp('edge-split'), { title: 'A new corner in the middle of the side' });
    add('Edge', 'ebevel', 'Bevel', 'bevel', () => ed.applyOp(`Bevel edge${many}`, [{ key: 'w', label: 'Width', value: 0.3, unit: 'm', step: 0.05 }], (v) => ed.modelOp('edge-bevel', { w: N(v.w) })), { title: 'Bevel on the top and base of this side only' });
    return out;
  }
  if (inside && s && !multiS && ed.sel.verts?.length) {
    // Vertex mode: the actions of the selected corners.
    add('Vertex', 'vround', 'Round', 'round', () => ed.applyOp('Round corners', [{ key: 'r', label: 'Radius', value: 1, unit: 'm' }], (v) => ed.modelOp('corner', { round: N(v.r) })), { title: 'Rounds the selected corners' });
    const smooth = ed.sel.verts.some((id) => s.plan.outer.concat(...s.plan.holes).find((v) => v.id === id)?.smooth);
    add('Vertex', 'vsmooth', smooth ? 'Sharp' : 'Smooth', smooth ? 'chamfer' : 'path', () => ed.toggleSmooth(), { title: smooth ? 'The outline turns a corner at these points' : 'The outline passes smoothly through these points (a spline)' });
    add('Vertex', 'vchamfer', 'Chamfer', 'chamfer', () => ed.applyOp('Chamfer corners', [{ key: 'c', label: 'Chamfer', value: 0.8, unit: 'm' }], (v) => ed.modelOp('corner', { chamfer: N(v.c) })), { title: 'Chamfers the selected corners' });
    add('Vertex', 'vdel', 'Delete', 'trash', () => ed.remove(), { danger: true, title: 'Deletes the selected corners (a volume keeps 3) · Delete' });
    return out;
  }
  if (inside && s && !multiS) {
    const op = (o: 'add' | 'subtract' | 'intersect', label: string, ic: string, title: string) => add('Operation', `op-${o}`, label, ic, () => ed.command(`op-${o}`), { on: s.op === o, title });
    op('add', 'Add', 'add', 'Add to the building');
    op('subtract', 'Subtract', 'subtract', 'Cut what came before (courtyards, arches, niches)');
    op('intersect', 'Intersect', 'intersect', 'Keeps only the common part');
    const side = ed.sel.face?.kind === 'side';
    // Each operation opens the last operation panel (lastop.ts) with its parameters.
    const top = ed.sel.face?.kind === 'top';
    add(
      'Model',
      'extrude',
      'Extrude',
      'extrude',
      () =>
        side
          ? ed.applyOp('Extrude face', [{ key: 'depth', label: 'Depth (− sinks)', value: 3, unit: 'm' }], (v) => ed.modelOp('extrude', { depth: N(v.depth) }))
          : top
            ? // The chosen top: a new volume on it, the same outline (the panel promised this).
              ed.applyOp('Extrude top', [{ key: 'depth', label: 'Height (− lowers)', value: 3, unit: 'm' }], (v) => ed.modelOp('inset-top', { inset: 0, depth: N(v.depth) }))
            : (ed.setTool('extrude'), ed.toast('Extrude: drag a face (or its arrow) to create the new volume.')),
      { title: 'The chosen face becomes a new volume (E)' },
    );
    add('Model', 'inset', 'Inset', 'inset', () =>
      side
        ? ed.applyOp('Inset face', [{ key: 'margin', label: 'Margin', value: 1, unit: 'm' }, { key: 'depth', label: 'Depth (− niche)', value: -0.6, unit: 'm' }, { key: 'foot', label: 'Foot', value: '', options: [['', 'With margin'], ['1', 'Down to the base']] }], (v) => ed.modelOp('inset-side', { margin: N(v.margin), depth: N(v.depth), keepBottom: v.foot === '1' }))
        : ed.applyOp('Inset top', [{ key: 'inset', label: 'Edge setback', value: 1, unit: 'm' }, { key: 'depth', label: 'Height (− lowers)', value: 3, unit: 'm' }], (v) => ed.modelOp('inset-top', { inset: N(v.inset), depth: N(v.depth) })), { title: 'On the chosen face: niche or projection; without a face: set-back volume on the top' });
    add('Model', 'offset', 'Offset', 'offset', () => ed.applyOp('Outline offset', [{ key: 'd', label: 'Distance (− shrinks)', value: 1, unit: 'm' }, { key: 'corner', label: 'Corners', value: 'sharp', options: [['sharp', 'Sharp'], ['round', 'Round'], ['chamfer', 'Chamfered']] }, { key: 'copy', label: 'Result', value: '', options: [['', 'Changes the volume'], ['1', 'New volume']] }], (v) => ed.modelOp('offset', { d: N(v.d), corner: String(v.corner), copy: v.copy === '1' })), { title: 'Offsets the whole outline (negative shrinks)' });
    add('Model', 'split', 'Split', 'split', () => ed.applyOp('Split at height', [{ key: 'y', label: 'Cut height', value: splitHeight(ed), unit: 'm' }], (v) => ed.modelOp('split', { y: N(v.y) })), { title: 'Cuts the volume in two at a height (floor closest to the middle)' });
    add('Model', 'bevel', 'Bevel', 'bevel', () => ed.applyOp('Edge bevel', [{ key: 'top', label: 'Top', value: 0.3, unit: 'm', step: 0.05 }, { key: 'bottom', label: 'Base', value: 0, unit: 'm', step: 0.05 }, { key: 'segments', label: 'Segments', value: 1, step: 1 }, { key: 'profile', label: 'Profile', value: '0', options: [['0', 'Straight'], ['0.5', 'Mixed'], ['1', 'Round']] }], (v) => ed.modelOp('bevel', { top: N(v.top), bottom: N(v.bottom), segments: N(v.segments), profile: N(v.profile) })), { title: 'Bevel on the top and base edges' });
    add('Model', 'round', 'Round', 'round', () => ed.applyOp('Round corners', [{ key: 'r', label: 'Radius', value: 1, unit: 'm' }], (v) => ed.modelOp('corner', { round: N(v.r) })), { title: 'All corners (or the chosen corner)' });
    add('Model', 'chamfer', 'Chamfer', 'chamfer', () => ed.applyOp('Chamfer corners', [{ key: 'c', label: 'Chamfer', value: 0.8, unit: 'm' }], (v) => ed.modelOp('corner', { chamfer: N(v.c) })), { title: 'All corners (or the chosen corner)' });
    add('Massing', 'setback', 'Top setback', 'setback', () => ed.quick('setback'), { title: 'Set-back floor on top; the one below becomes a terrace' });
    add('Massing', 'podium', 'Podium', 'podium', () => ed.quick('podium'), { title: 'Wider podium on the ground floor, with shops' });
    add('Massing', 'court', 'Courtyard', 'court', () => ed.quick('court'), { title: 'Cut in the middle (inner courtyard)' });
    add('Floors', 'lvup', 'Floor +', 'floorUp', () => ed.floorsDelta(1), { title: 'Floor +' });
    add('Floors', 'lvdown', 'Floor −', 'floorDown', () => ed.floorsDelta(-1), { title: 'Floor −' });
    add('Edit', 'dup', 'Duplicate', 'copy', () => ed.duplicate(), { title: 'Duplicate · Ctrl+D' });
    add('Edit', 'mirror', 'Mirror', 'mirror', () => ed.command('mirror'));
    if (b.solids.length > 1) add('Edit', 'sep1', 'Separate', 'detach', () => ed.separate(b.id, [s.id]), { title: 'This volume becomes a building of its own' });
  }
  if (inside && ed.workspace === 'interior' && !ed.sel.item && !ed.sel.elems.length) {
    add('Interior', 'stairup', 'Stair up', 'floorUp', () => ed.stairUp(), { title: 'A straight stair from the floor shown to the one above (it opens the slab)' });
    add('Interior', 'colgrid', 'Columns', 'grid', () => ed.applyOp('Structural grid', [{ key: 's', label: 'Spacing', value: 6, unit: 'm' }], (v) => (ed.columnGrid(Math.max(2, N(v.s))), true)), { title: 'Columns in a grid on every floor of the volume' });
    add('Interior', 'repfloor', 'Copy walls up', 'floors', () => ed.replicateFloor(), { title: 'The interior walls of this floor on every floor above' });
  }
  if (inside && !s && !ed.sel.item && !ed.sel.elems.length) {
    add('Floors', 'lvup', 'Floor +', 'floorUp', () => ed.floorsDelta(1), { title: 'Floor +' });
    add('Floors', 'lvdown', 'Floor −', 'floorDown', () => ed.floorsDelta(-1), { title: 'Floor −' });
    add('Building', 'exit', 'Leave', 'exit', () => ed.exitContext(), { title: 'Leave the building · Esc' });
    return out;
  }
  add('Edit', 'del', 'Delete', 'trash', () => ed.remove(), { danger: true, title: 'Delete · Delete' });
  return out;
}

function swapMenu(ed: Editor3, anchor?: HTMLElement): void {
  const types = BUILTIN_TYPES.concat(ed.project.types).filter((t) => family(t.family)?.host === 'face');
  const r = anchor?.getBoundingClientRect();
  popMenu(ed, r ? r.left : 200, r ? r.bottom + 4 : 200, [{ title: 'Swap for', items: types.map((t) => ({ label: t.name, icon: 'swap', run: () => ed.elemAction('swap', t.id) })) }]);
}

interface MenuItem {
  label: string;
  icon: string;
  run: () => void;
  danger?: boolean;
  on?: boolean;
  title?: string;
}

/** Floating menu in titled groups (context menu and action lists). */
function popMenu(ed: Editor3, x: number, y: number, groups: { title: string; items: MenuItem[] }[]): void {
  document.querySelectorAll('.f3-cmenu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'f3-cmenu f3-island';
  m.setAttribute('role', 'menu');
  const flat: MenuItem[] = [];
  m.innerHTML = groups
    .filter((g) => g.items.length)
    .map(
      (g) =>
        `<div class="hd">${g.title}</div>` +
        g.items
          .map((it) => {
            flat.push(it);
            return `<button role="menuitem" data-i="${flat.length - 1}"${it.danger ? ' class="danger"' : ''}${it.on ? ' aria-pressed="true"' : ''}${it.title ? ` title="${it.title}"` : ''}>${icon(it.icon)}<span>${it.label}</span></button>`;
          })
          .join(''),
    )
    .join('');
  ed.shell.root.appendChild(m);
  const rr = ed.shell.root.getBoundingClientRect();
  const w = m.offsetWidth,
    h = m.offsetHeight;
  m.style.left = `${Math.max(4, Math.min(x - rr.left, rr.width - w - 8))}px`;
  m.style.top = `${Math.max(4, Math.min(y - rr.top, rr.height - h - 8))}px`;
  m.querySelectorAll<HTMLButtonElement>('button').forEach((bt) =>
    bt.addEventListener('click', () => {
      m.remove();
      flat[Number(bt.dataset.i)]!.run();
    }),
  );
  closeOnOutside(m, () => m.remove());
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      m.remove();
      window.removeEventListener('keydown', esc, true);
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', esc, true);
}

/** Groups the actions in the order they appear. */
function grouped(list: Action[]): [string, Action[]][] {
  const g = new Map<string, Action[]>();
  for (const a of list) {
    const arr = g.get(a.group) ?? [];
    arr.push(a);
    g.set(a.group, arr);
  }
  return [...g];
}

/** Actions shown in the contextual bar; the others go to "More". */
const PRIMARY = new Set(['vsmooth', 'stairup', 'cjoin', 'csub', 'cint', 'csep', 'repeat', 'emove', 'ecurve', 'esplit', 'ebevel', 'vround', 'vchamfer', 'vdel', 'enter', 'lvup', 'lvdown', 'dup', 'rot90', 'del', 'op-add', 'op-subtract', 'op-intersect', 'extrude', 'inset', 'offset', 'row', 'column', 'type', 'face', 'swap', 'removesel', 'detach', 'restore', 'unique', 'exit', 'left', 'centerX', 'right', 'front', 'centerZ', 'back', 'distX', 'distZ']);

/** Move, rotate and scale lead the bar of any selection that can be transformed. */
export function transformActions(ed: Editor3): Action[] {
  if (!ed.activeBuilding() || (ed.sel.elems.length && !ed.sel.item)) return [];
  const t = (id: 'move' | 'rotate' | 'scale', label: string, ic: string, key: string): Action => ({ group: 'Transform', id: `tool-${id}`, label, icon: ic, title: `${label} · ${key}`, on: ed.tool === id, run: () => ed.setTool(ed.tool === id ? 'select' : id) });
  return [t('move', 'Move', 'move', 'M'), t('rotate', 'Rotate', 'rotate', 'Q'), t('scale', 'Scale', 'scale', 'S')];
}

/**
 * Contextual bar next to the selection: Move, Rotate, Scale and the main actions
 * of what is selected (the rest under "More"); the editor places it above the
 * object (below when it does not fit) and it hides without a selection. The
 * right-click menu and the search use the same list.
 */
export function mountActions(ed: Editor3): void {
  const bar = ed.shell.ctxbar;
  let last = '';
  // Drawing tools own the view; with the floors drawn apart nothing can be edited (store guard), so no bar.
  const busy = () => ed.presenting || ed.tool === 'paint' || ed.tool === 'tape' || ed.tool === 'rect' || ed.tool === 'circle' || ed.tool === 'polygon' || ed.tool === 'place' || explodeGap(ed.project) > 0;
  const render = () => {
    const list = busy() ? [] : actionsFor(ed);
    const all = list.length ? [...transformActions(ed), ...list] : [];
    const floors = ed.activeBuilding()?.levels.length ?? 0;
    const key = JSON.stringify([ed.tool, floors, all.map((a) => [a.id, a.on])]);
    if (key === last) return ed.placeCtxBar();
    last = key;
    bar.hidden = !all.length;
    if (!all.length) return;
    const shown = all.filter((a) => a.group === 'Transform' || PRIMARY.has(a.id));
    const more = all.filter((a) => !shown.includes(a));
    const btn = (a: Action) => `<button data-a="${a.id}"${a.on !== undefined ? ` aria-pressed="${a.on}"` : ''}${a.danger ? ' class="danger"' : ''} title="${a.title ?? a.label}" aria-label="${a.label}">${icon(a.icon)}<span>${a.label}</span></button>`;
    // Floors: a "− N floors +" stepper with the current number (not a gizmo handle).
    const stepper = (as: Action[]) => {
      const dn = as.find((a) => a.id === 'lvdown'),
        up = as.find((a) => a.id === 'lvup');
      return `<div class="grp step" title="Building floors">${dn ? btn({ ...dn, icon: 'minus' }) : ''}<span class="n">${floors} ${floors === 1 ? 'floor' : 'floors'}</span>${up ? btn({ ...up, icon: 'add' }) : ''}</div>`;
    };
    bar.innerHTML =
      grouped(shown)
        .map(([g, as]) => (g === 'Floors' ? stepper(as) : `<div class="grp"><div class="btns">${as.map(btn).join('')}</div></div>`))
        .join('') + (more.length ? `<div class="grp"><div class="btns"><button data-more class="lbl" title="More actions (${more.length})" aria-label="More actions">${icon('more')}<span>More</span></button></div></div>` : '');
    bar.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((bt) =>
      bt.addEventListener('click', () => {
        const a = [...transformActions(ed), ...actionsFor(ed)].find((x) => x.id === bt.dataset.a);
        a?.run(bt);
      }),
    );
    bar.querySelector<HTMLButtonElement>('[data-more]')?.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const rest = actionsFor(ed).filter((a) => !PRIMARY.has(a.id));
      popMenu(ed, r.left, r.bottom + 4, grouped(rest).map(([title, as]) => ({ title, items: as.map((a) => ({ label: a.label, icon: a.icon, run: () => a.run(), danger: a.danger, on: a.on, title: a.title })) })));
    });
    ed.placeCtxBar();
  };
  ed.onChange(render);
  render();
  // Right click without dragging: the menu with the actions of what is under the cursor (selected first if needed).
  ed.contextRequested = (x, y) => {
    const list = actionsFor(ed);
    const head: MenuItem[] = [];
    if (ed.context) head.push({ label: 'Leave the building', icon: 'exit', run: () => ed.exitContext() });
    head.push({ label: 'Frame', icon: 'focus', run: () => ed.frameSelection() });
    popMenu(ed, x, y, [...grouped(list).map(([title, as]) => ({ title, items: as.map((a) => ({ label: a.label, icon: a.icon, run: () => a.run(), danger: a.danger, on: a.on, title: a.title })) })), { title: 'View', items: head }]);
  };
}
