// Workspaces (Blender, Fusion): presets of the same document for a task. A switch never edits the
// project (no history step, no save): it only filters the tool bar, the actions next to the selection
// and the handles, and opens what the task needs (the library on a tab, the interior panel). The choice
// is a preference of this browser. Keys: Alt+PageUp / Alt+PageDown (Chrome keeps Ctrl+PageUp/PageDown
// for its tabs), and Ctrl+K "Workspace: …". Design: docs/research/workspaces-and-nodes.md, part A.
import type { Editor3, Tool } from '../editor/editor';

export type WorkspaceId = 'model' | 'components' | 'materials' | 'interior' | 'present';

export interface WorkspaceDef {
  label: string;
  title: string;
  /** Tools on the bar ('all': every one). */
  tools: Tool[] | 'all';
  entry: Tool;
  /** Library: opened on this tab, or closed. */
  library: string | null;
  /** The interior view panel opens. */
  interior?: boolean;
  /** Look only: no handles, no contextual bar, no editing tool. */
  present?: boolean;
}

export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  model: { label: 'Model', title: 'Massing and volumes: every tool', tools: 'all', entry: 'select', library: null },
  components: { label: 'Components', title: 'Windows, doors, balconies, facade rules and free parts', tools: ['select', 'move', 'rotate', 'opening', 'place', 'tape'], entry: 'select', library: 'windows' },
  materials: { label: 'Materials', title: 'Finishes and paint', tools: ['select', 'paint'], entry: 'select', library: 'materials' },
  interior: { label: 'Interior', title: 'Floors, cuts and the inside of the buildings', tools: ['select', 'tape', 'iwall', 'room', 'slab', 'column', 'beam', 'stair', 'opening', 'place'], entry: 'select', library: null, interior: true },
  present: { label: 'Present', title: 'Look, compare, export: no editing handles', tools: ['select'], entry: 'select', library: null, present: true },
};

const ORDER: WorkspaceId[] = ['model', 'components', 'materials', 'interior', 'present'];
const KEY = 'forma3_workspace';

function load(): WorkspaceId {
  try {
    const v = localStorage.getItem(KEY) as WorkspaceId | null;
    return v && v in WORKSPACES ? v : 'model';
  } catch {
    return 'model';
  }
}

export function mountWorkspaces(ed: Editor3): { set(id: WorkspaceId): void } {
  const bar = document.createElement('div');
  bar.className = 'f3-ws';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Workspaces');
  bar.innerHTML = ORDER.map((id) => `<button role="tab" data-ws="${id}" title="${WORKSPACES[id].title} · Alt+PageUp/PageDown">${WORKSPACES[id].label}</button>`).join('');
  ed.shell.top.querySelector('.f3-saved')?.after(bar);
  let current: WorkspaceId = load();

  const set = (id: WorkspaceId, quiet = false) => {
    current = id;
    const w = WORKSPACES[id];
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // The choice lasts for this page.
    }
    bar.querySelectorAll<HTMLButtonElement>('[data-ws]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ws === id)));
    ed.setWorkspace(id, w.tools === 'all' ? null : new Set(w.tools), !!w.present);
    if (w.library) {
      ed.toggleLibrary(true);
      ed.shell.cat.querySelector<HTMLButtonElement>(`[data-tab="${w.library}"]`)?.click();
    } else ed.toggleLibrary(false);
    // The interior panel: opened in Interior, closed when leaving it (the view state stays as set).
    const intBtn = ed.shell.viewbar.querySelector<HTMLButtonElement>('[aria-label="Interior view"]');
    const intPop = ed.shell.root.querySelector<HTMLElement>('.f3-interior');
    if (intBtn && intPop && intPop.hidden === !!w.interior) intBtn.click();
    if (!quiet) ed.toast(`${w.label} workspace.`);
  };
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ws]');
    if (b) set(b.dataset.ws as WorkspaceId);
  });
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'PageUp' && e.key !== 'PageDown')) return;
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    const i = ORDER.indexOf(current);
    set(ORDER[(i + (e.key === 'PageDown' ? 1 : ORDER.length - 1)) % ORDER.length]!);
    e.preventDefault();
  });
  ed.workspaceRequested = (id) => set(id as WorkspaceId);
  set(current, true);
  return { set };
}
