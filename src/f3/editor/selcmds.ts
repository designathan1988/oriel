// Selection commands of the editor: sub-elements (vertex, edge, face), select all / similar, hide, isolate, selection sets, the marquee, facade elements and their actions.
import * as THREE from 'three';
import type { Building3, ID, Solid, Vec3 } from '../model/schema';
import { uid } from '../model/defaults';
import { inside, findSolid } from '../model/ops';
import { buildingHidden, buildingLocked, ensureLayers, itemHidden, itemLocked, solidHidden, solidLocked, viewOf } from '../model/layers';
import { boxPicks, combine, marqueeRect, selMode } from './selection';
import { segDistance, subElements, type SubEdge, type SubVertex } from '../eval/subelements';
import { invert, nextSetName, pickableBuildings, pickableSolids, recallSet, saveSet, similarBuildings, similarSolids } from '../model/selsets';
import { family, typeById } from '../families/index';
import { CATEGORY_NAMES } from '../families/family';
import { column, elemKey, elementsOf, groupElements, grow, row, rowOnFace, sameFace, sameType, shift, shrink, type Elem, type GroupRow } from './elements';
import { type Selection, type Mods, partHostFace, faceSelOf } from './support';
import type { Editor3 } from './editor';

export function subOf(ed: Editor3, b: Building3, s: Solid): { verts: SubVertex[]; edges: SubEdge[] } {
  const key = `${b.id}|${s.id}|${ed.store.revision.get(b.id) ?? 0}|${JSON.stringify(s.plan)}|${s.height}|${s.base}|${s.taper}`;
  let v = ed.subCache.get(key);
  if (!v) {
    if (ed.subCache.size > 64) ed.subCache.clear();
    ed.subCache.set(key, (v = subElements(s)));
  }
  return v;
}

/** Corner or side under the cursor (screen distance; what the model hides is not picked). */
export function subPickAt(ed: Editor3, e: { clientX: number; clientY: number }, b: Building3): { sid: ID; id: ID } | null {
  const r = ed.view.renderer.domElement.getBoundingClientRect();
  const x = e.clientX - r.left,
    y = e.clientY - r.top;
  const M = ed.view.buildingMatrix(b);
  const hit = ed.pickAt(e, b.id);
  const cam = ed.view.camera.position;
  // A point farther than the surface under the cursor is behind it (Blender picks only what is seen).
  const limit = hit ? hit.point.distanceTo(cam) + 1 : Infinity;
  const w = new THREE.Vector3();
  const screen = (p: Vec3) => {
    w.set(p[0], p[1], p[2]).applyMatrix4(M);
    const d = w.distanceTo(cam);
    const q = ed.view.toScreen(w);
    return { x: q.x, y: q.y, ok: !q.behind && d <= limit };
  };
  let best: { sid: ID; id: ID } | null = null;
  let bestD = ed.elemMode === 'vertex' ? 20 : 12;
  for (const s of b.solids) {
    if (solidHidden(ed.project, s) || solidLocked(ed.project, s)) continue;
    const sub = ed.subOf(b, s);
    // The volume under the cursor wins a tie (its own corners and sides first).
    const bias = hit?.face?.solid === s.id ? 3 : 0;
    if (ed.elemMode === 'vertex')
      for (const v of sub.verts)
        for (const p of [v.base, v.top]) {
          const q = screen(p);
          const d = Math.hypot(q.x - x, q.y - y) - bias;
          if (q.ok && d < bestD) {
            bestD = d;
            best = { sid: s.id, id: v.id };
          }
        }
    else
      for (const se of sub.edges)
        for (const [a, c] of se.segs) {
          const qa = screen(a),
            qc = screen(c);
          if (!qa.ok && !qc.ok) continue;
          const d = segDistance(x, y, qa.x, qa.y, qc.x, qc.y) - bias;
          if (d < bestD) {
            bestD = d;
            best = { sid: s.id, id: se.id };
          }
        }
  }
  return best;
}

