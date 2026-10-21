// Panels of the site (a lot or a street selected on the ground): a lot's setbacks, a ready building in
// what they leave, the split in equal fronts and its indices; a street's widths, the lots and the trees
// along it. The data and the geometry are model/site.ts; the tools that draw them, editor/tools/site.ts.
import type { Editor3 } from '../editor/editor';
import type { Project3, Street } from '../model/schema';
import { buildableArea, buildOnLot, insideRing, lotsAlongStreet, ribbon, splitLot, treeItems, treesAlong, DEFAULT_SETBACKS, type BuildKind, type Lot } from '../model/site';
import { building, uid } from '../model/defaults';
import { lotIndices, outerRing, planArea } from '../model/lots';

const boxRing = (r: [number, number][]): [number, number][] => {
  const xs = r.map((p) => p[0]),
    zs = r.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
};
import { icon } from './icons';
import { withModifiers } from '../eval/modifiers';
import { evalExpr } from '../model/expr';
import { gicon, gtext, numCell, prow } from './kit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => String(Math.round(v * 100) / 100);
const parse = (s: string) => evalExpr(s) ?? parseFloat(s.replace(',', '.'));
const m2 = (v: number) => `${num(Math.round(v * 10) / 10)} m²`;
const cell = (attr: string, name: string, value: number, glyph: string, unit = 'm', step = 0.5) => numCell({ attr, name, value, glyph, unit, step });

/** Panel of the selected lot or street (empty when neither). */
export function sitePanel(ed: Editor3): string {
  const { lot, street } = ed.sitePick;
  const l = lot ? ed.project.lots.find((x) => x.id === lot) : undefined;
  if (l) return lotPanel(ed.project, l);
  const st = street ? ed.project.streets?.find((x) => x.id === street) : undefined;
  return st ? streetPanel(st) : '';
}

function lotPanel(p: Project3, l: Lot): string {
  const sb = l.rules?.setbacks ?? DEFAULT_SETBACKS;
  const area = buildableArea(l);
  const rows: [string, string][] = [['Lot area', m2(Math.abs(planArea(l.polygon)))], ['Buildable area', area ? m2(Math.abs(planArea(area))) : 'none: the setbacks cover the lot']];
  const li = lotIndices({ ...p, buildings: p.buildings.map(withModifiers) }, l.id);
  const built = p.buildings.filter((b) => b.lotId === l.id).length;
  if (li && built) rows.push(['Buildings', String(built)], ['Occupancy', `${num(Math.round(li.occupancy * 1000) / 10)} %`], ['Floor area ratio', num(Math.round(li.far * 100) / 100)], ['Permeable', `${num(Math.round(li.permeable * 1000) / 10)} %`]);
  const btn = (kind: BuildKind, ic: string, label: string, title: string) => `<button class="f3-btn" data-build="${kind}" title="${title}"${area ? '' : ' disabled'}>${icon(ic)}${label}</button>`;
  return `<div class="f3-title"><input data-lot="name" value="${esc(l.name)}" aria-label="Lot name"><span class="f3-kind">Lot</span></div>
  <div class="f3-sec"><h3>Setbacks</h3>
    ${prow('Front', 'distance', [cell('data-sb="front"', 'Front setback (the side on the street)', sb.front, gtext('F'))])}
    ${prow('Sides', 'distance', [cell('data-sb="side"', 'Side setbacks (0: the house touches the neighbour)', sb.side, gtext('S')), cell('data-sb="back"', 'Back setback', sb.back, gtext('B'))])}
    <div class="f3-btns n2"><button class="f3-btn" data-lotact="front" title="The street is on another side of the lot">${icon('rot90')}Front: next side</button><button class="f3-btn danger" data-lotact="delete" title="Delete the lot (its buildings stay)">${icon('trash')}Delete</button></div>
  </div>
  <div class="f3-sec"><h3>Build in the buildable area</h3>
    <div class="f3-btns">${btn('house', 'home', 'House', 'A one-floor house with a hip roof filling the buildable area')}${btn('residential', 'floors', 'Block', 'A five-floor residential block')}${btn('commercial', 'opening', 'Shops', 'Three floors with shopfronts on the ground floor')}</div>
  </div>
  <div class="f3-sec"><h3>Split</h3>
    ${prow('Lots', 'split', [cell('data-splitn', 'Number of lots of equal front', 2, gicon('count'), '', 1)], { title: 'Split this lot in lots of equal front' })}
    <div class="f3-btns n2"><button class="f3-btn" data-lotact="split"${l.polygon.length === 4 ? '' : ' disabled'} title="${l.polygon.length === 4 ? 'Split along the front' : 'Only a four-sided lot splits'}">${icon('split')}Split</button></div>
  </div>
  <div class="f3-sec"><h3>Information</h3><dl class="f3-info">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`;
}

