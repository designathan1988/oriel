// Pointer input of the editor: the canvas events, picking, click selection and double click, hover, and cancel.
import * as THREE from 'three';
import type { ID } from '../model/schema';
import { inside, findSolid } from '../model/ops';
import { solidRings } from '../eval/body';
import { hostedFrame } from '../model/modeling';
import { combine, selMode } from './selection';
import { segDistance } from '../eval/subelements';
import { invert } from '../model/selsets';
import { type Hit } from './view';
import type { FaceInfo } from '../eval/faces';
import { between, column, row } from './elements';
import { type Selection, type Mods, type Drag, faceSelOf, simplifyClosed } from './support';
import { startWallChain } from './construct';
import type { Editor3 } from './editor';

// ── Pointer ──────────────────────────────────────────────────────────
export function bindCanvas(ed: Editor3): void {
  const el = ed.view.renderer.domElement;
  el.tabIndex = 0;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Middle button: no Windows autoscroll and no link opening (MDN: mousedown/auxclick default actions).
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault();
  });
  el.addEventListener('auxclick', (e) => e.preventDefault());
  // Navigation (Revit/AutoCAD): middle drag pans, Shift+middle orbits, the wheel zooms on the
  // point under the cursor; dragging the right button also orbits (still, it opens the menu).
  let orbit: { x: number; y: number; pan: boolean; right: boolean; x0: number; y0: number; pivot: THREE.Vector3 } | null = null;
  // Touch: the fingers down; with two, their middle pans and their spread zooms there.
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { mx: number; my: number; d: number; pivot: THREE.Vector3 } | null = null;
  const pinchMove = () => {
    const [a, b] = [...touches.values()];
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2,
      d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!pinch) {
      const at = { clientX: mx, clientY: my };
      pinch = { mx, my, d, pivot: ed.view.modelAt(at) ?? ed.view.nearGroundAt(at) ?? ed.view.target.clone() };
      return;
    }
    ed.view.panBy(mx - pinch.mx, my - pinch.my, pinch.pivot);
    if (d > 10 && pinch.d > 10) ed.view.zoomAt(pinch.pivot, pinch.d / d);
    pinch.mx = mx;
    pinch.my = my;
    pinch.d = d;
  };
  const touchUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return false;
    const was = touches.size;
    touches.delete(e.pointerId);
    if (was >= 2) {
      if (touches.size < 2) pinch = null;
      return true;
    }
    return false;
  };
  el.addEventListener('pointerdown', (e) => {
    el.focus();
    ed.view.stopAnim();
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // Two fingers: whatever one finger began is cancelled; they pan and pinch (Estúdio de Construção).
        ed.cancel();
        pinch = null;
      }
      if (touches.size >= 2) return;
    }
    if (e.button === 2 || e.button === 1) {
      // Middle drag: FORMA/Revit pans (Shift orbits); SketchUp and Blender orbit (Shift pans).
      const pan = e.button === 1 && (ed.navPreset === 'forma' ? !e.shiftKey : e.shiftKey);
      // Pivot (Blender Auto Depth + Orbit Around Selection): the model under the cursor, else the
      // selection, else the whole model, never empty ground (the model would swing off screen).
      // Panning grabs the point under the cursor at its depth (near ground counts).
      const pivot = pan ? (ed.view.modelAt(e) ?? ed.view.nearGroundAt(e) ?? ed.orbitPivot(e)) : ed.orbitPivot(e);
      if (!pan) ed.view.showPivot(pivot);
      orbit = { x: e.clientX, y: e.clientY, pan, right: e.button === 2, x0: e.clientX, y0: e.clientY, pivot };
      el.setPointerCapture(e.pointerId);
      if (e.button === 1) e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    ed.onDown(e);
  });
  // A navigation drag ends however the pointer is released (Pointer Events: pointercancel and
  // lostpointercapture); without this a lost release left the view orbiting with every move.
  const endNav = () => {
    if (!orbit) return;
    orbit = null;
    ed.view.showPivot(null);
  };
  el.addEventListener('pointercancel', (e) => {
    touchUp(e);
    endNav();
  });
  el.addEventListener('lostpointercapture', endNav);
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) return pinchMove();
    }
    if (orbit && (e.buttons & 6) === 0) endNav();
    if (orbit) {
      const dx = e.clientX - orbit.x,
        dy = e.clientY - orbit.y;
      orbit.x = e.clientX;
      orbit.y = e.clientY;
      if (orbit.pan) ed.view.panBy(dx, dy, orbit.pivot);
      else {
        // 0.35° per pixel (Blender turntable sensitivity is of this order).
        ed.view.orbitAround(orbit.pivot, -dx * 0.006, -dy * 0.006);
        ed.view.showPivot(orbit.pivot);
      }
      return;
    }
    ed.onMove(e);
  });
  el.addEventListener('pointerup', (e) => {
    if (touchUp(e)) return;
    if (orbit) {
      // Right button without dragging: context menu of what is under the cursor (dragging still orbits).
      const click = orbit.right && Math.hypot(e.clientX - orbit.x0, e.clientY - orbit.y0) < 5;
      orbit = null;
      ed.view.showPivot(null);
      // While drawing walls or a slab, a right click ends the line (AutoCAD, ArchiCAD: the menu's Done).
      if (click && ed.tool === 'walls' && ed.wallsTool.busy) return void ed.wallsTool.enter();
      if (click) ed.openContext(e);
      return;
    }
    if (e.button === 0) ed.onUp(e);
  });
  el.addEventListener('dblclick', (e) => ed.onDouble(e));
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      ed.view.stopAnim();
      const k = Math.exp(Math.max(-300, Math.min(300, e.deltaY)) * 0.0011);
      // Zooms on the point under the cursor (it stays still on screen): the model, or the ground
      // when it is near; over the sky or the far horizon, on the view center.
      const p = ed.view.modelAt(e) ?? ed.view.nearGroundAt(e) ?? ed.view.target.clone();
      ed.view.zoomAt(p, k);
    },
    { passive: false },
  );
  // Drag from the catalog onto the view.
  ed.shell.view.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('text/forma-type')) {
      e.preventDefault();
      ed.tool = 'place';
      ed.placing = ed.placing ?? null;
      ed.onMove(e as unknown as PointerEvent);
    }
  });
  ed.shell.view.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData('text/forma-type');
    if (!id) return;
    e.preventDefault();
    ed.startPlacing(id);
    ed.placeAt(e as unknown as PointerEvent);
  });
}

