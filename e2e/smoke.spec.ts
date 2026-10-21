// The smoke check of every change (npm run smoke, part of npm run check): one page on the real GPU,
// every fixed scene (e2e/scenes.ts) opened in it one after the other without a reload, each waited
// for until the view is final (View.settled), and then the state is asserted, not the pixels:
//   - the sentinel (src/app/sentinel.ts) found no error: no exception, rejected promise, console
//     error, shader error, lost context, worker failure or document the validator refuses;
//   - the scene drew something, within its ceilings of draw calls and triangles of one frame.
// One picture per scene goes to test-results/smoke/ to be looked at; nothing compares them. The exact
// pictures are the visual check (e2e/visual.spec.ts, SwiftShader), run before a stage closes.
import { expect, test } from '@playwright/test';
import { SCENES } from './scenes';
import { MAX } from './ceilings';

test.describe.configure({ mode: 'serial' });

test('every scene opens, draws and reports no problem', async ({ page }, info) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  // English, no first-run guide and no start screen: the editor opens straight on the scene.
  await page.addInitScript(() => {
    localStorage.setItem('oriel_lang', 'en');
    localStorage.setItem('oriel_guide_off', '1');
    (globalThis as any).__orielNoStart = true;
  });
  await page.goto('/editor.html');
  await page.waitForFunction(() => !!(globalThis as any).forma3 && !!(globalThis as any).forma3Problems);
  const gpu = await page.evaluate(() => {
    const gl = (globalThis as any).forma3.view.renderer.getContext() as WebGL2RenderingContext;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  info.annotations.push({ type: 'renderer', description: gpu });
  console.log(`renderer: ${gpu}`);

  for (const s of SCENES) {
    const t0 = Date.now();
    await page.evaluate(({ project, camera, select }) => {
      const ed = (globalThis as any).forma3;
      ed.select({});
      ed.store.replace(project, '');
      ed.enter(null);
      if (select) ed.select({ building: ed.project.buildings.find((x: any) => x.name === select).id });
      const v = ed.view;
      v.theta = camera.theta;
      v.phi = camera.phi;
      v.frame();
      v.distance *= camera.zoom;
      v.updateCamera();
    }, { project: s.project, camera: s.camera, select: s.select ?? null });
    await page.waitForFunction(() => (globalThis as any).forma3.view.settled, null, { timeout: 15_000 });
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
    const problems = await page.evaluate(() => (globalThis as any).forma3Problems() as { severity: string; source: string; message: string }[]);
    await page.screenshot({ path: info.outputPath(`${s.name}.png`) });
    console.log(`${s.name}: ${Date.now() - t0} ms, ${JSON.stringify(n)}${problems.length ? `, problems: ${problems.length}` : ''}`);
    for (const p of problems.filter((x) => x.severity === 'warning')) console.log(`  warning (${p.source}): ${p.message}`);
    expect(problems.filter((p) => p.severity === 'error'), `${s.name}: problems found by the sentinel`).toEqual([]);
    expect(crashes, `${s.name}: page errors`).toEqual([]);
    expect(n.triangles, `${s.name}: the scene drew nothing`).toBeGreaterThan(0);
    const max = MAX[s.name];
    if (max) {
      expect(n.calls, `${s.name}: draw calls of one frame`).toBeLessThanOrEqual(max.calls);
      expect(n.triangles, `${s.name}: triangles of one frame`).toBeLessThanOrEqual(max.triangles);
    }
  }
});
