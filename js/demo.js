// Demo data: about six months of made-up student spending, relative to today.
// Deterministic: the same `today` always produces the same numbers (seeded random),
// so the hand calculation in the tests can check it exactly.
import { addDays, addMonths, parseISO, toISO, weekday, daysInMonth } from './dates.js';
import { postDueCharges, newBill, pauseBill } from './recurring.js';
import { paydaysBetween } from './pay.js';
import { defaultData } from './store.js';
import { owedOn, nextClosing, dueDateFor, lastClosing, quarterOf, quarterEnd } from './cards.js';

export const DEMO_DAYS = 182;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoData(today, { now = Date.now() } = {}) {
  const rand = seeded(20261119);
  const cents = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const chance = (p) => rand() < p;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let seq = 0;
  const makeId = () => `demo-${(seq += 1)}`;

  const start = addDays(today, -DEMO_DAYS);
  let data = defaultData({ today, now });
  data.setupDone = true;
  data.balance = { start: 125000, startDate: start };
  data.budget = { limit: 130000, startDay: 1, split: { need: 50, want: 30, savings: 20 } };
  data.goal = { name: 'Spring break', target: 60000, saved: 10000, since: start };
  data.meta.lastBackupAt = now;

  const transactions = [];
  const add = (fields) => transactions.push({
    id: makeId(), type: 'expense', categoryId: null, bucket: null, source: null, note: '',
    createdAt: now, updatedAt: now, ...fields,
  });

  // Paychecks every other Friday, the next one this coming Friday. Hours vary, so the amounts do too.
  const nextFriday = addDays(today, (5 - weekday(today) + 7) % 7 || 7);
  const pay = { amount: 56000, frequency: 'biweekly', anchor: nextFriday, days: null, handledThrough: null };
  const paydays = paydaysBetween(pay, start, today);
  for (const date of paydays) add({ type: 'income', source: 'paycheck', amount: cents(49000, 61500), date });
  pay.handledThrough = paydays.length ? paydays[paydays.length - 1] : addDays(today, -1);
  data.pay = pay;

  // Some months there is a little help from home on the 1st.
  for (let d = toISO(parseISO(start).y, parseISO(start).m, 1); d <= today; d = addMonths(d, 1, 1)) {
    if (d >= start && chance(0.6)) {
      add({ type: 'income', source: 'family', amount: pick([10000, 15000, 20000]), date: d, note: 'Help from home' });
    }
  }

  // Everyday spending.
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const wd = weekday(d);
    const weekend = wd === 0 || wd === 6;
    if (!weekend && chance(0.4)) {
      add({ categoryId: 'coffee', amount: -pick([395, 425, 475, 510, 545, 595]), date: d, note: pick(['Latte', 'Cold brew', 'Iced coffee', 'Coffee before class']) });
    }
    if (chance(weekend ? 0.3 : 0.14)) {
      add({ categoryId: 'eating-out', amount: -cents(899, 2399), date: d, note: pick(['Burrito bowl', 'Pizza with friends', 'Ramen', 'Late-night tacos', 'Sandwich', 'Pho']) });
    }
    if (wd === 0) add({ categoryId: 'groceries', amount: -cents(3800, 7400), date: d, note: 'Weekly groceries' });
    if (chance(0.09)) add({ categoryId: 'transport', amount: -cents(2800, 4200), date: d, note: 'Gas' });
    if (chance(0.035)) {
      add({ categoryId: 'shopping', amount: -cents(1500, 5900), date: d, note: pick(['Hoodie', 'Target run', 'Phone case', 'Shoes on sale']) });
    }
    if (chance(weekend ? 0.09 : 0.03)) {
      add({ categoryId: 'fun', amount: -cents(1000, 4500), date: d, note: pick(['Movie', 'Bowling', 'Game night', 'Mini golf']) });
    }
    if (chance(0.02)) add({ categoryId: 'other', amount: -cents(400, 1500), date: d, note: pick(['Laundry', 'Haircut', 'Printing']) });
  }

  // A few one-offs, including a refund and a purchase flipped from Want to Need.
  add({ categoryId: 'school', amount: -8499, date: addDays(start, 9), note: 'Textbook' });
  add({ categoryId: 'school', amount: -2235, date: addDays(start, 12), note: 'Notebooks and pens' });
  add({ categoryId: 'fun', amount: -6800, date: addDays(today, -66), note: 'Concert tickets' });
  add({ categoryId: 'gifts', amount: -3500, date: addDays(today, -41), note: 'Birthday gift' });
  add({ categoryId: 'eating-out', amount: -1240, bucket: 'need', date: addDays(today, -20), note: 'Lunch between shifts' });
  add({ categoryId: 'eating-out', amount: 1850, date: addDays(today, -9), note: 'Roommate paid me back' });

  // A made-up student credit card, opened when the history starts. Eating out, shopping and fun
  // go on the card (refunds from friends stay in the bank). Autopay pays each statement in full.
  const q = quarterOf(today);
  const card = {
    id: 'demo-card', name: 'Student Card', closingDay: 12, dueDay: 9, limit: 150000, cap: 40000,
    openDate: start, autopay: true, startOwed: 0, startDate: start, statements: {},
    handledDue: null, handledClose: null, quarterSeen: q.key, closed: false, createdAt: now,
    rewards: {
      baseBp: 100,
      firstYearMatch: true,
      bonuses: [
        { id: 'demo-bonus-prev', rateBp: 500, cap: 150000, start: quarterOf(addDays(q.start, -1)).start, end: addDays(q.start, -1), categoryIds: ['fun', 'transport'] },
        { id: 'demo-bonus-now', rateBp: 500, cap: 150000, start: q.start, end: quarterEnd(today), categoryIds: ['eating-out', 'shopping'] },
      ],
    },
  };
  const ON_CARD = new Set(['eating-out', 'shopping', 'fun']);
  for (const tx of transactions) tx.account = tx.type === 'expense' && tx.amount < 0 && ON_CARD.has(tx.categoryId) ? card.id : 'bank';
  add({ type: 'cashback', account: card.id, amount: 1240, date: addDays(today, -50), note: 'Cash back credit' });

  // Bills and subscriptions. Hulu was cancelled (paused) about six weeks ago. Spotify and
  // Netflix charge the card.
  const firstOnDay = (day) => {
    const { y, m } = parseISO(start);
    const date = toISO(y, m, Math.min(day, daysInMonth(y, m)));
    return date < start ? addMonths(date, 1, day) : date;
  };
  const bill = (id, name, amount, categoryId, cadence, next, account = 'bank') =>
    newBill({ name, amount, categoryId, cadence, next, account }, { id: `demo-bill-${id}`, now });
  const bills = [
    bill('rent', 'Rent', 57500, 'rent', 'monthly', firstOnDay(1)),
    bill('phone', 'Phone plan', 4500, 'phone', 'monthly', firstOnDay(28)),
    bill('electric', 'Electric', 3800, 'bills', 'monthly', firstOnDay(18)),
    bill('spotify', 'Spotify', 1199, 'subscriptions', 'monthly', firstOnDay(22), card.id),
    bill('netflix', 'Netflix', 1549, 'subscriptions', 'monthly', firstOnDay(9), card.id),
    bill('icloud', 'iCloud+', 299, 'subscriptions', 'monthly', firstOnDay(14)),
    bill('prime', 'Prime Student', 6900, 'subscriptions', 'yearly', addDays(today, -100)),
    bill('hulu', 'Hulu', 999, 'subscriptions', 'monthly', firstOnDay(12)),
    bill('autosave', 'Auto-save', 5000, 'savings', 'monthly', firstOnDay(3)),
  ];

  data = { ...data, transactions, recurring: bills, cards: [card] };
  ({ data } = postDueCharges(data, addDays(today, -45), { now, makeId }));
  data = { ...data, recurring: data.recurring.map((b) => (b.id === 'demo-bill-hulu' ? pauseBill(b) : b)) };
  ({ data } = postDueCharges(data, today, { now, makeId }));

  // Autopay: every statement that has come due was paid in full from the bank on its due date.
  let lastDue = null;
  for (let closing = nextClosing(card, start); closing <= today; closing = nextClosing(card, closing)) {
    const due = dueDateFor(card, closing);
    if (due > today) break;
    const statement = owedOn(data, card, closing);
    if (statement > 0) {
      data.transactions.push({
        id: makeId(), type: 'cardPayment', amount: statement, account: 'bank', cardId: card.id,
        categoryId: null, bucket: null, source: null, note: '', date: due, createdAt: now, updatedAt: now,
      });
    }
    lastDue = due;
  }
  data.cards = [{ ...card, handledDue: lastDue ?? addDays(today, -1), handledClose: lastClosing(card, today) }];
  return data;
}
