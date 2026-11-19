// Every change to your data, as a pure function: data in, new data out.
// The UI calls these, then saves. Keeping them pure makes them easy to test.
import { newId } from './ids.js';
import { MAX_CENTS } from './money.js';
import { addDays, isValidISO, clampStartDay } from './dates.js';
import { balanceOn } from './budget.js';
import { postDueCharges, newBill, editBill, pauseBill, resumeBill, CADENCES } from './recurring.js';
import { INCOME_SOURCE_IDS, BUCKETS, removeCategory } from './categories.js';
import { FREQUENCIES, paydaysBetween } from './pay.js';

const TYPES = ['expense', 'income', 'adjustment'];
export const NOTE_MAX = 140;
export const NAME_MAX = 40;

export function cleanText(text, max) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

const amountOk = (n) => Number.isSafeInteger(n) && n !== 0 && Math.abs(n) <= MAX_CENTS;

/** Build a clean, validated transaction. Throws an Error with a friendly message. */
export function makeTransaction(f, { id = newId(), now = Date.now() } = {}) {
  if (!TYPES.includes(f.type)) throw new Error('Unknown transaction type.');
  if (!amountOk(f.amount)) throw new Error('Enter an amount.');
  if (!isValidISO(f.date)) throw new Error('Pick a date.');
  if (f.type === 'income' && f.amount < 0) throw new Error('Income must be more than $0.');
  const tx = {
    id, type: f.type, amount: f.amount, categoryId: null, bucket: null, source: null,
    note: cleanText(f.note, NOTE_MAX), date: f.date, createdAt: now, updatedAt: now,
  };
  if (f.type === 'expense') {
    if (!f.categoryId) throw new Error('Pick a category.');
    tx.categoryId = f.categoryId;
    tx.bucket = f.bucket === 'need' || f.bucket === 'want' ? f.bucket : null;
  }
  if (f.type === 'income') tx.source = INCOME_SOURCE_IDS.includes(f.source) ? f.source : 'other';
  if (f.recurringId) {
    tx.recurringId = f.recurringId;
    tx.recurringDate = f.recurringDate;
  }
  return tx;
}

export function addTransaction(data, fields, opts = {}) {
  const tx = makeTransaction(fields, opts);
  return { data: { ...data, transactions: [...data.transactions, tx] }, tx };
}

export function updateTransaction(data, id, fields, { now = Date.now() } = {}) {
  const index = data.transactions.findIndex((t) => t.id === id);
  if (index === -1) throw new Error('That transaction no longer exists.');
  const old = data.transactions[index];
  const tx = makeTransaction(
    { ...old, ...fields, recurringId: old.recurringId, recurringDate: old.recurringDate },
    { id: old.id, now: old.createdAt },
  );
  tx.updatedAt = now;
  const transactions = data.transactions.slice();
  transactions[index] = tx;
  return { data: { ...data, transactions }, tx };
}

/** Remove a transaction. Returns what was removed so Undo can put it back. */
export function deleteTransaction(data, id) {
  const index = data.transactions.findIndex((t) => t.id === id);
  if (index === -1) return { data, removed: null };
  return {
    data: { ...data, transactions: data.transactions.filter((t) => t.id !== id) },
    removed: { tx: data.transactions[index], index },
  };
}

export function restoreTransaction(data, removed) {
  if (!removed || data.transactions.some((t) => t.id === removed.tx.id)) return data;
  const transactions = data.transactions.slice();
  transactions.splice(Math.min(removed.index, transactions.length), 0, removed.tx);
  return { ...data, transactions };
}

/**
 * Match Runway's balance to what the bank says by adding an Adjustment for the difference.
 * With no balance set yet, the bank balance simply becomes the starting balance.
 */
export function reconcile(data, actual, today, opts = {}) {
  if (!Number.isSafeInteger(actual) || Math.abs(actual) > MAX_CENTS) throw new Error('Enter your bank balance.');
  if (!data.balance) return { data: setBalanceNow(data, actual, today), diff: null, tx: null };
  const diff = actual - balanceOn(data, today);
  if (diff === 0) return { data, diff: 0, tx: null };
  const { data: next, tx } = addTransaction(
    data,
    { type: 'adjustment', amount: diff, date: today, note: 'Matched to bank balance' },
    opts,
  );
  return { data: next, diff, tx };
}

