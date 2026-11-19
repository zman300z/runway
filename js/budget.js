// Budget math: balance, safe-to-spend, the balance guard, pace, warnings, goal and charts data.
// Every function is pure: (data, today) in, numbers out. All amounts are integer cents.
import {
  periodFor, shiftPeriod, addDays, diffDays, daysInPeriod, daysLeftInPeriod, daysElapsedInPeriod, maxDate,
} from './dates.js';
import { upcomingCharges } from './recurring.js';
import { nextPayday, expectedPaydays, monthlyPay } from './pay.js';
import { categoryMap, effectiveBucket } from './categories.js';
import { bankEffect, cardPaymentsDue, cardSummary, activeCards, totalOwed } from './cards.js';

export const DEFAULT_SPLIT = Object.freeze({ need: 50, want: 30, savings: 20 });

const sum = (list, pick) => {
  let total = 0;
  for (const item of list) total += pick(item);
  return total;
};

/** Daily allowance: an amount spread over some days, rounded down, never below 0. */
const perDay = (amount, days) => (amount > 0 ? Math.floor(amount / Math.max(1, days)) : 0);

/** Spending effect of a transaction: purchases are positive, refunds negative, the rest 0. */
export const spendOf = (tx) => (tx.type === 'expense' ? -tx.amount : 0);

/**
 * Bank balance at the end of `date`: the starting balance plus every bank transaction dated from
 * the start date through `date` (earlier ones were already in the starting balance). Card
 * purchases don't touch the bank; card payments do.
 */
export function balanceOn(data, date) {
  if (!data.balance) return null;
  const { start, startDate } = data.balance;
  let total = start;
  for (const tx of data.transactions) {
    if (tx.date >= startDate && tx.date <= date) total += bankEffect(tx);
  }
  return total;
}

/** Totals for one budget month. "spent" is Need plus Want (refunds subtract); Savings is separate. */
export function periodTotals(data, period, cats = categoryMap(data.categories)) {
  const t = {
    need: 0, want: 0, savings: 0, spent: 0, outflow: 0, income: 0, billsPosted: 0,
    byCategory: new Map(), expenseCount: 0,
  };
  for (const tx of data.transactions) {
    if (tx.date < period.start || tx.date > period.end) continue;
    if (tx.type === 'income') {
      t.income += tx.amount;
      continue;
    }
    if (tx.type !== 'expense') continue;
    const s = -tx.amount;
    const bucket = effectiveBucket(tx, cats);
    t[bucket] += s;
    t.outflow += s;
    t.expenseCount += 1;
    if (bucket !== 'savings') {
      t.spent += s;
      if (tx.recurringId) t.billsPosted += s;
      t.byCategory.set(tx.categoryId, (t.byCategory.get(tx.categoryId) ?? 0) + s);
    }
  }
  return t;
}

/** Bill charges from `from` through `to`, each marked as savings or not. */
function chargesBetween(data, from, to, cats) {
  return upcomingCharges(data.recurring, from, to).map((c) => ({
    ...c,
    savings: cats.get(c.categoryId)?.bucket === 'savings',
    bank: (c.account ?? 'bank') === 'bank',
  }));
}

