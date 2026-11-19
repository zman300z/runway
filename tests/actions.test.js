import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransaction, updateTransaction, deleteTransaction, restoreTransaction, makeTransaction, reconcile,
  setBalance, setPay, confirmPayday, markPaydayHandled, addBill, updateBill, setBillActive, deleteBill,
  addCategory, updateCategory, moveCategory, deleteCategory, setBudget, setGoal, runDailyJobs,
} from '../js/actions.js';
import { balanceOn, summarize } from '../js/budget.js';
import { pendingPaydays } from '../js/pay.js';
import { novemberExample, data, bill, idMaker } from './helpers.js';

const TODAY = '2026-11-18';

test('add, edit, delete and undo a transaction', () => {
  const start = novemberExample();
  const { data: added, tx } = addTransaction(start, { type: 'expense', amount: -450, categoryId: 'coffee', date: TODAY, note: '  Oat   latte ' }, { id: 'new', now: 10 });
  assert.equal(added.transactions.length, 8);
  assert.deepEqual(tx, { id: 'new', type: 'expense', amount: -450, categoryId: 'coffee', bucket: null, source: null, note: 'Oat latte', date: TODAY, createdAt: 10, updatedAt: 10 });
  assert.equal(start.transactions.length, 7, 'the input is never changed');

  const { data: edited, tx: changed } = updateTransaction(added, 'new', { amount: -525, bucket: 'need' }, { now: 20 });
  assert.equal(changed.amount, -525);
  assert.equal(changed.bucket, 'need');
  assert.equal(changed.createdAt, 10);
  assert.equal(changed.updatedAt, 20);

  const { data: removed, removed: info } = deleteTransaction(edited, 'new');
  assert.equal(removed.transactions.length, 7);
  const undone = restoreTransaction(removed, info);
  assert.deepEqual(undone.transactions, edited.transactions);
  assert.equal(restoreTransaction(undone, info), undone, 'undo twice does nothing');
  assert.equal(deleteTransaction(edited, 'missing').removed, null);
});

test('transactions are validated with friendly messages', () => {
  const ok = { type: 'expense', amount: -100, categoryId: 'coffee', date: TODAY };
  assert.throws(() => makeTransaction({ ...ok, amount: 0 }), /Enter an amount/);
  assert.throws(() => makeTransaction({ ...ok, amount: 1.5 }), /Enter an amount/);
  assert.throws(() => makeTransaction({ ...ok, amount: -100000001 }), /Enter an amount/);
  assert.throws(() => makeTransaction({ ...ok, date: '2026-02-30' }), /Pick a date/);
  assert.throws(() => makeTransaction({ ...ok, categoryId: null }), /Pick a category/);
  assert.throws(() => makeTransaction({ ...ok, type: 'income', amount: -5 }), /more than \$0/);
  assert.equal(makeTransaction({ type: 'income', amount: 5000, date: TODAY, source: 'nope' }).source, 'other');
  assert.equal(makeTransaction({ ...ok, note: 'x'.repeat(500) }).note.length, 140);
});

test('reconcile adds an adjustment for the difference, and only that', () => {
  const d = novemberExample();
  assert.equal(balanceOn(d, TODAY), 75000);
  const { data: after, diff, tx } = reconcile(d, 74012, TODAY, { id: 'adj', now: 1 });
  assert.equal(diff, -988);
  assert.equal(tx.type, 'adjustment');
  assert.equal(tx.amount, -988);
  assert.equal(balanceOn(after, TODAY), 74012);
  assert.equal(summarize(after, TODAY).spent, 70000, 'adjustments are not spending');

  const same = reconcile(after, 74012, TODAY);
  assert.equal(same.diff, 0);
  assert.equal(same.data, after);

  const fresh = reconcile(data(), 12345, TODAY);
  assert.deepEqual(fresh.data.balance, { start: 12345, startDate: TODAY });
  assert.equal(reconcile(d, -2500, TODAY, { id: 'neg' }).diff, -77500, 'negative bank balances work');
});

test('starting balance', () => {
  assert.deepEqual(setBalance(data(), 50000, TODAY).balance, { start: 50000, startDate: TODAY });
  assert.equal(setBalance(data(), null).balance, null);
  assert.throws(() => setBalance(data(), 1.5, TODAY), /Enter your balance/);
});

test('pay schedule, confirming and skipping paydays', () => {
  const d = setPay(data(), { amount: 52000, frequency: 'biweekly', anchor: '2026-11-21' }, TODAY);
  assert.deepEqual(d.pay, { amount: 52000, frequency: 'biweekly', anchor: '2026-11-21', days: null, handledThrough: '2026-11-17' });
  assert.deepEqual(pendingPaydays(d.pay, '2026-11-21'), ['2026-11-21']);

  const { data: paid, tx } = confirmPayday(d, '2026-11-21', 49875, { id: 'pay', now: 1 });
  assert.equal(tx.type, 'income');
  assert.equal(tx.source, 'paycheck');
  assert.equal(tx.amount, 49875);
  assert.equal(paid.pay.handledThrough, '2026-11-21');
  assert.deepEqual(pendingPaydays(paid.pay, '2026-11-21'), []);
  assert.equal(markPaydayHandled(paid, '2026-11-07').pay.handledThrough, '2026-11-21', 'never moves backward');

  const semi = setPay(data(), { amount: 60000, frequency: 'semimonthly', days: [31, 15] }, TODAY);
  assert.deepEqual(semi.pay.days, [15, 31]);
  assert.equal(semi.pay.anchor, TODAY);
  assert.throws(() => setPay(data(), { amount: 60000, frequency: 'semimonthly', days: [15, 15] }, TODAY), /two different/);
  assert.throws(() => setPay(data(), { amount: 0, frequency: 'weekly', anchor: TODAY }, TODAY), /usual paycheck/);
  // Editing the schedule never brings back old banners.
  const old = { ...d, pay: { ...d.pay, handledThrough: '2026-11-21' } };
  assert.equal(setPay(old, { amount: 1, frequency: 'weekly', anchor: TODAY }, TODAY).pay.handledThrough, '2026-11-21');
});

