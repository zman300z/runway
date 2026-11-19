import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain } from '../js/explain.js';
import { summarize, monthlyHistory } from '../js/budget.js';
import { novemberExample } from './helpers.js';

const TODAY = '2026-11-18';
const flat = (e) => e.sections.flatMap((s) => s.rows.map((r) => `${r.label}: ${r.value}`));

test('"?" on today\'s number shows both calculations with live numbers', () => {
  const d = novemberExample();
  const e = explain('today', summarize(d, TODAY), d);
  assert.equal(e.title, 'Safe to spend today');
  assert.equal(e.sections.length, 2);
  assert.deepEqual(flat(e), [
    'Monthly limit: $1,200.00',
    'Spent so far this month: − $700.00',
    'Bills still scheduled this month: − $56.99',
    'Left this month: $443.01',
    'Days left, counting today: ÷ 13',
    'Per day, rounded down: $34.07',
    'Balance right now: $750.00',
    'Bills due before payday: − $0.00',
    'Cash until payday: $750.00',
    'Days until payday, counting today: ÷ 3',
    'Per day, rounded down: $250.00',
  ]);
  assert.deepEqual(e.result, { label: 'Safe to spend today', value: '$34.07' });
  assert.match(e.footnote, /smaller of \$34\.07 and \$250\.00/);
  assert.match(e.sections[1].heading, /Sat, Nov 21/);
});

test('every topic has an explanation, even with nothing set up', () => {
  const d = novemberExample({ goal: { name: 'Trip', target: 20000, saved: 0, since: '2026-11-01' } });
  const s = summarize(d, TODAY);
  for (const topic of ['today', 'month', 'balance', 'pace', 'limit', 'leftover', 'goal', 'bills', 'split']) {
    const e = explain(topic, s, d);
    assert.ok(e.title, topic);
    assert.ok(Array.isArray(e.sections), topic);
  }
  const net = explain('net', monthlyHistory(d, TODAY).at(-1), d);
  assert.deepEqual(net.result, { label: 'Net', value: '-$200.00' });
  assert.throws(() => explain('nope', s, d));

  const empty = novemberExample({ balance: null, goal: null });
  empty.budget = { ...empty.budget, limit: null };
  const es = summarize(empty, TODAY);
  assert.equal(explain('today', es, empty).result, null);
  assert.match(explain('balance', es, empty).intro, /Add your debit card balance/);
  assert.match(explain('pace', es, empty).intro, /Set a monthly limit/);
});

test('card "?" explanations add up with live numbers', async () => {
  const { card, cardPayment, expense } = await import('./helpers.js');
  const onCard = { account: 'card1' };
  const base = novemberExample();
  const d = {
    ...base,
    cards: [card()],
    transactions: [
      ...base.transactions,
      expense('2026-10-20', 12000, 'eating-out', onCard),
      expense('2026-11-12', 4000, 'groceries', onCard),
      cardPayment('2026-11-16', 5000),
    ],
  };
  const s = summarize(d, TODAY);

  const bank = explain('balance', s, d);
  assert.equal(bank.title, 'Bank balance');
  assert.ok(flat(bank).includes('Card payments since then: − $50.00'));
  assert.ok(flat(bank).includes('Bank balance now: $700.00'));
  assert.match(bank.footnote, /Card purchases don't touch your bank/);

  const owed = explain('owed', s, d);
  assert.deepEqual(flat(owed), [
    'Statement balance, due Mon, Dec 7: $70.00',
    'New charges since Tue, Nov 10: + $40.00',
    'Owed on this card: $110.00',
  ]);
  assert.deepEqual(owed.result, { label: 'Total owed', value: '$110.00' });

  const after = explain('afterPayoff', s, d);
  assert.deepEqual(flat(after), [
    'Bank balance now: $700.00',
    'Owed on your card (statement plus new charges): − $110.00',
    'After card is paid off: $590.00',
  ]);

  const withCard = { ...s, cardId: 'card1' };
  assert.deepEqual(flat(explain('statement', withCard, d)), [
    'Owed when the statement closed on Tue, Nov 10: $120.00',
    'Paid since then: − $50.00',
    'Still due by Mon, Dec 7: $70.00',
  ]);
  assert.deepEqual(flat(explain('cardCycle', withCard, d)), [
    'Card purchases since Wed, Nov 11 (refunds count back): $40.00',
    'Your cap for each cycle: $400.00',
    'Used: 10%',
    'Left before your cap: $360.00',
  ]);
  assert.equal(explain('utilization', withCard, d).result.value, '5%');
  assert.equal(explain('cashback', withCard, d).sections.length, 0); // no tracker set up

  // A card payment due before payday shows up in the cash part of today's number.
  const soon = { ...d, cards: [card({ closingDay: 25, dueDay: 20, handledDue: '2026-10-20', handledClose: '2026-10-25' })] };
  const today = explain('today', summarize(soon, TODAY), soon);
  assert.ok(flat(today).some((r) => r.startsWith('Student Card payment, due Fri, Nov 20: −')));
  assert.ok(flat(today).includes('Bank balance right now: $700.00'));
});
