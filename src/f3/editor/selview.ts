// What the editor draws for the selection: outlines, handles, the dimensions of the selection (editable on the label) and the hover highlight.
import * as THREE from 'three';
import type { Building3, ID, Solid, Vec2 } from '../model/schema';
import { inside, edgeNormal, findSolid, planCenter, pushEdge } from '../model/ops';
import { solidRings } from '../eval/body';
import { hostedFrame } from '../model/modeling';
import { explodeGap } from '../model/layers';
import { invert } from '../model/selsets';
import { arcOf } from '../model/plan';
import { type Hit } from './view';
import { HANDLE_COLORS, type Handle, type HandleKind } from './handles';
import { family } from '../families/index';
import { dimParams, partBox } from '../eval/partsize';
import type { FaceInfo } from '../eval/faces';
import { type Bounds } from '../eval/bounds';
import { between } from './elements';
import { placeLabels } from './labels';
import { type Tool, type Selection, type Drag, fmt, midOf, halfway, faceSelOf } from './support';
import type { Editor3 } from './editor';

/** Selection outlines and handles. */
export function drawSelection(ed: Editor3): void {
  // Screen-space outline of the selected buildings (not while editing inside one: its own lines show
  // the volume or face chosen there).
  const outlined = !ed.context && ed.sel.building ? [ed.sel.building, ...ed.sel.others].map((id) => ed.view.built.get(id)?.group).filter((g): g is THREE.Group => !!g) : [];
  ed.view.look.setOutline(outlined);
  for (const c of [...ed.selOverlay.children]) {
    ed.selOverlay.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    if (m.material && !Array.isArray(m.material)) (m.material as THREE.Material).dispose();
  }
  const handles: Handle[] = [];
  const b = ed.activeBuilding();
  // A street or a lot selected: a dot on each of its points (drag to reshape) and arrows to move it.
  const sp = ed.view.sitePicked;
  if (!b && (sp.lot || sp.street)) {
    const pts = sp.street ? ed.project.streets?.find((x) => x.id === sp.street)?.points : ed.project.lots.find((x) => x.id === sp.lot)?.polygon;
    if (pts?.length) {
      pts.forEach((p, i) => handles.push({ kind: 'vertex', at: new THREE.Vector3(p[0], 0.3, p[1]), color: HANDLE_COLORS.vertex, label: sp.street ? 'Street point: drag it' : 'Lot corner: drag it', site: { index: i } }));
      const c = new THREE.Vector3(pts.reduce((a, p) => a + p[0], 0) / pts.length, 0.3, pts.reduce((a, p) => a + p[1], 0) / pts.length);
      handles.push({ kind: 'move-x', at: c.clone(), dir: new THREE.Vector3(1, 0, 0), color: HANDLE_COLORS.x, label: 'Move (X)', site: { index: -1 } });
      handles.push({ kind: 'move-z', at: c.clone(), dir: new THREE.Vector3(0, 0, 1), color: HANDLE_COLORS.z, label: 'Move (Z)', site: { index: -1 } });
    }
    ed.handles.set(ed.tool === 'select' || ed.tool === 'move' ? handles : []);
    ed.placeCtxBar();
    return;
  }
  // Interior walls tool: the nodes of the walls of the floor shown (drag) and each wall's middle
  // (Alt+click deletes the wall), in the building being edited.
  const iwb = ed.tool === 'iwall' || ed.tool === 'walls' ? (ed.store.building(ed.context) ?? b) : undefined;
  if (iwb) {
    const lv = ed.workLevel(iwb);
    const it = lv ? iwb.interiors[lv.id] : undefined;
    const hs: Handle[] = [];
    if (lv && it) {
      const IM = ed.view.buildingMatrix(iwb);
      const y = lv.elevation + 0.05;
      const at = (q: Vec2) => new THREE.Vector3(q[0], y, q[1]).applyMatrix4(IM);
      const pos = new Map(it.nodes.map((n) => [n.id, n.p]));
      for (const n of it.nodes) hs.push({ kind: 'vertex', at: at(n.p), color: HANDLE_COLORS.vertex, label: 'Wall corner: drag it (its walls follow)', iwall: { level: lv.id, node: n.id } });
      for (const w of it.walls) {
        const a = pos.get(w.a),
          c = pos.get(w.b);
        if (a && c) hs.push({ kind: 'bend', at: at([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]), color: HANDLE_COLORS.bend, label: 'Wall: Alt+click deletes it', iwall: { level: lv.id, wall: w.id } });
      }
    }
    ed.handles.set(hs);
    ed.placeCtxBar();
    return;
  }
  // Floors drawn apart are not where the building is: its box, handles and dimensions would cross them
  // (and nothing can be edited meanwhile). The selection stays; the panel still shows it.
  if (!b || explodeGap(ed.project) > 0) {
    ed.handles.set([]);
    ed.placeCtxBar();
    ed.drawSelDims();
    return;
  }
  const M = ed.view.buildingMatrix(b);
  const W = (p: Vec2, y: number) => new THREE.Vector3(p[0], y, p[1]).applyMatrix4(M);
  // Outline with depth test: strong where it is in view, faint where
  // it passes behind walls and roofs (never a line crossing the facade).
  const line = (pts: THREE.Vector3[], color: string, closed = true, opacity = 1) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const Kind = closed ? THREE.LineLoop : THREE.Line;
    const front = new Kind(g, new THREE.LineBasicMaterial({ color, depthTest: true, transparent: opacity < 1, opacity }));
    const behind = new Kind(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.16 * opacity }));
    front.renderOrder = 20;
    behind.renderOrder = 19;
    ed.selOverlay.add(front, behind);
  };
  // Box of the real bounds (local → world by the building matrix).
  const boxLines = (bb: Bounds, color: string, BM = M) => {
    const [x0, y0, z0] = bb.min,
      [x1, y1, z1] = bb.max;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(BM);
    line([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], color);
    line([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], color);
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) line([P(x, y0, z), P(x, y1, z)], color, false);
  };
  const [ax, az] = [new THREE.Vector3(1, 0, 0).transformDirection(M), new THREE.Vector3(0, 0, 1).transformDirection(M)];
  // Other buildings selected together: the same box as the main one (every selected building reads as selected).
  for (const oid of ed.sel.others) {
    const ob = ed.store.building(oid);
    if (!ob) continue;
    const OM = ed.view.buildingMatrix(ob);
    for (const s of ob.solids) if (s.op === 'add') line(solidRings(s).outer.pts.map((p) => new THREE.Vector3(p[0], s.base + 0.03, p[1]).applyMatrix4(OM)), '#2f7de1', true, 1);
    const ob3 = ed.boundsOf(ob);
    if (ob3) boxLines(ob3, '#2f7de1', OM);
  }
  // Outline of each solid of the building (the selected one highlighted).
  const inCtx = ed.context === b.id;
  for (const s of b.solids) {
    const r = solidRings(s);
    const sel = ed.sel.solids.includes(s.id);
    if (!inCtx && !sel) {
      if (s.op !== 'add') continue;
      line(r.outer.pts.map((p) => W(p, s.base + 0.03)), '#2f7de1', true, 0.9);
      continue;
    }
    const color = sel ? '#e2702a' : s.op === 'add' ? '#2f7de1' : '#c026d3';
    const op = sel ? 1 : 0.45;
    // A cutter is outlined where it cuts something: between the lowest base and the highest top of the
    // adding volumes (a courtyard cutter 30 m tall left a square in the sky, 16 m over the roof).
    let lo = r.base,
      hi = r.top;
    if (s.op !== 'add' && !sel) {
      const adds = b.solids.filter((x) => x.op === 'add');
      if (adds.length) {
        lo = Math.max(lo, Math.min(...adds.map((x) => x.base)));
        hi = Math.min(hi, Math.max(...adds.map((x) => x.base + x.height)));
      }
    }
    const at = (y: number) => {
      const f = r.top > r.base ? Math.max(0, Math.min(1, (y - r.base) / (r.top - r.base))) : 0;
      return r.outer.pts.map((p, i) => {
        const q = r.topOuter[i] ?? p;
        return W([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], y);
      });
    };
    if (hi <= lo) continue;
    line(lo === r.base ? r.outer.pts.map((p) => W(p, r.base)) : at(lo), color, true, op);
    // Selected: the box wraps everything the volume generates (roof, overhang, parts).
    if (sel) {
      const bb = ed.boundsOf(b, [s.id]);
      if (bb) boxLines(bb, color);
    } else line(hi === r.top ? r.topOuter.map((p) => W(p, r.top)) : at(hi), color, true, op);
  }
  // Whole building selected: the box of the real bounds.
  // Edge mode: the selected sides, at the base and at the top, in the selection color.
  const sEdges = inCtx ? ed.activeSolid() : undefined;
  if (sEdges && ed.sel.edges?.length)
    for (const se of ed.subOf(b, sEdges).edges)
      if (ed.sel.edges.includes(se.id)) for (const [a, c] of se.segs) line([new THREE.Vector3(a[0], a[1], a[2]).applyMatrix4(M), new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(M)], '#e2702a', false);
  const whole = !inCtx ? ed.boundsOf(b) : null;
  if (whole) boxLines(whole, '#2f7de1');
  // Slab lines (like FormIt levels): every floor visible on the facade.
  for (const lv of b.levels) {
    if (lv.elevation < 0.05) continue;
    for (const s of b.solids) {
      if (s.op !== 'add' || lv.elevation <= s.base + 0.05 || lv.elevation >= s.base + s.height - 0.05) continue;
      const r = solidRings(s);
      const f = (lv.elevation - s.base) / s.height;
      const pts = r.outer.pts.map((p, i) => {
        const q = r.topOuter[i] ?? p;
        return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f] as Vec2;
      });
      // Slightly outside the wall (does not fight it in depth).
      const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
      const out = pts.map((p) => {
        const dx = p[0] - c[0],
          dz = p[1] - c[1],
          l = Math.hypot(dx, dz) || 1;
        return W([p[0] + (dx / l) * 0.05, p[1] + (dz / l) * 0.05], lv.elevation);
      });
      line(out, '#ffffff', true, 0.55);
    }
  }
  // Selected face: translucent highlight of its triangles.
  const s0 = ed.activeSolid();
  const built = ed.view.built.get(b.id);
  if (s0 && ed.sel.face && built) {
    const fk = ed.sel.face.kind;
    const want = (f: FaceInfo | undefined) =>
      !!f && f.solid === s0.id && (fk === 'top' ? f.kind === 'top' || f.kind === 'roof' : fk === 'plinth' ? f.kind === 'plinth' : fk === 'parapet' ? f.kind === 'parapet' || f.kind === 'coping' : f.kind === 'side' && f.edge === ed.sel.face!.edge);
    const { positions: P, indices: I, faceOf } = built.ev.shell;
    const pos: number[] = [];
    for (let t = 0; t < I.length / 3; t++) {
      if (!want(built.ev.faces[faceOf[t]!])) continue;
      for (let j = 0; j < 3; j++) {
        const i = I[t * 3 + j]! * 3;
        pos.push(P[i]!, P[i + 1]!, P[i + 2]!);
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#e2702a', transparent: true, opacity: 0.28, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.applyMatrix4(M);
      m.renderOrder = 15;
      ed.selOverlay.add(m);
    }
  }
  // Selected elements: an outline box on each.
  if (ed.sel.elems.length && built) {
    const pos = ed.elemBoxes(b, new Set(ed.sel.elems));
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      // Strong where the element shows; faint where it is hidden (courtyard, another face).
      const front = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: true }));
      const behind = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#e2702a', depthTest: false, transparent: true, opacity: 0.22 }));
      front.renderOrder = 22;
      behind.renderOrder = 21;
      ed.selOverlay.add(front, behind);
    }
  }
  if (ed.drag) {
    ed.handles.set(ed.handles.list.filter((h) => h.kind === (ed.drag!.data.handle as string)));
    ed.placeCtxBar();
    return;
  }
  if (!inCtx) {
    // Whole building: move on the ground and rotate.
    const bb = whole ?? ed.prismBounds(b, b.solids.filter((x) => x.op === 'add'));
    if (bb) {
      // Above the highest point (roof included): visible from any angle, without crossing the model.
      const c = new THREE.Vector3((bb.min[0] + bb.max[0]) / 2, bb.max[1] + 0.6, (bb.min[2] + bb.max[2]) / 2).applyMatrix4(M);
      const R = Math.max(Math.hypot(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2 + 1.5, 4);
      handles.push(...ed.gizmo(c, ax, az, R));
      handles.push(...ed.sizeHandles(b, bb));
      // Green = move vertically (Rhino Gumball, TransformControls): the building leaves the ground and
      // snaps onto the top of another. Floors are not on the gizmo (contextual bar and panel).
      if (ed.tool === 'move') handles.push({ kind: 'move-y', at: c.clone(), dir: new THREE.Vector3(0, 1, 0), color: HANDLE_COLORS.y, label: 'Move vertically (snaps to the ground and to the top of other buildings; Alt: free)' });
    }
  } else if (ed.sel.item) {
    const it = ed.activeItem();
    if (it && (it.host.kind === 'free' || it.host.kind === 'roof')) {
      // Real height of the part (on a roof, that of the surface it is on).
      const pl = built?.ev.placements.find((q) => q.tag.item === it.id);
      const y = pl ? pl.frame[13]! : it.host.kind === 'free' ? it.host.p[1] : 0;
      const p = it.host.kind === 'free' ? it.host.p : [it.host.p[0], y, it.host.p[1]];
      const c = W([p[0]!, p[2]!], y + 0.05);
      handles.push(...ed.gizmo(c, ax, az, 2.5));
    }
    // Part attached to a face: width, height and sill handles on it.
    if (it && it.host.kind === 'face' && built) {
      const pl = built.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
      if (pl) {
        const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
        const [w, h] = pl.family.size(pl.params);
        const op = pl.opening;
        const ow = op?.w ?? w,
          oh = op?.h ?? h;
        const P = (x: number, y: number) => new THREE.Vector3(x, y, 0.15).applyMatrix4(F);
        const U = new THREE.Vector3(1, 0, 0).transformDirection(F),
          V = new THREE.Vector3(0, 1, 0).transformDirection(F);
        // Slide it along the wall and up or down (the size handles on each side come below).
        handles.push({ kind: 'pmove', at: P(0, oh / 2).addScaledVector(U, -Math.max(0.6, ow / 2 + 0.35)), dir: U.clone().negate(), color: HANDLE_COLORS.x, label: 'Slide along the wall', pmove: 0 });
        handles.push({ kind: 'pmove', at: P(0, oh / 2).addScaledVector(U, Math.max(0.6, ow / 2 + 0.35)), dir: U.clone(), color: HANDLE_COLORS.x, label: 'Slide along the wall', pmove: 0 });
        handles.push({ kind: 'pmove', at: P(0, oh + 0.45), dir: V.clone(), color: HANDLE_COLORS.y, label: 'Up or down the wall', pmove: 1 });
      }
    }
    // A part drawn as a path: a dot on each of its points (drag to reshape); dragging the part moves it.
    if (it && it.host.kind === 'path') {
      const ps = it.host.points;
      ps.forEach((q, i) => handles.push({ kind: 'vertex', at: new THREE.Vector3(q[0], q[1] + 0.05, q[2]).applyMatrix4(M), color: HANDLE_COLORS.vertex, label: 'Path point: drag it (Alt+click removes it)', pathPt: i }));
      // Midpoints of the runs: dragging one adds a point there (Blender's edge slide / SketchUp's divide).
      const runs = it.host.closed ? ps.length : ps.length - 1;
      for (let i = 0; i < runs; i++) {
        const a = ps[i]!,
          c2 = ps[(i + 1) % ps.length]!;
        handles.push({ kind: 'bend', at: new THREE.Vector3((a[0] + c2[0]) / 2, (a[1] + c2[1]) / 2 + 0.05, (a[2] + c2[2]) / 2).applyMatrix4(M), color: HANDLE_COLORS.bend, label: 'Drag to add a point here', pathPt: i, pathMid: true });
      }
    }
    // Any part, whatever its family: a handle on each side of its box that a length parameter moves
    // (eval/partsize.ts). On a wall, width and height keep the handles above.
    // A path part (wall, fence, hedge): the box of its first run, in that run's frame (x along it).
    if (it && built) {
      const pl = built.ev.placements.find((q) => q.tag.item === it.id && (q.tag.key ?? '0') === '0');
      const isPath = it.host.kind === 'path';
      const pts = it.host.kind === 'path' ? it.host.points : [];
      const runLen = isPath && pts.length >= 2 ? Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![2] - pts[0]![2]) : pl?.length ?? 1;
      const bx = pl && partBox(pl.family, pl.params, runLen);
      if (pl && bx && (!isPath || pts.length >= 2)) {
        let F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
        if (isPath) {
          const a = pts[0]!,
            c2 = pts[1]!;
          const ang = Math.atan2(-(c2[2] - a[2]), c2[0] - a[0]);
          F = new THREE.Matrix4().makeRotationY(ang).setPosition((a[0] + c2[0]) / 2, a[1], (a[2] + c2[2]) / 2).premultiply(M);
        }
        const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
        const c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
        // A handle on BOTH sides of each axis a parameter drives: the part grows toward the side dragged,
        // the opposite side stays where it is (the part slides by what that side would have moved).
        // Depth on a wall only grows outward (the wall is behind it).
        for (const d of dimParams(pl.family, pl.params)) {
          for (const side of [1, -1] as const) {
            if (it.host.kind === 'face' && d.axis === 2 && side < 0) continue;
            // A path part grows from its line (the length is its points): only the outer sides, no length.
            if (isPath && (side < 0 || d.axis === 0)) continue;
            // Only on a side that moves with this measure (a slab thickness grows downward only).
            if ((side > 0 ? d.up : d.down) < 0.25) continue;
            const q = [...c] as [number, number, number];
            q[d.axis] = side > 0 ? bx.max[d.axis]! : bx.min[d.axis]!;
            // Depth sits at a lower corner of the front, never over the middle of the part (where a drag moves it).
            if (d.axis === 2 && !isPath) {
              q[0] = bx.max[0];
              q[1] = bx.min[1];
            }
            const at = new THREE.Vector3(...q).applyMatrix4(F);
            const dir = axes[d.axis]!.clone().multiplyScalar(side).transformDirection(F);
            handles.push({ kind: 'pdim', at, dir, color: '#e2702a', label: `${d.label}: drag ed side (type the value)`, square: true, param: { key: d.key, slope: d.slope, min: d.min, max: d.max, label: d.label, up: d.up, down: d.down, side, axis: d.axis } });
          }
        }
        // Scale it all together: the top corner (every size parameter by the same ratio).
        const dps = dimParams(pl.family, pl.params);
        if (dps.length) {
          const corner = new THREE.Vector3(bx.max[0], bx.max[1], it.host.kind === 'face' ? bx.max[2] : bx.max[2]).applyMatrix4(F);
          const ctr = new THREE.Vector3(c[0], bx.min[1], c[2]).applyMatrix4(F);
          handles.push({ kind: 'pscale', at: corner, dir: corner.clone().sub(ctr).normalize(), color: '#e2702a', label: 'Scale it all (proportions kept)', square: true });
        }
        // Free parts also go up and down (a lamp on a wall, a sign, a shelf).
        if (it.host.kind === 'free') handles.push({ kind: 'pmove', at: new THREE.Vector3(c[0], bx.max[1] + 0.6, c[2]).applyMatrix4(F), dir: new THREE.Vector3(0, 1, 0), color: HANDLE_COLORS.y, label: 'Up or down', pmove: 1 });
      }
    }
  } else if (ed.sel.elems.length === 1 && ed.sel.elems[0]!.startsWith('r|') && built) {
    // One element of a facade rule: the same size handles, written for this position only.
    const [, sid, rid, pos] = ed.sel.elems[0]!.split('|');
    const pl = built.ev.placements.find((q) => q.tag.rule === rid && q.tag.key === pos && q.tag.solid === sid);
    const bx = pl && partBox(pl.family, pl.params, pl.length);
    if (pl && bx) {
      const F = new THREE.Matrix4().fromArray(pl.frame).premultiply(M);
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
      const c = [(bx.min[0] + bx.max[0]) / 2, (bx.min[1] + bx.max[1]) / 2, (bx.min[2] + bx.max[2]) / 2];
      for (const d of dimParams(pl.family, pl.params)) {
        const q = [...c] as [number, number, number];
        q[d.axis] = d.side > 0 ? bx.max[d.axis]! : bx.min[d.axis]!;
        if (d.axis === 2) {
          q[0] = bx.max[0];
          q[1] = bx.min[1];
        }
        handles.push({ kind: 'pdim', at: new THREE.Vector3(...q).applyMatrix4(F), dir: axes[d.axis]!.clone().multiplyScalar(d.side).transformDirection(F), color: '#e2702a', label: `${d.label} here only (drag; type the value)`, square: true, solid: sid, param: { key: d.key, slope: d.slope, min: d.min, max: d.max, label: d.label }, rule: { id: rid!, pos: pos!, v0: Number(pl.params[d.key] ?? 1) } });
      }
    }
  } else if (s0) {
    const r = solidRings(s0);
    const ctr = planCenter(s0);
    const base = W(ctr, s0.base + 0.05);
    const top = W(ctr, r.top);
    const faceMode = !!ed.sel.face;
    // Move and rotate above the top of the volume (without crossing the walls); with a face chosen, only the face arrow.
    const sb = ed.boundsOf(b, [s0.id]);
    // Gizmo raised in pixels above the real top: the height square (on top) always stays below it.
    const over = W(ctr, sb ? sb.max[1] : r.top);
    if (!faceMode) {
      const R0 = Math.max(...r.outer.pts.map((p) => Math.hypot(p[0] - ctr[0], p[1] - ctr[1]))) + 1.2;
      handles.push(...ed.gizmo(over, ax, az, R0).map((h) => (h.kind === 'rotate' ? h : { ...h, liftPx: 46 })));
      if (ed.tool === 'move') handles.push({ kind: 'move-y', at: over.clone(), dir: new THREE.Vector3(0, 1, 0), liftPx: 46, color: HANDLE_COLORS.y, label: 'Move vertically: base elevation (snaps to tops, bases and floors; Alt: free)' });
      handles.push({ kind: 'height', at: over.clone(), square: true, color: '#ffffff', label: 'Volume height: drag the top (floor by floor; Alt: free; type the value)' });
      // Corners resize; each side has its own push/pull arrow (below).
      if (sb) handles.push(...ed.sizeHandles(b, sb).filter((h) => h.sx && h.sz));
      // Made on a face: one depth arrow on its free face, measured from the wall (out adds, in cuts);
      // the wall side has none (pulling it only stretched a cutter into the air).
      const hf = hostedFrame(s0);
      const along = hf ? [s0.plan.outer[0]!.id, s0.plan.outer[2]!.id] : [];
      if (hf) {
        const mid: Vec2 = [(hf.a[0] + hf.z[0]) / 2 + hf.n[0] * hf.depth, (hf.a[1] + hf.z[1]) / 2 + hf.n[1] * hf.depth];
        const dir = new THREE.Vector3(hf.n[0], 0, hf.n[1]).transformDirection(M);
        handles.push({ kind: 'push', hosted: true, at: W(mid, s0.base + s0.height / 2), dir, normal: dir.clone(), solid: s0.id, color: HANDLE_COLORS.push, label: 'Depth from the wall: pull out for a projection, push in for a niche (type the value; − = niche)' });
      }
      for (const ring of [s0.plan.outer, ...s0.plan.holes])
        ring.forEach((v, k) => {
          if (along.includes(v.id)) return;
          const n = edgeNormal(s0, v.id);
          if (!n) return;
          const mid = midOf(v, ring[(k + 1) % ring.length]!);
          const dir = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
          handles.push({ kind: 'push', at: W(mid, s0.base + s0.height / 2), dir, normal: dir.clone(), solid: s0.id, edge: v.id, color: HANDLE_COLORS.push, label: 'Push/pull ed side (Ctrl: extrude)' });
        });
    }
    // Top chosen: orange push/pull arrow, like the side faces (Ctrl: extrude).
    if (faceMode && ed.sel.face?.kind === 'top') handles.push({ kind: 'height', at: top, dir: new THREE.Vector3(0, 1, 0), solid: s0.id, color: HANDLE_COLORS.push, label: 'Push/pull the top (floor by floor; Alt: free; Ctrl: extrude)' });
    void base;
    // Vertices and side midpoints (bend), at the base when tapered, otherwise on top.
    const yv = s0.taper > 0.01 || s0.loft ? r.base : r.top;
    for (const ring of [s0.plan.outer, ...s0.plan.holes])
      ring.forEach((v, i) => {
        const n = ring[(i + 1) % ring.length]!;
        handles.push({ kind: 'vertex', at: W(v.p, yv), solid: s0.id, vertex: v.id, color: ed.sel.verts?.includes(v.id) ? HANDLE_COLORS.push : HANDLE_COLORS.vertex, label: 'Vertex' });
        const mid = midOf(v, n);
        handles.push({ kind: 'bend', at: W(mid, yv), solid: s0.id, edge: v.id, color: HANDLE_COLORS.bend, label: 'Bend (snaps to straight and to a half circle; Alt: free)' });
      });
    // Twist: a dot on the top, toward the first corner; dragging it around turns the top against the base.
    if (!faceMode && s0.op === 'add' && !s0.revolve) {
      const v0 = s0.plan.outer[0]!.p;
      const tp: Vec2 = [ctr[0] + (v0[0] - ctr[0]) * 0.55, ctr[1] + (v0[1] - ctr[1]) * 0.55];
      handles.push({ kind: 'twist', at: W(tp, r.top + 0.02), solid: s0.id, color: HANDLE_COLORS.ring, label: 'Twist: drag around to turn the top (5° steps; Alt: free)' });
    }
    if (ed.sel.face?.kind === 'side' && ed.sel.face.edge) {
      const n = edgeNormal(s0, ed.sel.face.edge);
      const loc = s0.plan.outer.concat(...s0.plan.holes);
      const vi = loc.findIndex((v) => v.id === ed.sel.face!.edge);
      if (n && vi >= 0) {
        const ringOf = [s0.plan.outer, ...s0.plan.holes].find((rg) => rg.some((v) => v.id === ed.sel.face!.edge))!;
        const k = ringOf.findIndex((v) => v.id === ed.sel.face!.edge);
        const mid = midOf(ringOf[k]!, ringOf[(k + 1) % ringOf.length]!);
        const at = W(mid, s0.base + s0.height / 2);
        const dir = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
        handles.push({ kind: 'push', at, dir, normal: dir.clone(), solid: s0.id, edge: ed.sel.face.edge, color: HANDLE_COLORS.push, label: 'Push/pull (Ctrl: extrude)' });
      }
    }
  }
  // A visible handle is a clickable handle: only the manipulating tools (Select and Push) show them.
  // Move, Rotate and Scale show only the handles of that action (like W/E/R in Blender and three.js).
  const only: Partial<Record<Tool, HandleKind[]>> = {
    move: ['move-x', 'move-z', 'move-xz', 'move-y', 'pmove'],
    rotate: ['rotate'],
    scale: ['size', 'height', 'push', 'cwidth', 'cheight', 'pdim', 'pscale'],
  };
  const keep = only[ed.tool];
  ed.handles.set(!ed.handlesLive() ? [] : keep ? handles.filter((h) => keep.includes(h.kind)) : handles);
  ed.placeCtxBar();
  ed.drawSelDims();
}

