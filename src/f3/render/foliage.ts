// Foliage atlas: leaf clusters, needles, palm fronds, grass blades, flowers, fern and maple
// leaves drawn once on a canvas (4 × 2 cells of 256 px, layout in families/family.ts
// FOLIAGE_CELLS). Greyscale: the material color tints it. Its alpha cuts the leaf cards
// out (alphaTest), and the color under the transparent pixels is the mean leaf grey, so the
// mipmaps do not darken the leaf edges (the "dilated" color of alpha-tested foliage).
import * as THREE from 'three';
import { FOLIAGE_CELLS, type Foliage } from '../families/family';

const CELL = 256;
const COLS = 4;
const ROWS = 2;

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

type G = CanvasRenderingContext2D;
const grey = (v: number, a = 1) => {
  const c = Math.round(255 * Math.max(0, Math.min(1, v)));
  return `rgba(${c},${c},${c},${a})`;
};

/** A leaf blade from (0,0) pointing up, length l, half-width w; lobes > 0 draws a palmate (maple) outline. */
function leafPath(g: G, l: number, w: number, lobes = 0): void {
  g.beginPath();
  if (lobes) {
    for (let i = 0; i <= lobes * 2; i++) {
      const a = -Math.PI / 2 - Math.PI * 0.85 + (i / (lobes * 2)) * Math.PI * 1.7;
      const r = i % 2 === 0 ? l * (i === lobes ? 1 : 0.78) : l * 0.42;
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r * 1.0 - l * 0.35;
      if (i === 0) g.moveTo(0, -l * 0.05);
      g.lineTo(x * (w / (l * 0.5)), y);
    }
    g.closePath();
    return;
  }
  g.moveTo(0, 0);
  g.bezierCurveTo(w * 1.25, -l * 0.25, w * 0.9, -l * 0.75, 0, -l);
  g.bezierCurveTo(-w * 0.9, -l * 0.75, -w * 1.25, -l * 0.25, 0, 0);
  g.closePath();
}

function leaf(g: G, x: number, y: number, ang: number, l: number, w: number, v: number, lobes = 0): void {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  leafPath(g, l, w, lobes);
  const grd = g.createLinearGradient(-w, 0, w, 0);
  grd.addColorStop(0, grey(v * 0.82));
  grd.addColorStop(0.5, grey(v));
  grd.addColorStop(1, grey(v * 0.72));
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = grey(v * 0.6, 0.8);
  g.lineWidth = Math.max(0.8, l * 0.025);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -l * (lobes ? 0.8 : 0.92));
  g.stroke();
  g.restore();
}

function stem(g: G, pts: [number, number][], width: number, v: number): void {
  g.strokeStyle = grey(v);
  g.lineWidth = width;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.stroke();
}