export function pickAt(ed: Editor3, e: { clientX: number; clientY: number }, only?: ID | null): Hit | null {
  return ed.view.pick(ed.store.project, e, only);
}

/**
 * The wall or top under the pointer, through the windows and parts in front of it: a ray that goes in
 * through an opening (its reveal, the room behind the glass) counts as the wall it is in, the side of
 * that volume nearest to the point.
 */
export function pickBody(ed: Editor3, e: { clientX: number; clientY: number }): Hit | null {
  const hit = ed.view.pick(ed.store.project, e, null, true);
  const f = hit?.face;
  if (!hit || !f || !/^(reveal|room)/.test(f.kind)) return hit;
  const s = findSolid(hit.building, f.solid);
  if (!s) return hit;
  const lp = hit.point.clone().applyMatrix4(ed.view.buildingMatrix(hit.building).invert());
  const r = solidRings(s).outer;
  let best = '',
    bd = Infinity;
  r.pts.forEach((a, i) => {
    const b = r.pts[(i + 1) % r.pts.length]!;
    const d = segDistance(lp.x, lp.z, a[0], a[1], b[0], b[1]);
    if (d < bd) {
      bd = d;
      best = r.segs[i]!.edge;
    }
  });
  return best ? { ...hit, face: { kind: 'side', solid: s.id, edge: best } as FaceInfo } : hit;
}

