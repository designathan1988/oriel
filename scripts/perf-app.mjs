// FORMA performance scenario on the machine that runs it, in a VISIBLE Chrome with its normal GPU
// acceleration (not headless, not SwiftShader): frame time, CPU and GPU per frame (timer query),
// draw calls, triangles, memory, response of the tools, and the load of other processes.
// Usage (optional, real frame times on the GPU; not part of the check): with the test server up
// (npx vite --port 5795), FORMA_URL=http://127.0.0.1:5795/editor.html SIZE=S|T20|T40|L REPS=3 npm run perf:app
// It clears the page storage: never point it at the origin where real projects are saved (5792).
// Budgets measured on the player's machine (RTX 3060, 2026-10-12) with margin; a failure exits with 1.
// A visible Chrome window (installed Chrome, normal GPU acceleration) — not headless, not SwiftShader.
import { chromium } from 'playwright';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const WORK = process.env.FORMA_PERF_OUT || 'perf-out';
const PHOTOS = `${WORK}/photos`;
const LOGS = `${WORK}/logs`;
mkdirSync(PHOTOS, { recursive: true });
mkdirSync(LOGS, { recursive: true });

// The page to measure: never the 5792 origin where the user's projects are saved (the script clears storage).
const SERVERS = { app: process.env.FORMA_URL || 'http://127.0.0.1:5795/editor.html' };

function logger(name) {
  const file = `${LOGS}/${name}.log`;
  writeFileSync(file, '');
  return (...a) => {
    const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    console.log(line);
    appendFileSync(file, line + '\n');
  };
}

/**
 * Visible Chrome window. Occlusion flags only keep it drawing when another window covers it
 * (Chrome on Windows stops rAF for occluded windows); they do not change GPU or quality.
 */
async function launch({ w = 1440, h = 900, x = 30, y = 30 } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [`--window-position=${x},${y}`, `--window-size=${w},${h}`, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
  });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // Pointer lock in a probe clips the player's real cursor (memory: headless-pointer-lock-clips-cursor).
    Element.prototype.requestPointerLock = function () {
      return Promise.resolve();
    };
    const orig = window.requestAnimationFrame.bind(window);
    window.__raf = [];
    window.__rafOn = false;
    window.requestAnimationFrame = (cb) =>
      orig((t) => {
        const s = performance.now();
        try {
          cb(t);
        } finally {
          if (window.__rafOn) window.__raf.push(performance.now() - s);
        }
      });
    window.__frames = (n = 2) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : orig(f)); orig(f); });
    window.__rafOrig = orig;
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text());
  });
  return { browser, context, page, errors };
}

async function openEditor(page, url, { clear = true } = {}) {
  await page.goto(url);
  if (clear) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await page.waitForFunction(() => !!globalThis.forma3, null, { timeout: 180000 });
  await settle(page, 800);
}

async function settle(page, ms = 300) {
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__frames(2));
}

/** GPU and backend the page really uses. */
async function gpuInfo(page) {
  return page.evaluate(() => {
    const r = globalThis.forma3?.view?.renderer;
    const gl = r ? r.getContext() : document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      dpr: devicePixelRatio,
      canvas: r ? [r.domElement.width, r.domElement.height] : null,
      pixelRatio: r ? r.getPixelRatio() : null,
      ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    };
  });
}

/** CPU% of the busiest processes and total, over `secs` (other processes interfering). */
function cpuSnapshot(secs = 2) {
  try {
    const ps = `$a = Get-Process | Select-Object Id,Name,CPU; Start-Sleep -Milliseconds ${secs * 1000}; $b = Get-Process | Select-Object Id,Name,CPU; $n=[Environment]::ProcessorCount; $d=@{}; foreach($p in $a){ $d[$p.Id]=$p.CPU }; $r = foreach($p in $b){ if($d.ContainsKey($p.Id) -and $p.CPU -ne $null -and $d[$p.Id] -ne $null){ [pscustomobject]@{Name=$p.Name; Pct=[math]::Round((($p.CPU-$d[$p.Id])/${secs})*100/$n,1)} } }; $g = $r | Group-Object Name | ForEach-Object { [pscustomobject]@{Name=$_.Name; Pct=[math]::Round(($_.Group | Measure-Object Pct -Sum).Sum,1)} } | Sort-Object Pct -Descending; $tot=[math]::Round(($r | Measure-Object Pct -Sum).Sum,1); $gpu = (Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object CookedValue -Sum; @{ total=$tot; top=($g | Select-Object -First 6); gpu3d=[math]::Round($gpu.Sum,1) } | ConvertTo-Json -Compress -Depth 3`;
    return JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 }).trim());
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

