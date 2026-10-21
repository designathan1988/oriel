// forma/2 schema validation: types, ranges and reference integrity.
// Throws an Error with a readable message at the first inconsistency.
import { validateStylePack, type StylePack } from '../styles/schema';
import type { Building, Limits, Lot, Mass, Project, Ring } from './schema';
import { DEFAULT_LIMITS, SCHEMA } from './schema';
import { validPolygon, type PolygonLimits } from '../geometry/polygon';
import { validHoles } from '../geometry/boolean';
import { massEdges } from '../geometry/ring';

const COLOR = /^#[0-9a-f]{6}$/i;
const ROOFS = ['flat', 'shed', 'gable', 'dome', 'hip', 'mansard'];
const PATTERNS = ['regular', 'storefront', 'curtain', 'blank', 'arched'];
const FILLS = ['window', 'door', 'void', 'storefront'];

class Check {
  constructor(private where: string) {}
  fail(msg: string): never {
    throw new Error(`${this.where}: ${msg}`);
  }
  str(v: unknown, name: string, max = 200): string {
    if (typeof v !== 'string' || !v.length || v.length > max) this.fail(`Invalid ${name}.`);
    return v;
  }
  num(v: unknown, name: string, min: number, max: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) this.fail(`${name} out of range (${min} to ${max}).`);
    return v;
  }
  bool(v: unknown, name: string): boolean {
    if (typeof v !== 'boolean') this.fail(`${name} must be true or false.`);
    return v;
  }
  color(v: unknown, name: string): string {
    if (typeof v !== 'string' || !COLOR.test(v)) this.fail(`${name}: invalid color.`);
    return v;
  }
  oneOf(v: unknown, name: string, options: string[]): string {
    if (typeof v !== 'string' || !options.includes(v)) this.fail(`Invalid ${name}.`);
    return v;
  }
  arr(v: unknown, name: string, max: number): unknown[] {
    if (!Array.isArray(v) || v.length > max) this.fail(`${name} invalid or more than ${max} items.`);
    return v;
  }
}

function polyLimits(l: Limits): PolygonLimits {
  return { maxVertices: l.maxVertices, extent: l.worldExtent, minArea: 0.12, minEdge: 0.02 };
}

function checkRing(c: Check, r: unknown, name: string, ids: Set<string>, l: Limits): Ring {
  const ring = r as Ring;
  if (!ring || !Array.isArray(ring.vertices)) c.fail(`${name} without vertices.`);
  for (const v of ring.vertices) {
    c.str(v?.id, `Vertex ID in ${name}`);
    if (ids.has(v.id)) c.fail(`Repeated vertex ID in ${name}.`);
    ids.add(v.id);
  }
  if (!validPolygon(ring.vertices.map((v) => v.p), polyLimits(l))) c.fail(`${name} self-intersects, is too small or has invalid coordinates.`);
  return ring;
}

