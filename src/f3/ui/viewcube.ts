// View cube (like the Autodesk ViewCube): 26 standard views — 6 faces, 12 edges and 8
// corners — a click turns the camera there around the current target, animated; Home
// goes back to the three-quarter view framing the whole project. The cube follows the
// camera every time it changes. CSS 3D in the DOM: no extra draw call in the scene.
import type { Editor3 } from '../editor/editor';
import { MAX_PHI } from '../editor/view';
import { icon } from './icons';

type V3 = [number, number, number];

/** Face: outward normal, the face's right and up as seen from outside, its CSS placement. */
const FACES: { name: string; n: V3; u: V3; v: V3; css: string }[] = [
  { name: 'Front', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], css: 'translateZ(var(--h))' },
  { name: 'Back', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], css: 'rotateY(180deg) translateZ(var(--h))' },
  { name: 'Right', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], css: 'rotateY(90deg) translateZ(var(--h))' },
  { name: 'Left', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], css: 'rotateY(-90deg) translateZ(var(--h))' },
  { name: 'Top', n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], css: 'rotateX(90deg) translateZ(var(--h))' },
  { name: 'Bottom', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], css: 'rotateX(-90deg) translateZ(var(--h))' },
];

/** Home: the three-quarter view the editor opens with. */
const HOME = { phi: 1, theta: 0.75 };
/** Straight down or up: the heading turned to the nearest quarter, so the plan axes stay square with the
 * screen (the cube's face views are defined by the Front view, Autodesk ViewCube) with the least spin. */
const square = (theta: number) => Math.round(theta / (Math.PI / 2)) * (Math.PI / 2);

/** Camera angles that look from direction `d` (world, toward the camera). */
export function anglesFor(d: V3): { phi: number; theta: number } {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const phi = Math.acos(Math.max(-1, Math.min(1, d[1] / l)));
  return { phi: Math.min(phi, MAX_PHI), theta: Math.atan2(d[0], d[2]) };
}

