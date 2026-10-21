// Document being edited: forma/3 project, history (undo/redo by compact
// copies), revision per building (what needs re-evaluation) and events.
import type { Building3, ID, Project3 } from '../model/schema';
import { project as newProject, uid } from '../model/defaults';
import { resolveBuilding } from '../model/relations';

export type StoreEvent = { kind: 'change'; ids: ID[] | null; message: string } | { kind: 'history' };

const MAX_HISTORY = 200;

// The history keeps every step as text; an embedded image (a data URL of a few MB) would be copied into
// each one and written out on every edit. Big data URLs go into this table once and the steps hold a
// short reference to them; reading a step back puts the very same string in place again.
const BIG = 4096;
const blobs: string[] = [];
const blobId = new Map<string, number>();
const REF = '\u0001blob:';
const REFS = /\u0001blob:(\d+)/g;

/** The undo and redo steps of a project, written out to survive a reload (io/history.ts). */
export interface History {
  /** The state shown when it was written: the steps are taken back only onto that same state. */
  last: string;
  undo: string[];
  redo: string[];
  /** The big data URLs the steps refer to (`REF` + index into this list). */
  blobs: string[];
}

/** The project as history text, big data URLs as references. */
function pack(p: unknown): string {
  return JSON.stringify(p, (_k, v: unknown) => {
    if (typeof v !== 'string' || v.length < BIG || !v.startsWith('data:')) return v;
    let id = blobId.get(v);
    if (id === undefined) {
      id = blobs.push(v) - 1;
      blobId.set(v, id);
    }
    return REF + id;
  });
}

/** History text back to a project, the references replaced by their data. */
function unpack<T>(json: string): T {
  return JSON.parse(json, (_k, v: unknown) => (typeof v === 'string' && v.startsWith(REF) ? (blobs[Number(v.slice(REF.length))] ?? '') : v)) as T;
}

export class Store {
  project: Project3;
  /** Revision per building: changes when it needs re-evaluation. */
  readonly revision = new Map<ID, number>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<(e: StoreEvent) => void>();
  private last: string;
  /** Counts history steps (record, undo, redo): whoever keeps the value knows whether something changed since. */
  seq = 0;
  /**
   * Whether the last commit recorded something. A commit that finds the project as it was (the roof
   * kind it already had, an alignment already true) records no step, re-evaluates nothing and emits
   * nothing, so the interface says nothing either (audit F11).
   */
  changed = false;
  /**
   * While it returns a reason, only the view state (`project.view`) may change: a commit that changes
   * anything else is undone and `onBlocked` gets the reason (one check for every way of editing).
   */
  guard: (() => string | null) | null = null;
  onBlocked: ((why: string) => void) | null = null;
  /**
   * Each building as the last relation resolve left it (model/relations.ts): what an edit changes is
   * read against it, so supports, floors, cutters and hosted parts follow on every path that edits.
   */
  private resolved = new Map<ID, Building3>();

  constructor(p: Project3 = newProject()) {
    this.project = p;
    // An opened project gets its relations (older files had none); nothing moves.
    this.resolve(null);
    this.last = pack(p);
    for (const b of p.buildings) this.revision.set(b.id, 1);
  }

  /** Keeps the relations of the given buildings (all with null) after an edit. */
  private resolve(ids: ID[] | null): void {
    for (const b of this.project.buildings) {
      if (ids && !ids.includes(b.id)) continue;
      resolveBuilding(b, this.resolved.get(b.id), uid);
      this.resolved.set(b.id, structuredClone(b));
    }
  }

  /** The resolve snapshot follows a state that was put back (undo, redo, revert, open). */
  private rebase(ids: ID[] | null): void {
    if (!ids) this.resolved.clear();
    for (const b of this.project.buildings) if (!ids || ids.includes(b.id)) this.resolved.set(b.id, structuredClone(b));
    for (const id of [...this.resolved.keys()]) if (!this.project.buildings.some((b) => b.id === id)) this.resolved.delete(id);
  }

  on(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  building(id: ID | null | undefined): Building3 | undefined {
    return id ? this.project.buildings.find((b) => b.id === id) : undefined;
  }

  /** Marks buildings as changed (without recording history): during a drag. */
  touch(ids: ID[] | null, message = ''): void {
    this.resolve(ids);
    const list = ids ?? this.project.buildings.map((b) => b.id);
    for (const id of list) this.revision.set(id, (this.revision.get(id) ?? 0) + 1);
    this.emit({ kind: 'change', ids: list, message });
  }

  /**
   * Linked buildings (Building3.linked): the member edited since the last step gives its volumes, parts,
   * floors, interiors and use to the others of its group. Returns the buildings changed that way.
   */
  private propagateLinks(ids: ID[] | null): ID[] {
    const groups = new Map<ID, Building3[]>();
    for (const b of this.project.buildings) if (b.linked) groups.set(b.linked, [...(groups.get(b.linked) ?? []), b]);
    if (![...groups.values()].some((g) => g.length > 1)) return [];
    const shape = (b: Building3) => JSON.stringify([b.solids, b.items, b.levels, b.interiors, b.use]);
    const before = new Map(unpack<Project3>(this.last).buildings.map((b) => [b.id, shape(b)]));
    const out: ID[] = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // The member that changed (one of the ids given first); a new member takes the group's shape.
      const changed = g.filter((b) => before.has(b.id) && before.get(b.id) !== shape(b));
      const src = changed.find((b) => !ids || ids.includes(b.id)) ?? changed[0] ?? g.find((b) => before.has(b.id));
      if (!src) continue;
      const s = shape(src);
      for (const b of g) {
        if (b === src || shape(b) === s) continue;
        b.solids = structuredClone(src.solids);
        b.items = structuredClone(src.items);
        b.levels = structuredClone(src.levels);
        b.interiors = structuredClone(src.interiors);
        b.use = src.use;
        out.push(b.id);
      }
    }
    return out;
  }