/** Selection dimensions: each side of the volume and the height, always visible and never touching each other. */
export function drawSelDims(ed: Editor3): void {
  ed.placeSelDims();
  ed.declutterDims();
}

/**
 * Labeling like map renderers (`labels.ts`): the height first, then each side, takes
 * the nearest free spot around its anchor, clear of the handles (a dimension never sits
 * under an arrow, point or square), the panels and the dimensions already placed. With
 * no free spot within reach it hides: never one label over another.
 * All rectangles are read before any label moves (one layout, no reflow per label).
 */
export function declutterDims(ed: Editor3): void {
  const els = [...ed.shell.view.querySelectorAll<HTMLElement>('.f3-sdim')];
  if (!els.length) return;
  els.sort((a, b) => Number(a.dataset.prio ?? 1) - Number(b.dataset.prio ?? 1));
  const v = ed.shell.view.getBoundingClientRect();
  const boxes = els.map((el) => el.getBoundingClientRect());
  const obstacles = [...ed.handles.footprints(), ...ed.islands()];
  const at = placeLabels(boxes, obstacles, { left: v.left, top: v.top, right: v.right, bottom: v.bottom });
  els.forEach((el, i) => {
    const o = at[i];
    if (!o) {
      el.hidden = true;
      return;
    }
    if (o[0]) el.style.left = `${parseFloat(el.style.left) + o[0]}px`;
    if (o[1]) el.style.top = `${parseFloat(el.style.top) + o[1]}px`;
  });
}

