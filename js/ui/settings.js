// Settings: everything from setup, editable any time, plus categories, demo data and backups.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { moneyInput, moneyText, readMoney, field, errorLine, showFormError } from './forms.js';
import { openReconcile } from './reconcile.js';
import * as categoriesPage from './categories-page.js';
import { formatMoney, formatWholeMoney } from '../money.js';
import { formatDate, addDays } from '../dates.js';
import { FREQUENCY_LABEL, describeDays, nextPayday, monthlyPay, suggestedLimit, LAST_DAY, ordinal } from '../pay.js';
import { setBalance, setPay, setBudget, setGoal, setSetting } from '../actions.js';
import { APP_VERSION } from '../version.js';
import { actions as backupActions, lastBackupText } from './backup.js';

/** The icon badge needs the Badging API and notification permission (home screen apps on iOS 16.4+). */
const badgeSupported = () => 'setAppBadge' in navigator && 'Notification' in window;

const TINT = {
  balance: '#34C759', reconcile: '#0A84FF', pay: '#FF9500', limit: '#5E5CE6', start: '#8E8E93',
  split: '#30B0C7', goal: '#FF2D55', categories: '#AF52DE', demo: '#FFCC00',
};

function row(action, iconName, tint, label, value = '', to = null) {
  return html`<li><button type="button" class="row" data-action="${action}"${to ? html` data-to="${to}"` : ''}>
    <span class="row-icon" style="--tint:${tint}">${icon(iconName)}</span>
    <span class="row-label">${label}</span>
    ${value ? html`<span class="row-value">${value}</span>` : ''}
    ${icon('chevronRight', { cls: 'row-chevron' })}
  </button></li>`;
}

function payLabel(pay, today) {
  const when = pay.frequency === 'semimonthly' ? describeDays(pay.days) : FREQUENCY_LABEL[pay.frequency].toLowerCase();
  const next = nextPayday(pay, addDays(today, -1));
  return `${formatWholeMoney(pay.amount)}, ${when}${next ? `, next ${formatDate(next, 'short')}` : ''}`;
}

