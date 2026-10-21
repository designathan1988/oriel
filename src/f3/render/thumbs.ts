// Catalog card thumbnails: each component type is drawn in a
// scene of its own, into a small render target, read back and stored as a PNG
// (object URL). Face parts appear on a wall piece with the opening
// cut and a dark background behind. At most two per frame; the renderer
// state (target, clear color, autoClear) goes back to what it was after each
// drawing.
//
// three r170: the render target comes out in linear color (the output space only
// applies to the screen), so the sRGB conversion is done here, with a table. The
// async read (`readRenderTargetPixelsAsync`) issues readPixels right
// away into a pixel buffer and waits for the GPU only later; the target can be reused
// for the next drawing.
import * as THREE from 'three';
import { flushProc } from './procedural';
import type { RenderContext } from '../../render/context';
import type { Family, Params } from '../families/family';
import { resolveParams } from '../families/family';
import { family as familyById, typeById } from '../families/index';
import { openingProfile } from '../families/shapes';
import type { ComponentType, Project3, Vec3 } from '../model/schema';
import { emptyParts3, FrameSink, identity, type Parts3 } from '../eval/parts';
import { buildPartsMesh } from './parts';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  /** Project types (besides the built-in ones). */
  project?: Pick<Project3, 'types'>;
  /** Color of the backing wall of face parts. */
  wallColor?: string;
}

export interface Thumbnailer {
  /** URL (blob:) of the thumbnail PNG; the same promise for the same key. */
  get(typeId: string, params?: Params, family?: Family | string): Promise<string>;
  dispose(): void;
}

interface Job {
  typeId: string;
  params: Params;
  family: Family | string | undefined;
  resolve(url: string): void;
  reject(e: unknown): void;
}

const PER_FRAME = 2;

/** Linear (0–255) → sRGB (0–255) table. */
const SRGB = (() => {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const l = i / 255;
    t[i] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
  }
  return t;
})();

/** Box of the parts (unit primitive corners and profile vertices). */
function partsBounds(parts: Parts3): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3(),
    m = new THREE.Matrix4();
  for (const it of parts.inst) {
    m.fromArray(it.m);
    for (let k = 0; k < 8; k++) box.expandByPoint(v.set(k & 1 ? 0.5 : -0.5, k & 2 ? 0.5 : -0.5, k & 4 ? 0.5 : -0.5).applyMatrix4(m));
  }
  for (const me of parts.meshes) for (let i = 0; i < me.positions.length; i += 3) box.expandByPoint(v.set(me.positions[i]!, me.positions[i + 1]!, me.positions[i + 2]!));
  return box;
}

