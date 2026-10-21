// One run at a time on a shared resource (the Playwright server on 5795, the CPU of the visual scenes):
// two conversations in this folder, or a Stop hook and a commit, would otherwise start two checks that
// share one Vite server (reuseExistingServer) and kill it under each other (on Windows the web server
// is killed, never shut down gracefully). The lock is a file holding the owner's pid and start time:
// the second run waits for it with a limit, and a lock whose owner is gone (or older than any run can
// be) is taken over instead of waited for.
import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../node_modules/.cache/locks', import.meta.url));
/** No run under a lock lasts longer (the check's steps add up to 4 minutes, the flows to 15). */
const STALE_MS = 20 * 60_000;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The owner of a lock file, or null when the file is missing, unreadable, dead or stale. */
export function owner(file, now = Date.now()) {
  let o;
  try {
    o = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!Number.isInteger(o.pid) || !alive(o.pid) || now - o.at > STALE_MS) return null;
  return o;
}

/**
 * Takes the lock `name`, waiting at most `waitS` seconds for its owner to finish. Returns the release
 * function, or throws with the owner's pid and command when the wait ran out.
 */
export async function acquire(name, { waitS = 300, what = process.argv.slice(1).join(' '), dir = DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.lock`);
  const end = Date.now() + waitS * 1000;
  let told = false;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now(), what }));
      closeSync(fd);
      let held = true;
      const release = () => {
        if (!held) return;
        held = false;
        rmSync(file, { force: true });
      };
      process.on('exit', release);
      return release;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const o = owner(file);
    if (!o) {
      rmSync(file, { force: true }); // Its owner is gone: take it over.
      continue;
    }
    if (Date.now() > end) throw new Error(`lock ${name} still held after ${waitS} s by pid ${o.pid} (${o.what})`);
    if (!told) {
      console.log(`waiting for lock ${name}: pid ${o.pid} (${o.what})`);
      told = true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
