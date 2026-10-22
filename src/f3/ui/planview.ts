// Plan view (2D): the floor plan of one level of a building, drawn from the model (eval/floorplan.ts),
// over the 3D view. It follows every change made in 3D (and the other way: a room named here is named
// in the model). F2 opens it and F3 goes back to 3D, as in ArchiCAD
// (https://help.graphisoft.com/AC/25/INT/_AC25_Help/030_Interaction/030_Interaction-3.htm). The wheel
// zooms on the cursor, a drag pans; a click on a room selects it and lets it be named.
import type { Editor3 } from '../editor/editor';
import type { Building3, ID, Vec2 } from '../model/schema';
import { addInteriorWall, interiorDoors, type InteriorWithDoors } from '../eval/interiorwalls';
import { inside, toWorld } from '../model/ops';
import { sampleRing } from '../model/plan';
import { floorPlan, sortedLevels, type FloorPlan } from '../eval/floorplan';
import { checkFloor, type Check } from '../eval/compliance';
import { floorPlanSvg } from '../eval/floorplansvg';
import { siteContext } from '../eval/sitecontext';
import { icon } from './icons';
import { loadLang, tr } from './i18n';

const CSS = `
.f3-plan{position:absolute;inset:0;z-index:12;display:flex;flex-direction:column;background:#f4f2ec;color:#1e2024}
.f3-plan[hidden]{display:none}
.f3-plan .bar{display:flex;align-items:center;gap:6px;padding:8px 10px;white-space:nowrap;background:var(--panel-solid);border-bottom:1px solid var(--line);color:var(--ink);flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;min-height:49px}
.f3-plan .bar>*{flex-shrink:0}
.f3-plan .bar b{font-size:12.5px;font-weight:600;margin-right:6px}
.f3-plan .bar select{height:28px;background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:0 6px;max-width:180px}
.f3-plan .lv{display:flex;gap:2px;background:var(--field);border-radius:7px;padding:2px}
.f3-plan .lv button{height:24px;border:0;border-radius:5px;background:transparent;color:var(--muted);padding:0 10px;font-size:12px;cursor:pointer}
.f3-plan .lv button[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-plan .sp{flex:1}
.f3-plan .bar .f3-btn[aria-pressed=true]{background:var(--accent-2);color:var(--accent-ink)}
.f3-plan .checks{position:absolute;z-index:2;right:12px;top:56px;width:340px;max-height:calc(100% - 140px);overflow:auto;background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px #0004;font-size:12px}
.f3-plan .checks h4{margin:0 0 6px;font-size:12.5px}
.f3-plan .checks p{margin:0 0 8px;color:var(--muted);font-size:11px;line-height:1.4}
.f3-plan .checks li{list-style:none;display:flex;gap:8px;padding:4px 0;border-top:1px solid var(--line);line-height:1.35}
.f3-plan .checks ul{margin:0;padding:0}
.f3-plan .checks li b{flex:none;width:16px;text-align:center}
.f3-plan .checks li.no b{color:#e5534b}
.f3-plan .checks li.ok b{color:#3fb950}
.f3-plan .hint.fade{animation:f3-hint-out .5s 8s forwards}
@keyframes f3-hint-out{to{opacity:0;visibility:hidden}}
.f3-plan .hint{position:absolute;z-index:2;left:12px;bottom:12px;max-width:min(520px,calc(100% - 24px));background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:12px;pointer-events:none;box-shadow:0 6px 18px #0002}
.f3-plan .paper[data-mode=wall],.f3-plan .paper[data-mode=door]{cursor:crosshair}
.f3-plan .bar .f3-btn{height:28px;display:inline-flex;align-items:center;gap:6px}
.f3-plan .paper{flex:1;position:relative;overflow:hidden;cursor:grab;background-image:linear-gradient(#0000000a 1px,transparent 1px),linear-gradient(90deg,#0000000a 1px,transparent 1px);background-size:24px 24px}
.f3-plan .paper.drag{cursor:grabbing}
.f3-plan .paper svg{position:absolute;inset:0;width:100%;height:100%;fill:#000;stroke:none;stroke-width:1;stroke-linecap:butt;stroke-linejoin:miter;letter-spacing:0}
.f3-plan .paper .rm{cursor:pointer}
.f3-plan .paper svg text{pointer-events:none}
.f3-plan .empty{position:absolute;z-index:1;inset:0;display:grid;place-items:center;color:#6b6760;font-size:14px;text-align:center;padding:24px}
.f3-plan .card{position:absolute;z-index:3;right:12px;bottom:12px;background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px 12px;box-shadow:0 10px 30px #0004;display:flex;flex-direction:column;gap:6px;min-width:220px;font-size:12.5px}
.f3-plan .card input{height:28px;background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:0 8px;font:inherit}
.f3-plan .card small{color:var(--muted)}
.f3-viewbar .f3-tb.plan2d{font-weight:600;font-size:11px;letter-spacing:.02em}
`;

export interface PlanView {
  open(on?: boolean): void;
  readonly isOpen: boolean;
}

