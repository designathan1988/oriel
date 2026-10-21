// Placing parts in the editor: components from the library on walls, roofs, the ground and along paths, their ghost, and the Paint tool.
import * as THREE from 'three';
import type { Building3, ID, Item, Vec3 } from '../model/schema';
import { uid } from '../model/defaults';
import { inside, findSolid, toLocal } from '../model/ops';
import { invert } from '../model/selsets';
import { HANDLE_COLORS } from './handles';
import { family, typeById } from '../families/index';
import { resolveParams } from '../families/family';
import { interiorOf } from '../eval/interiorwalls';
import { FINISHES } from '../render/finishes';
import { emptyParts3, faceMatrix, FrameSink } from '../eval/parts';
import { buildPartsMesh } from '../render/parts';
import { row } from './elements';
import { fmt } from './support';
import type { Editor3 } from './editor';

export function placeHover(ed: Editor3, e: PointerEvent): void {
  const tf = ed.placing ? typeById(ed.placing, ed.project) : undefined;
  if (tf && family(tf.family)?.host === 'path') return ed.pathHover(e);
  const pl = ed.placementAt(e);
  if (!pl) {
    ed.removeGhost();
    return;
  }
  const key = JSON.stringify([ed.placing, pl.frame]);
  if (ed.ghost?.key === key) return;
  ed.removeGhost();
  const t = typeById(ed.placing!, ed.project)!;
  const f = family(t.family)!;
  const params = resolveParams(f, t.params);
  const parts = emptyParts3();
  f.build(params, new FrameSink(parts, pl.frame, 0), { length: f.size(params)[0], reveal: 0.3, index: 0 });
  parts.tags.push({ family: f.id });
  const mesh = buildPartsMesh(parts, ed.view.ctx, false);
  mesh.group.applyMatrix4(ed.view.buildingMatrix(pl.b));
  mesh.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.material) m.renderOrder = 5;
  });
  ed.view.overlay.add(mesh.group);
  ed.ghost = { mesh, key };
  ed.showDim(pl.label, e);
  ed.view.mark();
}

export function removeGhost(ed: Editor3): void {
  if (!ed.ghost) return;
  ed.ghost.mesh.group.removeFromParent();
  ed.ghost.mesh.dispose();
  ed.ghost = null;
  ed.view.mark();
}

