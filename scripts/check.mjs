// The check of a change: `npm run check` (also the git pre-commit hook and the Stop hook of a Claude Code
// conversation, scripts/gate.mjs). Seconds, not minutes: every step has a hard limit, the run stops at
// the first failure and prints the seconds of each step.
//   types   tsc (TypeScript 7, incremental): under a second
//   unit    vitest on the tests the changed files reach (--changed, by the files each test loaded on
//           its last run) plus the static rules (test/unit/arch.test.ts, which reads src with fs)
//   smoke   one page on the real GPU opens every fixed scene and fails on any problem the app's own
//           sentinel found (e2e/smoke.spec.ts): about 10 s
// What runs depends on what changed (git): docs only → nothing; tests only → types and unit.
// `node scripts/check.mjs --full` (npm run check:full) runs every step whatever changed, every unit
// test, and the exact pictures (e2e/visual.spec.ts, SwiftShader, about a minute): before a stage closes,
// after changing imports, or when the look of the view changed on purpose. The gesture flows
// (e2e/f3.spec.ts, minutes) are never in a check: `npm run flows -- -g "<name>"` for the feature touched.
// One check at a time (scripts/lock.mjs, shared with scripts/pw.mjs): a second one waits for the first.
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire } from './lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const all = process.argv.includes('--full') || process.argv.includes('--all');

function changed() {
  try {
    const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    return [...new Set([...git(['diff', '--name-only', 'HEAD']), ...git(['ls-files', '--others', '--exclude-standard'])])];
  } catch {
    return null; // Not a repository (or no commit yet): everything runs.
  }
}

const files = all ? null : changed();
const docs = (f) => f.startsWith('docs/') || f.endsWith('.md');
const tests = (f) => f.startsWith('test/');
const steps = [];
if (!files || files.some((f) => !docs(f))) steps.push('types', 'unit');
if (!files || files.some((f) => !docs(f) && !tests(f))) steps.push('smoke');
if (all) steps.push('visual');

const node = process.execPath;
const vitest = [node, 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '4'];
const STEPS = {
  types: { limit: 30, cmds: [[node, 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', 'node_modules/.cache/tsc.tsbuildinfo']] },
  unit: { limit: 60, cmds: all ? [vitest] : [[...vitest, '--changed', '--passWithNoTests', '--bail=1'], [...vitest, 'test/unit/arch.test.ts']] },
  smoke: { limit: 60, cmds: [[node, 'node_modules/@playwright/test/cli.js', 'test', '--project=smoke', '--reporter=line', '--global-timeout=55000']] },
  visual: { limit: 120, cmds: [[node, 'node_modules/@playwright/test/cli.js', 'test', '--project=visual', '--global-timeout=100000']] },
};

/** Runs a step (its commands one after the other); past its limit the process tree is killed and the step fails. */
async function run(name) {
  const { limit, cmds } = STEPS[name];
  const t0 = Date.now();
  const end = t0 + limit * 1000;
  for (const cmd of cmds) {
    const r = await new Promise((done) => {
      const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else child.kill('SIGKILL');
      }, Math.max(0, end - Date.now()));
      child.on('exit', (code) => {
        clearTimeout(timer);
        done({ code, late });
      });
    });
    if (r.code !== 0 || r.late) {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      return { name, ok: false, s, why: r.late ? `passed its limit of ${limit} s` : `exit ${r.code}` };
    }
  }
  return { name, ok: true, s: ((Date.now() - t0) / 1000).toFixed(1), why: '' };
}

const t0 = Date.now();
console.log(files ? `changed: ${files.length ? files.join(', ') : 'nothing'}` : 'changed: everything (--full or no git)');
console.log(`steps: ${steps.join(', ') || 'none (docs only)'}`);
// One check at a time in this folder (another conversation, a Stop hook, a commit): they would share the
// Playwright server on 5795 and the CPU. The wait has a limit; a lock whose owner died is taken over.
if (steps.length) {
  try {
    await acquire('check', { what: 'npm run check' });
  } catch (e) {
    console.log(`\ncheck: FAIL  ${e.message}`);
    process.exit(1);
  }
}
const report = [];
for (const name of steps) {
  const r = await run(name);
  report.push(r);
  if (!r.ok) break;
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\ncheck:');
for (const r of report) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(7)} ${r.s.padStart(5)} s${r.why ? `  (${r.why})` : ''}`);
console.log(`  total ${total} s`);
const failed = report.find((r) => !r.ok);
if (failed?.name === 'visual') console.log('\nA picture changed: look at test-results/ (expected, actual, diff). If the new one is right: npm run visual:accept');
if (failed?.name === 'smoke') console.log('\nThe smoke check failed: its message names the scene and the problem; the picture of each scene is in test-results/.');
process.exit(failed ? 1 : 0);
