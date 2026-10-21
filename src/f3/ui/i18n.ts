// Interface language. The interface is written in English in the code; in another language its text is
// swapped where it is shown: a MutationObserver (https://developer.mozilla.org/docs/Web/API/MutationObserver)
// watches the app's DOM and replaces every text node and every title / aria-label / placeholder / alt
// whose English text is in the dictionary. Texts made with values ("Room 3: 12 m².") are matched by
// patterns where the dictionary has {0}, {1}… The swap runs in the observer's microtask, before the
// browser paints, so the English never shows. Typed values (inputs, textareas) and anything under
// [data-i18n-skip] are left alone. The dictionary comes from `i18n/pt-BR.json` (English text → text).
//
// The language is a preference of this browser (localStorage `oriel_lang`): Portuguese (Brazil) by
// default, English as written in the code.
import ptBR from './i18n/pt-BR.json';

export type Lang = 'pt-BR' | 'en';
const KEY = 'oriel_lang';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const;

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' ? 'en' : 'pt-BR';
  } catch {
    return 'pt-BR';
  }
}

export function saveLang(l: Lang): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice lasts for this page */
  }
}

interface Pattern {
  re: RegExp;
  to: string;
}

/** A dictionary ready to use: exact texts and patterns (most specific first). */
export class Dictionary {
  private exact = new Map<string, string>();
  private patterns: Pattern[] = [];
  private cache = new Map<string, string | null>();
  /** Every translated text: never translated again (a text that is already the translation). */
  private outputs = new Set<string>();

  constructor(dict: Record<string, string>) {
    const pats: (Pattern & { fixed: number })[] = [];
    for (const [en, to] of Object.entries(dict)) {
      if (!to || en === to) continue;
      this.outputs.add(to);
      if (!/\{\d+\}/.test(en)) {
        this.exact.set(en, to);
        continue;
      }
      // "{0} copies in a row." → /^(.+?) copies in a row\.$/ ; the groups keep their numbers.
      const order: number[] = [];
      const src = en
        .split(/(\{\d+\})/)
        .map((part) => {
          const m = /^\{(\d+)\}$/.exec(part);
          if (m) {
            order.push(Number(m[1]));
            // A value is a number or a name, never a whole sentence: a short pattern ("Room {0}")
            // must not swallow a long text that merely contains its words.
            return '(.{1,48}?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      const fixed = en.replace(/\{\d+\}/g, '').length;
      if (fixed < 3) continue;
      // The groups are found in the order they appear; the translation names them by their number.
      const to2 = to.replace(/\{(\d+)\}/g, (_, n: string) => `{${order.indexOf(Number(n))}}`);
      pats.push({ re: new RegExp(`^${src}$`, 's'), to: to2, fixed });
    }
    // Longer fixed text first: "Room {0}: {1} m²." before "Room {0}".
    this.patterns = pats.sort((a, b) => b.fixed - a.fixed);
  }

  /** The translation of a whole text, or null when there is none. */
  translate(text: string): string | null {
    const key = text.trim();
    if (!key || this.outputs.has(key)) return null;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit === null ? null : text.replace(key, hit);
    let out: string | null = this.exact.get(key) ?? null;
    if (out === null && /[A-Za-z]/.test(key))
      for (const p of this.patterns) {
        const m = p.re.exec(key);
        if (!m) continue;
        // The values inside are translated too when they are known words ("Building", "Roof").
        out = p.to.replace(/\{(\d+)\}/g, (_, n: string) => {
          const v = m[Number(n) + 1] ?? '';
          return this.exact.get(v) ?? v;
        });
        break;
      }
    if (out === null && ENGLISH.test(key)) missingTranslation?.(key);
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(key, out);
    return out === null ? null : text.replace(key, out);
  }
}

let active: Dictionary | null = null;

/** Words that only an English text has: a shown text with one of them and no translation is a gap. */
const ENGLISH = /(the|to|of|and|click|drag|type|wall|walls|floor|floors|enter|with|for|this|from|here|select|building|buildings|volume|inside|outside|first|then|points?|not|no longer|is|are)/i;

/** Called with each shown text that has no translation (the development sentinel lists them). */
export let missingTranslation: ((text: string) => void) | null = null;
export function onMissingTranslation(fn: (text: string) => void): void {
  missingTranslation = fn;
}

/** The text in the interface language (for text drawn outside the DOM: canvas, document title, files). */
export function tr(text: string): string {
  return active?.translate(text) ?? text;
}

function skip(el: Element | null): boolean {
  return !!el?.closest('input,textarea,[contenteditable="true"],[data-i18n-skip],script,style');
}

function translateNode(d: Dictionary, n: Node): void {
  if (n.nodeType === Node.TEXT_NODE) {
    const t = n as Text;
    if (skip(t.parentElement)) return;
    const out = d.translate(t.data);
    if (out !== null && out !== t.data) t.data = out;
    return;
  }
  if (n.nodeType !== Node.ELEMENT_NODE) return;
  const el = n as Element;
  if (el.closest('[data-i18n-skip],script,style')) return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const out = d.translate(v);
    if (out !== null && out !== v) el.setAttribute(a, out);
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let c = walker.nextNode();
  while (c) {
    if (c.nodeType === Node.TEXT_NODE) {
      const t = c as Text;
      if (!skip(t.parentElement)) {
        const out = d.translate(t.data);
        if (out !== null && out !== t.data) t.data = out;
      }
    } else {
      const e = c as Element;
      for (const a of ATTRS) {
        const v = e.getAttribute(a);
        if (!v) continue;
        const out = d.translate(v);
        if (out !== null && out !== v) e.setAttribute(a, out);
      }
    }
    c = walker.nextNode();
  }
}

/** Starts the interface language on the whole page (once, before the app draws its panels). */
export function startI18n(lang = loadLang()): void {
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  const d = new Dictionary(ptBR as Record<string, string>);
  active = d;
  translateNode(d, document.body);
  document.title = tr(document.title);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateNode(d, r.target);
      else if (r.type === 'attributes') {
        const el = r.target as Element;
        const v = r.attributeName && el.getAttribute(r.attributeName);
        if (!v || skip(el.parentElement) || el.closest('[data-i18n-skip]')) continue;
        const out = d.translate(v);
        if (out !== null && out !== v) el.setAttribute(r.attributeName!, out);
      }
      else r.addedNodes.forEach((n) => translateNode(d, n));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
}
