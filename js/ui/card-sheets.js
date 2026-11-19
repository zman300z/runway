// Credit card sheets: add or edit a card, pay it, check a statement, Card Reconcile, cash back,
// and editing a card payment or cash back credit.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet, closeAllSheets } from './sheet.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { moneyInput, moneyText, readMoney, field, errorLine, showFormError } from './forms.js';
import { lengthClass, safeColor, breakable } from './format.js';
import { openQuickAdd } from './quickadd.js';
import { keypadPress, entryToCents, centsToEntry, formatEntry, formatMoney, formatWholeMoney } from '../money.js';
import { formatDate, relativeDay, addMonths } from '../dates.js';
import { ordinal } from '../pay.js';
import { balanceOn } from '../budget.js';
import {
  findCard, cardSummary, owedOn, pendingPayments, computedStatement, statementAmount, quarterOf, quarterEnd,
  parseRate, rateText,
} from '../cards.js';
import {
  addCard, updateCard, deleteCard, closeCard, reopenCard, cardInUse, payCard, markCardDueHandled, confirmStatement,
  addCashback, cardReconcile, updateTransaction, deleteTransaction, restoreTransaction, dismissQuarterReminder,
} from '../actions.js';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** "$12.00 owed" or "$5.00 credit". */
const owedText = (cents) => (cents < 0 ? `${formatMoney(-cents)} credit` : formatMoney(cents));

function dateChip(ctx, st, { min = null } = {}) {
  return html`<label class="chip date-chip">
    ${icon('calendar')}<span>${relativeDay(st.date, ctx.today)}</span>
    <input type="date" data-input="ks-date" value="${st.date}" max="${ctx.today}"${min ? html` min="${min}"` : ''} aria-label="Date">
  </label>`;
}

/**
 * A sheet with Runway's keypad for one amount.
 * o: { title, lead, start, state, top, middle, bottom, live, button, ready, hideButton, confirm, actions, inputs }
 * Hooks get (st, amount, typed). Action and input hooks get (st, el, helpers).
 */
function keypadSheet(ctx, o) {
  const st = { entry: o.start > 0 ? centsToEntry(o.start) : '', negative: false, date: ctx.today, ...(o.state ?? {}) };
  let unbind = null;
  const amount = () => (st.negative ? -1 : 1) * entryToCents(st.entry);
  const typed = () => st.entry !== '';
  const ready = () => o.ready(st, amount(), typed());
  const hidden = () => Boolean(o.hideButton?.(st, amount(), typed()));

  function refresh() {
    const out = sheet.body.querySelector('.qa-value');
    out.textContent = `${st.negative ? '−' : ''}${formatEntry(st.entry)}`;
    out.className = `qa-value ${lengthClass(amount())}`;
    const live = sheet.body.querySelector('.ks-live');
    if (live) live.innerHTML = String(o.live(st, amount(), typed()));
    const btn = sheet.body.querySelector('.ks-save');
    btn.textContent = o.button(st, amount(), typed());
    btn.disabled = !ready();
    btn.hidden = hidden();
  }

  function confirm() {
    if (!ready()) return;
    try {
      o.confirm(st, amount(), sheet);
    } catch (err) {
      ctx.toast(err.message, { tone: 'bad' });
    }
  }

  const helpers = () => ({ amount: amount(), typed: typed(), refresh, sheet, rerender: () => sheet.refresh() });
  const wrap = (hooks) => Object.fromEntries(Object.entries(hooks ?? {}).map(([name, fn]) => [name, (el, e) => fn(st, el, helpers(), e)]));

  const sheet = openSheet({
    title: o.title,
    className: `reconcile ${o.className ?? ''}`,
    render: () => html`
      ${o.lead ? html`<p class="sheet-lead">${o.lead}</p>` : ''}
      <div class="qa-amount">
        <output class="qa-value ${lengthClass(amount())}" aria-live="polite">${st.negative ? '−' : ''}${formatEntry(st.entry)}</output>
        ${o.top ? o.top(st) : ''}
      </div>
      <div class="ks-live" aria-live="polite">${o.live(st, amount(), typed())}</div>
      ${o.middle ? o.middle(st) : ''}
      ${keypadHTML()}
      <button type="button" class="btn btn-primary btn-block ks-save" data-action="ks-confirm" ${ready() ? '' : 'disabled'} ${hidden() ? 'hidden' : ''}>${o.button(st, amount(), typed())}</button>
      ${o.bottom ? o.bottom(st) : ''}`,
    mount(sh) {
      if (!unbind) {
        unbind = bindKeypad(sh.body, (key) => {
          const next = keypadPress(st.entry, key);
          if (next === st.entry) return;
          st.entry = next;
          refresh();
        }, { onEnter: confirm });
      }
    },
    onClose: () => unbind?.(),
    actions: {
      'ks-confirm': confirm,
      'ks-sign'() {
        st.negative = !st.negative;
        sheet.refresh();
      },
      ...wrap(o.actions),
    },
    inputs: {
      'ks-date'(el, e) {
        if (e.type !== 'change' || !el.value) return;
        st.date = el.value > ctx.today ? ctx.today : el.value;
        sheet.refresh();
      },
      ...wrap(o.inputs),
    },
  });
  return sheet;
}