/** Everything Home needs, worked out once per render. */
export function summarize(data, today) {
  const cats = categoryMap(data.categories);
  const period = periodFor(today, data.budget?.startDay ?? 1);
  const daysLeft = daysLeftInPeriod(today, period);
  const daysTotal = daysInPeriod(period);
  const daysElapsed = daysElapsedInPeriod(today, period);
  const totals = periodTotals(data, period, cats);
  const tomorrow = addDays(today, 1);

  // Bills still to come this budget month. Today's charges have already posted.
  const scheduled = chargesBetween(data, tomorrow, period.end, cats);
  const scheduledSpend = sum(scheduled.filter((c) => !c.savings), (c) => c.amount);
  const scheduledAll = sum(scheduled, (c) => c.amount);

  // View 1, the budget: what is left of the monthly limit.
  const rawLimit = data.budget?.limit;
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : null;
  const budgetMonth = limit === null ? null : limit - totals.spent - scheduledSpend;
  const budgetDaily = budgetMonth === null ? null : perDay(budgetMonth, daysLeft);

  // View 2, the cash: what the bank balance covers until the next paycheck.
  // An unconfirmed paycheck is never counted. No pay schedule means "until the month ends".
  const balance = balanceOn(data, today);
  const payday = nextPayday(data.pay, today);
  const horizon = payday ?? period.nextStart; // first day NOT covered
  const lastCashDay = addDays(horizon, -1);
  // Only bills paid from the bank leave the bank; bills on a card wait for the card payment.
  const billsSoon = chargesBetween(data, tomorrow, lastCashDay, cats).filter((c) => c.bank);
  const billsBeforeHorizon = sum(billsSoon, (c) => c.amount);
  // Card payments due before payday come out of the bank like a bill.
  const cardDueItems = balance === null ? [] : cardPaymentsDue(data, today, horizon);
  const cardDue = sum(cardDueItems, (c) => c.amount);
  const futureOutflows = balance === null ? 0 : sum(
    data.transactions.filter((t) => bankEffect(t) < 0 && t.date >= tomorrow && t.date <= lastCashDay
      && t.date >= data.balance.startDate),
    (t) => -bankEffect(t),
  );
  const cash = balance === null ? null : balance - billsBeforeHorizon - cardDue - futureOutflows;
  const cashDays = diffDays(today, horizon);
  const cashDaily = cash === null ? null : perDay(cash, cashDays);

  // The number you see is the safer of the two views.
  let mode = 'none';
  let month = null;
  let daily = null;
  let monthGuarded = false;
  let dailyGuarded = false;
  if (budgetMonth !== null && cash !== null) {
    mode = 'both';
    monthGuarded = cash < budgetMonth;
    dailyGuarded = cashDaily < budgetDaily;
    month = Math.min(budgetMonth, cash);
    daily = Math.min(budgetDaily, cashDaily);
  } else if (budgetMonth !== null) {
    mode = 'budget';
    month = budgetMonth;
    daily = budgetDaily;
  } else if (cash !== null) {
    mode = 'cash';
    month = cash;
    daily = cashDaily;
  }

  // Pace leaves fixed bills out, so rent on the 1st doesn't make the whole month look "ahead".
  let pace = null;
  if (limit !== null) {
    const billsThisMonth = totals.billsPosted + scheduledSpend;
    const everydayBudget = limit - billsThisMonth;
    const everydaySpent = totals.spent - totals.billsPosted;
    const expected = everydayBudget > 0 ? Math.floor((everydayBudget * daysElapsed) / daysTotal) : 0;
    let status = 'ontrack';
    if (budgetMonth < 0) status = 'over';
    else if (everydaySpent > expected) status = 'ahead';
    pace = {
      status, billsPosted: totals.billsPosted, billsThisMonth, everydayBudget, everydaySpent, expected,
      gap: everydaySpent - expected,
    };
  }

  const prevTotals = periodTotals(data, shiftPeriod(period, -1), cats);

  return {
    today, period, daysLeft, daysTotal, daysElapsed,
    totals, spent: totals.spent, income: totals.income, prevIncome: prevTotals.income,
    scheduled, scheduledSpend, scheduledAll,
    limit, budgetMonth, budgetDaily,
    balance, payday, horizon, cashDays, billsSoon, billsBeforeHorizon, cardDue, cardDueItems, futureOutflows, cash, cashDaily,
    hasCards: activeCards(data).length > 0,
    owed: totalOwed(data, today),
    afterPayoff: balance === null ? null : balance - totalOwed(data, today),
    mode, month, daily, monthGuarded, dailyGuarded,
    pace,
    usedPct: limit === null ? null : Math.floor((Math.max(0, totals.spent) * 100) / limit),
    leftover: totals.income - (totals.outflow + scheduledAll),
    goal: goalProgress(data),
    warnings: [...limitWarnings(data, totals), ...cardWarnings(data, today)],
    split: splitSummary(data, totals),
  };
}

const warnLevel = (spent, limit) => {
  if (spent >= limit) return 100;
  if (spent * 5 >= limit * 4) return 80;
  return 0;
};

/** 80% and 100% warnings for the monthly limit and every category limit. */
export function limitWarnings(data, totals) {
  const out = [];
  const limit = data.budget?.limit;
  if (Number.isSafeInteger(limit) && limit > 0) {
    const level = warnLevel(totals.spent, limit);
    if (level) out.push({ kind: 'month', key: 'month', level, spent: totals.spent, limit, over: totals.spent - limit });
  }
  for (const c of data.categories) {
    if (!(c.limit > 0) || c.bucket === 'savings') continue;
    const spent = totals.byCategory.get(c.id) ?? 0;
    const level = warnLevel(spent, c.limit);
    if (level) {
      out.push({
        kind: 'category', key: `cat:${c.id}`, categoryId: c.id, name: c.name, emoji: c.emoji,
        level, spent, limit: c.limit, over: spent - c.limit,
      });
    }
  }
  return out;
}

/** 80% and 100% of each card's personal cap this statement cycle, and utilization over 30%. */
export function cardWarnings(data, today) {
  const out = [];
  for (const card of activeCards(data)) {
    const s = cardSummary(data, card, today);
    if (s.capLevel) {
      out.push({
        kind: 'card', key: `card:${card.id}:${s.cycleStart}`, cardId: card.id, name: card.name,
        level: s.capLevel, spent: s.cycleSpend, limit: s.cap, over: s.overCap,
      });
    }
    if (s.utilizationHigh) {
      out.push({
        kind: 'utilization', key: `util:${card.id}:${s.cycleStart}`, cardId: card.id, name: card.name,
        level: 80, spent: s.reported, limit: card.limit, over: 0, pct: s.utilization,
      });
    }
  }
  return out;
}

