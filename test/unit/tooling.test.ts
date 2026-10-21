// The tools that keep conversations from undoing each other: the lock shared by the check and the
// Playwright runs (scripts/lock.mjs) and the decision of the Stop hook (scripts/gate.mjs).
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const load = (f: string) => import(pathToFileURL(join(ROOT, 'scripts', f)).href);

describe('lock (scripts/lock.mjs)', () => {
  it('a second run waits for the first and gets the lock once it is released', async () => {
    const { acquire } = await load('lock.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'forma-lock-'));
    const release = await acquire('t', { dir, waitS: 5 });
    let second = false;
    const waiting = acquire('t', { dir, waitS: 5 }).then((r: () => void) => {
      second = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(second).toBe(false);
    release();
    (await waiting)();
    expect(second).toBe(true);
  });

  it('a lock whose owner is gone is taken over at once; a held one fails after its wait', async () => {
    const { acquire } = await load('lock.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'forma-lock-'));
    const dead = spawn(process.execPath, ['-e', '0']);
    await new Promise((r) => dead.on('exit', r));
    writeFileSync(join(dir, 't.lock'), JSON.stringify({ pid: dead.pid, at: Date.now(), what: 'gone' }));
    const release = await acquire('t', { dir, waitS: 0 });
    await expect(acquire('t', { dir, waitS: 0 })).rejects.toThrow(/still held/);
    release();
  });
});

describe('gate (scripts/gate.mjs)', () => {
  it('runs the check only for a conversation that changed code, and never loops on the same red state', async () => {
    const { decide } = await load('gate.mjs');
    const failed = { fingerprint: 'a', reason: 'red' };
    expect(decide({ touched: false, fingerprint: '', failed: null, active: false })).toBe('skip');
    expect(decide({ touched: true, fingerprint: 'a', failed: null, active: false })).toBe('run');
    expect(decide({ touched: true, fingerprint: 'b', failed, active: true })).toBe('run');
    expect(decide({ touched: true, fingerprint: 'a', failed, active: false })).toBe('block');
    expect(decide({ touched: true, fingerprint: 'a', failed, active: true })).toBe('warn');
  });

  it('counts code and settings, not docs, notes or files outside the project', async () => {
    const { counts } = await load('gate.mjs');
    expect(counts(join(ROOT, 'src/f3/ui/shell.ts'), ROOT)).toBe(true);
    expect(counts(join(ROOT, 'scripts/check.mjs'), ROOT)).toBe(true);
    expect(counts(join(ROOT, 'docs/PLAN.md'), ROOT)).toBe(false);
    expect(counts(join(ROOT, 'CLAUDE.md'), ROOT)).toBe(false);
    expect(counts(join(tmpdir(), 'x.ts'), ROOT)).toBe(false);
  });
});
