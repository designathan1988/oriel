// Interior panels (Revit's wall and room properties, ArchiCAD's wall and zone settings): the wall selected
// (thickness, length, its doors: width, height, position, delete; add a door; delete the wall), the room
// selected (name, area, floor finish, delete) and, with neither, the interior defaults (thickness of new
// walls, the rooms of the floor shown). Data: Building3.interiors (eval/interiorwalls.ts).
import type { Editor3 } from '../editor/editor';
import type { Building3, ID, MaterialRef } from '../model/schema';
import { interiorDoors, roomArea, type InteriorWithDoors } from '../eval/interiorwalls';
import { icon } from './icons';
import { gicon, gtext, numCell, prow, selectCell } from './kit';
import { evalExpr } from '../model/expr';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => String(Math.round(v * 100) / 100);
const parse = (s: string) => evalExpr(s) ?? parseFloat(s.replace(',', '.'));
const cell = (attr: string, name: string, value: number, glyph: string, unit = 'm', step = 0.05) => numCell({ attr, name, value, glyph, unit, step });

const FLOORS: [string, string, MaterialRef][] = [
  ['none', 'Slab (no finish)', { finish: 'floor', color: '#c9b79a' }],
  ['tile', 'Ceramic tile', { finish: 'floor', color: '#d8d2c4', color2: '#a29a8d' }],
  ['wood', 'Wood floor', { finish: 'wood', color: '#a8774a' }],
  ['stone', 'Stone', { finish: 'stone', color: '#cfc7b8' }],
  ['concrete', 'Polished concrete', { finish: 'concrete', color: '#9b9a96' }],
  ['carpet', 'Carpet', { finish: 'paint', color: '#7a8a9a' }],
];

function wallLength(b: Building3, level: ID, wall: ID): number {
  const it = b.interiors[level];
  const w = it?.walls.find((q) => q.id === wall);
  const a = it?.nodes.find((n) => n.id === w?.a)?.p,
    c = it?.nodes.find((n) => n.id === w?.b)?.p;
  return a && c ? Math.hypot(c[0] - a[0], c[1] - a[1]) : 0;
}

