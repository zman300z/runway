// Bills and subscriptions: the yearly total (big, so it hits hard), what's due this week,
// pause toggles that show what cutting one would save, and add/edit sheets.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { helpButton } from './explain-sheet.js';
import { moneyInput, moneyText, readMoney, field, errorLine, showFormError } from './forms.js';
import { safeColor, plural } from './format.js';
import { formatMoney } from '../money.js';
import { formatDate, relativeDay, addDays, diffDays, parseISO } from '../dates.js';
import {
  billTotals, upcomingCharges, yearlyCost, CADENCES, CADENCE_LABEL, CADENCE_UNIT, chargeDatesBetween,
} from '../recurring.js';
import { categoryMap } from '../categories.js';
import { addBill, updateBill, setBillActive, deleteBill, runDailyJobs } from '../actions.js';

const AND = new Intl.ListFormat('en', { type: 'conjunction' });

const byNext = (a, b) => (a.next < b.next ? -1 : a.next > b.next ? 1 : a.name.localeCompare(b.name));

function inDays(date, today) {
  const n = diffDays(today, date);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

function billRow(b, cats, today) {
  const cat = cats.get(b.categoryId);
  const sub = b.active
    ? `${formatMoney(b.amount)} ${CADENCE_LABEL[b.cadence].toLowerCase()} · next ${formatDate(b.next, 'short')}`
    : `${formatMoney(b.amount)} ${CADENCE_LABEL[b.cadence].toLowerCase()} · paused, saves ${formatMoney(yearlyCost(b))} a year`;
  return html`<li class="bill-row${b.active ? '' : ' paused'}">
    <button type="button" class="row bill-main" data-action="edit-bill" data-id="${b.id}">
      <span class="tx-icon" style="--cat:${safeColor(cat?.color)}" aria-hidden="true">${cat?.emoji ?? '🔁'}</span>
      <span class="row-label">${b.name}<span class="row-sub">${sub}</span></span>
    </button>
    <label class="bill-switch">
      <span class="sr-only">${b.name} active</span>
      <input type="checkbox" switch class="switch" data-input="bill-active" data-id="${b.id}" ${b.active ? 'checked' : ''}>
    </label>
  </li>`;
}

export function render(ctx) {
  const bills = ctx.data.recurring;
  const cats = categoryMap(ctx.data.categories);
  const t = billTotals(bills);
  const active = bills.filter((b) => b.active).sort(byNext);
  const paused = bills.filter((b) => !b.active).sort((a, b) => a.name.localeCompare(b.name));
  // Today's charges have already posted, so "next 7 days" starts tomorrow.
  const soon = upcomingCharges(bills, addDays(ctx.today, 1), addDays(ctx.today, 7));
  return html`<main class="screen bills" id="main">
    <div class="title-row">
      <h1 class="large-title">Bills</h1>
      <button type="button" class="icon-btn" data-action="add-bill" aria-label="Add a bill or subscription">${icon('plus')}</button>
    </div>
    ${bills.length === 0
      ? html`<div class="empty">
          <div class="empty-icon">${icon('bills')}</div>
          <p class="empty-title">No bills yet</p>
          <p class="empty-text">Add rent, your phone plan and subscriptions. Runway posts each charge on its date, even if you don't open the app.</p>
          <button type="button" class="btn btn-primary" data-action="add-bill">${icon('plus')}Add a bill</button>
        </div>`
      : html`
        <section class="card bill-totals" aria-label="Bill totals">
          <div class="tile-top"><span class="tile-label">Your bills cost</span>${helpButton('bills', 'How bill totals are worked out')}</div>
          <p class="bt-year">${formatMoney(t.perYear)}<span> a year</span></p>
          <p class="bt-month">That's <strong>${formatMoney(t.perMonth)}</strong> a month across ${plural(active.length, 'active bill')}.</p>
        </section>
        ${t.pausedPerYear ? html`<p class="note note-good">${icon('checkCircle')}<span>Pausing ${AND.format(paused.map((b) => b.name))} saves you ${formatMoney(t.pausedPerYear)} a year.</span></p>` : ''}
        <div class="section-head"><h2>Due in the next 7 days</h2></div>
        ${soon.length
          ? html`<ul class="card list-card">${soon.map((c) => html`<li><button type="button" class="row" data-action="edit-bill" data-id="${c.billId}">
              <span class="tx-icon" style="--cat:${safeColor(cats.get(c.categoryId)?.color)}" aria-hidden="true">${cats.get(c.categoryId)?.emoji ?? '🔁'}</span>
              <span class="row-label">${c.name}<span class="row-sub">${formatDate(c.date, 'medium')}, ${inDays(c.date, ctx.today)}</span></span>
              <span class="row-value strong">${formatMoney(c.amount)}</span>
            </button></li>`)}</ul>`
          : html`<div class="card empty-card"><p class="muted">Nothing due in the next 7 days.</p></div>`}
        ${active.length ? html`<div class="section-head"><h2>Active</h2></div><ul class="card list-card">${active.map((b) => billRow(b, cats, ctx.today))}</ul>` : ''}
        ${paused.length ? html`<div class="section-head"><h2>Paused</h2></div><ul class="card list-card">${paused.map((b) => billRow(b, cats, ctx.today))}</ul>` : ''}
        <p class="group-foot">Switch a bill off to pause it and see what cutting it would save. Paused bills don't post charges.</p>`}
  </main>`;
}

/** Run daily jobs right away so a bill dated today or earlier posts immediately. */
function postNow(ctx, data) {
  return runDailyJobs(data, ctx.today);
}

function billSheet(ctx, id = null) {
  const b = id ? ctx.data.recurring.find((x) => x.id === id) : null;
  const cats = ctx.data.categories;
  const defaultCat = cats.find((c) => c.id === 'subscriptions') ?? cats.find((c) => c.bucket !== 'savings') ?? cats[0];
  const st = {
    name: b?.name ?? '',
    amount: moneyText(b?.amount ?? null),
    categoryId: b?.categoryId ?? defaultCat.id,
    cadence: b?.cadence ?? 'monthly',
    next: b?.next ?? '',
  };

  function headsUp() {
    if (!st.next) return '';
    const lines = [];
    const day = parseISO(st.next).d;
    if (st.cadence === 'monthly' && day >= 29) lines.push(`In months without a ${day}${day === 31 ? 'st' : 'th'}, it charges on the last day.`);
    const nextChanged = !b || st.next !== b.next || st.cadence !== b.cadence;
    if (nextChanged && st.next <= ctx.today && (!b || b.active)) {
      const dates = chargeDatesBetween(st.next, st.cadence, st.next, ctx.today);
      const posted = new Set(ctx.data.posted);
      const fresh = b ? dates.filter((d) => !posted.has(`${b.id}:${d}`)) : dates;
      if (fresh.length) {
        lines.push(`Saving adds ${plural(fresh.length, 'charge')} right away (${fresh.slice(0, 3).map((d) => formatDate(d, 'short')).join(', ')}${fresh.length > 3 ? ', ...' : ''}).`);
      }
    }
    return lines.length ? html`<p class="note note-warn">${icon('info')}<span>${lines.join(' ')}</span></p>` : '';
  }

  const sheet = openSheet({
    title: b ? 'Edit bill' : 'New bill',
    render: () => html`
      ${field('Name', html`<input type="text" class="field-input" maxlength="40" value="${st.name}" placeholder="Netflix" data-input="name" autocomplete="off" aria-label="Bill name">`)}
      ${field('Amount', moneyInput({ name: 'amount', value: st.amount, label: 'Amount' }))}
      ${field('How often', html`<div class="segmented" role="group" aria-label="How often">${CADENCES.map((c) => html`<button type="button" class="seg${st.cadence === c ? ' on' : ''}" data-action="cadence" data-cadence="${c}" aria-pressed="${st.cadence === c}">${CADENCE_LABEL[c]}</button>`)}</div>`)}
      ${field('Next charge', html`<input type="date" class="field-input" value="${st.next}" data-input="next" aria-label="Next charge date">`)}
      <div class="heads-up" aria-live="polite">${headsUp()}</div>
      ${field('Category', html`<select class="field-input" data-input="category" aria-label="Category">${cats.map((c) => html`<option value="${c.id}" ${st.categoryId === c.id ? 'selected' : ''}>${c.emoji} ${c.name}</option>`)}</select>`)}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">${b ? 'Save' : 'Add bill'}</button>
      ${b ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="delete">${icon('trash')}Delete bill</button>` : ''}
      <p class="sheet-foot">${icon('info')}Changes apply to future charges. Charges already posted stay as they are.</p>`,
    inputs: {
      name: (el) => { st.name = el.value; },
      amount: (el) => { st.amount = el.value; },
      category: (el) => { st.categoryId = el.value; },
      next(el, e, sh) {
        st.next = el.value;
        sh.body.querySelector('.heads-up').innerHTML = String(headsUp());
      },
    },
    actions: {
      cadence(el, e, sh) {
        st.cadence = el.dataset.cadence;
        sh.refresh();
      },
      save() {
        const amount = readMoney(st.amount);
        if (!amount || Number.isNaN(amount) || amount <= 0) return showFormError(sheet.body, 'Enter an amount.');
        const fields = { name: st.name, amount, categoryId: st.categoryId, cadence: st.cadence, next: st.next };
        let added = [];
        try {
          ctx.update((d) => {
            const next = b ? updateBill(d, b.id, fields) : addBill(d, fields).data;
            const posted = postNow(ctx, next);
            added = posted.added;
            return posted.data;
          });
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        const extra = added.length ? ` Posted ${plural(added.length, 'past charge')}.` : '';
        return ctx.toast(`${b ? 'Saved' : 'Added'} ${st.name.trim()}.${extra}`);
      },
      delete() {
        const before = ctx.data;
        const after = ctx.update((d) => deleteBill(d, b.id));
        sheet.close();
        ctx.toast(`Deleted ${b.name}. Past charges stay in your history.`, {
          duration: 5000,
          action: {
            label: 'Undo',
            run: () => {
              if (ctx.data !== after) return ctx.toast("Can't undo after other changes.", { tone: 'bad' });
              return ctx.update(() => before);
            },
          },
        });
      },
    },
  });
}

export const actions = {
  'add-bill': (ctx) => billSheet(ctx),
  'edit-bill': (ctx, el) => billSheet(ctx, el.dataset.id),
};

export const inputs = {
  'bill-active'(ctx, el, e) {
    if (e.type !== 'change') return;
    const id = el.dataset.id;
    const bill = ctx.data.recurring.find((b) => b.id === id);
    if (!bill) return;
    let added = [];
    ctx.update((d) => {
      const r = postNow(ctx, setBillActive(d, id, el.checked, ctx.today));
      added = r.added;
      return r.data;
    });
    const updated = ctx.data.recurring.find((b) => b.id === id);
    if (el.checked) {
      ctx.toast(added.length ? `Resumed ${bill.name}. Charged today.` : `Resumed ${bill.name}. Next charge ${formatDate(updated.next, 'medium')}.`);
    } else {
      ctx.toast(`Paused ${bill.name}. That saves ${formatMoney(yearlyCost(bill))} a year.`);
    }
  },
};

export { billSheet, inDays, CADENCE_UNIT };
