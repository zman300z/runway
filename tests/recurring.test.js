import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nthCharge, chargeDatesBetween, chargeAfter, billChargesBetween, postDueCharges, newBill, editBill,
  pauseBill, resumeBill, pastChargeCount, yearlyCost, monthlyCost, billTotals, upcomingCharges, postedKey,
} from '../js/recurring.js';
import { bill, data, idMaker } from './helpers.js';

test('a bill on the 31st charges on the last day of shorter months, without drifting', () => {
  assert.deepEqual(chargeDatesBetween('2026-01-31', 'monthly', '2026-01-01', '2026-06-30'), [
    '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
  ]);
  assert.deepEqual(chargeDatesBetween('2027-12-31', 'monthly', '2028-02-01', '2028-03-31'), ['2028-02-29', '2028-03-31']);
  assert.equal(nthCharge('2026-01-31', 'monthly', 13), '2027-02-28');
  assert.equal(nthCharge('2026-01-31', 'monthly', 14), '2027-03-31');
});

test('a yearly bill on Feb 29 charges Feb 28 in other years', () => {
  assert.deepEqual(chargeDatesBetween('2028-02-29', 'yearly', '2028-01-01', '2032-12-31'), [
    '2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29',
  ]);
});

test('weekly bills', () => {
  assert.deepEqual(chargeDatesBetween('2026-11-02', 'weekly', '2026-11-10', '2026-11-30'), ['2026-11-16', '2026-11-23', '2026-11-30']);
  assert.equal(chargeAfter('2026-11-02', 'weekly', '2026-11-16'), '2026-11-23');
  assert.deepEqual(chargeDatesBetween('2026-11-02', 'weekly', '2026-10-01', '2026-11-02'), ['2026-11-02'], 'nothing before the anchor');
});

test('catch-up after 2+ missed months posts each charge exactly once, dated correctly', () => {
  // Last opened Sep 10. Today is Nov 18.
  const before = data({
    recurring: [
      bill({ id: 'rent', name: 'Rent', amount: 65000, categoryId: 'rent', anchor: '2026-09-15', next: '2026-09-15' }),
      bill({ id: 'gym', name: 'Gym', amount: 1000, categoryId: 'fun', cadence: 'weekly', anchor: '2026-09-11', next: '2026-09-11' }),
    ],
  });
  const { data: after, added } = postDueCharges(before, '2026-11-18', { makeId: idMaker('p'), now: 1 });

  const rent = added.filter((t) => t.recurringId === 'rent');
  assert.deepEqual(rent.map((t) => t.date), ['2026-09-15', '2026-10-15', '2026-11-15']);
  assert.ok(rent.every((t) => t.amount === -65000 && t.type === 'expense' && t.categoryId === 'rent' && t.note === 'Rent'));

  const gym = added.filter((t) => t.recurringId === 'gym');
  assert.deepEqual(gym.map((t) => t.date), [
    '2026-09-11', '2026-09-18', '2026-09-25', '2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23',
    '2026-10-30', '2026-11-06', '2026-11-13',
  ]);
  assert.equal(after.transactions.length, 13);
  assert.equal(after.recurring.find((b) => b.id === 'rent').next, '2026-12-15');
  assert.equal(after.recurring.find((b) => b.id === 'gym').next, '2026-11-20');
  assert.equal(before.transactions.length, 0, 'the input is never changed');

  // Opening again the same day posts nothing and returns the same data.
  const again = postDueCharges(after, '2026-11-18', { makeId: idMaker('q'), now: 2 });
  assert.equal(again.added.length, 0);
  assert.equal(again.data, after);

  // Even if `next` were rolled back, the posted log stops duplicates.
  const rolledBack = { ...after, recurring: after.recurring.map((b) => ({ ...b, next: b.anchor })) };
  const third = postDueCharges(rolledBack, '2026-11-18', { makeId: idMaker('r'), now: 3 });
  assert.equal(third.added.length, 0);
  assert.equal(third.data.transactions.length, 13);
});

