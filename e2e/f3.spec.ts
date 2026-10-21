// FORMA 3 (editor.html): real gestures with mouse and keyboard.
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, errors: string[], keep = false) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // The gestures read the interface in English, and the start screen stays closed (samples open).
  await page.addInitScript(() => {
    localStorage.setItem('oriel_lang', 'en');
    (globalThis as any).__orielNoStart = true;
  });
  await page.goto('/editor.html');
  if (!keep) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await page.waitForFunction(() => !!(globalThis as any).forma3);
  // Gestures only: no ambient occlusion pass, the most costly part of a frame on SwiftShader (the
  // pictures are checked by e2e/visual.spec.ts, with it).
  await page.evaluate(() => (globalThis as any).forma3.view.look.setAO(false));
}

/** Until the editor has drawn the last change (View.settled): never a fixed wait. */
async function settle(page: Page) {
  await page.waitForFunction(() => (globalThis as any).forma3.view.settled);
}

/** Past the delay before a balloon shows (380 ms, ui/shell.ts installTooltips): to see that none did. */
const TIP_DELAY = 700;

/** Selects a building by name and frames it (known starting state). */
async function pick(page: Page, name: string) {
  await page.evaluate((n) => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === n);
    ed.select({ building: b.id });
    ed.view.theta = 0.75;
    ed.view.phi = 0.95;
    ed.frameSelection();
  }, name);
  await settle(page);
}

/** Where a handle is on screen (drawn position). */
async function handleAt(page: Page, kind: string) {
  return page.evaluate((k) => {
    const ed = (globalThis as any).forma3;
    const h = ed.handles.list.find((x: any) => x.kind === k);
    const s = ed.view.toScreen(ed.handles.posOf(h));
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, kind);
}

test('saved project with a short color (#777) reopens repaired, without falling back to the samples', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const id = await page.evaluate(() => {
    const p = structuredClone((globalThis as any).forma3.project);
    p.name = 'My project';
    p.buildings[0].solids[0].materials.roof.color = '#777';
    localStorage.setItem('forma3_project', JSON.stringify(p));
    return p.buildings[0].id;
  });
  await open(page, errors, true);
  const r = await page.evaluate(() => {
    const p = (globalThis as any).forma3.project;
    return { name: p.name, id: p.buildings[0].id, color: p.buildings[0].solids[0].materials.roof.color, invalid: localStorage.getItem('forma3_project_invalid') };
  });
  expect(r).toEqual({ name: 'My project', id, color: '#777777', invalid: null });
  expect(errors).toEqual([]);
});

test('modes: a click on a window in face mode picks its wall, and 1/2/3 keep switching modes (they never fall into the measure box)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.frameSelection();
  });
  await page.keyboard.press('3');
  // A screen point on a window of the block (found by the picker, clicked with the mouse).
  const at = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    for (let y = r.top + 40; y < r.bottom - 40; y += 10)
      for (let x = r.left + 40; x < r.right - 40; x += 10) {
        const h = ed.pickAt({ clientX: x, clientY: y }, ed.activeBuilding().id);
        if (h?.part?.family === 'window') return { x, y };
      }
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
  const state = () => page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    return { mode: ed.elemMode, face: ed.sel.face?.kind ?? null, vcb: ed.shell.status.vcb.value };
  });
  expect(await state()).toEqual({ mode: 'face', face: 'side', vcb: '' });
  const modes: string[] = [];
  for (const k of ['2', '1', '3', '3']) {
    await page.keyboard.press(k);
    const s = await state();
    modes.push(s.mode);
    expect(s.vcb).toBe('');
  }
  expect(modes).toEqual(['edge', 'vertex', 'face', 'object']);
  expect(errors).toEqual([]);
});

test('push: a value typed after dragging a face is the whole distance from where it started (not added to the drag)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.frameSelection();
  });
  const width = () => page.evaluate(() => { const s = (globalThis as any).forma3.activeSolid(); const xs = s.plan.outer.map((v: any) => v.p[0]); const zs = s.plan.outer.map((v: any) => v.p[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)); });
  const w0 = await width();
  // A push arrow that is shown (the arrows of faces turned away from the camera are hidden), dragged 3 m out.
  const [a, z] = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const h = ed.handles.list.find((x: any) => x.kind === 'push' && ed.handles.shown(x));
    const at = ed.handles.posOf(h);
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const S = (p: any) => { const s = ed.view.toScreen(p); return { x: r.left + s.x, y: r.top + s.y }; };
    const p0 = at.clone().addScaledVector(h.dir, ed.view.worldPerPixel(at) * 45);
    return [S(p0), S(p0.clone().addScaledVector(h.dir, 3))];
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + ((z.x - a.x) * i) / 8, a.y + ((z.y - a.y) * i) / 8);
  await page.mouse.up();
  expect(await width()).toBeGreaterThan(w0 + 1);
  for (const v of ['5', '2']) {
    await page.keyboard.press(v);
    await page.keyboard.press('Enter');
    expect(await width()).toBeCloseTo(w0 + Number(v), 3);
  }
  expect(errors).toEqual([]);
});

test('extrude with a negative depth pushes the face in: no cutter, the wall keeps its windows and shops', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  const info = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    const s = b.solids[0];
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [s.id], face: { kind: 'side', edge: s.plan.outer[1].id } });
    const ev = ed.view.built.get(b.id)?.ev;
    const on = (edge: string) => (ed.view.built.get(b.id)?.ev?.placements ?? []).filter((p: any) => p.tag.solid === s.id && p.tag.key?.startsWith(edge + ':')).length;
    return { edge: s.plan.outer[1].id, before: on(s.plan.outer[1].id), solids: b.solids.length, hasEv: !!ev };
  });
  await page.locator('.f3-ctx button[data-a="extrude"]').click();
  const depth = page.locator('.f3-lastop input[data-op="depth"]');
  await depth.click({ clickCount: 3 });
  await page.keyboard.type('-2');
  await page.keyboard.press('Enter');
  await settle(page);
  const after = await page.evaluate((edge) => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    const s = b.solids[0];
    const placed = (ed.view.built.get(b.id)?.ev?.placements ?? []).filter((p: any) => p.tag.solid === s.id && p.tag.key?.startsWith(edge + ':')).length;
    return { ops: b.solids.map((x: any) => x.op), placed };
  }, info.edge);
  expect(after.ops.length).toBe(info.solids);
  expect(after.ops.filter((o: string) => o === 'subtract').length).toBe(1);
  if (info.hasEv) expect(after.placed).toBeGreaterThanOrEqual(info.before);
  expect(errors).toEqual([]);
});

test('rectangle: the far corner lands on the grid (no parallel or perpendicular pull along the diagonal)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // The camera and corners of the audit: other buildings around have sides in every direction.
  const pts = await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    Object.assign(v, { theta: 0.75, phi: 0.95, distance: 110 });
    v.target.set(-60, 0, 70);
    v.updateCamera();
    const T = v.camera.position.constructor;
    const r = v.renderer.domElement.getBoundingClientRect();
    const S = (x: number, z: number) => { const s = v.toScreen(new T(x, 0, z)); return { x: r.left + s.x, y: r.top + s.y }; };
    return [S(-70, 55), S(-58, 61)];
  });
  await page.keyboard.press('r');
  await page.mouse.click(pts[0]!.x, pts[0]!.y);
  await page.mouse.move((pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2, { steps: 4 });
  await page.mouse.move(pts[1]!.x, pts[1]!.y, { steps: 4 });
  await page.mouse.click(pts[1]!.x, pts[1]!.y);
  const size = await page.evaluate(() => {
    const s = (globalThis as any).forma3.activeBuilding().solids.at(-1);
    const xs = s.plan.outer.map((v: any) => v.p[0]);
    const zs = s.plan.outer.map((v: any) => v.p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
  });
  expect(size[0]).toBeCloseTo(12, 3);
  expect(size[1]).toBeCloseTo(6, 3);
  expect(errors).toEqual([]);
});

test('a part placed on the ground belongs to the nearest building, not to the first of the project', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const at = await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    const T = v.camera.position.constructor;
    const r = v.renderer.domElement.getBoundingClientRect();
    const s = v.toScreen(new T(-14, 0, 24));
    return { x: r.left + s.x, y: r.top + s.y };
  });
  await page.keyboard.press('k');
  await page.keyboard.type('lamp');
  await page.getByText('Modern street lamp', { exact: true }).first().click();
  await page.mouse.move(at.x - 30, at.y - 10);
  await page.mouse.move(at.x, at.y, { steps: 5 });
  await page.mouse.click(at.x, at.y);
  const r = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const owner = ed.project.buildings.find((b: any) => b.items.length);
    // The nearest building to (-14, 24) by its walls' box.
    const near = ed.project.buildings
      .map((b: any) => {
        const bb = ed.boundsOf(b, b.solids.map((s: any) => s.id));
        const l = [-14 - b.position[0], 24 - b.position[1]];
        return { name: b.name, d: Math.hypot(Math.max(bb.min[0] - l[0]!, 0, l[0]! - bb.max[0]), Math.max(bb.min[2] - l[1]!, 0, l[1]! - bb.max[2])) };
      })
      .sort((a: any, b: any) => a.d - b.d)[0];
    return { owner: owner?.name, nearest: near.name };
  });
  expect(r.owner).toBe(r.nearest);
  expect(r.owner).not.toBe('House with tower');
  expect(errors).toEqual([]);
});

test('a cutter is outlined only where it cuts (no square in the sky over the courtyard)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    let top = -Infinity;
    ed.selOverlay.traverse((o: any) => {
      if (!o.isLine || o.material?.color?.getHexString() !== 'c026d3') return;
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) top = Math.max(top, a.getY(i));
    });
    return { top, walls: Math.max(...b.solids.filter((s: any) => s.op === 'add').map((s: any) => s.base + s.height)) };
  });
  expect(r.top).toBeGreaterThan(0);
  expect(r.top).toBeLessThanOrEqual(r.walls + 0.01);
  expect(errors).toEqual([]);
});