/** Where the component would land under the pointer (face, ground or roof). */
export function placementAt(ed: Editor3, e: { clientX: number; clientY: number }): { b: Building3; host: Item['host']; frame: number[]; label: string } | null {
  if (!ed.placing) return null;
  const t = typeById(ed.placing, ed.project);
  const f = t && family(t.family);
  if (!t || !f) return null;
  const params = resolveParams(f, { ...t.params, ...ed.instanceParams(f) });
  const hit = ed.pickAt(e);
  if (f.host === 'face') {
    if (!hit?.face || hit.face.kind !== 'side' || !hit.face.frame) return null;
    const b = hit.building;
    const fr = hit.face.frame;
    const local = hit.point.clone().applyMatrix4(ed.view.buildingMatrix(b).invert());
    let s = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.y - fr.o[1]) * fr.u[1] + (local.z - fr.o[2]) * fr.u[2];
    const solid = findSolid(b, hit.face.solid)!;
    // Sill from the level under the pointer.
    const yAbs = local.y;
    const lv = [...b.levels].sort((x, y) => x.elevation - y.elevation).filter((l) => l.elevation <= yAbs + 0.01).pop();
    const sill = f.sill?.(params) ?? 0.9;
    let y = (lv ? lv.elevation : solid.base) + sill - solid.base;
    if (e && 'altKey' in e && (e as PointerEvent).altKey) y = (local.x - fr.o[0]) * fr.v[0] + (local.y - fr.o[1]) * fr.v[1] + (local.z - fr.o[2]) * fr.v[2] - f.size(params)[1] / 2;
    if (ed.infer.enabled) s = Math.round(s / 0.1) * 0.1;
    // Inside the wall it lands on: never past a corner nor above the top (the evaluation hid such a
    // door or window right after it was "placed").
    const [pw, ph] = f.size(params);
    const half = (pw ?? 1) / 2 + 0.05;
    if (fr.s1 - fr.s0 > 2 * half) s = Math.min(fr.s1 - half, Math.max(fr.s0 + half, s));
    const top = solid.height - 0.05 - (ph ?? 1);
    if (top >= 0) y = Math.min(top, Math.max(0, y));
    const ds = s - fr.s0;
    const p: Vec3 = [fr.o[0] + fr.u[0] * ds + fr.v[0] * y, fr.o[1] + fr.u[1] * ds + fr.v[1] * y, fr.o[2] + fr.u[2] * ds + fr.v[2] * y];
    return { b, host: { kind: 'face', solid: solid.id, edge: hit.face.edge!, u: s, y }, frame: faceMatrix(p, fr.u, fr.v, fr.n), label: `${fmt(s)} m along · ${fmt(y + solid.base)} m high` };
  }
  if (f.host === 'roof' && hit?.face && (hit.face.kind === 'roof' || hit.face.kind === 'top')) {
    const b = hit.building;
    const local = hit.point.clone().applyMatrix4(ed.view.buildingMatrix(b).invert());
    return { b, host: { kind: 'roof', solid: hit.face.solid, p: [local.x, local.z], rot: 0 }, frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, local.x, local.y, local.z, 1], label: 'On the roof' };
  }
  // Free: on the ground (or on the flat top under the pointer). It belongs to the building under it,
  // else the one being edited, else the nearest one (before: the first of the project, wherever it was).
  const onTop = !!hit?.face && hit.normal.y > 0.9;
  // On a shaped ground (terrain) the part stands on it, at the ground's height where it is put.
  const field = onTop ? null : ed.terrain();
  const gy = field ? (ed.view.onGround(e)?.y ?? 0) : 0;
  const sn = ed.infer.snap(e, onTop ? hit!.point.y : gy, null, null);
  if (!sn) return null;
  const y = onTop ? hit!.point.y : field ? field.at(sn.p.x, sn.p.z) : 0;
  // On a flat top it belongs to that building; on the ground the ray may have crossed a roof in front
  // of the point, so it is the building being edited or the nearest one to where it stands.
  const b = (onTop ? hit!.building : undefined) ?? ed.ownerAt(sn.p.x, sn.p.z);
  const l = toLocal(b, [sn.p.x, sn.p.z]);
  const ly = field ? y - (b.elevation ?? 0) : y;
  return { b, host: { kind: 'free', p: [l[0], ly, l[1]], rot: 0 }, frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, l[0], ly, l[1], 1], label: `${fmt(l[0])}; ${fmt(l[1])}` };
}

/** Where a path part starts: on the flat top under the pointer (a terrace, a slab), else on the ground. */
export function pathStart(ed: Editor3, e: PointerEvent): { y: number; bid: ID | null } {
  const hit = ed.pickAt(e);
  if (hit?.face && hit.normal.y > 0.9 && hit.point.y > 0.3) return { y: hit.point.y, bid: hit.building.id };
  return { y: 0, bid: null };
}

/**
 * Drawing a path part (fence, wall, railing): the points so far and the segment to the pointer as a
 * line, with the segment length and the total next to the cursor (before, a ghost part and the
 * meaningless "0; 0" of a building not made yet).
 */
