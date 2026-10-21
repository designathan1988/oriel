import { describe, expect, it } from 'vitest';
import { placeLabels, type Rect } from '../../src/f3/editor/labels';

const box = (x: number, y: number, w = 50, h = 18): Rect => ({ left: x, top: y, right: x + w, bottom: y + h });
const view = box(0, 0, 1000, 800);
const overlap = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const moved = (r: Rect, o: [number, number]): Rect => ({ left: r.left + o[0], top: r.top + o[1], right: r.right + o[0], bottom: r.bottom + o[1] });

describe('dimension label placement', () => {
  it('a free label stays on its anchor', () => {
    expect(placeLabels([box(100, 100)], [], view)).toEqual([[0, 0]]);
  });

  it('labels on the same spot never end over one another, and the first keeps its place', () => {
    const boxes = [box(300, 300), box(305, 302), box(298, 296), box(310, 305)];
    const at = placeLabels(boxes, [], view);
    expect(at[0]).toEqual([0, 0]);
    const placed = at.map((o, i) => moved(boxes[i]!, o!));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i]!, placed[j]!)).toBe(false);
  });

  it('a chain of small handle boxes is cleared in one go (the old push-down stopped inside it)', () => {
    // An arrow drawn as 16 px boxes every 12 px, down and to the right, over the label.
    const arrow: Rect[] = [];
    for (let i = 0; i < 10; i++) arrow.push(box(280 + i * 9, 290 + i * 9, 16, 16));
    const label = box(290, 300);
    const [o] = placeLabels([label], arrow, view);
    expect(o).not.toBeNull();
    for (const a of arrow) expect(overlap(moved(label, o!), a)).toBe(false);
    // The nearest free spot: never further than the reach.
    expect(Math.hypot(o![0], o![1])).toBeLessThanOrEqual(72);
  });

  it('stays inside the view and hides when nothing within reach is free', () => {
    const [edge] = placeLabels([box(-10, 5)], [], view);
    expect(edge![0]).toBeGreaterThanOrEqual(10);
    // A panel covering everything around the anchor: the label hides instead of covering it.
    expect(placeLabels([box(400, 400)], [box(200, 200, 500, 500)], view)).toEqual([null]);
  });
});
