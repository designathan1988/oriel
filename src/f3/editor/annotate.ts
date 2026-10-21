// Annotation in the editor: the Measure tool (dimensions, labels, guides), grid axes, pinned dimensions and labels, and the room labels.
import * as THREE from 'three';
import type { Building3, ID, Vec2, Vec3, NoteRef } from '../model/schema';
import { uid } from '../model/defaults';
import { findSolid } from '../model/ops';
import { invert } from '../model/selsets';
import { roomArea } from '../eval/interiorwalls';
import { fmt } from './support';
import type { Editor3 } from './editor';

/** Where a tied dimension end is now (building frame), or null when its corner is gone. */
export function refPoint(ed: Editor3, building: ID | undefined, r: NoteRef | undefined): Vec3 | null {
  if (!r || !building) return null;
  const s = findSolid(ed.store.building(building) ?? ({ solids: [] } as unknown as Building3), r.solid);
  const v = s?.plan.outer.find((q) => q.id === r.vertex);
  if (!s || !v) return null;
  return [v.p[0], r.at === 'base' ? s.base : r.at === 'top' ? s.base + s.height : r.at, v.p[1]];
}

/** The corner of a volume a point (building frame) lies on, at its base or top, within 3 cm. */
export function refAt(ed: Editor3, building: ID | null, p: Vec3): NoteRef | undefined {
  const b = building ? ed.store.building(building) : undefined;
  for (const s of b?.solids ?? []) {
    if (s.op !== 'add') continue;
    for (const v of s.plan.outer) {
      if (Math.hypot(v.p[0] - p[0], v.p[1] - p[2]) > 0.03) continue;
      const at = Math.abs(p[1] - s.base) < 0.03 ? 'base' : Math.abs(p[1] - s.base - s.height) < 0.03 ? 'top' : p[1] > s.base && p[1] < s.base + s.height ? p[1] : null;
      if (at !== null) return { solid: s.id, vertex: v.id, at };
    }
  }
  return undefined;
}

export function noteWorld(ed: Editor3, p: Vec3, building?: ID): THREE.Vector3 {
  const v = new THREE.Vector3(...p);
  const b = building ? ed.store.building(building) : undefined;
  return b ? v.applyMatrix4(ed.view.buildingMatrix(b)) : v;
}

/** A world point in the frame of `building` (or the world when none). */
export function noteLocal(ed: Editor3, p: THREE.Vector3, building: ID | null): Vec3 {
  const b = building ? ed.store.building(building) : undefined;
  const v = b ? p.clone().applyMatrix4(ed.view.buildingMatrix(b).invert()) : p;
  return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
}

export function tapePoint(ed: Editor3, e: { clientX: number; clientY: number }): THREE.Vector3 | null {
  const hit = ed.pickAt(e);
  if (hit) {
    // Snaps to nearby vertices on the plane of the hit point.
    const sn = ed.infer.snap(e, hit.point.y, ed.tapeFrom, null, 10);
    if (sn && sn.kind !== 'grid' && sn.kind !== 'free') return sn.p;
    return hit.point;
  }
  return ed.infer.snap(e, ed.tapeFrom?.y ?? 0, ed.tapeFrom, null)?.p ?? null;
}

export function tapeAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const p = ed.tapePoint(e);
  const old = ed.snapOverlay.getObjectByName('tape') as THREE.Line | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.geometry.dispose();
  }
  if (!p) return;
  if (commit) {
    // Shift+click: a text label at that point (typed in the measure box).
    if (e.shiftKey && !ed.tapeFrom) {
      const on = ed.pickAt(e)?.building.id ?? null;
      const at = ed.noteLocal(p, on);
      ed.setMeasure('Text', (txt) => {
        const text = txt.trim().slice(0, 200);
        if (!text) return false;
        return ed.changeSite((pr) => void (pr.notes ??= []).push({ id: uid(), kind: 'label', p: at, text, ...(on ? { building: on } : {}) }), 'Label added.');
      });
      ed.shell.status.vcb.value = '';
      // After the click is over (the canvas takes the focus on its pointer up).
      setTimeout(() => ed.shell.status.vcb.focus(), 60);
      return ed.toast('Type the label and Enter.');
    }
    if (!ed.tapeFrom) {
      ed.tapeFrom = p.clone();
      ed.tapeOn = ed.pickAt(e)?.building.id ?? null;
      return;
    }
    // Ctrl on the second point: an endless guide line through both instead of a dimension.
    if (e.ctrlKey || e.metaKey) {
      const ga: Vec2 = [ed.tapeFrom.x, ed.tapeFrom.z],
        gb: Vec2 = [p.x, p.z];
      ed.tapeFrom = null;
      ed.tapeOn = null;
      if (Math.hypot(gb[0] - ga[0], gb[1] - ga[1]) < 0.05) return;
      return void ed.changeSite((pr) => void (pr.guides ??= []).push({ id: uid(), a: ga, b: gb }), 'Guide line: the drawing tools snap to it.');
    }
    // Both points on the same building: the dimension is that building's (it follows it).
    const on = ed.tapeOn && ed.pickAt(e)?.building.id === ed.tapeOn ? ed.tapeOn : null;
    const a = ed.noteLocal(ed.tapeFrom, on),
      b = ed.noteLocal(p, on);
    const len = ed.tapeFrom.distanceTo(p);
    ed.tapeFrom = null;
    ed.tapeOn = null;
    const aRef = ed.refAt(on, a),
      bRef = ed.refAt(on, b);
    ed.changeSite((pr) => void (pr.notes ??= []).push({ id: uid(), kind: 'dim', a, b, ...(on ? { building: on } : {}), ...(aRef ? { aRef } : {}), ...(bRef ? { bRef } : {}) }), `Dimension ${fmt(len)} m.`);
    return;
  }
  if (!ed.tapeFrom) {
    ed.showDim('Click the first point', e);
    return;
  }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ed.tapeFrom, p]), new THREE.LineBasicMaterial({ color: '#1f2326', depthTest: false }));
  l.name = 'tape';
  l.renderOrder = 26;
  ed.snapOverlay.add(l);
  const d = p.clone().sub(ed.tapeFrom);
  ed.showDim(`${fmt(d.length())} m  (Δx ${fmt(Math.abs(d.x))} · Δz ${fmt(Math.abs(d.z))} · Δy ${fmt(Math.abs(d.y))})`, e);
  ed.view.mark();
}