/** Press in a sub-element mode: picks (Shift toggles, Ctrl adds) and starts dragging what was pressed. */
export function subDown(ed: Editor3, e: PointerEvent): boolean {
  const b = ed.store.building(ed.context);
  if (!b) return false;
  const mode = selMode(e);
  if (ed.elemMode === 'face') {
    const hit = ed.pickAt(e, b.id);
    // A window, door or awning lies on its wall: in face mode it picks that wall.
    const f = hit?.building.id === b.id ? (hit.face ?? (hit.part ? partHostFace(b, hit.part) : undefined)) : undefined;
    const face = f ? faceSelOf(f) : null;
    if (!f || !face) {
      if (mode === 'replace') ed.select(f ? { building: b.id, solids: [f.solid] } : { building: b.id });
      return true;
    }
    ed.select({ building: b.id, solids: [f.solid], face });
    const fh = ed.handles.list.find((h) => (face.kind === 'side' ? h.kind === 'push' && h.edge === face.edge : face.kind === 'top' && h.kind === 'height' && !!h.dir));
    if (fh) {
      ed.beginHandle(fh, e);
      if (ed.drag) ed.drag.data.sub = true;
    }
    return true;
  }
  const p = ed.subPickAt(e, b);
  if (!p) {
    // Empty: a plain click clears the corners or sides (the volume stays chosen).
    if (mode === 'replace') ed.select({ building: b.id, solids: ed.sel.solids.slice(0, 1) });
    return true;
  }
  const verts = ed.elemMode === 'vertex';
  const cur = ed.sel.solids[0] === p.sid ? ((verts ? ed.sel.verts : ed.sel.edges) ?? []) : [];
  // Pressing one already selected keeps the group (to drag it); otherwise the modifiers apply.
  const next = mode === 'replace' && cur.includes(p.id) ? cur : combine(cur, [p.id], mode);
  ed.select(verts ? { building: b.id, solids: [p.sid], verts: next } : { building: b.id, solids: [p.sid], edges: next });
  if (!next.includes(p.id) || mode === 'toggle' || mode === 'remove') return true;
  const h = ed.handles.list.find((x) => (verts ? x.kind === 'vertex' && x.vertex === p.id : x.kind === 'push' && x.edge === p.id));
  if (h) {
    ed.beginHandle(h, e);
    if (ed.drag) ed.drag.data.sub = true;
  }
  return true;
}

/** Everything in the current context: elements (when elements are selected), the building's volumes inside it, buildings outside. */
export function selectAll(ed: Editor3, invertSel = false): void {
  const p = ed.project;
  if (ed.sel.elems.length && ed.sel.building) {
    const all = ed.elements().map((e) => e.key);
    return ed.selectElemKeys(ed.sel.building, invertSel ? invert(all, ed.sel.elems) : all);
  }
  const b = ed.store.building(ed.context);
  if (b) {
    const all = pickableSolids(p, b).map((x) => x.id);
    const next = invertSel ? invert(all, ed.sel.solids) : all;
    return ed.select(next.length ? { building: b.id, solids: next } : { building: b.id });
  }
  const all = pickableBuildings(p).map((x) => x.id);
  ed.selectBuildings(invertSel ? invert(all, ed.selectedBuildings()) : all);
}

/** Same type (elements), same shape (volumes: operation, corners, height) or same use (buildings). */
export function selectSimilar(ed: Editor3): void {
  if (ed.sel.elems.length) return ed.selectElems('type');
  const b = ed.activeBuilding();
  if (b && ed.sel.solids.length) {
    const ids = similarSolids(ed.project, b, ed.sel.solids);
    const first = ed.sel.solids[0]!;
    ed.select({ building: b.id, solids: [first, ...ids.filter((i) => i !== first)] });
    return ed.toast(`${ids.length} volume(s) with the same shape and height.`);
  }
  const ref = ed.selectedBuildings();
  if (!ref.length) return ed.toast('Select something first.');
  const ids = similarBuildings(ed.project, ref);
  ed.selectBuildings([ref[0]!, ...ids.filter((i) => i !== ref[0])]);
  ed.toast(`${ids.length} building(s) with the same use.`);
}

