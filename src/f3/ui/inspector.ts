// Contextual inspector: shows only what applies to the selection (building, volume,
// face, component or rule component). Each field records on change.
import type { Editor3 } from '../editor/editor';
import type { Building3, FacadeRule, MaterialRef, Project3, RoofKind, Solid } from '../model/schema';
import { planCenter, rotateSolid, translateSolid } from '../model/ops';

/** Volume center (vertex average), rounded for display. */
const centerOf = (s: Solid): [number, number] => {
  const c = planCenter(s);
  return [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100];
};
import { facadeRule, uid } from '../model/defaults';
import { FINISHES } from '../render/finishes';
import { allFamilies, family, typeById, BUILTIN_TYPES } from '../families/index';
import { resolveParams, type ParamDef } from '../families/family';
import { icon } from './icons';
import { applyStyle, BUILDING_STYLES, applyUse, setLevelHeights, setOneLevelHeight, changeLevels, courtyardIn, FACADE_PRESETS, podiumUnder, presetRules, setbackOn } from '../model/quick';
import { cutTopDirection } from '../model/relations';
import { addBands, planBox, type BandPreset } from '../model/modeling';
import { cornerLimit } from '../model/plan';
import { axis, closeOnOutside, colorCell, gicon, gtext, numCell, polish, prow, selectCell } from './kit';
import { bindPaintPanel, paintPanel, switchFinish } from './materials';
import { adjusted, bindSurface, surfaceRows, surfaceToggles } from './mateditor';
import { buildingAreas, lotIndices } from '../model/lots';
import { bindSitePanel, sitePanel } from './site';
import { bindInteriorPanel, interiorPanel } from './interiorpanel';
import { evalExpr } from '../model/expr';
import { openCreator } from './creator';
import { withModifiers } from '../eval/modifiers';
import { openPhoto } from './photo';
import { decimal, tr } from './i18n';
import { optionHidden } from '../model/layers';
import { PROFILES } from '../eval/roofs';
import { WALL_TYPES, layersThickness } from '../model/walltypes';

