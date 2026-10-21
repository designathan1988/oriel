// FORMA v2 project schema.
// Units: meters; Y up; plan in [x, z]; angles in degrees.
// All IDs are stable strings (UUID); never derived from coordinates.

import type { StylePack } from '../styles/schema';

export const SCHEMA = 'forma/2' as const;

export type ID = string;
export type Vec2 = [number, number];

export interface Project {
  schema: typeof SCHEMA;
  name: string;
  lots: Lot[];
  buildings: Building[];
  /** The project's own styles (built-in ones need not be here). */
  styles: StylePack[];
  meta: { createdWith: string; migratedFrom?: 1 };
}

// ── Lot ───────────────────────────────────────────────────────────────
export interface Lot {
  id: ID;
  name: string;
  /** Lot polygon in world coordinates, counterclockwise. */
  polygon: Vec2[];
  /** Indices of the edges facing the street (frontage). */
  frontEdges: number[];
  rules?: LotRules;
}

export interface LotRules {
  setbacks: { front: number; side: number; back: number };
  /** Maximum lot coverage (0..1). */
  maxOccupancy?: number;
  /** Maximum floor area ratio. */
  maxFAR?: number;
  /** Height limit in meters. */
  maxHeight?: number;
  maxStoreys?: number;
  /** Minimum permeability ratio (0..1). */
  minPermeability?: number;
  enforcement: 'block' | 'warn';
  /** Height limit measured up to the ridge (default) or up to the eave. */
  heightTo?: 'eave' | 'ridge';
}

// ── Building ──────────────────────────────────────────────────────────
export interface Building {
  id: ID;
  name: string;
  lotId: ID | null;
  /** Building origin in the world [x, z]. */
  position: Vec2;
  /** Rotation in degrees around Y (same convention as v1). */
  rotation: number;
  storeys: Storey[];
  masses: Mass[];
  openings: Opening[];
  slabs: Slab[];
  stairs: Stair[];
  styleRef?: ID;
}

/** Storey. Elevation relative to the building origin (y = 0 on the ground). */
export interface Storey {
  id: ID;
  name: string;
  elevation: number;
  height: number;
  slabThickness: number;
  /** Interior walls (the exterior ones are derived from the masses). */
  graph: WallGraph;
  rooms: Room[];
}

export interface WallGraph {
  nodes: GraphNode[];
  walls: Wall[];
}

export interface GraphNode {
  id: ID;
  p: Vec2;
}

export interface Wall {
  id: ID;
  a: ID;
  b: ID;
  thickness: number;
  height?: number;
  sideA?: Partial<Finish>;
  sideB?: Partial<Finish>;
  splitFrom?: ID;
}

export interface Room {
  id: ID;
  name: string;
  /** Interior walls bounding the room. */
  wallIds: ID[];
  /** Computed outline (building local coordinates). */
  polygon?: Vec2[];
  /** Computed area (m²). */
  area?: number;
}

export interface Slab {
  id: ID;
  storeyId: ID;
  outline: Vec2[];
  cutouts: Vec2[][];
}

export interface Stair {
  id: ID;
  fromStorey: ID;
  toStorey: ID;
  path: Vec2[];
  width: number;
}

// ── Mass (volume extruded between storeys) ────────────────────────────
export interface RingVertex {
  id: ID;
  p: Vec2;
}

/** Polygon ring. An edge ID is the ID of its start vertex. */
export interface Ring {
  vertices: RingVertex[];
}

export type FacadePattern = 'regular' | 'storefront' | 'curtain' | 'blank' | 'arched';
export type RoofKind = 'flat' | 'shed' | 'gable' | 'dome' | 'hip' | 'mansard';

export interface Finish {
  /** Wall color. */
  wall: string;
  /** Frame color. */
  trim: string;
  material?: string;
}

export interface FacadeSpec {
  pattern: FacadePattern;
  windowWidth: number;
  windowHeight: number;
  spacing: number;
}

export interface MassFlags {
  balconies: boolean;
  brise: boolean;
  cornice: boolean;
  garden: boolean;
  pilotis: boolean;
}

export interface Roof {
  kind: RoofKind;
  height: number;
  color: string;
  direction?: number;
  overhang?: number;
}

/** Overrides of a specific edge (facade). */
export interface EdgeOverride {
  pattern?: FacadePattern;
  windowWidth?: number;
  windowHeight?: number;
  spacing?: number;
  wall?: string;
  trim?: string;
  balconies?: boolean;
  brise?: boolean;
  /** true: the drawn openings replace the automatic rhythm. */
  manual?: boolean;
  splitFrom?: ID;
}

export interface Mass {
  id: ID;
  name: string;
  /** Style of this mass (wins over the building style). */
  style?: ID;
  /** Building local coordinates. Counterclockwise outer ring. */
  outer: Ring;
  holes: Ring[];
  fromStorey: ID;
  toStorey: ID;
  roof: Roof;
  facade: FacadeSpec;
  finish: Finish;
  flags: MassFlags;
  edges: Record<ID, EdgeOverride>;
}

// ── Openings (void separate from the filling, as in IFC) ─────────────
export type OpeningHost =
  | { kind: 'massEdge'; massId: ID; edgeId: ID }
  | { kind: 'wall'; storeyId: ID; wallId: ID };

export type OpeningFillType = 'window' | 'door' | 'void' | 'storefront';

export interface Opening {
  id: ID;
  host: OpeningHost;
  storeyId: ID;
  /** Distance in meters from the edge start to the opening center. */
  offset: number;
  /** Sill: height of the opening base above the storey floor. */
  sill: number;
  width: number;
  height: number;
  fill: { type: OpeningFillType; arch?: boolean; module?: string };
}

export interface StyleRef {
  id: ID;
  name: string;
  url?: string;
}

// ── Limits (configurable by the game) ─────────────────────────────────
export interface Limits {
  maxBuildings: number;
  maxStoreys: number;
  maxHeight: number;
  maxVertices: number;
  maxHoles: number;
  maxOpeningsPerEdge: number;
  worldExtent: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxBuildings: 120,
  maxStoreys: 30,
  maxHeight: 100,
  maxVertices: 128,
  maxHoles: 12,
  maxOpeningsPerEdge: 80,
  worldExtent: 500,
};
