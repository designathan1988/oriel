// Model commands of the editor: operations on volumes, duplicate and linked copies, components, design options, properties, generators (curtain wall, corner window, railing, beams), mirror, combine and bridge.
import type { Building3, ID, Item, Solid, Vec2, Vec3 } from '../model/schema';
import { building as newBuilding, facadeRule, planVertices, roofSpec, solid as newSolid, uid } from '../model/defaults';
import { bendEdge, cloneBuilding, inside, mirrorSolidAbout, reflect, cloneSolid, edgeNormal, findSolid, pushEdge, splitEdge, toLocal, topRing, toWorld, translateSolid } from '../model/ops';
import { modifierCopies } from '../eval/modifiers';
import { adoptOffsetSides, stackOnTop, edgeLength, extrudeSide, insetSide, insetTop, offsetCopy, offsetSolid, setSolidSize, splitAtHeight } from '../model/modeling';
import { activeLayer, ensureLayers, viewOf, optionHidden } from '../model/layers';
import { pointsAlong } from './tools/polyline';
import { replicateLevel } from '../eval/interiorwalls';
import { buildingBox, freeShift, volumeBox, type PlanBox } from '../model/align';
import { cornerLimit, offsetRing, oriented, ringValid } from '../model/plan';
import { family, typeById } from '../families/index';
import { resolveParams } from '../families/family';
import { columnGrid as columnGridOf } from '../model/structure';
import { osmToBuildings, overpassQuery } from '../model/osm';
import { separateSolids } from '../model/compose';
import { clipperOffset } from '../eval/clipoffset';
import { between, column } from './elements';
import { fmt } from './support';
import type { Editor3 } from './editor';

/**
 * Modeling operations on the selection (panel, measure box): face extrude
 * and inset, offset, split, size, bevel, corners.
 */
