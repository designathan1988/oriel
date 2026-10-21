// Virtual tour panel (Export → "Virtual tour and site", Ctrl+K "Virtual tour", stage 6 Present): the
// stops of the tour (the current view added as a stop, or a first tour made from the rooms), the
// numbered points of interest clicked on the model, the title and contact shown on the site, what the
// site offers (walking, VR, plans, playing by itself), and the publishing: a preview, the site as one
// HTML file, the installable app as a ZIP. A panel beside the view, not a dialog: the author moves the
// camera to frame each stop while it stays open. Every edit is one history step (Ctrl+Z).
import type { Editor3 } from '../editor/editor';
import type { TourHotspot, TourSpec, TourStop, Vec3 } from '../model/schema';
import { icon } from './icons';
import { tr } from './i18n';

export interface TourPublish {
  /** The tour opened in a new tab, as the client will see it. */
  preview(): Promise<void>;
  /** The site as one HTML file. */
  site(): Promise<void>;
  /** The installable app (PWA) as a ZIP to put on a host. */
  app(): Promise<void>;
  /** A first tour from the project (outside views and the rooms). */
  autoStops(): Promise<TourStop[]>;
}

const CSS = `
.f3-tour{position:absolute;z-index:14;left:12px;top:12px;bottom:12px;width:min(380px,calc(100% - 24px));display:flex;flex-direction:column;background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px #0005;font-size:12.5px;overflow:hidden}
.f3-tour header{display:flex;align-items:center;gap:8px;padding:12px 14px 8px}
.f3-tour header h2{margin:0;font-size:15px;flex:1}
.f3-tour .body{overflow:auto;padding:0 14px 10px;flex:1}
.f3-tour h3{margin:14px 0 6px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:6px}
.f3-tour h3 .n{background:var(--field);border-radius:8px;padding:0 6px;font-weight:600}
.f3-tour .row{display:flex;align-items:center;gap:4px;padding:4px;border-radius:8px;border:1px solid transparent}
.f3-tour .row.on{border-color:var(--accent,#e86a1e);background:var(--field)}
.f3-tour .row .i{width:22px;text-align:center;color:var(--muted);font-variant-numeric:tabular-nums;flex:none}
.f3-tour input,.f3-tour textarea{background:var(--field);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:4px 7px;font:inherit;min-width:0}
.f3-tour .row input{flex:1;height:26px}
.f3-tour textarea{width:100%;resize:vertical;min-height:44px;margin:2px 0 6px}
.f3-tour .ic{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;flex:none;padding:0}
.f3-tour .ic:hover{background:var(--field);color:var(--ink)}.f3-tour .ic[aria-pressed=true]{color:var(--accent,#e86a1e)}
.f3-tour .ic svg{width:16px;height:16px;fill:currentColor}
.f3-tour .btns{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
.f3-tour .grid{display:grid;grid-template-columns:96px 1fr;gap:6px 8px;align-items:center}
.f3-tour .grid input{height:28px}
.f3-tour .opts{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px}
.f3-tour .opts label{display:flex;align-items:center;gap:6px}
.f3-tour footer{border-top:1px solid var(--line);padding:10px 14px;display:flex;flex-direction:column;gap:8px;background:var(--raise)}
.f3-tour footer .btns{margin:0}
.f3-tour footer p{margin:0;color:var(--muted);font-size:11.5px;line-height:1.45}
.f3-tour .empty{color:var(--muted);padding:6px 4px}
.f3-tour .pick{color:var(--accent,#e86a1e);font-weight:600}
`;

const ARROWS = { up: 'M7 14l5-5 5 5z', down: 'M7 10l5 5 5-5z', del: 'M6 7h12l-1 13H7zM9 4h6l1 2H8z', go: 'M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z', walk: 'M13 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM9.5 8l-3 13h2.2l1.8-8 2 2v6h2v-7.5l-2-2 .6-3c1.3 1.5 3 2.5 4.9 2.5v-2c-1.7 0-3-.9-3.8-2.2l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5 0-.8.2L6 8.3V13h2V9.6z' };
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const r2 = (v: number) => Math.round(v * 100) / 100;

let open: HTMLElement | null = null;

