import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions, groupByDay, kindOf } from '../js/search.js';
import { novemberExample, expense, refund, income } from './helpers.js';

test('search matches notes, category names and income sources', () => {
  const d = novemberExample();
  d.transactions.push(expense('2026-11-16', 1299, 'eating-out', { note: 'Pho with Sam' }));
  assert.deepEqual(filterTransactions(d, { q: 'pho' }).map((t) => t.note), ['Pho with Sam']);
  assert.equal(filterTransactions(d, { q: 'GROCER' }).length, 1, 'category names, any case');
  assert.equal(filterTransactions(d, { q: 'paycheck' }).length, 1, 'income source names');
  assert.equal(filterTransactions(d, { q: '   ' }).length, 8, 'blank search shows everything');
});

test('filters by category, type, need or want, and month', () => {
  const d = novemberExample();
  assert.equal(filterTransactions(d, { categoryId: 'eating-out' }).length, 2);
  assert.equal(filterTransactions(d, { kind: 'refund' }).length, 1);
  assert.equal(filterTransactions(d, { kind: 'income' }).length, 1);
  assert.equal(filterTransactions(d, { kind: 'expense' }).length, 5);
  assert.equal(filterTransactions(d, { bucket: 'need' }).length, 2);
  assert.equal(filterTransactions(d, { bucket: 'savings' }).length, 1);
  assert.equal(filterTransactions(d, { from: '2026-11-10', to: '2026-11-13' }).length, 3);
  assert.equal(kindOf(refund('2026-11-01', 5, 'coffee')), 'refund');
});

test('newest first, grouped by day with honest totals', () => {
  const d = novemberExample();
  d.transactions.push(expense('2026-11-13', 400, 'coffee'));
  const list = filterTransactions(d);
  assert.equal(list[0].date, '2026-11-14');
  const groups = groupByDay(list, d.categories);
  const nov13 = groups.find((g) => g.date === '2026-11-13');
  // A $4 coffee and a $10 refund on the same day: $4 spent, $10 back (never "-$6 spent").
  assert.equal(nov13.spent, 400);
  assert.equal(nov13.back, 1000);
  const nov14 = groups.find((g) => g.date === '2026-11-14');
  assert.deepEqual([nov14.spent, nov14.saved], [0, 5000]);
  const nov7 = groups.find((g) => g.date === '2026-11-07');
  assert.equal(nov7.back, 50000);
  assert.ok(groups.every((g, i) => i === 0 || groups[i - 1].date > g.date));
  assert.equal(income('2026-11-01', 1).type, 'income');
});
