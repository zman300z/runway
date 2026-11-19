// Toasts: one short message at a time, with an optional action like Undo.
import { html, setHTML } from './dom.js';

let current = null;
const queue = [];

function dismiss(entry, instant = false) {
  if (!entry || entry.gone) return;
  entry.gone = true;
  clearTimeout(entry.timer);
  if (current === entry) current = null;
  entry.el.classList.remove('show');
  setTimeout(() => entry.el.remove(), instant ? 0 : 260);
  if (!instant && queue.length) {
    const [message, opts] = queue.shift();
    setTimeout(() => toast(message, opts), 300);
  }
}

/**
 * Show a toast. Options: { action: { label, run }, duration (ms, Infinity to stay), tone: "bad" | "good",
 * queue: true to wait until the current toast is gone instead of replacing it }.
 */
export function toast(message, { action = null, duration = 3500, tone = '', queue: wait = false, tapAnywhere = false } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return null;
  if (wait && current) {
    queue.push([message, { action, duration, tone, tapAnywhere }]);
    return null;
  }
  dismiss(current, true);
  const el = document.createElement('div');
  el.className = `toast${tone ? ` toast-${tone}` : ''}`;
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  setHTML(el, html`<span class="toast-text">${message}</span>${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}`);
  region.append(el);
  const entry = { el, timer: null, gone: false };
  if (action) {
    const target = tapAnywhere ? el : el.querySelector('.toast-action');
    if (tapAnywhere) el.classList.add('toast-tappable');
    target.addEventListener('click', () => {
      dismiss(entry);
      action.run();
    });
  }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  if (Number.isFinite(duration)) entry.timer = setTimeout(() => dismiss(entry), duration);
  current = entry;
  return { dismiss: () => dismiss(entry) };
}