async function shot(page, name, log) {
  const path = `${PHOTOS}/${name}.png`;
  await page.screenshot({ path });
  log?.(`PHOTO ${name}.png`);
  return path;
}

const med = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.floor(s.length / 2)].toFixed(2);
};
const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
};


/** Budgets per scene (ms unless said): measured values × ~1.5–2, so a real regression fails. */
const BUDGETS = {
  S: { floorPlus: 160, pushFace: 160, cutawayClick: 300, cutawayBack: 120, clickSelect: 80, drawCalls: 330 },
  T20: { floorPlus: 400, pushFace: 400, cutawayClick: 300, cutawayBack: 120, clickSelect: 90 },
  T40: { floorPlus: 700, pushFace: 700, cutawayClick: 400, cutawayBack: 120, clickSelect: 120 },
  L: { floorPlus: 200, pushFace: 200, cutawayClick: 400, cutawayBack: 150, clickSelect: 80, drawCalls: 5600, reopenWall: 7000 },
};
function checkBudgets(o) {
  const b = BUDGETS[o.size] ?? {};
  const f = [];
  const over = (name, v, lim) => v != null && lim != null && v > lim && f.push(`${name} ${v} > ${lim}`);
  over('floorPlus', o.floorPlus?.total, b.floorPlus);
  over('pushFace', o.pushFace?.total, b.pushFace);
  over('cutaway click', o.cutaway?.click, b.cutawayClick);
  over('cutaway back', o.cutaway?.back, b.cutawayBack);
  over('exploded click', o.exploded?.click, b.cutawayClick);
  over('click select', o.clickSelect?.total, b.clickSelect);
  over('draw calls', o.orbitAll?.drawCalls, b.drawCalls);
  over('reopen', o.reopen?.wallMs, b.reopenWall);
  if (o.errors?.length) f.push(`page errors: ${o.errors.join(' | ')}`);
  return f;
}

// FORMA performance on the player's machine: visible Chrome on the RTX 3060.
// Env: SERVER = before|after, SIZE = S|T20|T40|L, REPS (default 5).
// Same project, camera, window and quality on both servers.

const SERVER = 'app';
const SIZE = process.env.SIZE || 'S';
const REPS = Number(process.env.REPS || 5);
const tag = `perf-${SERVER}-${SIZE}`;
const log = logger(tag);
const out = { server: SERVER, size: SIZE, reps: REPS, at: new Date().toISOString() };
out.cpuBefore = cpuSnapshot(2);
log('cpu before', out.cpuBefore);
const { browser, page, errors } = await launch();
const URL = SERVERS[SERVER];

/** GPU timer + draw-call counter around every view render (installed once the editor exists). */
const instrument = () =>
  page.evaluate(() => {
    const ed = globalThis.forma3;
    const r = ed.view.renderer;
    const gl = r.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    r.info.autoReset = false;
    const look = ed.view.look;
    const orig = look.render.bind(look);
    window.__gpu = [];
    window.__calls = [];
    window.__cpuRender = [];
    const pending = [];
    look.render = (...a) => {
      r.info.reset();
      let q = null;
      if (ext && !pending.length) {
        q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      }
      const s = performance.now();
      orig(...a);
      window.__cpuRender.push(performance.now() - s);
      if (q) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
      }
      window.__calls.push({ calls: r.info.render.calls, tris: r.info.render.triangles });
      // Collect finished queries.
      while (pending.length) {
        const p = pending[0];
        if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (!disjoint) window.__gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p);
        pending.shift();
      }
    };
    return !!ext;
  });

/** Wall time from the action to the second frame after it (the user sees the result) + longest task. */
const timed = (src) =>
  page.evaluate(async (code) => {
    const fn = new Function('ed', `return (async () => { ${code} })()`);
    await window.__frames(1);
    const t0 = performance.now();
    await fn(globalThis.forma3);
    const t1 = performance.now();
    await window.__frames(2);
    return { sync: t1 - t0, total: performance.now() - t0 };
  }, src);