export function onDown(ed: Editor3, e: PointerEvent): void {
  ed.downAt = { x: e.clientX, y: e.clientY };
  if (ed.stickyDrag && ed.drag) {
    ed.stickyDrag = false;
    return ed.finishDrag(e);
  }
  ed.stickyDrag = false;
  if (ed.polyline.active) return ed.polyline.down(e);
  if (ed.tool === 'select' && ed.elemMode !== 'object' && ed.context && ed.subDown(e)) return;
  if (ed.selectLike() || ed.pushLike()) {
    const h = ed.handles.hit(e);
    if (h) {
      ed.beginHandle(h, e);
      if (ed.drag) ed.drag.data.viaHandle = true;
      return;
    }
    // Alt+click outside a building: the building behind the selected one (Blender/Maya "select through").
    const behind = e.altKey && !ed.context && ed.sel.building ? ed.view.pick(ed.store.project, e, undefined, false, new Set([ed.sel.building, ...ed.sel.others])) : null;
    const hit = behind ?? ed.pickAt(e);
    if (ed.pushLike()) {
      if (hit?.face && (hit.face.kind === 'side' || hit.face.kind === 'top' || hit.face.kind === 'roof') && hit.building) {
        if (ed.context !== hit.building.id) ed.context = hit.building.id;
        ed.select({ building: hit.building.id, solids: [hit.face.solid], face: hit.face.kind === 'side' ? { kind: 'side', edge: hit.face.edge! } : { kind: 'top' } });
        const fh = ed.handles.list.find((x) => x.kind === (hit.face!.kind === 'side' ? 'push' : 'height'));
        if (fh) ed.beginHandle(fh, e);
      } else if (hit?.face?.kind === 'cutter' && hit.building) {
        // The back of a niche: pushing or pulling it changes the niche's depth (through the wall it becomes a projection).
        const so = findSolid(hit.building, hit.face.solid);
        if (so && hostedFrame(so)) {
          if (ed.context !== hit.building.id) ed.context = hit.building.id;
          ed.select({ building: hit.building.id, solids: [so.id] });
          const fh = ed.handles.list.find((x) => x.hosted);
          if (fh) ed.beginHandle(fh, e);
        }
      }
      return;
    }
    // Scale tool on an object: it is selected whole and a typed factor scales it (or drag a corner).
    if (ed.tool === 'scale' && hit) {
      if (ed.context === hit.building.id && hit.face?.solid) ed.select({ building: hit.building.id, solids: [hit.face.solid] });
      else ed.selectBuildings([hit.building.id]);
      ed.setMeasure('Scale (factor)', (t) => ed.scaleSelection(t));
      ed.toast('Type a factor (2 doubles it; 2;1 the plan only) and Enter, or drag a corner.');
      return;
    }
    // Rotate tool on an object (not only on its ring): it turns about its centre, dragged or clicked
    // and then clicked again or a typed angle (before, it was moved instead, and a typed 30 moved it 30 m).
    if (ed.tool === 'rotate' && hit) {
      // The whole object turns (a face or an element selected would carry no ring).
      if (ed.context === hit.building.id && hit.face?.solid) {
        if (!(ed.sel.solids.includes(hit.face.solid) && !ed.sel.face && !ed.sel.elems.length && !ed.sel.item)) ed.select({ building: hit.building.id, solids: [hit.face.solid] });
      } else if (!ed.inSelection(hit, true) || ed.sel.face || ed.sel.elems.length || ed.sel.item) ed.selectBuildings([hit.building.id]);
      const rh = ed.handles.list.find((x) => x.kind === 'rotate');
      if (rh) {
        ed.beginHandle(rh, e);
        if (ed.drag) ed.drag.data.viaHandle = true;
      }
      return;
    }
    // Ctrl on what is already selected: dragging copies (SketchUp); still, nothing changes.
    const copyGrab = !!hit && (e.ctrlKey || e.metaKey) && !e.shiftKey && ed.inSelection(hit, false);
    // Empty space, or Ctrl/Shift anywhere: selection box; still, it counts as a click on release.
    if (ed.selectLike() && !copyGrab && (!hit || e.ctrlKey || e.shiftKey || e.metaKey)) {
      ed.marquee = { ax: e.clientX, ay: e.clientY, bx: e.clientX, by: e.clientY, active: false, hit, ev: { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey, altKey: e.altKey } };
      return;
    }
    // Pressing something already in a multiple selection does not break it: dragging moves the
    // group; releasing without dragging selects only that (like SketchUp and Figma).
    if (hit && (copyGrab || ed.inSelection(hit, true))) {
      const b0 = ed.activeBuilding()!;
      if (ed.context !== b0.id) ed.beginMoveBuilding(b0, e, hit);
      else if (ed.sel.item && !ed.sel.elems.length) ed.beginMoveItem(b0, e, hit);
      else if (ed.sel.solids.length && !ed.sel.elems.length) ed.beginMoveSolids(b0, e, hit);
      // One window or door of a facade rule, dragged: it leaves the rule (a part of its own) and moves.
      else if (ed.sel.elems.length === 1 && ed.sel.elems[0]!.startsWith('r|') && hit.part?.rule) ed.pendingDetach = { x: e.clientX, y: e.clientY, e };
      const ev = { ctrlKey: copyGrab, shiftKey: false, metaKey: false, altKey: false };
      if (ed.drag) ed.drag.data.click = { hit, ev };
      else if (!copyGrab) ed.pendingClick = hit;
      return;
    }
    // Clicking again on an already selected building (without dragging) enters it and picks the volume.
    const drill = hit && ed.context !== hit.building.id && ed.sel.building === hit.building.id && !e.shiftKey && !ed.sel.others.length ? hit.face?.solid : undefined;
    ed.clickSelect(hit, e);
    ed.drawHover(null);
    // Dragging what is selected moves it (right on the model).
    const b = ed.activeBuilding();
    if (hit && b && hit.building.id === b.id) {
      if (ed.context !== b.id) {
        ed.beginMoveBuilding(b, e, hit);
        if (ed.drag && drill) ed.drag.data.drill = drill;
      }
      else if (ed.sel.item) ed.beginMoveItem(b, e, hit);
      // A window or door of a facade rule: dragging it detaches it from the rule and moves it.
      else if (ed.sel.elems.length === 1 && ed.sel.elems[0]!.startsWith('r|') && hit.part?.rule) ed.pendingDetach = { x: e.clientX, y: e.clientY, e };
      else if (ed.sel.solids.length && !ed.sel.elems.length) ed.beginMoveSolids(b, e, hit);
    }
    return;
  }
  if (ed.tool === 'rect' || ed.tool === 'circle' || ed.tool === 'polygon' || ed.tool === 'spline' || ed.tool === 'arc') return ed.drawDown(e);
  if (ed.tool === 'place') return ed.placeAt(e);
  if (ed.tool === 'block') return ed.blockAt(e, true);
  if (ed.tool === 'tape') return ed.tapeAt(e, true);
  if (ed.tool === 'cut') return ed.cutAt(e, true);
  if (ed.tool === 'opening') return ed.opening.down(e);
  if (ed.tool === 'iwall') {
    // A wall corner or a wall under the pointer: drag the corner, Alt+click deletes the wall.
    const h = ed.handles.hit(e);
    if (h?.iwall) return ed.beginIwallHandle(h, e);
    return ed.iwallAt(e, true);
  }
  if (ed.tool === 'stair') return ed.stair.down(e);
  if (ed.tool === 'walls') {
    // One wall tool (Revit, ArchiCAD, Chief Architect): a chain started inside a building divides its
    // floor (interior walls of the floor shown, cut open so they can be seen); one started outside
    // makes walls of their own (closed: a building).
    if (!ed.wallsTool.busy) {
      // A click always draws with this tool (the handles of a wall just drawn sat where the next wall
      // starts, on its middle, and grabbed the click); walls are reshaped with Select.
      ed.iwallSel = null;
      startWallChain(ed, e, ed.wallsTool.probe(e)?.hit ?? null);
    }
    return ed.wallsTool.down(e);
  }
  if (ed.tool === 'slab') return ed.slabTool.down(e);
  if (ed.tool === 'column') return ed.columnAt(e);
  if (ed.tool === 'beam') return ed.beamAt(e, true);
  if (ed.tool === 'room') return ed.roomDown(e);
  if (ed.tool === 'lot') return ed.site.lotDown(e);
  if (ed.tool === 'terrain') return ed.terrainAt(e, true);
  if (ed.tool === 'axis') return ed.axisAt(e, true);
  if (ed.tool === 'mirror') return ed.mirrorAt(e, true);
  if (ed.tool === 'street') return ed.site.streetDown(e);
  if (ed.tool === 'paint') return ed.paintAt(e);
}

