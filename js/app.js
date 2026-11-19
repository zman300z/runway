// Runway app shell: loads your data, keeps it saved, routes between screens and wires events.
// All the math lives in the logic modules; this file only connects them to the page.
import { createStore, defaultData } from './store.js';
import { todayISO } from './dates.js';
import { summarize } from './budget.js';
import { runDailyJobs } from './actions.js';
import { buildDemoData } from './demo.js';
import { html, setHTML } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { openSheet, syncSheetsWithHistory } from './ui/sheet.js';
import { openQuickAdd } from './ui/quickadd.js';
import { openExplain } from './ui/explain-sheet.js';
import { openReconcile } from './ui/reconcile.js';
import { editTransaction } from './ui/activity.js';
import { shareFile } from './ui/files.js';
import { plural } from './ui/format.js';
import { limitSheet } from './ui/settings.js';
import { formatMoney, formatWholeMoney, floorDollars } from './money.js';
import { actions as backupActions } from './ui/backup.js';
import * as home from './ui/home.js';
import * as activity from './ui/activity.js';
import * as bills from './ui/bills.js';
import * as insights from './ui/insights.js';
import * as settings from './ui/settings.js';
import * as onboarding from './ui/onboarding.js';
import * as cardPage from './ui/card.js';

const SCREENS = { home, activity, bills, insights, settings, card: cardPage };
const TABS = [
  ['home', 'Home', 'home'],
  ['activity', 'Activity', 'list'],
  null, // the + button
  ['bills', 'Bills', 'bills'],
  ['insights', 'Insights', 'chart'],
];
const RESTORE_WINDOW_MS = 30 * 60 * 1000;

const store = createStore(window.localStorage);
const state = {
  data: null,
  mode: 'real',
  ui: {},
  today: todayISO(),
  route: { name: 'home', params: [], path: 'home' },
  screen: null,
  step: null,
  fatal: null,
  summary: null,
  cleanup: null,
};
const scrollMemory = new Map();
let erased = false; // after Erase everything, nothing may be written again
let swRegistration = null;
let updateRequested = false;

function parseHash() {
  const path = window.location.hash.replace(/^#\/?/, '') || 'home';
  const [name = 'home', ...params] = path.split('/').filter(Boolean);
  return { name, params, path };
}

// The context every screen gets.
const ctx = {
  store,
  get data() {
    return state.data;
  },
  get mode() {
    return state.mode;
  },
  get today() {
    return state.today;
  },
  get ui() {
    return state.ui;
  },
  get route() {
    return state.route;
  },
  get summary() {
    if (!state.summary || state.summary.data !== state.data || state.summary.today !== state.today) {
      state.summary = { data: state.data, today: state.today, value: summarize(state.data, state.today) };
    }
    return state.summary.value;
  },
  setUI(patch) {
    state.ui = { ...state.ui, ...patch };
    if (!erased) store.saveUI(state.ui);
  },
  /** Change the data: fn gets the current data and returns the new data (or throws). */
  update(fn) {
    const next = fn(state.data);
    if (!next || next === state.data) return state.data;
    state.data = next;
    save();
    render();
    return next;
  },
  navigate,
  back,
  rerender: () => render(),
  toast,
  openSheet,
  explain: (topic, subject) => openExplain(ctx, topic, subject),
  quickAdd: (opts) => openQuickAdd(ctx, opts),
  finishSetup,
  startDemo,
  clearDemo,
  afterChange,
  replaceData,
  realData,
  eraseEverything,
  updateBadge,
};

function save() {
  if (erased) return;
  try {
    store.save(state.data, state.mode === 'demo' ? 'demo' : 'data');
  } catch {
    toast("Couldn't save. Your phone may be out of storage. Export a backup from Settings.", { tone: 'bad', duration: 8000 });
  }
}

function rememberRoute() {
  if (erased) return;
  ctx.setUI({ route: state.route.path, leftAt: Date.now() });
}

function navigate(path, { replace = false } = {}) {
  scrollMemory.set(state.route.path, window.scrollY);
  const depth = window.history.state?.depth ?? 0;
  const url = `#/${path}`;
  if (replace) window.history.replaceState({ depth, sheetDepth: 0 }, '', url);
  else window.history.pushState({ depth: depth + 1, sheetDepth: 0 }, '', url);
  state.route = parseHash();
  rememberRoute();
  render({ restoreScroll: true });
}

function back() {
  if ((window.history.state?.depth ?? 0) > 0) window.history.back();
  else navigate('home', { replace: true });
}

function runJobs() {
  const { data, added } = runDailyJobs(state.data, state.today);
  if (data !== state.data) {
    state.data = data;
    save();
  }
  if (added.length) {
    const names = [...new Set(added.map((t) => t.note))].slice(0, 3).join(', ');
    toast(`${plural(added.length, 'bill charge')} posted: ${names}`);
  }
}

function refreshDay() {
  const today = todayISO();
  if (today === state.today) return;
  state.today = today;
  runJobs();
  render();
}

function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    refreshDay();
    scheduleMidnight();
  }, next - now);
}

