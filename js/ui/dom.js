// Tiny DOM helpers. html`` escapes every interpolated value unless it is already markup,
// so text from your data (notes, names, imported backups) can never inject HTML.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class Markup {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

/** Mark a string as trusted markup (only for strings built in code, never user text). */
export const raw = (text) => new Markup(String(text));

function piece(v) {
  if (v instanceof Markup) return v.text;
  if (Array.isArray(v)) return v.map(piece).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += piece(values[i]) + strings[i + 1];
  return new Markup(out);
}

export function setHTML(el, markup) {
  el.innerHTML = String(markup);
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Resolve after two animation frames, so a CSS transition starts from the first state. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** Resolve when a transition ends, or after `ms` as a safety net. */
export function afterTransition(el, ms = 300) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    el.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, reducedMotion() ? 0 : ms);
  });
}

let uid = 0;
export const uniqueId = (prefix = 'u') => `${prefix}-${(uid += 1)}`;
