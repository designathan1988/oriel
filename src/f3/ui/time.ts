// Time of day in the view island: a button with the time and a slider
// (day, sunset, night). The time is kept in the project view state.
import type { Editor3 } from '../editor/editor';
import { viewOf } from '../model/layers';
import { icon } from './icons';
import { closeOnOutside } from './kit';
import { SUN_PRESETS, sunPosition } from '../model/sun';

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export function mountTime(ed: Editor3): void {
  const bar = ed.shell.viewbar;
  const btn = document.createElement('button');
  btn.className = 'f3-tb';
  btn.title = 'Time of day: sun, sky and night lights';
  const anchor = bar.querySelector('[data-cmd="snap"]')!;
  bar.insertBefore(btn, anchor);
  // Read only: creating `view` here changed the document on open, outside the history.
  let hour = ed.project.view?.time ?? 13;
  const apply = (h: number, save = true) => {
    hour = Math.max(0, Math.min(23.99, h));
    const rs = ed.project.view?.sun;
    const [y, mo, d] = (rs?.date ?? '2026-06-21').split('-').map(Number);
    const real = rs ? sunPosition({ date: { year: y ?? 2026, month: mo ?? 6, day: d ?? 21 }, hour, latitude: rs.latitude, longitude: rs.longitude, utcOffset: rs.utcOffset, north: rs.north }) : undefined;
    const dark = ed.view.look.setTime(hour, real ? { altitude: real.altitude, dir: real.dir } : undefined);
    ed.view.setDark(dark);
    ed.view.mark();
    btn.innerHTML = `${icon(dark > 0.5 ? 'moon' : 'sun')}<span>${fmt(hour)}</span>`;
    btn.setAttribute('aria-pressed', String(dark > 0.5));
    if (save) viewOf(ed.project).time = hour;
  };
  apply(hour, false);
  let pop: HTMLElement | null = null;
  let off: (() => void) | null = null;
  const close = () => {
    off?.();
    off = null;
    pop?.remove();
    pop = null;
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop) return close();
    pop = document.createElement('div');
    pop.className = 'f3-island';
    pop.style.cssText = 'position:absolute;z-index:20;width:260px;padding:10px 12px;display:grid;gap:8px';
    pop.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><b style="font-size:12px">Time of day</b><span data-h style="margin-left:auto;font:600 12px ui-monospace,Consolas,monospace">${fmt(hour)}</span></div>
      <input type="range" min="0" max="23.75" step="0.25" value="${hour}" aria-label="Time" style="width:100%;accent-color:var(--accent)">
      <div class="f3-seg"><button data-p="9">Morning</button><button data-p="13">Noon</button><button data-p="18.5">Sunset</button><button data-p="21.5">Night</button></div>
      <label style="display:grid;grid-template-columns:64px 1fr;align-items:center;gap:6px;font-size:11.5px">Sun<select data-place style="min-width:0">${['<option value="">Stylized</option>', ...SUN_PRESETS.map((c) => `<option value="${c.id}"${ed.project.view?.sun?.place === c.id ? ' selected' : ''}>${c.name}</option>`), ...(ed.project.view?.sun && !SUN_PRESETS.some((c) => c.id === ed.project.view?.sun?.place) ? [`<option value="custom" selected>${(ed.project.view.sun.place ?? 'Found place').replace(/</g, '&lt;')}</option>`] : [])].join('')}</select></label>
      <label style="display:grid;grid-template-columns:64px 1fr;align-items:center;gap:6px;font-size:11.5px">Date<input type="date" data-date value="${ed.project.view?.sun?.date ?? '2026-06-21'}"></label>
      <label style="display:grid;grid-template-columns:64px 1fr;align-items:center;gap:6px;font-size:11.5px">North<input type="number" step="5" data-north value="${ed.project.view?.sun?.north ?? 0}" title="Angle of true north, clockwise from the screen up in the top view (degrees)"></label>
      <div style="display:grid;grid-template-columns:64px 1fr auto;align-items:center;gap:6px;font-size:11.5px">Place<input data-addr placeholder="Address or city" value="${ed.project.view?.sun && !SUN_PRESETS.some((c) => c.id === ed.project.view?.sun?.place) ? (ed.project.view.sun.place ?? '').replace(/"/g, '&quot;') : ''}" style="min-width:0"><button class="f3-btn" data-find title="Find the place (OpenStreetMap Nominatim)">Find</button></div>
      <button class="f3-btn" data-osm style="justify-content:center" title="The buildings within 200 m of the place, from OpenStreetMap, on a locked layer">Buildings around (OpenStreetMap)</button>
      <small style="color:var(--faint);font-size:10.5px">Map data © OpenStreetMap contributors (ODbL)</small>`;
    const r = btn.getBoundingClientRect(),
      rv = ed.shell.view.getBoundingClientRect();
    pop.style.left = `${Math.min(rv.width - 270, r.left - rv.left - 100)}px`;
    // Above the button when there is room, else below it; never past the view (it scrolls instead).
    const above = r.top - rv.top - 16,
      below = rv.bottom - r.bottom - 16;
    if (above >= 420 || above >= below) {
      pop.style.bottom = `${rv.bottom - r.top + 8}px`;
      pop.style.maxHeight = `${Math.max(160, above)}px`;
    } else {
      pop.style.top = `${r.bottom - rv.top + 8}px`;
      pop.style.maxHeight = `${Math.max(160, below)}px`;
    }
    pop.style.overflowY = 'auto';
    ed.shell.view.appendChild(pop);
    const range = pop.querySelector<HTMLInputElement>('input')!;
    const label = pop.querySelector<HTMLElement>('[data-h]')!;
    range.addEventListener('input', () => {
      apply(parseFloat(range.value));
      label.textContent = fmt(hour);
    });
    pop.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) =>
      b.addEventListener('click', () => {
        apply(parseFloat(b.dataset.p!));
        range.value = String(hour);
        label.textContent = fmt(hour);
      }),
    );
    // The real sun: place, date and north are view settings of the project (saved, no history step).
    const placeSel = pop.querySelector<HTMLSelectElement>('[data-place]')!;
    const dateIn = pop.querySelector<HTMLInputElement>('[data-date]')!;
    const northIn = pop.querySelector<HTMLInputElement>('[data-north]')!;
    const setSun = () => {
      const c = SUN_PRESETS.find((q) => q.id === placeSel.value);
      const v = viewOf(ed.project);
      // The found place stays while only the date or north change.
      if (placeSel.value === 'custom' && v.sun) {
        v.sun = { ...v.sun, date: dateIn.value || v.sun.date, north: parseFloat(northIn.value) || 0 };
        ed.store.commit(null, '', false);
        apply(hour);
        return;
      }
      if (!c) delete v.sun;
      else v.sun = { date: dateIn.value || '2026-06-21', latitude: c.latitude, longitude: c.longitude, utcOffset: c.utcOffset, north: parseFloat(northIn.value) || 0, place: c.id };
      ed.store.commit(null, '', false);
      apply(hour);
    };
    // Any place: found by Nominatim (one request per click, as its usage policy asks; no typing search).
    const addr = pop.querySelector<HTMLInputElement>('[data-addr]')!;
    const find = async () => {
      const q = addr.value.trim();
      if (!q) return;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        const hit = ((await r.json()) as { lat: string; lon: string; display_name: string }[])[0];
        if (!hit) return ed.toast(`No place called “${q}” on OpenStreetMap.`);
        const lat = parseFloat(hit.lat),
          lon = parseFloat(hit.lon);
        const v = viewOf(ed.project);
        v.sun = { date: dateIn.value || '2026-06-21', latitude: lat, longitude: lon, utcOffset: Math.round(lon / 15), north: parseFloat(northIn.value) || 0, place: hit.display_name.split(',').slice(0, 2).join(',').slice(0, 80) };
        ed.store.commit(null, '', false);
        let opt = placeSel.querySelector<HTMLOptionElement>('option[value="custom"]');
        if (!opt) {
          opt = document.createElement('option');
          opt.value = 'custom';
          placeSel.appendChild(opt);
        }
        opt.textContent = v.sun.place ?? 'Found place';
        placeSel.value = 'custom';
        apply(hour);
        ed.toast(`${v.sun.place} (${lat.toFixed(4)}, ${lon.toFixed(4)}): the sun follows this place.`);
      } catch (err) {
        ed.toast(`The place search did not answer (${(err as Error).message}).`);
      }
    };
    pop.querySelector<HTMLButtonElement>('[data-find]')!.addEventListener('click', () => void find());
    addr.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void find();
    });
    pop.querySelector<HTMLButtonElement>('[data-osm]')!.addEventListener('click', () => void ed.importOsm(200));
    placeSel.addEventListener('change', setSun);
    dateIn.addEventListener('change', setSun);
    northIn.addEventListener('change', setSun);
    off = closeOnOutside(pop, close, btn);
  });
  // Project opened or new: back to the time saved in it.
  ed.store.on((ev) => {
    if (ev.kind === 'change' && (ed.project.view?.time ?? 13) !== hour && !pop) apply(ed.project.view?.time ?? 13, false);
  });
}
