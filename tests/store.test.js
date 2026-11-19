import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, defaultData, migrate, validate, serializeBackup, parseBackup, StoreError, SCHEMA_VERSION, KEYS,
} from '../js/store.js';
import { postDueCharges } from '../js/recurring.js';
import { MemoryStorage, FullStorage, novemberExample, idMaker } from './helpers.js';

test('a fresh store is empty, and default data is valid', () => {
  const store = createStore(new MemoryStorage());
  assert.deepEqual(store.load(), { status: 'empty' });
  const d = defaultData({ today: '2026-11-18', now: 1 });
  assert.deepEqual(validate(d), []);
  assert.equal(d.schemaVersion, SCHEMA_VERSION);
  assert.equal(d.categories.length, 14);
});

test('save then load gives back the same data', () => {
  const storage = new MemoryStorage();
  const store = createStore(storage);
  const d = novemberExample();
  store.save(d);
  const res = store.load();
  assert.equal(res.status, 'ok');
  assert.equal(res.migratedFrom, null);
  assert.deepEqual(res.data, d);
});

test('migrates v0 data (saved before schemaVersion existed) to v1', () => {
  const v0 = {
    balance: { start: '50000', startDate: '2026-11-01' },
    budget: { limit: 90000 },
    transactions: [
      { id: 'a', type: 'expense', amount: '-450', categoryId: 'coffee', date: '2026-11-02' },
      { id: 'r', type: 'expense', amount: -1199, categoryId: 'subscriptions', date: '2026-11-01', recurringId: 'spot', recurringDate: '2026-11-01', note: 'Spotify' },
    ],
    // An early build never moved `next` forward and had no anchor.
    recurring: [{ id: 'spot', name: 'Spotify', amount: 1199, categoryId: 'subscriptions', cadence: 'monthly', next: '2026-11-01' }],
  };
  const raw = JSON.stringify(v0);
  const storage = new MemoryStorage({ [KEYS.data]: raw });
  const res = createStore(storage).load();

  assert.equal(res.status, 'ok');
  assert.equal(res.migratedFrom, 0);
  const d = res.data;
  assert.equal(d.schemaVersion, 1);
  assert.deepEqual(validate(d), []);
  assert.equal(d.transactions[0].amount, -450);
  assert.equal(d.transactions[0].note, '');
  assert.equal(d.balance.start, 50000);
  assert.deepEqual(d.budget, { limit: 90000, startDay: 1, split: { need: 50, want: 30, savings: 20 } });
  assert.equal(d.recurring[0].anchor, '2026-11-01');
  assert.equal(d.recurring[0].active, true);
  assert.deepEqual(d.posted, ['spot:2026-11-01']);
  assert.equal(d.categories.length, 14);
  assert.deepEqual(d.settings, { badge: false });
  assert.equal(d.setupDone, true);

  // The original is kept, and the upgraded copy is saved.
  assert.equal(storage.getItem(`${KEYS.data}:pre-v0`), raw);
  assert.equal(JSON.parse(storage.getItem(KEYS.data)).schemaVersion, 1);
  // The rebuilt log means the Nov 1 charge does not post a second time.
  const { added } = postDueCharges(d, '2026-11-18', { makeId: idMaker(), now: 1 });
  assert.equal(added.length, 0);
  // Migration never changes its input.
  assert.equal(v0.transactions[0].amount, '-450');
});

test('a multi-step migration chain runs every step in order', () => {
  const steps = [
    { from: 0, to: 1, up: (d) => ({ ...d, trail: ['0 to 1'] }) },
    { from: 1, to: 2, up: (d) => ({ ...d, trail: [...d.trail, '1 to 2'] }) },
    { from: 2, to: 3, up: (d) => ({ ...d, trail: [...d.trail, '2 to 3'] }) },
  ];
  const out = migrate({ transactions: [] }, steps, 3);
  assert.deepEqual(out.trail, ['0 to 1', '1 to 2', '2 to 3']);
  assert.equal(out.schemaVersion, 3);
  const fromTwo = migrate({ schemaVersion: 2, trail: ['old'] }, steps, 3);
  assert.deepEqual(fromTwo.trail, ['old', '2 to 3']);
  assert.throws(() => migrate({ schemaVersion: 1 }, [steps[0]], 3), StoreError);
});

