// Spending categories and the Need / Want / Savings buckets.
import { addDays } from './dates.js';

export const BUCKETS = ['need', 'want', 'savings'];
export const BUCKET_LABEL = { need: 'Need', want: 'Want', savings: 'Savings' };

/** Colors offered for categories. Mid-tone hues that read well on light and dark cards. */
export const CATEGORY_COLORS = [
  '#7C5CFA', '#2F9E44', '#1C7ED6', '#E8A400', '#0C9DB8', '#4263EB', '#F76707',
  '#9A4F14', '#D6336C', '#AE3EC9', '#5C7CFA', '#E03131', '#0CA678', '#868E96',
  '#5C940D',
];

// [id, name, emoji, bucket, color]
const DEFAULTS = [
  ['rent', 'Rent/Housing', '🏠', 'need', '#7C5CFA'],
  ['groceries', 'Groceries', '🛒', 'need', '#2F9E44'],
  ['transport', 'Gas/Transport', '⛽', 'need', '#1C7ED6'],
  ['bills', 'Bills & Utilities', '💡', 'need', '#E8A400'],
  ['phone', 'Phone', '📱', 'need', '#0C9DB8'],
  ['school', 'School', '🎓', 'need', '#4263EB'],
  ['eating-out', 'Eating Out', '🍔', 'want', '#F76707'],
  ['coffee', 'Coffee', '☕', 'want', '#9A4F14'],
  ['shopping', 'Shopping', '🛍️', 'want', '#D6336C'],
  ['fun', 'Fun/Entertainment', '🎉', 'want', '#AE3EC9'],
  ['subscriptions', 'Subscriptions', '🔁', 'want', '#5C7CFA'],
  ['gifts', 'Gifts', '🎁', 'want', '#E03131'],
  ['savings', 'Savings', '🐷', 'savings', '#0CA678'],
  ['other', 'Other', '📦', 'want', '#868E96'],
  ['fees', 'Fees & interest', '💸', 'want', '#5C940D'],
];

/** The category Card Reconcile uses for interest and fees. */
export const FEES_CATEGORY = { id: 'fees', name: 'Fees & interest', emoji: '💸', color: '#5C940D', bucket: 'want', limit: null };

export function defaultCategories() {
  return DEFAULTS.map(([id, name, emoji, bucket, color]) => ({ id, name, emoji, color, bucket, limit: null }));
}

/** Emoji offered in the category editor (any emoji can also be typed). */
export const EMOJI_CHOICES = [
  '🏠', '🛒', '⛽', '🚗', '🚌', '💡', '📱', '🎓', '📚', '🍔', '🍕', '🌮', '🍜', '☕',
  '🧋', '🛍️', '👕', '🎉', '🎬', '🎮', '🎵', '🔁', '📺', '🎁', '🐷', '💰', '📦', '💊',
  '🏋️', '✂️', '🐶', '✈️', '🍺', '🧺', '💻', '🎨', '⚽', '🚲', '🧾', '✨',
];

export const INCOME_SOURCES = [
  { id: 'paycheck', name: 'Paycheck', emoji: '💼' },
  { id: 'family', name: 'From family', emoji: '🏡' },
  { id: 'rewards', name: 'Rewards', emoji: '🪙' },
  { id: 'other', name: 'Other income', emoji: '💵' },
];
export const INCOME_SOURCE_IDS = INCOME_SOURCES.map((s) => s.id);
export function incomeSource(id) {
  return INCOME_SOURCES.find((s) => s.id === id) ?? INCOME_SOURCES[INCOME_SOURCES.length - 1];
}

export const categoryMap = (categories) => new Map(categories.map((c) => [c.id, c]));

/**
 * The bucket a transaction counts toward. A transaction stores a bucket only when you
 * overrode it (Need or Want); otherwise it follows its category. Savings categories are
 * always Savings.
 */
export function effectiveBucket(tx, cats) {
  const cat = cats.get(tx.categoryId);
  if (cat?.bucket === 'savings') return 'savings';
  if (tx.bucket === 'need' || tx.bucket === 'want') return tx.bucket;
  return cat?.bucket === 'need' ? 'need' : 'want';
}

/** Default bucket for a category id ("want" when the category is unknown). */
export function categoryBucket(cats, id) {
  return cats.get(id)?.bucket ?? 'want';
}

// The quick-pick order for someone with no history yet: everyday purchases first.
const QUICK_PICKS = ['coffee', 'eating-out', 'groceries', 'transport', 'shopping', 'fun'];

/** Your most-used categories over the last 90 days (bill charges don't count). */
export function topCategories(categories, transactions, today, count = 6) {
  const since = addDays(today, -90);
  const uses = new Map();
  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.recurringId || tx.amount >= 0) continue;
    if (tx.date < since || tx.date > today) continue;
    uses.set(tx.categoryId, (uses.get(tx.categoryId) ?? 0) + 1);
  }
  const rank = (c) => {
    const quick = QUICK_PICKS.indexOf(c.id);
    return quick === -1 ? QUICK_PICKS.length : quick;
  };
  const order = new Map(categories.map((c, i) => [c.id, i]));
  return [...categories]
    .sort((a, b) =>
      (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || rank(a) - rank(b) || order.get(a.id) - order.get(b.id))
    .slice(0, count);
}

export function categoryInUse(data, id) {
  return data.transactions.some((t) => t.categoryId === id) || data.recurring.some((b) => b.categoryId === id);
}

/** Move every transaction and bill from one category to another. */
export function reassignCategory(data, fromId, toId) {
  return {
    ...data,
    transactions: data.transactions.map((t) => (t.categoryId === fromId ? { ...t, categoryId: toId } : t)),
    recurring: data.recurring.map((b) => (b.categoryId === fromId ? { ...b, categoryId: toId } : b)),
  };
}

/** Delete a category. If it has transactions or bills, they move to `moveToId` first. */
export function removeCategory(data, id, moveToId) {
  if (data.categories.length <= 1) throw new Error('Keep at least one category.');
  if (!data.categories.some((c) => c.id === id)) return data;
  let next = data;
  if (categoryInUse(data, id)) {
    if (!moveToId || moveToId === id || !data.categories.some((c) => c.id === moveToId)) {
      throw new Error('Pick a category to move its transactions to.');
    }
    next = reassignCategory(data, id, moveToId);
  }
  return { ...next, categories: next.categories.filter((c) => c.id !== id) };
}
