// IFC4 export (buildingSMART IFC4 ADD2 TC1, STEP physical file ISO 10303-21), written as text: one
// IfcProject, IfcSite, an IfcBuilding per building with an IfcBuildingStorey per level; the evaluated
// shell grouped into IfcWall (sides), IfcSlab (tops, floors, bottoms) and IfcRoof (roofs), and each
// component as IfcWindow / IfcDoor / IfcStair / IfcRailing / IfcFurniture / IfcBuildingElementProxy,
// in its storey; the rooms of each floor plan as IfcSpace (name, the free floor extruded to the ceiling,
// Qto_SpaceBaseQuantities with NetFloorArea and Height), aggregated in their storey. Geometry as IfcTriangulatedFaceSet (tessellation), coloured by the finish of the
// volume or the part. Coordinates: IFC is Z up (X east, Y north): the scene's (x, y, z) → (x, −z, y).
// Read back with web-ifc in the tests (test/unit/f3-ifc.test.ts). Needs the loaded kernel.
import { BRAND } from '../model/brand';
import type { Project3, Solid } from '../model/schema';
import { evaluateBuilding } from '../eval/evaluate';
import { primitiveTris } from '../eval/interior';
import { apply, type M4 } from '../eval/parts';
import { family as familyOf } from '../families/index';
import { floorPlan } from '../eval/floorplan';
import { SLAB } from '../eval/interior';
import { interiorDoors, interiorWallMeshes } from '../eval/interiorwalls';
import { FaceTable } from '../eval/faces';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** An IFC GlobalId (22 characters of the IFC base 64; 128 bits, so the first is 0–3) from a seed. */
export function ifcGuid(seed: string): string {
  // FNV-1a over the seed, four rounds with different salts: 128 deterministic bits.
  const words: number[] = [];
  for (let r = 0; r < 4; r++) {
    let h = 0x811c9dc5 ^ (r * 0x9e3779b9);
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h >>> 0);
  }
  let big = 0n;
  for (const w of words) big = (big << 32n) | BigInt(w);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = B64[Number(big & 63n)]! + out;
    big >>= 6n;
  }
  return B64[B64.indexOf(out[0]!) % 4]! + out.slice(1);
}

const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`)}'`;
const real = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  const t = String(r === 0 ? 0 : r);
  return t.includes('.') || t.includes('e') ? t : `${t}.`;
};

/** Triangles in IFC coordinates (building frame → IFC: (x, y, z) → (x, −z, y)). */
interface Tris {
  pos: number[];
  idx: number[];
}

