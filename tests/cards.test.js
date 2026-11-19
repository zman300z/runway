import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardSummary, owedOn, statementAmount, computedStatement, lastClosing, nextClosing, dueDateFor, closingForDue,
  monthlyOn, pendingPayments, pendingStatement, capPreview, rewardsEstimate, needsQuarterReminder, quarterOf,
  activeCards, totalOwed, bankEffect, cycleFor,
} from '../js/cards.js';
import { summarize, balanceOn, periodTotals, monthlyHistory, balanceSeries, cardWarnings, spendOf } from '../js/budget.js';
import {
  addCard, updateCard, deleteCard, closeCard, reopenCard, payCard, answerCardDue, confirmStatement, markStatementHandled,
  addCashback, cardReconcile, addTransaction, updateTransaction, makeTransaction, addBill, updateBill, dismissQuarterReminder,
} from '../js/actions.js';
import { postDueCharges } from '../js/recurring.js';
import { periodFor } from '../js/dates.js';
import { validate, createStore, KEYS } from '../js/store.js';
import { buildDemoData } from '../js/demo.js';
import {
  novemberExample, data, card, cardPayment, expense, refund, income, bill, idMaker, MemoryStorage,
} from './helpers.js';

const TODAY = '2026-11-18'; // Wednesday. Next payday is Sat, Nov 21.
const onCard = { account: 'card1' };

/** The worked example (bank balance $750, $700 spent in November) plus one card. */
function example(extra = [], cardOver = {}, over = {}) {
  const d = novemberExample(over);
  return { ...d, cards: [card(cardOver)], transactions: [...d.transactions, ...extra] };
}

/** $120 on the card in October (on the Nov 10 statement), then $40 and $20 this cycle. */
const purchases = () => [
  expense('2026-10-20', 12000, 'eating-out', onCard),
  expense('2026-11-12', 4000, 'groceries', onCard),
  expense('2026-11-15', 2000, 'coffee', onCard),
];

test('a card purchase is spending on the day you make it, but only the card owes it', () => {
  const before = summarize(novemberExample(), TODAY);
  const d = example(purchases());
  const s = summarize(d, TODAY);
  // November spending goes up by the $60 this month. The $120 counted in October.
  assert.equal(s.spent, before.spent + 6000);
  assert.equal(s.totals.need, before.totals.need + 4000);
  assert.equal(s.totals.want, before.totals.want + 2000);
  assert.equal(s.totals.byCategory.get('groceries'), 8000 + 4000);
  assert.equal(s.budgetMonth, before.budgetMonth - 6000);
  assert.equal(periodTotals(d, periodFor('2026-10-15', 1)).spent, 12000);
  // Bank balance: untouched. Card owed: all $180. After payoff: $750 - $180.
  assert.equal(s.balance, 75000);
  assert.equal(s.owed, 18000);
  assert.equal(s.afterPayoff, 57000);
  assert.equal(s.hasCards, true);

  const c = cardSummary(d, d.cards[0], TODAY);
  assert.equal(c.closing, '2026-11-10');
  assert.equal(c.statement, 12000);
  assert.equal(c.statementDue, 12000);
  assert.equal(c.newCharges, 6000);
  assert.equal(c.due, '2026-12-07');
  assert.equal(c.cycleStart, '2026-11-11');
  assert.equal(c.cycleEnd, '2026-12-10');
  assert.equal(c.cycleSpend, 6000);
  // Due Dec 7, after Saturday's payday, so the guard leaves the cash alone.
  assert.equal(s.cardDue, 0);
  assert.equal(s.cash, 75000);

  // No card: none of this shows.
  assert.equal(before.hasCards, false);
  assert.equal(before.owed, 0);
});

test('a card payment moves money from the bank to the card and is never spending', () => {
  const d = example([...purchases(), cardPayment('2026-11-16', 12000)]);
  const s = summarize(d, TODAY);
  assert.equal(s.spent, 76000);
  assert.equal(s.balance, 75000 - 12000);
  assert.equal(s.owed, 6000);
  // Paying the card never changes "after card is paid off".
  assert.equal(s.afterPayoff, 57000);
  assert.equal(summarize(example(purchases()), TODAY).afterPayoff, s.afterPayoff);
  // Not in categories, needs or wants, or the monthly net chart.
  assert.equal([...s.totals.byCategory.values()].reduce((a, b) => a + b, 0), 76000);
  assert.equal(s.totals.need + s.totals.want, 76000);
  assert.equal(monthlyHistory(d, TODAY).at(-1).net, 50000 - 76000);
  assert.equal(spendOf(cardPayment(TODAY, 100)), 0);
  assert.equal(bankEffect(cardPayment(TODAY, 100)), -100);

  const c = cardSummary(d, d.cards[0], TODAY);
  assert.equal(c.statementDue, 0);
  assert.equal(c.newCharges, 6000);
});

