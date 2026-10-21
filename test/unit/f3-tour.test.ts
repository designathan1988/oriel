import { beforeAll, describe, expect, it } from 'vitest';
import { loadKernel } from '../../src/f3/kernel/kernel';
import { TEMPLATES } from '../../src/f3/io/templates';
import { autoStops, buildingToWorld, roomView, tourApp, tourData, tourHtml, tourManifest, tourRooms, tourRuntime } from '../../src/f3/io/tour';
import { unzipStore } from '../../src/f3/io/zip';
import { validateForma3 } from '../../src/f3/io/migrate';
import { evaluateBuilding } from '../../src/f3/eval/evaluate';
import { withModifiers } from '../../src/f3/eval/modifiers';

beforeAll(async () => {
  await loadKernel();
});

describe('virtual tour', () => {
  it('rooms of the furnished house, in the world, each with the eye 1.6 m over its floor', () => {
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    p.buildings[0]!.position = [10, -4];
    p.buildings[0]!.rotation = 90;
    const { rooms, plans } = tourRooms(p);
    expect(rooms.map((r) => r.name).sort()).toEqual(['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Hall', 'Living and kitchen']);
    expect(plans).toHaveLength(1);
    // Turned 90°, a point of the plan (x, z) goes to (z, −x) and then by the position.
    const m = buildingToWorld(p.buildings[0]!);
    expect(m[0] * 2 + m[2] * 1 + m[4]).toBeCloseTo(11, 6);
    expect(m[1] * 2 + m[3] * 1 + m[5]).toBeCloseTo(-6, 6);
    for (const r of rooms) {
      expect(r.eye[1] - r.floor).toBeCloseTo(1.6, 6);
      // Inside the house turned and moved: x in 10 ± 4.5, z in −4 ± 6.
      expect(Math.abs(r.eye[0] - 10)).toBeLessThan(4.5);
      expect(Math.abs(r.eye[2] + 4)).toBeLessThan(6);
    }
  });

  it('a first tour: the project from outside, then each room walking', () => {
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    let n = 0;
    const stops = autoStops(p, () => `s${n++}`);
    expect(stops.length).toBe(3 + 5);
    expect(stops.filter((s) => s.walk).map((s) => s.name)).toContain('Bedroom 1');
    // The project with its stops is still a valid document (the file opens again).
    p.tour = { stops, hotspots: [{ id: 'h', title: 'Cozinha planejada', text: 'Cooktop e aéreos', at: [0, 1, 0] }] };
    expect(validateForma3(JSON.parse(JSON.stringify(p)))).toEqual([]);
    p.tour.stops[0]!.eye = [Number.NaN, 0, 0] as never;
    expect(validateForma3(JSON.parse(JSON.stringify(p))).join(' ')).toContain('tour stop');
  });

  it('the page carries the data safely and the viewer bundled; the app has its manifest, icons and service worker', async () => {
    const p = TEMPLATES.find((t) => t.id === 'house')!.make();
    p.tour = { title: 'Casa </script><b>x', stops: [], hotspots: [], phone: '(69) 99999-0000' };
    const data = tourData(p, new Uint8Array([1, 2, 3]), { decimal: ',', t: (s) => (s === 'Rooms' ? 'Cômodos' : s) });
    expect(data.t.Rooms).toBe('Cômodos');
    expect(data.plans[0]!.svg).toContain('<svg');
    expect(data.gross).toBeCloseTo(108, 0);
    const runtime = await tourRuntime();
    expect(runtime.length).toBeGreaterThan(100_000);
    expect(runtime).toContain('oriel-data');
    const html = tourHtml(data, runtime);
    // One script element closes the data, one the viewer: the title cannot break out of them.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const json = html.slice(html.indexOf('id="oriel-data">') + 16, html.indexOf('</script>'));
    expect(JSON.parse(json).title).toBe('Casa </script><b>x');
    const zip = unzipStore(tourApp(data, runtime, { s192: new Uint8Array([137, 80]), s512: new Uint8Array([137, 80]) }));
    expect(zip.map((f) => f.name).sort()).toEqual(['HOW-TO-PUBLISH.txt', 'icon-192.png', 'icon-512.png', 'index.html', 'manifest.webmanifest', 'sw.js']);
    const man = JSON.parse(tourManifest(data));
    expect(man.icons.map((i: { sizes: string }) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    expect(man.display).toBe('standalone');
    expect(new TextDecoder().decode(zip.find((f) => f.name === 'index.html')!.data)).toContain('rel="manifest"');
  }, 120000);

  it('a room is seen from a free corner, across to the far one', () => {
    const ring: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]];
    const v = roomView([ring], [])!;
    // In from a corner, looking toward the opposite half of the room.
    const corner = ring.reduce((a, q) => (Math.hypot(q[0] - v.eye[0], q[1] - v.eye[1]) < Math.hypot(a[0] - v.eye[0], a[1] - v.eye[1]) ? q : a));
    expect(Math.hypot(corner[0] - v.eye[0], corner[1] - v.eye[1])).toBeCloseTo(0.75, 2);
    expect(Math.hypot(v.look[0] - v.eye[0], v.look[1] - v.eye[1])).toBeGreaterThan(2);
    // A bed in that corner: another corner is taken.
    const bed = { lo: [corner[0] - 2, corner[1] - 2] as [number, number], hi: [corner[0] + 2, corner[1] + 2] as [number, number] };
    const w = roomView([ring], [bed])!;
    expect(Math.hypot(w.eye[0] - v.eye[0], w.eye[1] - v.eye[1])).toBeGreaterThan(1);
    // Every room of the templates gets a view.
    for (const id of ['house', 'townhouse']) for (const r of tourRooms(TEMPLATES.find((t) => t.id === id)!.make()).rooms) expect(r.view, `${id} ${r.name}`).toBeTruthy();
  });

  it('the two-storey house: a slab at each floor, opened over its stair, and the stair in the tour', () => {
    const p = TEMPLATES.find((t) => t.id === 'townhouse')!.make();
    const b = p.buildings[0]!;
    const cuts = withModifiers(b).solids.filter((s) => s.op === 'subtract');
    // Ground floor, upper floor and the stair's opening in the slab between them.
    expect(cuts).toHaveLength(3);
    const open = cuts.find((c) => c.id.includes('~open'))!;
    expect(open.base).toBeCloseTo(2.88, 6);
    const ev = evaluateBuilding(b, {}, p);
    expect(ev.warnings).toEqual([]);
    const { rooms } = tourRooms(p);
    expect(rooms.map((r) => r.name).sort()).toEqual(['Bathroom', 'Bedroom 1', 'Bedroom 2', 'Hall', 'Kitchen', 'Lavatory and laundry', 'Living room']);
    expect(new Set(rooms.map((r) => r.floor.toFixed(2)))).toEqual(new Set(['0.25', '3.15']));
    const d = tourData(p, new Uint8Array([1, 2, 3]));
    expect(d.stairs).toHaveLength(1);
    const st = d.stairs![0]!;
    // Along the east wall (x 2.85 … 3.85), from z −4 up to the middle of the house.
    expect(st.min[0]).toBeLessThan(2.85);
    expect(st.max[0]).toBeGreaterThan(3.85);
    expect(st.max[1]).toBeGreaterThan(0.7);
  });
});

