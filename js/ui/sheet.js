// Bottom sheets. Each open sheet adds a history entry, so the back gesture, the close
// button, a swipe down and the Escape key all close it the same way.
import { html, setHTML, nextFrame, afterTransition, uniqueId } from './dom.js';
import { icon } from './icons.js';

const stack = [];
let scrollLock = null;
let pendingCloseAll = null;

function lockScroll() {
  if (scrollLock) return;
  const y = window.scrollY;
  scrollLock = { y };
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${y}px`;
  b.left = '0';
  b.right = '0';
  document.getElementById('app')?.setAttribute('inert', '');
}

function unlockScroll() {
  if (!scrollLock) return;
  const { y } = scrollLock;
  scrollLock = null;
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  document.getElementById('app')?.removeAttribute('inert');
  window.scrollTo(0, y);
}

export const openSheetCount = () => stack.length;

/**
 * Open a sheet.
 * opts: { title, hideTitle, className, header(sheet), render(sheet), mount(sheet), actions, inputs, onClose, initialFocus }
 * Returns { el, body, close(), refresh() }.
 */
export function openSheet(opts) {
  const id = uniqueId('sheet');
  const layer = document.createElement('div');
  layer.className = `sheet-layer ${opts.className ?? ''}`;
  setHTML(layer, html`
    <div class="sheet-scrim" data-sheet-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="${id}-title" tabindex="-1">
      <header class="sheet-head">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <div class="sheet-titlebar">
          <h2 class="sheet-title ${opts.hideTitle ? 'sr-only' : ''}" id="${id}-title">${opts.title ?? ''}</h2>
          <div class="sheet-header-extra"></div>
          <button type="button" class="icon-btn sm sheet-close" data-sheet-close aria-label="Close">${icon('close')}</button>
        </div>
      </header>
      <div class="sheet-body"></div>
    </section>`);
  document.getElementById('sheets').append(layer);

  const sheet = {
    id,
    el: layer,
    panel: layer.querySelector('.sheet'),
    body: layer.querySelector('.sheet-body'),
    headerExtra: layer.querySelector('.sheet-header-extra'),
    opts,
    returnFocus: document.activeElement,
    closed: false,
    close: () => requestClose(sheet),
    refresh: () => renderSheet(sheet),
    setTitle: (text) => {
      layer.querySelector('.sheet-title').textContent = text;
    },
  };

  renderSheet(sheet);
  wireSheet(sheet);
  stack.push(sheet);
  lockScroll();
  history.pushState({ ...(history.state ?? {}), sheetDepth: stack.length }, '', window.location.href);

  nextFrame().then(() => {
    layer.classList.add('open');
    const target = opts.initialFocus ? sheet.panel.querySelector(opts.initialFocus) : null;
    (target ?? sheet.panel).focus({ preventScroll: true });
  });
  return sheet;
}

function renderSheet(sheet) {
  const { opts } = sheet;
  if (opts.header) setHTML(sheet.headerExtra, opts.header(sheet));
  setHTML(sheet.body, opts.render(sheet));
  opts.mount?.(sheet);
}

function wireSheet(sheet) {
  const { el, opts } = sheet;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) {
      e.preventDefault();
      sheet.close();
      return;
    }
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const fn = opts.actions?.[target.dataset.action];
    if (fn) {
      e.stopPropagation();
      fn(target, e, sheet);
    }
  });
  const onInput = (e) => {
    const target = e.target.closest('[data-input]');
    const fn = target && opts.inputs?.[target.dataset.input];
    if (fn) fn(target, e, sheet);
  };
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      sheet.close();
    } else if (e.key === 'Tab') {
      trapFocus(sheet.panel, e);
    }
  });

  // Swipe down on the header to dismiss.
  const head = el.querySelector('.sheet-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, textarea, a, label')) return;
    drag = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0 };
    head.setPointerCapture(e.pointerId);
    sheet.panel.style.transition = 'none';
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheet.panel.style.transform = `translateY(${drag.dy}px)`;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const speed = drag.dy / Math.max(1, performance.now() - drag.t);
    const dy = drag.dy;
    drag = null;
    sheet.panel.style.transition = '';
    if (dy > 110 || (dy > 30 && speed > 0.6)) sheet.close();
    else sheet.panel.style.transform = '';
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);
}

function trapFocus(panel, e) {
  const items = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// Closing goes through history so the back gesture and the close button behave the same.
// Closes asked for in the same moment (say, a picker and the sheet under it) are combined
// into one history step, so the app never steps back further than the sheets it closes.
let closeTarget = null; // lowest stack index asked to close in this tick
let closeScheduled = false;
let pendingDepth = null; // sheet depth history is heading to after a step we already started

function requestClose(sheet) {
  const index = stack.indexOf(sheet);
  if (sheet.closed || index === -1) return;
  const depth = history.state?.sheetDepth ?? 0;
  if (pendingDepth === null && depth !== stack.length) {
    // History is out of step with the sheets (rare): close them directly.
    for (const s of stack.slice(index).reverse()) removeSheet(s);
    return;
  }
  closeTarget = closeTarget === null ? index : Math.min(closeTarget, index);
  if (closeScheduled) return;
  closeScheduled = true;
  queueMicrotask(() => {
    closeScheduled = false;
    const target = closeTarget;
    closeTarget = null;
    const base = pendingDepth ?? (history.state?.sheetDepth ?? 0);
    if (target === null || target >= base) return; // already on its way out
    pendingDepth = target;
    history.go(target - base); // popstate closes this sheet and every sheet above it
  });
}

async function removeSheet(sheet) {
  if (sheet.closed) return;
  sheet.closed = true;
  const i = stack.indexOf(sheet);
  if (i !== -1) stack.splice(i, 1);
  sheet.panel.style.transform = '';
  sheet.el.classList.remove('open');
  if (!stack.length) unlockScroll();
  sheet.opts.onClose?.();
  const focusBack = sheet.returnFocus;
  await afterTransition(sheet.panel, 280);
  sheet.el.remove();
  if (focusBack && document.contains(focusBack)) focusBack.focus({ preventScroll: true });
}

/** Called by the app on every popstate. Closes sheets above the history entry we landed on. */
export function syncSheetsWithHistory(state) {
  const depth = state?.sheetDepth ?? 0;
  while (stack.length > depth) removeSheet(stack[stack.length - 1]);
  if (pendingDepth !== null && depth <= pendingDepth) pendingDepth = null;
  if (pendingCloseAll && !stack.length) {
    pendingCloseAll();
    pendingCloseAll = null;
  }
}

/** Close every sheet (through history), then resolve. Use before navigating from a sheet. */
export function closeAllSheets() {
  if (!stack.length) return Promise.resolve();
  return new Promise((resolve) => {
    pendingCloseAll = resolve;
    const base = pendingDepth ?? (history.state?.sheetDepth ?? 0);
    if (base > 0) {
      pendingDepth = 0;
      history.go(-base);
    }
    setTimeout(() => {
      if (pendingCloseAll === resolve) {
        while (stack.length) removeSheet(stack[stack.length - 1]);
        pendingCloseAll = null;
        pendingDepth = null;
        resolve();
      }
    }, 400);
  });
}
