// Searching, filtering and grouping transactions for the Activity list. Pure functions.
import { categoryMap, effectiveBucket, incomeSource } from './categories.js';

/** "expense" | "refund" | "income" | "adjustment" | "cardPayment" | "cashback" */
export function kindOf(tx) {
  if (tx.type === 'expense') return tx.amount > 0 ? 'refund' : 'expense';
  return tx.type;
}

export function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
}

/**
 * Filters: q (searches notes, category and income source names), categoryId, kind,
 * bucket ("need" | "want" | "savings"), from and to (dates, inclusive). Newest first.
 */
export function filterTransactions(data, { q = '', categoryId = null, kind = null, bucket = null, from = null, to = null } = {}) {
  const cats = categoryMap(data.categories);
  const cardNames = new Map((data.cards ?? []).map((c) => [c.id, c.name]));
  const needle = q.trim().toLowerCase();
  return data.transactions
    .filter((t) => {
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (kind && kindOf(t) !== kind) return false;
      if (bucket && (t.type !== 'expense' || effectiveBucket(t, cats) !== bucket)) return false;
      if (needle) {
        const hay = [
          t.note,
          cats.get(t.categoryId)?.name,
          t.type === 'income' ? incomeSource(t.source).name : '',
          t.type === 'cardPayment' ? `${cardNames.get(t.cardId) ?? ''} card payment` : '',
          t.type === 'cashback' ? `${cardNames.get(t.account) ?? ''} cash back` : '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort(byNewest);
}

/**
 * Group a newest-first list by day. Totals: spent (purchases), back (refunds and income), saved.
 * Card payments and cash back credits are neither spending nor income, so they never count here.
 */
export function groupByDay(transactions, categories) {
  const cats = categoryMap(categories);
  const groups = [];
  let current = null;
  for (const t of transactions) {
    if (!current || current.date !== t.date) {
      current = { date: t.date, items: [], spent: 0, back: 0, saved: 0 };
      groups.push(current);
    }
    current.items.push(t);
    if (t.type === 'income') current.back += t.amount;
    else if (t.type === 'expense') {
      if (effectiveBucket(t, cats) === 'savings') current.saved += -t.amount;
      else if (t.amount < 0) current.spent += -t.amount;
      else current.back += t.amount;
    }
  }
  return groups;
}
