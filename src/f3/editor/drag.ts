// Dragging in the editor: handles (move, size, rotate, push, vertices), moving buildings, volumes and parts, copies while dragging, and the end of a drag.
import * as THREE from 'three';
import type { Building3, ID, Item, Solid, Vec2, Vec3 } from '../model/schema';
import { bendEdge, cloneBuilding, cloneSolid, dirToLocal, edgeNormal, findSolid, moveVertex, planCenter, planValid as planValidOps, pushEdge, rotateSolid, toLocal, topRing, toWorld, translateSolid } from '../model/ops';
import { solidRings } from '../eval/body';
import { edgeLength, extrudeSide, hostedFrame, insetTop, setSideDepth } from '../model/modeling';
import { buildingHidden, explodeGap } from '../model/layers';
import { combine } from './selection';
import { invert } from '../model/selsets';
import { type Hit } from './view';
import { type Handle } from './handles';
import { SNAP_COLORS } from './infer';
import { family, typeById } from '../families/index';
import { resolveParams } from '../families/family';
import { evalExpr } from '../model/expr';
import { dimParams, partBox } from '../eval/partsize';
import { buildingPassedThrough, mergeInto, worldParts } from '../model/compose';
import { floorsIn, snapToFloor } from '../model/quick';
import { type Mods, type Drag, rad, fmt, parseLength, parseFloors, floorsHeight, parseOffset, clampInside, midOf, ringCenter } from './support';
import type { Editor3 } from './editor';

// ── Drags ────────────────────────────────────────────────────────────
export function startDrag(ed: Editor3, kind: string, b: Building3, e: { clientX: number; clientY: number }, data: Record<string, unknown>, geometry: boolean): void {
  // Exploded floors are drawn apart from where they are: editing them there would mislead.
  // A click only selects, so the reason waits for a real move (the same 4 px that make a drag).
  if (explodeGap(ed.project) > 0) return void (ed.blockedAt = { x: e.clientX, y: e.clientY });
  ed.drag = { kind, bid: b.id, start: { x: e.clientX, y: e.clientY }, moved: false, origBuilding: structuredClone(b), data, geometry };
}

export function beginSiteDrag(ed: Editor3, h: Handle, e: PointerEvent): void {
  const sp = ed.view.sitePicked;
  const pts = sp.street ? ed.project.streets?.find((x) => x.id === sp.street)?.points : ed.project.lots.find((x) => x.id === sp.lot)?.polygon;
  const from = ed.view.onPlane(e, 0);
  if (!pts || !from) return;
  ed.siteDrag = { index: h.site!.index, axis: h.site!.index < 0 ? h.dir!.clone() : null, from, pts: pts.map((p) => [p[0], p[1]] as Vec2) };
}

export function moveSiteDrag(ed: Editor3, e: PointerEvent): void {
  const d = ed.siteDrag!;
  const p = ed.view.onPlane(e, 0);
  if (!p) return;
  let dx = p.x - d.from.x,
    dz = p.z - d.from.z;
  if (d.axis) {
    const t = dx * d.axis.x + dz * d.axis.z;
    dx = d.axis.x * t;
    dz = d.axis.z * t;
  }
  if (ed.infer.enabled && !e.altKey) {
    const g = Math.max(0.5, ed.infer.grid);
    dx = Math.round(dx / g) * g;
    dz = Math.round(dz / g) * g;
  }
  const sp = ed.view.sitePicked;
  const target = sp.street ? ed.store.project.streets?.find((x) => x.id === sp.street)?.points : ed.store.project.lots.find((x) => x.id === sp.lot)?.polygon;
  if (!target) return;
  d.pts.forEach((q, i) => {
    if (d.index < 0 || d.index === i) target[i] = [q[0] + dx, q[1] + dz];
  });
  ed.view.site.sync(ed.store.project, sp);
  ed.drawSelection();
  ed.view.mark();
  ed.showDim(d.index < 0 ? `${fmt(Math.hypot(dx, dz))} m` : `${fmt(target[d.index]![0])}, ${fmt(target[d.index]![1])}`, e);
}

export function endSiteDrag(ed: Editor3): void {
  const d = ed.siteDrag!;
  ed.siteDrag = null;
  ed.shell.dim.hidden = true;
  const sp = ed.view.sitePicked;
  // The buildings on a lot move with it (a whole lot moved, not a corner).
  if (d.index < 0 && sp.lot) {
    const lot = ed.store.project.lots.find((x) => x.id === sp.lot)!;
    const dx = lot.polygon[0]![0] - d.pts[0]![0],
      dz = lot.polygon[0]![1] - d.pts[0]![1];
    const ids: ID[] = [];
    for (const b of ed.store.project.buildings)
      if (b.lotId === sp.lot) {
        b.position = [b.position[0] + dx, b.position[1] + dz];
        ids.push(b.id);
      }
    ed.store.commit(ids, ids.length ? `Lot moved with its ${ids.length} building(s).` : 'Lot moved.');
  } else if (d.index < 0 && sp.street) {
    // The trees planted along the street go with it.
    ed.store.commit(ed.replantTrees(), 'Street moved.');
  } else ed.store.commit(sp.street ? ed.replantTrees() : [], sp.street ? 'Street point moved.' : 'Lot corner moved.');
  if (ed.store.changed) ed.toast(sp.street ? (d.index < 0 ? 'Street moved.' : 'Street point moved.') : d.index < 0 ? 'Lot moved.' : 'Lot corner moved.');
  ed.emit();
}

