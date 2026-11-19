import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  niceStep, niceDomain, balanceChart, nearestIndex, barPath, netBarsChart, annularPath, foldSlices,
  donutChart, percentShares, ringSVG,
} from '../js/charts.js';
import { balanceSeries } from '../js/budget.js';
import { buildDemoData } from '../js/demo.js';
import { novemberExample, data } from './helpers.js';

test('round tick steps and domains', () => {
  assert.equal(niceStep(100000, 3), 50000);
  assert.equal(niceStep(70000, 3), 25000);
  assert.equal(niceStep(9, 3), 5);
  const d = niceDomain(12345, 98765, 3);
  assert.ok(d.min <= 12345 && d.max >= 98765);
  assert.equal(d.ticks[0], d.min);
  assert.equal(d.ticks.at(-1), d.max);
  const flat = niceDomain(5000, 5000, 3);
  assert.ok(flat.min < 5000 && flat.max > 5000, 'a flat line still gets a band');
  const neg = niceDomain(-20000, 50000, 2);
  assert.ok(neg.ticks.includes(0), 'zero is a tick when the data crosses it');
});

test('balance chart geometry: history, today, projection', () => {
  const series = balanceSeries(novemberExample(), '2026-11-18');
  const chart = balanceChart(series, { width: 326 });
  assert.equal(chart.points.length, 18 + 12);
  assert.equal(chart.todayIndex, 17);
  assert.equal(chart.points[chart.todayIndex].date, '2026-11-18');
  assert.ok(chart.points.every((p, i) => i === 0 || p.x > chart.points[i - 1].x), 'x always moves right');
  assert.ok(chart.points.every((p) => p.y >= chart.plot.top && p.y <= chart.plot.bottom), 'every point inside the plot');
  assert.equal(chart.points.filter((p) => p.projected).length, 12);
  assert.match(chart.svg, /class="line projected"/);
  assert.equal(nearestIndex(chart.points, -50), 0);
  assert.equal(nearestIndex(chart.points, 9999), chart.points.length - 1);
});

test('balance chart works with one day of history and with long histories', () => {
  const one = novemberExample({ balance: { start: 50000, startDate: '2026-11-30' }, transactions: [], recurring: [] });
  assert.equal(balanceChart(balanceSeries(one, '2026-11-30'), { width: 300 }), null, 'a single point is not a chart');
  const demo = buildDemoData('2026-11-19', { now: 1 });
  const chart = balanceChart(balanceSeries(demo, '2026-11-19'), { width: 326 });
  assert.equal(chart.points.filter((p) => !p.projected).length, 30);
  assert.ok(chart.svg.length < 20000);
});

test('bars grow from the baseline with a rounded data end', () => {
  const up = barPath(10, 24, 100, 40);
  assert.match(up, /^M10,100 V44 Q10,40 14,40 H30 Q34,40 34,44 V100 Z$/);
  const down = barPath(10, 24, 100, 160);
  assert.match(down, /^M10,100 V156/);
  const tiny = barPath(0, 24, 100, 98);
  assert.match(tiny, /Q0,98 2,98/, 'the corner radius never exceeds the bar height');
});

test('monthly net bars: green up, red down, the selected one labeled', () => {
  const months = [
    { label: 'Jun', net: 3497 }, { label: 'Jul', net: 49804 }, { label: 'Aug', net: -961 },
    { label: 'Sep', net: 0 }, { label: 'Oct', net: -16474 }, { label: 'Nov', net: -12043 },
  ];
  const chart = netBarsChart(months, { width: 326, selected: 5 });
  assert.equal(chart.bars.length, 6);
  for (const b of chart.bars) {
    assert.ok(b.w <= 24, 'bars are at most 24px wide');
    if (b.net > 0) assert.ok(b.yEnd < b.y0);
    if (b.net < 0) assert.ok(b.yEnd > b.y0);
  }
  assert.equal((chart.svg.match(/class="bar bar-good/g) ?? []).length, 2);
  assert.equal((chart.svg.match(/class="bar bar-bad/g) ?? []).length, 3);
  assert.equal((chart.svg.match(/class="bar-zero"/g) ?? []).length, 1);
  assert.equal((chart.svg.match(/class="bar-value"/g) ?? []).length, 1, 'only the selected bar gets a number');
  assert.equal((chart.svg.match(/class="hit"/g) ?? []).length, 6);
});

test('donut: at most six slices, gaps between them, shares that add to 100', () => {
  const raw = [
    { id: 'a', value: 50000 }, { id: 'b', value: 20000 }, { id: 'c', value: 10000 }, { id: 'd', value: 8000 },
    { id: 'e', value: 6000 }, { id: 'f', value: 3000 }, { id: 'g', value: 2000 }, { id: 'h', value: -500 },
  ].map((s) => ({ ...s, label: s.id, color: '#123456' }));
  const slices = foldSlices(raw, 6);
  assert.equal(slices.length, 6);
  assert.equal(slices.at(-1).id, '__other');
  assert.equal(slices.at(-1).value, 5000);
  assert.deepEqual(slices.at(-1).folded.map((s) => s.id), ['f', 'g']);
  const chart = donutChart(slices);
  assert.equal(chart.total, 99000);
  assert.equal(chart.segments.length, 6);
  assert.equal(percentShares(slices.map((s) => s.value)).reduce((t, v) => t + v, 0), 100);
  assert.deepEqual(percentShares([1, 1, 1]), [34, 33, 33]);
  assert.equal(donutChart([]), null);
  const whole = donutChart([{ id: 'x', value: 1, color: '#123456' }]);
  assert.match(whole.segments[0].d, /Z M/, 'a single slice draws a full ring');
});

test('arc paths and the limit ring', () => {
  assert.match(annularPath(50, 50, 30, 40, 0, Math.PI / 2), /^M90,50 A40,40 0 0 1 50,90 L50,80 A30,30 0 0 0 80,50 Z$/);
  const ring = ringSVG({ spent: 0.5, scheduled: 0.2, tone: 'good', label: '50% used <script>' });
  assert.match(ring, /ring-spent/);
  assert.match(ring, /ring-sched/);
  assert.doesNotMatch(ring, /<script>/, 'labels are escaped');
  assert.doesNotMatch(ringSVG({ spent: 0, label: '' }), /ring-spent/);
  assert.equal(foldSlices([{ id: 'a', value: 0 }]).length, 0);
  assert.ok(data());
});
