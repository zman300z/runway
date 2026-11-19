// Data storage: load, save, migrate, validate, back up and restore.
// The storage object is passed in: browser storage in the app, an in-memory fake in tests.
// Golden rule: never overwrite data we could not read. Keep it and offer a way out instead.
import { defaultCategories, BUCKETS } from './categories.js';
import { isValidISO, clampStartDay } from './dates.js';
import { DEFAULT_SPLIT } from './budget.js';
import { CADENCES, postedKey } from './recurring.js';
import { FREQUENCIES } from './pay.js';

export const SCHEMA_VERSION = 1;

export const KEYS = Object.freeze({
  data: 'runway:data', // your data, the only thing a backup contains
  demo: 'runway:demo', // demo data, kept apart from your own
  ui: 'runway:ui', // last screen, filters and similar, never backed up
  mode: 'runway:mode', // "demo" while demo data is showing
});

const TX_TYPES = ['expense', 'income', 'adjustment'];

export class StoreError extends Error {
  constructor(code, message, info) {
    super(message);
    this.name = 'StoreError';
    this.code = code; // "invalid" | "newer"
    this.info = info;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const toInt = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function defaultData({ today = null, now = Date.now() } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    setupDone: false,
    balance: null,
    pay: null,
    budget: { limit: null, startDay: 1, split: { ...DEFAULT_SPLIT } },
    goal: null,
    categories: defaultCategories(),
    transactions: [],
    recurring: [],
    posted: [],
    settings: { badge: false },
    meta: { createdAt: now, lastBackupAt: null, lastOpened: today },
  };
}

// Migrations. Each step turns version N into N + 1. To change the data shape later:
// bump SCHEMA_VERSION, add a step here, and add a test in tests/store.test.js.

/** v0 is data saved before schemaVersion existed (early builds or hand-made files). */
function v0ToV1(old) {
  const transactions = (Array.isArray(old.transactions) ? old.transactions : []).filter(isObj).map((t) => ({
    ...t,
    amount: toInt(t.amount),
    categoryId: t.categoryId ?? null,
    bucket: t.bucket === 'need' || t.bucket === 'want' ? t.bucket : null,
    source: t.source ?? null,
    note: typeof t.note === 'string' ? t.note : '',
  }));
  const recurring = (Array.isArray(old.recurring) ? old.recurring : []).filter(isObj).map((b) => ({
    ...b,
    amount: toInt(b.amount),
    anchor: b.anchor ?? b.next,
    active: b.active !== false,
  }));
  // Rebuild the auto-post log from posted charges so nothing posts twice after upgrading.
  const posted = Array.isArray(old.posted)
    ? old.posted.filter((k) => typeof k === 'string')
    : transactions.filter((t) => t.recurringId && t.recurringDate).map((t) => postedKey(t.recurringId, t.recurringDate));
  const split = old.budget?.split;
  const splitOk = isObj(split) && [split.need, split.want, split.savings].every(Number.isInteger)
    && split.need + split.want + split.savings === 100;
  return {
    schemaVersion: 1,
    setupDone: Boolean(old.setupDone ?? (old.balance || transactions.length)),
    balance: isObj(old.balance) ? { start: toInt(old.balance.start), startDate: old.balance.startDate } : null,
    pay: isObj(old.pay) ? { ...old.pay, amount: toInt(old.pay.amount), handledThrough: old.pay.handledThrough ?? null } : null,
    budget: {
      limit: old.budget?.limit == null ? null : toInt(old.budget.limit),
      startDay: clampStartDay(old.budget?.startDay ?? 1),
      split: splitOk ? { need: split.need, want: split.want, savings: split.savings } : { ...DEFAULT_SPLIT },
    },
    goal: isObj(old.goal) ? { ...old.goal, target: toInt(old.goal.target), saved: toInt(old.goal.saved ?? 0) } : null,
    categories: Array.isArray(old.categories) && old.categories.length ? old.categories : defaultCategories(),
    transactions,
    recurring,
    posted: [...new Set(posted)],
    settings: { badge: Boolean(old.settings?.badge) },
    meta: {
      createdAt: old.meta?.createdAt ?? null,
      lastBackupAt: old.meta?.lastBackupAt ?? null,
      lastOpened: old.meta?.lastOpened ?? null,
    },
  };
}

export const MIGRATIONS = [{ from: 0, to: 1, up: v0ToV1 }];

/** Upgrade data step by step to `target`. Pure: the input is never changed. */
export function migrate(data, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  if (!isObj(data)) throw new StoreError('invalid', 'This is not Runway data.');
  let version = data.schemaVersion ?? 0;
  if (!Number.isInteger(version) || version < 0) throw new StoreError('invalid', 'Unknown data version.');
  if (version > target) {
    throw new StoreError('newer', 'This data comes from a newer version of Runway.', { version });
  }
  let out = structuredClone(data);
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new StoreError('invalid', `No upgrade path from version ${version}.`);
    out = step.up(out);
    out.schemaVersion = step.to;
    version = step.to;
  }
  return out;
}