const noteHTML = (tone, text) => html`<p class="note note-${tone}">${icon(tone === 'warn' ? 'alert' : 'info')}<span>${text}</span></p>`;

// Paying the card

/**
 * Pay the card from the bank, any time. With `due`, it answers the "Card payment due" prompt:
 * pre-filled with what is still due, dated on the due date.
 */
export function openPayCard(ctx, cardId, { due = null } = {}) {
  const card = findCard(ctx.data, cardId);
  if (!card) return null;
  const c = cardSummary(ctx.data, card, ctx.today);
  const prompt = due ? pendingPayments(ctx.data, card, ctx.today).find((p) => p.due === due) ?? null : null;
  const stillDue = prompt ? prompt.amount : c.statementDue;
  const dueDate = prompt ? prompt.due : c.due;
  const owed = c.owed;
  const bank = balanceOn(ctx.data, ctx.today);
  const start = stillDue > 0 ? stillDue : Math.max(0, owed);

  let lead = 'Type how much you paid from your bank. It only moves money from your bank to the card, so it never counts as spending.';
  if (prompt && card.autopay) {
    lead = `Autopay should have paid ${formatMoney(prompt.amount)} on ${formatDate(prompt.due, 'medium')}. Type what actually left your bank.`;
  } else if (prompt) {
    lead = `Your ${card.name} payment was due ${formatDate(prompt.due, 'medium')}. How much left your bank?`;
  }

  const quick = [];
  if (stillDue > 0) quick.push(['Statement', stillDue]);
  if (owed > 0 && owed !== stillDue) quick.push(['Full balance', owed]);

  return keypadSheet(ctx, {
    title: prompt ? 'Card payment due' : `Pay ${card.name}`,
    lead,
    start,
    state: { date: prompt ? prompt.due : ctx.today },
    top: () => (quick.length > 1
      ? html`<div class="quick-amounts">${quick.map(([label, cents]) => html`<button type="button" class="chip" data-action="quick" data-cents="${cents}">${label} ${formatMoney(cents)}</button>`)}</div>`
      : ''),
    live(st, amount) {
      const rows = [];
      if (stillDue > 0) rows.push(html`<div><dt>Statement balance, due ${formatDate(dueDate, 'short')}</dt><dd>${formatMoney(stillDue)}</dd></div>`);
      rows.push(html`<div><dt>Owed on the card now</dt><dd>${owedText(owed)}</dd></div>`);
      if (bank !== null && amount > 0) rows.push(html`<div class="is-total"><dt>Bank balance after</dt><dd>${formatMoney(bank - amount)}</dd></div>`);
      let note = '';
      if (amount > 0 && stillDue > 0 && amount < stillDue) {
        note = noteHTML('warn', `That is ${formatMoney(stillDue - amount)} less than your statement balance. The rest will be charged interest.`);
      } else if (amount > 0 && amount > owed) {
        note = noteHTML('info', `That is ${formatMoney(amount - Math.max(0, owed))} more than you owe. The extra becomes a credit on the card.`);
      }
      return html`<dl class="recon-rows">${rows}</dl>${note}`;
    },
    middle: (st) => html`<div class="qa-row ks-row">${dateChip(ctx, st, { min: card.openDate })}</div>`,
    button: (st, amount) => (amount > 0 ? `Paid ${formatMoney(amount)}` : 'Type the amount'),
    ready: (st, amount) => amount > 0,
    bottom: () => (prompt
      ? html`<button type="button" class="btn btn-plain btn-block" data-action="not-paid">It wasn't paid</button>`
      : html`<p class="sheet-foot">${icon('info')}Paying the statement balance in full by the due date means no interest.</p>`),
    confirm(st, amount, sheet) {
      const handledBefore = card.handledDue;
      let tx = null;
      ctx.update((d) => {
        const r = payCard(d, card.id, amount, st.date);
        tx = r.tx;
        // Paying on or after a due date answers its prompt.
        let next = r.data;
        for (const p of pendingPayments(d, card, ctx.today)) if (p.due <= st.date || prompt) next = markCardDueHandled(next, card.id, p.due);
        return next;
      });
      sheet.close();
      const short = stillDue > 0 && amount < stillDue;
      ctx.toast(short ? `Paid ${formatMoney(amount)}. ${formatMoney(stillDue - amount)} of the statement is left, and it will be charged interest.` : `Paid ${formatMoney(amount)} to ${card.name}`, {
        tone: short ? 'bad' : '',
        duration: short ? 7000 : 5000,
        action: {
          label: 'Undo',
          run: () => ctx.update((d) => ({
            ...deleteTransaction(d, tx.id).data,
            cards: d.cards.map((x) => (x.id === card.id ? { ...x, handledDue: handledBefore } : x)),
          })),
        },
      });
    },
    actions: {
      quick(st, el, h) {
        st.entry = centsToEntry(Number(el.dataset.cents));
        h.refresh();
      },
      'not-paid'(st, el, h) {
        ctx.update((d) => markCardDueHandled(d, card.id, prompt.due));
        h.sheet.close();
        ctx.toast('Okay. Pay it soon to avoid a late fee and interest. It still shows in what you owe.', { duration: 6000 });
      },
    },
  });
}

