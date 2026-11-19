// Shared test helpers. Not a test file itself (node --test only runs *.test.js).
import { defaultData } from '../js/store.js';

/** In-memory stand-in for browser storage. */
export class MemoryStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
  }

  get length() {
    return this.map.size;
  }

  key(i) {
    return [...this.map.keys()][i] ?? null;
  }

  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }

  setItem(k, v) {
    this.map.set(k, String(v));
  }

  removeItem(k) {
    this.map.delete(k);
  }
}

/** Storage that is full: every write throws like a real quota error. */
export class FullStorage extends MemoryStorage {
  setItem() {
    const e = new Error('QuotaExceededError');
    e.name = 'QuotaExceededError';
    throw e;
  }
}

export function idMaker(prefix = 'id') {
  let n = 0;
  return () => `${prefix}${(n += 1)}`;
}

let seq = 0;
const base = (fields) => ({
  id: `t${(seq += 1)}`, categoryId: null, bucket: null, source: null, note: '', createdAt: seq, updatedAt: seq, ...fields,
});

/** A purchase: expense('2026-11-05', 800, 'groceries') is $8.00 spent. */
export const expense = (date, cents, categoryId, extra = {}) => base({ type: 'expense', amount: -cents, categoryId, date, ...extra });
/** A refund or payback: money back into a category. */
export const refund = (date, cents, categoryId, extra = {}) => base({ type: 'expense', amount: cents, categoryId, date, ...extra });
export const income = (date, cents, extra = {}) => base({ type: 'income', amount: cents, source: 'paycheck', date, ...extra });
export const adjustment = (date, cents, extra = {}) => base({ type: 'adjustment', amount: cents, date, ...extra });

export function bill(over = {}) {
  return {
    id: 'b1', name: 'Bill', amount: 1000, categoryId: 'subscriptions', cadence: 'monthly',
    anchor: '2026-11-22', next: '2026-11-22', active: true, createdAt: 0, ...over,
  };
}

export function data(over = {}) {
  return { ...defaultData({ today: '2026-11-01', now: 0 }), setupDone: true, ...over };
}

/**
 * The worked example used across tests (today is Wed, Nov 18, 2026):
 * limit $1,200, balance $1,000 on Nov 1, rent $600 posted Nov 1, groceries $80, coffee $5,
 * eating out $25 minus a $10 refund, $50 moved to savings, $500 paycheck on Nov 7.
 * Still scheduled: Spotify $11.99 (Nov 22), auto-save $25 (Nov 25), phone $45 (Nov 28).
 * Next payday: Sat, Nov 21.
 */
export function novemberExample(over = {}) {
  return data({
    balance: { start: 100000, startDate: '2026-11-01' },
    pay: { amount: 50000, frequency: 'biweekly', anchor: '2026-11-07', days: null, handledThrough: '2026-11-07' },
    budget: { limit: 120000, startDay: 1, split: { need: 50, want: 30, savings: 20 } },
    transactions: [
      expense('2026-11-01', 60000, 'rent', { recurringId: 'rent', recurringDate: '2026-11-01', note: 'Rent' }),
      expense('2026-11-05', 8000, 'groceries'),
      expense('2026-11-10', 500, 'coffee'),
      expense('2026-11-12', 2500, 'eating-out'),
      refund('2026-11-13', 1000, 'eating-out'),
      expense('2026-11-14', 5000, 'savings'),
      income('2026-11-07', 50000),
    ],
    recurring: [
      bill({ id: 'rent', name: 'Rent', amount: 60000, categoryId: 'rent', anchor: '2026-11-01', next: '2026-12-01' }),
      bill({ id: 'spotify', name: 'Spotify', amount: 1199, categoryId: 'subscriptions', anchor: '2026-11-22', next: '2026-11-22' }),
      bill({ id: 'phone', name: 'Phone', amount: 4500, categoryId: 'phone', anchor: '2026-11-28', next: '2026-11-28' }),
      bill({ id: 'autosave', name: 'Auto-save', amount: 2500, categoryId: 'savings', anchor: '2026-11-25', next: '2026-11-25' }),
    ],
    posted: ['rent:2026-11-01'],
    ...over,
  });
}
