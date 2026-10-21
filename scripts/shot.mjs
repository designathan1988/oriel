// Pictures to look at, sharper than the browser pane gives them: the pane's screenshot reaches Claude at
// about 800 px wide and its zoom only crops that picture; an image file read with Read arrives at up to
// 2000 px on its long side. This captures a page of a server of this folder in headless Chromium, at a
// chosen size and pixel scale, the whole page, a clip or one element, and with --tiles cuts the picture
// into pieces of at most 2000 px, so that nothing is shrunk before it is seen.
//   npm run shot -- http://localhost:5797/editor.html [--size 1440x860] [--scale 2] [--full]
//        [--clip x,y,w,h] [--element "css selector"] [--tiles] [--project file.json] [--swiftshader]
//        [--out test-results/shots]
// The editor is waited for until View.settled (drawn, batched, compiled, textures in, rendered). The real
// GPU is used unless --swiftshader (the renderer of the visual check). Never the 5792 origin.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const LONG = 2000;
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const VALUED = new Set(['--size', '--scale', '--clip', '--element', '--project', '--out']);
const url = argv.find((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1]));
if (!url) {
  console.log('usage: npm run shot -- <url> [--size WxH] [--scale N] [--full] [--clip x,y,w,h] [--element css] [--tiles] [--project file.json] [--swiftshader] [--out dir]');
  process.exit(1);
}
if (new URL(url).port === '5792') {
  console.log('5792 holds the user projects: use the server of this conversation (see .claude/launch.json)');
  process.exit(1);
}
const [w, h] = opt('size', '1440x860').split('x').map(Number);
const scale = Number(opt('scale', '1'));
const out = opt('out', 'test-results/shots');
mkdirSync(out, { recursive: true });

const gpu = flag('swiftshader')
  ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
  : process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: gpu });
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (opt('project')) {
    const json = readFileSync(opt('project'), 'utf8');
    await page.addInitScript((j) => localStorage.setItem('forma3_project', j), json);
  }
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  const editor = await page.waitForFunction(() => !!globalThis.forma3, null, { timeout: 5_000 }).then(() => true, () => false);
  if (editor) await page.waitForFunction(() => globalThis.forma3.view.settled, null, { timeout: 30_000 });
  const renderer = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    const e = g?.getExtension('WEBGL_debug_renderer_info');
    return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'no WebGL renderer info';
  });

  // The region in CSS pixels: an element, a clip, the whole page or the window.
  let region;
  if (opt('element')) {
    const box = await page.locator(opt('element')).first().boundingBox({ timeout: 10_000 });
    if (!box) throw new Error(`element not shown: ${opt('element')}`);
    region = box;
  } else if (opt('clip')) {
    const [x, y, cw, ch] = opt('clip').split(',').map(Number);
    region = { x, y, width: cw, height: ch };
  } else if (flag('full')) {
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    region = { x: 0, y: 0, ...size };
  } else region = { x: 0, y: 0, width: w, height: h };

  const name = new Date().toISOString().replace(/[:.]/g, '-');
  const shots = [];
  const step = flag('tiles') ? Math.floor(LONG / scale) : Infinity;
  for (let y = region.y; y < region.y + region.height; y += step)
    for (let x = region.x; x < region.x + region.width; x += step) {
      const clip = { x, y, width: Math.min(step, region.x + region.width - x), height: Math.min(step, region.y + region.height - y) };
      const file = join(out, `${name}${step === Infinity ? '' : `-${shots.length + 1}`}.png`);
      await page.screenshot({ path: file, clip, fullPage: flag('full'), animations: 'disabled', scale: 'device' });
      shots.push({ file, px: `${Math.round(clip.width * scale)}x${Math.round(clip.height * scale)}`, css: clip });
    }
  console.log(`renderer: ${renderer}`);
  for (const s of shots) console.log(`${s.file}  ${s.px} px  (css ${s.css.x},${s.css.y} ${s.css.width}x${s.css.height})`);
  const big = shots.filter((s) => Math.max(...s.px.split('x').map(Number)) > LONG);
  if (big.length) console.log(`note: ${big.length} picture(s) over ${LONG} px are shrunk before Claude sees them; add --tiles`);
  if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`);
} finally {
  await browser.close();
}
