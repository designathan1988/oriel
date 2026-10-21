// The options of the tool in hand, in the top bar (Revit's Options Bar, Photoshop's tool options, the
// SketchUp/ArchiCAD info box): what the next wall, door, window, slab or shape will be, set before it is
// drawn. Wall: thickness, interior thickness, height. Door and window: type, width, height (and sill).
// Slab: thickness. Shapes: add or subtract. Nothing for the tools that need no setting.
import type { Editor3 } from '../editor/editor';
import { BUILTIN_TYPES, family } from '../families/index';
import { resolveParams } from '../families/family';
import { icon } from './icons';
import { decimal, tr } from './i18n';

const dec = (v: number) => decimal(Math.round(v * 1000) / 1000);
const parse = (s: string) => {
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

export function mountToolOptions(ed: Editor3): void {
  const box = document.createElement('div');
  box.className = 'f3-opts';
  box.setAttribute('aria-label', 'Tool options');
  ed.shell.viewctl.append(box);
  const sep = document.createElement('span');
  sep.className = 'f3-topsep';
  ed.shell.viewctl.before(sep);

  /** A number field: a glyph, the value and its unit; Enter or leaving applies it. */
  const num = (key: string, glyph: string, title: string, v: number, unit = 'm', step = 0.05) =>
    `<label class="f3-opt" title="${title}"><span>${glyph}</span><input data-o="${key}" inputmode="decimal" value="${dec(v)}" data-step="${step}" aria-label="${title}"><small>${unit}</small></label>`;

  let last = '';
  const render = () => {
    // In the floor plan the box moves into the plan's bar and follows its Wall mode.
    const plan = ed.shell.view.querySelector<HTMLElement>('.f3-plan:not([hidden])');
    const slot = plan?.querySelector<HTMLElement>('[data-opts]') ?? null;
    const home = slot ?? ed.shell.viewctl;
    if (box.parentElement !== home) home.append(box);
    const tool = plan ? (plan.dataset.mode === 'wall' ? 'walls' : '') : ed.tool;
    const placingFam = tool === 'place' && ed.placing ? family(BUILTIN_TYPES.concat(ed.project.types).find((t) => t.id === ed.placing)?.family ?? '') : undefined;
    const key = JSON.stringify([tool, !!plan, ed.placing, ed.drawMode, ed.wallThickness, ed.iwallThickness, ed.wallHeight, ed.wallLine, ed.terrainHeight, ed.slabThickness, ed.placeParams]);
    if (key === last) return;
    // Never redraw under the user's typing.
    if (box.contains(document.activeElement)) return;
    last = key;
    let html = '';
    if (tool === 'walls' || tool === 'iwall') {
      html = num('wallT', '↔', tr('Wall thickness'), ed.wallThickness) + num('iwallT', '↔ⁱ', tr('Interior wall thickness'), ed.iwallThickness) + num('wallH', 'H', tr('Wall height'), ed.wallHeight);
      // The location line: which part of the wall the clicks follow.
      const ln = (v: string, ic: string, t: string) => `<button data-o="line:${v}" aria-pressed="${ed.wallLine === v}" title="${tr(t)}">${icon(ic)}</button>`;
      html += `<div class="f3-seg2" role="group" aria-label="${tr('Location line')}">${ln('center', 'lineCenter', 'Clicks on the centre of the wall')}${ln('outside', 'lineOutside', 'Clicks on the outer face of the wall')}${ln('inside', 'lineInside', 'Clicks on the inner face of the wall')}</div>`;
    } else if (placingFam && (placingFam.id === 'door' || placingFam.id === 'window')) {
      const types = BUILTIN_TYPES.concat(ed.project.types).filter((t) => t.family === placingFam.id);
      const t = types.find((x) => x.id === ed.placing)!;
      const p = { ...resolveParams(placingFam, t.params), ...ed.placeParams } as Record<string, unknown>;
      const n = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);
      html = `<label class="f3-opt sel" title="${tr('Type')}">${icon(placingFam.id === 'door' ? 'door' : 'window')}<select data-o="type" aria-label="${tr('Type')}">${types.map((x) => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${tr(x.name)}</option>`).join('')}</select></label>`;
      html += num('p:width', 'L', tr('Width'), n('width')) + num('p:height', 'H', tr('Height'), n('height'));
      if (placingFam.id === 'window') html += num('p:sillH', '⊥', tr('Sill height'), n('sillH'));
    } else if (tool === 'terrain') {
      html = num('terrainH', '⛰', tr('Ground height at the next point'), ed.terrainHeight, 'm', 0.5);
    } else if (tool === 'slab') {
      html = num('slabT', '⊟', tr('Slab thickness'), ed.slabThickness, 'm', 0.01);
    } else if (tool === 'rect' || tool === 'circle' || tool === 'polygon' || tool === 'spline' || tool === 'arc') {
      html = `<div class="f3-seg2" role="group" aria-label="${tr('Drawing')}"><button data-o="add" aria-pressed="${ed.drawMode === 'add'}" title="${tr('Add a volume')}">${icon('add')}</button><button data-o="sub" aria-pressed="${ed.drawMode === 'subtract'}" title="${tr('Subtract (a courtyard, a niche, an opening)')}">${icon('subtract')}</button></div>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
    sep.hidden = !html || !!plan;
  };

  const apply = (inp: HTMLInputElement | HTMLSelectElement) => {
    const k = inp.dataset.o!;
    if (k === 'type') return ed.startPlacing(inp.value);
    const v = parse(inp.value);
    if (k === 'terrainH') {
      if (v === null || Math.abs(v) > 500) return render();
      ed.terrainHeight = v;
      last = '';
      return ed.emit();
    }
    if (v === null || v <= 0) return render();
    if (k === 'wallT') ed.wallThickness = Math.min(1.5, Math.max(0.05, v));
    else if (k === 'iwallT') ed.iwallThickness = Math.min(1, Math.max(0.03, v));
    else if (k === 'wallH') ed.wallHeight = Math.min(30, Math.max(0.5, v));
    else if (k === 'slabT') ed.slabThickness = Math.min(2, Math.max(0.05, v));
    else if (k.startsWith('p:')) ed.placeParams = { ...ed.placeParams, [k.slice(2)]: v };
    last = '';
    ed.emit();
  };
  box.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.dataset.o) apply(t);
  });
  box.addEventListener('keydown', (e) => {
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && t.dataset.o) {
      apply(t);
      t.blur();
    }
    if (e.key === 'Escape') t.blur();
    e.stopPropagation();
  });
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-o]');
    if (!b) return;
    if (b.dataset.o!.startsWith('line:')) ed.wallLine = b.dataset.o!.slice(5) as typeof ed.wallLine;
    else if ((b.dataset.o === 'sub') !== (ed.drawMode === 'subtract')) ed.toggleDrawMode();
    last = '';
    render();
  });
  ed.onChange(render);
  render();
}