export function beginHandle(ed: Editor3, h: Handle, e: PointerEvent): void {
  if (h.site) return ed.beginSiteDrag(h, e);
  const b = ed.activeBuilding();
  if (!b) return;
  const inCtx = ed.context === b.id;
  const s = ed.activeSolid();
  if (h.kind === 'move-x' || h.kind === 'move-z' || h.kind === 'move-xz') {
    if (!inCtx) return ed.beginMoveBuilding(b, e, null, h);
    if (ed.sel.item) return ed.beginMoveItem(b, e, null, h);
    if (s) return ed.beginMoveSolids(b, e, null, h);
  }
  if (h.kind === 'move-y') {
    // Green arrow: vertical, along the gizmo line (where it is drawn).
    const at = ed.handles.posOf(h).clone();
    if (!inCtx) {
      ed.startDrag('lift-building', b, e, { handle: 'move-y', at, e0: b.elevation ?? 0 }, false);
      ed.setMeasure('Elevation', (t) => {
        const v = parseLength(t);
        if (v === null) return false;
        return ed.change(b.id, (x) => void (x.elevation = Math.abs(v) < 1e-6 ? undefined : v), `Elevation ${fmt(v)} m.`, false);
      });
      return;
    }
    if (s && !ed.sel.item) {
      ed.startDrag('lift', b, e, { handle: 'move-y', at, h0: s.height, b0: s.base, sid: s.id }, true);
      ed.preview.add(b.id);
      ed.setMeasure('Base elevation', (t) => {
        const v = parseLength(t);
        if (v === null) return false;
        // What rests on it goes along, the floors follow (model/relations.ts, in the store).
        return ed.change(b.id, (x) => void (findSolid(x, s.id)!.base = v), `Base ${fmt(v)} m.`);
      });
    }
    return;
  }
  if (h.kind === 'size') {
    const ids = inCtx ? (s ? [s.id] : []) : b.solids.filter((x) => x.op === 'add').map((x) => x.id);
    if (!ids.length) return;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const id of ids)
      for (const v of findSolid(b, id)!.plan.outer) {
        x0 = Math.min(x0, v.p[0]);
        x1 = Math.max(x1, v.p[0]);
        z0 = Math.min(z0, v.p[1]);
        z1 = Math.max(z1, v.p[1]);
      }
    const all = !inCtx;
    // The handle sits on the real box (overhang, balconies); the size is of the plan. How far the
    // grabbed point is outside the plan edge is discounted in the drag: the first move does not jump.
    const p0 = ed.view.onPlane(e, h.at.y);
    const l0 = p0 ? toLocal(b, [p0.x, p0.z]) : null;
    const grab: Vec2 = l0 ? [h.sx ? l0[0] - (h.sx > 0 ? x1 : x0) : 0, h.sz ? l0[1] - (h.sz > 0 ? z1 : z0) : 0] : [0, 0];
    ed.startDrag('size', b, e, { handle: 'size', sx: h.sx, sz: h.sz, box: [x0, x1, z0, z1], y: h.at.y, ids, all, grab }, true);
    ed.preview.add(b.id);
    ed.setMeasure(h.sx && h.sz ? 'Size' : h.sx ? 'Width' : 'Depth', (t) => {
      const m = /^\s*([\d.,]+)\s*(?:[x*;\s]\s*([\d.,]+))?\s*$/.exec(t);
      if (!m) return false;
      const a = parseFloat(m[1]!.replace(',', '.')),
        c = m[2] ? parseFloat(m[2].replace(',', '.')) : NaN;
      // The box as it is now: a value typed after the drag sizes what the drag left (the box of when
      // the drag began gave 12.6 for a typed 12).
      const nb = ed.store.building(b.id);
      if (!nb) return false;
      [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const id of ids)
        for (const v of findSolid(nb, id)?.plan.outer ?? []) {
          x0 = Math.min(x0, v.p[0]);
          x1 = Math.max(x1, v.p[0]);
          z0 = Math.min(z0, v.p[1]);
          z1 = Math.max(z1, v.p[1]);
        }
      const W0 = x1 - x0,
        D0 = z1 - z0;
      const wantW = h.sx ? a : W0,
        wantD = h.sz ? (h.sx ? (Number.isFinite(c) ? c : (a / W0) * D0) : a) : D0;
      return ed.change(b.id, (x) => ed.applySize(x, ids, [x0, x1, z0, z1], h.sx ?? 0, h.sz ?? 0, wantW / W0, wantD / D0, all), `Size ${fmt(wantW)} × ${fmt(wantD)} m.`);
    });
    return;
  }
  if (h.kind === 'rotate') {
    const c = h.ring ? ringCenter(h.ring) : h.at;
    ed.startDrag('rotate', b, e, { handle: 'rotate', center: c, a0: ed.angleAt(e, c), copy: e.ctrlKey, inCtx }, inCtx);
    ed.setMeasure('Angle', (t) => {
      const v = parseLength(t);
      if (v === null) return false;
      ed.applyRotation(v, ed.drag?.origBuilding ?? structuredClone(b));
      return true;
    });
    return;
  }
  if (h.pathPt !== undefined) {
    const it = ed.activeItem();
    if (!it || it.host.kind !== 'path') return;
    // Alt+click on a point removes it (a path keeps at least two).
    if (e.altKey && !h.pathMid) {
      if (it.host.points.length <= 2) return ed.toast('A path keeps at least two points.');
      const i = h.pathPt;
      ed.change(b.id, (x) => {
        const y = x.items.find((q) => q.id === it.id);
        if (y?.host.kind === 'path') y.host.points.splice(i, 1);
      }, 'Point removed.');
      return;
    }
    let index = h.pathPt;
    if (h.pathMid) {
      // The new point first, then it is the one dragged.
      const ps = it.host.points;
      const a = ps[index]!,
        c2 = ps[(index + 1) % ps.length]!;
      ps.splice(index + 1, 0, [(a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2, (a[2] + c2[2]) / 2]);
      index += 1;
      ed.store.touch([b.id]);
    }
    ed.startDrag('pathpt', b, e, { handle: 'vertex', id: it.id, index }, true);
    return;
  }
  if (h.kind === 'pscale') {
    const it = ed.activeItem();
    const t = it && typeById(it.type, ed.project);
    const fam = t && family(t.family);
    const pl = it && ed.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
    if (!it || !t || !fam || !pl) return;
    const p = resolveParams(fam, t.params, it.params);
    const keys = dimParams(pl.family, pl.params).map((d) => ({ key: d.key, v0: Number(p[d.key] ?? 1), min: d.min, max: d.max }));
    const bx = partBox(pl.family, pl.params, pl.length);
    const diag = bx ? Math.hypot(bx.max[0] - bx.min[0], bx.max[1] - bx.min[1], bx.max[2] - bx.min[2]) : 1;
    ed.startDrag('pscale', b, e, { handle: 'pscale', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, keys, diag: Math.max(0.2, diag) }, true);
    ed.setMeasure('Scale (×)', (txt) => {
      const r = evalExpr(txt.replace(/x$/i, ''));
      if (r === null || r <= 0) return false;
      return ed.change(b.id, (x) => {
        const y = x.items.find((q) => q.id === it.id)!;
        for (const k of keys) y.params[k.key] = Math.round(Math.max(k.min, Math.min(k.max, k.v0 * r)) * 1000) / 1000;
      }, `Scaled ×${fmt(r)}.`);
    });
    return;
  }
  if (h.kind === 'pmove' && h.pmove !== undefined) {
    const it = ed.activeItem();
    if (!it) return;
    ed.startDrag('pmove', b, e, { handle: 'pmove', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, axis: h.pmove, host0: structuredClone(it.host) }, true);
    return;
  }
  if (h.kind === 'pdim' && h.param && h.rule && h.solid) {
    const pr = h.param,
      ru = h.rule,
      sid = h.solid;
    const write = (x: Building3, v: number) => {
      const rule = findSolid(x, sid)?.facade.find((f) => f.id === ru.id);
      if (!rule) return;
      rule.sizes ??= {};
      (rule.sizes[ru.pos] ??= {})[pr.key] = Math.round(v * 1000) / 1000;
    };
    ed.startDrag('pdim', b, e, { handle: 'pdim', at: h.at.clone(), dir: h.dir!.clone(), key: pr.key, slope: pr.slope, v0: ru.v0, min: pr.min, max: pr.max, label: pr.label, write }, true);
    ed.setMeasure(pr.label, (txt) => {
      const v = parseLength(txt);
      if (v === null || v <= 0) return false;
      const w = Math.max(pr.min, Math.min(pr.max, v));
      return ed.change(b.id, (x) => write(x, w), `${pr.label} ${fmt(w)} m at ed position only (Back to rule undoes).`);
    });
    return;
  }
  if (h.kind === 'pdim' && h.param) {
    const it = ed.activeItem();
    const t = it && typeById(it.type, ed.project);
    const fam = t && family(t.family);
    if (!it || !t || !fam) return;
    const pr = h.param;
    const v0 = Number(resolveParams(fam, t.params, it.params)[pr.key] ?? 1);
    // Each side's share: the dragged side and the opposite one (eval/partsize.ts, up/down).
    const sDrag = pr.side === -1 ? (pr.down ?? 0) : (pr.up ?? pr.slope),
      sOpp = pr.side === -1 ? (pr.up ?? 0) : (pr.down ?? 0);
    // The part's own axis in the building frame, to slide it by what the opposite side would move.
    const pl = ed.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
    const F = pl ? new THREE.Matrix4().fromArray(pl.frame) : new THREE.Matrix4();
    const ax = new THREE.Vector3(pr.axis === 0 ? 1 : 0, pr.axis === 1 ? 1 : 0, pr.axis === 2 ? 1 : 0).transformDirection(F).multiplyScalar(pr.side ?? 1);
    ed.startDrag('pdim', b, e, { handle: 'pdim', at: h.at.clone(), dir: h.dir!.clone(), id: it.id, key: pr.key, slope: Math.max(0.05, sDrag + sOpp), sOpp, v0, min: pr.min, max: pr.max, label: pr.label, axis: pr.axis, side: pr.side ?? 1, ax, host0: structuredClone(it.host) }, true);
    ed.setMeasure(pr.label, (txt) => {
      const v = parseLength(txt);
      if (v === null || v <= 0) return false;
      const w = Math.max(pr.min, Math.min(pr.max, v));
      return ed.change(b.id, (x) => void (x.items.find((q) => q.id === it.id)!.params[pr.key] = w), `${pr.label} ${fmt(w)} m.`);
    });
    return;
  }
  if (h.kind === 'cwidth' || h.kind === 'cheight' || h.kind === 'csill') {
    const it = ed.activeItem();
    if (!it || it.host.kind !== 'face') return;
    const t = typeById(it.type, ed.project);
    const fam = t && family(t.family);
    if (!t || !fam) return;
    const p = resolveParams(fam, t.params, it.params);
    ed.startDrag(h.kind, b, e, { handle: h.kind, at: h.at.clone(), dir: h.dir!.clone(), id: it.id, w0: Number(p.width ?? 1), h0: Number(p.height ?? 1), y0: it.host.y }, true);
    const label = h.kind === 'cwidth' ? 'Width' : h.kind === 'cheight' ? 'Height' : 'Sill';
    ed.setMeasure(label, (txt) => {
      let v = parseLength(txt);
      if (v === null || v <= 0) return false;
      // Width and height within the parameter limits (the message says what took effect).
      const pk = h.kind === 'cwidth' ? 'width' : h.kind === 'cheight' ? 'height' : null;
      const pd = pk ? fam.params.find((q) => q.key === pk) : undefined;
      if (pd) v = Math.max(pd.min ?? 0.3, Math.min(pd.max ?? Infinity, v));
      return ed.change(b.id, (x) => {
        const y = x.items.find((q) => q.id === it.id)!;
        if (h.kind === 'cwidth') y.params.width = v;
        else if (h.kind === 'cheight') y.params.height = v;
        else if (y.host.kind === 'face') {
          const lv = ed.levelBelow(x, y);
          y.host.y = lv + v;
        }
      }, `${label} ${fmt(v)} m.`);
    });
    return;
  }
  if (!s) return;
  const M = ed.view.buildingMatrix(b);
  // Ctrl + face arrow: extrude (new volume), like Ctrl with SketchUp Push/Pull.
  if ((h.kind === 'push' && h.edge) || (h.kind === 'height' && ed.sel.face?.kind === 'top')) {
    if (e.ctrlKey || ed.tool === 'extrude') {
      const side = h.kind === 'push';
      ed.startDrag(side ? 'extrude-side' : 'extrude-top', b, e, { handle: h.kind, at: h.at.clone(), dir: h.dir!.clone(), edge: h.edge, sid: s.id }, true);
      ed.preview.add(b.id);
      ed.setMeasure(side ? 'Extrude' : 'Extrude top', (t) => {
        const v = parseLength(t);
        if (v === null || v === 0) return false;
        ed.modelOp(side ? 'extrude' : 'inset-top', side ? { depth: v } : { inset: 0, depth: v });
        return true;
      });
      return;
    }
  }
  if (h.kind === 'height' || h.kind === 'lift') {
    ed.startDrag(h.kind, b, e, { handle: h.kind, at: h.at.clone(), h0: s.height, b0: s.base, sid: s.id }, true);
    ed.preview.add(b.id);
    ed.setMeasure(h.kind === 'height' ? 'Height (or 5f)' : 'Base elevation', (t) => {
      const nf = h.kind === 'height' ? parseFloors(t) : null;
      const v = nf !== null ? floorsHeight(b, s.base, nf) : parseLength(t);
      if (v === null || v <= 0) return false;
      ed.change(b.id, (x) => {
        const y = findSolid(x, s.id)!;
        if (h.kind === 'height') y.height = v;
        else y.base = v;
      }, h.kind === 'height' ? `Height ${fmt(v)} m.` : `Base ${fmt(v)} m.`);
      return true;
    });
    return;
  }
  if (h.kind === 'push' && h.hosted) {
    const hf = hostedFrame(s);
    if (!hf) return;
    ed.startDrag('side-depth', b, e, { handle: 'push', at: h.at.clone(), dir: h.dir!.clone(), d0: hf.depth, sid: s.id }, true);
    ed.preview.add(b.id);
    ed.setMeasure('Depth', (t) => {
      const v = parseLength(t);
      if (v === null || Math.abs(v) < 0.05) return false;
      return ed.change(b.id, (x) => setSideDepth(findSolid(x, s.id)!, v, x.solids.find((y) => y.id === s.host?.solid)) || false, v > 0 ? `Projection ${fmt(v)} m.` : `Niche ${fmt(-v)} m deep.`);
    });
    return;
  }
  if (h.kind === 'push') {
    const plan0 = structuredClone(s.plan);
    ed.startDrag('push', b, e, { handle: 'push', at: h.at.clone(), dir: h.dir!.clone(), edge: h.edge, sid: s.id, plan: structuredClone(s.plan) }, true);
    ed.preview.add(b.id);
    // The typed value is the whole distance from where the face was when the push began (SketchUp
    // Push/Pull): after dragging 3 m, typing 5 leaves the face 5 m out, not 8.
    ed.setMeasure('Distance', (t) => {
      const v = parseLength(t);
      if (v === null) return false;
      const last = (ed.lastPush ?? 0) >= 0 ? 1 : -1;
      return ed.change(b.id, (x) => pushEdge(findSolid(x, s.id)!, h.edge!, v * last, plan0) || false, `Face moved ${fmt(v)} m.`);
    });
    return;
  }
  if (h.kind === 'twist') {
    const pc = planCenter(s);
    const c = new THREE.Vector3(pc[0], 0, pc[1]).applyMatrix4(M);
    c.y = h.at.y;
    ed.startDrag('twist', b, e, { handle: 'twist', c, y: h.at.y, t0: s.twist ?? 0, sid: s.id }, true);
    ed.setMeasure('Twist', (txt) => {
      const v = parseFloat(txt.replace(',', '.'));
      if (!Number.isFinite(v) || Math.abs(v) > 360) return false;
      return ed.changeSolid((x) => {
        if (Math.abs(v) > 0.01) x.twist = v;
        else delete x.twist;
      }, `Twist ${fmt(v)}°.`);
    });
    return;
  }
  if (h.kind === 'vertex' || h.kind === 'bend') {
    const y = h.at.y;
    ed.startDrag(h.kind, b, e, { handle: h.kind, y, vertex: h.vertex, edge: h.edge, sid: s.id, M }, true);
    ed.preview.add(b.id);
    if (h.kind === 'bend') ed.setMeasure('Bulge', (t) => {
      const v = parseLength(t);
      if (v === null) return false;
      ed.change(b.id, (x) => {
        const so = findSolid(x, s.id)!;
        const n = edgeNormal(so, h.edge!)!;
        const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.some((q) => q.id === h.edge))!;
        const k = ring.findIndex((q) => q.id === h.edge);
        const m = midOf(ring[k]!, ring[(k + 1) % ring.length]!, true);
        return bendEdge(so, h.edge!, [m[0] + n[0] * v, m[1] + n[1] * v]);
      }, 'Side bent.');
      return true;
    });
  }
}

