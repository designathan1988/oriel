// Photographic render: the view as it is (buildings, parts, site, the time of day) path traced, light
// bouncing between the surfaces until the picture converges: soft sun shadows, light coming in by the
// windows and filling the rooms, glass that lets the outside through and reflects, true reflections on
// metal and glossy floors. three-gpu-pathtracer (https://github.com/gkjohnson/three-gpu-pathtracer):
// WebGLPathTracer on the view's own renderer, so the textures the view baked on its GPU (render targets
// of the procedural finishes) are read where they are.
// What the path tracer does not run is converted first: instanced parts become plain meshes, the
// procedural finishes (a detail map decoded in the shader) are baked into colour and roughness maps,
// the window glass (a blending trick) becomes physical glass. The sun is a directional light sampled
// at every bounce (no grain in the sunlight; its real 0.5° disc softens a shadow by 2–3 cm at a few
// metres, sharp at this scale), the sky an image that lights everything else.
import * as THREE from 'three';
import { DenoiseMaterial, ProceduralEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SkyState } from './look';
import { NIGHT, ROOM_LIGHT } from './night';

export interface PhotoOptions {
  /** Samples per pixel to converge to (more: less noise, longer). */
  samples: number;
  /** Light bounces (more: brighter interiors lit only by the windows). */
  bounces?: number;
  /** Exposure of the picture (1: as the view). */
  exposure?: number;
  /** Internal resolution relative to the canvas (2: supersampled, sharper edges). */
  scale?: number;
  /** Edge-preserving smoothing of the remaining noise (strong at first, light at the end). Default on. */
  denoise?: boolean;
  /** Ceiling lights switched on (rooms lit from inside, by night or by day). */
  lights?: PhotoLight[];
}

/** A square ceiling panel of warm light (2700 K), facing down: where (its middle, world) and its side (m). */
export interface PhotoLight {
  at: [number, number, number];
  size: number;
}

export interface PhotoSession {
  /** The exposure the metering added (1: none; 4: two stops more). */
  readonly exposure: number;
  /** Samples rendered so far. */
  readonly samples: number;
  readonly done: boolean;
  /** The picture as it is now (PNG). */
  snapshot(): Promise<Blob>;
  /** Stops and gives the canvas back to the view. */
  stop(): void;
}

/** Sky radiance per unit of the view's sky colours (calibrated with the sun so a facade in shade reads as in a photo). */
const SKY_GAIN = 0.22;
/** A lamp's point light (candela in the view's units, calibrated against the sun) and how many are traced. */
const LAMP_CANDELA = 3;
const MAX_LAMPS = 48;
/** Luminance of a ceiling panel (view units): a lit room reads as warm and bright from outside at night. */
const PANEL_NITS = 12;

/** Log-average luminance a daylight exterior has (the picture is left as it is at or above half of it). */
const KEY = 0.18;

/**
 * How much longer to expose (1 … 12; at most 3 at night, which must stay night): the key over the
 * log-average luminance of the picture. Read back from the first samples in blocks of 8 × 8 pixels
 * averaged first (one sample per pixel is mostly black or bright grain: per pixel, the black pulled the
 * log-average down and a daylight cutaway came out six times too bright).
 */
function meter(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, dark: number): number {
  const w = target.width,
    h = target.height;
  if (!w || !h) return 1;
  const B = 8;
  const bw = Math.ceil(w / B),
    bh = Math.ceil(h / B);
  const sums = new Float64Array(bw * bh),
    counts = new Uint32Array(bw * bh);
  const buf = new Float32Array(w * 4);
  for (let y = 0; y < h; y++) {
    renderer.readRenderTargetPixels(target, 0, y, w, 1, buf);
    const row = Math.floor(y / B) * bw;
    for (let x = 0; x < w; x++) {
      const l = 0.2126 * buf[x * 4]! + 0.7152 * buf[x * 4 + 1]! + 0.0722 * buf[x * 4 + 2]!;
      if (!Number.isFinite(l)) continue;
      const k = row + Math.floor(x / B);
      sums[k] = sums[k]! + l;
      counts[k]!++;
    }
  }
  let sum = 0,
    n = 0;
  for (let k = 0; k < sums.length; k++) {
    if (!counts[k]) continue;
    sum += Math.log(1e-3 + sums[k]! / counts[k]!);
    n++;
  }
  if (!n) return 1;
  const avg = Math.exp(sum / n);
  return avg >= KEY / 2 ? 1 : Math.min(dark > 0.5 ? 3 : 12, KEY / avg);
}