/** Each cell drawn in its own 256 px square, its base (where the card hangs) at the bottom middle. */
const DRAW: Record<Foliage, (g: G, r: () => number) => void> = {
  broad(g, r) {
    stem(g, [[128, 250], [126, 170], [130, 90]], 4, 0.35);
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      const side = i % 2 ? 1 : -1;
      const y = 240 - t * 175;
      leaf(g, 128 + side * 4, y, side * (0.5 + r() * 0.5) - (t > 0.9 ? side * 0.5 : 0), 70 - t * 18 + r() * 10, 22 + r() * 6, 0.62 + r() * 0.36);
    }
  },
  small(g, r) {
    for (let k = 0; k < 3; k++) {
      const a = -0.45 + k * 0.45;
      const x1 = 128 + Math.sin(a) * 200,
        y1 = 250 - Math.cos(a) * 225;
      stem(g, [[128, 252], [x1, y1]], 2, 0.35);
      for (let i = 0; i < 11; i++) {
        const t = 0.15 + (i / 10) * 0.85;
        const x = 128 + (x1 - 128) * t,
          y = 252 + (y1 - 252) * t;
        const side = i % 2 ? 1 : -1;
        leaf(g, x, y, a + side * (0.7 + r() * 0.4), 30 + r() * 8, 11 + r() * 3, 0.6 + r() * 0.38);
      }
    }
  },
  needle(g, r) {
    stem(g, [[128, 252], [128, 10]], 3, 0.32);
    for (let k = 0; k < 2; k++) {
      const off = k ? 40 : -40;
      stem(g, [[128, 140 + Math.abs(off)], [128 + off * 1.8, 40]], 2, 0.32);
    }
    g.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const t = r();
      const branch = Math.floor(r() * 3);
      let x0 = 128,
        y0 = 252 - t * 240,
        dir = -Math.PI / 2;
      if (branch) {
        const off = branch === 1 ? -40 : 40;
        x0 = 128 + off * 1.8 * t;
        y0 = 140 + Math.abs(off) - t * (100 + Math.abs(off));
        dir = Math.atan2(-(100 + Math.abs(off)), off * 1.8);
      }
      const side = r() < 0.5 ? -1 : 1;
      const a = dir + side * (0.5 + r() * 0.5);
      const l = 26 + r() * 14;
      g.strokeStyle = grey(0.55 + r() * 0.42);
      g.lineWidth = 1.6 + r();
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l);
      g.stroke();
    }
  },
  palm(g, r) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push([128 + Math.sin(t * 1.4) * 22, 252 - t * 244]);
    }
    stem(g, pts, 4, 0.45);
    for (let i = 2; i < 20; i++) {
      const [x, y] = pts[i]!;
      const t = i / 20;
      const l = 95 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 10;
      for (const side of [-1, 1]) {
        g.save();
        g.translate(x, y);
        g.rotate(side * (1.05 - t * 0.35));
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(side * 3, -l * 0.5, side * l * 0.12, -l);
        g.quadraticCurveTo(-side * 2, -l * 0.5, 0, 0);
        g.lineWidth = 7;
        g.strokeStyle = grey(0.62 + r() * 0.34);
        g.stroke();
        g.restore();
      }
    }
  },
  grass(g, r) {
    for (let i = 0; i < 22; i++) {
      const x = 40 + r() * 176;
      const h = 150 + r() * 100;
      const bend = (r() - 0.5) * 120;
      const w = 9 + r() * 7;
      g.beginPath();
      g.moveTo(x - w, 254);
      g.quadraticCurveTo(x - w * 0.6 + bend * 0.3, 254 - h * 0.6, x + bend, 254 - h);
      g.quadraticCurveTo(x + w * 0.6 + bend * 0.3, 254 - h * 0.6, x + w, 254);
      g.closePath();
      g.fillStyle = grey(0.5 + r() * 0.48);
      g.fill();
    }
  },
  flower(g, r) {
    // Five big heads with layered petals and a darker eye, filling the cell.
    const heads: [number, number, number][] = [[80, 80, 52], [180, 70, 46], [128, 160, 56], [60, 200, 40], [200, 195, 42]];
    for (const [cx, cy, R] of heads) {
      const n = 6 + Math.floor(r() * 3);
      for (const layer of [0, 1]) {
        for (let k = 0; k < n; k++) {
          const a = ((k + layer * 0.5) / n) * Math.PI * 2 + r() * 0.2;
          g.save();
          g.translate(cx, cy);
          g.rotate(a);
          g.beginPath();
          g.ellipse(0, -R * (layer ? 0.4 : 0.55), R * (layer ? 0.2 : 0.26), R * (layer ? 0.4 : 0.5), 0, 0, Math.PI * 2);
          const v = layer ? 0.98 : 0.84 + r() * 0.1;
          const grd = g.createLinearGradient(0, 0, 0, -R);
          grd.addColorStop(0, grey(v * 0.75));
          grd.addColorStop(1, grey(v));
          g.fillStyle = grd;
          g.fill();
          g.restore();
        }
      }
      g.beginPath();
      g.arc(cx, cy, R * 0.2, 0, Math.PI * 2);
      g.fillStyle = grey(0.42);
      g.fill();
    }
  },
  fern(g, r) {
    // A pinnate frond: a curving rachis and long tapering pinnae, each with serrated edges.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      pts.push([128 + t * t * 26, 252 - t * 244]);
    }
    for (let i = 2; i < 29; i += 2) {
      const [x, y] = pts[i]!;
      const t = i / 30;
      const l = 108 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (1 - t * 0.35);
      for (const side of [-1, 1]) {
        g.save();
        g.translate(x, y);
        g.rotate(side * (1.15 - t * 0.3));
        g.beginPath();
        g.moveTo(0, 0);
        const teeth = 7;
        for (let k = 1; k <= teeth; k++) {
          const u = k / teeth;
          const w = 7 * (1 - u * 0.85);
          g.lineTo(side * (w + 2), -l * (u - 0.5 / teeth));
          g.lineTo(side * w * 0.6, -l * u);
        }
        for (let k = teeth; k >= 1; k--) {
          const u = k / teeth;
          const w = 7 * (1 - u * 0.85);
          g.lineTo(-side * w * 0.6, -l * u);
          g.lineTo(-side * (w + 2), -l * (u - 0.5 / teeth));
        }
        g.closePath();
        g.fillStyle = grey(0.62 + r() * 0.3);
        g.fill();
        g.strokeStyle = grey(0.45, 0.7);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -l * 0.95);
        g.stroke();
        g.restore();
      }
    }
    stem(g, pts, 3, 0.4);
  },
  maple(g, r) {
    // Palmate leaves: five pointed lobes around the stalk, veins to each tip.
    const leafAt = (x: number, y: number, ang: number, R: number, v: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.beginPath();
      const lobes = [-1.25, -0.62, 0, 0.62, 1.25];
      const len = [0.62, 0.9, 1, 0.9, 0.62];
      g.moveTo(0, 0);
      const at = (a: number, r: number): [number, number] => [Math.sin(a) * R * r, -Math.cos(a) * R * r - R * 0.15];
      lobes.forEach((a, i) => {
        const prev = i ? lobes[i - 1]! : a - 0.62;
        g.lineTo(...at((a + prev) / 2, 0.42));
        g.lineTo(...at(a - 0.24, len[i]! * 0.7));
        g.lineTo(...at(a - 0.1, len[i]! * 0.82));
        g.lineTo(...at(a, len[i]!));
        g.lineTo(...at(a + 0.1, len[i]! * 0.82));
        g.lineTo(...at(a + 0.24, len[i]! * 0.7));
      });
      g.lineTo(...at(1.56, 0.42));
      g.closePath();
      const grd = g.createRadialGradient(0, -R * 0.15, R * 0.1, 0, -R * 0.4, R);
      grd.addColorStop(0, grey(v * 0.75));
      grd.addColorStop(1, grey(v));
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = grey(v * 0.6, 0.8);
      g.lineWidth = 1.2;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        g.moveTo(0, -R * 0.15);
        g.lineTo(Math.sin(lobes[i]!) * R * len[i]! * 0.85, -Math.cos(lobes[i]!) * R * len[i]! * 0.85 - R * 0.15);
        g.stroke();
      }
      g.restore();
    };
    stem(g, [[128, 252], [128, 150]], 3, 0.35);
    const spots: [number, number, number][] = [[128, 120, 0], [75, 150, -0.7], [181, 150, 0.7], [90, 72, -0.35], [166, 72, 0.35], [60, 215, -1.2], [196, 215, 1.2]];
    for (const [x, y, a] of spots) {
      stem(g, [[128, 175], [x, y + 18]], 1.5, 0.35);
      leafAt(x, y + 20, a + (r() - 0.5) * 0.3, 56 + r() * 8, 0.62 + r() * 0.34);
    }
  },
};