export function mountPlanView(ed: Editor3): PlanView {
  const doc = ed.shell.root.ownerDocument;
  if (!doc.getElementById('f3-plan-css')) {
    const st = doc.createElement('style');
    st.id = 'f3-plan-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const el = doc.createElement('div');
  el.className = 'f3-plan';
  el.hidden = true;
  el.innerHTML = `<div class="bar" role="toolbar" aria-label="Floor plan">
      <b>Floor plan</b>
      <select data-b aria-label="Building"></select>
      <div class="lv" data-lv role="group" aria-label="Floor"></div>
      <div class="lv" data-modes role="group" aria-label="Plan tools">
        <button data-mode="select" aria-pressed="true" title="Select · V">Select</button>
        <button data-mode="wall" aria-pressed="false" title="Wall · W">Wall</button>
        <button data-mode="door" aria-pressed="false" title="Door · D">Door</button>
      </div>
      <div class="popts" data-opts></div>
      <span class="sp"></span>
      <button class="f3-btn" data-check aria-pressed="false" title="Code check" aria-label="Code check">${icon('star')}</button>
      <button class="f3-btn" data-fit title="Fit" aria-label="Fit">${icon('focus')}</button>
      <button class="f3-btn" data-svg title="Download SVG" aria-label="Download SVG">${icon('export')}</button>
      <button class="f3-btn" data-3d title="3D view · F3" aria-label="3D view">${icon('cube')}</button>
    </div>
    <div class="paper"><div class="empty" hidden></div><div class="hint"></div><div class="checks" hidden></div></div>`;
  ed.shell.view.appendChild(el);
  const paper = el.querySelector<HTMLElement>('.paper')!;
  const empty = el.querySelector<HTMLElement>('.empty')!;
  const selB = el.querySelector<HTMLSelectElement>('[data-b]')!;
  const lvBox = el.querySelector<HTMLElement>('[data-lv]')!;
  let open = false;
  let bid: ID | null = null;
  let level = 0;
  let vb: [number, number, number, number] | null = null;
  let fitted: [number, number, number, number] | null = null;
  let fp: FloorPlan | null = null;
  let room: string | null = null;
  let card: HTMLElement | null = null;
  let svgText = '';
  let checking = false;
  let checks: Check[] = [];
  const decimal = loadLang() === 'pt-BR' ? ',' : '.';

  // Toggle in the View island of the 3D view.
  const btn = doc.createElement('button');
  btn.className = 'f3-tb plan2d';
  btn.title = 'Floor plan (2D) · F2';
  btn.innerHTML = `${icon('grid')}<span>2D</span>`;
  ed.shell.viewbar.prepend(btn);
  btn.addEventListener('click', () => setOpen(true));

  const building = (): Building3 | undefined => ed.store.building(bid) ?? undefined;

  const drawBar = () => {
    const bs = ed.project.buildings.filter((b) => !b.hidden && b.solids.some((s) => s.op === 'add'));
    selB.innerHTML = bs.map((b) => `<option value="${b.id}"${b.id === bid ? ' selected' : ''}></option>`).join('');
    // Names set as text: they are the user's and are never translated.
    [...selB.options].forEach((o, i) => (o.textContent = bs[i]!.name));
    selB.setAttribute('data-i18n-skip', '');
    const b = building();
    const lvs = b ? sortedLevels(b) : [];
    lvBox.innerHTML = lvs.map((l, i) => `<button data-i="${i}" aria-pressed="${i === level}">${esc(tr(l.name))}</button>`).join('');
  };

  const render = () => {
    if (!open) return;
    const b = building();
    paper.querySelector('svg')?.remove();
    if (!b) {
      // A blank sheet (a 1 m grid): walls drawn on it make the first building.
      empty.hidden = true;
      fp = null;
      vb ??= [-15, -10, 30, 20];
      fitted = [-15, -10, 30, 20];
      const lines: string[] = [];
      for (let x = -100; x <= 100; x++) lines.push(`M${x},-100V100`);
      for (let z = -100; z <= 100; z++) lines.push(`M-100,${z}H100`);
      paper.insertAdjacentHTML('beforeend', `<svg xmlns="http://www.w3.org/2000/svg" data-i18n-skip preserveAspectRatio="xMidYMid meet"><rect x="-100" y="-100" width="200" height="200" fill="#f4f2ec"/><path d="${lines.join('')}" stroke="#d9d4c8" stroke-width="0.02"/><path d="M-100,0H100M0,-100V100" stroke="#c4bdae" stroke-width="0.04"/></svg>`);
      applyVb();
      preview();
      return;
    }
    const ev = ed.view.built.get(b.id)?.ev;
    try {
      fp = floorPlan(b, level, ev?.placements ?? []);
    } catch (e) {
      empty.hidden = false;
      empty.textContent = `${tr('This floor could not be drawn')}: ${(e as Error).message}`;
      return;
    }
    if (!fp.walls.length) {
      empty.hidden = false;
      empty.textContent = tr('Nothing is cut on this floor (no wall at 1.2 m above it).');
      return;
    }
    empty.hidden = true;
    const lv = sortedLevels(b)[level];
    const title = `${tr('Floor plan')} · ${tr(lv?.name ?? '')} · ${b.name}`;
    const out = floorPlanSvg(fp, { title, decimal, interactive: true, selectedRoom: room, t: tr, site: siteContext(ed.project, b, level === 0) });
    svgText = out.svg;
    // A different drawing (another building, floor or a new size) is fitted again; an edit keeps the view.
    if (!fitted || fitted.join() !== out.viewBox.join() || !vb) {
      if (!vb || !fitted || Math.abs(fitted[2] - out.viewBox[2]) > 0.5 || Math.abs(fitted[3] - out.viewBox[3]) > 0.5) vb = [...out.viewBox];
      fitted = out.viewBox;
    }
    paper.insertAdjacentHTML('beforeend', out.svg);
    const svg = paper.querySelector('svg')!;
    svg.setAttribute('data-i18n-skip', '');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    applyVb();
    drawChecks(b);
    preview();
  };

  /** Code check: the rooms that fail outlined in red, and the list of every check of the floor. */
  const drawChecks = (b: Building3) => {
    const box = el.querySelector<HTMLElement>('.checks')!;
    box.hidden = !checking;
    el.querySelector<HTMLElement>('.hint')!.hidden = checking;
    if (!checking || !fp) return;
    checks = checkFloor(b, fp).sort((x, y) => Number(x.ok) - Number(y.ok));
    const svg = paper.querySelector('svg');
    const bad = new Set(checks.filter((c) => !c.ok).map((c) => c.room));
    if (svg)
      for (const r of bad) {
        const pth = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        pth.setAttribute('d', r.rings.map((q) => `M${q.map((p) => `${p[0]},${p[1]}`).join('L')}Z`).join(''));
        pth.setAttribute('fill', 'rgba(229,83,75,.10)');
        pth.setAttribute('stroke', '#e5534b');
        pth.setAttribute('stroke-width', '0.06');
        pth.setAttribute('stroke-dasharray', '0.2 0.1');
        pth.setAttribute('pointer-events', 'none');
        svg.appendChild(pth);
      }
    const n = (v: number) => v.toFixed(2).replace('.', decimal);
    const line = (c: Check) => {
      const what =
        c.rule === 'height'
          ? `${tr('Ceiling height')}: ${n(c.have)} m (${tr('least')} ${n(c.need)} m)`
          : c.rule === 'window'
            ? `${tr('No window: a long-stay room needs')} ${n(c.need)} m² ${tr('of window')}`
            : `${tr('Window for light')}: ${n(c.have)} m² (${tr('least')} ${n(c.need)} m²)`;
      return `<li class="${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'}</b><span><strong></strong> · ${esc(what)}</span></li>`;
    };
    const unnamed = fp.rooms.filter((r) => !r.name).length;
    const fails = checks.filter((c) => !c.ok).length;
    box.innerHTML = `<h4 title="${esc(tr('Reference: window area 1/6 of the floor in bedrooms and living rooms, 1/8 in kitchens and laundries, 1/12 in bathrooms (municipal code of Porto Velho, LC 471/2012); ceiling height 2.50 m, 2.30 m in bathrooms and halls (NBR 15575). Check the code of your city.'))}">${esc(tr('Code check'))}: ${fails ? `${fails} ${esc(tr('to fix'))}` : esc(tr('all right'))}</h4><ul>${checks.map(line).join('')}</ul>${unnamed ? `<p style="margin-top:8px">${unnamed} ${esc(tr('room(s) without a name are not checked: name them (Quarto, Sala, Cozinha…) to check them.'))}</p>` : ''}`;
    // Room names are the user's: set as text.
    box.querySelectorAll('li strong').forEach((s2, i) => (s2.textContent = checks[i]!.room.name));
    box.setAttribute('data-i18n-skip', '');
  };

  const applyVb = () => {
    const svg = paper.querySelector('svg');
    if (svg && vb) svg.setAttribute('viewBox', vb.map((v) => Math.round(v * 1000) / 1000).join(' '));
  };

  let pending = 0;
  const later = () => {
    if (!open || pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      render();
    });
  };
  ed.store.on(() => {
    if (!open) return;
    if (!building()) bid = pickBuilding();
    drawBar();
    later();
  });
  // The facade openings come from the evaluation, which can end after the edit: redraw when it lands.
  let lastEv: unknown = null;
  const watch = () => {
    if (!open) return;
    const ev = bid ? ed.view.built.get(bid)?.ev : null;
    if (ev !== lastEv) {
      lastEv = ev;
      render();
    }
    setTimeout(watch, 400);
  };

  const pickBuilding = (): ID | null => {
    const b = ed.activeBuilding() ?? ed.project.buildings.find((x) => !x.hidden && x.solids.some((s) => s.op === 'add'));
    return b?.id ?? null;
  };

  function setOpen(on: boolean) {
    if (on === open) return;
    open = on;
    el.hidden = !on;
    if (!on) {
      el.dataset.mode = '';
      ed.emit();
    }
    closeCard();
    if (on) {
      bid = pickBuilding();
      const b = building();
      level = Math.min(Math.max(0, ed.project.view?.cutLevel ?? 0), Math.max(0, (b?.levels.length ?? 1) - 1));
      vb = null;
      fitted = null;
      lastEv = null;
      drawBar();
      setMode('select');
      render();
      setTimeout(watch, 400);
    }
  }

  selB.addEventListener('change', () => {
    bid = selB.value;
    level = 0;
    vb = null;
    room = null;
    closeCard();
    drawBar();
    render();
  });
  lvBox.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-i]');
    if (!b) return;
    level = Number(b.dataset.i);
    room = null;
    closeCard();
    drawBar();
    render();
  });
  el.querySelector('[data-fit]')!.addEventListener('click', () => {
    vb = fitted ? [...fitted] : null;
    applyVb();
  });
  el.querySelector('[data-3d]')!.addEventListener('click', () => setOpen(false));
  el.querySelector('[data-check]')!.addEventListener('click', (e) => {
    checking = !checking;
    (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(checking));
    render();
  });
  el.querySelector('[data-svg]')!.addEventListener('click', () => {
    if (!svgText) return;
    const b = building();
    const a = doc.createElement('a');
    a.href = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    a.download = `${(b?.name ?? 'plan').replace(/[^\w\-]+/g, '_')}-${level}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Pan and zoom on the drawing (the viewBox moves; the drawing is never redrawn for it).
  const toModel = (cx: number, cy: number): [number, number] | null => {
    const svg = paper.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  paper.addEventListener(
    'wheel',
    (e) => {
      if (!vb) return;
      e.preventDefault();
      const at = toModel(e.clientX, e.clientY);
      if (!at) return;
      const k = Math.exp(e.deltaY * 0.0015);
      const w = Math.min(2000, Math.max(1, vb[2] * k)),
        h = (vb[3] * w) / vb[2];
      vb = [at[0] - ((at[0] - vb[0]) * w) / vb[2], at[1] - ((at[1] - vb[1]) * h) / vb[3], w, h];
      applyVb();
    },
    { passive: false },
  );
  // ── Drawing on the plan: interior walls (click, click… Enter or Esc ends) and doors (click a wall).
  let mode: 'select' | 'wall' | 'door' = 'select';
  let from: Vec2 | null = null;
  let hover: Vec2 | null = null;
  let wallSel: ID | null = null;
  /** A chain of walls started outside every building (plan points): closed, it becomes a building. */
  let loop: Vec2[] | null = null;
  /** A length being typed for the next wall (Revit, ArchiCAD tracker): Enter places it. */
  let typed = '';
  const T = () => ed.iwallThickness || 0.12;
  /** Inside the outline of the building drawn (its plan frame). */
  const insideBuilding = (p: Vec2): boolean => {
    const b = building();
    return !!b && b.solids.some((s) => s.op === 'add' && !s.hidden && inside(p, sampleRing(s.plan.outer).pts));
  };
  const finishLoop = (closed: boolean) => {
    const pts = loop;
    loop = null;
    from = null;
    typed = '';
    if (!pts || pts.length < (closed ? 3 : 2)) return preview();
    const b = building();
    ed.wallsFromPlan(pts.map((p) => (b ? toWorld(b, p) : p)), closed);
    bid = pickBuilding();
    vb = null;
    fitted = null;
    drawBar();
    render();
    hint();
  };
  /** A point clicked (or reached by a typed length) while drawing walls. */
  const wallPoint = (p: Vec2) => {
    if (loop) {
      const f = loop[0]!;
      if (loop.length >= 3 && Math.hypot(p[0] - f[0], p[1] - f[1]) < Math.max(0.05, 10 * mpp())) return finishLoop(true);
      loop.push(p);
    } else if (!from && !insideBuilding(p)) loop = [p];
    else if (from) addWall(from, p);
    from = p;
    hover = p;
    typed = '';
    hint();
    preview();
  };
  /** Metres per screen pixel of the drawing. */
  const mpp = (): number => {
    const svg = paper.querySelector('svg');
    if (!svg || !vb) return 0.02;
    const r = svg.getBoundingClientRect();
    return Math.max(vb[2] / r.width, vb[3] / r.height);
  };
  const levelId = (): ID | null => {
    const b = building();
    return b ? (sortedLevels(b)[level]?.id ?? null) : null;
  };
  const interior = () => {
    const b = building(),
      id = levelId();
    return b && id ? b.interiors[id] : undefined;
  };
  /** Interior walls of the floor as segments. */
  const segs = () => {
    const it = interior();
    if (!it) return [];
    const node = new Map(it.nodes.map((n) => [n.id, n.p]));
    return it.walls.flatMap((w) => {
      const a = node.get(w.a),
        c = node.get(w.b);
      return a && c ? [{ id: w.id, a, c, t: w.thickness }] : [];
    });
  };
  const near = (p: Vec2, a: Vec2, c: Vec2): { q: Vec2; d: number; u: number } => {
    const dx = c[0] - a[0],
      dz = c[1] - a[1];
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2));
    const q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
    return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]), u: t * Math.sqrt(L2) };
  };
  /**
   * Where a click lands: on a wall corner or an interior wall end; else locked to the axes from the
   * previous point (within 15°) and stopped on the face of a wall it reaches; else on a 5 cm grid.
   */
  const snap = (raw: Vec2): Vec2 => {
    const tol = 10 * mpp();
    const pts: Vec2[] = [...(fp?.walls.flat() ?? []), ...(interior()?.nodes.map((n) => n.p) ?? [])];
    let best: Vec2 | null = null,
      bd = tol;
    for (const q of pts) {
      const d = Math.hypot(q[0] - raw[0], q[1] - raw[1]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) return [best[0], best[1]];
    let p: Vec2 = raw;
    let axis: 'x' | 'z' | null = null;
    if (from) {
      const ang = (Math.atan2(raw[1] - from[1], raw[0] - from[0]) * 180) / Math.PI;
      const m = ((ang % 90) + 90) % 90;
      if (m < 15 || m > 75) {
        axis = Math.abs(Math.cos((ang * Math.PI) / 180)) > 0.5 ? 'x' : 'z';
        p = axis === 'x' ? [raw[0], from[1]] : [from[0], raw[1]];
      }
    }
    // The face of a wall within reach.
    const edges: [Vec2, Vec2][] = [];
    for (const r of fp?.walls ?? []) for (let i = 0; i < r.length; i++) edges.push([r[i]!, r[(i + 1) % r.length]!]);
    let eb: { q: Vec2; d: number } | null = null;
    for (const [a, c] of edges) {
      const n = near(p, a, c);
      if (n.d < tol && (!eb || n.d < eb.d)) {
        if (axis) {
          // Along the axis: where the axis line meets that face.
          const dx = c[0] - a[0],
            dz = c[1] - a[1];
          if (axis === 'x' && Math.abs(dx) < 1e-6 && Math.abs(dz) > 1e-6) eb = { q: [a[0], p[1]], d: n.d };
          else if (axis === 'z' && Math.abs(dz) < 1e-6 && Math.abs(dx) > 1e-6) eb = { q: [p[0], a[1]], d: n.d };
          else if (axis === 'x' && Math.abs(dx) > 1e-6) continue;
          else if (axis === 'z' && Math.abs(dz) > 1e-6) continue;
          else eb = { q: n.q, d: n.d };
        } else eb = n;
      }
    }
    if (eb) return eb.q;
    const g = 0.05;
    if (from && axis) {
      const L = Math.round((axis === 'x' ? p[0] - from[0] : p[1] - from[1]) / g) * g;
      return axis === 'x' ? [from[0] + L, from[1]] : [from[0], from[1] + L];
    }
    return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  };
  const wallAt = (p: Vec2) => {
    const tol = 8 * mpp();
    let best: { id: ID; d: number; u: number; len: number; side: 1 | -1 } | null = null;
    for (const w of segs()) {
      const n = near(p, w.a, w.c);
      const side = (w.c[0] - w.a[0]) * (p[1] - w.a[1]) - (w.c[1] - w.a[1]) * (p[0] - w.a[0]) >= 0 ? 1 : -1;
      if (n.d < w.t / 2 + tol && (!best || n.d < best.d)) best = { id: w.id, d: n.d, u: n.u, len: Math.hypot(w.c[0] - w.a[0], w.c[1] - w.a[1]), side };
    }
    return best;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  /** The preview over the drawing: the wall being drawn with its length, the door to be placed, the selected wall. */
  const preview = () => {
    const svg = paper.querySelector('svg');
    if (!svg) return;
    svg.querySelector('.pv')?.remove();
    const g = doc.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'pv');
    const k = mpp();
    let html = '';
    const line = (a: Vec2, c: Vec2, w: number, color: string, op = 1) => `<path d="M${a[0]},${a[1]}L${c[0]},${c[1]}" stroke="${color}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="square"/>`;
    if (wallSel) {
      const w = segs().find((x) => x.id === wallSel);
      if (w) html += line(w.a, w.c, w.t + 4 * k, '#d97757', 0.55);
    }
    if (mode === 'wall' && hover) {
      html += `<circle cx="${hover[0]}" cy="${hover[1]}" r="${4 * k}" fill="#d97757"/>`;
      // The walls of a new building drawn so far, as thick as they will be.
      if (loop) for (let i = 1; i < loop.length; i++) html += line(loop[i - 1]!, loop[i]!, ed.wallThickness, '#b2502a', 0.8);
      if (from) {
        html += line(from, hover, loop ? ed.wallThickness : T(), '#d97757', 0.7);
        const L = typed ? (parseFloat(typed.replace(',', '.')) || 0) : Math.hypot(hover[0] - from[0], hover[1] - from[1]);
        const mx = (from[0] + hover[0]) / 2,
          my = (from[1] + hover[1]) / 2;
        html += `<text x="${mx + 8 * k}" y="${my - 8 * k}" font-size="${13 * k}" font-weight="600" fill="#b2502a">${L.toFixed(2).replace('.', decimal)} m</text>`;
      }
    }
    if (mode === 'door' && hover) {
      const w = wallAt(hover);
      const s = w && segs().find((x) => x.id === w.id);
      if (w && s) {
        const ux = (s.c[0] - s.a[0]) / w.len,
          uz = (s.c[1] - s.a[1]) / w.len;
        const u = Math.max(0.4, Math.min(w.len - 0.4, w.u));
        const a: Vec2 = [s.a[0] + ux * (u - 0.4), s.a[1] + uz * (u - 0.4)],
          c: Vec2 = [s.a[0] + ux * (u + 0.4), s.a[1] + uz * (u + 0.4)];
        html += line(a, c, s.t + 6 * k, '#d97757', 0.7);
        // The leaf and its swing on the side the door will open to.
        const nx = -uz * w.side,
          nz = ux * w.side;
        const h: Vec2 = [a[0] + (nx * s.t) / 2, a[1] + (nz * s.t) / 2],
          j: Vec2 = [c[0] + (nx * s.t) / 2, c[1] + (nz * s.t) / 2],
          lf: Vec2 = [h[0] + nx * 0.8, h[1] + nz * 0.8];
        const sweep = (j[0] - h[0]) * (lf[1] - h[1]) - (j[1] - h[1]) * (lf[0] - h[0]) > 0 ? 0 : 1;
        html += line(h, lf, 2 * k, '#d97757');
        html += `<path d="M${lf[0]},${lf[1]}A0.8 0.8 0 0 ${sweep} ${j[0]},${j[1]}" fill="none" stroke="#d97757" stroke-width="${1.5 * k}" stroke-dasharray="${4 * k} ${3 * k}"/>`;
      }
    }
    g.innerHTML = html;
    svg.appendChild(g);
  };

  const setMode = (m: typeof mode) => {
    mode = m;
    from = null;
    el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    paper.dataset.mode = m;
    // The tool options (ui/options.ts) come into this bar for the plan's Wall mode.
    el.dataset.mode = m;
    hint();
    preview();
    ed.emit();
  };
  const hintEl = el.querySelector<HTMLElement>('.hint')!;
  const hint = () => {
    hintEl.textContent =
      mode === 'wall'
        ? tr(from ? 'Click point to point · type the length · click the first point to close' : 'Click the start of the wall')
        : mode === 'door'
          ? tr('Click a wall to put a door')
          : tr('Click: select · drag: pan · wheel: zoom');
    // The selection hint gives way to the drawing after a while; the drawing ones stay while drawing.
    hintEl.classList.remove('fade');
    void hintEl.offsetWidth;
    hintEl.classList.toggle('fade', mode === 'select');
  };
  el.querySelector('[data-modes]')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
    if (b) setMode(b.dataset.mode as typeof mode);
  });

  const addWall = (a: Vec2, c: Vec2) => {
    const b = building(),
      id = levelId();
    if (!b || !id || Math.hypot(c[0] - a[0], c[1] - a[1]) < 0.05) return;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    ed.change(b.id, (x) => void addInteriorWall(x, id, a, c, T(), newId), `${tr('Interior wall')} ${L.toFixed(2).replace('.', decimal)} m`);
  };
  const addDoor = (p: Vec2) => {
    const b = building(),
      id = levelId();
    const w = wallAt(p);
    if (b && id && !w) {
      // An outside wall: the standard door on that side of the volume, on the floor of this level.
      const lv = sortedLevels(b)[level];
      let best: { sid: ID; edge: ID; u: number; d: number; base: number } | null = null;
      for (const s of b.solids) {
        if (s.op !== 'add' || s.hidden || !lv || s.base > lv.elevation + 0.1 || s.base + s.height < lv.elevation + 2) continue;
        const ring = s.plan.outer;
        for (let i = 0; i < ring.length; i++) {
          const n = near(p, ring[i]!.p, ring[(i + 1) % ring.length]!.p);
          if (n.d < Math.max(0.45, 12 * mpp()) && (!best || n.d < best.d)) best = { sid: s.id, edge: ring[i]!.id, u: n.u, d: n.d, base: s.base };
        }
      }
      if (!best) return ed.toast(tr('Click a wall to put a door'));
      const pick = best;
      const y = Math.max(0, (lv?.elevation ?? 0) - pick.base);
      return void ed.change(b.id, (x) => void x.items.push({ id: newId(), type: 'door-panel', params: {}, host: { kind: 'face', solid: pick.sid, edge: pick.edge, u: Math.round(pick.u * 100) / 100, y } }), tr('Door added.'));
    }
    if (!b || !id || !w) return ed.toast(tr('Click on an interior wall to put a door in it.'));
    if (w.len < 0.9) return ed.toast(tr('This wall is too short for a door.'));
    const u = Math.max(0.4, Math.min(w.len - 0.4, w.u));
    ed.change(b.id, (x) => {
      const it = x.interiors[id] as InteriorWithDoors;
      it.doors = [...interiorDoors(it), { wall: w.id, u, width: 0.8, height: 2.1, swing: w.side }];
    }, tr('Door added to the interior wall.'));
  };
  const removeWall = (wid: ID) => {
    const b = building(),
      id = levelId();
    if (!b || !id) return;
    ed.change(b.id, (x) => {
      const it = x.interiors[id] as InteriorWithDoors | undefined;
      if (!it) return false;
      it.walls = it.walls.filter((w) => w.id !== wid);
      if (it.doors) it.doors = it.doors.filter((d) => d.wall !== wid);
      const used = new Set(it.walls.flatMap((w) => [w.a, w.b]));
      it.nodes = it.nodes.filter((n) => used.has(n.id));
    }, tr('Interior wall removed.'));
    wallSel = null;
  };

  let drag: { x: number; y: number; vb: [number, number, number, number]; moved: boolean; target: Element | null; wall?: { id: ID; at: Vec2; off: number } } | null = null;
  /** The selected interior wall and its room shown in the properties panel (the 3D panel, one place). */
  const tellSelection = () => {
    const b = building(),
      lv = levelId();
    ed.iwallSel = b && lv && wallSel ? { level: lv, wall: wallSel } : null;
    if (b && (wallSel || room)) ed.context = b.id;
    ed.emit();
  };
  paper.addEventListener('pointerdown', (e) => {
    if (!vb || e.button > 1 || (e.target as Element).closest('.card')) return;
    // The target is kept now: under pointer capture, the release targets the paper.
    drag = { x: e.clientX, y: e.clientY, vb: [...vb], moved: false, target: e.target as Element };
    // A press on the selected wall drags it (its corners take the connected walls along).
    const at = mode === 'select' && wallSel ? toModel(e.clientX, e.clientY) : null;
    if (at && wallAt(at)?.id === wallSel) drag.wall = { id: wallSel, at, off: 0 };
    paper.setPointerCapture(e.pointerId);
  });
  paper.addEventListener('pointermove', (e) => {
    if (!drag) {
      if (mode !== 'select') {
        const at = toModel(e.clientX, e.clientY);
        hover = at ? (mode === 'wall' ? snap(at) : at) : null;
        preview();
      }
      return;
    }
    if (!vb) return;
    const svg = paper.querySelector('svg');
    if (!svg) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    if (drag.wall) {
      // Across the wall only (Revit, ArchiCAD: a wall dragged keeps its direction), on a 5 cm step.
      const at = toModel(e.clientX, e.clientY);
      const w = segs().find((x) => x.id === drag!.wall!.id);
      if (!at || !w) return;
      const L = Math.hypot(w.c[0] - w.a[0], w.c[1] - w.a[1]) || 1;
      const n: Vec2 = [-(w.c[1] - w.a[1]) / L, (w.c[0] - w.a[0]) / L];
      const off = Math.round((((at[0] - drag.wall.at[0]) * n[0] + (at[1] - drag.wall.at[1]) * n[1]) / 0.05)) * 0.05;
      drag.wall.off = off;
      preview();
      const svg2 = paper.querySelector('svg');
      const g = svg2?.querySelector('.pv');
      if (g) g.insertAdjacentHTML('beforeend', `<path d="M${w.a[0] + n[0] * off},${w.a[1] + n[1] * off}L${w.c[0] + n[0] * off},${w.c[1] + n[1] * off}" stroke="#d97757" stroke-width="${w.t}" stroke-opacity="0.6"/><text x="${(w.a[0] + w.c[0]) / 2 + n[0] * off}" y="${(w.a[1] + w.c[1]) / 2 + n[1] * off - 0.3}" font-size="${13 * mpp()}" fill="#b2502a">${Math.abs(off).toFixed(2).replace('.', decimal)} m</text>`);
      return;
    }
    paper.classList.add('drag');
    // Metres per pixel of the fitted drawing (meet: the larger ratio).
    const r = svg.getBoundingClientRect();
    const k = Math.max(drag.vb[2] / r.width, drag.vb[3] / r.height);
    vb = [drag.vb[0] - dx * k, drag.vb[1] - dy * k, drag.vb[2], drag.vb[3]];
    applyVb();
  });
  paper.addEventListener('pointerup', (e) => {
    const d = drag;
    drag = null;
    paper.classList.remove('drag');
    if (d?.wall && d.moved && Math.abs(d.wall.off) > 1e-6) {
      const b = building(),
        lv = levelId();
      const wid = d.wall.id,
        off = d.wall.off;
      if (b && lv)
        ed.change(b.id, (x) => {
          const it = x.interiors[lv];
          const w = it?.walls.find((q) => q.id === wid);
          if (!it || !w) return false;
          const A = it.nodes.find((q) => q.id === w.a),
            C = it.nodes.find((q) => q.id === w.b);
          if (!A || !C) return false;
          const L = Math.hypot(C.p[0] - A.p[0], C.p[1] - A.p[1]) || 1;
          const n: Vec2 = [-(C.p[1] - A.p[1]) / L, (C.p[0] - A.p[0]) / L];
          for (const q of [A, C]) q.p = [Math.round((q.p[0] + n[0] * off) * 1e4) / 1e4, Math.round((q.p[1] + n[1] * off) * 1e4) / 1e4];
        }, `${tr('Wall moved')} ${Math.abs(off).toFixed(2).replace('.', decimal)} m`);
      return;
    }
    if (!d || d.moved) return;
    const at = toModel(e.clientX, e.clientY);
    if (!at) return;
    if (mode === 'wall') return wallPoint(snap(at));
    if (mode === 'door') return addDoor(at);
    const w = wallAt(at);
    if (w) {
      wallSel = w.id;
      room = null;
      closeCard();
      tellSelection();
      return render();
    }
    wallSel = null;
    tellSelection();
    const t = d.target?.closest?.('.rm') as SVGElement | null;
    if (!t) {
      room = null;
      closeCard();
      return render();
    }
    pickRoom(Number(t.getAttribute('data-i')));
  });
  paper.addEventListener('dblclick', () => {
    if (mode === 'wall') {
      from = null;
      hint();
      preview();
    }
  });

  const closeCard = () => {
    card?.remove();
    card = null;
  };

  /** A room clicked: the card with its name (typed here, saved in the model) and its area. */
  const pickRoom = (i: number) => {
    const r = fp?.rooms[i];
    const b = building();
    const lv = b ? sortedLevels(b)[level] : undefined;
    if (!r || !b || !lv) return;
    room = r.id;
    closeCard();
    card = doc.createElement('div');
    card.className = 'card';
    card.innerHTML = `<b>${r.id ? esc(tr('Room')) : esc(tr('Unnamed room'))}</b><input data-name aria-label="Room name" placeholder="Name (e.g. Kitchen)"><small>${esc(tr('Area'))}: ${r.area.toFixed(2).replace('.', decimal)} m² · ${esc(tr('Enter saves'))}</small>`;
    paper.appendChild(card);
    const inp = card.querySelector<HTMLInputElement>('[data-name]')!;
    inp.value = r.name;
    inp.focus();
    inp.select();
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') return closeCard();
      if (e.key !== 'Enter') return;
      const name = inp.value.trim().slice(0, 60);
      if (!name) return;
      const ring = r.rings[0]!;
      ed.change(
        b.id,
        (x) => {
          const it = (x.interiors[lv.id] ??= { nodes: [], walls: [], rooms: [] });
          const ex = r.id ? it.rooms.find((q) => q.id === r.id) : undefined;
          if (ex) ex.name = name;
          else {
            const id = `room-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            it.rooms.push({ id, name, wallIds: [], polygon: ring.map((p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]), area: Math.round(r.area * 100) / 100 });
            room = id;
          }
        },
        `${tr('Room')} “${name}”.`,
      );
      closeCard();
    });
    render();
  };

  // F2: plan, F3: 3D (ArchiCAD). While the plan is open its keys stay in it (the 3D tools do not
  // switch underneath): V select, W wall, D door, Enter / Esc end a wall, Delete removes the wall.
  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
      if (e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        return setOpen(true);
      }
      if (!open || e.ctrlKey || e.metaKey) return;
      e.stopPropagation();
      // A length typed while drawing a wall: the next point goes that far towards the cursor.
      if (mode === 'wall' && from && /^[0-9.,]$/.test(e.key)) {
        typed += e.key;
        return preview();
      }
      if (mode === 'wall' && typed && e.key === 'Backspace') {
        typed = typed.slice(0, -1);
        return preview();
      }
      if (mode === 'wall' && from && typed && e.key === 'Enter') {
        const len = parseFloat(typed.replace(',', '.'));
        typed = '';
        if (!(len > 0)) return preview();
        const h = hover ?? [from[0] + 1, from[1]];
        const d = Math.hypot(h[0] - from[0], h[1] - from[1]) || 1;
        const dx = d > 1e-6 ? (h[0] - from[0]) / d : 1,
          dz = d > 1e-6 ? (h[1] - from[1]) / d : 0;
        const r = (v: number) => Math.round(v * 1e4) / 1e4;
        return wallPoint([r(from[0] + dx * len), r(from[1] + dz * len)]);
      }
      if (mode === 'wall' && loop && (e.key === 'Enter' || e.key === 'Escape')) {
        if (e.key === 'Enter') return finishLoop(false);
        loop = null;
        from = null;
        typed = '';
        hint();
        return preview();
      }
      const k = e.key.toLowerCase();
      if (e.key === 'F3') {
        e.preventDefault();
        setOpen(false);
      } else if (k === 'v') setMode('select');
      else if (k === 'w') setMode('wall');
      else if (k === 'd') setMode('door');
      else if (e.key === 'Enter' || e.key === 'Escape') {
        if (mode === 'wall' && from) {
          from = null;
          hint();
          preview();
        } else if (e.key === 'Escape') {
          if (mode !== 'select') setMode('select');
          else if (wallSel) {
            wallSel = null;
            render();
          } else setOpen(false);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && wallSel) removeWall(wallSel);
    },
    true,
  );

  const api: PlanView = {
    open: (on = true) => setOpen(on),
    get isOpen() {
      return open;
    },
  };
  ed.planRequested = (on) => setOpen(on ?? !open);
  return api;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const newId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
