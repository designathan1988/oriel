// Quantities and cost estimate (Export → Quantities, Ctrl+K "Quantities"): the takeoff of a building or
// of the whole project (eval/quantities.ts), a unit cost typed per line (kept in this browser), the
// total, and a quick estimate by the built area times the CUB/m² — the reference cost per m² the
// builders' unions publish monthly (Sinduscon); the default is the average residential CUB of Santa
// Catarina for October 2026, R$ 3.171,96/m² (https://myside.com.br/guia-balneario-camboriu/cub-sc), to be
// set to the state and standard of the work. The table downloads as a spreadsheet (CSV).
import type { Editor3 } from '../editor/editor';
import type { Building3 } from '../model/schema';
import { floorPlan, sortedLevels } from '../eval/floorplan';
import { buildingQuantities, type QuantityLine } from '../eval/quantities';
import { loadLang, tr } from './i18n';

const PRICES = 'oriel_prices';
const CUB = 'oriel_cub';
const CUB_DEFAULT = 3171.96;

const CSS = `
.f3-modal>.f3-qty{width:min(980px,96vw);max-width:none;max-height:84vh;display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.f3-qty header{display:flex;align-items:center;gap:10px}
.f3-qty header h2{margin:0;font-size:16px;flex:1}
.f3-qty select,.f3-qty input{height:28px;background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:0 8px;font:inherit}
.f3-qty .tbl{overflow:auto;border:1px solid var(--line);border-radius:8px}
.f3-qty table{width:100%;border-collapse:collapse;font-size:12.5px}
.f3-qty th,.f3-qty td{padding:5px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
.f3-qty th{position:sticky;top:0;background:var(--raise);font-weight:600;font-size:11.5px;color:var(--muted)}
.f3-qty td.n{text-align:right;font-variant-numeric:tabular-nums}
.f3-qty td small{color:var(--faint);margin-left:6px}
.f3-qty tr.g td{background:var(--field);font-weight:600;font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.f3-qty td input{width:96px;text-align:right;height:24px}
.f3-qty footer{display:flex;flex-wrap:wrap;align-items:center;gap:14px;font-size:12.5px}
.f3-qty footer b{font-size:15px}
.f3-qty footer .sp{flex:1}
.f3-qty .cub{display:flex;align-items:center;gap:6px;color:var(--muted)}
.f3-qty .cub input{width:110px;text-align:right}
`;

const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // Kept for this page.
  }
};

/** The quantities of a building from the evaluation the view already holds. */
function quantitiesOf(ed: Editor3, b: Building3): QuantityLine[] {
  const ev = ed.view.built.get(b.id)?.ev ?? null;
  const plans = sortedLevels(b)
    .map((_, i) => floorPlan(b, i, ev?.placements ?? []))
    .filter((f) => f.walls.length);
  return buildingQuantities(b, ev, plans);
}

/** Lines of several buildings added up (same key, same line). */
function sum(lists: QuantityLine[][]): QuantityLine[] {
  const by = new Map<string, QuantityLine>();
  for (const l of lists.flat()) {
    const c = by.get(l.key);
    if (c) c.qty = Math.round((c.qty + l.qty) * 100) / 100;
    else by.set(l.key, { ...l });
  }
  return [...by.values()];
}