export function modelOp(ed: Editor3, op: string, a: Record<string, number | string | boolean> = {}): boolean {
  const b = ed.activeBuilding(),
    s = ed.activeSolid();
  if (!b || !s) return false;
  const n = (k: string, d = 0) => (typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : d);
  let created: Solid | null = null;
  let cornerLimited: number | null = null;
  const edge = ed.sel.face?.kind === 'side' ? ed.sel.face.edge : undefined;
  // Edge mode: every selected side; otherwise the side of the chosen face.
  const edgeList = ed.sel.edges?.length ? ed.sel.edges : edge ? [edge] : [];
  const msgs: Record<string, string> = {
    extrude: n('depth') >= 0 ? 'Face extruded (new volume).' : 'Face pushed in.',
    'inset-side': n('depth') >= 0 ? 'Projection created.' : 'Niche created (cutter).',
    'inset-top': n('depth') >= 0 ? 'Volume on the top created.' : 'Recess in the top created (cutter).',
    offset: a.copy ? 'Offset copy created.' : 'Outline offset.',
    split: 'Volume split in two.',
    size: 'Size applied.',
    bevel: (() => {
      // Without a width (here or on a side) segments and profile have nothing to shape yet: say so.
      const cur = s.bevel ?? { top: 0, bottom: 0 };
      const w = Math.max(n('top', cur.top), n('bottom', cur.bottom), ...Object.values(s.edges).map((e) => e.bevel ?? 0));
      return w > 0 ? 'Bevel applied.' : 'Segments and profile kept: give the bevel a width (Top or Base) to see them.';
    })(),
    'edge-bevel': 'Side bevel applied.',
    'edge-offset': 'Edge moved.',
    'edge-curve': n('sag') ? 'Edge curved.' : 'Edge straightened.',
    'edge-split': 'Edge split in two.',
    corner: 'Corner adjusted.',
  };
  const layer = activeLayer(ed.project);
  const run = (x: Building3): boolean => {
      const so = findSolid(x, s.id)!;
      switch (op) {
        case 'extrude':
          if (!edge) return false;
          // Sinking the whole face is pushing it in: the wall keeps its windows, shops and parapet (a
          // full-face cutter left a blank cut face). A niche with margins is Inset.
          if (n('depth') < 0) return pushEdge(so, edge, n('depth'));
          created = extrudeSide(x, so, edge, n('depth'));
          return !!created;
        case 'inset-side':
          if (!edge) return false;
          created = insetSide(x, so, edge, n('margin', 1), n('depth', -1), !!a.keepBottom);
          return !!created;
        case 'inset-top':
          created = insetTop(x, so, n('inset'), n('depth'));
          return !!created;
        case 'offset': {
          const corner = (a.corner as 'sharp' | 'round' | 'chamfer' | undefined) ?? 'sharp';
          const before = structuredClone(so);
          if (a.copy) {
            created = offsetCopy(x, so, n('d'), corner);
            if (created) return true;
            const pieces = clipperOffset(so.plan, n('d'), corner);
            if (!pieces.length) return false;
            const roof0 = structuredClone(so.roof);
            const made = pieces.map((pc) => {
              const c = cloneSolid(so);
              c.plan = { outer: planVertices(pc.outer), holes: pc.holes.map((h) => planVertices(h)) };
              c.edges = {};
              so.roof = structuredClone(roof0);
              stackOnTop(x, so, c);
              x.solids.push(c);
              return c;
            });
            // The copies take the settings and rules of the sides they come from (new IDs: the source keeps its own).
            adoptOffsetSides(before, made, n('d'));
            const own = new Set([before.plan.outer, ...before.plan.holes].flat().map((v) => v.id));
            for (const c of made) {
              const ids = new Map<ID, ID>();
              for (const ring of [c.plan.outer, ...c.plan.holes]) for (const v of ring) if (own.has(v.id)) ids.set(v.id, uid());
              for (const ring of [c.plan.outer, ...c.plan.holes]) for (const v of ring) if (ids.has(v.id)) v.id = ids.get(v.id)!;
              c.edges = Object.fromEntries(Object.entries(c.edges).map(([k, e]) => [ids.get(k) ?? k, e]));
              c.facade = c.facade.map((r) => ({ ...r, id: uid(), edges: r.edges.map((e) => ids.get(e) ?? e), except: {} }));
            }
            created = made[made.length - 1]!;
            return true;
          }
          if (offsetSolid(so, n('d'), corner)) return true;
          // The exact offset cannot keep the shape (a part vanishes or the outline splits): Clipper2 gives
          // what is left, each piece as a volume (arcs sampled); each new side gets the identity, settings and
          // rules of the side it comes from (model/modeling.ts, adoptOffsetSides).
          const pieces = clipperOffset(so.plan, n('d'), corner);
          if (!pieces.length) return false;
          const vols = pieces.map((pc, i) => {
            const t = i === 0 ? so : cloneSolid(so);
            t.plan = { outer: planVertices(pc.outer), holes: pc.holes.map((h) => planVertices(h)) };
            t.edges = {};
            if (i > 0) {
              t.name = `${so.name} ${i + 1}`;
              x.solids.push(t);
            }
            return t;
          });
          adoptOffsetSides(before, vols, n('d'), x.items);
          return true;
        }
        case 'split':
          created = splitAtHeight(x, so, n('y'));
          return !!created;
        case 'size':
          return setSolidSize(so, n('w'), n('d'));
        case 'bevel': {
          const cur = so.bevel ?? { top: 0, bottom: 0, segments: 1, profile: 0 };
          so.bevel = { top: Math.max(0, n('top', cur.top)), bottom: Math.max(0, n('bottom', cur.bottom)), segments: Math.max(1, Math.round(n('segments', cur.segments))), profile: Math.max(0, Math.min(1, n('profile', cur.profile))) };
          // Segments and profile also shape the bevel of single sides: kept even without a width here.
          if (so.bevel.top <= 0 && so.bevel.bottom <= 0 && so.bevel.segments === 1 && so.bevel.profile === 0) delete so.bevel;
          return true;
        }
        case 'edge-bevel': {
          if (!edgeList.length) return false;
          // 0 is valid too: removes the bevel from these sides only.
          for (const e of edgeList) (so.edges[e] ??= {}).bevel = Math.max(0, n('w'));
          return true;
        }
        case 'edge-offset': {
          // Each side moves along its own normal (+ out, − in), its neighbours follow.
          return edgeList.length > 0 && edgeList.every((e) => pushEdge(so, e, n('d')));
        }
        case 'edge-curve': {
          // Sagitta at the middle of the side, along its outward normal (0 straightens).
          for (const e of edgeList) {
            const ring = [so.plan.outer, ...so.plan.holes].find((rg) => rg.some((v) => v.id === e));
            const i = ring ? ring.findIndex((v) => v.id === e) : -1;
            const nrm = edgeNormal(so, e);
            if (!ring || i < 0 || !nrm) return false;
            const a = ring[i]!.p,
              c = ring[(i + 1) % ring.length]!.p;
            if (!n('sag')) {
              delete ring[i]!.bulge;
              continue;
            }
            if (!bendEdge(so, e, [(a[0] + c[0]) / 2 + nrm[0] * n('sag'), (a[1] + c[1]) / 2 + nrm[1] * n('sag')])) return false;
          }
          return edgeList.length > 0;
        }
        case 'edge-split': {
          const made = edgeList.map((e) => splitEdge(so, e));
          return made.length > 0 && made.every(Boolean);
        }
        case 'corner': {
          // One chosen corner, or every corner of the outline when none is chosen.
          const vids = ed.sel.verts ?? [];
          const vs = vids.length ? [so.plan.outer, ...so.plan.holes].flat().filter((q) => vids.includes(q.id)) : so.plan.outer;
          if (!vs.length) return false;
          for (const v of vs) {
            const ring = [so.plan.outer, ...so.plan.holes].find((r) => r.includes(v))!;
            // Never more than half the shorter side of the corner.
            const max = cornerLimit(ring, ring.indexOf(v));
            const want = (k: string) => Math.min(n(k), max);
            if ('round' in a) {
              if (n('round') > max) cornerLimited = max;
              if (want('round') > 0) v.round = want('round');
              else delete v.round;
            }
            if ('chamfer' in a) {
              if (n('chamfer') > max) cornerLimited = max;
              if (want('chamfer') > 0) v.chamfer = want('chamfer');
              else delete v.chamfer;
            }
          }
          return true;
        }
      }
      return false;
  };
  const ok = ed.change(
    b.id,
    (x) => {
      const r = run(x);
      const c = created as Solid | null;
      if (r && c && layer && !c.layer) c.layer = layer;
      return r;
    },
    msgs[op] ?? '',
  );
  if (ok && created) ed.select({ building: b.id, solids: [(created as Solid).id] });
  if (ok && cornerLimited !== null) ed.toast(`Limited to ${fmt(cornerLimited)} m: half the shorter side of the corner.`);
  return ok;
}

