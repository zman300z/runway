// Runway boot. Phase 1 placeholder: proves every logic module loads in the browser.
// Phase 2 replaces this with the real app shell.
import { createStore } from './store.js';
import { summarize } from './budget.js';
import { buildDemoData } from './demo.js';
import { todayISO } from './dates.js';
import { formatMoney } from './money.js';

const store = createStore(localStorage);
const today = todayISO();
const s = summarize(buildDemoData(today), today);
document.getElementById('app').innerHTML = `<main style="padding:24px">
  <h1>Runway</h1>
  <p>Logic modules loaded. Demo safe to spend today: <strong>${formatMoney(s.daily)}</strong></p>
  <p>Storage available: ${store.isAvailable() ? 'yes' : 'no'}</p>
</main>`;
