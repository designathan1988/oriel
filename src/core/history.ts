// Undo/redo history by diffs. Each step stores only what
// changed (forward and back), instead of full copies: projects with interiors
// get large, and 100 copies would weigh hundreds of megabytes.

type Key = string | number;
export type Op =
  | { t: 'set'; p: Key[]; v: unknown }
  | { t: 'del'; p: Key[] }
  | { t: 'splice'; p: Key[]; s: number; dc: number; items: unknown[] };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** Diffs that turn `a` into `b`. */
export function diff(a: unknown, b: unknown, p: Key[] = [], ops: Op[] = []): Op[] {
  if (a === b) return ops;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length) {
      for (let i = 0; i < a.length; i++) diff(a[i], b[i], [...p, i], ops);
      return ops;
    }
    // Different sizes: common prefix and suffix, splice in the middle.
    let s = 0;
    while (s < a.length && s < b.length && JSON.stringify(a[s]) === JSON.stringify(b[s])) s++;
    let e = 0;
    while (e < a.length - s && e < b.length - s && JSON.stringify(a[a.length - 1 - e]) === JSON.stringify(b[b.length - 1 - e])) e++;
    ops.push({ t: 'splice', p, s, dc: a.length - s - e, items: clone(b.slice(s, b.length - e)) });
    return ops;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) ops.push({ t: 'del', p: [...p, k] });
    for (const k of Object.keys(b)) {
      if (!(k in a)) ops.push({ t: 'set', p: [...p, k], v: clone(b[k]) });
      else diff(a[k], b[k], [...p, k], ops);
    }
    return ops;
  }
  ops.push({ t: 'set', p, v: clone(b) });
  return ops;
}

/** Applies the diffs; returns the object (the root may be replaced). */
export function apply<T>(root: T, ops: Op[]): T {
  let r: unknown = root;
  for (const op of ops) {
    if (!op.p.length) {
      if (op.t === 'set') r = clone(op.v);
      else if (op.t === 'splice') (r as unknown[]).splice(op.s, op.dc, ...clone(op.items));
      continue;
    }
    let parent = r as Record<Key, unknown>;
    for (let i = 0; i < op.p.length - 1; i++) parent = parent[op.p[i]!] as Record<Key, unknown>;
    const last = op.p.at(-1)!;
    if (op.t === 'set') parent[last] = clone(op.v);
    else if (op.t === 'del') delete parent[last];
    else (parent[last] as unknown[]).splice(op.s, op.dc, ...clone(op.items));
  }
  return r as T;
}

export class History<T> {
  private state: T;
  private undoStack: { fwd: Op[]; back: Op[] }[] = [];
  private redoStack: { fwd: Op[]; back: Op[] }[] = [];

  constructor(
    initial: T,
    private max = 200,
  ) {
    this.state = clone(initial);
  }

  /** Records a new state. Returns false if nothing changed. */
  commit(state: T): boolean {
    const next = clone(state);
    const fwd = diff(this.state, next);
    if (!fwd.length) return false;
    const back = diff(next, this.state);
    this.undoStack.push({ fwd, back });
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
    this.state = next;
    return true;
  }

  undo(): T {
    const step = this.undoStack.pop();
    if (step) {
      this.state = apply(this.state, step.back);
      this.redoStack.push(step);
    }
    return clone(this.state);
  }

  redo(): T {
    const step = this.redoStack.pop();
    if (step) {
      this.state = apply(this.state, step.fwd);
      this.undoStack.push(step);
    }
    return clone(this.state);
  }

  /** Current recorded state (copy). */
  current(): T {
    return clone(this.state);
  }

  /** Restarts the history from a state (e.g. an opened project). */
  reset(state: T): void {
    this.state = clone(state);
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Approximate stored size (for diagnostics). */
  get storedBytes(): number {
    return JSON.stringify(this.undoStack).length + JSON.stringify(this.redoStack).length;
  }
}