test('Ctrl+K finds every action the contextual bar offers (same registry) and runs it', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.view.renderer.domElement.focus();
  });
  await page.keyboard.press('Control+k');
  const input = page.locator('.f3-pal input');
  for (const [q, label] of [['court', 'Courtyard'], ['podium', 'Podium'], ['setback', 'Top setback'], ['chamfer', 'Chamfer'], ['floor', 'Floor +'], ['rotate', 'Rotate'], ['interior', 'Interior view'], ['face mode', 'Face mode']] as const) {
    await input.fill(q);
    await expect(page.locator('.f3-pal li[data-i] span', { hasText: label }).first()).toBeVisible();
  }
  await input.fill('court');
  await page.keyboard.press('Enter');
  const n = await page.evaluate(() => (globalThis as any).forma3.activeBuilding().solids.filter((s: any) => s.op === 'subtract').length);
  expect(n).toBe(2);
  expect(errors).toEqual([]);
});

test('the bucket on a window paints the frames of its facade rule (and says so)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.paintMat = { finish: 'paint', color: '#9fc2b3' };
    ed.setTool('paint');
  });
  const at = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    for (let y = r.top + 40; y < r.bottom - 40; y += 6)
      for (let x = r.left + 40; x < r.right - 40; x += 6) {
        const h = ed.pickAt({ clientX: x, clientY: y }, b.id);
        if (h?.part?.family === 'window' && h.building.id === b.id) return { x, y };
      }
    return null;
  });
  expect(at).not.toBeNull();
  await page.mouse.move(at!.x - 5, at!.y);
  await page.mouse.move(at!.x, at!.y);
  await page.mouse.click(at!.x, at!.y);
  const r = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    return { params: b.solids[0].facade.find((f: any) => f.type === 'win-sliding').params, toast: ed.shell.toast.textContent };
  });
  expect(r.params.frameColor).toBe('#9fc2b3');
  expect(r.toast).toContain('painted');
  expect(errors).toEqual([]);
});

test('small things: the top bar does not move with "Saving…", the library matches word starts, undo disarms the measure box', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const left = () => page.evaluate(() => [...document.querySelectorAll('.f3-top [data-cmd="undo"], .f3-top [data-cmd="palette"]')].map((b) => Math.round(b.getBoundingClientRect().left)));
  const l0 = await left();
  for (const t of ['Saving…', 'Saved in this browser']) {
    await page.evaluate((x) => (document.querySelector('.f3-saved')!.textContent = x), t);
    expect(await left()).toEqual(l0);
  }
  await page.keyboard.press('k');
  // Inside a word ('s-treet') finds nothing; the library has real trees now, so not 'tree'.
  await page.locator('.f3-cat input').fill('treet');
  await expect(page.locator('.f3-cat .f3-empty')).toHaveText('Nothing found.');
  await page.locator('.f3-cat input').fill('street');
  await expect(page.locator('.f3-cat .f3-card').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
  });
  await page.locator('.f3-ctx button[data-a="offset"]').click();
  await expect(page.locator('.f3-vcb label')).toHaveText('Outline offset');
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.focus());
  await page.keyboard.press('Control+z');
  await expect(page.locator('.f3-vcb label')).toHaveText('Size');
  expect(errors).toEqual([]);
});

test('side dimensions measure corner to corner, a circle shows its diameter, and labels step aside during a drag', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const labels = () => page.evaluate(() => [...document.querySelectorAll('.f3-sdim')].map((e) => e.textContent));
  // Rounded corners do not shorten the sides (18 m block, 1 m radius).
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.frameSelection();
    ed.modelOp('corner', { round: 1 });
  });
  expect((await labels()).filter((t) => t === '18 m').length).toBe(4);
  // While a face is dragged the old sizes are not shown; they come back with the result.
  const [a, z] = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const h = ed.handles.list.find((x: any) => x.kind === 'push' && ed.handles.shown(x));
    const at = ed.handles.posOf(h);
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const S = (p: any) => { const s = ed.view.toScreen(p); return { x: r.left + s.x, y: r.top + s.y }; };
    const p0 = at.clone().addScaledVector(h.dir, ed.view.worldPerPixel(at) * 45);
    return [S(p0), S(p0.clone().addScaledVector(h.dir, 2))];
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 4 });
  expect(await labels()).toEqual([]);
  await page.mouse.move(z.x, z.y, { steps: 4 });
  await page.mouse.up();
  await settle(page);
  expect((await labels()).length).toBeGreaterThan(3);
  // The Rotunda (a circle): one diameter label instead of four arcs.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Rotunda');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids.find((s: any) => s.op === 'add').id] });
    ed.frameSelection();
  });
  const rot = await labels();
  expect(rot.filter((t) => t?.startsWith('⌀'))).toEqual(['⌀ 13 m']);
  expect(rot.length).toBe(2);
  expect(errors).toEqual([]);
});

test('contextual bar: same place for Move, Rotate and Scale; never over the breadcrumb or the modes; dimensions never under a panel', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(async () => {
    const ed = (globalThis as any).forma3;
    const wait = () => new Promise((res) => setTimeout(res, 60));
    const R = (el: Element) => el.getBoundingClientRect();
    const meets = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.frameSelection();
    const tops: number[] = [];
    for (const t of ['select', 'move', 'rotate', 'scale']) {
      ed.setTool(t);
      await wait();
      tops.push(Math.round(R(ed.shell.ctxbar).top));
    }
    ed.setTool('select');
    // Close up: the selection fills the view and the bar goes to the top, where the breadcrumb is.
    Object.assign(ed.view, { theta: 0.75, phi: 1, distance: 30 });
    ed.view.target.set(b.position[0] + 6, 4, b.position[1] - 6);
    ed.view.updateCamera();
    await wait();
    const bar = R(ed.shell.ctxbar);
    const islands = [...document.querySelectorAll('.f3-view .f3-island')].filter((e) => !(e as HTMLElement).hidden && e.getClientRects().length).map(R);
    // With the last operation panel open, no dimension sits under any island.
    (document.querySelector('.f3-ctx button[data-a="offset"]') as HTMLElement).click();
    await wait();
    const isl2 = [...document.querySelectorAll('.f3-island, .f3-menu')].filter((e) => !(e as HTMLElement).hidden && e.getClientRects().length).map(R);
    const under = [...document.querySelectorAll<HTMLElement>('.f3-sdim')].filter((e) => !e.hidden && isl2.some((q) => meets(R(e), q))).map((e) => e.textContent);
    return { tops, barOverIsland: islands.some((q) => meets(bar, q)), under };
  });
  expect(new Set(r.tops).size).toBe(1);
  expect(r.barOverIsland).toBe(false);
  expect(r.under).toEqual([]);
  expect(errors).toEqual([]);
});

test('second audit: no handles or dimensions while exploded, a new selection opens the panel at the top, bevel values share a row', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(async () => {
    const ed = (globalThis as any).forma3;
    const wait = () => new Promise((res) => setTimeout(res, 80));
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    // Panel at the top for another selection.
    ed.shell.side.scrollTop = 500;
    ed.select({ building: b.id, solids: [b.solids[1].id] });
    await new Promise((res) => requestAnimationFrame(() => setTimeout(res, 60)));
    const scroll = ed.shell.side.scrollTop;
    // Bevel in the last operation panel: Top and Base on one row.
    ed.select({ building: b.id, solids: [b.solids[0].id] });
    ed.modelOp('bevel', { top: 0.3 });
    ed.applyOp('Edge bevel', [{ key: 'top', label: 'Top', value: 0.3, unit: 'm' }, { key: 'bottom', label: 'Base', value: 0, unit: 'm' }, { key: 'segments', label: 'Segments', value: 1 }, { key: 'profile', label: 'Profile', value: '0', options: [['0', 'Straight'], ['1', 'Round']] }], () => true);
    await wait();
    const rows = [...document.querySelectorAll('.f3-lastop .f3-prow')].map((x) => x.querySelectorAll('input,select').length);
    ed.clearLastOp();
    // Exploded: no handles, no dimensions.
    (ed.project.view ??= { hiddenCategories: [] }).explode = 4;
    ed.store.commit(null, '', false);
    await wait();
    return { scroll, rows, handles: ed.handles.list.length, dims: document.querySelectorAll('.f3-sdim').length };
  });
  expect(r.scroll).toBe(0);
  expect(r.rows).toEqual([2, 2]);
  expect(r.handles).toBe(0);
  expect(r.dims).toBe(0);
  expect(errors).toEqual([]);
});

test('duplicate puts the copy on free ground: it touches neither the original nor any other building', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  for (const name of ['Barn', 'Courtyard block', 'Rotunda']) {
    const hits = await page.evaluate((n) => {
      const ed = (globalThis as any).forma3;
      ed.enter(null);
      ed.select({ building: ed.project.buildings.find((x: any) => x.name === n).id });
      ed.duplicate();
      const box = (b: any) => {
        const bb = ed.boundsOf(b);
        return [b.position[0] + bb.min[0], b.position[0] + bb.max[0], b.position[1] + bb.min[2], b.position[1] + bb.max[2]];
      };
      const copy = ed.project.buildings.find((x: any) => x.name === `${n} (copy)`);
      const c = box(copy);
      return ed.project.buildings.filter((o: any) => o !== copy).filter((o: any) => { const q = box(o); return c[0] < q[1] && c[1] > q[0] && c[2] < q[3] && c[3] > q[2]; }).map((o: any) => o.name);
    }, name);
    expect(hits).toEqual([]);
  }
  expect(errors).toEqual([]);
});

test('click then double click on a building enters it and ends on its volume, at any window size', async ({ page }) => {
  const errors: string[] = [];
  for (const [w, h] of [[1440, 860], [1920, 1080]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page, errors);
    const at = await page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
      const T = ed.view.camera.position.constructor;
      const s = ed.view.toScreen(new T(b.position[0] + 6, 12.4, b.position[1] + 6));
      const r = ed.view.renderer.domElement.getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    });
    await page.mouse.click(at.x, at.y);
    await page.mouse.dblclick(at.x, at.y);
    const sel = await page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      return { inside: ed.context === ed.activeBuilding()?.id, solids: ed.sel.solids.length, face: ed.sel.face };
    });
    expect(sel).toEqual({ inside: true, solids: 1, face: null });
  }
  expect(errors).toEqual([]);
});

