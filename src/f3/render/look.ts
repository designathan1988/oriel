// FORMA 3 look, in the spirit of the game (Roadcraft src/render/environment.ts and
// postprocess.ts): a gradient sky that is also the environment map
// (glass and metal reflect the sky), a dominant side sun with a soft
// shadow and a weak fill sky (the ratio is what models the volume),
// GTAO ambient occlusion at half resolution reading the depth already drawn,
// MSAA and tone mapping. Materials with bump from the textures.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { extraKey, type MaterialKey } from '../../geometry/parts';
import { foliageMeshes } from './foliage';
import { createRenderContext, type RenderContext } from '../../render/context';
import { DETAIL_MEAN, disposePbr, pbrFor } from './pbr';
import { disposeProc, procFor, type ProcTextures } from './procedural';
import { imageTexture, tiledImage } from './images';
import { finishOf } from './finishes';
import { awakeShare, curtainMaterial, lampMaterial, NIGHT, nightUniforms, roomMaterial, setLampLevel } from './night';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const SKY_VERTEX = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w;
  }
`;

const SKY_FRAGMENT = `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  void main() {
    float h = vDir.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
    sky = mix(uGround, sky, smoothstep(-0.1, 0.03, h));
    float sun = max(dot(normalize(vDir), uSunDir), 0.0);
    sky += uSunColor * (pow(sun, 8.0) * 0.22 + pow(sun, 160.0) * 0.8);
    gl_FragColor = vec4(sky, 1.0);
  }