/** Hides the selection (H); Alt+H brings it back. */
export function hideSelected(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (b && ed.sel.item) {
    const id = ed.sel.item;
    ed.change(b.id, (x) => {
      const it = x.items.find((i) => i.id === id);
      if (it) it.hidden = true;
    }, 'Hidden · Alt+H shows everything.');
    return ed.select({ building: b.id });
  }
  if (b && ed.sel.solids.length) {
    const ids = ed.sel.solids;
    ed.change(b.id, (x) => {
      for (const q of x.solids) if (ids.includes(q.id)) q.hidden = true;
    }, 'Hidden · Alt+H shows everything.');
    return ed.select({ building: b.id });
  }
  if (ed.sel.elems.length) return ed.toast('Facade elements follow their rule: hide the volume, or the category in the Layers tab.');
  const ids = ed.selectedBuildings();
  if (!ids.length) return ed.toast('Select something to hide.');
  for (const o of ed.project.buildings) if (ids.includes(o.id)) o.hidden = true;
  ed.select({});
  ed.store.commit(null, 'Hidden', false);
  ed.toast(`${ids.length} building(s) hidden · Alt+H shows everything.`);
}

/** Hides everything else (Shift+H): the other volumes inside a building, the other buildings outside it. */
export function isolateSelection(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (b && ed.sel.solids.length) {
    const ids = ed.sel.solids;
    // Hidden cutters keep cutting, so only adding volumes are hidden.
    if (!b.solids.some((q) => !ids.includes(q.id) && q.op === 'add' && !q.hidden)) return ed.toast('Nothing else to hide in ed building (cutters keep cutting, so they stay).');
    ed.change(b.id, (x) => {
      for (const q of x.solids) if (!ids.includes(q.id) && q.op === 'add') q.hidden = true;
    }, 'Selection isolated · Alt+H shows everything.');
    return;
  }
  const ids = ed.selectedBuildings();
  if (!ids.length) return ed.toast('Select a volume or building to isolate.');
  if (!ed.project.buildings.some((o) => !ids.includes(o.id) && !o.hidden)) return ed.toast('Nothing else to hide: the other buildings are already hidden.');
  for (const o of ed.project.buildings) if (!ids.includes(o.id)) o.hidden = true;
  ed.store.commit(null, 'Isolated', false);
  ed.toast('Selection isolated · Alt+H shows everything.');
}

/** Shows every building, volume, component, layer and category (Alt+H). */
export function showAll(ed: Editor3): void {
  const p = ed.store.project;
  for (const b of p.buildings) {
    delete b.hidden;
    b.solids.forEach((s) => delete s.hidden);
    b.items.forEach((i) => delete i.hidden);
  }
  for (const l of ensureLayers(p)) l.visible = true;
  const v = viewOf(p);
  v.hiddenCategories = [];
  delete v.hiddenBody;
  delete v.cutLevel;
  delete v.onlyLevel;
  delete v.explode;
  ed.store.commit(null, 'Everything visible.', true);
  ed.toast('Everything visible.');
}

/** Saves the selection as a named set (a new default name when none is given). */
export function saveSelectionSet(ed: Editor3, name?: string): void {
  const s = ed.sel;
  if (!s.building) return ed.toast('Select something to save as a set.');
  const set = saveSet(ed.store.project, name?.trim() || nextSetName(ed.project), { building: s.building, others: s.others, solids: s.solids, elems: s.elems, item: s.item });
  ed.store.commit(null, '', false);
  ed.toast(`Selection saved as "${set.name}" (Structure tab).`);
}

/** Selects a saved set again (entering its building when it holds volumes or elements). */
export function recallSelectionSet(ed: Editor3, id: ID): void {
  const set = ed.project.selectionSets?.find((x) => x.id === id);
  if (!set) return;
  const sel = recallSet(ed.project, set);
  if (!sel || !sel.building) return ed.toast(`Nothing of "${set.name}" is left to select (deleted, hidden or locked).`);
  const inside = sel.solids.length > 0 || sel.elems.length > 0 || !!sel.item;
  if (inside && ed.context !== sel.building) ed.enter(sel.building);
  else if (!inside && ed.context) ed.enter(null);
  ed.select(sel);
}

