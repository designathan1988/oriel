// What surrounds a building on its ground floor plan (the "planta de situação" drawn under it): the lot
// lines, the street and sidewalk edges and the terrain's contour lines, in the building's plan frame, for
// floorplansvg.ts to draw light behind the walls. Pure.
import type { Building3, Project3, Vec2 } from '../model/schema';
import { toLocal } from '../model/ops';
import { ribbon } from '../model/site';
import { contourSegments, terrainField } from '../model/terrain';

export interface SiteContext {
  /** Lot outlines (dashed). */
  lots: Vec2[][];
  /** Street and sidewalk outlines. */
  streets: Vec2[][];
  /** Contour segments with their height. */
  contours: [Vec2, Vec2, number][];
}

/** The surroundings of `b` within `reach` metres of its position, or null when there is nothing. */
export function siteContext(p: Project3, b: Building3, reach = 60): SiteContext | null {
  const near = (q: Vec2) => Math.hypot(q[0] - b.position[0], q[1] - b.position[1]) < reach;
  const L = (q: Vec2) => toLocal(b, q);
  const lots = p.lots.filter((l) => l.polygon.some(near)).map((l) => l.polygon.map(L));
  const streets = (p.streets ?? []).flatMap((s) => [...ribbon(s.points, 0, s.width / 2), ...ribbon(s.points, s.width / 2, s.width / 2 + s.sidewalk)]).filter((r) => r.some(near)).map((r) => r.map(L));
  const field = terrainField(p);
  const contours: [Vec2, Vec2, number][] = field
    ? contourSegments(field, 1, 0.5)
        .filter((c) => near([c[0], c[1]]))
        .map((c) => [L([c[0], c[1]]), L([c[2], c[3]]), c[4]])
    : [];
  return lots.length || streets.length || contours.length ? { lots, streets, contours } : null;
}
