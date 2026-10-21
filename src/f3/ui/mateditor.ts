// Surface editor: everything about a material besides its finish and colours. How glossy and how
// metallic it is, the size and the turn of its texture, the light it gives off, how much it lets through,
// and your own picture as the texture (a photographed floor, a wallpaper, a logo, a painting). The paint
// bucket shows it in its panel; every material row of the inspector opens it beside the row (its ⋯
// button). A value left empty is the finish's own; "Finish values" drops every adjustment.
import type { Editor3 } from '../editor/editor';
import type { MaterialRef } from '../model/schema';
import { finishOf } from '../render/finishes';
import { readImageFile } from '../render/images';
import { icon } from './icons';
import { numCell, prow, selectCell } from './kit';

/** Bumped when a surface editor opens or closes: the inspector redraws even with the focus inside it. */
export const surfaceToggles = { n: 0 };

/** The adjustable values, their range and step, and the finish's own value when absent. */
const FIELDS: { k: 'rough' | 'metal' | 'scale' | 'rot' | 'glow' | 'opacity'; label: string; title: string; ic: string; min: number; max: number; step: number; unit?: string }[] = [
  { k: 'rough', label: 'Roughness', title: 'Roughness: 0 polished (mirror-like reflections), 1 matte', ic: 'palette', min: 0, max: 1, step: 0.05 },
  { k: 'metal', label: 'Metallic', title: 'Metallic: 0 paint, stone, wood; 1 bare metal (reflects in its own colour)', ic: 'palette', min: 0, max: 1, step: 0.05 },
  { k: 'scale', label: 'Texture size', title: 'Texture size: ×1 is the finish as it comes; with your picture, its width in metres', ic: 'scale', min: 0.05, max: 50, step: 0.1 },
  { k: 'rot', label: 'Texture turn', title: 'Texture turn (degrees): boards lengthwise or across, a tile set at 45°', ic: 'rot90', min: -360, max: 360, step: 15, unit: '°' },
  { k: 'glow', label: 'Light given off', title: 'Light given off: 0 none, 1 a lit sign, 3 a lamp (lights the rooms in the photorealistic render)', ic: 'star', min: 0, max: 20, step: 0.25 },
  { k: 'opacity', label: 'Opacity', title: 'Opacity: 1 solid, 0.3 a frosted screen, 0.05 almost invisible', ic: 'eye', min: 0.02, max: 1, step: 0.05 },
];

/** The value the surface has now (the adjustment, or the finish's own). */
export function surfaceValue(ref: MaterialRef, k: (typeof FIELDS)[number]['k']): number {
  const f = finishOf(ref.finish);
  switch (k) {
    case 'rough':
      return ref.rough ?? f.roughness;
    case 'metal':
      return ref.metal ?? f.metalness ?? 0;
    case 'scale':
      return ref.scale ?? 1;
    case 'rot':
      return ref.rot ?? 0;
    case 'glow':
      return ref.glow ?? 0;
    case 'opacity':
      return ref.opacity ?? 1;
  }
}

/** Whether the material carries any adjustment over its finish. */
export const adjusted = (ref: MaterialRef): boolean => FIELDS.some((d) => ref[d.k] !== undefined);

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * The rows of the editor for `ref`. `attr` names the material (the bucket, or a slot of the selected
 * volume) so the binder knows which one a field changes.
 */
export function surfaceRows(ed: Editor3, ref: MaterialRef): string {
  const images = ed.project.images ?? [];
  const pic =
    ref.finish === 'image'
      ? prow('Picture', 'material', [selectCell('data-sf="image"', 'Picture used as the texture', images.map((im) => [im.id, im.name] as const), ref.image ?? '')], { wide: true })
      : '';
  return `${pic}${FIELDS.map((d) =>
    prow(d.label, d.ic, [numCell({ attr: `data-sf="${d.k}"`, name: d.title, value: num(surfaceValue(ref, d.k)), glyph: '', step: d.step, ...(d.unit ? { unit: d.unit } : {}), ...(ref[d.k] !== undefined ? { over: true } : {}) })], { title: d.title }),
  ).join('')}
  <div class="f3-btns n2"><button class="f3-btn" data-sf-pic title="Your own picture as the texture: a photographed floor or wall, a wallpaper, a logo">${icon('add')}Your picture…</button><button class="f3-btn" data-sf-reset title="Back to the finish's own values"${adjusted(ref) ? '' : ' disabled'}>${icon('restore')}Finish values</button></div>`;
}

/** Clamps and stores one value (the finish's own value removes the adjustment). */
function setField(ref: MaterialRef, k: (typeof FIELDS)[number]['k'], v: number): void {
  const d = FIELDS.find((x) => x.k === k)!;
  const x = Math.max(d.min, Math.min(d.max, v));
  const own = k === 'rough' ? finishOf(ref.finish).roughness : k === 'metal' ? (finishOf(ref.finish).metalness ?? 0) : k === 'scale' || k === 'opacity' ? 1 : 0;
  if (Math.abs(x - own) < 1e-9 && !(k === 'scale' && ref.finish === 'image')) delete ref[k];
  else ref[k] = x;
}

/**
 * Binds the rows drawn by surfaceRows inside `root`: `change` receives a function that edits a copy of
 * the material, and a message for the history.
 */
export function bindSurface(ed: Editor3, root: HTMLElement, change: (fn: (m: MaterialRef) => void, msg: string) => void): void {
  const parse = (s: string) => parseFloat(s.replace(',', '.'));
  root.querySelectorAll<HTMLInputElement>('input[data-sf]').forEach((el) => {
    el.addEventListener('change', () => {
      const v = parse(el.value);
      if (!Number.isFinite(v)) return;
      change((m) => setField(m, el.dataset.sf as (typeof FIELDS)[number]['k'], v), 'Material adjusted.');
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        el.dispatchEvent(new Event('change'));
        e.preventDefault();
        return;
      }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const step = parse(el.dataset.step ?? '0.1') * (e.shiftKey ? 10 : 1);
      el.value = num((parse(el.value) || 0) + (e.key === 'ArrowUp' ? step : -step));
      el.dispatchEvent(new Event('change'));
      e.preventDefault();
    });
  });
  root.querySelector<HTMLSelectElement>('select[data-sf="image"]')?.addEventListener('change', (e) => change((m) => void (m.image = (e.target as HTMLSelectElement).value), 'Picture changed.'));
  root.querySelector<HTMLButtonElement>('[data-sf-reset]')?.addEventListener('click', () =>
    change((m) => {
      for (const d of FIELDS) delete m[d.k];
    }, 'Material back to its finish.'),
  );
  root.querySelector<HTMLButtonElement>('[data-sf-pic]')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.addEventListener('change', async () => {
      const f = inp.files?.[0];
      if (!f) return;
      try {
        const im = await readImageFile(f);
        (ed.store.project.images ??= []).push(im);
        ed.store.commit(null, 'Image added to the project.', false);
        change((m) => {
          m.finish = 'image';
          m.image = im.id;
          m.color = '#ffffff';
          delete m.color2;
          delete m.params;
          // A picture of a surface usually shows about a metre of it.
          m.scale ??= 1;
        }, `${im.name}: picture used as the texture.`);
      } catch (err) {
        ed.toast(`${(err as Error).message}.`);
      }
    });
    inp.click();
  });
}
