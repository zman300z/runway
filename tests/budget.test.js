import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize, balanceOn, periodTotals, goalProgress, limitWarnings, monthlyHistory, balanceSeries, spendOf,
} from '../js/budget.js';
import { periodFor } from '../js/dates.js';
import { postDueCharges } from '../js/recurring.js';
import { novemberExample, expense, refund, bill, idMaker } from './helpers.js';

const TODAY = '2026-11-18'; // Wednesday. Next payday is Sat, Nov 21.

test('the worked example, by hand', () => {
  const s = summarize(novemberExample(), TODAY);
  // Spent: rent 600 + groceries 80 + coffee 5 + eating out 25 - refund 10 = $700. Savings ($50) is not spending.
  assert.equal(s.spent, 70000);
  assert.equal(s.totals.savings, 5000);
  // Still scheduled this month: Spotify 11.99 + phone 45 = $56.99 (auto-save to savings is not spending).
  assert.equal(s.scheduledSpend, 5699);
  assert.equal(s.scheduledAll, 8199);
  // Left this month: 1,200 - 700 - 56.99 = $443.01, over 13 days (counting today) = $34.07 a day, rounded down.
  assert.equal(s.daysLeft, 13);
  assert.equal(s.budgetMonth, 44301);
  assert.equal(s.budgetDaily, 3407);
  // Balance: 1,000 - 600 - 80 - 5 - 25 + 10 - 50 + 500 = $750. No bills before Saturday's payday.
  assert.equal(s.balance, 75000);
  assert.equal(s.payday, '2026-11-21');
  assert.equal(s.billsBeforeHorizon, 0);
  assert.equal(s.cash, 75000);
  assert.equal(s.cashDays, 3);
  assert.equal(s.cashDaily, 25000);
  // The safer of the two views wins, and here the budget is lower.
  assert.equal(s.mode, 'both');
  assert.equal(s.month, 44301);
  assert.equal(s.daily, 3407);
  assert.equal(s.monthGuarded, false);
  assert.equal(s.dailyGuarded, false);
  assert.equal(s.usedPct, 58);
});

test('pace leaves out fixed bills', () => {
  const s = summarize(novemberExample(), TODAY);
  // Bills this month: rent 600 + Spotify 11.99 + phone 45. Everyday budget: 1,200 - 656.99 = $543.01.
  // After 18 of 30 days, an even pace is $325.80. Everyday spending is $100, so: on track.
  assert.equal(s.pace.billsThisMonth, 65699);
  assert.equal(s.pace.everydayBudget, 54301);
  assert.equal(s.pace.expected, 32580);
  assert.equal(s.pace.everydaySpent, 10000);
  assert.equal(s.pace.status, 'ontrack');

  const ahead = novemberExample();
  ahead.transactions.push(expense('2026-11-15', 30000, 'shopping'));
  const a = summarize(ahead, TODAY);
  assert.equal(a.pace.everydaySpent, 40000);
  assert.equal(a.pace.status, 'ahead');
  assert.equal(a.pace.gap, 7420);
  assert.equal(a.budgetMonth, 14301);
});

test('over limit: spent plus scheduled bills is more than the limit', () => {
  const d = novemberExample();
  d.budget = { ...d.budget, limit: 70000 };
  const s = summarize(d, TODAY);
  assert.equal(s.budgetMonth, -5699);
  assert.equal(s.budgetDaily, 0);
  assert.equal(s.daily, 0, 'never below zero');
  assert.equal(s.month, -5699, 'the month number shows how far over');
  assert.equal(s.pace.status, 'over');
});

test('balance guard: when cash is lower, the lower number wins', () => {
  const d = novemberExample({ balance: { start: 30000, startDate: '2026-11-01' } });
  d.recurring.push(bill({ id: 'electric', name: 'Electric', amount: 3000, categoryId: 'bills', anchor: '2026-11-20', next: '2026-11-20' }));
  const s = summarize(d, TODAY);
  assert.equal(s.balance, 5000);
  assert.equal(s.billsBeforeHorizon, 3000);
  assert.equal(s.cash, 2000);
  assert.equal(s.cashDaily, 666); // $20 over 3 days, rounded down
  assert.equal(s.budgetMonth, 41301);
  assert.equal(s.budgetDaily, 3177);
  assert.equal(s.daily, 666);
  assert.equal(s.month, 2000);
  assert.equal(s.monthGuarded, true);
  assert.equal(s.dailyGuarded, true);
});

test('negative balance: never suggests spending money you do not have', () => {
  const s = summarize(novemberExample({ balance: { start: 10000, startDate: '2026-11-01' } }), TODAY);
  assert.equal(s.balance, -15000);
  assert.equal(s.cash, -15000);
  assert.equal(s.cashDaily, 0);
  assert.equal(s.daily, 0);
  assert.equal(s.month, -15000);
});

