// The problems the running app finds in itself (the sentinel): exceptions, rejected promises, console
// errors, shader errors, a lost WebGL context, a kernel result Manifold refused, a document that would
// not open again. Every layer may report here (the kernel imports nothing, so anything can import it);
// the app shows them on screen in development (src/app/sentinel.ts) and the smoke check
// (e2e/smoke.spec.ts) fails on any error. A worker reports into its own copy and sends the list back
// with its reply (worker/eval.worker.ts → eval/pool.ts).
// Nothing here costs anything unless something goes wrong: a report is a push into a short list.

export type Severity = 'error' | 'warning';

export interface Problem {
  severity: Severity;
  /** Where it comes from: 'exception', 'promise', 'console', 'webgl', 'kernel', 'document', 'worker'. */
  source: string;
  message: string;
  /** How many times the same problem was reported (repeats are counted, not listed). */
  count: number;
}

const MAX = 200;
const list: Problem[] = [];
const listeners = new Set<(p: Problem) => void>();

/** Records a problem; the same source and message again only raises its count. */
export function report(severity: Severity, source: string, message: string): void {
  const same = list.find((p) => p.severity === severity && p.source === source && p.message === message);
  if (same) {
    same.count++;
    return;
  }
  if (list.length >= MAX) return;
  const p: Problem = { severity, source, message, count: 1 };
  list.push(p);
  for (const fn of listeners) fn(p);
}

/** What was reported so far (a copy). */
export function problems(): Problem[] {
  return list.map((p) => ({ ...p }));
}

/** Takes the reported problems out (a worker sends them with its reply). */
export function drainProblems(): Problem[] {
  return list.splice(0, list.length);
}

/** Puts problems reported elsewhere (a worker) into this list. */
export function adoptProblems(ps: readonly Problem[] | undefined): void {
  for (const p of ps ?? []) for (let i = 0; i < p.count; i++) report(p.severity, p.source, p.message);
}

export function clearProblems(): void {
  list.length = 0;
}

/** Called for each new problem (not for repeats). */
export function onProblem(fn: (p: Problem) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The first line of the stack outside this file: where a report was made from. */
export function caller(): string {
  const lines = (new Error().stack ?? '').split('\n').slice(1);
  const at = lines.find((l) => !l.includes('problems.ts') && !l.includes('kernel.ts'));
  return at?.trim().replace(/^at\s+/, '') ?? 'unknown place';
}