export function setBalance(data, start, startDate, today = null) {
  if (start === null) return { ...data, balance: null };
  if (!Number.isSafeInteger(start) || Math.abs(start) > MAX_CENTS) throw new Error('Enter your balance.');
  if (!isValidISO(startDate)) throw new Error('Pick a date.');
  if (today && startDate > today) throw new Error("The date can't be in the future.");
  return { ...data, balance: { start, startDate } };
}

/**
 * Set the balance from what the bank says right now. Anything already logged today is part of
 * that number, so the start-of-day balance is the typed amount minus today's logged changes.
 */
export function setBalanceNow(data, actual, today) {
  let todayNet = 0;
  for (const t of data.transactions) if (t.date === today) todayNet += t.amount;
  return setBalance(data, actual - todayNet, today, today);
}

// Pay

/**
 * Save the pay schedule. Paydays before today are treated as handled, so changing your
 * schedule never brings back old "Did you get paid?" banners.
 */
export function setPay(data, pay, today) {
  if (pay === null) return { ...data, pay: null };
  const { amount, frequency } = pay;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CENTS) throw new Error('Enter your usual paycheck.');
  if (!FREQUENCIES.includes(frequency)) throw new Error('Pick how often you get paid.');
  let anchor = pay.anchor;
  let days = null;
  if (frequency === 'semimonthly') {
    days = [...new Set((pay.days ?? []).map(Number))].filter((d) => Number.isInteger(d) && d >= 1 && d <= 31).sort((a, b) => a - b);
    if (days.length !== 2) throw new Error('Pick two different paydays.');
    anchor = today;
  }
  if (!isValidISO(anchor)) throw new Error('Pick your next payday.');
  // Same schedule (only the amount changed)? Keep it, so an unanswered payday still asks.
  const old = data.pay;
  if (old && old.frequency === frequency) {
    const same = frequency === 'semimonthly'
      ? (old.days ?? []).join() === days.join()
      : paydaysBetween(old, anchor, anchor).length === 1;
    if (same) return { ...data, pay: { ...old, amount } };
  }
  const yesterday = addDays(today, -1);
  const prev = data.pay?.handledThrough;
  return {
    ...data,
    pay: { amount, frequency, anchor, days, handledThrough: prev && prev > yesterday ? prev : yesterday },
  };
}

export function markPaydayHandled(data, date) {
  if (!data.pay) return data;
  const prev = data.pay.handledThrough;
  return { ...data, pay: { ...data.pay, handledThrough: prev && prev > date ? prev : date } };
}

/** "Yes, I got paid": add the paycheck as income on that payday. */
export function confirmPayday(data, date, amount, opts = {}) {
  const { data: next, tx } = addTransaction(data, { type: 'income', amount, source: 'paycheck', date, note: '' }, opts);
  return { data: markPaydayHandled(next, date), tx };
}

// Bills and subscriptions

function checkBill(f) {
  if (!cleanText(f.name, NAME_MAX)) throw new Error('Give it a name.');
  if (!Number.isSafeInteger(f.amount) || f.amount <= 0 || f.amount > MAX_CENTS) throw new Error('Enter an amount.');
  if (!f.categoryId) throw new Error('Pick a category.');
  if (!CADENCES.includes(f.cadence)) throw new Error('Pick how often it charges.');
  if (!isValidISO(f.next)) throw new Error('Pick the next charge date.');
}

export function addBill(data, fields, opts = {}) {
  checkBill(fields);
  const bill = newBill({ ...fields, name: cleanText(fields.name, NAME_MAX) }, opts);
  return { data: { ...data, recurring: [...data.recurring, bill] }, bill };
}

export function updateBill(data, id, changes) {
  const old = data.recurring.find((b) => b.id === id);
  if (!old) throw new Error('That bill no longer exists.');
  const merged = { ...old, ...changes };
  checkBill(merged);
  const bill = editBill(old, { ...changes, ...(changes.name !== undefined ? { name: cleanText(changes.name, NAME_MAX) } : {}) });
  return { ...data, recurring: data.recurring.map((b) => (b.id === id ? bill : b)) };
}

export function setBillActive(data, id, active, today) {
  return {
    ...data,
    recurring: data.recurring.map((b) => {
      if (b.id !== id || b.active === active) return b;
      return active ? resumeBill(b, today) : pauseBill(b);
    }),
  };
}

