// Night: the same numbers as the game (Roadcraft src/render/lightLevels.ts and
// buildings/kit.ts), so what comes out of the builder matches the city.
//  - Fraction of lit rooms per hour = people awake (ATUS 2007-11, BLS
//    table A-3); the light follows active occupancy when it gets dark
//    (Richardson et al. 2009).
//  - A lit room seen through the glass with luminance 0.72, BELOW the bloom
//    threshold (1.05): above it the city became a halo. A lamp at 2.4 glows.
import * as THREE from 'three';

const AWAKE_BY_HOUR = [
  0.174, 0.095, 0.063, 0.051, 0.082, 0.146, 0.34, 0.579, 0.755, 0.864, 0.924, 0.951,
  0.964, 0.959, 0.958, 0.961, 0.964, 0.97, 0.975, 0.973, 0.95, 0.855, 0.628, 0.349,
];

export function awakeShare(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const a = AWAKE_BY_HOUR[i]!,
    b = AWAKE_BY_HOUR[(i + 1) % 24]!;
  return a + (b - a) * (h - i);
}

export const NIGHT = {
  /** Lit room seen through the glass (below the bloom threshold). */
  window: 0.72,
  /** Facade lamp (glows). */
  lamp: 2.4,
  bloomThreshold: 1.05,
  bloomStrength: 0.2,
  bloomRadius: 0.32,
} as const;

/** Uniforms shared by rooms and lamps (one value for the whole scene). */
export const nightUniforms = {
  /** 0 by day to 1 at night. */
  uDark: { value: 0 },
  /** Fraction of lit rooms. */
  uAwake: { value: awakeShare(21) },
};

/** Warm room light (2700 K, incandescent/warm LED). */
export const ROOM_LIGHT = new THREE.Color('#ffc58a');

/**
 * Room: lights up at night according to the room draw (attribute aRoom, 0..1)
 * and the awake fraction. The room color becomes the light it sends through the window.
 */
export function roomMaterial(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDark = nightUniforms.uDark;
    sh.uniforms.uAwake = nightUniforms.uAwake;
    sh.vertexShader = 'attribute float aRoom;\nvarying float vRoom;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRoom = aRoom;');
    sh.fragmentShader =
      'uniform float uDark;\nuniform float uAwake;\nvarying float vRoom;\n' +
      sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  float roomLit = step(vRoom, uAwake) * uDark;
  totalEmissiveRadiance += vec3(${ROOM_LIGHT.r.toFixed(4)}, ${ROOM_LIGHT.g.toFixed(4)}, ${ROOM_LIGHT.b.toFixed(4)}) * ${NIGHT.window.toFixed(2)} * roomLit * (0.55 + 0.45 * fract(vRoom * 7.31));`,
      );
  };
  m.customProgramCacheKey = () => 'forma-room';
}

const lamps = new Set<THREE.MeshStandardMaterial>();

/** Lamp: emits at night (glows), off by day. */
export function lampMaterial(m: THREE.MeshStandardMaterial, color: string): void {
  m.emissive.set(color);
  m.emissiveIntensity = nightUniforms.uDark.value * NIGHT.lamp;
  lamps.add(m);
}

export function setLampLevel(dark: number): void {
  for (const m of lamps) m.emissiveIntensity = dark * NIGHT.lamp;
}

/** Stable draw of a room (0..1) from its number. */
export function roomHash(n: number): number {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  return (x % 100000) / 100000;
}

/**
 * Curtain: at night it lets the room light through (translucent fabric against
 * the light), at the mean awake fraction — otherwise a curtained window goes black.
 */
export function curtainMaterial(m: THREE.MeshStandardMaterial): void {
  // Chained, not replaced: a fabric with a procedural finish keeps its own decoding of the detail
  // map (replacing it showed the raw R/G/B channels as magenta fabric).
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.call(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uDark = nightUniforms.uDark;
    sh.uniforms.uAwake = nightUniforms.uAwake;
    sh.fragmentShader =
      'uniform float uDark;\nuniform float uAwake;\n' +
      sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * vec3(${ROOM_LIGHT.r.toFixed(4)}, ${ROOM_LIGHT.g.toFixed(4)}, ${ROOM_LIGHT.b.toFixed(4)}) * ${(NIGHT.window * 0.6).toFixed(3)} * uDark * uAwake;`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|forma-curtain`;
}