/** Draws the pinned dimensions (lines with ticks and labels). */
export function drawDims(ed: Editor3): void {
  const old = ed.snapOverlay.getObjectByName('dims') as THREE.LineSegments | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.geometry.dispose();
  }
  ed.shell.view.querySelectorAll('.f3-dimlbl').forEach((x) => x.remove());
  // Guide lines: long thin dashed lines on the ground (endless in use; drawn 200 m each way).
  const oldG = ed.snapOverlay.getObjectByName('guides') as THREE.LineSegments | undefined;
  if (oldG) {
    ed.snapOverlay.remove(oldG);
    oldG.geometry.dispose();
    (oldG.material as THREE.Material).dispose();
  }
  if (ed.project.guides?.length) {
    const pos: number[] = [];
    for (const g of ed.project.guides) {
      const d: Vec2 = [g.b[0] - g.a[0], g.b[1] - g.a[1]];
      const l = Math.hypot(d[0], d[1]) || 1;
      pos.push(g.a[0] - (d[0] / l) * 200, 0.02, g.a[1] - (d[1] / l) * 200, g.a[0] + (d[0] / l) * 200, 0.02, g.a[1] + (d[1] / l) * 200);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const gl = new THREE.LineSegments(gg, new THREE.LineDashedMaterial({ color: '#7a4fd1', dashSize: 0.5, gapSize: 0.35, transparent: true, opacity: 0.8 }));
    gl.computeLineDistances();
    gl.name = 'guides';
    ed.snapOverlay.add(gl);
  }
  // Grid axes: a dashed line on the ground and its label in a circle at each end.
  const axes = ed.project.axes ?? [];
  const old2 = ed.snapOverlay.getObjectByName('axes') as THREE.LineSegments | undefined;
  if (old2) {
    ed.snapOverlay.remove(old2);
    old2.geometry.dispose();
    (old2.material as THREE.Material).dispose();
  }
  if (axes.length) {
    const pos: number[] = [];
    for (const x of axes) pos.push(x.a[0], 0.03, x.a[1], x.b[0], 0.03, x.b[1]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: '#c0392b', dashSize: 1.2, gapSize: 0.4 }));
    ls.computeLineDistances();
    ls.name = 'axes';
    ed.snapOverlay.add(ls);
    for (const x of axes)
      for (const end of [x.a, x.b]) {
        const sp = ed.view.toScreen(new THREE.Vector3(end[0], 0.03, end[1]));
        if (sp.behind) continue;
        const el = document.createElement('div');
        el.className = 'f3-dimlbl f3-axislbl';
        el.dataset.axis = x.id;
        el.title = 'Alt+click deletes';
        el.setAttribute('data-i18n-skip', '');
        el.textContent = x.label;
        el.style.left = `${sp.x}px`;
        el.style.top = `${sp.y}px`;
        ed.shell.view.appendChild(el);
      }
  }
  // Text labels: a tag at their point.
  for (const n of ed.project.notes ?? []) {
    if (n.kind !== 'label') continue;
    const sp = ed.view.toScreen(ed.noteWorld(n.p, n.building));
    if (sp.behind) continue;
    const el = document.createElement('div');
    el.className = 'f3-dim f3-dimlbl note';
    el.dataset.note = n.id;
    el.title = 'Alt+click deletes';
    el.setAttribute('data-i18n-skip', '');
    el.textContent = n.text;
    el.style.left = `${sp.x}px`;
    el.style.top = `${sp.y}px`;
    ed.shell.view.appendChild(el);
  }
  if (!ed.dims.length) return ed.view.mark();
  const pos: number[] = [];
  for (const d of ed.dims) pos.push(...d.a.toArray(), ...d.b.toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#1f2326', depthTest: false }));
  ls.name = 'dims';
  ls.renderOrder = 26;
  ed.snapOverlay.add(ls);
  for (const d of ed.dims) {
    const m = d.a.clone().add(d.b).multiplyScalar(0.5);
    const sp = ed.view.toScreen(m);
    if (sp.behind) continue;
    const el = document.createElement('div');
    el.className = 'f3-dim f3-dimlbl';
    el.dataset.note = d.id;
    el.title = 'Alt+click deletes';
    el.textContent = `${fmt(d.a.distanceTo(d.b))} m`;
    el.style.left = `${sp.x}px`;
    el.style.top = `${sp.y}px`;
    ed.shell.view.appendChild(el);
  }
  ed.view.mark();
}

