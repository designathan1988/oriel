// Canvas awning: a continuous surface from the wall to the front (a profile swept
// along the width), triangular side flaps, a valance (hanging cloth) at the
// edge, metal arms and optional stripes. Frame: x along the
// wall (center at 0), y up, z outward; the canvas starts at y = top, z = 0.
import type { PartMat, PartSink } from './family';

export interface AwningOptions {
  width: number;
  /** Projection out of the wall. */
  depth: number;
  /** How far the front edge sits below the fixing point. */
  drop: number;
  /** Valance height (hanging cloth at the front). */
  valance: number;
  color: string;
  /** Second stripe color (empty = plain). */
  stripe?: string;
  stripeWidth?: number;
  /** Closed side flaps. */
  cheeks?: boolean;
  /** Scalloped cut on the valance. */
  scallop?: boolean;
}

const T = 0.025;

export function awning(out: PartSink, top: number, o: AwningOptions): void {
  const { width: w, depth: d, drop } = o;
  const a: PartMat = { slot: 'fabric', color: o.color };
  const b: PartMat = { slot: 'fabric', color: o.stripe || o.color };
  const metal: PartMat = { slot: 'metal', color: '#3a3d40', finish: 'metal' };
  // Canvas profile (y, z): from the wall (top, 0) to the front (top − drop, d), with thickness.
  const slope: [number, number][] = [
    [top, 0],
    [top - drop, d],
    [top - drop - T, d],
    [top - T, 0],
  ];
  // Stripes: alternating bands along x (continuous, no gaps).
  const sw = o.stripe ? Math.max(0.15, o.stripeWidth ?? 0.3) : w;
  const n = Math.max(1, Math.round(w / sw));
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const m = i % 2 === 0 ? a : b;
    const x0 = -w / 2 + i * step,
      x1 = x0 + step;
    out.sweepX(m, slope, x0, x1);
    // Valance: cloth hanging from the front edge.
    if (o.valance > 0.02) {
      const v0 = top - drop - T,
        v1 = v0 - o.valance;
      out.sweepX(m, [[v0, d], [v0, d + T], [v1, d + T], [v1, d]], x0, x1);
      if (o.scallop) {
        // Scallops: a half moon under each band.
        const r = Math.min(step / 2, o.valance * 0.6);
        const pts: [number, number][] = [];
        for (let k = 0; k <= 8; k++) {
          const t = Math.PI * (k / 8);
          pts.push([x0 + step / 2 - Math.cos(t) * (step / 2), v1 - Math.sin(t) * r]);
        }
        out.prism(m, pts, d, d + T);
      }
    }
  }
  // Side flaps: a triangle on the yz plane at each end.
  if (o.cheeks !== false) {
    for (const x of [-w / 2, w / 2 - T]) {
      out.sweepX(a, [[top, 0], [top - drop - T - o.valance, d], [top - drop - T - o.valance, 0.02]], x, x + T);
    }
  }
  // Arms: from the wall to the edge, at the ends and every ~2.5 m.
  const arms = Math.max(2, Math.ceil(w / 2.5) + 1);
  for (let i = 0; i < arms; i++) {
    const x = -w / 2 + 0.06 + ((w - 0.12) * i) / (arms - 1);
    out.rod(metal, [x, top - drop - 0.45, 0.02], [x, top - drop - 0.04, d - 0.04], 0.015, 6);
  }
  // Fixing bar on the wall.
  out.box(metal, [0, top + 0.03, 0.03], [w, 0.06, 0.06]);
}