export function pathHover(ed: Editor3, e: PointerEvent): void {
  const old = ed.snapOverlay.getObjectByName('pathdraft');
  if (old) {
    ed.snapOverlay.remove(old);
    (old as THREE.Line).geometry.dispose();
  }
  ed.removeGhost();
  const py = ed.pathDraft?.y ?? ed.pathStart(e).y;
  const sn = ed.infer.snap(e, py, ed.pathDraft?.pts.length ? new THREE.Vector3(...ed.pathDraft.pts[ed.pathDraft.pts.length - 1]!) : null, null);
  if (!sn) return;
  const pts = [...(ed.pathDraft?.pts ?? []).map((p) => new THREE.Vector3(p[0], py + 0.05, p[2])), new THREE.Vector3(sn.p.x, py + 0.05, sn.p.z)];
  if (pts.length > 1) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
    l.name = 'pathdraft';
    l.renderOrder = 27;
    ed.snapOverlay.add(l);
  }
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += pts[i]!.distanceTo(pts[i - 1]!);
  const seg = pts.length > 1 ? pts[pts.length - 1]!.distanceTo(pts[pts.length - 2]!) : 0;
  ed.showDim(pts.length > 1 ? `${fmt(seg)} m · total ${fmt(total)} m · Enter ends` : 'Click the first point', e);
  ed.view.mark();
}

export function clearPathDraft(ed: Editor3): void {
  ed.pathDraft = null;
  const old = ed.snapOverlay.getObjectByName('pathdraft');
  if (old) {
    ed.snapOverlay.remove(old);
    (old as THREE.Line).geometry.dispose();
    ed.view.mark();
  }
  ed.shell.dim.hidden = true;
}

export function placeAt(ed: Editor3, e: PointerEvent): void {
  if (!ed.placing) return;
  const t = typeById(ed.placing, ed.project);
  const f = t && family(t.family);
  if (!t || !f) return;
  if (f.host === 'path') {
    // Points in the world; the owner is decided when the path ends (the building being edited, the
    // nearest one to the first point, or a new site there).
    const last = ed.pathDraft?.pts[ed.pathDraft.pts.length - 1];
    ed.pathDraft ??= { pts: [], ...ed.pathStart(e) };
    const sn = ed.infer.snap(e, ed.pathDraft.y, last ? new THREE.Vector3(...last) : null, null);
    if (!sn) return;
    ed.pathDraft.pts.push([sn.p.x, ed.pathDraft.y, sn.p.z]);
    ed.toast(`${ed.pathDraft.pts.length} point(s). Enter finishes.`);
    ed.pathHover(e);
    return;
  }
  const pl = ed.placementAt(e);
  if (!pl) return ed.toast(f.host === 'face' ? 'Point at a wall.' : 'Point at the ground or a roof.');
  const it: Item = { id: uid(), type: t.id, params: ed.instanceParams(f), host: pl.host };
  ed.removeGhost();
  ed.shell.dim.hidden = true;
  // Say where it went when it was not obvious (no building under the pointer and none being edited).
  const fresh = !ed.store.building(pl.b.id);
  // The site (open ground) needs no mention; another building does.
  const owner = ed.context === pl.b.id || fresh || /^Site( \d+)?$/.test(pl.b.name) ? '' : ` (in ${pl.b.name})`;
  ed.adopt(pl.b);
  ed.change(pl.b.id, (b) => void b.items.push(it), `${t.name} placed${owner}. Click again for one more; Esc finishes.`);
  ed.context = pl.b.id;
  ed.select({ building: pl.b.id, item: it.id });
  ed.lastItem = it.id;
  ed.setMeasure('Copies', (txt) => {
    const m = /^(\d+)\s*x$/i.exec(txt.trim());
    if (!m) return false;
    const n = parseInt(m[1]!, 10);
    return ed.change(pl.b.id, (b) => {
      const x = b.items.find((q) => q.id === it.id);
      if (x) x.array = { along: { mode: 'spacing', value: (f.size(resolveParams(f, t.params))[0] ?? 1) + 1, count: n } };
    }, `${n} copies in a row.`);
  });
}

/** The sizes set in the top bar that the family takes (its parameters), for a new occurrence. */
export function instanceParams(ed: Editor3, f: { params: { key: string }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(ed.placeParams)) if (f.params.some((p) => p.key === k)) out[k] = v;
  return out;
}

