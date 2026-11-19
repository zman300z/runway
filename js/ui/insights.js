// Insights: one budget month at a time. Monthly net for six months, spending by category,
// needs vs wants vs savings against your target, income versus last month, category limits.
import { html } from './dom.js';
import { icon } from './icons.js';
import { helpButton, openExplain } from './explain-sheet.js';
import { safeColor, plural } from './format.js';
import { formatMoney, formatWholeMoney } from '../money.js';
import { periodFor, shiftPeriod, periodLabel, periodShortLabel, formatDate } from '../dates.js';
import { periodTotals, splitSummary, monthlyHistory } from '../budget.js';
import { categoryMap, BUCKET_LABEL } from '../categories.js';
import { netBarsChart, donutChart, foldSlices, percentShares } from '../charts.js';

const BUCKET_ORDER = ['need', 'want', 'savings'];

function currentPeriod(ctx) {
  return periodFor(ctx.today, ctx.data.budget.startDay);
}

/** The month Insights is showing (never in the future). */
function selectedPeriod(ctx) {
  const now = currentPeriod(ctx);
  const saved = ctx.ui.insightsPeriod;
  if (!saved || saved >= now.start) return now;
  const first = earliestDate(ctx.data);
  if (!first || saved < periodFor(first, ctx.data.budget.startDay).start) return now;
  return periodFor(saved, ctx.data.budget.startDay);
}

function earliestDate(data) {
  let min = data.balance?.startDate ?? null;
  for (const t of data.transactions) if (!min || t.date < min) min = t.date;
  return min;
}

/** Six months of net, ending at the current month (or at the selected one, if it's older). */
function netWindow(ctx, selected) {
  const now = currentPeriod(ctx);
  const end = selected.start >= shiftPeriod(now, -5).start ? now : selected;
  return monthlyHistory(ctx.data, end.start, 6).map((m) => ({ ...m, label: periodShortLabel(m.period) }));
}

function netCard(ctx, selected) {
  const months = netWindow(ctx, selected);
  const index = months.findIndex((m) => m.period.start === selected.start);
  const entry = months[index];
  const any = months.some((m) => m.income || m.spent);
  return html`<section class="card insight-card" aria-labelledby="net-title">
    <div class="card-head">
      <h2 id="net-title">Monthly net</h2>
      <button type="button" class="help" data-action="explain-net" aria-label="How monthly net is worked out">?</button>
    </div>
    ${any
      ? html`<p class="card-sub">${entry.net >= 0
          ? html`${icon('trend', { cls: 'tone-good' })}<span>Kept <strong>${formatMoney(entry.net)}</strong> in ${periodLabel(entry.period)}</span>`
          : html`${icon('alert', { cls: 'tone-bad' })}<span>Spent <strong>${formatMoney(-entry.net)}</strong> more than came in</span>`}</p>
        <div class="chart" data-chart="net" role="img" aria-label="Income minus spending for six months. ${months.map((m) => `${m.label} ${formatMoney(m.net)}`).join(', ')}. Tap a bar to open that month."></div>
        <details class="chart-table"><summary>Show as a table</summary><table>
          <thead><tr><th scope="col">Month</th><th scope="col">In</th><th scope="col">Spent</th><th scope="col">Net</th></tr></thead>
          <tbody>${months.map((m) => html`<tr><td>${periodLabel(m.period)}</td><td>${formatWholeMoney(m.income)}</td><td>${formatWholeMoney(m.spent)}</td><td>${formatMoney(m.net)}</td></tr>`)}</tbody>
        </table></details>`
      : html`<p class="muted chart-empty">${icon('chart')}Log a few purchases to see this.</p>`}
  </section>`;
}

function donutCard(ctx, selected, totals) {
  const cats = categoryMap(ctx.data.categories);
  const raw = [...totals.byCategory.entries()].map(([id, value]) => {
    const c = cats.get(id);
    return { id, label: c?.name ?? 'Uncategorized', emoji: c?.emoji ?? '📦', value, color: safeColor(c?.color) };
  });
  const slices = foldSlices(raw, 6);
  const chart = donutChart(slices);
  const shares = percentShares(slices.map((s) => s.value));
  return html`<section class="card insight-card" aria-labelledby="donut-title">
    <div class="card-head"><h2 id="donut-title">Spending by category</h2></div>
    ${chart
      ? html`<div class="donut-wrap">
          <div class="donut-box" data-chart="donut">
            <div class="donut-center"><span class="donut-total">${formatWholeMoney(chart.total)}</span><span class="donut-caption">spent</span></div>
          </div>
        </div>
        <ul class="legend-list">
          ${slices.map((s, i) => html`<li><button type="button" class="legend-row" data-action="open-category" data-id="${s.id}" aria-label="${s.label}: ${formatMoney(s.value)}, ${shares[i]}%. Show these transactions.">
            <i class="swatch-dot" style="--sw:${s.color}" aria-hidden="true"></i>
            <span class="legend-name">${s.emoji ? `${s.emoji} ` : ''}${s.label}${s.folded ? html`<span class="row-sub">${plural(s.folded.length, 'category', 'categories')}</span>` : ''}</span>
            <span class="legend-value">${formatMoney(s.value)}</span>
            <span class="legend-pct">${shares[i]}%</span>
          </button></li>`)}
        </ul>`
      : html`<p class="muted chart-empty">${icon('chart')}Log a few purchases to see this.</p>`}
  </section>`;
}

