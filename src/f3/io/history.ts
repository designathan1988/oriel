// The undo history of each project kept in IndexedDB (a database of its own beside the projects), so a
// reload, a crash or a closed tab does not lose Ctrl+Z: the last steps are written a moment after the
// edits stop and read back when the same project opens again, only if the saved state is the one shown
// (editor/store.ts, `snapshot` and `adopt`). No three.

const DB = 'oriel_history',
  STORE = 'history';

function open(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => void r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((ok, no) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      ok(req.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      no(t.error);
    };
  });
}

export async function getHistory<T>(id: string): Promise<T | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  return run<T | undefined>('readonly', (s) => s.get(id) as IDBRequest<T | undefined>).catch(() => undefined);
}

export async function putHistory(id: string, h: object): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run('readwrite', (s) => s.put(h, id)).catch(() => undefined);
}

export async function deleteHistory(id: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await run('readwrite', (s) => s.delete(id)).catch(() => undefined);
}
