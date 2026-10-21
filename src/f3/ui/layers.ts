// Structure and Layers tabs of the right panel.
// Structure: the element tree (buildings → volumes → rules and parts) with a filter box,
// a type icon per row, eye and lock always visible, rename by double click and the layer as a
// colored dot (its selector only on the selected row) — like the SketchUp Outliner.
// Layers: project layers (eye, lock, color, active) and visibility per component category —
// like SketchUp Tags, Rhino layers and Revit Visibility/Graphics.
import type { Editor3 } from '../editor/editor';
import type { Building3, ID, Item, Solid } from '../model/schema';
import { addLayer, activeLayer, buildingHidden, DEFAULT_LAYER, ensureLayers, itemHidden, layersOf, removeLayer, solidHidden, viewOf } from '../model/layers';
import { CATEGORY_NAMES, type Category } from '../families/family';
import { family, typeById } from '../families/index';
import { icon } from './icons';
import { polish } from './kit';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function mountLayers(ed: Editor3): void {
  const layersPane = ed.shell.layers;
  const treePane = ed.shell.tree;
  const tabs = ed.shell.tabs;
  const open = new Set<ID>();
  let filter = '';
  let renaming: string | null = null;
  let lastKey = '';
  /** The volume row being dragged (`building|solid`); the drag data cannot be read during dragover. */
  let dragged: string | null = null;
  tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((t) =>
    t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      tabs.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      ed.shell.side.hidden = tab !== 'props';
      treePane.hidden = tab !== 'tree';
      layersPane.hidden = tab !== 'layers';
      lastKey = '';
      render();
    }),
  );

  // Structure: the filter bar is built once (typing never loses focus); the list re-renders.
  treePane.innerHTML = `<div class="f3-tree-bar"><input type="search" data-tf placeholder="Filter by name" aria-label="Filter the structure by name">
    <button class="f3-btn ic" data-tbar="expand" title="Expand all">▾</button><button class="f3-btn ic" data-tbar="collapse" title="Collapse all">▸</button>
    <button class="f3-btn ic" data-tbar="showall" title="Show all · Alt+H">${icon('eye')}</button><button class="f3-btn ic" data-tbar="isolate" title="Isolate the selection (hides the rest) · Shift+H">${icon('focus')}</button></div><div class="f3-sets"></div><div class="f3-tree-list"></div>`;
  const list = treePane.querySelector<HTMLElement>('.f3-tree-list')!;
  const setsBox = treePane.querySelector<HTMLElement>('.f3-sets')!;
  const filterBox = treePane.querySelector<HTMLInputElement>('[data-tf]')!;
  filterBox.addEventListener('input', () => {
    filter = filterBox.value.trim().toLowerCase();
    lastKey = '';
    render();
  });
  treePane.querySelector('[data-tbar="expand"]')!.addEventListener('click', () => {
    for (const b of ed.project.buildings) open.add(b.id);
    lastKey = '';
    render();
  });
  treePane.querySelector('[data-tbar="collapse"]')!.addEventListener('click', () => {
    open.clear();
    lastKey = '';
    render();
  });
  treePane.querySelector('[data-tbar="showall"]')!.addEventListener('click', () => ed.showAll());
  treePane.querySelector('[data-tbar="isolate"]')!.addEventListener('click', () => ed.isolateSelection());

  const layerOf = (id: ID | undefined) => layersOf(ed.project).find((l) => l.id === (id ?? DEFAULT_LAYER.id)) ?? DEFAULT_LAYER;
  const layerCell = (cur: ID | undefined, selected: boolean) => {
    if (!selected) {
      const l = layerOf(cur);
      return `<span class="ldot" style="background:${l.color}" title="Layer: ${esc(l.name)}"></span>`;
    }
    return `<select data-tact="layer" title="Layer">${layersOf(ed.project)
      .map((l) => `<option value="${l.id}" ${(cur ?? DEFAULT_LAYER.id) === l.id ? 'selected' : ''}>${esc(l.name)}</option>`)
      .join('')}</select>`;
  };
  const eye = (on: boolean, attr: string) => `<button class="ic" ${attr} aria-pressed="${on}" title="${on ? 'Hide' : 'Show'}">${icon(on ? 'eye' : 'eyeoff')}</button>`;
  const lock = (on: boolean, attr: string) => `<button class="ic" ${attr} aria-pressed="${!on}" title="${on ? 'Unlock' : 'Lock (visible, but not selectable)'}">${icon(on ? 'lock' : 'unlock')}</button>`;
  const kind = (ic: string, title: string) => `<span class="kind" title="${title}">${icon(ic)}</span>`;
  const hit = (s: string) => !filter || s.toLowerCase().includes(filter);
  const label = (s: string) => {
    if (!filter) return esc(s);
    const i = s.toLowerCase().indexOf(filter);
    return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + filter.length))}</mark>${esc(s.slice(i + filter.length))}`;
  };
  const nameCell = (key: string, name: string, renameable: boolean) =>
    renaming === key ? `<input class="nm" data-tact="rename" value="${esc(name)}" aria-label="New name">` : `<span class="nm" data-tact="pick"${renameable ? ' title="Click selects · double click renames"' : ''}>${label(name)}</span>`;

  function itemName(it: Item): string {
    return typeById(it.type, ed.project)?.name ?? 'Component';
  }

  function render(): void {
    if (!treePane.hidden) renderTree();
    if (!layersPane.hidden) renderLayers();
  }

  function renderTree(): void {
    const p = ed.project;
    renderSets();
    const key = JSON.stringify(['tree', filter, renaming, p.layers, p.buildings.map((b) => [b.id, b.name, b.hidden, b.locked, b.layer, b.solids.map((s) => [s.id, s.name, s.op, s.hidden, s.locked, s.layer, s.facade.map((r) => r.type)]), b.items.map((i) => [i.id, i.type, i.hidden, i.locked, i.layer])]), ed.sel, ed.context, [...open]]);
    if (key === lastKey) return;
    lastKey = key;
    const rows: string[] = [];
    for (const b of p.buildings) {
      const kids: string[] = [];
      for (const s of b.solids) {
        const ruleRows = s.facade
          .map((r) => {
            const t = typeById(r.type, ed.project);
            const nm = t?.name ?? r.type;
            const f = t && family(t.family);
            return hit(nm) ? `<div class="f3-lrow sub2" data-b="${b.id}" data-s="${s.id}" data-r="${r.id}">${kind('array', 'Facade rule')}<span class="nm" data-tact="pick" title="Selects every element of this rule">${label(nm)}${f ? ` <small style="color:var(--muted)">${esc(CATEGORY_NAMES[f.category])}</small>` : ''}</span></div>` : '';
          })
          .join('');
        if (hit(s.name) || ruleRows) kids.push(solidRow(b, s) + ruleRows);
      }
      for (const it of b.items) {
        if (!hit(itemName(it))) continue;
        const sel = ed.sel.item === it.id;
        kids.push(`<div class="f3-lrow sub${itemHidden(ed.project, it) ? ' off' : ''}" data-b="${b.id}" data-i="${it.id}" aria-selected="${sel}">${kind('catalog', 'Component')}${nameCell(`i:${it.id}`, itemName(it), false)}${layerCell(it.layer, sel)}${eye(!it.hidden, 'data-tact="eye"')}${lock(!!it.locked, 'data-tact="lock"')}</div>`);
      }
      if (!hit(b.name) && !kids.length) continue;
      const isOpen = open.has(b.id) || ed.context === b.id || (!!filter && kids.length > 0);
      const selB = ed.sel.building === b.id && !ed.sel.solids.length && !ed.sel.item;
      rows.push(`<div class="f3-lrow${buildingHidden(ed.project, b) ? ' off' : ''}" data-b="${b.id}" aria-selected="${selB}">
          <button class="ic on" data-tact="fold" title="${isOpen ? 'Collapse' : 'Expand'}">${isOpen ? '▾' : '▸'}</button>${kind('home', 'Building')}
          ${nameCell(`b:${b.id}`, b.name, true)}${layerCell(b.layer, selB)}${eye(!b.hidden, 'data-tact="eye"')}${lock(!!b.locked, 'data-tact="lock"')}</div>`);
      if (isOpen) rows.push(...kids);
    }
    list.innerHTML = rows.join('') || `<p class="f3-empty" style="padding:8px">${filter ? 'Nothing matches the filter.' : 'Nothing in the project yet.'}</p>`;
    bindTree();
    polish(list);
    const input = list.querySelector<HTMLInputElement>('[data-tact="rename"]');
    if (input) {
      input.focus();
      input.select();
    }
  }

  // Selection sets (Revit Save/Load Selection): click selects again, double click renames, × deletes.
  let setsKey = '';
  function renderSets(): void {
    const p = ed.project;
    const sets = p.selectionSets ?? [];
    const k = JSON.stringify([sets, renaming, !!ed.sel.building]);
    if (k === setsKey) return;
    setsKey = k;
    const rows = sets
      .map((st) => {
        const n = st.sel.solids.length || st.sel.elems.length || (st.sel.item ? 1 : 0) || 1 + st.sel.others.length;
        const what = st.sel.solids.length ? 'volume' : st.sel.elems.length ? 'element' : st.sel.item ? 'component' : 'building';
        const name = renaming === `set:${st.id}` ? `<input class="nm" data-sact="rename" value="${esc(st.name)}" aria-label="New name">` : `<span class="nm" data-sact="pick" title="Click selects again · double click renames">${esc(st.name)} <small style="color:var(--muted)">${n} ${what}${n === 1 ? '' : 's'}</small></span>`;
        return `<div class="f3-lrow" data-set="${st.id}">${kind('bookmark', 'Selection set')}${name}<button class="ic" data-sact="del" title="Delete the set (not the elements)">${icon('trash')}</button></div>`;
      })
      .join('');
    setsBox.innerHTML = `<div class="f3-sets-head"><span>Selection sets</span><button class="f3-btn" data-sact="save" ${ed.sel.building ? '' : 'disabled'} title="Saves what is selected under a name">${icon('add')}<span>Save selection</span></button></div>${rows}`;
    setsBox.querySelector('[data-sact="save"]')?.addEventListener('click', () => ed.saveSelectionSet());
    setsBox.querySelectorAll<HTMLElement>('[data-set]').forEach((row) => {
      const id = row.dataset.set!;
      const pick = row.querySelector<HTMLElement>('[data-sact="pick"]');
      pick?.addEventListener('click', () => ed.recallSelectionSet(id));
      pick?.addEventListener('dblclick', () => {
        renaming = `set:${id}`;
        setsKey = '';
        renderSets();
      });
      row.querySelector('[data-sact="del"]')?.addEventListener('click', () => ed.deleteSelectionSet(id));
      const input = row.querySelector<HTMLInputElement>('[data-sact="rename"]');
      if (input) {
        const done = (apply: boolean) => {
          if (renaming === null) return;
          renaming = null;
          setsKey = '';
          if (apply) ed.renameSelectionSet(id, input.value);
          renderSets();
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') done(true);
          else if (e.key === 'Escape') done(false);
        });
        input.addEventListener('blur', () => done(true));
        input.focus();
        input.select();
      }
    });
    polish(setsBox);
  }

  function solidRow(b: Building3, s: Solid): string {
    const sel = ed.sel.solids.includes(s.id);
    // The volumes are the building's operation stack, in boolean order: the kind icon cycles the
    // operation (adds → subtracts → intersects) and a row dragged onto another moves it there.
    const [ic, title] = s.op === 'add' ? ['add', 'Volume (adds)'] : s.op === 'subtract' ? ['subtract', 'Cutter (subtracts)'] : ['intersect', 'Intersection'];
    const k = `<button class="kind" data-tact="op" title="${title} · click: change">${icon(ic)}</button>`;
    return `<div class="f3-lrow sub${solidHidden(ed.project, s) ? ' off' : ''}" data-b="${b.id}" data-s="${s.id}" aria-selected="${sel}"${renaming === `s:${s.id}` ? '' : ' draggable="true"'}>${k}${nameCell(`s:${s.id}`, s.name, true)}${layerCell(s.layer, sel)}${eye(!s.hidden, 'data-tact="eye"')}${lock(!!s.locked, 'data-tact="lock"')}</div>`;
  }

  function renderLayers(): void {
    const p = ed.project;
    const key = JSON.stringify(['layers', p.layers, p.view, p.buildings.map((b) => [b.layer, b.solids.map((s) => s.layer), b.items.map((i) => i.layer)])]);
    if (key === lastKey && layersPane.contains(document.activeElement)) return;
    lastKey = key;
    const act = activeLayer(p) ?? DEFAULT_LAYER.id;
    const counts = new Map<ID, number>();
    const inc = (id: ID | undefined) => counts.set(id ?? DEFAULT_LAYER.id, (counts.get(id ?? DEFAULT_LAYER.id) ?? 0) + 1);
    for (const b of p.buildings) {
      inc(b.layer);
      b.solids.forEach((s) => inc(s.layer));
      b.items.forEach((i) => inc(i.layer));
    }
    const layers = layersOf(p)
      .map(
        (l) => `<div class="f3-lrow" data-layer="${l.id}">
        <button class="ic on" data-lact="active" aria-pressed="${l.id === act}" title="${l.id === act ? 'Active layer (receives what is created)' : 'Make active'}">${l.id === act ? '●' : '○'}</button>
        <input type="color" data-lact="color" value="${l.color}" title="Color">
        ${l.id === DEFAULT_LAYER.id ? `<span class="nm">${esc(l.name)}</span>` : `<input class="nm" data-lact="name" value="${esc(l.name)}" aria-label="Layer name">`}
        <small style="color:var(--muted)" title="Elements on this layer">${counts.get(l.id) ?? 0}</small>
        ${eye(l.visible, 'data-lact="eye"')}${lock(l.locked, 'data-lact="lock"')}
        ${l.id === DEFAULT_LAYER.id ? '<span style="width:22px"></span>' : `<button class="ic" data-lact="del" title="Delete layer (its content goes back to Default)">${icon('trash')}</button>`}
      </div>`,
      )
      .join('');
    const hiddenCats = new Set(p.view?.hiddenCategories ?? []);
    const cats = (Object.keys(CATEGORY_NAMES) as Category[])
      .map((c) => `<div class="f3-lrow" data-cat="${c}"><span class="nm">${CATEGORY_NAMES[c]}</span>${eye(!hiddenCats.has(c), 'data-cact="eye"')}</div>`)
      .join('');
    layersPane.innerHTML = `<div class="f3-sec"><h3>Layers <span class="r"><button class="f3-btn ic" data-lact="add" title="New layer">${icon('add')}</button></span></h3>${layers}</div>
      <div class="f3-sec"><h3>Categories in view</h3>${cats}</div>`;
    bindLayers();
    polish(layersPane);
  }

  function bindLayers(): void {
    const commitView = (msg: string) => ed.store.commit(null, msg, false);
    layersPane.querySelector('[data-lact="add"]')?.addEventListener('click', () => {
      const l = addLayer(ed.project);
      viewOf(ed.project).activeLayer = l.id;
      commitView(`Layer "${l.name}" created and active.`);
      ed.toast(`Layer "${l.name}" created and active.`);
    });
    layersPane.querySelectorAll<HTMLElement>('[data-layer]').forEach((row) => {
      const id = row.dataset.layer!;
      const L = () => ensureLayers(ed.project).find((l) => l.id === id)!;
      row.querySelector('[data-lact="active"]')?.addEventListener('click', () => {
        viewOf(ed.project).activeLayer = id;
        commitView('Active layer changed.');
      });
      row.querySelector<HTMLInputElement>('[data-lact="color"]')?.addEventListener('change', (e) => {
        L().color = (e.target as HTMLInputElement).value;
        commitView('Layer color.');
      });
      row.querySelector<HTMLInputElement>('[data-lact="name"]')?.addEventListener('change', (e) => {
        L().name = (e.target as HTMLInputElement).value.trim() || L().name;
        commitView('Layer renamed.');
      });
      row.querySelector('[data-lact="eye"]')?.addEventListener('click', () => {
        L().visible = !L().visible;
        commitView(L().visible ? 'Layer visible.' : 'Layer hidden.');
      });
      row.querySelector('[data-lact="lock"]')?.addEventListener('click', () => {
        L().locked = !L().locked;
        if (L().locked) ed.select({});
        commitView(L().locked ? 'Layer locked.' : 'Layer unlocked.');
      });
      row.querySelector('[data-lact="del"]')?.addEventListener('click', () => {
        if (removeLayer(ed.project, id)) {
          ed.store.commit(null, 'Layer deleted.', true);
          ed.toast('Layer deleted; its content went back to Default.');
        }
      });
    });
    layersPane.querySelectorAll<HTMLElement>('[data-cat]').forEach((row) =>
      row.querySelector('[data-cact="eye"]')?.addEventListener('click', () => {
        const v = viewOf(ed.project);
        const c = row.dataset.cat!;
        v.hiddenCategories = v.hiddenCategories.includes(c) ? v.hiddenCategories.filter((x) => x !== c) : [...v.hiddenCategories, c];
        commitView(`${CATEGORY_NAMES[c as Category]}: ${v.hiddenCategories.includes(c) ? 'hidden' : 'visible'}.`);
      }),
    );
  }

  function bindTree(): void {
    list.querySelectorAll<HTMLElement>('.f3-lrow[data-b]').forEach((row) => {
      const bid = row.dataset.b!,
        sid = row.dataset.s,
        iid = row.dataset.i,
        rid = row.dataset.r;
      const target = (b: Building3): Building3 | Solid | Item | undefined => (iid ? b.items.find((x) => x.id === iid) : sid ? b.solids.find((x) => x.id === sid) : b);
      row.querySelector('[data-tact="fold"]')?.addEventListener('click', () => {
        if (open.has(bid)) open.delete(bid);
        else open.add(bid);
        lastKey = '';
        render();
      });
      if (sid && !rid) {
        row.querySelector('[data-tact="op"]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          ed.change(
            bid,
            (b) => {
              const s = b.solids.find((x) => x.id === sid);
              if (!s) return false;
              s.op = s.op === 'add' ? 'subtract' : s.op === 'subtract' ? 'intersect' : 'add';
            },
            'Operation changed.',
          );
        });
        row.addEventListener('dragstart', (e) => {
          dragged = `${bid}|${sid}`;
          e.dataTransfer?.setData('text/plain', dragged);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        // Only volumes of the same building take the drop (the boolean order is per building).
        const accepts = () => !!dragged && dragged.startsWith(bid + '|');
        row.addEventListener('dragend', () => (dragged = null));
        row.addEventListener('dragover', (e) => {
          if (!accepts()) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          const after = e.offsetY > row.clientHeight / 2;
          row.classList.toggle('drop-before', !after);
          row.classList.toggle('drop-after', after);
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const after = row.classList.contains('drop-after');
          row.classList.remove('drop-before', 'drop-after');
          const [fb, fs] = (dragged ?? '').split('|');
          dragged = null;
          if (fb !== bid || !fs || fs === sid) return;
          ed.change(
            bid,
            (b) => {
              const from = b.solids.findIndex((x) => x.id === fs);
              if (from < 0) return false;
              const [moved] = b.solids.splice(from, 1);
              const to = b.solids.findIndex((x) => x.id === sid) + (after ? 1 : 0);
              b.solids.splice(to, 0, moved!);
            },
            'Volume order changed.',
          );
        });
      }
      const pick = row.querySelector<HTMLElement>('[data-tact="pick"]');
      pick?.addEventListener('click', () => {
        if (!sid && !iid) {
          if (ed.context === bid) ed.enter(null);
          return ed.select({ building: bid });
        }
        if (ed.context !== bid) ed.enter(bid);
        if (rid) {
          const keys = ed.elements().filter((e) => e.key.startsWith(`r|${sid}|${rid}|`)).map((e) => e.key);
          return ed.select({ building: bid, elems: keys });
        }
        if (iid) return ed.select({ building: bid, item: iid });
        ed.select({ building: bid, solids: [sid!] });
      });
      // Double click renames buildings and volumes (components take their type's name).
      if (!rid && !iid)
        pick?.addEventListener('dblclick', () => {
          renaming = sid ? `s:${sid}` : `b:${bid}`;
          lastKey = '';
          render();
        });
      const input = row.querySelector<HTMLInputElement>('[data-tact="rename"]');
      if (input) {
        const done = (apply: boolean) => {
          if (renaming === null) return;
          renaming = null;
          const v = input.value.trim();
          if (apply && v)
            ed.change(bid, (b) => {
              const t = target(b) as Building3 | Solid | undefined;
              if (!t || t.name === v) return false;
              t.name = v;
            }, 'Renamed.');
          lastKey = '';
          render();
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') done(true);
          else if (e.key === 'Escape') done(false);
        });
        input.addEventListener('blur', () => done(true));
      }
      row.querySelector<HTMLSelectElement>('[data-tact="layer"]')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        ed.change(bid, (b) => {
          const t = target(b);
          if (!t) return false;
          if (v === DEFAULT_LAYER.id) delete t.layer;
          else t.layer = v;
        }, 'Layer changed.');
      });
      row.querySelector('[data-tact="eye"]')?.addEventListener('click', () =>
        ed.change(bid, (b) => {
          const t = target(b);
          if (!t) return false;
          t.hidden = !t.hidden;
          if (!t.hidden) delete t.hidden;
        }, ''),
      );
      row.querySelector('[data-tact="lock"]')?.addEventListener('click', () => {
        ed.change(bid, (b) => {
          const t = target(b);
          if (!t) return false;
          t.locked = !t.locked;
          if (!t.locked) delete t.locked;
        }, '', false);
        ed.select({});
      });
    });
  }

  ed.onChange(render);
  render();
}
