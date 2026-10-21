import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Batcher } from '../../src/f3/render/batch';

/** A drawn building as View keeps it: group, shell mesh (two material groups), parts (one instanced, one plain). */
function building(x: number, wall: THREE.Material, roof: THREE.Material, frame: THREE.Material) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  const sg = new THREE.BoxGeometry(4, 3, 4);
  const shellMesh = new THREE.Mesh(sg, [wall, roof, wall, wall, wall, wall]);
  const parts = new THREE.Group();
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.1), frame, 3);
  for (let i = 0; i < 3; i++) im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i - 1, 1, 2));
  const sill = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.2), frame);
  parts.add(im, sill);
  group.add(shellMesh, parts);
  return { group, shell: { mesh: shellMesh }, parts: { group: parts }, gap: 0 };
}

describe('Batcher (buildings at rest in BatchedMesh)', () => {
  const wall = new THREE.MeshStandardMaterial(),
    roof = new THREE.MeshStandardMaterial(),
    frame = new THREE.MeshStandardMaterial();

  it('draws resting buildings in one batch per material and hides their own meshes', () => {
    const bt = new Batcher();
    const built = new Map([
      ['a', building(0, wall, roof, frame)],
      ['b', building(10, wall, roof, frame)],
    ]);
    bt.sync(built, new Set(), false);
    expect(bt.batchCount).toBe(3);
    for (const b of built.values()) {
      expect(b.shell.mesh.visible).toBe(false);
      expect(b.parts.group.visible).toBe(false);
    }
    // a: shell 6 groups (one per box face) + 3 frames + 1 sill = 10 instances; the same for b.
    expect(bt.instances).toBe(20);
  });

  it('the active building is drawn by its own meshes; leaving the selection batches it again', () => {
    const bt = new Batcher();
    const built = new Map([
      ['a', building(0, wall, roof, frame)],
      ['b', building(10, wall, roof, frame)],
    ]);
    bt.sync(built, new Set(['a']), false);
    expect(built.get('a')!.shell.mesh.visible).toBe(true);
    expect(built.get('b')!.shell.mesh.visible).toBe(false);
    bt.sync(built, new Set(), false);
    expect(built.get('a')!.shell.mesh.visible).toBe(false);
  });

  it('a moved building moves its batched copy (no copy left behind)', () => {
    const bt = new Batcher();
    const a = building(0, wall, roof, frame);
    const built = new Map([['a', a]]);
    bt.sync(built, new Set(), false);
    a.group.position.x = 25;
    bt.sync(built, new Set(), false);
    const batch = bt.root.children.find((m) => (m as THREE.BatchedMesh).material === frame) as THREE.BatchedMesh;
    const box = new THREE.Box3();
    const m = new THREE.Matrix4();
    for (let i = 0; i < batch.instanceCount; i++) {
      batch.getMatrixAt(i, m);
      box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(m));
    }
    expect(box.min.x).toBeGreaterThan(20);
  });

  it('a redrawn or removed building replaces or frees its instances; "off" shows every own mesh', () => {
    const bt = new Batcher();
    const built = new Map([['a', building(0, wall, roof, frame)]]);
    bt.sync(built, new Set(), false);
    const count = () => bt.instances;
    const before = count();
    // A new drawing of the same building (an edit): the old instances go, the new ones come.
    built.set('a', building(0, wall, roof, frame));
    bt.sync(built, new Set(), false);
    expect(count()).toBe(before);
    bt.sync(built, new Set(), true);
    expect(built.get('a')!.shell.mesh.visible).toBe(true);
    built.delete('a');
    bt.sync(built, new Set(), false);
    expect(count()).toBe(0);
  });

  it('a view change of many buildings starts the batches again, refilled within the budget', () => {
    const bt = new Batcher();
    const built = new Map(Array.from({ length: 40 }, (_, i) => [`b${i}`, building(i * 10, wall, roof, frame)] as const));
    bt.sync(built, new Set(), false);
    expect(bt.instances).toBe(400);
    // Every building drawn again (another view): no one-by-one removal, new batches.
    const old = bt.root.children.slice();
    for (const k of built.keys()) built.set(k, building(Number(k.slice(1)) * 10, wall, roof, frame));
    let pending = bt.sync(built, new Set(), false, 0);
    // Budget 0: nothing copied this frame, every building shows its own meshes meanwhile.
    expect(pending).toBe(true);
    expect([...built.values()].every((b) => b.shell.mesh.visible)).toBe(true);
    expect(old.every((m) => !m.parent)).toBe(true);
    while (pending) pending = bt.sync(built, new Set(), false, 5);
    expect(bt.instances).toBe(400);
    expect([...built.values()].every((b) => !b.shell.mesh.visible)).toBe(true);
  });

  it('a drawing kept for another view keeps its copy hidden; coming back only shows it', () => {
    const bt = new Batcher();
    const whole = building(0, wall, roof, frame);
    const cut = building(0, wall, roof, frame);
    const built = new Map([['a', whole]]);
    bt.sync(built, new Set(), false);
    // Cutaway: the whole drawing is kept aside, the cut one is current.
    built.set('a', cut);
    bt.sync(built, new Set(), false, Infinity, [whole]);
    expect(bt.instances).toBe(10);
    const slots = () => bt.root.children.reduce((n, m) => n + (m as THREE.BatchedMesh).instanceCount, 0);
    const both = slots();
    expect(both).toBe(20);
    // Show all: back to the whole drawing, nothing copied again. Kept drawings given by a generator
    // (as View does): the cut copy must be hidden, not drawn inside the whole one.
    built.set('a', whole);
    bt.sync(built, new Set(), false, 0, (function* () {
      yield cut;
    })());
    const drawnTris = () => bt.root.children.reduce((n, m) => {
      const b = m as unknown as { _instanceInfo: { visible: boolean; active: boolean }[] };
      return n + b._instanceInfo.filter((i) => i.visible && i.active).length;
    }, 0);
    expect(drawnTris()).toBe(10);
    expect(slots()).toBe(both);
    expect(bt.instances).toBe(10);
    expect(whole.shell.mesh.visible).toBe(false);
    // Dropped from the kept drawings: its copy goes.
    bt.sync(built, new Set(), false);
    expect(slots()).toBe(10);
  });

  it('a material past the chunk size gets another batch (no batch grows without limit)', () => {
    const bt = new Batcher(null, 200);
    const built = new Map(Array.from({ length: 12 }, (_, i) => [`b${i}`, building(i * 10, wall, roof, frame)] as const));
    bt.sync(built, new Set(), false);
    // Wall: 5 faces × 6 vertices = 30 per building, 360 in all: two wall batches of at most 200.
    const walls = bt.root.children.filter((m) => (m as THREE.BatchedMesh).material === wall) as THREE.BatchedMesh[];
    expect(walls.length).toBe(2);
    for (const m of walls) expect((m as unknown as { _maxVertexCount: number })._maxVertexCount).toBeLessThanOrEqual(200);
    expect(bt.instances).toBe(120);
  });

  it('a batch whose program is compiling stays hidden; its buildings keep their meshes until ready', async () => {
    let done!: () => void;
    const compiled = new Promise<void>((r) => (done = r));
    const asked: THREE.BatchedMesh[] = [];
    const bt = new Batcher((m) => {
      asked.push(m);
      return compiled;
    });
    const a = building(0, wall, roof, frame);
    const built = new Map([['a', a]]);
    let ready = 0;
    bt.onReady = () => ready++;
    bt.sync(built, new Set(), false);
    // One compile per material key (wall, roof, frame), not per chunk or building.
    expect(asked.length).toBe(3);
    expect(a.shell.mesh.visible).toBe(true);
    expect(bt.root.children.every((m) => !m.visible)).toBe(true);
    done();
    await compiled;
    await Promise.resolve();
    expect(ready).toBe(3);
    bt.sync(built, new Set(), false);
    expect(a.shell.mesh.visible).toBe(false);
    expect(bt.root.children.every((m) => m.visible)).toBe(true);
    // A second building of the same materials asks for nothing more.
    built.set('b', building(10, wall, roof, frame));
    bt.sync(built, new Set(), false);
    expect(asked.length).toBe(3);
    expect(built.get('b')!.shell.mesh.visible).toBe(false);
  });

  it('culls per building and per pass: the camera pass draws what it sees, the shadow pass what the sun covers', () => {
    const bt = new Batcher();
    const near = building(0, wall, roof, frame);
    const far = building(400, wall, roof, frame);
    const built = new Map([
      ['near', near],
      ['far', far],
    ]);
    bt.sync(built, new Set(), false);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.set(0, 20, 40);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const sun = new THREE.DirectionalLight();
    sun.castShadow = true;
    sun.position.set(380, 100, 0);
    sun.target.position.set(400, 0, 0);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    bt.cull(camera, sun);
    const drawn = (pass: THREE.Camera) => {
      let n = 0;
      for (const m of bt.root.children as THREE.BatchedMesh[]) {
        m.onBeforeRender(null as unknown as THREE.WebGLRenderer, new THREE.Scene(), pass, m.geometry, m.material as THREE.Material, null as unknown as THREE.Group);
        const info = (m as unknown as { _instanceInfo: { visible: boolean; active: boolean }[] })._instanceInfo;
        n += info.filter((i) => i.visible && i.active).length;
      }
      return n;
    };
    // The camera sees only the near building; the sun's shadow box holds only the far one.
    expect(drawn(camera)).toBe(10);
    expect(drawn(sun.shadow.camera)).toBe(10);
    // Another camera (a thumbnail, a second view) is not culled.
    expect(drawn(new THREE.PerspectiveCamera())).toBe(20);
    // The far building moves into view: drawn by the camera pass.
    far.group.position.x = 5;
    bt.sync(built, new Set(), false);
    bt.cull(camera, sun);
    expect(drawn(camera)).toBe(20);
  });

  it('a hidden category switches its instances off in the batch, with nothing copied again', () => {
    const bt = new Batcher();
    const a = building(0, wall, roof, frame) as ReturnType<typeof building> & { parts: { group: THREE.Group; hidden?: ReadonlySet<string>; hiddenKey?: string } };
    // Frames are windows; the sill has no category.
    a.parts.group.children[0]!.userData.category = 'windows';
    const built = new Map([['a', a]]);
    bt.sync(built, new Set(), false);
    const slots = () => bt.root.children.reduce((n, m) => n + (m as THREE.BatchedMesh).instanceCount, 0);
    const drawn = () =>
      bt.root.children.reduce((n, m) => n + (m as unknown as { _instanceInfo: { visible: boolean; active: boolean }[] })._instanceInfo.filter((i) => i.visible && i.active).length, 0);
    const before = slots();
    expect(drawn()).toBe(10);
    a.parts.hidden = new Set(['windows']);
    a.parts.hiddenKey = 'windows';
    bt.sync(built, new Set(), false);
    expect(drawn()).toBe(7);
    expect(slots()).toBe(before);
    a.parts.hidden = new Set();
    a.parts.hiddenKey = '';
    bt.sync(built, new Set(), false);
    expect(drawn()).toBe(10);
  });

  it('exploded floors at rest are batched; a new gap copies them again', () => {
    const bt = new Batcher();
    const a = building(0, wall, roof, frame);
    const built = new Map([['a', a]]);
    a.gap = 4;
    bt.sync(built, new Set(), false);
    expect(a.shell.mesh.visible).toBe(false);
    const first = bt.root.children.map((m) => (m as THREE.BatchedMesh).instanceCount);
    a.gap = 6;
    bt.sync(built, new Set(), false);
    expect(a.shell.mesh.visible).toBe(false);
    expect(bt.instances).toBe(10);
    expect(bt.root.children.map((m) => (m as THREE.BatchedMesh).instanceCount)).toEqual(first);
  });
});
