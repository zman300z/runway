import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoData } from '../js/demo.js';
import { summarize } from '../js/budget.js';
import { validate } from '../js/store.js';
import { postDueCharges } from '../js/recurring.js';
import { formatMoney } from '../js/money.js';

const TODAY = '2026-11-19'; // Thursday

test('demo data is valid and the same every time for a given day', () => {
  const a = buildDemoData(TODAY, { now: 1 });
  const b = buildDemoData(TODAY, { now: 1 });
  assert.deepEqual(a, b);
  assert.deepEqual(validate(a), []);
  assert.ok(a.transactions.length > 150, 'about six months of history');
  assert.ok(a.recurring.some((r) => !r.active), 'one paused subscription');
  assert.ok(a.transactions.some((t) => t.type === 'expense' && t.amount > 0), 'includes a refund');
  // Bills are fully caught up, so opening the app posts nothing new.
  assert.equal(postDueCharges(a, TODAY, { now: 2 }).added.length, 0);
});

test('safe-to-spend on demo data matches a hand calculation', (t) => {
  const d = buildDemoData(TODAY, { now: 1 });
  const s = summarize(d, TODAY);

  // Independent hand calculation with plain loops (no budget.js helpers).
  const bucketOf = Object.fromEntries(d.categories.map((c) => [c.id, c.bucket]));
  const inNovember = (date) => date >= '2026-11-01' && date <= '2026-11-30';
  let spent = 0;
  for (const tx of d.transactions) {
    if (tx.type === 'expense' && inNovember(tx.date) && bucketOf[tx.categoryId] !== 'savings') spent -= tx.amount;
  }
  // Monthly bills whose day falls after today (the 19th) and by the 30th, active and not savings.
  let scheduled = 0;
  for (const b of d.recurring) {
    const day = Number(b.anchor.slice(8));
    if (b.active && b.cadence === 'monthly' && day > 19 && day <= 30 && bucketOf[b.categoryId] !== 'savings') scheduled += b.amount;
  }
  const limit = d.budget.limit;
  const daysLeft = 30 - 19 + 1;
  const leftThisMonth = limit - spent - scheduled;
  const budgetPerDay = Math.floor(leftThisMonth / daysLeft);

  let balance = d.balance.start;
  for (const tx of d.transactions) if (tx.date >= d.balance.startDate && tx.date <= TODAY) balance += tx.amount;
  // Next payday is Friday, Nov 20. No bills fall between today and then.
  const cashUntilPayday = balance;
  const cashPerDay = Math.floor(cashUntilPayday / 1);
  const safeToday = Math.max(0, Math.min(budgetPerDay, cashPerDay));

  t.diagnostic(`Limit ${formatMoney(limit)} - spent ${formatMoney(spent)} - scheduled ${formatMoney(scheduled)} = ${formatMoney(leftThisMonth)} left`);
  t.diagnostic(`${formatMoney(leftThisMonth)} / ${daysLeft} days = ${formatMoney(budgetPerDay)} a day`);
  t.diagnostic(`Balance ${formatMoney(balance)}, payday tomorrow, so cash allows ${formatMoney(cashPerDay)} today`);
  t.diagnostic(`Safe to spend today: ${formatMoney(safeToday)}`);

  assert.equal(s.payday, '2026-11-20');
  assert.equal(s.spent, spent);
  assert.equal(s.scheduledSpend, scheduled);
  assert.equal(s.budgetMonth, leftThisMonth);
  assert.equal(s.budgetDaily, budgetPerDay);
  assert.equal(s.balance, balance);
  assert.equal(s.cash, cashUntilPayday);
  assert.equal(s.daily, safeToday);
  assert.equal(s.month, Math.min(leftThisMonth, cashUntilPayday));
});