/** A view change drawn progressively: click response, time until everything is drawn, worst frame meanwhile. */
const timedIdle = (src) =>
  page.evaluate(async (code) => {
    const fn = new Function('ed', `return (async () => { ${code} })()`);
    await window.__frames(1);
    const t0 = performance.now();
    await fn(globalThis.forma3);
    const t1 = performance.now();
    await window.__frames(2);
    const resp = performance.now() - t0;
    let last = performance.now(), worst = 0;
    while (globalThis.forma3.view.busy !== undefined && globalThis.forma3.view.busy) {
      await window.__frames(1);
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
    }
    return { sync: t1 - t0, total: resp, done: performance.now() - t0, worstFrame: worst };
  }, src);

const repIdle = async (label, body, undo, n) => {
  const r = [], u = [];
  for (let i = 0; i < n; i++) {
    r.push(await timedIdle(body));
    u.push(await timedIdle(undo));
  }
  const m = (a, k) => med(a.map((x) => x[k]));
  out[label] = { click: m(r, 'total'), done: m(r, 'done'), worstFrame: m(r, 'worstFrame'), back: m(u, 'total'), backDone: m(u, 'done'), backWorstFrame: m(u, 'worstFrame') };
  log(label, out[label]);
};

const rep = async (label, body, undo = null, n = REPS) => {
  const tot = [], syn = [], und = [];
  for (let i = 0; i < n; i++) {
    const r = await timed(body);
    tot.push(r.total);
    syn.push(r.sync);
    if (undo) und.push((await timed(undo)).total);
  }
  out[label] = { total: med(tot), sync: med(syn), max: +Math.max(...tot).toFixed(1), ...(und.length ? { undo: med(und), undoMax: +Math.max(...und).toFixed(1) } : {}) };
  log(label, out[label]);
};

/** Orbits the camera for `ms` and reads frame intervals, render CPU, GPU, draw calls, triangles. */
const orbit = async (label, ms = 4000) => {
  const r = await page.evaluate(async (dur) => {
    const ed = globalThis.forma3;
    window.__gpu.length = 0;
    window.__calls.length = 0;
    window.__cpuRender.length = 0;
    const iv = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const f = (now) => {
        iv.push(now - last);
        last = now;
        ed.view.theta += 0.012;
        ed.view.updateCamera();
        if (now - t0 < dur) window.__rafOrig(f);
        else res();
      };
      window.__rafOrig(f);
    });
    await new Promise((res) => setTimeout(res, 200));
    const m = performance.memory;
    const info = ed.view.renderer.info.memory;
    return { iv: iv.slice(2), gpu: [...window.__gpu], cpu: [...window.__cpuRender], calls: window.__calls.at(-1), heapMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(1) : null, geometries: info.geometries, textures: info.textures };
  }, ms);
  const res = {
    frames: r.iv.length,
    frameMs: { med: med(r.iv), p95: pct(r.iv, 0.95), max: +Math.max(...r.iv).toFixed(1) },
    fps: +(1000 / med(r.iv)).toFixed(1),
    renderCpuMs: { med: med(r.cpu), p95: pct(r.cpu, 0.95) },
    gpuMs: { med: med(r.gpu), p95: pct(r.gpu, 0.95), n: r.gpu.length },
    drawCalls: r.calls?.calls,
    triangles: r.calls?.tris,
    heapMB: r.heapMB,
    geometries: r.geometries,
    textures: r.textures,
  };
  out[label] = res;
  log(label, res);
};

