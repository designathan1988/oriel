// Evaluates a forma/3 building: solids (body + roof) → booleans in list order
// (like the Blender modifier stack) → cut openings →
// floor voids (hollow mode) → final mesh with the source face of each
// triangle. Pure (no three); runs in a worker or in Node.
import type { Building3, Solid, Vec2 } from '../model/schema';
import { kernel, Scope, usable, type Manifold } from '../kernel/kernel';
import { bodyMesh, coveredEdges, solidRings, type SolidRings } from './body';
import { FaceTable, type FaceInfo } from './faces';
import { roofMesh } from './roofs';
import { roofGroups } from './roofgroups';
import { relationWarnings } from '../model/relations';
import { withModifiers } from './modifiers';
import { bandsManifold, flatRoof, groupParapet, ringsAt, topKey } from './parapet';
import { heightPrism, MeshBuilder, prismMesh } from './mesh';
import { roomRowMesh, roomRows, type RoomCut } from './rooms';
import { offsetRing, oriented, ringValid, sampleRing } from '../model/plan';
import { inside } from '../model/ops';
import { edgeRegions, itemPlacements, rulePlacements, typeResolver, type Placement } from './facade';
import { emptyParts3, faceMatrix, FrameSink, type Parts3 } from './parts';
import { openingProfile } from '../families/shapes';
import { bandParts, clipPartsBelow, cutBox, exteriorWalls, floorBands, floorVoids, mergeShells, roofCuts, WALL } from './interior';
import { interiorDoorFrames, interiorWallMeshes } from './interiorwalls';
import { resolveParams } from '../families/family';
import type { Project3 } from '../model/schema';

export interface EvalOptions {
  /** Hollow walls with voids per level (section and interior). */
  hollow?: boolean;
  /** Cuts everything above this elevation (active floor). */
  cutY?: number;
  /** Interior view with the exterior walls hidden: they are cut away, slabs and wall ends show their section. */
  noWalls?: boolean;
  /** Floor bands (exploded view): each floor from its slab to its plan cut; `top` adds the roof band. */
  bands?: { levels: number[]; top: boolean };
  /** Body only, without openings (during a drag). */
  preview?: boolean;
  wallThickness?: number;
  /** Volume hidden in the view (layers, eye). Default: `solid.hidden`. */
  hidden?: (s: Solid) => boolean;
  /** Filled with the milliseconds of each phase (performance probes and gates). */
  timings?: Record<string, number>;
  /** False: every room behind an opening as its own solid, joined by booleans (the reference the row meshes are tested against). */
  roomRows?: boolean;
}

export interface Shell {
  /** Positions [x, y, z] (building frame). */
  positions: Float32Array;
  /** Three indices per triangle. */
  indices: Uint32Array;
  /** Source face of each triangle (index into `faces`). */
  faceOf: Uint32Array;
  /** Floor band of each triangle (exploded / single-floor views). */
  floorOf?: Uint16Array;
}

export interface Evaluated {
  shell: Shell;
  /** Component parts (frames, glass, balconies…). */
  parts: Parts3;
  /** Where each component ended up (selection, handles). */
  placements: Placement[];
  faces: FaceInfo[];
  warnings: string[];
  ms: number;
}

/** Complete solid of a volume: body joined to the roof. */
export function solidManifold(s: Solid, table: FaceTable, scope: Scope, noParapet = false, covered?: ReadonlySet<string>, noRoof = false): Manifold | null {
  const k = kernel();
  if (s.revolve) {
    const m = scope.keep(revolveMesh(s, table).toManifold(k));
    return usable(m) ? m : null;
  }
  if (s.loft) {
    const m = scope.keep(loftMesh(s, table).toManifold(k));
    return usable(m) ? m : null;
  }
  const rings = solidRings(s, covered);
  if (rings.outer.pts.length < 3 || s.height <= 0.01) return null;
  let body = scope.keep(bodyMesh(s, rings, table).toManifold(k));
  if (!usable(body)) return null;
  const bands = bandsManifold(s, rings, table, scope);
  if (bands.length) body = scope.keep(k.Manifold.union([body, ...bands]));
  // A subtractive solid with a curved roof becomes an arched cut (arcades, porticoes).
  // Flat/terrace: the parapet comes from the group (outline of the union), not from the volume alone.
  // A volume whose roof continues over its neighbors gets it from the group (eval/roofgroups.ts).
  const roof = noRoof || ((s.op === 'subtract' || noParapet) && flatRoof(s)) ? null : roofMesh(s, rings, table);
  if (!roof) return body;
  const parts = roof.parts.filter((p) => !p.empty).map((p) => scope.keep(p.toManifold(k)));
  const good = parts.filter((p) => usable(p));
  return good.length ? scope.keep(k.Manifold.union([body, ...good])) : body;
}