export function openQuantities(ed: Editor3): void {
  const doc = ed.shell.root.ownerDocument;
  if (!doc.getElementById('f3-qty-css')) {
    const st = doc.createElement('style');
    st.id = 'f3-qty-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const pt = loadLang() === 'pt-BR';
  const dec = pt ? ',' : '.';
  const money = (v: number) => v.toLocaleString(pt ? 'pt-BR' : 'en-US', { style: 'currency', currency: 'BRL' });
  const num = (v: number) => v.toLocaleString(pt ? 'pt-BR' : 'en-US', { maximumFractionDigits: 2, minimumFractionDigits: v % 1 ? 2 : 0 });
  const parse = (s: string) => Number(s.replace(/\s/g, '').replace(pt ? /\./g : /,/g, '').replace(',', '.')) || 0;
  const bs = ed.project.buildings.filter((b) => !b.hidden && b.solids.some((s) => s.op === 'add'));
  const prices = load<Record<string, number>>(PRICES, {});
  let cub = load<number>(CUB, CUB_DEFAULT);
  let which = ed.activeBuilding()?.id ?? 'all';
  if (which !== 'all' && !bs.some((b) => b.id === which)) which = 'all';

  const m = doc.createElement('div');
  m.className = 'f3-modal';
  m.innerHTML = `<div class="f3-qty" role="dialog" aria-label="Quantities and cost">
    <header><h2>Quantities and cost estimate</h2><select data-b aria-label="Building"></select><button class="f3-btn" data-csv>Download spreadsheet (CSV)</button><button class="f3-x" data-close aria-label="Close" style="background:none;border:0;color:var(--muted);font-size:20px;cursor:pointer">×</button></header>
    <div class="tbl"><table><thead><tr><th>Item</th><th class="n">Quantity</th><th>Unit</th><th class="n">Unit cost (R$)</th><th class="n">Subtotal</th></tr></thead><tbody></tbody></table></div>
    <footer><span>Sum of the lines with a cost: <b data-total></b></span><span class="sp"></span><label class="cub" title="Reference cost per m² (Sinduscon CUB): set your state and standard">Estimate by CUB/m² <input data-cub inputmode="decimal"> × <span data-gross></span> = <b data-cubtotal></b></label></footer>
  </div>`;
  ed.shell.root.appendChild(m);
  const sel = m.querySelector<HTMLSelectElement>('[data-b]')!;
  sel.setAttribute('data-i18n-skip', '');
  sel.innerHTML = `<option value="all">${tr('Whole project')}</option>` + bs.map((b) => `<option value="${b.id}"></option>`).join('');
  bs.forEach((b, i) => (sel.options[i + 1]!.textContent = b.name));
  sel.value = which;
  const body = m.querySelector('tbody')!;
  const cubIn = m.querySelector<HTMLInputElement>('[data-cub]')!;
  cubIn.value = num(cub);
  let lines: QuantityLine[] = [];

  const compute = () => {
    const list = which === 'all' ? bs : bs.filter((b) => b.id === which);
    lines = sum(list.map((b) => quantitiesOf(ed, b)));
  };
  const draw = () => {
    const groups = ['Areas', 'Walls', 'Floors and ceilings', 'Roof', 'Windows and doors'] as const;
    body.innerHTML = groups
      .map((g) => {
        const ls = lines.filter((l) => l.group === g);
        if (!ls.length) return '';
        return `<tr class="g"><td colspan="5">${tr(g)}</td></tr>` + ls.map((l) => `<tr data-k="${l.key}"><td>${tr(l.item)}${l.detail ? `<small>${l.detail.replace(/\./g, dec)}</small>` : ''}</td><td class="n">${num(l.qty)}</td><td>${l.unit}</td><td class="n">${g === 'Areas' ? '' : `<input data-price inputmode="decimal" aria-label="Unit cost" value="${prices[l.key] ? num(prices[l.key]!) : ''}" placeholder="0${dec}00">`}</td><td class="n" data-sub></td></tr>`).join('');
      })
      .join('');
    totals();
  };
  const totals = () => {
    let total = 0;
    body.querySelectorAll<HTMLTableRowElement>('tr[data-k]').forEach((tr2) => {
      const l = lines.find((x) => x.key === tr2.dataset.k);
      const p = prices[tr2.dataset.k!] ?? 0;
      const sub = l && p ? l.qty * p : 0;
      total += sub;
      tr2.querySelector('[data-sub]')!.textContent = sub ? money(sub) : '';
    });
    const gross = lines.find((l) => l.key === 'gross')?.qty ?? 0;
    m.querySelector('[data-total]')!.textContent = money(total);
    m.querySelector('[data-gross]')!.textContent = `${num(gross)} m²`;
    m.querySelector('[data-cubtotal]')!.textContent = money(gross * cub);
  };
  compute();
  draw();

  body.addEventListener('input', (e) => {
    const inp = e.target as HTMLInputElement;
    const k = inp.closest<HTMLElement>('tr[data-k]')?.dataset.k;
    if (!k) return;
    const v = parse(inp.value);
    if (v) prices[k] = v;
    else delete prices[k];
    save(PRICES, prices);
    totals();
  });
  cubIn.addEventListener('input', () => {
    cub = parse(cubIn.value);
    save(CUB, cub);
    totals();
  });
  sel.addEventListener('change', () => {
    which = sel.value;
    compute();
    draw();
  });
  m.querySelector('[data-csv]')!.addEventListener('click', () => {
    const sep = pt ? ';' : ',';
    const n = (v: number) => String(Math.round(v * 100) / 100).replace('.', dec);
    const rows = [[tr('Group'), tr('Item'), tr('Detail'), tr('Quantity'), tr('Unit'), tr('Unit cost (R$)'), tr('Subtotal')].join(sep)];
    for (const l of lines) {
      const p = prices[l.key] ?? 0;
      rows.push([tr(l.group), tr(l.item), l.detail ?? '', n(l.qty), l.unit, p ? n(p) : '', p ? n(p * l.qty) : ''].map((c) => (/[;,"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(sep));
    }
    // BOM: spreadsheet programs read the accents right.
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `${ed.project.name.replace(/[^\w\-]+/g, '_') || 'project'}-quantities.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  const close = () => {
    m.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if ((e.target as HTMLElement).closest?.('input,select')) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  m.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest('[data-close]')) close();
  });
}