export function mountViewCube(ed: Editor3): void {
  const view = ed.view;
  const root = document.createElement('div');
  root.className = 'f3-cube';
  root.innerHTML = `<div class="f3-cube-top"><button class="f3-tb f3-cube-home" title="Home view: three-quarter, whole project">${icon('home')}</button><button class="f3-tb f3-cube-walk" title="Walk inside: first person (WASD, mouse, Esc leaves)">${icon('enter')}</button><button class="f3-tb f3-cube-par" title="Parallel view, without perspective (Numpad 5)" aria-pressed="false">∥</button></div><div class="f3-cube-stage"><div class="f3-cube-box">${FACES.map((f) => {
    const cells: string[] = [];
    for (const j of [1, 0, -1])
      for (const i of [-1, 0, 1]) {
        const d = [0, 1, 2].map((k) => f.n[k]! + i * f.u[k]! + j * f.v[k]!) as V3;
        const under = d[1] < 0;
        const kind = i === 0 && j === 0 ? 'face' : i !== 0 && j !== 0 ? 'corner' : 'edge';
        cells.push(`<span class="${kind}${under ? ' off' : ''}" data-dir="${d.join(',')}" title="${under ? 'Not available: the camera stays above the ground' : `${f.name}${kind === 'face' ? '' : ` (${kind})`}`}">${kind === 'face' ? f.name : ''}</span>`);
      }
    return `<div class="f3-cube-face" style="transform:${f.css}">${cells.join('')}</div>`;
  }).join('')}</div>${['up', 'down', 'left', 'right'].map((a) => `<button class="f3-cube-arrow" data-arrow="${a}" hidden aria-label="${a === 'up' ? 'Turn to the face above' : a === 'down' ? 'Turn to the face below' : a === 'left' ? 'Turn to the face on the left' : 'Turn to the face on the right'}"></button>`).join('')}</div>`;
  ed.shell.viewbar.prepend(root);
  const box = root.querySelector<HTMLElement>('.f3-cube-box')!;
  const arrows = [...root.querySelectorAll<HTMLButtonElement>('.f3-cube-arrow')];
  /** Camera right, up and toward-camera directions in the world (columns of its matrix). */
  const axes = () => {
    const m = view.camera.matrixWorld.elements;
    return { right: [m[0]!, m[1]!, m[2]!] as V3, up: [m[4]!, m[5]!, m[6]!] as V3, back: [m[8]!, m[9]!, m[10]!] as V3 };
  };
  /** The world axis nearest to a direction (the face it points at). */
  const snapAxis = (d: V3): V3 => {
    const k = [0, 1, 2].reduce((a, c) => (Math.abs(d[c]!) > Math.abs(d[a]!) ? c : a), 0);
    const out: V3 = [0, 0, 0];
    out[k] = Math.sign(d[k]!) || 1;
    return out;
  };
  // Looking straight at a face, four arrows turn to the neighbouring faces (Autodesk ViewCube: the
  // triangles shown around a face view); the one toward the ground is hidden (the camera stays above it).
  const syncArrows = () => {
    const { right, up, back } = axes();
    const face = snapAxis(back);
    const onFace = Math.abs(back[0] * face[0] + back[1] * face[1] + back[2] * face[2]) > 0.9995;
    for (const a of arrows) {
      const d = arrowDir(a.dataset.arrow!, right, up);
      a.hidden = !onFace || d[1] < -0.5;
      a.title = `Turn to the ${faceName(d)} view`;
    }
  };
  const arrowDir = (a: string, right: V3, up: V3): V3 => snapAxis(a === 'up' ? up : a === 'down' ? (up.map((x) => -x) as V3) : a === 'right' ? right : (right.map((x) => -x) as V3));
  const faceName = (d: V3) => FACES.find((f) => f.n.every((x, i) => x === d[i]))?.name.toLowerCase() ?? 'next';
  for (const a of arrows)
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      const { right, up } = axes();
      const d = arrowDir(a.dataset.arrow!, right, up);
      const t = anglesFor(d);
      view.animateTo(t.phi, d[0] === 0 && d[2] === 0 ? square(view.theta) : t.theta);
    });
  // CSS has y down: the cube shows the world rotated as the camera sees it (S·R·S, S = diag(1, −1, 1)).
  const sync = () => {
    const e = view.camera.matrixWorldInverse.elements;
    const r = (row: number, col: number) => e[col * 4 + row]! * (row === 1 ? -1 : 1) * (col === 1 ? -1 : 1);
    box.style.transform = `matrix3d(${r(0, 0)},${r(1, 0)},${r(2, 0)},0,${r(0, 1)},${r(1, 1)},${r(2, 1)},0,${r(0, 2)},${r(1, 2)},${r(2, 2)},0,0,0,0,1)`;
  };
  const par = root.querySelector<HTMLButtonElement>('.f3-cube-par')!;
  const syncPar = () => par.setAttribute('aria-pressed', String(view.parallel));
  view.cameraListeners.push(sync, syncArrows, syncPar);
  sync();
  syncArrows();
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.f3-cube-walk')) {
      ed.startWalk();
      return;
    }
    if (t.closest('.f3-cube-par')) {
      view.setParallel(!view.parallel);
      return;
    }
    if (t.closest('.f3-cube-home')) {
      view.animateTo(HOME.phi, HOME.theta, 380, () => view.frameAll());
      return;
    }
    const cell = t.closest<HTMLElement>('[data-dir]');
    if (!cell || cell.classList.contains('off')) return;
    const d = cell.dataset.dir!.split(',').map(Number) as V3;
    const a = anglesFor(d);
    // Straight top: the nearest square heading (little spin, axes square with the screen).
    view.animateTo(a.phi, d[0] === 0 && d[2] === 0 ? square(view.theta) : a.theta);
  });
}