/**
 * Loft of a volume (Rhino Loft, Blender's bridge edge loops): the base plan resampled to N points by
 * length, joined to the same N points of the top shape (a regular polygon or a circle around the plan
 * center, scaled and turned), each point to the point at the same share of the way around. Caps closed.
 */
export function loftMesh(s: Solid, table: FaceTable): MeshBuilder {
  const mb = new MeshBuilder();
  const base = sampleRing(oriented(s.plan.outer, 1)).pts as Vec2[];
  const c: Vec2 = [base.reduce((a, p) => a + p[0], 0) / base.length, base.reduce((a, p) => a + p[1], 0) / base.length];
  const N = 96;
  // Base: N points evenly by length, starting at the base's first point.
  const lens = base.map((p, i) => Math.hypot(base[(i + 1) % base.length]![0] - p[0], base[(i + 1) % base.length]![1] - p[1]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const B: Vec2[] = [];
  for (let j = 0, seg = 0, acc = 0; j < N; j++) {
    const t = (total * j) / N;
    while (seg < base.length - 1 && acc + lens[seg]! < t) acc += lens[seg++]!;
    const a = base[seg]!,
      b2 = base[(seg + 1) % base.length]!;
    const u = lens[seg]! > 0 ? (t - acc) / lens[seg]! : 0;
    B.push([a[0] + (b2[0] - a[0]) * u, a[1] + (b2[1] - a[1]) * u]);
  }
  // Top: the shape around the center, as wide as the base (its mean radius), starting toward B[0].
  const r = (base.reduce((a, p) => a + Math.hypot(p[0] - c[0], p[1] - c[1]), 0) / base.length) * s.loft!.scale;
  const a0 = Math.atan2(B[0]![1] - c[1], B[0]![0] - c[0]) + (s.loft!.turn * Math.PI) / 180;
  const sides = Math.round(s.loft!.sides);
  // Same turning sense as the base (counterclockwise in plan, z down the sheet: +angle).
  const dir = Math.sign(base.reduce((acc, p, i) => { const q = base[(i + 1) % base.length]!; return acc + (p[0] * q[1] - q[0] * p[1]); }, 0)) || 1;
  const T: Vec2[] = Array.from({ length: N }, (_, j) => {
    const f = j / N;
    if (sides < 3) return [c[0] + Math.cos(a0 + dir * f * 2 * Math.PI) * r, c[1] + Math.sin(a0 + dir * f * 2 * Math.PI) * r] as Vec2;
    // On a regular polygon: the corner before and the next, by share of the perimeter.
    const k = f * sides,
      i = Math.floor(k),
      u = k - i;
    const A = a0 + (dir * i * 2 * Math.PI) / sides,
      Bn = a0 + (dir * (i + 1) * 2 * Math.PI) / sides;
    return [c[0] + (Math.cos(A) * (1 - u) + Math.cos(Bn) * u) * r, c[1] + (Math.sin(A) * (1 - u) + Math.sin(Bn) * u) * r] as Vec2;
  });
  const y0 = s.base,
    y1 = s.base + s.height;
  const side = table.add({ kind: 'side', solid: s.id, smooth: true }),
    top = table.add({ kind: 'top', solid: s.id }),
    bot = table.add({ kind: 'bottom', solid: s.id });
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const p = B[j]!,
      q = B[j2]!,
      pt = T[j]!,
      qt = T[j2]!;
    // Outward: away from the center at the middle of the strip.
    const mx = (p[0] + q[0] + pt[0] + qt[0]) / 4 - c[0],
      mz = (p[1] + q[1] + pt[1] + qt[1]) / 4 - c[1];
    mb.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [qt[0], y1, qt[1]], [pt[0], y1, pt[1]], side, [mx, 0, mz]);
  }
  // Caps: a fan from the center (the top is convex; the base fan works for the plans a loft starts from,
  // star-shaped around their center).
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    mb.triangle([c[0], y1, c[1]], [T[j]![0], y1, T[j]![1]], [T[j2]![0], y1, T[j2]![1]], top, [0, 1, 0]);
    mb.triangle([c[0], y0, c[1]], [B[j]![0], y0, B[j]![1]], [B[j2]![0], y0, B[j2]![1]], bot, [0, -1, 0]);
  }
  return mb;
}