// Limit warnings: after a change, announce any newly crossed 80% or 100% line, once per month.

function warningText(w) {
  if (w.kind === 'card') {
    if (w.level === 100) {
      return w.over > 0
        ? `${w.name} is ${formatMoney(w.over)} over your ${formatWholeMoney(w.limit)} cap this cycle.`
        : `${w.name} hit your ${formatWholeMoney(w.limit)} cap this cycle.`;
    }
    return `Heads up: ${w.name} is at ${Math.floor((w.spent * 100) / w.limit)}% of your ${formatWholeMoney(w.limit)} cap this cycle.`;
  }
  if (w.kind === 'utilization') {
    return `Heads up: ${w.name} is at ${w.pct}% of its credit limit. Under 30% is better for your credit score.`;
  }
  const name = w.kind === 'month' ? 'your monthly limit' : `${w.name}`;
  if (w.level === 100) {
    return w.kind === 'month'
      ? `You've hit your ${formatWholeMoney(w.limit)} monthly limit.`
      : `${w.emoji} ${w.name} is at its ${formatWholeMoney(w.limit)} limit.`;
  }
  const pct = Math.floor((w.spent * 100) / w.limit);
  return w.kind === 'month'
    ? `Heads up: you've used ${pct}% of ${name}.`
    : `Heads up: ${w.emoji} ${w.name} is at ${pct}% of its ${formatWholeMoney(w.limit)} limit.`;
}

function afterChange(before) {
  const after = ctx.summary;
  const prev = new Map((before?.warnings ?? []).map((w) => [w.key, w.level]));
  const period = after.period.start;
  const warned = Object.fromEntries(Object.entries(state.ui.warned ?? {}).filter(([k]) => k.startsWith(period)));
  for (const w of after.warnings) {
    if ((prev.get(w.key) ?? 0) >= w.level) continue;
    const id = `${period}:${w.key}:${w.level}`;
    if (warned[id]) continue;
    warned[id] = true;
    toast(warningText(w), { tone: w.level === 100 ? 'bad' : '', duration: 6000, queue: true });
    break;
  }
  ctx.setUI({ warned });
}

// Setup and demo data

function finishSetup({ apply, demo }) {
  state.data = apply(state.data);
  save();
  ctx.setUI({ setupDraft: null });
  if (demo) startDemo({ quiet: true });
  navigate('home', { replace: true });
  toast(demo ? 'Demo data loaded. Clear it any time from Home.' : "You're all set. Tap + to log a purchase.");
}

function startDemo({ quiet = false } = {}) {
  const demoData = buildDemoData(state.today);
  try {
    store.save(demoData, 'demo');
    store.setMode('demo');
  } catch {
    toast("Couldn't load demo data. Storage may be full.", { tone: 'bad' });
    return;
  }
  state.mode = 'demo';
  state.data = demoData;
  render();
  if (!quiet) toast('Demo data loaded. Your own setup is safe and separate.');
}

function clearDemo() {
  store.remove('demo');
  store.setMode('real');
  state.mode = 'real';
  const res = store.load('data');
  if (res.status !== 'ok' && res.status !== 'empty') {
    // Never paper over data we could not read: show the recovery screen instead.
    state.fatal = { kind: res.status, raw: res.raw ?? null };
    render();
    return;
  }
  state.data = res.status === 'ok' ? res.data : defaultData({ today: state.today });
  runJobs();
  render();
  toast('Demo data cleared. Your own setup is back.');
}

// Restore, erase, badge, updates

/** Your own data, even while demo data is showing. */
function realData() {
  const res = store.load('data');
  return res.status === 'ok' ? res.data : defaultData({ today: state.today });
}

/** Replace everything with a restored backup, keeping a safety copy of what was there. */
function replaceData(data) {
  const current = store.readRaw('data');
  if (current) store.keepCopy('pre-import', current);
  if (state.mode === 'demo') {
    store.remove('demo');
    store.setMode('real');
    state.mode = 'real';
  }
  state.data = data;
  save();
  runJobs();
  render();
}

