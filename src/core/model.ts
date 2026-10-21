// Model queries (without three.js).
import type { Building, EdgeOverride, FacadeSpec, Finish, Mass, Storey } from './schema';

/** Building storeys sorted by elevation. */
export const sortedStoreys = (b: Building): Storey[] => [...b.storeys].sort((x, y) => x.elevation - y.elevation);

/** Storeys occupied by the mass, bottom to top. */
export function massStoreys(b: Building, m: Mass): Storey[] {
  const s = sortedStoreys(b);
  const i = s.findIndex((x) => x.id === m.fromStorey),
    j = s.findIndex((x) => x.id === m.toStorey);
  if (i < 0 || j < 0) return [];
  return s.slice(Math.min(i, j), Math.max(i, j) + 1);
}

export interface MassExtent {
  storeys: Storey[];
  /** Elevation of the mass base. */
  base: number;
  /** Total mass height. */
  height: number;
}

export function massExtent(b: Building, m: Mass): MassExtent {
  const storeys = massStoreys(b, m);
  if (!storeys.length) return { storeys, base: 0, height: 0 };
  const base = storeys[0]!.elevation,
    last = storeys.at(-1)!;
  return { storeys, base, height: last.elevation + last.height - base };
}

/** Effective configuration of an edge: mass default + edge overrides. */
export interface EdgeConfig extends FacadeSpec {
  wall: string;
  trim: string;
  balconies: boolean;
  brise: boolean;
  manual: boolean;
}

export function edgeConfig(m: Mass, o: EdgeOverride | undefined): EdgeConfig {
  return {
    pattern: o?.pattern ?? m.facade.pattern,
    windowWidth: o?.windowWidth ?? m.facade.windowWidth,
    windowHeight: o?.windowHeight ?? m.facade.windowHeight,
    spacing: o?.spacing ?? m.facade.spacing,
    wall: o?.wall ?? m.finish.wall,
    trim: o?.trim ?? m.finish.trim,
    balconies: o?.balconies ?? m.flags.balconies,
    brise: o?.brise ?? m.flags.brise,
    manual: o?.manual ?? false,
  };
}

export const finishOf = (m: Mass): Finish => m.finish;
