// Credit cards: what you owe, statements and due dates, the personal cap, utilization and a
// cash back estimate. Pure functions: amounts are integer cents, dates are local YYYY-MM-DD.
//
// The rule: a card purchase is spending the day you make it, your bank only feels it on
// payment day, and the card payment itself is never spending.
//
// Every transaction has an `account`: "bank" or a card id. Its `amount` is the effect on your
// money (a purchase is negative). On a card that means owed goes UP by -amount. A card payment
// (type "cardPayment", amount positive, `cardId`) takes money out of the bank and pays the card.
import { addDays, addMonths, parseISO, toISO, daysInMonth, diffDays } from './dates.js';

export const BANK = 'bank';
export const accountOf = (tx) => tx.account ?? BANK;
export const activeCards = (data) => (data.cards ?? []).filter((c) => !c.closed);
export const findCard = (data, id) => (data.cards ?? []).find((c) => c.id === id) ?? null;

/** Change to the bank balance from one transaction. */
export function bankEffect(tx) {
  if (tx.type === 'cardPayment') return -tx.amount;
  return accountOf(tx) === BANK ? tx.amount : 0;
}

/** Change to what you owe on one card (positive means you owe more). */
export function owedEffect(tx, cardId) {
  if (tx.type === 'cardPayment') return tx.cardId === cardId ? -tx.amount : 0;
  return accountOf(tx) === cardId ? -tx.amount : 0;
}

// Statement dates. Days 29 to 31 fall back to the last day of shorter months.

const onDay = (y, m, day) => toISO(y, m, Math.min(day, daysInMonth(y, m)));
const monthOffset = (iso, n) => parseISO(addMonths(`${iso.slice(0, 7)}-01`, n));

