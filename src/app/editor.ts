// FORMA 3 app (full editor).
import { planSvg, areasTable } from '../f3/io/plansvg';
import { sectionSvg } from '../f3/io/sectionsvg';
import { polylinesToBuildings } from '../f3/io/dxf';
import { planToCadDxf, readCadDxf } from '../f3/io/cad';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadKernel } from '../f3/kernel/kernel';
import { Editor3 } from '../f3/editor/editor';
import { project } from '../f3/model/defaults';
import { sampleBuildings } from '../f3/model/samples';
import type { Project3 } from '../f3/model/schema';
import { autoVersions, openVersions } from './versions';
import { mountInspector } from '../f3/ui/inspector';
import { mountPrefs } from '../f3/ui/prefs';
import { mountWorkspaces } from '../f3/ui/workspaces';
import { mountCatalog } from '../f3/ui/catalog';
import { mountLayers } from '../f3/ui/layers';
import { mountPalette } from '../f3/ui/palette';
import { mountTime } from '../f3/ui/time';
import { mountActions } from '../f3/ui/actions';
import { mountLastOp } from '../f3/ui/lastop';
import { mountViewCube } from '../f3/ui/viewcube';
import { mountInteriorView } from '../f3/ui/interior';
import { loadAutosave, saveFile, openFileWithNotes, download, fileName } from '../f3/io/persist';
import { exportGLB, exportOBJ, exportGameJSON, exportGamePackage, exportUSDZ } from '../f3/io/export';

await loadKernel(wasmUrl);
let initial: Project3 | undefined;
// What to say on open: saved project repaired or failed to open (the copy is kept).
let startNote = '';
try {
  const r = loadAutosave();
  initial = r.project ?? undefined;
  if (r.error) startNote = `The saved project did not open (${r.error}) A copy was kept in the browser; the samples were opened.`;
  else if (r.notes.length) startNote = `Project opened with ${r.notes.length} fix(es): ${r.notes.slice(0, 2).join(' ')}`;
} catch {
  initial = undefined;
}
initial ??= project({ name: 'Samples', buildings: sampleBuildings() });
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
mountWorkspaces(editor);
(globalThis as { forma3?: Editor3 }).forma3 = editor;
if (startNote) editor.toast(startNote);