`;

/** Sun elevation and azimuth: high enough not to stretch the shadows too much, sideways to model.  */
const SUN_ELEVATION = (46 * Math.PI) / 180;
const SUN_AZIMUTH = (-62 * Math.PI) / 180;

export interface Look {
  sun: THREE.DirectionalLight;
  /** Points the shadow where the camera looks. */
  follow(target: THREE.Vector3, span: number): void;
  setSize(w: number, h: number): void;
  /** The camera the passes draw with (perspective or parallel). */
  setCamera(camera: THREE.Camera): void;
  /** What carries the selection outline (screen space, OutlinePass); empty = none. */
  setOutline(objects: THREE.Object3D[]): void;
  render(): void;
  setAO(on: boolean): void;
  /** Size of the sun's shadow map (texels a side): sharper and costlier as it grows. */
  setShadowSize(n: number): void;
  /** Region where ambient occlusion acts (the buildings plus a margin); outside it, none (far ground and horizon stay clean). */
  setAOBox(box: THREE.Box3 | null): void;
  /**
   * Time of day (0–24): sun, sky, sky reflection, diffuse light, bloom and the
   * night lights. Returns how dark it is (0 day, 1 night).
   */
  setTime(hour: number, real?: { altitude: number; dir: [number, number, number] }): number;
  /**
   * Compiles an object's shader programs without blocking, in the variant the scene pass uses: the
   * composer's target (linear output, no tone mapping). Compiled for the screen instead, the real
   * variant still compiled on first draw and blocked the frame.
   */
  compileAsync(obj: THREE.Object3D): Promise<unknown>;
  /** The sky and the sun as they are now (the photographic render rebuilds its light from them). */
  skyState(): SkyState;
  dispose(): void;
}

export interface SkyState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  /** Toward the sun (or the moon at night), and its color and strength (DirectionalLight intensity). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** 0 by day, 1 at night. */
  dark: number;
  /** Share of the rooms lit at this hour (render/night.ts). */
  awake: number;
}

export function createLook(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): Look {
  // Neutral (Khronos PBR): keeps the material colors (AgX washed everything gray).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const sunDir = new THREE.Vector3(Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH), Math.sin(SUN_ELEVATION), Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH)).normalize();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color('#5d8fcf') },
      uHorizon: { value: new THREE.Color('#d6e3ec') },
      uGround: { value: new THREE.Color('#b9b4a6') },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color('#fff1d6') },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.name = 'sky';
  sky.userData.noAO = true;
  // WebGLRenderer.renderObject (r170) builds modelViewMatrix from matrixWorld right after this callback:
  // without updating it here the sky lagged one frame behind the camera (a ground-colored band above the horizon).
  sky.onBeforeRender = (_r, _s, cam) => {
    sky.position.copy(cam.position);
    sky.updateMatrixWorld();
  };
  sky.scale.setScalar(900);
  scene.add(sky);
  scene.background = null;

  // The sky becomes the environment map (reflections on glass, metal and roof tiles);
  // rebuilt when the time changes (glass reflects the night sky at night).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const probe = new THREE.Scene();
  const probeMat = skyMat.clone();
  const probeSky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), probeMat);
  probe.add(probeSky);
  let env = pmrem.fromScene(probe, 0, 0.1, 100);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  const rebuildEnv = () => {
    for (const k of ['uZenith', 'uHorizon', 'uGround', 'uSunColor'] as const) (probeMat.uniforms[k]!.value as THREE.Color).copy(skyMat.uniforms[k]!.value as THREE.Color);
    (probeMat.uniforms.uSunDir!.value as THREE.Vector3).copy(skyMat.uniforms.uSunDir!.value as THREE.Vector3);
    const next = pmrem.fromScene(probe, 0, 0.1, 100);
    env.dispose();
    env = next;
    scene.environment = env.texture;
  };

  let lastDark = 0;
  const hemi = new THREE.HemisphereLight('#e9e6dc', '#6d6b58', 0.75);
  const sun = new THREE.DirectionalLight('#fff0d8', 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.08;
  sun.shadow.radius = 3;
  scene.add(hemi, sun, sun.target);

  // Post-processing: scene into an MSAA target with depth → GTAO → output.
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(Math.max(1, size.x * ratio), Math.max(1, size.y * ratio), {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(Math.max(1, size.x * ratio), Math.max(1, size.y * ratio)),
    samples: Math.min(4, renderer.capabilities.maxSamples),
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(size.x, size.y);
  const scenePass = new RenderPass(scene, camera);
  composer.addPass(scenePass);
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  // In meters: ~0.6 m creases (eaves, sills, volume junctions).
  gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.9;
  {
    // GTAO renders its own G-buffer (real normals and depth, half resolution), the GTAOPass
    // default: reusing the scene depth made it rebuild normals from depth, and on the ground
    // they came out stepped (horizontal occlusion bands under the buildings).
    // Interface overlays (hover veil, outlines, handles, pivot: userData.noAO) stay out of that pass:
    // a translucent veil drawn as a solid surface there turned the hovered building almost black.
    const draw = gtao.render.bind(gtao);
    gtao.render = (...args: Parameters<GTAOPass['render']>) => {
      const hidden: THREE.Object3D[] = [];
      for (const o of scene.children)
        if (o.userData.noAO && o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      for (const o of foliageMeshes)
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      draw(...args);
      for (const o of hidden) o.visible = true;
    };
    const resize = gtao.setSize.bind(gtao);
    gtao.setSize = (w: number, h: number) => resize(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    gtao.setSize(size.x * ratio, size.y * ratio);
  }
  composer.addPass(gtao);
  // Selection outline in screen space (three's OutlinePass): the silhouette of what is selected, strong
  // where it shows and faint behind other buildings; off (and free) while nothing is selected.
  const outline = new OutlinePass(new THREE.Vector2(size.x, size.y), scene, camera, []);
  // Linear colours (the output pass brightens them): a deep orange reads as the accent on screen.
  outline.visibleEdgeColor.set('#e04a00');
  outline.hiddenEdgeColor.set('#7a4a2a');
  outline.edgeStrength = 7;
  outline.edgeThickness = 1;
  outline.edgeGlow = 0;
  outline.enabled = false;
  composer.addPass(outline);
  // Bloom only at night and only above 1.05 (lamps), as in the game.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), NIGHT.bloomStrength, NIGHT.bloomRadius, NIGHT.bloomThreshold);
  bloom.enabled = false;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const lastT = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0),
    shadowX = new THREE.Vector3(),
    shadowY = new THREE.Vector3(),
    snapped = new THREE.Vector3(),
    shadowDir = new THREE.Vector3();
  let shadowSpan = 0;
  let lastSpan = 60;
  const C = (h: string) => new THREE.Color(h);
  const SKY = {
    zenith: [C('#5d8fcf'), C('#46588a'), C('#0d1830')],
    horizon: [C('#d6e3ec'), C('#f2a56a'), C('#2a3552')],
    ground: [C('#b9b4a6'), C('#6e5d52'), C('#1b1e24')],
  };
  const mix3 = (set: THREE.Color[], dark: number, dusk: number, out: THREE.Color) => out.copy(set[0]!).lerp(set[2]!, dark).lerp(set[1]!, dusk * (1 - dark * 0.6));

  return {
    sun,
    follow(t, span) {
      lastT.copy(t);
      lastSpan = span;
      const d = 220;
      // No shimmering shadow edges while navigating (Microsoft, "Common Techniques to Improve Shadow
      // Depth Maps", moving the light in texel-sized increments): the projection size only takes
      // discrete steps and the light frustum moves in whole shadow-map texels.
      const s = Math.min(240, 30 * 2 ** Math.ceil(Math.log2(Math.max(30, span) / 30)));
      const texel = (2 * s) / sun.shadow.mapSize.x;
      // Normal offset (three.js LightShadow.normalBias): the shadow lookup moves out along the smooth normal.
      // A curved wall is drawn smooth but casts its shadow with its flat segments, so where the sun grazes
      // them one segment shadowed the next: a hard vertical step down the wall (audit D6). 8 cm clears the
      // segments of the arcs (their sagitta is a couple of centimetres) and keeps the contact at the foot;
      // never under 1.5 shadow texels when the map covers more ground.
      sun.shadow.normalBias = Math.max(0.08, 1.5 * texel);
      shadowX.crossVectors(UP, sunDir).normalize();
      shadowY.crossVectors(sunDir, shadowX);
      const a = Math.floor(t.dot(shadowX) / texel) * texel,
        b = Math.floor(t.dot(shadowY) / texel) * texel;
      snapped.copy(shadowX).multiplyScalar(a).addScaledVector(shadowY, b).addScaledVector(sunDir, t.dot(sunDir));
      if (snapped.equals(sun.target.position) && s === shadowSpan && sunDir.equals(shadowDir)) return;
      shadowSpan = s;
      shadowDir.copy(sunDir);
      sun.position.copy(snapped).addScaledVector(sunDir, d);
      sun.target.position.copy(snapped);
      sun.target.updateMatrixWorld();
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: d * 2 });
      sun.shadow.camera.updateProjectionMatrix();
      renderer.shadowMap.needsUpdate = true;
    },
    setCamera(cam) {
      camera = cam as THREE.PerspectiveCamera;
      scenePass.camera = cam;
      gtao.camera = cam;
      outline.renderCamera = cam;
      gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = (cam as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
      gtao.gtaoMaterial.needsUpdate = true;
    },
    setOutline(objects) {
      outline.selectedObjects = objects;
      outline.enabled = objects.length > 0;
    },
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    compileAsync(obj) {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const mats = renderer.compile(obj, camera, scene) as unknown as Set<THREE.Material>;
      renderer.setRenderTarget(prev);
      // Ready when every program of these materials is (WebGLRenderer.compileAsync looks only at each
      // material's current program: a material shared by a building's own mesh and a batch reported
      // ready while the batch variant was still linking, and that first draw blocked 56 ms).
      return new Promise<void>((resolve) => {
        const check = () => {
          for (const m of mats) {
            const programs = (renderer.properties.get(m) as { programs?: Map<string, { isReady(): boolean }> }).programs;
            if (programs) for (const prog of programs.values()) if (!prog.isReady()) return void setTimeout(check, 10);
          }
          resolve();
        };
        check();
      });
    },
    render() {
      composer.render();
    },
    setAO(on) {
      gtao.enabled = on;
    },
    setShadowSize(n) {
      if (sun.shadow.mapSize.x === n) return;
      sun.shadow.mapSize.set(n, n);
      // A new map at the new size on the next shadow pass (three.js makes it when the map is null).
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      renderer.shadowMap.needsUpdate = true;
    },
    setAOBox(box) {
      gtao.setSceneClipBox(box as THREE.Box3); // null turns the clip off (GTAOPass.setSceneClipBox)
    },
    skyState() {
      return {
        zenith: (skyMat.uniforms.uZenith!.value as THREE.Color).clone(),
        horizon: (skyMat.uniforms.uHorizon!.value as THREE.Color).clone(),
        ground: (skyMat.uniforms.uGround!.value as THREE.Color).clone(),
        sunDir: sunDir.clone(),
        sunColor: sun.color.clone(),
        sunIntensity: sun.intensity,
        dark: lastDark,
        awake: nightUniforms.uAwake.value,
      };
    },
    setTime(hour, real) {
      const h = ((hour % 24) + 24) % 24;
      // Sun height: > 0 by day; the azimuth moves from east to west. With a real sun (model/sun.ts: date,
      // place and north), its altitude decides day and dusk and its direction lights the scene.
      const s = real ? Math.sin((real.altitude * Math.PI) / 180) : Math.sin((Math.PI * (h - 6)) / 12);
      const dark = THREE.MathUtils.clamp((0.1 - s) / 0.28, 0, 1);
      const dusk = THREE.MathUtils.clamp(1 - Math.abs(s) / 0.32, 0, 1);
      const az = SUN_AZIMUTH + ((h - 12) / 12) * 1.3;
      const el = dark > 0.5 ? (50 * Math.PI) / 180 : Math.max(0.06, SUN_ELEVATION * Math.max(0.12, s));
      const azUse = dark > 0.5 ? az + Math.PI : az;
      sunDir.set(Math.cos(el) * Math.sin(azUse), Math.sin(el), Math.cos(el) * Math.cos(azUse)).normalize();
      if (real && dark <= 0.5) sunDir.set(real.dir[0], Math.max(0.06, real.dir[1]), real.dir[2]).normalize();
      // Warm low sun late in the afternoon; cold weak moon at night.
      if (dark > 0.5) {
        sun.color.set('#9db2e0');
        sun.intensity = 0.55;
      } else {
        sun.color.set('#ff9e5c').lerp(C('#fff0d8'), THREE.MathUtils.smoothstep(s, 0, 0.5));
        sun.intensity = 3.4 * THREE.MathUtils.smoothstep(s, -0.06, 0.28) * (1 - dark);
      }
      mix3(SKY.zenith, dark, dusk, skyMat.uniforms.uZenith!.value as THREE.Color);
      mix3(SKY.horizon, dark, dusk, skyMat.uniforms.uHorizon!.value as THREE.Color);
      mix3(SKY.ground, dark, dusk, skyMat.uniforms.uGround!.value as THREE.Color);
      (skyMat.uniforms.uSunColor!.value as THREE.Color).copy(dark > 0.5 ? C('#1b2238') : sun.color);
      (skyMat.uniforms.uSunDir!.value as THREE.Vector3).copy(sunDir);
      hemi.intensity = 0.75 * (1 - dark) + 0.32 * dark;
      hemi.color.set('#e9e6dc').lerp(C('#33415f'), dark);
      hemi.groundColor.set('#6d6b58').lerp(C('#14161a'), dark);
      scene.environmentIntensity = 0.55 * (1 - dark) + 0.16 * dark;
      nightUniforms.uDark.value = dark;
      nightUniforms.uAwake.value = awakeShare(h);
      setLampLevel(dark);
      lastDark = dark;
      bloom.enabled = dark > 0.15;
      rebuildEnv();
      this.follow(lastT, lastSpan);
      return dark;
    },
    dispose() {
      composer.dispose();
      gtao.dispose();
      target.dispose();
      env.dispose();
      pmrem.dispose();
      probeSky.geometry.dispose();
      probeMat.dispose();
      bloom.dispose();
      sky.geometry.dispose();
      skyMat.dispose();
      scene.remove(sky, hemi, sun, sun.target);
    },
  };
}

/**
 * Window glass in one pass, premultiplied alpha: the reflection (sky and sun)
 * adds at full strength and what is behind is attenuated by the alpha, which
 * grows with Fresnel (at grazing angles glass becomes a mirror). Plain opacity
 * dimmed the reflection too (three.js #15941).
 */
function windowGlass(m: THREE.MeshStandardMaterial, color: string): void {
  m.color.set(color);
  m.roughness = 0.04;
  m.metalness = 0;
  m.envMapIntensity = 1.6;
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendEquation = THREE.AddEquation;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float glassNv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
       float glassF = pow(1.0 - glassNv, 5.0);
       float glassA = mix(0.22, 1.0, glassF);
       gl_FragColor = vec4(totalSpecular + totalDiffuse * glassA, glassA);`,
    );
  };
  m.customProgramCacheKey = () => 'forma-window-glass';
  m.userData.windowGlass = true;
}