export function finishPath(ed: Editor3): void {
  const pd = ed.pathDraft;
  ed.clearPathDraft();
  if (!pd || pd.pts.length < 2 || !ed.placing) return;
  const t = typeById(ed.placing, ed.project)!;
  const first = pd.pts[0]!;
  // Started on a terrace or a slab: that building, at that height; else the one under the first point.
  const ob = ed.store.building(pd.bid) ?? ed.ownerAt(first[0], first[2]);
  const fresh = !ed.store.building(ob.id);
  const points = pd.pts.map((p) => {
    const l = toLocal(ob, [p[0], p[2]]);
    return [l[0], pd.y - (ob.elevation ?? 0), l[1]] as Vec3;
  });
  const it: Item = { id: uid(), type: t.id, params: {}, host: { kind: 'path', points } };
  ed.adopt(ob);
  ed.context = ob.id;
  ed.change(ob.id, (b) => void b.items.push(it), `${t.name} created${fresh ? ` in a new building, ${ob.name} (no building nearby)` : ed.context === ob.id ? '' : ` (it belongs to ${ob.name})`}.`);
  ed.select({ building: ob.id, item: it.id });
}

// ── Painting ─────────────────────────────────────────────────────────
export function paintAt(ed: Editor3, e: PointerEvent): void {
  const hit = ed.pickAt(e);
  if (hit?.part) return ed.paintPart(hit.building, hit.part, e);
  if (!hit?.face) return;
  const b = hit.building;
  const f = hit.face;
  // The inside: a room's floor, or the walls, ceilings and floors of a floor (its interior finishes).
  // The outside of the same wall keeps its own material (each side is painted on its own).
  const local = hit.point.clone().applyMatrix4(ed.view.buildingMatrix(b).invert());
  const room = /^room:([^:]+):(.+)$/.exec(f.solid);
  const hollow = f.kind === 'cutter' && f.solid.includes('~shell');
  const inner = room ? null : hollow ? (hit.normal.y < -0.7 ? 'ceiling' : hit.normal.y > 0.7 ? 'floor' : 'walls') : f.kind === 'innerWall' ? 'walls' : f.kind === 'ceiling' ? 'ceiling' : f.kind === 'floor' ? 'floor' : null;
  if (room || inner) {
    if (e.altKey) return ed.toast('Pick a material from an outside face or the library.');
    const m = structuredClone(ed.paintMat);
    let lv = room?.[1];
    if (!lv) {
      const at = inner === 'ceiling' ? local.y - 0.1 : local.y + 0.05;
      for (const l of [...b.levels].sort((p, q) => p.elevation - q.elevation)) if (at >= l.elevation) lv = l.id;
    }
    if (!lv) return;
    const level = lv;
    return void ed.change(b.id, (x) => {
      const it = interiorOf(x, level);
      // A floor clicked inside a room paints that room (Chief Architect, SketchUp: the face clicked).
      const under = inner === 'floor' ? it.rooms.find((q) => q.polygon && inside([local.x, local.z], q.polygon)) : undefined;
      const r = room ? it.rooms.find((q) => q.id === room[2]) : under;
      if (r) r.finish = m;
      else it.finishes = { ...(it.finishes ?? {}), [inner!]: m };
    }, room ? 'Room floor painted.' : inner === 'walls' ? 'Inside of the walls painted (ed floor).' : inner === 'ceiling' ? 'Ceiling painted (ed floor).' : 'Floor painted (ed floor).');
  }
  const s = findSolid(b, f.solid);
  if (!s) return;
  // Which volume material each face kind uses (paint and eyedropper).
  const edge = f.edge ? (f.edge.endsWith(':c') ? f.edge.slice(0, -2) : f.edge) : undefined;
  const slot = (k: string): 'wall' | 'roof' | 'trim' | 'base' | 'floor' | 'edge' =>
    k === 'roof' ? 'roof' : k === 'top' ? 'floor' : k === 'fascia' || k === 'soffit' || k === 'parapet' || k === 'coping' || k === 'band' || k === 'reveal' ? 'trim' : k === 'plinth' || k === 'bottom' ? 'base' : (k === 'side' || k === 'gable' || k === 'bevel') && edge ? 'edge' : 'wall';
  const where = slot(f.kind);
  if (e.altKey) {
    const ref = where === 'edge' ? (s.edges[edge!]?.material ?? s.materials.wall) : where === 'floor' ? (s.materials.floor ?? s.materials.base) : s.materials[where];
    ed.paintMat = structuredClone(ref);
    ed.toast('Material copied to the bucket.');
    ed.emit();
    return;
  }
  ed.change(b.id, (x) => {
    const so = findSolid(x, s.id)!;
    const m = structuredClone(ed.paintMat);
    // As in SketchUp: a click paints the face; Shift paints the walls of the whole volume.
    if (where === 'edge' && e.shiftKey) {
      so.materials.wall = m;
      for (const es of Object.values(so.edges)) delete es.material;
    } else if (where === 'edge') (so.edges[edge!] ??= {}).material = m;
    else so.materials[where] = m;
  }, where === 'edge' && !e.shiftKey ? 'Face painted (Shift paints the whole volume).' : 'Painted.');
}