/**
 * Solid of revolution of a volume: its profile [radius, height above the base] turned around the plan
 * center (Estúdio de Construção's "Revolution": spheres, domes, spires). The profile is closed on the
 * axis at both ends; one smooth face for the surface.
 */
export function revolveMesh(s: Solid, table: FaceTable): MeshBuilder {
  const mb = new MeshBuilder();
  const o = s.plan.outer;
  const c: Vec2 = [o.reduce((a, v) => a + v.p[0], 0) / o.length, o.reduce((a, v) => a + v.p[1], 0) / o.length];
  const prof = [...s.revolve!.profile].map((q) => [Math.max(0, q[0]), q[1]] as Vec2);
  if (prof[0]![0] > 1e-6) prof.unshift([0, prof[0]![1]]);
  if (prof[prof.length - 1]![0] > 1e-6) prof.push([0, prof[prof.length - 1]![1]]);
  const n = Math.max(8, Math.min(96, Math.round(s.revolve!.segments)));
  const side = table.add({ kind: 'side', solid: s.id, smooth: true });
  const P = (q: Vec2, j: number): [number, number, number] => {
    const a = (2 * Math.PI * j) / n;
    return [c[0] + Math.cos(a) * q[0], s.base + q[1], c[1] + Math.sin(a) * q[0]];
  };
  for (let i = 0; i + 1 < prof.length; i++) {
    const a = prof[i]!,
      b = prof[i + 1]!;
    for (let j = 0; j < n; j++) {
      const am = (2 * Math.PI * (j + 0.5)) / n;
      // Outward: the profile normal (dy, −dr) turned to this angle.
      const dr = b[0] - a[0],
        dy = b[1] - a[1];
      const want: [number, number, number] = [Math.cos(am) * dy, -dr, Math.sin(am) * dy];
      mb.quad(P(a, j), P(b, j), P(b, j + 1), P(a, j + 1), side, want);
    }
  }
  return mb;
}

function withPlinths(b: Building3, acc: Manifold, table: FaceTable, scope: Scope, hidden: (s: Solid) => boolean): Manifold {
  const k = kernel();
  const ps = b.solids.filter((s) => !hidden(s)).map((s) => plinthManifold(s, table, scope)).filter((m): m is Manifold => !!m);
  if (!ps.length) return acc;
  let band = scope.keep(k.Manifold.union(ps));
  // Hidden cutters keep cutting (they are operations, not objects).
  const cutters = b.solids.filter((s) => s.op === 'subtract').map((s) => solidManifold(s, new FaceTable(), scope)).filter((m): m is Manifold => !!m);
  if (cutters.length) band = scope.keep(band.subtract(scope.keep(k.Manifold.union(cutters))));
  return scope.keep(acc.add(band));
}

/** Plinth: a projecting band at the foot of the walls (volumes touching the ground). */
function plinthManifold(s: Solid, table: FaceTable, scope: Scope): Manifold | null {
  if (s.op !== 'add' || !(s.plinth > 0.05) || s.base > 0.3) return null;
  const k = kernel();
  const rings = solidRings(s);
  const pid = table.add({ kind: 'plinth', solid: s.id });
  const out = offsetRing(rings.outer.pts, rings.outer.pts.map(() => -0.04));
  if (!ringValid(out, 1)) return null;
  const mb = new MeshBuilder();
  heightPrism(mb, out, rings.holes.map((h) => offsetRing(h.pts, h.pts.map(() => -0.04))), [], () => s.base + Math.min(s.plinth, s.height * 0.4), s.base - 0.02, { top: () => pid, bottom: pid, side: () => pid });
  const pm = scope.keep(mb.toManifold(k));
  return usable(pm) ? pm : null;
}

