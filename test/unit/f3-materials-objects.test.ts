import { describe, expect, it } from 'vitest';
import { drawShape, readShapes, SHAPE_KINDS, shapeMat, shapesBox, type Shape } from '../../src/f3/families/assembly';
import { family } from '../../src/f3/families/index';
import { emptyParts3, FrameSink, identity } from '../../src/f3/eval/parts';
import { materialKey } from '../../src/f3/render/finishes';
import { partMaterial } from '../../src/f3/render/parts';
import { extraKey } from '../../src/geometry/parts';
import { sameMaterial } from '../../src/f3/model/matlib';
import { TEMPLATES } from '../../src/f3/io/templates';

const shape = (kind: Shape['kind'], extra: Partial<Shape> = {}): Shape => ({ kind, at: [0, 0.5, 0], size: [1, 1, 1], color: '#888888', ...extra });

describe('material adjustments', () => {
  it('roughness, metallic, texture size and turn, light and opacity reach the render key', () => {
    const k = materialKey({ finish: 'brick', color: '#a8553a', rough: 0.3, metal: 0.2, scale: 2, rot: 45, glow: 1.5, opacity: 0.5 }, 'wall');
    expect(k.roughness).toBe(0.3);
    expect(k.metalness).toBe(0.2);
    expect(k.uvScale).toBe(2);
    expect(k.uvRot).toBe(45);
    expect(k.glow).toBe(1.5);
    expect(k.opacity).toBe(0.5);
    // The caches tell an adjusted material from the plain one.
    expect(extraKey(k)).not.toBe('');
    expect(extraKey(materialKey({ finish: 'brick', color: '#a8553a' }, 'wall'))).toBe('');
  });

  it('a picture is tiled at its width in metres, not stretched like a plate', () => {
    const k = materialKey({ finish: 'image', color: '#ffffff', image: 'img1', scale: 1.5 }, 'wall');
    expect(k.image).toBe('img1');
    expect(k.imageTile).toBe(1.5);
    expect(k.uvScale).toBeUndefined();
  });

  it('the project library tells materials apart by their adjustments', () => {
    expect(sameMaterial({ finish: 'wood', color: '#9c6b43' }, { finish: 'wood', color: '#9c6b43', rot: 90 })).toBe(false);
    expect(sameMaterial({ finish: 'wood', color: '#9c6b43', rot: 90 }, { finish: 'wood', color: '#9C6B43', rot: 90 })).toBe(true);
  });
});

describe('objects from shapes', () => {
  it('every kind of shape gives closed, finite geometry inside its box', () => {
    for (const [kind] of SHAPE_KINDS) {
      const parts = emptyParts3();
      drawShape(new FrameSink(parts, identity(), 0), shape(kind, { t: 0.3 }));
      const pos = parts.meshes.flatMap((m) => m.positions);
      expect(parts.inst.length + parts.meshes.length, kind).toBeGreaterThan(0);
      for (let i = 0; i < pos.length; i += 3) {
        expect(Number.isFinite(pos[i]! + pos[i + 1]! + pos[i + 2]!), kind).toBe(true);
        expect(Math.abs(pos[i]!), kind).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(pos[i + 1]!, kind).toBeGreaterThanOrEqual(-1e-9);
        expect(pos[i + 1]!, kind).toBeLessThanOrEqual(1 + 1e-9);
      }
      // Normals point away from the middle on the whole (outward winding).
      const nrm = parts.meshes.flatMap((m) => m.normals);
      let out = 0;
      for (let i = 0; i < pos.length; i += 3) out += pos[i]! * nrm[i]! + (pos[i + 1]! - 0.5) * nrm[i + 1]! + pos[i + 2]! * nrm[i + 2]!;
      if (pos.length) expect(out, kind).toBeGreaterThan(0);
    }
  });

  it('a turned shape: its box follows the turn', () => {
    const b = shapesBox([shape('box', { size: [2, 0.2, 0.2], rot: [90, 0, 0] })]);
    expect(b.hi[2] - b.lo[2]).toBeCloseTo(2, 6);
    expect(b.hi[0] - b.lo[0]).toBeCloseTo(0.2, 6);
  });

  it('the family reads its shapes and sizes itself from them; bad input draws nothing', () => {
    const f = family('assembly')!;
    const p = { shapes: JSON.stringify([shape('sphere', { at: [0, 1, 0], size: [0.4, 0.4, 0.4] }), shape('cylinder', { at: [0, 0.4, 0], size: [0.1, 0.8, 0.1] })]) };
    const [w, h, d] = f.size(p);
    expect(w).toBeCloseTo(0.4, 6);
    expect(h).toBeCloseTo(1.2, 6);
    expect(d).toBeCloseTo(0.4, 6);
    expect(readShapes({ shapes: 'not json' })).toEqual([]);
    expect(readShapes({ shapes: JSON.stringify([{ kind: 'blob', at: [0, 0, 0], size: [1, 1, 1] }]) })).toEqual([]);
  });

  it('a lamp shape glows at night; surface adjustments reach the material', () => {
    expect(partMaterial(shapeMat(shape('sphere', { lamp: true }))).lamp).toBe(true);
    const k = partMaterial(shapeMat(shape('box', { finish: 'steel', metal: 1, rough: 0.1, opacity: 0.4 })));
    expect(k.metalness).toBe(1);
    expect(k.roughness).toBe(0.1);
    expect(k.opacity).toBe(0.4);
  });
});

describe('templates in the interface language', () => {
  it('names the project, buildings and rooms through the translator; the floors follow the room, not its translation', () => {
    const pt: Record<string, string> = { 'Single-storey house': 'Casa térrea', 'Bedroom 1': 'Quarto 1', Walls: 'Paredes' };
    const p = TEMPLATES.find((t) => t.id === 'house')!.make((s) => pt[s] ?? s);
    const b = p.buildings[0]!;
    expect(p.name).toBe('Casa térrea');
    expect(b.solids[0]!.name).toBe('Paredes');
    const rooms = Object.values(b.interiors ?? {})[0]!.rooms;
    expect(rooms.find((r) => r.name === 'Quarto 1')!.finish!.finish).toBe('wood');
    // Without a translator: English, and the next template is not left translated.
    expect(TEMPLATES.find((t) => t.id === 'house')!.make().name).toBe('Single-storey house');
  });
});