/**
 * Editable dimension (Revit temporary dimensions): click the value, type, Enter applies
 * (Tab applies and goes to the next one, Esc cancels). Values with a point or a comma.
 */
export function makeDimEditable(ed: Editor3, el: HTMLElement, value: number, apply: (v: number) => boolean | void, prefix = ''): void {
  el.classList.add('edit');
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.querySelector('input')) return;
    ed.dimEditing = true;
    el.textContent = prefix;
    const input = document.createElement('input');
    input.value = fmt(value);
    input.setAttribute('aria-label', 'Dimension value in meters');
    el.append(input, ' m');
    input.focus();
    input.select();
    let done = false;
    const close = (ok: boolean, next: boolean) => {
      if (done) return;
      done = true;
      const order = [...ed.shell.view.querySelectorAll<HTMLElement>('.f3-sdim.edit:not([hidden])')];
      const at = order.indexOf(el);
      ed.dimEditing = false;
      if (ok) {
        const v = parseFloat(input.value.replace(',', '.'));
        if (!(v > 0.05 && v < 2000)) ed.toast('Type a length in meters, like 12 or 12.5.');
        else if (Math.abs(v - value) > 1e-4 && apply(v) === false) ed.toast('That value does not fit here.');
      }
      ed.drawSelDims();
      if (next) [...ed.shell.view.querySelectorAll<HTMLElement>('.f3-sdim.edit:not([hidden])')][at + 1]?.click();
    };
    input.addEventListener('keydown', (k) => {
      k.stopPropagation();
      if (k.key === 'Enter') close(true, false);
      else if (k.key === 'Tab') {
        k.preventDefault();
        close(true, true);
      } else if (k.key === 'Escape') close(false, false);
    });
    input.addEventListener('blur', () => close(false, false));
  });
}