export function evaluateBuilding(b0: Building3, opts: EvalOptions = {}, project?: Pick<Project3, 'types'>): Evaluated {
  const t0 = performance.now();
  // Live modifiers (repeat, mirror) make their copies here, from the source volumes (eval/modifiers.ts).
  const b = withModifiers(b0);
  const T = opts.timings;
  let tm = t0;
  // Manifold is lazy (a CSG tree): a phase is forced with status() only when it is being measured.
  const mark = (name: string, force?: Manifold | null) => {
    if (!T) return;
    if (force) force.status();
    const now = performance.now();
    T[name] = (T[name] ?? 0) + now - tm;
    tm = now;
  };
  const k = kernel();
  const scope = new Scope();
  const table = new FaceTable();
  // Relations that cannot hold right now (support gone, rider off its support): reported, nothing moved.
  const warnings: string[] = relationWarnings(b);
  const hidden = opts.hidden ?? ((s: Solid) => !!s.hidden);
  // Walls removed for the interior view: their section through a roof becomes a roof cut (hidden with the roofs).
  let wallCut: number | null = null;
  let roofCut: number | null = null;
  const fix = (sh: Shell): Shell => {
    if (wallCut === null) return sh;
    roofCut ??= table.add({ kind: 'roofCut', solid: '' });
    roofCuts(sh, b, hidden, wallCut, roofCut);
    return sh;
  };
  try {
    let acc: Manifold | null = null;
    // Groups of flat volumes with the same top: a single parapet, placed right
    // after the last member (later cutters cut it too).
    const groups = new Map<number, Solid[]>();
    const groupEnd = new Map<number, Solid[]>();
    b.solids.forEach((s) => {
      // A revolved or lofted volume is its own closed shape: no parapet on its plan outline.
      if (s.op !== 'add' || hidden(s) || !flatRoof(s) || s.revolve || s.loft) return;
      const key = topKey(s);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(s);
    });
    for (const g of groups.values()) groupEnd.set(b.solids.indexOf(g[g.length - 1]!), g);
    const covered = new Map(b.solids.map((s) => [s.id, coveredEdges(s, b.solids, hidden)]));
    // Adjacent volumes with the same sloped roof: one roof over their union, added after the last member.
    const roofOf = new Map<string, Manifold | null>();
    const roofAt = new Map<number, Manifold>();
    for (const g of roofGroups(b, hidden)) {
      const r = roofMesh(g.roofSolid, solidRings(g.roofSolid), table);
      const parts = r ? r.parts.filter((q) => !q.empty).map((q) => scope.keep(q.toManifold(k))).filter((q) => usable(q)) : [];
      // The skeleton failed on the joined outline: each volume keeps its own roof (as before).
      if (!parts.length) continue;
      const m = parts.length > 1 ? scope.keep(k.Manifold.union(parts)) : parts[0]!;
      for (const x of g.members) roofOf.set(x.id, m);
      roofAt.set(Math.max(...g.members.map((x) => b.solids.indexOf(x))), m);
    }
    for (const [i, s] of b.solids.entries()) {
      if (s.op === 'add' && hidden(s)) continue;
      const m = solidManifold(s, table, scope, true, covered.get(s.id), roofOf.has(s.id));
      if (!m) {
        warnings.push(`${s.name}: invalid shape, ignored.`);
        continue;
      }
      if (s.op === 'add') acc = acc ? scope.keep(acc.add(m)) : m;
      else if (!acc) warnings.push(`${s.name}: nothing to ${s.op === 'subtract' ? 'subtract from' : 'intersect with'} before it.`);
      else if (s.op === 'subtract') acc = scope.keep(acc.subtract(m));
      else acc = scope.keep(acc.intersect(m));
      const g = groupEnd.get(i);
      if (g && acc) for (const p of groupParapet(g, table, scope, (x) => covered.get(x.id))) acc = scope.keep(acc.add(p));
      const gr = roofAt.get(i);
      if (gr && acc) acc = scope.keep(acc.add(gr));
    }
    mark('body', acc);
    const parts = emptyParts3();
    const placements: Placement[] = [];
    if (!opts.preview) {
      // Facade on the solid before the openings: the visible part of each side. A building without volumes
      // (a site with fences, lamps, benches) still places its free and path parts.
      const shell0 = acc ? toShell(acc) : emptyShell();
      const regions = edgeRegions(shell0, table.faces);
      const types = typeResolver(project);
      const roofY = roofHeight(shell0);
      const items = itemPlacements(b, regions, types, roofY, warnings);
      for (const s of b.solids) if (!hidden(s) && s.op === 'add') placements.push(...rulePlacements(b, s, regions, types, warnings, [...items]));
      placements.push(...items);
      mark('facade');
      // Openings: a single solid with every cut. Each opening and the room behind it are built as one
      // closed mesh (no boolean to join them); cutters whose boxes do not touch any other go into a single
      // multi-part mesh, and only those that overlap are joined by booleans (Manifold's union composes
      // disjoint parts and runs real booleans only where boxes overlap: before, the 800 openings and their
      // 800 rooms of a 20-floor tower formed two crossing blocks and one huge boolean, 168 ms of 294).
      const pieces: MeshBuilder[] = [];
      const rooms: RoomCut[] = [];
      let roomCount = 0;
      const roomSections = new Map<string, RoomSection>();
      for (const pl of placements) {
        if (!pl.opening) continue;
        const o = pl.opening;
        const reveal = table.add({ kind: 'reveal', solid: pl.tag.solid ?? pl.host?.solid ?? '', ...(pl.tag.item ? { item: pl.tag.item } : {}) });
        const profile = openingProfile(o.shape, o.w, o.h, 12);
        // Room behind the opening: a real interior seen through the glass (exact parallax).
        // (Hollow building: the real rooms are there.)
        const room = !opts.hollow && o.room && o.room > 0.2 && pl.host ? roomFit(b, pl, o, roomSections) : null;
        if (room && pl.host && room.above + room.below - 0.03 >= 0.3) {
          const n = roomCount++;
          const ids = { reveal, floor: table.add({ kind: 'roomFloor', solid: pl.host.solid, room: n }), ceil: table.add({ kind: 'roomCeil', solid: pl.host.solid, room: n }), wall: table.add({ kind: 'roomWall', solid: pl.host.solid, room: n }) };
          rooms.push({ frame: pl.frame, profile, hx: room.hx, y0: -room.below + 0.03, y1: room.above, z0: -room.depth, z1: -o.depth + 0.002, ids, depth: o.depth } as RoomCut & { depth: number });
          continue;
        }
        const mb = new MeshBuilder();
        // Hollow: the opening goes through the wall into the room.
        prismMesh(mb, profile, opts.hollow ? -Math.max(o.depth, WALL + 0.15) : -o.depth, 0.6, pl.frame, reveal);
        pieces.push(mb);
      }
      // The rooms of a row (same wall plane, floor and ceiling) as one mesh with their openings; a room
      // whose opening goes past it (a door down to the floor) keeps two solids, joined by the union.
      for (const row of roomRows(rooms)) {
        const mb = new MeshBuilder();
        // A row mesh that is not closed would be refused by Manifold: its rooms go one by one.
        if (opts.roomRows !== false && roomRowMesh(mb, row.map((i) => rooms[i]!), 0.6) && mb.closed()) {
          pieces.push(mb);
          continue;
        }
        for (const i of row) {
          const r = rooms[i]! as RoomCut & { depth: number };
          const pm = new MeshBuilder();
          prismMesh(pm, r.profile, -r.depth, 0.6, r.frame, r.ids.reveal);
          pieces.push(pm);
          const rb = new MeshBuilder();
          roomBox(rb, r.frame, r.hx, r.y0, r.y1, r.z0, r.z1, r.ids);
          if (!rb.empty) pieces.push(rb);
        }
      }
      const layers = acc ? cutterLayers(pieces, k, scope, warnings) : [];
      const cuts: Manifold[] = [];
      mark('cutters');
      // Plinth after the facade (does not hide the foot of doors), without crossing cuts.
      if (acc) acc = withPlinths(b, acc, table, scope, hidden);
      mark('plinth', acc);
      if (opts.hollow) {
        const voids = floorVoids(b, hidden, table, scope);
        if (voids) cuts.push(voids);
      }
      if (opts.hollow && opts.noWalls) {
        wallCut = table.add({ kind: 'cut', solid: '' });
        const walls = exteriorWalls(b, hidden, table, scope, wallCut);
        if (walls) cuts.push(walls);
      }
      // Hollow voids and removed walls cross everything: a layer of their own, last.
      if (cuts.length) layers.push(cuts);
      mark('cutUnion');
      // The first layer (most of the cutters, no two touching) alone; the rest (the few that touch it:
      // rooms meeting at a corner, a door and its room) joined into one: two subtractions in all.
      const [first, ...rest] = layers;
      if (first && acc) acc = scope.keep(acc.subtract(first.length > 1 ? scope.keep(k.Manifold.union(first)) : first[0]!));
      const others = rest.flat();
      if (others.length && acc) acc = scope.keep(acc.subtract(others.length > 1 ? scope.keep(k.Manifold.union(others)) : others[0]!));
      mark('cutSubtract', acc);
      // Interior walls of the hollow building: joined AFTER the voids, so the floor voids never cut
      // them open (they stand on a slab and stop under the one above). A door is a notch in the
      // wall's own plan (eval/interiorwalls.ts), so nothing has to be subtracted from them either.
      // A hollow volume (shell) is open inside in every view: its rooms are walled and floored too.
      if ((opts.hollow || b.solids.some((x) => x.op === 'add' && !x.hidden && (x.shell ?? 0) > 0)) && acc) {
        const iw = interiorWallMeshes(b, table);
        if (iw) {
          try {
            const m = scope.keep(iw.toManifold(k));
            if (usable(m)) acc = scope.keep(acc.add(m));
            else warnings.push('Interior walls ignored (their plan is not a closed solid).');
          } catch {
            warnings.push('Interior walls ignored (their plan is not a closed solid).');
          }
        }
      }
      mark('interiorWalls', acc);
      for (const pl of placements) {
        const tag = parts.tags.push(pl.tag) - 1;
        pl.family.build(pl.params, new FrameSink(parts, pl.frame, tag), { length: pl.length, reveal: pl.opening?.depth ?? 0, index: 0, ...(pl.path ? { path: pl.path } : {}) });
      }
      // The doors of the interior walls get a leaf and a frame (the standard panelled door at their size),
      // not a bare hole.
      if (opts.hollow || b.solids.some((x) => x.op === 'add' && !x.hidden && (x.shell ?? 0) > 0)) {
        const dt = types('door-panel');
        if (dt) for (const d of interiorDoorFrames(b)) {
          const params = resolveParams(dt.family, dt.type.params, { width: d.width, height: d.height });
          const tag = parts.tags.push({ family: dt.family.id, key: d.key }) - 1;
          dt.family.build(params, new FrameSink(parts, faceMatrix(d.o, d.u, [0, 1, 0], d.n), tag), { length: d.width, reveal: d.depth, index: 0 });
        }
      }
    }
    mark('parts');
    if (acc && opts.preview) acc = withPlinths(b, acc, table, scope, hidden);
    // Floor bands: one piece per floor (and the roof), each with its band index.
    if (acc && opts.bands) {
      const bands = floorBands(b, opts.bands.levels, opts.bands.top);
      const shells = bands.map((bd) => fix(toShell(scope.keep(acc!.intersect(cutBox(bd.lo, table, scope, bd.hi))))));
      return { shell: mergeShells(shells, bands.map((bd) => bd.index)), parts: bandParts(parts, bands), placements, faces: table.faces, warnings, ms: performance.now() - t0 };
    }
    // Cut by floor: the solid above goes and the cut plane shows as a section (its own face kind).
    if (acc && opts.cutY !== undefined) acc = scope.keep(acc.subtract(cutBox(opts.cutY, table, scope)));
    const shell = acc ? fix(toShell(acc)) : emptyShell();
    mark('mesh');
    return { shell, parts: opts.cutY !== undefined ? clipPartsBelow(parts, opts.cutY) : parts, placements, faces: table.faces, warnings, ms: performance.now() - t0 };
  } finally {
    scope.dispose();
  }
}

