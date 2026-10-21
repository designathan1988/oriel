import { describe, expect, it } from 'vitest';
import { osmToBuildings, overpassQuery, project2d, type OsmElement } from '../../src/f3/model/osm';
import { validateForma3 } from '../../src/f3/io/migrate';
import { project } from '../../src/f3/model/defaults';

const lat0 = -19.93,
  lon0 = -43.94;
// A 20 × 10 m rectangle (east-west long) around the origin, closed like OSM ways.
const dLat = 10 / 110_574,
  dLon = 20 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const rect = (x0: number, z0: number) => [
  { lat: lat0 - z0 / 110_574, lon: lon0 },
  { lat: lat0 - z0 / 110_574, lon: lon0 + dLon },
  { lat: lat0 - z0 / 110_574 + dLat, lon: lon0 + dLon },
  { lat: lat0 - z0 / 110_574 + dLat, lon: lon0 },
  { lat: lat0 - z0 / 110_574, lon: lon0 },
].map((q) => ({ lat: q.lat, lon: q.lon + x0 / (111_320 * Math.cos((lat0 * Math.PI) / 180)) }));

describe('OpenStreetMap neighbourhood', () => {
  it('asks Overpass for buildings and parts around the place, with their outlines', () => {
    const q = overpassQuery(lat0, lon0, 200);
    expect(q).toContain('[out:json]');
    expect(q).toContain('way["building"](around:200,-19.930000,-43.940000)');
    expect(q).toContain('out geom');
  });

  it('north is −Z and east is +X in the project plane', () => {
    const p = project2d({ lat: lat0 + 1 / 110_574, lon: lon0 }, lat0, lon0);
    expect(p[1]).toBeCloseTo(-1, 6);
    expect(project2d({ lat: lat0, lon: lon0 + 0.0001 }, lat0, lon0)[0]).toBeGreaterThan(0);
  });

  it('heights from height or levels, roofs from roof:shape, parts instead of their building', () => {
    const json: { elements: OsmElement[] } = {
      elements: [
        { type: 'way' as const, id: 1, tags: { building: 'yes', 'building:levels': '4', name: 'Casa' }, geometry: rect(0, 0) },
        { type: 'way' as const, id: 2, tags: { building: 'yes', height: '9', 'roof:shape': 'gabled', 'roof:height': '3' }, geometry: rect(40, 0) },
        { type: 'way' as const, id: 3, tags: { building: 'yes' }, geometry: rect(80, 0) },
        { type: 'way' as const, id: 4, tags: { 'building:part': 'yes', height: '30', min_height: '6' }, geometry: rect(80, 0) },
      ],
    };
    const bs = osmToBuildings(json, lat0, lon0, 'osm');
    expect(bs).toHaveLength(3);
    const casa = bs.find((b) => b.name === 'Casa')!;
    expect(casa.solids[0]!.height).toBeCloseTo(12, 6);
    expect(Math.abs(casa.solids[0]!.plan.outer[1]!.p[0] - casa.solids[0]!.plan.outer[0]!.p[0])).toBeCloseTo(20, 0);
    const gable = bs.find((b) => b.solids[0]!.roof.kind === 'gable')!;
    expect(gable.solids[0]!.height).toBeCloseTo(6, 6);
    const part = bs.find((b) => b.solids[0]!.base === 6)!;
    expect(part.solids[0]!.height).toBeCloseTo(24, 6);
    expect(validateForma3(project({ buildings: bs, layers: [{ id: 'osm', name: 'OpenStreetMap', color: '#888888', visible: true, locked: true }] }))).toEqual([]);
  });
});
