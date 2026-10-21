// Projects kept in the browser's IndexedDB (https://developer.mozilla.org/docs/Web/API/IndexedDB_API):
// many projects, each saved whole as text with its name and when it changed. IndexedDB holds far more
// than localStorage (which keeps a few MB per origin and blocks the page while it writes:
// https://developer.mozilla.org/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API), so large
// projects with images keep saving. The open project's id is remembered in localStorage. No three.
import type { Project3 } from '../model/schema';
import { deleteHistory } from './history';

export interface StoredProject {
  id: string;
  name: string;
  /** Last change (ms since 1970). */
  at: number;
  buildings: number;
  json: string;
}

/** The listing without the project text. */
export type ProjectInfo = Omit<StoredProject, 'json'> & { kb: number };

const DB = 'oriel_projects',
  STORE = 'projects',
  CURRENT = 'oriel_current_project';

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => void r.result.createObjectStore(STORE, { keyPath: 'id' });
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
        t.onabort = () => {
          db.close();
          no(t.error);
        };
      }),
  );
}

export const available = (): boolean => typeof indexedDB !== 'undefined';

export function newProjectId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Every project, the most recently changed first. */
export async function listProjects(): Promise<ProjectInfo[]> {
  const all = (await tx<StoredProject[]>('readonly', (s) => s.getAll())) ?? [];
  return all.map(({ json, ...rest }) => ({ ...rest, kb: Math.round(json.length / 1024) })).sort((a, b) => b.at - a.at);
}

export async function getProject(id: string): Promise<StoredProject | undefined> {
  return tx<StoredProject>('readonly', (s) => s.get(id));
}

export async function putProject(id: string, p: Project3, json = JSON.stringify(p)): Promise<void> {
  await tx('readwrite', (s) => s.put({ id, name: p.name, at: Date.now(), buildings: p.buildings.length, json } satisfies StoredProject));
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  await deleteHistory(id);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const p = await getProject(id);
  if (!p) return;
  try {
    const doc = JSON.parse(p.json) as Project3;
    doc.name = name;
    await tx('readwrite', (s) => s.put({ ...p, name, json: JSON.stringify(doc) }));
  } catch {
    await tx('readwrite', (s) => s.put({ ...p, name }));
  }
}

export function currentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT);
  } catch {
    return null;
  }
}

export function setCurrentProjectId(id: string): void {
  try {
    localStorage.setItem(CURRENT, id);
  } catch {
    /* the project still saves; only which one opens next is not remembered */
  }
}