/**
 * Room behind an opening, limited to the interior of the host volume: it does
 * not pass the slab (volume top), does not pierce the opposite wall or the side
 * walls near the corners and does not enter cuts (courtyards). No room: no space.
 */
/** Interior of a volume at one height: the outline inset by the wall and the holes grown by it. */
interface RoomSection {
  rings: SolidRings;
  at: Map<number, { inner: Vec2[]; holes: Vec2[][] } | null>;
}

function roomFit(b: Building3, pl: Placement, o: { w: number; depth: number; room?: number }, sections: Map<string, RoomSection>): { hx: number; below: number; above: number; depth: number } | null {
  const host = b.solids.find((x) => x.id === pl.host!.solid);
  if (!host) return null;
  let sec = sections.get(host.id);
  if (!sec) sections.set(host.id, (sec = { rings: solidRings(host), at: new Map() }));
  const S = sec;
  const lv = levelAround(b, pl);
  const y = pl.frame[13]!;
  const SLAB = 0.25,
    WALL = 0.2;
  const above = Math.min(lv.above - 0.12, host.base + host.height - y - SLAB);
  const below = Math.min(lv.below, y - host.base - 0.02);
  if (above < 0.5) return null;
  // The interior at the height of each tested point (taper and leaning sides narrow it as it rises),
  // cached per 10 cm: the base plan alone let rooms poke through the neighbouring faces of a tapered tower.
  const interiorAt = (wy: number) => {
    const key = Math.round((wy - host.base) * 10);
    if (!S.at.has(key)) {
      const [outer, ...hs] = ringsAt(S.rings, Math.max(0, Math.min(host.height, key / 10)));
      const inner = offsetRing(outer!, outer!.map(() => WALL));
      S.at.set(key, ringValid(inner, 1) ? { inner, holes: hs.map((h) => offsetRing(h, h.map(() => WALL))) } : null);
    }
    return S.at.get(key)!;
  };
  const y0 = y - below,
    y1 = y + above;
  const cutters = b.solids
    .filter((x) => x.op === 'subtract' && x.base < y1 && x.base + x.height > y0)
    .map((x) => offsetRing(sampleRing(oriented(x.plan.outer, 1)).pts, sampleRing(oriented(x.plan.outer, 1)).pts.map(() => -WALL)));
  const m = pl.frame;
  // A point of the room in the part frame (x along, y up the wall, z out) → building frame (3D: the frame may lean).
  const free = (x: number, ly: number, z: number) => {
    const px = m[0]! * x + m[4]! * ly + m[8]! * z + m[12]!,
      py = m[1]! * x + m[5]! * ly + m[9]! * z + m[13]!,
      pz = m[2]! * x + m[6]! * ly + m[10]! * z + m[14]!;
    const sec = interiorAt(py);
    const p: Vec2 = [px, pz];
    return !!sec && inside(p, sec.inner) && !sec.holes.some((h) => inside(p, h)) && !cutters.some((c) => inside(p, c));
  };
  const fits = (hx: number, d: number) => {
    // Corners and the middle of each edge of the box, at its floor and at its ceiling.
    for (const ly of [-below + 0.03, above]) for (const x of [-hx, 0, hx]) for (const z of [-o.depth - 0.05, -(o.depth + d) / 2 - 0.01, -d]) if (!free(x, ly, z)) return false;
    return true;
  };
  const minHx = o.w / 2 + 0.03;
  const minD = o.depth + 0.4;
  if (!fits(minHx, minD)) return null;
  // Largest depth and then largest width that fit (binary search).
  let lo = minD,
    hi = o.depth + (o.room ?? 0);
  if (fits(minHx, hi)) lo = hi;
  else
    for (let k = 0; k < 10; k++) {
      if (fits(minHx, (lo + hi) / 2)) lo = (lo + hi) / 2;
      else hi = (lo + hi) / 2;
    }
  const depth = lo;
  let a = minHx,
    z = o.w / 2 + 0.9;
  if (fits(z, depth)) a = z;
  else
    for (let k = 0; k < 10; k++) {
      if (fits((a + z) / 2, depth)) a = (a + z) / 2;
      else z = (a + z) / 2;
    }
  return { hx: a, below, above, depth };
}

