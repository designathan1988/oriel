// Named versions of projects in the browser's IndexedDB (https://developer.mozilla.org/docs/Web/API/IndexedDB_API):
// unlike the autosave (one copy in localStorage, a few MB at most), versions are many, large, and kept
// until deleted. Each version holds the whole project as text, its name and when it was made. Automatic
// versions are made every few minutes while the project changes (the last 20 are kept); named ones stay.
import type { Project3 } from '../model/schema';

export interface Version {
  id: string;
  project: string;
  name: string;
  at: number;
  auto: boolean;
  json: string;
  /** Buildings, for the list. */
  buildings: number;
}

const DB = 'forma3_versions',
  STORE = 'versions',
  AUTO_KEEP = 20;

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('project', 'project');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise((ok, no) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          db.close();
          ok(req ? (req.result as T) : undefined);
        };
        t.onerror = () => {
          db.close();
          no(t.error);
        };
      }),
  );
}

/** The versions of a project (by its name), newest first. */
export async function listVersions(project: string): Promise<Version[]> {
  const all = (await tx<Version[]>('readonly', (s) => s.index('project').getAll(project))) ?? [];
  return all.sort((a, b) => b.at - a.at);
}

export async function saveVersion(p: Project3, name: string, auto = false): Promise<Version> {
  const v: Version = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, project: p.name, name, at: Date.now(), auto, json: JSON.stringify(p), buildings: p.buildings.length };
  await tx('readwrite', (s) => s.put(v));
  if (auto) {
    // Only the latest automatic versions are kept.
    const autos = (await listVersions(p.name)).filter((x) => x.auto);
    for (const old of autos.slice(AUTO_KEEP)) await tx('readwrite', (s) => s.delete(old.id));
  }
  return v;
}

export async function deleteVersion(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

export async function renameVersion(id: string, name: string): Promise<void> {
  const v = await tx<Version>('readonly', (s) => s.get(id));
  if (v) await tx('readwrite', (s) => s.put({ ...v, name, auto: false }));
}
