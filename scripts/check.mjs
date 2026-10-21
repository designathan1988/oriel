// The check of a change: `npm run check` (also the git pre-commit hook). Under a minute, every step
// with a hard limit, stops at the first failure, prints the seconds of each step.
//   types   tsc (incremental)
//   unit    vitest: the static rules (test/unit/arch.test.ts), the work counts
//           (test/unit/budget.test.ts) and the logic of the model and the evaluation
//   visual  the fixed scenes captured once and compared with their references (e2e/visual.spec.ts)
// What runs depends on what changed (git): docs only → nothing; tests only → types and unit; source,
// scenes or config → everything. Every visual scene loads the whole editor, so a change anywhere in
// the source can change any picture: all of them are captured (about 5 s each), never a guessed subset.
// The gesture flows (e2e/f3.spec.ts, minutes) are not here: run the one of the feature touched,
// `npm run flows -- -g "<name>"`, and all of them before a stage closes (`npm run flows`).
// `node scripts/check.mjs --all` runs every step whatever changed. One check at a time (scripts/lock.mjs,
// shared with scripts/pw.mjs): a second one waits for the first.
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire } from './lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const all = process.argv.includes('--all');

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
if (!files || files.some((f) => !docs(f) && !tests(f))) steps.push('visual');

const node = process.execPath;
const STEPS = {
  types: { limit: 60, cmd: [node, 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', '--tsBuildInfoFile', 'node_modules/.cache/tsc.tsbuildinfo'] },
  unit: { limit: 60, cmd: [node, 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers', '4'] },
  visual: { limit: 120, cmd: [node, 'node_modules/@playwright/test/cli.js', 'test', '--project=visual', '--global-timeout=100000'] },
};

/** Runs a step; past its limit the whole process tree is killed and the step fails. */
function run(name) {
  const { limit, cmd } = STEPS[name];
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGKILL');
    }, limit * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      done({ name, ok: code === 0 && !late, s, why: late ? `passed its limit of ${limit} s` : code === 0 ? '' : `exit ${code}` });
    });
  });
}

const t0 = Date.now();
console.log(files ? `changed: ${files.length ? files.join(', ') : 'nothing'}` : 'changed: everything (--all or no git)');
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
process.exit(failed ? 1 : 0);
