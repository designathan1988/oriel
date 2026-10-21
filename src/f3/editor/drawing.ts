// Shape tools of the editor (rectangle, circle, polygon, arc, curve), the Cut tool, blocks from the library, and what a typed value means while drawing.
import * as THREE from 'three';
import type { Building3, ID, Solid, Vec2 } from '../model/schema';
import { building as newBuilding, circlePlan, levelsFor, planVertices, roofSpec, solid as newSolid } from '../model/defaults';
import { bendEdge, inside, locateVertex, findSolid, toLocal, topAt } from '../model/ops';
import { solidRings } from '../eval/body';
import { sideCurve, splitAtHeight, splitByLine, splitSideAt } from '../model/modeling';
import { activeLayer } from '../model/layers';
import { invert } from '../model/selsets';
import { tr } from '../ui/i18n';
import { sampleRing } from '../model/plan';
import { BLOCKS, blockSolid, type BlockPlacement } from '../model/blocks';
import { HANDLE_COLORS } from './handles';
import { buildingPassedThrough } from '../model/compose';
import { adoptLevels, fillLevels } from '../model/quick';
import { between } from './elements';
import { type Measure, type Drag, fmt, arcSample, parseLength, parseFloors, floorsHeight, polyArea, screenDist, cutEdgePoint } from './support';
import { parseLengthAngle } from './tools/walls';
import type { Editor3 } from './editor';

// ── Drawing ──────────────────────────────────────────────────────────
export function drawPlane(ed: Editor3, e: { clientX: number; clientY: number }): { y: number; bid: ID | null } {
  const hit = ed.pickAt(e);
  if (hit?.face && (hit.face.kind === 'top' || hit.face.kind === 'parapet') && hit.normal.y > 0.9) return { y: hit.point.y, bid: hit.building.id };
  // On the ground: the building being edited only when the shape starts inside its outline (an arc
  // drawn 100 m away used to become a volume of that building).
  const g = ed.view.onPlane(e, 0);
  const inside = g ? ed.footprintAt(g.x, g.z) : null;
  return { y: 0, bid: inside && inside.id === ed.context ? ed.context : null };
}

export function drawDown(ed: Editor3, e: PointerEvent): void {
  // A rectangle started on a wall: drawn on the wall, then pulled out or carved in (tools/opening.ts).
  if (!ed.draft && ed.tool === 'rect' && ed.opening.onAWall(e)) return ed.opening.down(e, 'pull');
  // A circle started on a wall: a round window (oculus) of that size.
  if (!ed.draft && ed.tool === 'circle' && ed.opening.onAWall(e)) return ed.opening.down(e, 'circle');
  if (!ed.draft) {
    const pl = ed.drawPlane(e);
    const sn = ed.infer.snap(e, pl.y, null, null);
    if (!sn) return;
    ed.draft = { points: [sn.p.clone()], y: pl.y, bid: pl.bid, hover: sn.p.clone() };
    return;
  }
  const sn = ed.infer.snap(e, ed.draft.y, ed.draft.points[ed.draft.points.length - 1]!, e.shiftKey && ed.lastSnap?.line ? ed.lastSnap.line[1].clone().sub(ed.lastSnap.line[0]) : null, 12, ed.secondPointSnap());
  if (!sn) return;
  if (ed.tool === 'arc' && ed.draft.points.length < 2) {
    // Arc: the two ends of the chord, then the point the arc passes through.
    ed.draft.points.push(sn.p.clone());
    return;
  }
  if (ed.tool === 'polygon' || ed.tool === 'spline') {
    const first = ed.draft.points[0]!;
    if (ed.draft.points.length >= 3 && ed.view.toScreen(first).x !== undefined && screenDist(ed.view, first, sn.p) < 12) return ed.finishPolygon();
    ed.draft.points.push(sn.p.clone());
    return;
  }
  ed.draft.points.push(sn.p.clone());
  ed.finishShape();
}

/** Inferences for the second point: a rectangle corner or a circle radius are not directions from the first. */
export function secondPointSnap(ed: Editor3): { parallel?: boolean; axes?: boolean } {
  return ed.tool === 'rect' ? { parallel: false, axes: false } : ed.tool === 'circle' ? { parallel: false } : {};
}

