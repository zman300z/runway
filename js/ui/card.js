// The Card page: what you owe and when it's due, this statement cycle against your cap,
// utilization, the cash back estimate, and recent card activity.
import { html } from './dom.js';
import { icon } from './icons.js';
import { helpButton } from './explain-sheet.js';
import { txRow, cardMap } from './activity.js';
import { cycleBar } from './home.js';
import { openPayCard, openCardReconcile, openStatement, openCashback, openCardForm } from './card-sheets.js';
import { formatMoney, formatWholeMoney } from '../money.js';
import { formatDate } from '../dates.js';
import { categoryMap } from '../categories.js';
import { byNewest } from '../search.js';
import { findCard, cardSummary, rewardsEstimate } from '../cards.js';
import { ratePct, utilizationText } from '../explain.js';

const RECENT = 15;

function navbar() {
  return html`<header class="navbar">
    <button type="button" class="nav-back" data-action="back">${icon('chevronLeft')}<span>Back</span></button>
  </header>`;
}

function statementSub(c) {
  if (!c.closing) return `Your first statement closes ${formatDate(c.cycleEnd, 'medium')}.`;
  if (c.statementDue > 0) return `Due ${formatDate(c.due, 'medium')}${c.card.autopay ? '. Autopay pays it.' : '. Pay it in full to avoid interest.'}`;
  if (c.statement > 0) return 'Paid in full. No interest.';
  return 'Nothing was due on this statement.';
}

function owedCard(c) {
  const credit = c.owed < 0;
  const mismatch = !credit && c.newCharges < 0;
  return html`<section class="card owed-card" aria-labelledby="owed-title">
    <div class="tile-top"><span class="tile-label" id="owed-title">${credit ? 'Credit on this card' : 'Owed on this card'}</span>${helpButton('owed', 'How what you owe is worked out')}</div>
    <p class="owed-big${credit ? ' tone-good' : ''}">${formatMoney(Math.abs(c.owed))}</p>
    <div class="money-row">
      <div class="money-line">
        <span class="tile-label">Statement balance</span>${helpButton('statement', 'How the statement balance works', c.card.id)}
        <strong class="money-mid">${formatMoney(c.statementDue)}</strong>
      </div>
      <p class="tile-sub">${statementSub(c)}</p>
    </div>
    <div class="money-row">
      <div class="money-line">
        <span class="tile-label">New charges${c.closing ? ` since ${formatDate(c.closing, 'short')}` : ''}</span>
        <strong class="money-mid">${formatMoney(Math.max(0, c.newCharges))}</strong>
      </div>
      <p class="tile-sub">On the statement that closes ${formatDate(c.nextClosing, 'medium')}.</p>
    </div>
    ${mismatch ? html`<p class="note note-warn">${icon('alert')}<span>Your statement is ${formatMoney(-c.newCharges)} more than Runway has logged. Do a Card Reconcile to add interest, fees or purchases you forgot.</span></p>` : ''}
    <div class="owed-actions">
      <button type="button" class="btn btn-primary btn-sm" data-action="pay-card" data-card="${c.card.id}">Pay card</button>
      <button type="button" class="btn btn-quiet btn-sm" data-action="card-reconcile" data-card="${c.card.id}">${icon('refresh')}Reconcile</button>
    </div>
  </section>`;
}

function cycleSection(c) {
  let nudge = '';
  if (c.capLevel === 100) {
    nudge = html`<p class="note note-bad">${icon('alert')}<span>${c.overCap ? `${formatMoney(c.overCap)} over your cap this cycle.` : "You've reached your cap this cycle."} Debit is one tap away in Quick Add.</span></p>`;
  } else if (c.capLevel === 80) {
    nudge = html`<p class="note note-warn">${icon('alert')}<span>Over 80% of your cap. ${formatMoney(c.cap - c.cycleSpend)} left until ${formatDate(c.cycleEnd, 'medium')}.</span></p>`;
  }
  return html`<section class="home-section" aria-labelledby="cycle-title">
    <div class="section-head"><h2 id="cycle-title">This statement cycle</h2>${helpButton('cardCycle', 'How the cycle is counted', c.card.id)}</div>
    <div class="card cycle-card">
      ${c.cap
        ? cycleBar(c, { label: `${formatDate(c.cycleStart, 'short')} to ${formatDate(c.cycleEnd, 'short')}`, link: false })
        : html`<p class="cycle-text"><span class="cycle-label">${formatDate(c.cycleStart, 'short')} to ${formatDate(c.cycleEnd, 'short')}</span><span><strong>${formatMoney(c.cycleSpend)}</strong></span></p>
          <p class="muted small">Add a personal monthly cap in Card settings to track it.</p>`}
      ${nudge}
      <div class="money-line util-line">
        <span class="tile-label">Utilization</span>${helpButton('utilization', 'How utilization works', c.card.id)}
        <strong class="money-mid${c.utilizationHigh ? ' tone-warn' : ''}">${utilizationText(c)}</strong>
      </div>
      ${c.utilizationHigh
        ? html`<p class="note note-warn">${icon('alert')}<span>Over 30% of your ${formatWholeMoney(c.card.limit)} limit. Paying part of the card before ${formatDate(c.cycleEnd, 'medium')} lowers what gets reported.</span></p>`
        : html`<p class="muted small">Of your ${formatWholeMoney(c.card.limit)} credit limit, likely reported on ${formatDate(c.cycleEnd, 'medium')}. Under 30% is best.</p>`}
    </div>
  </section>`;
}