test('data from a newer version of the app is refused and never overwritten', () => {
  const raw = JSON.stringify({ ...novemberExample(), schemaVersion: SCHEMA_VERSION + 1 });
  const storage = new MemoryStorage({ [KEYS.data]: raw });
  const res = createStore(storage).load();
  assert.equal(res.status, 'newer');
  assert.equal(storage.getItem(KEYS.data), raw);
  assert.throws(() => migrate(JSON.parse(raw)), (e) => e.code === 'newer');
});

test('unreadable data is left untouched', () => {
  for (const raw of ['{not json', '[]', '"text"', JSON.stringify({ ...novemberExample(), transactions: 'oops' })]) {
    const storage = new MemoryStorage({ [KEYS.data]: raw });
    const res = createStore(storage).load();
    assert.equal(res.status, 'corrupt', raw);
    assert.equal(res.raw, raw);
    assert.equal(storage.getItem(KEYS.data), raw, 'nothing was overwritten');
  }
});

test('export then import gives identical data', () => {
  const original = novemberExample();
  const text = serializeBackup(original, { exportedAt: '2026-11-18T12:00:00.000Z', appVersion: '1.0.0' });
  const { data, counts, exportedAt } = parseBackup(text);
  assert.deepEqual(data, original);
  assert.deepEqual(counts, { transactions: 7, bills: 4, categories: 14 });
  assert.equal(exportedAt, '2026-11-18T12:00:00.000Z');
  // A bare data object (no header) is accepted too.
  assert.deepEqual(parseBackup(JSON.stringify(original)).data, original);
});

test('bad backup files are rejected with a friendly message', () => {
  const rejects = (text, code) => assert.throws(() => parseBackup(text), (e) => e instanceof StoreError && e.code === code && e.message.length > 0);
  rejects('this is not json', 'invalid');
  rejects('{}', 'invalid');
  rejects('[1, 2, 3]', 'invalid');
  rejects(JSON.stringify({ app: 'runway', data: { ...novemberExample(), schemaVersion: 99 } }), 'newer');
  const broken = novemberExample();
  broken.transactions[0] = { ...broken.transactions[0], amount: 4.5 };
  rejects(JSON.stringify(broken), 'invalid');
});

test('demo data lives in its own slot and never touches yours', () => {
  const storage = new MemoryStorage();
  const store = createStore(storage);
  const mine = novemberExample();
  const demo = { ...novemberExample(), transactions: [] };
  store.save(mine);
  store.save(demo, 'demo');
  store.setMode('demo');
  assert.equal(store.getMode(), 'demo');
  assert.deepEqual(store.load('demo').data, demo);
  assert.deepEqual(store.load('data').data, mine);
  store.remove('demo');
  store.setMode('real');
  assert.equal(store.getMode(), 'real');
  assert.equal(store.load('demo').status, 'empty');
  assert.deepEqual(store.load().data, mine);
});

test('erase everything removes only Runway keys', () => {
  const storage = new MemoryStorage({ 'runway:data': '{}', 'runway:ui': '{}', 'runway:data:pre-v0': '{}', 'other-app': 'keep' });
  createStore(storage).eraseAll();
  assert.deepEqual([...storage.map.keys()], ['other-app']);
});

test('UI state is optional and survives bad JSON', () => {
  const storage = new MemoryStorage({ [KEYS.ui]: '{broken' });
  const store = createStore(storage);
  assert.deepEqual(store.loadUI(), {});
  store.saveUI({ route: 'activity' });
  assert.deepEqual(store.loadUI(), { route: 'activity' });
});

test('full or blocked storage is reported, not hidden', () => {
  const store = createStore(new FullStorage());
  assert.throws(() => store.save(novemberExample()), /Quota/);
  assert.equal(store.isAvailable(), false);
  assert.equal(store.keepCopy('pre-import', '{}'), false);
  assert.equal(createStore(new MemoryStorage()).isAvailable(), true);
});
