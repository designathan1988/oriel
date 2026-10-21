// Start screen and project manager (project menu → New project…, Projects…; also shown on the first
// visit). Left: start from a template (blank site, a single-storey house with its rooms, a two-storey
// house, a warehouse, an apartment block, the examples). Right: the projects kept in this browser
// (IndexedDB, f3/io/projects.ts) and, signed in, the ones in the cloud (cloud/account.ts): open, rename,
// delete. A cloud project not yet in this browser is copied here when opened. App layer.
import type { Editor3 } from '../f3/editor/editor';
import type { Project3 } from '../f3/model/schema';
import { TEMPLATES } from '../f3/io/templates';
import { deleteProject, getProject, listProjects, putProject, renameProject } from '../f3/io/projects';
import type { Account } from './cloud/account';
import type { CloudProject } from './cloud/api';
import { mergeProjects } from './cloud/plans';
import { migrateForma3 } from '../f3/io/migrate';
import { icon } from '../f3/ui/icons';
import { tr } from '../f3/ui/i18n';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

export interface ProjectHost {
  account: Account;
  /** Opens a project as the current one (its own id; a new id for a new project). */
  open(p: Project3, id: string | null, message: string): void;
  /** Id of the project being edited. */
  currentId(): string;
}

/** Opens the start screen. `first`: the first visit (no project yet): it cannot be dismissed empty. */
export function openStart(ed: Editor3, host: ProjectHost, first = false): void {
  ed.shell.root.querySelector('.f3-modal.f3-start-modal')?.remove();
  const m = document.createElement('div');
  m.className = 'f3-modal f3-start-modal';
  m.innerHTML = `<div class="f3-start" role="dialog" aria-label="Start">
    <header><h2>${first ? 'Welcome' : 'Projects'}</h2>${first ? '' : '<button class="f3-x" data-close aria-label="Close">×</button>'}</header>
    <div class="cols">
      <section><h3>New project</h3><div class="tpls">${TEMPLATES.map((t) => `<button class="tpl" data-tpl="${t.id}"><span class="pic">${t.id === 'blank' ? icon('add') : `<img src="./tpl/${t.id}.webp" alt="" loading="lazy" decoding="async" width="480" height="300">`}</span><b>${esc(tr(t.name))}</b><small>${esc(tr(t.note))}</small></button>`).join('')}</div></section>
      <section><h3>Recent projects</h3><ul class="list"><li class="empty">…</li></ul></section>
    </div>
    <p class="note">${host.account.user() ? 'Projects are saved automatically in this browser and in the cloud.' : host.account.enabled ? 'Projects are saved automatically in this browser. Sign in to keep them in the cloud too.' : 'Projects are saved automatically in this browser. Use Save (Ctrl+S) to keep a copy in a file.'}</p></div>`;
  ed.shell.root.appendChild(m);
  const list = m.querySelector<HTMLUListElement>('.list')!;
  let cloudRows: CloudProject[] = [];
  const draw = async () => {
    let ps: Awaited<ReturnType<typeof listProjects>> = [];
    try {
      ps = await listProjects();
    } catch {
      /* storage blocked: only templates */
    }
    const api = await host.account.api();
    try {
      cloudRows = api ? await api.listProjects() : [];
    } catch {
      cloudRows = [];
    }
    const cur = host.currentId();
    const rows = mergeProjects(ps, cloudRows);
    // Each piece in its own element: the translator matches whole texts ("{0} building(s)", "open").
    const where = (r: (typeof rows)[number]) => (r.cloud && r.local ? ' · <span>in the cloud</span>' : r.cloud ? ' · <span>only in the cloud</span>' : '');
    list.innerHTML = rows.length
      ? rows
          .map((r) => {
            const name = r.local?.name ?? r.cloud!.name;
            const buildings = r.local?.buildings ?? r.cloud!.buildings;
            const kb = r.local?.kb ?? Math.round(r.cloud!.bytes / 1024);
            const pic = r.cloud?.thumb ? `<img class="th" src="${esc(r.cloud.thumb)}" alt="" loading="lazy">` : `<span class="th">${icon(r.cloud ? 'cloud' : 'folder')}</span>`;
            return `<li data-id="${esc(r.id)}"${r.id === cur ? ' class="cur"' : ''}>${pic}<div><input data-rename value="${esc(name)}" aria-label="Project name"${r.local ? '' : ' readonly'}><small><span>${when(r.at)}</span> · <span>${buildings} building(s)</span> · <span>${kb} KB</span>${where(r)}${r.id === cur ? ' · <span>open</span>' : ''}</small></div><button class="f3-btn" data-open>Open</button><button class="f3-btn ic danger" data-del aria-label="Delete project" title="Delete project">×</button></li>`;
          })
          .join('')
      : '<li class="empty">No project yet: choose a starting point.</li>';
  };
  void draw();
  // Closed, the keys go back where they were; a project just opened gets them in its view (R, numbers…).
  const before = document.activeElement as HTMLElement | null;
  const close = (opened = false) => {
    m.remove();
    window.removeEventListener('keydown', onKey, true);
    const to = opened || !before?.isConnected ? ed.view.renderer.domElement : before;
    to.focus({ preventScroll: true });
  };
  m.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if ((t === m && !first) || t.closest('[data-close]')) return close();
    const tpl = t.closest<HTMLElement>('[data-tpl]');
    if (tpl) {
      const def = TEMPLATES.find((x) => x.id === tpl.dataset.tpl)!;
      host.open(def.make(tr), null, `${tr(def.name)}: new project.`);
      return close(true);
    }
    const li = t.closest<HTMLElement>('li[data-id]');
    if (!li) return;
    const id = li.dataset.id!;
    if (t.closest('[data-del]')) {
      // Two clicks: the first arms the button (no confirm(): the same pattern works everywhere).
      const b = t.closest<HTMLButtonElement>('[data-del]')!;
      if (!b.classList.contains('armed')) {
        b.classList.add('armed');
        b.textContent = 'Delete?';
        return;
      }
      if (id === host.currentId()) return ed.toast('This is the open project: open another one first.');
      await deleteProject(id);
      // Deleted here and in the cloud: the same project on every computer.
      const api = await host.account.api();
      if (api && cloudRows.some((c) => c.id === id)) await api.deleteProject(id).catch((err) => ed.toast(`${tr('Not deleted from the cloud')}: ${(err as Error).message}`));
      return void draw();
    }
    if (t.closest('[data-open]')) {
      let sp = await getProject(id);
      // The cloud copy when it is newer than this browser's (or the only one): it is copied here first.
      const c = cloudRows.find((x) => x.id === id);
      const api = await host.account.api();
      if (api && c && (!sp || c.at > sp.at + 1000)) {
        try {
          const json = await api.getProject(id);
          const doc = JSON.parse(json) as Project3;
          await putProject(id, doc, json);
          host.account.synced(id, Date.now());
          sp = await getProject(id);
        } catch (err) {
          if (!sp) return ed.toast(`${tr('Could not open from the cloud')}: ${(err as Error).message}`);
        }
      }
      if (!sp) return void draw();
      try {
        const mig = migrateForma3(JSON.parse(sp.json) as Project3);
        host.open(mig.project, id, `“${sp.name}” opened.`);
        close(true);
      } catch (err) {
        ed.toast(`This project could not be read: ${(err as Error).message}`);
      }
    }
  });
  list.addEventListener('change', async (e) => {
    const inp = e.target as HTMLInputElement;
    const li = inp.closest<HTMLElement>('li[data-id]');
    if (inp.dataset.rename === undefined || !li) return;
    const name = inp.value.trim().slice(0, 80) || tr('Untitled project');
    if (li.dataset.id === host.currentId()) {
      ed.store.project.name = name;
      ed.shell.name.value = name;
    }
    await renameProject(li.dataset.id!, name);
    // The cloud copy gets the new name too.
    const api = await host.account.api();
    const sp = api && cloudRows.some((c) => c.id === li.dataset.id) ? await getProject(li.dataset.id!) : undefined;
    if (api && sp) await api.putProject(sp.id, { name, buildings: sp.buildings }, sp.json).catch(() => undefined);
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !first) {
      e.stopPropagation();
      close();
    } else if ((e.target as HTMLElement).closest?.('input')) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
}