/** The sky of the moment as an equirectangular radiance map (the sun itself is a light of its own). */
function skyTexture(sky: SkyState): ProceduralEquirectTexture {
  const tex = new ProceduralEquirectTexture(1024, 512);
  const sunDir = sky.sunDir.clone().normalize();
  const d = new THREE.Vector3();
  const tmp = new THREE.Color();
  tex.generationCallback = (polar: THREE.Spherical, _uv: THREE.Vector2, _coord: THREE.Vector2, out: THREE.Color) => {
    d.setFromSpherical(polar);
    const h = d.y;
    // The view's sky gradient (render/look.ts SKY_FRAGMENT), then a glow around the sun.
    out.copy(sky.horizon).lerp(sky.zenith, Math.pow(THREE.MathUtils.clamp(h, 0, 1), 0.55));
    tmp.copy(sky.ground);
    out.lerp(tmp, 1 - THREE.MathUtils.smoothstep(h, -0.1, 0.03));
    // A real sky lights the shade less blue than its colour on screen suggests (the view's sky is a backdrop).
    const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
    // At night the picture is exposed as a night photograph is (longer): the moonlit sky reads as dusk blue.
    out.lerp(tmp.setRGB(l, l, l), 0.3).multiplyScalar(SKY_GAIN * (1 + 2 * sky.dark));
    const c = d.dot(sunDir);
    if (sky.dark < 0.5) out.add(tmp.copy(sky.sunColor).multiplyScalar(Math.pow(Math.max(c, 0), 12) * 0.35));
  };
  tex.update();
  return tex;
}

const BAKE_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// The procedural detail decoded as render/look.ts procMaterial does: R luminance, G mask of the second
// colour, B roughness. The colour target is sRGB (8 bits without banding in the darks): the GPU encodes
// on write and decodes on read, so the shader writes linear colour. Roughness in G (glTF rule).
const BAKE_FRAG = `
  uniform sampler2D map;
  uniform vec3 c1;
  uniform vec3 c2;
  uniform float rough;
  uniform int mode;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(map, vUv);
    if (mode == 0) gl_FragColor = vec4(clamp(mix(c1, c2, t.g) * t.r, 0.0, 1.0), 1.0);
    else gl_FragColor = vec4(1.0, clamp(rough * t.b, 0.04, 1.0), 0.0, 1.0);
  }
`;

interface Baker {
  bake(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial;
  dispose(): void;
}

function createBaker(renderer: THREE.WebGLRenderer): Baker {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    uniforms: { map: { value: null }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() }, rough: { value: 1 }, mode: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const targets: THREE.WebGLRenderTarget[] = [];
  const pass = (src: THREE.Texture, mode: number, size: number, srgb: boolean): THREE.Texture => {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    mat.uniforms.mode!.value = mode;
    mat.uniforms.map!.value = src;
    const prev = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.toneMapping = prevTone;
    targets.push(rt);
    const t = rt.texture;
    t.wrapS = src.wrapS;
    t.wrapT = src.wrapT;
    t.repeat.copy(src.repeat);
    t.offset.copy(src.offset);
    t.rotation = src.rotation;
    t.center.copy(src.center);
    t.anisotropy = 8;
    return t;
  };
  return {
    bake(m) {
      const src = m.map!;
      const size = Math.min(1024, (src.image as { width?: number } | undefined)?.width ?? 1024);
      mat.uniforms.c1!.value.copy(m.color);
      mat.uniforms.c2!.value.copy((m.userData.proc as { color2: THREE.Color }).color2);
      mat.uniforms.rough!.value = m.roughness;
      const out = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        map: pass(src, 0, size, true),
        roughnessMap: pass(src, 1, size, false),
        roughness: 1,
        metalness: m.metalness,
        normalMap: m.normalMap,
        normalScale: m.normalScale.clone(),
        side: m.side,
      });
      out.name = m.name;
      return out;
    },
    dispose() {
      for (const t of targets) t.dispose();
      mat.dispose();
      quad.geometry.dispose();
    },
  };
}