  /**
   * Records the current state as a history step. `geometry = false` when only
   * building position/rotation changed (no re-evaluation needed).
   */
  commit(ids: ID[] | null, message = '', geometry = true): boolean {
    this.resolve(ids);
    const linked = this.propagateLinks(ids);
    if (linked.length) {
      this.resolve(linked);
      if (ids) ids = [...new Set([...ids, ...linked])];
    }
    const now = pack(this.project);
    this.changed = false;
    if (now === this.last) return true;
    const why = this.guard?.();
    if (why && withoutView(now) !== withoutView(this.last)) {
      this.revert();
      this.onBlocked?.(why);
      return false;
    }
    this.changed = true;
    this.undoStack.push(this.last);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.last = now;
    this.seq++;
    if (geometry) this.touch(ids, message);
    else this.emit({ kind: 'change', ids, message });
    this.emit({ kind: 'history' });
    return true;
  }

  /**
   * Goes back to the last recorded state (cancels a drag). Without changes (a
   * still click) it does nothing; with changes, only the buildings that differ
   * are re-evaluated (before, every click redid the booleans of the whole project).
   */
  revert(): void {
    const now = pack(this.project);
    if (now === this.last) return;
    const prev = unpack<Project3>(this.last);
    const before = new Map(prev.buildings.map((b) => [b.id, JSON.stringify(b)]));
    const changed = new Set<ID>();
    for (const b of this.project.buildings) if (before.get(b.id) !== JSON.stringify(b)) changed.add(b.id);
    for (const id of before.keys()) if (!this.project.buildings.some((b) => b.id === id)) changed.add(id);
    this.project = prev;
    const rest = pack({ ...prev, buildings: [] }) !== pack({ ...unpack<Project3>(now), buildings: [] });
    this.rebase(null);
    this.touch(rest ? null : [...changed].filter((id) => prev.buildings.some((b) => b.id === id)));
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(this.last);
    this.restore(prev);
    this.seq++;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(this.last);
    this.restore(next);
    this.seq++;
    return true;
  }

  /**
   * Undo/redo: only the buildings that differ from what is on screen are re-evaluated
   * (before, every step redid the booleans of the whole project). The view state,
   * layers, name and selection sets are left to the view, which compares its own
   * visibility keys (their commits touch nothing either); anything else outside the
   * buildings (types, styles, lots, images) still redoes all of them.
   */
  private restore(json: string): void {
    const shown = this.project;
    this.last = json;
    this.project = unpack<Project3>(json);
    // A recorded state already has its relations: it is the new reference, not an edit.
    this.rebase(null);
    const rest = (p: Project3) => pack({ ...p, buildings: [], view: null, layers: null, name: '', selectionSets: null });
    if (rest(shown) !== rest(this.project)) this.touch(null, '');
    else {
      const before = new Map(shown.buildings.map((b) => [b.id, JSON.stringify(b)]));
      // A building that comes back has no drawing (it was dropped), so it is drawn anyway; one that goes is dropped by the view.
      this.touch(this.project.buildings.filter((b) => before.get(b.id) !== JSON.stringify(b)).map((b) => b.id), '');
    }
    this.emit({ kind: 'history' });
  }

  /** Replaces the whole project (open file, new). */
  /** Replaces the project. `fresh`: another project opened (its own history starts empty). */
  replace(p: Project3, message = '', fresh = false): void {
    if (fresh) this.undoStack = [];
    else this.undoStack.push(this.last);
    this.redoStack = [];
    this.project = p;
    this.resolved.clear();
    this.resolve(null);
    this.last = pack(p);
    this.revision.clear();
    this.touch(null, message);
    this.emit({ kind: 'history' });
  }

  json(): string {
    return JSON.stringify(this.project);
  }

  /** The last `max` undo and redo steps with the data URLs they refer to. */
  snapshot(max = 40): History {
    const out: string[] = [];
    const at = new Map<number, number>();
    const map = (s: string) =>
      s.replace(REFS, (_m, i: string) => {
        let j = at.get(+i);
        if (j === undefined) at.set(+i, (j = out.push(blobs[+i] ?? '') - 1));
        return REF + j;
      });
    return { last: map(this.last), undo: this.undoStack.slice(-max).map(map), redo: this.redoStack.slice(-max).map(map), blobs: out };
  }

  /** Takes back saved steps when they were written on the state shown now (else nothing changes). */
  adopt(h: History): boolean {
    if (!h || typeof h.last !== 'string' || !Array.isArray(h.undo) || !Array.isArray(h.redo) || !Array.isArray(h.blobs)) return false;
    const map = (s: string) =>
      s.replace(REFS, (_m, i: string) => {
        const v = h.blobs[+i] ?? '';
        let id = blobId.get(v);
        if (id === undefined) {
          id = blobs.push(v) - 1;
          blobId.set(v, id);
        }
        return REF + id;
      });
    if (map(h.last) !== this.last || this.undoStack.length || this.redoStack.length) return false;
    this.undoStack = h.undo.map(map);
    this.redoStack = h.redo.map(map);
    this.seq++;
    this.emit({ kind: 'history' });
    return true;
  }
}

/** The project without its view state (camera-like settings and the saved scenes, never an edit of the model). */
function withoutView(json: string): string {
  const p = unpack<Project3>(json);
  delete p.view;
  delete p.scenes;
  return pack(p);
}
