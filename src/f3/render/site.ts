// Drawing of the site: streets (asphalt, sidewalks raised like a curb), lots (a lawn with its outline),
// on the selected lot the buildable area its setbacks leave (dashed), and the shaped ground (terrain:
// a height grid, the lots tinted on it and their outlines laid over the slopes). Rebuilt only when the lots
// or the streets change (a key of their JSON), so a camera move costs nothing. Data: model/site.ts.
import * as THREE from 'three';
import type { Project3, Vec2 } from '../model/schema';
import { buildableArea, insideRing, ribbon } from '../model/site';
import { terrainField, type TerrainField } from '../model/terrain';

const ASPHALT = '#4b4d50',
  SIDEWALK = '#b9b5ab',
  LAWN = '#a7b48a',
  SOIL = '#d8d5ca',
  EDGE = '#5f6a48',
  PICK = '#3b82f6';

/** Flat polygon on the ground at height y (world [x, z] ring, either orientation). */
function flat(ring: Vec2[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** A raised slab (a sidewalk with its curb): top and the sides of the ring, `h` high. */
function slab(ring: Vec2[], h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  // Extruded along +z in shape space (x, y=z_world): turn it up so the depth is the height.
  g.rotateX(Math.PI / 2);
  g.translate(0, h, 0);
  return g;
}

/** The outline of a ring as a flat band `w` wide inside it (a line would sink into the lawn far away). */
function band(ring: Vec2[], w: number, y: number): THREE.BufferGeometry {
  const ccw = ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0) > 0;
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Inward normal of a counterclockwise ring (x, z): (−tz, tx).
    const s = ccw ? 1 : -1;
    const nx = (-(b[1] - a[1]) / l) * s * w,
      nz = ((b[0] - a[0]) / l) * s * w;
    const q = [a[0], a[1], b[0], b[1], b[0] + nx, b[1] + nz, a[0] + nx, a[1] + nz];
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(q[k * 2]!, y, q[k * 2 + 1]!);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function loop(ring: Vec2[], y: number, mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.LineLoop {
  const g = new THREE.BufferGeometry().setFromPoints(ring.map((p) => new THREE.Vector3(p[0], y, p[1])));
  const l = new THREE.LineLoop(g, mat);
  if (mat instanceof THREE.LineDashedMaterial) l.computeLineDistances();
  return l;
}

function makeMats() {
  return {
    asphalt: new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: SIDEWALK, roughness: 0.9 }),
    lawn: new THREE.MeshStandardMaterial({ color: LAWN, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    edge: new THREE.MeshBasicMaterial({ color: EDGE, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pickBand: new THREE.MeshBasicMaterial({ color: PICK, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pick: new THREE.LineBasicMaterial({ color: PICK, depthTest: false }),
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    edgeLine: new THREE.LineBasicMaterial({ color: EDGE }),
    contour: new THREE.LineBasicMaterial({ color: '#8f8774', transparent: true, opacity: 0.55 }),
    buildable: new THREE.LineDashedMaterial({ color: PICK, dashSize: 0.8, gapSize: 0.5, depthTest: false }),
  };
}

/**
 * The street's name painted on the asphalt along its longest stretch (a canvas texture on a flat plane,
 * reading left to right whichever way the street was drawn).
 */
function streetLabel(name: string, pts: Vec2[], width: number): THREE.Mesh | null {
  if (typeof document === 'undefined' || pts.length < 2 || !name.trim()) return null;
  let best = 0,
    bi = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    if (l > best) {
      best = l;
      bi = i;
    }
  }
  if (best < width * 2) return null;
  let a = pts[bi - 1]!,
    b = pts[bi]!;
  if (b[0] < a[0]) [a, b] = [b, a];
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 128;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '600 72px system-ui, Segoe UI, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 512, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const h = Math.min(width * 0.45, 3),
    w = Math.min(best * 0.6, h * 8);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  m.rotation.order = 'YXZ';
  m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
  m.rotation.x = -Math.PI / 2;
  m.position.set((a[0] + b[0]) / 2, 0.012, (a[1] + b[1]) / 2);
  m.renderOrder = 3;
  return m;
}

/** The shaped ground as a height grid over its box (at most ~180 cells a side), lots tinted on it. */
function terrainMesh(t: TerrainField, lots: Vec2[][]): THREE.BufferGeometry {
  const [x0, z0, x1, z1] = t.box;
  const cell = Math.max(0.5, Math.max(x1 - x0, z1 - z0) / 180);
  const nx = Math.ceil((x1 - x0) / cell),
    nz = Math.ceil((z1 - z0) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3),
    col = new Float32Array(pos.length);
  // Hex colours are already turned into linear values by three.js (ColorManagement).
  const soil = new THREE.Color(SOIL),
    lawn = new THREE.Color(LAWN);
  let k = 0;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++, k += 3) {
      const x = x0 + ((x1 - x0) * i) / nx,
        z = z0 + ((z1 - z0) * j) / nz;
      pos[k] = x;
      pos[k + 1] = t.at(x, z);
      pos[k + 2] = z;
      const c = lots.some((r) => insideRing([x, z], r)) ? lawn : soil;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i,
        b = a + 1,
        c = a + nx + 1,
        d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.grid = [nx, nz];
  return g;
}

/**
 * Contour lines every `step` metres over the height grid (marching squares on each cell): the reading of a
 * site plan's "curvas de nível", a little above the ground.
 */
function contours(g: THREE.BufferGeometry, nx: number, nz: number, step: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const out: number[] = [];
  const V = (i: number, j: number) => j * (nx + 1) + i;
  const lerp = (a: number, b: number, lv: number) => {
    const ya = p.getY(a),
      yb = p.getY(b);
    const t = (lv - ya) / (yb - ya);
    return [p.getX(a) + (p.getX(b) - p.getX(a)) * t, lv + 0.03, p.getZ(a) + (p.getZ(b) - p.getZ(a)) * t];
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const c = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
      const ys = c.map((v) => p.getY(v));
      const lo = Math.ceil(Math.min(...ys) / step),
        hi = Math.floor(Math.max(...ys) / step);
      for (let k = lo; k <= hi; k++) {
        const lv = k * step;
        if (lv === 0) continue;
        const cut: number[][] = [];
        for (let e = 0; e < 4; e++) {
          const a = c[e]!,
            b = c[(e + 1) % 4]!;
          const ya = p.getY(a),
            yb = p.getY(b);
          if ((ya < lv) !== (yb < lv)) cut.push(lerp(a, b, lv));
        }
        if (cut.length >= 2) out.push(...cut[0]!, ...cut[1]!);
        if (cut.length === 4) out.push(...cut[2]!, ...cut[3]!);
      }
    }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return r;
}

/** A ring laid over the shaped ground (a point every 0.5 m, `lift` above it). */
function draped(ring: Vec2[], t: TerrainField, lift: number, mat: THREE.LineBasicMaterial): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let s = 0; s < n; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / n,
        z = a[1] + ((b[1] - a[1]) * s) / n;
      pts.push(new THREE.Vector3(x, t.at(x, z) + lift, z));
    }
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
}

export class SiteLayer {
  /** The box the shaped ground covers (the flat ground disc leaves it open), null when flat. */
  terrainBox: [number, number, number, number] | null = null;
  readonly group = new THREE.Group();
  private key = '';
  // Made on first use: a project without lots or streets creates no material (and draws exactly as before).
  private made: ReturnType<typeof makeMats> | null = null;
  private get mats(): ReturnType<typeof makeMats> {
    return (this.made ??= makeMats());
  }

  constructor() {
    this.group.name = 'site';
  }

  /** Redraws when the lots, the streets or the selected one changed; true when something was redrawn. */
  sync(p: Project3, picked: { lot: string | null; street: string | null }): boolean {
    // The terrain's pads follow the buildings: their plans and levels are part of the key only with a terrain.
    const pads = p.terrain?.points.length ? p.buildings.map((b) => [b.position, b.rotation, b.elevation, b.hidden, b.solids.map((x) => [x.op, x.hidden, x.base, x.plan.outer.map((v) => v.p)])]) : null;
    const key = JSON.stringify([p.lots, p.streets ?? [], picked, p.terrain ?? null, pads]);
    if (key === this.key) return false;
    this.key = key;
    this.clear();
    const t = terrainField(p);
    this.terrainBox = t ? t.box : null;
    if (t) {
      const m = new THREE.Mesh(terrainMesh(t, p.lots.map((l) => l.polygon)), this.mats.terrain);
      m.castShadow = true;
      m.name = 'terrain';
      this.add(m, true);
      const [nx, nz] = m.geometry.userData.grid as [number, number];
      this.add(new THREE.LineSegments(contours(m.geometry, nx, nz, 1), this.mats.contour));
    }
    for (const st of p.streets ?? []) {
      for (const q of ribbon(st.points, 0, st.width / 2)) this.add(new THREE.Mesh(flat(q, 0.005), this.mats.asphalt), true);
      if (st.sidewalk > 0) for (const q of ribbon(st.points, st.width / 2, st.width / 2 + st.sidewalk)) this.add(new THREE.Mesh(slab(q, 0.15), this.mats.sidewalk), true);
      if (st.id === picked.street) for (const q of ribbon(st.points, 0, st.width / 2 + st.sidewalk)) this.add(loop(q, 0.2, this.mats.pick));
      const label = streetLabel(st.name, st.points, st.width);
      if (label) this.add(label);
    }
    for (const lot of p.lots) {
      const sel = lot.id === picked.lot;
      // On a shaped ground the lot is tinted on it (terrainMesh) and its outline follows the slopes.
      if (t) {
        this.add(draped(lot.polygon, t, 0.04, sel ? this.mats.pick : this.mats.edgeLine));
        continue;
      }
      this.add(new THREE.Mesh(flat(lot.polygon, 0.003), this.mats.lawn), true);
      this.add(new THREE.Mesh(band(lot.polygon, sel ? 0.35 : 0.18, 0.006), sel ? this.mats.pickBand : this.mats.edge));
      if (sel) {
        const area = buildableArea(lot);
        if (area) this.add(loop(area, 0.04, this.mats.buildable));
      }
    }
    return true;
  }

  private add(o: THREE.Object3D, shadow = false): void {
    if (shadow) o.receiveShadow = true;
    o.userData.site = true;
    this.group.add(o);
  }

  private clear(): void {
    for (const o of [...this.group.children]) {
      (o as THREE.Mesh).geometry?.dispose();
      // A street name owns its texture and material.
      const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (mat && mat.map instanceof THREE.CanvasTexture) {
        mat.map.dispose();
        mat.dispose();
      }
      this.group.remove(o);
    }
  }

  dispose(): void {
    this.clear();
    if (this.made) for (const m of Object.values(this.made)) m.dispose();
  }
}