/** Physical window glass: clear, thin, reflecting at grazing angles (Fresnel), the outside seen through. */
function glassFor(m: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  const g = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(m.color).lerp(new THREE.Color('#ffffff'), 0.7),
    roughness: 0.02,
    metalness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: 0.006,
    side: THREE.DoubleSide,
  });
  g.name = m.name;
  return g;
}

/** A float array that grows as triangles are added. */
class Grow {
  a = new Float32Array(1 << 12);
  n = 0;
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  get array(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

/**
 * The scene to trace: every visible mesh under `roots` with a material the path tracer runs, instances
 * expanded, merged into one mesh per material in world space (the path tracer gives up on scenes of
 * thousands of meshes: its material index is per mesh). Interface meshes (lines, sprites) are left out.
 */
function photoScene(roots: THREE.Object3D[], baker: Baker, sky: SkyState): { scene: THREE.Scene; created: { dispose(): void }[] } {
  const scene = new THREE.Scene();
  const created: { dispose(): void }[] = [];
  const mats = new Map<THREE.Material, THREE.Material | null>();
  const night = sky.dark > 0.05;
  const convert = (m: THREE.Material): THREE.Material | null => {
    let c = mats.get(m);
    if (c !== undefined) return c;
    const s = m as THREE.MeshStandardMaterial;
    if (!s.isMeshStandardMaterial || !m.visible || (m.transparent && m.opacity < 0.02 && !s.userData.windowGlass)) c = null;
    else if (s.userData.windowGlass) c = glassFor(s);
    else if (s.userData.proc && s.map) c = baker.bake(s);
    else if (s.userData.lamp) {
      // The glowing part of a lamp: seen, it glows; its light comes from a point light inside it, which
      // it lets through (castShadow, read per material by the path tracer).
      c = s.clone();
      (c as THREE.MeshStandardMaterial).emissiveIntensity = sky.dark * NIGHT.lamp;
      Object.assign(c, { castShadow: false });
    } else c = m;
    // The user's texture size and turn (render/look.ts uvTransform, done there in the shader): put into
    // each map's own transform, on copies of the shared textures.
    const xf = s.userData?.uvXf as THREE.Matrix3 | undefined;
    if (c && xf) {
      const baked = c !== m && !!s.userData.proc;
      if (c === m) c = s.clone();
      const cm = c as THREE.MeshStandardMaterial;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'bumpMap'] as const) {
        const t = cm[k];
        if (!t) continue;
        const own = baked ? t : t.clone();
        own.updateMatrix();
        own.matrix.premultiply(xf);
        own.matrixAutoUpdate = false;
        cm[k] = own;
        if (!baked) created.push(own);
      }
    }
    if (c && c !== m) created.push(c);
    mats.set(m, c);
    return c;
  };
  // A room seen through the window (finish 'interior'): lit at night by the same draw as the view (the
  // share of the people awake at this hour), the warm light it sends out of the window.
  const litRooms = new Map<THREE.Material, THREE.Material>();
  const litRoom = (m: THREE.Material): THREE.Material => {
    let c = litRooms.get(m);
    if (!c) {
      const l = (m as THREE.MeshStandardMaterial).clone();
      l.onBeforeCompile = () => {};
      l.emissive.copy(ROOM_LIGHT);
      l.emissiveIntensity = NIGHT.window * 0.78 * sky.dark;
      litRooms.set(m, (c = l));
      created.push(l);
    }
    return c;
  };
  /** Lamps lit at night: where their light comes from (the middle of each glowing part) and its colour. */
  const lamps: { at: THREE.Vector3; color: THREE.Color }[] = [];
  const lampBox = new THREE.Box3();
  const buckets = new Map<THREE.Material, { pos: Grow; nor: Grow; uv: Grow }>();
  const bucket = (m: THREE.Material) => {
    let b = buckets.get(m);
    if (!b) buckets.set(m, (b = { pos: new Grow(), nor: new Grow(), uv: new Grow() }));
    return b;
  };
  const p = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const addMesh = (mesh: THREE.Mesh, matrix: THREE.Matrix4, lift: number) => {
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    if (!g.attributes.normal) g.computeVertexNormals();
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const uv = g.attributes.uv as THREE.BufferAttribute | undefined;
    const idx = g.index;
    nm.getNormalMatrix(matrix);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const total = idx ? idx.count : pos.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    const r0 = Math.max(0, g.drawRange.start),
      r1 = Math.min(total, g.drawRange.start + g.drawRange.count);
    const roomAttr = g.attributes.aRoom as THREE.BufferAttribute | undefined;
    for (const gr of groups) {
      const src = list[gr.materialIndex ?? 0];
      const mat = src ? convert(src) : null;
      if (!mat) continue;
      const lamp = night && !!src!.userData.lamp;
      const room = night && !!src!.userData.room && roomAttr ? litRoom(src!) : null;
      if (lamp) lampBox.makeEmpty();
      const plain = bucket(mat);
      const s0 = Math.max(r0, gr.start),
        s1 = Math.min(r1, gr.start + gr.count);
      for (let i = s0; i + 2 < s1; i += 3) {
        const v0 = idx ? idx.getX(i) : i;
        const b = room && roomAttr!.getX(v0) <= sky.awake ? bucket(room) : plain;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(i + k) : i + k;
          p.fromBufferAttribute(pos, v).applyMatrix4(matrix);
          if (lamp) lampBox.expandByPoint(p);
          b.pos.push3(p.x, p.y + lift, p.z);
          p.fromBufferAttribute(nor, v).applyMatrix3(nm).normalize();
          b.nor.push3(p.x, p.y, p.z);
          if (uv) b.uv.push3(uv.getX(v), uv.getY(v), 0);
          else b.uv.push3(0, 0, 0);
        }
      }
      if (lamp && !lampBox.isEmpty()) lamps.push({ at: lampBox.getCenter(new THREE.Vector3()), color: (src as THREE.MeshStandardMaterial).emissive.clone() });
    }
  };
  const inst = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as unknown as THREE.BatchedMesh).isBatchedMesh || o.userData.noPhoto) return;
      const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Coplanar layers drawn with a polygon offset in the view (lawn, asphalt on the ground) are lifted
      // a few millimetres instead: the path tracer has no depth offset.
      const po = src.find((x) => x.polygonOffset);
      const lift = po ? -po.polygonOffsetFactor * 0.004 : 0;
      if (o.name === 'ground') {
        // The view's ground is a disc of a few kilometres in a handful of long triangles: traced, the
        // hit points on them lose precision (speckled light). A grid of small squares instead.
        const grid = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 60, 60).rotateX(-Math.PI / 2), mesh.material);
        grid.position.y = mesh.position.y;
        grid.updateMatrixWorld();
        addMesh(grid, grid.matrixWorld, 0);
        grid.geometry.dispose();
        return;
      }
      const im = mesh as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, inst);
          addMesh(mesh, world.multiplyMatrices(mesh.matrixWorld, inst), lift);
        }
      } else addMesh(mesh, mesh.matrixWorld, lift);
    });
  }
  for (const [mat, b] of buckets) {
    if (!b.pos.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos.array, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.nor.array, 3));
    const uv3 = b.uv.array;
    const uv2 = new Float32Array((uv3.length / 3) * 2);
    for (let i = 0, j = 0; i < uv3.length; i += 3, j += 2) {
      uv2[j] = uv3[i]!;
      uv2[j + 1] = uv3[i + 1]!;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
    // Normal maps need tangents in the path tracer as in the view (computed from the UVs there).
    created.push(g);
    scene.add(new THREE.Mesh(g, mat));
  }
  // Every light is drawn in turn (one per sample at each bounce): past a few dozen, the nearest ones to
  // the camera would do as well; a street of lamps stays under the limit.
  for (const l of lamps.slice(0, MAX_LAMPS)) {
    const light = new THREE.PointLight(l.color, LAMP_CANDELA * sky.dark, 0, 2);
    light.position.copy(l.at);
    scene.add(light);
  }
  return { scene, created };
}

