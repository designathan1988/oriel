import { describe, expect, it } from 'vitest';
import { FaceTable } from '../../src/f3/eval/faces';
import { addInteriorWall, interiorWallMeshes, replicateLevel, type InteriorWithDoors } from '../../src/f3/eval/interiorwalls';
import type { MeshBuilder } from '../../src/f3/eval/mesh';
import { building, levelsFor, uid } from '../../src/f3/model/defaults';

/** Building with a single 3 m ground level. */
const flat = () => building({ levels: levelsFor(1, 3, 3) });

/** How many vertices of a mesh sit at height `y`. */
function at(mb: MeshBuilder, y: number): number {
  let n = 0;
  for (let i = 0; i < mb.pos.length; i += 3) if (Math.abs(mb.pos[i + 1]! - y) < 1e-6) n++;
  return n;
}

describe('interior walls', () => {
  it('shares the node of two walls that meet', () => {
    const b = flat();
    const level = b.levels[0]!.id;
    addInteriorWall(b, level, [0, 0], [4, 0], 0.12, uid);
    addInteriorWall(b, level, [4, 0], [4, 3], 0.12, uid);
    const it = b.interiors[level]!;
    expect(it.nodes).toHaveLength(3);
    expect(it.walls).toHaveLength(2);
    // The second wall starts at the node the first one ended on (the corner node is one node).
    expect(it.walls[1]!.a).toBe(it.walls[0]!.b);
  });

  it('draws one closed prism per wall, from the floor to under the slab', () => {
    const b = flat();
    const level = b.levels[0]!.id;
    addInteriorWall(b, level, [0, 0], [4, 0], 0.12, uid);
    const table = new FaceTable();
    const mb = interiorWallMeshes(b, table, {});
    expect(mb).not.toBeNull();
    expect(mb!.closed()).toBe(true);
    // 3 m level − 0.25 m slab.
    const bd = mb!.bounds();
    expect(bd[4]! - bd[1]!).toBeCloseTo(2.75, 6);
    // A wall without a door is a four-point profile: two caps of two triangles and four quads.
    expect(mb!.tri.length / 3).toBe(12);
    expect(table.faces[0]).toMatchObject({ kind: 'innerWall', solid: `interior:${level}` });
  });

  it('cuts a door as a notch (before, above and after the opening) and stays closed', () => {
    const b = flat();
    const level = b.levels[0]!.id;
    const wall = addInteriorWall(b, level, [0, 0], [4, 0], 0.12, uid);
    (b.interiors[level] as InteriorWithDoors).doors = [{ wall, u: 2, width: 0.9, height: 2.1 }];
    const table = new FaceTable();
    const mb = interiorWallMeshes(b, table, {});
    expect(mb).not.toBeNull();
    expect(mb!.closed()).toBe(true);
    // The notch adds the door head and both jambs: four more profile points, sixteen vertices.
    expect(mb!.pos.length / 3).toBe(16);
    // Four points at floor level (two wall ends and two jambs), two at the door head, per side.
    expect(at(mb!, 0)).toBe(8);
    expect(at(mb!, 2.1)).toBe(4);
    const bd = mb!.bounds();
    expect(bd[4]! - bd[1]!).toBeCloseTo(2.75, 6);
  });

  it('has nothing to draw without walls', () => {
    expect(interiorWallMeshes(flat(), new FaceTable(), {})).toBeNull();
  });

  it('replicates a level with new ids', () => {
    const b = building({ levels: levelsFor(3, 3, 3) });
    const from = b.levels[0]!.id;
    const to = b.levels.slice(1).map((l) => l.id);
    const wall = addInteriorWall(b, from, [0, 0], [4, 0], 0.12, uid);
    (b.interiors[from] as InteriorWithDoors).doors = [{ wall, u: 2, width: 0.9, height: 2.1 }];
    replicateLevel(b, from, to, uid);
    for (const id of to) {
      const it = b.interiors[id]!;
      expect(it.nodes).toHaveLength(2);
      expect(it.walls).toHaveLength(1);
      expect(it.nodes[0]!.id).not.toBe(b.interiors[from]!.nodes[0]!.id);
      expect(it.walls[0]!.id).not.toBe(wall);
      expect(it.walls[0]!.a).toBe(it.nodes[0]!.id);
      expect(it.walls[0]!.b).toBe(it.nodes[1]!.id);
      // The door follows its own wall into the copy.
      expect((it as InteriorWithDoors).doors?.[0]?.wall).toBe(it.walls[0]!.id);
    }
  });
});
