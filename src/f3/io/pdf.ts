// The drawing set as a PDF at true scale (jsPDF + svg2pdf.js: https://github.com/yWorks/svg2pdf.js), on
// A3 landscape sheets laid out as the Brazilian drawing rules ask: the sheet frame 25 mm from the left
// edge (binding) and 7 mm from the others (NBR 10068), the title block in the bottom right corner, 178 mm
// wide, with the project, the drawing, the scale, the date and the sheet number (NBR 10582).
// Sheets: the site plan, every floor plan of every building (eval/floorplan.ts: cut walls, doors,
// windows, rooms with their areas, dimensions), a section, and the area table (built and free area per
// floor, the area of each room). Each drawing at the largest usual scale that fits (1:50, 1:75, 1:100…).
// Browser only (svg2pdf needs a real DOM); loaded on demand from the export menu.
import { BRAND } from '../model/brand';
import type { Project3 } from '../model/schema';
import { planSvg } from './plansvg';
import { sectionSvg } from './sectionsvg';
import { evaluateBuilding } from '../eval/evaluate';
import { floorPlan, sortedLevels, type FloorPlan } from '../eval/floorplan';
import { floorPlanSvg } from '../eval/floorplansvg';

const SCALES = [50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000];
const PT_PER_MM = 72 / 25.4;
/** A3 landscape (mm), the frame margins (NBR 10068) and the title block (NBR 10582). */
const PAGE = { w: 420, h: 297 };
const LEFT = 25,
  EDGE = 7;
const BLOCK = { w: 178, h: 36 };

export interface DrawingSetOptions {
  /** Section line (z of the scene) for the section sheet. */
  sectionAt?: number;
  /** The interface language for the words on the sheets (identity by default). */
  t?: (english: string) => string;
  /** Decimal separator of the numbers. */
  decimal?: string;
}

/** The largest standard scale (1:N) at which a drawing of `w` × `h` m fits the area (mm). */
export function fitScale(w: number, h: number, areaW: number, areaH: number): number {
  for (const s of SCALES) if ((w * 1000) / s <= areaW && (h * 1000) / s <= areaH) return s;
  return SCALES[SCALES.length - 1]!;
}

interface Sheet {
  title: string;
  /** The drawing (SVG text and its drawing units per metre), or a table drawn by hand. */
  svg?: { text: string; perMetre: number };
  table?: { head: string[]; rows: (string | number)[][]; bold: Set<number> };
}

/** The floor plans of the project: every visible building with walls, every floor of it. */
export function projectPlans(p: Project3): { building: string; level: string; plan: FloorPlan }[] {
  const out: { building: string; level: string; plan: FloorPlan }[] = [];
  for (const b of p.buildings) {
    if (b.hidden || !b.solids.some((s) => s.op === 'add' && !s.hidden)) continue;
    let ev;
    try {
      ev = evaluateBuilding(b, {}, p);
    } catch {
      continue;
    }
    sortedLevels(b).forEach((lv, i) => {
      const plan = floorPlan(b, i, ev.placements);
      if (plan.walls.length) out.push({ building: b.name, level: lv.name, plan });
    });
  }
  return out;
}