function eraseEverything() {
  erased = true;
  store.eraseAll();
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
  window.location.replace('./');
}

/** Today's safe-to-spend in whole dollars on the app icon (only if you turned it on). */
function updateBadge() {
  if (erased || state.mode === 'demo' || !state.data?.settings?.badge || !('setAppBadge' in navigator)) return;
  const daily = ctx.summary.daily;
  const dollars = daily === null ? 0 : floorDollars(daily);
  const job = dollars > 0 ? navigator.setAppBadge(dollars) : navigator.clearAppBadge();
  job.catch(() => {});
}

function offerUpdate(worker) {
  toast('Update available, tap to refresh', {
    duration: Infinity,
    tapAnywhere: true,
    sticky: true,
    action: {
      label: 'Refresh',
      run: () => {
        updateRequested = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      },
    },
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) window.location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swRegistration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
      });
    });
  }).catch(() => {});
}

// Rendering

function tabbar(active) {
  const current = active === 'settings' || active === 'card' ? 'home' : active;
  return html`<nav class="tabbar" aria-label="Main">
    ${TABS.map((t) => (t
      ? html`<button type="button" class="tab${current === t[0] ? ' on' : ''}" data-action="tab" data-to="${t[0]}" ${current === t[0] ? html`aria-current="page"` : ''}>${icon(t[2])}<span>${t[1]}</span></button>`
      : html`<button type="button" class="tab-add" data-action="quick-add" aria-label="Add a purchase">${icon('plus')}</button>`))}
  </nav>`;
}

function recoveryScreen() {
  const f = state.fatal;
  if (f.kind === 'storage') {
    return html`<main class="screen bare recovery" id="main">
      <div class="recovery-icon">${icon('lock')}</div>
      <h1>Storage is turned off</h1>
      <p>Runway keeps everything on this phone, but this browser is blocking storage (often because of Private Browsing). Open Runway from its home screen icon, or turn off Private Browsing.</p>
    </main>`;
  }
  const newer = f.kind === 'newer';
  return html`<main class="screen bare recovery" id="main">
    <div class="recovery-icon">${icon('alert')}</div>
    <h1>${newer ? 'Runway needs an update' : "Runway couldn't read its saved data"}</h1>
    <p>${newer
      ? 'Your data was saved by a newer version of Runway. Close Runway completely and open it again to get the update. Your data is safe and untouched.'
      : 'Your data is still saved and untouched. Export a copy so nothing is lost. Then you can start over.'}</p>
    <button type="button" class="btn btn-primary btn-block" data-action="export-raw">${icon('download')}Export raw data</button>
    ${newer ? '' : html`<button type="button" class="btn btn-quiet btn-block" data-action="start-over">${f.confirm ? 'Tap again to erase and start over' : 'Start over'}</button>`}
  </main>`;
}

function render({ restoreScroll = false } = {}) {
  const root = document.getElementById('app');
  state.cleanup?.();
  state.cleanup = null;
  if (state.fatal) {
    state.screen = null;
    setHTML(root, recoveryScreen());
    return;
  }
  const route = state.route;
  const inSetup = route.name === 'setup' || (!state.data.setupDone && state.mode === 'real');
  if (inSetup) {
    const step = route.name === 'setup' ? Math.min(onboarding.STEP_COUNT - 1, Number(route.params[0]) || 0) : 0;
    state.screen = onboarding;
    state.step = step;
    setHTML(root, onboarding.render(ctx, step));
    state.cleanup = onboarding.mount?.(root, ctx) ?? null;
    window.scrollTo(0, 0);
    return;
  }
  const screen = SCREENS[route.name] ?? home;
  const y = window.scrollY;
  state.screen = screen;
  state.step = null;
  try {
    setHTML(root, html`${screen.render(ctx, route.params)}${tabbar(route.name)}`);
    state.cleanup = screen.mount?.(root, ctx, route.params) ?? null;
  } catch (err) {
    // One broken screen must never lock you out of the app: keep the tab bar and Settings.
    console.error(err);
    setHTML(root, html`<main class="screen" id="main"><div class="card empty-card" role="alert">
      <p><strong>Something went wrong showing this screen.</strong></p>
      <p class="muted">Your data is safe. Try another tab, or open Settings.</p>
      <button type="button" class="btn btn-quiet btn-sm" data-action="nav" data-to="settings">Open Settings</button>
    </div></main>${tabbar(route.name)}`);
  }
  window.scrollTo(0, restoreScroll ? scrollMemory.get(route.path) ?? 0 : y);
  updateBadge();
}

