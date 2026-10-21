// The visual check: each fixed scene (e2e/scenes.ts) is opened, waited for until the picture is final
// (View.settled: drawn, batched, compiled, textures in, rendered) and captured once, compared with its
// reference picture (Playwright toHaveScreenshot; references in e2e/visual/, made in this same
// environment). The page runs with a fixed chance and a stopped clock (as three.js does in its own
// screenshot tests), so the same code gives the same pixels. Draw calls and triangles of one frame are
// counted against ceilings. A changed picture is never accepted by the test: whoever made the change
// looks at the new picture and writes it with `npm run visual:accept` (= --update-snapshots).
import { expect, test } from '@playwright/test';
import { SCENES } from './scenes';
import { MAX } from './ceilings';

/** Fixed chance, ids and clock in the page, before any script of the app runs. */
function frozen() {
  let seed = Math.PI / 4;
  Math.random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
  let n = 0;
  Object.defineProperty(crypto, 'randomUUID', { value: () => `00000000-0000-4000-9000-${(++n).toString(16).padStart(12, '0')}`, configurable: true });
  const zero = () => 0;
  performance.now = zero;
  Date.now = zero;
}

for (const s of SCENES) {
  test(`${s.name}: ${s.what}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(frozen);
    await page.addInitScript(() => {
      localStorage.setItem('oriel_lang', 'en');
    localStorage.setItem('oriel_guide_off', '1');
      (globalThis as any).__orielNoStart = true;
    });
    // The project is the saved one the editor opens (as after a reload): no message, no samples first.
    await page.addInitScript((json) => localStorage.setItem('forma3_project', json), JSON.stringify(s.project));
    await page.goto('/editor.html');
    await page.waitForFunction(() => !!(globalThis as any).forma3);
    await page.evaluate(({ camera, select }) => {
      const ed = (globalThis as any).forma3;
      if (select) {
        const b = ed.project.buildings.find((x: any) => x.name === select);
        ed.select({ building: b.id });
      }
      const v = ed.view;
      v.theta = camera.theta;
      v.phi = camera.phi;
      v.frame();
      v.distance *= camera.zoom;
      v.updateCamera();
    }, { camera: s.camera, select: s.select ?? null });
    await page.waitForFunction(() => (globalThis as any).forma3.view.settled, null, { timeout: 20_000 });
    // The 3D view is final here; Chromium may still raster the top bar icons once more (one color level,
    // seen in a probe), and toHaveScreenshot captures until two in a row match before it compares.
    await expect(page).toHaveScreenshot(`${s.name}.png`);
    const n = await page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      const r = ed.view.renderer;
      r.info.autoReset = false;
      r.info.reset();
      ed.view.look.render();
      const out = { calls: r.info.render.calls, triangles: r.info.render.triangles };
      r.info.autoReset = true;
      return out;
    });
    console.log(`${s.name}: ${JSON.stringify(n)}`);
    const max = MAX[s.name]!;
    expect(n.calls, 'draw calls of one frame').toBeLessThanOrEqual(max.calls);
    expect(n.triangles, 'triangles of one frame').toBeLessThanOrEqual(max.triangles);
    expect(errors).toEqual([]);
  });
}