export function render(ctx, params = []) {
  if (params[0] === 'categories') return categoriesPage.render(ctx);
  const d = ctx.data;
  const s = d.budget.split;
  return html`<main class="screen settings" id="main">
    <header class="navbar">
      <button type="button" class="nav-back" data-action="back">${icon('chevronLeft')}<span>Home</span></button>
    </header>
    <h1 class="large-title">Settings</h1>
    ${ctx.mode === 'demo' ? html`<p class="banner banner-demo">${icon('sparkle')}<span>You're editing demo data. Your own setup is untouched.</span></p>` : ''}

    <h2 class="group-title">Your money</h2>
    <ul class="card list-card">
      ${row('edit-balance', 'wallet', TINT.balance, 'Starting balance', d.balance ? `${formatMoney(d.balance.start)}, ${formatDate(d.balance.startDate, 'short')}` : 'Not set')}
      ${row('reconcile', 'refresh', TINT.reconcile, 'Reconcile with bank')}
      ${row('edit-pay', 'calendar', TINT.pay, 'Pay', d.pay ? payLabel(d.pay, ctx.today) : 'Not set')}
      ${row('edit-limit', 'target', TINT.limit, 'Monthly limit', d.budget.limit ? formatWholeMoney(d.budget.limit) : 'Not set')}
      ${row('edit-start', 'calendar', TINT.start, 'Month starts on', d.budget.startDay === 1 ? 'the 1st' : `the ${ordinal(d.budget.startDay)}`)}
      ${row('edit-split', 'chart', TINT.split, 'Target split', `${s.need} / ${s.want} / ${s.savings}`)}
      ${row('edit-goal', 'sparkle', TINT.goal, 'Savings goal', d.goal ? `${d.goal.name}, ${formatWholeMoney(d.goal.target)}` : 'Not set')}
    </ul>

    <h2 class="group-title">Organize</h2>
    <ul class="card list-card">
      ${row('nav', 'list', TINT.categories, 'Categories', String(d.categories.length), 'settings/categories')}
    </ul>

    ${badgeSupported() ? html`
      <h2 class="group-title">App icon</h2>
      <ul class="card list-card">
        <li class="toggle-row">
          <span class="row-icon" style="--tint:#FF3B30">${icon('bell')}</span>
          <label class="row-label" for="badge-toggle">Show today's safe-to-spend on the app icon</label>
          <label class="bill-switch"><input type="checkbox" switch class="switch" id="badge-toggle" data-input="badge" ${d.settings.badge ? 'checked' : ''}></label>
        </li>
      </ul>
      <p class="group-foot">Shows today's number in whole dollars on the Runway icon. It refreshes when you open the app, so it can be behind if you haven't opened Runway today. iPhone asks for notification permission because badges count as notifications. Runway never sends any.</p>` : ''}

    <h2 class="group-title">Backup and data</h2>
    <ul class="card list-card">
      ${row('export-backup', 'download', '#34C759', 'Export backup', lastBackupText(ctx))}
      ${row('import-backup', 'upload', '#0A84FF', 'Import backup')}
      ${row('export-csv', 'list', '#30B0C7', 'Export transactions (CSV)')}
    </ul>
    <p class="group-foot">Save backups to Files or iCloud Drive. Always back up before deleting the app or switching phones.</p>

    <h2 class="group-title">Demo data</h2>
    <ul class="card list-card">
      ${ctx.mode === 'demo'
        ? row('clear-demo', 'close', TINT.demo, 'Clear demo data')
        : row('start-demo', 'sparkle', TINT.demo, 'Explore with demo data')}
    </ul>
    <p class="group-foot">Demo data is kept separate. Clearing it brings back your own setup exactly as it was.</p>

    <ul class="card list-card danger-card">
      <li><button type="button" class="row danger-row" data-action="erase-all">${icon('trash')}<span class="row-label">Erase everything</span></button></li>
    </ul>

    <p class="about">${icon('lock')} Runway ${APP_VERSION}. Your data stays on this phone. Nothing is sent anywhere.</p>
  </main>`;
}

// Sheets

function balanceSheet(ctx) {
  const b = ctx.data.balance;
  const st = { amount: moneyText(b?.start), negative: (b?.start ?? 0) < 0, date: b?.startDate ?? ctx.today };
  const sheet = openSheet({
    title: 'Starting balance',
    render: () => html`
      <p class="sheet-lead">Your debit card balance at the start of a day. Runway adds everything you log from that day on.</p>
      ${moneyInput({ name: 'amount', value: st.amount, label: 'Balance' })}
      <label class="check-row"><input type="checkbox" data-input="negative" ${st.negative ? 'checked' : ''}><span>Balance is below zero</span></label>
      ${field('As of', html`<input type="date" class="field-input" data-input="date" value="${st.date}" max="${ctx.today}" aria-label="As of date">`)}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>
      ${b ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="clear">Stop tracking my balance</button>` : ''}
      <p class="sheet-foot">${icon('info')}For a small difference, use Reconcile instead. It keeps your history.</p>`,
    inputs: {
      amount: (el) => { st.amount = el.value; },
      negative: (el) => { st.negative = el.checked; },
      date: (el) => { st.date = el.value; },
    },
    actions: {
      save() {
        const c = readMoney(st.amount);
        if (c === null || Number.isNaN(c)) return showFormError(sheet.body, 'Enter your balance.');
        try {
          ctx.update((d) => setBalance(d, st.negative ? -Math.abs(c) : Math.abs(c), st.date));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast('Balance saved');
      },
      clear() {
        ctx.update((d) => setBalance(d, null));
        sheet.close();
        ctx.toast('Balance tracking is off');
      },
    },
  });
}