export function clickSelect(ed: Editor3, hit: Hit | null, e: Mods): void {
  const mode = selMode(e);
  // Component mode: the first part along the ray, whatever stands in front of it (nothing else is picked).
  if (ed.partsMode && ed.pointerAt) {
    let part: Hit | null = hit?.part ? hit : null;
    for (let n = 1; !part && n < 8; n++) {
      const h = ed.view.pick(ed.store.project, ed.pointerAt, null, false, undefined, n);
      if (!h) break;
      if (h.part) part = h;
    }
    if (!part) return;
    hit = part;
  }
  // Clicking again on the same spot (slower than a double click) goes one thing deeper: the window under
  // the eaves, the wall behind a tree, the part inside another one.
  const at = ed.pointerAt;
  if (hit && at && mode === 'replace') {
    const now = performance.now();
    const lp = ed.lastPick;
    const again = !!lp && Math.hypot(at.clientX - lp.x, at.clientY - lp.y) < 4 && now - lp.t > 380 && now - lp.t < 2500;
    const depth = again ? lp!.depth + 1 : 0;
    const deeper = depth ? ed.view.pick(ed.store.project, at, null, false, undefined, depth) : null;
    if (deeper) hit = deeper;
    ed.lastPick = { x: at.clientX, y: at.clientY, t: now, depth: deeper ? depth : 0 };
  }
  // A tree or lamp planted along a street (a building with parts only) picks the street on a click;
  // inside that building (double click) the parts themselves are picked.
  if (hit && !hit.building.solids.length && ed.context !== hit.building.id && mode === 'replace' && ed.pointerAt && ed.pickSiteAt(ed.pointerAt)) return;
  if (!hit) {
    // A click on empty space with a modifier keeps the selection.
    if (mode !== 'replace') return;
    if (ed.context) {
      if (ed.sel.solids.length || ed.sel.item) return ed.select({ building: ed.context });
      const id = ed.context;
      ed.context = null;
      return ed.select({ building: id });
    }
    return ed.select({});
  }
  const b = hit.building;
  if (ed.context !== b.id) {
    if (ed.context) ed.context = null;
    // Several buildings (to align and distribute).
    if (mode !== 'replace') return ed.selectBuildings(combine(ed.selectedBuildings(), [b.id], mode));
    // A door, a window, a piece of furniture or any part is selected at once (Revit elements, SketchUp
    // components): sizing or editing it never needs entering the building first.
    if (!(hit.part && (hit.part.item || hit.part.rule))) return ed.select({ building: b.id });
    ed.context = b.id;
  }
  if (hit.part) {
    const key = hit.part.rule ? `r|${hit.part.solid}|${hit.part.rule}|${hit.part.key}` : hit.part.item ? `i|${hit.part.item}|${hit.part.key ?? '0'}` : null;
    // Alt: the row span between the last selected and this one.
    if (key && e.altKey && ed.sel.elems.length) return ed.selectElemKeys(b.id, combine(ed.sel.elems, [...between(ed.elements(), ed.sel.elems[ed.sel.elems.length - 1]!, key)], 'add'));
    if (key && mode !== 'replace') return ed.selectElemKeys(b.id, combine(ed.sel.elems, [key], mode));
    if (hit.part.item) return ed.select({ building: b.id, item: hit.part.item, elems: key ? [key] : [] });
    if (key) return ed.select({ building: b.id, elems: [key] });
  }
  const f = hit.face;
  if (!f) return;
  const sid = f.solid;
  if (mode !== 'replace') {
    // With a modifier, a wall only joins a volume selection; with elements selected, nothing changes.
    if (ed.sel.item || ed.sel.elems.length) return;
    return ed.select({ building: b.id, solids: combine(ed.sel.solids, [sid], mode) });
  }
  // First click: the volume; another click on the same volume: the face (the plinth and the parapet too).
  const already = ed.sel.solids.length === 1 && ed.sel.solids[0] === sid;
  ed.select({ building: b.id, solids: [sid], face: already ? faceSelOf(f) : null });
}