/** Savings goal progress: what you'd already saved plus Savings-bucket transfers since the goal began. */
export function goalProgress(data) {
  const g = data.goal;
  if (!g) return null;
  const cats = categoryMap(data.categories);
  let transfers = 0;
  for (const tx of data.transactions) {
    if (tx.type === 'expense' && tx.date >= g.since && effectiveBucket(tx, cats) === 'savings') {
      transfers += -tx.amount;
    }
  }
  const saved = (g.saved ?? 0) + transfers;
  const pct = g.target > 0 ? Math.min(100, Math.max(0, Math.floor((saved * 100) / g.target))) : 0;
  return {
    name: g.name, target: g.target, startSaved: g.saved ?? 0, transfers, saved, pct, since: g.since,
    remaining: Math.max(0, g.target - saved), done: g.target > 0 && saved >= g.target,
  };
}

/** Needs, wants and savings this month against the target split of income. */
export function splitSummary(data, totals) {
  const split = data.budget?.split ?? DEFAULT_SPLIT;
  const expected = monthlyPay(data.pay);
  let base = 0;
  let baseSource = 'none';
  if (totals.income > 0) {
    base = totals.income;
    baseSource = 'income';
  } else if (expected > 0) {
    base = expected;
    baseSource = 'expected';
  }
  const actual = { need: totals.need, want: totals.want, savings: totals.savings };
  const target = base > 0
    ? {
      need: Math.floor((base * split.need) / 100),
      want: Math.floor((base * split.want) / 100),
      savings: Math.floor((base * split.savings) / 100),
    }
    : null;
  return { split, base, baseSource, actual, target };
}

/** Income, spending and net for the last `count` budget months, oldest first. */
export function monthlyHistory(data, today, count = 6) {
  const cats = categoryMap(data.categories);
  const current = periodFor(today, data.budget?.startDay ?? 1);
  const out = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const period = shiftPeriod(current, -i);
    const t = periodTotals(data, period, cats);
    out.push({
      period, income: t.income, spent: t.spent, savings: t.savings, net: t.income - t.spent,
      count: t.expenseCount, current: i === 0,
    });
  }
  return out;
}

/**
 * Daily balances for the last `days` days (never before the starting balance), plus a projection
 * from today to the end of the budget month with scheduled bills and expected paychecks.
 */
export function balanceSeries(data, today, days = 30) {
  if (!data.balance) return null;
  const { start, startDate } = data.balance;
  const period = periodFor(today, data.budget?.startDay ?? 1);
  const from = maxDate(startDate, addDays(today, -(days - 1)));
  const net = new Map();
  for (const tx of data.transactions) {
    const effect = bankEffect(tx);
    if (effect && tx.date >= startDate) net.set(tx.date, (net.get(tx.date) ?? 0) + effect);
  }
  let bal = start;
  for (const [date, amount] of net) if (date < from) bal += amount;
  const history = [];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    bal += net.get(d) ?? 0;
    history.push({ date: d, balance: bal });
  }

  const projection = [];
  const events = [];
  if (today < period.end) {
    const tomorrow = addDays(today, 1);
    const charges = new Map();
    for (const c of upcomingCharges(data.recurring, tomorrow, period.end)) {
      if ((c.account ?? 'bank') !== 'bank') continue; // goes on a card, paid later
      charges.set(c.date, (charges.get(c.date) ?? 0) + c.amount);
      events.push({ date: c.date, kind: 'bill', name: c.name, amount: -c.amount });
    }
    // Card payments leave the bank on their due date (an unconfirmed late one, tomorrow).
    for (const item of cardPaymentsDue(data, today, addDays(period.end, 1))) {
      const date = item.late ? tomorrow : item.due;
      if (date > period.end) continue;
      charges.set(date, (charges.get(date) ?? 0) + item.amount);
      events.push({ date, kind: 'card', name: `${item.name} payment`, amount: -item.amount });
    }
    const paydays = new Set(expectedPaydays(data.pay, tomorrow, period.end));
    for (const d of paydays) events.push({ date: d, kind: 'pay', name: 'Expected paycheck', amount: data.pay.amount });
    let p = bal;
    projection.push({ date: today, balance: p });
    for (let d = tomorrow; d <= period.end; d = addDays(d, 1)) {
      p += net.get(d) ?? 0;
      p -= charges.get(d) ?? 0;
      if (paydays.has(d)) p += data.pay.amount;
      projection.push({ date: d, balance: p });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { history, projection, events, period };
}
