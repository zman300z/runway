// The big custom number pad used by Quick Add and Reconcile.
import { html } from './dom.js';
import { icon } from './icons.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

export function keypadHTML() {
  return html`<div class="keypad" role="group" aria-label="Number pad">${KEYS.map((k) => {
    if (k === 'back') {
      return html`<button type="button" class="key key-back" data-key="back" aria-label="Delete last digit">${icon('backspace')}</button>`;
    }
    return html`<button type="button" class="key" data-key="${k}" aria-label="${k === '.' ? 'Decimal point' : k}">${k}</button>`;
  })}</div>`;
}

/**
 * Wire a keypad inside `root`. onKey gets "0" to "9", ".", "back" or "clear" (long-press delete).
 * Also accepts a hardware keyboard. Returns a cleanup function.
 */
export function bindKeypad(root, onKey, { onEnter } = {}) {
  let hold = null;
  let held = false;
  const click = (e) => {
    const key = e.target.closest('[data-key]');
    if (!key || !root.contains(key)) return;
    if (key.dataset.key === 'back' && held) {
      held = false;
      return;
    }
    onKey(key.dataset.key);
  };
  const down = (e) => {
    if (!e.target.closest('[data-key="back"]')) return;
    held = false;
    hold = setTimeout(() => {
      held = true;
      onKey('clear');
    }, 550);
  };
  const up = () => clearTimeout(hold);
  const keydown = (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (/^[0-9]$/.test(e.key) || e.key === '.') {
      e.preventDefault();
      onKey(e.key);
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      onKey('back');
    } else if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };
  root.addEventListener('click', click);
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('pointerleave', up);
  document.addEventListener('keydown', keydown);
  return () => document.removeEventListener('keydown', keydown);
}
