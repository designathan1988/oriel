// forma/3 finishes (surface materials) and the render material key.
// The color comes from the document; the finish gives texture, scale and gloss.
import type { MaterialKey } from '../../geometry/parts';
import type { TextureKind } from '../../styles/schema';
import type { MaterialRef } from '../model/schema';

export interface Finish {
  id: string;
  name: string;
  texture?: TextureKind;
  /** Meters per texture repeat. */
  scale: number;
  roughness: number;
  metalness?: number;
}

export const FINISHES: Finish[] = [
  // Procedural (parametric, baked on the GPU).
  { id: 'plaster', name: 'Plaster', texture: 'plaster', scale: 2, roughness: 0.9 },
  { id: 'paint', name: 'Smooth paint', texture: 'plaster', scale: 2, roughness: 0.75 },
  { id: 'brick', name: 'Face brick', texture: 'brick', scale: 1.4, roughness: 0.88 },
  { id: 'stone', name: 'Dressed stone', texture: 'stone', scale: 2.4, roughness: 0.92 },
  { id: 'concrete', name: 'Exposed concrete', texture: 'concrete', scale: 2.4, roughness: 0.85 },
  { id: 'wood', name: 'Wood (boards)', texture: 'wood', scale: 2, roughness: 0.7 },
  { id: 'floor', name: 'Ceramic tile', texture: 'tile', scale: 2.4, roughness: 0.5 },
  { id: 'paving', name: 'Interlocking paving', texture: 'brick', scale: 1.2, roughness: 0.9 },
  { id: 'tile', name: 'Clay roof tile', texture: 'tile', scale: 1.6, roughness: 0.78 },
  { id: 'slate', name: 'Slate', texture: 'tile', scale: 2, roughness: 0.6 },
  { id: 'metal', name: 'Corrugated metal', texture: 'metal', scale: 1.5, roughness: 0.45, metalness: 0.55 },
  { id: 'panel', name: 'Seamed panel', texture: 'metal', scale: 2, roughness: 0.4, metalness: 0.3 },
  { id: 'membrane', name: 'Membrane', texture: 'concrete', scale: 3, roughness: 0.95 },
  // Smooth painted or galvanized steel (railings, grilles, frames, street furniture): no corrugation.
  { id: 'steel', name: 'Painted steel', scale: 1, roughness: 0.38, metalness: 0.6 },
  { id: 'glass', name: 'Glass', scale: 1, roughness: 0.15, metalness: 0.35 },
  { id: 'ceramic', name: 'Glazed ceramic', scale: 1, roughness: 0.12 },
  // Photographed (PBR).
  { id: 'plaster-photo', name: 'Plaster (photo)', texture: 'plaster', scale: 2, roughness: 0.9 },
  { id: 'brick-photo', name: 'Brick (photo)', texture: 'brick', scale: 2.4, roughness: 0.88 },
  { id: 'stone-photo', name: 'Stone (photo)', texture: 'stone', scale: 2.4, roughness: 0.92 },
  { id: 'concrete-photo', name: 'Concrete (photo)', texture: 'concrete', scale: 2.2, roughness: 0.85 },
  { id: 'wood-photo', name: 'Wood (photo)', texture: 'wood', scale: 0.8, roughness: 0.7 },
  { id: 'tile-photo', name: 'Roof tile (photo)', texture: 'tile', scale: 3.2, roughness: 0.78 },
  { id: 'slate-photo', name: 'Slate (photo)', texture: 'tile', scale: 2, roughness: 0.6 },
  { id: 'metal-photo', name: 'Corrugated metal (photo)', texture: 'metal', scale: 2, roughness: 0.45, metalness: 0.55 },
];

const byId = new Map(FINISHES.map((f) => [f.id, f]));

export function finishOf(id: string): Finish {
  return byId.get(id) ?? FINISHES[0]!;
}

export type Role = MaterialKey['role'];

export function materialKey(ref: MaterialRef, role: Role, doubleSide = false): MaterialKey {
  const f = finishOf(ref.finish);
  return {
    role,
    color: ref.color,
    roughness: f.roughness,
    ...(f.metalness ? { metalness: f.metalness } : {}),
    ...(f.texture ? { texture: f.texture, textureScale: f.scale } : {}),
    finish: f.id,
    ...(ref.color2 ? { color2: ref.color2 } : {}),
    ...(ref.params && Object.keys(ref.params).length ? { params: JSON.stringify(Object.keys(ref.params).sort().map((k) => [k, ref.params![k]])) } : {}),
    ...(doubleSide ? { doubleSide: true } : {}),
  };
}