export function onDouble(ed: Editor3, e: MouseEvent): void {
  if ((ed.tool === 'polygon' || ed.tool === 'spline') && ed.draft) return ed.finishPolygon();
  if (!ed.selectLike()) return;
  const hit = ed.pickAt(e);
  if (!hit) return;
  // The first click of this double click already went into the building: the double click means "enter",
  // so it ends on the volume under the cursor — not on the face (top or parapet, by a pixel).
  if (ed.context === hit.building.id && performance.now() - ed.drilledAt < 600) {
    const sid = hit.face?.solid ?? hit.part?.solid;
    if (sid) ed.select({ building: hit.building.id, solids: [sid] });
    return;
  }
  if (ed.context === hit.building.id && hit.part && (hit.part.rule || hit.part.item)) {
    // Double click on an element: the whole row (3ds Max Loop).
    if (!ed.sel.elems.length) ed.clickSelect(hit, e as PointerEvent);
    return ed.selectElems('row');
  }
  if (ed.context !== hit.building.id) {
    ed.enter(hit.building.id);
    const h2 = ed.pickAt(e, hit.building.id);
    // Wall: its volume; window or balcony: the volume the rule (or the component) occupies.
    const it = h2?.part?.item ? hit.building.items.find((x) => x.id === h2.part!.item) : undefined;
    const sid = h2?.face?.solid ?? h2?.part?.solid ?? (it && (it.host.kind === 'face' || it.host.kind === 'roof') ? it.host.solid : undefined);
    if (sid) ed.select({ building: hit.building.id, solids: [sid] });
    ed.toast('Editing the building. Esc leaves.');
  } else if (hit.face && (hit.face.kind === 'side' || hit.face.kind === 'top')) {
    ed.select({ building: hit.building.id, solids: [hit.face.solid], face: hit.face.kind === 'side' ? { kind: 'side', edge: hit.face.edge! } : { kind: 'top' } });
  }
}