export function beginMoveBuilding(ed: Editor3, b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
  // Through a gizmo handle, the drag runs on the horizontal plane through it (TransformControls):
  // the building follows the cursor. Through the building body, on the ground, as before.
  const planeY = h ? h.at.y : 0;
  const p0 = ed.view.onPlane(e, planeY) ?? new THREE.Vector3(b.position[0], 0, b.position[1]);
  // The other selected buildings move along (each from its starting position).
  const others = ed.sel.building === b.id ? ed.sel.others.flatMap((id) => {
    const o = ed.store.building(id);
    return o ? [[id, [...o.position]] as [ID, number[]]] : [];
  }) : [];
  ed.startDrag('move-building', b, e, { handle: h?.kind ?? 'move-xz', p0, axis: h?.dir?.clone() ?? null, copy: e.ctrlKey, hitY: hit?.point.y ?? 0, others, y: planeY }, false);
  ed.setMoveMeasure();
}

export function beginMoveSolids(ed: Editor3, b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
  const s = ed.activeSolid()!;
  const p0 = ed.view.onPlane(e, s.base) ?? new THREE.Vector3();
  ed.startDrag('move-solids', b, e, { handle: h?.kind ?? 'move-xz', p0, axis: h?.dir?.clone() ?? null, copy: e.ctrlKey, ids: [...ed.sel.solids], y: s.base }, true);
  void hit;
  ed.preview.add(b.id);
  ed.setMoveMeasure();
}

export function beginMoveItem(ed: Editor3, b: Building3, e: PointerEvent, hit: Hit | null, h?: Handle): void {
  const it = ed.activeItem();
  if (!it) return;
  void hit;
  // Real height of the part (on a roof, that of its surface): the drag runs at that height.
  const pl = ed.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id);
  const y0 = pl ? pl.frame[13]! : it.host.kind === 'free' ? it.host.p[1] : 0;
  // On a face: the drag runs on the plane of the face itself, from the grabbed point (the part
  // covers the wall where it is held, so it cannot rely on hitting the wall under the cursor).
  let face: Record<string, unknown> | null = null;
  if (it.host.kind === 'face' && pl) {
    const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(ed.view.buildingMatrix(b));
    const n = new THREE.Vector3().setFromMatrixColumn(F, 2).normalize();
    const o = new THREE.Vector3().setFromMatrixPosition(F);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p0 = ed.view.rayFrom(e).ray.intersectPlane(plane, new THREE.Vector3());
    const s = findSolid(b, it.host.solid);
    const [w, hh] = pl.family.size(pl.params);
    if (p0 && s) face = { plane, p0, ux: new THREE.Vector3().setFromMatrixColumn(F, 0).normalize().negate(), vy: new THREE.Vector3().setFromMatrixColumn(F, 1).normalize(), u0: it.host.u, yf0: it.host.y, len: edgeLength(s, it.host.edge), w, h: hh, top: s.height };
  }
  ed.startDrag('move-item', b, e, { handle: h?.kind ?? 'move-xz', axis: h?.dir?.clone() ?? null, at: h?.at.clone() ?? null, id: it.id, y0, face }, true);
}

export function setMoveMeasure(ed: Editor3): void {
  ed.setMeasure('Distance (or dx;dz)', (t) => {
    const m = /^(\d+)\s*([x*/])$/.exec(t.trim());
    if (m) return ed.arrayLast(parseInt(m[1]!, 10), m[2] === '/');
    // "dx;dz": the move by those amounts in the world (east, south), whatever the drag was.
    const off = parseOffset(t);
    if (off && ed.lastMove) {
      ed.applyMoveDelta(new THREE.Vector3(off[0], 0, off[1]), true);
      return true;
    }
    const v = parseLength(t);
    if (v === null || !ed.lastMove) return false;
    const d = ed.lastMove.clone().normalize().multiplyScalar(v);
    ed.applyMoveDelta(d, true);
    return true;
  });
}