function segmentBar(label, parts, scale) {
  return html`<div class="seg-row">
    <span class="seg-label">${label}</span>
    <div class="seg-bar" role="img" aria-label="${label}: ${parts.filter((p) => p.value > 0).map((p) => `${p.name} ${p.text}`).join(', ')}">
      ${parts.filter((p) => p.value > 0).map((p) => {
        const pct = (p.value * 100) / scale;
        return html`<span class="seg seg-${p.key}" style="width:${pct.toFixed(2)}%">${pct >= 13 ? html`<b>${p.text}</b>` : ''}</span>`;
      })}
    </div>
  </div>`;
}

function splitCard(ctx, selected, totals) {
  const sp = splitSummary(ctx.data, totals);
  const actual = sp.actual;
  const spentAll = actual.need + actual.want + actual.savings;
  if (!sp.base && !spentAll) {
    return html`<section class="card insight-card"><div class="card-head"><h2>Needs, wants and savings</h2></div>
      <p class="muted chart-empty">${icon('chart')}Log a few purchases to see this.</p></section>`;
  }
  const base = sp.base || spentAll;
  const scale = Math.max(base, spentAll);
  const pctOf = (v) => (base ? Math.round((Math.max(0, v) * 100) / base) : 0);
  const targetParts = BUCKET_ORDER.map((k) => ({ key: k, name: BUCKET_LABEL[k], value: Math.round((base * sp.split[k]) / 100), text: `${sp.split[k]}%` }));
  const actualParts = BUCKET_ORDER.map((k) => ({ key: k, name: BUCKET_LABEL[k], value: Math.max(0, actual[k]), text: `${pctOf(actual[k])}%` }));
  const baseText = sp.baseSource === 'income' ? `of ${formatWholeMoney(base)} income` : sp.baseSource === 'expected' ? `of your usual ${formatWholeMoney(base)} pay` : 'of what you spent';
  return html`<section class="card insight-card" aria-labelledby="split-title">
    <div class="card-head">
      <h2 id="split-title">Needs, wants and savings</h2>
      <button type="button" class="help" data-action="explain-split" aria-label="How the split is worked out">?</button>
    </div>
    <p class="card-sub muted">Shares ${baseText}</p>
    <div class="seg-chart">
      ${segmentBar('Target', targetParts, scale)}
      ${segmentBar('Actual', actualParts, scale)}
    </div>
    <ul class="split-legend">
      ${BUCKET_ORDER.map((k) => html`<li>
        <i class="swatch-dot seg-${k}" aria-hidden="true"></i>
        <span class="legend-name">${BUCKET_LABEL[k] === 'Need' ? 'Needs' : BUCKET_LABEL[k] === 'Want' ? 'Wants' : 'Savings'}</span>
        <span class="legend-value">${formatMoney(actual[k])}</span>
        <span class="legend-pct">${pctOf(actual[k])}% <span class="muted">/ ${sp.split[k]}%</span></span>
      </li>`)}
    </ul>
  </section>`;
}

function incomeCard(ctx, selected, totals) {
  const prev = periodTotals(ctx.data, shiftPeriod(selected, -1));
  const now = totals.income;
  const before = prev.income;
  let delta = '';
  if (before > 0) {
    const pct = Math.round(((now - before) * 100) / before);
    const up = pct >= 0;
    delta = html`<span class="delta ${up ? 'tone-good' : 'tone-bad'}">${icon(up ? 'arrowUp' : 'arrowDown')}${up ? '+' : '−'}${Math.abs(pct)}% vs ${formatDate(shiftPeriod(selected, -1).start, 'monthName')}</span>`;
  } else {
    delta = html`<span class="delta muted">No income logged in ${formatDate(shiftPeriod(selected, -1).start, 'monthName')}</span>`;
  }
  return html`<section class="card insight-card stat" aria-labelledby="income-title">
    <div class="card-head"><h2 id="income-title">Income</h2></div>
    <p class="stat-value">${formatMoney(now)}</p>
    <p class="stat-sub">${delta}</p>
    <p class="muted small">Last month: ${formatMoney(before)}</p>
  </section>`;
}