/** The panel, or '' when there is nothing interior to show. */
export function interiorPanel(ed: Editor3, b: Building3): string {
  const ws = ed.iwallSel,
    rs = ed.roomSel;
  if (ws) {
    const it = b.interiors[ws.level] as InteriorWithDoors | undefined;
    const w = it?.walls.find((q) => q.id === ws.wall);
    if (!it || !w) return '';
    const len = wallLength(b, ws.level, ws.wall);
    const doors = interiorDoors(it).map((d, i) => ({ d, i })).filter((x) => x.d.wall === w.id);
    return `<div class="f3-title"><span style="flex:1;font-weight:600">Interior wall</span><span class="f3-kind">Wall</span></div>
    <div class="f3-sec"><h3>Wall</h3>
      ${prow('Thickness', 'thickness', [cell('data-iw="thickness"', 'Wall thickness', w.thickness, gicon('thickness'))])}
      ${prow('Length', 'distance', [cell('data-iw="length"', 'Length (the end point moves)', len, gtext('L'), 'm', 0.1)])}
      <div class="f3-btns n2"><button class="f3-btn" data-iwact="door">${icon('door')}Add door</button><button class="f3-btn danger" data-iwact="delete">${icon('trash')}Delete wall</button></div>
    </div>
    ${doors.map(({ d, i }, k) => `<div class="f3-sec"><h3>Door ${k + 1}</h3>
      ${prow('Size', 'scale', [cell(`data-door="${i}" data-dk="width"`, 'Door width', d.width, gtext('W')), cell(`data-door="${i}" data-dk="height"`, 'Door height', d.height, gtext('H'))])}
      ${prow('Position', 'distance', [cell(`data-door="${i}" data-dk="u"`, 'Distance from the start of the wall to the middle of the door', d.u, gtext('↔'), 'm', 0.1)])}
      <div class="f3-btns n2"><button class="f3-btn danger" data-doordel="${i}">${icon('trash')}Delete door</button></div></div>`).join('')}`;
  }
  if (rs) {
    const room = b.interiors[rs.level]?.rooms.find((r) => r.id === rs.room);
    if (!room) return '';
    const area = room.polygon ? roomArea(room.polygon) : room.area ?? 0;
    const cur = FLOORS.find(([, , m]) => room.finish && m.finish === room.finish.finish && m.color === room.finish.color)?.[0] ?? (room.finish ? 'custom' : 'none');
    let per = 0;
    if (room.polygon) for (let i = 0; i < room.polygon.length; i++) per += Math.hypot(room.polygon[(i + 1) % room.polygon.length]![0] - room.polygon[i]![0], room.polygon[(i + 1) % room.polygon.length]![1] - room.polygon[i]![1]);
    return `<div class="f3-title"><input data-room="name" value="${esc(room.name)}" aria-label="Room name" maxlength="60"><span class="f3-kind">Room</span></div>
    <div class="f3-sec"><h3>Floor</h3>
      ${prow('Finish', 'material', [selectCell('data-room="finish"', 'Floor finish', [...FLOORS.map(([id, name]) => [id, name] as const), ...(cur === 'custom' ? [['custom', 'Custom'] as const] : [])], cur)], { wide: true })}
      ${room.finish ? prow('Color', 'palette', [`<label class="f3-cell col" title="Floor color"><input type="color" data-room="color" value="${room.finish.color}" aria-label="Floor color"></label>`]) : ''}
    </div>
    <div class="f3-sec"><h3>Information</h3><dl class="f3-info"><dt>Area</dt><dd>${num(area)} m²</dd><dt>Perimeter</dt><dd>${num(per)} m</dd><dt>Walls</dt><dd>${room.wallIds.length}</dd></dl>
      <div class="f3-btns n2"><button class="f3-btn danger" data-roomdel>${icon('trash')}Delete room</button></div></div>`;
  }
  if (ed.tool !== 'iwall' && ed.tool !== 'room') return '';
  const lvId = [...b.levels].sort((p, q) => p.elevation - q.elevation)[Math.min(b.levels.length - 1, Math.max(0, ed.project.view?.cutLevel ?? 0))]?.id;
  const it = lvId ? b.interiors[lvId] : undefined;
  const rooms = it?.rooms ?? [];
  const total = rooms.reduce((a, r) => a + (r.polygon ? roomArea(r.polygon) : r.area ?? 0), 0);
  return `<div class="f3-title"><span style="flex:1;font-weight:600">Interior</span><span class="f3-kind">${esc(b.name)}</span></div>
  <div class="f3-sec"><h3>New walls</h3>${prow('Thickness', 'thickness', [cell('data-idef="thickness"', 'Thickness of the walls you draw next', ed.iwallThickness, gicon('thickness'))])}
    <p class="f3-empty" style="padding:4px 0 0">Interior walls: click points on the floor (Enter ends) · Room: click inside walls or drag a rectangle · drag a corner dot to move it, click a wall dot to edit it.</p></div>
  <div class="f3-sec"><h3>Rooms on this floor</h3>${rooms.length ? `<dl class="f3-info">${rooms.map((r) => `<dt><button class="f3-link" data-roompick="${r.id}">${esc(r.name)}</button></dt><dd>${num(r.polygon ? roomArea(r.polygon) : r.area ?? 0)} m²</dd>`).join('')}<dt><b>Total</b></dt><dd><b>${num(total)} m²</b></dd></dl>` : '<p class="f3-empty" style="padding:0">No room yet.</p>'}
    <div class="f3-btns n2"><button class="f3-btn" data-iwact="copyup">${icon('floors')}Copy walls up</button><button class="f3-btn" data-iwact="stair">${icon('floorUp')}Stair up</button></div></div>`;
}