export function renameSelectionSet(ed: Editor3, id: ID, name: string): void {
  const set = ed.store.project.selectionSets?.find((x) => x.id === id);
  if (!set || !name.trim()) return;
  set.name = name.trim().slice(0, 60);
  ed.store.commit(null, '', false);
}

export function deleteSelectionSet(ed: Editor3, id: ID): void {
  const p = ed.store.project;
  p.selectionSets = (p.selectionSets ?? []).filter((x) => x.id !== id);
  ed.store.commit(null, '', false);
}

export function moveMarquee(ed: Editor3, e: { clientX: number; clientY: number }): void {
  const m = ed.marquee!;
  m.bx = e.clientX;
  m.by = e.clientY;
  if (!m.active && Math.hypot(m.bx - m.ax, m.by - m.ay) < 5) return;
  m.active = true;
  if (!ed.marqueeEl) {
    ed.marqueeEl = document.createElement('div');
    ed.marqueeEl.className = 'f3-marquee';
    ed.shell.view.appendChild(ed.marqueeEl);
  }
  const el = ed.marqueeEl;
  const rv = ed.shell.view.getBoundingClientRect();
  const { rect, window: win } = marqueeRect(m.ax, m.ay, m.bx, m.by);
  el.hidden = false;
  el.classList.toggle('cross', !win);
  el.style.left = `${rect.x0 - rv.left}px`;
  el.style.top = `${rect.y0 - rv.top}px`;
  el.style.width = `${rect.x1 - rect.x0}px`;
  el.style.height = `${rect.y1 - rect.y0}px`;
  ed.drawHover(null);
  ed.shell.status.hint.textContent = win ? 'Window (→): picks only what is fully inside' : 'Crossing (←): picks everything the box touches';
}

export function endMarquee(ed: Editor3): void {
  const m = ed.marquee!;
  ed.marquee = null;
  if (ed.marqueeEl) ed.marqueeEl.hidden = true;
  if (!m.active) {
    // Empty ground: the street or lot under it, even from inside a building (it leaves the building).
    if (!m.hit && selMode(m.ev) === 'replace' && ed.pickSiteAt({ clientX: m.ax, clientY: m.ay })) return;
    return ed.clickSelect(m.hit, m.ev);
  }
  ed.applyMarquee(m);
  ed.updateHint();
}

/** What the box picks: buildings outside a building; inside, elements (or volumes when there are none). */
export function applyMarquee(ed: Editor3, m: { ax: number; ay: number; bx: number; by: number; ev: Mods }): void {
  const cr = ed.view.renderer.domElement.getBoundingClientRect();
  const { rect, window: win } = marqueeRect(m.ax - cr.left, m.ay - cr.top, m.bx - cr.left, m.by - cr.top);
  const mode = selMode(m.ev);
  const scr = (v: THREE.Vector3) => ed.view.toScreen(v);
  const solidPts = (s: Solid, M: THREE.Matrix4) => s.plan.outer.flatMap((v) => [new THREE.Vector3(v.p[0], s.base, v.p[1]).applyMatrix4(M), new THREE.Vector3(v.p[0], s.base + s.height, v.p[1]).applyMatrix4(M)]);
  const b = ed.context ? ed.store.building(ed.context) : null;
  if (!b) {
    const ids = ed.project.buildings
      .filter((x) => !buildingHidden(ed.project, x) && !buildingLocked(ed.project, x))
      .filter((x) => {
        const M = ed.view.buildingMatrix(x);
        return boxPicks(x.solids.filter((s) => s.op === 'add').flatMap((s) => solidPts(s, M)).map(scr), rect, win);
      })
      .map((x) => x.id);
    const next = combine(ed.selectedBuildings(), ids, mode);
    ed.selectBuildings(next);
    if (next.length) ed.toast(`${next.length} building(s) selected.`);
    return;
  }
  const M = ed.view.buildingMatrix(b);
  const cam = ed.view.camera.position;
  const mm = new THREE.Matrix4(),
    n = new THREE.Vector3(),
    c = new THREE.Vector3();
  const keys: string[] = [];
  for (const el of ed.elements()) {
    const pl = el.pl;
    const it = pl.tag.item ? b.items.find((x) => x.id === pl.tag.item) : undefined;
    if (it && (itemHidden(ed.project, it) || itemLocked(ed.project, it))) continue;
    const [w, h, d] = pl.family.size(pl.params);
    mm.fromArray(pl.frame).premultiply(M);
    if (pl.host) {
      // Only faces facing the camera: the box does not pick the back of the building.
      n.setFromMatrixColumn(mm, 2);
      c.setFromMatrixPosition(mm);
      if (n.dot(c.sub(cam).negate()) <= 0) continue;
    }
    let pts: THREE.Vector3[];
    if (pl.path) pts = pl.path.flatMap((p) => [new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(p[0], p[1] + h, p[2])].map((v) => v.applyMatrix4(mm)));
    else {
      const zs = pl.host ? [0, Math.max(0.05, d)] : [-d / 2, d / 2];
      pts = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? w / 2 : -w / 2, i & 2 ? h : 0, zs[(i >> 2) & 1]!).applyMatrix4(mm));
    }
    if (boxPicks(pts.map(scr), rect, win)) keys.push(el.key);
  }
  if (keys.length) {
    const next = combine(ed.sel.elems, keys, mode);
    ed.selectElemKeys(b.id, next);
    ed.toast(`${next.length} element(s) selected.`);
    return;
  }
  // No element in the box: volumes.
  const sids = b.solids.filter((s) => !solidHidden(ed.project, s) && !solidLocked(ed.project, s) && boxPicks(solidPts(s, M).map(scr), rect, win)).map((s) => s.id);
  if (!sids.length && mode !== 'replace') return;
  const next = combine(ed.sel.solids, sids, mode);
  ed.select({ building: b.id, solids: next });
  if (next.length) ed.toast(`${next.length} volume(s) selected.`);
}