const PART_CLASS: Record<string, string> = {
  windows: 'IFCWINDOW',
  doors: 'IFCDOOR',
  gates: 'IFCDOOR',
  stairs: 'IFCSTAIR',
  railings: 'IFCRAILING',
  balconies: 'IFCSLAB',
  furniture: 'IFCFURNITURE',
  structure: 'IFCCOLUMN',
};

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  const n = m ? parseInt(m[1]!, 16) : 0xbbbbbb;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function exportIFC(p: Project3, t: (s: string) => string = (x) => x): string {
  const lines: string[] = [];
  let n = 0;
  const add = (body: string): number => {
    n++;
    lines.push(`#${n}=${body};`);
    return n;
  };
  const ref = (i: number) => `#${i}`;
  const list = (xs: number[]) => `(${xs.map(ref).join(',')})`;
  // Shared resources.
  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const axis = add(`IFCAXIS2PLACEMENT3D(${ref(origin)},$,$)`);
  const ctx = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(axis)},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ref(ctx)},$,.MODEL_VIEW.,$)`);
  const units = [add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'), add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)'), add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)'), add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')];
  const unitAssign = add(`IFCUNITASSIGNMENT(${list(units)})`);
  const project = add(`IFCPROJECT(${str(ifcGuid('project' + p.name))},$,${str(p.name)},$,$,$,$,(${ref(ctx)}),${ref(unitAssign)})`);
  const sitePlace = add(`IFCLOCALPLACEMENT($,${ref(axis)})`);
  const site = add(`IFCSITE(${str(ifcGuid('site' + p.name))},$,'Site',$,$,${ref(sitePlace)},$,$,.ELEMENT.,$,$,$,$,$)`);
  add(`IFCRELAGGREGATES(${str(ifcGuid('agg-site'))},$,$,$,${ref(project)},(${ref(site)}))`);
  const styles = new Map<string, number>();
  const styleOf = (colour: string): number => {
    const k = colour.toLowerCase();
    const hit = styles.get(k);
    if (hit) return hit;
    const [r, g, b] = hex(k);
    const rgb = add(`IFCCOLOURRGB($,${real(r)},${real(g)},${real(b)})`);
    const rend = add(`IFCSURFACESTYLERENDERING(${ref(rgb)},0.,$,$,$,$,$,$,.NOTDEFINED.)`);
    const st = add(`IFCSURFACESTYLE($,.BOTH.,(${ref(rend)}))`);
    styles.set(k, st);
    return st;
  };
  /** A placed product with its tessellated body; returns its id (or null when it has no triangles). */
  const product = (cls: string, guidSeed: string, name: string, place: number, t: Tris, colour: string, extra = ''): number | null => {
    if (!t.idx.length) return null;
    const pts = [];
    for (let i = 0; i < t.pos.length; i += 3) pts.push(`(${real(t.pos[i]!)},${real(t.pos[i + 1]!)},${real(t.pos[i + 2]!)})`);
    const pl = add(`IFCCARTESIANPOINTLIST3D((${pts.join(',')}))`);
    const tri = [];
    for (let i = 0; i < t.idx.length; i += 3) tri.push(`(${t.idx[i]! + 1},${t.idx[i + 1]! + 1},${t.idx[i + 2]! + 1})`);
    const fs = add(`IFCTRIANGULATEDFACESET(${ref(pl)},$,$,(${tri.join(',')}),$)`);
    add(`IFCSTYLEDITEM(${ref(fs)},(${ref(styleOf(colour))}),$)`);
    const rep = add(`IFCSHAPEREPRESENTATION(${ref(body)},'Body','Tessellation',(${ref(fs)}))`);
    const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`);
    return add(`${cls}(${str(ifcGuid(guidSeed))},$,${str(name.slice(0, 100))},$,$,${ref(place)},${ref(shape)},$${extra})`);
  };
  // IFC entity tails after Tag: IfcWall/IfcSlab/IfcRoof… take a PredefinedType; windows and doors their size.
  const tail = (cls: string): string =>
    cls === 'IFCWINDOW' || cls === 'IFCDOOR' ? ',$,$,.NOTDEFINED.,$,$' : cls === 'IFCBUILDINGELEMENTPROXY' || cls === 'IFCFURNITURE' || cls === 'IFCSTAIR' || cls === 'IFCRAILING' || cls === 'IFCCOLUMN' || cls === 'IFCWALL' || cls === 'IFCROOF' ? ',.NOTDEFINED.' : cls === 'IFCSLAB' ? ',.NOTDEFINED.' : '';

  const buildings: number[] = [];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    let ev;
    try {
      ev = evaluateBuilding(b, { hidden: () => false }, p);
    } catch {
      continue;
    }
    // Building placement: its position and turn (about the IFC Z), its base elevation.
    const a = (b.rotation * Math.PI) / 180;
    const bp = add(`IFCCARTESIANPOINT((${real(b.position[0])},${real(-b.position[1])},${real(b.elevation ?? 0)}))`);
    const dirX = add(`IFCDIRECTION((${real(Math.cos(a))},${real(Math.sin(a))},0.))`);
    const dirZ = add('IFCDIRECTION((0.,0.,1.))');
    const bAxis = add(`IFCAXIS2PLACEMENT3D(${ref(bp)},${ref(dirZ)},${ref(dirX)})`);
    const bPlace = add(`IFCLOCALPLACEMENT(${ref(sitePlace)},${ref(bAxis)})`);
    const bld = add(`IFCBUILDING(${str(ifcGuid('b' + b.id))},$,${str(b.name)},$,$,${ref(bPlace)},$,$,.ELEMENT.,$,$,$)`);
    buildings.push(bld);
    const levels = [...b.levels].sort((x, y) => x.elevation - y.elevation);
    const storeys = levels.map((l) => {
      const lp = add(`IFCCARTESIANPOINT((0.,0.,${real(l.elevation)}))`);
      const la = add(`IFCAXIS2PLACEMENT3D(${ref(lp)},$,$)`);
      const place = add(`IFCLOCALPLACEMENT(${ref(bPlace)},${ref(la)})`);
      return { id: add(`IFCBUILDINGSTOREY(${str(ifcGuid('s' + l.id))},$,${str(t(l.name))},$,$,${ref(place)},$,$,.ELEMENT.,${real(l.elevation)})`), elevation: l.elevation, height: l.height, place, items: [] as number[] };
    });
    if (!storeys.length) continue;
    add(`IFCRELAGGREGATES(${str(ifcGuid('agg-b' + b.id))},$,$,$,${ref(bld)},${list(storeys.map((s) => s.id))})`);
    // Rooms: each piece of free floor of the plan (eval/floorplan.ts), from the slab to the ceiling.
    storeys.forEach((st, li) => {
      const lid = levels[li]!.id;
      let fp;
      try {
        fp = floorPlan(b, li, ev.placements);
      } catch {
        return;
      }
      const spaces: number[] = [];
      fp.rooms.forEach((r, ri) => {
        const loops = r.rings.filter((ring) => ring.length >= 3);
        if (!loops.length) return;
        const curve = (ring: (typeof loops)[number]) => {
          const pts = [...ring, ring[0]!].map((q) => add(`IFCCARTESIANPOINT((${real(q[0])},${real(-q[1])}))`));
          return add(`IFCPOLYLINE(${list(pts)})`);
        };
        // The outer ring is the largest; the others are holes in it.
        const area = (ring: (typeof loops)[number]) => Math.abs(ring.reduce((sum, q, i) => sum + q[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * q[1], 0)) / 2;
        const sorted = [...loops].sort((x, y) => area(y) - area(x));
        const outer = curve(sorted[0]!);
        const prof = sorted.length > 1 ? add(`IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,$,${ref(outer)},${list(sorted.slice(1).map(curve))})`) : add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${ref(outer)})`);
        const h = Math.max(0.1, st.height - SLAB);
        const at = add(`IFCAXIS2PLACEMENT3D(${ref(add(`IFCCARTESIANPOINT((0.,0.,${real(SLAB)}))`))},$,$)`);
        const solid = add(`IFCEXTRUDEDAREASOLID(${ref(prof)},${ref(at)},${ref(add('IFCDIRECTION((0.,0.,1.))'))},${real(h)})`);
        const rep = add(`IFCSHAPEREPRESENTATION(${ref(body)},'Body','SweptSolid',(${ref(solid)}))`);
        const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(rep)}))`);
        const place = add(`IFCLOCALPLACEMENT(${ref(st.place)},${ref(axis)})`);
        const name = r.name || `${fp.level} ${ri + 1}`;
        const sp = add(`IFCSPACE(${str(ifcGuid(`space|${b.id}|${lid}|${r.id ?? ri}`))},$,${str(String(ri + 1))},$,$,${ref(place)},${ref(shape)},${str(name.slice(0, 100))},.ELEMENT.,.INTERNAL.,$)`);
        const q = [add(`IFCQUANTITYAREA('NetFloorArea',$,$,${real(r.area)},$)`), add(`IFCQUANTITYLENGTH('Height',$,$,${real(h)},$)`)];
        const qto = add(`IFCELEMENTQUANTITY(${str(ifcGuid(`qto|${b.id}|${lid}|${r.id ?? ri}`))},$,'Qto_SpaceBaseQuantities',$,$,${list(q)})`);
        add(`IFCRELDEFINESBYPROPERTIES(${str(ifcGuid(`qrel|${b.id}|${lid}|${r.id ?? ri}`))},$,$,$,(${ref(sp)}),${ref(qto)})`);
        spaces.push(sp);
      });
      if (spaces.length) add(`IFCRELAGGREGATES(${str(ifcGuid(`agg-sp|${b.id}|${lid}`))},$,$,$,${ref(st.id)},${list(spaces)})`);
    });
    const storeyAt = (y: number) => [...storeys].reverse().find((s) => s.elevation <= y + 0.05) ?? storeys[0]!;
    // The shell, by element class and volume: triangles in the building frame, then to IFC (Z up), with
    // the storey's elevation taken off (its placement holds it).
    const groups = new Map<string, { cls: string; solid: string; tris: Tris; minY: number }>();
    const sh = ev.shell;
    const vmap = new Map<string, Map<number, number>>();
    for (let t = 0; t < sh.indices.length / 3; t++) {
      const f = ev.faces[sh.faceOf[t]!];
      if (!f || /^room|^cut|^cutter|^roofCut/.test(f.kind)) continue;
      const cls = f.kind === 'roof' || f.kind === 'gable' || f.kind === 'fascia' || f.kind === 'soffit' || f.kind === 'glazing' ? 'IFCROOF' : f.kind === 'top' || f.kind === 'bottom' || f.kind === 'floor' || f.kind === 'ceiling' ? 'IFCSLAB' : 'IFCWALL';
      // One IfcWall per side of a volume (Revit and ArchiCAD walls are per side), slabs and roofs per volume.
      const key = cls === 'IFCWALL' && f.edge ? `${cls}|${f.solid}|${f.edge.replace(/:c$/, '')}` : `${cls}|${f.solid}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { cls, solid: f.solid, tris: { pos: [], idx: [] }, minY: Infinity }));
      let vm = vmap.get(key);
      if (!vm) vmap.set(key, (vm = new Map()));
      for (let j = 0; j < 3; j++) {
        const v = sh.indices[t * 3 + j]!;
        let k = vm.get(v);
        if (k === undefined) {
          k = g.tris.pos.length / 3;
          vm.set(v, k);
          const x = sh.positions[v * 3]!,
            y = sh.positions[v * 3 + 1]!,
            z = sh.positions[v * 3 + 2]!;
          g.tris.pos.push(x, -z, y);
          g.minY = Math.min(g.minY, y);
        }
        g.tris.idx.push(k);
      }
    }
    const solidOf = (id: string): Solid | undefined => b.solids.find((s) => s.id === id || id.startsWith(s.id + '~'));
    const names: Record<string, string> = { IFCWALL: t('Wall'), IFCSLAB: t('Slab'), IFCROOF: t('Roof') };
    for (const [key, g] of groups) {
      const s = solidOf(g.solid);
      const st = storeyAt(g.minY);
      // Storey-relative: take its elevation off the Z of every point.
      for (let i = 2; i < g.tris.pos.length; i += 3) g.tris.pos[i]! -= st.elevation;
      const colour = g.cls === 'IFCROOF' ? s?.materials.roof.color : g.cls === 'IFCSLAB' ? s?.materials.base.color : s?.materials.wall.color;
      const id = product(g.cls, key + b.id, `${s?.name ?? 'Volume'} · ${names[g.cls]}`, st.place, g.tris, colour ?? '#cccccc', tail(g.cls));
      if (id) st.items.push(id);
    }
    // Interior walls (drawn in the plan; built apart from the shell): one IfcWall per floor.
    const iwTable = new FaceTable();
    const iw = interiorWallMeshes(b, iwTable);
    if (iw) {
      const per = new Map<string, Tris>();
      for (let t = 0; t < iw.tri.length / 3; t++) {
        const f = iwTable.faces[iw.face[t]!];
        if (!f || f.kind !== 'innerWall') continue;
        const lid = f.solid.slice('interior:'.length);
        let g = per.get(lid);
        if (!g) per.set(lid, (g = { pos: [], idx: [] }));
        for (let j = 0; j < 3; j++) {
          const v = iw.tri[t * 3 + j]!;
          g.idx.push(g.pos.length / 3);
          g.pos.push(iw.pos[v * 3]!, -iw.pos[v * 3 + 2]!, iw.pos[v * 3 + 1]!);
        }
      }
      for (const [lid, g] of per) {
        const li = levels.findIndex((l) => l.id === lid);
        const st = storeys[li];
        if (!st) continue;
        for (let i = 2; i < g.pos.length; i += 3) g.pos[i]! -= st.elevation;
        const id = product('IFCWALL', `interior|${b.id}|${lid}`, 'Interior walls', st.place, g, '#efe9de', tail('IFCWALL'));
        if (id) st.items.push(id);
      }
    }
    // Doors of the interior walls (openings in the plan): an IfcDoor each, its leaf in the opening.
    levels.forEach((lv, li) => {
      const it = b.interiors[lv.id];
      const st = storeys[li];
      if (!it || !st) return;
      const node = new Map(it.nodes.map((n) => [n.id, n.p]));
      interiorDoors(it).forEach((d, di) => {
        const w = it.walls.find((x) => x.id === d.wall);
        const A = w && node.get(w.a),
          C = w && node.get(w.b);
        if (!w || !A || !C) return;
        const L = Math.hypot(C[0] - A[0], C[1] - A[1]) || 1;
        const ux = (C[0] - A[0]) / L,
          uz = (C[1] - A[1]) / L;
        const nx = -uz,
          nz = ux;
        const tk = 0.04;
        const corner = (along: number, across: number, y: number): [number, number, number] => {
          const x = A[0] + ux * along + nx * across,
            z = A[1] + uz * along + nz * across;
          return [x, -z, y];
        };
        const a0 = d.u - d.width / 2,
          a1 = d.u + d.width / 2;
        const v: [number, number, number][] = [];
        for (const y of [0, d.height]) for (const c of [-tk / 2, tk / 2]) for (const al of [a0, a1]) v.push(corner(al, c, y));
        const q = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
        const id = product('IFCDOOR', `idoor|${b.id}|${lv.id}|${di}`, t('Door'), st.place, { pos: v.flat(), idx: q }, '#b08d62', tail('IFCDOOR'));
        if (id) st.items.push(id);
      });
    });
    // Components: one product per tag (a window, a door, a bench), from its instances and meshes.
    const parts = ev.parts;
    const byTag = new Map<number, { tris: Tris; colour: string; minY: number }>();
    const grab = (tag: number, colour: string) => {
      let g = byTag.get(tag);
      if (!g) byTag.set(tag, (g = { tris: { pos: [], idx: [] }, colour, minY: Infinity }));
      return g;
    };
    const prims = new Map<string, number[]>();
    for (const it of parts.inst) {
      const g = grab(it.tag, it.mat.color);
      let tri = prims.get(it.shape);
      if (!tri) prims.set(it.shape, (tri = primitiveTris(it.shape)));
      for (let i = 0; i < tri.length; i += 3) {
        const q = apply(it.m as M4, [tri[i]!, tri[i + 1]!, tri[i + 2]!]);
        g.tris.idx.push(g.tris.pos.length / 3);
        g.tris.pos.push(q[0], -q[2], q[1]);
        g.minY = Math.min(g.minY, q[1]);
      }
    }
    for (const m of parts.meshes) {
      const g = grab(m.tag, m.mat.color);
      for (let i = 0; i < m.positions.length; i += 3) {
        g.tris.idx.push(g.tris.pos.length / 3);
        g.tris.pos.push(m.positions[i]!, -m.positions[i + 2]!, m.positions[i + 1]!);
        g.minY = Math.min(g.minY, m.positions[i + 1]!);
      }
    }
    for (const [tag, g] of byTag) {
      const pt = parts.tags[tag];
      const fam = pt ? familyOf(pt.family) : undefined;
      const cls = (fam && PART_CLASS[fam.category]) ?? 'IFCBUILDINGELEMENTPROXY';
      const st = storeyAt(g.minY);
      for (let i = 2; i < g.tris.pos.length; i += 3) g.tris.pos[i]! -= st.elevation;
      const id = product(cls, `${b.id}|${tag}|${pt?.item ?? ''}|${pt?.rule ?? ''}|${pt?.key ?? ''}`, fam?.name ?? 'Component', st.place, g.tris, g.colour, tail(cls));
      if (id) st.items.push(id);
    }
    for (const st of storeys) if (st.items.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${str(ifcGuid('c' + st.id + b.id))},$,$,$,${list(st.items)},${ref(st.id)})`);
  }
  if (buildings.length) add(`IFCRELAGGREGATES(${str(ifcGuid('agg-buildings'))},$,$,$,${ref(site)},${list(buildings)})`);
  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${str(p.name + '.ifc')},${str(stamp)},(''),(''),'${BRAND}','${BRAND}','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