function streetPanel(st: Street): string {
  let length = 0;
  for (let i = 1; i < st.points.length; i++) length += Math.hypot(st.points[i]![0] - st.points[i - 1]![0], st.points[i]![1] - st.points[i - 1]![1]);
  return `<div class="f3-title"><input data-street="name" value="${esc(st.name)}" aria-label="Street name"><span class="f3-kind">Street</span></div>
  <div class="f3-sec"><h3>Section</h3>
    ${prow('Asphalt', 'distance', [cell('data-st="width"', 'Asphalt width (2 to 60 m)', st.width, gtext('W'))])}
    ${prow('Sidewalk', 'distance', [cell('data-st="sidewalk"', 'Sidewalk width on each side', st.sidewalk, gtext('S'))])}
    <dl class="f3-info"><dt>Length</dt><dd>${num(Math.round(length * 10) / 10)} m</dd></dl>
  </div>
  <div class="f3-sec"><h3>Lots along the street</h3>
    ${prow('Lot', 'rect', [cell('data-alongf', 'Front of each lot', 12, gtext('F'), 'm', 1), cell('data-alongd', 'Depth of each lot', 30, gtext('D'), 'm', 1)], { title: 'Size of each lot' })}
    <div class="f3-btns n2"><button class="f3-btn" data-stact="lots" title="Lots on both sides, behind the sidewalks">${icon('lot')}Lay lots</button></div>
  </div>
  <div class="f3-sec"><h3>Trees</h3>
    ${prow('Every', 'spacing', [cell('data-treesp', 'Distance between trees', 8, gtext('↔'), 'm', 1)])}
    <div class="f3-btns n2"><button class="f3-btn" data-stact="trees" title="Trees on both sidewalks">${icon('tree')}Plant trees</button><button class="f3-btn danger" data-stact="delete" title="Delete the street">${icon('trash')}Delete</button></div>
  </div>`;
}