function limitsCard(ctx, totals) {
  const limited = ctx.data.categories.filter((c) => c.limit > 0 && c.bucket !== 'savings');
  if (!limited.length) return '';
  return html`<section class="card insight-card" aria-labelledby="limits-title">
    <div class="card-head"><h2 id="limits-title">Category limits</h2></div>
    <ul class="limit-list">${limited.map((c) => {
      const spent = Math.max(0, totals.byCategory.get(c.id) ?? 0);
      const pct = Math.floor((spent * 100) / c.limit);
      const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
      const word = pct >= 100 ? 'Over' : pct >= 80 ? 'Close' : 'OK';
      return html`<li>
        <p class="limit-top"><span>${c.emoji} ${c.name}</span><span class="${tone === 'good' ? 'muted' : `tone-${tone}`} strong">${word}, ${pct}%</span></p>
        <div class="bar" aria-hidden="true"><span class="fill-${tone}" style="width:${Math.min(100, pct)}%"></span></div>
        <p class="warn-sub">${formatWholeMoney(spent)} of ${formatWholeMoney(c.limit)}</p>
      </li>`;
    })}</ul>
  </section>`;
}

export function render(ctx) {
  const selected = selectedPeriod(ctx);
  const now = currentPeriod(ctx);
  const first = earliestDate(ctx.data);
  const canBack = first && first < selected.start;
  const totals = periodTotals(ctx.data, selected);
  const markup = html`<main class="screen insights" id="main">
    <h1 class="large-title">Insights</h1>
    <div class="month-switch" role="group" aria-label="Month">
      <button type="button" class="icon-btn" data-action="prev-month" aria-label="Previous month" ${canBack ? '' : 'disabled'}>${icon('chevronLeft')}</button>
      <h2 class="month-label" aria-live="polite">${periodLabel(selected)}</h2>
      <button type="button" class="icon-btn" data-action="next-month" aria-label="Next month" ${selected.start < now.start ? '' : 'disabled'}>${icon('chevronRight')}</button>
    </div>
    ${netCard(ctx, selected)}
    ${donutCard(ctx, selected, totals)}
    ${splitCard(ctx, selected, totals)}
    ${incomeCard(ctx, selected, totals)}
    ${limitsCard(ctx, totals)}
  </main>`;
  return markup;
}

function setPeriod(ctx, start) {
  const now = currentPeriod(ctx);
  ctx.setUI({ insightsPeriod: start >= now.start ? null : start });
  ctx.rerender();
}

export const actions = {
  'prev-month'(ctx) {
    setPeriod(ctx, shiftPeriod(selectedPeriod(ctx), -1).start);
  },
  'next-month'(ctx) {
    setPeriod(ctx, shiftPeriod(selectedPeriod(ctx), 1).start);
  },
  'explain-net'(ctx) {
    const selected = selectedPeriod(ctx);
    const entry = monthlyHistory(ctx.data, selected.start, 1)[0];
    openExplain(ctx, 'net', entry);
  },
  'explain-split'(ctx) {
    const totals = periodTotals(ctx.data, selectedPeriod(ctx));
    openExplain(ctx, 'split', { split: splitSummary(ctx.data, totals) });
  },
  'open-category'(ctx, el) {
    const p = selectedPeriod(ctx);
    const id = el.dataset.id;
    ctx.setUI({
      activity: {
        q: '', kind: null, bucket: null,
        categoryId: id === '__other' ? null : id,
        period: { start: p.start, end: p.end, startDay: p.startDay },
      },
    });
    ctx.navigate('activity');
  },
};

/** Draw the measured charts and wire taps on bars and slices. */
export function mount(root, ctx) {
  const selected = selectedPeriod(ctx);
  // Donut: inject the trusted SVG markup built by charts.js.
  const donutBox = root.querySelector('[data-chart="donut"]');
  if (donutBox) {
    const totals = periodTotals(ctx.data, selected);
    const cats = categoryMap(ctx.data.categories);
    const raw = [...totals.byCategory.entries()].map(([id, value]) => ({ id, label: cats.get(id)?.name ?? 'Uncategorized', value, color: safeColor(cats.get(id)?.color) }));
    const slices = foldSlices(raw, 6);
    const chart = donutChart(slices);
    if (chart) donutBox.insertAdjacentHTML('afterbegin', chart.svg);
    donutBox.querySelector('svg')?.addEventListener('click', (e) => {
      const slice = e.target.closest('.slice');
      if (!slice) return;
      const s = slices[Number(slice.dataset.index)];
      actions['open-category'](ctx, { dataset: { id: s.id } });
    });
  }
  // Net bars: drawn at the card's width; tap a column to open that month.
  const netEl = root.querySelector('[data-chart="net"]');
  if (!netEl) return null;
  const months = netWindow(ctx, selected);
  const index = months.findIndex((m) => m.period.start === selected.start);
  const draw = () => {
    const width = Math.round(netEl.getBoundingClientRect().width);
    if (!width) return;
    netEl.innerHTML = netBarsChart(months, { width, selected: index }).svg;
  };
  draw();
  const onClick = (e) => {
    const hit = e.target.closest('.hit');
    if (!hit) return;
    setPeriod(ctx, months[Number(hit.dataset.index)].period.start);
  };
  netEl.addEventListener('click', onClick);
  return null;
}
