// Account, plans and cloud saving (src/app/cloud) with a cloud kept in the page's memory: the same interface as
// Supabase (CloudApi), given in globalThis.__orielCloud before the app starts. What the database and the
// Stripe functions do on the server is checked apart (supabase/migrations on Postgres, the functions by Deno).
import { expect, test, type Page } from '@playwright/test';
import { open } from './cloudfake';

const acct = (page: Page) => page.locator('.f3-top [data-cmd="account"]');

test('signed out: Pro exports carry a badge and open the plans; the e-mail link is sent', async ({ page }) => {
  const errors: string[] = [];
  await open(page, {}, errors);
  await expect(acct(page)).toContainText('Sign in');
  await page.locator('.f3-top [data-cmd="export"]').click();
  const ifc = page.locator('.f3-menu[data-menu-of="export"] button', { hasText: 'BIM model (IFC4)' });
  await expect(ifc.locator('.f3-pro')).toHaveText('PRO');
  // Free deliveries have no badge.
  await expect(page.locator('.f3-menu[data-menu-of="export"] button', { hasText: 'Drawing set' }).locator('.f3-pro')).toHaveCount(0);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await ifc.click();
  const dlg = page.locator('.f3-acct[role="dialog"]');
  await expect(dlg.locator('.why')).toContainText('BIM model (IFC4) is part of Oriel Pro.');
  await expect(dlg.locator('.plan.pro')).toContainText('Sign in above to subscribe.');
  await dlg.locator('input[type="email"]').fill('ana@example.com');
  await dlg.locator('[data-email] button').click();
  await expect(dlg.locator('.sent')).toContainText('ana@example.com');
  expect(await page.evaluate(() => (globalThis as any).__cloud.calls)).toEqual([['email', 'ana@example.com']]);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(errors).toEqual([]);
});

test('signed in: the project is saved in the cloud, a cloud project opens here, versions go to the cloud', async ({ page }) => {
  const errors: string[] = [];
  await open(page, { user: { id: 'u1', email: 'ana@example.com' } }, errors);
  await expect(acct(page).locator('.av')).toHaveText('A');
  // Signed in with a project open: it goes to the cloud (a few seconds after).
  await page.waitForFunction(() => (globalThis as any).__cloud.projects.size === 1, null, { timeout: 20_000 });
  await expect(acct(page)).toHaveAttribute('data-state', 'saved');
  const [id, saved] = await page.evaluate(() => {
    const [p] = [...(globalThis as any).__cloud.projects.values()];
    return [p.id, JSON.parse(p.json).buildings.length];
  });
  expect(saved).toBeGreaterThan(0);
  // A change is saved again.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.store.project.name = 'Casa da Ana';
    ed.store.commit([], 'Renamed.');
  });
  await page.waitForFunction(() => [...(globalThis as any).__cloud.projects.values()][0].name === 'Casa da Ana', null, { timeout: 20_000 });

  // A project made on another computer: listed, opened from the cloud.
  await page.evaluate((id) => {
    const st = (globalThis as any).__cloud;
    const p = JSON.parse(st.projects.get(id).json);
    p.name = 'Galpão do cliente';
    p.buildings = p.buildings.slice(0, 1);
    st.projects.set('other-1', { id: 'other-1', name: p.name, buildings: 1, json: JSON.stringify(p), at: Date.now() + 5000, bytes: 100 });
  }, id);
  await page.evaluate(() => (globalThis as any).forma3.topCommand('projects'));
  const row = page.locator('.f3-start li[data-id="other-1"]');
  await expect(row).toContainText('only in the cloud');
  await expect(page.locator(`.f3-start li[data-id="${id}"]`)).toContainText('in the cloud');
  await row.locator('[data-open]').click();
  await expect(page.locator('.f3-start')).toHaveCount(0);
  expect(await page.evaluate(() => [(globalThis as any).forma3.project.name, (globalThis as any).forma3.project.buildings.length])).toEqual(['Galpão do cliente', 1]);

  // A named version is kept in the cloud too, and opens from there.
  await page.evaluate(() => (globalThis as any).forma3.topCommand('versions'));
  const v = page.locator('.f3-versions');
  await v.locator('[data-vname]').fill('Estudo 1');
  await v.locator('[data-vsave]').click();
  await expect(v.locator('[data-cloud] li[data-vid]')).toContainText('Estudo 1');
  expect(await page.evaluate(() => (globalThis as any).__cloud.versions.map((x: any) => [x.id, x.label, x.auto]))).toEqual([['other-1', 'Estudo 1', false]]);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.store.project.buildings.length = 0;
    ed.store.commit([], 'Cleared.');
  });
  await v.locator('[data-cloud] [data-copen]').click();
  await expect(v).toHaveCount(0);
  expect(await page.evaluate(() => (globalThis as any).forma3.project.buildings.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('free plan full: the project stays in this browser, with a notice', async ({ page }) => {
  const errors: string[] = [];
  const now = Date.now();
  const projects = [1, 2, 3].map((i) => ({ id: `c${i}`, name: `Cloud ${i}`, buildings: 1, json: '{}', at: now - i * 1000 }));
  await open(page, { user: { id: 'u1', email: 'ana@example.com' }, projects }, errors);
  await expect(acct(page)).toHaveAttribute('data-state', 'local', { timeout: 20_000 });
  expect((await page.evaluate(() => (globalThis as any).__toasts as string[])).some((t) => t.includes('free plan keeps 3 projects'))).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).__cloud.projects.size)).toBe(3);
  expect(errors).toEqual([]);
});