/** One tap from the Home banner: the usual amount left the bank on the due date. */
export function confirmCardDue(ctx, cardId, due) {
  const card = findCard(ctx.data, cardId);
  const prompt = card ? pendingPayments(ctx.data, card, ctx.today).find((p) => p.due === due) : null;
  if (!prompt) return;
  let tx = null;
  ctx.update((d) => {
    const r = payCard(d, cardId, prompt.amount, due);
    tx = r.tx;
    return markCardDueHandled(r.data, cardId, due);
  });
  ctx.toast(`Paid ${formatMoney(prompt.amount)} to ${card.name}`, {
    duration: 5000,
    action: {
      label: 'Undo',
      run: () => ctx.update((d) => ({
        ...deleteTransaction(d, tx.id).data,
        cards: d.cards.map((x) => (x.id === cardId ? { ...x, handledDue: card.handledDue } : x)),
      })),
    },
  });
}

// Statement

/** Check the statement balance against your card app. Pre-filled with Runway's own figure. */
export function openStatement(ctx, cardId, closing) {
  const card = findCard(ctx.data, cardId);
  if (!card || !closing) return null;
  const computed = computedStatement(ctx.data, card, closing);
  const current = statementAmount(ctx.data, card, closing);
  return keypadSheet(ctx, {
    title: 'Statement balance',
    lead: `Check your card app. What is the statement balance for the statement that closed ${formatDate(closing, 'medium')}?`,
    start: current,
    state: { entry: current > 0 ? centsToEntry(current) : '0' },
    live(st, amount, typed) {
      const diff = amount - computed;
      const rows = html`<dl class="recon-rows">
        <div><dt>Runway counted</dt><dd>${formatMoney(computed)}</dd></div>
        ${typed ? html`<div class="is-total"><dt>Your card app says</dt><dd>${formatMoney(amount)}</dd></div>` : ''}
      </dl>`;
      if (!typed || diff === 0) return rows;
      return html`${rows}${diff > 0
        ? noteHTML('info', `That is ${formatMoney(diff)} more than Runway counted. Saving changes how much is due now, not what you owe in total. If interest, fees or a purchase you forgot is missing, do a Card Reconcile too.`)
        : noteHTML('info', `That is ${formatMoney(-diff)} less than Runway counted, so some charges will be on your next statement instead. What you owe in total doesn't change.`)}`;
    },
    button: (st, amount, typed) => (typed ? `Confirm ${formatMoney(amount)}` : 'Type the statement balance'),
    ready: (st, amount, typed) => typed && amount >= 0,
    confirm(st, amount, sheet) {
      ctx.update((d) => confirmStatement(d, card.id, closing, amount));
      sheet.close();
      ctx.toast(`Statement balance confirmed: ${formatMoney(amount)}`);
    },
  });
}

// Card Reconcile