// Events

const GLOBAL_ACTIONS = {
  tab: (el) => {
    if (state.route.name === el.dataset.to) window.scrollTo({ top: 0, behavior: 'smooth' });
    else navigate(el.dataset.to, { replace: true });
  },
  nav: (el) => navigate(el.dataset.to),
  back: () => back(),
  'quick-add': () => openQuickAdd(ctx),
  explain: (el) => openExplain(ctx, el.dataset.topic, el.dataset.card ? { ...ctx.summary, cardId: el.dataset.card } : null),
  reconcile: () => openReconcile(ctx),
  'edit-tx': (el) => editTransaction(ctx, el.dataset.id),
  'edit-limit': () => limitSheet(ctx),
  'clear-demo': () => clearDemo(),
  'export-backup': () => backupActions['export-backup'](ctx),
  'snooze-backup': () => backupActions['snooze-backup'](ctx),
  'export-raw': async () => {
    const raw = state.fatal?.raw ?? '';
    await shareFile(`runway-raw-${state.today}.json`, raw, 'application/json');
  },
  'start-over': () => {
    if (!state.fatal.confirm) {
      state.fatal.confirm = true;
      render();
      return;
    }
    store.keepCopy(`unreadable-${Date.now()}`, state.fatal.raw ?? '');
    store.remove('data');
    store.setMode('real');
    state.fatal = null;
    state.mode = 'real';
    state.data = defaultData({ today: state.today });
    navigate('setup/0', { replace: true });
  },
};

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  const inSheet = Boolean(el.closest('.sheet-layer'));
  const screenFn = !inSheet ? state.screen?.actions?.[name] : null;
  if (screenFn) {
    screenFn(ctx, el, e, state.step);
    return;
  }
  GLOBAL_ACTIONS[name]?.(el, e);
}

function onInput(e) {
  const el = e.target.closest('[data-input]');
  if (!el || el.closest('.sheet-layer')) return;
  state.screen?.inputs?.[el.dataset.input]?.(ctx, el, e, state.step);
}

function onPopState(e) {
  syncSheetsWithHistory(e.state);
  const route = parseHash();
  if (route.path !== state.route.path) {
    scrollMemory.set(state.route.path, window.scrollY);
    state.route = route;
    rememberRoute();
    render({ restoreScroll: true });
  }
}

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    rememberRoute();
  } else {
    refreshDay();
    swRegistration?.update().catch(() => {});
    if (swRegistration?.waiting && navigator.serviceWorker.controller) offerUpdate(swRegistration.waiting);
  }
}

// Boot

function boot() {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  // Safari 17.4+ draws <input switch> as a native iOS switch; elsewhere CSS draws one.
  if (!('switch' in HTMLInputElement.prototype)) document.documentElement.classList.add('no-native-switch');
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  window.addEventListener('popstate', onPopState);
  document.addEventListener('visibilitychange', onVisibility);

  if (!store.isAvailable()) {
    state.fatal = { kind: 'storage' };
    render();
    return;
  }
  state.ui = store.loadUI();
  state.mode = store.getMode();
  let res = store.load(state.mode === 'demo' ? 'demo' : 'data');
  if (state.mode === 'demo' && res.status !== 'ok') {
    store.setMode('real');
    state.mode = 'real';
    res = store.load('data');
  }
  if (res.status === 'empty') {
    state.data = defaultData({ today: state.today });
  } else if (res.status === 'ok') {
    state.data = res.data;
  } else {
    state.fatal = { kind: res.status, raw: res.raw ?? null };
    render();
    return;
  }

  runJobs();
  navigator.storage?.persist?.().catch(() => {});

  // Reopen where you left off if it was recent, otherwise start on Home.
  const recent = state.ui.route && Date.now() - (state.ui.leftAt ?? 0) < RESTORE_WINDOW_MS;
  const fromHash = window.location.hash && window.location.hash !== '#/' ? parseHash().path : null;
  const initial = fromHash ?? (recent ? state.ui.route : 'home');
  window.history.replaceState({ depth: 0, sheetDepth: 0 }, '', `#/${initial}`);
  state.route = parseHash();
  render();
  scheduleMidnight();
  registerServiceWorker();
}

boot();
