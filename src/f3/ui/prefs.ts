// Preferences of this browser (never of the project): theme (system, dark, light), graphics quality and the navigation
// preset (FORMA/Revit: middle pans and Shift+middle orbits; SketchUp and Blender: middle orbits and
// Shift+middle pans). A small dialog opened from the top bar gear or Ctrl+K "Preferences".
import type { Editor3 } from '../editor/editor';
import { closeOnOutside } from './kit';
import { loadLang, saveLang } from './i18n';

export type Theme = 'system' | 'dark' | 'light';
export type NavPreset = 'forma' | 'sketchup' | 'blender';
export type Quality = 'light' | 'normal' | 'high';
export interface Prefs {
  theme: Theme;
  nav: NavPreset;
  quality: Quality;
}

const KEY = 'forma3_prefs';

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { theme: raw.theme === 'system' || raw.theme === 'light' ? raw.theme : 'dark', nav: raw.nav === 'sketchup' || raw.nav === 'blender' ? raw.nav : 'forma', quality: raw.quality === 'light' || raw.quality === 'high' ? raw.quality : 'normal' };
  } catch {
    return { theme: 'dark', nav: 'forma', quality: 'normal' };
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private window or storage blocked: the choice lasts for this page.
  }
}

/** Light or dark as shown: "system" follows the operating system (prefers-color-scheme). */
function resolved(t: Theme): 'dark' | 'light' {
  if (t !== 'system') return t;
  try {
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyPrefs(ed: Editor3, p: Prefs): void {
  ed.shell.root.dataset.theme = resolved(p.theme);
  ed.navPreset = p.nav;
  ed.view.setQuality(p.quality);
}

export function mountPrefs(ed: Editor3): void {
  let prefs = loadPrefs();
  applyPrefs(ed, prefs);
  try {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyPrefs(ed, prefs));
  } catch {
    // No media queries: the stored theme stays.
  }
  const gear = document.createElement('button');
  const open = () => {
    document.querySelectorAll('.f3-prefs').forEach((m) => m.remove());
    const m = document.createElement('div');
    m.className = 'f3-cmenu f3-island f3-prefs';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', 'Preferences');
    const seg = (key: keyof Prefs, opts: [string, string, string][]) =>
      `<div class="f3-prefs-seg" role="radiogroup">${opts.map(([v, l, t]) => `<button role="radio" data-k="${key}" data-v="${v}" aria-checked="${prefs[key] === v}" title="${t}">${l}</button>`).join('')}</div>`;
    // "Light" alone is the light of a lamp in the dictionary: the light theme says its own word.
    const lightTheme = loadLang() === 'pt-BR' ? '<span data-i18n-skip>Claro</span>' : 'Light';
    m.innerHTML =
      `<div class="hd">Theme</div>${seg('theme', [['system', 'System', 'Follows the operating system'], ['dark', 'Dark', 'Graphite panels'], ['light', lightTheme, 'Light panels']])}` +
      `<div class="hd">Navigation</div>${seg('nav', [['forma', 'Revit', 'Middle drag pans, Shift+middle orbits (Revit, AutoCAD)'], ['sketchup', 'SketchUp', 'Middle drag orbits, Shift+middle pans'], ['blender', 'Blender', 'Middle drag orbits, Shift+middle pans']])}` +
      `<div class="hd">Graphics</div>${seg('quality', [['light', 'Fast', 'For laptops and integrated graphics: no ambient occlusion, softer shadows, one pixel per screen point'], ['normal', 'Normal', 'Ambient occlusion and sharp shadows'], ['high', 'Maximum', 'As Normal, at the full sharpness of high-density screens']])}` +
      `<div class="hd">Language</div><div class="f3-prefs-seg" role="radiogroup">${[['pt-BR', 'Português', 'Português (Brasil)'], ['en', 'English', 'English']].map(([v, l, t]) => `<button role="radio" data-lang="${v}" aria-checked="${loadLang() === v}" title="${t}" data-i18n-skip>${l}</button>`).join('')}</div>` +
      '';
    ed.shell.root.appendChild(m);
    const r = gear.getBoundingClientRect(),
      rr = ed.shell.root.getBoundingClientRect();
    m.style.top = `${r.bottom - rr.top + 6}px`;
    m.style.left = `${Math.max(8, r.right - rr.left - m.offsetWidth)}px`;
    m.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) =>
      b.addEventListener('click', () => {
        prefs = { ...prefs, [b.dataset.k!]: b.dataset.v } as Prefs;
        savePrefs(prefs);
        applyPrefs(ed, prefs);
        m.querySelectorAll<HTMLButtonElement>(`[data-k="${b.dataset.k}"]`).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      }),
    );
    m.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.lang === loadLang()) return;
        saveLang(b.dataset.lang === 'en' ? 'en' : 'pt-BR');
        // The interface is rebuilt in the other language (the project is saved: nothing is lost).
        location.reload();
      }),
    );
    closeOnOutside(m, () => m.remove(), gear);
  };
  ed.prefsRequested = open;
  gear.className = 'f3-tb';
  gear.dataset.cmd = 'prefs';
  gear.title = 'Preferences: theme, graphics, navigation and language';
  gear.setAttribute('aria-label', 'Preferences');
  gear.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>';
  gear.addEventListener('click', () => {
    if (document.querySelector('.f3-prefs')) document.querySelectorAll('.f3-prefs').forEach((x) => x.remove());
    else open();
  });
  ed.shell.top.querySelector('[data-cmd="help"]')?.before(gear);
}