export function drawMove(ed: Editor3, e: PointerEvent): void {
  const from = ed.draft?.points[ed.draft.points.length - 1] ?? null;
  const y = ed.draft?.y ?? ed.drawPlane(e).y;
  const sn = ed.infer.snap(e, y, from, null, 12, from ? ed.secondPointSnap() : {});
  if (!sn) return;
  ed.showSnap(sn, e);
  if (!ed.draft) return;
  // Curve tool dragged: a free-hand outline, a point every 30 cm along the stroke (simplified on release).
  if (ed.tool === 'spline' && e.buttons & 1) {
    const last = ed.draft.points[ed.draft.points.length - 1]!;
    // The pointer as it is (no grid: a stroke snapped to the grid comes out as steps).
    const raw = ed.view.onPlane(e, ed.draft.y);
    if (raw && raw.distanceTo(last) > 0.3 && ed.draft.points.length < 2000) {
      ed.draft.points.push(raw.clone());
      ed.freehand = true;
    }
  }
  ed.draft.hover = sn.p.clone();
  ed.drawDraft();
  const a = ed.draft.points[0]!;
  if (ed.tool === 'rect') {
    const [ax, az] = ed.infer.axes();
    const d = sn.p.clone().sub(a);
    ed.showDim(`${fmt(Math.abs(d.dot(ax!)))} × ${fmt(Math.abs(d.dot(az!)))} m`, e);
  } else if (ed.tool === 'circle') ed.showDim(`r ${fmt(sn.p.distanceTo(a))} m`, e);
  else ed.showDim(`${fmt(sn.p.distanceTo(from!))} m`, e);
}

export function drawDraft(ed: Editor3): void {
  const dr = ed.draft;
  if (!dr || !dr.hover) return;
  const pts = ed.shapePoints(dr.points.concat(ed.tool === 'polygon' ? [dr.hover] : [dr.hover]));
  const g = ed.snapOverlay.getObjectByName('draft') as THREE.Line | undefined;
  if (g) {
    ed.snapOverlay.remove(g);
    g.geometry.dispose();
  }
  const l = new (ed.tool === 'polygon' ? THREE.Line : THREE.LineLoop)(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, dr.y + 0.03, p.z))), new THREE.LineBasicMaterial({ color: ed.drawMode === 'add' ? '#e2702a' : '#c026d3', depthTest: false }));
  l.name = 'draft';
  l.renderOrder = 25;
  ed.snapOverlay.add(l);
  ed.view.mark();
}

/** Points of the drawing in progress (rectangle in the building frame). */
export function shapePoints(ed: Editor3, pts: THREE.Vector3[]): THREE.Vector3[] {
  if (ed.tool === 'polygon') return pts;
  if (ed.tool === 'spline') {
    // The smooth closed outline through the points (model/plan.ts sampleRing, smooth vertices).
    if (pts.length < 3) return pts;
    const ring = sampleRing(planVertices(pts.map((q) => [q.x, q.z] as Vec2), () => ({ smooth: true })));
    return ring.pts.map((q) => new THREE.Vector3(q[0], pts[0]!.y, q[1]));
  }
  if (ed.tool === 'arc') return pts.length >= 3 ? arcSample(pts[0]!, pts[1]!, pts[2]!, 24) ?? pts : pts;
  const a = pts[0]!,
    b = pts[pts.length - 1]!;
  if (ed.tool === 'circle') {
    const r = a.distanceTo(b);
    return Array.from({ length: 48 }, (_, i) => new THREE.Vector3(a.x + Math.cos((i / 48) * Math.PI * 2) * r, a.y, a.z + Math.sin((i / 48) * Math.PI * 2) * r));
  }
  const [ax, az] = ed.infer.axes();
  const d = b.clone().sub(a);
  const u = d.dot(ax!),
    v = d.dot(az!);
  return [a.clone(), a.clone().addScaledVector(ax!, u), a.clone().addScaledVector(ax!, u).addScaledVector(az!, v), a.clone().addScaledVector(az!, v)];
}

export function finishPolygon(ed: Editor3): void {
  const dr = ed.draft;
  if (!dr || dr.points.length < 3) return;
  ed.finishShape();
}

