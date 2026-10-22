// FORMA 3 app (full editor).
import { areasTable, planSvg } from '../f3/io/plansvg';
import { sectionSvg } from '../f3/io/sectionsvg';
import { polylinesToBuildings } from '../f3/io/dxf';
import { readCadDxf } from '../f3/io/cad';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadKernel } from '../f3/kernel/kernel';
import { Editor3 } from '../f3/editor/editor';
import { project } from '../f3/model/defaults';
import { sampleBuildings } from '../f3/model/samples';
import type { Project3 } from '../f3/model/schema';
import { autoVersions, openVersions } from './versions';
import { mountAccount } from './cloud/account';
import type { ProFeature } from './cloud/plans';
import { openStart, type ProjectHost } from './projects';
import { getHistory, putHistory } from '../f3/io/history';
import type { History } from '../f3/editor/store';
import { available as storeAvailable, currentProjectId, getProject, newProjectId, putProject, setCurrentProjectId } from '../f3/io/projects';
import { migrateForma3 } from '../f3/io/migrate';
import { decimal, loadLang, startI18n, tr } from '../f3/ui/i18n';
import { mountInspector } from '../f3/ui/inspector';
import { mountPrefs } from '../f3/ui/prefs';
import { mountCatalog } from '../f3/ui/catalog';
import { mountLayers } from '../f3/ui/layers';
import { mountPalette } from '../f3/ui/palette';
import { mountPlanView } from '../f3/ui/planview';
import { openQuantities } from '../f3/ui/quantities';
import { openTour, type TourPublish } from '../f3/ui/tour';
import { mountPhoto, openPhoto } from '../f3/ui/photo';
import { mountTime } from '../f3/ui/time';
import { mountActions } from '../f3/ui/actions';
import { mountLastOp } from '../f3/ui/lastop';
import { mountViewCube } from '../f3/ui/viewcube';
import { mountInteriorView } from '../f3/ui/interior';
import { mountScenes } from '../f3/ui/scenes';
import { mountLevels } from '../f3/ui/levels';
import { mountToolOptions } from '../f3/ui/options';
import { loadAutosave, saveFile, openFileWithNotes, download, fileName } from '../f3/io/persist';
import { exportGLB, exportOBJ, exportGameJSON, exportGamePackage, exportUSDZ } from '../f3/io/export';

startI18n();
// Development build: the app checks itself while it is used (src/app/sentinel.ts; not in production).
const sentinel = import.meta.env.DEV ? await import('./sentinel') : null;
sentinel?.installSentinel();
// Production build with a DSN: errors customers hit are reported (src/app/monitoring.ts).
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) (await import('./monitoring')).startMonitoring(import.meta.env.VITE_SENTRY_DSN);
await loadKernel(wasmUrl);
let initial: Project3 | undefined;
// The project being edited: its id in the project store (IndexedDB), remembered for the next visit.
let currentId: string | null = currentProjectId();
let firstVisit = false;
// What to say on open: saved project repaired or failed to open (the copy is kept).
let startNote = '';
try {
  const stored = currentId && storeAvailable() ? await getProject(currentId) : undefined;
  if (stored) {
    const m = migrateForma3(JSON.parse(stored.json) as Project3);
    initial = m.project;
    if (m.notes.length) startNote = `Project opened with ${m.notes.length} fix(es): ${m.notes.slice(0, 2).join(' ')}`;
  } else {
    // Before the project store: the single autosave in localStorage becomes the first stored project.
    const r = loadAutosave();
    initial = r.project ?? undefined;
    if (r.error) startNote = `The saved project did not open (${r.error}) A copy was kept in the browser; the samples were opened.`;
    else if (r.notes.length) startNote = `Project opened with ${r.notes.length} fix(es): ${r.notes.slice(0, 2).join(' ')}`;
    if (initial) currentId = newProjectId();
    else firstVisit = true;
  }
} catch {
  initial = undefined;
}
// The first visit opens on the start screen: nothing is built behind it (the eleven samples took the main
// thread for seconds while the visitor chose a template, and the click on it waited for them).
const welcome = firstVisit && !(globalThis as { __orielNoStart?: boolean }).__orielNoStart;
initial ??= welcome ? project({ name: tr('Untitled project') }) : project({ name: tr('Samples'), buildings: sampleBuildings() });
currentId ??= newProjectId();
const editor = new Editor3(document.getElementById('app')!, { project: initial });
mountInspector(editor);
mountPrefs(editor);
mountCatalog(editor);
mountLayers(editor);
mountPalette(editor);
mountTime(editor);
mountActions(editor);
mountLastOp(editor);
mountViewCube(editor);
mountInteriorView(editor);
mountScenes(editor);
mountLevels(editor);
mountToolOptions(editor);
mountPhoto(editor);
mountPlanView(editor);
// Account and cloud (only when this build has a cloud configured: cloud/api.ts).
const account = mountAccount(editor, () => currentId!);
editor.quantitiesRequested = () => openQuantities(editor);
editor.tourRequested = () => openTour(editor, tourPublish());

