// Workspaces (Blender, Fusion): presets of the same document for a task. A switch never edits the
// project (no history step, no save): it only filters the tool bar, the actions next to the selection
// and the handles, and opens what the task needs (the library on a tab, the interior panel). The choice
// is a preference of this browser. Keys: Alt+PageUp / Alt+PageDown (Chrome keeps Ctrl+PageUp/PageDown
// for its tabs), and Ctrl+K "Workspace: …". Design: docs/research/workspaces-and-nodes.md, part A.
import type { Editor3, Tool } from '../editor/editor';

export type WorkspaceId = 'site' | 'model' | 'interior' | 'components' | 'materials' | 'present';

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
  /** The floor plan (2D) opens. */
  plan?: boolean;
  /** Look only: no handles, no contextual bar, no editing tool. */
  present?: boolean;
  /** What to do in this stage (the guide card), in order. */
  steps: string[];
}

/**
 * The stages of a project, in the order a design is made (site, massing, plan, facades, finishes,
 * presentation): the workspaces are these stages, numbered, so the bar reads as the path of the work.
 */
export const WORKSPACES: Record<WorkspaceId, WorkspaceDef> = {
  site: {
    label: 'Site',
    title: 'The lot, the streets, the trees and the neighbourhood',
    tools: ['select', 'move', 'rotate', 'lot', 'street', 'rect', 'polygon', 'place', 'tape'],
    entry: 'select',
    library: null,
    steps: ['Draw the lot (Shift+L): drag a rectangle on the ground; its setbacks show where you can build.', 'Add the streets (Shift+S) and trees from the library (K).', 'Ctrl+K "Neighbourhood from OpenStreetMap" brings the buildings around a real address.'],
  },
  model: {
    label: 'Massing',
    title: 'Volumes, floors and roofs: every tool',
    tools: 'all',
    entry: 'select',
    library: null,
    steps: ['Draw a volume with Rectangle (R), Polygon (L) or Walls (W).', 'Set the floors and the roof in the panel on the right.', 'Push/pull faces (P) and extrude (E) to shape it.'],
  },
  interior: {
    label: 'Plan',
    title: 'Floor plan (2D, F2): interior walls, doors and rooms; F3 shows them in 3D',
    tools: ['select', 'tape', 'iwall', 'room', 'slab', 'column', 'beam', 'stair', 'opening', 'place'],
    entry: 'select',
    library: null,
    interior: true,
    plan: true,
    steps: ['Wall (W): click point by point; the walls join by themselves and close the rooms.', 'Door (D): click an interior wall.', 'Click a room to name it: its area is measured for you.'],
  },
  components: {
    label: 'Facades',
    title: 'Windows, doors, balconies, facade rules and free parts',
    tools: ['select', 'move', 'rotate', 'opening', 'place', 'tape'],
    entry: 'select',
    library: 'windows',
    steps: ['Drag a window or door from the library onto a wall.', 'A facade rule repeats it on every floor and side.', 'Opening (O): drag a rectangle on a wall for a balcony, a canopy or a niche.'],
  },
  materials: {
    label: 'Finishes',
    title: 'Finishes and paint',
    tools: ['select', 'paint'],
    entry: 'select',
    library: 'materials',
    steps: ['Pick a material in the library and click a wall, a roof or a frame.', 'Alt+click takes a material from the model (eyedropper).'],
  },
  present: {
    label: 'Present',
    title: 'Look, compare, export: no editing handles',
    tools: ['select'],
    entry: 'select',
    library: null,
    present: true,
    steps: ['Set the time of day for the sun and shadows.', 'Walk inside in first person (Ctrl+K "Walk inside").', 'Export: drawings in PDF and DXF, BIM in IFC, 3D in GLB, or an image.'],
  },
};

const ORDER: WorkspaceId[] = ['site', 'model', 'interior', 'components', 'materials', 'present'];
const KEY = 'forma3_workspace';
const COACH = 'oriel_guide_off';
const SEEN = 'oriel_guide_seen';

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
  bar.setAttribute('aria-label', 'Project stages');
  bar.innerHTML = ORDER.map((id, i) => `<button role="tab" data-ws="${id}" title="${WORKSPACES[id].title} · Alt+PageUp/PageDown"><i>${i + 1}</i>${WORKSPACES[id].label}</button>`).join('');
  // The guide of the stage: what to do here and the next stage (it can be turned off).
  const guide = document.createElement('div');
  guide.className = 'f3-guide';
  guide.hidden = true;
  ed.shell.view.appendChild(guide);
  let guideOff = false;
  try {
    guideOff = localStorage.getItem(COACH) === '1';
  } catch {
    // On for this page.
  }
  const drawGuide = (id: WorkspaceId) => {
    const w = WORKSPACES[id];
    const i = ORDER.indexOf(id);
    const next = ORDER[i + 1];
    guide.hidden = guideOff;
    // Open the first time a stage is shown; afterwards a small tab that opens on a click.
    const seen = (() => {
      try {
        const v = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[];
        if (!v.includes(id)) localStorage.setItem(SEEN, JSON.stringify([...v, id]));
        return v.includes(id);
      } catch {
        return false;
      }
    })();
    guide.classList.toggle('open', !seen);
    guide.innerHTML = `<header><i>${i + 1}</i><b>${w.label}</b><button data-fold aria-label="Fold the guide" title="Fold the guide">–</button><button data-off aria-label="Hide the guide" title="Hide the guide">×</button></header><ol>${w.steps.map((t) => `<li>${t}</li>`).join('')}</ol>${next ? `<button class="f3-btn" data-next="${next}">Next: ${WORKSPACES[next].label} →</button>` : ''}`;
  };
  guide.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-off]')) {
      guideOff = true;
      guide.hidden = true;
      try {
        localStorage.setItem(COACH, '1');
      } catch {
        // Hidden for this page.
      }
      ed.toast('Guide hidden: Ctrl+K "Show the stage guide" brings it back.');
      return;
    }
    const n = t.closest<HTMLElement>('[data-next]');
    if (n) return set(n.dataset.next as WorkspaceId);
    if (t.closest('[data-fold]')) return void guide.classList.remove('open');
    if (!guide.classList.contains('open')) guide.classList.add('open');
  });
  ed.guideRequested = () => {
    guideOff = false;
    try {
      localStorage.removeItem(COACH);
    } catch {
      // Shown for this page.
    }
    drawGuide(current);
    guide.classList.add('open');
  };
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
    // The plan stage opens the floor plan; the others go back to the 3D view.
    ed.planRequested?.(!!w.plan && !quiet);
    drawGuide(id);
    if (!quiet) ed.toast(`${w.label}: stage ${ORDER.indexOf(id) + 1} of ${ORDER.length}.`);
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