// ── Facade elements ──────────────────────────────────────────────────
/** Elements (windows, doors…) of the building being edited. */
export function elements(ed: Editor3): Elem[] {
  const b = ed.store.building(ed.context ?? ed.sel.building);
  const built = b && ed.view.built.get(b.id);
  if (!b || !built) return [];
  return elementsOf(built.ev.placements, (pl) => {
    if (pl.tag.item) return b.items.find((i) => i.id === pl.tag.item)?.type ?? '';
    const rule = findSolid(b, pl.tag.solid)?.facade.find((f) => f.id === pl.tag.rule);
    const ex = rule?.except[pl.tag.key!];
    return ex && ex !== 'none' ? ex : (rule?.type ?? '');
  }, (pl) => {
    // Floor by the real elevation of the part (rules, free parts and free components in the same numbering).
    const y = (pl.path ? (pl.path[0]?.[1] ?? 0) : pl.frame[13]!) + 0.05;
    const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
    let i = 0;
    lv.forEach((l, k) => {
      if (l.elevation <= y) i = k;
    });
    return i;
  });
}

/** Element selection: row, column, grow, shrink, same type, face, shift. */
export function selectElems(ed: Editor3, op: 'row' | 'rowFace' | 'column' | 'grow' | 'shrink' | 'type' | 'face' | 'left' | 'right' | 'up' | 'down'): void {
  const all = ed.elements();
  const cur = new Set(ed.sel.elems);
  if (!cur.size) return;
  const next =
    op === 'row' ? row(all, cur) : op === 'rowFace' ? rowOnFace(all, cur) : op === 'column' ? column(all, cur) : op === 'grow' ? grow(all, cur) : op === 'shrink' ? shrink(all, cur) : op === 'type' ? sameType(all, cur) : op === 'face' ? sameFace(all, cur) : shift(all, cur, op);
  if (!next.size) return ed.toast('Nothing left to shrink.');
  ed.select({ building: ed.sel.building ?? ed.context, elems: [...next] });
  ed.toast(`${next.size} element(s) selected.`);
}