/** Delete a bill. Charges it already posted stay in your history. */
export function deleteBill(data, id) {
  return { ...data, recurring: data.recurring.filter((b) => b.id !== id) };
}

// Categories

function checkCategory(c) {
  if (!cleanText(c.name, NAME_MAX)) throw new Error('Give the category a name.');
  if (!BUCKETS.includes(c.bucket)) throw new Error('Pick Need, Want or Savings.');
  if (c.limit !== null && !(Number.isSafeInteger(c.limit) && c.limit > 0 && c.limit <= MAX_CENTS)) {
    throw new Error('Enter a limit, or leave it empty.');
  }
}

export function addCategory(data, fields, { id = newId() } = {}) {
  const cat = {
    id,
    name: cleanText(fields.name, NAME_MAX),
    emoji: cleanText(fields.emoji, 16) || '📦',
    color: fields.color || '#868E96',
    bucket: fields.bucket,
    limit: fields.limit ?? null,
  };
  checkCategory(cat);
  return { data: { ...data, categories: [...data.categories, cat] }, category: cat };
}

export function updateCategory(data, id, changes) {
  const old = data.categories.find((c) => c.id === id);
  if (!old) throw new Error('That category no longer exists.');
  const cat = { ...old, ...changes };
  if (changes.name !== undefined) cat.name = cleanText(changes.name, NAME_MAX);
  if (changes.emoji !== undefined) cat.emoji = cleanText(changes.emoji, 16) || old.emoji;
  checkCategory(cat);
  return { ...data, categories: data.categories.map((c) => (c.id === id ? cat : c)) };
}

/** Move a category to a new position in the list. */
export function moveCategory(data, id, toIndex) {
  const from = data.categories.findIndex((c) => c.id === id);
  if (from === -1) return data;
  const categories = data.categories.slice();
  const [cat] = categories.splice(from, 1);
  categories.splice(Math.max(0, Math.min(toIndex, categories.length)), 0, cat);
  return { ...data, categories };
}

export function deleteCategory(data, id, moveToId) {
  return removeCategory(data, id, moveToId);
}

// Budget and goal

export function setBudget(data, { limit, startDay, split }) {
  const budget = { ...data.budget };
  if (limit !== undefined) {
    if (limit !== null && !(Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_CENTS)) {
      throw new Error('Enter a monthly limit.');
    }
    budget.limit = limit;
  }
  if (startDay !== undefined) budget.startDay = clampStartDay(startDay);
  if (split !== undefined) {
    const s = { need: Number(split.need), want: Number(split.want), savings: Number(split.savings) };
    if (![s.need, s.want, s.savings].every((v) => Number.isInteger(v) && v >= 0 && v <= 100)
      || s.need + s.want + s.savings !== 100) {
      throw new Error('The three parts must add up to 100%.');
    }
    budget.split = s;
  }
  return { ...data, budget };
}

export function setGoal(data, goal, today) {
  if (goal === null) return { ...data, goal: null };
  const name = cleanText(goal.name, NAME_MAX);
  if (!name) throw new Error('Name your goal.');
  if (!Number.isSafeInteger(goal.target) || goal.target <= 0 || goal.target > MAX_CENTS) throw new Error('Enter a target amount.');
  const saved = goal.saved ?? 0;
  if (!Number.isSafeInteger(saved) || saved < 0 || saved > MAX_CENTS) throw new Error('Enter what you have already saved.');
  return { ...data, goal: { name, target: goal.target, saved, since: data.goal?.since ?? goal.since ?? today } };
}

/** Remember when you last exported a backup. */
export function markBackedUp(data, now = Date.now()) {
  return { ...data, meta: { ...data.meta, lastBackupAt: now } };
}

export function setSetting(data, key, value) {
  return { ...data, settings: { ...data.settings, [key]: value } };
}

/** Run on every open, on resume and at midnight: post due bills and remember the day. */
export function runDailyJobs(data, today, opts = {}) {
  const { data: posted, added } = postDueCharges(data, today, opts);
  const out = posted.meta?.lastOpened === today ? posted : { ...posted, meta: { ...posted.meta, lastOpened: today } };
  return { data: out, added };
}
