// Images and areas on faces. Hosted on the face like a window (the
// facade frame is already exact), they follow the wall when it changes —
// without reprojecting like three.js DecalGeometry.
//  - Image: a thin plate with the photo (box instance: the front has UV 0–1).
//  - Cladding area: a material plate (procedural or photo) over a
//    piece of the wall, like stone or wood cladding.
import type { Family } from './family';
import { num, P, str } from './family';

export const IMAGE_DECAL: Family = {
  id: 'image-decal',
  name: 'Image',
  category: 'facade',
  host: 'face',
  tags: ['image', 'photo', 'poster', 'placard', 'graffiti', 'mural', 'sticker', 'logo', 'sign'],
  params: [
    P.len('width', 'Width', 2, 0.1, 30, 'type', 'size'),
    P.len('height', 'Height', 1.4, 0.1, 30, 'type', 'size'),
    P.len('sillH', 'Base height', 1.2, 0, 60, 'instance', 'size'),
    // Image identifier in the project (chosen when placing; not shown in the panel).
    { key: 'image', label: 'Image', kind: 'text', default: '', scope: 'type', group: 'detail' },
    P.flag('frame', 'Frame', false, 'detail'),
    P.color('frameColor', 'Frame color', '#2b2b2b'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), 0.02],
  sill: (p) => num(p, 'sillH'),
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height');
    out.box({ slot: 'panel', color: '#ffffff', image: str(p, 'image') }, [0, h / 2, 0.006], [w, h, 0.006]);
    if (p.frame === true) {
      const t = 0.05,
        fm = { slot: 'frame' as const, color: str(p, 'frameColor') };
      out.box(fm, [0, h + t / 2, 0.01], [w + 2 * t, t, 0.02]);
      out.box(fm, [0, -t / 2, 0.01], [w + 2 * t, t, 0.02]);
      out.box(fm, [-w / 2 - t / 2, h / 2, 0.01], [t, h, 0.02]);
      out.box(fm, [w / 2 + t / 2, h / 2, 0.01], [t, h, 0.02]);
    }
  },
};

export const CLADDING: Family = {
  id: 'cladding',
  name: 'Cladding area',
  category: 'facade',
  host: 'face',
  tags: ['cladding', 'area', 'stone', 'wood', 'panel', 'facade', 'texture', 'paint'],
  params: [
    P.len('width', 'Width', 3, 0.1, 60, 'type', 'size'),
    P.len('height', 'Height', 2.6, 0.1, 60, 'type', 'size'),
    P.len('sillH', 'Base height', 0, 0, 60, 'instance', 'size'),
    P.len('thick', 'Thickness', 0.03, 0.002, 0.3, 'type', 'size', 0.005),
    P.finish('finish', 'Finish', 'stone'),
    P.color('color', 'Color', '#cfc4ae'),
    P.color('color2', 'Joint color', '#bdb3a0'),
  ],
  size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'thick')],
  sill: (p) => num(p, 'sillH'),
  build(p, out) {
    const w = num(p, 'width'),
      h = num(p, 'height'),
      t = num(p, 'thick');
    out.prism(
      { slot: 'wall', color: str(p, 'color'), finish: str(p, 'finish'), color2: str(p, 'color2') },
      [
        [-w / 2, 0],
        [w / 2, 0],
        [w / 2, h],
        [-w / 2, h],
      ],
      0,
      t,
    );
  },
};