test('top menus: the project menu still opens after Export; Esc closes either menu and gives the focus back', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const project = page.locator('[data-menu-of="project"]');
  await page.locator('[data-cmd="export"]').click();
  await expect(page.locator('[data-menu-of="export"]')).toBeVisible();
  // A click on a disabled button (Redo, nothing to redo) closes it too: Chrome sends no pointer event to a disabled control.
  const redo = (await page.getByRole('button', { name: 'Redo' }).boundingBox())!;
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  await page.mouse.click(redo.x + 2, redo.y + 2);
  await expect(page.locator('[data-menu-of="export"]')).toHaveCount(0);
  await page.locator('.f3-brand').click();
  await expect(project).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(project).toBeHidden();
  await expect(page.locator('.f3-brand')).toBeFocused();
  await page.locator('[data-cmd="export"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-menu-of="export"]')).toHaveCount(0);
  await expect(page.locator('[data-cmd="export"]')).toBeFocused();
  await page.locator('.f3-brand').click();
  await expect(project).toBeVisible();
  expect(errors).toEqual([]);
});

test('top bar in a narrow window: every button stays on the screen and whole (the name, the note and the search give way)', async ({ page }) => {
  // Under 1032 px the bar used to push Search, Preferences, Shortcuts and Export out of the window.
  const errors: string[] = [];
  for (const width of [1000, 800, 700]) {
    await page.setViewportSize({ width, height: 500 });
    if (width === 1000) await open(page, errors);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.f3-top button')]
        .filter((b) => b.offsetWidth > 0)
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.left < 0 || r.right > innerWidth || b.scrollWidth > b.clientWidth + 1;
        })
        .map((b) => b.title || b.textContent),
    );
    expect(bad, `buttons cut or outside at ${width} px`).toEqual([]);
  }
  await page.locator('[data-cmd="export"]').click();
  await expect(page.locator('[data-menu-of="export"]')).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('Escape');
  await page.locator('.f3-search').click();
  await page.keyboard.type('export');
  await expect(page.locator('input:focus')).toHaveValue('export');
  expect(errors).toEqual([]);
});

test('the yellow gizmo square moves the building on the ground, following the cursor, without changing floors', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  const before = await page.evaluate(() => {
    const b = (globalThis as any).forma3.activeBuilding();
    return { pos: [...b.position], levels: b.levels.length };
  });
  const a = await handleAt(page, 'move-xz');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 10, { steps: 5 });
  await page.mouse.move(a.x + 80, a.y + 20, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  const after = await page.evaluate(() => {
    const b = (globalThis as any).forma3.activeBuilding();
    return { pos: [...b.position], levels: b.levels.length };
  });
  expect(after.levels).toBe(before.levels);
  expect(Math.hypot(after.pos[0] - before.pos[0], after.pos[1] - before.pos[1])).toBeGreaterThan(0.5);
  // The square ends under the cursor (the drag runs on the handle plane), within the grid snap slack.
  const end = await handleAt(page, 'move-xz');
  expect(Math.hypot(end.x - (a.x + 80), end.y - (a.y + 20))).toBeLessThan(25);
  expect(errors).toEqual([]);
});

test('box, size handles and height dimension wrap what is seen (roof yes, cutter no)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  for (const name of ['Courtyard block', 'L mansard', 'House with tower']) {
    await pick(page, name);
    const r = await page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      const b = ed.activeBuilding();
      const built = ed.view.built.get(b.id);
      const P = built.ev.shell.positions as Float32Array;
      let top = -Infinity;
      for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]!);
      const sizes = ed.handles.list.filter((h: any) => h.kind === 'size').map((h: any) => h.at.y);
      const dims = [...document.querySelectorAll('.f3-sdim')].map((e) => e.textContent ?? '').find((t) => t.startsWith('↕'));
      return { top, sizes, dims };
    });
    expect(r.sizes.length).toBe(8);
    for (const y of r.sizes) expect(y).toBeGreaterThanOrEqual(r.top - 1e-3);
    for (const y of r.sizes) expect(y).toBeLessThan(r.top + 1.5);
    const h = parseFloat(r.dims!.replace('↕', '').replace(',', '.'));
    expect(h).toBeGreaterThanOrEqual(r.top - 0.01);
    expect(h).toBeLessThan(r.top + 1.5);
  }
  expect(errors).toEqual([]);
});

test('building width and depth measure the box (eaves included) and a typed width lands exactly on it', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Bungalow');
  const box = () =>
    page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      const bb = ed.boundsOf(ed.activeBuilding());
      return { w: bb.max[0] - bb.min[0], d: bb.max[2] - bb.min[2] };
    });
  const b0 = await box();
  const labels = page.locator('.f3-sdim.edit');
  await expect(labels.nth(0)).toHaveText(`${Math.round(b0.w * 100) / 100} m`);
  await expect(labels.nth(1)).toHaveText(`${Math.round(b0.d * 100) / 100} m`);
  await labels.nth(0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('18');
  await page.keyboard.press('Enter');
  expect((await box()).w).toBeCloseTo(18, 3);
  expect((await box()).d).toBeCloseTo(b0.d, 3);
  expect(errors).toEqual([]);
});

test('the panel loses neither the field nor the click (X, Tab, Y, Tab, Z); offset adjusted in the last operation panel, one history step', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  // Position X · Y · Z share one row (panel standard): Tab walks them in that order.
  const x = page.locator('.f3-side input[data-k="px"]');
  await x.click({ clickCount: 3 });
  await page.keyboard.type('5');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  await settle(page);
  const at = await page.evaluate(() => {
    const b = (globalThis as any).forma3.activeBuilding();
    return { pos: [...b.position], elevation: b.elevation };
  });
  expect(at.pos[0]).toBe(5);
  // Tab went to Y, then to Z (focus survives both redraws); "7" replaced or joined Z.
  expect(at.elevation).toBe(2);
  expect(String(at.pos[1])).toContain('7');
  // Volume: type the distance and click Apply without leaving the field first.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
  });
  await settle(page);
  // Offset from the contextual bar; the value changes in the last operation panel (redone in place).
  await page.locator('.f3-ctx button[data-a="offset"]').click();
  await settle(page);
  const d = page.locator('.f3-lastop input[data-op="d"]');
  await d.click({ clickCount: 3 });
  await page.keyboard.type('-1');
  await page.keyboard.press('Enter');
  await settle(page);
  const w = await page.evaluate(() => {
    const s = (globalThis as any).forma3.activeSolid();
    const xs = s.plan.outer.map((v: any) => v.p[0]);
    return Math.max(...xs) - Math.min(...xs);
  });
  expect(w).toBeCloseTo(16, 3);
  // A single history step: undo goes back to the original 18 m.
  await page.keyboard.press('Control+z');
  await settle(page);
  // Undo closes the last operation panel (its values no longer apply).
  await expect(page.locator('.f3-lastop')).toBeHidden();
  const w0 = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const s = ed.activeBuilding().solids[0];
    const xs = s.plan.outer.map((v: any) => v.p[0]);
    return Math.max(...xs) - Math.min(...xs);
  });
  expect(w0).toBeCloseTo(18, 3);
  expect(errors).toEqual([]);
});

test('a value applied with Enter is one history step even when the click then goes elsewhere; floors keep their IDs; no balloon over the field being typed in', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Barn');
  const barnLevels = () => page.evaluate(() => (globalThis as any).forma3.project.buildings.find((x: any) => x.name === 'Barn').levels.map((l: any) => l.id) as string[]);
  const ids0 = await barnLevels();
  const floors = page.locator('.f3-side input[data-k="levels"]');
  await floors.hover();
  await floors.click({ clickCount: 3 });
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  // Past the balloon delay, with the panel redrawn under the still mouse: no name over the row below.
  await page.waitForTimeout(TIP_DELAY);
  await expect(page.locator('.f3-tip.on')).toHaveCount(0);
  // Leaving the field (Chrome blurs it again when the redraw removes it) applies nothing more.
  const box = (await page.locator('canvas.f3-canvas').boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height - 30);
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.store.undoStack.length)).toBe(1);
  const ids = await barnLevels();
  expect(ids).toHaveLength(3);
  expect(ids[0]).toBe(ids0[0]);
  // So one Ctrl+Z goes back to the single floor, the same one.
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await barnLevels()).toEqual(ids0);
  // Ground floor height: applied once (one re-evaluation, not a second one on leaving), same floor.
  await pick(page, 'Barn');
  const rev = () => page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    return ed.store.revision.get(ed.project.buildings.find((x: any) => x.name === 'Barn').id) as number;
  });
  const r0 = await rev();
  await page.locator('.f3-side input[data-k="ground"]').click({ clickCount: 3 });
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await settle(page);
  await page.mouse.click(box.x + 30, box.y + box.height - 30);
  await settle(page);
  expect(await rev()).toBe(r0 + 1);
  expect(await barnLevels()).toEqual(ids0);
  expect(await page.evaluate(() => (globalThis as any).forma3.project.buildings.find((x: any) => x.name === 'Barn').levels[0].height)).toBe(5);
  expect(errors).toEqual([]);
});

/** Drags an arrow handle along its own direction by `t` meters (world). */
async function dragArrow(page: Page, kind: string, t: number) {
  const [a, b] = await page.evaluate(([k, t]) => {
    const ed = (globalThis as any).forma3;
    const h = ed.handles.list.find((x: any) => x.kind === k);
    const at = ed.handles.posOf(h);
    const len = ed.view.worldPerPixel(at) * 45;
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const S = (p: any) => {
      const s = ed.view.toScreen(p);
      return { x: r.left + s.x, y: r.top + s.y };
    };
    const p0 = at.clone().addScaledVector(h.dir, len);
    return [S(p0), S(p0.clone().addScaledVector(h.dir, t as number))];
  }, [kind, t] as const);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await settle(page);
}