export function openTour(ed: Editor3, pub: TourPublish): void {
  if (open) {
    open.remove();
    open = null;
  }
  const doc = ed.shell.root.ownerDocument;
  if (!doc.getElementById('f3-tour-css')) {
    const st = doc.createElement('style');
    st.id = 'f3-tour-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  const spec = (): TourSpec => (ed.project.tour ??= { stops: [], hotspots: [] });
  let sel: string | null = null;
  let picking = false;

  const panel = doc.createElement('div');
  panel.className = 'f3-tour';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Virtual tour');
  panel.innerHTML = `<header><h2>Virtual tour and site</h2><button class="ic" data-close aria-label="Close" style="font-size:18px">×</button></header>
    <div class="body">
      <h3>Stops <span class="n" data-nstops></span></h3>
      <div data-stops></div>
      <div class="btns"><button class="f3-btn" data-add>${icon('bookmark')}<span>Add the current view</span></button><button class="f3-btn" data-auto title="Views from outside and one stop walking in each named room">Make a tour from the rooms</button></div>
      <h3>Points of interest <span class="n" data-nhots></span></h3>
      <div data-hots></div>
      <div class="btns"><button class="f3-btn" data-pick>${icon('star')}<span>Add: click on the model</span></button></div>
      <h3>Title and contact</h3>
      <div class="grid">
        <label for="tt">Title</label><input id="tt" data-f="title" maxlength="120">
        <label for="ts">Description</label><input id="ts" data-f="subtitle" maxlength="200">
        <label for="ta">Architect</label><input id="ta" data-f="author" maxlength="120">
        <label for="tp">WhatsApp</label><input id="tp" data-f="phone" maxlength="40" inputmode="tel">
        <label for="te">E-mail</label><input id="te" data-f="email" maxlength="120" inputmode="email">
      </div>
      <h3>The site offers</h3>
      <div class="opts">
        <label><input type="checkbox" data-o="walk"> Walking inside</label>
        <label><input type="checkbox" data-o="vr"> Virtual reality (VR)</label>
        <label><input type="checkbox" data-o="plans"> Floor plans and areas</label>
        <label>Plays by itself, <input data-autoplay type="number" min="0" max="120" step="1" style="width:56px;height:26px"> s per stop (0: by hand)</label>
      </div>
    </div>
    <footer>
      <div class="btns"><button class="f3-btn" data-preview>Preview</button><button class="f3-btn primary" data-site>Download the site (HTML)</button><button class="f3-btn" data-app>Download the app (PWA, ZIP)</button></div>
      <p>The site is one file: it opens in any browser, also offline. To share a link, put it on any host (Netlify Drop, GitHub Pages): its address is the link, and the Share button on the site copies a link to the very view being seen. The app installs on phones from that address and works without internet.</p>
    </footer>`;
  ed.shell.view.appendChild(panel);
  open = panel;
  const $ = <T extends Element>(q: string) => panel.querySelector<T>(q)!;

  const commit = (msg: string) => ed.store.commit([], msg, false);

  // ── Camera ──
  const currentView = (): { eye: Vec3; target: Vec3 } => {
    const v = ed.view;
    const e = v.persp.position;
    return { eye: [r2(e.x), r2(e.y), r2(e.z)], target: [r2(v.target.x), r2(v.target.y), r2(v.target.z)] };
  };
  const goTo = (eye: Vec3, target: Vec3) => {
    const v = ed.view;
    v.stopAnim();
    v.setParallel(false);
    const dx = eye[0] - target[0],
      dy = eye[1] - target[1],
      dz = eye[2] - target[2];
    const d = Math.max(0.1, Math.hypot(dx, dy, dz));
    v.target.set(target[0], target[1], target[2]);
    v.distance = d;
    v.phi = Math.acos(Math.max(-1, Math.min(1, dy / d)));
    v.theta = Math.atan2(dx, dz);
    v.updateCamera();
  };

  // ── Lists ──
  const drawStops = () => {
    const box = $('[data-stops]');
    const s = spec();
    $('[data-nstops]').textContent = String(s.stops.length);
    if (!s.stops.length) {
      box.innerHTML = `<div class="empty">${tr('No stop yet: frame a view and add it, or make a tour from the rooms.')}</div>`;
      return;
    }
    box.innerHTML = s.stops
      .map(
        (st, i) => `<div class="row${st.id === sel ? ' on' : ''}" data-id="${st.id}">
        <span class="i">${i + 1}</span><input data-name aria-label="${tr('Stop name')}" maxlength="120">
        <button class="ic" data-walk aria-pressed="${!!st.walk}" title="${tr(st.walk ? 'Seen walking (eye height)' : 'Seen turning around the model')}">${svg(ARROWS.walk)}</button>
        <button class="ic" data-go title="${tr('See this stop')}">${svg(ARROWS.go)}</button>
        <button class="ic" data-up title="${tr('Earlier')}"${i === 0 ? ' disabled' : ''}>${svg(ARROWS.up)}</button>
        <button class="ic" data-down title="${tr('Later')}"${i === s.stops.length - 1 ? ' disabled' : ''}>${svg(ARROWS.down)}</button>
        <button class="ic" data-del title="${tr('Remove')}">${svg(ARROWS.del)}</button>
      </div>${st.id === sel ? `<textarea data-note placeholder="${tr('What the client should notice here (optional)')}" maxlength="2000"></textarea><div class="btns"><button class="f3-btn" data-update>${tr('Use the current view for this stop')}</button></div>` : ''}`,
      )
      .join('');
    // Names typed by the author: set as values, never as HTML.
    box.querySelectorAll<HTMLElement>('.row').forEach((row) => {
      const st = s.stops.find((x) => x.id === row.dataset.id)!;
      row.querySelector<HTMLInputElement>('[data-name]')!.value = st.name;
    });
    const note = box.querySelector<HTMLTextAreaElement>('[data-note]');
    if (note) note.value = s.stops.find((x) => x.id === sel)?.note ?? '';
  };
  const drawHots = () => {
    const box = $('[data-hots]');
    const s = spec();
    $('[data-nhots]').textContent = String(s.hotspots.length);
    if (!s.hotspots.length) {
      box.innerHTML = `<div class="empty">${picking ? `<span class="pick">${tr('Click on the model where the point goes (Esc cancels).')}</span>` : tr('Numbered markers on the model that open a card: a material, a detail, a view.')}</div>`;
      return;
    }
    box.innerHTML =
      s.hotspots
        .map(
          (h, i) => `<div class="row" data-id="${h.id}"><span class="i">${i + 1}</span><input data-title aria-label="${tr('Point title')}" maxlength="120">
        <button class="ic" data-go title="${tr('See this point')}">${svg(ARROWS.go)}</button><button class="ic" data-del title="${tr('Remove')}">${svg(ARROWS.del)}</button></div>
        <textarea data-text placeholder="${tr('Text of the card (optional)')}" maxlength="2000"></textarea>`,
        )
        .join('') + (picking ? `<div class="empty pick">${tr('Click on the model where the point goes (Esc cancels).')}</div>` : '');
    box.querySelectorAll<HTMLElement>('.row').forEach((row) => {
      const h = s.hotspots.find((x) => x.id === row.dataset.id)!;
      row.querySelector<HTMLInputElement>('[data-title]')!.value = h.title;
      (row.nextElementSibling as HTMLTextAreaElement).value = h.text ?? '';
      (row.nextElementSibling as HTMLTextAreaElement).dataset.id = h.id;
    });
  };
  const drawInfo = () => {
    const s = spec();
    panel.querySelectorAll<HTMLInputElement>('[data-f]').forEach((i) => (i.value = (s[i.dataset.f as 'title'] as string | undefined) ?? (i.dataset.f === 'title' ? '' : '')));
    $<HTMLInputElement>('[data-f="title"]').placeholder = ed.project.name;
    panel.querySelectorAll<HTMLInputElement>('[data-o]').forEach((i) => (i.checked = s[i.dataset.o as 'walk'] !== false));
    $<HTMLInputElement>('[data-autoplay]').value = String(s.autoplay ?? 0);
  };
  const draw = () => {
    drawStops();
    drawHots();
    drawInfo();
  };
  draw();

  // ── Stops ──
  $('[data-add]').addEventListener('click', () => {
    const s = spec();
    const v = currentView();
    const st: TourStop = { id: crypto.randomUUID(), name: `${tr('Stop')} ${s.stops.length + 1}`, ...v };
    s.stops.push(st);
    sel = st.id;
    commit('Stop added to the tour.');
    drawStops();
    panel.querySelector<HTMLInputElement>(`.row[data-id="${st.id}"] [data-name]`)?.select();
  });
  $('[data-auto]').addEventListener('click', async () => {
    const s = spec();
    const made = await pub.autoStops();
    if (!made.length) return ed.toast(tr('Nothing to visit yet: draw a building first.'));
    s.stops = s.stops.length && !confirm(tr('Replace the stops of the tour with a new tour from the rooms?')) ? [...s.stops, ...made] : made;
    sel = null;
    commit('Tour made from the rooms.');
    drawStops();
    ed.toast(`${made.length} ${tr('stops: rename them, frame them again or remove them.')}`);
  });
  const stopsBox = $('[data-stops]');
  stopsBox.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.row');
    const s = spec();
    if (t.closest('[data-update]') && sel) {
      const st = s.stops.find((x) => x.id === sel);
      if (st) Object.assign(st, currentView());
      commit('Stop framed again.');
      return ed.toast(tr('The stop now shows the current view.'));
    }
    if (!row) return;
    const i = s.stops.findIndex((x) => x.id === row.dataset.id);
    const st = s.stops[i];
    if (!st) return;
    if (t.closest('[data-go]')) {
      sel = st.id;
      goTo(st.eye, st.target);
      drawStops();
    } else if (t.closest('[data-walk]')) {
      st.walk = !st.walk;
      commit(st.walk ? 'Stop seen walking.' : 'Stop seen from around.');
      drawStops();
    } else if (t.closest('[data-up]') && i > 0) {
      s.stops.splice(i - 1, 0, ...s.stops.splice(i, 1));
      commit('Stop moved.');
      drawStops();
    } else if (t.closest('[data-down]') && i < s.stops.length - 1) {
      s.stops.splice(i + 1, 0, ...s.stops.splice(i, 1));
      commit('Stop moved.');
      drawStops();
    } else if (t.closest('[data-del]')) {
      s.stops.splice(i, 1);
      if (sel === st.id) sel = null;
      commit('Stop removed.');
      drawStops();
    } else if (!t.closest('input') && sel !== st.id) {
      sel = st.id;
      goTo(st.eye, st.target);
      drawStops();
    }
  });
  stopsBox.addEventListener('focusin', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (row && row.dataset.id !== sel && (e.target as HTMLElement).matches('[data-name]')) {
      sel = row.dataset.id!;
      const st = spec().stops.find((x) => x.id === sel);
      if (st) goTo(st.eye, st.target);
      const caret = (e.target as HTMLInputElement).selectionStart;
      drawStops();
      const inp = panel.querySelector<HTMLInputElement>(`.row[data-id="${sel}"] [data-name]`);
      inp?.focus();
      if (inp && caret !== null) inp.setSelectionRange(caret, caret);
    }
  });
  stopsBox.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const s = spec();
    if (t.matches('[data-name]')) {
      const st = s.stops.find((x) => x.id === t.closest<HTMLElement>('.row')!.dataset.id);
      if (st) st.name = t.value.trim().slice(0, 120) || st.name;
      commit('Stop renamed.');
    } else if (t.matches('[data-note]') && sel) {
      const st = s.stops.find((x) => x.id === sel);
      if (st) st.note = t.value.trim().slice(0, 2000) || undefined;
      commit('Stop note.');
    }
  });

  // ── Points of interest ──
  const view = ed.view.el;
  const onPick = (e: PointerEvent) => {
    if (!picking || e.button !== 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const p = ed.view.modelAt(e);
    stopPick();
    if (!p) return ed.toast(tr('Click on the model itself (a wall, a roof, a piece of furniture).'));
    const s = spec();
    const h: TourHotspot = { id: crypto.randomUUID(), title: `${tr('Point')} ${s.hotspots.length + 1}`, at: [r2(p.x), r2(p.y + 0.15), r2(p.z)] };
    s.hotspots.push(h);
    commit('Point of interest added.');
    drawHots();
    panel.querySelector<HTMLInputElement>(`.row[data-id="${h.id}"] [data-title]`)?.select();
  };
  const stopPick = () => {
    picking = false;
    view.removeEventListener('pointerdown', onPick, true);
    view.style.cursor = '';
    drawHots();
  };
  $('[data-pick]').addEventListener('click', () => {
    picking = true;
    view.addEventListener('pointerdown', onPick, true);
    view.style.cursor = 'crosshair';
    drawHots();
  });
  const hotsBox = $('[data-hots]');
  hotsBox.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>('.row');
    if (!row) return;
    const s = spec();
    const i = s.hotspots.findIndex((x) => x.id === row.dataset.id);
    const h = s.hotspots[i];
    if (!h) return;
    if (t.closest('[data-go]')) {
      const v = ed.view;
      const dir = v.persp.position.clone().sub(v.target).normalize();
      goTo([h.at[0] + dir.x * 6, h.at[1] + dir.y * 6, h.at[2] + dir.z * 6], h.at);
    } else if (t.closest('[data-del]')) {
      s.hotspots.splice(i, 1);
      commit('Point of interest removed.');
      drawHots();
    }
  });
  hotsBox.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLTextAreaElement;
    const s = spec();
    if (t.matches('[data-title]')) {
      const h = s.hotspots.find((x) => x.id === t.closest<HTMLElement>('.row')!.dataset.id);
      if (h) h.title = t.value.trim().slice(0, 120) || h.title;
    } else if (t.matches('[data-text]')) {
      const h = s.hotspots.find((x) => x.id === (t as HTMLElement).dataset.id);
      if (h) h.text = t.value.trim().slice(0, 2000) || undefined;
    } else return;
    commit('Point of interest edited.');
  });

  // ── Title, contact, options ──
  panel.querySelectorAll<HTMLInputElement>('[data-f]').forEach((inp) =>
    inp.addEventListener('change', () => {
      const s = spec();
      const k = inp.dataset.f as 'title' | 'subtitle' | 'author' | 'phone' | 'email';
      const v = inp.value.trim();
      if (v) s[k] = v;
      else delete s[k];
      commit('Tour information.');
    }),
  );
  panel.querySelectorAll<HTMLInputElement>('[data-o]').forEach((inp) =>
    inp.addEventListener('change', () => {
      spec()[inp.dataset.o as 'walk' | 'vr' | 'plans'] = inp.checked;
      commit('Tour options.');
    }),
  );
  $<HTMLInputElement>('[data-autoplay]').addEventListener('change', (e) => {
    const v = Math.max(0, Math.min(120, Math.round(Number((e.target as HTMLInputElement).value) || 0)));
    spec().autoplay = v;
    (e.target as HTMLInputElement).value = String(v);
    commit('Tour options.');
  });

  // ── Publish ──
  const busy = async (btn: HTMLButtonElement, f: () => Promise<void>) => {
    if (btn.disabled) return;
    // A field being typed in is saved before the tour is made.
    (doc.activeElement as HTMLElement | null)?.blur?.();
    btn.disabled = true;
    try {
      await f();
    } catch (err) {
      ed.toast(`${tr('Could not publish:')} ${(err as Error).message}`);
    } finally {
      btn.disabled = false;
    }
  };
  $<HTMLButtonElement>('[data-preview]').addEventListener('click', (e) => busy(e.currentTarget as HTMLButtonElement, pub.preview));
  $<HTMLButtonElement>('[data-site]').addEventListener('click', (e) => busy(e.currentTarget as HTMLButtonElement, pub.site));
  $<HTMLButtonElement>('[data-app]').addEventListener('click', (e) => busy(e.currentTarget as HTMLButtonElement, pub.app));

  // ── Closing, undo ──
  const off = ed.store.on((ev) => {
    if (ev.kind === 'history' && open === panel && !panel.contains(doc.activeElement)) draw();
  });
  const close = () => {
    stopPick();
    off();
    panel.remove();
    if (open === panel) open = null;
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && picking) {
      e.stopPropagation();
      stopPick();
    } else if ((e.target as HTMLElement).closest?.('.f3-tour input, .f3-tour textarea')) e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  $('[data-close]').addEventListener('click', close);
}
