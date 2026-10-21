// Last operation panel (Blender, "Adjust Last Operation"): in the corner of the
// view, the parameters of the operation just done; changing a value redoes the
// operation on the same selection, as a single history step. It hides when the
// user selects something else or records another change.
import type { Editor3 } from '../editor/editor';
import { icon } from './icons';
import { gicon, numCell, polish, prow, selectCell } from './kit';

/** Row icon of each operation parameter (panel standard: icon + short label, the note in the tooltip). */
const PARAM_ICON: Record<string, string> = { d: 'distance', depth: 'extrude', margin: 'margin', inset: 'inset', y: 'split', top: 'bevel', bottom: 'bevel', segments: 'segments', profile: 'segments', corner: 'round', copy: 'copy', foot: 'floors', r: 'round', c: 'chamfer', w: 'bevel', sag: 'arc' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => String(Math.round(v * 1000) / 1000);

export function mountLastOp(ed: Editor3): void {
  const box = document.createElement('div');
  box.className = 'f3-lastop f3-island';
  box.setAttribute('role', 'group');
  box.hidden = true;
  ed.shell.view.appendChild(box);
  const render = () => {
    const op = ed.lastOp;
    box.hidden = !op;
    if (!op) return;
    const row = (p: (typeof op.params)[number]) => {
      const v = op.values[p.key];
      // "Distance (− shrinks)": the row says "Distance", the tooltip says it all.
      const short = p.label.replace(/\s*\(.*\)\s*$/, '');
      const ic = PARAM_ICON[p.key] ?? null;
      if (p.options) return prow(short, ic, [selectCell(`data-op="${esc(p.key)}"`, p.label, p.options, String(v))], { wide: true, title: p.label });
      return prow(short, ic, [numCell({ attr: `data-op="${esc(p.key)}"`, name: p.label, value: num(Number(v)), glyph: ic ? gicon(ic) : '', unit: p.unit && p.unit !== 'm' ? p.unit : '', step: p.step ?? 0.1 })], { title: p.label });
    };
    // Values that belong together share one row, like in the properties panel.
    const PAIRS: [string, string, string, string][] = [
      ['top', 'bottom', 'Bevel', 'bevel'],
      ['segments', 'profile', 'Profile', 'segments'],
    ];
    const keys = new Set(op.params.map((p) => p.key));
    const cellOf = (p: (typeof op.params)[number], glyph: string) => {
      const v = op.values[p.key];
      return p.options ? selectCell(`data-op="${esc(p.key)}"`, p.label, p.options, String(v), glyph) : numCell({ attr: `data-op="${esc(p.key)}"`, name: p.label, value: num(Number(v)), glyph, unit: p.unit && p.unit !== 'm' ? p.unit : '', step: p.step ?? 0.1 });
    };
    const rows: string[] = [];
    const done = new Set<string>();
    for (const p of op.params) {
      if (done.has(p.key)) continue;
      const pair = PAIRS.find(([a, b]) => p.key === a && keys.has(b));
      if (pair) {
        const q = op.params.find((x) => x.key === pair[1])!;
        done.add(q.key);
        rows.push(prow(pair[2], pair[3], [cellOf(p, p.options ? '' : `<b class="g gt">${esc(p.label)}</b>`), cellOf(q, q.options ? '' : q.key === 'segments' ? gicon('count') : `<b class="g gt">${esc(q.label)}</b>`)], { title: `${p.label} and ${q.label}` }));
      } else rows.push(row(p));
    }
    box.innerHTML = `<div class="hd"><b>${esc(op.label)}</b><button class="f3-tb" data-x title="Close (the result stays)" aria-label="Close">${icon('close')}</button></div>${rows.join('')}`;
    polish(box);
    box.querySelector('[data-x]')!.addEventListener('click', () => ed.clearLastOp());
    box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-op]').forEach((el) => {
      const key = el.dataset.op!;
      const apply = () => {
        if (el instanceof HTMLSelectElement) return void ed.redoLastOp({ [key]: el.value });
        const v = parseFloat(el.value.replace(',', '.'));
        if (!Number.isFinite(v)) return void (el.value = num(Number(ed.lastOp?.values[key] ?? 0)));
        if (v !== ed.lastOp?.values[key]) ed.redoLastOp({ [key]: v });
      };
      el.addEventListener('change', apply);
      el.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent;
        // Arrow keys step the value (like the properties panel fields).
        if (el instanceof HTMLInputElement && (ke.key === 'ArrowUp' || ke.key === 'ArrowDown')) {
          const step = Number(el.dataset.step ?? 0.1) * (ke.shiftKey ? 10 : 1);
          const v = parseFloat(el.value.replace(',', '.')) || 0;
          el.value = num(Math.round((v + (ke.key === 'ArrowUp' ? step : -step)) * 1000) / 1000);
          apply();
          ke.preventDefault();
        }
        if (ke.key === 'Enter') (el as HTMLElement).blur();
        ke.stopPropagation();
      });
    });
  };
  // The contextual bar steps aside when the panel appears or goes.
  ed.lastOpChanged = () => {
    render();
    ed.placeCtxBar();
  };
  render();
}
