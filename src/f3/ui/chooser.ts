// A small chooser shown where something just happened (the drop of a building on another, a rectangle
// drawn on a wall): the likely answer is already chosen, Enter takes it, a click takes another, Esc or a
// click elsewhere leaves things as they are. Like the result chooser of a Boolean drop in Estúdio de
// Construção and the "Adjust Last Operation" idea: decide after seeing, not before.
import { closeOnOutside } from './kit';

export interface Choice {
  id: string;
  label: string;
  hint?: string;
}

/** Shows the chooser at client point (x, y) inside `root`; `pick` gets the chosen id, or null when dismissed. */
export function choose(root: HTMLElement, x: number, y: number, title: string, options: Choice[], def: string, pick: (id: string | null) => void): void {
  document.querySelectorAll('.f3-chooser').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'f3-cmenu f3-island f3-chooser';
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', title);
  m.innerHTML = `<div class="hd">${title}</div>` + options.map((o, i) => `<button role="menuitem" data-i="${i}"${o.id === def ? ' aria-pressed="true"' : ''}${o.hint ? ` title="${o.hint}"` : ''}><span>${o.label}</span>${o.hint ? `<small>${o.hint}</small>` : ''}</button>`).join('');
  root.appendChild(m);
  const rr = root.getBoundingClientRect();
  m.style.left = `${Math.max(4, Math.min(x - rr.left + 12, rr.width - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(4, Math.min(y - rr.top + 12, rr.height - m.offsetHeight - 8))}px`;
  let done = false;
  const finish = (id: string | null) => {
    if (done) return;
    done = true;
    m.remove();
    window.removeEventListener('keydown', key, true);
    off();
    pick(id);
  };
  const buttons = [...m.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach((b) => b.addEventListener('click', () => finish(options[Number(b.dataset.i)]!.id)));
  let at = Math.max(0, options.findIndex((o) => o.id === def));
  const focus = () => buttons[at]?.focus();
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') finish(null);
    else if (e.key === 'Enter') finish(options[at]!.id);
    else if (e.key === 'ArrowDown') at = (at + 1) % buttons.length;
    else if (e.key === 'ArrowUp') at = (at - 1 + buttons.length) % buttons.length;
    else return;
    e.preventDefault();
    e.stopPropagation();
    focus();
  };
  window.addEventListener('keydown', key, true);
  const off = closeOnOutside(m, () => finish(null));
  focus();
}
