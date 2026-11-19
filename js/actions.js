// Every change to your data, as a pure function: data in, new data out.
// The UI calls these, then saves. Keeping them pure makes them easy to test.
import { newId } from './ids.js';
import { MAX_CENTS } from './money.js';
import { addDays, isValidISO, clampStartDay } from './dates.js';
import { balanceOn } from './budget.js';
import { postDueCharges, newBill, editBill, pauseBill, resumeBill, CADENCES } from './recurring.js';
import { INCOME_SOURCE_IDS, BUCKETS, removeCategory, FEES_CATEGORY } from './categories.js';
import { FREQUENCIES, paydaysBetween } from './pay.js';
import { BANK, bankEffect, findCard, owedOn, lastClosing } from './cards.js';

const TYPES = ['expense', 'income', 'adjustment', 'cardPayment', 'cashback'];
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
  if ((f.type === 'cardPayment' || f.type === 'cashback') && f.amount < 0) throw new Error('Enter an amount.');
  // Which account it hit: "bank" (Debit) or a card id. A card payment always leaves the bank.
  const account = f.type === 'cardPayment' ? BANK : f.account || BANK;
  if (f.type === 'income' && account !== BANK) throw new Error('Income goes into your bank account.');
  if (f.type === 'cashback' && account === BANK) throw new Error('Pick the card that got the credit.');
  const tx = {
    id, type: f.type, amount: f.amount, account, categoryId: null, bucket: null, source: null,
    note: cleanText(f.note, NOTE_MAX), date: f.date, createdAt: now, updatedAt: now,
  };
  if (f.type === 'cardPayment') {
    if (!f.cardId) throw new Error('Pick a card.');
    tx.cardId = f.cardId;
  }
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

/** A card that a transaction points at must exist. */
function checkAccounts(data, tx) {
  if (tx.account !== BANK && !findCard(data, tx.account)) throw new Error('That card no longer exists.');
  if (tx.type === 'cardPayment' && !findCard(data, tx.cardId)) throw new Error('That card no longer exists.');
}

