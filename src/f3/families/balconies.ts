// Balconies (attached to the facade: cantilevered slab, railing, brackets and
// optional balcony door) and free verandas/porches (deck, posts, roof).
import type { Vec3 } from '../model/schema';
import type { Family, Params } from './family';
import { bool, num, P, resolveParams, str } from './family';
import { DOOR } from './doors';
import { mat, railAlong, railOpts, railParams, spread, type RailOpts } from './kit';
import type { Pt } from './shapes';

/** Balcony outline in plan, open (from the wall on the left to the wall on the right). */
function balconyOutline(shape: string, w: number, d: number, steps = 6): Pt[] {
  const hw = w / 2;
  if (shape === 'chamfer') {
    const c = Math.min(d * 0.6, hw * 0.6);
    return [[-hw, 0], [-hw, d - c], [-hw + c, d], [hw - c, d], [hw, d - c], [hw, 0]];
  }
  if (shape === 'round') {
    const r = Math.min(d * 0.9, hw * 0.9);
    const out: Pt[] = [[-hw, 0], [-hw, d - r]];
    for (let i = 1; i < steps; i++) {
      const a = Math.PI + (i / steps) * (Math.PI / 2);
      out.push([-hw + r + Math.cos(a) * r, d - r - Math.sin(a) * r]);
    }
    out.push([-hw + r, d], [hw - r, d]);
    for (let i = 1; i < steps; i++) {
      const a = Math.PI / 2 - (i / steps) * (Math.PI / 2);
      out.push([hw - r + Math.cos(a) * r, d - r + Math.sin(a) * r]);
    }
    out.push([hw, d - r], [hw, 0]);
    return out;
  }
  return [[-hw, 0], [-hw, d], [hw, d], [hw, 0]];
}

export const BALCONY: Family = {
  id: 'balcony',
  name: 'Balcony',
  category: 'balconies',
  host: 'face',
  tags: ['balcony', 'balcony', 'veranda', 'cantilever slab', 'railing', 'balcony door'],
  params: [
    // Never narrower than a balcony door (minimum door 0.7 m + jambs + gap).
    P.len('width', 'Width', 3, 1.2, 12),
    P.len('depth', 'Projection', 1.2, 0.3, 3),
    P.len('thickness', 'Slab thickness', 0.15, 0.08, 0.4, 'type', 'size', 0.01),
    { ...P.len('sillH', 'Floor height', 0, -0.3, 3, 'instance'), group: 'size' },
    P.pick('shape', 'Shape', 'rect', [
      ['rect', 'Rectangular'],
      ['chamfer', 'Chamfered'],
      ['round', 'Rounded corners'],
    ]),
    P.pick('guard', 'Guard', 'rail', [
      ['rail', 'Railing'],
      ['solid', 'Masonry parapet'],
    ]),
    ...railParams('bars', 1.1),
    P.pick('support', 'Support', 'none', [
      ['none', 'Cantilever slab'],
      ['corbels', 'Stone corbels'],
      ['brackets', 'Steel brackets'],
    ], 'detail'),
    P.count('supports', 'Number of supports', 2, 2, 8, 'detail'),
    P.flag('withDoor', 'Balcony door', true),
    P.len('doorWidth', 'Door width', 1.4, 0.7, 3, 'type', 'detail'),
    P.len('doorHeight', 'Door height', 2.3, 1.9, 3.2, 'type', 'detail'),
    P.color('slabColor', 'Slab color', '#e6e1d6'),
    P.color('floorColor', 'Floor color', '#b9a58c'),
    P.finish('floorFinish', 'Floor finish', 'floor'),
    P.color('wallColor', 'Parapet color', '#ebe4d6'),
  ],
  // The effective door (the opening and the built one) fits the slab: the width is the balcony's.
  size: (p) => [Math.max(num(p, 'width'), bool(p, 'withDoor') ? Math.min(num(p, 'doorWidth'), num(p, 'width') - 0.2) + 0.16 : 0), Math.max(num(p, 'railH'), bool(p, 'withDoor') ? num(p, 'doorHeight') : 0), num(p, 'depth')],
  sill: (p) => num(p, 'sillH'),
  opening: (p) => (bool(p, 'withDoor') ? { w: Math.min(num(p, 'doorWidth'), num(p, 'width') - 0.2), h: num(p, 'doorHeight'), shape: 'rect', depth: 0.35, room: 2.4 } : null),
  build(p, out, ctx) {
    const w = num(p, 'width'),
      d = num(p, 'depth'),
      t = num(p, 'thickness');
    const shape = str(p, 'shape');
    const slab = mat('concrete', str(p, 'slabColor'), 'paint');
    const floor = mat('stone', str(p, 'floorColor'), str(p, 'floorFinish'));
    const outline = balconyOutline(shape, w, d);
    // One-piece slab with the floor on top (floor top at y = 0); no loose plate below.
    out.slab(slab, outline, -t, -0.02);
    out.slab(floor, balconyOutline(shape, w - 0.02, d - 0.01), -0.02, 0);
    const rh = num(p, 'railH');
    const e = 0.06;
    const inner = balconyOutline(shape, w - 2 * e, d - e);
    if (str(p, 'guard') === 'solid') {
      // Parapet: a ring between the outline and the inset outline, with a coping.
      const wall = mat('wall', str(p, 'wallColor'), 'plaster');
      const tk = 0.12;
      const o2 = balconyOutline(shape, w, d);
      const i2 = balconyOutline(shape, w - 2 * tk, d - tk);
      const ring: Pt[] = [...o2, ...[...i2].reverse()];
      out.slab(wall, ring, 0, rh - 0.05);
      const capO = balconyOutline(shape, w + 0.04, d + 0.02);
      const capI = balconyOutline(shape, w - 2 * tk - 0.04, d - tk - 0.02);
      out.slab(mat('stone', '#d9d2c3', 'stone'), [...capO, ...[...capI].reverse()], rh - 0.05, rh);
    } else {
      const pts: Vec3[] = inner.map(([x, z]) => [x, 0, z]);
      railAlong(out, pts, railOpts(p));
    }
    // Supports under the slab.
    const sup = str(p, 'support');
    if (sup !== 'none') {
      const n = Math.max(2, Math.round(num(p, 'supports')));
      const xs = Array.from({ length: n }, (_, i) => -w / 2 + 0.25 + ((w - 0.5) * i) / (n - 1));
      for (const x of xs) {
        if (sup === 'corbels') {
          // Corbel: a quarter-round profile on the yz plane, swept along x.
          const cd = Math.min(d * 0.7, 0.6),
            ch = cd * 1.1;
          const prof: [number, number][] = [[-t, 0], [-t, cd]];
          for (let k = 1; k < 6; k++) {
            const a = (k / 6) * (Math.PI / 2);
            prof.push([-t - ch + Math.cos(a) * ch, cd - Math.sin(a) * cd]);
          }
          prof.push([-t - ch, 0]);
          out.sweepX(mat('stone', '#d4ccbb', 'stone'), prof, x - 0.09, x + 0.09);
        } else {
          const steel = mat('metal', str(p, 'railColor'), 'metal');
          const bd = d * 0.8;
          out.box(steel, [x, -t - 0.01, bd / 2], [0.06, 0.02, bd]);
          out.box(steel, [x, -t - bd * 0.4, 0.015], [0.08, bd * 0.8, 0.03]);
          out.rod(steel, [x, -t - bd * 0.75, 0.02], [x, -t - 0.02, bd * 0.95], 0.025, 6);
        }
      }
    }
    // Balcony door in the wall opening (the door family, with a balcony leaf).
    if (bool(p, 'withDoor')) {
      const dw = Math.min(num(p, 'doorWidth'), w - 0.2);
      const dp = resolveParams(DOOR, { leaf: 'french', leaves: 2, width: dw, height: num(p, 'doorHeight'), step: false, trim: 0.08, leafColor: '#f4f2ec', leafFinish: 'paint' });
      DOOR.build(dp, out, ctx);
    }
  },
};

