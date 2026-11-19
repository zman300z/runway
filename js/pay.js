// Pay schedule: paydays, the next payday, paydays waiting to be confirmed, monthly pay.
import { addDays, diffDays, parseISO, toISO, daysInMonth, maxDate } from './dates.js';

export const FREQUENCIES = ['weekly', 'biweekly', 'semimonthly', 'monthly'];
export const FREQUENCY_LABEL = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Once a month',
};
/** In `days` for twice-a-month pay, 31 means "the last day of the month". */
export const LAST_DAY = 31;

function stepDates(anchor, step, from, to) {
  const out = [];
  let n = Math.ceil(diffDays(anchor, from) / step);
  for (let d = addDays(anchor, n * step); d <= to; n += 1, d = addDays(anchor, n * step)) out.push(d);
  return out;
}

function monthDayDates(days, from, to) {
  const out = [];
  const f = parseISO(from);
  const t = parseISO(to);
  let y = f.y;
  let m = f.m;
  while (y < t.y || (y === t.y && m <= t.m)) {
    const dim = daysInMonth(y, m);
    const dates = [...new Set(days.map((d) => toISO(y, m, Math.min(d, dim))))].sort();
    for (const date of dates) if (date >= from && date <= to) out.push(date);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return out;
}

/** Every payday from `from` through `to`. */
export function paydaysBetween(pay, from, to) {
  if (!pay || to < from) return [];
  switch (pay.frequency) {
    case 'weekly':
      return stepDates(pay.anchor, 7, from, to);
    case 'biweekly':
      return stepDates(pay.anchor, 14, from, to);
    case 'monthly':
      return monthDayDates([parseISO(pay.anchor).d], from, to);
    case 'semimonthly':
      return monthDayDates(pay.days?.length ? pay.days : [1, 15], from, to);
    default:
      return [];
  }
}

/**
 * Paydays you can count on from `from` through `to`: never earlier than the first payday you
 * entered (the anchor), even though the schedule could be stepped backward from it.
 */
export function expectedPaydays(pay, from, to) {
  if (!pay) return [];
  return paydaysBetween(pay, maxDate(from, pay.anchor), to);
}

/** The first payday strictly after `date` (and not before your first payday), or null. */
export function nextPayday(pay, date) {
  if (!pay) return null;
  const from = maxDate(addDays(date, 1), pay.anchor);
  return paydaysBetween(pay, from, addDays(from, 70))[0] ?? null;
}

/**
 * Paydays that have arrived and are not confirmed or dismissed yet, oldest first.
 * Nothing before the schedule's anchor counts.
 */
export function pendingPaydays(pay, today) {
  if (!pay) return [];
  let from = pay.anchor;
  if (pay.handledThrough) {
    const afterHandled = addDays(pay.handledThrough, 1);
    if (afterHandled > from) from = afterHandled;
  }
  return paydaysBetween(pay, from, today);
}

/** Usual pay converted to a monthly amount. */
export function monthlyPay(pay) {
  if (!pay || !pay.amount) return 0;
  switch (pay.frequency) {
    case 'weekly':
      return Math.round((pay.amount * 52) / 12);
    case 'biweekly':
      return Math.round((pay.amount * 26) / 12);
    case 'semimonthly':
      return pay.amount * 2;
    case 'monthly':
      return pay.amount;
    default:
      return 0;
  }
}

/**
 * Suggested monthly spending limit: 80% of monthly pay (the 50% needs and 30% wants of
 * 50/30/20), rounded down to a whole $10.
 */
export function suggestedLimit(pay) {
  const monthly = monthlyPay(pay);
  return Math.floor((monthly * 8) / 10000) * 1000;
}

/** Twice-a-month days in words: [15, 31] becomes "15th and last day". */
export function describeDays(days) {
  const name = (d) => (d >= LAST_DAY ? 'last day' : ordinal(d));
  return days.map(name).join(' and ');
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