/** Serial copies after moving with Ctrl (5x) or division (5/), like SketchUp. */
export function arrayLast(ed: Editor3, n: number, divide: boolean): boolean {
  const lm = ed.lastMoved;
  if (!lm || !lm.copied || n < 2) {
    ed.toast('Move with Ctrl (copy) and then type 5x.');
    return false;
  }
  const step = divide ? lm.delta.clone().divideScalar(n) : lm.delta.clone();
  if (lm.kind === 'building') {
    const src = ed.store.building(lm.bid);
    if (!src) return false;
    if (divide) {
      src.position = [src.position[0] - lm.delta.x + step.x, src.position[1] - lm.delta.z + step.z];
    }
    for (let i = 1; i < n; i++) {
      const c = cloneBuilding(src);
      c.position = [src.position[0] + step.x * i, src.position[1] + step.z * i];
      ed.store.project.buildings.push(c);
    }
    ed.store.commit(null, `${n} copies.`);
    ed.toast(`${divide ? n : n} copies.`);
    return true;
  }
  return ed.change(lm.bid, (b) => {
    const local = dirToLocal(b, [step.x, step.z]);
    for (const sid of lm.ids) {
      const src = findSolid(b, sid);
      if (!src) continue;
      if (divide) translateSolid(src, -dirToLocal(b, [lm.delta.x, lm.delta.z])[0] + local[0], -dirToLocal(b, [lm.delta.x, lm.delta.z])[1] + local[1]);
      for (let i = 1; i < n; i++) {
        const c = cloneSolid(src);
        translateSolid(c, local[0] * i, local[1] * i);
        b.solids.push(c);
      }
    }
  }, `${n} copies.`);
}

export function angleAt(ed: Editor3, e: { clientX: number; clientY: number }, c: THREE.Vector3): number {
  const p = ed.view.onPlane(e, c.y);
  return p ? Math.atan2(-(p.z - c.z), p.x - c.x) : 0;
}

export function applyRotation(ed: Editor3, deg: number, orig: Building3): void {
  const d = ed.drag;
  const b = ed.store.building(orig.id);
  if (!b) return;
  if (!d || !(d.data.inCtx as boolean)) {
    // Whole building: rotates around the center of its volumes.
    const c = (d?.data.center as THREE.Vector3) ?? new THREE.Vector3(b.position[0], 0, b.position[1]);
    const a = rad(deg);
    const ox = orig.position[0] - c.x,
      oz = orig.position[1] - c.z;
    b.position = [c.x + ox * Math.cos(a) + oz * Math.sin(a), c.z - ox * Math.sin(a) + oz * Math.cos(a)];
    b.rotation = (((orig.rotation + deg) % 360) + 360) % 360;
    if (!d) ed.store.commit([b.id], `Rotated ${fmt(deg)}°.`, false);
    else ed.store.touch([]);
    return;
  }
  if (ed.sel.item) {
    const it = b.items.find((i) => i.id === ed.sel.item);
    const io = orig.items.find((i) => i.id === ed.sel.item);
    if (it && io && (it.host.kind === 'free' || it.host.kind === 'roof') && (io.host.kind === 'free' || io.host.kind === 'roof')) it.host.rot = io.host.rot + deg;
    return;
  }
  const c = (d.data.center as THREE.Vector3).clone();
  const cl = toLocal(b, [c.x, c.z]);
  for (const sid of ed.sel.solids) {
    const so = findSolid(orig, sid),
      s = findSolid(b, sid);
    if (!so || !s) continue;
    s.plan = structuredClone(so.plan);
    rotateSolid(s, deg, cl);
  }
}