try {
  await openEditor(page, URL);
  out.gpu = await gpuInfo(page);
  log('gpu', out.gpu);
  // Build the scene from the samples (same code on both servers) and reopen through the autosave.
  const info = await page.evaluate((size) => {
    const ed = globalThis.forma3;
    const p = structuredClone(ed.project);
    const samples = p.buildings;
    const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const remap = (b) => { const ids = new Map(); return JSON.parse(JSON.stringify(b).replace(re, (m) => { if (!ids.has(m)) ids.set(m, crypto.randomUUID()); return ids.get(m); })); };
    let list = samples;
    if (size === 'L') {
      const n = 200, tiles = Math.ceil(n / samples.length), cols = Math.ceil(Math.sqrt(tiles));
      list = [];
      for (let t = 0; t < tiles && list.length < n; t++) {
        const ox = ((t % cols) - (cols - 1) / 2) * 110, oz = (Math.floor(t / cols) - (Math.ceil(tiles / cols) - 1) / 2) * 95;
        for (const s of samples) {
          if (list.length >= n) break;
          const b = t === 0 ? structuredClone(s) : remap(s);
          b.position = [s.position[0] + ox, s.position[1] + oz];
          if (t > 0) b.name = `${s.name} ${t + 1}`;
          list.push(b);
        }
      }
    }
    if (size === 'T40') {
      const b = remap(samples.find((x) => x.name === 'Courtyard block'));
      b.name = 'Tower 40'; b.position = [0, 0];
      const lv = []; let e = 0;
      for (let i = 0; i < 40; i++) { const h = i === 0 ? 4.5 : 3.1; lv.push({ id: crypto.randomUUID(), name: i === 0 ? 'Ground' : `Floor ${i}`, elevation: +e.toFixed(2), height: h }); e += h; }
      b.levels = lv; b.solids[0].height = +e.toFixed(2); b.solids[1].height = e + 2;
      list = [b];
    }
    if (size === 'T20') {
      // 30 × 30 m, 20 floors, casement windows (max 3 m) and glass balconies above the ground (max 6 m).
      const b = remap(samples.find((x) => x.name === 'Courtyard block'));
      b.name = 'Tower 30x30x20'; b.position = [0, 0];
      const s = b.solids[0];
      const lv = []; let e = 0;
      for (let i = 0; i < 20; i++) { const h = i === 0 ? 3.4 : 3; lv.push({ id: crypto.randomUUID(), name: i === 0 ? 'Ground' : `Floor ${i}`, elevation: +e.toFixed(2), height: h }); e += h; }
      b.levels = lv;
      const ids = s.plan.outer.map((v) => v.id);
      while (ids.length < 4) ids.push(crypto.randomUUID());
      s.plan = { outer: [[-15, -15], [15, -15], [15, 15], [-15, 15]].map((p, i) => ({ id: ids[i], p: [p[0], p[1]] })), holes: [] };
      s.edges = {}; s.base = 0; s.height = +e.toFixed(2); s.taper = 0;
      s.roof = { ...s.roof, kind: 'flat', parapet: 1 };
      const win = s.facade[0] ?? { id: crypto.randomUUID(), type: 'win-casement', levels: 'all', edges: [], mode: 'max', value: 3, margin: 0.6, sill: NaN, justify: 'center', except: {}, params: {} };
      s.facade = [{ ...win, id: crypto.randomUUID(), type: 'win-casement', levels: 'all', edges: [], mode: 'max', value: 3, except: {}, params: {} }, { ...win, id: crypto.randomUUID(), type: 'balcony-glass', levels: 'upper', edges: [], mode: 'max', value: 6, except: {}, params: {} }];
      b.solids = [s]; b.items = [];
      list = [b];
    }
    p.buildings = list;
    p.name = `Perf ${size}`;
    const json = JSON.stringify(p);
    localStorage.setItem('forma3_project', json);
    return { buildings: list.length, solids: list.reduce((a, b) => a + b.solids.length, 0), jsonKB: Math.round(json.length / 1024) };
  }, SIZE);
  out.project = info;
  log('project', info);
  // Reopen (navigation → editor ready, first evaluation).
  const opens = [], evals = [];
  for (let i = 0; i < (SIZE === 'L' ? 2 : 3); i++) {
    const t0 = Date.now();
    await page.reload();
    await page.waitForFunction(() => !!globalThis.forma3, null, { timeout: 300000 });
    await page.evaluate(() => window.__frames(2));
    opens.push(Date.now() - t0);
    evals.push(await page.evaluate(() => globalThis.forma3.view.lastEvalMs));
  }
  out.reopen = { wallMs: med(opens), firstEvalMs: med(evals) };
  log('reopen', out.reopen);
  out.timerQuery = await instrument();
  // Same camera on both servers: everything framed, fixed angles.
  await page.evaluate(() => { const ed = globalThis.forma3; ed.enter(null); ed.select({}); ed.view.theta = 0.75; ed.view.phi = 1.0; ed.view.frameAll(); });
  await settle(page, 1500);
  await shot(page, `${tag}-overview`, log);
  out.cpuDuring = cpuSnapshot(2);
  await orbit('orbitAll', 4000);
  log('cpu during idle', out.cpuDuring);
  // Close: the largest building framed.
  await page.evaluate(() => {
    const ed = globalThis.forma3;
    const big = [...ed.project.buildings].sort((a, b) => (ed.view.built.get(b.id)?.ev.shell.indices.length ?? 0) - (ed.view.built.get(a.id)?.ev.shell.indices.length ?? 0))[0];
    window.__b = big.id;
    ed.select({ building: big.id });
    ed.view.theta = 0.75; ed.view.phi = 1.15;
    ed.frameSelection();
  });
  await settle(page, 1000);
  await orbit('orbitClose', 3000);
  // Full evaluation of the project.
  await rep('fullEval', 'ed.store.touch(null); ed.sync();', null, SIZE === 'L' ? 2 : 3);
  // Real mouse click on the largest building (select).
  await page.evaluate(() => { const ed = globalThis.forma3; ed.enter(null); ed.select({}); });
  await settle(page, 300);
  const pt = await page.evaluate(() => {
    const ed = globalThis.forma3;
    const r = ed.view.renderer.domElement.getBoundingClientRect();
    for (let y = r.top + r.height * 0.3; y < r.bottom - 60; y += 7) for (let x = r.left + r.width * 0.3; x < r.right - r.width * 0.3; x += 7) { const h = ed.view.pick(ed.project, { clientX: x, clientY: y }); if (h && h.face && h.building.id === window.__b) return { x, y }; }
    return null;
  });
  if (pt) {
    const cl = [];
    for (let i = 0; i < REPS; i++) {
      await page.evaluate(() => { const ed = globalThis.forma3; ed.enter(null); ed.select({}); });
      await settle(page, 150);
      await page.evaluate(() => { window.__t0 = 0; if (!window.__clkInst) { window.__clkInst = 1; addEventListener('pointerdown', () => (window.__t0 = performance.now()), true); } });
      await page.mouse.click(pt.x, pt.y);
      cl.push(await page.evaluate(async () => { await window.__frames(2); return performance.now() - window.__t0; }));
    }
    out.clickSelect = { total: med(cl), max: +Math.max(...cl).toFixed(1) };
    log('clickSelect', out.clickSelect);
  }
  // Edits on the largest building, each undone with a real Ctrl+Z.
  await page.evaluate(() => { const ed = globalThis.forma3; ed.enter(null); ed.select({ building: window.__b }); });
  await rep('floorPlus', 'ed.floorsDelta(1);', "ed.command('undo');");
  await page.evaluate(() => { const ed = globalThis.forma3; const b = ed.store.building(window.__b); ed.enter(b.id); const s = b.solids.find((x) => x.op === 'add'); ed.select({ building: b.id, solids: [s.id], edges: [s.plan.outer[0].id] }); });
  await rep('pushFace', "ed.modelOp('edge-offset', { d: 1 });", "ed.command('undo');");
  await page.evaluate(() => { const ed = globalThis.forma3; ed.enter(null); ed.select({}); });
  // Interior view clicks (cutaway, exploded, back).
  await page.evaluate(() => document.querySelector('[aria-label="Interior view"]').click());
  await settle(page, 300);
  const nI = SIZE === 'L' ? 2 : 3;
  await repIdle('cutaway', "document.querySelector('.f3-interior [data-preset=\"cutaway\"]').click();", "document.querySelector('.f3-interior [data-preset=\"all\"]').click();", nI);
  await repIdle('exploded', "document.querySelector('.f3-interior [data-preset=\"explode\"]').click();", "document.querySelector('.f3-interior [data-preset=\"all\"]').click();", nI);
  out.cpuAfter = cpuSnapshot(2);
  log('cpu after', out.cpuAfter);
  out.errors = errors.filter((e) => !/GLTFExporter/.test(e)).slice(0, 10);
  log('errors', out.errors);
} catch (e) {
  log('PROBE ERROR', e.stack || String(e));
  out.probeError = String(e);
} finally {
  writeFileSync(`${LOGS}/${tag}.json`, JSON.stringify(out, null, 1));
  const fails = checkBudgets(out);
  console.log(fails.length ? `BUDGET FAILED: ${fails.join('; ')}` : 'budgets: ok');
  process.exitCode = fails.length ? 1 : 0;
  await browser.close();
}
