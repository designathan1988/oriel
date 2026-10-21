// Core without three.js: schema, validation, migration and queries.
// It can run in a worker or on the game server.
import type { Limits, Project } from './schema';
import { SCHEMA } from './schema';
import { validateProject } from './validate';
import { migrateV1 } from './migrate/v1';

export * from './schema';
export { validateProject } from './validate';
export { migrateV1, normalizeV1 } from './migrate/v1';
export { History } from './history';
export { Emitter } from './events';
export { uid, sequentialIds } from './ids';
export { massExtent, massStoreys, sortedStoreys, edgeConfig } from './model';
export { computeLotIndices, buildingHeight, buildingFootprints, DEFAULT_LOT_RULES, type LotIndices, type Violation, type ViolationKind } from './indices';
export { buildableArea, edgeKinds, lotArea, lotAt } from '../geometry/lot';

/** Opens a project of any known version, migrating when needed. */
export function loadProject(raw: unknown, limits: Partial<Limits> = {}): Project {
  const r = raw as { schema?: string; version?: number } | null;
  if (r && r.schema === SCHEMA) return validateProject(r, limits);
  if (r && r.version === 1) return validateProject(migrateV1(r), limits);
  throw new Error('Unknown project format.');
}

export function emptyProject(name = 'Untitled project'): Project {
  return { schema: SCHEMA, name, lots: [], buildings: [], styles: [], meta: { createdWith: 'forma 2' } };
}
export * from '../styles';