const DAY_PAIRS = [
  { id: '1-15', label: '1st and 15th', days: [1, 15] },
  { id: '15-31', label: '15th and last day', days: [15, LAST_DAY] },
  { id: 'custom', label: 'Other days', days: null },
];

function paySheet(ctx) {
  const p = ctx.data.pay;
  const pairId = (days) => DAY_PAIRS.find((x) => x.days && days && x.days.join() === days.join())?.id ?? 'custom';
  const st = {
    amount: moneyText(p?.amount),
    frequency: p?.frequency ?? 'biweekly',
    next: p && p.frequency !== 'semimonthly' ? nextPayday(p, addDays(ctx.today, -1)) ?? '' : '',
    pair: p?.days ? pairId(p.days) : '1-15',
    day1: p?.days?.[0] ?? 1,
    day2: p?.days?.[1] ?? 15,
  };
  const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1);
  const sheet = openSheet({
    title: 'Pay',
    render: () => html`
      ${field('Usual paycheck', moneyInput({ name: 'amount', value: st.amount, label: 'Usual paycheck' }), 'Hours vary? On payday Runway asks, and you can change the amount.')}
      <fieldset class="choices">
        <legend class="field-label">How often</legend>
        ${Object.entries(FREQUENCY_LABEL).map(([value, label]) => html`<label class="choice">
          <input type="radio" name="pay-frequency" value="${value}" data-input="frequency" ${st.frequency === value ? 'checked' : ''}><span>${label}</span></label>`)}
      </fieldset>
      ${st.frequency === 'semimonthly'
        ? html`<fieldset class="choices">
            <legend class="field-label">Which days</legend>
            ${DAY_PAIRS.map((x) => html`<label class="choice"><input type="radio" name="pay-pair" value="${x.id}" data-input="pair" ${st.pair === x.id ? 'checked' : ''}><span>${x.label}</span></label>`)}
            ${st.pair === 'custom' ? html`<div class="day-pickers">${['day1', 'day2'].map((f, i) => html`<label class="select-field">
              <span class="field-label">${i === 0 ? 'First payday' : 'Second payday'}</span>
              <select data-input="${f}">${dayOptions.map((n) => html`<option value="${n}" ${Number(st[f]) === n ? 'selected' : ''}>${n === LAST_DAY ? 'Last day of the month' : `The ${ordinal(n)}`}</option>`)}</select>
            </label>`)}</div>` : ''}
          </fieldset>`
        : field('Next payday', html`<input type="date" class="field-input" data-input="next" value="${st.next}" min="${ctx.today}" max="${addDays(ctx.today, 62)}" aria-label="Next payday">`)}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>
      ${p ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="clear">Remove pay schedule</button>` : ''}`,
    inputs: {
      amount: (el) => { st.amount = el.value; },
      next: (el) => { st.next = el.value; },
      day1: (el) => { st.day1 = Number(el.value); },
      day2: (el) => { st.day2 = Number(el.value); },
      frequency(el, e, sh) {
        if (e.type !== 'change') return;
        st.frequency = el.value;
        sh.refresh();
      },
      pair(el, e, sh) {
        if (e.type !== 'change') return;
        st.pair = el.value;
        sh.refresh();
      },
    },
    actions: {
      save() {
        const amount = readMoney(st.amount);
        if (!amount || Number.isNaN(amount) || amount <= 0) return showFormError(sheet.body, 'Enter your usual paycheck.');
        const pay = { amount, frequency: st.frequency };
        if (st.frequency === 'semimonthly') pay.days = DAY_PAIRS.find((x) => x.id === st.pair)?.days ?? [st.day1, st.day2];
        else if (!st.next) return showFormError(sheet.body, 'Pick your next payday.');
        else pay.anchor = st.next;
        try {
          ctx.update((d) => setPay(d, pay, ctx.today));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast('Pay schedule saved');
      },
      clear() {
        ctx.update((d) => setPay(d, null, ctx.today));
        sheet.close();
        ctx.toast('Pay schedule removed');
      },
    },
  });
}

export function limitSheet(ctx) {
  const current = ctx.data.budget.limit;
  const sug = ctx.data.pay ? suggestedLimit(ctx.data.pay) : 0;
  const st = { amount: moneyText(current ?? (sug || null)) };
  const sheet = openSheet({
    title: 'Monthly limit',
    render: () => html`
      <p class="sheet-lead">The most you want to spend in a month, rent and bills included. Money you move to savings doesn't count.</p>
      ${moneyInput({ name: 'amount', value: st.amount, label: 'Monthly limit' })}
      ${sug > 0 ? html`<p class="field-hint">Suggested: ${formatWholeMoney(sug)}, which is 80% of your pay (about ${formatWholeMoney(monthlyPay(ctx.data.pay))} a month), leaving 20% for savings.</p>` : ''}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>
      ${current ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="clear">Remove limit</button>` : ''}`,
    inputs: { amount: (el) => { st.amount = el.value; } },
    actions: {
      save() {
        const c = readMoney(st.amount);
        if (!c || Number.isNaN(c) || c <= 0) return showFormError(sheet.body, 'Enter a monthly limit.');
        try {
          ctx.update((d) => setBudget(d, { limit: c }));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast(`Monthly limit set to ${formatWholeMoney(c)}`);
      },
      clear() {
        ctx.update((d) => setBudget(d, { limit: null }));
        sheet.close();
        ctx.toast('Monthly limit removed');
      },
    },
  });
}

