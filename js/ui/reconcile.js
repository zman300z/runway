// Reconcile: type what your bank app says, see the difference, confirm.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { lengthClass } from './format.js';
import { keypadPress, entryToCents, formatEntry, formatMoney } from '../money.js';
import { reconcile } from '../actions.js';
import { balanceOn } from '../budget.js';

export function openReconcile(ctx) {
  const current = balanceOn(ctx.data, ctx.today);
  const st = { entry: '', negative: false };
  let unbind = null;

  const actual = () => (st.negative ? -1 : 1) * entryToCents(st.entry);
  const typed = () => st.entry !== '';

  function compare() {
    if (current === null) return html`<p class="muted">This becomes your starting balance for today.</p>`;
    if (!typed()) return html`<p class="muted">Runway says <strong>${formatMoney(current)}</strong>.</p>`;
    const diff = actual() - current;
    return html`<dl class="recon-rows">
      <div><dt>Runway says</dt><dd>${formatMoney(current)}</dd></div>
      <div><dt>Your bank says</dt><dd>${formatMoney(actual())}</dd></div>
      <div class="is-total"><dt>${diff === 0 ? 'Difference' : 'Adjustment to add'}</dt>
        <dd class="${diff > 0 ? 'tone-good' : ''}">${diff === 0 ? 'Already matches' : formatMoney(diff, { sign: true })}</dd></div>
    </dl>`;
  }

  function buttonLabel() {
    if (current === null) return 'Save balance';
    if (!typed()) return 'Type your bank balance';
    return actual() === current ? 'Done' : 'Add adjustment';
  }

  function refresh() {
    const out = sheet.body.querySelector('.qa-value');
    out.textContent = `${st.negative ? '−' : ''}${formatEntry(st.entry)}`;
    out.className = `qa-value ${lengthClass(actual())}`;
    sheet.body.querySelector('.recon-compare').innerHTML = String(compare());
    const btn = sheet.body.querySelector('.recon-save');
    btn.textContent = buttonLabel();
    btn.disabled = !typed();
  }

  function confirm() {
    if (!typed()) return;
    const value = actual();
    let diff = null;
    try {
      ctx.update((d) => {
        const r = reconcile(d, value, ctx.today);
        diff = r.diff;
        return r.data;
      });
    } catch (err) {
      ctx.toast(err.message, { tone: 'bad' });
      return;
    }
    sheet.close();
    if (diff === null) ctx.toast(`Balance set to ${formatMoney(value)}`);
    else if (diff === 0) ctx.toast('Your balance already matches');
    else ctx.toast(`Balance matched. Added a ${formatMoney(diff, { sign: true })} adjustment.`);
  }

  const sheet = openSheet({
    title: current === null ? 'Add your balance' : 'Reconcile',
    className: 'reconcile',
    render: () => html`
      <p class="sheet-lead">${current === null
        ? 'What does your bank app say your debit card balance is right now?'
        : 'Type what your bank app says. Runway adds an adjustment for the difference, so your balance matches reality.'}</p>
      <div class="qa-amount">
        <output class="qa-value len-xl" aria-live="polite">${formatEntry('')}</output>
        <button type="button" class="chip sign-chip" data-action="toggle-sign" aria-pressed="false">Balance is below zero</button>
      </div>
      <div class="recon-compare" aria-live="polite">${compare()}</div>
      ${keypadHTML()}
      <button type="button" class="btn btn-primary btn-block recon-save" data-action="confirm" disabled>${buttonLabel()}</button>
      <p class="sheet-foot">${icon('info')} Adjustments change your balance only, never your spending.</p>`,
    mount(sh) {
      if (!unbind) unbind = bindKeypad(sh.body, (key) => {
        const next = keypadPress(st.entry, key);
        if (next === st.entry) return;
        st.entry = next;
        refresh();
      }, { onEnter: confirm });
    },
    onClose: () => unbind?.(),
    actions: {
      'toggle-sign'(el) {
        st.negative = !st.negative;
        el.classList.toggle('on', st.negative);
        el.innerHTML = String(html`${st.negative ? icon('check') : ''}Balance is below zero`);
        el.setAttribute('aria-pressed', String(st.negative));
        refresh();
      },
      confirm,
    },
  });
  return sheet;
}
