// Recurring bills and subscriptions: schedules, idempotent auto-posting, totals.
// A bill keeps its original `anchor` date so a charge on the 31st lands on the last day of
// shorter months without drifting, and `next` is the next charge that has not posted yet.
import { addDays, addMonths, diffDays, parseISO, maxDate } from './dates.js';
import { newId } from './ids.js';

export const CADENCES = ['weekly', 'monthly', 'yearly'];
export const CADENCE_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
export const CADENCE_UNIT = { weekly: 'week', monthly: 'month', yearly: 'year' };

/** Date of charge number n (0 is the anchor itself). */
export function nthCharge(anchor, cadence, n) {
  if (cadence === 'weekly') return addDays(anchor, 7 * n);
  if (cadence === 'monthly') return addMonths(anchor, n);
  if (cadence === 'yearly') return addMonths(anchor, 12 * n);
  throw new RangeError(`Unknown cadence: ${cadence}`);
}

/** Smallest n >= 0 whose charge falls on or after `from`. */
function firstIndexOnOrAfter(anchor, cadence, from) {
  if (from <= anchor) return 0;
  let n;
  if (cadence === 'weekly') {
    n = Math.floor(diffDays(anchor, from) / 7);
  } else {
    const a = parseISO(anchor);
    const f = parseISO(from);
    const months = (f.y - a.y) * 12 + (f.m - a.m);
    n = cadence === 'monthly' ? months - 1 : Math.floor(months / 12) - 1;
  }
  n = Math.max(0, n);
  while (nthCharge(anchor, cadence, n) < from) n += 1;
  return n;
}

/** Every scheduled charge date from `from` through `to`. */
export function chargeDatesBetween(anchor, cadence, from, to) {
  const out = [];
  if (to < from) return out;
  let n = firstIndexOnOrAfter(anchor, cadence, from);
  for (let d = nthCharge(anchor, cadence, n); d <= to; n += 1, d = nthCharge(anchor, cadence, n)) {
    out.push(d);
  }
  return out;
}

/** First scheduled charge strictly after `date`. */
export function chargeAfter(anchor, cadence, date) {
  return nthCharge(anchor, cadence, firstIndexOnOrAfter(anchor, cadence, addDays(date, 1)));
}

/** First scheduled charge on or after `date`. */
export function chargeOnOrAfter(anchor, cadence, date) {
  return nthCharge(anchor, cadence, firstIndexOnOrAfter(anchor, cadence, date));
}

/** A bill's charge dates from `from` through `to` that have not posted yet. Paused bills have none. */
export function billChargesBetween(bill, from, to) {
  if (!bill.active || to < from) return [];
  const start = maxDate(from, bill.next);
  if (start > to) return [];
  const dates = chargeDatesBetween(bill.anchor, bill.cadence, start, to);
  // `next` normally sits on the schedule. If old data says otherwise, it still counts.
  if (bill.next >= from && bill.next <= to && dates[0] !== bill.next) dates.unshift(bill.next);
  return dates;
}

export const postedKey = (billId, date) => `${billId}:${date}`;

/**
 * Post every bill charge due on or before `today`, exactly once each, dated the day it came due.
 * Safe to run every time the app opens: `next` moves past today and each charge is logged in
 * `posted`, so running it again (or with an old `next`) adds nothing. Pure: returns new data.
 */
export function postDueCharges(data, today, { now = Date.now(), makeId = newId } = {}) {
  const posted = new Set(data.posted);
  const added = [];
  let changed = false;
  const recurring = data.recurring.map((bill) => {
    if (!bill.active || bill.next > today) return bill;
    for (const date of billChargesBetween(bill, bill.next, today)) {
      const key = postedKey(bill.id, date);
      if (posted.has(key)) continue;
      posted.add(key);
      added.push(chargeTransaction(bill, date, makeId(), now));
    }
    changed = true;
    return { ...bill, next: chargeAfter(bill.anchor, bill.cadence, today) };
  });
  if (!changed) return { data, added };
  return {
    data: { ...data, recurring, transactions: [...data.transactions, ...added], posted: [...posted] },
    added,
  };
}

function chargeTransaction(bill, date, id, now) {
  return {
    id,
    type: 'expense',
    amount: -bill.amount,
    categoryId: bill.categoryId,
    bucket: null,
    source: null,
    note: bill.name,
    date,
    recurringId: bill.id,
    recurringDate: date,
    createdAt: now,
    updatedAt: now,
  };
}

/** A new bill. Its schedule is anchored on the first charge date. */
export function newBill({ name, amount, categoryId, cadence, next }, { id = newId(), now = Date.now() } = {}) {
  return { id, name: String(name).trim(), amount, categoryId, cadence, anchor: next, next, active: true, createdAt: now };
}

/**
 * Apply edits to a bill. Charges already posted are separate transactions, so they never change.
 * A new next date or cadence re-anchors the schedule on that date.
 */
export function editBill(bill, changes) {
  const out = { ...bill };
  if (changes.name !== undefined) out.name = String(changes.name).trim();
  if (changes.amount !== undefined) out.amount = changes.amount;
  if (changes.categoryId !== undefined) out.categoryId = changes.categoryId;
  const nextChanged = changes.next !== undefined && changes.next !== bill.next;
  const cadenceChanged = changes.cadence !== undefined && changes.cadence !== bill.cadence;
  if (nextChanged || cadenceChanged) {
    out.cadence = changes.cadence ?? bill.cadence;
    out.next = changes.next ?? bill.next;
    out.anchor = out.next;
  }
  return out;
}

export function pauseBill(bill) {
  return { ...bill, active: false };
}

/** Resume a paused bill. Charges missed while paused are skipped, never back-posted. */
export function resumeBill(bill, today) {
  return { ...bill, active: true, next: chargeOnOrAfter(bill.anchor, bill.cadence, today) };
}

/** How many past charges a bill would post right away if saved with this next date. */
export function pastChargeCount(cadence, next, today) {
  if (next > today) return 0;
  return chargeDatesBetween(next, cadence, next, today).length;
}

export function yearlyCost(bill) {
  if (bill.cadence === 'weekly') return bill.amount * 52;
  if (bill.cadence === 'monthly') return bill.amount * 12;
  return bill.amount;
}

export function monthlyCost(bill) {
  return Math.round(yearlyCost(bill) / 12);
}

/** Totals for the Bills screen. Per month is the yearly total spread evenly over 12 months. */
export function billTotals(bills) {
  let perYear = 0;
  let pausedPerYear = 0;
  for (const b of bills) {
    if (b.active) perYear += yearlyCost(b);
    else pausedPerYear += yearlyCost(b);
  }
  return {
    perYear,
    perMonth: Math.round(perYear / 12),
    pausedPerYear,
    pausedPerMonth: Math.round(pausedPerYear / 12),
  };
}

/** Every active charge from `from` through `to`, sorted by date then name. */
export function upcomingCharges(bills, from, to) {
  const out = [];
  for (const bill of bills) {
    for (const date of billChargesBetween(bill, from, to)) {
      out.push({ billId: bill.id, name: bill.name, amount: bill.amount, categoryId: bill.categoryId, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}
