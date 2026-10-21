// Building evaluation in a Web Worker: the same pure evaluator as the main thread (no three),
// with its own Manifold. The result goes back with the shell arrays transferred; placements carry
// their family by ID (a family has functions, which cannot cross threads).
import { loadKernel } from '../kernel/kernel';
import { drainProblems, report } from '../kernel/problems';
import { evaluateBuilding, type EvalOptions } from '../eval/evaluate';
import type { Building3, ComponentType } from '../model/schema';

export interface EvalRequest {
  id: number;
  building: Building3;
  opts: Omit<EvalOptions, 'hidden' | 'timings'>;
  hidden: string[];
  types: ComponentType[];
}

let ready: Promise<unknown> | null = null;

self.onmessage = async (e: MessageEvent<EvalRequest | { init: string }>) => {
  // First message: the absolute .wasm URL (an inline worker has a blob URL, nothing resolves against it).
  if ('init' in e.data) {
    ready = loadKernel(e.data.init);
    return;
  }
  const { id, building, opts, hidden, types } = e.data;
  try {
    await ready;
    const hide = new Set(hidden);
    const ev = evaluateBuilding(building, { ...opts, hidden: (s) => hide.has(s.id) }, { types });
    const placements = ev.placements.map((p) => ({ ...p, family: p.family.id }));
    const sh = ev.shell;
    // One entry per buffer (a buffer listed twice throws).
    const transfer = [...new Set([sh.positions.buffer, sh.indices.buffer, sh.faceOf.buffer, ...(sh.floorOf ? [sh.floorOf.buffer] : [])])] as ArrayBuffer[];
    // What the kernel reported while evaluating goes back with the result (the page shows it).
    (self as unknown as Worker).postMessage({ id, ev: { ...ev, placements }, problems: drainProblems() }, transfer);
  } catch (err) {
    const error = String((err as Error)?.stack ?? err);
    report('error', 'worker', error);
    (self as unknown as Worker).postMessage({ id, error, problems: drainProblems() });
  }
};
