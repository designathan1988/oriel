// The gate of a Claude Code conversation (hooks in .claude/settings.json): a turn that changed code
// does not end while `npm run check` is red. CLAUDE.md only asks for it; this makes it happen.
//   node scripts/gate.mjs touch   PostToolUse on Edit|Write|NotebookEdit: notes that this conversation
//                                 changed a file of the project other than docs.
//   node scripts/gate.mjs stop    Stop: when this conversation changed something since the last green
//                                 check, runs the check; red blocks the end of the turn (exit 2, the
//                                 reason goes to Claude).
// Cheap when nothing is to be checked: no change of this conversation, no run. A red check is run once
// per state of the files: the same state blocks again from the stored result, and when Claude is already
// continuing because of this hook (stop_hook_active) with nothing changed, the check runs once more (a
// failure can be passing) and, still red, the turn ends with a warning to the user instead of a loop. Not seen: files changed by shell commands (sed, cp) only.
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'node_modules/.cache/claude-gate');

/** A project file whose change can change what the check sees (docs and notes cannot). */
export function counts(file, root = ROOT) {
  const r = relative(root, file).split(sep).join('/');
  if (!r || r.startsWith('..') || /^[a-zA-Z]:/.test(r)) return false;
  return !(r.startsWith('docs/') || r.endsWith('.md') || r.startsWith('node_modules/') || r.startsWith('.git/'));
}

/**
 * What the Stop hook does: `skip` (nothing of this conversation to check), `run`, `block` (same files as
 * a red check already seen: block again with its result) or `warn` (same red state while Claude is
 * already continuing because of this hook: let the turn end and tell the user).
 */
export function decide({ touched, fingerprint, failed, active }) {
  if (!touched) return 'skip';
  if (failed && failed.fingerprint === fingerprint) return active ? 'warn' : 'block';
  return 'run';
}

/** The state of the working tree: commit, changes to it and untracked files with their contents. */
function fingerprint() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 256 << 20 });
  const h = createHash('sha1');
  h.update(git(['rev-parse', 'HEAD']));
  h.update(git(['diff', 'HEAD', '--binary']));
  for (const f of git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean)) {
    h.update(f);
    try {
      h.update(readFileSync(join(ROOT, f)));
    } catch {
      // Removed meanwhile: its name is enough.
    }
  }
  return h.digest('hex');
}

function input() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function main(mode) {
  const hook = input();
  const id = String(hook.session_id || 'none').replace(/[^\w-]/g, '_');
  const mark = join(DIR, `${id}.touched`);
  const fail = join(DIR, `${id}.failed.json`);
  mkdirSync(DIR, { recursive: true });

  if (mode === 'touch') {
    const file = hook.tool_input?.file_path || hook.tool_input?.notebook_path;
    if (file && counts(file)) writeFileSync(mark, file);
    return 0;
  }

  const failed = existsSync(fail) ? JSON.parse(readFileSync(fail, 'utf8')) : null;
  const fp = existsSync(mark) ? fingerprint() : '';
  const what = decide({ touched: existsSync(mark), fingerprint: fp, failed, active: !!hook.stop_hook_active });
  if (what === 'skip') return 0;
  let reason = failed?.reason;
  if (what === 'warn') {
    // Run once more: a red check can be passing (a page reloaded by another conversation's edit).
    const r = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 140_000, maxBuffer: 64 << 20 });
    if (r.status === 0) {
      rmSync(mark, { force: true });
      rmSync(fail, { force: true });
      return 0;
    }
    process.stdout.write(JSON.stringify({ systemMessage: 'npm run check is still red; the turn ended without fixing it (scripts/gate.mjs).' }));
    return 0;
  }
  if (what === 'run') {
    const r = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 140_000, maxBuffer: 64 << 20 });
    if (r.status === 0) {
      rmSync(mark, { force: true });
      rmSync(fail, { force: true });
      return 0;
    }
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n');
    reason = out.slice(-60).join('\n') || `check ended with ${r.status ?? r.signal}`;
    writeFileSync(fail, JSON.stringify({ fingerprint: fp, reason }));
  }
  process.stderr.write(
    'npm run check is red, so this turn cannot end yet (scripts/gate.mjs). Fix the cause; if it comes from ' +
      "another conversation's work in this folder, tell the user instead of changing it.\n\n" + reason,
  );
  return 2;
}

if (import.meta.main) process.exit(main(process.argv[2]));