/**
 * The bucket on a window, door, awning or free part paints its main color (and finish) like SketchUp
 * paints a component: a facade part paints its rule (every one placed by it), a free part only itself.
 * Alt copies the part's color into the bucket. (It used to do nothing, without a word.)
 */
export function paintPart(ed: Editor3, b: Building3, tag: { family: string; rule?: ID; solid?: ID; item?: ID }, e: PointerEvent): void {
  const fam = family(tag.family);
  const defs = fam?.params ?? [];
  const colors = defs.filter((d) => d.kind === 'color');
  const color = (['color', 'frameColor', 'bodyColor', 'postColor', 'trimColor'].map((k) => colors.find((d) => d.key === k)).find(Boolean) ?? colors[0])?.key;
  const finish = defs.find((d) => d.kind === 'finish' && color && d.key === color.replace(/Color$/, 'Finish').replace(/^color$/, 'finish'))?.key;
  if (!fam || (!color && !finish)) return ed.toast('This part has no color to paint.');
  const rule = tag.rule && tag.solid ? findSolid(b, tag.solid)?.facade.find((f) => f.id === tag.rule) : undefined;
  const item = tag.item ? b.items.find((i) => i.id === tag.item) : undefined;
  if (!rule && !item) return;
  const typeId = rule?.type ?? item!.type;
  const t = typeById(typeId, ed.project);
  const now = resolveParams(fam, t?.params, rule ? rule.params : item!.params);
  if (e.altKey) {
    ed.paintMat = { ...structuredClone(ed.paintMat), ...(color ? { color: String(now[color]) } : {}), ...(finish ? { finish: String(now[finish]) } : {}) };
    ed.toast('Part color copied to the bucket.');
    ed.emit();
    return;
  }
  const m = ed.paintMat;
  const set = (p: Record<string, unknown>) => {
    if (color) p[color] = m.color;
    if (finish && FINISHES.some((f) => f.id === m.finish)) p[finish] = m.finish;
  };
  ed.change(b.id, (x) => {
    if (rule) {
      const r = findSolid(x, tag.solid!)!.facade.find((f) => f.id === rule.id)!;
      set((r.params ??= {}) as Record<string, unknown>);
    } else set((x.items.find((i) => i.id === item!.id)!.params ??= {}) as Record<string, unknown>);
  }, rule ? `${t?.name ?? 'Parts'} painted: every one of ed facade rule.` : `${t?.name ?? 'Part'} painted.`);
}
