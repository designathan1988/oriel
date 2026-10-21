import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// FORMA 3 editor: src/app/editor.html (the page that is used); `/` redirects to it. Paths are absolute so
// the config works from any working directory (a server started from another folder).
const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The port given by whoever starts the server: `--port` on the command line, or PORT from the desktop app
// (`autoPort` in .claude/launch.json: a free port per conversation). Never 5792: the user's projects are
// saved in the storage of that origin, and a server of this folder there would open them for tests.
const port = process.env.PORT ? Number(process.env.PORT) : undefined;
if (port === 5792 || process.argv.some((a, i) => a === '5792' && process.argv[i - 1] === '--port')) {
  throw new Error('5792 holds the user projects: start this folder on another port');
}

export default defineConfig({
  root: at('./src/app'),
  server: { port, strictPort: port !== undefined },
  // PBR textures served next to the app (not embedded in the HTML).
  publicDir: 'public',
  build: {
    outDir: at('./dist'),
    emptyOutDir: true,
    rollupOptions: { input: { editor: at('./src/app/editor.html'), index: at('./src/app/index.html') } },
  },
  test: {
    root: at('.'),
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
