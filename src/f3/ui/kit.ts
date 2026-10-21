// Common finishing of the panels (kit): each panel builds the HTML of its fields and
// this pass standardizes everything at once — unit inside the field, inline label
// (a long one takes the whole row), dragging the label changes the number (as
// in Figma and Blender), collapsible sections remembered between selections.
//
// Panel standard (docs/INTERFACE.md, "Panel standard"): every value sits in a row —
// a short label with an icon on the left, then one to three cells on one grid.
// Related values share a row (position X·Y·Z, size W·D·H, round·chamfer), the way
// Figma pairs X/Y and W/H and Blender groups a property's X/Y/Z. Inside each cell
// a glyph (an axis letter colored like the gizmo, a letter or an icon) names it;
// dragging the glyph changes the number; the full name is the tooltip.

import { icon } from './icons';
import { decimal } from './i18n';

const escA = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const show = (v: number) => String(Math.round(v * 100) / 100);

/** Glyph of an axis, colored like the gizmo arrow of that axis (X red, Y green and vertical, Z blue). */
// The letters architects read (SketchUp, Revit, ArchiCAD: Z up): the model's y (height) shows as Z, its z (plan depth) as Y.
export const axis = (a: 'x' | 'y' | 'z'): string => `<b class="g g${a}">${a === 'y' ? 'Z' : a === 'z' ? 'Y' : 'X'}</b>`;
/** Glyph of a short word or letter (W, D, H, Top…). */
export const gtext = (t: string): string => `<b class="g gt">${t}</b>`;
/** Glyph of an icon. */
export const gicon = (name: string): string => `<b class="g">${icon(name)}</b>`;

export interface NumCell {
  /** Identifying attribute(s) of the input, e.g. `data-k="cx"`. */
  attr: string;
  /** Full name (tooltip and accessible name). */
  name: string;
  value: number | string;
  glyph: string;
  unit?: string;
  step?: number;
  placeholder?: string;
  /** Overridden on this occurrence (blue). */
  over?: boolean;
}

/** A number cell: glyph (drag it to change the value), the number and its unit. */
export function numCell(c: NumCell): string {
  const v = typeof c.value === 'number' ? decimal(show(c.value)) : /^-?\d+(\.\d+)?$/.test(c.value) ? decimal(c.value) : c.value;
  return `<label class="f3-cell${c.over ? ' over' : ''}" title="${escA(c.name)}">${c.glyph}<input ${c.attr} inputmode="decimal" value="${escA(v)}" data-step="${c.step ?? 0.1}" aria-label="${escA(c.name)}"${c.placeholder !== undefined ? ` placeholder="${escA(c.placeholder)}"` : ''}>${c.unit ? `<em>${c.unit}</em>` : ''}</label>`;
}

/** A select cell (choices); `glyph` is optional. */
export function selectCell(attr: string, name: string, options: readonly (readonly [string, string])[], value: string, glyph = '', over = false): string {
  return `<label class="f3-cell sel${over ? ' over' : ''}" title="${escA(name)}">${glyph}<select ${attr} aria-label="${escA(name)}">${options.map(([v, l]) => `<option value="${escA(v)}" ${v === value ? 'selected' : ''}>${escA(l)}</option>`).join('')}</select></label>`;
}

/** A color cell. */
export function colorCell(attr: string, name: string, value: string, over = false): string {
  return `<label class="f3-cell col${over ? ' over' : ''}" title="${escA(name)}"><input type="color" ${attr} value="${escA(value)}" aria-label="${escA(name)}"></label>`;
}

/**
 * One row: a short label with its icon, then one to three cells. `wide` cells
 * (selects, long values) take the whole width; otherwise a lone cell takes half,
 * two take half each and three a third each, so the columns line up between rows.
 */
export function prow(label: string, ic: string | null, cells: string[], opts: { title?: string; wide?: boolean } = {}): string {
  const n = opts.wide ? 'w' : String(Math.min(3, cells.length));
  return `<div class="f3-prow"><span class="lab" title="${escA(opts.title ?? label)}">${ic ? icon(ic) : ''}<span>${label}</span></span><div class="f3-cells n${n}">${cells.join('')}</div></div>`;
}

// v3: the sections few edits need start closed (the panel shows size, roof, materials and facade first,
// like Revit's and SketchUp's short property lists); what the user opens or closes is remembered.
const CLOSED_KEY = 'forma3_closed_sections_v3';
const DEFAULT_CLOSED = new Set<string>(['Transform', 'Shape', 'Loft', 'Repeat and mirror', 'Edges', 'Bands and cornice', 'Revolved shape', 'Array']);