test('a charge due today posts today', () => {
  const before = data({ recurring: [bill({ anchor: '2026-11-18', next: '2026-11-18' })] });
  const { added, data: after } = postDueCharges(before, '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.deepEqual(added.map((t) => t.date), ['2026-11-18']);
  assert.equal(after.recurring[0].next, '2026-12-18');
});

test('paused bills never post, and resuming does not back-post', () => {
  const paused = pauseBill(bill({ id: 'b', anchor: '2026-08-15', next: '2026-09-15' }));
  const before = data({ recurring: [paused] });
  const { added } = postDueCharges(before, '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.equal(added.length, 0);

  const resumed = resumeBill(paused, '2026-11-18');
  assert.equal(resumed.active, true);
  assert.equal(resumed.next, '2026-12-15', 'skips the charges missed while paused');
  const afterResume = postDueCharges(data({ recurring: [resumed] }), '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.equal(afterResume.added.length, 0);

  // Resuming on a charge day charges that day.
  assert.equal(resumeBill(paused, '2026-11-15').next, '2026-11-15');
  assert.deepEqual(billChargesBetween(paused, '2026-11-01', '2026-12-31'), [], 'paused bills have nothing upcoming');
});

test('editing a bill never changes charges already posted', () => {
  const before = data({ recurring: [bill({ id: 'b', amount: 1000, anchor: '2026-10-05', next: '2026-10-05' })] });
  const { data: posted } = postDueCharges(before, '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.deepEqual(posted.transactions.map((t) => t.amount), [-1000, -1000]);

  const edited = { ...posted, recurring: posted.recurring.map((b) => editBill(b, { amount: 2500, name: 'Renamed' })) };
  assert.deepEqual(edited.transactions.map((t) => [t.amount, t.note]), [[-1000, 'Bill'], [-1000, 'Bill']]);
  const { added } = postDueCharges(edited, '2026-12-05', { makeId: idMaker('x'), now: 2 });
  assert.deepEqual(added.map((t) => [t.date, t.amount, t.note]), [['2026-12-05', -2500, 'Renamed']]);
});

test('changing the next date or cadence re-anchors the schedule', () => {
  const b = bill({ anchor: '2026-01-31', next: '2026-11-30' });
  const moved = editBill(b, { next: '2026-12-10' });
  assert.equal(moved.anchor, '2026-12-10');
  assert.equal(moved.next, '2026-12-10');
  const weekly = editBill(b, { cadence: 'weekly' });
  assert.equal(weekly.anchor, '2026-11-30');
  assert.equal(weekly.cadence, 'weekly');
  assert.equal(editBill(b, { amount: 5 }).anchor, '2026-01-31', 'other edits keep the anchor');
});

test('a deleted posted charge never comes back', () => {
  const before = data({ recurring: [bill({ id: 'b', anchor: '2026-11-05', next: '2026-11-05' })] });
  const { data: posted } = postDueCharges(before, '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.equal(posted.transactions.length, 1);
  const deleted = { ...posted, transactions: [] };
  const rolledBack = { ...deleted, recurring: deleted.recurring.map((x) => ({ ...x, next: '2026-11-05' })) };
  assert.equal(postDueCharges(rolledBack, '2026-11-18', { makeId: idMaker(), now: 2 }).added.length, 0);
  assert.ok(posted.posted.includes(postedKey('b', '2026-11-05')));
});

test('new bills start on their first charge date; past dates are counted for a heads-up', () => {
  const b = newBill({ name: ' Netflix ', amount: 1549, categoryId: 'subscriptions', cadence: 'monthly', next: '2026-11-09' }, { id: 'n', now: 5 });
  assert.deepEqual(b, { id: 'n', name: 'Netflix', amount: 1549, categoryId: 'subscriptions', account: 'bank', cadence: 'monthly', anchor: '2026-11-09', next: '2026-11-09', active: true, createdAt: 5 });
  assert.equal(pastChargeCount('monthly', '2026-11-09', '2026-11-18'), 1);
  assert.equal(pastChargeCount('monthly', '2026-09-09', '2026-11-18'), 3);
  assert.equal(pastChargeCount('monthly', '2026-11-25', '2026-11-18'), 0);
  assert.equal(pastChargeCount('weekly', '2026-11-04', '2026-11-18'), 3);
});

test('totals per month and per year', () => {
  const bills = [
    bill({ id: 'a', amount: 1199, cadence: 'monthly' }),
    bill({ id: 'b', amount: 500, cadence: 'weekly' }),
    bill({ id: 'c', amount: 6900, cadence: 'yearly' }),
    bill({ id: 'd', amount: 999, cadence: 'monthly', active: false }),
  ];
  assert.equal(yearlyCost(bills[0]), 14388);
  assert.equal(yearlyCost(bills[1]), 26000);
  assert.equal(yearlyCost(bills[2]), 6900);
  assert.equal(monthlyCost(bills[1]), 2167);
  assert.deepEqual(billTotals(bills), { perYear: 47288, perMonth: 3941, pausedPerYear: 11988, pausedPerMonth: 999 });
  assert.deepEqual(billTotals([]), { perYear: 0, perMonth: 0, pausedPerYear: 0, pausedPerMonth: 0 });
});

test('upcoming charges in the next 7 days, sorted by date', () => {
  const bills = [
    bill({ id: 'w', name: 'Weekly', amount: 300, cadence: 'weekly', anchor: '2026-11-16', next: '2026-11-23' }),
    bill({ id: 'm', name: 'Monthly', amount: 1000, anchor: '2026-10-20', next: '2026-11-20' }),
    bill({ id: 'p', name: 'Paused', amount: 999, anchor: '2026-11-21', next: '2026-11-21', active: false }),
    bill({ id: 'y', name: 'Yearly', amount: 6900, cadence: 'yearly', anchor: '2026-03-01', next: '2027-03-01' }),
  ];
  const list = upcomingCharges(bills, '2026-11-19', '2026-11-25');
  assert.deepEqual(list.map((c) => [c.date, c.name]), [['2026-11-20', 'Monthly'], ['2026-11-23', 'Weekly']]);
});