/** Structural checks. Returns a list of problems (empty means the data is usable). */
export function validate(data) {
  const errors = [];
  const err = (msg) => {
    if (errors.length < 20) errors.push(msg);
  };
  if (!isObj(data)) return ['Not an object.'];
  if (data.schemaVersion !== SCHEMA_VERSION) err('Wrong data version.');

  if (data.balance !== null
    && !(isObj(data.balance) && Number.isSafeInteger(data.balance.start) && isValidISO(data.balance.startDate))) {
    err('Balance is malformed.');
  }

  const p = data.pay;
  if (p !== null) {
    if (!isObj(p) || !Number.isSafeInteger(p.amount) || p.amount < 0 || !FREQUENCIES.includes(p.frequency)
      || !isValidISO(p.anchor)) {
      err('Pay schedule is malformed.');
    } else {
      if (p.frequency === 'semimonthly'
        && !(Array.isArray(p.days) && p.days.length === 2 && p.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31))) {
        err('Twice-a-month pay days are malformed.');
      }
      if (p.handledThrough != null && !isValidISO(p.handledThrough)) err('Payday history is malformed.');
    }
  }

  const b = data.budget;
  if (!isObj(b)) {
    err('Budget settings are missing.');
  } else {
    if (b.limit !== null && !(Number.isSafeInteger(b.limit) && b.limit >= 0)) err('Monthly limit is malformed.');
    if (!(Number.isInteger(b.startDay) && b.startDay >= 1 && b.startDay <= 28)) err('Month start day is malformed.');
    const s = b.split;
    if (!isObj(s) || ![s.need, s.want, s.savings].every((v) => Number.isInteger(v) && v >= 0)
      || s.need + s.want + s.savings !== 100) {
      err('Target split is malformed.');
    }
  }

  const g = data.goal;
  if (g !== null && !(isObj(g) && typeof g.name === 'string' && Number.isSafeInteger(g.target)
    && Number.isSafeInteger(g.saved) && isValidISO(g.since))) {
    err('Savings goal is malformed.');
  }

  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    err('Categories are missing.');
  } else {
    data.categories.forEach((c, i) => {
      if (!isObj(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || !BUCKETS.includes(c.bucket)
        || (c.limit !== null && c.limit !== undefined && !(Number.isSafeInteger(c.limit) && c.limit >= 0))) {
        err(`Category ${i + 1} is malformed.`);
      }
    });
  }

  if (!Array.isArray(data.transactions)) {
    err('Transactions are missing.');
  } else {
    data.transactions.forEach((t, i) => {
      if (!isObj(t) || typeof t.id !== 'string' || !TX_TYPES.includes(t.type) || !Number.isSafeInteger(t.amount)
        || !isValidISO(t.date)) {
        err(`Transaction ${i + 1} is malformed.`);
      }
    });
  }

  if (!Array.isArray(data.recurring)) {
    err('Bills are missing.');
  } else {
    data.recurring.forEach((r, i) => {
      if (!isObj(r) || typeof r.id !== 'string' || typeof r.name !== 'string' || !Number.isSafeInteger(r.amount)
        || r.amount <= 0 || !CADENCES.includes(r.cadence) || !isValidISO(r.anchor) || !isValidISO(r.next)
        || typeof r.active !== 'boolean') {
        err(`Bill ${i + 1} is malformed.`);
      }
    });
  }

  if (!Array.isArray(data.posted) || !data.posted.every((k) => typeof k === 'string')) err('Bill history is malformed.');
  if (!isObj(data.settings)) err('Settings are missing.');
  if (!isObj(data.meta)) err('App info is missing.');
  return errors;
}

/**
 * Wrap a storage object (getItem, setItem, removeItem, key, length).
 * load() returns { status: "ok" | "empty" | "corrupt" | "newer" | "unavailable", ... }.
 */
