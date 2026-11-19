// Settings. (Built out in Phase 3.)
import { html } from './dom.js';
import { icon } from './icons.js';

export function render(ctx) {
  return html`<main class="screen settings" id="main">
    <header class="navbar">
      <button type="button" class="nav-back" data-action="back">${icon('chevronLeft')}<span>Home</span></button>
    </header>
    <h1 class="large-title">Settings</h1>
    <ul class="card list-card">
      ${ctx.mode === 'demo'
        ? html`<li><button type="button" class="row" data-action="clear-demo"><span class="row-label">Clear demo data</span></button></li>`
        : html`<li><button type="button" class="row" data-action="start-demo"><span class="row-label">Explore with demo data</span></button></li>`}
    </ul>
  </main>`;
}

export const actions = {
  'start-demo': (ctx) => ctx.startDemo(),
};