/** Floor and ceiling of the storey around a part (distances from the part base). */
function levelAround(b: Building3, pl: Placement): { below: number; above: number } {
  // Real elevation of the part (on a leaning wall, host.y runs along the wall, not vertically).
  const y = pl.frame[13]!;
  const lv = [...b.levels].sort((p, q) => p.elevation - q.elevation).filter((l) => l.elevation <= y + 0.01).pop();
  if (!lv) return { below: Math.min(1, pl.host!.y), above: 2.6 };
  return { below: y - lv.elevation, above: lv.elevation + lv.height - y };
}

/** Box (room) in the part frame, with floor, ceiling and wall faces. */
function roomBox(mb: MeshBuilder, m: number[], hx: number, y0: number, y1: number, z0: number, z1: number, ids: { floor: number; ceil: number; wall: number }): void {
  if (y1 - y0 < 0.3) return;
  const P = (x: number, y: number, z: number): [number, number, number] => [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
  const N = (x: number, y: number, z: number): [number, number, number] => [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z];
  const c = (sx: number, sy: number, sz: number) => P(sx < 0 ? -hx : hx, sy < 0 ? y0 : y1, sz < 0 ? z0 : z1);
  mb.quad(c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), ids.floor, N(0, -1, 0));
  mb.quad(c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1), ids.ceil, N(0, 1, 0));
  mb.quad(c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), ids.wall, N(0, 0, -1));
  mb.quad(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), ids.wall, N(0, 0, 1));
  mb.quad(c(-1, -1, -1), c(-1, 1, -1), c(-1, 1, 1), c(-1, -1, 1), ids.wall, N(-1, 0, 0));
  mb.quad(c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1), ids.wall, N(1, 0, 0));
}

