// First-run setup: one friendly question per screen. Every step can be skipped and edited later.
import { html } from './dom.js';
import { icon } from './icons.js';
import { appMark } from './brand.js';
import { parseMoney, formatMoney, formatWholeMoney, centsToDecimal } from '../money.js';
import { addDays } from '../dates.js';
import { FREQUENCY_LABEL, suggestedLimit, monthlyPay, LAST_DAY, ordinal } from '../pay.js';
import { setBalance, setPay, setBudget, setGoal } from '../actions.js';

export const STEP_COUNT = 6; // welcome + 5 questions

const DAY_PAIRS = [
  { id: '1-15', label: '1st and 15th', days: [1, 15] },
  { id: '15-31', label: '15th and last day', days: [15, LAST_DAY] },
  { id: 'custom', label: 'Other days', days: null },
];

function draft(ctx) {
  return {
    balance: '', negative: false, payAmount: '', frequency: 'biweekly', nextPayday: '', pair: '1-15',
    day1: 1, day2: 15, limit: '', goalName: '', goalTarget: '', goalSaved: '',
    ...(ctx.ui.setupDraft ?? {}),
  };
}

function saveDraft(ctx, patch) {
  ctx.setUI({ setupDraft: { ...draft(ctx), ...patch } });
}

const amountOf = (text) => {
  const c = parseMoney(text ?? '');
  return c !== null && c > 0 ? c : null;
};

/** The pay schedule from the draft, or null if it isn't complete. */
function payFromDraft(d, today) {
  const amount = amountOf(d.payAmount);
  if (!amount) return null;
  if (d.frequency === 'semimonthly') {
    const pair = DAY_PAIRS.find((p) => p.id === d.pair);
    const days = pair?.days ?? [Number(d.day1), Number(d.day2)];
    return { amount, frequency: 'semimonthly', days, anchor: today };
  }
  if (!d.nextPayday) return null;
  return { amount, frequency: d.frequency, anchor: d.nextPayday };
}

function suggestion(d, today) {
  const pay = payFromDraft(d, today);
  return pay ? { limit: suggestedLimit(pay), monthly: monthlyPay(pay) } : null;
}

function moneyField({ id, field, value, label, placeholder = '0.00' }) {
  return html`<label class="money-field" for="${id}">
    <span class="money-prefix" aria-hidden="true">$</span>
    <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" value="${value}" data-input="ob-field" data-field="${field}" aria-label="${label}" enterkeyhint="next">
  </label>`;
}

function frame(step, content, { canSkip = true, nextLabel = 'Continue' } = {}) {
  return html`<main class="screen bare onboarding" id="main">
    <div class="ob-top">
      <button type="button" class="icon-btn" data-action="ob-back" aria-label="Back">${icon('chevronLeft')}</button>
      <div class="ob-dots" role="progressbar" aria-label="Setup progress" aria-valuemin="1" aria-valuemax="5" aria-valuenow="${step}">
        ${[1, 2, 3, 4, 5].map((i) => html`<span class="ob-dot${i <= step ? ' on' : ''}"></span>`)}
      </div>
      <span class="ob-step">${step} of 5</span>
    </div>
    <div class="ob-body">${content}</div>
    <p class="field-error" role="alert" id="ob-error"></p>
    <div class="ob-actions">
      <button type="button" class="btn btn-primary btn-block" data-action="ob-next">${nextLabel}</button>
      ${canSkip ? html`<button type="button" class="btn btn-plain btn-block" data-action="ob-skip">Skip for now</button>` : ''}
    </div>
  </main>`;
}

function welcome() {
  return html`<main class="screen bare onboarding welcome" id="main">
    <div class="ob-hero">
      <div class="ob-mark">${appMark(84)}</div>
      <h1 class="ob-name">Runway</h1>
      <p class="ob-lead">Know exactly what you can spend today.</p>
    </div>
    <ul class="ob-points">
      <li>${icon('checkCircle')}<span>See today's safe-to-spend the moment you open it.</span></li>
      <li>${icon('checkCircle')}<span>Log a purchase in about 3 seconds.</span></li>
      <li>${icon('lock')}<span>Your data stays on this phone. No account, no tracking.</span></li>
    </ul>
    <div class="ob-actions">
      <button type="button" class="btn btn-primary btn-block" data-action="ob-next">Get started</button>
      <button type="button" class="btn btn-plain btn-block" data-action="ob-skip-all">Skip setup</button>
    </div>
  </main>`;
}

function balanceStep(d) {
  return frame(1, html`
    <h1 class="ob-title">What's your debit card balance right now?</h1>
    <p class="ob-help">Check your bank app. If it's ever off later, tap Reconcile on Home to fix it.</p>
    ${moneyField({ id: 'ob-balance', field: 'balance', value: d.balance, label: 'Current balance' })}
    <label class="check-row">
      <input type="checkbox" data-input="ob-check" data-field="negative" ${d.negative ? 'checked' : ''}>
      <span>My balance is below zero</span>
    </label>`);
}

