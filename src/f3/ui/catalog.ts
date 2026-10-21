// Component catalog: categories, search, favorites, real thumbnails
// (rendered from the family itself) and drag onto the wall/ground. Clicking
// a card starts placing; the project types appear under "My types".
import type { Editor3 } from '../editor/editor';
import type { ComponentType } from '../model/schema';
import { BUILTIN_TYPES, family } from '../families/index';
import { CATEGORY_NAMES, resolveParams, type Category } from '../families/family';
import { createThumbnailer, type Thumbnailer } from '../render/thumbs';
import { openCreator } from './creator';
import { icon } from './icons';
import { BLOCKS } from '../model/blocks';
import { MATERIAL_PRESETS, materialThumb } from './materials';
import { readImageFile } from '../render/images';
import { uid } from '../model/defaults';

const FAV_KEY = 'forma3_favorites';
const RECENT_KEY = 'forma3_recent';
const THUMB_KEY = 'forma3_thumb:';

/**
 * Thumbnail kept across sessions (localStorage, a small PNG as a data URL): the key carries the family's
 * code length, so a family that changes draws its thumbnails again.
 */
function thumbKey(t: ComponentType): string {
  const f = family(t.family);
  return THUMB_KEY + t.id + ':' + (f ? f.build.toString().length : 0) + ':' + JSON.stringify(t.params);
}
function cachedThumb(t: ComponentType): string | null {
  try {
    return localStorage.getItem(thumbKey(t));
  } catch {
    return null;
  }
}
async function keepThumb(t: ComponentType, url: string): Promise<void> {
  try {
    const blob = await (await fetch(url)).blob();
    const data = await new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => no(r.error);
      r.readAsDataURL(blob);
    });
    if (data.length < 60_000) localStorage.setItem(thumbKey(t), data);
  } catch {
    /* full storage: drawn again next time */
  }
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