export function duplicate(ed: Editor3, linked = false): void {
  const b = ed.activeBuilding();
  if (!b) return;
  if (!linked && ed.context === b.id && ed.sel.item) {
    const it = ed.activeItem()!;
    const c = structuredClone(it);
    c.id = uid();
    // Beside the original, one part width (and a hand) away: along the side, back the other way when the
    // side ends (before, 1.5 m: a wide part landed on itself).
    const t = typeById(it.type, ed.project);
    const f = t && family(t.family);
    const pr = f ? resolveParams(f, t!.params, it.params) : {};
    const w = Math.max(0.5, Number(pr.width ?? pr.w ?? 1)) + 0.4;
    if (c.host.kind === 'face') {
      const hs = findSolid(b, c.host.solid);
      const len = hs ? edgeLength(hs, c.host.edge) : Infinity;
      c.host.u = c.host.u + w + w / 2 <= len ? c.host.u + w : Math.max(w / 2, c.host.u - w);
    } else if (c.host.kind === 'free') c.host.p = [c.host.p[0] + w, c.host.p[1], c.host.p[2]];
    else if (c.host.kind === 'roof') c.host.p = [c.host.p[0] + w, c.host.p[1]];
    else if (c.host.kind === 'path') c.host.points = c.host.points.map((p) => [p[0] + 2, p[1], p[2] + 2] as Vec3);
    ed.change(b.id, (x) => void x.items.push(c), 'Component duplicated.');
    ed.select({ building: b.id, item: c.id });
    return;
  }
  if (!linked && ed.context === b.id && ed.sel.solids.length) {
    const ids: ID[] = [];
    // The copies keep their arrangement and go beside the selected volumes, on a free spot of the
    // building (before, 2 m off: the copy went through the original).
    const chosen = ed.sel.solids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x);
    // The other volumes and the other buildings (their boxes seen from this building's frame).
    const rest = b.solids.filter((x) => x.op === 'add' && !chosen.includes(x)).map(volumeBox);
    for (const o of ed.project.buildings) {
      if (o === b) continue;
      const ob = buildingBox(o);
      if (!ob) continue;
      const cs = [[ob.x0, ob.z0], [ob.x1, ob.z0], [ob.x1, ob.z1], [ob.x0, ob.z1]].map((q) => toLocal(b, q as Vec2));
      rest.push({ x0: Math.min(...cs.map((q) => q[0])), x1: Math.max(...cs.map((q) => q[0])), z0: Math.min(...cs.map((q) => q[1])), z1: Math.max(...cs.map((q) => q[1])) });
    }
    const [dx, dz] = freeShift(chosen.map(volumeBox), rest, 2);
    ed.change(
      b.id,
      (x) => {
        for (const sid of ed.sel.solids) {
          const src = findSolid(x, sid);
          if (!src) continue;
          const c = cloneSolid(src);
          translateSolid(c, dx, dz);
          c.name = src.name.replace(/( \(copy\))+$/, '') + ' (copy)';
          x.solids.push(c);
          ids.push(c.id);
        }
      },
      ids.length > 1 || ed.sel.solids.length > 1 ? `${ed.sel.solids.length} volumes duplicated.` : 'Volume duplicated.',
    );
    ed.select({ building: b.id, solids: ids });
    return;
  }
  // Every selected building (the arrangement between them is kept), on the nearest free ground beside the
  // group: right, left, front or back, by steps of the group's real size plus 3 m, touching no building
  // (before, 4 m away: the copy went through the original).
  const sel = ed.selectedBuildings().map((id) => ed.store.building(id)).filter((x): x is Building3 => !!x);
  const box = (bx: Building3): PlanBox | null => {
    const bb = ed.boundsOf(bx);
    if (!bb) return null;
    const r = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const cx of [bb.min[0], bb.max[0]])
      for (const cz of [bb.min[2], bb.max[2]]) {
        const w = toWorld(bx, [cx, cz]);
        r.x0 = Math.min(r.x0, w[0]);
        r.x1 = Math.max(r.x1, w[0]);
        r.z0 = Math.min(r.z0, w[1]);
        r.z1 = Math.max(r.z1, w[1]);
      }
    return r;
  };
  const group = sel.map(box).filter((q): q is PlanBox => !!q);
  const others = ed.project.buildings.filter((o) => !sel.includes(o)).map(box).filter((q): q is PlanBox => !!q);
  const [shiftX, shiftZ] = freeShift(group, others, 3);
  const copies = sel.flatMap((src) => {
    // A linked copy keeps the very same volumes (their IDs too): an edit of either is made on both.
    const c = linked ? structuredClone(src) : cloneBuilding(src);
    if (linked) {
      c.id = uid();
      src.linked ??= src.id;
      c.linked = src.linked;
      c.lotId = null;
    }
    c.position = [src.position[0] + shiftX, src.position[1] + shiftZ];
    c.name = src.name.replace(/( \(copy\))+$/, '') + ' (copy)';
    ed.store.project.buildings.push(c);
    return [c.id];
  });
  const msg = linked ? (copies.length > 1 ? `${copies.length} linked copies: an edit of one is made on all.` : 'Linked copy: an edit of one is made on all.') : copies.length > 1 ? `${copies.length} buildings duplicated.` : 'Building duplicated.';
  if (!ed.store.commit(copies, msg)) return;
  ed.toast(msg);
  ed.selectBuildings(copies);
}

/** The building leaves its group of linked copies (it is edited on its own from now on). */
export function unlink(ed: Editor3, id: ID): void {
  const b = ed.store.building(id);
  if (!b?.linked) return;
  const key = b.linked;
  ed.changeSite((p) => {
    const x = p.buildings.find((q) => q.id === id)!;
    delete x.linked;
    // A group of one is no group.
    const rest = p.buildings.filter((q) => q.linked === key);
    if (rest.length === 1) delete rest[0]!.linked;
  }, 'Independent: edited on its own.');
}

/**
 * A curtain wall over the whole selected side (Revit's curtain wall): it replaces the wall there, and the
 * side stops taking the facade rule's windows (blank) so nothing sits behind the glass.
 */
