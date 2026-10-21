import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { project } from '../../src/f3/model/defaults';
import { sampleBuildings } from '../../src/f3/model/samples';
import { clipPartsBelow, cutHeight } from '../../src/f3/eval/interior';
import { solidRings } from '../../src/f3/eval/body';
import { buildShellMesh, faceMaterial } from '../../src/f3/render/shell';
import { buildPartsMesh } from '../../src/f3/render/parts';
import { createRenderContext } from '../../src/render/context';
import * as THREE from 'three';

beforeAll(async () => {
  await loadKernel();
});

/** Every edge used by exactly two triangles (closed mesh, by topology: touching corners share positions, not edges). */
function closed(I: Uint32Array): boolean {
  const edges = new Map<string, number>();
  for (let t = 0; t < I.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = I[t + j]!,
        c = I[t + ((j + 1) % 3)]!;
      const e = a < c ? `${a}|${c}` : `${c}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  return [...edges.values()].every((n) => n === 2);
}

/** Signed volume of a closed mesh. */
function volume(P: Float32Array, I: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t]! * 3, I[t + 1]! * 3, I[t + 2]! * 3];
    v += (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6;
  }
  return v;
}

describe('hollow buildings (interior view)', () => {
  const p = project({ buildings: sampleBuildings() });
  for (const b of p.buildings) {
    it(`${b.name}: floors, ceilings and inner walls, closed, lighter than the solid`, () => {
      const solid = evaluateBuilding(b, {}, p);
      const hollow = evaluateBuilding(b, { hollow: true }, p);
      const kinds = new Set([...hollow.shell.faceOf].map((f) => hollow.faces[f]!.kind));
      expect(kinds.has('floor')).toBe(true);
      expect(kinds.has('ceiling')).toBe(true);
      expect(kinds.has('innerWall')).toBe(true);
      // No fake room boxes behind the windows: the real rooms are there.
      expect(kinds.has('roomWall')).toBe(false);
      expect(closed(hollow.shell.indices)).toBe(true);
      expect(volume(hollow.shell.positions, hollow.shell.indices)).toBeLessThan(volume(solid.shell.positions, solid.shell.indices) * 0.8);
    });
  }

  for (const name of ['Courtyard block', 'Tapered tower', 'House with tower']) {
    it(`${name}: cut at the ground floor, nothing above the plane, a closed section, parts clipped`, () => {
      const b = p.buildings.find((x) => x.name === name)!;
      const y = cutHeight(b, 0)!;
      const ev = evaluateBuilding(b, { hollow: true, cutY: y }, p);
      const P = ev.shell.positions;
      let top = -Infinity;
      for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]!);
      expect(top).toBeLessThanOrEqual(y + 1e-4);
      expect([...ev.shell.faceOf].some((f) => ev.faces[f]!.kind === 'cut')).toBe(true);
      expect(closed(ev.shell.indices)).toBe(true);
      for (const m of ev.parts.meshes) for (let i = 1; i < m.positions.length; i += 3) expect(m.positions[i]!).toBeLessThanOrEqual(y + 1e-6);
      for (const it of ev.parts.inst) expect(Math.abs(it.m[1]!) * 0.5 + Math.abs(it.m[5]!) * 0.5 + Math.abs(it.m[9]!) * 0.5 + it.m[13]!).toBeLessThanOrEqual(y + 1e-6);
    });
  }

  it('a box crossing the cut becomes its lower part; one above it goes', () => {
    const box = (cy: number) => ({ shape: 'box' as const, mat: { role: 'frame' } as never, m: [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, cy, 0, 1], tag: 0 });
    const out = clipPartsBelow({ inst: [box(0), box(5)], meshes: [], tags: [{ family: 'x' }] }, 0.5);
    expect(out.inst.length).toBe(0);
    expect(out.meshes.length).toBe(1);
    const ys = out.meshes[0]!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 6);
    expect(Math.min(...ys)).toBeCloseTo(-1, 6);
  });
  it('a level past the top floor leaves the building whole', () => {
    const b = p.buildings[0]!;
    expect(cutHeight(b, b.levels.length)).toBeUndefined();
  });

  for (const name of p.buildings.map((x) => x.name)) {
    it(`${name}: exterior walls cut away keep the section (slab edges) and no outer wall face`, () => {
      const b = p.buildings.find((x) => x.name === name)!;
      const ev = evaluateBuilding(b, { hollow: true, noWalls: true }, p);
      const kinds = [...ev.shell.faceOf].map((f) => ev.faces[f]!.kind);
      expect(kinds.includes('cut')).toBe(true);
      expect(kinds.includes('floor')).toBe(true);
      expect(kinds.filter((k) => k === 'side').length).toBe(0);
      expect(closed(ev.shell.indices)).toBe(true);
    });
    it(`${name}: exploded bands, one per floor plus the roof, each closed`, () => {
      const b = p.buildings.find((x) => x.name === name)!;
      const n = b.levels.length;
      const ev = evaluateBuilding(b, { hollow: true, bands: { levels: Array.from({ length: n }, (_, i) => i), top: true } }, p);
      const f = ev.shell.floorOf!;
      expect(f.length).toBe(ev.shell.faceOf.length);
      expect(new Set(f).size).toBe(n + 1);
      expect(closed(ev.shell.indices)).toBe(true);
      // Each floor band ends 1.2 m above its floor (stacked plans).
      const lv = [...b.levels].sort((a, c) => a.elevation - c.elevation);
      const P = ev.shell.positions,
        I = ev.shell.indices;
      for (let t = 0; t < f.length; t++) if (f[t]! < n) for (let j = 0; j < 3; j++) expect(P[I[t * 3 + j]! * 3 + 1]!).toBeLessThanOrEqual(lv[f[t]!]!.elevation + 1.2 + 1e-4);
      for (const it of ev.parts.inst) expect(it.floor).toBeDefined();
    });
  }

  it('what a cutter leaves (niche, arch soffit) takes its cut-face finish, never roof tile', () => {
    const arcade = p.buildings.find((x) => x.name === 'Arcade')!;
    const arch = arcade.solids.find((x) => x.op === 'subtract')!;
    expect(faceMaterial(arcade, { kind: 'roof', solid: arch.id }).finish).toBe(faceMaterial(arcade, { kind: 'cutter', solid: arch.id }).finish);
    expect(faceMaterial(arcade, { kind: 'roof', solid: arch.id }).color).toBe(arch.materials.wall.color);
  });

  it('the section reads as dark poché, though it belongs to no volume', () => {
    expect(faceMaterial(p.buildings[0]!, { kind: 'cut', solid: '' }).color).toBe('#3b3a38');
  });

  it('exploded gap moved in place: the same positions as a mesh built at that gap, same UVs, and back to together', () => {
    const ctx = createRenderContext();
    const b = p.buildings.find((x) => x.name === 'House with tower')!;
    const n = b.levels.length;
    const ev = evaluateBuilding(b, { hollow: true, bands: { levels: Array.from({ length: n }, (_, i) => i), top: true } }, p);
    const arr = (m: THREE.Mesh, a: string) => [...(m.geometry.getAttribute(a).array as Float32Array)];
    const at3 = buildShellMesh(b, ev, ctx, undefined, undefined, 3);
    const moved = buildShellMesh(b, ev, ctx, undefined, undefined, 0);
    const base = arr(moved.mesh, 'position');
    const uv = arr(moved.mesh, 'uv');
    moved.setGap(3);
    expect(arr(moved.mesh, 'position')).toEqual(arr(at3.mesh, 'position'));
    expect(arr(moved.mesh, 'uv')).toEqual(uv);
    expect(arr(moved.mesh, 'uv')).toEqual(arr(at3.mesh, 'uv'));
    // The bounds follow without another pass over the vertices: the box is exact and the
    // sphere holds every vertex (picking and culling test it first).
    const g = moved.mesh.geometry;
    const exact = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
    expect(g.boundingBox!.min.toArray()).toEqual(exact.min.toArray());
    expect(g.boundingBox!.max.toArray()).toEqual(exact.max.toArray());
    const P3 = g.getAttribute('position').array as Float32Array;
    const c = g.boundingSphere!.center, r = g.boundingSphere!.radius;
    let out = 0;
    for (let v = 0; v < P3.length; v += 3) if (Math.hypot(P3[v]! - c.x, P3[v + 1]! - c.y, P3[v + 2]! - c.z) > r + 1e-4) out++;
    expect(out).toBe(0);
    moved.setGap(0);
    expect(arr(moved.mesh, 'position')).toEqual(base);
    // Parts: instance matrices and profile positions alike.
    const parts3 = buildPartsMesh(ev.parts, ctx, false, undefined, 3);
    const parts = buildPartsMesh(ev.parts, ctx, false, undefined, 0);
    parts.setGap(3);
    const dump = (g: THREE.Group) =>
      g.children.map((c) => ((c as THREE.InstancedMesh).isInstancedMesh ? [...(c as THREE.InstancedMesh).instanceMatrix.array] : arr(c as THREE.Mesh, 'position')));
    expect(parts.group.children.length).toBeGreaterThan(0);
    expect(dump(parts.group)).toEqual(dump(parts3.group));
    ctx.dispose();
  });
});

describe('cutaway (walls removed): no section left floating above the walls', () => {
  const p = project({ buildings: sampleBuildings() });
  for (const b of p.buildings) {
    it(`${b.name}: every section above the wall top of its volume is a roof cut (it hides with the roofs)`, () => {
      const ev = evaluateBuilding(b, { hollow: true, noWalls: true }, p);
      const { positions: P, indices: I, faceOf: F } = ev.shell;
      const tops = b.solids.filter((s) => s.op === 'add').map((s) => s.base + s.height);
      const maxTop = Math.max(...tops);
      let above = 0;
      for (let t = 0; t < F.length; t++) {
        if (ev.faces[F[t]!]!.kind !== 'cut') continue;
        const y = (P[I[3 * t]! * 3 + 1]! + P[I[3 * t + 1]! * 3 + 1]! + P[I[3 * t + 2]! * 3 + 1]!) / 3;
        if (y > maxTop + 0.01) above++;
      }
      expect(above).toBe(0);
      // Section faces still show the slabs and wall ends below.
      expect(F.some((f) => ev.faces[f]!.kind === 'cut')).toBe(true);
    });
  }

  it('House with tower: the tower ring no longer leaves a black gable section over the house', () => {
    const b = p.buildings.find((x) => x.name === 'House with tower')!;
    const house = b.solids.find((s) => s.name === 'House')!;
    const tower = b.solids.find((s) => s.name === 'Tower')!;
    const tp = solidRings(tower).outer.pts;
    const inTower = (x: number, z: number) => {
      let inside = false;
      for (let i = 0, j = tp.length - 1; i < tp.length; j = i++) if (tp[i]![1] > z !== tp[j]![1] > z && x < ((tp[j]![0] - tp[i]![0]) * (z - tp[i]![1])) / (tp[j]![1] - tp[i]![1]) + tp[i]![0]) inside = !inside;
      return inside;
    };
    const ev = evaluateBuilding(b, { hollow: true, noWalls: true }, p);
    const { positions: P, indices: I, faceOf: F } = ev.shell;
    let cutAbove = 0,
      roofCut = 0;
    for (let t = 0; t < F.length; t++) {
      const kind = ev.faces[F[t]!]!.kind;
      const c = [0, 1, 2].map((k) => (P[I[3 * t]! * 3 + k]! + P[I[3 * t + 1]! * 3 + k]! + P[I[3 * t + 2]! * 3 + k]!) / 3);
      if (kind === 'roofCut') roofCut++;
      // Above the house walls and outside the tower: the house roof cut by the tower ring (the black gable).
      if (kind === 'cut' && c[1]! > house.base + house.height + 0.05 && !inTower(c[0]!, c[2]!)) cutAbove++;
    }
    expect(roofCut).toBeGreaterThan(0);
    expect(cutAbove).toBe(0);
  });
});