export function placeSelDims(ed: Editor3): void {
  if (ed.dimEditing) return;
  ed.shell.view.querySelectorAll('.f3-sdim').forEach((x) => x.remove());
  const b = ed.activeBuilding();
  // The cut tool measures at the pointer: the selection's dimensions would sit under its label.
  if (!b || ed.drag || explodeGap(ed.project) > 0 || ed.tool === 'cut') return;
  const M = ed.view.buildingMatrix(b);
  // `prio` 0 is placed before the others when they crowd (the height of the whole volume or building).
  const put = (p: THREE.Vector3, text: string, edit?: { value: number; apply: (v: number) => boolean | void; prefix?: string }, dx = 0, prio = 1) => {
    const sp = ed.view.toScreen(p);
    if (sp.behind) return;
    const el = document.createElement('div');
    el.className = 'f3-dim f3-sdim';
    el.textContent = text;
    el.style.left = `${sp.x + dx}px`;
    el.style.top = `${sp.y}px`;
    if (prio !== 1) el.dataset.prio = String(prio);
    if (edit) ed.makeDimEditable(el, edit.value, edit.apply, edit.prefix);
    ed.shell.view.appendChild(el);
  };
  const solids = ed.context === b.id ? ed.sel.solids.map((id) => findSolid(b, id)).filter((s): s is Solid => !!s) : [];
  if (solids.length === 1 && !ed.sel.elems.length && !ed.sel.item) {
    const s = solids[0]!;
    const r = solidRings(s);
    // Length of each side between its plan vertices (the virtual corner, like the Width field: rounding
    // or chamfering a corner does not shorten what the side measures); an arc by its arc length.
    const ring0 = s.plan.outer;
    const arcs = ring0.map((v, k) => (v.bulge ? arcOf(v.p, ring0[(k + 1) % ring0.length]!.p, v.bulge) : null));
    const sides = new Map<string, { len: number }>();
    ring0.forEach((v, k) => {
      const c = ring0[(k + 1) % ring0.length]!.p;
      const arc = arcs[k];
      sides.set(v.id, { len: arc ? arc.r * Math.abs(arc.theta) : Math.hypot(c[0] - v.p[0], c[1] - v.p[1]) });
    });
    const eye = ed.view.camera.position;
    // A circle (every side an arc of one center and radius) has one size: its diameter.
    const a0 = arcs[0];
    if (a0 && arcs.every((q) => q && Math.hypot(q.c[0] - a0.c[0], q.c[1] - a0.c[1]) < 1e-3 * a0.r + 1e-6 && Math.abs(q.r - a0.r) < 1e-3 * a0.r + 1e-6)) {
      const toEye = new THREE.Vector3().copy(eye).applyMatrix4(M.clone().invert());
      const dx = toEye.x - a0.c[0],
        dz = toEye.z - a0.c[1];
      const l = Math.hypot(dx, dz) || 1;
      const D = 2 * a0.r;
      put(new THREE.Vector3(a0.c[0] + (dx / l) * (a0.r + 0.9), s.base + 0.05, a0.c[1] + (dz / l) * (a0.r + 0.9)).applyMatrix4(M), `⌀ ${fmt(D)} m`, {
        value: D,
        prefix: '⌀ ',
        apply: (v) => ed.modelOp('size', { w: v, d: v }),
      });
      sides.clear();
    }
    const sub = ed.subOf(b, s);
    for (const [edge, v] of sides) {
      const ring = s.plan.outer;
      const k = ring.findIndex((q) => q.id === edge);
      if (k < 0) continue;
      const m = midOf(ring[k]!, ring[(k + 1) % ring.length]!);
      const n = edgeNormal(s, edge) ?? [0, 0];
      let at = new THREE.Vector3(m[0] + n[0] * 0.9, s.base + 0.05, m[1] + n[1] * 0.9);
      // A side facing away is measured on its top edge, the one seen: its base is behind the
      // volume and the label would float over the front facade.
      const nW = new THREE.Vector3(n[0], 0, n[1]).transformDirection(M);
      if (nW.dot(eye.clone().sub(new THREE.Vector3(m[0], s.base, m[1]).applyMatrix4(M))) < 0) {
        const top = halfway(sub.edges.find((e) => e.id === edge)?.segs.filter((_, i) => i % 2 === 1) ?? []);
        if (top) at = new THREE.Vector3(top[0] + n[0] * 0.9, top[1] + 0.05, top[2] + n[1] * 0.9);
      }
      // New length: the next side moves (Revit moves the referenced element; this side's start stays).
      const nextEdge = ring[(k + 1) % ring.length]!.id;
      put(at.applyMatrix4(M), `${fmt(v.len)} m`, {
        value: v.len,
        apply: (L) => ed.changeSolid((x) => pushEdge(x, nextEdge, L - v.len), `Side set to ${fmt(L)} m.`),
      });
    }
    // Height next to the right-most corner on screen, at half height (the center belongs to the gizmo).
    let best: THREE.Vector3 | null = null;
    let bx = -Infinity;
    for (const p of r.outer.pts) {
      const w = new THREE.Vector3(p[0], s.base + s.height / 2, p[1]).applyMatrix4(M);
      const sp = ed.view.toScreen(w);
      if (!sp.behind && sp.x > bx) {
        bx = sp.x;
        best = w;
      }
    }
    if (best)
      put(best, `↕ ${fmt(s.height)} m`, { value: s.height, prefix: '↕ ', apply: (h) => ed.changeSolid((x) => void (x.height = Math.max(0.3, h)), `Height set to ${fmt(h)} m.`) }, 30, 0);
    return;
  }
  if (ed.context !== b.id) {
    const pts = b.solids.filter((s) => s.op === 'add').flatMap((s) => solidRings(s).outer.pts);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]),
      zs = pts.map((p) => p[1]);
    // Real total height (roof included; cutters do not count). The dimensions measure the body: walls,
    // roof and eave, not the awnings and balconies that stick out (audit D3: 20.55 m on an 18 m block);
    // the box still wraps everything.
    const bb = ed.boundsOf(b, undefined, true);
    const top = bb ? bb.max[1] : Math.max(...b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height));
    // Plan of the walls (what scales) and the body bounds (walls with the eaves).
    const pw = Math.max(...xs) - Math.min(...xs),
      pd = Math.max(...zs) - Math.min(...zs);
    const x0 = bb ? bb.min[0] : Math.min(...xs),
      x1 = bb ? bb.max[0] : Math.max(...xs),
      z0 = bb ? bb.min[2] : Math.min(...zs),
      z1 = bb ? bb.max[2] : Math.max(...zs);
    const W = x1 - x0,
      D = z1 - z0;
    const c: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    // Like the height: the label measures the box and the walls take the whole difference (what sticks
    // out stays the same), so the box lands exactly on the typed value.
    const fit = (v: number, total: number, plan: number) => (v - (total - plan)) / plan;
    put(new THREE.Vector3((x0 + x1) / 2, 0.1, z1 + 1.2).applyMatrix4(M), `${fmt(W)} m`, { value: W, apply: (v) => fit(v, W, pw) > 0.05 && ed.scaleBuildingPlan(b.id, c, fit(v, W, pw), 1, `Width set to ${fmt(v)} m.`) });
    put(new THREE.Vector3(x1 + 1.2, 0.1, (z0 + z1) / 2).applyMatrix4(M), `${fmt(D)} m`, { value: D, apply: (v) => fit(v, D, pd) > 0.05 && ed.scaleBuildingPlan(b.id, c, 1, fit(v, D, pd), `Depth set to ${fmt(v)} m.`) });
    // Height on a vertical corner (the top center belongs to the gizmo).
    // The total includes the roof, whose rise comes from its pitch and span (not from the height): the
    // walls take the whole difference, so the result is exactly the typed value.
    const wallTop = Math.max(...b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height));
    const roof = top - wallTop;
    put(new THREE.Vector3(x1 + 1.2, top / 2, z1 + 1.2).applyMatrix4(M), `↕ ${fmt(top)} m`, {
      value: top,
      prefix: '↕ ',
      apply: (v) => (v - roof > 0.6 ? ed.scaleBuildingHeight(b.id, (v - roof) / wallTop, `Height set to ${fmt(v)} m.`) : false),
    }, 0, 0);
  }
}