const ROOFS: [RoofKind, string, string][] = [
  ['flat', 'Flat', 'flat'],
  ['terrace', 'Terrace', 'terrace'],
  ['shed', 'Shed', 'shed'],
  ['gable', 'Gable', 'gable'],
  ['hip', 'Hip', 'hip'],
  ['mansard', 'Mansard', 'mansard'],
  ['gambrel', 'Gambrel', 'gambrel'],
  ['pyramid', 'Pyramid', 'pyramid'],
  ['dome', 'Dome', 'dome'],
  ['vault', 'Vault', 'vault'],
  ['sawtooth', 'Sawtooth', 'sawtooth'],
  ['profile', 'By profile', 'arc'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => decimal(Math.round(v * 100) / 100);
// A typed field takes arithmetic too ('3*2.5', '(4+2)/3', '250cm'): model/expr.ts.
const parse = (s: string) => evalExpr(s) ?? parseFloat(s.replace(',', '.'));

/** A material slot: color and finish on one row (panel standard). */
const SLOT_ICON: Record<string, string> = { wall: 'wall', edgemat: 'wall', roof: 'gable', trim: 'cornice', base: 'flat', floor: 'top' };
/** The material slot whose surface editor is open under its row (ui/mateditor.ts), and the editor. */
let openSurface: string | null = null;
let surfaceEd: Editor3 | null = null;

function finishSelect(key: string, label: string, ref: MaterialRef): string {
  const open = openSurface === key && surfaceEd;
  return `<div class="f3-prow"><span class="lab" title="${label} material">${icon(SLOT_ICON[key] ?? 'material')}<span>${label}</span><button class="f3-medit" data-medit="${key}" aria-pressed="${!!open}" title="${label}: roughness, metallic, texture size and turn, light given off, opacity, your own picture${adjusted(ref) ? ' (adjusted)' : ''}">${icon(adjusted(ref) ? 'star' : 'more')}</button></span><div class="f3-cells fin">${colorCell(`data-k="${key}.color"`, `${label} color`, ref.color)}${selectCell(`data-k="${key}.finish"`, `${label} finish`, FINISHES.map((f) => [f.id, f.name] as const), ref.finish)}</div></div>${open ? `<div class="f3-surface" data-surface="${key}">${surfaceRows(surfaceEd!, ref)}</div>` : ''}`;
}

/** Number cell bound to an inspector key (`data-k`). */
const nk = (key: string, name: string, value: number, glyph: string, unit = '', step = 0.1, placeholder?: string) => numCell({ attr: `data-k="${key}"`, name, value, glyph, unit, step, ...(placeholder !== undefined ? { placeholder } : {}) });

/** Attributes that identify a panel field from one redraw to the next. */
const FIELD_KEYS = ['data-k', 'data-p', 'data-t', 'data-rk', 'data-b', 'data-s', 'data-mp', 'data-mk', 'data-bk', 'data-bvprofile', 'data-quick-facade', 'data-sf'];

/** Selector of the equivalent field after the panel is redrawn (same key, same rule/band). */
function fieldSelector(el: Element): string | null {
  const attr = FIELD_KEYS.find((k) => el.hasAttribute(k));
  if (!attr) return null;
  const own = `[${attr}="${CSS.escape(el.getAttribute(attr) ?? '')}"]`;
  const row = el.closest('[data-rule],[data-bandrow]');
  if (!row) return own;
  const ra = row.hasAttribute('data-rule') ? 'data-rule' : 'data-bandrow';
  return `[${ra}="${CSS.escape(row.getAttribute(ra) ?? '')}"] ${own}`;
}

export function mountInspector(ed: Editor3): void {
  const side = ed.shell.side;
  let lastKey = '';
  // Redrawing the panel in the middle of a click swaps the button under the mouse and the click is lost
  // (the click goes to the common ancestor; MDN, Element: click event). So: one redraw
  // per frame, and never while the mouse button is pressed inside the panel.
  let pending = false,
    pressed = false;
  const flush = () => {
    if (!pending || pressed) return;
    pending = false;
    render();
  };
  side.addEventListener('pointerdown', () => void (pressed = true), true);
  // Chrome blurs a focused field that a redraw removes, and so fires its "change" again
  // (Firefox does not: WHATWG list, Jan 2015; MDN, change event). The typed text goes on
  // to the new field, so that change is no commit: it was applying the same value twice
  // (two history steps for one edit, the first Ctrl+Z doing nothing).
  let redrawing = false;
  side.addEventListener(
    'change',
    (e) => {
      if (redrawing || !(e.target as Node).isConnected) e.stopImmediatePropagation();
    },
    true,
  );
  window.addEventListener(
    'pointerup',
    () => {
      if (!pressed) return;
      pressed = false;
      // After the click (which comes right after pointerup).
      setTimeout(flush, 0);
    },
    true,
  );
  const request = () => {
    pending = true;
    if (!pressed) requestAnimationFrame(flush);
  };
  const render = () => {
    // Focused field: return to it (with the unsaved text and the caret) in the new panel.
    const act = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
    const keep = act && side.contains(act) ? fieldSelector(act) : null;
    const typed = keep && act instanceof HTMLInputElement && act.value !== act.defaultValue ? act.value : null;
    const caret: [number | null, number | null] | null = keep && act instanceof HTMLInputElement ? [act.selectionStart, act.selectionEnd] : null;
    redrawing = true;
    try {
      draw();
    } finally {
      redrawing = false;
    }
    if (!keep) return;
    const el = side.querySelector<HTMLInputElement | HTMLSelectElement>(keep);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement) {
      if (typed !== null) el.value = typed;
      if (caret && caret[0] !== null) {
        try {
          el.setSelectionRange(caret[0], caret[1] ?? caret[0]);
        } catch {
          /* field type without text selection */
        }
      }
    }
  };
  let lastSel = '';
  const draw = () => {
    const b = ed.activeBuilding();
    const site = !b && (ed.sitePick.lot || ed.sitePick.street);
    const ib = ed.store.building(ed.context) ?? b;
    const key = JSON.stringify([ed.sel, ed.context, b && ed.store.revision.get(b.id), ed.project.types.length, ed.tool, ed.tool === 'paint' ? ed.paintMat : 0, ed.sitePick, site ? [ed.project.lots, ed.project.streets, ed.project.buildings.length] : 0, ed.iwallSel, ed.roomSel, surfaceToggles.n, b ? 0 : [...ed.store.revision.values()].join(), ib && (ed.iwallSel || ed.roomSel || ed.tool === 'iwall' || ed.tool === 'room') ? [ed.store.revision.get(ib.id), ed.project.view?.cutLevel, ed.iwallThickness] : 0]);
    // Does not redraw while the user types in a field.
    if (key === lastKey && side.contains(document.activeElement)) return;
    lastKey = key;
    // Another selection starts at the top of the panel (its "Selected face/corner" section is there);
    // a redraw of the same selection keeps the scroll.
    const selKey = JSON.stringify([ed.sel, ed.context, ed.tool === 'paint', ed.sitePick]);
    if (selKey !== lastSel) {
      lastSel = selKey;
      requestAnimationFrame(() => (side.scrollTop = 0));
    }
    // The panel is about to be replaced: a group pre-highlight under the mouse must not stay behind.
    ed.previewElems(null);
    if (ed.tool === 'paint') {
      side.innerHTML = paintPanel(ed);
      bindPaintPanel(ed, side);
      polish(side);
      return;
    }
    // Interior: a wall, a room or the interior defaults (ui/interiorpanel.ts).
    const ipanel = ib ? interiorPanel(ed, ib) : '';
    if (ib && ipanel) {
      side.innerHTML = ipanel;
      bindInteriorPanel(ed, ib, side);
      polish(side);
      return;
    }
    if (site) {
      side.innerHTML = sitePanel(ed);
      bindSitePanel(ed, side);
      polish(side);
      return;
    }
    if (!b) {
      side.innerHTML = emptyHelp(ed.project);
      side.querySelectorAll<HTMLInputElement>('[data-pinfo]').forEach((inp) =>
        inp.addEventListener('change', () => {
          const k = inp.dataset.pinfo as keyof NonNullable<Project3['info']>;
          const info = { ...(ed.store.project.info ?? {}) };
          const v = inp.value.trim().slice(0, 160);
          if (v) info[k] = v;
          else delete info[k];
          ed.store.project.info = info;
          ed.store.commit(null, 'Title block updated.', false);
        }),
      );
      polish(side);
      return;
    }
    const s = ed.activeSolid();
    const it = ed.activeItem();
    if (ed.context !== b.id && ed.sel.others.length) side.innerHTML = alignPanel(1 + ed.sel.others.length, 'buildings');
    else if (ed.context !== b.id) side.innerHTML = buildingPanel(b, false, '', ed.project, ed.boundsOf(b, undefined, true));
    else if (ed.sel.solids.length > 1) side.innerHTML = alignPanel(ed.sel.solids.length, 'volumes');
    else if (it && ed.sel.elems.length <= 1) side.innerHTML = itemPanel(ed, b, it.id);
    else if (ed.sel.elems.length) side.innerHTML = elementsPanel(ed);
    else if (s) side.innerHTML = solidPanel(ed, b, s);
    else side.innerHTML = buildingPanel(b, true, groupsSection(ed), ed.project, ed.boundsOf(b, undefined, true));
    bind(ed, b, s);
    polish(side);
  };
  ed.onChange(request);
  draw();
}

/** The project at a glance (nothing selected): its size, then what to make of it. */
function projectSummary(p: Project3): string {
  if (!p.buildings.length) return '';
  let gfa = 0,
    footprint = 0,
    floors = 0;
  // The buildings shown: an option not chosen of a design option set does not count.
  const shown = p.buildings.filter((b) => !b.hidden && !optionHidden(p, b));
  for (const b of shown) {
    const a = buildingAreas(b);
    gfa += a.gfa;
    footprint += a.footprint;
    floors = Math.max(floors, b.levels.length);
  }
  const m2 = (v: number) => `${Math.round(v)} m²`;
  const stat = (v: string, l: string) => `<div><b>${v}</b><span>${l}</span></div>`;
  return `<div class="f3-sec f3-summary"><h3>Project</h3>
    <div class="f3-sumstats">${stat(String(shown.length), 'buildings')}${stat(String(floors), 'floors')}${stat(m2(footprint), 'footprint')}${stat(m2(gfa), 'floor area')}</div></div>`;
}

/** The title block of the sheets (client, address, the professional responsible, registration, revision). */
function projectInfo(p: Project3): string {
  const i = p.info ?? {};
  const f = (k: keyof NonNullable<Project3['info']>, label: string) => `<label class="f3-field w"><span>${label}</span><input data-pinfo="${k}" value="${esc(i[k] ?? '')}" maxlength="160" data-i18n-skip></label>`;
  return `<div class="f3-sec"><h3>Title block</h3><div class="f3-grid2">${f('client', 'Client')}${f('address', 'Address')}${f('author', 'Responsible')}${f('registration', 'CAU / CREA')}${f('revision', 'Revision')}</div></div>`;
}

/**
 * Nothing selected: the project's numbers, or for an empty project the three ways to start. Renders,
 * tours, drawings and quantities are in Export (one place); the shortcuts are under ? (one place).
 */
function emptyHelp(p: Project3): string {
  if (p.buildings.length) return projectSummary(p) + projectInfo(p);
  const k = (keys: string, what: string) => `<span><kbd>${keys}</kbd></span><span>${what}</span>`;
  return `<div class="f3-empty"><b>Start a project</b>
  <div class="f3-keys">${k('W', 'Walls: click point to point, type the lengths')}${k('R', 'Rectangle: a volume to shape')}${k('K', 'Library: furniture, doors, windows, plants')}</div></div>`;
}

function buildingPanel(b: Building3, _inside = false, groups = '', project?: Project3, overall?: { min: number[]; max: number[] } | null): string {
  const levels = [...b.levels].sort((x, y) => x.elevation - y.elevation);
  const uses = [
    ['residential', 'Residential'],
    ['commercial', 'Commercial'],
    ['industrial', 'Industrial'],
    ['public', 'Public'],
    ['mixed', 'Mixed'],
  ] as const;
  return `<div class="f3-title"><input data-b="name" value="${esc(b.name)}" aria-label="Building name"><span class="f3-kind">Building</span></div>
  ${groups}
  <div class="f3-sec"><h3>Transform</h3>
    ${prow('Position', 'move', [nk('px', 'Position X', b.position[0], axis('x')), nk('py', 'Elevation (Z): base above the ground', b.elevation ?? 0, axis('y')), nk('pz', 'Position Y', b.position[1], axis('z'))])}
    ${prow('Rotation', 'rotate', [nk('rotation', 'Rotation around the vertical axis', b.rotation, gicon('rotate'), '°', 15)])}
  </div>
  <div class="f3-sec"><h3>Floors</h3>
    ${prow('Floors', 'floors', [nk('levels', 'Number of floors', levels.length, gicon('count'), '', 1)])}
    ${prow('Height', 'floorH', [nk('ground', 'Ground floor height', levels[0]?.height ?? 3, gtext('Ground')), nk('typical', 'Height of the other floors', levels[1]?.height ?? 3, gtext('Upper'))], { title: 'Floor to floor height' })}
  </div>
  ${levels.length > 1 && levels.length <= 40 ? `<div class="f3-sec"><h3>Floors table</h3><table class="f3-floors"><thead><tr><th>Floor</th><th>Elevation</th><th>Height</th></tr></thead><tbody>${[...levels]
    .map((l, i) => `<tr><td><input data-lvname="${l.id}" value="${esc(/^(Ground|Floor \d+)$/.test(l.name) ? tr(l.name) : l.name)}" aria-label="Name of floor ${i + 1}" maxlength="40"></td><td>${num(l.elevation)} m</td><td><input data-lvh="${i}" inputmode="decimal" value="${num(l.height)}" aria-label="Height of floor ${i + 1} (floor to floor)"></td></tr>`)
    .reverse()
    .join('')}</tbody></table></div>` : ''}
  <div class="f3-sec"><h3>Use</h3><div class="f3-seg">${uses.map(([v, l]) => `<button data-use="${v}" aria-pressed="${b.use === v}">${l}</button>`).join('')}</div></div>
  <div class="f3-sec"><h3>Style</h3><div class="f3-btns n2">${BUILDING_STYLES.map((st) => `<button class="f3-btn" data-style="${st.id}" title="Wall, roof and trim finishes, roof and facade of every volume"><span class="f3-swatch" style="background:${st.wall.color};border-color:${st.trim.color}"></span>${st.name}</button>`).join('')}</div></div>
  ${infoSection(b, project, overall)}
`;
}

function alignPanel(n: number, what: string): string {
  const b = (op: string, ic: string, label: string, title = label) => `<button class="f3-btn" data-align="${op}" title="${title}">${icon(ic)}${label}</button>`;
  return `<div class="f3-title"><span>${n} ${what}</span><span class="f3-kind">Selection</span></div>
  <div class="f3-sec"><h3>Align to the first selected</h3>
    ${prow('Along X', 'alignCenterX', [`<div class="f3-btns n3">${b('left', 'alignLeft', 'Left', 'Align left (X)')}${b('centerX', 'alignCenterX', 'Center', 'Align centers in X')}${b('right', 'alignRight', 'Right', 'Align right (X)')}</div>`], { wide: true, title: 'Align along X' })}
    ${prow('Along Z', 'alignCenterZ', [`<div class="f3-btns n3">${b('front', 'alignFront', 'Front', 'Align front (Z)')}${b('centerZ', 'alignCenterZ', 'Center', 'Align centers in Z')}${b('back', 'alignBack', 'Back', 'Align back (Z)')}</div>`], { wide: true, title: 'Align along Z' })}
    ${what === 'volumes' ? prow('Height', 'floorH', [`<div class="f3-btns n3">${b('base', 'alignFront', 'Base', 'Same base')}${b('top', 'alignBack', 'Top', 'Same top (moves up)')}${b('height', 'scale', 'Stretch', 'Same top (stretches)')}</div>`], { wide: true, title: 'Same base, same top (moves up) or same top (stretches)' }) : ''}
  </div>
  <div class="f3-sec"><h3>Distribute with equal spacing</h3>
    ${prow('Spacing', 'distance', [`<div class="f3-btns n3">${b('distX', 'distX', 'In X', 'Equal spacing in X')}${b('distZ', 'distZ', 'In Z', 'Equal spacing in Z')}</div>`], { wide: true, title: 'Distribute with equal spacing' })}
  </div>`;
}

function solidPanel(ed: Editor3, b: Building3, s: Solid): string {
  const face = ed.sel.face;
  const box = planBox(s);
  const bv = s.bevel;
  const r = s.roof;
  const c = centerOf(s);
  const pitched = r.kind !== 'flat' && r.kind !== 'terrace' && r.kind !== 'dome' && r.kind !== 'vault';
  const directed = r.kind === 'shed' || r.kind === 'sawtooth' || r.kind === 'gable' || r.kind === 'gambrel' || r.kind === 'vault' || r.kind === 'profile';
  const roofRows =
    (r.kind === 'flat' || r.kind === 'terrace' ? prow('Parapet', 'parapet', [nk('parapet', 'Parapet height', r.parapet, gicon('parapet'))]) : '') +
    (r.kind === 'dome' || r.kind === 'vault' ? prow('Rise', 'rise', [nk('rise', 'Rise (0 = half circle)', r.rise, gicon('rise'))]) : '') +
    (r.kind === 'profile'
      ? prow('Profile', 'arc', [selectCell('data-rprofile', 'Section of the roof across the building', [['butterfly', 'Butterfly'], ['asymmetric', 'Asymmetric gable'], ['curved', 'Curved'], ['m', 'M (double gable)'], ['wave', 'Wave']], Object.entries(PROFILES).find(([, v]) => JSON.stringify(v) === JSON.stringify(r.profile))?.[0] ?? 'butterfly')], { wide: true }) + prow('Rise', 'rise', [nk('rise', 'Height of the profile above the eave', r.rise || 2, gicon('rise'))])
      : '') +
    (pitched ? prow('Slope', 'slope', [nk('pitch', 'Roof slope', r.pitch, gicon('slope'), '°', 1), nk('overhang', 'Overhang past the walls', r.overhang, gicon('overhang'), '', 0.05)], { title: 'Slope and overhang' }) : '') +
    (directed ? prow('Direction', 'compass', [nk('direction', 'Ridge direction (0 = width, 90 = depth)', r.direction, gicon('compass'), '°', 15)]) : '');
  let facePart = '';
  if (face?.kind === 'side' && face.edge) {
    const e = s.edges[face.edge] ?? {};
    facePart = `<div class="f3-sec"><h3>${icon('push')} Selected face</h3>
    ${prow('Face', 'push', [nk('push', 'Push the face out (− in)', 0, gicon('push'), '', 0.1, '0'), nk('lean', 'Lean of the wall', e.lean ?? 0, gicon('lean'), '°', 1)], { title: 'Push and lean' })}
    ${prow('Bevel', 'bevel', [nk('edgebevel', 'Bevel of this side (top and base)', e.bevel ?? 0, gicon('bevel'), '', 0.05)])}
    ${['hip', 'gable', 'mansard', 'gambrel'].includes(r.kind) && !e.gable ? prow('Roof pitch', 'slope', [nk('edgepitch', 'Roof pitch of this side (empty = the roof’s)', e.pitch ?? r.pitch, gicon('slope'), '°', 1)]) : ''}
    ${finishSelect('edgemat', 'Wall', e.material ?? s.materials.wall)}
    <div class="f3-btns n3">
      <button class="f3-btn" data-act="gable" aria-pressed="${!!e.gable}" title="${e.gable ? 'This side is a gable: click to undo' : 'Make this side a gable (the roof rises to it)'}">${icon('gable')}Gable</button>
      <button class="f3-btn" data-act="blank" aria-pressed="${!!e.blank}" title="${e.blank ? 'Blank wall: click to let it take components again' : 'Blank wall: no windows or doors on this side'}">${icon('blank')}Blank</button>
      <button class="f3-btn" data-act="split" title="Split this side in two">${icon('split')}Split</button>
      <button class="f3-btn" data-act="curtain" title="The whole side in glass on a grid of mullions">${icon('window')}Curtain wall</button>
    </div></div>`;
  } else if (face?.kind === 'plinth') {
    facePart = `<div class="f3-sec"><h3>${icon('flat')} Selected plinth</h3>
    ${prow('Height', 'floorH', [nk('plinth', 'Plinth height (at most 40% of the wall)', s.plinth, gtext('H'), '', 0.05)])}
    ${finishSelect('base', 'Plinth', s.materials.base)}
    <div class="f3-btns n3"><button class="f3-btn danger" data-act="noplinth" title="No plinth on this volume">${icon('trash')}Remove</button></div></div>`;
  } else if (face?.kind === 'parapet') {
    facePart = `<div class="f3-sec"><h3>${icon('parapet')} Selected parapet</h3>
    ${prow('Height', 'parapet', [nk('parapet', 'Parapet height', r.parapet, gicon('parapet'))])}
    ${finishSelect('trim', 'Coping', s.materials.trim)}
    ${finishSelect('wall', 'Wall', s.materials.wall)}
    <div class="f3-btns n3"><button class="f3-btn danger" data-act="noparapet" title="No parapet on this roof">${icon('trash')}Remove</button></div></div>`;
  } else if (face?.kind === 'top') {
    // Top operations (inset, extrude) are in the contextual bar; here what is built on the top.
    facePart = `<div class="f3-sec"><h3>${icon('push')} Top</h3><div class="f3-btns n2"><button class="f3-btn" data-act="railaround" title="A railing around the edge of this top (terrace, slab)">${icon('railing')}Railing around</button></div></div>`;
  }
  if (ed.sel.vertex) {
    const v = [...s.plan.outer, ...s.plan.holes.flat()].find((q) => q.id === ed.sel.vertex);
    if (v)
      facePart += `<div class="f3-sec"><h3>Selected corner</h3>
    ${prow('Corner', 'round', [nk('cround', 'Round this corner (radius)', v.round ?? 0, gicon('round')), nk('cchamfer', 'Chamfer this corner', v.chamfer ?? 0, gicon('chamfer'))], { title: 'Round and chamfer' })}
    <div class="f3-btns n3"><button class="f3-btn" data-act="cornerwin" title="A window on each side, meeting at this corner">${icon('window')}Corner window</button><button class="f3-btn danger" data-act="delvertex" title="Delete this vertex">${icon('trash')}Delete</button></div></div>`;
  }
  const ops = [
    ['add', 'add', 'Add'],
    ['subtract', 'subtract', 'Subtract'],
    ['intersect', 'intersect', 'Intersect'],
  ] as const;
  return `<div class="f3-title"><input data-s="name" value="${esc(s.name)}" aria-label="Volume name"><span class="f3-kind">${s.op === 'add' ? 'Volume' : s.op === 'subtract' ? 'Cutter' : 'Intersect'}</span></div>
  ${facePart}
  ${s.shell && s.op === 'add' ? `<div class="f3-sec"><h3>Walls</h3>
    ${prow('Type', 'layers', [selectCell('data-walltype', 'Wall type (its layers, outside in)', [['', 'Custom'], ...WALL_TYPES.map((t) => [t.id, t.name] as const)], WALL_TYPES.find((t) => JSON.stringify(t.layers) === JSON.stringify(s.wallLayers))?.id ?? '')], { wide: true })}
    ${prow('Walls', 'thickness', [nk('shell', 'Wall thickness', s.shell, gicon('thickness'), 'm', 0.05), nk('height', 'Wall height', s.height, gtext('H'))], { title: 'Thickness and height of the walls' })}
    ${finishSelect('wall', 'Finish', s.materials.wall)}</div>` : ''}
  <div class="f3-sec"><h3>Transform</h3>
    ${prow('Position', 'move', [nk('cx', 'Center X', c[0], axis('x')), nk('base', 'Base (Z): height of the bottom above the building', s.base, axis('y')), nk('cz', 'Center Y', c[1], axis('z'))])}
    ${prow('Rotate', 'rotate', [nk('spin', 'Rotate the volume by this angle', 0, gicon('rotate'), '°', 15, '0')])}
  </div>
  <div class="f3-sec"><h3>Size</h3>
    ${prow('Size', 'scale', [nk('sizew', 'Width (X)', box.x1 - box.x0, gtext('W')), nk('sized', 'Depth (Z)', box.z1 - box.z0, gtext('D')), nk('height', 'Height', s.height, gtext('H'))], { title: 'Width, depth and height' })}
    <div class="f3-btns n1"><button class="f3-btn" data-act="sizelock" aria-pressed="${ed.sizeLock}" title="Keep the proportions: width, depth and height change together">${icon(ed.sizeLock ? 'lock' : 'unlock')}${ed.sizeLock ? 'Proportions kept' : 'Keep proportions'}</button></div>
    ${layerRow(ed, 'solid', s.layer)}
    <div class="f3-btns n2"><button class="f3-btn" data-act="levelsfit" title="The volume height goes to the nearest floor slab">${icon('floors')}Height to floors</button></div>
  </div>
  <div class="f3-sec"><h3>Shape</h3>
    <div class="f3-seg" style="margin-bottom:6px">${ops.map(([o, ic, l]) => `<button data-op="${o}" aria-pressed="${s.op === o}">${icon(ic)}${l}</button>`).join('')}</div>
    ${prow('Corners', 'round', [nk('round', 'Round every corner (radius)', s.plan.outer[0]?.round ?? 0, gicon('round')), nk('chamfer', 'Chamfer every corner', s.plan.outer[0]?.chamfer ?? 0, gicon('chamfer'))], { title: 'Round and chamfer' })}
    ${prow('Taper', 'taper', [nk('taper', 'Taper: the top shrinks by this much on each side', s.taper, gicon('taper')), nk('twist', 'Twist: the top turned against the base (degrees)', s.twist ?? 0, gicon('rotate'), '°', 5)], { title: 'Taper and twist' })}
    ${s.op === 'add' ? prow('Shell', 'thickness', [nk('shell', 'Hollow: walls, floor and top this thick (0: solid)', s.shell ?? 0, gicon('thickness'), 'm', 0.05)], { title: 'Hollow shell: the inside empty' }) : ''}
  </div>
  ${s.op === 'add' && !s.revolve ? `<div class="f3-sec"><h3>Loft</h3>${prow('Top', 'taper', [selectCell('data-loft', 'Shape on top (the walls go from the plan to it)', [['none', 'Same as the base'], ['0', 'Circle'], ['3', 'Triangle'], ['4', 'Square'], ['6', 'Hexagon'], ['8', 'Octagon']], s.loft ? String(s.loft.sides) : 'none')], { title: 'Loft: a different shape on top', wide: true })}${s.loft ? prow('Size', 'scale', [nk('loftscale', 'Size of the top (× the base)', s.loft.scale, gicon('scale'), '', 0.05), nk('loftturn', 'Turn of the top (degrees)', s.loft.turn, gicon('rotate'), '°', 5)], { title: 'Size and turn of the top' }) + prow('Middle', 'scale', [nk('loftmid', 'Size at half height (× the blend; 1 = straight)', s.loft.mids?.[0]?.scale ?? 1, gicon('scale'), '', 0.05), nk('loftmidturn', 'Turn at half height (degrees)', s.loft.mids?.[0]?.turn ?? 0, gicon('rotate'), '°', 5)], { title: 'A section at half height' }) : ''}</div>` : ''}
  ${s.revolve ? `<div class="f3-sec"><h3>Revolved shape</h3>${prow('Profile', 'rise', [`<label class="f3-cell" title="Profile points: radius,height; radius,height… (m from the axis and the base), turned around the center"><input data-revolve value="${s.revolve.profile.map((q) => `${num(q[0])},${num(q[1])}`).join('; ')}" aria-label="Revolve profile"></label>`], { wide: true })}${prow('Sides', 'segments', [nk('revseg', 'Facets around (8–96)', s.revolve.segments, gicon('count'), '', 4)])}</div>` : ''}
  <div class="f3-sec"><h3>Repeat and mirror</h3>
    ${prow('Repeat', 'array', [selectCell('data-rep', 'Live copies of this volume', [['none', 'None'], ['line', 'Row'], ['ring', 'Ring'], ['helix', 'Helix']], s.repeat?.kind ?? 'none'), ...(s.repeat ? [nk('repcount', 'How many (with this one)', s.repeat.count, gicon('count'), '', 1)] : [])], { title: 'Live copies: they follow every change of this volume' })}
    ${s.repeat?.kind === 'line' ? prow('Step', 'distance', [nk('repdx', 'Step in X', s.repeat.dx, axis('x')), nk('repdz', 'Step in Z', s.repeat.dz, axis('z'))], { title: 'Distance between copies' }) : ''}
    ${s.repeat?.kind === 'helix' ? prow('Turn', 'rotate', [nk('reprise', 'Rise of each copy over the previous one', s.repeat.rise, axis('y')), nk('repturn', 'Turn of each copy (degrees)', s.repeat.turn, gicon('rotate'), '°', 5)], { title: 'Each copy rises and turns' }) : ''}
    ${s.repeat?.kind === 'ring' || s.repeat?.kind === 'helix' ? prow('Center', 'move', [nk('repcx', 'Center X of the turn (building frame)', s.repeat.cx, axis('x')), nk('repcz', 'Center Z of the turn', s.repeat.cz, axis('z'))], { title: 'Center of the turn' }) : ''}
    ${prow('Mirror', 'mirror', [selectCell('data-mirror', 'A live mirrored copy across the building axis', [['none', 'None'], ['x', 'Across X (x = 0)'], ['z', 'Across Z (z = 0)']], s.mirror ?? 'none')], { wide: true })}
  </div>
  <div class="f3-sec"><h3>Edges</h3>
    ${prow('Bevel', 'bevel', [nk('bvtop', 'Bevel of the top edges', bv?.top ?? 0, gtext('Top'), '', 0.05), nk('bvbottom', 'Bevel of the base edges', bv?.bottom ?? 0, gtext('Base'), '', 0.05)])}
    ${prow('Profile', 'segments', [nk('bvseg', 'Bevel segments', bv?.segments ?? 1, gicon('count'), '', 1), selectCell('data-bvprofile', 'Bevel profile', [['0', 'Straight'], ['0.5', 'Mixed'], ['1', 'Round']], !bv || bv.profile < 0.25 ? '0' : bv.profile < 0.75 ? '0.5' : '1')], { title: 'Segments and profile' })}
  </div>
  ${
    s.op === 'subtract'
      ? // A cutter has no roof of its own: what it offers is the shape of the top of the hole (arcades, pointed
        // niches). Showing the roof chips here made "Hip" carve a wedge out of the building instead of roofing it.
        `<div class="f3-sec"><h3>Top of the cut</h3><div class="f3-chips">${CUT_TOPS.map(([k, l, ic]) => `<button class="f3-chip" data-roof="${k}" aria-pressed="${r.kind === k}" title="${l}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    ${r.kind === 'vault' || r.kind === 'gable' ? `<div style="margin-top:6px">${r.kind === 'vault' ? prow('Rise', 'rise', [nk('rise', 'Rise of the arch (0 = half circle)', r.rise, gicon('rise'))]) : ''}${prow('Direction', 'compass', [nk('direction', 'Direction of the arch: it shows on the walls across it (0 = it runs along the width)', r.direction, gicon('compass'), '°', 15)])}</div>` : ''}
    ${s.host && b.solids.some((x) => x.id === s.host!.solid) ? `<div class="f3-btns n2" style="margin-top:6px"><button class="f3-btn" data-act="tohost" title="Select the volume this was made on (its roof, facade and materials)">${icon('modeObject')}Wall's volume</button></div>` : ''}</div>
  <div class="f3-sec"><h3>Materials</h3>${finishSelect('wall', 'Cut faces', s.materials.wall)}</div>`
      : `<div class="f3-sec"><h3>Roof</h3><div class="f3-chips">${ROOFS.map(([k, l, ic]) => `<button class="f3-chip" data-roof="${k}" aria-pressed="${r.kind === k}" title="${l}">${icon(ic)}<span>${l}</span></button>`).join('')}</div>
    ${roofRows ? `<div style="margin-top:6px">${roofRows}</div>` : ''}</div>
  <div class="f3-sec"><h3>Bands and cornice</h3><div class="f3-btns n3">
    <button class="f3-btn" data-band="floors" title="A band at every slab">${icon('floors')}Per slab</button>
    <button class="f3-btn" data-band="cornice" title="Stepped cornice on top">${icon('cornice')}Cornice</button>
    <button class="f3-btn" data-band="base" title="Band at the foot of the walls">${icon('flat')}Plinth</button></div>
    ${(s.bands ?? [])
      .map(
        (bd) => `<div class="f3-op" data-bandrow="${bd.id}">
      ${prow('Band', 'cornice', [numCell({ attr: 'data-bk="y"', name: 'Height of the band base', value: bd.y, glyph: axis('y') }), numCell({ attr: 'data-bk="height"', name: 'Band thickness', value: bd.height, glyph: gicon('thickness'), step: 0.05 })], { title: 'Base height and thickness' })}
      ${prow('Projection', 'projection', [numCell({ attr: 'data-bk="depth"', name: 'Projection out of the wall', value: bd.depth, glyph: gicon('projection'), step: 0.05 }), selectCell('data-bk="profile"', 'Band profile', [['flat', 'Flat band'], ['cornice', 'Cornice']], bd.profile)], { title: 'Projection and profile' })}
      <div class="f3-btns n3"><button class="f3-btn danger" data-bk="del" title="Remove this band">${icon('trash')}Remove</button></div></div>`,
      )
      .join('')}</div>
  <div class="f3-sec"><h3>Facade <span class="r"><button class="f3-btn" data-act="addrule">${icon('add')}Rule</button></span></h3>
    ${prow('Preset', 'style', [selectCell('data-quick-facade', 'Apply a facade preset', [['', 'Choose…'], ...FACADE_PRESETS.map((f) => [f.id, f.name] as const)], '')], { wide: true })}
    <div style="margin-top:6px">${s.facade.length ? s.facade.map((f) => ruleRow(ed, f)).join('') : '<p class="f3-empty" style="padding:2px 0">No facade rules.</p>'}</div></div>
  <div class="f3-sec"><h3>Materials</h3>${finishSelect('wall', 'Walls', s.materials.wall)}${finishSelect('roof', 'Roof', s.materials.roof)}${finishSelect('trim', 'Trim', s.materials.trim)}${finishSelect('base', 'Base', s.materials.base)}${finishSelect('floor', 'Top floor', s.materials.floor ?? { finish: s.roof.kind === 'terrace' ? 'floor' : 'membrane', color: s.roof.kind === 'terrace' ? '#d4ccbf' : '#8f9290' })}</div>`
  }`;
}

/** Shapes the top of a cut can take (flat hole, arch, pointed arch, dome niche). */
const CUT_TOPS: [RoofKind, string, string][] = [
  ['flat', 'Flat', 'flat'],
  ['vault', 'Arch', 'vault'],
  ['gable', 'Pointed', 'gable'],
  ['dome', 'Dome', 'dome'],
];

/** Rules open for full editing (survives panel redraws). */
const openRules = new Set<string>();

function ruleRow(ed: Editor3, f: FacadeRule): string {
  const t = typeById(f.type, ed.project);
  const lvName = Array.isArray(f.levels) ? 'Floors ' + f.levels.map((x) => x + 1).join(',') : { all: 'All', ground: 'Ground', upper: 'Above ground', top: 'Top', middle: 'Middle' }[f.levels];
  const mode = { spacing: 'every', max: 'up to', count: 'count', fit: 'fit' }[f.mode];
  const isOpen = openRules.has(f.id);
  const face = ed.sel.face?.kind === 'side' ? ed.sel.face.edge : undefined;
  const sides = f.edges.length ? `${f.edges.length} side(s)` : 'All sides';
  const types = BUILTIN_TYPES.concat(ed.project.types).filter((x) => family(x.family)?.host === 'face');
  const valueName = f.mode === 'count' ? 'Count' : f.mode === 'fit' ? 'Gap' : 'Distance';
  const valueCell = (extra = '') => numCell({ attr: `data-rk="value"${extra}`, name: valueName, value: f.value, glyph: gicon(f.mode === 'count' ? 'count' : 'distance'), step: f.mode === 'count' ? 1 : 0.1 });
  const edgeOpts: [string, string][] = [['all', 'All sides']];
  if (face) edgeOpts.push(['face', 'Only the selected face'], ['addface', 'Add the selected face']);
  const keepEdges = f.edges.length && !(face && f.edges.length === 1 && f.edges[0] === face);
  if (keepEdges) edgeOpts.push(['keep', `${f.edges.length} side(s) chosen`]);
  const edgeVal = !f.edges.length ? 'all' : face && f.edges.length === 1 && f.edges[0] === face ? 'face' : 'keep';
  const details = isOpen
    ? `<div class="f3-rule-body">
      ${prow('Type', 'catalog', [selectCell('data-rk="type"', 'Component type', types.map((x) => [x.id, x.name] as const), f.type)], { wide: true })}
      ${prow('Floors', 'floors', [selectCell('data-rk="levels"', 'Floors that get it', [['all', 'All'], ['ground', 'Ground'], ['upper', 'Above ground'], ['middle', 'Middle'], ['top', 'Top']], String(f.levels))], { wide: true })}
      ${prow('Spread', 'distance', [selectCell('data-rk="mode"', 'Distribution: up to a spacing, every fixed distance, a count, or as many as fit', [['max', 'Max spacing'], ['spacing', 'Every'], ['count', 'Count'], ['fit', 'Fit most']], f.mode), valueCell()], { title: 'Distribution and its value' })}
      ${prow('Place', 'justify', [selectCell('data-rk="justify"', 'Justify along the side', [['start', 'Start'], ['center', 'Center'], ['end', 'End']], f.justify), numCell({ attr: 'data-rk="margin"', name: 'Margin at both ends', value: f.margin, glyph: gicon('margin') })], { title: 'Justify and end margin' })}
      ${prow('Sill', 'sill', [numCell({ attr: 'data-rk="sill"', name: 'Sill height (empty = from the type)', value: Number.isFinite(f.sill) ? f.sill : '', glyph: gicon('sill'), placeholder: 'type' })], { title: 'Sill height (empty = from the type)' })}
      ${prow('Sides', 'modeFace', [selectCell('data-rk="edges"', 'Sides that get it', edgeOpts, edgeVal)], { wide: true })}
    </div>
    <div class="f3-btns n3" style="grid-column:1/-1"><button class="f3-btn" data-rk="pick" title="Select the elements of this rule (edit their parameters)">${icon('cursor')}Select</button>${Object.keys(f.except).length ? `<button class="f3-btn" data-rk="clearexc" title="Clear ${Object.keys(f.except).length} exception(s)">${icon('restore')}Reset</button>` : ''}<button class="f3-btn danger" data-rk="del" title="Remove this rule">${icon('trash')}Remove</button></div>`
    : '';
  return `<div class="f3-rule" data-rule="${f.id}"><div class="t" data-rk="open" style="cursor:pointer" title="${isOpen ? 'Close' : 'Edit the rule'}"><b>${isOpen ? '▾' : '▸'} <span>${esc(t?.name ?? f.type)}</span></b><small><span>${lvName}</span> · <span>${mode}</span> ${num(f.value)}${f.mode === 'count' ? '' : ' m'} · <span>${sides}</span></small></div>
  ${isOpen ? details : `<span class="f3-rule-val">${valueCell()}</span><button class="f3-btn ic danger" data-rk="del" title="Remove rule" aria-label="Remove rule">${icon('trash')}</button>`}</div>`;
}

/** Areas of the building (model/lots.ts) and, on a lot, its urban indices: read only. */
function infoSection(b: Building3, project?: Project3, overall?: { min: number[]; max: number[] } | null): string {
  // The copies made by the live modifiers count (a row of five is five times the area).
  const a = buildingAreas(withModifiers(b));
  const m2 = (v: number) => `${num(Math.round(v * 10) / 10)} m²`;
  const rows: [string, string][] = [['Footprint', m2(a.footprint)], ['Gross floor area', m2(a.gfa)], ['Volume', `${num(Math.round(a.volume))} m³`]];
  // Overall size in the building's own frame (width × depth × height of the adding volumes).
  const adds = withModifiers(b).solids.filter((s) => s.op === 'add');
  if (adds.length) {
    const ps = adds.flatMap((s) => s.plan.outer.map((v) => v.p));
    const W = Math.max(...ps.map((p) => p[0])) - Math.min(...ps.map((p) => p[0])),
      D = Math.max(...ps.map((p) => p[1])) - Math.min(...ps.map((p) => p[1])),
      H = Math.max(...adds.map((s) => s.base + s.height));
    rows.unshift(['Walls (W × D × H)', `${num(W)} × ${num(D)} × ${num(H)} m`]);
    // The whole building with its roof and eaves: the same box and sizes the selection shows in the view.
    // Linked copies: how many share this building's shape.
    const group = b.linked && project ? project.buildings.filter((x) => x.linked === b.linked).length : 0;
    if (group > 1) rows.unshift(['Linked copies', String(group)]);
    if (overall) rows.unshift(['Overall (W × D × H)', `${num(overall.max[0]! - overall.min[0]!)} × ${num(overall.max[2]! - overall.min[2]!)} × ${num(overall.max[1]!)} m`]);
  }
  const li = b.lotId && project ? lotIndices({ ...project, buildings: project.buildings.map(withModifiers) }, b.lotId) : null;
  if (li) rows.push(['Lot occupancy', `${num(Math.round(li.occupancy * 1000) / 10)} %`], ['Floor area ratio', num(Math.round(li.far * 100) / 100)], ['Permeable', `${num(Math.round(li.permeable * 1000) / 10)} %`], ['Smallest setback', `${num(Math.round(li.setbacks.min * 100) / 100)} m`]);
  const lot = b.lotId && project ? project.lots.find((l) => l.id === b.lotId) : undefined;
  return `<div class="f3-sec"><h3>Information</h3><dl class="f3-info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${lot ? `<div class="f3-btns n2"><button class="f3-btn" data-act="selectlot" title="Select the lot this building stands on (its setbacks, split, build)">${icon('lot')}${esc(lot.name)}</button></div>` : ''}</div>`;
}

/** Layer of the chosen volume or part (Default = none), like SketchUp's Tag field in Entity Info. */
function layerRow(ed: Editor3, what: 'solid' | 'item', cur: string | undefined): string {
  const ls = ed.project.layers ?? [];
  // The renovation phase sits with the layer: both say where the element belongs.
  const target = what === 'solid' ? ed.activeSolid() : ed.activeItem();
  const phase = prow('Phase', 'restore', [selectCell(`data-phase="${what}"`, 'Renovation phase', [['', 'New'], ['existing', 'Existing'], ['demolished', 'To demolish']], target?.phase ?? '')], { wide: true });
  return `<div class="f3-sec"><h3>Layer</h3>${ls.length ? prow('Layer', 'layers', [selectCell(`data-layer="${what}"`, 'Layer', [['', 'Default'], ...ls.map((l) => [l.id, l.name] as const)], cur ?? '')], { wide: true }) : ''}${phase}</div>`;
}

function paramInputs(defs: ParamDef[], values: Record<string, unknown>, overrides: Record<string, unknown>): string {
  const groups: Record<string, string> = { size: 'Size', divisions: 'Divisions', profile: 'Profile', material: 'Materials', detail: 'Details' };
  const cellOf = (d: ParamDef, glyph = ''): string => {
    const v = values[d.key];
    const over = d.key in overrides;
    // A blue field (overridden on this occurrence) edits the override, not the type; its ↺ gives the
    // field back to the type (one field at a time, like Figma's reset of one instance override).
    const attr = `data-p="${d.key}" data-scope="${over ? 'instance' : d.scope}"${d.min !== undefined ? ` data-min="${d.min}"` : ''}${d.max !== undefined ? ` data-max="${d.max}"` : ''}`;
    const reset = (html: string) => (over ? html.replace(/<\/label>$/, `<button type="button" class="f3-reset" data-reset="${d.key}" title="Back to the type value" aria-label="${d.label}: back to the type value">↺</button></label>`) : html);
    if (d.kind === 'enum') return reset(selectCell(attr, d.label, d.options!.map((o) => [String(o.value), o.label] as const), String(v), glyph, over));
    if (d.kind === 'bool') return reset(selectCell(`${attr} data-bool="1"`, d.label, [['1', 'Yes'], ['0', 'No']], v === true ? '1' : '0', glyph, over));
    if (d.kind === 'color') return reset(colorCell(attr, d.label, String(v), over));
    if (d.kind === 'finish') return reset(selectCell(attr, d.label, FINISHES.map((f) => [f.id, f.name] as const), String(v), glyph, over));
    return reset(numCell({ attr, name: d.label, value: typeof v === 'number' ? v : String(v ?? ''), glyph, unit: d.kind === 'angle' ? '°' : '', step: d.kind === 'count' ? 1 : d.kind === 'angle' ? 1 : 0.05, over }));
  };
  let html = '';
  for (const g of Object.keys(groups)) {
    const ds = defs.filter((d) => d.group === g && d.kind !== 'text');
    if (!ds.length) continue;
    html += `<div class="f3-sec"><h3>${groups[g]}</h3>`;
    // Width, height and depth share one row (W · H · D), like the size of a volume.
    const dims = g === 'size' ? (['width', 'height', 'depth'] as const).map((k) => ds.find((d) => d.key === k && d.kind === 'length')).filter((d): d is ParamDef => !!d) : [];
    if (dims.length >= 2) html += prow('Size', 'scale', dims.map((d) => cellOf(d, gtext(d.key === 'width' ? 'W' : d.key === 'height' ? 'H' : 'D'))), { title: dims.map((d) => d.label).join(', ') });
    for (const d of ds) {
      if (dims.length >= 2 && dims.includes(d)) continue;
      const wide = d.kind === 'enum' || d.kind === 'finish' || d.kind === 'bool';
      html += prow(d.label, paramIcon(d), [cellOf(d)], { wide });
    }
    html += '</div>';
  }
  return html;
}

/** Row icon of a family parameter, by its kind and what its key says (panel standard: every row has one). */
function paramIcon(d: ParamDef): string {
  if (d.kind === 'color') return 'palette';
  if (d.kind === 'finish') return 'material';
  if (d.kind === 'count') return 'count';
  if (d.kind === 'angle') return 'slope';
  if (d.kind === 'bool') return 'check';
  if (d.kind === 'enum') return 'segments';
  const k = d.key.toLowerCase();
  if (/sill|elev|base/.test(k)) return 'sill';
  if (/spac|span|every|gap/.test(k)) return 'spacing';
  if (/thick|depth|projection|offset|over/.test(k)) return 'projection';
  if (/height|rise/.test(k)) return 'floorH';
  if (/width|size|length|diam/.test(k)) return 'scale';
  return 'margin';
}

function itemPanel(ed: Editor3, b: Building3, id: string): string {
  const it = b.items.find((x) => x.id === id)!;
  const t = typeById(it.type, ed.project);
  const f = t && family(t.family);
  if (!t || !f) return '<div class="f3-empty">Unknown type.</div>';
  const values = resolveParams(f, t.params, it.params);
  const users = ed.project.buildings.reduce((n, x) => n + x.items.filter((q) => q.type === t.id).length + x.solids.reduce((m, s) => m + s.facade.filter((r) => r.type === t.id).length, 0), 0);
  const arr = it.array;
  return `<div class="f3-title"><span style="flex:1;font-weight:600">${esc(t.name)}</span><span class="f3-kind">${esc(f.name)}</span></div>
  <div class="f3-sec" style="padding-top:8px"><div class="f3-row"><span class="f3-kind" title="Type fields change every occurrence; blue fields apply to this one only">Type in ${users} use(s)</span><span class="f3-sp"></span>
  ${it.origin ? `<button class="f3-btn" data-act="restore" title="Deletes this free part and returns the position to the facade rule">Back to rule</button>` : ''}<button class="f3-btn" data-act="unique" title="Creates a type of its own for this occurrence">${icon('unique')}Make unique</button><button class="f3-btn" data-act="design" title="Every parameter of this component with a live picture (a library type: a copy of it)">${icon('pencil')}Design</button><button class="f3-btn ic danger" data-act="del" title="Delete">${icon('trash')}</button></div></div>
  <div class="f3-sec"><h3>${icon('array')} Array</h3>
    ${prow('Copies', 'array', [nk('acount', 'Copies along', arr?.along.count ?? 1, gicon('count'), '', 1), nk('aspace', 'Distance between copies', arr?.along.value ?? f.size(values)[0] + 1, gicon('distance'))], { title: 'Copies and distance' })}
    ${prow('Rows', 'row', [nk('rcount', 'Rows', arr?.across?.count ?? 1, gicon('count'), '', 1), nk('rspace', 'Row spacing', arr?.across?.spacing ?? 3, gicon('spacing'))], { title: 'Rows and spacing' })}
  </div>
  ${paramInputs(f.params, values, it.params)}
  ${layerRow(ed, 'item', it.layer)}`;
}

function elementsPanel(ed: Editor3): string {
  const all = ed.elements();
  const picked = all.filter((e) => ed.sel.elems.includes(e.key));
  const types = [...new Set(picked.map((e) => e.type))];
  const btn = (op: string, label: string, title: string, ic = '') => '<button class="f3-btn" data-sel="' + op + '" title="' + title + '">' + (ic ? icon(ic) : '') + label + '</button>';
  const t = types.length === 1 ? typeById(types[0]!, ed.project) : undefined;
  const f = t && family(t.family);
  const users = t ? all.filter((e) => e.type === t.id).length : 0;
  let params: string;
  if (t && f) {
    const scope = ed.elemScope;
    params =
      '<div class="f3-sec"><h3>Parameters · ' + esc(t.name) + '</h3><div class="f3-seg" style="margin-bottom:6px">' +
      '<button data-escope="type" aria-pressed="' + (scope === 'type') + '">All of the type (' + users + ')</button>' +
      '<button data-escope="sel" aria-pressed="' + (scope === 'sel') + '">Only the selected (' + picked.length + ')</button></div></div>' +
      paramInputs(f.params, resolveParams(f, t.params), {});
  } else {
    // Mixed types: the split by type; a click keeps only that type (and its parameters).
    const chips = types
      .map((id) => [id, typeById(id, ed.project)?.name ?? id, picked.filter((e) => e.type === id).length] as const)
      .sort((a, b) => b[2] - a[2])
      .map(([id, name, n]) => '<button class="f3-chip" data-onlytype="' + esc(id) + '" title="Keep only these">' + esc(name) + ' <b>' + n + '</b></button>')
      .join('');
    params = '<div class="f3-sec"><h3>Types in the selection</h3><div class="f3-chips">' + chips + '</div></div>';
  }
  return '<div class="f3-title"><span style="flex:1;font-weight:600">' + (t ? esc(t.name) : picked.length + ' element(s)') + '</span><span class="f3-kind">' + (f ? esc(tr(f.name)) : 'Facade') + ' · ' + picked.length + '</span></div>' +
  groupsSection(ed) +
  '<div class="f3-sec"><h3>Select</h3><div class="f3-btns n3">' +
  btn('row', 'Row', 'The same floor on every face (double click a window)', 'row') +
  btn('rowFace', 'On face', 'Row on this face only: the same floor on this face', 'row') +
  btn('column', 'Column', 'The same stack on every floor', 'column') +
  btn('grow', 'Grow', 'Adds the neighbours', 'add') +
  btn('shrink', 'Shrink', 'Removes the selection border', 'minus') +
  btn('type', 'Same type', 'All of the same type in the building', 'catalog') +
  btn('face', 'Face', 'Whole face: all on this face', 'modeFace') +
  '</div></div>' +
  params +
  '<div class="f3-sec"><h3>Apply to the selected</h3><div class="f3-btns n2">' +
  '<button class="f3-btn" data-act="swapsel" title="Swap for another type">' + icon('swap') + 'Swap…</button>' +
  (picked.some((e) => e.key.startsWith('r|')) ? '<button class="f3-btn" data-act="detach" title="Becomes a free component in the same place: moves and changes on its own, without following the rule">' + icon('detach') + 'Detach</button>' : '') +
  '<button class="f3-btn" data-act="restore" title="Back to rule: clears exceptions and returns detached elements to the rule">' + icon('restore') + 'To rule</button>' +
  '<button class="f3-btn danger" data-act="removesel">' + icon('trash') + 'Remove</button></div></div>';
}

/**
 * Automatic building groups (docs/SELECTION.md): category → type → variant,
 * with how many there are and how many are selected. A click selects the
 * group (Ctrl adds, Shift toggles, Ctrl+Shift removes); hovering highlights
 * in the model what will be selected.
 */
function groupsSection(ed: Editor3): string {
  const rows = ed.elementGroups();
  if (!rows.length) return '';
  const sel = new Set(ed.sel.elems);
  const html = rows
    .map((r) => {
      const n = r.keys.filter((k) => sel.has(k)).length;
      const part = n > 0 && n < r.keys.length;
      return `<button class="f3-grp d${r.depth}" data-group="${esc(r.id)}" aria-pressed="${n > 0 && n === r.keys.length}"${part ? ' data-part' : ''}><span class="nm">${esc(r.label)}</span><span class="n">${part ? `${n}/` : ''}${r.keys.length}</span></button>`;
    })
    .join('');
  return `<div class="f3-sec"><h3 title="Click selects the group; Ctrl adds, Shift toggles, Ctrl+Shift removes">Building elements</h3><div class="f3-groups">${html}</div></div>`;
}

function bind(ed: Editor3, b: Building3, s: Solid | undefined): void {
  const side = ed.shell.side;
  const $$ = <T extends HTMLElement>(q: string) => [...side.querySelectorAll<T>(q)];
  const val = (el: HTMLInputElement | HTMLSelectElement) => el.value;
  // Building.
  $$<HTMLInputElement>('[data-b="name"]').forEach((el) => el.addEventListener('change', () => ed.change(b.id, (x) => void (x.name = el.value || 'Building'), '', false)));
  $$<HTMLSelectElement>('select[data-phase]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = (el.value || undefined) as 'existing' | 'demolished' | undefined;
      ed.change(b.id, (x) => {
        const target = el.dataset.phase === 'solid' ? x.solids.find((q) => q.id === ed.sel.solids[0]) : x.items.find((q) => q.id === ed.sel.item);
        if (!target) return;
        if (v) target.phase = v;
        else delete target.phase;
      }, v === 'existing' ? 'Existing.' : v === 'demolished' ? 'To demolish.' : 'New work.');
    }),
  );
  $$<HTMLSelectElement>('select[data-layer]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = el.value || undefined;
      ed.change(b.id, (x) => {
        const target = el.dataset.layer === 'solid' ? x.solids.find((q) => q.id === ed.sel.solids[0]) : x.items.find((q) => q.id === ed.sel.item);
        if (!target) return;
        if (v) target.layer = v;
        else delete target.layer;
      }, v ? `On layer ${ed.project.layers?.find((l) => l.id === v)?.name ?? ''}.` : 'On the Default layer.', false);
    }),
  );
  // Floors table: a name and a height per floor (the floors above and their volumes follow).
  $$<HTMLInputElement>('[data-lvname]').forEach((el) => el.addEventListener('change', () => ed.change(b.id, (x) => {
    const l = x.levels.find((q) => q.id === el.dataset.lvname);
    if (l) l.name = el.value.trim().slice(0, 40) || l.name;
  }, '', false)));
  $$<HTMLInputElement>('[data-lvh]').forEach((el) => el.addEventListener('change', () => {
    const v = parse(el.value);
    if (!Number.isFinite(v) || v < 2.2 || v > 30) return ed.toast('A floor is 2.2 to 30 m from floor to floor.');
    ed.change(b.id, (x) => setOneLevelHeight(x, Number(el.dataset.lvh), v), `Floor ${Number(el.dataset.lvh) + 1}: ${num(v)} m; the floors above moved with it.`);
  }));
  // Use with effect: floor heights, ground floor and windows (model/quick.ts, applyUse).
  $$<HTMLButtonElement>('[data-use]').forEach((el) =>
    el.addEventListener('click', () => {
      const isWindow = (t: string) => family(typeById(t, ed.project)?.family ?? '')?.category === 'windows';
      let msg = '';
      ed.change(b.id, (x) => void (msg = applyUse(x, el.dataset.use as Building3['use'], isWindow)));
      if (ed.store.changed) ed.toast(msg);
    }),
  );
  $$<HTMLButtonElement>('[data-style]').forEach((el) =>
    el.addEventListener('click', () => {
      let msg = '';
      ed.change(b.id, (x) => void (msg = applyStyle(x, el.dataset.style!)));
      if (ed.store.changed) ed.toast(msg);
    }),
  );
  // Volume.
  $$<HTMLInputElement>('[data-s="name"]').forEach((el) => el.addEventListener('change', () => ed.changeSolid((x) => void (x.name = el.value || 'Volume'))));
  $$<HTMLButtonElement>('[data-op]').forEach((el) => el.addEventListener('click', () => ed.command('op-' + el.dataset.op)));
  $$<HTMLSelectElement>('[data-rprofile]').forEach((el) =>
    el.addEventListener('change', () => ed.changeSolid((x) => void (x.roof.profile = structuredClone(PROFILES[el.value]!)), 'Roof profile changed.')),
  );
  $$<HTMLButtonElement>('[data-roof]').forEach((el) =>
    el.addEventListener('click', () =>
      ed.changeSolid((x) => {
        const k = el.dataset.roof as RoofKind;
        x.roof.kind = k;
        if (k === 'flat') x.roof.parapet = x.roof.parapet || 0.6;
        if (k === 'terrace') x.roof.parapet = Math.max(1.05, x.roof.parapet);
        if (k === 'profile') {
          x.roof.profile ??= structuredClone(PROFILES.butterfly!);
          if (!(x.roof.rise > 0.3)) x.roof.rise = 2;
        }
        if (k !== 'flat' && k !== 'terrace' && x.roof.overhang === 0 && k !== 'dome' && k !== 'vault' && x.op !== 'subtract') x.roof.overhang = 0.5;
        // The top of a cut: no parapet, no eaves past its sides; an arch or a point turned to show on
        // the wall it cuts (audit D1).
        if (x.op === 'subtract') {
          x.roof.parapet = 0;
          x.roof.overhang = 0;
          if (k === 'vault' || k === 'gable') x.roof.direction = cutTopDirection(b, x);
        }
      }, 'Roof changed.'),
    ),
  );
  // Surface editor of a material slot: the ⋯ beside the row opens it under the row (one at a time).
  surfaceEd = ed;
  $$<HTMLButtonElement>('[data-medit]').forEach((el) =>
    el.addEventListener('click', () => {
      openSurface = openSurface === el.dataset.medit ? null : el.dataset.medit!;
      surfaceToggles.n++;
      ed.select({ ...ed.sel });
    }),
  );
  $$<HTMLElement>('[data-surface]').forEach((box) => {
    const slot = box.dataset.surface!;
    bindSurface(ed, box, (fn, msg) =>
      ed.changeSolid((x) => {
        if (slot === 'edgemat') fn(((x.edges[ed.sel.face!.edge!] ??= {}).material ??= structuredClone(x.materials.wall)));
        else fn((x.materials[slot as 'wall'] ??= structuredClone(x.materials.base)));
      }, msg),
    );
  });
  for (const el of $$<HTMLInputElement>('input[data-k]')) {
    el.addEventListener('change', () => {
      const k = el.dataset.k!;
      if (k.endsWith('.color') || k.endsWith('.finish')) {
        const [slot, prop] = k.split('.') as [string, 'color' | 'finish'];
        if (slot === 'edgemat') return ed.changeSolid((x) => void (((x.edges[ed.sel.face!.edge!] ??= {}).material ??= { ...x.materials.wall })[prop] = el.value));
        return ed.changeSolid((x) => void ((x.materials[slot as 'wall'] ??= { ...x.materials.base })[prop] = el.value));
      }
      const v = parse(el.value);
      if (!Number.isFinite(v)) return;
      applyNumber(ed, b, s, k, v);
    });
    // Up/down arrows step the value.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        el.dispatchEvent(new Event('change'));
        el.select();
        e.preventDefault();
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const step = parse(el.dataset.step ?? '0.1') * (e.shiftKey ? 10 : 1);
      const v = (parse(el.value) || 0) + (e.key === 'ArrowUp' ? step : -step);
      el.value = num(v);
      el.dispatchEvent(new Event('change'));
      e.preventDefault();
    });
  }
  // Revolve profile: "r,y; r,y" (a comma inside a pair, a semicolon between pairs).
  $$<HTMLSelectElement>('select[data-loft]').forEach((el) =>
    el.addEventListener('change', () =>
      ed.changeSolid((x) => {
        if (el.value === 'none') delete x.loft;
        else x.loft = { sides: Number(el.value), scale: x.loft?.scale ?? 0.8, turn: x.loft?.turn ?? 0 };
      }, el.value === 'none' ? 'Loft removed.' : 'Loft: the walls go from the plan to the shape on top.'),
    ),
  );
  $$<HTMLInputElement>('input[data-revolve]').forEach((el) =>
    el.addEventListener('change', () => {
      const pts = el.value.split(';').map((q) => q.split(',').map((t) => parseFloat(t.trim()))).filter((q) => q.length === 2 && q.every(Number.isFinite) && q[0]! >= 0) as [number, number][];
      if (pts.length < 2) return void ed.toast('Write at least two points: radius,height; radius,height');
      ed.changeSolid((x) => {
        if (x.revolve) x.revolve.profile = pts;
      }, 'Profile changed.');
    }),
  );
  // Live modifiers: repeat (row or ring) and mirror (eval/modifiers.ts).
  $$<HTMLSelectElement>('select[data-rep]').forEach((el) =>
    el.addEventListener('change', () =>
      ed.changeSolid((x) => {
        const bx = planBox(x);
        if (el.value === 'line') x.repeat = { kind: 'line', count: 3, dx: Math.round((bx.x1 - bx.x0 + 2) * 100) / 100, dz: 0 };
        else if (el.value === 'ring') x.repeat = { kind: 'ring', count: 6, cx: 0, cz: 0 };
        else if (el.value === 'helix') {
          // Turning about one corner of the volume, rising its height: a spiral of slabs.
          x.repeat = { kind: 'helix', count: 12, cx: Math.round(bx.x0 * 100) / 100, cz: Math.round(((bx.z0 + bx.z1) / 2) * 100) / 100, rise: Math.round((x.height + (x.roof.kind === 'flat' || x.roof.kind === 'terrace' ? x.roof.parapet : 0)) * 100) / 100, turn: 30 };
        } else delete x.repeat;
      }, el.value === 'none' ? 'Copies removed.' : el.value === 'line' ? 'Three copies in a row: they follow every change of this volume.' : el.value === 'helix' ? 'Twelve copies, each turned 30° and raised its height (with the parapet): a spiral.' : 'Six copies around the building center.'),
    ),
  );
  $$<HTMLSelectElement>('select[data-mirror]').forEach((el) =>
    el.addEventListener('change', () =>
      ed.changeSolid((x) => {
        if (el.value === 'x' || el.value === 'z') x.mirror = el.value;
        else delete x.mirror;
      }, el.value === 'none' ? 'Mirror removed.' : `Mirrored across ${el.value.toUpperCase()}.`),
    ),
  );
  $$<HTMLSelectElement>('select[data-k]').forEach((el) =>
    el.addEventListener('change', () => {
      const [slot] = el.dataset.k!.split('.') as [string, 'finish'];
      if (slot === 'edgemat') return ed.changeSolid((x) => switchFinish(((x.edges[ed.sel.face!.edge!] ??= {}).material ??= { ...x.materials.wall }), el.value));
      ed.changeSolid((x) => switchFinish((x.materials[slot as 'wall'] ??= { ...x.materials.base }), el.value));
    }),
  );
  // Facade rules.
  $$<HTMLElement>('.f3-rule').forEach((row) => {
    const id = row.dataset.rule!;
    const R = (x: Solid) => x.facade.find((f) => f.id === id)!;
    const set = (fn: (r: FacadeRule) => void, msg = '') => ed.changeSolid((x) => void fn(R(x)), msg);
    row.querySelector('[data-rk="open"]')?.addEventListener('click', () => {
      if (openRules.has(id)) openRules.delete(id);
      else openRules.add(id);
      ed.select({ ...ed.sel });
    });
    const sel = (k: string, fn: (v: string) => void) => row.querySelector<HTMLSelectElement>(`select[data-rk="${k}"]`)?.addEventListener('change', (e) => fn((e.target as HTMLSelectElement).value));
    const inp = (k: string, fn: (v: string) => void) => {
      const el = row.querySelector<HTMLInputElement>(`input[data-rk="${k}"]`);
      el?.addEventListener('change', () => fn(el.value));
      el?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          el.dispatchEvent(new Event('change'));
          e.preventDefault();
        }
        // Up/down arrows step the value, like every other number field (Shift ×10).
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.dataset.step) {
          const step = parse(el.dataset.step) * (e.shiftKey ? 10 : 1);
          el.value = num((parse(el.value) || 0) + (e.key === 'ArrowUp' ? step : -step));
          el.dispatchEvent(new Event('change'));
          e.preventDefault();
        }
      });
    };
    sel('type', (v) => set((r) => void (r.type = v), 'Rule type swapped.'));
    sel('levels', (v) => set((r) => void (r.levels = v as FacadeRule['levels'])));
    sel('mode', (v) =>
      set((r) => {
        r.mode = v as FacadeRule['mode'];
        // A value consistent with the new mode.
        if (r.mode === 'count') r.value = Math.max(1, Math.round(r.value > 6 ? 3 : r.value));
        else if (r.mode === 'fit') r.value = 0.6;
        else if (r.value < 1.2) r.value = 3;
      }),
    );
    inp('value', (v) => {
      const n = parse(v);
      if (Number.isFinite(n) && n > 0) set((r) => void (r.value = n));
    });
    inp('margin', (v) => {
      const n = parse(v);
      if (Number.isFinite(n) && n >= 0) set((r) => void (r.margin = n));
    });
    inp('sill', (v) => {
      const n = v.trim() === '' ? NaN : parse(v);
      set((r) => void (r.sill = Number.isFinite(n) && n >= 0 ? n : NaN));
    });
    sel('justify', (v) => set((r) => void (r.justify = v as FacadeRule['justify'])));
    sel('edges', (v) => {
      const face = ed.sel.face?.kind === 'side' ? ed.sel.face.edge : undefined;
      if (v === 'all') set((r) => void (r.edges = []), 'Rule on all sides.');
      else if (v === 'face' && face) set((r) => void (r.edges = [face]), 'Rule on this face only.');
      else if (v === 'addface' && face) set((r) => void (r.edges = [...new Set([...r.edges, face])]), 'Face added to the rule.');
    });
    row.querySelector('[data-rk="clearexc"]')?.addEventListener('click', () => set((r) => void (r.except = {}), 'Exceptions cleared.'));
    row.querySelector('[data-rk="pick"]')?.addEventListener('click', () => {
      const keys = ed.elements().filter((e) => e.key.startsWith(`r|${s?.id}|${id}|`)).map((e) => e.key);
      if (!keys.length) return ed.toast('This rule placed no element (faces too small or covered).');
      ed.select({ building: b.id, solids: s ? [s.id] : [], elems: keys });
    });
    row.querySelector('[data-rk="del"]')?.addEventListener('click', () => ed.changeSolid((x) => void (x.facade = x.facade.filter((f) => f.id !== id)), 'Rule removed.'));
  });
  // Component parameters.
  // Enter also applies on component parameters.
  $$<HTMLInputElement>('input[data-p]').forEach((el) => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      el.dispatchEvent(new Event('change'));
      e.preventDefault();
    }
  }));
  $$<HTMLInputElement | HTMLSelectElement>('[data-p]').forEach((el) =>
    el.addEventListener('change', () => {
      const k = el.dataset.p!;
      let v: unknown = val(el);
      if (el.dataset.bool) v = el.value === '1';
      else if (el instanceof HTMLInputElement && el.type !== 'color' && el.value.trim().startsWith('=')) {
        // A formula of the other parameters ("=width/2"): kept as written, worked out by the family.
        v = el.value.trim();
      } else if (el instanceof HTMLInputElement && el.type !== 'color') {
        let n = parse(el.value);
        if (!Number.isFinite(n)) return;
        // Out of the family's range: kept at the limit, and said so (a 30 m window would be clamped anyway).
        const lo = el.dataset.min !== undefined ? Number(el.dataset.min) : -Infinity,
          hi = el.dataset.max !== undefined ? Number(el.dataset.max) : Infinity;
        if (n < lo || n > hi) {
          n = Math.min(hi, Math.max(lo, n));
          el.value = num(n);
          queueMicrotask(() => ed.toast(`${el.getAttribute('aria-label') ?? k}: from ${num(lo)} to ${num(hi)}.`));
        }
        v = n;
      }
      if (ed.sel.elems.length && !(ed.activeItem() && ed.sel.elems.length <= 1)) ed.editElemsParam(k, v);
      else ed.setItemParam(k, v, el.dataset.scope === 'instance' ? 'instance' : 'type');
    }),
  );
  $$<HTMLButtonElement>('[data-reset]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.preventDefault();
      ed.resetItemParam(el.dataset.reset!);
    }),
  );
  // Bands and cornice.
  $$<HTMLButtonElement>('[data-band]').forEach((el) =>
    el.addEventListener('click', () => {
      let n = 0;
      ed.changeSolid((x, bb) => {
        n = addBands(bb, x, el.dataset.band as BandPreset);
        return n > 0;
      }, el.dataset.band === 'floors' ? 'Bands at the slabs.' : el.dataset.band === 'cornice' ? 'Cornice on top.' : 'Plinth band created.');
      if (!n) ed.toast('No slab inside this volume to receive a band.');
    }),
  );
  $$<HTMLElement>('[data-bandrow]').forEach((row) => {
    const id = row.dataset.bandrow!;
    const B = (x: Solid) => x.bands!.find((q) => q.id === id)!;
    row.querySelectorAll<HTMLInputElement>('input[data-bk]').forEach((el) => {
      el.addEventListener('change', () => {
        const v = parse(el.value);
        if (!Number.isFinite(v) || v < 0) return;
        ed.changeSolid((x) => void (B(x)[el.dataset.bk as 'y' | 'height' | 'depth'] = v));
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          el.dispatchEvent(new Event('change'));
          e.preventDefault();
        }
      });
    });
    row.querySelector<HTMLSelectElement>('select[data-bk="profile"]')?.addEventListener('change', (e) => ed.changeSolid((x) => void (B(x).profile = (e.target as HTMLSelectElement).value as 'flat' | 'cornice')));
    row.querySelector('[data-bk="del"]')?.addEventListener('click', () => ed.changeSolid((x) => void (x.bands = x.bands!.filter((q) => q.id !== id)), 'Band removed.'));
  });
  $$<HTMLSelectElement>('[data-bvprofile]').forEach((el) => el.addEventListener('change', () => ed.modelOp('bevel', { profile: parse(el.value) })));
  $$<HTMLSelectElement>('[data-walltype]').forEach((el) =>
    el.addEventListener('change', () => {
      const t = WALL_TYPES.find((w) => w.id === el.value);
      if (!t) return;
      ed.changeSolid((x) => {
        x.wallLayers = structuredClone(t.layers);
        x.shell = layersThickness(t.layers);
      }, `Wall type: ${t.name}.`);
    }),
  );
  $$<HTMLButtonElement>('[data-escope]').forEach((el) =>
    el.addEventListener('click', () => {
      ed.elemScope = el.dataset.escope === 'sel' ? 'sel' : 'type';
      ed.select({ ...ed.sel });
    }),
  );
  $$<HTMLButtonElement>('[data-sel]').forEach((el) => el.addEventListener('click', () => ed.selectElems(el.dataset.sel as 'row')));
  for (const el of $$<HTMLButtonElement>('[data-group]')) {
    const id = el.dataset.group!;
    el.addEventListener('click', (e) => ed.selectGroup(id, e));
    el.addEventListener('mouseenter', () => ed.previewElems(ed.elementGroups().find((g) => g.id === id)?.keys ?? null));
    el.addEventListener('mouseleave', () => ed.previewElems(null));
  }
  for (const el of $$<HTMLButtonElement>('[data-onlytype]'))
    el.addEventListener('click', () => {
      const keys = ed.elements().filter((x) => x.type === el.dataset.onlytype && ed.sel.elems.includes(x.key)).map((x) => x.key);
      ed.selectElemKeys(b.id, keys);
    });
  $$<HTMLButtonElement>('[data-align]').forEach((el) => el.addEventListener('click', () => ed.align(el.dataset.align as never)));
  $$<HTMLButtonElement>('[data-quick]').forEach((el) =>
    el.addEventListener('click', () => {
      const q = el.dataset.quick!;
      if (q === 'lvup' || q === 'lvdown') return void ed.change(b.id, (x) => changeLevels(x, q === 'lvup' ? 1 : -1), q === 'lvup' ? 'One more floor.' : 'One floor less.');
      if (!s) return;
      let made: string | null = null;
      const ok = ed.change(b.id, (x) => {
        const so = x.solids.find((y) => y.id === s.id)!;
        const n = q === 'setback' ? setbackOn(x, so) : q === 'podium' ? podiumUnder(x, so) : courtyardIn(x, so);
        if (!n) return false;
        made = n.id;
      }, q === 'setback' ? 'Setback created; the volume below became a terrace.' : q === 'podium' ? 'Podium with shops created.' : 'Courtyard cut.');
      if (ok && made) ed.select({ building: b.id, solids: [made] });
      else if (!ok) ed.toast('Does not fit: the volume is too small for that.');
    }),
  );
  $$<HTMLSelectElement>('[data-quick-facade]').forEach((el) =>
    el.addEventListener('change', () => {
      const pr = FACADE_PRESETS.find((f) => f.id === el.value);
      if (pr) ed.changeSolid((x) => void (x.facade = presetRules(pr.id, x)), `${pr.name} facade (door at the front).`);
    }),
  );
  // Actions.
  $$<HTMLButtonElement>('[data-act]').forEach((el) =>
    el.addEventListener('click', () => {
      const a = el.dataset.act!;
      if (a === 'enter') ed.enter(b.id);
      else if (a === 'dup') ed.duplicate();
      else if (a === 'railaround') ed.railAround();
      else if (a === 'cornerwin') ed.cornerWindow();
      else if (a === 'del') ed.remove();
      else if (a === 'mirror') ed.command('mirror');
      else if (a === 'unique') ed.makeUnique();
      else if (a === 'selectlot' && b.lotId) {
        ed.context = null;
        ed.selectSite({ lot: b.lotId });
      }
      else if (a === 'sizelock') {
        ed.sizeLock = !ed.sizeLock;
        ed.select({ ...ed.sel });
      }
      else if (a === 'design') {
        const it = ed.activeItem();
        const t = it && typeById(it.type, ed.project);
        if (!t) return;
        // A project type is edited in place; a library one starts a copy with its values.
        if (ed.project.types.some((x) => x.id === t.id)) openCreator(ed, { edit: t });
        else openCreator(ed, { family: t.family, start: { name: `${t.name} (mine)`, params: t.params } });
      }
      else if (a === 'levelsfit') ed.changeSolid((x, bb) => {
        const top = [...bb.levels].sort((p, q) => p.elevation - q.elevation).reduce((acc, l) => (l.elevation + l.height > x.base + 0.5 ? Math.max(acc, l.elevation + l.height) : acc), x.base + 3);
        x.height = top - x.base;
      }, 'Height equal to the floors.');
      else if (a === 'tohost' && s?.host) ed.select({ building: b.id, solids: [s.host.solid] });
      else if (a === 'noplinth' && s) {
        ed.changeSolid((x) => void (x.plinth = 0), 'Plinth removed.');
        ed.select({ building: b.id, solids: [s.id] });
      } else if (a === 'noparapet' && s) {
        ed.changeSolid((x) => void (x.roof.parapet = 0), 'Parapet removed.');
        ed.select({ building: b.id, solids: [s.id] });
      } else if (a === 'curtain') ed.curtainWall();
      else if (a === 'gable' && s && ed.sel.face?.edge) ed.changeSolid((x) => void ((x.edges[ed.sel.face!.edge!] ??= {}).gable = !x.edges[ed.sel.face!.edge!]?.gable), 'Gable changed.');
      else if (a === 'blank' && s && ed.sel.face?.edge) ed.changeSolid((x) => void ((x.edges[ed.sel.face!.edge!] ??= {}).blank = !x.edges[ed.sel.face!.edge!]?.blank));
      else if (a === 'split' && s && ed.sel.face?.edge) ed.changeSolid((x) => void splitEdgeOf(x, ed.sel.face!.edge!), 'Side split: drag the new point.');
      else if (a === 'delvertex') ed.remove();
      else if (a === 'addrule') ruleMenu(ed, el);
      else if (a === 'swapsel') swapMenu(ed, el);
      else if (a === 'vary') ed.elemAction('vary');
      else if (a === 'restore') ed.elemAction('restore');
      else if (a === 'detach') ed.elemAction('detach');
      else if (a === 'removesel') ed.elemAction('remove');
    }),
  );
}