export function finishShape(ed: Editor3): void {
  const dr = ed.draft!;
  ed.draft = null;
  const g = ed.snapOverlay.getObjectByName('draft');
  if (g) ed.snapOverlay.remove(g);
  ed.shell.dim.hidden = true;
  ed.clearSnap();
  let world = ed.shapePoints(dr.points);
  if (ed.tool === 'circle') world = [dr.points[0]!, dr.points[1]!];
  // Arc: the chord ends and the middle of the arc (its two halves are bent into true arcs below).
  let arcMids: THREE.Vector3[] | null = null;
  if (ed.tool === 'arc') {
    const sm = arcSample(dr.points[0]!, dr.points[1]!, dr.points[2]!, 4);
    if (!sm) return ed.toast('The three points are in a line: no arc.');
    world = [sm[0]!, sm[4]!, sm[2]!];
    arcMids = [sm[3]!, sm[1]!];
  }
  const a = world[0]!;
  if (ed.tool !== 'circle' && polyArea(world) < 0.5) return;
  if (ed.tool === 'circle' && a.distanceTo(world[1]!) < 0.3) return;
  const isRectTool = ed.tool === 'rect';
  let b = ed.store.building(dr.bid);
  let created = false;
  let joined: Building3 | null = null;
  if (!b && ed.drawMode !== 'subtract') {
    // Drawn through another building: it becomes a volume of that building (one body, joined by the
    // booleans), not a new building whose walls cross the other one's. Touching beside it is not through.
    const ring = world.map((p) => [p.x, p.z] as Vec2);
    const part = ed.tool === 'circle' ? Array.from({ length: 24 }, (_, i) => [world[0]!.x + Math.cos((i / 24) * Math.PI * 2) * world[0]!.distanceTo(world[1]!), world[0]!.z + Math.sin((i / 24) * Math.PI * 2) * world[0]!.distanceTo(world[1]!)] as Vec2) : ring;
    joined = buildingPassedThrough(ed.project, [{ ring: part, y0: dr.y, y1: dr.y + 3 }]);
    if (joined) b = joined;
  }
  if (!b) {
    if (ed.drawMode === 'subtract') return ed.toast('To subtract, draw on a building (or inside it while editing).');
    b = newBuilding({ name: tr(`Building ${ed.project.buildings.length + 1}`), position: [a.x, a.z], levels: levelsFor(1) , ...(activeLayer(ed.project) ? { layer: activeLayer(ed.project) } : {}) });
    ed.store.project.buildings.push(b);
    created = true;
  }
  const local = world.map((p) => toLocal(b!, [p.x, p.z]));
  let plan;
  if (ed.tool === 'circle') {
    const r = Math.hypot(local[1]![0] - local[0]![0], local[1]![1] - local[0]![1]);
    plan = circlePlan(r, local[0]![0], local[0]![1]);
  } else plan = planVertices(ed.tool === 'spline' ? dr.points.map((p) => toLocal(b!, [p.x, p.z])) : local, () => (ed.tool === 'spline' ? { smooth: true } : {}));
  const sub = ed.drawMode === 'subtract';
  const levelH = b.levels[0]?.height ?? 3;
  const top = topAt(b, local[0]!);
  const base = dr.y > 0.01 ? dr.y : sub ? Math.max(0, top - levelH) : 0;
  const s = newSolid({ name: sub ? 'Cutter' : `Volume ${b.solids.length + 1}`, op: sub ? 'subtract' : 'add', plan: { outer: plan, holes: [] }, base: sub && dr.y > 0.01 ? dr.y - levelH : base, height: sub ? levelH + 0.5 : levelH, roof: roofSpec('flat', { parapet: sub ? 0 : 0.6 }) });
  if (sub && dr.y > 0.01) s.height = levelH;
  if (arcMids) {
    // Sides 1 (end → middle) and 2 (middle → start) of the triangle become the two halves of the arc.
    const [m1, m2] = arcMids.map((p) => toLocal(b!, [p.x, p.z]));
    bendEdge(s, s.plan.outer[1]!.id, m1!);
    bendEdge(s, s.plan.outer[2]!.id, m2!);
  }
  b.solids.push(s);
  // Levels follow the height of the first volume.
  if (!ed.store.commit([b.id], created ? 'Volume created.' : 'Volume added.')) return;
  if (joined) ed.composedNote = `Joined to ${joined.name}: drawn through it, so it is one building now (Separate in the bar keeps it apart).`;
  // Back to selecting before the measure box is armed: changing tools clears a pending measure, and the
  // typed 10x8 or 6 was lost (the "1", "2", "3" in it then switched the selection mode).
  ed.setTool('select');
  ed.context = b.id;
  ed.select({ building: b.id, solids: [s.id], face: { kind: 'top' } });
  ed.toast(ed.composedNote ?? (sub ? 'Cutter created. Drag the top square for the height.' : isRectTool ? 'Volume created. Type 10x8 (width × depth) or 6 (height) and Enter; or drag the top square.' : 'Volume created. Drag the top square or type the height and Enter.'));
  ed.composedNote = null;
  const bid = b.id,
    sid = s.id;
  const isRect = isRectTool;
  ed.setMeasure(isRect ? 'Dimensions' : 'Height', (t) => {
    // Width × depth: 10x8, 10;8, 10*8 or 10 8 (a comma is a decimal separator).
    const m = /^\s*([\d.,]+)\s*(?:[;x×*/]|\s)\s*([\d.,]+)\s*$/i.exec(t);
    if (isRect && m) {
      const w = parseLength(m[1]!),
        dd = parseLength(m[2]!);
      if (!w || !dd) return false;
      return ed.change(bid, (x) => {
        const so = findSolid(x, sid)!;
        const p0 = so.plan.outer[0]!.p;
        const p1 = so.plan.outer[1]!.p,
          p3 = so.plan.outer[3]!.p;
        const ux = [p1[0] - p0[0], p1[1] - p0[1]],
          uz = [p3[0] - p0[0], p3[1] - p0[1]];
        const lu = Math.hypot(ux[0]!, ux[1]!) || 1,
          lz = Math.hypot(uz[0]!, uz[1]!) || 1;
        const U: Vec2 = [(ux[0]! / lu) * w, (ux[1]! / lu) * w],
          V: Vec2 = [(uz[0]! / lz) * dd, (uz[1]! / lz) * dd];
        so.plan.outer[1]!.p = [p0[0] + U[0], p0[1] + U[1]];
        so.plan.outer[2]!.p = [p0[0] + U[0] + V[0], p0[1] + U[1] + V[1]];
        so.plan.outer[3]!.p = [p0[0] + V[0], p0[1] + V[1]];
      }, `${fmt(w)} × ${fmt(dd)} m.`);
    }
    const nf = parseFloors(t);
    const v = nf !== null ? floorsHeight(ed.store.building(bid)!, findSolid(ed.store.building(bid)!, sid)!.base, nf) : parseLength(t);
    if (v === null || v <= 0) return false;
    return ed.change(bid, (x) => {
      const so = findSolid(x, sid)!;
      so.height = v;
      // A building that is only this volume: its floors fill the typed height (a 3 m house is one
      // 3 m floor; before, a 3.4 m floor stood in a 3 m wall and an 8 m shed had one 3.4 m floor).
      if (created && !sub && x.solids.length === 1 && so.base < 0.05) fillLevels(x, v);
    }, `Height ${fmt(v)} m.`);
  });
}