export function bindInteriorPanel(ed: Editor3, b: Building3, side: HTMLElement): void {
  const $$ = <T extends HTMLElement>(q: string) => [...side.querySelectorAll<T>(q)];
  const ws = ed.iwallSel,
    rs = ed.roomSel;
  const itOf = (x: Building3, level: ID) => x.interiors[level] as InteriorWithDoors;
  $$<HTMLInputElement>('[data-idef="thickness"]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = parse(el.value);
      if (Number.isFinite(v) && v >= 0.05 && v <= 1.5) {
        ed.iwallThickness = v;
        ed.toast(`New interior walls ${num(v)} m thick.`);
      }
    }),
  );
  $$<HTMLButtonElement>('[data-roompick]').forEach((el) =>
    el.addEventListener('click', () => {
      const lvId = [...b.levels].sort((p, q) => p.elevation - q.elevation)[Math.min(b.levels.length - 1, Math.max(0, ed.project.view?.cutLevel ?? 0))]!.id;
      ed.roomSel = { level: lvId, room: el.dataset.roompick! };
      ed.iwallSel = null;
      ed.select({ ...ed.sel });
    }),
  );
  $$<HTMLButtonElement>('[data-iwact]').forEach((el) =>
    el.addEventListener('click', () => {
      const a = el.dataset.iwact;
      if (a === 'copyup') return ed.replicateFloor();
      if (a === 'stair') return ed.stairUp();
      if (!ws) return;
      if (a === 'delete') {
        ed.change(b.id, (x) => {
          const it = itOf(x, ws.level);
          it.walls = it.walls.filter((w) => w.id !== ws.wall);
          if (it.doors) it.doors = it.doors.filter((d) => d.wall !== ws.wall);
          const used = new Set(it.walls.flatMap((w) => [w.a, w.b]));
          it.nodes = it.nodes.filter((n) => used.has(n.id));
        }, 'Interior wall deleted.');
        ed.iwallSel = null;
        return ed.select({ ...ed.sel });
      }
      if (a === 'door') {
        const len = wallLength(b, ws.level, ws.wall);
        ed.change(b.id, (x) => {
          const it = itOf(x, ws.level);
          it.doors = [...interiorDoors(it), { wall: ws.wall, u: len / 2, width: Math.min(0.9, Math.max(0.6, len - 0.3)), height: 2.1 }];
        }, 'Door added in the middle of the wall.');
      }
    }),
  );
  $$<HTMLInputElement>('[data-iw]').forEach((el) =>
    el.addEventListener('change', () => {
      if (!ws) return;
      const v = parse(el.value);
      if (!Number.isFinite(v) || v <= 0) return;
      ed.change(b.id, (x) => {
        const it = itOf(x, ws.level);
        const w = it.walls.find((q) => q.id === ws.wall)!;
        if (el.dataset.iw === 'thickness') w.thickness = Math.max(0.05, Math.min(1.5, v));
        else {
          // Length: the end node slides along the wall.
          const a = it.nodes.find((n) => n.id === w.a)!.p,
            c = it.nodes.find((n) => n.id === w.b)!;
          const L = Math.hypot(c.p[0] - a[0], c.p[1] - a[1]) || 1;
          c.p = [a[0] + ((c.p[0] - a[0]) * v) / L, a[1] + ((c.p[1] - a[1]) * v) / L];
        }
      }, el.dataset.iw === 'thickness' ? `Wall ${num(v)} m thick.` : `Wall ${num(v)} m long.`);
    }),
  );
  $$<HTMLInputElement>('[data-door]').forEach((el) =>
    el.addEventListener('change', () => {
      if (!ws) return;
      const v = parse(el.value);
      if (!Number.isFinite(v) || v < 0) return;
      ed.change(b.id, (x) => {
        const d = interiorDoors(itOf(x, ws.level))[Number(el.dataset.door)];
        if (d) d[el.dataset.dk as 'width' | 'height' | 'u'] = v;
      }, 'Door changed.');
    }),
  );
  $$<HTMLButtonElement>('[data-doordel]').forEach((el) =>
    el.addEventListener('click', () => {
      if (!ws) return;
      ed.change(b.id, (x) => {
        const it = itOf(x, ws.level);
        it.doors = interiorDoors(it).filter((_, i) => i !== Number(el.dataset.doordel));
      }, 'Door deleted.');
    }),
  );
  // Room.
  const room = (x: Building3) => (rs ? x.interiors[rs.level]?.rooms.find((r) => r.id === rs.room) : undefined);
  $$<HTMLInputElement>('[data-room="name"]').forEach((el) => el.addEventListener('change', () => ed.change(b.id, (x) => void (room(x)!.name = el.value.trim().slice(0, 60) || 'Room'), '', false)));
  $$<HTMLSelectElement>('[data-room="finish"]').forEach((el) =>
    el.addEventListener('change', () => {
      const f = FLOORS.find(([id]) => id === el.value);
      if (!f) return;
      ed.change(b.id, (x) => {
        const r = room(x)!;
        if (f[0] === 'none') delete r.finish;
        else r.finish = structuredClone(f[2]);
      }, `Floor: ${f[1]}.`);
    }),
  );
  $$<HTMLInputElement>('[data-room="color"]').forEach((el) =>
    el.addEventListener('change', () => ed.change(b.id, (x) => {
      const r = room(x)!;
      if (r.finish) r.finish = { ...r.finish, color: el.value };
    })),
  );
  $$<HTMLButtonElement>('[data-roomdel]').forEach((el) =>
    el.addEventListener('click', () => {
      if (!rs) return;
      ed.change(b.id, (x) => {
        const it = x.interiors[rs.level]!;
        it.rooms = it.rooms.filter((r) => r.id !== rs.room);
      }, 'Room deleted (its walls stay).');
      ed.roomSel = null;
      ed.select({ ...ed.sel });
    }),
  );
}