function payStep(d, today) {
  const semi = d.frequency === 'semimonthly';
  const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1);
  return frame(2, html`
    <h1 class="ob-title">How do you get paid?</h1>
    <p class="ob-help">Hours vary? That's fine. On payday Runway asks, and you can change the amount.</p>
    <span class="field-label" id="pay-amount-label">Usual paycheck</span>
    ${moneyField({ id: 'ob-pay', field: 'payAmount', value: d.payAmount, label: 'Usual paycheck' })}
    <fieldset class="choices">
      <legend class="field-label">How often</legend>
      ${Object.entries(FREQUENCY_LABEL).map(([value, label]) => html`
        <label class="choice">
          <input type="radio" name="ob-frequency" value="${value}" data-input="ob-radio" data-field="frequency" ${d.frequency === value ? 'checked' : ''}>
          <span>${label}</span>
        </label>`)}
    </fieldset>
    ${semi
      ? html`<fieldset class="choices">
          <legend class="field-label">Which days</legend>
          ${DAY_PAIRS.map((p) => html`
            <label class="choice">
              <input type="radio" name="ob-pair" value="${p.id}" data-input="ob-radio" data-field="pair" ${d.pair === p.id ? 'checked' : ''}>
              <span>${p.label}</span>
            </label>`)}
          ${d.pair === 'custom'
            ? html`<div class="day-pickers">
                ${['day1', 'day2'].map((f, i) => html`<label class="select-field">
                  <span class="field-label">${i === 0 ? 'First payday' : 'Second payday'}</span>
                  <select data-input="ob-field" data-field="${f}">
                    ${dayOptions.map((n) => html`<option value="${n}" ${Number(d[f]) === n ? 'selected' : ''}>${n === LAST_DAY ? 'Last day of the month' : `The ${ordinal(n)}`}</option>`)}
                  </select>
                </label>`)}
              </div>`
            : ''}
        </fieldset>`
      : html`<label class="date-field">
          <span class="field-label">Next payday</span>
          <input type="date" min="${today}" max="${addDays(today, 62)}" value="${d.nextPayday}" data-input="ob-field" data-field="nextPayday" aria-label="Next payday">
        </label>`}`);
}

/** The limit field starts filled with the suggestion until you type your own number. */
function limitValue(d, sug) {
  if (d.limitTouched) return d.limit;
  return d.limit || (sug && sug.limit > 0 ? centsToDecimal(sug.limit) : '');
}

function limitStep(d, today) {
  const sug = suggestion(d, today);
  const value = limitValue(d, sug);
  const usingSuggestion = sug && sug.limit > 0 && amountOf(value) === sug.limit;
  return frame(3, html`
    <h1 class="ob-title">What's the most you want to spend this month?</h1>
    <p class="ob-help">Count everything, rent and bills too. Runway spreads what's left over the days in the month.</p>
    ${moneyField({ id: 'ob-limit', field: 'limit', value, label: 'Monthly spending limit' })}
    ${sug && sug.limit > 0
      ? html`<div class="ob-suggest">
          <p>${usingSuggestion ? 'Suggested' : 'We suggest'} <strong>${formatWholeMoney(sug.limit)}</strong>: 80% of your pay (about ${formatWholeMoney(sug.monthly)} a month), leaving 20% for savings.</p>
          ${usingSuggestion ? '' : html`<button type="button" class="btn btn-quiet btn-sm" data-action="ob-use-suggestion">Use ${formatWholeMoney(sug.limit)}</button>`}
        </div>`
      : html`<p class="ob-help">Tip: a common start is about 80% of what you earn in a month.</p>`}`);
}

function goalStep(d) {
  return frame(4, html`
    <h1 class="ob-title">Saving for something?</h1>
    <p class="ob-help">Optional. Money you move to Savings counts toward it.</p>
    <label class="text-field">
      <span class="field-label">Goal name</span>
      <input type="text" class="text-input" maxlength="40" placeholder="Spring break" value="${d.goalName}" data-input="ob-field" data-field="goalName" autocomplete="off">
    </label>
    <span class="field-label">Target</span>
    ${moneyField({ id: 'ob-goal', field: 'goalTarget', value: d.goalTarget, label: 'Goal target' })}
    <span class="field-label">Already saved (optional)</span>
    ${moneyField({ id: 'ob-goal-saved', field: 'goalSaved', value: d.goalSaved, label: 'Already saved' })}`);
}

function demoStep() {
  return html`<main class="screen bare onboarding" id="main">
    <div class="ob-top">
      <button type="button" class="icon-btn" data-action="ob-back" aria-label="Back">${icon('chevronLeft')}</button>
      <div class="ob-dots" aria-hidden="true">${[1, 2, 3, 4, 5].map(() => html`<span class="ob-dot on"></span>`)}</div>
      <span class="ob-step">5 of 5</span>
    </div>
    <div class="ob-body">
      <div class="ob-illustration">${icon('sparkle')}</div>
      <h1 class="ob-title">Want to explore first?</h1>
      <p class="ob-help">Load six months of made-up spending to see how everything works. It's kept separate from your setup, and one tap clears it.</p>
    </div>
    <div class="ob-actions">
      <button type="button" class="btn btn-primary btn-block" data-action="ob-finish" data-demo="1">Explore with demo data</button>
      <button type="button" class="btn btn-quiet btn-block" data-action="ob-finish">Start fresh</button>
    </div>
  </main>`;
}