/** Component types of a file made by "Export my types" (or a list of types): only families that exist. */
export function typesFromFile(raw: unknown): ComponentType[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { types?: unknown }).types) ? (raw as { types: unknown[] }).types : [];
  return list.filter((t): t is ComponentType => !!t && typeof t === 'object' && typeof (t as ComponentType).family === 'string' && !!family((t as ComponentType).family) && typeof (t as ComponentType).name === 'string' && typeof (t as ComponentType).params === 'object' && (t as ComponentType).params !== null && !Array.isArray((t as ComponentType).params));
}
const ORDER: Category[] = ['windows', 'doors', 'balconies', 'railings', 'fences', 'gates', 'structure', 'stairs', 'canopies', 'shading', 'ornament', 'roofgear', 'industrial', 'site', 'walls', 'facade', 'furniture', 'vegetation', 'street'];

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function mountCatalog(ed: Editor3): { open(): void } {
  const host = ed.shell.cat;
  const favs = loadFavs();
  let recent = loadRecent();
  // Every type that starts being placed (from here, Ctrl+K or the creator) goes first in Recent.
  let seenPlacing: string | null = null;
  ed.onChange(() => {
    if (!ed.placing || ed.placing === seenPlacing) {
      seenPlacing = ed.placing;
      return;
    }
    seenPlacing = ed.placing;
    recent = [ed.placing, ...recent.filter((x) => x !== ed.placing)].slice(0, 12);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      /* no storage: recents last only this session */
    }
  });
  let tab: string = 'blocks';
  let query = '';
  let tag: string | null = null;
  let thumbs: Thumbnailer | null = null;
  const types = (): ComponentType[] => [...BUILTIN_TYPES, ...ed.project.types.filter((t) => !BUILTIN_TYPES.some((b) => b.id === t.id))];
  const cats = (): string[] => {
    const present = new Set(types().map((t) => family(t.family)?.category).filter(Boolean) as string[]);
    return ['blocks', 'materials', 'fav', 'recent', ...ORDER.filter((c) => present.has(c)), 'mine'];
  };
  host.innerHTML = `<div class="f3-cat-head"><b>Library</b>
    <input type="search" placeholder="Search: window, gate, balcony…" aria-label="Search the library">
    <button class="f3-tb" data-c="new" title="New component: any family, every parameter, live picture">${icon('add')}</button>
    <button class="f3-tb" data-c="close" title="Close · K">${icon('close')}</button></div>
    <div class="f3-cat-body"><div class="f3-cat-tabs" role="tablist"></div><div class="f3-cards"></div></div>`;
  const search = host.querySelector<HTMLInputElement>('input')!;
  const tabsEl = host.querySelector<HTMLElement>('.f3-cat-tabs')!;
  const cards = host.querySelector<HTMLElement>('.f3-cards')!;
  host.querySelector('[data-c="close"]')!.addEventListener('click', () => ed.toggleLibrary(false));
  host.querySelector('[data-c="new"]')!.addEventListener('click', () => openCreator(ed));
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderCards();
  });
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') ed.toggleLibrary(false);
  });

  const label = (c: string) => (c === 'blocks' ? 'Massing blocks' : c === 'materials' ? 'Materials' : c === 'fav' ? 'Favorites' : c === 'recent' ? 'Recent' : c === 'mine' ? 'My types' : CATEGORY_NAMES[c as Category]);
  const count = (c: string) => (c === 'blocks' ? BLOCKS.length : c === 'materials' ? MATERIAL_PRESETS.length : c === 'fav' ? favs.size : c === 'recent' ? recent.length : c === 'mine' ? ed.project.types.filter((t) => t.user).length : types().filter((t) => family(t.family)?.category === c).length);
  const renderTabs = () => {
    tabsEl.innerHTML = cats()
      .map((c) => `<button data-tab="${c}" aria-pressed="${c === tab && !query}"><span>${label(c)}</span><small>${count(c) || ''}</small></button>${c === 'recent' ? '<hr>' : ''}`)
      .join('');
    tabsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        tab = b.dataset.tab!;
        tag = null;
        query = '';
        search.value = '';
        renderTabs();
        renderCards();
      }),
    );
  };

  const list = (): ComponentType[] => {
    const all = types();
    if (query) {
      return all.filter((t) => {
        const f = family(t.family);
        // Each typed word must start a word of the name, family, tags or category ("tree" is not in "street").
        const words = `${t.name} ${f?.name ?? ''} ${(f?.tags ?? []).join(' ')} ${f ? CATEGORY_NAMES[f.category] : ''}`.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(Boolean);
        return query.split(/\s+/).filter(Boolean).every((w) => words.some((x) => x.startsWith(w)));
      });
    }
    if (tab === 'fav') return all.filter((t) => favs.has(t.id));
    if (tab === 'mine') return ed.project.types.filter((t) => t.user);
    if (tab === 'recent') return recent.map((id) => all.find((t) => t.id === id)).filter((t): t is ComponentType => !!t);
    return all.filter((t) => family(t.family)?.category === tab && (!tag || (family(t.family)?.tags ?? []).includes(tag)));
  };

  const renderCards = () => {
    renderTabs();
    if (tab === 'blocks' && !query) {
      // Massing blocks: click and drop on the ground, on a roof or against a wall.
      cards.innerHTML = BLOCKS.map((b) => `<div class="f3-card" data-block="${b.id}" title="${b.name}: on the ground creates a building; on a roof stacks; on a wall attaches aligned (X subtracts)" aria-pressed="${ed.tool === 'block' && ed.blockId === b.id}"><div class="f3-blockico">${icon(b.icon)}</div><span>${b.name}</span></div>`).join('');
      cards.querySelectorAll<HTMLElement>('[data-block]').forEach((c) =>
        c.addEventListener('click', () => {
          ed.startBlock(c.dataset.block!);
          ed.toggleLibrary(false);
        }),
      );
      return;
    }
    if (tab === 'materials' && !query) {
      let html = '';
      let group = '';
      for (const m of MATERIAL_PRESETS) {
        if (m.group !== group) {
          group = m.group;
          html += `<div style="grid-column:1/-1;font-size:11px;color:var(--faint);padding:4px 2px 0">${group}</div>`;
        }
        const th = materialThumb(m.ref);
        html += `<div class="f3-card" data-mat="${m.id}" title="${m.name}: click and paint faces (Shift: whole volume)"><img alt="" ${th ? `src="${th}"` : ''} style="object-fit:cover"><span>${m.name}</span></div>`;
      }
      cards.innerHTML = html;
      cards.querySelectorAll<HTMLElement>('[data-mat]').forEach((c) =>
        c.addEventListener('click', () => {
          const m = MATERIAL_PRESETS.find((x) => x.id === c.dataset.mat)!;
          ed.paintMat = structuredClone(m.ref);
          ed.setTool('paint');
          ed.toggleLibrary(false);
          ed.toast(`${m.name}: click a face to paint.`);
        }),
      );
      return;
    }
    const items = list();
    // Cladding and facade: besides the areas, the own-image card.
    // My types: share them as a file, bring types from another project, or make a new one.
    const mine = tab === 'mine' && !query ? `<div class="f3-card" data-mine="new" title="New component: any family, every parameter"><div class="f3-blockico">${icon('add')}</div><span>New…</span></div><div class="f3-card" data-mine="import" title="Bring the types of a file exported from FORMA"><div class="f3-blockico">${icon('open')}</div><span>Import…</span></div>${items.length ? `<div class="f3-card" data-mine="export" title="Save these types as a file (for another project or a colleague)"><div class="f3-blockico">${icon('export')}</div><span>Export</span></div>` : ''}` : '';
    const upload = tab === 'facade' && !query ? `<div class="f3-card" data-upload title="Choose an image from the computer and place it on a wall (poster, graffiti, logo, mural)"><div class="f3-blockico">${icon('open')}</div><span>Image…</span></div>` : '';
    if (!items.length && !upload && !mine) {
      cards.innerHTML = `<p class="f3-empty" style="padding:6px 4px">${tab === 'fav' && !query ? 'Mark ★ on the components you use most.' : tab === 'recent' && !query ? 'The components you place appear here.' : 'Nothing found.'}</p>`;
      return;
    }
    // Tag filters of the category (the tags its families share), like the chips of a store.
    const tagCount = new Map<string, number>();
    if (!query && !['fav', 'recent', 'mine', 'blocks', 'materials'].includes(tab))
      for (const t of types().filter((x) => family(x.family)?.category === tab)) for (const g of family(t.family)?.tags ?? []) tagCount.set(g, (tagCount.get(g) ?? 0) + 1);
    const inTab = types().filter((x) => family(x.family)?.category === tab).length;
    // A tag every card has filters nothing.
    const chips = [...tagCount.entries()].filter(([, n]) => n >= 2 && n < inTab).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const chipBar = chips.length > 1 ? `<div class="f3-chips">${chips.map(([g]) => `<button data-chip="${g}" aria-pressed="${tag === g}">${g}</button>`).join('')}</div>` : '';
    cards.innerHTML = chipBar + mine + upload + items
      .map((t) => {
        const f = family(t.family)!;
        // Where it goes, as it really behaves (audit E8: free parts said "on the ground" and went on a terrace).
        const host = f.host === 'face' ? 'goes on a wall' : f.host === 'path' ? 'drawn point by point (Enter ends)' : f.host === 'roof' ? 'goes on a roof' : 'goes where you click (ground, terrace or slab)';
        return `<div class="f3-card" draggable="true" data-type="${t.id}" data-host="${host}" aria-label="${t.name} · ${host}" aria-pressed="${ed.placing === t.id}">
        <button class="fav" data-fav="${t.id}" aria-pressed="${favs.has(t.id)}" aria-label="Favorite">${icon('star')}</button>
        <img alt="" data-thumb="${t.id}"><span>${t.name}</span></div>`;
      })
      .join('');
    thumbs ??= createThumbnailer(ed.view.renderer, ed.view.ctx, { project: ed.project });
    cards.querySelectorAll<HTMLImageElement>('img[data-thumb]').forEach((img) => {
      const id = img.dataset.thumb!;
      const t = types().find((x) => x.id === id);
      if (!t) return;
      const kept = cachedThumb(t);
      if (kept) return void (img.src = kept);
      void thumbs!.get(id, t.params, t.family).then((url) => {
        img.src = url;
        void keepThumb(t, url);
        ed.view.mark();
      }).catch(() => undefined);
    });
    cards.querySelectorAll<HTMLButtonElement>('[data-chip]').forEach((c) =>
      c.addEventListener('click', () => {
        tag = tag === c.dataset.chip ? null : c.dataset.chip!;
        renderCards();
      }),
    );
    // Hover preview: the picture larger, with where it goes and its size.
    let pop: HTMLElement | null = null;
    cards.querySelectorAll<HTMLElement>('.f3-card[data-type]').forEach((c) => {
      c.addEventListener('mouseenter', () => {
        const t = types().find((x) => x.id === c.dataset.type);
        const f = t && family(t.family);
        const src = c.querySelector<HTMLImageElement>('img')?.src;
        if (!t || !f || !src) return;
        pop?.remove();
        pop = document.createElement('div');
        pop.className = 'f3-catpop';
        const sz = f.size(resolveParams(f, t.params)).map((v) => Math.round(v * 100) / 100);
        pop.innerHTML = `<img alt="" src="${src}"><b>${t.name}</b><small>${CATEGORY_NAMES[f.category]} · ${f.name} · ${sz[0]} × ${sz[1]} × ${sz[2]} m</small><small>Click, then it ${c.dataset.host ?? ''}.</small>`;
        const r = c.getBoundingClientRect(),
          root = ed.shell.root.getBoundingClientRect();
        pop.style.left = `${r.right - root.left + 8}px`;
        pop.style.top = `${Math.min(r.top - root.top, root.height - 260)}px`;
        ed.shell.root.appendChild(pop);
      });
      c.addEventListener('mouseleave', () => {
        pop?.remove();
        pop = null;
      });
      c.addEventListener('click', () => {
        pop?.remove();
        pop = null;
      });
    });
    cards.querySelectorAll<HTMLElement>('[data-mine]').forEach((c) =>
      c.addEventListener('click', () => {
        const what = c.dataset.mine;
        if (what === 'new') return openCreator(ed);
        if (what === 'export') {
          const data = JSON.stringify({ format: 'forma-types', version: 1, types: ed.project.types.filter((t) => t.user) }, null, 2);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
          a.download = `${(ed.project.name || 'project').replace(/[^\w-]+/g, '_')}-types.json`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          return;
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
          const f = input.files?.[0];
          if (!f) return;
          try {
            const got = typesFromFile(JSON.parse(await f.text()));
            if (!got.length) return ed.toast('No component types in that file.');
            const have = new Set(ed.project.types.map((t) => t.id));
            for (const t of got) ed.store.project.types.push({ ...structuredClone(t), id: have.has(t.id) || BUILTIN_TYPES.some((b) => b.id === t.id) ? uid() : t.id, user: true });
            ed.store.commit([], `${got.length} type(s) imported.`);
            ed.toast(`${got.length} component type(s) imported into My types.`);
            renderCards();
          } catch (err) {
            ed.toast(`Could not read the file: ${(err as Error).message}`);
          }
        });
        input.click();
      }),
    );
    cards.querySelector<HTMLElement>('[data-upload]')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          const im = await readImageFile(f);
          const w = Math.min(4, Math.max(0.5, im.w / 400));
          const type = { id: uid(), family: 'image-decal', name: im.name, params: { image: im.id, width: Math.round(w * 100) / 100, height: Math.round(((w * im.h) / im.w) * 100) / 100 }, user: true };
          (ed.project.images ??= []).push(im);
          ed.project.types.push(type);
          ed.store.commit(null, 'Image added to the project.', false);
          ed.startPlacing(type.id);
          ed.toggleLibrary(false);
          ed.toast(`${im.name}: click a wall to place it.`);
        } catch (err) {
          ed.toast(`Could not use the image: ${(err as Error).message}`);
        }
      });
      input.click();
    });
    cards.querySelectorAll<HTMLElement>('.f3-card[data-type]').forEach((c) => {
      c.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.fav')) return;
        ed.startPlacing(c.dataset.type!);
        ed.toggleLibrary(false);
      });
      c.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/forma-type', c.dataset.type!);
        ed.placing = c.dataset.type!;
      });
    });
    cards.querySelectorAll<HTMLButtonElement>('.fav').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.fav!;
        if (favs.has(id)) favs.delete(id);
        else favs.add(id);
        try {
          localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
        } catch {
          /* no storage: favorites last only this session */
        }
        renderCards();
      }),
    );
  };

  ed.catalogRequested = () => {
    host.classList.remove('closed');
    renderCards();
    search.focus();
  };
  let lastPlacing: string | null = null;
  ed.onChange(() => {
    if (ed.placing !== lastPlacing) {
      lastPlacing = ed.placing;
      cards.querySelectorAll<HTMLElement>('.f3-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.type === ed.placing)));
    }
  });
  renderCards();
  return { open: () => ed.catalogRequested?.() };
}