export function curtainWall(ed: Editor3): void {
  const b = ed.activeBuilding();
  const s = ed.activeSolid();
  const edge = ed.sel.face?.kind === 'side' ? ed.sel.face.edge : undefined;
  if (!b || !s || !edge) return ed.toast('Select a side of a volume first.');
  const len = edgeLength(s, edge);
  if (!(len > 1)) return ed.toast('That side is too short.');
  const it: Item = { id: uid(), type: 'curtain-wall', params: { width: Math.round((len - 0.1) * 100) / 100, height: Math.round((s.height - 0.05) * 100) / 100, sillH: 0 }, host: { kind: 'face', solid: s.id, edge, u: Math.round((len / 2) * 100) / 100, y: 0 } };
  ed.change(b.id, (x) => {
    const so = findSolid(x, s.id)!;
    (so.edges[edge] ??= {}).blank = true;
    x.items.push(it);
  }, 'Curtain wall on this side.');
  ed.select({ building: b.id, item: it.id });
}

/**
 * Beams between the columns of a building (Revit's beam system on the grid): each column joined to its
 * nearest neighbour on the same line (the same x or z, 5 cm of tolerance) up to 8 m away and on the same
 * floor, at the columns' top; beams already there are not repeated.
 */
export function beamsBetweenColumns(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (!b) return ed.toast('Select a building with columns first.');
  const cols = b.items
    .filter((it) => it.host.kind === 'free' && typeById(it.type, ed.project)?.family === 'column')
    .map((it) => {
      const h = it.host as { p: Vec3 };
      const t = typeById(it.type, ed.project)!;
      const f = family(t.family)!;
      const height = Number(resolveParams(f, t.params, it.params).height ?? 3);
      return { x: h.p[0], y: h.p[1], z: h.p[2], top: h.p[1] + height };
    });
  if (cols.length < 2) return ed.toast('At least two columns are needed.');
  const key = (a: Vec3, c: Vec3) => [a, c].map((q) => q.map((v) => Math.round(v * 20)).join(',')).sort().join('|');
  const have = new Set(b.items.filter((it) => it.type === 'beam' && it.host.kind === 'path').map((it) => key((it.host as { points: Vec3[] }).points[0]!, (it.host as { points: Vec3[] }).points.at(-1)!)));
  const add: Vec3[][] = [];
  for (const c of cols)
    for (const dir of [0, 1] as const) {
      // The nearest column after this one along x (dir 0) or z (dir 1), on the same line and floor.
      let best: (typeof cols)[number] | null = null;
      for (const o of cols) {
        if (o === c || Math.abs(o.y - c.y) > 0.05) continue;
        const along = dir === 0 ? o.x - c.x : o.z - c.z,
          off = dir === 0 ? o.z - c.z : o.x - c.x;
        if (along <= 0.05 || along > 8 || Math.abs(off) > 0.05) continue;
        if (!best || along < (dir === 0 ? best.x - c.x : best.z - c.z)) best = o;
      }
      if (!best) continue;
      const top = Math.min(c.top, best.top);
      const a: Vec3 = [c.x, top, c.z],
        e: Vec3 = [best.x, top, best.z];
      if (have.has(key(a, e))) continue;
      have.add(key(a, e));
      add.push([a, e]);
    }
  if (!add.length) return ed.toast('No two columns on a line within 8 m (or their beams are there).');
  ed.change(b.id, (x) => {
    for (const pts of add) x.items.push({ id: uid(), type: 'beam', params: { align: 'top' }, host: { kind: 'path', points: pts } });
  }, `${add.length} beam(s) between the columns.`);
}

/** Outward direction of each side of a volume (plan, unit), by its edge ID. */
export function sideDirs(ed: Editor3, s: Solid): Map<ID, Vec2> {
  const out = new Map<ID, Vec2>();
  const r = oriented(s.plan.outer, 1);
  r.forEach((v, i) => {
    const w = r[(i + 1) % r.length]!;
    const dx = w.p[0] - v.p[0],
      dz = w.p[1] - v.p[1];
    const l = Math.hypot(dx, dz) || 1;
    // Counterclockwise ring: the outside is on the right of each side.
    out.set(v.id, [dz / l, -dx / l]);
  });
  return out;
}

/**
 * Copy properties (SketchUp's Match, Revit's Match Type): the look of the selected volume — roof, facade
 * rules, materials, plinth, bands, bevel, walls — kept to paste on other volumes. Nothing of its shape.
 */
export function copyProperties(ed: Editor3): void {
  const s = ed.activeSolid();
  if (!s) return ed.toast('Select a volume first.');
  ed.matchSource = { ...structuredClone({ roof: s.roof, facade: s.facade, materials: s.materials, plinth: s.plinth, bands: s.bands, bevel: s.bevel, shell: s.shell, wallLayers: s.wallLayers }), dirs: ed.sideDirs(s) };
  ed.toast(`Properties of ${s.name} copied: select volumes and paste them (Ctrl+Shift+V).`);
}

/** Paste properties on the selected volumes (or every volume of the selected buildings). */
export function pasteProperties(ed: Editor3): void {
  const src = ed.matchSource;
  if (!src) return ed.toast('Copy the properties of a volume first (Ctrl+Shift+C).');
  const b = ed.activeBuilding();
  if (!b) return ed.toast('Select the volumes to paste on.');
  const inside = ed.context === b.id && ed.sel.solids.length;
  const targets = inside ? [{ b, ids: ed.sel.solids }] : ed.selectedBuildings().map((id) => ({ b: ed.store.building(id)!, ids: ed.store.building(id)!.solids.filter((x) => x.op === 'add').map((x) => x.id) }));
  let n = 0;
  for (const t of targets) {
    for (const id of t.ids) {
      const s = findSolid(t.b, id);
      if (!s || s.op !== 'add') continue;
      const { dirs, ...look } = src;
      const c = structuredClone(look);
      // A rule kept to some sides goes to the sides of this volume facing the same way; its exceptions
      // (single windows changed by hand) belong to the other volume and stay there. Each rule a new ID.
      const mine = ed.sideDirs(s);
      const sideFor = (id: ID): ID | undefined => {
        const d = dirs.get(id);
        if (!d) return undefined;
        let best: ID | undefined,
          bd = 0.5;
        for (const [k, m] of mine) {
          const dot = m[0] * d[0] + m[1] * d[1];
          if (dot > bd) [best, bd] = [k, dot];
        }
        return best;
      };
      c.facade = c.facade.map((r) => ({ ...r, id: uid(), edges: [...new Set(r.edges.map(sideFor).filter((x): x is ID => !!x))], except: {} }));
      // A rule that kept to sides none of which face the same way here is left out.
      c.facade = c.facade.filter((r, i) => !look.facade[i]!.edges.length || r.edges.length);
      Object.assign(s, c);
      for (const k of ['bands', 'bevel', 'shell', 'wallLayers'] as const) if (c[k] === undefined) delete s[k];
      n++;
    }
  }
  if (!n) return ed.toast('Select the volumes to paste on.');
  ed.store.commit(targets.map((t) => t.b.id), `Properties pasted on ${n} volume(s).`);
  ed.toast(`Properties pasted on ${n} volume(s).`);
}