test('last day of the month, with rent due right after payday rolls over', () => {
  const { data } = postDueCharges(novemberExample(), '2026-11-30', { makeId: idMaker(), now: 1 });
  const s = summarize(data, '2026-11-30');
  assert.equal(s.daysLeft, 1);
  assert.equal(s.spent, 75699); // Spotify and phone have posted
  assert.equal(s.budgetMonth, 44301);
  assert.equal(s.budgetDaily, 44301);
  assert.equal(s.balance, 66801);
  // Next payday is Sat, Dec 5. Rent ($600) is due Dec 1, before it.
  assert.equal(s.payday, '2026-12-05');
  assert.equal(s.billsBeforeHorizon, 60000);
  assert.equal(s.cash, 6801);
  assert.equal(s.cashDays, 5);
  assert.equal(s.cashDaily, 1360);
  assert.equal(s.daily, 1360);
  assert.equal(s.month, 6801);
});

test('without a pay schedule the cash view runs to the end of the month', () => {
  const s = summarize(novemberExample({ pay: null }), TODAY);
  assert.equal(s.payday, null);
  assert.equal(s.horizon, '2026-12-01');
  assert.equal(s.billsBeforeHorizon, 8199); // every bill left this month, savings included
  assert.equal(s.cash, 66801);
  assert.equal(s.cashDays, 13);
  assert.equal(s.cashDaily, 5138);
  assert.equal(s.daily, 3407);
});

test('missing limit, missing balance, or nothing set', () => {
  const noLimit = novemberExample();
  noLimit.budget = { ...noLimit.budget, limit: null };
  const a = summarize(noLimit, TODAY);
  assert.equal(a.mode, 'cash');
  assert.equal(a.month, 75000);
  assert.equal(a.daily, 25000);
  assert.equal(a.pace, null);
  assert.equal(a.usedPct, null);

  const b = summarize(novemberExample({ balance: null }), TODAY);
  assert.equal(b.mode, 'budget');
  assert.equal(b.balance, null);
  assert.equal(b.month, 44301);
  assert.equal(b.daily, 3407);

  const none = novemberExample({ balance: null });
  none.budget = { ...none.budget, limit: null };
  const c = summarize(none, TODAY);
  assert.equal(c.mode, 'none');
  assert.equal(c.month, null);
  assert.equal(c.daily, null);
});

test('future-dated purchases count as spent and come out of cash, not today\'s balance', () => {
  const d = novemberExample();
  d.transactions.push(expense('2026-11-20', 1000, 'shopping'));
  const s = summarize(d, TODAY);
  assert.equal(s.spent, 71000);
  assert.equal(s.balance, 75000);
  assert.equal(s.futureOutflows, 1000);
  assert.equal(s.cash, 74000);
  assert.equal(s.budgetDaily, 3330);
  assert.equal(s.daily, 3330);
});

test('the starting balance already includes earlier transactions', () => {
  const d = novemberExample({ balance: { start: 100000, startDate: '2026-11-10' } });
  // Only Nov 10 onward changes the balance: coffee 5, eating out 25, refund 10, savings 50.
  assert.equal(balanceOn(d, TODAY), 93000);
  assert.equal(summarize(d, TODAY).spent, 70000, 'rent on Nov 1 still counts toward November spending');
});

test('refunds subtract from spending; savings and adjustments are not spending', () => {
  assert.equal(spendOf(expense(TODAY, 500, 'coffee')), 500);
  assert.equal(spendOf(refund(TODAY, 500, 'coffee')), -500);
  const t = periodTotals(novemberExample(), periodFor(TODAY));
  assert.equal(t.byCategory.get('eating-out'), 1500);
  assert.equal(t.want, 2000);
  assert.equal(t.need, 68000);
  assert.equal(t.billsPosted, 60000);
  assert.equal(t.income, 50000);
  assert.equal(t.outflow, 75000);
});

test('a purchase flipped to Need counts as a need', () => {
  const d = novemberExample();
  d.transactions.push(expense('2026-11-16', 1200, 'eating-out', { bucket: 'need' }));
  const t = periodTotals(d, periodFor(TODAY));
  assert.equal(t.need, 69200);
  assert.equal(t.want, 2000);
});

test('projected left over and income versus last month', () => {
  const s = summarize(novemberExample(), TODAY);
  // Income 500 - (all spending incl. savings 750 + all scheduled 81.99) = -$331.99
  assert.equal(s.leftover, -33199);
  assert.equal(s.income, 50000);
  assert.equal(s.prevIncome, 0);
});