test('paying more than the statement lowers new charges, and below zero is a credit', () => {
  const over = example([...purchases(), cardPayment('2026-11-16', 15000)]);
  let c = cardSummary(over, over.cards[0], TODAY);
  assert.equal(c.statementDue, 0);
  assert.equal(c.owed, 3000);
  assert.equal(c.newCharges, 3000); // the extra $30 came off the $60 of new charges

  const credit = example([...purchases(), cardPayment('2026-11-16', 20000)]);
  c = cardSummary(credit, credit.cards[0], TODAY);
  assert.equal(c.owed, -2000);
  assert.equal(c.credit, 2000);
  assert.equal(c.statementDue, 0);
  assert.equal(c.utilization, 0);
  const s = summarize(credit, TODAY);
  assert.equal(s.owed, -2000);
  assert.equal(s.afterPayoff, 75000 - 20000 + 2000);
});

test('a partial payment leaves the rest due, and it rolls into the next statement', () => {
  const d = example([...purchases(), cardPayment('2026-11-16', 5000)]);
  const c = cardSummary(d, d.cards[0], TODAY);
  assert.equal(c.statementDue, 7000);
  assert.equal(c.newCharges, 6000);
  assert.equal(c.owed, 13000);

  // On the due date, Runway asks about what is still due.
  assert.deepEqual(pendingPayments(d, d.cards[0], '2026-12-06'), []);
  assert.deepEqual(pendingPayments(d, d.cards[0], '2026-12-07'), [{ due: '2026-12-07', closing: '2026-11-10', amount: 7000 }]);
  // Answering with what left the bank stops the question.
  const paid = answerCardDue(d, 'card1', '2026-12-07', 7000, { id: 'p1', now: 1 }).data;
  assert.deepEqual(pendingPayments(paid, paid.cards[0], '2026-12-07'), []);
  assert.equal(owedOn(paid, paid.cards[0], '2026-12-07'), 6000);
  assert.equal(paid.transactions.at(-1).date, '2026-12-07');
  // Paying less still stops the question. The rest stays owed and lands on the next statement.
  const short = answerCardDue(d, 'card1', '2026-12-07', 2000, { id: 'p2', now: 1 }).data;
  assert.deepEqual(pendingPayments(short, short.cards[0], '2026-12-08'), []);
  assert.equal(owedOn(short, short.cards[0], '2026-12-07'), 11000);
  assert.equal(statementAmount(short, short.cards[0], '2026-12-10'), 11000);
  // "Didn't pay" (0) records nothing but stops asking.
  const none = answerCardDue(d, 'card1', '2026-12-07', 0);
  assert.equal(none.tx, null);
  assert.equal(none.data.transactions.length, d.transactions.length);
  assert.equal(none.data.cards[0].handledDue, '2026-12-07');
  // A statement already paid in full never asks.
  const full = example([...purchases(), cardPayment('2026-11-16', 12000)]);
  assert.deepEqual(pendingPayments(full, full.cards[0], '2026-12-07'), []);
});

