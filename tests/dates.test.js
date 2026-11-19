import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayISO, addDays, diffDays, addMonths, isLeapYear, daysInMonth, isValidISO, weekday,
  periodFor, shiftPeriod, daysInPeriod, daysLeftInPeriod, daysElapsedInPeriod, clampStartDay,
  formatDate, relativeDay, periodLabel, periodShortLabel,
} from '../js/dates.js';

/** Run fn with the process time zone switched, if this Node build supports switching at runtime. */
function inTimeZone(tz, expectedNovOffset, fn) {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    if (new Date('2026-11-19T12:00:00Z').getTimezoneOffset() !== expectedNovOffset) return 'unsupported';
    fn();
    return 'ran';
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test('today comes from local date parts, so 11:30pm stays today', () => {
  assert.equal(todayISO(new Date(2026, 10, 18, 23, 30)), '2026-11-18');
  assert.equal(todayISO(new Date(2026, 10, 18, 0, 0)), '2026-11-18');
  assert.equal(todayISO(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('an 11:30pm purchase west of UTC is not pushed to tomorrow', (t) => {
  const result = inTimeZone('America/Los_Angeles', 480, () => {
    const lateNight = new Date('2026-11-19T07:30:00Z'); // 11:30pm Nov 18 in Los Angeles
    assert.equal(lateNight.toISOString().slice(0, 10), '2026-11-19', 'the UTC trap');
    assert.equal(todayISO(lateNight), '2026-11-18');
  });
  if (result === 'unsupported') t.skip('this Node build cannot switch time zones at runtime');
});

test('just after midnight east of UTC is already tomorrow', (t) => {
  const result = inTimeZone('Pacific/Auckland', -780, () => {
    const earlyMorning = new Date('2026-11-18T11:30:00Z'); // 12:30am Nov 19 in Auckland
    assert.equal(earlyMorning.toISOString().slice(0, 10), '2026-11-18');
    assert.equal(todayISO(earlyMorning), '2026-11-19');
  });
  if (result === 'unsupported') t.skip('this Node build cannot switch time zones at runtime');
});

test('day math ignores daylight saving changes', (t) => {
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(diffDays('2026-03-01', '2026-04-01'), 31);
  assert.equal(diffDays('2026-10-15', '2026-11-15'), 31);
  const result = inTimeZone('America/New_York', 300, () => {
    // Local noon on the days the clocks change.
    assert.equal(todayISO(new Date(2026, 2, 8, 12)), '2026-03-08');
    assert.equal(todayISO(new Date(2026, 10, 1, 12)), '2026-11-01');
    assert.equal(addDays('2026-03-07', 2), '2026-03-09');
    assert.equal(diffDays('2026-03-07', '2026-03-09'), 2);
  });
  if (result === 'unsupported') t.skip('this Node build cannot switch time zones at runtime');
});

test('adding and subtracting days', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2027-02-28', 1), '2027-03-01');
  assert.equal(diffDays('2026-11-18', '2026-11-18'), 0);
  assert.equal(diffDays('2026-11-18', '2026-11-01'), -17);
  assert.equal(weekday('2026-11-18'), 3); // Wednesday
});

test('leap years and February', () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2027), false);
  assert.equal(isLeapYear(2100), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2027-01-31', 2), '2027-03-31');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2027-01-15', -1), '2026-12-15');
  assert.equal(addMonths('2027-03-31', -1), '2027-02-28');
});

test('date validation', () => {
  assert.equal(isValidISO('2028-02-29'), true);
  assert.equal(isValidISO('2027-02-29'), false);
  assert.equal(isValidISO('2026-13-01'), false);
  assert.equal(isValidISO('2026-1-01'), false);
  assert.equal(isValidISO(20261118), false);
});

test('calendar budget months and days left, counting today', () => {
  const nov = periodFor('2026-11-18', 1);
  assert.deepEqual(nov, { start: '2026-11-01', end: '2026-11-30', nextStart: '2026-12-01', startDay: 1 });
  assert.equal(daysInPeriod(nov), 30);
  assert.equal(daysLeftInPeriod('2026-11-18', nov), 13);
  assert.equal(daysLeftInPeriod('2026-11-30', nov), 1);
  assert.equal(daysLeftInPeriod('2026-11-01', nov), 30);
  assert.equal(daysElapsedInPeriod('2026-11-18', nov), 18);
  assert.equal(daysElapsedInPeriod('2026-11-01', nov), 1);
  assert.equal(daysInPeriod(periodFor('2028-02-10')), 29);
  assert.equal(daysInPeriod(periodFor('2027-02-10')), 28);
  assert.equal(periodFor('2028-02-10').end, '2028-02-29');
  assert.equal(periodFor('2027-02-10').end, '2027-02-28');
});

test('custom month start day', () => {
  assert.deepEqual(periodFor('2026-11-18', 15), { start: '2026-11-15', end: '2026-12-14', nextStart: '2026-12-15', startDay: 15 });
  assert.equal(periodFor('2026-11-14', 15).start, '2026-10-15');
  assert.equal(periodFor('2026-11-15', 15).start, '2026-11-15');
  // Crossing New Year.
  assert.deepEqual(periodFor('2027-01-10', 15), { start: '2026-12-15', end: '2027-01-14', nextStart: '2027-01-15', startDay: 15 });
  // Start day 28 around February, leap and not.
  assert.equal(periodFor('2027-02-28', 28).end, '2027-03-27');
  assert.equal(periodFor('2028-02-27', 28).start, '2028-01-28');
  assert.equal(daysInPeriod(periodFor('2028-02-27', 28)), 31);
  assert.equal(daysInPeriod(periodFor('2028-02-28', 28)), 29);
  assert.equal(daysInPeriod(periodFor('2027-02-28', 28)), 28);
  assert.equal(daysLeftInPeriod('2026-12-14', periodFor('2026-12-14', 15)), 1);
  assert.equal(shiftPeriod(periodFor('2026-11-18', 15), -1).start, '2026-10-15');
  assert.equal(shiftPeriod(periodFor('2026-12-20', 15), 1).start, '2027-01-15');
  assert.equal(clampStartDay(0), 1);
  assert.equal(clampStartDay(31), 28);
  assert.equal(clampStartDay('15'), 15);
  assert.equal(clampStartDay('x'), 1);
});

test('labels show exactly the stored date', () => {
  assert.equal(formatDate('2026-11-18', 'medium'), 'Wed, Nov 18');
  assert.equal(formatDate('2026-11-18', 'short'), 'Nov 18');
  assert.equal(formatDate('2026-11-18', 'full'), 'Nov 18, 2026');
  assert.equal(formatDate('2026-11-18', 'month'), 'November 2026');
  assert.equal(relativeDay('2026-11-18', '2026-11-18'), 'Today');
  assert.equal(relativeDay('2026-11-17', '2026-11-18'), 'Yesterday');
  assert.equal(relativeDay('2026-11-19', '2026-11-18'), 'Tomorrow');
  assert.equal(relativeDay('2026-11-10', '2026-11-18'), 'Tue, Nov 10');
  assert.equal(relativeDay('2025-11-10', '2026-11-18'), 'Nov 10, 2025');
  assert.equal(periodLabel(periodFor('2026-11-18')), 'November 2026');
  assert.equal(periodLabel(periodFor('2026-11-18', 15)), 'Nov 15 to Dec 14');
  assert.equal(periodShortLabel(periodFor('2026-11-18')), 'Nov');
});
