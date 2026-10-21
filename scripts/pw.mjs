// Playwright under the check's lock (scripts/lock.mjs): `npm run flows`, `visual` and `visual:accept`
// never run at the same time as a check or as each other, since they share the server on 5795.
// Arguments go to `playwright test` unchanged.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquire } from './lock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
try {
  await acquire('check', { waitS: 600, what: `playwright test ${args.join(' ')}` });
} catch (e) {
  console.log(e.message);
  process.exit(1);
}
const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...args], { cwd: ROOT, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