export function openCardReconcile(ctx, cardId) {
  const card = findCard(ctx.data, cardId);
  if (!card) return null;
  const current = owedOn(ctx.data, card, ctx.today);
  const reason = (id, title, text) => html`<button type="button" class="reason" data-action="reason" data-reason="${id}">
    <span class="reason-title">${title}</span><span class="reason-text">${text}</span>${icon('chevronRight')}
  </button>`;
  return keypadSheet(ctx, {
    title: 'Card Reconcile',
    lead: 'Type the current balance your card app shows. Runway matches what you owe to it.',
    top: (st) => html`<button type="button" class="chip sign-chip${st.negative ? ' on' : ''}" data-action="ks-sign" aria-pressed="${st.negative}">${st.negative ? icon('check') : ''}It shows a credit</button>`,
    live(st, amount, typed) {
      if (!typed) return html`<p class="muted">Runway says ${current < 0 ? html`you have a <strong>${formatMoney(-current)}</strong> credit` : html`you owe <strong>${formatMoney(current)}</strong>`}.</p>`;
      const diff = amount - current;
      const rows = html`<dl class="recon-rows">
        <div><dt>Runway says</dt><dd>${owedText(current)}</dd></div>
        <div><dt>Your card app says</dt><dd>${owedText(amount)}</dd></div>
        <div class="is-total"><dt>Difference</dt><dd>${diff === 0 ? 'Already matches' : formatMoney(diff, { sign: true })}</dd></div>
      </dl>`;
      if (diff === 0) return rows;
      if (diff > 0) {
        return html`${rows}<p class="recon-ask">What is the extra ${formatMoney(diff)} from?</p>
          <div class="reason-list">
            ${reason('fees', 'Interest or fees', 'Logged as spending in Fees & interest, so it counts against your monthly limit.')}
            ${reason('forgot', 'Purchases I forgot to log', 'Opens Quick Add with your card selected.')}
            ${reason('unsure', 'Not sure', 'A plain adjustment. It changes what you owe, never your spending.')}
          </div>`;
      }
      return html`${rows}<p class="recon-ask">What is the ${formatMoney(-diff)} from?</p>
        <div class="reason-list">
          ${reason('refund', 'A refund or credit I forgot to log', 'Opens Quick Add as a refund on your card.')}
          ${reason('unsure', 'Not sure', 'A plain adjustment. It changes what you owe, never your spending.')}
        </div>`;
    },
    button: (st, amount, typed) => (typed ? 'Done' : 'Type your card balance'),
    ready: (st, amount, typed) => typed && amount === current,
    hideButton: (st, amount, typed) => typed && amount !== current,
    confirm(st, amount, sheet) {
      sheet.close();
      ctx.toast('Your card already matches');
    },
    actions: {
      async reason(st, el, h) {
        const why = el.dataset.reason;
        const diff = h.amount - current;
        if (why === 'forgot' || why === 'refund') {
          await closeAllSheets();
          openQuickAdd(ctx, {
            preset: { type: why === 'refund' ? 'refund' : 'expense', account: card.id },
            hint: why === 'refund'
              ? `Your card app shows ${formatMoney(-diff)} less than Runway. Log the refund here.`
              : `Your card app shows ${formatMoney(diff)} more than Runway. Log each purchase here.`,
          });
          return;
        }
        const before = ctx.summary;
        let result = null;
        try {
          ctx.update((d) => {
            result = cardReconcile(d, card.id, h.amount, ctx.today, why);
            return result.data;
          });
        } catch (err) {
          ctx.toast(err.message, { tone: 'bad' });
          return;
        }
        h.sheet.close();
        const undo = { label: 'Undo', run: () => ctx.update((d) => deleteTransaction(d, result.tx.id).data) };
        if (why === 'fees') ctx.toast(`Added ${formatMoney(diff)} in Fees & interest. It counts as spending.`, { action: undo, duration: 6000 });
        else ctx.toast(`Matched. Runway now says you owe ${formatMoney(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}.`, { action: undo, duration: 5000 });
        ctx.afterChange?.(before);
      },
    },
  });
}

// Cash back