export function addTransaction(data, fields, opts = {}) {
  const tx = makeTransaction(fields, opts);
  checkAccounts(data, tx);
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
  checkAccounts(data, tx);
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
  for (const t of data.transactions) if (t.date === today) todayNet += bankEffect(t);
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

function checkBill(f, data) {
  if (!cleanText(f.name, NAME_MAX)) throw new Error('Give it a name.');
  if (f.account && f.account !== BANK && !findCard(data, f.account)) throw new Error('That card no longer exists.');
  if (!Number.isSafeInteger(f.amount) || f.amount <= 0 || f.amount > MAX_CENTS) throw new Error('Enter an amount.');
  if (!f.categoryId) throw new Error('Pick a category.');
  if (!CADENCES.includes(f.cadence)) throw new Error('Pick how often it charges.');
  if (!isValidISO(f.next)) throw new Error('Pick the next charge date.');
}

export function addBill(data, fields, opts = {}) {
  checkBill(fields, data);
  const bill = newBill({ ...fields, name: cleanText(fields.name, NAME_MAX) }, opts);
  return { data: { ...data, recurring: [...data.recurring, bill] }, bill };
}

export function updateBill(data, id, changes) {
  const old = data.recurring.find((b) => b.id === id);
  if (!old) throw new Error('That bill no longer exists.');
  const merged = { ...old, ...changes };
  checkBill(merged, data);
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

// Credit cards

const dayOk = (d) => Number.isInteger(d) && d >= 1 && d <= 31;
const rateOk = (bp) => Number.isSafeInteger(bp) && bp >= 0 && bp <= 10000;

/** Cash back settings. Rates are basis points (1% is 100) so the math stays in whole numbers. */
function cleanRewards(r) {
  if (!r) return null;
  const baseBp = r.baseBp ?? 0;
  if (!rateOk(baseBp)) throw new Error('Enter a cash back rate from 0% to 100%.');
  const bonuses = (r.bonuses ?? []).map((b) => {
    if (!rateOk(b.rateBp)) throw new Error('Enter a bonus rate from 0% to 100%.');
    if (!Number.isSafeInteger(b.cap) || b.cap < 0 || b.cap > MAX_CENTS) throw new Error('Enter the bonus spending cap.');
    if (!isValidISO(b.start) || !isValidISO(b.end)) throw new Error('Pick the bonus start and end dates.');
    if (b.end < b.start) throw new Error('The bonus end date must be after its start date.');
    return { id: b.id || newId(), rateBp: b.rateBp, cap: b.cap, start: b.start, end: b.end, categoryIds: [...new Set(b.categoryIds ?? [])] };
  });
  return { baseBp, firstYearMatch: Boolean(r.firstYearMatch), bonuses };
}

function checkCard(c) {
  if (!c.name) throw new Error('Give the card a name.');
  if (!dayOk(c.closingDay)) throw new Error('Pick the statement closing day.');
  if (!dayOk(c.dueDay)) throw new Error('Pick the payment due day.');
  if (!Number.isSafeInteger(c.limit) || c.limit <= 0 || c.limit > MAX_CENTS) throw new Error('Enter the credit limit.');
  if (c.cap !== null && !(Number.isSafeInteger(c.cap) && c.cap > 0 && c.cap <= MAX_CENTS)) {
    throw new Error('Enter a monthly cap, or leave it empty.');
  }
  if (!isValidISO(c.openDate)) throw new Error('Pick the date the account opened.');
}

/**
 * Add a card. Runway starts watching it today, so old closing and due dates never prompt.
 * `startOwed` is what you owe on it right now (0 for a new card). With a balance, purchases
 * count from today; without one, every purchase since the account opened counts.
 */
export function addCard(data, f, { id = newId(), now = Date.now(), today }) {
  const startOwed = f.startOwed ?? 0;
  if (!Number.isSafeInteger(startOwed) || startOwed < 0 || startOwed > MAX_CENTS) {
    throw new Error('Enter what you owe on it now, or leave it empty.');
  }
  const card = {
    id,
    name: cleanText(f.name, NAME_MAX),
    closingDay: Number(f.closingDay),
    dueDay: Number(f.dueDay),
    limit: f.limit,
    cap: f.cap ?? null,
    openDate: f.openDate,
    autopay: Boolean(f.autopay),
    startOwed,
    startDate: startOwed || f.openDate > today ? today : f.openDate,
    statements: {},
    handledDue: today,
    handledClose: null,
    quarterSeen: null,
    rewards: cleanRewards(f.rewards),
    closed: false,
    createdAt: now,
  };
  checkCard(card);
  card.handledClose = lastClosing(card, today);
  return { data: { ...data, cards: [...(data.cards ?? []), card] }, card };
}

/** Edit a card's settings. What you owe comes from your history, so it never changes here. */
export function updateCard(data, id, changes) {
  const old = findCard(data, id);
  if (!old) throw new Error('That card no longer exists.');
  const card = { ...old };
  if (changes.name !== undefined) card.name = cleanText(changes.name, NAME_MAX);
  if (changes.closingDay !== undefined) card.closingDay = Number(changes.closingDay);
  if (changes.dueDay !== undefined) card.dueDay = Number(changes.dueDay);
  if (changes.limit !== undefined) card.limit = changes.limit;
  if (changes.cap !== undefined) card.cap = changes.cap;
  if (changes.openDate !== undefined) card.openDate = changes.openDate;
  if (changes.autopay !== undefined) card.autopay = Boolean(changes.autopay);
  if (changes.rewards !== undefined) card.rewards = cleanRewards(changes.rewards);
  checkCard(card);
  return { ...data, cards: data.cards.map((c) => (c.id === id ? card : c)) };
}

/** A card nothing points at can be deleted. A card with history can only be closed. */
export function cardInUse(data, id) {
  return data.transactions.some((t) => t.account === id || t.cardId === id) || data.recurring.some((b) => b.account === id);
}

export function deleteCard(data, id) {
  if (cardInUse(data, id)) throw new Error('This card has history, so it can be closed but not deleted.');
  return { ...data, cards: data.cards.filter((c) => c.id !== id) };
}

/** Close a card (hidden from Quick Add and Home). Only once it is paid off and has no bills. */
export function closeCard(data, id, today) {
  const card = findCard(data, id);
  if (!card) throw new Error('That card no longer exists.');
  if (owedOn(data, card, today) !== 0) throw new Error('Pay the card off before closing it.');
  if (data.recurring.some((b) => b.account === id)) throw new Error('Move its bills to Debit or another card first.');
  return { ...data, cards: data.cards.map((c) => (c.id === id ? { ...c, closed: true } : c)) };
}

export function reopenCard(data, id) {
  return { ...data, cards: data.cards.map((c) => (c.id === id ? { ...c, closed: false } : c)) };
}

/** Pay the card from the bank. Never spending: it only moves money from the bank to the card. */
export function payCard(data, cardId, amount, date, opts = {}) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter how much you paid.');
  return addTransaction(data, { type: 'cardPayment', cardId, amount, date, note: '' }, opts);
}

/** A due date's prompt was answered. */
export function markCardDueHandled(data, cardId, due) {
  return {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId && !(c.handledDue && c.handledDue >= due) ? { ...c, handledDue: due } : c)),
  };
}

