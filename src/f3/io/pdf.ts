// Drawings as a PDF at a true scale (jsPDF + svg2pdf.js: https://github.com/yWorks/svg2pdf.js): the plan
// and the section (plansvg.ts, sectionsvg.ts, both drawn in metres) each on an A3 landscape sheet, at the
// largest standard scale that fits (1:50 … 1:2000), with a title line (project, drawing, scale, date).
// Browser only (svg2pdf needs a real DOM); loaded on demand from the export menu.
import type { Project3 } from '../model/schema';
import { planSvg } from './plansvg';
import { sectionSvg } from './sectionsvg';

const SCALES = [50, 100, 200, 250, 500, 1000, 2000, 5000];
const PT_PER_MM = 72 / 25.4;
/** A3 landscape (mm) and the margins of the drawing area. */
const PAGE = { w: 420, h: 297 };
const MARGIN = 15,
  TITLE = 14;

/** Size (m) of a drawing from its viewBox, given its drawing units per metre. */
function viewSize(svg: SVGSVGElement, perMetre: number): { w: number; h: number } {
  const vb = svg.viewBox.baseVal;
  return { w: vb.width / perMetre, h: vb.height / perMetre };
}

/** The largest standard scale (1:N) at which a drawing of `w` × `h` m fits the area (mm). */
export function fitScale(w: number, h: number, areaW: number, areaH: number): number {
  for (const s of SCALES) if ((w * 1000) / s <= areaW && (h * 1000) / s <= areaH) return s;
  return SCALES[SCALES.length - 1]!;
}

export async function drawingsPdf(p: Project3, sectionAt?: number): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  await import('svg2pdf.js');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
  // [name, SVG, drawing units per metre]: the plan is drawn at 4 units per metre, the section in metres.
  const sheets: [string, string, number][] = [
    ['Plan', planSvg(p), 4],
    ['Section', sectionSvg(p, sectionAt), 1],
  ];
  const date = new Date().toISOString().slice(0, 10);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < sheets.length; i++) {
      const [name, text, perMetre] = sheets[i]!;
      if (i) doc.addPage('a3', 'landscape');
      host.innerHTML = text;
      const svg = host.querySelector('svg') as SVGSVGElement | null;
      if (!svg) continue;
      const { w, h } = viewSize(svg, perMetre);
      const areaW = PAGE.w - 2 * MARGIN,
        areaH = PAGE.h - 2 * MARGIN - TITLE;
      const scale = fitScale(w, h, areaW, areaH);
      const mmW = (w * 1000) / scale,
        mmH = (h * 1000) / scale;
      const x = MARGIN + (areaW - mmW) / 2,
        y = MARGIN + (areaH - mmH) / 2;
      await doc.svg(svg, { x: x * PT_PER_MM, y: y * PT_PER_MM, width: mmW * PT_PER_MM, height: mmH * PT_PER_MM });
      // Sheet frame and title line.
      doc.setDrawColor(40);
      doc.setLineWidth(0.6);
      doc.rect(MARGIN * PT_PER_MM * 0.5, MARGIN * PT_PER_MM * 0.5, (PAGE.w - MARGIN) * PT_PER_MM, (PAGE.h - MARGIN) * PT_PER_MM);
      doc.setFontSize(11);
      doc.setTextColor(30);
      const ty = (PAGE.h - MARGIN - 3) * PT_PER_MM;
      doc.text(`${p.name} — ${name}`, MARGIN * PT_PER_MM, ty);
      doc.text(`Scale 1:${scale} (A3)   ${date}   FORMA`, (PAGE.w - MARGIN) * PT_PER_MM, ty, { align: 'right' });
    }
  } finally {
    host.remove();
  }
  return doc.output('blob');
}