/** Wires the panel just drawn into `side`. */
export function bindSitePanel(ed: Editor3, side: HTMLElement): void {
  const $$ = <T extends HTMLElement>(q: string) => [...side.querySelectorAll<T>(q)];
  const lotId = ed.sitePick.lot,
    stId = ed.sitePick.street;
  const lotOf = (p: Project3) => p.lots.find((l) => l.id === lotId);
  const stOf = (p: Project3) => p.streets?.find((s) => s.id === stId);
  const numOf = (q: string, def: number) => {
    const v = parse(side.querySelector<HTMLInputElement>(q)?.value ?? '');
    return Number.isFinite(v) ? v : def;
  };
  // Lot.
  $$<HTMLInputElement>('[data-lot="name"]').forEach((el) => el.addEventListener('change', () => ed.changeSite((p) => void (lotOf(p)!.name = el.value.slice(0, 60) || 'Lot'))));
  $$<HTMLInputElement>('[data-sb]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = parse(el.value);
      if (!Number.isFinite(v) || v < 0 || v > 50) return ed.toast('A setback is between 0 and 50 m.');
      ed.changeSite((p) => {
        const l = lotOf(p)!;
        l.rules ??= { setbacks: { ...DEFAULT_SETBACKS }, enforcement: 'warn' };
        l.rules.setbacks[el.dataset.sb as 'front' | 'side' | 'back'] = v;
      });
    }),
  );
  $$<HTMLButtonElement>('[data-build]').forEach((el) =>
    el.addEventListener('click', () => {
      const l = lotOf(ed.project);
      if (!l) return;
      const kind = el.dataset.build as BuildKind;
      const names = { house: 'House', residential: 'Block', commercial: 'Shops' } as const;
      const b = buildOnLot(l, kind, `${names[kind]} on ${l.name}`);
      if (!b) return ed.toast('Nothing left to build on: lower the setbacks.');
      ed.changeSite((p) => void p.buildings.push(b), `${b.name}: it fills the buildable area. Edit it like any building.`);
      ed.select({ building: b.id });
    }),
  );
  $$<HTMLButtonElement>('[data-lotact]').forEach((el) =>
    el.addEventListener('click', () => {
      const act = el.dataset.lotact;
      if (act === 'delete') return void ed.deleteSite();
      if (act === 'front')
        return void ed.changeSite((p) => {
          const l = lotOf(p)!;
          l.frontEdges = [((l.frontEdges[0] ?? 0) + 1) % l.polygon.length];
        }, 'The front of the lot is on the next side.');
      if (act === 'split') {
        const n = Math.round(numOf('[data-splitn]', 2));
        if (n < 2 || n > 50) return ed.toast('Split in 2 to 50 lots.');
        const l = lotOf(ed.project);
        if (!l) return;
        const parts = splitLot(l, n, () => uid());
        ed.changeSite((p) => {
          const i = p.lots.findIndex((x) => x.id === l.id);
          p.lots.splice(i, 1, ...parts);
          // The buildings on it go to the new lot under their position (or stay without a lot).
          for (const b of p.buildings) if (b.lotId === l.id) b.lotId = parts.find((q) => insideRing(b.position, q.polygon))?.id ?? null;
        }, `${l.name} split in ${n} lots of equal front.`);
        ed.selectSite({ lot: parts[0]!.id });
      }
    }),
  );
  // Street.
  $$<HTMLInputElement>('[data-street="name"]').forEach((el) => el.addEventListener('change', () => ed.changeSite((p) => void (stOf(p)!.name = el.value.slice(0, 60) || 'Street'))));
  $$<HTMLInputElement>('[data-st]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = parse(el.value);
      const k = el.dataset.st as 'width' | 'sidewalk';
      if (!Number.isFinite(v) || (k === 'width' ? v < 2 || v > 60 : v < 0 || v > 15)) return ed.toast(k === 'width' ? 'The asphalt is 2 to 60 m wide.' : 'A sidewalk is 0 to 15 m wide.');
      ed.changeSite((p) => void (stOf(p)![k] = v));
    }),
  );
  $$<HTMLButtonElement>('[data-stact]').forEach((el) =>
    el.addEventListener('click', () => {
      const st = stOf(ed.project);
      if (!st) return;
      const act = el.dataset.stact;
      if (act === 'delete') return void ed.deleteSite();
      if (act === 'lots') {
        const f = numOf('[data-alongf]', 12),
          d = numOf('[data-alongd]', 30);
        if (f < 4 || f > 200 || d < 4 || d > 200) return ed.toast('A lot is 4 to 200 m on each side.');
        // Clear of the lots already there and of the other streets (a convex piece each).
        const avoid = [
          ...ed.project.lots.filter((l) => l.polygon.length === 4).map((l) => l.polygon),
          ...(ed.project.streets ?? []).filter((s) => s.id !== st.id).flatMap((s) => ribbon(s.points, 0, s.width / 2 + s.sidewalk)),
          // The buildings already standing (each volume's box, a convex stand-in for any plan).
          ...ed.project.buildings.flatMap((b) => b.solids.filter((s) => s.op === 'add').map((s) => boxRing(outerRing(b, s)))),
        ];
        const lots = lotsAlongStreet(st, f, d, () => uid(), st.name, avoid);
        if (!lots.length) return ed.toast('The street is too short for a lot of that front.');
        if (ed.project.lots.length + lots.length > 500) return ed.toast('At most 500 lots in a project.');
        ed.changeSite((p) => void p.lots.push(...lots), `${lots.length} lots of ${num(f)} × ${num(d)} m along ${st.name}.`);
        return;
      }
      if (act === 'trees') {
        const sp = numOf('[data-treesp]', 8);
        if (sp < 3 || sp > 100) return ed.toast('Trees 3 to 100 m apart.');
        const pts = treesAlong(st, sp, ed.project);
        if (!pts.length) return ed.toast('The street is too short for trees that far apart.');
        // The street keeps its spacing: its trees follow it when it changes (model/site.ts, replantStreetTrees).
        ed.changeSite((p) => void (stOf(p)!.trees = sp), `${pts.length} trees along ${st.name}; they follow the street when it changes.`);
        ed.selectSite({ street: st.id });
      }
    }),
  );
}