test('bills: add, edit, pause, resume and delete', () => {
  const ids = idMaker('b');
  const { data: d1, bill: b } = addBill(data(), { name: 'Netflix', amount: 1549, categoryId: 'subscriptions', cadence: 'monthly', next: '2026-11-25' }, { id: ids(), now: 1 });
  assert.equal(b.anchor, '2026-11-25');
  assert.throws(() => addBill(data(), { name: ' ', amount: 1, categoryId: 'x', cadence: 'monthly', next: TODAY }), /name/);
  assert.throws(() => addBill(data(), { name: 'A', amount: 0, categoryId: 'x', cadence: 'monthly', next: TODAY }), /amount/);

  const d2 = updateBill(d1, b.id, { amount: 1799 });
  assert.equal(d2.recurring[0].amount, 1799);
  assert.equal(d2.recurring[0].anchor, '2026-11-25');

  const paused = setBillActive(d2, b.id, false, TODAY);
  assert.equal(paused.recurring[0].active, false);
  const resumed = setBillActive(paused, b.id, true, '2026-12-01');
  assert.equal(resumed.recurring[0].next, '2026-12-25');
  assert.equal(deleteBill(resumed, b.id).recurring.length, 0);
});

test('categories: add, rename, reorder, and delete with a move', () => {
  const { data: d1, category } = addCategory(data(), { name: 'Gym', emoji: '🏋️', color: '#123456', bucket: 'want', limit: null }, { id: 'gym' });
  assert.equal(d1.categories.at(-1).id, 'gym');
  assert.equal(category.name, 'Gym');
  assert.throws(() => addCategory(data(), { name: '', bucket: 'want' }), /name/);
  assert.throws(() => addCategory(data(), { name: 'X', bucket: 'maybe' }), /Need, Want or Savings/);

  const d2 = updateCategory(d1, 'gym', { name: 'Fitness', bucket: 'need', limit: 3000 });
  assert.deepEqual(d2.categories.at(-1), { id: 'gym', name: 'Fitness', emoji: '🏋️', color: '#123456', bucket: 'need', limit: 3000 });

  const d3 = moveCategory(d2, 'gym', 0);
  assert.equal(d3.categories[0].id, 'gym');
  assert.equal(d3.categories.length, 15);

  const withCoffee = novemberExample();
  assert.throws(() => deleteCategory(withCoffee, 'coffee'), /Pick a category to move/);
  const moved = deleteCategory(withCoffee, 'coffee', 'eating-out');
  assert.equal(moved.categories.some((c) => c.id === 'coffee'), false);
  assert.equal(moved.transactions.filter((t) => t.categoryId === 'eating-out').length, 3);
  const bills = novemberExample();
  const movedBills = deleteCategory(bills, 'phone', 'bills');
  assert.equal(movedBills.recurring.find((r) => r.id === 'phone').categoryId, 'bills');
  const unused = deleteCategory(novemberExample(), 'gifts');
  assert.equal(unused.categories.length, 13);
});

test('budget settings and the savings goal', () => {
  const d = setBudget(data(), { limit: 90000, startDay: 15, split: { need: 60, want: 25, savings: 15 } });
  assert.deepEqual(d.budget, { limit: 90000, startDay: 15, split: { need: 60, want: 25, savings: 15 } });
  assert.throws(() => setBudget(data(), { split: { need: 60, want: 30, savings: 20 } }), /add up to 100/);
  assert.throws(() => setBudget(data(), { limit: -5 }), /monthly limit/);
  assert.equal(setBudget(d, { limit: null }).budget.limit, null);

  const g = setGoal(data(), { name: 'Spring break', target: 60000, saved: 5000 }, TODAY);
  assert.deepEqual(g.goal, { name: 'Spring break', target: 60000, saved: 5000, since: TODAY });
  assert.equal(setGoal(g, { name: 'Trip', target: 70000 }, '2026-12-01').goal.since, TODAY, 'editing keeps the start date');
  assert.throws(() => setGoal(data(), { name: 'Trip', target: 0 }, TODAY), /target/);
  assert.equal(setGoal(g, null).goal, null);
});

test('daily jobs post due bills and remember the day', () => {
  const d = data({ recurring: [bill({ anchor: '2026-11-10', next: '2026-11-10' })] });
  const { data: after, added } = runDailyJobs(d, TODAY, { makeId: idMaker(), now: 1 });
  assert.equal(added.length, 1);
  assert.equal(after.meta.lastOpened, TODAY);
  const again = runDailyJobs(after, TODAY, { makeId: idMaker(), now: 2 });
  assert.equal(again.added.length, 0);
  assert.equal(again.data, after);
});