/**
 * A corner window at the selected corner of a volume (on the floor shown): a window on each of the two
 * sides meeting there, each running to the corner, so the wall's corner is open from sill to head and
 * the two frames meet as the corner post.
 */
export function cornerWindow(ed: Editor3, width = 1.6): void {
  const b = ed.activeBuilding();
  const s = ed.activeSolid();
  const vid = ed.sel.vertex;
  if (!b || !s || !vid) return ed.toast('Select a corner of a volume first.');
  const ring = s.plan.outer;
  const i = ring.findIndex((v) => v.id === vid);
  if (i < 0) return ed.toast('Select a corner of a volume first.');
  const next = vid,
    prev = ring[(i - 1 + ring.length) % ring.length]!.id;
  const ln = edgeLength(s, next),
    lp = edgeLength(s, prev);
  const w = Math.min(width, ln - 0.3, lp - 0.3);
  if (w < 0.6) return ed.toast('The sides at this corner are too short.');
  const lv = ed.workLevel(b);
  const y = Math.max(0, (lv?.elevation ?? s.base) + 0.9 - s.base);
  const mk = (edge: ID, u: number): Item => ({ id: uid(), type: 'win-casement', params: { width: Math.round(w * 100) / 100, trim: 0, shutters: 'none' }, host: { kind: 'face', solid: s.id, edge, u: Math.round(u * 1000) / 1000, y } });
  // The side that starts at the corner, and the one that ends there.
  ed.change(b.id, (x) => void x.items.push(mk(next, w / 2), mk(prev, lp - w / 2)), 'Corner window.');
}

/**
 * A new design option of the selected building (Revit's design options): a copy in the same place,
 * the next option of its set (A, B, C…), shown at once; the original becomes option A of a new set.
 */
export function newDesignOption(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (!b) return ed.toast('Select a building first.');
  const sets = [...new Set(ed.project.buildings.flatMap((x) => (x.option ? [x.option.set] : [])))];
  const set = b.option?.set ?? (() => {
    for (let i = 1; ; i++) if (!sets.includes(`Options ${i}`)) return `Options ${i}`;
  })();
  const used = ed.project.buildings.filter((x) => x.option?.set === set).map((x) => x.option!.name);
  let name = 'A';
  for (let i = 0; i < 26; i++) {
    name = String.fromCharCode(66 + i - 1);
    if (!used.includes(name) && (b.option || name !== 'A')) break;
  }
  const src = ed.store.building(b.id)!;
  const c = cloneBuilding(src);
  src.option ??= { set, name: 'A' };
  c.option = { set, name };
  c.name = `${src.name.replace(/ \([A-Z]\)$/, '')} (${name})`;
  ed.store.project.buildings.push(c);
  (viewOf(ed.store.project).options ??= {})[set] = name;
  if (!ed.store.commit([src.id, c.id], `Design option ${name}: change it freely; the Interior view switches the options.`)) return;
  ed.toast(`Design option ${name}: change it freely; the Interior view switches the options.`);
  ed.selectBuildings([c.id]);
}

/** Keeps the shown option of the selected building's set and deletes the others (Revit's Accept Primary). */
export function acceptDesignOption(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (!b?.option) return ed.toast('Select a design option first.');
  const set = b.option.set;
  const keep = ed.project.buildings.filter((x) => x.option?.set === set && !optionHidden(ed.project, x)).map((x) => x.id);
  ed.changeSite((p) => {
    p.buildings = p.buildings.filter((x) => x.option?.set !== set || keep.includes(x.id));
    for (const x of p.buildings) if (x.option?.set === set) delete x.option;
    if (p.view?.options) delete p.view.options[set];
  }, 'Option kept; the others deleted.');
}

/**
 * Applies the live copies of the selected volume (repeat, mirror; Blender's Apply modifier): each copy
 * becomes a volume of its own with new IDs, right after the source, and the source keeps no modifier.
 */
export function applyModifiers(ed: Editor3): void {
  const b = ed.activeBuilding(),
    s = ed.activeSolid();
  if (!b || !s || !((s.repeat && s.repeat.count > 1) || s.mirror)) return ed.toast('Select a volume with copies first.');
  const n = modifierCopies(s).length;
  ed.change(
    b.id,
    (x) => {
      const src = x.solids.find((q) => q.id === s.id);
      if (!src) return false;
      const copies = modifierCopies(src).map((c, i) => {
        const k = cloneSolid(c);
        k.name = `${src.name} ${i + 2}`;
        return k;
      });
      delete src.repeat;
      delete src.mirror;
      x.solids.splice(x.solids.indexOf(src) + 1, 0, ...copies);
    },
    `${n} copies are volumes of their own now.`,
  );
}

