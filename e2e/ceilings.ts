// Ceilings of one frame of each fixed scene, shared by the smoke check (e2e/smoke.spec.ts) and the
// visual check (e2e/visual.spec.ts): a scene that draws more than this got slower to draw.
/** Ceilings of one frame of each scene (every pass: scene, ambient occlusion, shadows, bloom), measured 2026-10-13. */
// 2026-10-13: the curved building's rounded corners take windows (audit D27): +2.5k triangles in the
// scenes that show it (their frames, glass and the openings in the corner walls).
export const MAX: Record<string, { calls: number; triangles: number }> = {
  samples: { calls: 153, triangles: 188_513 },
  night: { calls: 166, triangles: 188_526 },
  tower: { calls: 39, triangles: 278_453 },
  close: { calls: 51, triangles: 10_005 },
  // 2026-10-13: two more finishes (Painted steel, Glazed ceramic) are two more blocks: +4 calls, +184 triangles each.
  finishes: { calls: 97, triangles: 5_441 },
  cutaway: { calls: 15, triangles: 1_669 },
  exploded: { calls: 43, triangles: 32_217 },
  // 2026-10-13: the garden scene, new: 22 grown plants (bark tubes and leaf cards), every pass.
  garden: { calls: 59, triangles: 63_371 },
  // 2026-10-13: the furniture scene, new: 18 pieces with rounded boxes and lofted ceramics, every pass.
  furniture: { calls: 101, triangles: 64_693 },
  // 2026-10-13: the screen-space selection outline (OutlinePass) draws the scene's depth and the selected
  // building's mask once more, only while something is selected: +139 calls, +95k triangles.
  selected: { calls: 363, triangles: 284_398 },
};
