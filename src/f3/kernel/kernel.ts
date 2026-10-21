// Loads Manifold (WASM) once. In the browser, the caller passes the .wasm URL
// (Vite resolves it with ?url); in Node, the package finds the file by itself.
// Every Manifold and CrossSection created needs .delete(): use `scope`.
import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { caller, report } from './problems';

export type Kernel = ManifoldToplevel;
export type { Manifold, CrossSection };

let loading: Promise<Kernel> | null = null;
let ready: Kernel | null = null;

export function loadKernel(wasmUrl?: string): Promise<Kernel> {
  if (ready) return Promise.resolve(ready);
  loading ??= (async () => {
    const opts = wasmUrl ? { locateFile: () => wasmUrl } : undefined;
    const k = await (Module as unknown as (o?: object) => Promise<Kernel>)(opts);
    k.setup();
    ready = k;
    return k;
  })();
  return loading;
}

/** Kernel already loaded (synchronous); an error if nobody called loadKernel before. */
export function kernel(): Kernel {
  if (!ready) throw new Error('Geometry kernel not loaded yet.');
  return ready;
}

export const kernelReady = (): boolean => ready !== null;

/**
 * A result that can be used: no error and not empty. An error is reported to the sentinel with the
 * place that made the mesh (a mesh Manifold refused is a bug of the code that built it, even when the
 * evaluation goes on without that part); an empty result is a normal outcome and is not reported.
 */
export function usable(m: Manifold): boolean {
  const s = m.status();
  if (s !== 'NoError') report('warning', 'kernel', `Manifold refused a mesh (${s}) made at ${caller()}`);
  return s === 'NoError' && !m.isEmpty();
}

/**
 * Manifold objects made since the count was last zeroed (every one passes through a Scope): the work
 * of an evaluation as a count, the same on any machine (test/unit/budget.test.ts).
 */
export const kernelStats: { objects: number } = { objects: 0 };

/**
 * Collects Manifold objects to free them all at once at the end of an
 * evaluation (WASM has no garbage collection).
 */
export class Scope {
  private items: { delete(): void }[] = [];
  keep<T extends { delete(): void }>(o: T): T {
    kernelStats.objects++;
    this.items.push(o);
    return o;
  }
  dispose(): void {
    for (const o of this.items) o.delete();
    this.items = [];
  }
}
