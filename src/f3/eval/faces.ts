// Source face table. Each triangle entering Manifold carries the
// index of one of these faces (faceID), and Manifold keeps that index in the
// boolean result: that is how the result knows which solid, which
// side and which part each triangle came from (material, selection, facade).
import type { ID, Vec3 } from '../model/schema';

export type FaceKind =
  /** Side wall of a solid (a segment of side `edge`). */
  | 'side'
  /** Flat top of a solid (flat roof, terrace). */
  | 'top'
  | 'bottom'
  /** Roof slope or dome/vault surface. */
  | 'roof'
  /** Gable (vertical wall under the roof). */
  | 'gable'
  /** Glazed plane (sawtooth, skylight). */
  | 'glazing'
  /** Eave fascia. */
  | 'fascia'
  /** Eave soffit (underside). */
  | 'soffit'
  | 'parapet'
  /** Coping on top of the parapet. */
  | 'coping'
  /** Plinth at the foot of the walls. */
  | 'plinth'
  /** Surface created by a cut opening. */
  | 'reveal'
  /** Room behind a window: floor, ceiling and interior walls. */
  | 'roomFloor'
  | 'roomCeil'
  | 'roomWall'
  /** Bevel band at the top or base of a side (wall, no components). */
  | 'bevel'
  /** Band, cornice or plinth band swept along the outline. */
  | 'band'
  /** Inner face of a subtractive solid (becomes a wall of the cut). */
  | 'cutter'
  /** Hollow building (interior view): top of a slab, underside of the slab above, inner side of the walls. */
  | 'floor'
  | 'ceiling'
  | 'innerWall'
  /** Section cut (cut by floor): the solid seen in the cut plane. */
  | 'cut'
  /** Section through a roof left by the wall removal (interior view): drawn like a cut, hidden with the roofs. */
  | 'roofCut';

export interface FaceFrame {
  /** Origin: segment start at the solid base. */
  o: Vec3;
  /** Along the segment (horizontal). */
  u: Vec3;
  /** Up the face. */
  v: Vec3;
  /** Outward. */
  n: Vec3;
  /** Distance along the side where the segment starts (curved sides have several). */
  s0: number;
  s1: number;
  /**
   * Distance along the whole outline (all sides of the ring, from its first vertex) where the segment
   * starts: the texture runs on it, so a finish is continuous along a curved wall and around a rounded
   * corner (audit D6: per-triangle texture planes made a step of tone at every segment of an arc).
   */
  per?: number;
}

export interface FaceInfo {
  kind: FaceKind;
  solid: ID;
  edge?: ID;
  /** Segment index in the sampled ring. */
  seg?: number;
  /** Ring: -1 outer, ≥0 hole. */
  ring?: number;
  frame?: FaceFrame;
  /** Curved surface: smoothed normals when drawn. */
  smooth?: boolean;
  /** Component that opened the gap (faces 'reveal'). */
  item?: ID;
  /** Number of the room behind an opening (floor, ceiling and walls of the same room). */
  room?: number;
}

export class FaceTable {
  readonly faces: FaceInfo[] = [];
  add(f: FaceInfo): number {
    this.faces.push(f);
    return this.faces.length - 1;
  }
}