/**
 * Procedural material: the detail carries luminance (R), the 2nd color mask (G)
 * and roughness (B); the main and 2nd colors belong to the material.
 */
/**
 * The user's texture size and turn: every map's coordinates scaled and turned in the vertex shader after
 * the finish's own repeat (one material, the shared textures untouched). The photographic render reads
 * the same transform from userData.uvXf.
 */
function uvTransform(m: THREE.MeshStandardMaterial, scale: number, deg: number): void {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a) / scale,
    s = Math.sin(a) / scale;
  const xf = new THREE.Matrix3().set(c, s, 0, -s, c, 0, 0, 0, 1);
  m.userData.uvXf = xf;
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.call(m);
  const maps = ['Map', 'NormalMap', 'RoughnessMap', 'BumpMap', 'EmissiveMap', 'MetalnessMap', 'AoMap'];
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uUvXf = { value: xf };
    sh.vertexShader =
      'uniform mat3 uUvXf;\n' +
      sh.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>\n${maps.map((n) => `#ifdef USE_${n.toUpperCase()}\n  v${n}Uv = (uUvXf * vec3(v${n}Uv, 1.0)).xy;\n#endif`).join('\n')}`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|uvxf`;
}

function procMaterial(m: THREE.MeshStandardMaterial, key: MaterialKey, t: ProcTextures): void {
  m.map = t.detail;
  m.normalMap = t.normal;
  m.normalScale.set(1, 1);
  m.bumpMap = null;
  m.roughnessMap = null;
  m.roughness = 1;
  m.color.set(key.color).multiplyScalar(1 / 0.8);
  const c2 = { value: new THREE.Color(key.color2 ?? t.def.color2).multiplyScalar(1 / 0.8) };
  // How the detail decodes, for the photographic render (render/pathtrace.ts bakes it into plain maps).
  m.userData.proc = { color2: c2.value };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uColor2 = c2;
    sh.fragmentShader =
      'uniform vec3 uColor2;\n' +
      sh.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
  vec4 procT = texture2D( map, vMapUv );
  diffuseColor.rgb = mix( diffuseColor.rgb, uColor2, procT.g ) * procT.r;
#endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness;
#ifdef USE_MAP
  roughnessFactor *= texture2D( map, vMapUv ).b;
#endif`,
        );
  };
  m.customProgramCacheKey = () => 'forma-proc';
}