export function updateDrag(ed: Editor3, e: PointerEvent): void {
  const d = ed.drag!;
  if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 4) return;
  if (!d.moved && d.data.copy) ed.makeDragCopy();
  // The dimension labels would show the old sizes for the whole drag: they go (the live label says the
  // value) and come back with the result.
  if (!d.moved) ed.drawSelDims();
  d.moved = true;
  const b = ed.store.building(d.bid);
  if (!b) return;
  const orig = d.origBuilding;
  if (d.kind === 'size') {
    const p = ed.view.onPlane(e, d.data.y as number);
    if (!p) return;
    const [x0, x1, z0, z1] = d.data.box as number[];
    const grab = (d.data.grab as Vec2 | undefined) ?? [0, 0];
    const l0 = toLocal(b, [p.x, p.z]);
    const l: Vec2 = [l0[0] - grab[0], l0[1] - grab[1]];
    const g = !e.altKey && ed.infer.enabled ? ed.infer.grid : 0;
    const q = (v: number) => (g ? Math.round(v / g) * g : v);
    const sx = d.data.sx as number,
      sz = d.data.sz as number;
    const W0 = x1! - x0!,
      D0 = z1! - z0!;
    let w = sx > 0 ? q(l[0] - x0!) : sx < 0 ? q(x1! - l[0]) : W0;
    let dd = sz > 0 ? q(l[1] - z0!) : sz < 0 ? q(z1! - l[1]) : D0;
    w = Math.max(0.3, w);
    dd = Math.max(0.3, dd);
    let fx = w / W0,
      fz = dd / D0;
    if (e.shiftKey && sx && sz) fx = fz = Math.max(fx, fz);
    b.solids = structuredClone(orig.solids);
    b.items = structuredClone(orig.items);
    if (ed.applySize(b, d.data.ids as ID[], [x0!, x1!, z0!, z1!], sx, sz, fx, fz, !!d.data.all)) ed.store.touch([b.id]);
    ed.showDim(`${fmt(W0 * fx)} × ${fmt(D0 * fz)} m`, e);
    ed.drawSelection();
    return;
  }
  if (d.kind === 'move-building' || d.kind === 'move-solids') {
    const y = (d.data.y as number | undefined) ?? 0;
    const p0 = d.data.p0 as THREE.Vector3;
    const axis = d.data.axis as THREE.Vector3 | null;
    const snap = ed.infer.snap(e, y, p0, axis, 12);
    if (!snap) return;
    ed.showSnap(snap, e);
    const delta = snap.p.clone().sub(p0).setY(0);
    // Block snapping: a vertex of what moves sticks to a vertex or to an
    // edge of another volume (faces touching perfectly).
    if (ed.infer.enabled && !e.altKey) {
      const fix = ed.blockSnap(d, delta, ed.view.worldPerPixel(p0) * 14);
      if (fix) {
        delta.add(fix.v);
        ed.showSnap({ kind: fix.kind, p: fix.at, label: fix.kind === 'vertex' ? 'Snapped to vertex' : 'Face against face', color: SNAP_COLORS[fix.kind] }, e);
      }
      // Contact snapping (SketchUp/Fusion): a building moved next to another lines up with its middle
      // or its edges along the side they share, within a few pixels.
      if (d.kind === 'move-building') {
        const mb = ed.worldBox(orig);
        if (mb) {
          const tol = ed.view.worldPerPixel(p0) * 10;
          const moved = mb.clone().translate(delta);
          let best: { axis: 'x' | 'z'; v: number; label: string } | null = null;
          for (const o of ed.project.buildings) {
            if (o.id === b.id || buildingHidden(ed.project, o)) continue;
            const ob = ed.worldBox(o);
            if (!ob) continue;
            // Only a neighbour across a side (close in the other axis) counts.
            const nearX = moved.min.x - ob.max.x < tol * 3 && ob.min.x - moved.max.x < tol * 3;
            const nearZ = moved.min.z - ob.max.z < tol * 3 && ob.min.z - moved.max.z < tol * 3;
            for (const axis of ['x', 'z'] as const) {
              if (!(axis === 'x' ? nearZ : nearX)) continue;
              const pairs: [number, number, string][] = [
                [(moved.min[axis] + moved.max[axis]) / 2, (ob.min[axis] + ob.max[axis]) / 2, `Centered on ${o.name}`],
                [moved.min[axis], ob.min[axis], `Aligned with ${o.name}`],
                [moved.max[axis], ob.max[axis], `Aligned with ${o.name}`],
              ];
              for (const [m, t, label] of pairs) if (Math.abs(t - m) < tol && (!best || Math.abs(t - m) < Math.abs(best.v))) best = { axis, v: t - m, label };
            }
          }
          if (best) {
            if (best.axis === 'x') delta.x += best.v;
            else delta.z += best.v;
            ed.showSnap({ kind: 'edge', p: snap.p.clone().add(new THREE.Vector3(best.axis === 'x' ? best.v : 0, 0, best.axis === 'z' ? best.v : 0)), label: best.label, color: SNAP_COLORS.edge }, e);
          }
        }
      }
    }
    ed.applyMoveDelta(delta, false);
    ed.showDim(`${fmt(delta.length())} m`, e);
    return;
  }
  if (d.kind === 'move-item') {
    const it = b.items.find((i) => i.id === d.data.id),
      io = orig.items.find((i) => i.id === d.data.id);
    if (!it || !io) return;
    if (it.host.kind === 'face' && io.host.kind === 'face' && d.data.face) {
      // On the face plane: offset from the grabbed point, within the face limits.
      const f = d.data.face as { plane: THREE.Plane; p0: THREE.Vector3; ux: THREE.Vector3; vy: THREE.Vector3; u0: number; yf0: number; len: number; w: number; h: number; top: number };
      const p = ed.view.rayFrom(e).ray.intersectPlane(f.plane, new THREE.Vector3());
      if (!p) return;
      p.sub(f.p0);
      let du = p.dot(f.ux),
        dv = p.dot(f.vy);
      if (ed.infer.enabled && !e.altKey) {
        // Axis inference (SketchUp): a clearly horizontal move does not change the height, and vice versa.
        if (Math.abs(dv) < 0.3 && Math.abs(du) > 3 * Math.abs(dv)) dv = 0;
        else if (Math.abs(du) < 0.3 && Math.abs(dv) > 3 * Math.abs(du)) du = 0;
      }
      let u = f.u0 + du,
        y = f.yf0 + dv;
      if (ed.infer.enabled && !e.altKey) {
        if (du) u = Math.round(u / 0.1) * 0.1;
        if (dv) y = Math.round(y / 0.05) * 0.05;
      }
      it.host.u = f.len > f.w ? Math.max(f.w / 2, Math.min(f.len - f.w / 2, u)) : f.len / 2;
      it.host.y = Math.max(0, Math.min(Math.max(0, f.top - f.h), y));
      ed.store.touch([b.id]);
      ed.showDim(`${fmt(it.host.u)} m along · ${fmt(it.host.y)} m high`, e);
      return;
    }
    if (it.host.kind === 'face' && io.host.kind === 'face') {
      // Drags along the face: projects onto the face plane.
      const hit = ed.pickAt(e, b.id);
      if (hit?.face?.kind === 'side' && hit.face.solid === io.host.solid && hit.face.edge === io.host.edge && hit.face.frame) {
        const local = new THREE.Vector3().copy(hit.point).applyMatrix4(ed.view.buildingMatrix(b).invert());
        const fr = hit.face.frame;
        const s = fr.s0 + (local.x - fr.o[0]) * fr.u[0] + (local.y - fr.o[1]) * fr.u[1] + (local.z - fr.o[2]) * fr.u[2];
        const fam = family(typeById(io.type, ed.project)?.family ?? '');
        const h = fam ? fam.size(resolveParams(fam, typeById(io.type, ed.project)?.params, io.params))[1] : 1;
        let yy = (local.x - fr.o[0]) * fr.v[0] + (local.y - fr.o[1]) * fr.v[1] + (local.z - fr.o[2]) * fr.v[2] - h / 2;
        if (ed.infer.enabled) yy = Math.round(yy / 0.05) * 0.05;
        it.host.u = ed.infer.enabled ? Math.round(s / 0.1) * 0.1 : s;
        it.host.y = Math.max(0, yy);
        ed.store.touch([b.id]);
        ed.showDim(`${fmt(it.host.u)} m · ${fmt(it.host.y)} m`, e);
      }
      return;
    }
    if (it.host.kind === 'roof' && io.host.kind === 'roof') {
      // A roof part slides on the roof: what is under the cursor, or
      // the plane at its height held to the roof edge (it never falls to the ground).
      const axis = d.data.axis as THREE.Vector3 | null;
      let sid = io.host.solid;
      let local: Vec2 | null = null;
      if (axis && d.data.at) {
        let t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, axis);
        if (ed.infer.enabled && !e.altKey) t = Math.round(t / 0.1) * 0.1;
        const dl = dirToLocal(b, [axis.x, axis.z]);
        local = [io.host.p[0] + dl[0] * t, io.host.p[1] + dl[1] * t];
      } else {
        const hit = ed.pickAt(e, b.id);
        const hs = hit?.face && (hit.face.kind === 'roof' || hit.face.kind === 'top') ? findSolid(b, hit.face.solid) : undefined;
        if (hit && hs && hs.op === 'add') {
          sid = hs.id;
          local = toLocal(b, [hit.point.x, hit.point.z]);
        } else {
          const p = ed.view.onPlane(e, d.data.y0 as number);
          if (p) local = toLocal(b, [p.x, p.z]);
        }
        if (local && ed.infer.enabled && !e.altKey) local = [Math.round(local[0] / 0.1) * 0.1, Math.round(local[1] / 0.1) * 0.1];
      }
      const host = findSolid(b, sid);
      if (!local || !host) return;
      it.host.solid = sid;
      it.host.p = clampInside(local, topRing(host), 0.3);
      ed.store.touch([b.id]);
      ed.showDim('on the roof', e);
      return;
    }
    if (it.host.kind === 'free' && io.host.kind === 'free') {
      const snap = ed.infer.snap(e, io.host.kind === 'free' ? io.host.p[1] : 0, null, null);
      if (!snap) return;
      const l = toLocal(b, [snap.p.x, snap.p.z]);
      it.host.p = [l[0], io.host.p[1], l[1]];
      ed.store.touch([b.id]);
    }
    // A wall, fence or hedge drawn as a path: the whole path moves by the drag on its plane.
    if (it.host.kind === 'path' && io.host.kind === 'path') {
      const y = io.host.points[0]?.[1] ?? 0;
      const p0 = d.data.p0 as THREE.Vector3 | undefined;
      const p = ed.view.onPlane(e, y + (b.elevation ?? 0));
      if (!p) return;
      if (!p0) d.data.p0 = p.clone();
      const s0 = (d.data.p0 as THREE.Vector3) ?? p;
      let dl = dirToLocal(b, [p.x - s0.x, p.z - s0.z]);
      if (ed.infer.enabled && !e.altKey) dl = [Math.round(dl[0] / 0.1) * 0.1, Math.round(dl[1] / 0.1) * 0.1];
      it.host.points = io.host.points.map((q) => [q[0] + dl[0], q[1], q[2] + dl[1]] as Vec3);
      ed.store.touch([b.id]);
      ed.showDim(`${fmt(Math.hypot(dl[0], dl[1]))} m`, e);
    }
    return;
  }
  if (d.kind === 'iwallnode') {
    const it = b.interiors[d.data.level as ID];
    const node = it?.nodes.find((q) => q.id === d.data.node);
    const lv = b.levels.find((l) => l.id === d.data.level);
    if (!node || !lv) return;
    const p = ed.view.onPlane(e, lv.elevation + (b.elevation ?? 0));
    if (!p) return;
    let l = toLocal(b, [p.x, p.z]);
    if (ed.infer.enabled && !e.altKey) l = [Math.round(l[0] / ed.infer.grid) * ed.infer.grid, Math.round(l[1] / ed.infer.grid) * ed.infer.grid];
    node.p = l;
    ed.showDim(`${fmt(l[0])}, ${fmt(l[1])}`, e);
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'pathpt') {
    const it = b.items.find((q) => q.id === d.data.id);
    if (!it || it.host.kind !== 'path') return;
    const i = d.data.index as number;
    const y = it.host.points[i]![1];
    const snap = ed.infer.snap(e, y + (b.elevation ?? 0), null, null);
    if (!snap) return;
    const l = toLocal(b, [snap.p.x, snap.p.z]);
    it.host.points[i] = [l[0], y, l[1]];
    ed.showSnap(snap, e);
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'rotate') {
    const c = d.data.center as THREE.Vector3;
    let deg = ((ed.angleAt(e, c) - (d.data.a0 as number)) * 180) / Math.PI;
    if (!e.shiftKey && ed.infer.enabled) deg = Math.round(deg / ed.rotSnap) * ed.rotSnap;
    ed.store.project = structuredClone(ed.store.project);
    const idx = ed.store.project.buildings.findIndex((x) => x.id === d.bid);
    ed.store.project.buildings[idx] = structuredClone(orig);
    ed.applyRotation(deg, orig);
    if (d.data.inCtx) ed.store.touch([d.bid]);
    else ed.view.sync(ed.store.project, ed.store.revision, ed.preview);
    ed.showDim(`${fmt(deg)}°`, e);
    ed.drawSelection();
    return;
  }
  if (d.kind === 'pscale') {
    const it = b.items.find((q) => q.id === d.data.id);
    if (!it) return;
    const t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
    let r = Math.max(0.1, 1 + t / (d.data.diag as number));
    if (!e.altKey && ed.infer.enabled) r = Math.round(r * 20) / 20;
    for (const k of d.data.keys as { key: string; v0: number; min: number; max: number }[]) it.params[k.key] = Math.round(Math.max(k.min, Math.min(k.max, k.v0 * r)) * 1000) / 1000;
    ed.showDim(`×${fmt(r)}`, e);
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'pmove') {
    const it = b.items.find((q) => q.id === d.data.id);
    const h0 = d.data.host0 as Item['host'];
    if (!it) return;
    let t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
    if (!e.altKey && ed.infer.enabled) t = Math.round(t / 0.05) * 0.05;
    const dir = d.data.dir as THREE.Vector3;
    if (it.host.kind === 'face' && h0.kind === 'face') {
      // Along the wall: the arrow's direction against the part's x (which runs against u).
      if (d.data.axis === 0) {
        const fx = new THREE.Vector3(1, 0, 0);
        const pl = ed.view.built.get(b.id)?.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
        if (pl) fx.transformDirection(new THREE.Matrix4().fromArray(pl.frame).premultiply(ed.view.buildingMatrix(b)));
        it.host.u = h0.u - Math.sign(dir.dot(fx) || 1) * t;
        ed.showDim(`${t >= 0 ? '+' : ''}${fmt(t)} m along the wall`, e);
      } else {
        it.host.y = Math.max(0, h0.y + t);
        ed.showDim(`${fmt(it.host.y - ed.levelBelow(b, it))} m above the floor`, e);
      }
    } else if (it.host.kind === 'free' && h0.kind === 'free') {
      it.host.p = [h0.p[0], Math.max(0, h0.p[1] + t), h0.p[2]];
      ed.showDim(`${fmt(it.host.p[1])} m up`, e);
    }
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'twist') {
    const so = findSolid(b, d.data.sid as ID);
    const p = ed.view.onPlane(e, d.data.y as number);
    if (!so || !p) return;
    const c = d.data.c as THREE.Vector3;
    // Counterclockwise seen from above (x right, z toward the viewer): atan2(−dz, dx).
    const ang = (Math.atan2(-(p.z - c.z), p.x - c.x) * 180) / Math.PI;
    if (d.data.a0 === undefined) d.data.a0 = ang;
    let v = (d.data.t0 as number) + ((((ang - (d.data.a0 as number) + 540) % 360) - 180));
    if (!e.altKey) v = Math.round(v / 5) * 5;
    v = Math.max(-360, Math.min(360, v));
    if (Math.abs(v) > 0.01) so.twist = v;
    else delete so.twist;
    ed.showDim(`twist ${fmt(v)}°`, e);
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'pdim') {
    const it = d.data.write ? undefined : b.items.find((q) => q.id === d.data.id);
    if (!it && !d.data.write) return;
    const t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3) / (d.data.slope as number);
    let v = (d.data.v0 as number) + t;
    if (!e.altKey && ed.infer.enabled) v = Math.round(v / 0.05) * 0.05;
    v = Math.max(d.data.min as number, Math.min(d.data.max as number, v));
    if (it) {
      it.params[d.data.key as string] = Math.round(v * 1000) / 1000;
      // The opposite side stays put: slide the part by what that side would have moved.
      const T = ((d.data.sOpp as number | undefined) ?? 0) * (v - (d.data.v0 as number));
      const h0 = d.data.host0 as Item['host'] | undefined;
      const ax = d.data.ax as THREE.Vector3 | undefined;
      if (h0 && ax && Math.abs(T) > 1e-6) {
        if (it.host.kind === 'free' && h0.kind === 'free') it.host.p = [h0.p[0] + ax.x * T, Math.max(0, h0.p[1] + ax.y * T), h0.p[2] + ax.z * T];
        else if (it.host.kind === 'roof' && h0.kind === 'roof') it.host.p = [h0.p[0] + ax.x * T, h0.p[1] + ax.z * T];
        else if (it.host.kind === 'face' && h0.kind === 'face') {
          // On a wall: the part's x runs against the wall's u (eval/facade.ts frame), y is up.
          if (d.data.axis === 0) it.host.u = h0.u - (d.data.side as number) * T;
          if (d.data.axis === 1) it.host.y = Math.max(0, h0.y + (d.data.side as number) * T);
        }
      }
    } else (d.data.write as (x: Building3, v: number) => void)(b, v);
    ed.showDim(`${(d.data.label as string).toLowerCase()} ${fmt(v)} m`, e);
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'cwidth' || d.kind === 'cheight' || d.kind === 'csill') {
    const it = b.items.find((q) => q.id === d.data.id);
    if (!it || it.host.kind !== 'face') return;
    let t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
    if (!e.altKey && ed.infer.enabled) t = Math.round(t / 0.05) * 0.05;
    // Within the family parameter limits: the value shown is the one that takes effect.
    const fam = family(typeById(it.type, ed.project)?.family ?? '');
    const lim = (k: string, v: number) => {
      const p = fam?.params.find((q) => q.key === k);
      return Math.max(p?.min ?? 0.3, Math.min(p?.max ?? Infinity, v));
    };
    if (d.kind === 'cwidth') {
      it.params.width = lim('width', (d.data.w0 as number) + 2 * t);
      ed.showDim(`width ${fmt(it.params.width as number)} m`, e);
    } else if (d.kind === 'cheight') {
      it.params.height = lim('height', (d.data.h0 as number) + t);
      ed.showDim(`height ${fmt(it.params.height as number)} m`, e);
    } else {
      it.host.y = Math.max(0, (d.data.y0 as number) - t);
      ed.showDim(`sill ${fmt(it.host.y - ed.levelBelow(b, it))} m`, e);
    }
    ed.store.touch([b.id]);
    return;
  }
  if (d.kind === 'lift-building') {
    const at = d.data.at as THREE.Vector3;
    const t = ed.dragAlong(d, e, at, new THREE.Vector3(0, 1, 0));
    const want = (d.data.e0 as number) + t;
    let v = want;
    let label = '';
    if (!e.altKey && ed.infer.enabled) {
      // Snaps to the ground and to the top of buildings whose plan overlaps this one (stack to combine).
      const tol = ed.view.worldPerPixel(at) * 14;
      const mine = ed.worldBox(orig);
      const cands: [number, string][] = [[0, 'On the ground']];
      for (const o of ed.store.project.buildings) {
        if (o.id === b.id) continue;
        const ob = ed.worldBox(o);
        if (!mine || !ob || ob.max.x < mine.min.x || ob.min.x > mine.max.x || ob.max.z < mine.min.z || ob.min.z > mine.max.z) continue;
        cands.push([ob.max.y, `On ${o.name}`]);
      }
      const best = cands.reduce<[number, string] | null>((acc, c) => (Math.abs(c[0] - want) < tol && (!acc || Math.abs(c[0] - want) < Math.abs(acc[0] - want)) ? c : acc), null);
      if (best) [v, label] = best;
      else v = Math.round(want / 0.1) * 0.1;
    }
    b.elevation = Math.abs(v) < 1e-6 ? undefined : v;
    ed.view.sync(ed.store.project, ed.store.revision, ed.preview);
    ed.drawSelection();
    ed.showDim(`elevation ${fmt(v)} m${label ? ' · ' + label : ''}`, e);
    return;
  }
  const s = findSolid(b, d.data.sid as ID);
  const so = findSolid(orig, d.data.sid as ID);
  if (!s || !so) return;
  if (d.kind === 'extrude-side' || d.kind === 'extrude-top') {
    let t = ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
    if (!e.altKey && ed.infer.enabled) t = Math.round(t / 0.1) * 0.1;
    // Redoes from the original on every step (the new volume is a single one).
    b.solids = structuredClone(orig.solids);
    b.levels = structuredClone(orig.levels);
    const base = findSolid(b, d.data.sid as ID)!;
    // A side dragged inward is pushed in (same as Extrude with a negative depth): the wall keeps its facade.
    const sink = d.kind === 'extrude-side' && t <= -0.05;
    if (sink) pushEdge(base, d.data.edge as ID, t);
    const n = Math.abs(t) < 0.05 || sink ? null : d.kind === 'extrude-side' ? extrudeSide(b, base, d.data.edge as ID, t) : insetTop(b, base, 0, t);
    d.data.created = n?.id;
    ed.store.touch([b.id]);
    ed.showDim((t >= 0 ? '+' : '') + fmt(t) + ' m' + (t < 0 && !sink ? ' (cutter)' : ''), e);
    return;
  }
  if (d.kind === 'height' || d.kind === 'lift') {
    const at = d.data.at as THREE.Vector3;
    const t = ed.dragAlong(d, e, at, new THREE.Vector3(0, 1, 0));
    const tops = b.solids.filter((x) => x.id !== s.id).flatMap((x) => [x.base + x.height, x.base]).concat(b.levels.map((l) => l.elevation), b.levels.map((l) => l.elevation + l.height));
    if (d.kind === 'height') {
      const want = so.base + so.height + t;
      // Floor by floor (as in the previous editor); Alt or snap off: free height.
      const free = e.altKey || !ed.infer.enabled;
      // Same height as another top (a volume of this building or another building; Fusion/SketchUp
      // inference): it wins over the floor snap when the pointer is within a few pixels of it.
      let same: { y: number; name: string } | null = null;
      if (!free) {
        const tol = ed.view.worldPerPixel(at) * 10;
        const be = b.elevation ?? 0;
        const cands: { y: number; name: string }[] = [
          ...orig.solids.filter((x) => x.id !== s.id && x.op === 'add').map((x) => ({ y: x.base + x.height, name: x.name })),
          ...ed.project.buildings.filter((o) => o.id !== b.id && !buildingHidden(ed.project, o)).map((o) => ({ y: (o.elevation ?? 0) - be + Math.max(0, ...o.solids.filter((x) => x.op === 'add').map((x) => x.base + x.height)), name: o.name })),
        ];
        for (const c of cands) if (c.y > so.base + 0.3 && Math.abs(c.y - want) < tol && (!same || Math.abs(c.y - want) < Math.abs(same.y - want))) same = c;
      }
      s.height = Math.max(0.3, (same ? same.y : free ? want : snapToFloor(orig, so.base, want)) - so.base);
      // The floors follow (they go up with the volume and go away when nothing reaches them) and what
      // rests on it goes along: the store keeps the relations on every move (model/relations.ts).
      ed.store.touch([b.id]);
      const n = floorsIn(b, s);
      ed.showDim(`${fmt(s.height)} m · ${n} ${n === 1 ? 'floor' : 'floors'}${same ? ` · same height as ${same.name}` : ''}`, e);
      void tops;
      return;
    }
    const want = so.base + t;
    const sn = e.altKey ? { value: want, snapped: false } : ed.infer.snapHeight(want, tops, 0.3);
    s.base = sn.value;
    ed.store.touch([b.id]);
    ed.showDim(`base ${fmt(s.base)} m`, e);
    return;
  }
  if (d.kind === 'side-depth') {
    let depth = (d.data.d0 as number) + ed.dragAlong(d, e, d.data.at as THREE.Vector3, d.data.dir as THREE.Vector3);
    if (!e.altKey && ed.infer.enabled) depth = Math.round(depth / 0.1) * 0.1;
    // At the wall it is neither: it keeps the last side until the pointer goes through.
    if (Math.abs(depth) < 0.05) return;
    Object.assign(s, structuredClone(so));
    if (setSideDepth(s, depth, b.solids.find((y) => y.id === so.host?.solid))) ed.store.touch([b.id]);
    ed.showDim(depth > 0 ? `projection ${fmt(depth)} m` : `niche ${fmt(-depth)} m`, e);
    return;
  }
  if (d.kind === 'push') {
    const at = d.data.at as THREE.Vector3,
      dir = d.data.dir as THREE.Vector3;
    let t = ed.dragAlong(d, e, at, dir);
    if (!e.altKey && ed.infer.enabled) t = Math.round(t / 0.1) * 0.1;
    s.plan = structuredClone(so.plan);
    if (pushEdge(s, d.data.edge as ID, t)) {
      ed.lastPush = t;
      ed.store.touch([b.id]);
    }
    ed.showDim(`${t >= 0 ? '+' : ''}${fmt(t)} m`, e);
    return;
  }
  if (d.kind === 'vertex' || d.kind === 'bend') {
    const snap = ed.infer.snap(e, d.data.y as number, null, null);
    if (!snap) return;
    ed.showSnap(snap, e);
    let l = toLocal(b, [snap.p.x, snap.p.z]);
    s.plan = structuredClone(so.plan);
    if (d.kind === 'bend' && !e.altKey) {
      // Curving a wall snaps to straight and to a half circle (Alt: free), like Estúdio de Construção.
      const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.some((v) => v.id === d.data.edge));
      const i = ring ? ring.findIndex((v) => v.id === d.data.edge) : -1;
      if (ring && i >= 0) {
        const a = ring[i]!.p,
          c = ring[(i + 1) % ring.length]!.p;
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        const m: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        const n: Vec2 = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L];
        const sag = (l[0] - m[0]) * n[0] + (l[1] - m[1]) * n[1];
        const tol = ed.view.worldPerPixel(snap.p) * 12;
        const to = Math.abs(sag) < tol ? 0 : Math.abs(Math.abs(sag) - L / 2) < tol ? Math.sign(sag) * (L / 2) : null;
        if (to !== null) {
          l = [m[0] + n[0] * to, m[1] + n[1] * to];
          ed.showDim(to === 0 ? 'Straight' : 'Half circle', e);
        } else ed.showDim(`bulge ${fmt(Math.abs(sag))} m`, e);
      }
    }
    const ok = d.kind === 'vertex' ? moveVertex(s, d.data.vertex as ID, l) : bendEdge(s, d.data.edge as ID, l);
    if (ok) ed.store.touch([b.id]);
    ed.drawSelection();
  }
}