export async function drawingsPdf(p: Project3, opts: DrawingSetOptions | number = {}): Promise<Blob> {
  const o: DrawingSetOptions = typeof opts === 'number' ? { sectionAt: opts } : opts;
  const t = o.t ?? ((s: string) => s);
  const dec = o.decimal ?? '.';
  const num = (v: number, d = 2) => v.toFixed(d).replace('.', dec);
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  const plans = projectPlans(p);

  const sheets: Sheet[] = [{ title: t('Site plan'), svg: { text: planSvg(p), perMetre: 4 } }];
  for (const f of plans) {
    sheets.push({ title: `${t('Floor plan')} · ${t(f.level)} · ${f.building}`, svg: { text: floorPlanSvg(f.plan, { decimal: dec, t }).svg, perMetre: 1 } });
  }
  sheets.push({ title: t('Section'), svg: { text: sectionSvg(p, o.sectionAt), perMetre: 1 } });
  // The area table: each floor with its built and free area, then its rooms.
  if (plans.length) {
    const rows: (string | number)[][] = [];
    const bold = new Set<number>();
    let gross = 0;
    for (const f of plans) {
      bold.add(rows.length);
      rows.push([`${f.building} · ${t(f.level)}`, '', `${num(f.plan.grossArea)} m²`, `${num(f.plan.netArea)} m²`]);
      gross += f.plan.grossArea;
      const rooms = [...f.plan.rooms].sort((a, b) => b.area - a.area);
      for (const r of rooms) rows.push(['', r.name || t('Unnamed room'), '', `${num(r.area)} m²`]);
    }
    bold.add(rows.length);
    rows.push([t('Total built area'), '', `${num(gross)} m²`, '']);
    // About 40 rows fit a sheet: a long table goes on as many sheets as it takes.
    for (let k = 0; k < rows.length; k += 40) {
      const part = new Set([...bold].filter((r) => r >= k && r < k + 40).map((r) => r - k));
      sheets.push({ title: t('Area table'), table: { head: [t('Floor'), t('Room'), t('Built area'), t('Free area')], rows: rows.slice(k, k + 40), bold: part } });
    }
  }

  const date = new Date().toLocaleDateString(dec === ',' ? 'pt-BR' : 'en-GB');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);
  const P = (mm: number) => mm * PT_PER_MM;
  try {
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i]!;
      if (i) doc.addPage('a3', 'landscape');
      // The frame.
      const fx = LEFT,
        fy = EDGE,
        fw = PAGE.w - LEFT - EDGE,
        fh = PAGE.h - 2 * EDGE;
      doc.setDrawColor(30);
      doc.setLineWidth(1);
      doc.rect(P(fx), P(fy), P(fw), P(fh));
      // The drawing area: the frame less a band for the title block.
      const ax = fx + 6,
        ay = fy + 6,
        aw = fw - 12,
        ah = fh - BLOCK.h - 12;
      let scale: number | null = null;
      if (sh.svg) {
        host.innerHTML = sh.svg.text;
        const svg = host.querySelector('svg') as SVGSVGElement | null;
        if (svg) {
          const vb = svg.viewBox.baseVal;
          const w = vb.width / sh.svg.perMetre,
            h = vb.height / sh.svg.perMetre;
          scale = fitScale(w, h, aw, ah);
          const mmW = (w * 1000) / scale,
            mmH = (h * 1000) / scale;
          await doc.svg(svg, { x: P(ax + (aw - mmW) / 2), y: P(ay + (ah - mmH) / 2), width: P(mmW), height: P(mmH) });
        }
      } else if (sh.table) drawTable(doc, sh.table, P(ax), P(ay), P(aw));
      // The title block (bottom right): brand and project, drawing, scale, date, sheet.
      const bx = fx + fw - BLOCK.w,
        by = fy + fh - BLOCK.h;
      doc.setLineWidth(0.8);
      doc.rect(P(bx), P(by), P(BLOCK.w), P(BLOCK.h));
      doc.setLineWidth(0.4);
      doc.line(P(bx), P(by + 12), P(bx + BLOCK.w), P(by + 12));
      doc.line(P(bx), P(by + 24), P(bx + BLOCK.w), P(by + 24));
      doc.line(P(bx + 60), P(by + 24), P(bx + 60), P(by + BLOCK.h));
      doc.line(P(bx + 120), P(by + 24), P(bx + 120), P(by + BLOCK.h));
      const label = (s: string, x: number, y: number) => {
        doc.setFontSize(6.5);
        doc.setTextColor(110);
        doc.text(s.toUpperCase(), P(x), P(y));
      };
      const value = (s: string, x: number, y: number, size = 10, w = 0) => {
        doc.setFontSize(size);
        doc.setTextColor(20);
        doc.text(w ? (doc.splitTextToSize(s, P(w)) as string[])[0]! : s, P(x), P(y));
      };
      label(t('Project'), bx + 3, by + 4);
      value(p.name, bx + 3, by + 9.5, 11, BLOCK.w - 40);
      doc.setFontSize(9);
      doc.setTextColor(60);
      doc.text(BRAND, P(bx + BLOCK.w - 3), P(by + 9.5), { align: 'right' });
      label(t('Drawing'), bx + 3, by + 16);
      value(sh.title, bx + 3, by + 21.5, 10, BLOCK.w - 6);
      label(t('Scale'), bx + 3, by + 28);
      value(scale ? `1:${scale}` : '—', bx + 3, by + 33);
      label(t('Date'), bx + 63, by + 28);
      value(date, bx + 63, by + 33);
      label(t('Sheet'), bx + 123, by + 28);
      value(`${String(i + 1).padStart(2, '0')} / ${String(sheets.length).padStart(2, '0')}`, bx + 123, by + 33);
    }
  } finally {
    host.remove();
  }
  return doc.output('blob');
}

/** A table with a header row, ruled, on the sheet (pt). */
function drawTable(doc: import('jspdf').jsPDF, tb: NonNullable<Sheet['table']>, x: number, y: number, w: number): void {
  const cols = [0.34, 0.34, 0.16, 0.16].map((f) => f * w);
  const rowH = 16;
  let cy = y + 4;
  const row = (cells: (string | number)[], bold: boolean, head = false) => {
    if (head) {
      doc.setFillColor(235, 233, 228);
      doc.rect(x, cy, w, rowH, 'F');
    }
    doc.setFont('helvetica', bold || head ? 'bold' : 'normal');
    doc.setFontSize(head ? 9 : 9.5);
    doc.setTextColor(25);
    let cx = x;
    cells.forEach((c, i) => {
      const right = i >= 2;
      doc.text(String(c), right ? cx + cols[i]! - 6 : cx + 6, cy + rowH - 5, right ? { align: 'right' } : undefined);
      cx += cols[i]!;
    });
    doc.setDrawColor(200);
    doc.setLineWidth(0.4);
    doc.line(x, cy + rowH, x + w, cy + rowH);
    cy += rowH;
  };
  row(tb.head, true, true);
  tb.rows.forEach((r, i) => row(r, tb.bold.has(i)));
  doc.setFont('helvetica', 'normal');
}