test('Pro: no badges, the export runs, the subscription is managed; Subscribe goes to the payment page on the free plan', async ({ page }) => {
  const errors: string[] = [];
  await open(page, { user: { id: 'u1', email: 'ana@example.com' }, sub: { status: 'active', current_period_end: new Date(Date.now() + 20 * 864e5).toISOString() } }, errors);
  await expect(acct(page).locator('.pro')).toHaveText('PRO');
  await page.locator('.f3-top [data-cmd="export"]').click();
  await expect(page.locator('.f3-menu[data-menu-of="export"] .f3-pro')).toHaveCount(0);
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.locator('.f3-menu[data-menu-of="export"] button', { hasText: 'Plan for CAD (DXF)' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.dxf$/);
  await acct(page).click();
  const dlg = page.locator('.f3-acct[role="dialog"]');
  await expect(dlg.locator('.plan.pro h4')).toContainText('Your plan');
  await expect(dlg.locator('.plan.pro')).toContainText('Renews on');
  await dlg.locator('[data-portal]').click();
  await page.waitForFunction(() => location.hash === '#portal');
  // Back to the free plan (cancelled and ended): the subscribe buttons ask for the payment page.
  await page.evaluate(() => sessionStorage.setItem('cloud_test_sub', JSON.stringify({ status: 'canceled', current_period_end: null })));
  await page.reload();
  await page.waitForFunction(() => !!(globalThis as any).forma3);
  await expect(acct(page).locator('.pro')).toHaveCount(0);
  await acct(page).click();
  await page.locator('.f3-acct [data-buy="year"]').click();
  await page.waitForFunction(() => location.hash === '#checkout');
  expect(await page.evaluate(() => (globalThis as any).__cloud.calls)).toEqual([['checkout', 'year']]);
  expect(errors).toEqual([]);
});

test('changed on another computer: the cloud copy is kept as a version before it is replaced', async ({ page }) => {
  const errors: string[] = [];
  const now = Date.now();
  // The open project (its id is made at start) is unknown to the seed: first a save, then a change "elsewhere".
  await open(page, { user: { id: 'u1', email: 'ana@example.com' } }, errors);
  await page.waitForFunction(() => (globalThis as any).__cloud.projects.size === 1, null, { timeout: 20_000 });
  await page.evaluate((now) => {
    const st = (globalThis as any).__cloud;
    const [p] = [...st.projects.values()];
    p.json = JSON.stringify({ ...JSON.parse(p.json), name: 'Edited on the laptop' });
    p.at = now + 60_000;
  }, now);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.store.project.name = 'Edited here';
    ed.store.commit([], 'Renamed.');
  });
  await page.waitForFunction(() => [...(globalThis as any).__cloud.projects.values()][0].name === 'Edited here', null, { timeout: 20_000 });
  const vs = await page.evaluate(() => (globalThis as any).__cloud.versions.map((v: any) => [v.label, JSON.parse(v.json).name]));
  expect(vs).toEqual([['Copy from another computer', 'Edited on the laptop']]);
  expect(errors).toEqual([]);
});