test('gizmo: green moves vertically (the building rises and snaps onto the top of another); floors are not on the gizmo', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // The Barn goes over the Bungalow (same x/z plan) and is lifted by the green arrow.
  const top = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const bg = ed.project.buildings.find((x: any) => x.name === 'Bungalow');
    const ce = ed.project.buildings.find((x: any) => x.name === 'Barn');
    ed.change(ce.id, (x: any) => void (x.position = [...bg.position]), '', false);
    const P = ed.view.built.get(bg.id).ev.shell.positions as Float32Array;
    let t = 0;
    for (let i = 1; i < P.length; i += 3) t = Math.max(t, P[i]!);
    return t;
  });
  await pick(page, 'Barn');
  const kinds = await page.evaluate(() => (globalThis as any).forma3.handles.list.map((h: any) => h.kind));
  expect(kinds).toContain('move-y');
  expect(kinds).not.toContain('floors');
  const lv0 = await page.evaluate(() => (globalThis as any).forma3.activeBuilding().levels.length);
  await dragArrow(page, 'move-y', top + 0.05);
  const r = await page.evaluate(() => {
    const b = (globalThis as any).forma3.activeBuilding();
    return { elevation: b.elevation, levels: b.levels.length };
  });
  expect(r.levels).toBe(lv0);
  expect(r.elevation).toBeCloseTo(top, 3);
  expect(errors).toEqual([]);
});

test('volume: green changes only the base; the top square changes the height; floor stepper', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  // "− N floors +" stepper on the contextual bar.
  await expect(page.locator('.f3-ctx .step .n')).toHaveText('4 floors');
  await page.locator('.f3-ctx .step button[data-a="lvup"]').click();
  await expect(page.locator('.f3-ctx .step .n')).toHaveText('5 floors');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    ed.enter(b.id);
    ed.select({ building: b.id, solids: [b.solids[0].id] });
  });
  await settle(page);
  const s0 = await page.evaluate(() => {
    const s = (globalThis as any).forma3.activeSolid();
    return { base: s.base, height: s.height };
  });
  await dragArrow(page, 'move-y', 3);
  const s1 = await page.evaluate(() => {
    const s = (globalThis as any).forma3.activeSolid();
    return { base: s.base, height: s.height };
  });
  expect(s1.height).toBeCloseTo(s0.height, 3);
  expect(s1.base).toBeGreaterThan(s0.base + 1);
  await page.keyboard.press('Control+z');
  // Top square: height floor by floor; the base does not change.
  const sq = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const h = ed.handles.list.find((x: any) => x.kind === 'height');
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const a = ed.view.toScreen(h.at), b = ed.view.toScreen(h.at.clone().setY(h.at.y + 3.1));
    return { a: { x: r.left + a.x, y: r.top + a.y }, b: { x: r.left + b.x, y: r.top + b.y }, square: h.square === true, dir: !!h.dir };
  });
  expect(sq.square).toBe(true);
  expect(sq.dir).toBe(false);
  await page.mouse.move(sq.a.x, sq.a.y);
  await page.mouse.down();
  await page.mouse.move(sq.b.x, sq.b.y, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  const s2 = await page.evaluate(() => {
    const s = (globalThis as any).forma3.activeSolid();
    return { base: s.base, height: s.height };
  });
  expect(s2.base).toBeCloseTo(s0.base, 3);
  expect(s2.height).toBeGreaterThan(s0.height + 2);
  expect(errors).toEqual([]);
});

test('navigation: orbiting from empty space keeps the model on screen; the wheel never slides at the limits; the sky follows the camera in the same frame', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(() => {
    const c = (globalThis as any).forma3.view.renderer.domElement.getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height };
  });
  // Shift+middle pressed on the empty sky: the pivot is the model, which stays in view.
  await page.mouse.move(r.x + 120, r.y + 60);
  await page.keyboard.down('Shift');
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 12; i++) await page.mouse.move(r.x + 120 + i * 30, r.y + 60);
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Shift');
  const inView = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const THREE = ed.view.camera.position.constructor;
    const all = ed.project.buildings.map((b: any) => ed.view.built.get(b.id).group.position);
    const c = all.reduce((a: any, p: any) => a.add(p), new THREE()).multiplyScalar(1 / all.length);
    const s = ed.view.toScreen(c);
    const w = ed.view.renderer.domElement.clientWidth,
      h = ed.view.renderer.domElement.clientHeight;
    return !s.behind && s.x > 0 && s.x < w && s.y > 0 && s.y < h;
  });
  expect(inView).toBe(true);
  // Zooming out past the limit: the distance stops and the target does not slide.
  await page.mouse.move(r.x + 100, r.y + r.h - 80);
  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 120);
  const a = await page.evaluate(() => { const v = (globalThis as any).forma3.view; return { d: v.distance, max: v.maxDistance, t: v.target.toArray() }; });
  expect(a.d).toBeCloseTo(a.max, 3);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);
  const b = await page.evaluate(() => (globalThis as any).forma3.view.target.toArray());
  expect(b).toEqual(a.t);
  // One render after a camera jump: the sky dome is centered on the camera (no one-frame lag).
  const lag = await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    v.phi = 1.5;
    v.distance = 120;
    v.updateCamera();
    v.look.render();
    const sky = v.scene.getObjectByName('sky');
    const e = sky.matrixWorld.elements;
    return Math.hypot(e[12] - v.camera.position.x, e[13] - v.camera.position.y, e[14] - v.camera.position.z);
  });
  expect(lag).toBeLessThan(1e-6);
  expect(errors).toEqual([]);
});

test('navigation: the camera comes back from both pitch limits, never goes under the ground, keeps the grabbed point and stops when the button is released anywhere', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(() => {
    const c = (globalThis as any).forma3.view.renderer.domElement.getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height };
  });
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const state = () => page.evaluate(() => { const v = (globalThis as any).forma3.view; return { phi: v.phi, y: v.camera.position.y }; });
  const drag = async (button: 'right' | 'middle', dx: number, dy: number, x = cx, y = cy) => {
    await page.mouse.move(x, y);
    await page.mouse.down({ button });
    for (let i = 1; i <= 20; i++) await page.mouse.move(x + (dx * i) / 20, y + (dy * i) / 20);
    await page.mouse.up({ button });
  };
  // Drag up to ground level, then back: the camera rises again (it used to stick at the limit).
  await drag('right', 0, -400);
  const low = await state();
  expect(low.phi).toBeGreaterThan(1.4);
  expect(low.y).toBeGreaterThanOrEqual(0.29);
  await drag('right', 0, 200);
  expect((await state()).phi).toBeLessThan(low.phi - 0.5);
  // Top limit and back.
  await drag('right', 0, 600);
  const top = await state();
  expect(top.phi).toBeLessThan(0.1);
  await drag('right', 0, -150);
  expect((await state()).phi).toBeGreaterThan(top.phi + 0.5);
  // The point under the cursor stays under the cursor while orbiting and while panning.
  const under = async (x: number, y: number) => page.evaluate(([xx, yy]) => { const p = (globalThis as any).forma3.view.pointAt({ clientX: xx, clientY: yy }); return p.toArray(); }, [x, y]);
  const onScreen = async (p: number[]) => page.evaluate(([q]) => { const v = (globalThis as any).forma3.view; const T = v.camera.position.constructor; const s = v.toScreen(new T(...(q as number[]))); const rr = v.renderer.domElement.getBoundingClientRect(); return { x: rr.left + s.x, y: rr.top + s.y }; }, [p]);
  const p0 = await under(cx - 150, cy + 120);
  await drag('middle', 220, -90, cx - 150, cy + 120);
  const s0 = await onScreen(p0);
  expect(Math.hypot(s0.x - (cx + 70), s0.y - (cy + 30))).toBeLessThan(4);
  // Release lost (no pointerup reaches the canvas): the next move without a button ends the orbit.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 40, cy);
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 })));
  const a = await page.evaluate(() => (globalThis as any).forma3.view.theta);
  await page.mouse.move(cx + 200, cy);
  const b = await page.evaluate(() => (globalThis as any).forma3.view.theta);
  expect(b).toBe(a);
  await page.mouse.up({ button: 'right' });
  expect(errors).toEqual([]);
});

test('navigation: a middle pan never takes the eye under the ground, keeps the grabbed point near the edges, and zooming out after zooming into a facade goes back out', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(() => {
    const c = (globalThis as any).forma3.view.renderer.domElement.getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height };
  });
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  const cam = () => page.evaluate(() => { const v = (globalThis as any).forma3.view; return { y: v.camera.position.y, d: v.distance, t: v.target.toArray() as number[], c: v.camera.position.toArray() as number[] }; });
  // A low view (just above the ground), then the middle button dragged up: the eye stops at 0.3 m.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    Object.assign(ed.view, { theta: 0.75, phi: 1.5, distance: 40 });
    ed.view.target.set(b.position[0], 2, b.position[1]);
    ed.view.updateCamera();
  });
  const ys: number[] = [];
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx, cy - (350 * i) / 20);
    ys.push((await cam()).y);
  }
  await page.mouse.up({ button: 'middle' });
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0.299);
  // And back down: the eye rises again.
  await page.mouse.move(cx, cy - 200);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx, cy - 200 + (300 * i) / 10);
  await page.mouse.up({ button: 'middle' });
  expect((await cam()).y).toBeGreaterThan(Math.min(...ys) + 1);
  // Near the bottom-left corner the grabbed point still follows the cursor (it used to slip ~9 px).
  await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    Object.assign(v, { theta: 0.75, phi: 1, distance: 120 });
    v.target.set(0, 0, 0);
    v.updateCamera();
  });
  const sx = r.x + 300,
    sy = r.y + r.h - 90;
  const p0 = await page.evaluate(([x, y]) => (globalThis as any).forma3.view.pointAt({ clientX: x, clientY: y }).toArray(), [sx, sy]);
  await page.mouse.move(sx, sy);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 20; i++) await page.mouse.move(sx + (150 * i) / 20, sy - (200 * i) / 20);
  await page.mouse.up({ button: 'middle' });
  const s0 = await page.evaluate(([q]) => { const v = (globalThis as any).forma3.view; const T = v.camera.position.constructor; const s = v.toScreen(new T(...(q as number[]))); const rr = v.renderer.domElement.getBoundingClientRect(); return { x: rr.left + s.x, y: rr.top + s.y }; }, [p0]);
  expect(Math.hypot(s0.x - (sx + 150), s0.y - (sy - 200))).toBeLessThan(2);
  // Wheel into a facade until the camera stops at it, keep turning, then wheel out: the camera goes far again.
  // The audit's case: the target is behind the facade under the cursor (the Barn stands between the camera
  // and the Courtyard block the camera looks at).
  const aim = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Barn');
    const bb = ed.boundsOf(b, b.solids.map((s: any) => s.id));
    const T = ed.view.camera.position.constructor;
    Object.assign(ed.view, { theta: 0, phi: 1.45, distance: 40 });
    ed.view.target.set(-2.5, 5, 10);
    ed.view.updateCamera();
    // The middle of the view falls on the Barn's front gable, 5 m from the camera; the target is 40 m away.
    const rr = ed.view.renderer.domElement.getBoundingClientRect();
    const x = rr.left + rr.width / 2,
      y = rr.top + rr.height / 2;
    const hit = ed.pickAt({ clientX: x, clientY: y });
    void bb;
    void T;
    return { x, y, c: (hit?.point ?? ed.view.target).toArray() as number[], on: hit?.building?.name };
  });
  expect(aim.on).toBe('Barn');
  await page.mouse.move(aim.x, aim.y);
  for (let i = 0; i < 70; i++) await page.mouse.wheel(0, -120);
  const near = await cam();
  for (let i = 0; i < 120; i++) await page.mouse.wheel(0, 120);
  const far = await cam();
  const away = Math.hypot(far.c[0]! - aim.c[0]!, far.c[1]! - aim.c[1]!, far.c[2]! - aim.c[2]!);
  expect(near.d).toBeLessThan(5);
  // Far again (it used to stop ~39 m away with the target 286 m behind the wall and under the ground).
  expect(away).toBeGreaterThan(150);
  expect(far.t[1]!).toBeGreaterThan(-5);
  expect(errors).toEqual([]);
});