export function openCashback(ctx, cardId) {
  const card = findCard(ctx.data, cardId);
  if (!card) return null;
  return keypadSheet(ctx, {
    title: 'Log cash back',
    lead: 'How much cash back did you redeem?',
    state: { mode: 'credit' },
    live: () => '',
    middle: (st) => html`
      <div class="segmented" role="group" aria-label="Redeemed as">
        ${[['credit', 'Statement credit'], ['bank', 'To my bank']].map(([id, label]) => html`<button type="button" class="seg${st.mode === id ? ' on' : ''}" data-action="mode" data-mode="${id}" aria-pressed="${st.mode === id}">${label}</button>`)}
      </div>
      <p class="field-hint ks-hint">${st.mode === 'credit'
        ? 'Lowers what you owe on the card. Not income, not spending.'
        : 'Counts as income in Rewards and raises your bank balance.'}</p>
      <div class="qa-row ks-row">${dateChip(ctx, st)}</div>`,
    button: (st, amount) => (amount > 0 ? `Add ${formatMoney(amount)}` : 'Type the amount'),
    ready: (st, amount) => amount > 0,
    confirm(st, amount, sheet) {
      let tx = null;
      ctx.update((d) => {
        const r = addCashback(d, card.id, amount, st.date, st.mode);
        tx = r.tx;
        return r.data;
      });
      sheet.close();
      ctx.toast(st.mode === 'credit' ? `Added a ${formatMoney(amount)} statement credit` : `Added ${formatMoney(amount)} cash back to Rewards`, {
        duration: 5000,
        action: { label: 'Undo', run: () => ctx.update((d) => deleteTransaction(d, tx.id).data) },
      });
    },
    actions: {
      mode(st, el, h) {
        st.mode = el.dataset.mode;
        h.rerender();
      },
    },
  });
}