/** Roof height (highest y among upward-facing triangles under the point). */
export function roofHeight(sh: Shell): (x: number, z: number) => number {
  const P = sh.positions,
    I = sh.indices;
  return (x, z) => {
    let best = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]! * 3,
        b = I[t + 1]! * 3,
        c = I[t + 2]! * 3;
      const ax = P[a]!, az = P[a + 2]!, bx = P[b]!, bz = P[b + 2]!, cx = P[c]!, cz = P[c + 2]!;
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * P[a + 1]! + l2 * P[b + 1]! + l3 * P[c + 1]!;
      if (y > best) best = y;
    }
    return best;
  };
}

export function emptyShell(): Shell {
  return { positions: new Float32Array(0), indices: new Uint32Array(0), faceOf: new Uint32Array(0) };
}

export function toShell(m: Manifold): Shell {
  const mesh = m.getMesh();
  return {
    // Every input has only a position (numProp = 3).
    positions: new Float32Array(mesh.vertProperties),
    indices: new Uint32Array(mesh.triVerts),
    faceOf: new Uint32Array(mesh.faceID),
  };
}

/** Last cutter grouping (probes): how many pieces and how many layers they were subtracted in. */
export const cutterStats: { pieces: number; layers: number } = { pieces: 0, layers: 0 };