/** "Card payment due": record what left the bank (0 means it didn't) and stop asking. */
export function answerCardDue(data, cardId, due, amount, opts = {}) {
  let next = data;
  let tx = null;
  if (amount > 0) ({ data: next, tx } = payCard(data, cardId, amount, due, opts));
  return { data: markCardDueHandled(next, cardId, due), tx };
}

/**
 * Use the statement balance from your card app. This only moves money between "statement
 * balance" and "new charges". The total you owe never changes here (Card Reconcile does that).
 */
export function confirmStatement(data, cardId, closing, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_CENTS) throw new Error('Enter the statement balance.');
  if (!isValidISO(closing)) throw new Error('Pick the closing date.');
  return {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId
      ? { ...c, statements: { ...c.statements, [closing]: amount }, handledClose: c.handledClose && c.handledClose > closing ? c.handledClose : closing }
      : c)),
  };
}

/** The "statement closed" banner was dismissed without changing anything. */
export function markStatementHandled(data, cardId, closing) {
  return {
    ...data,
    cards: data.cards.map((c) => (c.id === cardId && !(c.handledClose && c.handledClose >= closing) ? { ...c, handledClose: closing } : c)),
  };
}

/** Stop the start-of-quarter bonus reminder until the next quarter. */
export function dismissQuarterReminder(data, cardId, quarterKey) {
  return { ...data, cards: data.cards.map((c) => (c.id === cardId ? { ...c, quarterSeen: quarterKey } : c)) };
}

/**
 * Cash back. As a statement credit it lowers what you owe on the card (not income, not
 * spending). Sent to the bank it is income from "Rewards".
 */
export function addCashback(data, cardId, amount, date, mode, opts = {}) {
  const card = findCard(data, cardId);
  if (!card) throw new Error('That card no longer exists.');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter how much cash back you redeemed.');
  if (mode === 'bank') {
    return addTransaction(data, { type: 'income', source: 'rewards', amount, date, note: `${card.name} cash back` }, opts);
  }
  return addTransaction(data, { type: 'cashback', account: cardId, amount, date, note: 'Cash back credit' }, opts);
}

/**
 * Card Reconcile: make what Runway says you owe match your card app.
 * reason "fees": interest or fees, logged as spending in "Fees & interest" (a Want), so it
 * counts against your monthly limit. Anything else: a plain adjustment that only changes what
 * you owe, never spending.
 */
export function cardReconcile(data, cardId, actualOwed, today, reason, opts = {}) {
  const card = findCard(data, cardId);
  if (!card) throw new Error('That card no longer exists.');
  if (!Number.isSafeInteger(actualOwed) || Math.abs(actualOwed) > MAX_CENTS) throw new Error('Enter what your card app says.');
  const diff = actualOwed - owedOn(data, card, today);
  if (diff === 0) return { data, diff: 0, tx: null };
  if (reason === 'fees') {
    if (diff < 0) throw new Error('Interest and fees can only raise what you owe.');
    const withFees = data.categories.some((c) => c.id === FEES_CATEGORY.id)
      ? data
      : { ...data, categories: [...data.categories, { ...FEES_CATEGORY }] };
    const r = addTransaction(withFees, {
      type: 'expense', account: cardId, categoryId: FEES_CATEGORY.id, amount: -diff, date: today, note: 'Interest and fees',
    }, opts);
    return { data: r.data, diff, tx: r.tx };
  }
  const r = addTransaction(data, { type: 'adjustment', account: cardId, amount: -diff, date: today, note: 'Matched to card app' }, opts);
  return { data: r.data, diff, tx: r.tx };
}
