// Keyboard of the editor: tool keys from the registry (editor/commands.ts), modes, measures and commands.
import { toolForKey } from './commands';
import { row } from './elements';
import { fmt, parseLength } from './support';
import type { Editor3 } from './editor';

export function bindKeys(ed: Editor3): void {
  const vcb = ed.shell.status.vcb;
  // The value being typed shows next to the cursor too (Fusion's dynamic input, SketchUp's VCB):
  // the eyes stay on the model.
  ed.view.renderer.domElement.addEventListener('pointermove', (e) => (ed.pointerAt = { clientX: e.clientX, clientY: e.clientY }));
  vcb.addEventListener('input', () => {
    if (!ed.pointerAt || !vcb.value.trim()) return;
    const v = parseLength(vcb.value);
    ed.showDim(`${ed.shell.status.vcbLabel.textContent}: ${vcb.value}${v !== null && /[-+*/()]/.test(vcb.value.slice(1)) ? ` = ${fmt(v)} m` : ''} ↵`, { clientX: ed.pointerAt.clientX, clientY: ed.pointerAt.clientY + 44 });
  });
  vcb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      // A drawing in progress takes the value first (the length of its next side), then the last action.
      const m = ed.draftInput() ?? ed.measure;
      const ok = m?.apply(vcb.value) ?? false;
      if (!ok) ed.toast(`Value not recognized for ${(m?.label ?? 'Size').toLowerCase()}.`);
      ed.shell.status.vcbLabel.textContent = ed.measure?.label ?? 'Size';
      vcb.value = '';
      ed.shell.dim.hidden = true;
      ed.view.renderer.domElement.focus();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      vcb.value = '';
      ed.view.renderer.domElement.focus();
      if (ed.tool === 'walls' && ed.wallsTool.busy) ed.wallsTool.enter();
      else if (ed.tool === 'slab' && ed.slabTool.busy) ed.slabTool.cancel();
    }
    e.stopPropagation();
  });
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (!ed.shell.root.isConnected) return;
    // Ctrl+K opens the command search from anywhere, a text field included (VS Code, Figma, Linear).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && !ed.walk.active) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      ed.command('palette');
      return;
    }
    if (target.closest('input,select,textarea')) return;
    // Walking owns the keyboard (WASD, Shift, Space, Esc).
    if (ed.walk.active) return;
    const k = e.key.toLowerCase();
    // Numeric keypad: standard views (Blender: 1 front, 3 right, 7 top, Ctrl for the opposite side;
    // 0 the home three-quarter view). The digits of the main row keep their meaning.
    if (e.code.startsWith('Numpad') && !ed.measure && /^Numpad[01357]$/.test(e.code)) {
      const n = e.code.slice(6);
      if (n === '5') {
        ed.view.setParallel(!ed.view.parallel);
        ed.toast(ed.view.parallel ? 'Parallel view (no perspective) · Numpad 5 goes back.' : 'Perspective view.');
        ed.emit();
        e.preventDefault();
        return;
      }
      const back = e.ctrlKey;
      if (n === '0') ed.view.animateTo(1, 0.75, 380, () => ed.view.frameAll());
      // Top: north up, the plan axes square with the screen (Blender Numpad 7), not the current azimuth.
      else if (n === '7') ed.view.animateTo(0.001, back ? Math.PI : 0);
      else ed.view.animateTo(Math.PI / 2 - 0.02, n === '1' ? (back ? Math.PI : 0) : back ? -Math.PI / 2 : Math.PI / 2);
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey && ed.tool === 'walls' && ed.wallsTool.back()) return e.preventDefault();
      if (k === 'z' && !e.shiftKey && ed.tool === 'slab' && ed.slabTool.back()) return e.preventDefault();
      if (k === 'z') ed.command(e.shiftKey ? 'redo' : 'undo');
      else if (k === 'y') ed.command('redo');
      else if (k === 'd') ed.duplicate(e.shiftKey);
      else if (k === 'c' && e.shiftKey) ed.copyProperties();
      else if (k === 'v' && e.shiftKey) ed.pasteProperties();
      else if (k === 'c') ed.copy();
      else if (k === 'v') ed.paste();
      else if (k === 's') ed.saveRequested?.();
      else if (k === 'k') ed.command('palette');
      else if (k === 'a') ed.selectAll();
      else if (k === 'i') ed.selectAll(true);
      else return;
      e.preventDefault();
      return;
    }
    // Numbers and separators go to the measure box.
    // 1 / 2 / 3: vertex, edge, face (Blender); the same key again goes back to volumes.
    const typing = ed.draftInput();
    if (e.key === '4' && !ed.measure && !typing && !e.altKey && ed.context) {
      ed.setPartsMode();
      e.preventDefault();
      return;
    }
    if ((e.key === '1' || e.key === '2' || e.key === '3') && !ed.measure && !typing && !e.altKey) {
      ed.setElemMode(e.key === '1' ? 'vertex' : e.key === '2' ? 'edge' : 'face');
      e.preventDefault();
      return;
    }
    if (/^[0-9.,;*/-]$/.test(e.key) && (ed.measure || typing)) {
      if (typing) ed.shell.status.vcbLabel.textContent = typing.label;
      vcb.focus();
      return;
    }
    if (ed.sel.elems.length && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown')) {
      ed.selectElems(k.slice(5) as 'left');
      e.preventDefault();
      return;
    }
    if (k === 'enter' && ed.polyline.finish()) return;
    if (k === 'escape' && ed.polyline.active) return ed.polyline.cancel();
    if (k === 'enter' && ed.tool === 'street' && ed.site.enter()) return;
    if (k === 'enter' && ed.tool === 'stair' && ed.stair.enter()) return;
    if (k === 'enter' && ed.tool === 'walls' && ed.iwallLast) {
      ed.iwallLast = null;
      ed.toast('Wall chain ended: click to start another.');
      return;
    }
    if ((k === 'enter' || k === 'escape') && ed.tool === 'walls' && ed.wallsTool.enter()) return;
    if (k === 'escape' && ed.tool === 'slab' && ed.slabTool.busy) return ed.slabTool.cancel();
    // While drawing walls or a slab, Backspace takes the last point (and its wall) back.
    if (k === 'backspace' && ed.tool === 'walls' && ed.wallsTool.back()) return;
    if (k === 'backspace' && ed.tool === 'slab' && ed.slabTool.back()) return;
    if (k === 'enter' && ed.tool === 'iwall') {
      ed.iwallLast = null;
      ed.toast('Wall chain ended: click to start another.');
      return;
    }
    if (k === 'escape') {
      ed.iwallLast = null;
      if (ed.tool !== 'select') {
        ed.clearPathDraft();
        ed.setTool('select');
      } else ed.exitContext();
    }
    else if (k === 'delete' && e.shiftKey) {
      if (ed.project.notes?.length || ed.project.guides?.length)
        ed.changeSite((p) => {
          delete p.notes;
          delete p.guides;
        }, 'Dimensions, labels and guides cleared.');
    } else if (k === 'delete' || k === 'backspace') {
      if (ed.draft && (ed.tool === 'polygon' || ed.tool === 'spline') && ed.draft.points.length > 1) ed.draft.points.pop();
      else if (k === 'delete' && !ed.sel.building && ed.deleteSite()) return;
      else if (k === 'delete') ed.remove();
    } else if (k === 'enter') {
      if (ed.tool === 'polygon' || ed.tool === 'spline') ed.finishPolygon();
      else if (ed.pathDraft) ed.finishPath();
    } else if (k === 'h') {
      if (e.altKey) ed.showAll();
      else if (e.shiftKey) ed.isolateSelection();
      else ed.hideSelected();
    } else if (k === 'g' && e.shiftKey) ed.selectSimilar();
    // The tools' keys come from the registry (editor/commands.ts), as the bar shows them.
    else if (k.length === 1 && toolForKey(k, e.shiftKey)) ed.runTool(toolForKey(k, e.shiftKey)!);
    else if (k === 'x') ed.toggleDrawMode();
    else if (k === 'f') ed.frameSelection();
    else if (k === 'g') ed.toggleSnap();
    else if (k === '?') ed.helpRequested?.();
    else return;
    e.preventDefault();
  });
}
