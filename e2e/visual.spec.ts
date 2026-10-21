// The visual check: each fixed scene (e2e/scenes.ts) is opened, waited for until the picture is final
// (View.settled: drawn, batched, compiled, textures in, rendered) and captured once, compared with its
// reference picture (Playwright toHaveScreenshot; references in e2e/visual/, made in this same
// environment). The page runs with a fixed chance and a stopped clock (as three.js does in its own
// screenshot tests), so the same code gives the same pixels. Draw calls and triangles of one frame are
// counted against ceilings. A changed picture is never accepted by the test: whoever made the change
// looks at the new picture and writes it with `npm run visual:accept` (= --update-snapshots).
import { expect, test } from '@playwright/test';
import { SCENES } from './scenes';

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

/** Ceilings of one frame of each scene (every pass: scene, ambient occlusion, shadows, bloom), measured 2026-10-13. */
// 2026-10-13: the curved building's rounded corners take windows (audit D27): +2.5k triangles in the
// scenes that show it (their frames, glass and the openings in the corner walls).
const MAX: Record<string, { calls: number; triangles: number }> = {
  samples: { calls: 153, triangles: 188_513 },
  night: { calls: 166, triangles: 188_526 },
  tower: { calls: 39, triangles: 278_453 },
  close: { calls: 51, triangles: 10_005 },
  // 2026-10-13: two more finishes (Painted steel, Glazed ceramic) are two more blocks: +4 calls, +184 triangles each.
  finishes: { calls: 97, triangles: 5_441 },
  cutaway: { calls: 15, triangles: 1_669 },
  exploded: { calls: 43, triangles: 32_217 },
  // 2026-10-13: the garden scene, new: 22 grown plants (bark tubes and leaf cards), every pass.
  garden: { calls: 59, triangles: 63_371 },
  // 2026-10-13: the furniture scene, new: 18 pieces with rounded boxes and lofted ceramics, every pass.
  furniture: { calls: 101, triangles: 64_693 },
  // 2026-10-13: the screen-space selection outline (OutlinePass) draws the scene's depth and the selected
  // building's mask once more, only while something is selected: +139 calls, +95k triangles.
  selected: { calls: 363, triangles: 284_398 },
};

for (const s of SCENES) {
  test(`${s.name}: ${s.what}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.addInitScript(frozen);
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
