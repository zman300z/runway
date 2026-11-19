import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoData } from '../js/demo.js';
import { summarize } from '../js/budget.js';
import { validate } from '../js/store.js';
import { postDueCharges } from '../js/recurring.js';
import { formatMoney } from '../js/money.js';
import { cardSummary, owedOn, pendingPayments, pendingStatement, needsQuarterReminder, rewardsEstimate } from '../js/cards.js';

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

  // The bank feels Debit purchases, income and card payments. Card purchases wait for the payment.
  let balance = d.balance.start;
  for (const tx of d.transactions) {
    if (tx.date < d.balance.startDate || tx.date > TODAY) continue;
    if (tx.type === 'cardPayment') balance -= tx.amount;
    else if ((tx.account ?? 'bank') === 'bank') balance += tx.amount;
  }
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

test('the demo card: purchases on the card, autopay paid each statement, nothing to answer', () => {
  const d = buildDemoData(TODAY, { now: 1 });
  const [card] = d.cards;
  assert.equal(card.name, 'Student Card');
  assert.ok(d.transactions.filter((t) => t.account === card.id && t.type === 'expense').length > 40, 'card purchases');
  assert.ok(d.recurring.some((b) => b.account === card.id), 'a bill on the card');
  assert.ok(d.transactions.filter((t) => t.type === 'cardPayment').length >= 5, 'monthly autopay payments');
  assert.ok(d.transactions.some((t) => t.type === 'cashback'), 'a cash back credit');
  assert.deepEqual(pendingPayments(d, card, TODAY), []);
  assert.equal(pendingStatement(card, TODAY), null);
  assert.equal(needsQuarterReminder(card, TODAY, card.quarterSeen), false);
  // Every payment paid its statement in full, so what is owed is the Nov 12 statement plus new charges.
  const c = cardSummary(d, card, TODAY);
  assert.equal(c.closing, '2026-11-12');
  assert.equal(c.due, '2026-12-09');
  assert.equal(c.statementDue, owedOn(d, card, '2026-11-12'));
  assert.equal(c.owed, c.statementDue + c.newCharges);
  assert.ok(c.owed > 0);
  // Card purchases still count as spending, and the bank still matches what Home shows.
  const s = summarize(d, TODAY);
  assert.equal(s.afterPayoff, s.balance - c.owed);
  assert.equal(s.cardDue, 0); // due Dec 9, after Friday's payday
  assert.ok(rewardsEstimate(d, card, TODAY).total > 0);
});