// ── Components ───────────────────────────────────────────────────────
// ── Massing blocks ───────────────────────────────────────────────────
export function startBlock(ed: Editor3, id: string): void {
  ed.setTool('block');
  ed.blockId = id;
  const def = BLOCKS.find((b) => b.id === id);
  ed.updateHint(def ? `${def.name}: on the ground creates a building; on a roof stacks; on a wall attaches aligned. X toggles add/subtract. Esc finishes.` : undefined);
  ed.emit();
}

/** Where the block would land: ground, top (stacks) or face (attaches aligned). */
export function blockPlacement(ed: Editor3, e: { clientX: number; clientY: number }): { b: Building3 | null; at: BlockPlacement; label: string } | null {
  const def = BLOCKS.find((x) => x.id === ed.blockId);
  if (!def) return null;
  const hit = ed.pickAt(e);
  const op: Solid['op'] = ed.drawMode === 'subtract' ? 'subtract' : 'add';
  const lvOf = (b: Building3) => [...b.levels].sort((p, q) => p.elevation - q.elevation)[1]?.height ?? b.levels[0]?.height ?? 3;
  if (hit?.face && hit.building) {
    const b = hit.building;
    const lvH = lvOf(b);
    const s = findSolid(b, hit.face.solid);
    const local = hit.point.clone().applyMatrix4(ed.view.buildingMatrix(b).invert());
    if ((hit.face.kind === 'top' || hit.face.kind === 'parapet' || hit.face.kind === 'coping' || hit.face.kind === 'roof') && s && hit.normal.y > 0.5) {
      const p = ed.snapLocal([local.x, local.z]);
      const top = s.base + s.height;
      return { b, at: { origin: [p[0], p[1] - def.d / 2], ux: [1, 0], uz: [0, 1], base: op === 'add' ? top : top - def.levels * lvH, levelHeight: lvH, op }, label: op === 'add' ? 'Stack on the volume' : 'Cut from above' };
    }
    if (hit.face.kind === 'side' && hit.face.frame && s) {
      const fr = hit.face.frame;
      // Block back on the face plane, width along it (perfect fit).
      let along = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.z - fr.o[2]) * fr.u[2];
      if (ed.infer.enabled) along = Math.round(along / 0.5) * 0.5;
      const ds = along - fr.s0;
      const ox = fr.o[0] + fr.u[0] * ds,
        oz = fr.o[2] + fr.u[2] * ds;
      const nl = Math.hypot(fr.n[0], fr.n[2]) || 1;
      const n: Vec2 = [fr.n[0] / nl, fr.n[2] / nl];
      const inward = op === 'subtract';
      // Add: grows outward (wing, closed porch). Subtract: goes into the wall (arch, niche).
      const uz: Vec2 = inward ? [-n[0], -n[1]] : n;
      const ux: Vec2 = inward ? [fr.u[0], fr.u[2]] : [-fr.u[0], -fr.u[2]];
      const origin: Vec2 = inward ? [ox + n[0] * 0.3, oz + n[1] * 0.3] : [ox, oz];
      const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation <= local.y + 0.01).pop();
      const base = def.id === 'arch' ? s.base - 0.3 : (lv?.elevation ?? s.base);
      return { b, at: { origin, ux, uz, base, levelHeight: lvH, op, attached: true, ...(def.id === 'arch' ? { d: 2.5 } : {}) }, label: inward ? 'Cut into the wall' : 'Attach to the wall' };
    }
  }
  const b = ed.store.building(ed.context) ?? null;
  const sn = ed.infer.snap(e, 0, null, null);
  if (!sn) return null;
  const p: Vec2 = b ? toLocal(b, [sn.p.x, sn.p.z]) : [sn.p.x, sn.p.z];
  return { b, at: { origin: [p[0], p[1] - def.d / 2], ux: [1, 0], uz: [0, 1], base: 0, levelHeight: b ? lvOf(b) : 3, op }, label: b ? 'On the building ground' : 'New building' };
}

