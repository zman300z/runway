// Small form building blocks shared by the settings and bill sheets.
import { html } from './dom.js';
import { parseMoney, centsToDecimal } from '../money.js';

/** A big "$ 0.00" field. `name` is the data-input key the sheet listens for. */
export function moneyInput({ name, value = '', label, placeholder = '0.00', id = null }) {
  return html`<label class="money-field"${id ? html` for="${id}"` : ''}>
    <span class="money-prefix" aria-hidden="true">$</span>
    <input ${id ? html`id="${id}"` : ''} type="text" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" value="${value}" data-input="${name}" aria-label="${label}">
  </label>`;
}

/** Text for a money field from cents ("" for none). */
export const moneyText = (cents) => (cents === null || cents === undefined ? '' : centsToDecimal(Math.abs(cents)));

/** Cents from a money field: null when empty, NaN when it doesn't make sense. */
export function readMoney(text) {
  if (!String(text ?? '').trim()) return null;
  const c = parseMoney(text);
  return c === null ? Number.NaN : c;
}

export function field(label, control, hint = '') {
  return html`<div class="form-field">
    <span class="field-label">${label}</span>
    ${control}
    ${hint ? html`<p class="field-hint">${hint}</p>` : ''}
  </div>`;
}

/** Native iOS switch where available (Safari 17.4+), styled checkbox elsewhere. */
export function toggle({ name, checked, label, id = null }) {
  return html`<input type="checkbox" switch class="switch" role="switch" ${id ? html`id="${id}"` : ''} data-input="${name}" ${checked ? 'checked' : ''} aria-label="${label}">`;
}

export function errorLine() {
  return html`<p class="field-error" role="alert"></p>`;
}

export function showFormError(root, message) {
  const el = root.querySelector('.field-error');
  if (el) el.textContent = message ?? '';
}
