import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import type { Plugin } from 'vite';
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

// `import code from './x.ts?tour-bundle'`: the module x.ts bundled with what it imports (three.js…) into
// one minified script, given as text — the published tour (src/f3/tour/runtime.ts) is written into the
// page it exports, so the page works alone, offline, from a file or any host. Rolldown is the bundler
// Vite itself is built on (https://rolldown.rs/apis/bundler-api).
function tourBundle(): Plugin {
  const PREFIX = '\0tour-bundle:';
  return {
    name: 'oriel-tour-bundle',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith('?tour-bundle')) return null;
      const r = await this.resolve(id.slice(0, -'?tour-bundle'.length), importer, { skipSelf: true });
      return r ? PREFIX + r.id : null;
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const entry = id.slice(PREFIX.length);
      const bundle = await rolldown({ input: entry, cwd: at('.'), logLevel: 'silent' });
      try {
        const out = await bundle.generate({ format: 'iife', minify: true });
        for (const m of out.output) if (m.type === 'chunk') for (const f of m.moduleIds) this.addWatchFile(f);
        return `export default ${JSON.stringify(out.output[0]!.type === 'chunk' ? out.output[0]!.code : '')};`;
      } finally {
        await bundle.close();
      }
    },
  };
}

export default defineConfig({
  plugins: [tourBundle()],
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
