// A presentation for the client in one HTML file: the 3D model to turn and zoom with a finger or the
// mouse (Google's <model-viewer>, https://modelviewer.dev/, loaded from jsDelivr; AR on phones that have
// it), every floor plan with its rooms and areas, and the area table. The model travels inside the file
// (a GLB as a data URL), so the file can be sent by e-mail or a message and opened anywhere with a
// browser; only the viewer script comes from the network.
import { BRAND } from '../model/brand';
import type { Project3 } from '../model/schema';
import { floorPlanSvg } from '../eval/floorplansvg';
import { projectPlans } from './pdf';

const VIEWER = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export interface PresentationOptions {
  t?: (english: string) => string;
  decimal?: string;
  lang?: string;
}

export function presentationHtml(p: Project3, glb: Uint8Array, o: PresentationOptions = {}): string {
  const t = o.t ?? ((s: string) => s);
  const dec = o.decimal ?? '.';
  const num = (v: number) => v.toFixed(2).replace('.', dec);
  const plans = projectPlans(p);
  const gross = plans.reduce((s, f) => s + f.plan.grossArea, 0);
  const date = new Date().toLocaleDateString(o.lang ?? 'pt-BR');
  const planHtml = plans
    .map((f) => {
      const svg = floorPlanSvg(f.plan, { decimal: dec, t }).svg;
      return `<figure><figcaption>${esc(t('Floor plan'))} · ${esc(t(f.level))} · ${esc(f.building)}</figcaption>${svg}</figure>`;
    })
    .join('');
  const rows = plans
    .map(
      (f) =>
        `<tr class="lv"><td>${esc(f.building)} · ${esc(t(f.level))}</td><td>${num(f.plan.grossArea)} m²</td></tr>` +
        [...f.plan.rooms]
          .sort((a, b) => b.area - a.area)
          .map((r) => `<tr><td class="in">${esc(r.name || t('Unnamed room'))}</td><td>${num(r.area)} m²</td></tr>`)
          .join(''),
    )
    .join('');
  return `<!doctype html>
<html lang="${esc(o.lang ?? 'pt-BR')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.name)} · ${esc(BRAND)}</title>
<script type="module" src="${VIEWER}"></script>
<style>
:root{--ink:#1e2024;--muted:#6b6760;--line:#e4e1da;--accent:#e86a1e;--bg:#f6f4ef}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
header{display:flex;align-items:baseline;gap:12px;padding:18px 20px 8px;max-width:1100px;margin:auto;flex-wrap:wrap}
header h1{margin:0;font-size:24px}header small{color:var(--muted)}header .brand{margin-left:auto;color:var(--accent);font-weight:600;letter-spacing:.2em;font-size:12px}
main{max-width:1100px;margin:auto;padding:0 16px 40px}
model-viewer{width:100%;height:min(70vh,640px);background:linear-gradient(#e9e6df,#f8f6f2);border-radius:14px;--poster-color:transparent}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}
.stats div{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.stats b{display:block;font-size:20px}
.stats span{color:var(--muted);font-size:12.5px}
h2{font-size:18px;margin:28px 0 10px}
figure{margin:0 0 18px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}
figcaption{font-weight:600;margin-bottom:6px}
figure svg{width:100%;height:auto;max-height:80vh;display:block}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
td{padding:8px 12px;border-top:1px solid var(--line)}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
tr.lv td{font-weight:600;background:#faf8f4}td.in{padding-left:28px}
footer{color:var(--muted);font-size:12.5px;text-align:center;padding:20px}
.hint{color:var(--muted);font-size:13px;margin:6px 2px 0}
</style></head><body>
<header><h1>${esc(p.name)}</h1><small>${esc(date)}</small><span class="brand">${esc(BRAND.toUpperCase())}</span></header>
<main>
<model-viewer src="data:model/gltf-binary;base64,${base64(glb)}" alt="${esc(p.name)}" camera-controls touch-action="pan-y" auto-rotate shadow-intensity="1" exposure="1" ar ar-modes="webxr scene-viewer quick-look"></model-viewer>
<p class="hint">${esc(t('Drag to turn the model, pinch or scroll to zoom. On a phone, the AR button places it in your space.'))}</p>
<div class="stats"><div><b>${num(gross)} m²</b><span>${esc(t('Built area'))}</span></div><div><b>${plans.length}</b><span>${esc(t('Floor plans'))}</span></div><div><b>${plans.reduce((s, f) => s + f.plan.rooms.filter((r) => r.name).length, 0)}</b><span>${esc(t('Rooms'))}</span></div></div>
${plans.length ? `<h2>${esc(t('Floor plans'))}</h2>${planHtml}<h2>${esc(t('Area table'))}</h2><table>${rows}<tr class="lv"><td>${esc(t('Total built area'))}</td><td>${num(gross)} m²</td></tr></table>` : ''}
</main>
<footer>${esc(t('Made with'))} ${esc(BRAND)}</footer>
</body></html>`;
}
