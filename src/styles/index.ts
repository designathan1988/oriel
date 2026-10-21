// Style packs: schema, validation, split and built-in styles.
import type { Project } from '../core/schema';
import { BUILTIN_STYLES, builtinStyle } from './builtin';
import type { StylePack } from './schema';

export * from './schema';
export { resolveSplit, type Piece } from './split';
export { styleFacade, floorRule, type StyledFacade, type StyledOpening, type Ornament } from './interpret';
export { BUILTIN_STYLES, builtinStyle } from './builtin';

export type StyleResolver = (id: string) => StylePack | undefined;

/** Looks the style up in the project and then among the built-in ones. */
export function styleResolver(project?: Pick<Project, 'styles'>): StyleResolver {
  return (id) => project?.styles.find((s) => s.id === id) ?? builtinStyle(id);
}

/** All available styles (built-in + project). */
export function allStyles(project?: Pick<Project, 'styles'>): StylePack[] {
  const own = project?.styles ?? [];
  return [...BUILTIN_STYLES.filter((b) => !own.some((o) => o.id === b.id)), ...own];
}
