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