/** Saves the selected buildings as a component of the project's library (Library → My types). */
export function saveAsComponent(ed: Editor3): void {
  const bs = ed.selectedBuildings().map((id) => ed.store.building(id)).filter((x): x is Building3 => !!x);
  if (!bs.length) return ed.toast('Select the buildings to keep as a component.');
  const cx = bs.reduce((a, b) => a + b.position[0], 0) / bs.length,
    cz = bs.reduce((a, b) => a + b.position[1], 0) / bs.length;
  const name = (bs.length === 1 ? bs[0]!.name : `${bs[0]!.name} +${bs.length - 1}`).slice(0, 60);
  const comp = {
    id: uid(),
    name,
    buildings: bs.map((b) => {
      const c = structuredClone(b);
      c.position = [b.position[0] - cx, b.position[1] - cz];
      c.lotId = null;
      delete c.linked;
      return c;
    }),
  };
  if ((ed.project.components?.length ?? 0) >= 200) return ed.toast('At most 200 components.');
  ed.changeSite((p) => void (p.components ??= []).push(comp), `${name}: kept in the Library (My types).`);
}

/** Inserts a copy of a saved component at the middle of the view, selected (M moves it). */
export function insertComponent(ed: Editor3, id: ID): void {
  const comp = ed.project.components?.find((c) => c.id === id);
  if (!comp) return;
  const t = ed.view.target;
  const ids: ID[] = [];
  for (const src of comp.buildings) {
    const b = cloneBuilding(src);
    b.position = [Math.round((t.x + src.position[0]) * 100) / 100, Math.round((t.z + src.position[1]) * 100) / 100];
    ed.store.project.buildings.push(b);
    ids.push(b.id);
  }
  if (!ed.store.commit(ids, `${comp.name} inserted.`)) return;
  ed.toast(`${comp.name} inserted: M moves it.`);
  ed.selectBuildings(ids);
}

/** A railing around the selected flat top (a terrace, a slab edge), 8 cm in from its edge. */
export function railAround(ed: Editor3): void {
  const b = ed.activeBuilding();
  const s = ed.activeSolid();
  if (!b || !s || ed.sel.face?.kind !== 'top') return ed.toast('Select the top of a volume first.');
  const ring = offsetRing(topRing(s), topRing(s).map(() => 0.08));
  if (!ringValid(ring, 1)) return ed.toast('That top is too small for a railing.');
  const y = s.base + s.height;
  const points = [...ring, ring[0]!].map((p) => [p[0], y, p[1]] as Vec3);
  const it: Item = { id: uid(), type: 'railing-bars', params: {}, host: { kind: 'path', points, around: s.id } };
  ed.change(b.id, (x) => void x.items.push(it), 'Railing around the edge.');
  ed.select({ building: b.id, item: it.id });
}

/** Reflects the selection across the world line through `a` along `d`; `copy` keeps the original. */
export function mirrorAcross(ed: Editor3, a: Vec2, d: Vec2, copy: boolean): void {
  const b = ed.activeBuilding();
  if (!b) return;
  if (ed.context === b.id && ed.sel.solids.length) {
    // Volumes: the line in the building's frame.
    const la = toLocal(b, a),
      lb = toLocal(b, [a[0] + d[0], a[1] + d[1]]);
    const ld: Vec2 = [lb[0] - la[0], lb[1] - la[1]];
    const ids: ID[] = [];
    ed.change(b.id, (x) => {
      for (const sid of ed.sel.solids) {
        const src = findSolid(x, sid);
        if (!src) continue;
        const t = copy ? cloneSolid(src) : src;
        mirrorSolidAbout(t, la, ld);
        // Parts on its sides: the distance along each side counted from its other end.
        if (!copy) for (const it of x.items) if (it.host.kind === 'face' && it.host.solid === t.id) it.host.u = Math.round((edgeLength(t, it.host.edge) - it.host.u) * 1000) / 1000;
        if (copy) {
          t.name = src.name.replace(/( \(copy\))+$/, '') + ' (copy)';
          x.solids.push(t);
        }
        ids.push(t.id);
      }
    }, copy ? 'Mirrored copy.' : 'Mirrored.');
    return ed.select({ building: b.id, solids: ids });
  }
  // Buildings: the position reflected, the rotation turned and the plan flipped across its own x axis.
  const phi = Math.atan2(d[1], d[0]);
  const ids: ID[] = [];
  for (const id of ed.selectedBuildings()) {
    const src = ed.store.building(id);
    if (!src) continue;
    const t = copy ? cloneBuilding(src) : src;
    t.position = reflect(src.position, a, d);
    t.rotation = Math.round(((((-(2 * phi * 180) / Math.PI - src.rotation) % 360) + 540) % 360 - 180) * 1000) / 1000;
    for (const s of t.solids) mirrorSolidAbout(s, [0, 0], [1, 0]);
    for (const it of t.items) {
      const h = it.host;
      if (h.kind === 'free') {
        h.p = [h.p[0], h.p[1], -h.p[2]];
        // Its front (local +z) reflected: the turn that faces the mirrored way.
        h.rot = Math.round(((180 - h.rot + 540) % 360) - 180);
      } else if (h.kind === 'face') {
        // The side runs the other way now: the distance along it is counted from its other end.
        const so = findSolid(t, h.solid);
        if (so) h.u = Math.round((edgeLength(so, h.edge) - h.u) * 1000) / 1000;
      } else if (h.kind === 'roof') h.p = [h.p[0], -h.p[1]];
      else if (h.kind === 'path') h.points = h.points.map((q) => [q[0], q[1], -q[2]] as Vec3);
    }
    for (const it of Object.values(t.interiors ?? {})) {
      for (const n of it.nodes) n.p = [n.p[0], -n.p[1]];
      for (const r of it.rooms) if (r.polygon) r.polygon = r.polygon.map((q) => [q[0], -q[1]] as Vec2).reverse();
    }
    if (copy) {
      t.name = src.name.replace(/( \(copy\))+$/, '') + ' (copy)';
      ed.store.project.buildings.push(t);
    }
    ids.push(t.id);
  }
  if (!ids.length) return;
  ed.store.commit(ids, copy ? 'Mirrored copy.' : 'Mirrored.');
  ed.toast(copy ? 'Mirrored copy.' : 'Mirrored.');
  ed.selectBuildings(ids);
}

