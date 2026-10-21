// The neighbourhood from OpenStreetMap (data © OpenStreetMap contributors, ODbL): the buildings and
// building parts around the project's place, as context buildings on their own layer. The tags of
// Simple 3D Buildings (https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings) map almost one to one:
// height / building:levels (3 m a level), min_height / building:min_level, roof:shape (flat, skillion,
// gabled, hipped, pyramidal, gambrel, mansard, dome, round, sawtooth), roof:height. Coordinates go to the
// project plane by a local projection around the place (metres east and north; north is −Z, as the sun
// takes it). Pure: the query text and the answer parsing; the request is made by the caller.
import type { Building3, RoofKind, Vec2 } from './schema';
import { building, levelsFor, planVertices, roofSpec, solid } from './defaults';
import { signedArea2 } from './plan';

/** Overpass QL: every building and building part (with their outlines) within `radius` m of the place. */
export function overpassQuery(lat: number, lon: number, radius: number): string {
  const a = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:25];(way["building"]${a};way["building:part"]${a};relation["building"]${a};);out geom;`;
}

interface OsmPoint {
  lat: number;
  lon: number;
}
export interface OsmElement {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
  members?: { type: string; role: string; geometry?: OsmPoint[] }[];
}

const ROOFS: Record<string, RoofKind> = {
  flat: 'flat',
  skillion: 'shed',
  lean_to: 'shed',
  gabled: 'gable',
  hipped: 'hip',
  half_hipped: 'hip',
  pyramidal: 'pyramid',
  gambrel: 'gambrel',
  mansard: 'mansard',
  dome: 'dome',
  onion: 'dome',
  round: 'vault',
  saltbox: 'gable',
  sawtooth: 'sawtooth',
};

/** A length tag in metres ("12", "12 m", "12.5"); NaN when it does not read. */
const metres = (v: string | undefined): number => (v === undefined ? NaN : parseFloat(v.replace(',', '.')));

/** The project plane point of a place (local equirectangular projection around the origin). */
export function project2d(p: OsmPoint, lat0: number, lon0: number): Vec2 {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return [(p.lon - lon0) * 111_320 * k, -(p.lat - lat0) * 110_574];
}

/**
 * Context buildings from an Overpass answer (`out geom`). A building with parts keeps only its parts
 * (each part is drawn with its own height and roof, as the S3DB rule says); everything else is a
 * building of one volume. Names from `name` or the street address, else "OSM <id>".
 */
export function osmToBuildings(json: { elements?: OsmElement[] }, lat0: number, lon0: number, layer: string): Building3[] {
  const els = json.elements ?? [];
  const parts = els.filter((e) => e.tags?.['building:part'] && e.type === 'way' && e.geometry?.length);
  const ring = (g: OsmPoint[]): Vec2[] => {
    const pts = g.map((q) => project2d(q, lat0, lon0));
    if (pts.length > 3 && Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![1] - pts[pts.length - 1]![1]) < 0.01) pts.pop();
    return pts;
  };
  // A building outline that contains a part is drawn by its parts.
  const partRings = parts.map((e) => ring(e.geometry!));
  const inside = (q: Vec2, r: Vec2[]) => {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i]![1] > q[1] !== r[j]![1] > q[1] && q[0] < ((r[j]![0] - r[i]![0]) * (q[1] - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) c = !c;
    return c;
  };
  const out: Building3[] = [];
  const make = (outer: Vec2[], holes: Vec2[][], tags: Record<string, string>, id: number) => {
    if (outer.length < 3 || Math.abs(signedArea2(outer)) < 4) return;
    const levels = metres(tags['building:levels']);
    const roofLevels = metres(tags['roof:levels']);
    const roofH = metres(tags['roof:height']);
    let height = metres(tags.height);
    if (!(height > 0)) height = (levels > 0 ? levels : 2) * 3 + (roofH > 0 ? roofH : roofLevels > 0 ? roofLevels * 3 : 0);
    let base = metres(tags.min_height);
    if (!(base >= 0)) base = metres(tags['building:min_level']) > 0 ? metres(tags['building:min_level']) * 3 : 0;
    const kind = ROOFS[tags['roof:shape'] ?? 'flat'] ?? 'flat';
    const rh = kind === 'flat' ? 0 : roofH > 0 ? roofH : Math.min(4, height * 0.3);
    const wall = Math.max(1, height - base - rh);
    const c: Vec2 = [outer.reduce((a, q) => a + q[0], 0) / outer.length, outer.reduce((a, q) => a + q[1], 0) / outer.length];
    const local = (r: Vec2[], sign: number) => {
      const l = r.map((q): Vec2 => [q[0] - c[0], q[1] - c[1]]);
      return Math.sign(signedArea2(l)) === sign ? l : l.reverse();
    };
    const name = (tags.name ?? (tags['addr:street'] ? `${tags['addr:street']} ${tags['addr:housenumber'] ?? ''}`.trim() : `OSM ${id}`)).slice(0, 60);
    const b = building({ name, position: c, layer, use: tags.building === 'commercial' || tags.building === 'retail' ? 'commercial' : tags.building === 'industrial' ? 'industrial' : 'residential' });
    b.levels = levelsFor(Math.max(1, Math.min(60, Math.round(wall / 3))), wall / Math.max(1, Math.round(wall / 3)), wall / Math.max(1, Math.round(wall / 3)));
    const s = solid({ name, plan: { outer: planVertices(local(outer, 1)), holes: holes.map((h) => planVertices(local(h, -1))) }, base, height: wall, roof: roofSpec(kind, kind === 'flat' ? { parapet: 0.3 } : { rise: rh, overhang: 0.2 }) });
    const colour = tags['building:colour'];
    if (colour && /^#[0-9a-f]{6}$/i.test(colour)) s.materials.wall = { ...s.materials.wall, color: colour };
    b.solids = [s];
    out.push(b);
  };
  for (const e of els) {
    const tags = e.tags ?? {};
    if (e.type === 'way' && e.geometry?.length) {
      const r = ring(e.geometry);
      // (Tested at the part's centre: a part sharing its outline with the building has its corners on it.)
      const centre = (q: Vec2[]): Vec2 => [q.reduce((a, v) => a + v[0], 0) / q.length, q.reduce((a, v) => a + v[1], 0) / q.length];
      if (!tags['building:part'] && partRings.some((pr) => pr.length && inside(centre(pr), r))) continue;
      make(r, [], tags, e.id);
    } else if (e.type === 'relation' && e.members) {
      // Closed member ways only (an outline split over several ways is skipped, not guessed).
      const closed = (g?: OsmPoint[]) => !!g && g.length > 3 && g[0]!.lat === g[g.length - 1]!.lat && g[0]!.lon === g[g.length - 1]!.lon;
      const outers = e.members.filter((m) => m.role === 'outer' && closed(m.geometry)).map((m) => ring(m.geometry!));
      const inners = e.members.filter((m) => m.role === 'inner' && closed(m.geometry)).map((m) => ring(m.geometry!));
      for (const o of outers) make(o, inners.filter((h) => h.length && inside(h[0]!, o)), tags, e.id);
    }
  }
  return out;
}
