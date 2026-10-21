// Static rules of the code (read from the files, nothing runs): the layers, where three.js may be
// imported, a pure evaluation, no dead file and no test that waits on the clock. They hold today;
// a change that breaks one fails here in milliseconds, before any test opens a browser.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** Comments out (a commented import or a word in a note is not code). Strings stay. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SRC = files(join(ROOT, 'src'), /\.ts$/).filter((f) => !f.endsWith('.d.ts'));
const TEXT = new Map(SRC.map((f) => [f, code(readFileSync(f, 'utf8'))]));

/** Module specifiers of a file: static, re-exports, side effects and dynamic imports. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g])
    for (const m of src.matchAll(re)) out.push(m[1]!);
  return out;
}

/** A relative specifier to its file (`?worker&inline`, `?url` dropped), or null for a package. */
function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  // Data (the interface dictionaries) is not code: it only has to exist.
  if (/\.json$/.test(base) && existsSync(base)) return null;
  for (const p of [base, `${base}.ts`, join(base, 'index.ts')]) if (TEXT.has(p)) return p;
  throw new Error(`${rel(from)}: import '${spec}' resolves to no file`);
}

/** Layer of a file: `f3/<folder>` inside the editor, the top folder otherwise. */
function layer(f: string): string {
  const parts = rel(f).split('/');
  return parts[1] === 'f3' ? `f3/${parts[2]}` : parts[1]!;
}

const BASE = ['core', 'styles', 'geometry'];
/** What each layer may import (besides itself). Evaluation never reaches the editor, the screen or three.js. */
const MAY: Record<string, string[]> = {
  core: BASE,
  styles: BASE,
  geometry: BASE,
  render: [...BASE],
  'f3/kernel': [],
  'f3/model': [...BASE],
  'f3/families': ['f3/model', ...BASE],
  'f3/eval': ['f3/model', 'f3/families', 'f3/kernel', ...BASE],
  'f3/worker': ['f3/eval', 'f3/model', 'f3/kernel', ...BASE],
  'f3/render': ['f3/eval', 'f3/families', 'f3/model', 'render', ...BASE],
  'f3/io': ['f3/eval', 'f3/families', 'f3/model', 'f3/kernel', 'f3/render', 'render', ...BASE],
  'f3/editor': ['f3/eval', 'f3/families', 'f3/model', 'f3/kernel', 'f3/render', 'f3/ui', 'render', 'ui', ...BASE],
  'f3/ui': ['f3/editor', 'f3/eval', 'f3/families', 'f3/model', 'f3/render', 'ui', ...BASE],
  ui: [],
  app: ['f3/editor', 'f3/io', 'f3/kernel', 'f3/model', 'f3/ui'],
};
/** The only layers that draw (three.js); the rest is data and can run in a worker or in Node. */
const THREE_OK = new Set(['render', 'f3/render', 'f3/editor', 'f3/io']);
/** Pure layers: the same document always gives the same result (no clock, no chance). */
const PURE = new Set(['f3/eval', 'f3/families', 'f3/kernel', 'geometry']);
/** Exceptions to purity: none (the straight skeleton stops after a count of events since 2026-10-13). */
const IMPURE_KNOWN: string[] = [];

describe('architecture (static)', () => {
  it('every layer imports only the layers below it', () => {
    const bad: string[] = [];
    for (const [f, src] of TEXT) {
      const from = layer(f);
      expect(MAY[from], `${rel(f)}: layer ${from} has no rule`).toBeDefined();
      for (const s of specifiers(src)) {
        // `?worker` starts a worker (its own entry, reached below), it is not a dependency.
        const t = s.includes('?worker') ? null : resolveLocal(f, s);
        if (!t) continue;
        const to = layer(t);
        if (to !== from && !MAY[from]!.includes(to)) bad.push(`${rel(f)} (${from}) imports ${rel(t)} (${to})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('three.js is imported only where something is drawn', () => {
    const bad = [...TEXT].filter(([f, src]) => !THREE_OK.has(layer(f)) && specifiers(src).some((s) => s === 'three' || s.startsWith('three/'))).map(([f]) => rel(f));
    expect(bad).toEqual([]);
  });

  it('evaluation is pure: no Math.random, Date or crypto in eval, families, kernel, geometry', () => {
    const bad: string[] = [];
    for (const [f, src] of TEXT) {
      if (!PURE.has(layer(f))) continue;
      for (const m of src.matchAll(/\bMath\.random\b|\bDate\.now\b|\bnew Date\b|\bcrypto\./g)) bad.push(`${rel(f)}: ${m[0]}`);
    }
    expect(bad).toEqual(IMPURE_KNOWN);
  });

  it('no dead file: every source file is reached from the editor page', () => {
    const entry = join(ROOT, 'src/app/editor.ts');
    const seen = new Set<string>([entry]);
    const todo = [entry];
    while (todo.length) {
      const f = todo.pop()!;
      for (const s of specifiers(TEXT.get(f)!)) {
        const t = resolveLocal(f, s);
        if (t && !seen.has(t)) {
          seen.add(t);
          todo.push(t);
        }
      }
    }
    expect(SRC.filter((f) => !seen.has(f)).map(rel)).toEqual([]);
  });
});

describe('tests (static)', () => {
  const TESTS = [...files(join(ROOT, 'test'), /\.ts$/), ...files(join(ROOT, 'e2e'), /\.ts$/)];

  it('no focused test (.only) left behind', () => {
    const bad = TESTS.filter((f) => /\b(?:it|test|describe)\.only\(/.test(code(readFileSync(f, 'utf8')))).map(rel);
    expect(bad).toEqual([]);
  });

  it('browser tests wait on the editor state, never on the clock (the delay of a real UI timer is named)', () => {
    const bad: string[] = [];
    for (const f of files(join(ROOT, 'e2e'), /\.ts$/)) {
      const src = code(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/waitForTimeout\(([^)]*)\)/g)) if (!/^[A-Z_]+$/.test(m[1]!.trim())) bad.push(`${rel(f)}: waitForTimeout(${m[1]})`);
    }
    expect(bad).toEqual([]);
  });
});