/**
 * Grid axis tool (Revit's Grid): two clicks on the ground draw a grid line; it is numbered (1, 2, 3…)
 * when it runs mostly front to back and lettered (A, B, C…) across, the next free one; a typed label
 * renames it.
 */
export function axisAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const sn = ed.infer.snap(e, 0, ed.axisFrom, null);
  if (!sn) return;
  const p = sn.p;
  const old = ed.snapOverlay.getObjectByName('axis-draft') as THREE.Line | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.geometry.dispose();
  }
  if (!ed.axisFrom) {
    if (commit) ed.axisFrom = p.clone();
    else ed.showDim('Click the first end of the grid line', e);
    return ed.view.mark();
  }
  if (!commit) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ed.axisFrom, p]), new THREE.LineBasicMaterial({ color: '#c0392b', depthTest: false }));
    l.name = 'axis-draft';
    l.renderOrder = 26;
    ed.snapOverlay.add(l);
    ed.showDim(`${fmt(ed.axisFrom.distanceTo(p))} m`, e);
    return ed.view.mark();
  }
  const a: Vec2 = [ed.axisFrom.x, ed.axisFrom.z],
    b: Vec2 = [p.x, p.z];
  ed.axisFrom = null;
  ed.shell.dim.hidden = true;
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return;
  const numbered = Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0]);
  const used = new Set((ed.project.axes ?? []).map((x) => x.label));
  let label = '';
  for (let i = 0; i < 200 && !label; i++) {
    const c = numbered ? String(i + 1) : i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
    if (!used.has(c)) label = c;
  }
  const id = uid();
  ed.changeSite((pr) => void (pr.axes ??= []).push({ id, a, b, label }), `Grid line ${label}.`);
  ed.setMeasure('Label', (txt) => {
    const t = txt.trim().slice(0, 8);
    if (!t) return false;
    return ed.changeSite((pr) => void (pr.axes!.find((x) => x.id === id)!.label = t), `Grid line ${t}.`);
  });
}

/** Name and area of each room of the floor shown, on the floor (only with the interior tools or the cut view). */
export function drawRoomLabels(ed: Editor3): void {
  for (const el of [...ed.shell.view.querySelectorAll('.f3-roomlbl')]) el.remove();
  const b = ed.store.building(ed.context);
  if (!b || !(ed.tool === 'iwall' || ed.tool === 'room' || ed.project.view?.cutLevel !== undefined)) return;
  const lv = ed.workLevel(b);
  const it = lv ? b.interiors[lv.id] : undefined;
  if (!lv || !it) return;
  const M = ed.view.buildingMatrix(b);
  const r = ed.shell.view.getBoundingClientRect(),
    cr = ed.view.renderer.domElement.getBoundingClientRect();
  for (const room of it.rooms) {
    if (!room.polygon?.length) continue;
    const c = room.polygon.reduce((a, q) => [a[0] + q[0] / room.polygon!.length, a[1] + q[1] / room.polygon!.length], [0, 0]);
    const s = ed.view.toScreen(new THREE.Vector3(c[0], lv.elevation + 0.3, c[1]).applyMatrix4(M));
    if (s.behind) continue;
    const el = document.createElement('button');
    el.className = 'f3-roomlbl';
    el.setAttribute('aria-pressed', String(ed.roomSel?.room === room.id));
    el.innerHTML = `<b></b><small></small>`;
    el.querySelector('b')!.textContent = room.name;
    el.querySelector('small')!.textContent = `${fmt(room.area ?? roomArea(room.polygon))} m²`;
    el.style.left = `${s.x + cr.left - r.left}px`;
    el.style.top = `${s.y + cr.top - r.top}px`;
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      ed.roomSel = { level: lv.id, room: room.id };
      ed.iwallSel = null;
      ed.emit();
      ed.drawRoomLabels();
    });
    ed.shell.view.appendChild(el);
  }
}