export function snapLocal(ed: Editor3, p: Vec2): Vec2 {
  if (!ed.infer.enabled) return p;
  const g = ed.infer.grid || 0.5;
  return [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
}

export function blockAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const def = BLOCKS.find((x) => x.id === ed.blockId);
  const pl = ed.blockPlacement(e);
  const old = ed.snapOverlay.getObjectByName('block') as THREE.LineSegments | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.geometry.dispose();
  }
  if (!def || !pl) return ed.view.mark();
  const s = blockSolid(def, pl.at);
  if (!commit) {
    const r = solidRings(s);
    const M = pl.b ? ed.view.buildingMatrix(pl.b) : new THREE.Matrix4();
    const W = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]).applyMatrix4(M);
    const pos: number[] = [];
    const n = r.outer.pts.length;
    for (let i = 0; i < n; i++) {
      const a = r.outer.pts[i]!,
        c = r.outer.pts[(i + 1) % n]!;
      pos.push(...W(a, r.base).toArray(), ...W(c, r.base).toArray());
      pos.push(...W(r.topOuter[i]!, r.top).toArray(), ...W(r.topOuter[(i + 1) % n]!, r.top).toArray());
      if (!r.outer.segs[i]!.curved || i % 4 === 0) pos.push(...W(a, r.base).toArray(), ...W(r.topOuter[i]!, r.top).toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: pl.at.op === 'add' ? '#e2702a' : '#c026d3', depthTest: false }));
    ls.name = 'block';
    ls.renderOrder = 25;
    ed.snapOverlay.add(ls);
    ed.showDim(`${pl.label} · ${fmt(def.w)} × ${fmt(pl.at.d ?? def.d)} m`, e);
    ed.view.mark();
    return;
  }
  let b = pl.b;
  if (!b) {
    if (pl.at.op === 'subtract') return ed.toast('To subtract, drop the block on a building.');
    b = newBuilding({ name: tr(`Building ${ed.project.buildings.length + 1}`), position: [pl.at.origin[0], pl.at.origin[1] + def.d / 2], levels: levelsFor(Math.max(1, def.levels)) , ...(activeLayer(ed.project) ? { layer: activeLayer(ed.project) } : {}) });
    const s0 = blockSolid(def, { ...pl.at, origin: [0, -def.d / 2] });
    b.solids.push(s0);
    ed.store.project.buildings.push(b);
    ed.store.commit([b.id], `${def.name} created.`);
    ed.context = b.id;
    ed.select({ building: b.id, solids: [s0.id] });
    ed.toast(`${def.name} created. Click again for one more; Esc finishes.`);
    return;
  }
  ed.change(b.id, (x) => {
    x.solids.push(s);
    // More floors when the block goes beyond the building levels.
    const top = s.base + s.height;
    const lv = [...x.levels].sort((p, q) => p.elevation - q.elevation);
    const last = lv[lv.length - 1];
    const typ = lv[1]?.height ?? last?.height ?? 3;
    if (s.op === 'add' && last && top > last.elevation + last.height + 0.3) adoptLevels(x, levelsFor(Math.round((top - (lv[0]?.height ?? typ)) / typ) + 1, typ, lv[0]?.height ?? typ));
  }, `${def.name} ${s.op === 'add' ? 'added' : 'subtracted'}.`);
  ed.context = b.id;
  ed.select({ building: b.id, solids: [s.id] });
}