/**
 * Render context with rich materials: real PBR textures (color, normal,
 * roughness) per finish, physical window glass, glossy metal and dark interiors
 * (by day, a room seen from outside is much darker than the facade; the sky
 * light does not get fully in).
 */
export function createLookContext(): RenderContext {
  const base = createRenderContext();
  const extra = new Map<string, THREE.MeshStandardMaterial>();
  const adjustedMats: THREE.MeshStandardMaterial[] = [];
  return {
    ...base,
    boxGeometry: base.boxGeometry,
    modules: base.modules,
    material(key: MaterialKey) {
      const id = `${key.role}|${key.color}|${key.roughness}|${key.metalness ?? 0}|${key.doubleSide ? 2 : 1}|${key.texture ?? ''}|${key.textureScale ?? 1}|${key.finish ?? ''}|${key.color2 ?? ''}|${key.params ?? ''}|${key.image ?? ''}|${key.lamp ? 1 : 0}|${key.curtain ? 1 : 0}|${key.foliage ?? ''}${extraKey(key)}`;
      let m = extra.get(id);
      if (m) return m;
      m = base.material(key);
      // Adjusted by the user: a material of its own (the base one is shared by the same colour and gloss).
      if (extraKey(key)) {
        m = m.clone();
        adjustedMats.push(m);
      }
      const pbr = key.texture && key.finish ? pbrFor(key.finish) : null;
      const proc = key.texture && key.finish && !pbr ? procFor(key.finish, key.params ? (Object.fromEntries(JSON.parse(key.params) as [string, number][]) as Record<string, number>) : undefined) : null;
      if (key.image !== undefined && key.imageTile) {
        m.map = tiledImage(key.image, key.imageTile);
        m.name = 'image';
      } else if (key.image !== undefined) {
        m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.65, map: imageTexture(key.image) });
        m.name = 'image';
      } else if (key.role === 'glass' && key.roughness < 0.1) windowGlass(m, key.color);
      else if (key.role === 'glass') {
        // Glass with nothing behind (roof, curtain wall): opaque and mirrored.
        m.color.set(key.color).multiplyScalar(0.6);
        m.roughness = 0.06;
        m.metalness = 0.7;
        m.envMapIntensity = 1.5;
      } else if (key.finish === 'hollowWall') {
        // Room side of a wall in the interior view: casts only when it faces the sun. With the
        // default back-face shadow pass, the room sides of the hidden near walls would still
        // darken the rooms they no longer close (three.js Material.shadowSide).
        m.shadowSide = THREE.FrontSide;
      } else if (key.finish === 'interior') {
        m.roughness = 1;
        m.envMapIntensity = 0.12;
        roomMaterial(m);
      } else if (proc) procMaterial(m, key, proc);
      else if (pbr) {
        m.map = pbr.map;
        m.normalMap = pbr.normalMap;
        m.normalScale.set(pbr.set.normalScale, pbr.set.normalScale);
        m.roughnessMap = pbr.roughnessMap;
        m.roughness = Math.min(1, key.roughness + 0.1);
        m.bumpMap = null;
        // The stored detail has mean DETAIL_MEAN: the color compensates.
        m.color.set(key.color).multiplyScalar(1 / DETAIL_MEAN);
      }
      if ((key.metalness ?? 0) > 0.3 && key.role !== 'glass') m.envMapIntensity = 1.2;
      if (key.uvScale || key.uvRot) uvTransform(m, key.uvScale ?? 1, key.uvRot ?? 0);
      // A procedural finish keeps its gloss in its texture: the user's roughness scales it.
      if (proc && key.finish && Math.abs(key.roughness - finishOf(key.finish).roughness) > 1e-6) m.roughness = key.roughness / finishOf(key.finish).roughness;
      if (key.glow) {
        m.emissive.set(key.color);
        m.emissiveIntensity = key.glow;
        if (m.map && !proc) m.emissiveMap = m.map;
      }
      if (key.opacity !== undefined && key.opacity < 1) {
        m.transparent = true;
        m.opacity = key.opacity;
        m.depthWrite = key.opacity > 0.6;
      }
      if (key.lamp) lampMaterial(m, key.color);
      if (key.curtain) curtainMaterial(m);
      m.needsUpdate = true;
      extra.set(id, m);
      return m;
    },
    owns: base.owns,
    dispose() {
      extra.clear();
      for (const a of adjustedMats) a.dispose();
      adjustedMats.length = 0;
      base.dispose();
      disposePbr();
      disposeProc();
    },
  };
}