export function onMove(ed: Editor3, e: PointerEvent): void {
  if (ed.siteDrag) return ed.moveSiteDrag(e);
  if (ed.polyline.active) return ed.polyline.move(e);
  if (ed.pendingDetach && e.buttons & 1 && Math.hypot(e.clientX - ed.pendingDetach.x, e.clientY - ed.pendingDetach.y) > 5) {
    const pd = ed.pendingDetach;
    ed.pendingDetach = null;
    ed.pendingClick = null;
    ed.elemAction('detach');
    const b = ed.activeBuilding();
    if (b && ed.sel.item) {
      ed.refreshActive();
      ed.beginMoveItem(b, pd.e, null);
    }
    return;
  }
  if (ed.marquee) return ed.moveMarquee(e);
  if (ed.drag) return ed.updateDrag(e);
  if (ed.blockedAt && e.buttons && Math.hypot(e.clientX - ed.blockedAt.x, e.clientY - ed.blockedAt.y) >= 4) {
    ed.blockedAt = null;
    ed.toast('Exploded view: set "Floors apart" to 0 (Interior view) to edit.');
  }
  // Vertex and edge modes: the corner or side a click would pick lights up.
  if (ed.tool === 'select' && ed.context && (ed.elemMode === 'vertex' || ed.elemMode === 'edge')) {
    const b = ed.store.building(ed.context);
    ed.drawSubHover(b ? ed.subPickAt(e, b) : null);
  }
  if (ed.handlesLive()) {
    ed.handles.setHover(ed.handles.hit(e));
    const h = ed.handles.hover;
    if (h) {
      ed.shell.status.hint.textContent = h.label;
      ed.drawHover(null);
      ed.view.renderer.domElement.style.cursor = h.kind === 'size' ? (h.sx && h.sz ? (h.sx * h.sz > 0 ? 'nwse-resize' : 'nesw-resize') : 'ew-resize') : h.kind === 'rotate' ? 'grab' : 'move';
      return;
    }
    const hit = ed.pickAt(e);
    if (ed.pushLike()) {
      // Push: the hand shows only where a click picks a pushable face.
      const ok = !!hit?.face && (hit.face.kind === 'side' || hit.face.kind === 'top' || hit.face.kind === 'roof');
      ed.drawHover(null);
      ed.updateHint();
      ed.view.renderer.domElement.style.cursor = ok ? 'pointer' : 'default';
      return;
    }
    ed.drawHover(hit);
    const b = ed.activeBuilding();
    const onSel = !!hit && !!b && hit.building.id === b.id && (ed.context !== b.id || (hit.face && ed.sel.solids.includes(hit.face.solid)) || (!!hit.part?.item && hit.part.item === ed.sel.item));
    ed.view.renderer.domElement.style.cursor = !hit ? 'default' : onSel ? 'move' : 'pointer';
    return;
  }
  if (ed.opening.active) return ed.opening.hover(e);
  if (ed.tool === 'rect' || ed.tool === 'circle' || ed.tool === 'polygon' || ed.tool === 'spline' || ed.tool === 'arc') return ed.drawMove(e);
  if (ed.tool === 'place') return ed.placeHover(e);
  if (ed.tool === 'block') return ed.blockAt(e, false);
  if (ed.tool === 'tape') return ed.tapeAt(e, false);
  if (ed.tool === 'cut') return ed.cutAt(e, false);
  if (ed.tool === 'opening') return ed.opening.hover(e);
  if (ed.tool === 'iwall') return ed.iwallAt(e, false);
  if (ed.tool === 'stair') return ed.stair.move(e);
  if (ed.tool === 'walls') {
    if (!ed.wallsTool.busy && !ed.wallsTool.probe(e)?.hit && ed.buildingUnderWall(e)) return void ed.showDim(ed.iwallHint(), e);
    return ed.wallsTool.move(e);
  }
  if (ed.tool === 'slab') return ed.slabTool.move(e);
  if (ed.tool === 'column') return void ed.showDim('Click to place a column on the floor shown', e);
  if (ed.tool === 'beam') return ed.beamAt(e, false);
  if (ed.tool === 'room') return ed.roomMove(e);
  if (ed.tool === 'lot') return ed.site.lotMove(e, (e.buttons & 1) === 1);
  if (ed.tool === 'terrain') return ed.terrainDrag && (e.buttons & 1) ? ed.terrainDragMove(e) : ed.terrainAt(e, false);
  if (ed.tool === 'axis') return ed.axisAt(e, false);
  if (ed.tool === 'mirror') return ed.mirrorAt(e, false);
  if (ed.tool === 'street') return ed.site.streetMove(e);
}