export function render(ctx, step) {
  const d = draft(ctx);
  switch (step) {
    case 1: return balanceStep(d);
    case 2: return payStep(d, ctx.today);
    case 3: return limitStep(d, ctx.today);
    case 4: return goalStep(d);
    case 5: return demoStep();
    default: return welcome();
  }
}

function showError(message) {
  const el = document.getElementById('ob-error');
  if (el) el.textContent = message;
}

/** Check the current step. Returns true when it's fine to move on. */
function validateStep(ctx, step) {
  const d = draft(ctx);
  if (step === 1 && d.balance.trim() && parseMoney(d.balance) === null) return showError('That amount doesn\'t look right. Try something like 1250.75'), false;
  if (step === 2) {
    if (d.payAmount.trim() && !amountOf(d.payAmount)) return showError('That paycheck amount doesn\'t look right.'), false;
    if (amountOf(d.payAmount) && d.frequency !== 'semimonthly' && !d.nextPayday) return showError('Pick your next payday.'), false;
    if (d.frequency === 'semimonthly' && d.pair === 'custom' && Number(d.day1) === Number(d.day2)) return showError('Pick two different days.'), false;
  }
  if (step === 3 && d.limit.trim() && !amountOf(d.limit)) return showError('That limit doesn\'t look right.'), false;
  if (step === 4 && (d.goalName.trim() || d.goalTarget.trim())) {
    if (!d.goalName.trim()) return showError('Give your goal a name.'), false;
    if (!amountOf(d.goalTarget)) return showError('Enter a target amount.'), false;
  }
  return true;
}

/** Apply everything answered so far to the data. Unanswered steps are simply left unset. */
export function applyDraft(ctx) {
  const d = draft(ctx);
  const today = ctx.today;
  return (data) => {
    let next = { ...data };
    const bal = parseMoney(d.balance ?? '');
    if (bal !== null && d.balance.trim()) next = setBalance(next, d.negative ? -Math.abs(bal) : Math.abs(bal), today);
    const pay = payFromDraft(d, today);
    if (pay) next = setPay(next, pay, today);
    const limit = amountOf(d.limit);
    if (limit) next = setBudget(next, { limit });
    const target = amountOf(d.goalTarget);
    if (d.goalName.trim() && target) next = setGoal(next, { name: d.goalName, target, saved: amountOf(d.goalSaved) ?? 0 }, today);
    return { ...next, setupDone: true };
  };
}

export const actions = {
  'ob-next'(ctx, el, e, step) {
    if (step === 3) {
      // Accept the pre-filled suggestion if you didn't type your own number.
      const d = draft(ctx);
      saveDraft(ctx, { limit: limitValue(d, suggestion(d, ctx.today)) });
    }
    if (!validateStep(ctx, step)) return;
    ctx.navigate(`setup/${step + 1}`, { replace: true });
  },
  'ob-skip'(ctx, el, e, step) {
    const clear = { 1: { balance: '', negative: false }, 2: { payAmount: '', nextPayday: '' }, 3: { limit: '', limitTouched: true }, 4: { goalName: '', goalTarget: '', goalSaved: '' } }[step];
    if (clear) saveDraft(ctx, clear);
    ctx.navigate(`setup/${step + 1}`, { replace: true });
  },
  'ob-back'(ctx, el, e, step) {
    ctx.navigate(`setup/${Math.max(0, step - 1)}`, { replace: true });
  },
  'ob-skip-all'(ctx) {
    ctx.finishSetup({ apply: (data) => ({ ...data, setupDone: true }), demo: false });
  },
  'ob-use-suggestion'(ctx) {
    const sug = suggestion(draft(ctx), ctx.today);
    if (!sug) return;
    saveDraft(ctx, { limit: centsToDecimal(sug.limit), limitTouched: false });
    ctx.rerender();
  },
  'ob-finish'(ctx, el) {
    ctx.finishSetup({ apply: applyDraft(ctx), demo: el.dataset.demo === '1' });
  },
};

export const inputs = {
  'ob-field'(ctx, el) {
    const patch = { [el.dataset.field]: el.value };
    if (el.dataset.field === 'limit') patch.limitTouched = true;
    saveDraft(ctx, patch);
    showError('');
  },
  'ob-check'(ctx, el) {
    saveDraft(ctx, { [el.dataset.field]: el.checked });
  },
  'ob-radio'(ctx, el, e) {
    if (e.type !== 'change') return;
    saveDraft(ctx, { [el.dataset.field]: el.value });
    ctx.rerender();
  },
};

/** Focus the main input of a step, and let Enter move on. */
export function mount(root) {
  const input = root.querySelector('.money-field input, .text-input');
  if (input && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.matches('input')) {
      e.preventDefault();
      root.querySelector('[data-action="ob-next"]')?.click();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}
