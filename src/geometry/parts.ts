// Pure description (without three.js) of a building's parts. The render/
// module turns these parts into meshes: boxes become InstancedMesh per material,
// walls and slabs become ExtrudeGeometry, roofs become BufferGeometry.
import type { ID, Vec2 } from '../core/schema';
import type { TextureKind } from '../styles/schema';

export type Vec3 = [number, number, number];

export type MaterialRole = 'wall' | 'frame' | 'glass' | 'stone' | 'roof' | 'green' | 'cap';

/** Dark cap of cut walls (plan convention). */
export const CAP: MaterialKey = { role: 'cap', color: '#34393b', roughness: 0.9 };

export interface MaterialKey {
  role: MaterialRole;
  color: string;
  roughness: number;
  metalness?: number;
  doubleSide?: boolean;
  /** Real-scale procedural texture (only on walls and meshes with UVs in meters). */
  texture?: TextureKind;
  /** Meters per texture repeat. */
  textureScale?: number;
  /** FORMA 3 finish (picks the procedural generator or the PBR set). */
  finish?: string;
  /** 2nd color and parameters of the procedural finish (stable JSON). */
  color2?: string;
  params?: string;
  /** Project image as a texture (image plates). */
  image?: string;
  /** Lamp: turns on at night. */
  lamp?: boolean;
  /** Curtain: lets the room light through at night. */
  curtain?: boolean;
  /** Leaf cards (FORMA 3 foliage atlas). */
  foliage?: string;
  /** Texture size (× the finish's) and turn (degrees) chosen by the user. */
  uvScale?: number;
  uvRot?: number;
  /** Width (m) of one repeat of the project image `image` tiled over the surface (not a plate). */
  imageTile?: number;
  /** Light given off (emissive strength, in the material colour). */
  glow?: number;
  /** Opacity below 1: see-through. */
  opacity?: number;
}

/** The user's adjustments as text, for the material caches. */
export const extraKey = (k: MaterialKey): string => (k.uvScale || k.uvRot || k.imageTile || k.glow || k.opacity !== undefined ? `|${k.uvScale ?? 1}|${k.uvRot ?? 0}|${k.imageTile ?? 0}|${k.glow ?? 0}|${k.opacity ?? 1}` : '');

/** Selection data attached to each part. */
export interface PartData {
  buildingId: ID;
  massId: ID;
  edgeId?: ID;
  part: string;
  storey?: number;
  storeyId?: ID;
  wallId?: ID;
  openingId?: ID;
  stairId?: ID;
}

export interface BoxPart {
  mat: MaterialKey;
  size: Vec3;
  pos: Vec3;
  /** Rotation around Y (radians). */
  angle: number;
  /** Rotation around Z applied after Y (radians). */
  roll: number;
  data: PartData;
}

export interface WallHole {
  /** Exact horizontal center, width and height (the arch depends on them). */
  center: number;
  width: number;
  height: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
  arch: boolean;
}

/** Wall: a rectangular outline on the edge plane, with openings, extruded by `depth`. */
export interface WallPart {
  mat: MaterialKey;
  /** Origin on the plane [x, y, z] and the edge's Y rotation. */
  origin: Vec3;
  angle: number;
  length: number;
  bottom: number;
  top: number;
  depth: number;
  holes: WallHole[];
  data: PartData;
}

/** Slab: a plan polygon extruded upward from y. */
export interface SlabPart {
  mat: MaterialKey;
  y: number;
  thickness: number;
  outer: Vec2[];
  holes: Vec2[][];
  data: PartData;
}

/** Free mesh (roofs): triangles at positions [x, y, z, ...]. */
export interface MeshPart {
  mat: MaterialKey;
  positions: number[];
  data: PartData;
}

/** A style's glTF module, fitted into a facade box. */
export interface ModulePart {
  url: string;
  /** Target box [width, height, depth]. */
  size: Vec3;
  /** Box center. */
  pos: Vec3;
  angle: number;
  data: PartData;
}

export interface BuildingParts {
  boxes: BoxPart[];
  walls: WallPart[];
  slabs: SlabPart[];
  meshes: MeshPart[];
  modules: ModulePart[];
}

export const emptyParts = (): BuildingParts => ({ boxes: [], walls: [], slabs: [], meshes: [], modules: [] });