test('savings goal progress', () => {
  const d = novemberExample({ goal: { name: 'Trip', target: 20000, saved: 3000, since: '2026-11-01' } });
  assert.deepEqual(goalProgress(d), {
    name: 'Trip', target: 20000, startSaved: 3000, transfers: 5000, saved: 8000, pct: 40, since: '2026-11-01',
    remaining: 12000, done: false,
  });
  d.transactions.push(refund('2026-11-16', 2000, 'savings')); // moved money back out
  assert.equal(goalProgress(d).saved, 6000);
  assert.equal(goalProgress(novemberExample()), null);
});

test('warnings at 80% and 100% of the monthly and category limits', () => {
  const d = novemberExample();
  const t = periodTotals(d, periodFor(TODAY));
  assert.deepEqual(limitWarnings(d, t), []);

  d.categories = d.categories.map((c) => (c.id === 'eating-out' ? { ...c, limit: 1800 } : c));
  assert.deepEqual(limitWarnings(d, t).map((w) => [w.key, w.level]), [['cat:eating-out', 80]]);
  d.categories = d.categories.map((c) => (c.id === 'eating-out' ? { ...c, limit: 1500 } : c));
  assert.deepEqual(limitWarnings(d, t).map((w) => [w.key, w.level]), [['cat:eating-out', 100]]);

  d.budget = { ...d.budget, limit: 85000 };
  assert.equal(limitWarnings(d, t)[0].level, 80);
  d.budget = { ...d.budget, limit: 70000 };
  assert.equal(limitWarnings(d, t)[0].level, 100);
  assert.equal(limitWarnings(d, t)[0].over, 0);
});

test('needs, wants and savings against the target split', () => {
  const s = summarize(novemberExample(), TODAY);
  assert.equal(s.split.baseSource, 'income');
  assert.deepEqual(s.split.target, { need: 25000, want: 15000, savings: 10000 });
  assert.deepEqual(s.split.actual, { need: 68000, want: 2000, savings: 5000 });

  const noIncome = novemberExample();
  noIncome.transactions = noIncome.transactions.filter((t) => t.type !== 'income');
  const n = summarize(noIncome, TODAY);
  assert.equal(n.split.baseSource, 'expected');
  assert.equal(n.split.base, 108333); // $500 every 2 weeks is about $1,083.33 a month
});

test('monthly net history', () => {
  const h = monthlyHistory(novemberExample(), TODAY, 6);
  assert.equal(h.length, 6);
  assert.equal(h[0].period.start, '2026-06-01');
  assert.deepEqual([h[5].income, h[5].spent, h[5].net, h[5].current], [50000, 70000, -20000, true]);
  assert.equal(h[4].net, 0);
});

test('balance chart: history since the starting balance, projection to month end', () => {
  const series = balanceSeries(novemberExample(), TODAY);
  assert.equal(series.history.length, 18);
  assert.deepEqual(series.history[0], { date: '2026-11-01', balance: 40000 });
  assert.deepEqual(series.history.at(-1), { date: TODAY, balance: 75000 });
  assert.equal(series.projection.length, 13);
  const at = (date) => series.projection.find((p) => p.date === date).balance;
  assert.equal(at('2026-11-20'), 75000);
  assert.equal(at('2026-11-21'), 125000); // expected paycheck
  assert.equal(at('2026-11-22'), 123801); // Spotify
  assert.equal(at('2026-11-30'), 116801);
  assert.deepEqual(series.events.map((e) => [e.date, e.kind]), [
    ['2026-11-21', 'pay'], ['2026-11-22', 'bill'], ['2026-11-25', 'bill'], ['2026-11-28', 'bill'],
  ]);
  assert.equal(balanceSeries(novemberExample({ balance: null }), TODAY), null);
  assert.equal(balanceSeries(novemberExample(), '2026-11-30').projection.length, 0, 'nothing to project on the last day');
});

test('cash view waits for the real first payday, and the chart adds no early paycheck', () => {
  const d = novemberExample({
    balance: { start: 30000, startDate: '2026-11-19' },
    pay: { amount: 50000, frequency: 'biweekly', anchor: '2026-12-10', days: null, handledThrough: '2026-11-18' },
    transactions: [],
  });
  const s = summarize(d, '2026-11-19');
  assert.equal(s.payday, '2026-12-10');
  assert.equal(s.cashDays, 21);
  // Spotify (Nov 22), auto-save (Nov 25), phone (Nov 28) and rent (Dec 1) all fall before Dec 10.
  assert.equal(s.billsBeforeHorizon, 1199 + 2500 + 4500 + 60000);
  const series = balanceSeries(d, '2026-11-19');
  assert.equal(series.events.filter((e) => e.kind === 'pay').length, 0);
});

test('a starting balance dated in the future has no history yet (and never crashes the chart)', () => {
  const d = novemberExample({ balance: { start: 50000, startDate: '2026-11-25' } });
  const series = balanceSeries(d, '2026-11-19');
  assert.equal(series.history.length, 0);
});
