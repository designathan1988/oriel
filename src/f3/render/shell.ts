// Evaluated shell → three.js mesh with one group per material. Flat normals,
// except on curved faces (arched sides, domes, vaults), which are
// smoothed between triangles of the same surface. UVs in meters.
import * as THREE from 'three';
import type { Building3, ID } from '../model/schema';
import type { Evaluated } from '../eval/evaluate';
import type { FaceInfo } from '../eval/faces';
import type { MaterialKey } from '../../geometry/parts';
import type { RenderContext } from '../../render/context';
import { metricUVs } from '../../render/build-building';
import { materialKey } from './finishes';
import { roomHash } from './night';
import { floorLift } from './lift';

const FLAT_ROOF = { finish: 'membrane', color: '#8f9290' };
const TERRACE_FLOOR = { finish: 'floor', color: '#d4ccbf', color2: '#a29a8d' };

/** Material of a source face. */
/** Section poché: dark, so the cut walls and slabs read at once (the cut belongs to no volume). */
const CUT: MaterialKey = { role: 'stone', color: '#3b3a38', roughness: 1, finish: 'hollow' };

export function faceMaterial(b: Building3, f: FaceInfo): MaterialKey {
  if (f.kind === 'cut' || f.kind === 'roofCut') return CUT;
  // A room floor with its own finish (eval/interiorwalls.ts: solid "room:<level>:<room>").
  if (f.solid.startsWith('room:')) {
    const [, lv, rid] = f.solid.split(':');
    const fin = b.interiors[lv!]?.rooms.find((r) => r.id === rid)?.finish;
    if (fin) return materialKey(fin, 'stone');
  }
  const s = b.solids.find((x) => x.id === f.solid);
  if (!s) return materialKey({ finish: 'paint', color: '#cccccc' }, 'wall');
  // What a cutter leaves (niche walls, the arch or vault of an arcade) is one surface: its cut-face finish,
  // never roof tile or membrane.
  if (s.op === 'subtract' && (f.kind === 'roof' || f.kind === 'top' || f.kind === 'gable' || f.kind === 'side' || f.kind === 'cutter')) return materialKey(s.materials.wall, 'wall');
  const edgeMat = f.edge ? s.edges[f.edge.endsWith(':c') ? f.edge.slice(0, -2) : f.edge]?.material : undefined;
  switch (f.kind) {
    case 'side':
    case 'bevel':
    case 'gable':
    case 'cutter':
      return materialKey(edgeMat ?? s.materials.wall, 'wall');
    case 'parapet':
      return materialKey(s.materials.wall, 'wall');
    case 'roof':
      return materialKey(s.materials.roof, 'roof');
    case 'top':
      return materialKey(s.materials.floor ?? (s.roof.kind === 'terrace' ? TERRACE_FLOOR : FLAT_ROOF), 'roof');
    case 'glazing':
      return materialKey({ finish: 'glass', color: '#6d8794' }, 'glass');
    case 'fascia':
    case 'soffit':
    case 'reveal':
      return materialKey(s.materials.trim, 'frame');
    // Interior seen through the window: matte and dark (the sky light does not get fully in).
    case 'roomFloor':
      return { role: 'stone', color: '#4a3b2f', roughness: 1, finish: 'interior' };
    case 'roomCeil':
      return { role: 'stone', color: '#9c968c', roughness: 1, finish: 'interior' };
    case 'roomWall':
      return { role: 'stone', color: '#7d7568', roughness: 1, finish: 'interior' };
    case 'coping':
    case 'band':
      return materialKey(s.materials.trim, 'stone');
    case 'plinth':
      return materialKey(s.materials.base, 'stone');
    case 'bottom':
      return materialKey(s.materials.base, 'stone');
    // Hollow building (interior view): light, matte finishes that read as rooms, lit like the
    // rest (not the dark 'interior' of the rooms seen through the glass).
    case 'floor':
      return { role: 'stone', color: '#c9b79a', roughness: 0.85, finish: 'hollow' };
    case 'ceiling':
      return { role: 'stone', color: '#f1eee8', roughness: 1, finish: 'hollow' };
    case 'innerWall':
      return { role: 'stone', color: '#ebe6dc', roughness: 1, finish: 'hollowWall' };
  }
}