/**
 * Scales the volume plans by the box, with the side opposite to the handle
 * fixed (anchor). On the whole building, the free parts follow.
 */
export function applySize(ed: Editor3, b: Building3, ids: ID[], box: number[], sx: number, sz: number, fx: number, fz: number, all: boolean): boolean {
  const [x0, x1, z0, z1] = box as [number, number, number, number];
  const ax = sx > 0 ? x0 : sx < 0 ? x1 : (x0 + x1) / 2;
  const az = sz > 0 ? z0 : sz < 0 ? z1 : (z0 + z1) / 2;
  const k = Math.min(fx, fz);
  const map = (p: Vec2): Vec2 => [ax + (p[0] - ax) * fx, az + (p[1] - az) * fz];
  for (const id of ids) {
    const s = findSolid(b, id);
    if (!s) continue;
    const before = structuredClone(s.plan);
    for (const ring of [s.plan.outer, ...s.plan.holes])
      for (const v of ring) {
        v.p = map(v.p);
        if (v.round) v.round *= k;
        if (v.chamfer) v.chamfer *= k;
      }
    if (!planValidOps(s.plan)) {
      s.plan = before;
      return false;
    }
  }
  if (all)
    for (const it of b.items) {
      if (it.host.kind === 'free') {
        const q = map([it.host.p[0], it.host.p[2]]);
        it.host.p = [q[0], it.host.p[1], q[1]];
      } else if (it.host.kind === 'roof') it.host.p = map(it.host.p);
    }
  return true;
}