function splitEdgeOf(s: Solid, edge: string): void {
  // Late import to avoid a cycle (ops ← editor).
  void import('../model/ops').then(() => undefined);
  const ring = [s.plan.outer, ...s.plan.holes].find((r) => r.some((v) => v.id === edge));
  if (!ring) return;
  const i = ring.findIndex((v) => v.id === edge);
  const a = ring[i]!,
    n = ring[(i + 1) % ring.length]!;
  delete a.bulge;
  ring.splice(i + 1, 0, { id: uid(), p: [(a.p[0] + n.p[0]) / 2, (a.p[1] + n.p[1]) / 2] });
}

const fmtNum = (v: number) => decimal(+v.toFixed(2));
/** Height of the building body (the highest additive volume). */
const bodyTop = (x: Building3) => Math.max(0, ...x.solids.filter((q) => q.op === 'add').map((q) => q.base + q.height));

function applyNumber(ed: Editor3, b: Building3, s: Solid | undefined, k: string, v: number): void {
  if (k === 'ground' || k === 'typical') {
    // New heights: the volumes follow their floors (model/quick.ts, setLevelHeights; model/relations.ts).
    const h0 = bodyTop(b);
    const ok = ed.change(b.id, (x) => {
      const lv = [...x.levels].sort((p, q) => p.elevation - q.elevation);
      const g = k === 'ground' ? Math.max(2.2, v) : (lv[0]?.height ?? 3);
      const t = k === 'typical' ? Math.max(2.2, v) : (lv[1]?.height ?? 3);
      setLevelHeights(x, lv.length, g, t);
    });
    const after = ed.store.building(b.id);
    if (ok && after && ed.store.changed) ed.toast(`${k === 'ground' ? 'Ground floor' : 'Other floors'} ${fmtNum(Math.max(2.2, v))} m · height ${fmtNum(h0)} → ${fmtNum(bodyTop(after))} m.`);
    return;
  }
  if (k === 'levels') {
    const n = Math.max(1, Math.min(60, Math.round(v)));
    // The same count is no change (and no history step).
    const cur = ed.store.building(b.id)?.levels.length ?? n;
    if (n === cur) return;
    // The same action as Floor + / Floor − (one path): the body grows or shrinks floor by floor and
    // what stands on it moves along. Before, the field only rewrote the floor list: with a setback,
    // 8 → 12 said "Floors changed." and nothing grew.
    const h0 = bodyTop(b);
    let made = cur;
    const ok = ed.change(b.id, (x) => {
      if (!changeLevels(x, n - cur)) return false;
      made = x.levels.length;
    });
    const after = ed.store.building(b.id);
    if (!ok || !after) return void ed.toast(n > cur ? `No more floors fit (at most 60).` : 'The ground floor stays: no floor to remove.');
    ed.toast(`${made} floors · height ${fmtNum(h0)} → ${fmtNum(bodyTop(after))} m${made !== n ? ` (${n} asked; the ground floor stays)` : ''}.`);
    return;
  }
  if (k === 'rotation') return void ed.change(b.id, (x) => void (x.rotation = v), '', false);
  if (k === 'px' || k === 'pz') return void ed.change(b.id, (x) => void (x.position = k === 'px' ? [v, x.position[1]] : [x.position[0], v]), '', false);
  // Elevation: absent = on the ground (as the green gizmo arrow writes it).
  if (k === 'py') return void ed.change(b.id, (x) => void (x.elevation = Math.abs(v) < 1e-6 ? undefined : v), '', false);
  if (k === 'acount' || k === 'aspace' || k === 'rcount' || k === 'rspace') {
    const it = ed.activeItem();
    if (!it) return;
    ed.change(b.id, (x) => {
      const y = x.items.find((q) => q.id === it.id)!;
      const fam = family(typeById(y.type, ed.project)?.family ?? '');
      const w = fam ? fam.size(resolveParams(fam, typeById(y.type, ed.project)?.params, y.params))[0] : 1;
      y.array ??= { along: { mode: 'spacing', value: Math.round((w + 1) * 10) / 10, count: 1 } };
      if (k === 'acount') y.array.along.count = Math.max(1, Math.round(v));
      if (k === 'aspace') y.array.along.value = Math.max(0.1, v);
      if (k === 'rcount') y.array.across = { count: Math.max(1, Math.round(v)), spacing: y.array.across?.spacing ?? 3 };
      if (k === 'rspace') y.array.across = { count: y.array.across?.count ?? 1, spacing: Math.max(0.1, v) };
      if (y.array.along.count === 1 && (y.array.across?.count ?? 1) === 1) delete y.array;
    });
    return;
  }
  if (!s) return;
  if (k === 'bvtop' || k === 'bvbottom' || k === 'bvseg') return void ed.modelOp('bevel', k === 'bvtop' ? { top: v } : k === 'bvbottom' ? { bottom: v } : { segments: v });
  if (k === 'edgebevel') return void ed.modelOp('edge-bevel', { w: v });
  if (k === 'cround') return void ed.modelOp('corner', { round: v });
  if (k === 'cchamfer') return void ed.modelOp('corner', { chamfer: v });
  if (k === 'sizew' || k === 'sized' || (k === 'height' && ed.sizeLock)) {
    const bx = planBox(s);
    const w0 = bx.x1 - bx.x0,
      d0 = bx.z1 - bx.z0;
    if (!ed.sizeLock) return void ed.modelOp('size', k === 'sizew' ? { w: v, d: d0 } : { w: w0, d: v });
    // Proportions kept: the other two follow by the same ratio (one history step).
    const r = k === 'sizew' ? v / w0 : k === 'sized' ? v / d0 : v / s.height;
    if (!(r > 0) || !Number.isFinite(r)) return;
    ed.modelOp('size', { w: w0 * r, d: d0 * r });
    const after = ed.activeSolid();
    if (after) ed.changeSolid((x) => void (x.height = Math.max(0.3, s.height * r)), `Scaled ×${fmtNum(Math.round(r * 100) / 100)} (proportions kept).`);
    return;
  }
  ed.changeSolid((x) => {
    if (k === 'height') x.height = Math.max(0.3, v);
    else if (k === 'base') x.base = v;
    else if (k === 'taper') x.taper = Math.max(0, v);
    else if (k === 'shell') {
      // A thickness typed by hand: the wall is no longer of a type.
      delete x.wallLayers;
      if (v > 0.01) x.shell = Math.min(5, v);
      else delete x.shell;
    } else if (k === 'twist') {
      if (Math.abs(v) > 0.01) x.twist = Math.max(-360, Math.min(360, v));
      else delete x.twist;
    } else if (k === 'loftscale' && x.loft) x.loft.scale = Math.max(0.05, Math.min(4, v));
    else if (k === 'loftturn' && x.loft) x.loft.turn = Math.max(-360, Math.min(360, v));
    else if ((k === 'loftmid' || k === 'loftmidturn') && x.loft) {
      const m = x.loft.mids?.[0] ?? { at: 0.5, scale: 1, turn: 0 };
      if (k === 'loftmid') m.scale = Math.max(0.05, Math.min(4, v));
      else m.turn = Math.max(-360, Math.min(360, v));
      // A straight middle is no section.
      if (Math.abs(m.scale - 1) < 1e-3 && Math.abs(m.turn) < 1e-3) delete x.loft.mids;
      else x.loft.mids = [m];
    }
    else if (k === 'revseg' && x.revolve) x.revolve.segments = Math.max(8, Math.min(96, Math.round(v)));
    else if (k === 'repcount' && x.repeat) x.repeat.count = Math.max(1, Math.min(64, Math.round(v)));
    else if (k === 'repdx' && x.repeat?.kind === 'line') x.repeat.dx = v;
    else if (k === 'repdz' && x.repeat?.kind === 'line') x.repeat.dz = v;
    else if (k === 'repcx' && (x.repeat?.kind === 'ring' || x.repeat?.kind === 'helix')) x.repeat.cx = v;
    else if (k === 'repcz' && (x.repeat?.kind === 'ring' || x.repeat?.kind === 'helix')) x.repeat.cz = v;
    else if (k === 'reprise' && x.repeat?.kind === 'helix') x.repeat.rise = Math.max(-50, Math.min(50, v));
    else if (k === 'repturn' && x.repeat?.kind === 'helix') x.repeat.turn = Math.max(-360, Math.min(360, v));
    // Every corner, each limited to half its shorter side (modelling 'corner' does the same).
    else if (k === 'round') x.plan.outer.forEach((q, i) => (q.round = v > 0 ? Math.min(v, cornerLimit(x.plan.outer, i)) : undefined));
    else if (k === 'chamfer') x.plan.outer.forEach((q, i) => (q.chamfer = v > 0 ? Math.min(v, cornerLimit(x.plan.outer, i)) : undefined));
    else if (k === 'cx' || k === 'cz') {
      const c = centerOf(x);
      translateSolid(x, k === 'cx' ? v - c[0] : 0, k === 'cz' ? v - c[1] : 0);
    } else if (k === 'spin') rotateSolid(x, v);
    else if (k === 'parapet') x.roof.parapet = Math.max(0, v);
    else if (k === 'plinth') x.plinth = Math.max(0, v);
    else if (k === 'pitch') x.roof.pitch = Math.max(3, Math.min(75, v));
    else if (k === 'overhang') x.roof.overhang = Math.max(0, v);
    else if (k === 'direction') x.roof.direction = v;
    else if (k === 'rise') x.roof.rise = Math.max(0, v);
    else if (k === 'lean' && ed.sel.face?.edge) (x.edges[ed.sel.face.edge] ??= {}).lean = Math.max(-45, Math.min(45, v));
    else if (k === 'edgepitch' && ed.sel.face?.edge) {
      const es = (x.edges[ed.sel.face.edge] ??= {});
      // The roof's own pitch typed back: the side follows the roof again.
      if (Math.abs(v - x.roof.pitch) < 0.01) delete es.pitch;
      else es.pitch = Math.max(3, Math.min(75, v));
    }
    else if (k === 'push' && ed.sel.face?.edge) return void import('../model/ops').then(() => undefined);
  });
  if (k === 'push' && ed.sel.face?.edge && v !== 0) void import('../model/ops').then((ops) => ed.changeSolid((x) => ops.pushEdge(x, ed.sel.face!.edge!, v), `Face moved ${num(v)} m.`));
}