function cashbackSection(card, r) {
  if (!r) return '';
  const pct = r.bonus ? Math.min(100, Math.floor((r.bonus.spent * 100) / Math.max(1, r.bonus.cap))) : 0;
  return html`<section class="home-section" aria-labelledby="cb-title">
    <div class="section-head"><h2 id="cb-title">Cash back (estimate)</h2>${helpButton('cashback', 'How the cash back estimate works', card.id)}</div>
    <div class="card cashback-card">
      <p class="cb-total"><strong>${formatMoney(r.total)}</strong> <span class="muted">estimated so far</span></p>
      ${r.bonus
        ? html`<div class="cycle-mini">
            <span class="cycle-text"><span class="cycle-label">${ratePct(r.bonus.rateBp)} bonus this quarter</span><span class="cycle-value"><strong>${formatWholeMoney(r.bonus.spent)}</strong> of ${formatWholeMoney(r.bonus.cap)}</span></span>
            <span class="bar bar-slim" role="progressbar" aria-label="Bonus spending" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span class="fill-good" style="width:${pct}%"></span></span>
          </div>
          <p class="muted small">About ${formatMoney(r.windowEarned)} so far this quarter. The bonus ends ${formatDate(r.bonus.end, 'medium')}.</p>`
        : html`<p class="muted small">No bonus categories cover today. Add this quarter's in Card settings.</p>`}
      ${card.rewards.firstYearMatch
        ? html`<p class="muted small">${r.matchActive ? `First-year match: doubled until ${formatDate(r.anniversary, 'full')}.` : `The first-year match ended ${formatDate(r.anniversary, 'full')}.`}</p>`
        : ''}
      <p class="muted small">An estimate: your categories won't match the card company's exactly.</p>
    </div>
  </section>`;
}

export function render(ctx, params = []) {
  const card = findCard(ctx.data, params[0]);
  if (!card) {
    return html`<main class="screen card-page" id="main">${navbar()}
      <div class="card empty-card"><p class="muted">That card no longer exists.</p></div>
    </main>`;
  }
  const c = cardSummary(ctx.data, card, ctx.today);
  const r = rewardsEstimate(ctx.data, card, ctx.today);
  const cats = categoryMap(ctx.data.categories);
  const cards = cardMap(ctx.data);
  const activity = ctx.data.transactions.filter((t) => t.account === card.id || t.cardId === card.id).sort(byNewest);
  const confirmed = c.closing && Number.isSafeInteger(card.statements?.[c.closing]);
  return html`<main class="screen card-page" id="main">
    ${navbar()}
    <h1 class="large-title">${card.name}</h1>
    ${card.closed ? html`<p class="banner">${icon('info')}<span>This card is closed. It is hidden from Quick Add and Home.</span></p>` : ''}
    ${owedCard(c)}
    ${cycleSection(c)}
    ${cashbackSection(card, r)}

    <ul class="card list-card card-links">
      ${c.closing ? html`<li><button type="button" class="row" data-action="check-statement" data-card="${card.id}" data-closing="${c.closing}">
        <span class="row-icon" style="--tint:#5E5CE6">${icon('card')}</span>
        <span class="row-label">Statement from ${formatDate(c.closing, 'short')}<span class="row-sub">${confirmed ? 'Confirmed from your card app' : "Runway's count. Tap to check it."}</span></span>
        <span class="row-value">${formatMoney(c.statement)}</span>
        ${icon('chevronRight', { cls: 'row-chevron' })}
      </button></li>` : ''}
      <li><button type="button" class="row" data-action="log-cashback" data-card="${card.id}">
        <span class="row-icon" style="--tint:#0CA678">${icon('sparkle')}</span>
        <span class="row-label">Log cash back</span>
        ${icon('chevronRight', { cls: 'row-chevron' })}
      </button></li>
      <li><button type="button" class="row" data-action="edit-card" data-card="${card.id}">
        <span class="row-icon" style="--tint:#8E8E93">${icon('gear')}</span>
        <span class="row-label">Card settings</span>
        ${icon('chevronRight', { cls: 'row-chevron' })}
      </button></li>
    </ul>

    <section class="home-section" aria-labelledby="card-activity-title">
      <div class="section-head"><h2 id="card-activity-title">Card activity</h2></div>
      ${activity.length
        ? html`<ul class="card list-card tx-rows">${activity.slice(0, RECENT).map((t) => txRow(t, cats, { swipe: false, cards, showCard: false }))}</ul>
          ${activity.length > RECENT ? html`<p class="group-foot">Showing the latest ${RECENT}. Everything is in Activity.</p>` : ''}`
        : html`<div class="card empty-card"><p class="muted">Nothing on this card yet. In Quick Add, tap Debit to switch it to this card.</p></div>`}
    </section>
  </main>`;
}

export const actions = {
  'pay-card': (ctx, el) => openPayCard(ctx, el.dataset.card),
  'card-reconcile': (ctx, el) => openCardReconcile(ctx, el.dataset.card),
  'check-statement': (ctx, el) => openStatement(ctx, el.dataset.card, el.dataset.closing),
  'log-cashback': (ctx, el) => openCashback(ctx, el.dataset.card),
  'edit-card': (ctx, el) => openCardForm(ctx, el.dataset.card),
};