// ---------- Free veranda / porch ----------

function verandaLayout(p: Params) {
  const w = num(p, 'width'),
    d = num(p, 'depth'),
    deckH = num(p, 'deckH');
  const ov = num(p, 'overhang');
  const nSteps = deckH > 0.05 ? Math.ceil(deckH / 0.18) : 0;
  const run = nSteps > 1 ? (nSteps - 1) * 0.3 : 0;
  const zmin = -d / 2 - ov,
    zmax = d / 2 + Math.max(run, ov);
  return { w, d, deckH, ov, nSteps, run, shift: -(zmin + zmax) / 2, D: zmax - zmin };
}

export const VERANDA: Family = {
  id: 'veranda',
  name: 'Veranda / porch',
  category: 'balconies',
  host: 'free',
  tags: ['veranda', 'porch', 'deck', 'portico', 'covered terrace', 'porch'],
  params: [
    P.len('width', 'Width', 4, 1.5, 16),
    P.len('depth', 'Depth', 2.5, 1, 6),
    P.len('height', 'Clear height', 2.6, 2, 4),
    P.len('deckH', 'Deck height', 0.45, 0, 1.5, 'instance'),
    P.len('overhang', 'Overhang', 0.3, 0, 1),
    P.pick('roof', 'Roof', 'shed', [
      ['flat', 'Flat slab'],
      ['shed', 'Shed'],
      ['none', 'No roof'],
    ]),
    P.angle('pitch', 'Pitch', 12, 3, 35),
    P.len('postSpacing', 'Max span between posts', 2.5, 1, 5, 'type', 'divisions'),
    P.len('postSize', 'Post section', 0.14, 0.08, 0.4, 'type', 'profile', 0.01),
    P.pick('postShape', 'Post', 'square', [
      ['square', 'Square'],
      ['round', 'Round'],
    ]),
    P.flag('rail', 'Railing', true),
    P.color('deckColor', 'Deck color', '#9b7350'),
    P.finish('deckFinish', 'Deck material', 'wood'),
    P.color('postColor', 'Post color', '#f2eee6'),
    P.color('roofColor', 'Roof color', '#7b4d3a'),
  ],
  size: (p) => {
    const L = verandaLayout(p);
    const roofH = str(p, 'roof') === 'shed' ? (L.d + 2 * L.ov) * Math.tan((num(p, 'pitch') * Math.PI) / 180) : 0.25;
    return [L.w + 2 * L.ov, L.deckH + num(p, 'height') + roofH + 0.25, L.D];
  },
  build(p, root) {
    const L = verandaLayout(p);
    const out = root.translated(0, 0, L.shift);
    const { w, d, deckH, ov } = L;
    const H = num(p, 'height');
    const deck = mat('wood', str(p, 'deckColor'), str(p, 'deckFinish'));
    const post = mat('wood', str(p, 'postColor'), 'paint');
    const roofM = mat('roof', str(p, 'roofColor'), 'tile');
    const ps = num(p, 'postSize');
    // Deck: frame, boards and short posts.
    if (deckH > 0.05) {
      out.box(mat('stone', '#8c857a', 'stone'), [0, (deckH - 0.05) / 2, 0], [w - 0.1, deckH - 0.05, d - 0.1]);
      const nb = Math.max(4, Math.round(d / 0.14));
      for (let i = 0; i < nb; i++) out.box(deck, [0, deckH - 0.025, -d / 2 + (d * (i + 0.5)) / nb], [w, 0.05, d / nb - 0.008]);
      // Steps at the front, in the middle.
      const r = deckH / L.nSteps;
      for (let i = 0; i < L.nSteps - 1; i++) {
        const z0 = d / 2 + (L.nSteps - 2 - i) * 0.3;
        out.box(deck, [0, ((i + 1) * r) / 2, z0 + 0.15], [Math.min(1.4, w * 0.6), (i + 1) * r, 0.3]);
      }
    } else {
      out.box(mat('concrete', '#b8b2a6', 'concrete'), [0, 0.04, 0], [w, 0.08, d]);
    }
    const top = Math.max(deckH, 0.08);
    // Posts at the front (and at the back, against the wall).
    const xs = spread(w - ps, num(p, 'postSpacing')).map((x) => x - (w - ps) / 2);
    const roof = str(p, 'roof');
    const pitch = (num(p, 'pitch') * Math.PI) / 180;
    const frontH = top + H;
    const zf = d / 2 - ps / 2,
      zb = -d / 2 + ps / 2;
    const yAt = (z: number) => frontH + (roof === 'shed' ? (zf - z) * Math.tan(pitch) : 0);
    if (roof !== 'none') {
      for (const x of xs)
        for (const z of [zf, zb]) {
          const h = yAt(z) - top;
          if (str(p, 'postShape') === 'round') out.cylinder(post, [x, top, z], ps / 2, h, 12);
          else out.box(post, [x, top + h / 2, z], [ps, h, ps]);
        }
      // Beams on the posts.
      for (const z of [zf, zb]) out.box(post, [0, yAt(z) + 0.09, z], [w, 0.18, ps]);
      const rf = 0.12;
      const y0 = frontH + 0.18,
        y1 = yAt(zb) + 0.18;
      if (roof === 'flat') {
        out.box(mat('concrete', str(p, 'postColor'), 'plaster'), [0, y0 + rf, 0], [w + 2 * ov, rf * 2, d + 2 * ov]);
      } else {
        // Shed roof: a sloped plate over both beams.
        const len = (d + 2 * ov) / Math.cos(pitch);
        out.box(roofM, [0, (y0 + y1) / 2 + rf / 2, 0], [w + 2 * ov, rf, len], [0, toDegX(pitch), 0]);
        // Rafters underneath.
        const n = Math.max(3, Math.round(w / 0.6));
        for (let i = 0; i <= n; i++) {
          const x = -w / 2 + (w * i) / n;
          out.box(post, [x, (y0 + y1) / 2 - 0.04, 0], [0.05, 0.08, len * 0.98], [0, toDegX(pitch), 0]);
        }
      }
    }
    if (bool(p, 'rail') && deckH > 0.3) {
      const o: RailOpts = { ...railOpts({ railH: 0.95, postSpacing: 1.8, justify: 'fit', topRail: 'wood', postSize: 0.07, postShape: 'square', infill: 'balusters', infillSpacing: 0.12, railColor: str(p, 'postColor'), railFinish: 'paint', glassColor: '#7fa0a8' }) };
      o.post = post;
      o.infillMat = post;
      const gap = Math.min(1.4, w * 0.6) / 2;
      const y = deckH;
      const e = ps / 2;
      railAlong(out, [[-gap, y, d / 2 - e], [-w / 2 + e, y, d / 2 - e], [-w / 2 + e, y, -d / 2 + e]], o);
      railAlong(out, [[gap, y, d / 2 - e], [w / 2 - e, y, d / 2 - e], [w / 2 - e, y, -d / 2 + e]], o);
    }
  },
};

/** Tilt around x for a plate that slopes down toward +z (front). */
function toDegX(a: number): number {
  // A positive x rotation takes local z to −y: the plate slopes down to the front.
  return (a * 180) / Math.PI;
}