/** Type menu for a new rule (windows and doors first). */
function ruleMenu(ed: Editor3, anchor: HTMLElement): void {
  const types = BUILTIN_TYPES.concat(ed.project.types).filter((t) => family(t.family)?.host === 'face');
  // With a face chosen, the rule applies to that side only (front door, shopfront).
  const edge = ed.sel.face?.kind === 'side' ? ed.sel.face.edge : undefined;
  menu(anchor, types.map((t) => {
    const door = family(t.family)!.category === 'doors';
    return [t.name, () => ed.changeSolid((x) => void x.facade.push(facadeRule(t.id, { levels: door ? 'ground' : 'all', mode: door ? 'count' : 'max', value: door ? 1 : 3, edges: edge ? [edge] : [] })), `Rule: ${t.name}${edge ? ' on this face' : ' on all sides'}.`)] as [string, () => void];
  }));
}

function swapMenu(ed: Editor3, anchor: HTMLElement): void {
  const types = BUILTIN_TYPES.concat(ed.project.types).filter((t) => family(t.family)?.host === 'face');
  menu(anchor, types.map((t) => [t.name, () => ed.elemAction('swap', t.id)] as [string, () => void]));
}

function menu(anchor: HTMLElement, items: [string, () => void][]): void {
  document.querySelector('.f3-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'f3-menu';
  m.innerHTML = items.map(([l], i) => `<button data-i="${i}">${esc(l)}</button>`).join('');
  const root = anchor.closest('.f3') as HTMLElement;
  root.appendChild(m);
  const r = anchor.getBoundingClientRect(),
    rr = root.getBoundingClientRect();
  m.style.left = `${Math.min(r.left - rr.left, rr.width - 230)}px`;
  m.style.top = `${Math.min(r.bottom - rr.top + 4, rr.height - 320)}px`;
  m.style.maxHeight = '300px';
  m.style.overflow = 'auto';
  m.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      items[Number(b.dataset.i)]![1]();
      m.remove();
    }),
  );
  closeOnOutside(m, () => m.remove());
}

export { allFamilies };