/**
 * Pre-highlight: shows what the next click will select (building, volume,
 * face or element), like SketchUp, before clicking.
 */
export function drawHover(ed: Editor3, hit: Hit | null): void {
  if (!ed.hoverOverlay.parent) ed.view.overlay.add(ed.hoverOverlay);
  let key = '';
  let what: { b: Building3; solids?: ID[]; face?: { solid: ID; kind: string; edge?: ID }; part?: Hit['part'] } | null = null;
  if (hit && !ed.drag) {
    const b = hit.building;
    if (ed.context !== b.id) {
      // Building already selected: the click enters and picks the volume under the cursor.
      if (ed.sel.building === b.id && hit.face) what = { b, solids: [hit.face.solid] };
      else if (ed.sel.building !== b.id) what = { b, solids: b.solids.filter((s) => s.op === 'add').map((s) => s.id) };
    } else if (ed.elemMode === 'vertex' || ed.elemMode === 'edge') what = null;
    else if (ed.elemMode === 'face') {
      if (hit.face && faceSelOf(hit.face)) what = { b, face: { solid: hit.face.solid, kind: hit.face.kind, edge: hit.face.edge } };
    } else if (hit.part && (hit.part.item || hit.part.rule)) what = { b, part: hit.part };
    else if (hit.face) {
      const already = ed.sel.solids.length === 1 && ed.sel.solids[0] === hit.face.solid;
      if (already && !ed.sel.face && faceSelOf(hit.face)) what = { b, face: { solid: hit.face.solid, kind: hit.face.kind, edge: hit.face.edge } };
      else if (!already) what = { b, solids: [hit.face.solid] };
    }
    if (what) key = `${b.id}|${what.solids?.join(',') ?? ''}|${what.face ? what.face.solid + what.face.kind + (what.face.edge ?? '') : ''}|${what.part ? (what.part.item ?? '') + (what.part.rule ?? '') + (what.part.key ?? '') : ''}|${ed.store.revision.get(b.id)}`;
  }
  if (key === ed.hoverKey) return;
  ed.hoverKey = key;
  for (const c of [...ed.hoverOverlay.children]) {
    ed.hoverOverlay.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose();
  }
  if (what) {
    const M = ed.view.buildingMatrix(what.b);
    const color = '#5b9cff';
    // Like the selection outline: strong where it is in view, faint behind (never drawn through the roof).
    const addLine = (pts: THREE.Vector3[], closed = true) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const front = new (closed ? THREE.LineLoop : THREE.Line)(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      const behind = new (closed ? THREE.LineLoop : THREE.Line)(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.16 }));
      front.renderOrder = 19;
      behind.renderOrder = 18;
      ed.hoverOverlay.add(behind, front);
    };
    for (const id of what.solids ?? []) {
      const s = findSolid(what.b, id);
      if (!s) continue;
      const r = solidRings(s);
      addLine(r.outer.pts.map((p) => new THREE.Vector3(p[0], r.base + 0.02, p[1]).applyMatrix4(M)));
      addLine(r.topOuter.map((p) => new THREE.Vector3(p[0], r.top, p[1]).applyMatrix4(M)));
      r.outer.pts.forEach((p, i) => {
        if (r.outer.segs[i]!.curved) return;
        addLine([new THREE.Vector3(p[0], r.base, p[1]).applyMatrix4(M), new THREE.Vector3(r.topOuter[i]![0], r.top, r.topOuter[i]![1]).applyMatrix4(M)], false);
      });
    }
    const built = ed.view.built.get(what.b.id);
    // Pre-selection shows only the outline (like SketchUp): a colored veil over the whole volume changed its colors.
    if (what.face && built) {
      const f0 = what.face;
      const { positions: P, indices: I, faceOf } = built.ev.shell;
      const pos: number[] = [];
      for (let t = 0; t < I.length / 3; t++) {
        const f = built.ev.faces[faceOf[t]!];
        if (!f || f.solid !== f0.solid) continue;
        const s0 = faceSelOf(f0 as FaceInfo);
        const fs = faceSelOf(f);
        if (!s0 || !fs || fs.kind !== s0.kind || (fs.kind === 'side' && f.edge !== f0.edge)) continue;
        for (let j = 0; j < 3; j++) {
          const i = I[t * 3 + j]! * 3;
          pos.push(P[i]!, P[i + 1]!, P[i + 2]!);
        }
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
        m.applyMatrix4(M);
        m.renderOrder = 14;
        ed.hoverOverlay.add(m);
      }
    }
    if (what.part && built) {
      const tag = what.part;
      const pos: number[] = [];
      const mm = new THREE.Matrix4();
      for (const pl of built.ev.placements) {
        if (pl.tag.item !== tag.item || pl.tag.rule !== tag.rule || pl.tag.key !== tag.key) continue;
        const [w, h, dd] = pl.family.size(pl.params);
        mm.fromArray(pl.frame).premultiply(M);
        const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(mm);
        const xs = [-w / 2 - 0.04, w / 2 + 0.04],
          ys = [-0.04, h + 0.04],
          zs = [-0.04, Math.max(0.12, dd) + 0.04];
        const k = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c(xs[i & 1]!, ys[(i >> 1) & 1]!, zs[(i >> 2) & 1]!));
        for (const [a, b2] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as [number, number][]) pos.push(...k[a]!.toArray(), ...k[b2]!.toArray());
      }
      if (pos.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
        l.renderOrder = 19;
        ed.hoverOverlay.add(l);
      }
    }
  }
  ed.view.mark();
}