/**
 * Booleans between the selected volumes (the first selected is the one acted on): Join makes every one
 * add; Subtract and Intersect make the others cut it or keep only the common part, placed right after it
 * in the order (an operation acts on what comes before it).
 */
/**
 * A bridge between the two selected volumes (Estúdio de Construção's "bridge"): a one-floor volume
 * across the gap between their facing sides, on the first floor above the ground, as wide as their
 * facing stretch allows (at most 4 m).
 */
export function bridgeSelected(ed: Editor3): void {
  const b = ed.activeBuilding();
  if (!b || ed.sel.solids.length !== 2) return ed.toast('Select two volumes (Shift+click) to bridge.');
  const [p, q] = ed.sel.solids.map((id) => findSolid(b, id)).filter((x): x is Solid => !!x).map((x) => ({ s: x, box: volumeBox(x) }));
  if (!p || !q) return;
  const A = p.box,
    B = q.box;
  const lv = [...b.levels].sort((m, n) => m.elevation - n.elevation);
  const base = lv[1] && lv[1].elevation < Math.min(p.s.base + p.s.height, q.s.base + q.s.height) - 2 ? lv[1].elevation : Math.max(p.s.base, q.s.base);
  const h = lv[1]?.height ?? lv[0]?.height ?? 3;
  let plan: Vec2[] | null = null;
  const gapX = A.x1 < B.x0 ? [A.x1, B.x0] : B.x1 < A.x0 ? [B.x1, A.x0] : null;
  const gapZ = A.z1 < B.z0 ? [A.z1, B.z0] : B.z1 < A.z0 ? [B.z1, A.z0] : null;
  if (gapX) {
    const z0 = Math.max(A.z0, B.z0),
      z1 = Math.min(A.z1, B.z1);
    if (z1 - z0 < 1.2) return ed.toast('The two volumes do not face each other: nothing to bridge.');
    const w = Math.min(4, z1 - z0),
      c = (z0 + z1) / 2;
    plan = [[gapX[0]!, c - w / 2], [gapX[1]!, c - w / 2], [gapX[1]!, c + w / 2], [gapX[0]!, c + w / 2]];
  } else if (gapZ) {
    const x0 = Math.max(A.x0, B.x0),
      x1 = Math.min(A.x1, B.x1);
    if (x1 - x0 < 1.2) return ed.toast('The two volumes do not face each other: nothing to bridge.');
    const w = Math.min(4, x1 - x0),
      c = (x0 + x1) / 2;
    plan = [[c - w / 2, gapZ[0]!], [c + w / 2, gapZ[0]!], [c + w / 2, gapZ[1]!], [c - w / 2, gapZ[1]!]];
  }
  if (!plan) return ed.toast('The volumes touch or overlap: nothing to bridge (Join makes them one).');
  const br = newSolid({ name: 'Bridge', plan: { outer: planVertices(plan), holes: [] }, base, height: h, roof: roofSpec('flat', { parapet: 0.3 }) });
  br.facade = [facadeRule('win-sliding', { levels: 'all', mode: 'max', value: 2.2 })];
  ed.change(b.id, (x) => void x.solids.push(br), `Bridge ${fmt(Math.abs((gapX ?? gapZ)![1]! - (gapX ?? gapZ)![0]!))} m long, ${fmt(h)} m high.`);
  ed.select({ building: b.id, solids: [br.id] });
}

export function combineSelected(ed: Editor3, op: Solid['op']): void {
  const b = ed.activeBuilding();
  if (!b || ed.sel.solids.length < 2) return;
  const [first, ...rest] = ed.sel.solids;
  ed.change(b.id, (x) => {
    const f = findSolid(x, first!);
    if (!f) return false;
    f.op = 'add';
    const others = rest.map((id) => findSolid(x, id)).filter((q): q is Solid => !!q);
    for (const o of others) o.op = op;
    if (op !== 'add') {
      x.solids = x.solids.filter((q) => !others.includes(q));
      x.solids.splice(x.solids.indexOf(f) + 1, 0, ...others);
    }
  }, op === 'add' ? 'Volumes joined.' : op === 'subtract' ? `The others carve ${findSolid(b, first!)?.name ?? 'the first'}.` : 'Only the common part stays.');
}

/**
 * A free part on a wall becomes a facade rule of its type on every floor of that side (at its sill and
 * with its own values), like "Repeat on facade" in Estúdio de Construção; the part itself goes.
 */
export function repeatOnFacade(ed: Editor3): void {
  const b = ed.activeBuilding(),
    it = ed.activeItem();
  if (!b || !it || it.host.kind !== 'face') return ed.toast('Select a part on a wall to repeat it on the facade.');
  const h = it.host;
  const s = findSolid(b, h.solid);
  if (!s) return;
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation);
  const y = s.base + h.y;
  const floor = lv.filter((l) => l.elevation <= y + 0.01).pop();
  const t = typeById(it.type, ed.project);
  const f = t && family(t.family);
  const w = f ? f.size(resolveParams(f, t!.params, it.params))[0] : 1.2;
  const rule = facadeRule(it.type, { edges: [h.edge], levels: 'all', mode: 'max', value: Math.max(w + 0.8, 2.4), sill: Math.max(0, y - (floor?.elevation ?? s.base)), params: { ...it.params } });
  ed.change(b.id, (x) => {
    const so = findSolid(x, s.id)!;
    so.facade.push(rule);
    x.items = x.items.filter((q) => q.id !== it.id);
  }, 'Repeated on every floor of this side (a facade rule).');
  ed.select({ building: b.id, solids: [s.id], face: { kind: 'side', edge: h.edge } });
}