test('view cube: faces, corners and Home turn the camera to the standard views', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const click = async (dir: string) => {
    const p = await page.evaluate((d) => {
      const el = [...document.querySelectorAll<HTMLElement>('.f3-cube [data-dir]')].find((x) => x.dataset.dir === d && x.getBoundingClientRect().width > 3)!;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, dir);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => (globalThis as any).forma3.view.anim === 0);
  };
  const angles = () => page.evaluate(() => { const v = (globalThis as any).forma3.view; return { phi: v.phi, theta: v.theta }; });
  await click('1,0,0');
  expect((await angles()).theta).toBeCloseTo(Math.PI / 2, 3);
  expect((await angles()).phi).toBeCloseTo(Math.PI / 2 - 0.02, 3);
  await click('1,1,1');
  expect((await angles()).phi).toBeCloseTo(Math.acos(1 / Math.sqrt(3)), 3);
  expect((await angles()).theta).toBeCloseTo(Math.PI / 4, 3);
  // The bottom is not a view: the camera stays above the ground.
  expect(await page.locator('.f3-cube [data-dir="0,-1,0"]').getAttribute('class')).toContain('off');
  await page.locator('.f3-cube-home').click();
  await page.waitForFunction(() => (globalThis as any).forma3.view.anim === 0);
  expect((await angles()).phi).toBeCloseTo(1, 3);
  expect((await angles()).theta).toBeCloseTo(0.75, 3);
  expect(errors).toEqual([]);
});

test('structure tab: filter, rename by double click, eye; layers tab apart', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.getByRole('tab', { name: 'Structure' }).click();
  await page.locator('[data-tf]').fill('tow');
  const names = await page.locator('.f3-tree-list .nm').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n.toLowerCase()).toContain('tow');
  await page.locator('[data-tf]').fill('');
  await page.locator('[data-tbar="expand"]').click();
  const vol = page.locator('.f3-tree-list .f3-lrow.sub[data-s] .nm').first();
  await vol.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Main body');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (globalThis as any).forma3.project.buildings[0].solids[0].name)).toBe('Main body');
  await page.locator('.f3-tree-list .f3-lrow[data-b]:not([data-s]):not([data-i]) [data-tact="eye"]').first().click();
  expect(await page.evaluate(() => (globalThis as any).forma3.project.buildings[0].hidden)).toBe(true);
  await page.getByRole('tab', { name: 'Layers' }).click();
  await expect(page.locator('.f3-layers [data-lact="add"]')).toBeVisible();
  await expect(page.locator('.f3-tree')).toBeHidden();
  expect(errors).toEqual([]);
});

test('dimensions: click the value, type, Enter applies; Tab goes to the next; comma accepted', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Courtyard block');
  // The width label measures the body (walls, roof and eave; not the awnings, audit D3): the typed value
  // is the body width.
  const size = () => page.evaluate(() => { const ed = (globalThis as any).forma3; const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block'); const bb = ed.boundsOf(b, undefined, true); return { w: bb.max[0] - bb.min[0], h: b.solids[0].height }; });
  const labels = page.locator('.f3-sdim.edit');
  await labels.nth(0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('24');
  await page.keyboard.press('Enter');
  expect((await size()).w).toBeCloseTo(24, 2);
  // Tab: applies and opens the next value.
  await labels.nth(0).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('22,5');
  await page.keyboard.press('Tab');
  expect((await size()).w).toBeCloseTo(22.5, 2);
  await expect(page.locator('.f3-sdim input')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.f3-sdim input')).toHaveCount(0);
  // Total height (roof included): the result shows exactly the typed value.
  for (const v of ['10', '12,5', '8']) {
    await page.locator('.f3-sdim.edit', { hasText: '↕' }).click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(v);
    await page.keyboard.press('Enter');
    await expect(page.locator('.f3-sdim', { hasText: '↕' })).toHaveText(`↕ ${v.replace(',', '.')} m`);
  }
  expect(errors).toEqual([]);
});

test('dimensions: never over one another or over a handle, from four sides of every sample; a side facing away is measured on its top edge', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const bad: string[] = [];
    let states = 0;
    const meets = (a: DOMRect, b: { left: number; right: number; top: number; bottom: number }) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const check = (tag: string) => {
      states++;
      const vis = [...document.querySelectorAll<HTMLElement>('.f3-sdim')].filter((e) => !e.hidden).map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }));
      if (!vis.length) bad.push(`${tag}: no dimension`);
      for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) if (meets(vis[i]!.r, vis[j]!.r)) bad.push(`${tag}: ${vis[i]!.t} over ${vis[j]!.t}`);
      for (const h of ed.handles.footprints()) for (const v of vis) if (meets(v.r, h)) bad.push(`${tag}: ${v.t} over a handle`);
    };
    const far = () => {
      ed.view.distance *= 3;
      ed.view.updateCamera();
    };
    for (const b of ed.project.buildings)
      for (const theta of [0.75, 2.3, 3.9, 5.4]) {
        ed.enter(null);
        ed.select({ building: b.id });
        ed.view.theta = theta;
        ed.view.phi = 0.95;
        ed.frameSelection();
        check(`${b.name} ${theta}`);
        // Far away (small on screen, as in the opening view) the labels crowd: they still never meet.
        far();
        check(`${b.name} far ${theta}`);
        const s = b.solids.find((x: any) => x.op === 'add');
        ed.enter(b.id);
        ed.select({ building: b.id, solids: [s.id] });
        ed.frameSelection();
        check(`${b.name} volume ${theta}`);
        far();
        check(`${b.name} volume far ${theta}`);
      }
    // Curved building seen from the front: its straight back side (20 m between its corners) is labeled at the top, not over the front facade.
    const c = ed.project.buildings.find((x: any) => x.name === 'Curved building');
    ed.enter(c.id);
    ed.select({ building: c.id, solids: [c.solids[0].id] });
    ed.view.theta = 0.75;
    ed.view.phi = 0.95;
    ed.frameSelection();
    const canvas = ed.view.renderer.domElement.getBoundingClientRect();
    const V = ed.view.camera.position.constructor;
    const at = (y: number) => {
      const s = ed.view.toScreen(new V(c.position[0], y, c.position[1] - 5));
      return { x: canvas.left + s.x, y: canvas.top + s.y };
    };
    const el = [...document.querySelectorAll<HTMLElement>('.f3-sdim')].find((e) => e.textContent === '20 m')!.getBoundingClientRect();
    const mid = { x: (el.left + el.right) / 2, y: (el.top + el.bottom) / 2 };
    const top = at(c.solids[0].height),
      base = at(0);
    return { bad, states, nearTop: Math.hypot(mid.x - top.x, mid.y - top.y) < Math.hypot(mid.x - base.x, mid.y - base.y) };
  });
  expect(r.bad).toEqual([]);
  expect(r.states).toBe(176);
  expect(r.nearTop).toBe(true);
  expect(errors).toEqual([]);
});