test('statement dates: the 29th to 31st fall back to the last day of shorter months', () => {
  const end = card({ closingDay: 31, dueDay: 25 });
  assert.equal(lastClosing(end, '2026-11-18'), '2026-10-31');
  assert.equal(lastClosing(end, '2026-11-30'), '2026-11-30');
  assert.equal(nextClosing(end, '2026-11-18'), '2026-11-30');
  assert.equal(nextClosing(end, '2026-11-30'), '2026-12-31');
  assert.equal(lastClosing(end, '2027-02-27'), '2027-01-31');
  assert.equal(lastClosing(end, '2027-02-28'), '2027-02-28');
  assert.equal(lastClosing(end, '2028-02-29'), '2028-02-29');
  assert.equal(dueDateFor(end, '2026-11-30'), '2026-12-25');
  assert.equal(dueDateFor(end, '2027-02-28'), '2027-03-25');
  assert.deepEqual(monthlyOn(31, '2026-11-01', '2027-03-01'), ['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);

  const lateDue = card({ closingDay: 15, dueDay: 31 });
  assert.equal(dueDateFor(lateDue, '2027-02-15'), '2027-02-28');
  assert.equal(dueDateFor(lateDue, '2026-04-15'), '2026-04-30');
  assert.equal(closingForDue(lateDue, '2027-02-28'), '2027-02-15');
  // The due date is the first due day after the closing date.
  assert.equal(dueDateFor(card(), '2026-11-10'), '2026-12-07');
  assert.equal(dueDateFor(card({ closingDay: 3, dueDay: 28 }), '2026-11-03'), '2026-11-28');
  assert.equal(closingForDue(card(), '2026-12-07'), '2026-11-10');

  // Purchases through the closing date land on that statement, in short months too.
  const d = {
    ...data(),
    cards: [end],
    transactions: [expense('2026-11-30', 1000, 'coffee', onCard), expense('2026-12-01', 2000, 'coffee', onCard)],
  };
  assert.equal(statementAmount(d, end, '2026-11-30'), 1000);
  assert.equal(statementAmount(d, end, '2026-12-31'), 3000);
  const feb = { ...d, transactions: [expense('2027-02-28', 500, 'coffee', onCard), expense('2027-03-01', 700, 'coffee', onCard)] };
  const s = cardSummary(feb, end, '2027-03-02');
  assert.equal(s.closing, '2027-02-28');
  assert.equal(s.statement, 500);
  assert.equal(s.due, '2027-03-25');
  assert.equal(s.newCharges, 700);
  assert.equal(s.cycleStart, '2027-03-01');
  assert.equal(s.cycleEnd, '2027-03-31');
  // Nothing before the account opened is ever a statement.
  assert.equal(statementAmount(d, card({ closingDay: 31, openDate: '2026-12-01' }), '2026-11-30'), 0);
});

test('the personal cap counts per statement cycle, with nudges at 80% and 100%', () => {
  const old = expense('2026-11-09', 20000, 'shopping', onCard); // last cycle (Oct 11 to Nov 10)
  const d1 = example([old, expense('2026-11-11', 30000, 'eating-out', onCard)]); // $300 of $400
  let s = cardSummary(d1, d1.cards[0], TODAY);
  assert.equal(s.cycleSpend, 30000);
  assert.equal(s.capLevel, 0);
  assert.deepEqual(cardWarnings(d1, TODAY), []);

  const d2 = { ...d1, transactions: [...d1.transactions, expense('2026-11-17', 2000, 'coffee', onCard)] }; // $320, 80%
  s = cardSummary(d2, d2.cards[0], TODAY);
  assert.equal(s.cycleSpend, 32000);
  assert.equal(s.capLevel, 80);
  assert.deepEqual(cardWarnings(d2, TODAY).map((w) => [w.kind, w.level, w.key]), [['card', 80, 'card:card1:2026-11-11']]);

  const d3 = { ...d2, transactions: [...d2.transactions, expense('2026-11-18', 15000, 'fun', onCard)] }; // $470
  s = cardSummary(d3, d3.cards[0], TODAY);
  assert.equal(s.capLevel, 100);
  assert.equal(s.overCap, 7000);
  const w = cardWarnings(d3, TODAY)[0];
  assert.deepEqual([w.kind, w.level, w.spent, w.limit, w.over], ['card', 100, 47000, 40000, 7000]);
  // The cycle runs through the Dec 10 closing (a purchase that day is on that statement), then starts fresh.
  assert.deepEqual(cycleFor(card(), '2026-12-10'), { start: '2026-11-11', end: '2026-12-10' });
  assert.deepEqual(cycleFor(card(), '2026-12-11'), { start: '2026-12-11', end: '2027-01-10' });
  assert.equal(capPreview(d3, d3.cards[0], '2026-12-10', 1000).before, 47000);
  const closingDay = cardSummary(d3, d3.cards[0], '2026-12-10');
  assert.equal(closingDay.closing, '2026-12-10');
  assert.equal(closingDay.newCharges, 0);
  assert.equal(closingDay.cycleSpend, 47000);
  assert.equal(cardSummary(d3, d3.cards[0], '2026-12-11').cycleSpend, 0);
  assert.equal(cardSummary(d3, d3.cards[0], '2026-12-11').capLevel, 0);

  // Quick Add's heads-up before saving.
  assert.deepEqual(capPreview(d2, d2.cards[0], TODAY, 15000), { cap: 40000, before: 32000, after: 47000, level: 100, over: 7000 });
  assert.deepEqual(capPreview(d1, d1.cards[0], TODAY, 2000), { cap: 40000, before: 30000, after: 32000, level: 80, over: 0 });
  assert.equal(capPreview(d1, d1.cards[0], TODAY, 500).level, 0);
  // Editing a purchase doesn't count it twice, and a backdated one counts in its own cycle.
  const last = d2.transactions.at(-1);
  assert.equal(capPreview(d2, d2.cards[0], TODAY, 10000, last.id).after, 40000);
  assert.equal(capPreview(d2, d2.cards[0], '2026-11-05', 1000).before, 20000);
  // No cap, no heads-up.
  assert.equal(capPreview(d2, { ...d2.cards[0], cap: null }, TODAY, 1000), null);
});

test('utilization: what will likely be reported at the next closing, with a nudge over 30%', () => {
  const u = example([expense('2026-11-12', 80000, 'groceries', onCard)], { cap: null }); // $800 of $2,000
  let c = cardSummary(u, u.cards[0], TODAY);
  assert.equal(c.reported, 80000);
  assert.equal(c.utilization, 40);
  assert.equal(c.utilizationHigh, true);
  assert.deepEqual(cardWarnings(u, TODAY).map((w) => [w.kind, w.pct]), [['utilization', 40]]);
  // Exactly 30% is fine.
  const ok = example([expense('2026-11-12', 60000, 'groceries', onCard)], { cap: null });
  assert.equal(cardSummary(ok, ok.cards[0], TODAY).utilizationHigh, false);
  // With autopay, the statement paid before the next closing is not reported.
  const both = [expense('2026-10-20', 50000, 'groceries', onCard), expense('2026-11-12', 30000, 'groceries', onCard)];
  c = cardSummary(example(both, { cap: null, autopay: true }), card({ cap: null, autopay: true }), TODAY);
  assert.equal(c.statementDue, 50000);
  assert.equal(c.reported, 30000);
  assert.equal(c.utilization, 15);
  c = cardSummary(example(both, { cap: null }), card({ cap: null }), TODAY);
  assert.equal(c.utilization, 40);
});

test('refunds and cash back credits lower what you owe on the card', () => {
  const d = example([...purchases(), refund('2026-11-16', 1500, 'coffee', onCard)]);
  const s = summarize(d, TODAY);
  assert.equal(s.spent, 76000 - 1500);
  assert.equal(s.owed, 18000 - 1500);
  assert.equal(s.balance, 75000);
  assert.equal(cardSummary(d, d.cards[0], TODAY).cycleSpend, 6000 - 1500);

  // A statement credit: lower owed, never income or spending.
  const credited = addCashback(d, 'card1', 1000, TODAY, 'credit', { id: 'cb1', now: 1 });
  assert.equal(credited.tx.type, 'cashback');
  assert.equal(credited.tx.account, 'card1');
  const s2 = summarize(credited.data, TODAY);
  assert.equal(s2.owed, 16500 - 1000);
  assert.equal(s2.spent, s.spent);
  assert.equal(s2.income, s.income);
  assert.equal(s2.balance, s.balance);
  assert.equal(cardSummary(credited.data, credited.data.cards[0], TODAY).cycleSpend, 4500);
  assert.deepEqual(validate(credited.data), []);

  // Sent to the bank: income from "Rewards".
  const toBank = addCashback(d, 'card1', 1000, TODAY, 'bank', { id: 'cb2', now: 1 });
  assert.equal(toBank.tx.type, 'income');
  assert.equal(toBank.tx.source, 'rewards');
  assert.equal(toBank.tx.account, 'bank');
  const s3 = summarize(toBank.data, TODAY);
  assert.equal(s3.income, s.income + 1000);
  assert.equal(s3.balance, s.balance + 1000);
  assert.equal(s3.owed, s.owed);
});

test('bills can charge a card: they count toward the limit but leave the bank only when the card is paid', () => {
  const base = example();
  const netflix = bill({ id: 'netflix', name: 'Netflix', amount: 1549, anchor: '2026-11-20', next: '2026-11-20' });
  const onBank = { ...base, recurring: [...base.recurring, { ...netflix, account: 'bank' }] };
  const onCardBill = { ...base, recurring: [...base.recurring, { ...netflix, account: 'card1' }] };
  const bank = summarize(onBank, TODAY);
  const cardS = summarize(onCardBill, TODAY);
  assert.equal(cardS.scheduledSpend, bank.scheduledSpend);
  assert.equal(bank.billsBeforeHorizon, 1549);
  assert.equal(cardS.billsBeforeHorizon, 0);
  assert.equal(cardS.cash, bank.cash + 1549);
  // It posts to the card.
  const { data: posted, added } = postDueCharges(onCardBill, '2026-11-20', { makeId: idMaker('c'), now: 1 });
  assert.equal(added.length, 1);
  assert.equal(added[0].account, 'card1');
  assert.equal(balanceOn(posted, '2026-11-20'), balanceOn(onCardBill, '2026-11-20'));
  assert.equal(owedOn(posted, posted.cards[0], '2026-11-20'), 1549);
  assert.equal(summarize(posted, '2026-11-20').spent, summarize(onCardBill, '2026-11-20').spent + 1549);
  // No dip in the bank's projected balance on the charge date.
  assert.equal(balanceSeries(onCardBill, TODAY).events.some((e) => e.name === 'Netflix'), false);
  assert.equal(balanceSeries(onBank, TODAY).events.some((e) => e.name === 'Netflix'), true);

  // Adding and editing bills.
  const gym = { name: 'Gym', amount: 2500, categoryId: 'fun', cadence: 'monthly', next: '2026-12-01', account: 'card1' };
  const { data: withGym, bill: b } = addBill(base, gym, { id: 'gym', now: 1 });
  assert.equal(b.account, 'card1');
  assert.throws(() => addBill(base, { ...gym, account: 'gone' }), /no longer exists/);
  assert.equal(updateBill(withGym, 'gym', { account: 'bank' }).recurring.find((r) => r.id === 'gym').account, 'bank');
});

test('switching a past purchase between Debit and Card moves it between the bank and the card', () => {
  const d = example(purchases());
  const groceries = d.transactions.find((t) => t.date === '2026-11-05'); // $80 from the bank
  const before = summarize(d, TODAY);
  const toCard = updateTransaction(d, groceries.id, { account: 'card1' }, { now: 5 }).data;
  const s = summarize(toCard, TODAY);
  assert.equal(s.balance, before.balance + 8000);
  assert.equal(s.owed, before.owed + 8000);
  assert.equal(s.spent, before.spent);
  assert.equal(s.afterPayoff, before.afterPayoff);
  assert.deepEqual(monthlyHistory(toCard, TODAY), monthlyHistory(d, TODAY));
  // It was before the Nov 10 closing, so it lands on that statement.
  assert.equal(cardSummary(toCard, toCard.cards[0], TODAY).statement, 20000);
  // The balance chart no longer dips on Nov 5.
  const at = (series, date) => series.history.find((h) => h.date === date).balance;
  const chartBefore = balanceSeries(d, TODAY);
  const chartAfter = balanceSeries(toCard, TODAY);
  assert.equal(at(chartBefore, '2026-11-04') - at(chartBefore, '2026-11-05'), 8000);
  assert.equal(at(chartAfter, '2026-11-05'), at(chartAfter, '2026-11-04'));

  // And back to Debit restores everything.
  const back = updateTransaction(toCard, groceries.id, { account: 'bank' }, { now: 6 }).data;
  const s2 = summarize(back, TODAY);
  assert.equal(s2.balance, before.balance);
  assert.equal(s2.owed, before.owed);
  assert.equal(cardSummary(back, back.cards[0], TODAY).statement, 12000);

  // Only real cards, and income always goes to the bank.
  assert.throws(() => updateTransaction(d, groceries.id, { account: 'gone' }), /no longer exists/);
  const paycheck = d.transactions.find((t) => t.type === 'income');
  assert.throws(() => updateTransaction(d, paycheck.id, { account: 'card1' }), /bank account/);
  assert.equal(makeTransaction({ type: 'expense', amount: -500, categoryId: 'coffee', date: TODAY }).account, 'bank');
});

test('balance guard: a card payment due before payday comes out of the cash, like a bill', () => {
  const cardOver = { closingDay: 25, dueDay: 20, handledDue: '2026-10-20', handledClose: '2026-10-25' };
  const october = [expense('2026-10-12', 10000, 'groceries', onCard), expense('2026-10-22', 5000, 'eating-out', onCard)];
  const d = example(october, cardOver);
  const s = summarize(d, TODAY);
  // The Oct 25 statement ($150) is due Friday, Nov 20, before Saturday's payday.
  assert.deepEqual(s.cardDueItems, [{ cardId: 'card1', name: 'Student Card', due: '2026-11-20', amount: 15000, late: false }]);
  assert.equal(s.cardDue, 15000);
  assert.equal(s.balance, 75000);
  assert.equal(s.cash, 60000);
  assert.equal(s.cashDaily, 20000);

  // Paying part of it now: the bank drops and only the rest still waits.
  const part = example([...october, cardPayment(TODAY, 10000)], cardOver);
  const s2 = summarize(part, TODAY);
  assert.equal(s2.balance, 65000);
  assert.equal(s2.cardDue, 5000);
  assert.equal(s2.cash, 60000);

  // On the due date with no answer yet, the safe side assumes it already left the bank.
  const due = summarize(d, '2026-11-20');
  assert.equal(due.cardDueItems.length, 1);
  assert.equal(due.cardDueItems[0].late, true);
  assert.equal(due.balance, 75000); // the balance itself changes only once you confirm
  assert.equal(due.cash, 60000);
  const confirmed = answerCardDue(d, 'card1', '2026-11-20', 15000, { id: 'p', now: 1 }).data;
  const after = summarize(confirmed, '2026-11-20');
  assert.equal(after.balance, 60000);
  assert.equal(after.cardDue, 0);
  assert.equal(after.cash, 60000);

  // The balance chart shows the dip on the day the payment leaves the bank.
  const series = balanceSeries(d, TODAY);
  assert.deepEqual(series.events.find((e) => e.kind === 'card'), {
    date: '2026-11-20', kind: 'card', name: 'Student Card payment', amount: -15000,
  });
  const p = (date) => series.projection.find((x) => x.date === date).balance;
  assert.equal(p('2026-11-19') - p('2026-11-20'), 15000);
  // Once paid, the dip is in the history on the payment date instead.
  const paidSeries = balanceSeries(confirmed, '2026-11-20');
  const h = (date) => paidSeries.history.find((x) => x.date === date).balance;
  assert.equal(h('2026-11-19') - h('2026-11-20'), 15000);

  // A payment due after payday is left alone.
  assert.equal(summarize(example(october, { ...cardOver, dueDay: 24 }), TODAY).cardDue, 0);

  // New charges whose statement closes and comes due before the horizon count too
  // (no pay schedule: the horizon is the end of the month).
  const noPay = example(
    [expense('2026-11-12', 3000, 'coffee', onCard)],
    { closingDay: 22, dueDay: 28, handledDue: '2026-10-28', handledClose: '2026-10-22' },
    { pay: null },
  );
  const s3 = summarize(noPay, TODAY);
  assert.deepEqual(s3.cardDueItems, [{ cardId: 'card1', name: 'Student Card', due: '2026-11-28', amount: 3000, late: false }]);
});

test('the statement-closed banner, confirming the statement, and dismissing it', () => {
  const d = example(purchases(), { handledClose: '2026-10-10' });
  assert.equal(pendingStatement(d.cards[0], TODAY), '2026-11-10');
  assert.equal(computedStatement(d, d.cards[0], '2026-11-10'), 12000);
  // Confirming a different amount only moves money between "statement" and "new charges".
  const confirmed = confirmStatement(d, 'card1', '2026-11-10', 13000);
  assert.equal(pendingStatement(confirmed.cards[0], TODAY), null);
  const s = cardSummary(confirmed, confirmed.cards[0], TODAY);
  assert.equal(s.statement, 13000);
  assert.equal(s.statementDue, 13000);
  assert.equal(s.owed, 18000);
  assert.equal(s.newCharges, 5000);
  assert.equal(computedStatement(confirmed, confirmed.cards[0], '2026-11-10'), 12000);
  assert.deepEqual(validate(confirmed), []);
  assert.throws(() => confirmStatement(d, 'card1', '2026-11-10', -1), /statement balance/);
  // "Looks right" without changes also stops it.
  assert.equal(pendingStatement(markStatementHandled(d, 'card1', '2026-11-10').cards[0], TODAY), null);
  // Before the card's first statement there is nothing to confirm.
  assert.equal(pendingStatement(card({ openDate: '2026-11-12', startDate: '2026-11-12', handledClose: null }), TODAY), null);
});

test('Card Reconcile: interest and fees are spending, "not sure" only fixes what you owe', () => {
  const d = example(purchases());
  const before = summarize(d, TODAY);
  const fees = cardReconcile(d, 'card1', 19500, TODAY, 'fees', { id: 'f', now: 1 });
  assert.equal(fees.diff, 1500);
  assert.deepEqual([fees.tx.type, fees.tx.categoryId, fees.tx.account, fees.tx.amount], ['expense', 'fees', 'card1', -1500]);
  const sf = summarize(fees.data, TODAY);
  assert.equal(sf.owed, 19500);
  assert.equal(sf.spent, before.spent + 1500);
  assert.equal(sf.totals.want, before.totals.want + 1500);
  assert.equal(sf.balance, before.balance);

  const unsure = cardReconcile(d, 'card1', 17000, TODAY, 'unsure', { id: 'u', now: 1 });
  assert.equal(unsure.diff, -1000);
  assert.equal(unsure.tx.type, 'adjustment');
  const su = summarize(unsure.data, TODAY);
  assert.equal(su.owed, 17000);
  assert.equal(su.spent, before.spent);
  assert.equal(su.balance, before.balance);
  assert.deepEqual(validate(unsure.data), []);

  assert.throws(() => cardReconcile(d, 'card1', 17000, TODAY, 'fees'), /only raise/);
  assert.equal(cardReconcile(d, 'card1', 18000, TODAY, 'unsure').tx, null);
  // Data from before the category existed gets it back.
  const noFees = { ...d, categories: d.categories.filter((c) => c.id !== 'fees') };
  const restored = cardReconcile(noFees, 'card1', 19500, TODAY, 'fees', { id: 'f2', now: 1 });
  assert.ok(restored.data.categories.some((c) => c.id === 'fees' && c.bucket === 'want'));
});

test('cash back estimate: bonus categories up to the cap, base rate, and the first-year match', () => {
  const rewards = {
    baseBp: 100,
    firstYearMatch: true,
    bonuses: [{ id: 'q4', rateBp: 500, cap: 150000, start: '2026-10-01', end: '2026-12-31', categoryIds: ['groceries', 'eating-out'] }],
  };
  const d = example(purchases(), { rewards });
  const r = rewardsEstimate(d, d.cards[0], TODAY);
  // 5% of $120 eating out + 5% of $40 groceries + 1% of $20 coffee = $6.00 + $2.00 + $0.20.
  assert.equal(r.earned, 820);
  assert.equal(r.match, 820);
  assert.equal(r.total, 1640);
  assert.equal(r.matchActive, true);
  assert.equal(r.anniversary, '2027-09-01');
  assert.equal(r.bonus.spent, 16000);
  assert.equal(r.windowEarned, 820);

  // The bonus stops at its $1,500 cap: $2,000 more groceries earns 5% on $1,340 and 1% on $660.
  const big = example([...purchases(), expense('2026-11-17', 200000, 'groceries', onCard)], { rewards, cap: null });
  const rb = rewardsEstimate(big, big.cards[0], TODAY);
  assert.equal(rb.earned, 820 + 6700 + 660);
  assert.equal(rb.bonus.spent, 150000);

  // The match turns off 12 months after the account opened. Later purchases aren't doubled.
  const later = example([...purchases(), expense('2027-09-05', 10000, 'coffee', onCard)], { rewards });
  const rl = rewardsEstimate(later, later.cards[0], '2027-09-10');
  assert.equal(rl.matchActive, false);
  assert.equal(rl.earned, 920);
  assert.equal(rl.match, 820);
  assert.equal(rl.bonus, null);

  assert.equal(rewardsEstimate(d, card(), TODAY), null);
});

test('start-of-quarter reminder to activate and enter bonus categories', () => {
  const rewards = { baseBp: 100, firstYearMatch: false, bonuses: [{ id: 'q4', rateBp: 500, cap: 150000, start: '2026-10-01', end: '2026-12-31', categoryIds: [] }] };
  const c = card({ rewards });
  assert.deepEqual(quarterOf(TODAY), { key: '2026-Q4', start: '2026-10-01' });
  assert.equal(needsQuarterReminder(c, '2026-10-05'), true);
  assert.equal(needsQuarterReminder(c, TODAY), false);
  assert.equal(needsQuarterReminder(c, '2027-01-20'), true); // a new quarter with nothing entered
  assert.equal(needsQuarterReminder(c, '2027-01-20', '2027-Q1'), false);
  assert.equal(needsQuarterReminder(card(), '2026-10-05'), false);
  const d = dismissQuarterReminder({ ...data(), cards: [c] }, 'card1', '2027-Q1');
  assert.equal(d.cards[0].quarterSeen, '2027-Q1');
});

test('adding, editing, closing and deleting cards', () => {
  const base = data();
  const fields = { name: '  My   Card ', closingDay: 31, dueDay: 25, limit: 200000, cap: 40000, openDate: '2026-11-01', autopay: true };
  const { data: d, card: c } = addCard(base, fields, { id: 'c1', now: 1, today: '2026-11-19' });
  assert.equal(c.name, 'My Card');
  assert.equal(c.startDate, '2026-11-01');
  assert.equal(c.startOwed, 0);
  assert.equal(c.handledDue, '2026-11-19');
  assert.equal(c.handledClose, '2026-10-31');
  assert.equal(c.rewards, null);
  assert.deepEqual(validate(d), []);
  assert.deepEqual(pendingPayments(d, c, '2026-11-19'), []);

  // A card you already owe on starts from today.
  const owing = addCard(base, { ...fields, startOwed: 25000 }, { id: 'c2', now: 1, today: '2026-11-19' }).card;
  assert.equal(owing.startDate, '2026-11-19');
  assert.equal(owedOn({ ...base, cards: [owing] }, owing, '2026-11-19'), 25000);

  assert.throws(() => addCard(base, { ...fields, name: ' ' }, { today: '2026-11-19' }), /name/);
  assert.throws(() => addCard(base, { ...fields, closingDay: 32 }, { today: '2026-11-19' }), /closing day/);
  assert.throws(() => addCard(base, { ...fields, dueDay: 0 }, { today: '2026-11-19' }), /due day/);
  assert.throws(() => addCard(base, { ...fields, limit: 0 }, { today: '2026-11-19' }), /credit limit/);
  assert.throws(() => addCard(base, { ...fields, cap: -5 }, { today: '2026-11-19' }), /cap/);
  assert.throws(() => addCard(base, { ...fields, rewards: { baseBp: 100, bonuses: [{ rateBp: 500, cap: 1, start: '2026-12-31', end: '2026-10-01' }] } }, { today: '2026-11-19' }), /end date/);

  const edited = updateCard(d, 'c1', { name: 'Everyday Card', cap: null, autopay: false, rewards: { baseBp: 100, firstYearMatch: true, bonuses: [] } });
  assert.deepEqual([edited.cards[0].name, edited.cards[0].cap, edited.cards[0].autopay], ['Everyday Card', null, false]);
  assert.equal(edited.cards[0].rewards.baseBp, 100);
  assert.deepEqual(validate(edited), []);

  // Deleting only works while nothing points at the card. Closing needs it paid off.
  assert.equal(deleteCard(d, 'c1').cards.length, 0);
  const used = addTransaction(d, { type: 'expense', account: 'c1', amount: -500, categoryId: 'coffee', date: '2026-11-19' }, { id: 'x', now: 1 }).data;
  assert.throws(() => deleteCard(used, 'c1'), /closed but not deleted/);
  assert.throws(() => closeCard(used, 'c1', '2026-11-19'), /Pay the card off/);
  const paidOff = payCard(used, 'c1', 500, '2026-11-19', { id: 'y', now: 1 }).data;
  const closed = closeCard(paidOff, 'c1', '2026-11-19');
  assert.equal(activeCards(closed).length, 0);
  assert.equal(totalOwed(closed, '2026-11-19'), 0);
  assert.equal(summarize({ ...closed, balance: { start: 1000, startDate: '2026-11-01' } }, '2026-11-19').hasCards, false);
  assert.equal(activeCards(reopenCard(closed, 'c1')).length, 1);
  // Payments need a real card and an amount.
  assert.throws(() => payCard(d, 'gone', 500, '2026-11-19'), /no longer exists/);
  assert.throws(() => payCard(d, 'c1', 0, '2026-11-19'), /how much/);
});

test('the data check catches broken card data', () => {
  const ok = example(purchases());
  assert.deepEqual(validate(ok), []);
  const errorsFor = (d) => validate(d).join(' ');
  assert.match(errorsFor({ ...ok, transactions: [cardPayment(TODAY, 100, 'gone')] }), /Transaction 1/);
  assert.match(errorsFor({ ...ok, transactions: [income(TODAY, 100, { account: 'card1' })] }), /Transaction 1/);
  assert.match(errorsFor({ ...ok, transactions: [expense(TODAY, 100, 'coffee', { account: 'gone' })] }), /Transaction 1/);
  assert.match(errorsFor({ ...ok, cards: [card({ closingDay: 0 })] }), /Card 1/);
  assert.match(errorsFor({ ...ok, cards: [card({ id: 'bank' })] }), /Card 1/);
});

test('upgrading saved 1.0 data: everything already logged becomes Debit and nothing is lost', () => {
  const today = '2026-11-19';
  const demo = buildDemoData(today, { now: 1 });
  // Six months of realistic history, saved the way version 1.0 saved it.
  const v1 = {
    ...demo,
    schemaVersion: 1,
    categories: demo.categories.filter((c) => c.id !== 'fees'),
    transactions: demo.transactions
      .filter((t) => (t.account ?? 'bank') === 'bank' && t.type !== 'cardPayment' && t.type !== 'cashback')
      .map(({ account, ...t }) => t),
    recurring: demo.recurring.filter((b) => (b.account ?? 'bank') === 'bank').map(({ account, ...b }) => b),
  };
  delete v1.cards;
  assert.ok(v1.transactions.length > 150);
  const raw = JSON.stringify(v1);
  const storage = new MemoryStorage({ [KEYS.data]: raw });
  const res = createStore(storage).load();

  assert.equal(res.status, 'ok');
  assert.equal(res.migratedFrom, 1);
  const d = res.data;
  assert.equal(d.schemaVersion, 2);
  assert.deepEqual(validate(d), []);
  assert.deepEqual(d.cards, []);
  assert.ok(d.transactions.every((t) => t.account === 'bank'));
  assert.ok(d.recurring.every((b) => b.account === 'bank'));
  assert.ok(d.categories.some((c) => c.id === 'fees' && c.bucket === 'want'));
  // The same records, with only the account added.
  assert.deepEqual(d.transactions.map(({ account, ...t }) => t), v1.transactions);
  assert.deepEqual(d.recurring.map(({ account, ...b }) => b), v1.recurring);
  assert.deepEqual(d.categories.slice(0, v1.categories.length), v1.categories);
  for (const k of ['balance', 'pay', 'budget', 'goal', 'posted', 'settings', 'setupDone']) assert.deepEqual(d[k], v1[k], k);
  // Every number on Home is exactly what it was before the upgrade.
  const before = summarize(v1, today);
  const after = summarize(d, today);
  for (const k of ['balance', 'spent', 'income', 'month', 'daily', 'cash', 'budgetMonth', 'leftover']) {
    assert.equal(after[k], before[k], k);
  }
  // The original is kept as a safety copy, and the upgrade is saved once.
  assert.equal(storage.getItem(`${KEYS.data}:pre-v1`), raw);
  assert.equal(JSON.parse(storage.getItem(KEYS.data)).schemaVersion, 2);
  const again = createStore(storage).load();
  assert.equal(again.migratedFrom, null);
  assert.deepEqual(again.data, d);
});

test('a backup saved by version 1.0 imports as Debit, and a card backup round-trips', async () => {
  const { serializeBackup, parseBackup } = await import('../js/store.js');
  const v1 = { ...novemberExample(), schemaVersion: 1 };
  delete v1.cards;
  const imported = parseBackup(JSON.stringify({ app: 'runway', data: v1 }));
  assert.equal(imported.data.schemaVersion, 2);
  assert.ok(imported.data.transactions.every((t) => t.account === 'bank'));
  assert.equal(imported.counts.cards, 0);

  const withCard = example([...purchases(), cardPayment('2026-11-16', 12000)], {
    rewards: { baseBp: 100, firstYearMatch: true, bonuses: [{ id: 'q4', rateBp: 500, cap: 150000, start: '2026-10-01', end: '2026-12-31', categoryIds: ['groceries'] }] },
    statements: { '2026-11-10': 12000 },
  });
  const back = parseBackup(serializeBackup(withCard, { exportedAt: 'x', appVersion: '1.1.0' }));
  assert.deepEqual(back.data.cards, withCard.cards);
  assert.equal(back.counts.cards, 1);
  assert.deepEqual(summarize(back.data, TODAY), summarize(withCard, TODAY));
});
