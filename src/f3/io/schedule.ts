// The room schedule (Revit's room schedule, ArchiCAD's zone list): every room of every floor with its
// use, area, perimeter, ceiling height and volume, as CSV with ';' between the fields (what a spreadsheet
// in Portuguese opens directly) and the numbers with the decimal separator given. Totals by use at the end.
import { ROOM_USE_NAMES, type Project3, type RoomUse } from '../model/schema';
import { roomArea, roomCeiling, roomPerimeter } from '../eval/interiorwalls';
import { sortedLevels } from '../eval/floorplan';

export interface RoomRow {
  building: string;
  floor: string;
  room: string;
  use: RoomUse | '';
  area: number;
  perimeter: number;
  ceiling: number;
  volume: number;
  finish: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function roomRows(p: Project3): RoomRow[] {
  const out: RoomRow[] = [];
  for (const b of p.buildings) {
    if (b.hidden) continue;
    for (const lv of sortedLevels(b)) {
      for (const r of b.interiors?.[lv.id]?.rooms ?? []) {
        const area = r.polygon && r.polygon.length > 2 ? roomArea(r.polygon) : (r.area ?? 0);
        const ceiling = roomCeiling(b, lv.id, r);
        out.push({ building: b.name, floor: lv.name, room: r.name, use: r.use ?? '', area: r2(area), perimeter: r2(r.polygon ? roomPerimeter(r.polygon) : 0), ceiling, volume: r2(area * ceiling), finish: r.finish?.finish ?? '' });
      }
    }
  }
  return out;
}

/** The schedule as CSV text; `t` translates the headings, the floor names and the uses. */
export function roomScheduleCsv(p: Project3, dec = '.', t: (s: string) => string = (s) => s): string {
  const n = (v: number) => v.toFixed(2).replace('.', dec);
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = roomRows(p);
  const head = ['Building', 'Floor', 'Room', 'Use', 'Area (m²)', 'Perimeter (m)', 'Ceiling (m)', 'Volume (m³)'].map(t);
  const lines = [head.join(';'), ...rows.map((r) => [q(r.building), q(t(r.floor)), q(r.room), q(r.use ? t(ROOM_USE_NAMES[r.use]) : ''), n(r.area), n(r.perimeter), n(r.ceiling), n(r.volume)].join(';'))];
  // Totals by use, then the whole.
  const byUse = new Map<string, { area: number; volume: number }>();
  for (const r of rows) {
    const k = r.use ? t(ROOM_USE_NAMES[r.use]) : t('No use');
    const s = byUse.get(k) ?? { area: 0, volume: 0 };
    s.area += r.area;
    s.volume += r.volume;
    byUse.set(k, s);
  }
  lines.push('');
  for (const [k, s] of byUse) lines.push([t('Total'), '', '', q(k), n(s.area), '', '', n(s.volume)].join(';'));
  lines.push([t('Total'), '', '', '', n(rows.reduce((a, r) => a + r.area, 0)), '', '', n(rows.reduce((a, r) => a + r.volume, 0))].join(';'));
  return lines.join('\r\n') + '\r\n';
}