/**
 * Cutters as layers of solids that do not touch each other: within a layer Manifold's union only
 * composes (no boolean), and A − (B ∪ C) = (A − B) − C, so subtracting layer after layer gives the
 * same solid as subtracting their union, without the booleans that joined the overlapping ones
 * (the rooms of two facades meeting at a corner). Pieces whose box touches no other go together in
 * one multi-part mesh (one Manifold).
 */
function cutterLayers(pieces: MeshBuilder[], k: ReturnType<typeof kernel>, scope: Scope, warnings: string[]): Manifold[][] {
  const n = pieces.length;
  cutterStats.pieces = n;
  if (!n) return [];
  const B = pieces.map((p) => p.bounds());
  // Box overlaps (a 0.1 mm gap counts as touching: merged vertices would join them).
  const E = 1e-4;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, c) => B[a]![0]! - B[c]![0]!);
  const touches: number[][] = Array.from({ length: n }, () => []);
  for (let x = 0; x < n; x++) {
    const i = order[x]!,
      bi = B[i]!;
    for (let y = x + 1; y < n; y++) {
      const j = order[y]!,
        bj = B[j]!;
      if (bj[0]! > bi[3]! + E) break;
      if (bj[1]! > bi[4]! + E || bj[4]! < bi[1]! - E || bj[2]! > bi[5]! + E || bj[5]! < bi[2]! - E) continue;
      touches[i]!.push(j);
      touches[j]!.push(i);
    }
  }
  // Greedy coloring: each piece takes the first layer where nothing it touches is.
  const layerOf = new Array<number>(n).fill(-1);
  for (const i of order) {
    const used = new Set(touches[i]!.map((j) => layerOf[j]!).filter((l) => l >= 0));
    let l = 0;
    while (used.has(l)) l++;
    layerOf[i] = l;
  }
  const ok = (m: Manifold) => usable(m);
  // Manifold refuses an open mesh with an exception: such a cutter is dropped (it cuts nothing).
  const solid = (mb: MeshBuilder): Manifold | null => {
    try {
      const m = scope.keep(mb.toManifold(k));
      return ok(m) ? m : null;
    } catch {
      return null;
    }
  };
  const layers: Manifold[][] = [];
  const count = Math.max(...layerOf) + 1;
  for (let l = 0; l < count; l++) {
    const ids = layerOf.flatMap((x, i) => (x === l ? [i] : []));
    const mb = new MeshBuilder();
    for (const i of ids) mb.append(pieces[i]!);
    const m = solid(mb);
    if (m) layers.push([m]);
    else {
      // One bad piece would spoil the whole layer: then each goes on its own. A piece that is still
      // refused cuts nothing, and the user is told (before, the wall stayed whole with no word).
      const each = ids.map((i) => solid(pieces[i]!));
      const lost = each.filter((x) => !x).length;
      if (lost) warnings.push(`${lost} opening(s) could not be cut (their solid is not closed): the wall stays whole there.`);
      const good = each.filter((x): x is Manifold => !!x);
      if (good.length) layers.push(good);
    }
  }
  cutterStats.layers = layers.length;
  return layers;
}

export { MeshBuilder };