export function createThumbnailer(renderer: THREE.WebGLRenderer, ctx: RenderContext, opts: ThumbnailOptions = {}): Thumbnailer {
  const W = opts.width ?? 160,
    H = opts.height ?? 128;
  const target = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(3, 5, 4);
  scene.add(hemi, sun, sun.target);
  const camera = new THREE.PerspectiveCamera(26, W / H, 0.05, 500);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c2d = canvas.getContext('2d');
  const image = c2d ? c2d.createImageData(W, H) : null;
  const cache = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  const queue: Job[] = [];
  const saved = new THREE.Color();
  let raf = 0;
  let disposed = false;

  const schedule = () => {
    if (!raf && !disposed && queue.length) raf = requestAnimationFrame(tick);
  };

  function tick(): void {
    raf = 0;
    for (let i = 0; i < PER_FRAME && queue.length; i++) {
      const job = queue.shift()!;
      try {
        renderJob(job);
      } catch (e) {
        job.reject(e);
      }
    }
    schedule();
  }

  function resolveFamily(job: Job): { fam: Family; type: ComponentType | undefined } {
    const type = typeById(job.typeId, opts.project);
    const fam = typeof job.family === 'object' ? job.family : familyById(typeof job.family === 'string' ? job.family : (type?.family ?? ''));
    if (!fam) throw new Error(`Thumbnail: unknown family for type ${job.typeId}.`);
    return { fam, type };
  }

  /** Family parts in the local frame (with the backing wall for face parts). */
  function buildParts(fam: Family, p: Params): Parts3 {
    const parts = emptyParts3();
    parts.tags.push({ family: fam.id });
    const sink = new FrameSink(parts, identity(), 0);
    const [w, h] = fam.size(p);
    const opening = fam.opening?.(p) ?? null;
    if (fam.host === 'path') {
      const L = Math.max(2, Math.min(6, w * 3));
      const path: Vec3[] = [
        [-L / 2, 0, 0],
        [L / 2, 0, 0],
      ];
      fam.build(p, sink, { length: L, reveal: 0, index: 0, path });
      return parts;
    }
    fam.build(p, sink, { length: w, reveal: opening?.depth ?? 0, index: 0 });
    if (fam.host === 'face') {
      // Wall piece with the opening cut (prism with a hole) and a dark background behind.
      const depth = Math.max(0.2, opening?.depth ?? 0.25);
      const hw = w / 2 + 0.5;
      const top = h + 0.35;
      const wall = { slot: 'wall' as const, color: opts.wallColor ?? '#d8d1c4', finish: 'plaster' };
      const holes = opening ? [openingProfile(opening.shape, opening.w, opening.h, 12)] : [];
      sink.prism(
        wall,
        [
          [-hw, -0.35],
          [hw, -0.35],
          [hw, top],
          [-hw, top],
        ],
        -depth,
        0,
        holes,
      );
      if (opening) sink.box({ slot: 'dark', color: '#15191b' }, [0, opening.h / 2, -depth - 0.02], [opening.w + 0.06, opening.h + 0.06, 0.03]);
    }
    return parts;
  }

  function frameCamera(box: THREE.Box3, face: boolean): void {
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.1, box.getSize(new THREE.Vector3()).length() / 2);
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const dist = (r / Math.sin(Math.min(vf, hf) / 2)) * 0.92;
    // 3/4 view: from the front (z outward on face parts), to the right and from above.
    const d = face ? new THREE.Vector3(0.5, 0.32, 1).normalize() : new THREE.Vector3(1, 0.7, 1.2).normalize();
    camera.position.copy(c).addScaledVector(d, dist);
    camera.near = Math.max(0.01, dist - r * 2);
    camera.far = dist + r * 2;
    camera.lookAt(c);
    camera.updateProjectionMatrix();
  }

  function renderJob(job: Job): void {
    const { fam, type } = resolveFamily(job);
    const p = resolveParams(fam, type?.params, job.params);
    const parts = buildParts(fam, p);
    const mesh = buildPartsMesh(parts, ctx, false);
    const box = partsBounds(parts);
    if (box.isEmpty()) {
      mesh.dispose();
      throw new Error(`Thumbnail: type ${job.typeId} generated no parts.`);
    }
    frameCamera(box, fam.host === 'face');
    scene.add(mesh.group);
    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(saved);
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    try {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear();
      // Procedural textures of the part materials must be baked.
      flushProc();
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(saved, prevAlpha);
      renderer.autoClear = prevAuto;
      scene.remove(mesh.group);
      mesh.dispose();
    }
    const buf = new Uint8Array(W * H * 4);
    const read: Promise<unknown> =
      typeof renderer.readRenderTargetPixelsAsync === 'function'
        ? renderer.readRenderTargetPixelsAsync(target, 0, 0, W, H, buf)
        : Promise.resolve(renderer.readRenderTargetPixels(target, 0, 0, W, H, buf));
    read.then(() => encode(buf)).then(job.resolve, job.reject);
  }

  /** Linear, bottom-up, premultiplied pixels → PNG (URL). */
  function encode(buf: Uint8Array): Promise<string> {
    if (disposed) return Promise.reject(new Error('Thumbnails discarded.'));
    if (!c2d || !image) return Promise.reject(new Error('Thumbnail: 2D canvas unavailable.'));
    const d = image.data;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4,
        dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const a = buf[src + x + 3]!;
        // Antialiased edge over a transparent background: undoes the premultiplication.
        const k = a > 0 ? 255 / a : 0;
        d[dst + x] = SRGB[Math.min(255, Math.round(buf[src + x]! * k))]!;
        d[dst + x + 1] = SRGB[Math.min(255, Math.round(buf[src + x + 1]! * k))]!;
        d[dst + x + 2] = SRGB[Math.min(255, Math.round(buf[src + x + 2]! * k))]!;
        d[dst + x + 3] = a;
      }
    }
    c2d.putImageData(image, 0, 0);
    // toBlob copies the bitmap at call time (HTML, step 3); the canvas can be reused right after.
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Thumbnail: the browser did not produce the image.'));
        const url = URL.createObjectURL(blob);
        if (disposed) {
          URL.revokeObjectURL(url);
          return reject(new Error('Thumbnails discarded.'));
        }
        urls.add(url);
        resolve(url);
      }, 'image/png'),
    );
  }

  return {
    get(typeId, params = {}, fam) {
      if (disposed) return Promise.reject(new Error('Thumbnails discarded.'));
      const famKey = typeof fam === 'object' ? fam.id : (fam ?? '');
      const key = `${typeId}|${famKey}|${JSON.stringify(params)}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const promise = new Promise<string>((resolve, reject) => {
        queue.push({ typeId, params, family: fam, resolve, reject });
        schedule();
      });
      cache.set(key, promise);
      // Failed: leaves the cache so it can be retried.
      promise.catch(() => cache.delete(key));
      return promise;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (const j of queue.splice(0)) j.reject(new Error('Thumbnails discarded.'));
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
      cache.clear();
      target.dispose();
      sun.dispose();
      hemi.dispose();
    },
  };
}
