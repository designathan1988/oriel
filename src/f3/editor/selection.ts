// Selection rules shared by buildings, volumes and elements (docs/SELECTION.md):
// modifiers as in SketchUp (Ctrl adds, Shift toggles, Ctrl+Shift removes) and
// a selection box as window (→, only what is fully inside) or crossing (←,
// what it touches). No three.

export type SelMode = 'replace' | 'add' | 'toggle' | 'remove';

/** Mode of a click or box from its modifiers (Cmd counts as Ctrl). */
export function selMode(e: { ctrlKey: boolean; shiftKey: boolean; metaKey?: boolean }): SelMode {
  const ctrl = e.ctrlKey || !!e.metaKey;
  return ctrl && e.shiftKey ? 'remove' : ctrl ? 'add' : e.shiftKey ? 'toggle' : 'replace';
}

/** Combines what the gesture picked with the current selection, keeping the order (the first is the main one). */
export function combine<T>(cur: readonly T[], picked: readonly T[], mode: SelMode): T[] {
  if (mode === 'replace') return [...new Set(picked)];
  const s = new Set(cur);
  for (const p of picked) {
    if (mode === 'add') s.add(p);
    else if (mode === 'remove') s.delete(p);
    else if (s.has(p)) s.delete(p);
    else s.add(p);
  }
  return [...s];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Normalized rectangle (x0 < x1, y0 < y1) and whether it is a window (dragged to the right). */
export function marqueeRect(ax: number, ay: number, bx: number, by: number): { rect: Rect; window: boolean } {
  return { rect: { x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }, window: bx >= ax };
}

/**
 * Projected points of an object (its box corners) against the selection box.
 * Window: all inside. Crossing: their bounding rectangle touches the box. A
 * point behind the camera: outside (the whole object cannot be seen).
 */
export function boxPicks(pts: readonly { x: number; y: number; behind: boolean }[], r: Rect, window: boolean): boolean {
  if (!pts.length || pts.some((p) => p.behind)) return false;
  if (window) return pts.every((p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1);
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return x0 <= r.x1 && x1 >= r.x0 && y0 <= r.y1 && y1 >= r.y0;
}