/** Batch actions on the selected elements. */
export function elemAction(ed: Editor3, kind: 'remove' | 'restore' | 'swap' | 'vary' | 'detach', typeId?: ID): void {
  const b = ed.activeBuilding();
  if (!b || !ed.sel.elems.length) return;
  const keys = ed.sel.elems;
  let varied: ID | null = null;
  if (kind === 'vary') {
    // Type variant only for these elements (the others follow the original type).
    const first = ed.elements().find((e) => e.key === keys[0]);
    const base = first && typeById(first.type, ed.project);
    if (!base) return;
    const v = { id: uid(), family: base.family, name: base.name + ' (variant)', params: structuredClone(base.params), user: true, base: base.base ?? base.id };
    ed.store.project.types.push(v);
    varied = v.id;
  }
  // Back to rule only where something left it (an exception or a detached part).
  if (kind === 'restore') {
    const back = keys.some((k) => {
      const parts = k.split('|');
      if (parts[0] === 'r') return findSolid(b, parts[1]!)?.facade.find((f) => f.id === parts[2])?.except[parts[3]!] !== undefined;
      return !!b.items.find((i) => i.id === parts[1])?.origin;
    });
    if (!back) return ed.toast('Nothing to bring back: these elements already follow their rule.');
  }
  // Detach from rule: each element becomes a free component in the same place (Figma: detach).
  const detached: string[] = [];
  const placed = kind === 'detach' ? new Map(ed.elements().map((e) => [e.key, e])) : null;
  ed.change(b.id, (x) => {
    for (const k of keys) {
      const parts = k.split('|');
      if (parts[0] === 'r') {
        const rule = findSolid(x, parts[1]!)?.facade.find((f) => f.id === parts[2]);
        if (!rule) continue;
        const pos = parts[3]!;
        if (kind === 'detach') {
          const el = placed!.get(k);
          if (!el?.pl.host) continue;
          const ex = rule.except[pos];
          const id = uid();
          x.items.push({ id, type: ex && ex !== 'none' ? ex : rule.type, params: structuredClone(rule.params), host: { kind: 'face', solid: el.pl.host.solid, edge: el.pl.host.edge, u: el.pl.host.s, y: el.pl.host.y }, origin: { solid: parts[1]!, rule: rule.id, key: pos, ...(ex && ex !== 'none' ? { prev: ex } : {}) } });
          rule.except[pos] = 'none';
          detached.push(`i|${id}|0`);
        } else if (kind === 'remove') rule.except[pos] = 'none';
        else if (kind === 'restore') {
          delete rule.except[pos];
          if (rule.sizes) {
            delete rule.sizes[pos];
            if (!Object.keys(rule.sizes).length) delete rule.sizes;
          }
        }
        else if (kind === 'swap' && typeId) rule.except[pos] = typeId;
        else if (kind === 'vary' && varied) rule.except[pos] = varied;
      } else if (parts[0] === 'i') {
        if (kind === 'restore') {
          // A free part that came from a rule: it goes, and the rule takes the position again.
          const it = x.items.find((i) => i.id === parts[1]);
          const o = it?.origin;
          if (!o) continue;
          const rule = findSolid(x, o.solid)?.facade.find((f) => f.id === o.rule);
          if (rule) {
            // The position goes back to what it was before detaching (with the type variant, if any).
            if (o.prev) rule.except[o.key] = o.prev;
            else delete rule.except[o.key];
          }
          x.items = x.items.filter((i) => i.id !== it.id);
        } else if (kind === 'remove') x.items = x.items.filter((i) => i.id !== parts[1]);
        else if ((kind === 'swap' && typeId) || (kind === 'vary' && varied)) {
          const it = x.items.find((i) => i.id === parts[1]);
          if (it) it.type = (typeId ?? varied)!;
        }
      }
    }
  }, kind === 'remove' ? `${keys.length} element(s) removed.` : kind === 'restore' ? 'Elements went back to the rule.' : kind === 'vary' ? 'Variant created: edit the fields to change only these.' : kind === 'detach' ? `${keys.filter((k) => k.startsWith('r|')).length} element(s) detached from the rule: they move and change on their own.` : 'Type swapped.');
  if (kind === 'remove' || kind === 'restore') ed.select({ building: b.id });
  else if (kind === 'detach') ed.selectElemKeys(b.id, detached);
  else if (varied) ed.variation = varied;
}

/**
 * Changes a parameter of the selected elements: on the type (every occurrence
 * and rule) or, with "only the selected", on a type variant created on the
 * first change (like duplicating the type in Revit).
 */