test('panels: related values share a row (X·Y·Z, W·D·H) and nothing is cut (label, value, choice, button) at 240 and 300 px', async ({ page }) => {
  // 240 px puts the labels above the cells, 300 px beside them (a wider panel only has more room).
  test.setTimeout(150_000);
  const errors: string[] = [];
  await open(page, errors);
  const r = await page.evaluate(async () => {
    const ed = (globalThis as any).forma3;
    const side: HTMLElement = ed.shell.side;
    const wait = () => new Promise((res) => setTimeout(res, 40));
    const c = document.createElement('canvas').getContext('2d')!;
    const textW = (el: Element, t: string) => {
      const cs = getComputedStyle(el);
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return c.measureText(t).width;
    };
    const cut: string[] = [];
    let states = 0;
    const audit = async (tag: string) => {
      await wait();
      states++;
      for (const sp of side.querySelectorAll<HTMLElement>('.f3-prow>.lab>span')) if (sp.scrollHeight > sp.clientHeight + 1 || sp.scrollWidth > sp.clientWidth + 1) cut.push(`${tag}: label ${sp.textContent}`);
      for (const inp of side.querySelectorAll<HTMLInputElement>('.f3-cell input:not([type=color])')) {
        const cs = getComputedStyle(inp);
        const room = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        if (textW(inp, inp.value || inp.placeholder) > room + 0.5) cut.push(`${tag}: value ${inp.getAttribute('aria-label')} = ${inp.value}`);
      }
      for (const s of side.querySelectorAll<HTMLSelectElement>('.f3-cell select')) if (textW(s, s.options[s.selectedIndex]?.text ?? '') > s.clientWidth - 22) cut.push(`${tag}: choice ${s.getAttribute('aria-label')}`);
      for (const b of side.querySelectorAll<HTMLElement>('button')) if (b.offsetParent && b.scrollWidth > b.clientWidth + 1) cut.push(`${tag}: button ${b.textContent?.trim()}`);
    };
    const rowOf = (key: string) => [...(side.querySelector(`input[data-k="${key}"]`)?.closest('.f3-cells')?.querySelectorAll('input') ?? [])].map((i) => i.dataset.k).join(',');
    const rows: Record<string, string> = {};
    for (const w of [240, 300]) {
      ed.shell.aside.style.setProperty('--aside-w', `${w}px`);
      for (const b of ed.project.buildings) {
        ed.enter(null);
        ed.select({ building: b.id });
        await audit(`${w} ${b.name}`);
        rows.building = rowOf('px');
        ed.enter(b.id);
        for (const s of b.solids) {
          ed.select({ building: b.id, solids: [s.id] });
          await audit(`${w} ${b.name} ${s.name}`);
          rows.position = rowOf('cx');
          rows.size = rowOf('sizew');
          ed.select({ building: b.id, solids: [s.id], face: { kind: 'side', solid: s.id, edge: s.plan.outer[0].id }, vertex: s.plan.outer[0].id });
          await audit(`${w} ${b.name} face and corner`);
        }
        const els = ed.elements();
        if (els.length) {
          ed.select({ building: b.id, elems: els.slice(0, 6).map((e: any) => e.key) });
          await audit(`${w} ${b.name} elements`);
        }
        if (b.solids.length > 1) {
          ed.select({ building: b.id, solids: b.solids.slice(0, 2).map((s: any) => s.id) });
          await audit(`${w} ${b.name} align`);
        }
      }
      ed.setTool('paint');
      await audit(`${w} paint`);
      ed.setTool('select');
    }
    return { cut, states, rows };
  });
  expect(r.cut).toEqual([]);
  expect(r.states).toBeGreaterThan(100);
  expect(r.rows).toEqual({ building: 'px,py,pz', position: 'cx,base,cz', size: 'sizew,sized,height' });
  expect(errors).toEqual([]);
});

test('selection: Shift+G same use, H hides, Alt+H shows, Ctrl+A / Ctrl+I inside, a named set is saved, renamed and recalled', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await pick(page, 'Factory');
  const ed = (f: string) => page.evaluate(f);
  const names = () => page.evaluate(() => { const e = (globalThis as any).forma3; return e.selectedBuildings().map((id: string) => e.project.buildings.find((b: any) => b.id === id).name).sort(); });
  await page.locator('canvas').first().focus();
  await page.keyboard.press('Shift+G');
  expect(await names()).toEqual(['Barn', 'Factory', 'Vaulted shed']);
  await page.keyboard.press('h');
  expect(await ed('forma3.project.buildings.filter((b) => b.hidden).length')).toBe(3);
  await page.keyboard.press('Alt+h');
  expect(await ed('forma3.project.buildings.filter((b) => b.hidden).length')).toBe(0);
  // Inside a building: Ctrl+A takes every volume, Ctrl+I inverts.
  await page.evaluate(() => { const e = (globalThis as any).forma3; e.enter(e.project.buildings.find((b: any) => b.name === 'Courtyard block').id); });
  await page.keyboard.press('Control+a');
  expect(await ed('forma3.sel.solids.length')).toBe(2);
  await expect(page.locator('.f3-crumb')).toContainText('2 volumes');
  await page.keyboard.press('Control+i');
  expect(await ed('forma3.sel.solids.length')).toBe(0);
  await page.keyboard.press('Control+i');
  // Saved from the Structure tab, renamed, recalled from somewhere else.
  await page.getByRole('tab', { name: 'Structure' }).click();
  await page.locator('[data-sact="save"]').click();
  await page.locator('[data-sact="pick"]').first().dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Courtyard pair');
  await page.keyboard.press('Enter');
  expect(await ed('forma3.project.selectionSets[0].name')).toBe('Courtyard pair');
  await page.evaluate(() => { const e = (globalThis as any).forma3; e.enter(null); e.select({ building: e.project.buildings[0].id }); });
  await page.locator('[data-sact="pick"]').first().click();
  expect(await ed('forma3.sel.solids.length')).toBe(2);
  expect(await ed('forma3.context === forma3.sel.building')).toBe(true);
  expect(errors).toEqual([]);
});

test('interior view: Exploded shows every floor apart even after "only this floor"; nothing can be edited while exploded', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const view = () => page.evaluate(() => (globalThis as any).forma3.project.view ?? {});
  await page.getByRole('button', { name: 'Interior view' }).click();
  const pop = page.getByRole('dialog', { name: 'Interior view' });
  await pop.getByRole('button', { name: 'Cutaway' }).click();
  await pop.locator('[data-cut]').selectOption('2');
  await pop.locator('[data-only]').check();
  // One floor shown: the gap has nothing to move apart.
  await expect(pop.locator('[data-explode]')).toBeDisabled();
  await pop.getByRole('button', { name: 'Exploded' }).click();
  const v = await view();
  expect(v.explode).toBe(4);
  expect(v.cutLevel ?? v.onlyLevel).toBeUndefined();
  await expect(pop.locator('[data-explode]')).toBeEnabled();
  // Selecting works, editing does not: no contextual bar, Delete and Ctrl+D leave the project as it was.
  const before = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Bungalow');
    ed.select({ building: b.id });
    return JSON.stringify(ed.project.buildings);
  });
  // Keys go to the editor once the focus leaves the panel's select and checkbox.
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.focus());
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+d');
  const after = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    return { json: JSON.stringify(ed.project.buildings), bar: ed.shell.ctxbar.hidden, toast: ed.shell.toast.textContent, undo: ed.store.canUndo };
  });
  expect(after.json).toBe(before);
  expect(after.bar).toBe(true);
  expect(after.toast).toContain('Exploded view');
  // A click on a lifted building only selects it (no "blocked" message); dragging it says why nothing moves.
  // The exploded floors are drawn a few buildings per frame (View.sync queue): pick once they are all in.
  await settle(page);
  const at = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.project.buildings.find((x: any) => x.name === 'Courtyard block');
    const bt = ed.view.built.get(b.id);
    const box = bt.shell.mesh.geometry.boundingBox;
    const c = box.getCenter(box.min.clone()).applyMatrix4(bt.group.matrixWorld);
    const s = ed.view.toScreen(c);
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const x = r.left + s.x, y = r.top + s.y;
    ed.select({ building: null });
    ed.shell.toast.textContent = '';
    ed.shell.toast.classList.remove('on');
    return { x, y, hit: ed.view.pick(ed.project, { clientX: x, clientY: y })?.building.name, pos: [...b.position] };
  });
  expect(at.hit).toBe('Courtyard block');
  await page.mouse.click(at.x, at.y);
  await settle(page);
  const clicked = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    return { sel: ed.store.building(ed.sel.building)?.name, toast: ed.shell.toast.textContent };
  });
  expect(clicked.sel).toBe('Courtyard block');
  expect(clicked.toast).toBe('');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 10, { steps: 5 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    return { toast: ed.shell.toast.textContent, pos: [...ed.project.buildings.find((x: any) => x.name === 'Courtyard block').position] };
  });
  expect(dragged.toast).toContain('Exploded view');
  expect(dragged.pos).toEqual(at.pos);
  expect(errors).toEqual([]);
});

test('interior view: cutaway, exploded floors with the gap dragged, a single floor; show all brings the buildings back', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const view = () => page.evaluate(() => (globalThis as any).forma3.project.view ?? {});
  await page.getByRole('button', { name: 'Interior view' }).click();
  const pop = page.getByRole('dialog', { name: 'Interior view' });
  await expect(pop).toBeVisible();
  await pop.getByRole('button', { name: 'Cutaway' }).click();
  expect((await view()).hiddenBody).toEqual(['walls', 'roofs']);
  // A view change is drawn building by building in the next frames (the interface never freezes):
  // the click answers at once, and the drawing is complete when the view is no longer busy.
  await page.waitForFunction(() => !(globalThis as any).forma3.view.busy);
  // The walls are cut away: the slabs show their section.
  const cut = await page.evaluate(() => { const e = (globalThis as any).forma3; const b = e.project.buildings.find((x: any) => x.name === 'Courtyard block'); const bt = e.view.built.get(b.id); return [...bt.ev.shell.faceOf].filter((f: number) => bt.ev.faces[f].kind === 'cut').length; });
  expect(cut).toBeGreaterThan(0);
  await pop.getByRole('button', { name: 'Exploded' }).click();
  expect(await view()).toMatchObject({ explode: 4 });
  expect((await view()).hiddenBody).toBeUndefined();
  await page.waitForFunction(() => !(globalThis as any).forma3.view.busy);
  // Dragging the gap: one history step on release, no re-evaluation and no new mesh while
  // dragging, not even through 0; the floors move in place.
  const marks = () =>
    page.evaluate(() => {
      const e = (globalThis as any).forma3;
      (globalThis as any).__built ??= new Map();
      const prev = (globalThis as any).__built as Map<string, unknown>;
      let same = 0;
      for (const [id, x] of e.view.built) if (prev.get(id) === x.ev && x.shell.mesh.parent) same++;
      for (const [id, x] of e.view.built) prev.set(id, x.ev);
      const b = e.project.buildings.find((x: any) => x.name === 'Courtyard block');
      return { same, all: e.view.built.size, top: e.view.built.get(b.id).shell.mesh.geometry.boundingBox.max.y as number, undo: e.store.undoStack.length as number };
    });
  const m0 = await marks();
  const range = pop.locator('[data-explode]');
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 1, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await view()).explode).toBeGreaterThan(7);
  const m1 = await marks();
  expect(m1.same).toBe(m1.all);
  expect(m1.top).toBeGreaterThan(m0.top + 6);
  expect(m1.undo).toBe(m0.undo + 1);
  // Released under a still mouse: the slider's balloon does not cover the rows below.
  await page.waitForTimeout(TIP_DELAY);
  await expect(page.locator('.f3-tip.on')).toHaveCount(0);
  // Undo of the gap: the floors move back, still without evaluating.
  await page.keyboard.press('Control+z');
  await settle(page);
  const m2 = await marks();
  expect(m2.same).toBe(m2.all);
  expect(m2.top).toBeCloseTo(m0.top, 3);
  // Moving the mouse onto a tool shows its balloon again.
  await page.locator('.f3-tools button').first().hover();
  await expect(page.locator('.f3-tip.on')).toHaveCount(1);
  await pop.locator('[data-cut]').selectOption('1');
  await pop.locator('[data-only]').check();
  expect(await view()).toMatchObject({ cutLevel: 1, onlyLevel: true });
  await pop.getByRole('button', { name: 'Show all' }).click();
  const v = await view();
  expect(v.explode ?? v.cutLevel ?? v.onlyLevel ?? v.hiddenBody).toBeUndefined();
  expect(errors).toEqual([]);
});