export function onUp(ed: Editor3, e: PointerEvent): void {
  ed.blockedAt = null;
  ed.pendingDetach = null;
  if (ed.siteDrag) return ed.endSiteDrag();
  if (ed.marquee) return ed.endMarquee();
  if (ed.pendingClick) {
    const hit = ed.pendingClick;
    ed.pendingClick = null;
    return ed.clickSelect(hit, { ctrlKey: false, shiftKey: false, metaKey: false, altKey: false });
  }
  // A still click with Move or Rotate: the object follows the cursor until the next click.
  if (ed.drag && (ed.tool === 'move' || ed.tool === 'rotate') && !ed.stickyDrag && ed.downAt && Math.hypot(e.clientX - ed.downAt.x, e.clientY - ed.downAt.y) < 4) {
    ed.stickyDrag = true;
    ed.toast(ed.tool === 'move' ? 'Click the destination.' : 'Click to set the angle.');
    return;
  }
  if (ed.drag) return ed.finishDrag(e);
  if (ed.opening.active) return ed.opening.up(e);
  // The end of a free-hand stroke: the outline closes (a short stroke goes on as points).
  if (ed.tool === 'spline' && ed.freehand) {
    ed.freehand = false;
    if (ed.draft && ed.draft.points.length >= 4) {
      // The hand's wobble taken out (Ramer–Douglas–Peucker, 25 cm): the smooth outline needs few points.
      ed.draft.points = simplifyClosed(ed.draft.points, 0.25);
      if (ed.draft.points.length >= 3) ed.finishPolygon();
    }
    return;
  }
  if (ed.tool === 'lot') return ed.site.lotUp(e);
  if (ed.tool === 'terrain' && ed.terrainDrag) return ed.terrainDragEnd();
  if (ed.tool === 'room' && ed.roomFrom) return ed.roomUp(e);
  if ((ed.tool === 'rect' || ed.tool === 'circle') && ed.draft && ed.draft.points.length === 1 && ed.draft.hover && ed.draft.hover.distanceTo(ed.draft.points[0]!) > 0.6) ed.drawDown(e);
}

export function cancel(ed: Editor3): void {
  ed.stickyDrag = false;
  ed.opening?.cancel();
  ed.site?.cancel();
  ed.stair?.cancel();
  ed.wallsTool?.cancel();
  ed.slabTool?.cancel();
  ed.beamFrom = null;
  ed.beamB = null;
  ed.clearBeamDraft();
  ed.clearTerrainMarks();
  ed.axisFrom = null;
  ed.mirrorFrom = null;
  ed.roomFrom = null;
  ed.marquee = null;
  if (ed.marqueeEl) ed.marqueeEl.hidden = true;
  if (ed.drag) {
    ed.store.revert();
    ed.drag = null;
    ed.preview.clear();
    ed.placeCtxBar();
  }
  ed.draft = null;
  ed.tapeFrom = null;
  ed.cutFrom = null;
  ed.clearSnap();
  ed.removeGhost();
  for (const n of ['block', 'tape', 'cut']) {
    const o = ed.snapOverlay.getObjectByName(n);
    if (o) ed.snapOverlay.remove(o);
  }
  ed.shell.dim.hidden = true;
  ed.drawSelection();
}
