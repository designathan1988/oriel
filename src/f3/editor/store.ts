// Document being edited: forma/3 project, history (undo/redo by compact
// copies), revision per building (what needs re-evaluation) and events.
import type { Building3, ID, Project3 } from '../model/schema';
import { project as newProject, uid } from '../model/defaults';
import { resolveBuilding } from '../model/relations';

export type StoreEvent = { kind: 'change'; ids: ID[] | null; message: string } | { kind: 'history' };

const MAX_HISTORY = 200;

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
    this.last = JSON.stringify(p);
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
   * Records the current state as a history step. `geometry = false` when only
   * building position/rotation changed (no re-evaluation needed).
   */
  commit(ids: ID[] | null, message = '', geometry = true): boolean {
    this.resolve(ids);
    const now = JSON.stringify(this.project);
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
    const now = JSON.stringify(this.project);
    if (now === this.last) return;
    const prev = JSON.parse(this.last) as Project3;
    const before = new Map(prev.buildings.map((b) => [b.id, JSON.stringify(b)]));
    const changed = new Set<ID>();
    for (const b of this.project.buildings) if (before.get(b.id) !== JSON.stringify(b)) changed.add(b.id);
    for (const id of before.keys()) if (!this.project.buildings.some((b) => b.id === id)) changed.add(id);
    this.project = prev;
    const rest = JSON.stringify({ ...prev, buildings: [] }) !== JSON.stringify({ ...(JSON.parse(now) as Project3), buildings: [] });
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
    this.project = JSON.parse(json) as Project3;
    // A recorded state already has its relations: it is the new reference, not an edit.
    this.rebase(null);
    const rest = (p: Project3) => JSON.stringify({ ...p, buildings: [], view: null, layers: null, name: '', selectionSets: null });
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
    this.last = JSON.stringify(p);
    this.revision.clear();
    this.touch(null, message);
    this.emit({ kind: 'history' });
  }

  json(): string {
    return JSON.stringify(this.project);
  }
}

/** The project without its view state (camera-like settings that never count as an edit). */
function withoutView(json: string): string {
  const p = JSON.parse(json) as Project3;
  delete p.view;
  return JSON.stringify(p);
}