// ── Virtual tour: the site (one HTML file) and the installable app (PWA in a ZIP), io/tour.ts ──
async function tourParts() {
  editor.toast('Preparing the virtual tour…');
  const { optimizeGlb } = await import('../f3/io/glbopt');
  const tour = await import('../f3/io/tour');
  // Hollow (walls with their thickness, a slab per floor, the interior walls): the visitor walks inside.
  const glb = await optimizeGlb(new Uint8Array(await exportGLB(editor.project, { expandInstances: true, hollow: true })), { maxTexture: 1024 });
  const pt = loadLang() === 'pt-BR';
  const data = tour.tourData(editor.project, glb, { t: tr, decimal: pt ? ',' : '.', lang: pt ? 'pt-BR' : 'en' });
  const runtime = await tour.tourRuntime();
  return { tour, data, runtime };
}

/** A square PNG icon of the app: the current view of the model under the project's initials. */
async function tourIcon(size: number): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b1c1f';
  g.fillRect(0, 0, size, size);
  try {
    const v = editor.view;
    v.renderer.render(v.scene, v.camera);
    const src = v.renderer.domElement;
    const s = Math.min(src.width, src.height);
    g.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
  } catch {
    // The initials alone.
  }
  const grad = g.createLinearGradient(0, size * 0.45, 0, size);
  grad.addColorStop(0, 'rgba(27,28,31,0)');
  grad.addColorStop(1, 'rgba(27,28,31,0.92)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const initials = (editor.project.tour?.title || editor.project.name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'O';
  g.fillStyle = '#ffffff';
  g.font = `700 ${Math.round(size * 0.26)}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(initials, size / 2, size * 0.86);
  g.fillStyle = '#e86a1e';
  g.fillRect(size * 0.38, size * 0.9, size * 0.24, size * 0.025);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  return new Uint8Array(await blob!.arrayBuffer());
}

function tourPublish(): TourPublish {
  return {
    autoStops: async () => (await import('../f3/io/tour')).autoStops(editor.project, () => crypto.randomUUID(), tr),
    preview: async () => {
      // Opened at the click (a window opened after the wait would be blocked as a popup).
      const w = window.open('', '_blank');
      const { tour, data, runtime } = await tourParts();
      const url = URL.createObjectURL(new Blob([tour.tourHtml(data, runtime)], { type: 'text/html' }));
      if (w) w.location.href = url;
      else window.open(url, '_blank');
      editor.toast('Preview opened in a new tab.');
    },
    site: async () => {
      if (!account.gate('tour')) return;
      const { tour, data, runtime } = await tourParts();
      download(tour.tourHtml(data, runtime), fileName(tr(editor.project.name) + '-tour', 'html'), 'text/html');
      editor.toast('Site ready: open it in any browser, or put it on a host to share the link.');
    },
    app: async () => {
      if (!account.gate('tour')) return;
      const { tour, data, runtime } = await tourParts();
      const zip = tour.tourApp(data, runtime, { s192: await tourIcon(192), s512: await tourIcon(512) }, tr);
      download(zip as BlobPart, fileName(tr(editor.project.name) + '-app', 'zip'), 'application/zip');
      editor.toast('App ready: put the folder on a host (see HOW-TO-PUBLISH); phones install it from the address.');
    },
  };
}
(globalThis as { forma3?: Editor3 }).forma3 = editor;
sentinel?.watchEditor(editor);
if (startNote) editor.toast(startNote);

// Autosave into the project store; localStorage only where IndexedDB is missing. The undo steps follow
// a moment after the edits stop (io/history.ts) and come back on the next visit.
let historyTimer = 0;
editor.persist = async (json) => {
  if (!storeAvailable()) return localStorage.setItem('forma3_project', json);
  await putProject(currentId!, editor.project, json);
  setCurrentProjectId(currentId!);
  account.push(currentId!, json);
  clearTimeout(historyTimer);
  const id = currentId!;
  historyTimer = window.setTimeout(() => void putHistory(id, editor.store.snapshot()), 1200);
};
if (!firstVisit && storeAvailable()) {
  const h = await getHistory<History>(currentId);
  if (h) editor.store.adopt(h);
}
if (!firstVisit && storeAvailable()) void Promise.resolve(editor.persist(editor.store.json())).catch(() => undefined);
const projects: ProjectHost = {
  account,
  currentId: () => currentId!,
  open(p, id, message) {
    currentId = id ?? newProjectId();
    setCurrentProjectId(currentId);
    editor.store.replace(p, message, true);
    editor.shell.name.value = p.name;
    editor.enter(null);
    editor.view.frame();
    editor.toast(message);
    void editor.persist(editor.store.json());
  },
};
if (welcome) openStart(editor, projects, true);

const root = editor.shell.root;
const fileInput = root.querySelector<HTMLInputElement>('[data-file="project"]')!;
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  // A DXF drawing: its closed outlines become buildings added to the project (one step, Ctrl+Z undoes).
  if (/\.dxf$/i.test(f.name)) {
    const polys = await readCadDxf(await f.text());
    // Contour lines of a survey shape the ground; the other closed outlines become buildings.
    const { contoursToTerrain, isContour } = await import('../f3/io/dxf');
    const pts = contoursToTerrain(polys, () => crypto.randomUUID());
    if (pts.length) {
      editor.changeSite((p) => void (p.terrain = { points: pts }), `Terrain from ${polys.filter(isContour).length} contour line(s): ${pts.length} points.`);
      editor.view.frame();
    }
    const bs = polylinesToBuildings(polys.filter((pl) => !isContour(pl)), { height: 6, levels: 2 });
    if (!bs.length) return void (pts.length || editor.toast('No closed outline of at least 1 m² in that drawing.'));
    editor.store.project.buildings.push(...bs);
    editor.store.commit(bs.map((b) => b.id), 'DXF imported.');
    editor.view.frame();
    editor.toast(pts.length ? `${bs.length} building(s) and the terrain from the contour lines.` : `${bs.length} building(s) made from the DXF outlines (6 m, 2 floors): change their height as usual.`);
    return;
  }
  try {
    const m = await openFileWithNotes(f);
    editor.store.replace(m.project, 'Project opened.');
    editor.shell.name.value = m.project.name;
    editor.enter(null);
    editor.view.frame();
    editor.toast(m.notes.length ? `Project opened (${m.notes.length} fix(es) during conversion).` : 'Project opened.');
  } catch (e) {
    editor.toast(`Could not open: ${(e as Error).message}`);
  }
});

function exportMenu(anchor: HTMLElement): void {
  // Only a previous export menu goes (the project menu is also an .f3-menu and must stay).
  document.querySelector('.f3-menu[data-menu-of="export"]')?.remove();
  const m = document.createElement('div');
  m.className = 'f3-menu';
  m.dataset.menuOf = 'export';
  m.setAttribute('role', 'menu');
  // Grouped by what people deliver: drawings first, then BIM and 3D, the project file, game engines last.
  const items: [string, string, (() => Promise<void> | void) | null, ProFeature?][] = [
    ['Client', '', null],
    ['Virtual tour…', '', () => openTour(editor, tourPublish())],
    ['Photoreal render…', '', () => openPhoto(editor)],
    ['Client presentation', '.html', async () => {
      editor.toast('Preparing the presentation…');
      const { optimizeGlb } = await import('../f3/io/glbopt');
      const { presentationHtml } = await import('../f3/io/presentation');
      // Plain meshes: the viewer's scene graph and the iPhone AR (USDZ) take no GPU instances.
      const glb = await optimizeGlb(new Uint8Array(await exportGLB(editor.project, { expandInstances: true })), { maxTexture: 1024 });
      const pt = loadLang() === 'pt-BR';
      const html = presentationHtml(editor.project, glb, { t: tr, decimal: pt ? ',' : '.', lang: pt ? 'pt-BR' : 'en' });
      download(html, fileName(tr(editor.project.name) + '-presentation', 'html'), 'text/html');
      editor.toast('Presentation ready: send the file to the client; it opens in any browser.');
    }, 'presentation'],
    ['Drawings', '', null],
    ['Drawing set', '.pdf', async () => {
      const b = editor.store.building(editor.sel.building ?? editor.context);
      const { drawingsPdf } = await import('../f3/io/pdf');
      download(await drawingsPdf(editor.project, { sectionAt: b ? b.position[1] : undefined, t: tr, decimal: loadLang() === 'pt-BR' ? ',' : '.' }), fileName(tr(editor.project.name) + '-drawings', 'pdf'), 'application/pdf');
    }],
    ['Site plan', '.svg', () => download(planSvg(editor.project), fileName(tr(editor.project.name) + '-site', 'svg'), 'image/svg+xml')],
    ['Elevations for CAD', '.dxf', async () => {
      const { elevationsDxf } = await import('../f3/io/elevationdxf');
      const d = elevationsDxf(editor.project, loadLang() === 'pt-BR' ? ',' : '.', tr);
      if (!d) return editor.toast('Nothing to draw yet.');
      download(d, fileName(tr(editor.project.name) + '-elevations', 'dxf'), 'application/dxf');
    }, 'dxf'],
    ['Floor plans for CAD', '.dxf', async () => {
      const { collectFloorPlans, floorPlansToDxf } = await import('../f3/io/cadplan');
      const plans = collectFloorPlans(editor.project, (id) => editor.view.built.get(id)?.ev.placements ?? [], tr);
      if (!plans.length) return editor.toast('Nothing to draw yet.');
      download(floorPlansToDxf(plans, decimal), fileName(tr(editor.project.name) + '-plans', 'dxf'), 'application/dxf');
    }, 'dxf'],
    ['Floor plan', '.svg', async () => {
      const { collectFloorPlans, floorPlanSvgFile } = await import('../f3/io/cadplan');
      const sel = editor.store.building(editor.sel.building ?? editor.context);
      const plans = collectFloorPlans(editor.project, (id) => editor.view.built.get(id)?.ev.placements ?? [], tr);
      const first = plans.find((x) => !sel || x.fp.building === sel.id) ?? plans[0];
      if (!first) return editor.toast('Nothing to draw yet.');
      download(floorPlanSvgFile(first.fp, first.title, loadLang() === 'pt-BR' ? ',' : '.', tr, first.site), fileName(tr(editor.project.name) + '-plan', 'svg'), 'image/svg+xml');
    }],
    ['Section', '.svg', () => {
      // Through the selected building, else through the middle of them all.
      const b = editor.store.building(editor.sel.building ?? editor.context);
      download(sectionSvg(editor.project, b ? b.position[1] : undefined, loadLang() === 'pt-BR' ? ',' : '.', tr), fileName(tr(editor.project.name) + '-section', 'svg'), 'image/svg+xml');
    }],
    ['Elevations', '.zip', async () => {
      // The four sides, one SVG each, in one archive (four downloads at once would be blocked).
      const [{ elevationSvg, ELEVATION_NAMES }, { zipStore }] = await Promise.all([import('../f3/io/elevationsvg'), import('../f3/io/zip')]);
      const dec = loadLang() === 'pt-BR' ? ',' : '.';
      const sides = Object.keys(ELEVATION_NAMES) as (keyof typeof ELEVATION_NAMES)[];
      const files = sides.map((s) => ({ name: fileName(`${editor.project.name}-${tr(ELEVATION_NAMES[s])}`, 'svg'), data: elevationSvg(editor.project, s, dec, tr) }));
      download(zipStore(files) as BlobPart, fileName(tr(editor.project.name) + '-elevations', 'zip'), 'application/zip');
    }],
    ['Quantities and cost…', '', () => openQuantities(editor)],
    ['Room schedule', '.csv', async () => {
      const { roomScheduleCsv } = await import('../f3/io/schedule');
      // A byte order mark: spreadsheets read the accents as UTF-8.
      download('﻿' + roomScheduleCsv(editor.project, loadLang() === 'pt-BR' ? ',' : '.', tr), fileName(tr(editor.project.name) + '-rooms', 'csv'), 'text/csv');
    }],
    ['Areas', '.csv', () => download(['building;footprint m2;gross floor area m2;volume m3', ...areasTable(editor.project).map((r) => [r.building, r.footprint, r.gfa, r.volume].join(';'))].join('\n'), fileName(tr(editor.project.name) + '-areas', 'csv'), 'text/csv')],
    ['BIM and 3D', '', null],
    ['BIM model', '.ifc', async () => {
      const { exportIFC } = await import('../f3/io/ifc');
      download(exportIFC(editor.project, tr), fileName(tr(editor.project.name), 'ifc'), 'application/x-step');
    }, 'ifc'],
    ['3D model', '.glb', async () => download(await exportGLB(editor.project), fileName(tr(editor.project.name), 'glb'), 'model/gltf-binary')],
    ['3D model, compact', '.glb', async () => {
      const { optimizeGlb } = await import('../f3/io/glbopt');
      download(await optimizeGlb(new Uint8Array(await exportGLB(editor.project)), { maxTexture: 1024, meshopt: true }) as BlobPart, fileName(tr(editor.project.name) + '-compact', 'glb'), 'model/gltf-binary');
    }, 'compact'],
    ['Geometry', '.obj', async () => download(await exportOBJ(editor.project), fileName(tr(editor.project.name), 'obj'), 'text/plain')],
    ['AR on iPhone and iPad', '.usdz', async () => download((await exportUSDZ(editor.project)) as BlobPart, fileName(tr(editor.project.name), 'usdz'), 'model/vnd.usdz+zip')],
    ['Image of the view', '.png', () => {
      editor.view.look.render();
      editor.view.renderer.domElement.toBlob((b) => b && download(b, fileName(tr(editor.project.name), 'png'), 'image/png'));
    }],
    ['Project', '', null],
    ['Project file', '.json', () => saveFile(editor.project)],
    ['Game engines', '', null],
    ['Game package', '.zip', async () => download(await exportGamePackage(editor.project) as BlobPart, fileName(tr(editor.project.name) + '-game', 'zip'), 'application/zip'), 'game'],
    ['Game data', '.json', () => download(exportGameJSON(editor.project), fileName(tr(editor.project.name) + '-game', 'json'), 'application/json'), 'game'],
  ];
  // Pro deliveries carry a badge on the free plan; choosing one opens the plans instead.
  const locked = (f?: ProFeature) => !!f && account.enabled && account.plan() !== 'pro';
  m.innerHTML = items.map(([l, ext, run, f], i) => (run ? `<button data-i="${i}">${l}<small>${locked(f) ? '<em class="f3-pro">PRO</em>' : ''}${ext}</small></button>` : `<div class="f3-menu-h">${l}</div>`)).join('');
  root.appendChild(m);
  const r = anchor.getBoundingClientRect(),
    rr = root.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.left - rr.left, rr.width - m.offsetWidth - 8))}px`;
  m.style.top = `${r.bottom - rr.top + 4}px`;
  m.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', async () => {
      m.remove();
      const f = items[Number(b.dataset.i)]![3];
      if (f && !account.gate(f)) return;
      try {
        editor.toast('Exporting…');
        await items[Number(b.dataset.i)]![2]!();
        editor.toast('Exported.');
      } catch (e) {
        editor.toast(`Failed: ${(e as Error).message}`);
      }
    }),
  );
  // At once, not on a timer: the menu opens on a click, after its own pointerdown, and a busy frame could
  // delay a timer past the next click. A press inside the menu keeps it (and keeps this listener).
  const onDown = (e: PointerEvent) => {
    if (m.isConnected && m.contains(e.target as Node)) return;
    m.remove();
    document.removeEventListener('pointerdown', onDown, true);
  };
  document.addEventListener('pointerdown', onDown, true);
  // Esc closes it and gives the focus back to the button (menu button pattern), before the editor sees the key.
  const onKey = (e: KeyboardEvent) => {
    if (!m.isConnected) return document.removeEventListener('keydown', onKey, true);
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    m.remove();
    anchor.focus();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
}

editor.topCommand = (cmd) => {
  const btn = root.querySelector<HTMLElement>(`[data-cmd="${cmd}"]`)!;
  if (cmd === 'new' || cmd === 'templates' || cmd === 'projects') {
    openStart(editor, projects);
    return true;
  }
  if (cmd === 'open') {
    fileInput.click();
    return true;
  }
  if (cmd === 'save') {
    saveFile(editor.project);
    editor.toast('Project saved (.json).');
    return true;
  }
  if (cmd === 'export') {
    exportMenu(btn);
    return true;
  }
  if (cmd === 'versions') {
    openVersions(editor, { account, id: currentId! });
    return true;
  }
  return false;
};
editor.saveRequested = () => editor.topCommand?.('save');
autoVersions(editor);