function startSheet(ctx) {
  const st = { day: ctx.data.budget.startDay };
  const sheet = openSheet({
    title: 'Month starts on',
    render: () => html`
      <p class="sheet-lead">Line your budget month up with payday. If you get paid on the 15th, start your month on the 15th.</p>
      <label class="select-field">
        <span class="field-label">Start each budget month on</span>
        <select data-input="day">${Array.from({ length: 28 }, (_, i) => i + 1).map((n) => html`<option value="${n}" ${st.day === n ? 'selected' : ''}>${n === 1 ? 'The 1st (calendar month)' : `The ${ordinal(n)}`}</option>`)}</select>
      </label>
      <p class="field-hint">Days 29 to 31 aren't offered because some months don't have them.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>`,
    inputs: { day: (el) => { st.day = Number(el.value); } },
    actions: {
      save() {
        ctx.update((d) => setBudget(d, { startDay: st.day }));
        sheet.close();
        ctx.toast(st.day === 1 ? 'Budget months follow the calendar' : `Budget months now start on the ${ordinal(st.day)}`);
      },
    },
  });
}

function splitSheet(ctx) {
  const st = { ...ctx.data.budget.split };
  const total = () => Number(st.need) + Number(st.want) + Number(st.savings);
  const sheet = openSheet({
    title: 'Target split',
    render: () => html`
      <p class="sheet-lead">How you'd like your income to split between needs, wants and savings. 50 / 30 / 20 is a popular start.</p>
      <div class="split-inputs">
        ${[['need', 'Needs'], ['want', 'Wants'], ['savings', 'Savings']].map(([k, label]) => html`<label class="split-input">
          <span class="field-label">${label}</span>
          <span class="pct-field"><input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${st[k]}" data-input="${k}" aria-label="${label} percent"><span aria-hidden="true">%</span></span>
        </label>`)}
      </div>
      <p class="split-total" aria-live="polite">Total: <strong>${total()}%</strong></p>
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>
      <button type="button" class="btn btn-plain btn-block" data-action="reset">Use 50 / 30 / 20</button>`,
    inputs: Object.fromEntries(['need', 'want', 'savings'].map((k) => [k, (el, e, sh) => {
      st[k] = el.value.replace(/\D/g, '');
      const t = total();
      sh.body.querySelector('.split-total').innerHTML = String(html`Total: <strong class="${t === 100 ? '' : 'tone-bad'}">${Number.isNaN(t) ? '?' : t}%</strong>`);
    }])),
    actions: {
      save() {
        try {
          ctx.update((d) => setBudget(d, { split: { need: Number(st.need), want: Number(st.want), savings: Number(st.savings) } }));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast('Target split saved');
      },
      reset(el, e, sh) {
        Object.assign(st, { need: 50, want: 30, savings: 20 });
        sh.refresh();
      },
    },
  });
}

function goalSheet(ctx) {
  const g = ctx.data.goal;
  const st = { name: g?.name ?? '', target: moneyText(g?.target), saved: moneyText(g?.saved || null) };
  const sheet = openSheet({
    title: 'Savings goal',
    render: () => html`
      <p class="sheet-lead">Anything you log in a Savings category counts toward it.</p>
      ${field('Goal name', html`<input type="text" class="field-input" maxlength="40" placeholder="Spring break" value="${st.name}" data-input="name" autocomplete="off" aria-label="Goal name">`)}
      ${field('Target', moneyInput({ name: 'target', value: st.target, label: 'Target amount' }))}
      ${field('Already saved', moneyInput({ name: 'saved', value: st.saved, label: 'Already saved' }), 'Money you had saved before setting this goal.')}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">Save</button>
      ${g ? html`<button type="button" class="btn btn-plain btn-block btn-danger" data-action="clear">Remove goal</button>` : ''}`,
    inputs: {
      name: (el) => { st.name = el.value; },
      target: (el) => { st.target = el.value; },
      saved: (el) => { st.saved = el.value; },
    },
    actions: {
      save() {
        const target = readMoney(st.target);
        const saved = readMoney(st.saved);
        if (!target || Number.isNaN(target)) return showFormError(sheet.body, 'Enter a target amount.');
        if (Number.isNaN(saved)) return showFormError(sheet.body, 'That saved amount doesn\'t look right.');
        try {
          ctx.update((d) => setGoal(d, { name: st.name, target, saved: saved ?? 0 }, ctx.today));
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast('Goal saved');
      },
      clear() {
        ctx.update((d) => setGoal(d, null, ctx.today));
        sheet.close();
        ctx.toast('Goal removed');
      },
    },
  });
}

export const actions = {
  'edit-balance': (ctx) => balanceSheet(ctx),
  reconcile: (ctx) => openReconcile(ctx),
  'edit-pay': (ctx) => paySheet(ctx),
  'edit-limit': (ctx) => limitSheet(ctx),
  'edit-start': (ctx) => startSheet(ctx),
  'edit-split': (ctx) => splitSheet(ctx),
  'edit-goal': (ctx) => goalSheet(ctx),
  'start-demo': (ctx) => ctx.startDemo(),
  ...backupActions,
  ...categoriesPage.actions,
};

async function toggleBadge(ctx, el, e) {
  if (e.type !== 'change') return;
  if (!el.checked) {
    ctx.update((d) => setSetting(d, 'badge', false));
    navigator.clearAppBadge?.().catch(() => {});
    ctx.toast('Icon badge off');
    return;
  }
  // Ask only now, when you switch it on.
  let permission = Notification.permission;
  if (permission !== 'granted') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'denied';
    }
  }
  if (permission !== 'granted') {
    el.checked = false;
    ctx.toast('The badge needs notification permission. You can allow it in iPhone Settings, Notifications, Runway.', { duration: 7000 });
    return;
  }
  ctx.update((d) => setSetting(d, 'badge', true));
  ctx.updateBadge();
  ctx.toast('Icon badge on. It updates whenever you open Runway.');
}

export const inputs = { ...categoriesPage.inputs, badge: toggleBadge };

export function mount(root, ctx, params = []) {
  if (params[0] === 'categories') return categoriesPage.mount(root, ctx);
  return null;
}

export { paySheet, goalSheet, balanceSheet };