/** Screen point in the middle of where the model shows a face of this kind on the active building (away from corner handles). */
async function faceAt(page: Page, kind: string) {
  return page.evaluate((k) => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const hits: { x: number; y: number }[] = [];
    for (let y = r.top + 40; y < r.bottom - 40; y += 3)
      for (let x = r.left + 60; x < r.right - 340; x += 6) {
        const h = ed.view.pick(ed.project, { clientX: x, clientY: y });
        if (h?.building.id === b.id && h.face?.kind === k) hits.push({ x, y });
      }
    if (!hits.length) return null;
    // The hit nearest to their mean: inside the face, far from its corners.
    const mx = hits.reduce((a, p) => a + p.x, 0) / hits.length,
      my = hits.reduce((a, p) => a + p.y, 0) / hits.length;
    return hits.reduce((best, p) => (Math.hypot(p.x - mx, p.y - my) < Math.hypot(best.x - mx, best.y - my) ? p : best));
  }, kind);
}

test('inset: the niche depth goes through the wall (out = projection, in = niche); plinth and parapet are chosen by clicking; a cutter offers no roof', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // A fresh 12 × 6 m box, drawn with the rectangle tool, seen from the front and low.
  const pts = await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    Object.assign(v, { theta: 0.35, phi: 1.2, distance: 34 });
    v.target.set(-64, 2, 58);
    v.updateCamera();
    const T = v.camera.position.constructor;
    const r = v.renderer.domElement.getBoundingClientRect();
    const S = (x: number, z: number) => { const s = v.toScreen(new T(x, 0, z)); return { x: r.left + s.x, y: r.top + s.y }; };
    return [S(-70, 55), S(-58, 61)];
  });
  await page.keyboard.press('r');
  await page.mouse.click(pts[0]!.x, pts[0]!.y);
  await page.mouse.move(pts[1]!.x, pts[1]!.y, { steps: 4 });
  await page.mouse.click(pts[1]!.x, pts[1]!.y);
  await page.keyboard.press('Escape');
  await settle(page);
  const side = (await faceAt(page, 'side'))!;
  // Click: the building; click again: into it, on the volume; once more (not a double click): the face.
  await page.mouse.click(side.x, side.y);
  await settle(page);
  await page.mouse.click(side.x, side.y);
  await settle(page);
  if (!(await page.evaluate(() => (globalThis as any).forma3.sel.face))) {
    await page.mouse.click(side.x, side.y);
    await settle(page);
  }
  expect(await page.evaluate(() => (globalThis as any).forma3.sel.face?.kind)).toBe('side');
  await page.locator('.f3-ctx button[data-a="inset"]').click();
  await settle(page);
  await expect(page.locator('.f3-lastop')).toBeVisible();
  // One depth arrow, on the niche's free face: dragged out past the wall, the niche becomes a projection.
  const arrow = () =>
    page.evaluate(() => {
      const ed = (globalThis as any).forma3;
      const h = ed.handles.list.find((x: any) => x.hosted);
      const r = ed.view.renderer.domElement.getBoundingClientRect();
      const p = ed.handles.posOf(h);
      const a = ed.view.toScreen(p.clone().add(h.dir.clone().multiplyScalar(0.25)));
      const out = ed.view.toScreen(p.clone().add(h.dir.clone().multiplyScalar(3)));
      const inn = ed.view.toScreen(p.clone().add(h.dir.clone().multiplyScalar(-2.5)));
      return { a: { x: r.left + a.x, y: r.top + a.y }, out: { x: r.left + out.x, y: r.top + out.y }, inn: { x: r.left + inn.x, y: r.top + inn.y }, n: ed.handles.list.filter((x: any) => x.hosted).length };
    });
  const solid = () => page.evaluate(() => { const s = (globalThis as any).forma3.activeSolid(); return { op: s.op, name: s.name }; });
  expect(await solid()).toMatchObject({ op: 'subtract' });
  let ar = await arrow();
  expect(ar.n).toBe(1);
  await page.mouse.move(ar.a.x, ar.a.y);
  await page.mouse.down();
  await page.mouse.move(ar.out.x, ar.out.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  expect(await solid()).toMatchObject({ op: 'add' });
  expect((await solid()).name).toMatch(/\(annex\)$/);
  // The last operation panel no longer shows the inset's old depth.
  await expect(page.locator('.f3-lastop')).toBeHidden();
  ar = await arrow();
  await page.mouse.move(ar.a.x, ar.a.y);
  await page.mouse.down();
  await page.mouse.move(ar.inn.x, ar.inn.y, { steps: 8 });
  await page.mouse.up();
  await settle(page);
  expect(await solid()).toMatchObject({ op: 'subtract' });
  // The cutter's panel: the shape of the top of the hole, never the roof chips of a volume (Hip carved a wedge).
  await expect(page.locator('.f3-side h3', { hasText: 'Top of the cut' })).toBeVisible();
  await expect(page.locator('.f3-side [data-roof="hip"]')).toHaveCount(0);
  await expect(page.locator('.f3-side [data-act="addrule"]')).toHaveCount(0);
  // Back on the wall's volume: its plinth and its parapet are picked by clicking them.
  await page.locator('.f3-side [data-act="tohost"]').click();
  await settle(page);
  const plinth = (await faceAt(page, 'plinth'))!;
  await page.mouse.click(plinth.x, plinth.y);
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.sel.face?.kind)).toBe('plinth');
  await expect(page.locator('.f3-side h3', { hasText: 'Selected plinth' })).toBeVisible();
  const ph = page.locator('.f3-side input[data-k="plinth"]');
  await ph.click({ clickCount: 3 });
  await page.keyboard.type('0.9');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.activeSolid().plinth)).toBe(0.9);
  const cop = (await faceAt(page, 'coping')) ?? (await faceAt(page, 'parapet'))!;
  await page.mouse.click(cop.x, cop.y);
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.sel.face?.kind)).toBe('parapet');
  await expect(page.locator('.f3-side h3', { hasText: 'Selected parapet' })).toBeVisible();
  // A hip roof has no parapet: the choice falls back to the volume.
  await page.locator('.f3-side [data-roof="hip"]').click();
  await settle(page);
  expect(await page.evaluate(() => { const ed = (globalThis as any).forma3; return [ed.sel.face, ed.activeSolid().roof.kind]; })).toEqual([null, 'hip']);
  await expect(page.locator('.f3-side h3', { hasText: 'Selected parapet' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cut tool (U): a click on a wall splits it in two faces, Shift+click cuts across at a height, two clicks on a top cut the volume; undo restores', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const pts = await page.evaluate(() => {
    const v = (globalThis as any).forma3.view;
    Object.assign(v, { theta: 0.35, phi: 1.0, distance: 34 });
    v.target.set(-64, 2, 58);
    v.updateCamera();
    const T = v.camera.position.constructor;
    const r = v.renderer.domElement.getBoundingClientRect();
    const S = (x: number, z: number) => { const s = v.toScreen(new T(x, 0, z)); return { x: r.left + s.x, y: r.top + s.y }; };
    return [S(-70, 55), S(-58, 61)];
  });
  await page.keyboard.press('r');
  await page.mouse.click(pts[0]!.x, pts[0]!.y);
  await page.mouse.move(pts[1]!.x, pts[1]!.y, { steps: 4 });
  await page.mouse.click(pts[1]!.x, pts[1]!.y);
  await settle(page);
  await page.keyboard.press('u');
  expect(await page.evaluate(() => (globalThis as any).forma3.tool)).toBe('cut');
  const state = () => page.evaluate(() => { const ed = (globalThis as any).forma3; const b = ed.activeBuilding(); return { solids: b.solids.length, corners: b.solids.map((s: any) => s.plan.outer.length), face: ed.sel.face?.kind ?? null, sdims: document.querySelectorAll('.f3-sdim').length }; });
  // Vertical cut on the wall: one more corner, the new face chosen, no selection dimensions under the tool's label.
  const side = (await faceAt(page, 'side'))!;
  await page.mouse.move(side.x - 3, side.y);
  await page.mouse.move(side.x, side.y);
  await page.mouse.click(side.x, side.y);
  await settle(page);
  let st = await state();
  expect(st.corners).toEqual([5]);
  expect(st.face).toBe('side');
  expect(st.sdims).toBe(0);
  // Across, at a height: two volumes.
  await page.keyboard.down('Shift');
  await page.mouse.click(side.x, side.y + 4);
  await page.keyboard.up('Shift');
  await settle(page);
  expect((await state()).solids).toBe(2);
  await page.keyboard.press('Control+z');
  await settle(page);
  expect((await state()).solids).toBe(1);
  // Across the top, from one long side to the other: the volume becomes two.
  const ends = await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const b = ed.activeBuilding();
    const s = b.solids[0];
    const M = ed.view.buildingMatrix(b);
    const T = ed.view.camera.position.constructor;
    const xs = s.plan.outer.map((v: any) => v.p[0]), zs = s.plan.outer.map((v: any) => v.p[1]);
    const x = (Math.min(...xs) + Math.max(...xs)) / 2 + 2;
    const y = s.base + s.height;
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    const S = (z: number) => { const p = ed.view.toScreen(new T(x, y, z).applyMatrix4(M)); return { x: r.left + p.x, y: r.top + p.y }; };
    return [S(Math.min(...zs) + 0.05), S(Math.max(...zs) - 0.05)];
  });
  await page.mouse.move(ends[0]!.x, ends[0]!.y);
  await page.mouse.click(ends[0]!.x, ends[0]!.y);
  await page.mouse.move(ends[1]!.x, ends[1]!.y, { steps: 5 });
  await page.mouse.click(ends[1]!.x, ends[1]!.y);
  await settle(page);
  st = await state();
  expect(st.solids).toBe(2);
  // Esc leaves a started cut without cutting.
  await page.mouse.click(ends[0]!.x, ends[0]!.y);
  await page.keyboard.press('Escape');
  await page.mouse.click(ends[1]!.x, ends[1]!.y);
  await settle(page);
  expect((await state()).solids).toBe(2);
  expect(errors).toEqual([]);
});