/** Edit a card payment or a cash back credit: amount and date, or delete it. */
export function editCardTransaction(ctx, tx) {
  const pay = tx.type === 'cardPayment';
  const card = findCard(ctx.data, pay ? tx.cardId : tx.account);
  const name = card?.name ?? 'your card';
  return keypadSheet(ctx, {
    title: pay ? 'Card payment' : 'Cash back credit',
    lead: pay
      ? `Money from your bank to ${name}. It never counts as spending.`
      : `A statement credit on ${name}. It lowers what you owe and is not income or spending.`,
    start: tx.amount,
    state: { date: tx.date },
    live: () => '',
    middle: (st) => html`<div class="qa-row ks-row">${dateChip(ctx, st)}</div>`,
    button: () => 'Save changes',
    ready: (st, amount) => amount > 0,
    bottom: () => html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="delete-card-tx">${icon('trash')}Delete</button>`,
    confirm(st, amount, sheet) {
      ctx.update((d) => updateTransaction(d, tx.id, { amount, date: st.date }).data);
      sheet.close();
      ctx.toast('Saved');
    },
    actions: {
      'delete-card-tx'(st, el, h) {
        let removed = null;
        ctx.update((d) => {
          const r = deleteTransaction(d, tx.id);
          removed = r.removed;
          return r.data;
        });
        h.sheet.close();
        ctx.toast('Deleted', { duration: 5000, action: { label: 'Undo', run: () => ctx.update((d) => restoreTransaction(d, removed)) } });
      },
    },
  });
}

// Adding and editing cards

function dayOptions(selected) {
  return html`<option value="" ${selected ? '' : 'selected'} disabled>Pick a day</option>${DAYS.map((n) => html`<option value="${n}" ${Number(selected) === n ? 'selected' : ''}>The ${ordinal(n)}${n >= 29 ? ' (or the last day)' : ''}</option>`)}`;
}

function bonusText(b, cats) {
  const names = b.categoryIds.map((id) => cats.find((c) => c.id === id)?.name).filter(Boolean);
  return {
    title: `${rateText(b.rateBp)}% on up to ${formatWholeMoney(b.cap)}`,
    sub: `${formatDate(b.start, 'short')} to ${formatDate(b.end, 'short')}${names.length ? ` · ${names.join(', ')}` : ''}`,
  };
}

/** Add or edit one bonus window. onSave gets the bonus; onDelete removes it. */
export function openBonusSheet(ctx, { bonus = null, onSave, onDelete = null, title = null }) {
  const q = quarterOf(ctx.today);
  const st = {
    rate: bonus ? rateText(bonus.rateBp) : '',
    cap: moneyText(bonus?.cap ?? null),
    start: bonus?.start ?? q.start,
    end: bonus?.end ?? quarterEnd(ctx.today),
    categoryIds: new Set(bonus?.categoryIds ?? []),
  };
  const choices = ctx.data.categories.filter((c) => c.bucket !== 'savings' && c.id !== 'fees');
  const sheet = openSheet({
    title: title ?? (bonus ? 'Bonus categories' : 'Add bonus categories'),
    render: () => html`
      <p class="sheet-lead">Type in this quarter's bonus from your card app, then pick which of your categories count.</p>
      ${field('Bonus cash back', html`<label class="money-field"><input type="text" inputmode="decimal" autocomplete="off" placeholder="5" value="${st.rate}" data-input="rate" aria-label="Bonus cash back percent"><span class="money-suffix" aria-hidden="true">%</span></label>`)}
      ${field('On spending up to', moneyInput({ name: 'cap', value: st.cap, label: 'Bonus spending cap', placeholder: '1,500.00' }))}
      <div class="form-pair">
        ${field('Starts', html`<input type="date" class="field-input" data-input="start" value="${st.start}" aria-label="Bonus start date">`)}
        ${field('Ends', html`<input type="date" class="field-input" data-input="end" value="${st.end}" aria-label="Bonus end date">`)}
      </div>
      ${field('Categories that count', html`<div class="cat-grid">${choices.map((c) => html`
        <button type="button" class="cat-tile${st.categoryIds.has(c.id) ? ' on' : ''}" data-action="toggle-cat" data-id="${c.id}" aria-pressed="${st.categoryIds.has(c.id)}" style="--cat:${safeColor(c.color)}">
          <span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${breakable(c.name)}</span>
        </button>`)}</div>`, "Your categories won't match the card company's exactly, so the cash back total is an estimate.")}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save bonus</button>
      ${onDelete ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="delete">${icon('trash')}Remove this bonus</button>` : ''}`,
    inputs: {
      rate: (el) => { st.rate = el.value; },
      cap: (el) => { st.cap = el.value; },
      start: (el) => { st.start = el.value; },
      end: (el) => { st.end = el.value; },
    },
    actions: {
      'toggle-cat'(el) {
        const id = el.dataset.id;
        if (st.categoryIds.has(id)) st.categoryIds.delete(id);
        else st.categoryIds.add(id);
        const on = st.categoryIds.has(id);
        el.classList.toggle('on', on);
        el.setAttribute('aria-pressed', String(on));
      },
      save() {
        const rateBp = parseRate(st.rate);
        if (rateBp === null || Number.isNaN(rateBp)) return showFormError(sheet.body, 'Enter the bonus percent, like 5.');
        const cap = readMoney(st.cap);
        if (!cap || Number.isNaN(cap) || cap <= 0) return showFormError(sheet.body, 'Enter the spending cap for the bonus.');
        if (!st.start || !st.end) return showFormError(sheet.body, 'Pick the start and end dates.');
        if (st.end < st.start) return showFormError(sheet.body, 'The end date must be after the start date.');
        if (!st.categoryIds.size) return showFormError(sheet.body, 'Pick at least one category.');
        try {
          onSave({ id: bonus?.id ?? null, rateBp, cap, start: st.start, end: st.end, categoryIds: [...st.categoryIds] });
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        return sheet.close();
      },
      delete() {
        onDelete();
        sheet.close();
      },
    },
  });
  return sheet;
}

/** Add a credit card, or edit one. */
export function openCardForm(ctx, cardId = null) {
  const card = cardId ? findCard(ctx.data, cardId) : null;
  const r = card?.rewards ?? null;
  const st = {
    name: card?.name ?? '',
    closingDay: card?.closingDay ?? '',
    dueDay: card?.dueDay ?? '',
    limit: moneyText(card?.limit ?? null),
    cap: moneyText(card?.cap ?? null),
    openDate: card?.openDate ?? ctx.today,
    autopay: card?.autopay ?? false,
    owed: '',
    rewardsOn: Boolean(r),
    base: r ? rateText(r.baseBp) : '',
    match: r?.firstYearMatch ?? false,
    bonuses: (r?.bonuses ?? []).map((b) => ({ ...b })),
  };
  const used = card ? cardInUse(ctx.data, card.id) : false;

  function rewardsPart() {
    if (!st.rewardsOn) return '';
    const anniversary = st.openDate ? addMonths(st.openDate, 12) : null;
    const cats = ctx.data.categories;
    return html`
      ${field('Base cash back', html`<label class="money-field"><input type="text" inputmode="decimal" autocomplete="off" placeholder="1" value="${st.base}" data-input="base" aria-label="Base cash back percent"><span class="money-suffix" aria-hidden="true">%</span></label>`, 'What you earn on everything outside the bonus categories.')}
      <div class="form-field">
        <span class="field-label">Quarterly bonus categories</span>
        ${st.bonuses.length ? html`<ul class="card list-card bonus-list">${st.bonuses.map((b, i) => {
          const t = bonusText(b, cats);
          return html`<li><button type="button" class="row" data-action="edit-bonus" data-index="${i}">
            <span class="row-label">${t.title}<span class="row-sub">${t.sub}</span></span>${icon('chevronRight', { cls: 'row-chevron' })}
          </button></li>`;
        })}</ul>` : ''}
        <button type="button" class="btn btn-quiet btn-block" data-action="add-bonus">${icon('plus')}Add bonus categories</button>
      </div>
      <div class="toggle-line">
        <label for="match-toggle"><span class="toggle-title">First-year cash back match</span>
          <span class="field-hint">Doubles the estimate for purchases in your first 12 months${anniversary ? `, until ${formatDate(anniversary, 'full')}` : ''}. It turns off by itself.</span></label>
        <label class="bill-switch"><input type="checkbox" switch class="switch" id="match-toggle" data-input="match" ${st.match ? 'checked' : ''}></label>
      </div>`;
  }

  const sheet = openSheet({
    title: card ? 'Edit card' : 'Add a credit card',
    render: () => html`
      ${card ? '' : html`<p class="sheet-lead">Card purchases count as spending the day you make them. Your bank only feels them when you pay the card.</p>`}
      ${field('Card name', html`<input type="text" class="field-input" maxlength="40" value="${st.name}" placeholder="Student card" data-input="name" autocomplete="off" aria-label="Card name">`)}
      <div class="form-pair">
        ${field('Statement closes on', html`<label class="select-field"><select data-input="closingDay" aria-label="Statement closing day">${dayOptions(st.closingDay)}</select></label>`)}
        ${field('Payment due on', html`<label class="select-field"><select data-input="dueDay" aria-label="Payment due day">${dayOptions(st.dueDay)}</select></label>`)}
      </div>
      <p class="field-hint form-hint">Both are in your card app. In shorter months, the 29th to 31st fall on the last day.</p>
      ${field('Credit limit', moneyInput({ name: 'limit', value: st.limit, label: 'Credit limit' }))}
      ${field('Your monthly cap (optional)', moneyInput({ name: 'cap', value: st.cap, label: 'Your monthly cap' }),
        'Your own limit for each statement cycle, separate from the credit limit. Runway nudges you at 80% and 100%.')}
      ${field('Account opened', html`<input type="date" class="field-input" data-input="openDate" value="${st.openDate}" max="${ctx.today}" aria-label="Account open date">`)}
      ${card ? '' : field('What you owe on it now (optional)', moneyInput({ name: 'owed', value: st.owed, label: 'What you owe on it now' }), 'Leave empty for a new card.')}
      <div class="toggle-line">
        <label for="autopay-toggle"><span class="toggle-title">Autopay</span>
          <span class="field-hint">Pays the full statement balance from your bank on the due date.</span></label>
        <label class="bill-switch"><input type="checkbox" switch class="switch" id="autopay-toggle" data-input="autopay" ${st.autopay ? 'checked' : ''}></label>
      </div>
      <div class="toggle-line">
        <label for="rewards-toggle"><span class="toggle-title">Estimate my cash back</span>
          <span class="field-hint">Optional. Always an estimate.</span></label>
        <label class="bill-switch"><input type="checkbox" switch class="switch" id="rewards-toggle" data-input="rewardsOn" ${st.rewardsOn ? 'checked' : ''}></label>
      </div>
      <div class="rewards-part">${rewardsPart()}</div>
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">${card ? 'Save' : 'Add card'}</button>
      ${card && card.closed ? html`<button type="button" class="btn btn-quiet btn-block" data-action="reopen">Reopen card</button>` : ''}
      ${card && !card.closed ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="remove">${icon('trash')}${used ? 'Close card' : 'Delete card'}</button>` : ''}
      ${card && !card.closed && used ? html`<p class="sheet-foot">${icon('info')}A card with history is closed, not deleted, so your past spending stays right.</p>` : ''}`,
    inputs: {
      name: (el) => { st.name = el.value; },
      closingDay: (el) => { st.closingDay = el.value; },
      dueDay: (el) => { st.dueDay = el.value; },
      limit: (el) => { st.limit = el.value; },
      cap: (el) => { st.cap = el.value; },
      owed: (el) => { st.owed = el.value; },
      openDate: (el) => { st.openDate = el.value; },
      autopay: (el) => { st.autopay = el.checked; },
      base: (el) => { st.base = el.value; },
      match: (el) => { st.match = el.checked; },
      rewardsOn(el, e, sh) {
        if (e.type !== 'change') return;
        st.rewardsOn = el.checked;
        sh.body.querySelector('.rewards-part').innerHTML = String(rewardsPart());
      },
    },
    actions: {
      'add-bonus'() {
        openBonusSheet(ctx, {
          onSave(b) {
            st.bonuses.push({ ...b, id: b.id ?? `new-${Date.now()}` });
            sheet.body.querySelector('.rewards-part').innerHTML = String(rewardsPart());
          },
        });
      },
      'edit-bonus'(el) {
        const i = Number(el.dataset.index);
        openBonusSheet(ctx, {
          bonus: st.bonuses[i],
          onSave(b) {
            st.bonuses[i] = { ...st.bonuses[i], ...b, id: st.bonuses[i].id };
            sheet.body.querySelector('.rewards-part').innerHTML = String(rewardsPart());
          },
          onDelete() {
            st.bonuses.splice(i, 1);
            sheet.body.querySelector('.rewards-part').innerHTML = String(rewardsPart());
          },
        });
      },
      save() {
        const limit = readMoney(st.limit);
        if (!limit || Number.isNaN(limit) || limit <= 0) return showFormError(sheet.body, 'Enter the credit limit.');
        const cap = readMoney(st.cap);
        if (Number.isNaN(cap) || cap === 0) return showFormError(sheet.body, 'Enter a monthly cap, or leave it empty.');
        const owed = readMoney(st.owed);
        if (Number.isNaN(owed)) return showFormError(sheet.body, 'Enter what you owe, or leave it empty.');
        let rewards = null;
        if (st.rewardsOn) {
          const baseBp = parseRate(st.base);
          if (Number.isNaN(baseBp)) return showFormError(sheet.body, 'Enter the base cash back percent, like 1.');
          rewards = {
            baseBp: baseBp ?? 0,
            firstYearMatch: st.match,
            bonuses: st.bonuses.map((b) => ({ ...b, id: String(b.id).startsWith('new-') ? null : b.id })),
          };
        }
        const fields = {
          name: st.name, closingDay: Number(st.closingDay), dueDay: Number(st.dueDay), limit, cap,
          openDate: st.openDate, autopay: st.autopay, rewards,
        };
        let added = null;
        try {
          ctx.update((d) => {
            if (card) return updateCard(d, card.id, fields);
            const res = addCard(d, { ...fields, startOwed: Math.abs(owed ?? 0) }, { today: ctx.today });
            added = res.card;
            return res.data;
          });
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast(card ? 'Card saved' : `Added ${added.name}. Quick Add now has a Debit or Card switch.`, { duration: card ? 3000 : 6000 });
      },
      remove() {
        try {
          if (used) ctx.update((d) => closeCard(d, card.id, ctx.today));
          else ctx.update((d) => deleteCard(d, card.id));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        closeAllSheets().then(() => {
          if (ctx.route?.name === 'card') ctx.back();
        });
        return ctx.toast(used ? `Closed ${card.name}` : `Deleted ${card.name}`);
      },
      reopen() {
        ctx.update((d) => reopenCard(d, card.id));
        sheet.close();
        ctx.toast(`Reopened ${card.name}`);
      },
    },
  });
  return sheet;
}

/** The start-of-quarter reminder's "Enter" button: add this quarter's bonus to the card. */
export function enterQuarterBonus(ctx, cardId) {
  const card = findCard(ctx.data, cardId);
  if (!card?.rewards) return;
  const last = [...card.rewards.bonuses].sort((a, b) => (a.start < b.start ? 1 : -1))[0];
  const q = quarterOf(ctx.today);
  openBonusSheet(ctx, {
    title: "This quarter's bonus",
    bonus: last ? { ...last, id: null, start: q.start, end: quarterEnd(ctx.today), categoryIds: [] } : null,
    onSave(b) {
      ctx.update((d) => dismissQuarterReminder(
        updateCard(d, card.id, { rewards: { ...card.rewards, bonuses: [...card.rewards.bonuses, b] } }),
        card.id,
        q.key,
      ));
      ctx.toast('Bonus saved. Remember to activate it in your card app.');
    },
  });
}