/**
 * Starts the photographic render of `roots` seen by `camera`, on `renderer`'s canvas (the caller stops
 * drawing the view meanwhile). `onSample` follows the progress.
 */
export function startPhoto(renderer: THREE.WebGLRenderer, roots: THREE.Object3D[], camera: THREE.Camera, sky: SkyState, opts: PhotoOptions, onSample?: (n: number, done: boolean) => void): PhotoSession {
  const baker = createBaker(renderer);
  const { scene, created } = photoScene(roots, baker, sky);
  const env = skyTexture(sky);
  scene.environment = env;
  scene.background = env;
  // The sun (the moon at night): the view's own light, its direction and strength.
  const sun = new THREE.DirectionalLight(sky.sunColor, sky.sunIntensity);
  sun.position.copy(sky.sunDir).normalize().multiplyScalar(100);
  scene.add(sun, sun.target);
  for (const l of opts.lights ?? []) {
    const panel = new THREE.RectAreaLight(ROOM_LIGHT, PANEL_NITS, l.size, l.size);
    panel.position.set(...l.at);
    panel.lookAt(l.at[0], l.at[1] - 1, l.at[2]);
    scene.add(panel);
  }
  const prev = { tone: renderer.toneMapping, exposure: renderer.toneMappingExposure };
  // The view's tone mapping (Khronos PBR Neutral keeps the material colours), its exposure adjustable.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  const pt = new WebGLPathTracer(renderer);
  pt.bounces = opts.bounces ?? 6;
  pt.filterGlossyFactor = 0.5;
  pt.minSamples = 1;
  pt.renderDelay = 0;
  pt.fadeDuration = 0;
  pt.rasterizeScene = false;
  pt.dynamicLowRes = false;
  pt.renderScale = opts.scale ?? 1;
  pt.tiles.set(2, 2);
  pt.textureSize.set(512, 512);
  if (opts.denoise !== false) {
    // glslSmartDeNoise (three-gpu-pathtracer DenoiseMaterial) on the way to the canvas, before tone mapping:
    // strong while the picture is young, light once it has converged (detail kept, grain gone).
    const dn = new DenoiseMaterial({ sigma: 4, kSigma: 1, threshold: 0.08 });
    const quad = new FullScreenQuad(dn);
    created.push(dn, { dispose: () => quad.dispose() });
    pt.renderToCanvasCallback = (target, r) => {
      const k = Math.min(1, pt.samples / Math.max(1, opts.samples));
      dn.uniforms.map!.value = target.texture;
      dn.uniforms.sigma!.value = 4 - 2 * k;
      dn.uniforms.threshold!.value = 0.4 - 0.3 * k;
      const auto = r.autoClear;
      r.autoClear = false;
      quad.render(r);
      r.autoClear = auto;
    };
  }
  pt.setScene(scene, camera);
  let raf = 0;
  let stopped = false;
  let done = false;
  let shot: ((b: Blob) => void)[] = [];
  let metered = false;
  const user = opts.exposure ?? 1;
  const loop = () => {
    if (stopped) return;
    if (!done) {
      pt.renderSample();
      // Metering, as a camera does: once the first four samples cover the picture, a view much darker than
      // a daylight exterior (a room lit by its windows, a street at night) gets a longer exposure.
      if (!metered && pt.samples >= Math.min(4, opts.samples)) {
        metered = true;
        const k = meter(renderer, pt.target, sky.dark);
        renderer.toneMappingExposure = user * k;
        autoExposure = k;
      }
      if (pt.samples >= opts.samples) done = true;
      onSample?.(Math.floor(pt.samples), done);
    } else if (shot.length) pt.renderSample();
    // Read right after drawing, in the same task: the canvas still holds the picture.
    if (shot.length) {
      const waiting = shot;
      shot = [];
      renderer.domElement.toBlob((b) => b && waiting.forEach((f) => f(b)), 'image/png');
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  let autoExposure = 1;
  return {
    get exposure() {
      return autoExposure;
    },
    get samples() {
      return Math.floor(pt.samples);
    },
    get done() {
      return done;
    },
    snapshot: () => new Promise<Blob>((ok) => shot.push(ok)),
    stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        pt.dispose();
      } catch {
        // three-gpu-pathtracer 0.0.23 on three r170: a part of its dispose reads a missing object; the GPU
        // resources it holds go with the path tracer object.
      }
      env.dispose();
      for (const c of created) c.dispose();
      baker.dispose();
      renderer.toneMapping = prev.tone;
      renderer.toneMappingExposure = prev.exposure;
    },
  };
}
