// Which building floors a volume holds and which of them a facade rule takes (ground, upper, top,
// middle, a list). Shared by the evaluation (facade rules) and the modeling (a split keeps on each
// piece only the rules and exceptions of its floors). No three.
import type { Building3, LevelPick, Solid } from './schema';

/** Building levels inside the solid height. */
export function solidLevels(b: Building3, s: Solid): { index: number; elevation: number; height: number }[] {
  const out: { index: number; elevation: number; height: number }[] = [];
  const top = s.base + s.height;
  const levels = [...b.levels].sort((a, c) => a.elevation - c.elevation);
  levels.forEach((l, i) => {
    if (l.elevation >= s.base - 0.05 && l.elevation < top - 1) out.push({ index: i, elevation: l.elevation, height: Math.min(l.height, top - l.elevation) });
  });
  // No building level inside: one row for the whole volume, counted as an upper floor when it is raised.
  if (!out.length && s.height > 1.5) out.push({ index: s.base > 0.05 ? Math.max(1, levels.filter((l) => l.elevation < s.base - 0.05).length) : 0, elevation: s.base, height: s.height });
  return out;
}

/**
 * Levels of the volume a rule occupies. Ground and upper are the building's floors (index 0 and the
 * rest), not the volume's: a setback, an inset top or the upper half of a split starts above the
 * ground floor, so its first floor takes the upper rules (windows), never the shops of the ground
 * floor. Top is the volume's own last floor (each mass has its attic); middle is an upper floor below
 * it. A list names building floors (0 = ground).
 */
export function pickLevels(pick: LevelPick, list: ReturnType<typeof solidLevels>): ReturnType<typeof solidLevels> {
  if (Array.isArray(pick)) return list.filter((l) => pick.includes(l.index));
  if (pick === 'all') return list;
  if (pick === 'ground') return list.filter((l) => l.index === 0);
  if (pick === 'upper') return list.filter((l) => l.index > 0);
  if (pick === 'top') return list.slice(-1);
  return list.slice(0, -1).filter((l) => l.index > 0);
}

/**
 * Parts of a facade position key "side:level:place". The side of a rounded corner is "<vertex>:c", so
 * the key is not split at its first colon (a corner key "v1:c:2:0" is side "v1:c", level 2).
 */
export function keyParts(k: string): { edge: string; level: number; at: string } | null {
  const m = /^(.+?(?::c)?):(\d+):(.+)$/.exec(k);
  return m ? { edge: m[1]!, level: Number(m[2]), at: m[3]! } : null;
}
