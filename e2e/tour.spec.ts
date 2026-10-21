// The published tour, end to end: made in the editor from the furnished house, downloaded as one HTML
// file and as the app (ZIP), then opened as a visitor would and walked through.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

test('tour: make, publish, open, walk, share', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('oriel_lang', 'en');
    localStorage.setItem('oriel_guide_off', '1');
  });
  await page.goto('/editor.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('[data-tpl="house"]').click();
  await page.waitForFunction(() => !!(globalThis as any).forma3?.view.settled);
  await page.evaluate(() => (globalThis as any).forma3.view.look.setAO(false));

  // The panel: a tour from the rooms (it asks before replacing the stops), a point of interest, a title.
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Virtual tour');
  await page.keyboard.press('Enter');
  const panel = page.locator('.f3-tour');
  await expect(panel).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await panel.locator('[data-auto]').click();
  await page.waitForFunction(() => ((globalThis as any).forma3.project.tour?.stops.length ?? 0) === 8);
  await panel.locator('[data-pick]').click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
  await page.waitForFunction(() => (globalThis as any).forma3.project.tour?.hotspots.length === 1);
  await panel.locator('[data-f="author"]').fill('Studio Test');
  await panel.locator('[data-f="author"]').press('Tab');

  // The site, then the app.
  const siteDl = page.waitForEvent('download', { timeout: 240_000 });
  await panel.locator('[data-site]').click();
  const sitePath = info.outputPath('site.html');
  await (await siteDl).saveAs(sitePath);
  const appDl = page.waitForEvent('download', { timeout: 240_000 });
  await panel.locator('[data-app]').click();
  const appPath = info.outputPath('app.zip');
  await (await appDl).saveAs(appPath);
  const files = Object.keys(unzipSync(readFileSync(appPath)));
  expect(files.sort()).toEqual(['HOW-TO-PUBLISH.txt', 'icon-192.png', 'icon-512.png', 'index.html', 'manifest.webmanifest', 'sw.js']);
  expect(errors).toEqual([]);

  // The visitor: the page alone, from the disk.
  const tour = await context.newPage();
  tour.on('pageerror', (e) => errors.push(e.message));
  await tour.goto('file://' + sitePath);
  await tour.waitForFunction(() => (window as any).__tourReady, null, { timeout: 120_000 });
  await expect(tour.locator('.title h1')).toHaveText('Casa térrea');
  await expect(tour.locator('.title p')).toContainText('Studio Test');
  await expect(tour.locator('.hot')).toHaveCount(1);
  const state = () => tour.evaluate(() => (window as any).__tour.state);

  // A room from the list: walking, inside the house, on its floor.
  await tour.locator('.tools [data-k="rooms"]').click();
  await tour.locator('.side .room', { hasText: 'Quarto 1' }).click();
  await tour.waitForFunction(() => !(window as any).__tour.state.flying && (window as any).__tour.state.mode === 'walk');
  const w0 = (await state()).walker;
  expect(Math.abs(w0.x)).toBeLessThan(6);
  expect(Math.abs(w0.z)).toBeLessThan(4.5);
  expect(w0.feet).toBeCloseTo(0.15, 1);

  // Toward a point well outside: the wall stops the walker inside.
  await tour.evaluate((f) => (window as any).__tour.walkTo(20, -2.2, f), w0.feet);
  await tour.waitForFunction(() => !(window as any).__tour.state.going, null, { timeout: 120_000 });
  const w1 = (await state()).walker;
  expect(w1.x).toBeLessThan(6);
  expect(w1.feet).toBeCloseTo(0.15, 1);

  // The link to this view opens the same view.
  const link = (await state()).link as string;
  expect(link).toMatch(/^w=/);
  const again = await context.newPage();
  await again.goto('file://' + sitePath + '#' + link);
  await again.waitForFunction(() => (window as any).__tourReady && !(window as any).__tour.state.flying, null, { timeout: 120_000 });
  const w2 = await again.evaluate(() => (window as any).__tour.state.walker);
  expect(Math.hypot(w2.x - w1.x, w2.z - w1.z)).toBeLessThan(0.05);

  // The plans and the area table.
  await tour.locator('.tools [data-k="plans"]').click();
  await expect(tour.locator('.sheet svg').first()).toBeVisible();
  await expect(tour.locator('.sheet')).toContainText('108');
  expect(errors).toEqual([]);
});
