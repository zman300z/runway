// The Balance card on Home: last 30 days, a dashed projection to month end, and finger scrubbing.
// The readout sits above the chart (like the Stocks app) so your finger never covers the number.
import { html } from './dom.js';
import { icon } from './icons.js';
import { balanceSeries } from '../budget.js';
import { balanceChart, nearestIndex } from '../charts.js';
import { formatMoney } from '../money.js';
import { formatDate, relativeDay } from '../dates.js';

function readout(point, today) {
  const when = point.date === today ? 'Today' : relativeDay(point.date, today);
  return { value: formatMoney(point.balance), date: point.projected ? `${when}, projected` : when };
}

export function balanceCard(ctx) {
  const series = balanceSeries(ctx.data, ctx.today);
  if (!series) {
    return html`<section class="home-section" aria-labelledby="bal-title">
      <div class="section-head"><h2 id="bal-title">Balance over time</h2></div>
      <div class="card empty-card"><p class="muted">Add your balance to see where it's heading.</p>
        <button type="button" class="btn btn-quiet btn-sm" data-action="reconcile">Add balance</button></div>
    </section>`;
  }
  if (!series.history.length) {
    return html`<section class="home-section" aria-labelledby="bal-title">
      <div class="section-head"><h2 id="bal-title">Balance over time</h2></div>
      <div class="card empty-card"><p class="muted">Your balance tracking starts on ${formatDate(ctx.data.balance.startDate, 'medium')}.</p></div>
    </section>`;
  }
  const points = [...series.history, ...series.projection.slice(1)];
  const enough = points.length >= 2 && ctx.data.transactions.length + ctx.data.recurring.length > 0;
  const today = series.history[series.history.length - 1];
  const end = series.projection[series.projection.length - 1];
  const summary = end
    ? `Balance ${formatMoney(series.history[0].balance)} on ${formatDate(series.history[0].date, 'short')}, ${formatMoney(today.balance)} today, projected ${formatMoney(end.balance)} on ${formatDate(end.date, 'short')}.`
    : `Balance ${formatMoney(series.history[0].balance)} on ${formatDate(series.history[0].date, 'short')} and ${formatMoney(today.balance)} today.`;
  return html`<section class="home-section" aria-labelledby="bal-title">
    <div class="section-head"><h2 id="bal-title">Balance over time</h2></div>
    <div class="card chart-card">
      ${enough
        ? html`
          <div class="readout" aria-live="polite">
            <span class="readout-value">${formatMoney(today.balance)}</span>
            <span class="readout-date">Today</span>
          </div>
          <div class="chart" data-chart="balance" tabindex="0" role="img" aria-label="${summary} Drag across the chart, or use the arrow keys, to see any day."></div>
          <div class="legend" aria-hidden="true">
            <span class="legend-key"><i class="key-line"></i>Balance</span>
            <span class="legend-key"><i class="key-line dashed"></i>Projected with bills and expected pay</span>
          </div>
          <details class="chart-table">
            <summary>Show as a table</summary>
            <table>
              <thead><tr><th scope="col">Day</th><th scope="col">Balance</th></tr></thead>
              <tbody>${points.map((p, i) => html`<tr><td>${formatDate(p.date, 'medium')}${i >= series.history.length ? ' (projected)' : ''}</td><td>${formatMoney(p.balance)}</td></tr>`)}</tbody>
            </table>
          </details>`
        : html`<p class="muted chart-empty">${icon('chart')}Log a few purchases to see this.</p>`}
    </div>
  </section>`;
}

/** Draw the chart at the card's real width and wire scrubbing. Returns a cleanup function. */
export function mountBalanceChart(root, ctx) {
  const el = root.querySelector('[data-chart="balance"]');
  if (!el) return null;
  const series = balanceSeries(ctx.data, ctx.today);
  const card = el.closest('.chart-card');
  const valueEl = card.querySelector('.readout-value');
  const dateEl = card.querySelector('.readout-date');
  let chart = null;
  let index = null;

  const draw = () => {
    const width = Math.round(el.getBoundingClientRect().width);
    if (!width) return;
    chart = balanceChart(series, { width });
    if (!chart) return;
    el.innerHTML = chart.svg;
    index = null;
    show(null);
  };

  function show(i) {
    if (!chart) return;
    const scrub = el.querySelector('.scrub');
    const point = chart.points[i ?? chart.todayIndex];
    const r = readout(point, ctx.today);
    valueEl.textContent = r.value;
    dateEl.textContent = r.date;
    card.classList.toggle('is-projected', point.projected);
    if (i === null) {
      scrub.setAttribute('visibility', 'hidden');
      return;
    }
    scrub.setAttribute('visibility', 'visible');
    const rule = scrub.querySelector('.scrub-rule');
    rule.setAttribute('x1', point.x);
    rule.setAttribute('x2', point.x);
    const dot = scrub.querySelector('.scrub-dot');
    dot.setAttribute('cx', point.x);
    dot.setAttribute('cy', point.y);
  }

  const pick = (e) => {
    const box = el.getBoundingClientRect();
    index = nearestIndex(chart.points, e.clientX - box.left);
    show(index);
  };
  let active = false;
  const onDown = (e) => {
    if (!chart) return;
    active = true;
    pick(e);
  };
  const onMove = (e) => {
    if (!chart || (!active && e.pointerType !== 'mouse')) return;
    pick(e);
  };
  const onEnd = () => {
    active = false;
    index = null;
    show(null);
  };
  const onKey = (e) => {
    if (!chart) return;
    const last = chart.points.length - 1;
    const cur = index ?? chart.todayIndex;
    let next = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(last, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') next = null;
    else return;
    e.preventDefault();
    index = next;
    show(next);
  };

  draw();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onEnd);
  el.addEventListener('pointercancel', onEnd);
  el.addEventListener('pointerleave', onEnd);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onEnd);
  const ro = new ResizeObserver(() => {
    if (chart && Math.round(el.getBoundingClientRect().width) !== chart.plot.right + 54) draw();
  });
  ro.observe(el);
  return () => ro.disconnect();
}