test('third audit F1–F8: extrude on a chosen top, bevel segments without a width, arrows on rule fields, nothing to bring back, distribute needs three, nothing to isolate', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  const toast = () => page.evaluate(() => (globalThis as any).forma3.shell.toast.textContent as string);
  const into = (name: string, face?: 'top') =>
    page.evaluate(
      ([n, f]) => {
        const ed = (globalThis as any).forma3;
        const b = ed.project.buildings.find((x: any) => x.name === n);
        ed.select({ building: b.id });
        ed.frameSelection();
        ed.enter(b.id);
        ed.select({ building: b.id, solids: [b.solids[0].id], ...(f ? { face: { kind: f } } : {}) });
        return b.solids.length;
      },
      [name, face] as const,
    );
  // F1: the top chosen, Extrude makes a volume on it (it only switched tools).
  const n0 = await into('Courtyard block', 'top');
  await page.locator('.f3-ctx button[data-a="extrude"]').click();
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.activeBuilding().solids.length)).toBe(n0 + 1);
  await expect(page.locator('.f3-lastop')).toBeVisible();
  await page.keyboard.press('Control+z');
  // F2: segments without a width are kept, and the message says what is missing.
  await into('Courtyard block');
  const seg = page.locator('.f3-side input[data-k="bvseg"]');
  await seg.click({ clickCount: 3 });
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.activeSolid().bevel?.segments)).toBe(3);
  expect(await toast()).toContain('width');
  // F3: the arrow steps the value of a rule.
  const val = page.locator('.f3-side .f3-rule input[data-rk="value"]').first();
  const v0 = Number((await val.inputValue()).replace(',', '.'));
  await val.click();
  await page.keyboard.press('ArrowUp');
  await settle(page);
  const v1 = await page.evaluate(() => (globalThis as any).forma3.activeSolid().facade[0].value);
  expect(v1).toBeGreaterThan(v0);
  // F6: an element that never left its rule: nothing to bring back, said so, selection kept.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    const k = ed.elements().find((e: any) => e.key.startsWith('r|')).key;
    ed.selectElemKeys(ed.activeBuilding().id, [k]);
  });
  await settle(page);
  await page.locator('.f3-ctx button[data-a="restore"]').click();
  expect(await toast()).toContain('Nothing to bring back');
  expect(await page.evaluate(() => (globalThis as any).forma3.sel.elems.length)).toBe(1);
  // F8: the other volumes are cutters: nothing to isolate, said so.
  await into('Courtyard block');
  await page.evaluate(() => (globalThis as any).forma3.isolateSelection());
  expect(await toast()).toContain('Nothing else to hide');
  // F7: two buildings: distribute says it needs three.
  await page.evaluate(() => {
    const ed = (globalThis as any).forma3;
    ed.context = null;
    const f = ed.project.buildings.find((x: any) => x.name === 'Factory');
    const b = ed.project.buildings.find((x: any) => x.name === 'Barn');
    ed.select({ building: f.id, others: [b.id] });
  });
  await settle(page);
  await page.locator('.f3-side [data-align="distX"]').click();
  expect(await toast()).toContain('three or more');
  expect(errors).toEqual([]);
});

/** Screen point of a world point on the canvas. */
async function screenOf(page: Page, p: [number, number, number]) {
  return page.evaluate((q) => {
    const v = (globalThis as any).forma3.view;
    const s = v.toScreen(new v.camera.position.constructor(q[0], q[1], q[2]));
    const r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, p);
}

/** R, two clicks on the ground (or a slab at y), "WxD" Enter and the height Enter. */
async function drawRect(page: Page, x: number, z: number, w: number, d: number, h: number, y = 0) {
  await page.keyboard.press('r');
  const a = await screenOf(page, [x, y, z]);
  await page.mouse.click(a.x, a.y);
  const b = await screenOf(page, [x + 3, y, z + 2]);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.click(b.x, b.y);
  await settle(page);
  await page.keyboard.type(`${w}x${d}`);
  await page.keyboard.press('Enter');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await settle(page);
}

test('audit 2026-10-11: floors typed on a building with a setback grow it; a rider follows its support; a volume drawn through a building joins it', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  // New project, a 20×15 m body 25 m tall: its floors fill the typed height (no 3.4 m floor in a 3 m wall).
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.focus());
  await page.keyboard.press('Control+k');
  await page.keyboard.type('New project');
  await page.keyboard.press('Enter');
  await settle(page);
  expect(await page.evaluate(() => (globalThis as any).forma3.project.buildings.length)).toBe(0);
  await page.evaluate(() => { const v = (globalThis as any).forma3.view; v.theta = 0.75; v.phi = 0.9; v.distance = 90; v.target.set(10, 0, 8); v.updateCamera(); });
  await settle(page);
  await drawRect(page, 0, 0, 20, 15, 25);
  const st = () => page.evaluate(() => { const b = (globalThis as any).forma3.project.buildings[0]; return { n: (globalThis as any).forma3.project.buildings.length, levels: b.levels.map((l: any) => l.height), solids: b.solids.map((s: any) => ({ base: +s.base.toFixed(3), h: +s.height.toFixed(3), on: s.on ?? null })) }; });
  let s = await st();
  expect(s.levels).toHaveLength(8);
  expect(s.levels.reduce((a: number, x: number) => a + x, 0)).toBeCloseTo(25, 6);
  // A setback on top (More → Top setback, through the panel action), then 12 floors typed in the building panel.
  await page.evaluate(() => { const ed = (globalThis as any).forma3; const b = ed.project.buildings[0]; ed.enter(b.id); ed.select({ building: b.id, solids: [b.solids[0].id] }); ed.quick('setback'); });
  await settle(page);
  s = await st();
  expect(s.solids[1].on).not.toBeNull();
  const top0 = s.solids[0].h;
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const ed = (globalThis as any).forma3; ed.enter(null); ed.select({ building: ed.project.buildings[0].id }); });
  await settle(page);
  const floors = page.locator('.f3-side [aria-label="Number of floors"]');
  const n0 = Number(await floors.inputValue());
  await floors.click({ clickCount: 3 });
  await page.keyboard.type(String(n0 + 3));
  await page.keyboard.press('Enter');
  await settle(page);
  s = await st();
  expect(s.levels).toHaveLength(n0 + 3);
  // The body grew three floors and the setback rides on it (before: the list grew, the drawing did not).
  expect(s.solids[0].h).toBeCloseTo(top0 + 3 * s.levels[1], 4);
  expect(s.solids[1].base).toBeCloseTo(s.solids[0].h, 6);
  expect(await page.locator('.f3-toast').textContent()).toMatch(/floors · height/);
  // The body's height typed in its panel: the setback goes along, whole.
  await page.evaluate(() => { const ed = (globalThis as any).forma3; const b = ed.project.buildings[0]; ed.enter(b.id); ed.select({ building: b.id, solids: [b.solids[0].id] }); });
  await settle(page);
  const hField = page.locator('.f3-side [aria-label="Height"]').first();
  await hField.click({ clickCount: 3 });
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await settle(page);
  const setH = s.solids[1].h;
  s = await st();
  expect(s.solids[0].h).toBeCloseTo(20, 6);
  expect(s.solids[1].base).toBeCloseTo(20, 6);
  expect(s.solids[1].h).toBeCloseTo(setH, 6);
  // A rectangle drawn on the ground through the building becomes a volume of it (no second building).
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const ed = (globalThis as any).forma3; ed.enter(null); ed.select({}); });
  await settle(page);
  await drawRect(page, 15, 10, 12, 12, 6);
  s = await st();
  expect(s.n).toBe(1);
  expect(s.solids).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('batches: buildings gone from the project leave nothing drawn (new project, Ctrl+Z, delete)', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await page.waitForFunction(() => !(globalThis as any).forma3.view.busy);
  // Instances drawn by the batches, and the buildings they should be.
  const drawn = () =>
    page.evaluate(() => {
      const v = (globalThis as any).forma3.view;
      let n = 0;
      for (const m of v.batcher.root.children) n += m._instanceInfo.filter((i: any) => i.visible && i.active).length;
      return { instances: n, buildings: (globalThis as any).forma3.project.buildings.length };
    });
  expect((await drawn()).instances).toBeGreaterThan(0);
  await page.evaluate(() => (globalThis as any).forma3.view.renderer.domElement.focus());
  await page.keyboard.press('Control+k');
  await page.keyboard.type('New project');
  await page.keyboard.press('Enter');
  await settle(page);
  // Before: the eleven samples stayed drawn by the batches until the next change.
  expect(await drawn()).toEqual({ instances: 0, buildings: 0 });
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => !(globalThis as any).forma3.view.busy);
  await settle(page);
  const back = await drawn();
  expect(back.buildings).toBe(11);
  expect(back.instances).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