/**
 * Cut tool (SketchUp: a line across a face splits it; Blender Knife). On a
 * wall: a vertical line through the pointer splits the side in two faces
 * (Shift: a horizontal one splits the volume at that height). On a top: two
 * points of its edge cut the volume in two. Snaps to the middle, the grid and
 * the floors; the measure box takes the exact value.
 */
export function cutAt(ed: Editor3, e: PointerEvent, commit: boolean): void {
  const old = ed.snapOverlay.getObjectByName('cut') as THREE.Object3D | undefined;
  if (old) {
    ed.snapOverlay.remove(old);
    old.traverse((o) => (o as THREE.Line).geometry?.dispose());
    // The line goes from the screen too when nothing replaces it (it stayed over a window).
    ed.view.mark();
  }
  const show = (pts: THREE.Vector3[], dot = false) => {
    const g = new THREE.Group();
    g.name = 'cut';
    if (pts.length > 1) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
      l.renderOrder = 27;
      g.add(l);
    }
    if (dot)
      for (const p of [pts[0]!, pts[pts.length - 1]!]) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 * Math.max(1, ed.view.worldPerPixel(p) * 8), 10, 8), new THREE.MeshBasicMaterial({ color: HANDLE_COLORS.push, depthTest: false }));
        m.position.copy(p);
        m.renderOrder = 27;
        g.add(m);
      }
    ed.snapOverlay.add(g);
    ed.view.mark();
  };
  // Second point of a cut across a top: on the same volume's edge, at the same height.
  if (ed.cutFrom) {
    const cf = ed.cutFrom;
    const b = ed.store.building(cf.bid),
      s = b && findSolid(b, cf.sid);
    if (!b || !s) return void (ed.cutFrom = null);
    const M = ed.view.buildingMatrix(b);
    const W = (q: Vec2) => new THREE.Vector3(q[0], cf.y + 0.03, q[1]).applyMatrix4(M);
    const hp = ed.view.onPlane(e, cf.y + (b.elevation ?? 0));
    const z = hp ? cutEdgePoint(s, toLocal(b, [hp.x, hp.z]), cf.a, ed.infer.enabled ? ed.infer.grid : 0) : null;
    if (!z) {
      show([W(cf.a)], true);
      return ed.showDim('Click a point of the other edge (Esc cancels)', e);
    }
    show([W(cf.a), W(z.p)], true);
    ed.showDim(`${fmt(Math.hypot(z.p[0] - cf.a[0], z.p[1] - cf.a[1]))} m`, e);
    if (!commit) return;
    ed.cutFrom = null;
    let made: ID | null = null;
    const ok = ed.change(b.id, (x) => !!(made = splitByLine(x, findSolid(x, cf.sid)!, cf.a, z.p)?.id ?? null), 'Volume cut in two (each piece is a volume of its own).');
    if (!ok) ed.toast('That line does not cut ed top: both ends on its edge, the line inside (no holes, no curved sides).');
    // The new piece is chosen: the cut shows (nothing draws the line between two pieces of the same finish).
    else if (made) {
      ed.context = b.id;
      ed.select({ building: b.id, solids: [made] });
    }
    return ed.cutAt(e, false);
  }
  // Through the windows: a facade is mostly windows, and the cut is on the wall behind them.
  const hit = ed.pickBody(e);
  const b = hit?.building;
  const s = b && hit?.face ? findSolid(b, hit.face.solid) : undefined;
  if (!b || !hit?.face || !s || s.op !== 'add') return ed.showDim('Click a wall or a top', e);
  const M = ed.view.buildingMatrix(b);
  const ly = hit.point.y - (b.elevation ?? 0);
  if (hit.face.kind === 'side' && hit.face.edge) {
    if (hit.face.edge.endsWith(':c')) return ed.showDim('A rounded corner: cut one of its sides', e);
    const loc = locateVertex(s, hit.face.edge);
    const curve = sideCurve(s, hit.face.edge);
    if (!loc || !curve) return ed.showDim('Click a wall or a top', e);
    const len = curve.len;
    const at = curve.at;
    const W = (q: Vec2, y: number) => new THREE.Vector3(q[0], y, q[1]).applyMatrix4(M);
    const edge = loc.ring[loc.i]!.id;
    if (e.shiftKey) {
      // Across: the volume splits at this height (floors and 10 cm snap).
      let y = ly - s.base;
      const fl = b.levels.map((l) => l.elevation - s.base).find((h) => Math.abs(h - y) < 0.3);
      y = fl ?? (ed.infer.enabled ? Math.round(y / 0.1) * 0.1 : y);
      const k = Math.max(2, Math.ceil(len / 0.5));
      show(Array.from({ length: k + 1 }, (_, i) => W(at((len * i) / k), s.base + y)));
      // From the ground first (audit B2: 7.8 m on a volume raised 20 m read as the height).
      ed.showDim(`${fmt(s.base + y)} m from the ground (${fmt(y)} m up ed volume) · ${fmt(s.height - y)} m above`, e);
      const apply = (v: number) => {
        let made: ID | null = null;
        const ok = ed.change(b.id, (x) => !!(made = splitAtHeight(x, findSolid(x, s.id)!, v)?.id ?? null), `Volume cut at ${fmt(v)} m.`);
        if (ok && made) {
          ed.context = b.id;
          ed.select({ building: b.id, solids: [made] });
        }
        return ok;
      };
      ed.setMeasure('Cut height (above the volume base)', (t) => {
        const v = parseLength(t);
        return v !== null && apply(v);
      });
      if (commit && !apply(y)) ed.toast('Too close to the base or the top to cut there.');
      return;
    }
    const lp = toLocal(b, [hit.point.x, hit.point.z]);
    let u = curve.param(lp);
    // The middle first, then the grid.
    if (Math.abs(u - len / 2) < Math.max(0.25, ed.view.worldPerPixel(hit.point) * 10)) u = len / 2;
    else if (ed.infer.enabled) u = Math.round(u / ed.infer.grid) * ed.infer.grid;
    u = Math.max(0.1, Math.min(len - 0.1, u));
    show([W(at(u), s.base), W(at(u), s.base + s.height)]);
    ed.showDim(`${fmt(u)} m · ${fmt(len - u)} m${Math.abs(u - len / 2) < 1e-6 ? ' (middle)' : ''}`, e);
    const apply = (v: number) => {
      let made: ID | null = null;
      const ok = ed.change(b.id, (x) => !!(made = splitSideAt(x, findSolid(x, s.id)!, edge, v)), 'Face cut in two: each part is a face of its own.');
      if (ok && made) {
        ed.context = b.id;
        ed.select({ building: b.id, solids: [s.id], face: { kind: 'side', edge: made } });
      }
      return ok;
    };
    ed.setMeasure('Cut at', (t) => {
      const v = parseLength(t);
      return v !== null && apply(v);
    });
    if (commit && !apply(u)) ed.toast('Too close to a corner to cut there.');
    return;
  }
  // The edge of a top is often its parapet: it starts the cut too.
  if (hit.face.kind === 'top' || hit.face.kind === 'roof' || hit.face.kind === 'parapet' || hit.face.kind === 'coping') {
    const y = s.base + s.height;
    const hp = ed.view.onPlane(e, y + (b.elevation ?? 0));
    const p = hp ? cutEdgePoint(s, toLocal(b, [hp.x, hp.z]), null, ed.infer.enabled ? ed.infer.grid : 0) : null;
    if (!p) return ed.showDim('Start on the edge of the top', e);
    const W = (q: Vec2) => new THREE.Vector3(q[0], y + 0.03, q[1]).applyMatrix4(M);
    show([W(p.p)], true);
    ed.showDim('Click the first point of the cut', e);
    if (commit) ed.cutFrom = { bid: b.id, sid: s.id, a: p.p, y };
    return;
  }
  ed.showDim('Click a wall or a top', e);
}