const root = editor.shell.root;
const fileInput = root.querySelector<HTMLInputElement>('[data-file="project"]')!;
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f) return;
  // A DXF drawing: its closed outlines become buildings added to the project (one step, Ctrl+Z undoes).
  if (/\.dxf$/i.test(f.name)) {
    const bs = polylinesToBuildings(await readCadDxf(await f.text()), { height: 6, levels: 2 });
    if (!bs.length) return void editor.toast('No closed outline of at least 1 m² in that drawing.');
    editor.store.project.buildings.push(...bs);
    editor.store.commit(bs.map((b) => b.id), 'DXF imported.');
    editor.view.frame();
    editor.toast(`${bs.length} building(s) made from the DXF outlines (6 m, 2 floors): change their height as usual.`);
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
  const items: [string, string, () => Promise<void> | void][] = [
    ['3D model (GLB)', '.glb', async () => download(await exportGLB(editor.project), fileName(editor.project.name, 'glb'), 'model/gltf-binary')],
    ['3D model, compact (GLB, meshopt + WebP)', '.glb', async () => {
      const { optimizeGlb } = await import('../f3/io/glbopt');
      download(await optimizeGlb(new Uint8Array(await exportGLB(editor.project)), { maxTexture: 1024, meshopt: true }) as BlobPart, fileName(editor.project.name + '-compact', 'glb'), 'model/gltf-binary');
    }],
    ['BIM model (IFC4)', '.ifc', async () => {
      const { exportIFC } = await import('../f3/io/ifc');
      download(exportIFC(editor.project), fileName(editor.project.name, 'ifc'), 'application/x-step');
    }],
    ['For AR on iPhone/iPad (USDZ)', '.usdz', async () => download((await exportUSDZ(editor.project)) as BlobPart, fileName(editor.project.name, 'usdz'), 'model/vnd.usdz+zip')],
    ['Geometry (OBJ)', '.obj', async () => download(await exportOBJ(editor.project), fileName(editor.project.name, 'obj'), 'text/plain')],
    ['For the game (models, ZIP)', '.zip', async () => download(await exportGamePackage(editor.project) as BlobPart, fileName(editor.project.name + '-game', 'zip'), 'application/zip')],
    ['For the game (JSON)', '.json', () => download(exportGameJSON(editor.project), fileName(editor.project.name + '-game', 'json'), 'application/json')],
    ['View image (PNG)', '.png', () => {
      editor.view.look.render();
      editor.view.renderer.domElement.toBlob((b) => b && download(b, fileName(editor.project.name, 'png'), 'image/png'));
    }],
    ['Plan drawing (SVG)', '.svg', () => download(planSvg(editor.project), fileName(editor.project.name + '-plan', 'svg'), 'image/svg+xml')],
    ['Section drawing (SVG)', '.svg', () => {
      // Through the selected building, else through the middle of them all.
      const b = editor.store.building(editor.sel.building ?? editor.context);
      download(sectionSvg(editor.project, b ? b.position[1] : undefined), fileName(editor.project.name + '-section', 'svg'), 'image/svg+xml');
    }],
    ['Plan and section at scale (PDF)', '.pdf', async () => {
      const b = editor.store.building(editor.sel.building ?? editor.context);
      const { drawingsPdf } = await import('../f3/io/pdf');
      download(await drawingsPdf(editor.project, b ? b.position[1] : undefined), fileName(editor.project.name + '-drawings', 'pdf'), 'application/pdf');
    }],
    ['Plan for CAD (DXF)', '.dxf', () => download(planToCadDxf(editor.project), fileName(editor.project.name + '-plan', 'dxf'), 'application/dxf')],
    ['Areas (CSV)', '.csv', () => download(['building;footprint m2;gross floor area m2;volume m3', ...areasTable(editor.project).map((r) => [r.building, r.footprint, r.gfa, r.volume].join(';'))].join('\n'), fileName(editor.project.name + '-areas', 'csv'), 'text/csv')],
    ['Editable project (JSON)', '.json', () => saveFile(editor.project)],
  ];
  m.innerHTML = items.map(([l, ext], i) => `<button data-i="${i}">${l}<small>${ext}</small></button>`).join('');
  root.appendChild(m);
  const r = anchor.getBoundingClientRect(),
    rr = root.getBoundingClientRect();
  m.style.left = `${Math.min(r.left - rr.left, rr.width - 240)}px`;
  m.style.top = `${r.bottom - rr.top + 4}px`;
  m.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', async () => {
      m.remove();
      try {
        editor.toast('Exporting…');
        await items[Number(b.dataset.i)]![2]();
        editor.toast('Exported.');
      } catch (e) {
        editor.toast(`Failed: ${(e as Error).message}`);
      }
    }),
  );
  setTimeout(() => document.addEventListener('pointerdown', (e) => !m.contains(e.target as Node) && m.remove(), { once: true }), 0);
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
  if (cmd === 'new') {
    editor.store.replace(project(), 'New project.');
    editor.shell.name.value = 'Untitled project';
    editor.enter(null);
    editor.view.frame();
    editor.toast('New project. Ctrl+Z goes back to the previous one.');
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
    openVersions(editor);
    return true;
  }
  if (cmd === 'templates') {
    editor.store.replace(project({ name: 'Samples', buildings: sampleBuildings() }), 'Samples loaded.');
    editor.view.frame();
    editor.toast('Samples loaded. Ctrl+Z goes back.');
    return true;
  }
  return false;
};
editor.saveRequested = () => editor.topCommand?.('save');
autoVersions(editor);