export interface ShellMesh {
  mesh: THREE.Mesh;
  /** Source face of each drawn triangle (in group order). */
  faceOf: Uint32Array;
  /**
   * Exploded floors: each floor band rises by its index × `gap`, in place (only the
   * Y of the positions changes: no new mesh, normals or UVs). Nothing on a building
   * that was not evaluated in floors.
   */
  setGap(gap: number): void;
  dispose(): void;
}

const keyOf = (k: MaterialKey) => `${k.role}|${k.color}|${k.roughness}|${k.texture ?? ''}|${k.textureScale ?? 1}|${k.metalness ?? 0}|${k.finish ?? ''}|${k.color2 ?? ''}|${k.params ?? ''}`;

export function buildShellMesh(b: Building3, ev: Evaluated, ctx: RenderContext, solidOf?: (id: ID) => boolean, faceOk?: (f: FaceInfo) => boolean, gap = 0): ShellMesh {
  // Floor band of each triangle (exploded floors, a single floor shown).
  const floorOf = ev.shell.floorOf;
  const { positions: P, indices: I, faceOf } = ev.shell;
  const nTri = I.length / 3;
  // Triangles of no area (slivers the booleans leave) draw nothing and have no normal: they are left
  // out (a zero normal made the GLB exporter warn "normalized normal" and broke shading in viewers).
  const flat = new Uint8Array(nTri);
  {
    const p = new THREE.Vector3(),
      q = new THREE.Vector3(),
      r = new THREE.Vector3();
    for (let t = 0; t < nTri; t++) {
      p.fromArray(P, I[t * 3]! * 3);
      q.fromArray(P, I[t * 3 + 1]! * 3).sub(p);
      r.fromArray(P, I[t * 3 + 2]! * 3).sub(p);
      if (q.cross(r).lengthSq() < 1e-14) flat[t] = 1;
    }
  }
  // Triangles grouped by material.
  const groups = new Map<string, { key: MaterialKey; tris: number[] }>();
  for (let t = 0; t < nTri; t++) {
    const f = ev.faces[faceOf[t]!];
    if (flat[t] || !f || (solidOf && !solidOf(f.solid)) || (faceOk && !faceOk(f))) continue;
    const key = faceMaterial(b, f);
    const id = keyOf(key);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { key, tris: [] }));
    g.tris.push(t);
  }
  // Per-vertex smoothed normals within each curved surface, summed by position (to 0.1 mm), not by vertex
  // index: the booleans sometimes leave two vertices at one point, and summing by index split the surface
  // there into two halves with their own normals — a crease the whole height of a curved wall (audit D6).
  const smoothKey = (f: FaceInfo) => `${f.solid}|${f.kind}|${f.kind === 'side' ? f.edge : ''}`;
  const at = (vi: number) => `${Math.round(P[vi * 3]! * 1e4)},${Math.round(P[vi * 3 + 1]! * 1e4)},${Math.round(P[vi * 3 + 2]! * 1e4)}`;
  const acc = new Map<string, [number, number, number]>();
  const triNormal = new Float32Array(nTri * 3);
  const a = new THREE.Vector3(),
    bb = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let t = 0; t < nTri; t++) {
    a.fromArray(P, I[t * 3]! * 3);
    bb.fromArray(P, I[t * 3 + 1]! * 3);
    c.fromArray(P, I[t * 3 + 2]! * 3);
    bb.sub(a);
    c.sub(a);
    bb.cross(c);
    const area = bb.length();
    bb.normalize();
    triNormal[t * 3] = bb.x;
    triNormal[t * 3 + 1] = bb.y;
    triNormal[t * 3 + 2] = bb.z;
    const f = ev.faces[faceOf[t]!];
    if (!f?.smooth) continue;
    for (let j = 0; j < 3; j++) {
      const k = `${at(I[t * 3 + j]!)}|${smoothKey(f)}`;
      const v = acc.get(k) ?? [0, 0, 0];
      v[0] += bb.x * area;
      v[1] += bb.y * area;
      v[2] += bb.z * area;
      acc.set(k, v);
    }
  }
  const total = [...groups.values()].reduce((s, g) => s + g.tris.length, 0);
  const pos = new Float32Array(total * 9),
    nor = new Float32Array(total * 9),
    room = new Float32Array(total * 3);
  const drawnFace = new Uint32Array(total);
  const band = floorOf ? new Uint16Array(total) : null;
  const geo = new THREE.BufferGeometry();
  const materials: THREE.Material[] = [];
  let o = 0;
  for (const g of groups.values()) {
    const start = o;
    for (const t of g.tris) {
      const f = ev.faces[faceOf[t]!]!;
      for (let j = 0; j < 3; j++) {
        const vi = I[t * 3 + j]!;
        pos[(o * 3 + j) * 3] = P[vi * 3]!;
        pos[(o * 3 + j) * 3 + 1] = P[vi * 3 + 1]!;
        pos[(o * 3 + j) * 3 + 2] = P[vi * 3 + 2]!;
        let nx = triNormal[t * 3]!,
          ny = triNormal[t * 3 + 1]!,
          nz = triNormal[t * 3 + 2]!;
        if (f.smooth) {
          const v = acc.get(`${at(vi)}|${smoothKey(f)}`);
          if (v) {
            const l = Math.hypot(v[0], v[1], v[2]) || 1;
            // Smooths only where the curvature is small (does not round corners).
            if ((v[0] * nx + v[1] * ny + v[2] * nz) / l > 0.6) {
              nx = v[0] / l;
              ny = v[1] / l;
              nz = v[2] / l;
            }
          }
        }
        nor[(o * 3 + j) * 3] = nx;
        nor[(o * 3 + j) * 3 + 1] = ny;
        nor[(o * 3 + j) * 3 + 2] = nz;
      }
      drawnFace[o] = faceOf[t]!;
      if (band) band[o] = floorOf![t]!;
      // Room draw (lights at night according to the awake fraction); 1 = never.
      const rv = f.room !== undefined ? roomHash(f.room) : 1;
      room[o * 3] = room[o * 3 + 1] = room[o * 3 + 2] = rv;
      o++;
    }
    geo.addGroup(start * 3, (o - start) * 3, materials.length);
    materials.push(ctx.material(g.key));
  }
  const posAttr = new THREE.BufferAttribute(pos, 3);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aRoom', new THREE.BufferAttribute(room, 1));
  // UVs from the floors in place: the finish keeps its courses at any gap. Walls are unrolled along their
  // outline (distance along the ring, height up the wall), so the texture runs on without a seam across
  // the segments of an arc and around rounded corners (audit D6); the rest is projected in meters.
  const uv = metricUVs(Array.from(pos));
  for (let q = 0; q < total; q++) {
    const f = ev.faces[drawnFace[q]!];
    const fr = f?.frame;
    if (!fr || fr.per === undefined || (f.kind !== 'side' && f.kind !== 'cutter')) continue;
    for (let j = 0; j < 3; j++) {
      const k = (q * 3 + j) * 3;
      const dx = pos[k]! - fr.o[0],
        dy = pos[k + 1]! - fr.o[1],
        dz = pos[k + 2]! - fr.o[2];
      uv[(q * 3 + j) * 2] = fr.per + dx * fr.u[0] + dy * fr.u[1] + dz * fr.u[2];
      uv[(q * 3 + j) * 2 + 1] = fr.o[1] + dx * fr.v[0] + dy * fr.v[1] + dz * fr.v[2];
    }
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  // Floor bands lifted in place by the gap (the floor of each vertex is its triangle's).
  let lift: ((g: number) => void) | null = null;
  if (band) {
    const floors = new Uint16Array(total * 3);
    for (let t = 0; t < total; t++) floors[t * 3] = floors[t * 3 + 1] = floors[t * 3 + 2] = band[t]!;
    lift = floorLift(geo, posAttr, floors);
  }
  let lifted = 0;
  const setGap = (g: number) => {
    if (!lift || g === lifted) return;
    lifted = g;
    lift(g);
  };
  setGap(gap);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { shell: true, buildingId: b.id };
  return {
    mesh,
    faceOf: drawnFace,
    setGap,
    dispose() {
      geo.dispose();
    },
  };
}
