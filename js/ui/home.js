// Home answers three questions at a glance: how much can I spend today, how is my month
// going, and what is my balance. Everything else sits below the fold.
import { html, raw } from './dom.js';
import { icon } from './icons.js';
import { helpButton } from './explain-sheet.js';
import { bigMoney, lengthClass } from './format.js';
import { txRow } from './activity.js';
import { ringSVG } from '../charts.js';
import { formatMoney, formatWholeMoney } from '../money.js';
import { formatDate, diffDays } from '../dates.js';
import { categoryMap } from '../categories.js';
import { byNewest } from '../search.js';
import { PACE_LABEL } from '../explain.js';

export const PACE_TONE = { ontrack: 'good', ahead: 'warn', over: 'bad' };
export const PACE_ICON = { ontrack: 'checkCircle', ahead: 'trend', over: 'alert' };

export function paydayText(payday, today) {
  return diffDays(today, payday) <= 1 ? 'Payday tomorrow' : `Payday ${formatDate(payday, 'medium')}`;
}

function demoBanner() {
  return html`<div class="banner banner-demo" role="note">
    ${icon('sparkle')}<span>Exploring demo data</span>
    <button type="button" class="link-btn sm" data-action="clear-demo">Clear demo data</button>
  </div>`;
}

function setupCard() {
  return html`<section class="card setup-card">
    <h2>Let's get you a number</h2>
    <p class="muted">Add your balance or a monthly limit, and Runway will show what's safe to spend today.</p>
    <button type="button" class="btn btn-primary btn-block" data-action="nav" data-to="setup/1">Finish setup</button>
  </section>`;
}

function guardNote(s) {
  if (s.mode === 'budget') {
    return html`<button type="button" class="note note-info" data-action="reconcile">
      ${icon('info')}<span>Add your balance so Runway can check your cash covers this.</span>${icon('chevronRight')}
    </button>`;
  }
  if (s.mode !== 'both' || !(s.dailyGuarded || s.monthGuarded)) return '';
  let text;
  if (s.balance < 0) text = 'Your balance is below zero, so nothing is safe to spend right now.';
  else if (s.cash <= 0) text = s.payday ? 'Bills due before payday use up your balance.' : 'Bills due this month use up your balance.';
  else if (s.payday) text = `Lowered to fit your cash until payday, ${formatDate(s.payday, 'medium')}.`;
  else text = 'Lowered to fit your cash until the month ends.';
  return html`<p class="note note-warn">${icon('info')}<span>${text}</span></p>`;
}

function hero(s) {
  if (s.mode === 'none') return setupCard();
  const over = s.month < 0;
  return html`<section class="hero" aria-labelledby="hero-label">
    <div class="hero-label"><span id="hero-label">Safe to spend today</span>${helpButton('today', "How today's number is worked out")}</div>
    <p class="hero-amount ${lengthClass(s.daily)}${s.daily === 0 ? ' is-zero' : ''}">${bigMoney(s.daily)}</p>
    <div class="hero-sub">
      ${over
        ? html`<span class="tone-bad strong">${icon('alert')}Over by ${formatMoney(-s.month)} this month</span>`
        : html`<span><strong>${formatMoney(s.month)}</strong> left this month</span><span class="dot" aria-hidden="true"></span><span>${s.daysLeft === 1 ? 'last day' : `${s.daysLeft} days to go`}</span>`}
      ${helpButton('month', 'How the month number is worked out')}
    </div>
    ${guardNote(s)}
  </section>`;
}

function monthTile(s) {
  if (s.limit === null) {
    return html`<div class="tile">
      <span class="tile-label">This month</span>
      <p class="tile-hint">Set a monthly limit to see how your month is going.</p>
      <button type="button" class="btn btn-quiet btn-sm" data-action="edit-limit">Set a limit</button>
    </div>`;
  }
  const status = s.pace.status;
  const tone = PACE_TONE[status];
  const label = `${s.usedPct}% of your ${formatWholeMoney(s.limit)} limit used`;
  return html`<div class="tile month-tile">
    <div class="tile-top"><span class="tile-label">This month</span>${helpButton('limit', 'How the monthly limit works')}</div>
    <div class="ring-wrap">
      ${raw(ringSVG({ spent: s.spent / s.limit, scheduled: s.scheduledSpend / s.limit, tone, label }))}
      <span class="ring-center" aria-hidden="true">${Math.min(999, s.usedPct)}%</span>
    </div>
    <p class="tile-value"><strong>${formatWholeMoney(s.spent)}</strong> <span class="muted">of ${formatWholeMoney(s.limit)}</span></p>
    <button type="button" class="pill bg-${tone} pace-pill" data-action="explain" data-topic="pace" aria-label="Pace: ${PACE_LABEL[status]}. How pace works">
      ${icon(PACE_ICON[status])}${PACE_LABEL[status]}
    </button>
  </div>`;
}

function balanceTile(ctx, s) {
  if (s.balance === null) {
    return html`<div class="tile">
      <span class="tile-label">Balance</span>
      <p class="tile-hint">Add your balance so Runway never suggests money you don't have.</p>
      <button type="button" class="btn btn-quiet btn-sm" data-action="reconcile">Add balance</button>
    </div>`;
  }
  const negative = s.balance < 0;
  return html`<div class="tile balance-tile">
    <div class="tile-top"><span class="tile-label">Balance</span>${helpButton('balance', 'How your balance is worked out')}</div>
    <p class="tile-big${negative ? ' tone-bad' : ''}">${formatMoney(s.balance)}</p>
    ${negative ? html`<span class="pill bg-bad">${icon('alert')}Below zero</span>` : ''}
    ${s.payday ? html`<p class="tile-sub">${paydayText(s.payday, ctx.today)}</p>` : ''}
    <button type="button" class="btn btn-quiet btn-sm" data-action="reconcile">${icon('refresh')}Reconcile</button>
  </div>`;
}

function recent(ctx) {
  const cats = categoryMap(ctx.data.categories);
  const latest = [...ctx.data.transactions].filter((t) => t.date <= ctx.today).sort(byNewest).slice(0, 5);
  return html`<section class="home-section" aria-labelledby="recent-title">
    <div class="section-head">
      <h2 id="recent-title">Recent</h2>
      ${latest.length ? html`<button type="button" class="link-btn" data-action="tab" data-to="activity">See all</button>` : ''}
    </div>
    ${latest.length
      ? html`<ul class="card list-card tx-rows">${latest.map((t) => txRow(t, cats, { swipe: false }))}</ul>`
      : html`<div class="card empty-card"><p class="muted">No purchases yet. Tap ${icon('plus', { label: 'plus' })} to log your first one.</p></div>`}
  </section>`;
}

export function render(ctx) {
  const s = ctx.summary;
  return html`<main class="screen home" id="main">
    <header class="topbar">
      <p class="topbar-date">${formatDate(ctx.today, 'long')}</p>
      <button type="button" class="icon-btn" data-action="nav" data-to="settings" aria-label="Settings">${icon('gear')}</button>
    </header>
    ${ctx.mode === 'demo' ? demoBanner() : ''}
    ${hero(s)}
    ${s.mode === 'none' ? '' : html`<div class="tiles">${monthTile(s)}${balanceTile(ctx, s)}</div>`}
    ${recent(ctx)}
  </main>`;
}

export const actions = {};