function checkMass(c: Check, m: Mass, storeyIds: Set<string>, l: Limits): void {
  c.str(m.id, 'Mass ID');
  c.str(m.name, 'Mass name', 60);
  if (m.style !== undefined) c.str(m.style, 'Mass style', 60);
  const vids = new Set<string>();
  checkRing(c, m.outer, 'Base', vids, l);
  c.arr(m.holes, 'Courtyards', l.maxHoles).forEach((h, i) => checkRing(c, h, `Courtyard ${i + 1}`, vids, l));
  if (!validHoles(m.outer.vertices.map((v) => v.p), m.holes.map((h) => h.vertices.map((v) => v.p)), polyLimits(l))) c.fail('Courtyard outside the base or overlapping.');
  if (!storeyIds.has(m.fromStorey) || !storeyIds.has(m.toStorey)) c.fail('Mass points to a missing storey.');
  c.oneOf(m.roof?.kind, 'Roof kind', ROOFS);
  c.num(m.roof.height, 'Roof height', 0.2, 10);
  c.color(m.roof.color, 'Roof color');
  if (m.roof.direction !== undefined) c.num(m.roof.direction, 'Ridge direction', -360, 360);
  if (m.roof.overhang !== undefined) c.num(m.roof.overhang, 'Overhang', 0, 1.5);
  c.oneOf(m.facade?.pattern, 'Facade distribution', PATTERNS);
  c.num(m.facade.windowWidth, 'Window width', 0.25, 5);
  c.num(m.facade.windowHeight, 'Window height', 0.3, 4);
  c.num(m.facade.spacing, 'Window interval', 1, 8);
  c.color(m.finish?.wall, 'Wall color');
  c.color(m.finish.trim, 'Frame color');
  for (const k of ['balconies', 'brise', 'cornice', 'garden', 'pilotis'] as const) c.bool(m.flags?.[k], `Detail ${k}`);
  if (!m.edges || typeof m.edges !== 'object') c.fail('Invalid facade overrides.');
  for (const [id, o] of Object.entries(m.edges)) {
    if (!vids.has(id)) c.fail('Facade override points to a missing edge.');
    if (o.pattern !== undefined) c.oneOf(o.pattern, 'Face distribution', PATTERNS);
    if (o.wall !== undefined) c.color(o.wall, 'Face color');
    if (o.trim !== undefined) c.color(o.trim, 'Face frame');
    if (o.windowWidth !== undefined) c.num(o.windowWidth, 'Face window width', 0.25, 5);
    if (o.windowHeight !== undefined) c.num(o.windowHeight, 'Face window height', 0.3, 4);
    if (o.spacing !== undefined) c.num(o.spacing, 'Face interval', 1, 8);
  }
}

function checkBuilding(b: Building, lotIds: Set<string>, l: Limits): void {
  const c = new Check(`Building "${typeof b?.name === 'string' ? b.name : '?'}"`);
  c.str(b.id, 'ID');
  c.str(b.name, 'Name', 60);
  if (b.lotId !== null && !lotIds.has(b.lotId)) c.fail('Missing lot.');
  if (!Array.isArray(b.position) || b.position.length !== 2) c.fail('Invalid position.');
  c.num(b.position[0], 'Position x', -l.worldExtent, l.worldExtent);
  c.num(b.position[1], 'Position z', -l.worldExtent, l.worldExtent);
  c.num(b.rotation, 'Rotation', -3600, 3600);
  if (b.styleRef !== undefined) c.str(b.styleRef, 'Style', 60);
  const storeys = c.arr(b.storeys, 'Floors', l.maxStoreys) as Building['storeys'];
  if (!storeys.length) c.fail('Building without storeys.');
  const storeyIds = new Set<string>();
  for (const s of storeys) {
    c.str(s.id, 'Storey ID');
    if (storeyIds.has(s.id)) c.fail('Repeated storey ID.');
    storeyIds.add(s.id);
    c.str(s.name, 'Storey name', 60);
    c.num(s.elevation, 'Storey elevation', 0, l.maxHeight);
    c.num(s.height, 'Storey height', 0.3, l.maxHeight);
    if (s.elevation + s.height > l.maxHeight + 1e-6) c.fail(`Storey above ${l.maxHeight} m.`);
    c.num(s.slabThickness, 'Slab thickness', 0, 2);
    const nodes = new Set((c.arr(s.graph?.nodes, 'Nodes', 5000) as { id: string }[]).map((n) => n.id));
    for (const w of c.arr(s.graph.walls, 'Walls', 5000) as Building['storeys'][number]['graph']['walls']) {
      if (!nodes.has(w.a) || !nodes.has(w.b)) c.fail('Wall points to a missing node.');
      c.num(w.thickness, 'Wall thickness', 0.02, 2);
    }
    c.arr(s.rooms, 'Rooms', 2000);
  }
  const edgeIds = new Map<string, Set<string>>();
  for (const m of c.arr(b.masses, 'Masses', 200) as Mass[]) {
    checkMass(c, m, storeyIds, l);
    edgeIds.set(m.id, new Set(massEdges(m).map((e) => e.id)));
  }
  const perEdge = new Map<string, number>();
  for (const o of c.arr(b.openings, 'Openings', 20000) as Building['openings']) {
    c.str(o.id, 'Opening ID');
    if (!storeyIds.has(o.storeyId)) c.fail('Opening on a missing storey.');
    if (o.host?.kind === 'massEdge') {
      if (!edgeIds.get(o.host.massId)?.has(o.host.edgeId)) c.fail('Opening on a missing wall.');
      const key = o.host.massId + '/' + o.host.edgeId;
      perEdge.set(key, (perEdge.get(key) ?? 0) + 1);
      if (perEdge.get(key)! > l.maxOpeningsPerEdge) c.fail(`More than ${l.maxOpeningsPerEdge} openings on a wall.`);
    } else if (o.host?.kind === 'wall') {
      const host = o.host;
      const st = storeys.find((s) => s.id === host.storeyId);
      if (!st || !st.graph.walls.some((w) => w.id === host.wallId)) c.fail('Interior door on a missing wall.');
    } else c.fail('Opening without a wall.');
    c.num(o.offset, 'Opening position', 0, 1000);
    c.num(o.sill, 'Sill', 0, l.maxHeight);
    c.num(o.width, 'Opening width', 0.25, 8);
    c.num(o.height, 'Opening height', 0.3, 8);
    c.oneOf(o.fill?.type, 'Opening kind', FILLS);
  }
  c.arr(b.slabs, 'Slabs', 1000);
  for (const st of c.arr(b.stairs, 'Stairs', 200) as Building['stairs']) {
    if (!storeyIds.has(st.fromStorey) || !storeyIds.has(st.toStorey)) c.fail('Stair points to a missing storey.');
    c.num(st.width, 'Stair width', 0.5, 10);
  }
}

