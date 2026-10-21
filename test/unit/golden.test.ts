// The evaluated geometry of every fixed scene (e2e/scenes.ts), as a hash and a few counts per building,
// against the values recorded in __snapshots__/golden.test.ts.snap: the exact pictures' job, done on
// the model instead of the pixels, in about a second, on any machine, no GPU. Any change to what a
// building evaluates to (shell, parts, faces, placements, warnings) changes its line. A change that is
// meant: look at the scene in the editor, then record the new values with `npx vitest run -u
// test/unit/golden.test.ts`. Floats are rounded to 0.1 mm first, so the hash is about the geometry and
// not the last bit of a float. The kernel must report no problem while doing it (f3/kernel/problems.ts).
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { clearProblems, problems } from '../../src/f3/kernel/problems';
import { SCENES } from '../../e2e/scenes';

beforeAll(async () => {
  await loadKernel();
});

/** Feeds a value to the hash: typed and plain arrays of numbers rounded, objects by sorted key. */
function feed(h: ReturnType<typeof createHash>, v: unknown): void {
  if (v === null || v === undefined) h.update('_');
  else if (typeof v === 'number') h.update(Number.isFinite(v) ? (Math.round(v * 1e4) / 1e4).toString() : String(v));
  else if (typeof v === 'string' || typeof v === 'boolean') h.update(String(v));
  else if (ArrayBuffer.isView(v)) {
    const a = v as unknown as ArrayLike<number>;
    const r = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) r[i] = Math.round(a[i]! * 1e4) / 1e4;
    h.update(new Uint8Array(r.buffer));
  } else if (Array.isArray(v)) {
    h.update(`[${v.length}`);
    for (const x of v) feed(h, x);
    h.update(']');
  } else if (typeof v === 'object') {
    for (const k of Object.keys(v).sort()) {
      h.update(k);
      feed(h, (v as Record<string, unknown>)[k]);
    }
  } else h.update(typeof v);
}

describe('golden: what every fixed scene evaluates to', () => {
  for (const s of SCENES) {
    it(s.name, () => {
      clearProblems();
      const out: Record<string, string> = {};
      for (const b of s.project.buildings) {
        const ev = evaluateBuilding(b, {}, s.project);
        const h = createHash('sha1');
        feed(h, { shell: ev.shell, parts: ev.parts, faces: ev.faces, warnings: ev.warnings, placements: ev.placements.map((p) => ({ ...p, family: p.family.id })) });
        const tris = ev.shell.indices.length / 3;
        out[b.name] = `${tris} triangles · ${ev.parts.meshes.length} meshes · ${ev.parts.inst.length} instanced · ${ev.placements.length} placed · ${h.digest('hex').slice(0, 12)}`;
      }
      expect(problems()).toEqual([]);
      expect(out).toMatchSnapshot();
    });
  }
});