/** Every date on `day` of the month from `from` through `to`. */
export function monthlyOn(day, from, to) {
  const out = [];
  if (to < from) return out;
  let { y, m } = parseISO(from);
  const end = parseISO(to);
  while (y < end.y || (y === end.y && m <= end.m)) {
    const d = onDay(y, m, day);
    if (d >= from && d <= to) out.push(d);
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return out;
}

/** The most recent statement closing date on or before `date`. */
export function lastClosing(card, date) {
  const { y, m } = parseISO(date);
  const here = onDay(y, m, card.closingDay);
  if (here <= date) return here;
  const prev = monthOffset(date, -1);
  return onDay(prev.y, prev.m, card.closingDay);
}

/** The first statement closing date after `date`. */
export function nextClosing(card, date) {
  const { y, m } = parseISO(date);
  const here = onDay(y, m, card.closingDay);
  if (here > date) return here;
  const next = monthOffset(date, 1);
  return onDay(next.y, next.m, card.closingDay);
}

/** A statement's due date: the first payment due day after its closing date. */
export function dueDateFor(card, closing) {
  const { y, m } = parseISO(closing);
  const here = onDay(y, m, card.dueDay);
  if (here > closing) return here;
  const next = monthOffset(closing, 1);
  return onDay(next.y, next.m, card.dueDay);
}

/** The closing date of the statement that a due date belongs to. */
export function closingForDue(card, due) {
  return lastClosing(card, addDays(due, -1));
}

/**
 * The statement cycle a date falls in. A cycle runs from the day after one closing date
 * through the next closing date, so a purchase on the closing day is on that statement.
 */
export function cycleFor(card, date) {
  const end = lastClosing(card, date) === date ? date : nextClosing(card, date);
  const start = addDays(lastClosing(card, addDays(date, -1)), 1);
  return { start, end };
}

// Balances

/** What you owe on a card at the end of `date`. Below zero means the card holds a credit. */
export function owedOn(data, card, date) {
  let owed = card.startOwed ?? 0;
  for (const tx of data.transactions) {
    if (tx.date >= card.startDate && tx.date <= date) owed += owedEffect(tx, card.id);
  }
  return owed;
}

function paymentsBetween(data, card, after, through) {
  let paid = 0;
  for (const tx of data.transactions) {
    if (tx.type === 'cardPayment' && tx.cardId === card.id && tx.date > after && tx.date <= through) paid += tx.amount;
  }
  return paid;
}

/** The statement balance for a closing date: the amount you confirmed, or Runway's own figure. */
export function statementAmount(data, card, closing) {
  if (closing < card.openDate) return 0;
  const confirmed = card.statements?.[closing];
  if (Number.isSafeInteger(confirmed)) return Math.max(0, confirmed);
  return Math.max(0, owedOn(data, card, closing));
}

/** Runway's own figure for a statement, ignoring any confirmed amount (for the banner). */
export function computedStatement(data, card, closing) {
  return closing < card.openDate ? 0 : Math.max(0, owedOn(data, card, closing));
}

/** How much of the statement due on `due` is still unpaid, counting payments through `asOf`. */
export function dueRemaining(data, card, due, asOf) {
  const closing = closingForDue(card, due);
  return Math.max(0, statementAmount(data, card, closing) - paymentsBetween(data, card, closing, asOf));
}

/** Purchases minus refunds on a card in its statement cycle from `start` through `end`. */
export function cycleSpend(data, card, start, end, excludeId = null) {
  let spend = 0;
  for (const tx of data.transactions) {
    if (tx.type === 'expense' && accountOf(tx) === card.id && tx.date >= start && tx.date <= end && tx.id !== excludeId) {
      spend += -tx.amount;
    }
  }
  return spend;
}

const capLevel = (spent, cap) => {
  if (!(cap > 0)) return 0;
  if (spent >= cap) return 100;
  return spent * 5 >= cap * 4 ? 80 : 0;
};

/** Everything the screens need about one card today. */
export function cardSummary(data, card, today) {
  const closing = lastClosing(card, today);
  const hasStatement = closing >= card.openDate;
  const statement = hasStatement ? statementAmount(data, card, closing) : 0;
  const statementDue = Math.max(0, statement - paymentsBetween(data, card, closing, today));
  const owed = owedOn(data, card, today);
  const { start: cycleStart, end: cycleEnd } = cycleFor(card, today);
  const upcoming = nextClosing(card, today); // the statement that new charges will be on
  const spent = cycleSpend(data, card, cycleStart, today);
  const due = hasStatement ? dueDateFor(card, closing) : null;
  // Likely reported at the next closing: what you owe, minus autopay due before that closing.
  const autopayFirst = card.autopay && due && due > today && due <= cycleEnd ? statementDue : 0;
  const reported = Math.max(0, owed - autopayFirst);
  const utilization = card.limit > 0 ? Math.floor((reported * 100) / card.limit) : null;
  return {
    card,
    owed,
    credit: owed < 0 ? -owed : 0,
    closing: hasStatement ? closing : null,
    statement,
    statementDue,
    newCharges: owed - statementDue,
    due,
    nextClosing: upcoming,
    nextDue: dueDateFor(card, upcoming),
    cycleStart,
    cycleEnd,
    cycleSpend: spent,
    cap: card.cap > 0 ? card.cap : null,
    capLevel: capLevel(spent, card.cap),
    overCap: card.cap > 0 ? Math.max(0, spent - card.cap) : 0,
    reported,
    utilization,
    utilizationHigh: utilization !== null && utilization > 30,
  };
}

/** Total owed on every open card (credits count as negative). */
export function totalOwed(data, today) {
  return activeCards(data).reduce((t, card) => t + owedOn(data, card, today), 0);
}

// Prompts

/**
 * Due dates that have arrived without a confirmed payment, oldest first, with what is still due.
 * A statement already paid off (for example with Pay card) never asks.
 */
export function pendingPayments(data, card, today) {
  const from = card.handledDue ? addDays(card.handledDue, 1) : card.startDate;
  return monthlyOn(card.dueDay, from, today)
    .map((due) => ({ due, closing: closingForDue(card, due), amount: dueRemaining(data, card, due, today) }))
    .filter((p) => p.closing >= card.openDate && p.amount > 0);
}

/** The most recent statement closing date that hasn't been confirmed yet, or null. */
export function pendingStatement(card, today) {
  const closing = lastClosing(card, today);
  if (closing < card.openDate || closing < card.startDate) return null;
  if (card.handledClose && card.handledClose >= closing) return null;
  return closing;
}

/**
 * Card payments the bank still has to make before `horizon` (the next payday): unconfirmed
 * past-due payments (the safe side assumes they already left), the current statement if it is
 * due before the horizon, and new charges whose statement both closes and comes due before it.
 */
export function cardPaymentsDue(data, today, horizon) {
  const items = [];
  for (const card of activeCards(data)) {
    const s = cardSummary(data, card, today);
    for (const p of pendingPayments(data, card, today)) {
      items.push({ cardId: card.id, name: card.name, due: p.due, amount: p.amount, late: true });
    }
    if (s.due && s.due > today && s.due < horizon && s.statementDue > 0) {
      items.push({ cardId: card.id, name: card.name, due: s.due, amount: s.statementDue, late: false });
    }
    if (s.nextClosing < horizon && s.nextDue < horizon && s.newCharges > 0) {
      items.push({ cardId: card.id, name: card.name, due: s.nextDue, amount: s.newCharges, late: false });
    }
  }
  return items;
}

/** What a purchase would do to the personal cap of the cycle it falls in (for Quick Add). */
export function capPreview(data, card, date, amount, excludeId = null) {
  if (!(card.cap > 0)) return null;
  const { start, end } = cycleFor(card, date);
  const before = cycleSpend(data, card, start, end, excludeId);
  const after = before + amount;
  return { cap: card.cap, before, after, level: capLevel(after, card.cap), over: Math.max(0, after - card.cap) };
}

// Rewards (always an estimate: your categories won't match the card company's exactly)

/** "2026-Q4" and the first day of that calendar quarter. */
export function quarterOf(date) {
  const { y, m } = parseISO(date);
  const q = Math.ceil(m / 3);
  return { key: `${y}-Q${q}`, start: toISO(y, (q - 1) * 3 + 1, 1) };
}

/** Remind about bonus categories in the first two weeks of a quarter, or while none cover today. */
export function needsQuarterReminder(card, today, dismissedKey = null) {
  const bonuses = card.rewards?.bonuses ?? [];
  if (!card.rewards || !bonuses.length) return false;
  const q = quarterOf(today);
  if (dismissedKey === q.key) return false;
  const covered = bonuses.some((b) => today >= b.start && today <= b.end);
  return diffDays(q.start, today) < 14 || !covered;
}

export function rewardsEstimate(data, card, today) {
  const r = card.rewards;
  if (!r) return null;
  const anniversary = addMonths(card.openDate, 12);
  const bonuses = [...(r.bonuses ?? [])].sort((a, b) => (a.start < b.start ? -1 : 1));
  const current = bonuses.find((b) => today >= b.start && today <= b.end) ?? null;
  const used = new Map();
  let earnedBp = 0; // cents times basis points, so everything stays a whole number
  let matchBp = 0;
  let windowBp = 0;
  const purchases = data.transactions
    .filter((t) => t.type === 'expense' && accountOf(t) === card.id && t.date >= card.openDate && t.date <= today)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
  for (const t of purchases) {
    const spend = -t.amount; // refunds are negative and take cash back away at the base rate
    let bonusPart = 0;
    let bonus = null;
    if (spend > 0) {
      bonus = bonuses.find((b) => t.date >= b.start && t.date <= b.end && (b.categoryIds ?? []).includes(t.categoryId)) ?? null;
      if (bonus) {
        const u = used.get(bonus.id) ?? 0;
        bonusPart = Math.max(0, Math.min(spend, bonus.cap - u));
        used.set(bonus.id, u + bonusPart);
      }
    }
    const bp = bonusPart * (bonus?.rateBp ?? 0) + (spend - bonusPart) * r.baseBp;
    earnedBp += bp;
    if (r.firstYearMatch && t.date < anniversary) matchBp += bp;
    if (current && t.date >= current.start && t.date <= current.end) windowBp += bp;
  }
  const toCents = (bp) => Math.floor(bp / 10000);
  return {
    earned: toCents(earnedBp),
    match: toCents(matchBp),
    total: toCents(earnedBp + matchBp),
    matchActive: Boolean(r.firstYearMatch) && today < anniversary,
    anniversary,
    bonus: current ? { ...current, spent: used.get(current.id) ?? 0 } : null,
    windowEarned: current ? toCents(windowBp) : null,
  };
}

// Rates typed as percents ("1.5") are stored as basis points (150).

/** Percent text to basis points. Null when empty, NaN when it doesn't make sense. */
export function parseRate(text) {
  const t = String(text ?? '').trim().replace(/%$/, '').trim();
  if (!t) return null;
  const m = /^(\d{0,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m || !/\d/.test(t)) return Number.NaN;
  const bp = Number(m[1] || 0) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bp <= 10000 ? bp : Number.NaN;
}

/** Basis points as percent text: 150 is "1.5", 500 is "5". */
export function rateText(bp) {
  if (!Number.isSafeInteger(bp)) return '';
  const frac = bp % 100;
  if (!frac) return String(Math.floor(bp / 100));
  return `${Math.floor(bp / 100)}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** The last day of the calendar quarter a date falls in. */
export function quarterEnd(date) {
  const { start } = quarterOf(date);
  return addDays(addMonths(start, 3), -1);
}