export function editElemsParam(ed: Editor3, key: string, value: unknown): void {
  const picked = ed.elements().filter((e) => ed.sel.elems.includes(e.key));
  const types = [...new Set(picked.map((e) => e.type))];
  if (types.length !== 1) return;
  const tid = types[0]!;
  if (ed.elemScope === 'type') return ed.editType(tid, key, value);
  // The variant already belongs only to these when no other element uses the type.
  const others = ed.elements().some((e) => e.type === tid && !ed.sel.elems.includes(e.key));
  if (others || ed.project.types.every((t) => t.id !== tid)) {
    ed.elemAction('vary');
    if (!ed.variation) return;
    return ed.editType(ed.variation, key, value);
  }
  ed.editType(tid, key, value);
}

/** Edges (point pairs) of the boxes of elements `keys` of building `b`, in the world. */
export function elemBoxes(ed: Editor3, b: Building3, keys: Set<string>): number[] {
  const built = ed.view.built.get(b.id);
  if (!built) return [];
  const M = ed.view.buildingMatrix(b);
  const pos: number[] = [];
  const mm = new THREE.Matrix4();
  for (const pl of built.ev.placements) {
    const k = elemKey(pl);
    if (!k || !keys.has(k)) continue;
    const [w, h, dd] = pl.family.size(pl.params);
    mm.fromArray(pl.frame).premultiply(M);
    const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(mm);
    const xs = [-w / 2 - 0.05, w / 2 + 0.05],
      ys = [-0.05, h + 0.05],
      zs = pl.host ? [-0.05, Math.max(0.12, dd) + 0.05] : [-dd / 2 - 0.05, dd / 2 + 0.05];
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(xs[i & 1]!, ys[(i >> 1) & 1]!, zs[(i >> 2) & 1]!));
    for (const [a, b2] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as [number, number][]) pos.push(...corners[a]!.toArray(), ...corners[b2]!.toArray());
  }
  return pos;
}

/** Automatic groups of the elements of the building being edited (category → type → variant). */
export function elementGroups(ed: Editor3): GroupRow[] {
  return groupElements(
    ed.elements(),
    (t) => {
      const ty = typeById(t, ed.project);
      const f = ty && family(ty.family);
      return ty && f ? { name: ty.name, category: f.category, ...(ty.base ? { base: ty.base } : {}) } : undefined;
    },
    (c) => CATEGORY_NAMES[c as keyof typeof CATEGORY_NAMES] ?? c,
    Object.keys(CATEGORY_NAMES),
  );
}

/** Selects a group (with the click modifiers: Ctrl adds, Shift toggles, Ctrl+Shift removes). */
export function selectGroup(ed: Editor3, id: string, e: Mods): void {
  const b = ed.activeBuilding();
  const g = ed.elementGroups().find((x) => x.id === id);
  if (!b || !g) return;
  const next = combine(ed.sel.elems, g.keys, selMode(e));
  ed.selectElemKeys(b.id, next);
  ed.toast(`${next.length} element(s) selected.`);
}

/** Pre-highlight in the model of what a panel group would add to the selection (null clears). */
export function previewElems(ed: Editor3, keys: string[] | null): void {
  if (!keys && !ed.groupHover.children.length) return;
  if (!ed.groupHover.parent) ed.view.overlay.add(ed.groupHover);
  for (const c of [...ed.groupHover.children]) {
    ed.groupHover.remove(c);
    const m = c as THREE.LineSegments;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  const b = ed.activeBuilding();
  // Only what the click would add: what is already selected has the orange highlight.
  const sel = new Set(ed.sel.elems);
  const add = keys?.filter((k) => !sel.has(k)) ?? [];
  const pos = b && add.length ? ed.elemBoxes(b, new Set(add)) : [];
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const front = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#5b9cff', depthTest: true }));
    const behind = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#5b9cff', depthTest: false, transparent: true, opacity: 0.3 }));
    front.renderOrder = 24;
    behind.renderOrder = 23;
    ed.groupHover.add(front, behind);
  }
  ed.view.mark();
}
