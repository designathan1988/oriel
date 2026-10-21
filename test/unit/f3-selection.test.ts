import { describe, expect, it } from 'vitest';
import { boxPicks, combine, marqueeRect, selMode } from '../../src/f3/editor/selection';

describe('multiple selection', () => {
  it('modifiers as in SketchUp: Ctrl adds, Shift toggles, Ctrl+Shift removes', () => {
    expect(selMode({ ctrlKey: false, shiftKey: false })).toBe('replace');
    expect(selMode({ ctrlKey: true, shiftKey: false })).toBe('add');
    expect(selMode({ ctrlKey: false, shiftKey: true })).toBe('toggle');
    expect(selMode({ ctrlKey: true, shiftKey: true })).toBe('remove');
    expect(selMode({ ctrlKey: false, shiftKey: false, metaKey: true })).toBe('add');
  });

  it('combines keeping the order and the primary', () => {
    expect(combine(['a', 'b'], ['c', 'a'], 'replace')).toEqual(['c', 'a']);
    expect(combine(['a', 'b'], ['b', 'c'], 'add')).toEqual(['a', 'b', 'c']);
    expect(combine(['a', 'b'], ['b', 'c'], 'toggle')).toEqual(['a', 'c']);
    expect(combine(['a', 'b'], ['b', 'c'], 'remove')).toEqual(['a']);
  });

  it('a box to the right is a window; to the left, crossing', () => {
    expect(marqueeRect(10, 10, 50, 40)).toEqual({ rect: { x0: 10, y0: 10, x1: 50, y1: 40 }, window: true });
    expect(marqueeRect(50, 40, 10, 10).window).toBe(false);
  });

  it('window picks only what is fully inside; crossing picks what touches', () => {
    const r = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const inside = [{ x: 10, y: 10, behind: false }, { x: 40, y: 50, behind: false }];
    const half = [{ x: 90, y: 10, behind: false }, { x: 140, y: 50, behind: false }];
    const out = [{ x: 120, y: 10, behind: false }, { x: 140, y: 50, behind: false }];
    expect(boxPicks(inside, r, true)).toBe(true);
    expect(boxPicks(half, r, true)).toBe(false);
    expect(boxPicks(half, r, false)).toBe(true);
    expect(boxPicks(out, r, false)).toBe(false);
    expect(boxPicks([{ x: 10, y: 10, behind: true }], r, false)).toBe(false);
  });
});

describe('automatic element groups', () => {
  it('groups by category, type and variation (the variation sits under the source type)', async () => {
    const { groupElements } = await import('../../src/f3/editor/elements');
    const el = (key: string, type: string) => ({ key, type, side: 's', level: 0, s: 0, pl: {} as never });
    const all = [el('a', 'win'), el('b', 'win'), el('c', 'win-v'), el('d', 'door'), el('e', 'balcony')];
    const info = (t: string) =>
      ({
        win: { name: 'Casement window', category: 'windows' },
        'win-v': { name: 'Casement window (variation)', category: 'windows', base: 'win' },
        door: { name: 'Door', category: 'doors' },
        balcony: { name: 'Balcony', category: 'balconies' },
      })[t];
    const rows = groupElements(all, info, (c) => c.toUpperCase(), ['windows', 'doors', 'balconies']);
    expect(rows.map((r) => [r.id, r.depth, r.keys.length])).toEqual([
      ['c:windows', 0, 3],
      ['t:win', 1, 3],
      ['v:win-v', 2, 1],
      ['c:doors', 0, 1],
      ['t:door', 1, 1],
      ['c:balconies', 0, 1],
      ['t:balcony', 1, 1],
    ]);
  });
});