const CUT = 0.45;

/**
 * Mipmaps that keep the leaf coverage: a plain box filter averages the thin blades and needles
 * with the transparent pixels around them until no texel passes the alpha test and the far grass
 * vanishes. Each cell of each level gets its alpha scaled so the share of texels that pass equals
 * that of the full-size cell (Castaño, "Computing alpha mipmaps", the method of the Witness).
 */
function coverageMips(base: Uint8Array, W: number, H: number): { data: Uint8Array; width: number; height: number }[] {
  const T = CUT * 255;
  const coverage = (d: Uint8Array, w: number, x0: number, y0: number, cs: number, scale: number) => {
    let n = 0;
    for (let y = y0; y < y0 + cs; y++) for (let x = x0; x < x0 + cs; x++) if (d[(y * w + x) * 4 + 3]! * scale > T) n++;
    return n / (cs * cs);
  };
  const target: number[] = [];
  for (let c = 0; c < COLS * ROWS; c++) target.push(coverage(base, W, (c % COLS) * CELL, Math.floor(c / COLS) * CELL, CELL, 1));
  const levels = [{ data: base, width: W, height: H }];
  let w = W,
    h = H,
    prev = base;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1);
    const out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++)
        for (let k = 0; k < 4; k++) {
          const x0 = Math.min(w - 1, x * 2),
            x1 = Math.min(w - 1, x * 2 + 1),
            y0 = Math.min(h - 1, y * 2),
            y1 = Math.min(h - 1, y * 2 + 1);
          out[(y * nw + x) * 4 + k] = (prev[(y0 * w + x0) * 4 + k]! + prev[(y0 * w + x1) * 4 + k]! + prev[(y1 * w + x0) * 4 + k]! + prev[(y1 * w + x1) * 4 + k]! + 2) >> 2;
        }
    const cs = (CELL * nw) / W;
    if (cs >= 2)
      for (let c = 0; c < COLS * ROWS; c++) {
        const cx = (c % COLS) * cs,
          cy = Math.floor(c / COLS) * cs;
        let lo = 0.5,
          hi = 16;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          if (coverage(out, nw, cx, cy, cs, mid) < target[c]!) lo = mid;
          else hi = mid;
        }
        for (let y = cy; y < cy + cs; y++) for (let x = cx; x < cx + cs; x++) out[(y * nw + x) * 4 + 3] = Math.min(255, Math.round(out[(y * nw + x) * 4 + 3]! * hi));
      }
    levels.push({ data: out, width: nw, height: nh });
    prev = out;
    w = nw;
    h = nh;
  }
  return levels;
}