/** Pre-highlight of the corner or side under the cursor. */
export function drawSubHover(ed: Editor3, p: { sid: ID; id: ID } | null): void {
  if (!ed.subHover.parent) ed.view.overlay.add(ed.subHover);
  const b = ed.store.building(ed.context);
  const key = p && b ? `${ed.elemMode}|${p.sid}|${p.id}|${ed.store.revision.get(b.id)}` : '';
  if (key === ed.subHoverKey) return;
  ed.subHoverKey = key;
  for (const c of [...ed.subHover.children]) {
    ed.subHover.remove(c);
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    (m.material as THREE.Material)?.dispose();
  }
  if (!p || !b) return ed.view.mark();
  const s = b.solids.find((x) => x.id === p.sid);
  if (!s) return;
  const M = ed.view.buildingMatrix(b);
  const sub = ed.subOf(b, s);
  const color = '#5b9cff';
  if (ed.elemMode === 'vertex') {
    const v = sub.verts.find((x) => x.id === p.id);
    if (v) {
      const g = new THREE.BufferGeometry().setFromPoints([v.base, v.top].map((q) => new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M)));
      const dots = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 11, sizeAttenuation: false, depthTest: false }));
      dots.renderOrder = 30;
      const edge = new THREE.Line(g.clone(), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.7 }));
      edge.renderOrder = 29;
      ed.subHover.add(dots, edge);
    }
  } else {
    const se = sub.edges.find((x) => x.id === p.id);
    if (se) {
      const pts = se.segs.flatMap(([a, c]) => [a, c]).map((q) => new THREE.Vector3(q[0], q[1], q[2]).applyMatrix4(M));
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false }));
      lines.renderOrder = 30;
      ed.subHover.add(lines);
    }
  }
  ed.view.mark();
}