/** Floor elevation of the storey under a face part (relative to the solid base). */
export function levelBelow(ed: Editor3, b: Building3, it: Item): number {
  if (it.host.kind !== 'face') return 0;
  const s = findSolid(b, it.host.solid);
  const base = s?.base ?? 0;
  const y = base + it.host.y + 0.01;
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation <= y).pop();
  return (lv?.elevation ?? base) - base;
}

/** Offset correction to snap vertices of what moves onto vertices/edges of the others. */
export function blockSnap(ed: Editor3, d: Drag, delta: THREE.Vector3, tol: number): { v: THREE.Vector3; at: THREE.Vector3; kind: 'vertex' | 'edge' } | null {
  const ob = d.origBuilding;
  const moving = new Set(d.kind === 'move-solids' ? (d.data.ids as ID[]) : []);
  const mine: THREE.Vector3[] = [];
  const others: [THREE.Vector3, THREE.Vector3][] = [];
  const ring = (b: Building3, s: Solid) => {
    const r = solidRings(s);
    return r.outer.pts.filter((_, i) => !r.outer.segs[i]!.curved).map((p) => {
      const w = toWorld(b, p);
      return new THREE.Vector3(w[0], 0, w[1]);
    });
  };
  for (const b of ed.project.buildings) {
    const src = b.id === ob.id ? ob : b;
    for (const s of src.solids) {
      if (s.hidden) continue;
      const pts = ring(src, s);
      const isMoving = d.kind === 'move-building' ? b.id === ob.id : b.id === ob.id && moving.has(s.id);
      if (isMoving) mine.push(...pts);
      else if (s.op === 'add') pts.forEach((p, i) => others.push([p, pts[(i + 1) % pts.length]!]));
    }
  }
  let best: { dist: number; v: THREE.Vector3; at: THREE.Vector3; kind: 'vertex' | 'edge' } | null = null;
  for (const m of mine) {
    const q = m.clone().add(delta);
    for (const [a, b2] of others) {
      const dv = a.distanceTo(q);
      if (dv < tol && (!best || dv < best.dist - 1e-6 || best.kind === 'edge')) best = { dist: dv, v: a.clone().sub(q), at: a.clone(), kind: 'vertex' };
      if (best?.kind === 'vertex') continue;
      const ab = b2.clone().sub(a);
      const t = Math.max(0, Math.min(1, q.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
      const proj = a.clone().addScaledVector(ab, t);
      const de = proj.distanceTo(q);
      if (de < tol * 0.8 && (!best || de < best.dist)) best = { dist: de, v: proj.clone().sub(q), at: proj, kind: 'edge' };
    }
  }
  return best ? { v: best.v, at: best.at.setY(d.kind === 'move-solids' ? (d.data.y as number) : 0), kind: best.kind } : null;
}

/** Offsets what is being moved (from the initial state). */
export function applyMoveDelta(ed: Editor3, delta: THREE.Vector3, commit: boolean): void {
  const d = ed.drag;
  const bid = d?.bid ?? ed.lastMoved?.bid;
  const b = bid ? ed.store.building(bid) : undefined;
  if (!b) return;
  if ((d && d.kind === 'move-building') || (!d && ed.lastMoved?.kind === 'building')) {
    // Start: the drag's or, when retyping the distance, the one before the last move.
    const moveTo = (x: Building3, orig: number[] | null) => {
      const base = orig ?? [x.position[0] - ed.lastMoved!.delta.x, x.position[1] - ed.lastMoved!.delta.z];
      x.position = [base[0]! + delta.x, base[1]! + delta.z];
    };
    moveTo(b, d ? d.origBuilding.position : null);
    const others = d ? ((d.data.others as [ID, number[]][] | undefined) ?? []) : ed.lastMoved!.ids.map((id) => [id, null] as [ID, null]);
    for (const [id, p] of others) {
      const x = ed.store.building(id);
      if (x) moveTo(x, p);
    }
    const ids = others.map((o) => o[0]);
    if (commit) {
      ed.lastMoved = { kind: 'building', bid: b.id, ids, delta: delta.clone(), copied: ed.lastMoved?.copied ?? false };
      ed.store.commit([b.id, ...ids], `Moved ${fmt(delta.length())} m.`, false);
    } else ed.view.sync(ed.store.project, ed.store.revision, ed.preview);
    ed.drawSelection();
    return;
  }
  const ids = d ? (d.data.ids as ID[]) : ed.lastMoved!.ids;
  const local = dirToLocal(b, [delta.x, delta.z]);
  for (const sid of ids) {
    const s = findSolid(b, sid);
    const so = d ? findSolid(d.origBuilding, sid) : null;
    if (!s) continue;
    if (so) s.plan = structuredClone(so.plan);
    else translateSolid(s, -dirToLocal(b, [ed.lastMoved!.delta.x, ed.lastMoved!.delta.z])[0], -dirToLocal(b, [ed.lastMoved!.delta.x, ed.lastMoved!.delta.z])[1]);
    translateSolid(s, local[0], local[1]);
  }
  if (commit) {
    ed.lastMoved = { kind: 'solids', bid: b.id, ids, delta: delta.clone(), copied: ed.lastMoved?.copied ?? false };
    ed.store.commit([b.id], `Moved ${fmt(delta.length())} m.`);
  } else ed.store.touch([b.id]);
}

/** Ctrl when starting to move: the original stays, the copy moves. */
export function makeDragCopy(ed: Editor3): void {
  const d = ed.drag!;
  const b = ed.store.building(d.bid)!;
  if (d.kind === 'move-building') {
    const c = cloneBuilding(b);
    c.name = b.name + ' (copy)';
    ed.store.project.buildings.push(c);
    d.bid = c.id;
    d.origBuilding = structuredClone(c);
    ed.sel.building = c.id;
    // The other selected ones become copies too, and the copies are what moves.
    const others = (d.data.others as [ID, number[]][] | undefined) ?? [];
    d.data.others = others.flatMap(([id, p]) => {
      const src = ed.store.building(id);
      if (!src) return [];
      const k = cloneBuilding(src);
      k.name = src.name + ' (copy)';
      k.position = [p[0]!, p[1]!];
      ed.store.project.buildings.push(k);
      return [[k.id, p] as [ID, number[]]];
    });
    ed.sel.others = (d.data.others as [ID, number[]][]).map((o) => o[0]);
  } else if (d.kind === 'move-solids') {
    const ids: ID[] = [];
    for (const sid of d.data.ids as ID[]) {
      const src = findSolid(b, sid);
      if (!src) continue;
      const c = cloneSolid(src);
      b.solids.push(c);
      ids.push(c.id);
    }
    d.data.ids = ids;
    d.origBuilding = structuredClone(b);
    ed.sel.solids = ids;
  }
  d.data.copied = true;
}

/** Offset along the line since where the drag started (grabbing the arrow tip does not jump). */
export function dragAlong(ed: Editor3, d: Drag, e: { clientX: number; clientY: number }, at: THREE.Vector3, dir: THREE.Vector3): number {
  if (d.data.t0 === undefined) d.data.t0 = ed.alongLine({ clientX: d.start.x, clientY: d.start.y }, at, dir);
  return ed.alongLine(e, at, dir) - (d.data.t0 as number);
}

/** Distance along a line (in the world) to the point closest to the mouse ray. */
export function alongLine(ed: Editor3, e: { clientX: number; clientY: number }, at: THREE.Vector3, dir: THREE.Vector3): number {
  const ray = ed.view.rayFrom(e).ray;
  const d = dir.clone().normalize();
  const w0 = at.clone().sub(ray.origin);
  const a = d.dot(d),
    b = d.dot(ray.direction),
    c = ray.direction.dot(ray.direction),
    dd = d.dot(w0),
    ee = ray.direction.dot(w0);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-9) return 0;
  return (b * ee - c * dd) / den;
}

export function finishDrag(ed: Editor3, e: PointerEvent): void {
  const d = ed.drag!;
  const drewPreview = ed.preview.has(d.bid);
  ed.store.changed = false;
  ed.endDrag(d, e);
  // A drag that ended where it began records nothing, but its building was drawn without its facade
  // meanwhile (preview): it is drawn whole again.
  if (d.moved && drewPreview && !ed.store.changed && ed.store.building(d.bid)) ed.store.touch([d.bid]);
}

export function endDrag(ed: Editor3, d: Drag, e: PointerEvent): void {
  ed.drag = null;
  ed.placeCtxBar();
  ed.preview.delete(d.bid);
  ed.clearSnap();
  ed.shell.dim.hidden = true;
  // A press without a drag did nothing, so typing has nothing to correct: digits and 1/2/3 keep their
  // normal meaning (SketchUp's measurements box follows the last operation, not a click).
  // Push and Extrude are the exception (SketchUp Push/Pull: click the face, type the distance, Enter).
  if (!d.moved && !(ed.tool === 'push' || ed.tool === 'extrude' || d.data.handle === 'push')) ed.clearMeasure();
  if (!d.moved && d.data.sub) {
    // Still click in a sub-element mode: the selection made on press stays.
    ed.store.revert();
    return ed.syncSelection();
  }
  if (!d.moved && d.kind === 'iwallnode') {
    // A click (no drag) on a wall corner starts or continues a wall there.
    ed.store.revert();
    return ed.iwallAt(e, true);
  }
  if (!d.moved && d.kind === 'vertex') {
    // Click on a vertex: selects the corner (round, chamfer, delete).
    ed.store.revert();
    return ed.select({ building: ed.sel.building, solids: ed.sel.solids, vertex: d.data.vertex as ID });
  }
  if (!d.moved && d.kind === 'move-building' && d.data.drill) {
    ed.store.revert();
    ed.drilledAt = performance.now();
    ed.enter(d.bid);
    return ed.select({ building: d.bid, solids: [d.data.drill as ID] });
  }
  if (!d.moved && d.data.click) {
    // Still click on an object of the multiple selection: only it stays.
    ed.store.revert();
    const c = d.data.click as { hit: Hit; ev: Mods };
    return ed.clickSelect(c.hit, c.ev);
  }
  if (!d.moved) {
    ed.store.revert();
    // Click without dragging on a handle: counts as a click on the model (select face, etc.).
    if (d.data.viaHandle && ed.selectLike()) ed.clickSelect(ed.pickAt(e), e);
    else ed.drawSelection();
    return;
  }
  const b = ed.store.building(d.bid);
  if (d.kind === 'lift-building' && b) {
    ed.store.commit([b.id], `Elevation ${fmt(b.elevation ?? 0)} m.`, false);
    return;
  }
  if (d.kind === 'move-building' && b) {
    const delta = new THREE.Vector3(b.position[0] - d.origBuilding.position[0], 0, b.position[1] - d.origBuilding.position[1]);
    ed.lastMove = delta.clone();
    const ids = ((d.data.others as [ID, number[]][] | undefined) ?? []).map((o) => o[0]);
    // Dropped through another building: it joins it (one body; the booleans join the walls and roofs).
    // Alt keeps them apart. Several buildings moved together are left as they are.
    const into = !ids.length && !e.altKey ? buildingPassedThrough(ed.project, worldParts(b), b.id) : null;
    if (into) {
      const moved = b.solids.map((x) => x.id);
      mergeInto(into, b);
      ed.store.project.buildings = ed.store.project.buildings.filter((x) => x.id !== b.id);
      ed.lastMoved = null;
      const msg = `${d.origBuilding.name} joined to ${into.name}: dropped through it, so it is one building now.`;
      if (ed.store.commit([into.id], msg)) {
        ed.enter(null);
        ed.select({ building: into.id });
        ed.toast(msg);
        // Joining is the likely answer and is done; the chooser offers the others (Estúdio de Construção).
        ed.composeChooser(e, into.id, moved, d.origBuilding.name);
      }
      return;
    }
    ed.lastMoved = { kind: 'building', bid: b.id, ids, delta, copied: !!d.data.copied };
    ed.store.commit([b.id, ...ids], d.data.copied ? 'Copied. Type 5x for more copies.' : `Moved ${fmt(delta.length())} m.`, !!d.data.copied);
    if (d.data.copied) ed.toast('Copied. Type 5x for more copies.');
    return;
  }
  if (d.kind === 'move-solids' && b) {
    const s = findSolid(b, (d.data.ids as ID[])[0]!),
      so = findSolid(d.origBuilding, (d.data.ids as ID[])[0]!);
    if (s && so) {
      const a = toWorld(b, planCenter(so)),
        c = toWorld(b, planCenter(s));
      const delta = new THREE.Vector3(c[0] - a[0], 0, c[1] - a[1]);
      ed.lastMove = delta;
      ed.lastMoved = { kind: 'solids', bid: b.id, ids: d.data.ids as ID[], delta, copied: !!d.data.copied };
    }
  }
  if ((d.kind === 'extrude-side' || d.kind === 'extrude-top') && b) {
    const id = d.data.created as ID | undefined;
    ed.store.commit([d.bid], id ? 'Volume extruded.' : '');
    if (id) {
      ed.toast('Volume extruded: it is a new, editable volume.');
      ed.select({ building: b.id, solids: [id] });
    }
    return;
  }
  if (d.kind === 'rotate' && !d.data.inCtx) {
    ed.store.commit([d.bid], 'Rotated.', false);
    return;
  }
  if (d.kind === 'side-depth' && b) {
    const hf = hostedFrame(findSolid(b, d.data.sid as ID) ?? ({} as Solid));
    const msg = hf ? (hf.depth > 0 ? `Projection ${fmt(hf.depth)} m.` : `Niche ${fmt(-hf.depth)} m deep.`) : '';
    if (ed.store.commit([d.bid], msg) && msg) ed.toast(msg);
    return;
  }
  ed.store.commit([d.bid], '');
  void e;
}
