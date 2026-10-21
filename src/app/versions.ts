// Versions dialog (project menu → Versions…; app layer: it uses the storage of f3/io): save the project as a named version, see the earlier ones
// (named and automatic), open one (Ctrl+Z goes back), rename or delete it. Automatic versions every five
// minutes while the project changes. Storage: io/versions.ts (IndexedDB).
import type { Editor3 } from '../f3/editor/editor';
import type { Project3 } from '../f3/model/schema';
import { deleteVersion, listVersions, renameVersion, saveVersion } from '../f3/io/versions';
import { migrateForma3 } from '../f3/io/migrate';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

export function openVersions(ed: Editor3): void {
  const m = document.createElement('div');
  m.className = 'f3-modal';
  m.innerHTML = `<div class="f3-versions" role="dialog" aria-label="Versions"><header><h2>Versions of “${esc(ed.project.name)}”</h2><button class="f3-x" data-close aria-label="Close">×</button></header>
    <div class="row"><input data-vname placeholder="Name of this version" maxlength="60" value="${esc(new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}"><button class="f3-btn primary" data-vsave>Save version</button></div>
    <ul class="list"><li class="empty">…</li></ul>
    <p class="note">Kept in this browser (IndexedDB). An automatic version every 5 minutes while the project changes (the last 20).</p></div>`;
  ed.shell.root.appendChild(m);
  const list = m.querySelector<HTMLUListElement>('.list')!;
  const draw = async () => {
    const vs = await listVersions(ed.project.name);
    list.innerHTML = vs.length
      ? vs.map((v) => `<li data-id="${v.id}"><div><input data-rename value="${esc(v.name)}" aria-label="Version name"><small>${when(v.at)} · ${v.buildings} building(s)${v.auto ? ' · automatic' : ''} · ${Math.round(v.json.length / 1024)} KB</small></div><button class="f3-btn" data-open>Open</button><button class="f3-btn ic danger" data-del aria-label="Delete">×</button></li>`).join('')
      : '<li class="empty">No version yet: save the first one above.</li>';
  };
  void draw();
  const close = () => {
    m.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  m.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t === m || t.closest('[data-close]')) return close();
    if (t.closest('[data-vsave]')) {
      const name = m.querySelector<HTMLInputElement>('[data-vname]')!.value.trim() || 'Version';
      await saveVersion(ed.project, name.slice(0, 60));
      ed.toast(`Version “${name}” saved.`);
      return void draw();
    }
    const li = t.closest<HTMLElement>('li[data-id]');
    if (!li) return;
    const id = li.dataset.id!;
    if (t.closest('[data-del]')) {
      await deleteVersion(id);
      return void draw();
    }
    if (t.closest('[data-open]')) {
      const v = (await listVersions(ed.project.name)).find((x) => x.id === id);
      if (!v) return;
      let mig;
      try {
        mig = migrateForma3(JSON.parse(v.json) as Project3);
      } catch (err) {
        return ed.toast(`This version could not be read: ${(err as Error).message}`);
      }
      ed.store.replace(mig.project, `Version “${v.name}” opened.`);
      ed.view.frame();
      ed.toast(`Version “${v.name}” opened. Ctrl+Z goes back.`);
      close();
    }
  });
  list.addEventListener('change', async (e) => {
    const inp = e.target as HTMLInputElement;
    const li = inp.closest<HTMLElement>('li[data-id]');
    if (inp.dataset.rename !== undefined && li) await renameVersion(li.dataset.id!, inp.value.trim().slice(0, 60) || 'Version');
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if ((e.target as HTMLElement).closest?.('input')) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
}

/** Automatic versions: every 5 minutes, if the project changed since the last one. */
export function autoVersions(ed: Editor3): void {
  let last = '';
  setInterval(() => {
    if (!('indexedDB' in globalThis)) return;
    const json = JSON.stringify(ed.project);
    if (json === last || !ed.project.buildings.length) return;
    last = json;
    void saveVersion(ed.project, `Automatic ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`, true).catch(() => undefined);
  }, 5 * 60 * 1000);
}