function checkLot(lot: Lot, l: Limits): void {
  const c = new Check(`Lot "${typeof lot?.name === 'string' ? lot.name : '?'}"`);
  c.str(lot.id, 'ID');
  c.str(lot.name, 'Name', 60);
  if (!validPolygon(lot.polygon, polyLimits(l))) c.fail('Invalid lot polygon.');
  for (const i of c.arr(lot.frontEdges, 'Frontage', lot.polygon.length) as number[])
    if (!Number.isInteger(i) || i < 0 || i >= lot.polygon.length) c.fail('Frontage points to a missing edge.');
  if (lot.rules) {
    const r = lot.rules;
    c.oneOf(r.enforcement, 'Rule mode', ['block', 'warn']);
    for (const k of ['front', 'side', 'back'] as const) c.num(r.setbacks?.[k], `Setback ${k}`, 0, 100);
    if (r.maxOccupancy !== undefined) c.num(r.maxOccupancy, 'Lot coverage', 0, 1);
    if (r.minPermeability !== undefined) c.num(r.minPermeability, 'Permeability ratio', 0, 1);
    if (r.maxFAR !== undefined) c.num(r.maxFAR, 'Floor area ratio', 0, 100);
    if (r.maxHeight !== undefined) c.num(r.maxHeight, 'Height limit', 0, 1000);
    if (r.maxStoreys !== undefined) c.num(r.maxStoreys, 'Maximum storeys', 1, 1000);
    if (r.heightTo !== undefined) c.oneOf(r.heightTo, 'Height limit measurement', ['eave', 'ridge']);
  }
}

/** Validates a forma/2 project and returns a copy. */
export function validateProject(raw: unknown, limits: Partial<Limits> = {}): Project {
  const l = { ...DEFAULT_LIMITS, ...limits };
  const p = raw as Project;
  if (!p || p.schema !== SCHEMA) throw new Error('Project incompatible with FORMA 2.');
  const c = new Check('Project');
  c.str(p.name, 'Project name', 70);
  const lots = c.arr(p.lots, 'Lots', 500) as Lot[];
  const lotIds = new Set<string>();
  for (const lot of lots) {
    checkLot(lot, l);
    if (lotIds.has(lot.id)) c.fail('Repeated lot ID.');
    lotIds.add(lot.id);
  }
  const buildings = c.arr(p.buildings, 'Buildings', l.maxBuildings) as Building[];
  const ids = new Set<string>();
  for (const b of buildings) {
    checkBuilding(b, lotIds, l);
    if (ids.has(b.id)) c.fail('Repeated building ID.');
    ids.add(b.id);
  }
  const styles = c.arr(p.styles, 'Styles', 200) as StylePack[];
  for (const st of styles) for (const e of validateStylePack(st).slice(0, 3)) c.fail(`Style "${String(st?.name ?? st?.id)}": ${e}`);
  return structuredClone(p);
}
