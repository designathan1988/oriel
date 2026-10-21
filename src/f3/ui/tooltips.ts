// Tool names at a glance: hovering a tool of the bar shows its name, its key and what it does right
// away, next to it (the browser's own tooltip waits about a second and shows one grey line). Applies to
// the tool bar and the View island; the text is the button's own title ("Name: what it does · Key").
import type { Editor3 } from '../editor/editor';

const CSS = `
.f3-ttip{position:fixed;z-index:60;max-width:300px;background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 10px;box-shadow:0 10px 28px #0006;font-size:12px;line-height:1.4;pointer-events:none}
.f3-ttip b{font-weight:600}
.f3-ttip kbd{margin-left:8px;font:600 10.5px/1 ui-monospace,monospace;background:var(--field);border:1px solid var(--line);border-radius:4px;padding:2px 5px;color:var(--muted)}
.f3-ttip p{margin:3px 0 0;color:var(--muted)}
`;

export function mountToolTips(ed: Editor3): void {
  const doc = ed.shell.root.ownerDocument;
  const st = doc.createElement('style');
  st.textContent = CSS;
  doc.head.appendChild(st);
  const tip = doc.createElement('div');
  tip.className = 'f3-ttip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  ed.shell.root.appendChild(tip);
  let on: HTMLElement | null = null;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const hide = () => {
    if (on?.dataset.tip !== undefined) on.title = on.dataset.tip;
    on = null;
    tip.hidden = true;
  };
  ed.shell.root.addEventListener('pointerover', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.f3-tools .f3-tool, .f3-viewbar .f3-tb');
    if (b === on) return;
    hide();
    if (!b) return;
    const text = b.title || b.dataset.tip || '';
    if (!text) return;
    on = b;
    // The browser tooltip would show as well: the title waits in data-tip while the pointer is here.
    b.dataset.tip = text;
    b.removeAttribute('title');
    const cut = text.lastIndexOf(' · ');
    const key = cut > 0 ? text.slice(cut + 3) : '';
    const body = cut > 0 ? text.slice(0, cut) : text;
    const colon = body.indexOf(': ');
    const name = colon > 0 ? body.slice(0, colon) : body;
    const what = colon > 0 ? body.slice(colon + 2) : '';
    tip.innerHTML = `<b>${esc(name)}</b>${key ? `<kbd>${esc(key)}</kbd>` : ''}${what ? `<p>${esc(what[0]!.toUpperCase() + what.slice(1))}</p>` : ''}`;
    tip.hidden = false;
    const r = b.getBoundingClientRect();
    const inBar = !!b.closest('.f3-tools');
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    const x = inBar ? r.right + 8 : r.left - w - 8;
    const y = Math.max(8, Math.min(innerHeight - h - 8, r.top + r.height / 2 - h / 2));
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
  });
  ed.shell.root.addEventListener('pointerleave', hide);
  ed.shell.root.addEventListener('pointerdown', hide);
}
