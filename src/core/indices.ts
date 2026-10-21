// Zoning indices of a lot and rule violations (without three.js).
import type { Building, ID, Lot, LotRules, Project } from './schema';
import { massExtent } from './model';
import { area } from '../geometry/polygon';
import { ringPoints } from '../geometry/ring';
import { ringToWorld } from '../geometry/frame';
import { buildableArea, lotArea, lotPolygon } from '../geometry/lot';
import { difference, intersection, netArea, union, type PolygonWithHoles } from '../geometry/boolean';

export type ViolationKind = 'setback' | 'outside' | 'occupancy' | 'far' | 'height' | 'storeys' | 'permeability';

export interface Violation {
  lotId: ID;
  kind: ViolationKind;
  message: string;
  value: number;
  limit: number;
  buildingIds: ID[];
}

export interface LotIndices {
  lotId: ID;
  lotArea: number;
  /** Footprint of all masses on the lot (m²). */
  occupiedArea: number;
  /** Lot coverage (0..1). */
  occupancy: number;
  /** Built area: base of each mass × storeys (m²). */
  builtArea: number;
  /** Floor area ratio. */
  far: number;
  /** Maximum height measured by the rule (ridge or eave). */
  height: number;
  storeys: number;
  /** Permeability ratio (0..1): lot free of construction. */
  permeability: number;
  buildable: PolygonWithHoles[];
  buildingIds: ID[];
  violations: Violation[];
}

const fmt = (n: number, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => fmt(n * 100, 0) + '%';

/** Mass outlines in the world. */
export function buildingFootprints(b: Building): PolygonWithHoles[] {
  return b.masses.map((m) => [ringToWorld(b, ringPoints(m.outer)), ...m.holes.map((h) => ringToWorld(b, ringPoints(h)))]);
}

/** Building height up to the eave (wall top) or up to the ridge. */
export function buildingHeight(b: Building, to: 'eave' | 'ridge' = 'ridge'): number {
  let h = 0;
  for (const m of b.masses) {
    const { base, height } = massExtent(b, m);
    let top = base + height;
    if (to === 'ridge') top += m.roof.kind === 'flat' ? 0.66 : 0.18 + m.roof.height;
    h = Math.max(h, top);
  }
  return h;
}

export function computeLotIndices(project: Project, lot: Lot, rules: LotRules | undefined = lot.rules): LotIndices {
  const buildings = project.buildings.filter((b) => b.lotId === lot.id);
  const lotPoly: PolygonWithHoles = [lotPolygon(lot)];
  const la = lotArea(lot);
  const prints = buildings.flatMap(buildingFootprints);
  const merged = prints.length ? union(prints) : [];
  const inside = merged.flatMap((p) => intersection(p, lotPoly));
  const occupiedArea = inside.reduce((s, p) => s + netArea(p), 0);
  let builtArea = 0,
    storeys = 0;
  for (const b of buildings)
    for (const m of b.masses) {
      const { storeys: st } = massExtent(b, m);
      builtArea += (area(ringPoints(m.outer)) - m.holes.reduce((s, h) => s + area(ringPoints(h)), 0)) * st.length;
      storeys = Math.max(storeys, b.storeys.length);
    }
  const height = buildings.reduce((h, b) => Math.max(h, buildingHeight(b, rules?.heightTo ?? 'ridge')), 0);
  const buildable = buildableArea(lot, rules);
  const res: LotIndices = {
    lotId: lot.id,
    lotArea: la,
    occupiedArea,
    occupancy: la ? occupiedArea / la : 0,
    builtArea,
    far: la ? builtArea / la : 0,
    height,
    storeys,
    permeability: la ? Math.max(0, la - occupiedArea) / la : 1,
    buildable,
    buildingIds: buildings.map((b) => b.id),
    violations: [],
  };
  if (!rules) return res;
  const v = (kind: ViolationKind, message: string, value: number, limit: number, ids = res.buildingIds) =>
    res.violations.push({ lotId: lot.id, kind, message, value, limit, buildingIds: ids });

  for (const b of buildings) {
    for (const fp of buildingFootprints(b)) {
      const outside = difference(fp, lotPoly[0]!).reduce((s, p) => s + netArea(p), 0);
      if (outside > 0.05) {
        v('outside', `“${b.name}” crosses the lot boundary.`, outside, 0, [b.id]);
        continue;
      }
      // Part of the base outside the buildable area = encroaches on the setback.
      let rest: PolygonWithHoles[] = [fp];
      for (const part of buildable) {
        const next: PolygonWithHoles[] = [];
        for (const r of rest) {
          next.push(...difference(r, part[0]!));
          for (const h of part.slice(1)) next.push(...intersection(r, [h]));
        }
        rest = next;
      }
      const invade = rest.reduce((s, p) => s + netArea(p), 0);
      if (invade > 0.05) v('setback', `“${b.name}” encroaches on the setback (${fmt(invade)} m²).`, invade, 0, [b.id]);
    }
  }
  if (rules.maxOccupancy !== undefined && res.occupancy > rules.maxOccupancy + 1e-6)
    v('occupancy', `Lot coverage ${pct(res.occupancy)} above the maximum of ${pct(rules.maxOccupancy)}.`, res.occupancy, rules.maxOccupancy);
  if (rules.maxFAR !== undefined && res.far > rules.maxFAR + 1e-6)
    v('far', `Floor area ratio ${fmt(res.far, 2)} above the maximum of ${fmt(rules.maxFAR, 2)}.`, res.far, rules.maxFAR);
  if (rules.maxHeight !== undefined && res.height > rules.maxHeight + 1e-6)
    v('height', `Height ${fmt(res.height)} m above the height limit of ${fmt(rules.maxHeight)} m.`, res.height, rules.maxHeight);
  if (rules.maxStoreys !== undefined && res.storeys > rules.maxStoreys)
    v('storeys', `${res.storeys} storeys, above the maximum of ${rules.maxStoreys}.`, res.storeys, rules.maxStoreys);
  if (rules.minPermeability !== undefined && res.permeability < rules.minPermeability - 1e-6)
    v('permeability', `Permeability ${pct(res.permeability)} below the minimum of ${pct(rules.minPermeability)}.`, res.permeability, rules.minPermeability);
  return res;
}

export const DEFAULT_LOT_RULES: LotRules = {
  setbacks: { front: 5, side: 1.5, back: 3 },
  maxOccupancy: 0.6,
  maxFAR: 2.5,
  maxHeight: 30,
  maxStoreys: 10,
  minPermeability: 0.15,
  enforcement: 'warn',
  heightTo: 'ridge',
};
