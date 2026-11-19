// The "?" sheet: every formula in plain English, with your numbers.
import { html } from './dom.js';
import { openSheet } from './sheet.js';
import { explain } from '../explain.js';

export function openExplain(ctx, topic, subject = null) {
  const e = explain(topic, subject ?? ctx.summary, ctx.data);
  return openSheet({
    title: e.title,
    className: 'explain',
    render: () => html`
      ${e.intro ? html`<p class="explain-intro">${e.intro}</p>` : ''}
      ${e.sections.map((s) => html`
        <section class="explain-section">
          <h3>${s.heading}</h3>
          <dl class="explain-rows">
            ${s.rows.map((r) => html`<div class="explain-row${r.total ? ' is-total' : ''}"><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}
          </dl>
        </section>`)}
      ${e.result ? html`<div class="explain-result"><span>${e.result.label}</span><strong>${e.result.value}</strong></div>` : ''}
      ${e.footnote ? html`<p class="explain-foot">${e.footnote}</p>` : ''}`,
  });
}

/** A small "?" button that opens an explanation. Card topics name the card. */
export function helpButton(topic, label, cardId = null) {
  return html`<button type="button" class="help" data-action="explain" data-topic="${topic}"${cardId ? html` data-card="${cardId}"` : ''} aria-label="${label}">?</button>`;
}
