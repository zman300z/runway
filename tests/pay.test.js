import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  paydaysBetween, nextPayday, pendingPaydays, monthlyPay, suggestedLimit, describeDays, ordinal,
} from '../js/pay.js';

const biweekly = { amount: 52000, frequency: 'biweekly', anchor: '2026-11-21', days: null, handledThrough: null };

test('every-2-weeks paydays follow the anchor in both directions', () => {
  assert.deepEqual(paydaysBetween(biweekly, '2026-10-01', '2026-12-31'), [
    '2026-10-10', '2026-10-24', '2026-11-07', '2026-11-21', '2026-12-05', '2026-12-19',
  ]);
});

test('weekly paydays', () => {
  const weekly = { ...biweekly, frequency: 'weekly', anchor: '2026-11-20' };
  assert.deepEqual(paydaysBetween(weekly, '2026-11-01', '2026-11-30'), ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']);
});

test('monthly pay on the 31st lands on the last day of short months', () => {
  const monthly = { ...biweekly, frequency: 'monthly', anchor: '2026-10-31' };
  assert.deepEqual(paydaysBetween(monthly, '2026-11-01', '2027-03-31'), [
    '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
  ]);
});

test('twice a month: 15th and last day, and 1st and 15th', () => {
  const lastDay = { ...biweekly, frequency: 'semimonthly', anchor: '2026-11-18', days: [15, 31] };
  assert.deepEqual(paydaysBetween(lastDay, '2026-11-01', '2027-02-28'), [
    '2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31', '2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28',
  ]);
  const firstAndFifteenth = { ...lastDay, days: [1, 15] };
  assert.deepEqual(paydaysBetween(firstAndFifteenth, '2026-11-02', '2026-12-01'), ['2026-11-15', '2026-12-01']);
  assert.equal(describeDays([15, 31]), '15th and last day');
  assert.equal(describeDays([1, 15]), '1st and 15th');
  assert.equal(ordinal(22), '22nd');
  assert.equal(ordinal(13), '13th');
});

test('the next payday is strictly after today', () => {
  assert.equal(nextPayday(biweekly, '2026-11-20'), '2026-11-21');
  assert.equal(nextPayday(biweekly, '2026-11-21'), '2026-12-05');
  assert.equal(nextPayday(null, '2026-11-21'), null);
});

test('paydays waiting for a "Did you get paid?" answer', () => {
  const pay = { ...biweekly, anchor: '2026-10-10', handledThrough: '2026-10-09' };
  assert.deepEqual(pendingPaydays(pay, '2026-11-18'), ['2026-10-10', '2026-10-24', '2026-11-07']);
  assert.deepEqual(pendingPaydays({ ...pay, handledThrough: '2026-10-24' }, '2026-11-18'), ['2026-11-07']);
  assert.deepEqual(pendingPaydays({ ...pay, handledThrough: '2026-11-07' }, '2026-11-18'), []);
  assert.deepEqual(pendingPaydays({ ...pay, anchor: '2026-11-21', handledThrough: null }, '2026-11-18'), [], 'nothing before the first payday');
  assert.deepEqual(pendingPaydays({ ...pay, anchor: '2026-11-18', handledThrough: '2026-11-17' }, '2026-11-18'), ['2026-11-18'], 'payday today');
});

test('monthly pay and the suggested limit', () => {
  assert.equal(monthlyPay(biweekly), 112667); // $520 x 26 / 12
  assert.equal(suggestedLimit(biweekly), 90000); // 80% is $901.33, rounded down to $900
  assert.equal(monthlyPay({ ...biweekly, frequency: 'weekly', amount: 30000 }), 130000);
  assert.equal(suggestedLimit({ ...biweekly, frequency: 'weekly', amount: 30000 }), 104000);
  assert.equal(monthlyPay({ ...biweekly, frequency: 'semimonthly', amount: 60000 }), 120000);
  assert.equal(suggestedLimit({ ...biweekly, frequency: 'semimonthly', amount: 60000 }), 96000);
  assert.equal(monthlyPay({ ...biweekly, frequency: 'monthly', amount: 150000 }), 150000);
  assert.equal(suggestedLimit({ ...biweekly, frequency: 'monthly', amount: 150000 }), 120000);
  assert.equal(monthlyPay(null), 0);
  assert.equal(suggestedLimit(null), 0);
});
