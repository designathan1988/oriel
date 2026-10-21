// A small pool of evaluation workers (src/f3/worker/eval.worker.ts). The view asks for a building
// and gets a promise; the main thread never blocks on the booleans. Two workers by default: the
// machine is shared with the game and other work, and two halve a view change.
// Without Worker support (tests in Node) or when the workers cannot start, `threaded` stays false
// and the caller evaluates on its own thread, within its frame budget.
import type { Building3, ComponentType } from '../model/schema';
import type { EvalOptions, Evaluated } from './evaluate';
import { family } from '../families/index';
import type { Placement } from './facade';

type Job = { building: Building3; opts: Omit<EvalOptions, 'hidden' | 'timings'>; hidden: string[]; types: ComponentType[]; ok: (e: Evaluated) => void; fail: (e: Error) => void };
type Reply = { id: number; ev?: Omit<Evaluated, 'placements'> & { placements: (Omit<Placement, 'family'> & { family: string })[] }; error?: string };

export class EvalPool {
  private workers: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue: Job[] = [];
  private seq = 0;
  /** Resolves when the workers are up (true) or could not start (false). */
  readonly ready: Promise<boolean>;

  constructor(size = 2) {
    this.ready =
      typeof Worker === 'undefined'
        ? Promise.resolve(false)
        : (async () => {
            try {
              const [{ default: EvalWorker }, { default: wasmUrl }] = await Promise.all([import('../worker/eval.worker?worker&inline'), import('manifold-3d/manifold.wasm?url')]);
              // An inline worker runs from a blob URL: a relative URL does not resolve there, so the
              // page resolves the .wasm address and hands it over.
              const wasm = new URL(wasmUrl, location.href).href;
              for (let i = 0; i < size; i++) {
                const w = new EvalWorker();
                w.addEventListener('message', (e: MessageEvent<Reply>) => this.done(w, e.data));
                w.postMessage({ init: wasm });
                this.workers.push(w);
              }
              this.next();
              return true;
            } catch {
              this.workers = [];
              return false;
            }
          })();
  }

  get threaded(): boolean {
    return this.workers.length > 0;
  }

  /** Evaluates in a worker, in order of request. Only call when `threaded`. */
  evaluate(building: Building3, opts: Omit<EvalOptions, 'hidden' | 'timings'>, hidden: string[], types: ComponentType[]): Promise<Evaluated> {
    return new Promise((ok, fail) => {
      this.queue.push({ building, opts, hidden, types, ok, fail });
      this.next();
    });
  }

  /** Drops what was not started (a newer view change replaces it). */
  clear(): void {
    for (const j of this.queue) j.fail(new Error('cancelled'));
    this.queue = [];
  }

  private next(): void {
    for (const w of this.workers) {
      if (this.busy.has(w)) continue;
      const j = this.queue.shift();
      if (!j) return;
      this.busy.set(w, j);
      w.postMessage({ id: ++this.seq, building: j.building, opts: j.opts, hidden: j.hidden, types: j.types });
    }
  }

  private done(w: Worker, data: Reply): void {
    const j = this.busy.get(w);
    this.busy.delete(w);
    if (j) {
      if (data.ev) {
        const placements = data.ev.placements.map((p) => ({ ...p, family: family(p.family)! })) as Placement[];
        j.ok({ ...data.ev, placements });
      } else j.fail(new Error(data.error ?? 'Worker failure.'));
    }
    this.next();
  }

  dispose(): void {
    this.clear();
    for (const j of this.busy.values()) j.fail(new Error('cancelled'));
    this.busy.clear();
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