/** Meshes drawn with leaf cards: the ambient occlusion pass skips them (it draws whole quads, not the cut-out leaves). */
export const foliageMeshes = new Set<THREE.Object3D>();

let atlas: THREE.DataTexture | null | undefined;

/** The foliage atlas (null where there is no canvas: Node tests draw the cards plain). */
export function foliageAtlas(): THREE.DataTexture | null {
  if (atlas !== undefined) return atlas;
  const W = CELL * COLS,
    H = CELL * ROWS;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: W, height: H }) : null;
  const g = canvas?.getContext('2d') as G | null | undefined;
  if (!g) return (atlas = null);
  FOLIAGE_CELLS.forEach((kind, i) => {
    g.save();
    g.beginPath();
    g.rect((i % COLS) * CELL + 4, Math.floor(i / COLS) * CELL + 4, CELL - 8, CELL - 8);
    g.clip();
    g.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    DRAW[kind](g, rng(i * 7919 + 17));
    g.restore();
  });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  // Mean grey of the leaves under the transparent pixels (no dark fringe in the mipmaps).
  let sum = 0,
    n = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3]! > 200) {
      sum += d[i]!;
      n++;
    }
  const mean = n ? Math.round(sum / n) : 160;
  // getImageData gives straight (not premultiplied) colour: the antialiased edges keep theirs.
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 0) d[i] = d[i + 1] = d[i + 2] = mean;
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), W, H, THREE.RGBAFormat);
  tex.mipmaps = coverageMips(new Uint8Array(d.buffer.slice(0)), W, H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return (atlas = tex);
}

/**
 * Leaf card material: the atlas cut out by its alpha, both sides lit by the same (rounded)
 * normal: three.js flips the normal of back faces on double-sided materials, which would
 * light the back of every other card from inside the crown.
 */
export function foliageMaterial(m: THREE.MeshStandardMaterial): void {
  const map = foliageAtlas();
  m.side = THREE.DoubleSide;
  m.roughness = 0.8;
  m.metalness = 0;
  if (map) {
    m.map = map;
    m.alphaTest = CUT;
    // With the MSAA target: the cut edge becomes coverage (smooth leaf edges instead of stairs).
    m.alphaToCoverage = true;
  }
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  m.customProgramCacheKey = () => 'forma-foliage';
}
