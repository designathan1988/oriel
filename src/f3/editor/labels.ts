// Screen label placement for the selection dimensions, like the variable anchors
// of map renderers: each label, in priority order, tries candidate positions
// around its anchor and keeps the first one that collides with nothing already
// placed; when no candidate is free, the label is not shown.
// Mapbox, "Optimize map label placement" (text-variable-anchor):
//   https://docs.mapbox.com/help/dive-deeper/optimize-map-label-placement/
// mapbox-gl-native, "Collision Detection" (insert if there is room, else collided):
//   https://github.com/mapbox/mapbox-gl-native/wiki/Collision-Detection

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Distance between candidates and how far a label may move from its anchor (px). */
const STEP = 6;
const REACH = 72;

/**
 * Offsets tried around the anchor, nearest first; at the same distance the
 * smaller horizontal move wins (labels are wider than tall, so moving up or
 * down frees them sooner and keeps them under what they measure).
 */
const OFFSETS: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let dy = -REACH; dy <= REACH; dy += STEP)
    for (let dx = -REACH; dx <= REACH; dx += STEP) if (Math.hypot(dx, dy) <= REACH) out.push([dx, dy]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || Math.abs(a[0]) - Math.abs(b[0]));
})();

function hits(taken: readonly Rect[], l: number, t: number, r: number, b: number, gap: number): boolean {
  for (let i = 0; i < taken.length; i++) {
    const p = taken[i]!;
    if (l < p.right + gap && r > p.left - gap && t < p.bottom + gap && b > p.top - gap) return true;
  }
  return false;
}

/**
 * Places each box in order (the first has priority) at the nearest offset that
 * stays inside `bounds` and keeps `gap` px from the obstacles (handles, panels)
 * and from the boxes already placed. Returns the offset of each box, or null
 * when nothing within reach is free (the label hides instead of covering).
 */
export function placeLabels(boxes: readonly Rect[], obstacles: readonly Rect[], bounds: Rect, gap = 4): ([number, number] | null)[] {
  const taken: Rect[] = obstacles.slice();
  return boxes.map((r) => {
    for (const [dx, dy] of OFFSETS) {
      const l = r.left + dx,
        t = r.top + dy,
        rt = r.right + dx,
        b = r.bottom + dy;
      if (l < bounds.left || rt > bounds.right || t < bounds.top || b > bounds.bottom) continue;
      if (hits(taken, l, t, rt, b, gap)) continue;
      taken.push({ left: l, top: t, right: rt, bottom: b });
      return [dx, dy];
    }
    return null;
  });
}
