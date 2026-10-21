import { defineConfig } from '@playwright/test';

// Two suites, on their own origin (5795), never on 5792, where the projects of whoever uses the editor
// are saved (the tests clear and fill the page storage):
// - visual: the fixed scenes captured once and compared with their references (e2e/visual.spec.ts);
// - flows: gestures with mouse and keyboard (e2e/f3.spec.ts);
// - tour: the virtual tour published and opened as a visitor (e2e/tour.spec.ts).
// Every wait has an end: a test fails at its timeout, the run at globalTimeout, and nothing is retried
// (a test that passes on a second try hides a real fault).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  globalTimeout: 15 * 60_000,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/visual/{arg}{ext}',
  expect: {
    timeout: 10_000,
    // Exact: on SwiftShader the same code gives the same pixels on every run (checked: three captures
    // identical), so any changed pixel is a change. three.js allows 0.1 per pixel and 0.1% of pixels,
    // but it compares across GPUs; that margin let textured materials 3% darker pass here.
    toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 },
  },
  use: {
    baseURL: 'http://127.0.0.1:5795',
    viewport: { width: 1440, height: 860 },
    // A click, a wait for the editor state or a page load that does not happen fails here, with its step.
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // SwiftShader: the same pixels on every run on this machine (a GPU driver may differ between runs).
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
  },
  projects: [
    // The smoke check of every change: the real GPU (the installed Chrome, Direct3D 11 through ANGLE:
    // about 10 s for every scene), state asserted instead of pixels, so no SwiftShader and no exact images.
    {
      name: 'smoke',
      testMatch: 'smoke.spec.ts',
      timeout: 90_000,
      use: { channel: 'chrome', launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } },
    },
    { name: 'visual', testMatch: 'visual.spec.ts', timeout: 30_000 },
    { name: 'flows', testMatch: 'f3.spec.ts', timeout: 60_000 },
    // The published tour, made and walked through: one long test (two exports of the model).
    { name: 'tour', testMatch: 'tour.spec.ts', timeout: 600_000 },
    // Pictures and materials: the render forms its first samples on SwiftShader (tens of seconds).
    { name: 'look', testMatch: 'look.spec.ts', timeout: 600_000 },
    // Account, plans and cloud saving, with a cloud kept in the page (e2e/cloud.spec.ts).
    { name: 'cloud', testMatch: 'cloud.spec.ts', timeout: 120_000 },
  ],
  webServer: {
    command: 'npx vite --port 5795 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5795',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
