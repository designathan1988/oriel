// The sentinel of the development build (`import.meta.env.DEV` only; the production bundle does not
// contain this file): the app checks itself while it is used, at no cost to anyone's time. Every
// exception, rejected promise, console error (three.js reports shader errors there), lost WebGL
// context, kernel mesh Manifold refused (f3/kernel/kernel.ts usable) and document that would not open
// again (validated after every history step) is collected in f3/kernel/problems.ts and shown in a
// panel at the bottom left: red for errors, amber for warnings only. So every look at the editor,
// a person's or a screenshot's, is also a check. Text shown in English in the Portuguese interface is a
// warning too (a gap in the dictionary). `globalThis.forma3Problems()` lists them (the smoke
// check, e2e/smoke.spec.ts, fails on any error).
import type { Editor3 } from '../f3/editor/editor';
import { validateForma3 } from '../f3/io/migrate';
import { clearProblems, onProblem, problems, report, type Problem } from '../f3/kernel/problems';
import { onMissingTranslation } from '../f3/ui/i18n';

let installed = false;

/** Catches what goes wrong anywhere on the page, from the first script on (before the editor exists). */
export function installSentinel(): void {
  if (installed) return;
  installed = true;
  addEventListener('error', (e) => {
    // A resource that failed to load (an image, a script) has no error object, only its element.
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno}:${e.colno})` : '';
    report('error', 'exception', `${e.error instanceof Error ? e.error.message : e.message}${where}`);
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    report('error', 'promise', r instanceof Error ? r.message : String(r));
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    report('error', 'console', args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ').slice(0, 600));
  };
  (globalThis as { forma3Problems?: () => Problem[] }).forma3Problems = problems;
  onProblem(() => queueMicrotask(draw));
  // English shown in the Portuguese interface: a gap in src/f3/ui/i18n/pt-BR.json.
  onMissingTranslation((text) => report('warning', 'i18n', text.slice(0, 300)));
}

/** What only the editor can tell: its WebGL context and its document. */
export function watchEditor(ed: Editor3): void {
  const canvas = ed.view.renderer.domElement;
  canvas.addEventListener('webglcontextlost', () => report('error', 'webgl', 'The WebGL context was lost (the GPU was reset or ran out of memory).'));
  ed.store.on((e) => {
    if (e.kind !== 'history') return;
    // The document as it would be saved and opened again: anything the validator refuses would be
    // refused on the next open (or repaired with a note), so it is an error of the edit that made it.
    for (const m of validateForma3(JSON.parse(ed.store.json()))) report('error', 'document', m);
  });
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

let panel: HTMLElement | null = null;

function draw(): void {
  const list = problems();
  if (!list.length) {
    panel?.remove();
    panel = null;
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'f3-sentinel';
    panel.setAttribute('role', 'alert');
    panel.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:100000;max-width:min(640px,calc(100vw - 24px));max-height:40vh;overflow:auto;' +
      'font:12px/1.4 ui-monospace,Consolas,monospace;color:#fff;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.35);padding:8px 10px';
    panel.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !panel) return;
      if (b.dataset.clear !== undefined) clearProblems();
      else if (b.dataset.fold !== undefined) panel.dataset.folded = panel.dataset.folded ? '' : '1';
      draw();
    });
    document.body.append(panel);
  }
  const errors = list.filter((p) => p.severity === 'error').length;
  panel.style.background = errors ? '#b3261e' : '#8a5a00';
  const head = `<div style="display:flex;gap:8px;align-items:center"><b style="flex:1">Sentinel: ${errors} error(s), ${list.length - errors} warning(s)</b>` +
    '<button data-fold style="font:inherit">Fold</button><button data-clear style="font:inherit">Clear</button></div>';
  const rows = panel.dataset.folded
    ? ''
    : list.map((p) => `<div style="margin-top:4px;white-space:pre-wrap;word-break:break-word">[${p.severity} · ${p.source}${p.count > 1 ? ` · ×${p.count}` : ''}] ${escapeHtml(p.message)}</div>`).join('');
  panel.innerHTML = head + rows;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