/** Volumes of a building become a building of their own, in the same place (Separate, Keep apart). */
export function separate(ed: Editor3, bid: ID, ids: ID[], name?: string): boolean {
  const b = ed.store.building(bid);
  if (!b) return false;
  const nb = separateSolids(b, ids, (input) => newBuilding({ ...input, ...(name ? { name } : {}) }));
  if (!nb) {
    ed.toast('A building keeps at least one volume: nothing to separate.');
    return false;
  }
  ed.store.project.buildings.push(nb);
  if (!ed.store.commit([b.id, nb.id], 'Separated: a building of its own.')) return false;
  ed.toast(`${nb.name} is a building of its own now (Ctrl+Z joins it again).`);
  ed.enter(null);
  ed.select({ building: nb.id });
  return true;
}

/** Columns every `spacing` m inside the chosen volume (or the first), on each of its floors (model/structure.ts). */
export function columnGrid(ed: Editor3, spacing = 6): void {
  const b = ed.store.building(ed.context) ?? ed.activeBuilding();
  if (!b) return ed.toast('Select a building first.');
  const s = ed.activeSolid() ?? b.solids.find((q) => q.op === 'add');
  if (!s) return;
  const items = columnGridOf(b, s, spacing, 'column-square', uid);
  if (!items.length) return ed.toast('The volume is too small for a grid that wide.');
  ed.change(b.id, (x) => void x.items.push(...items), `${items.length} columns, a grid of ${fmt(spacing)} m (each is a part: move, size or delete it).`);
}

/** The interior walls of the floor shown copied to every floor above it. */
export function replicateFloor(ed: Editor3): void {
  const b = ed.store.building(ed.context) ?? ed.activeBuilding();
  if (!b) return ed.toast('Select a building first.');
  const lv = ed.workLevel(b);
  if (!lv || !b.interiors[lv.id]?.walls.length) return ed.toast('No interior walls on this floor to copy.');
  const above = b.levels.filter((l) => l.elevation > lv.elevation + 0.1).map((l) => l.id);
  if (!above.length) return ed.toast('No floor above this one.');
  ed.change(b.id, (x) => replicateLevel(x, lv.id, above, uid), `Walls of this floor copied to ${above.length} floor(s) above.`);
}

/**
 * Copies of the selected free part along a line drawn on the ground (lamps along a path, trees along a
 * drive, bollards): one every `spacing` m, each turned along the line.
 */
export function arrayAlongPath(ed: Editor3, spacing: number): void {
  const b = ed.activeBuilding();
  const it = ed.activeItem();
  if (!b || !it || it.host.kind !== 'free') return ed.toast('Select a free part (a lamp, a tree, a bench) first.');
  const src = structuredClone(it);
  const bid = b.id;
  ed.toast('Click the points of the line on the ground; Enter ends.');
  ed.polyline.start('Click the start of the line', (pts) => {
    const bb = ed.store.building(bid);
    if (!bb) return;
    // The part itself counts as one: no copy right next to it.
    const own = src.host.kind === 'free' ? toWorld(bb, [src.host.p[0], src.host.p[2]]) : null;
    const at = pointsAlong(pts, Math.max(0.5, spacing)).filter((q) => !own || Math.hypot(q.p[0] - own[0], q.p[1] - own[1]) > spacing * 0.5);
    const items: Item[] = at.map((q) => {
      const l = toLocal(bb, q.p);
      return { ...structuredClone(src), id: uid(), host: { kind: 'free', p: [l[0], src.host.kind === 'free' ? src.host.p[1] : 0, l[1]], rot: Math.round((q.yaw - bb.rotation) * 100) / 100 } };
    });
    if (!items.length) return;
    ed.change(bid, (x) => void x.items.push(...items), `${items.length} copies along the line, every ${fmt(spacing)} m.`);
    ed.select({ building: bid, item: items[0]!.id });
  });
}

/**
 * The buildings around the project's place from OpenStreetMap (Overpass API, model/osm.ts), on a layer
 * of their own ("OpenStreetMap"), replacing an earlier import. The place is the real sun's (Time panel).
 */
export async function importOsm(ed: Editor3, radius = 200): Promise<void> {
  const sun = ed.project.view?.sun;
  if (!sun) return ed.toast('Choose the place first: Time panel → real sun (city or latitude/longitude).');
  ed.toast(`Asking OpenStreetMap for the buildings within ${radius} m of ${sun.place ?? `${sun.latitude.toFixed(4)}, ${sun.longitude.toFixed(4)}`}…`);
  let json: unknown;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(overpassQuery(sun.latitude, sun.longitude, radius)) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    json = await r.json();
  } catch (err) {
    return ed.toast(`OpenStreetMap did not answer (${(err as Error).message}). Try again in a minute.`);
  }
  const p = ed.store.project;
  const layers = ensureLayers(p);
  let layer = layers.find((l) => l.name === 'OpenStreetMap');
  if (!layer) {
    layer = { id: uid(), name: 'OpenStreetMap', color: '#8a96a3', visible: true, locked: true };
    layers.push(layer);
  }
  const lid = layer.id;
  const bs = osmToBuildings(json as { elements?: [] }, sun.latitude, sun.longitude, lid);
  if (!bs.length) return ed.toast('OpenStreetMap has no buildings mapped around this place.');
  p.buildings = p.buildings.filter((b) => b.layer !== lid).concat(bs);
  ed.store.commit(null, `${bs.length} buildings from OpenStreetMap.`);
  ed.toast(`${bs.length} buildings from OpenStreetMap (© OpenStreetMap contributors, ODbL), on the locked layer "OpenStreetMap".`);
  ed.view.frameAll();
}