export function createStore(storage) {
  const keyFor = (slot) => (slot === 'demo' ? KEYS.demo : KEYS.data);

  return {
    load(slot = 'data') {
      const key = keyFor(slot);
      let raw;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        return { status: 'unavailable', error };
      }
      if (raw === null || raw === undefined) return { status: 'empty' };
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        return { status: 'corrupt', raw, error };
      }
      if (!isObj(parsed)) return { status: 'corrupt', raw };
      const version = parsed.schemaVersion ?? 0;
      if (!Number.isInteger(version) || version < 0) return { status: 'corrupt', raw };
      if (version > SCHEMA_VERSION) return { status: 'newer', raw, version };
      let data = parsed;
      if (version < SCHEMA_VERSION) {
        // Keep the original before upgrading, just in case.
        try {
          storage.setItem(`${key}:pre-v${version}`, raw);
        } catch {
          /* best effort */
        }
        try {
          data = migrate(parsed);
        } catch (error) {
          return { status: 'corrupt', raw, error };
        }
      }
      const errors = validate(data);
      if (errors.length) return { status: 'corrupt', raw, errors };
      if (version < SCHEMA_VERSION) {
        try {
          storage.setItem(key, JSON.stringify(data));
        } catch {
          /* the upgraded copy is still in memory */
        }
      }
      return { status: 'ok', data, migratedFrom: version < SCHEMA_VERSION ? version : null };
    },

    /** Throws if storage is full; the caller tells the user. */
    save(data, slot = 'data') {
      storage.setItem(keyFor(slot), JSON.stringify(data));
    },

    remove(slot = 'data') {
      storage.removeItem(keyFor(slot));
    },

    readRaw(slot = 'data') {
      return storage.getItem(keyFor(slot));
    },

    /** Keep a named safety copy of raw data (before an import, for example). */
    keepCopy(name, raw) {
      try {
        storage.setItem(`${KEYS.data}:${name}`, raw);
        return true;
      } catch {
        return false;
      }
    },

    getMode() {
      try {
        return storage.getItem(KEYS.mode) === 'demo' ? 'demo' : 'real';
      } catch {
        return 'real';
      }
    },

    setMode(mode) {
      if (mode === 'demo') storage.setItem(KEYS.mode, 'demo');
      else storage.removeItem(KEYS.mode);
    },

    loadUI() {
      try {
        const v = JSON.parse(storage.getItem(KEYS.ui) ?? '{}');
        return isObj(v) ? v : {};
      } catch {
        return {};
      }
    },

    saveUI(ui) {
      try {
        storage.setItem(KEYS.ui, JSON.stringify(ui));
      } catch {
        /* UI state is a convenience */
      }
    },

    /** Remove every Runway key, safety copies included. */
    eraseAll() {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith('runway:')) keys.push(k);
      }
      for (const k of keys) storage.removeItem(k);
    },

    /** False in private browsing modes that block storage. */
    isAvailable() {
      try {
        storage.setItem('runway:probe', '1');
        storage.removeItem('runway:probe');
        return true;
      } catch {
        return false;
      }
    },
  };
}

// Backups

export function countData(data) {
  return { transactions: data.transactions.length, bills: data.recurring.length, categories: data.categories.length };
}

/** A backup file: your data plus a small header. */
export function serializeBackup(data, { exportedAt = new Date().toISOString(), appVersion = null } = {}) {
  return JSON.stringify(
    { app: 'runway', kind: 'backup', schemaVersion: data.schemaVersion, appVersion, exportedAt, data },
    null,
    2,
  );
}

/** Read a backup file. Throws a StoreError with a friendly message if it can't be used. */
export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StoreError('invalid', "This file isn't a Runway backup. It isn't valid JSON.");
  }
  const inner = isObj(parsed) && parsed.app === 'runway' && isObj(parsed.data) ? parsed.data : parsed;
  if (!isObj(inner) || !Array.isArray(inner.transactions)) {
    throw new StoreError('invalid', "This file isn't a Runway backup.");
  }
  const data = migrate(inner);
  const errors = validate(data);
  if (errors.length) throw new StoreError('invalid', `This backup is damaged. ${errors[0]}`, { errors });
  return { data, exportedAt: isObj(parsed) ? parsed.exportedAt ?? null : null, counts: countData(data) };
}
