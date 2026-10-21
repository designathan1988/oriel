// Building-code checks on the floor plan, room by room: the window area a room needs for light (a
// fraction of its floor, with a least size), its ceiling height, and long-stay rooms that have no window
// at all. The room's use is read from its name (Bedroom, Quarto, Suíte, Cozinha…). The fractions are
// those of a Brazilian municipal building code (Porto Velho, LC 471/2012, art. 116-A: living rooms and
// bedrooms 1/6 of the floor, kitchens 1/8 and at least 0.70 m², laundries 1/8 and 1.20 m², bathrooms
// 1/12 and 0.24 m²: https://www.portovelho.ro.gov.br/uploads/docman/lei_comp_num_471_de_28.11.12.pdf);
// each city has its own, so these are a reference to check against, not the law of the site. Ceiling
// heights: 2.50 m in rooms and 2.30 m in bathrooms, halls and storage (NBR 15575-1). Pure.
import type { Building3, Vec2 } from '../model/schema';
import type { FloorPlan, PlanRoom } from './floorplan';
import { sortedLevels } from './floorplan';
import { SLAB } from './interior';

export type RoomUse = 'bedroom' | 'living' | 'kitchen' | 'bath' | 'laundry' | 'hall' | 'other';

export interface Check {
  room: PlanRoom;
  use: RoomUse;
  ok: boolean;
  /** What is checked and what was found (English, translated where shown). */
  rule: 'light' | 'height' | 'window';
  need: number;
  have: number;
}

const USES: [RoomUse, RegExp][] = [
  ['bedroom', /\b(quarto|dormit|su[ií]te|bedroom|master)/i],
  ['living', /\b(sala|estar|jantar|living|dining|lounge|escrit[oó]rio|office|home)/i],
  ['kitchen', /\b(cozinha|kitchen|copa)/i],
  ['bath', /\b(banheiro|lavabo|wc|sanit|bath|toilet|lavatory)/i],
  ['laundry', /\b(servi[cç]o|lavanderia|laundry|utility)/i],
  ['hall', /\b(corredor|circula|hall|entrada|despensa|closet|dep[oó]sito|storage)/i],
];

/** The use of a room from its name (other when the name says nothing known). */
export function roomUse(name: string): RoomUse {
  for (const [u, re] of USES) if (re.test(name)) return u;
  return 'other';
}

/** Light: fraction of the floor and least window area (m²), by use. */
const LIGHT: Partial<Record<RoomUse, { frac: number; min: number }>> = {
  bedroom: { frac: 1 / 6, min: 0 },
  living: { frac: 1 / 6, min: 0 },
  kitchen: { frac: 1 / 8, min: 0.7 },
  laundry: { frac: 1 / 8, min: 1.2 },
  bath: { frac: 1 / 12, min: 0.24 },
};

function inside(p: Vec2, rings: Vec2[][]): boolean {
  let c = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if (r[i]![1] > p[1] !== r[j]![1] > p[1] && p[0] < ((r[j]![0] - r[i]![0]) * (p[1] - r[i]![1])) / (r[j]![1] - r[i]![1]) + r[i]![0]) c = !c;
  return c;
}

/** The checks of the named rooms of a floor. */
export function checkFloor(b: Building3, fp: FloorPlan): Check[] {
  const lv = sortedLevels(b)[fp.levelIndex];
  const height = lv ? lv.height - SLAB : 0;
  const out: Check[] = [];
  // The window area of each room: a window lights the room just inside it.
  const light = new Map<PlanRoom, number>();
  for (const w of fp.windows) {
    const mid: Vec2 = [(w.a[0] + w.b[0]) / 2 - w.n[0] * (w.depth + 0.15), (w.a[1] + w.b[1]) / 2 - w.n[1] * (w.depth + 0.15)];
    const r = fp.rooms.find((x) => inside(mid, x.rings));
    if (r) light.set(r, (light.get(r) ?? 0) + w.w * w.h);
  }
  for (const r of fp.rooms) {
    if (!r.name) continue;
    const use = roomUse(r.name);
    const L = LIGHT[use];
    const have = Math.round((light.get(r) ?? 0) * 100) / 100;
    if (L) {
      const need = Math.round(Math.max(L.min, r.area * L.frac) * 100) / 100;
      if (have === 0 && use !== 'bath') out.push({ room: r, use, ok: false, rule: 'window', need, have });
      else out.push({ room: r, use, ok: have >= need - 1e-6, rule: 'light', need, have });
    }
    if (use !== 'other' && height > 0) {
      const need = use === 'bath' || use === 'hall' ? 2.3 : 2.5;
      out.push({ room: r, use, ok: height >= need - 1e-6, rule: 'height', need, have: Math.round(height * 100) / 100 });
    }
  }
  return out;
}
