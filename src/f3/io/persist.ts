// FORMA 3 saving: automatic in the browser (localStorage) and to a file
// (.json downloaded and opened). A saved project that does not open is never
// silently discarded: a copy goes to `forma3_project_invalid`. No three.
import type { Project3 } from '../model/schema';
import { migrateForma3, type Migration } from './migrate';

export const KEY3 = 'forma3_project';
export const KEY3_INVALID = 'forma3_project_invalid';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface Restored3 {
  project: Project3 | null;
  /** Migration notes (when the save was from an earlier version). */
  notes: string[];
  error?: string;
}

/** Reads the autosave. With nothing saved, returns `project: null` without an error. */
export function loadAutosave(key = KEY3): Restored3 {
  const s = storage();
  if (!s) return { project: null, notes: [] };
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return { project: null, notes: [], error: 'The browser did not allow reading the saved project.' };
  }
  if (!raw) return { project: null, notes: [] };
  try {
    const m = migrateForma3(JSON.parse(raw));
    return { project: m.project, notes: m.notes };
  } catch (e) {
    try {
      s.setItem(KEY3_INVALID, raw);
    } catch {
      /* no space: continue without the copy */
    }
    return { project: null, notes: [], error: e instanceof SyntaxError ? 'The saved project is corrupted (invalid JSON).' : (e as Error).message };
  }
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Saves in the browser. A failure (no space, private mode) comes back as an error, never an exception. */
export function autosave(p: Project3, key = KEY3): SaveResult {
  const s = storage();
  if (!s) return { ok: false, error: 'This browser does not allow saving locally.' };
  try {
    s.setItem(key, JSON.stringify(p));
    return { ok: true };
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return { ok: false, error: quota ? 'No space in the browser for the autosave; save to a file.' : 'Could not save in the browser.' };
  }
}

export function clearAutosave(key = KEY3): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Safe file name from the project name. */
export function fileName(name: string, ext: string): string {
  const base =
    (name || 'forma')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'forma';
  return `${base}.${ext}`;
}

/** Downloads data as a file (Blob + a[download]); the URL is released after the click. */
export function download(data: BlobPart | Blob, name: string, type: string, doc: Document = document): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after the click can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Saves the project as a JSON file (forma/3). */
export function saveFile(p: Project3, doc: Document = document): void {
  download(JSON.stringify(p, null, 2), fileName(p.name, 'forma3.json'), 'application/json', doc);
}

/** Opens a project file (forma/3, forma/2 or v1), migrating to forma/3. */
export async function openFile(file: File): Promise<Project3> {
  return (await openFileWithNotes(file)).project;
}

export async function openFileWithNotes(file: File): Promise<Migration> {
  if (file.size > 50 * 1024 * 1024) throw new Error('File too large for a project (over 50 MB).');
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file is not a valid project (invalid JSON).');
  }
  return migrateForma3(raw);
}