function loadClosed(): Set<string> {
  try {
    const raw = localStorage.getItem(CLOSED_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set(DEFAULT_CLOSED);
  } catch {
    return new Set(DEFAULT_CLOSED);
  }
}
const closed = loadClosed();
function saveClosed(): void {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]));
  } catch {
    /* no storage: valid for this session only */
  }
}

const parse = (s: string) => parseFloat(s.replace(',', '.'));
const fmt = (v: number, step: number) => {
  const d = step >= 1 ? 0 : step >= 0.1 ? 2 : 3;
  return decimal(Math.round(v * 10 ** d) / 10 ** d);
};

/** Standardizes a freshly drawn panel. */
export function polish(root: HTMLElement): void {
  for (const f of root.querySelectorAll<HTMLElement>('.f3-field')) {
    const span = f.querySelector<HTMLElement>(':scope>span');
    const ctl = f.querySelector<HTMLInputElement | HTMLSelectElement>(':scope>input,:scope>select');
    if (!span || !ctl) continue;
    // "Height (m)" → label "Height" + unit "m" inside the field.
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(span.textContent ?? '');
    let label = span.textContent ?? '';
    let unit = '';
    if (m) {
      label = m[1]!;
      const u = m[2]!;
      // A short unit goes inside; a long note becomes a tooltip.
      if (/^(m|°|%|cm|mm|m²)$/.test(u)) unit = u;
      else if (/^m;/.test(u)) {
        unit = 'm';
        f.title = `${label}: ${u.slice(2).trim()}`;
      } else f.title = `${label} (${u})`;
      span.textContent = label;
    }
    if (!f.title) f.title = label;
    if (label.length > 11 || (ctl instanceof HTMLSelectElement && label.length > 7)) f.classList.add("w");
    // Select: half a column holds ~7 letters with the arrow; more than that takes the whole row,
    // and a long option (over 14) puts the label above and the field across the row.
    if (ctl instanceof HTMLSelectElement) {
      const longest = Math.max(0, ...[...ctl.options].map((o) => o.text.length));
      if (longest > 7) f.classList.add('w');
      if (longest > 14) f.classList.add('st');
    }
    if (ctl instanceof HTMLInputElement && ctl.type !== 'color') {
      const wrap = document.createElement('span');
      wrap.className = 'f3-in';
      ctl.replaceWith(wrap);
      wrap.appendChild(ctl);
      if (unit) {
        const em = document.createElement('em');
        em.textContent = unit;
        wrap.appendChild(em);
      }
      if (ctl.inputMode === 'decimal') scrub(span, ctl);
    }
  }
  // Number cells of the panel standard: the glyph scrubs.
  for (const c of root.querySelectorAll<HTMLElement>('.f3-cell')) {
    const g = c.querySelector<HTMLElement>(':scope>.g');
    const ctl = c.querySelector<HTMLInputElement>(':scope>input[inputmode="decimal"]');
    if (g && ctl) scrub(g, ctl);
  }
  // Collapsible sections.
  for (const sec of root.querySelectorAll<HTMLElement>('.f3-sec')) {
    const h = sec.querySelector<HTMLElement>(':scope>h3');
    if (!h) continue;
    const key = (h.childNodes[0]?.textContent ?? h.textContent ?? '').trim() || (h.textContent ?? '').trim();
    if (closed.has(key)) sec.classList.add('closed');
    h.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button,input,select')) return;
      const now = !sec.classList.toggle('closed');
      if (now) closed.delete(key);
      else closed.add(key);
      saveClosed();
    });
  }
}

/** Dragging the label changes the number by the field step (Shift ×10, Alt ÷10). */
function scrub(label: HTMLElement, input: HTMLInputElement): void {
  label.classList.add('drag');
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = parse(input.value) || 0;
    const step = parse(input.dataset.step ?? '0.1') || 0.1;
    const x0 = e.clientX;
    let moved = false;
    label.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 2) moved = true;
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      input.value = fmt(start + Math.round(dx / 4) * step * k, step * k);
    };
    const up = () => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      if (moved) input.dispatchEvent(new Event('change'));
      else input.focus();
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
  });
}

/**
 * Closes a menu or floating window on the first touch outside it (capture
 * phase: the canvas does not swallow the event). Touches inside do not use up
 * the listener; `except` (the button that opens it) does not close either.
 * Returns the remover.
 */
export function closeOnOutside(el: HTMLElement, close: () => void, except?: Element | null): () => void {
  const off = () => document.removeEventListener('pointerdown', on, true);
  const on = (e: PointerEvent) => {
    if (!el.isConnected) return off();
    const t = e.target as Node;
    if (el.contains(t) || except?.contains(t)) return;
    off();
    close();
  };
  setTimeout(() => el.isConnected && document.addEventListener('pointerdown', on, true), 0);
  return off;
}
