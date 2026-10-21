// Pictures and materials (editor.html): the photorealistic render bar, the surface editor of a material,
// the finishes inside a floor and the object made from shapes, with real clicks and typing.
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('oriel_lang', 'en');
    localStorage.setItem('oriel_guide_off', '1');
  });
  await page.goto('/editor.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // The start screen offers the templates: the single-storey house (walls, rooms, furniture).
  await page.locator('[data-tpl="house"]').click();
  await settle(page);
}

async function settle(page: Page) {
  await page.waitForFunction(() => (globalThis as any).forma3?.view.settled);
}

test('surface editor: roughness, texture turn and size of a wall; undo brings the finish back', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings[0];
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
  });
  await page.locator('[data-medit="wall"]').click();
  const field = (k: string) => page.locator(`[data-surface="wall"] input[data-sf="${k}"]`);
  await field('rot').fill('90');
  await field('rot').press('Enter');
  await field('scale').fill('2');
  await field('scale').press('Enter');
  await field('rough').fill('0.3');
  await field('rough').press('Enter');
  await settle(page);
  const wall = () => page.evaluate(() => (globalThis as any).forma3.project.buildings[0].solids[0].materials.wall);
  expect(await wall()).toMatchObject({ rot: 90, scale: 2, rough: 0.3 });
  await page.locator('[data-surface="wall"] [data-sf-reset]').click();
  const plain = await wall();
  expect(plain.rot).toBeUndefined();
  expect(plain.scale).toBeUndefined();
  await page.keyboard.press('Control+z');
  expect(await wall()).toMatchObject({ rot: 90, scale: 2, rough: 0.3 });
  expect(errors).toEqual([]);
});

test('inside finishes: the walls of a floor take a finish of their own; a room floor turns its boards', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.enter(ed.project.buildings[0].id);
    ed.setTool('room');
  });
  await page.locator('select[data-ifin="walls.finish"]').selectOption('brick');
  await settle(page);
  const inside = () => page.evaluate(() => Object.values((globalThis as any).forma3.project.buildings[0].interiors as Record<string, any>)[0]);
  expect((await inside()).finishes.walls.finish).toBe('brick');
  // The bedrooms of the template have wood floors.
  const bedroom = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings[0];
    const lv = Object.keys(b.interiors)[0]!;
    const r = b.interiors[lv].rooms.find((x: any) => /Bedroom/.test(x.name));
    ed.roomSel = { level: lv, room: r.id };
    ed.select({ ...ed.sel });
    return r.finish.finish;
  });
  expect(bedroom).toBe('wood');
  await page.locator('[data-isurf="room"] input[data-sf="rot"]').fill('90');
  await page.locator('[data-isurf="room"] input[data-sf="rot"]').press('Enter');
  await settle(page);
  expect((await inside()).rooms.find((x: any) => /Bedroom/.test(x.name)).finish.rot).toBe(90);
  expect(errors).toEqual([]);
});

test('object from shapes: add a sphere that lights at night, create, place; editing it again keeps the shapes', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.focus());
  await page.keyboard.press('Control+k');
  await page.keyboard.type('object from shapes');
  await page.keyboard.press('Enter');
  const dlg = page.locator('.f3-objm');
  await expect(dlg).toBeVisible();
  await dlg.locator('[data-add="sphere"]').click();
  const f = (k: string) => dlg.locator(`[data-f="${k}"]`);
  await f('at.1').fill('1.1');
  await f('at.1').press('Tab');
  await f('lamp').check();
  await dlg.locator('[data-name]').fill('Garden lamp');
  await dlg.locator('[data-save]').click();
  await expect(dlg).toHaveCount(0);
  const r = await page.locator('.f3-canvas').boundingBox();
  await page.mouse.click(r!.x + r!.width * 0.2, r!.y + r!.height * 0.8);
  await page.keyboard.press('Escape');
  await settle(page);
  const got = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const t = ed.project.types.find((x: any) => x.name === 'Garden lamp');
    const shapes = JSON.parse(t.params.shapes);
    const placed = ed.project.buildings.some((b: any) => (b.items ?? []).some((i: any) => i.type === t.id));
    return { family: t.family, n: shapes.length, lamp: shapes.some((s: any) => s.kind === 'sphere' && s.lamp), placed };
  });
  expect(got).toEqual({ family: 'assembly', n: 6, lamp: true, placed: true });
  expect(errors).toEqual([]);
});

test('photorealistic render: the bar forms the picture, saves a PNG named after the project, Esc gives the view back', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.locator('[data-photo]').click();
  const bar = page.locator('.f3-photo');
  await expect(bar).toBeVisible();
  await bar.locator('[data-q]').selectOption('64');
  await page.waitForFunction(() => ((globalThis as any).forma3.view.photo?.samples ?? 0) >= 2, null, { timeout: 300_000, polling: 1000 });
  await expect(bar.locator('[data-s]')).toContainText('/ 64');
  // The picture is read after the next sample (seconds each on SwiftShader).
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), bar.locator('[data-save]').click()]);
  expect(dl.suggestedFilename()).toMatch(/-render\.png$/);
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as any).forma3.view.photo)).toBeNull();
  expect(errors).toEqual([]);
});