/**
 * What a typed value means while a drawing is in progress (SketchUp's VCB, Revit's typed length, Sweet
 * Home 3D's editable tooltip): the length of the next wall or side towards the cursor, the size of the
 * rectangle (10x8, or 10 for a square side along the cursor), the radius of the circle. It wins over a
 * pending measure of the last action, and the digits never switch the selection mode meanwhile.
 */
export function draftInput(ed: Editor3): Measure | null {
  if (ed.tool === 'walls' && ed.wallsTool.busy)
    return {
      label: 'Length (5 or 5<30°)',
      apply: (t) => {
        const v = parseLengthAngle(t, parseLength);
        return !!v && ed.wallsTool.typed(v.len, v.angle);
      },
    };
  if (ed.tool === 'slab' && ed.slabTool.busy) return { label: 'Length', apply: (t) => ed.slabTool.typed(parseLength(t) ?? NaN) };
  if (ed.tool === 'beam' && ed.beamFrom) return { label: 'Length', apply: (t) => ed.beamTyped(parseLength(t) ?? NaN) };
  if ((ed.tool === 'iwall' || ed.tool === 'walls') && ed.iwallLast) return { label: 'Length', apply: (t) => ed.iwallTyped(parseLength(t) ?? NaN) };
  const dr = ed.draft;
  if (!dr || !dr.points.length) return null;
  const a = dr.points[0]!;
  const last = dr.points[dr.points.length - 1]!;
  const toward = (len: number): THREE.Vector3 => {
    const d = (dr.hover ?? last.clone().add(new THREE.Vector3(1, 0, 0))).clone().sub(last);
    d.y = 0;
    if (d.lengthSq() < 1e-9) d.set(1, 0, 0);
    return last.clone().addScaledVector(d.normalize(), len);
  };
  if (ed.tool === 'rect') {
    return {
      label: 'Dimensions',
      apply: (t) => {
        const m = /^\s*([\d.,]+)\s*(?:[;x×*/]|\s)\s*([\d.,]+)\s*$/i.exec(t);
        const w = parseLength(m ? m[1]! : t);
        const d = m ? parseLength(m[2]!) : w;
        if (!w || !d || w <= 0 || d <= 0) return false;
        const [ax, az] = ed.infer.axes();
        const h = (dr.hover ?? a).clone().sub(a);
        const su = Math.sign(h.dot(ax!)) || 1,
          sv = Math.sign(h.dot(az!)) || 1;
        dr.points.push(a.clone().addScaledVector(ax!, su * w).addScaledVector(az!, sv * d));
        ed.finishShape();
        return true;
      },
    };
  }
  if (ed.tool === 'circle') {
    return {
      label: 'Radius',
      apply: (t) => {
        const r = parseLength(t);
        if (!r || r <= 0) return false;
        dr.points.push(toward(r));
        ed.finishShape();
        return true;
      },
    };
  }
  if (ed.tool === 'polygon' || ed.tool === 'spline' || (ed.tool === 'arc' && dr.points.length < 2)) {
    return {
      label: 'Length',
      apply: (t) => {
        const len = parseLength(t);
        if (!len || len <= 0) return false;
        const p = toward(len);
        if (dr.points.length >= 3 && p.distanceTo(a) < 0.02) {
          ed.finishPolygon();
          return true;
        }
        dr.points.push(p);
        dr.hover = toward(1);
        ed.drawDraft();
        return true;
      },
    };
  }
  return null;
}
