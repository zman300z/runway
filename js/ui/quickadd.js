// Quick Add: log a purchase in 3 taps (+, a category, Save) plus typing the amount.
// The same sheet edits an existing transaction.
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet, closeAllSheets } from './sheet.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { breakable, safeColor, lengthClass } from './format.js';
import { keypadPress, entryToCents, centsToEntry, formatEntry, formatMoney } from '../money.js';
import { topCategories, categoryMap, INCOME_SOURCES, BUCKET_LABEL, incomeSource } from '../categories.js';
import { relativeDay } from '../dates.js';
import { addTransaction, updateTransaction, deleteTransaction, restoreTransaction } from '../actions.js';

const TYPES = [
  ['expense', 'Expense'],
  ['refund', 'Refund'],
  ['income', 'Income'],
];

function startState(tx, preset, today) {
  if (tx) {
    let type = 'expense';
    if (tx.type === 'income') type = 'income';
    else if (tx.type === 'adjustment') type = 'adjustment';
    else if (tx.amount > 0) type = 'refund';
    return {
      type, entry: centsToEntry(tx.amount), categoryId: tx.categoryId, bucket: tx.bucket,
      source: tx.source ?? 'paycheck', note: tx.note ?? '', date: tx.date, negative: tx.amount < 0,
    };
  }
  return {
    type: preset.type ?? 'expense',
    entry: preset.amount ? centsToEntry(preset.amount) : '',
    categoryId: preset.categoryId ?? null,
    bucket: null,
    source: preset.source ?? 'paycheck',
    note: preset.note ?? '',
    date: preset.date ?? today,
    negative: false,
  };
}

export function openQuickAdd(ctx, { tx = null, preset = {}, onSaved = null } = {}) {
  const editing = Boolean(tx);
  const s = startState(tx, preset, ctx.today);
  const fromBill = Boolean(tx?.recurringId);
  let saving = false;
  let unbind = null;

  const cats = () => categoryMap(ctx.data.categories);
  const cents = () => entryToCents(s.entry);
  const needsCategory = () => s.type === 'expense' || s.type === 'refund';
  const ready = () => cents() > 0 && (!needsCategory() || Boolean(cats().get(s.categoryId)));

  function signedAmount() {
    const c = cents();
    if (s.type === 'expense') return -c;
    if (s.type === 'adjustment') return s.negative ? -c : c;
    return c;
  }

  function saveLabel() {
    if (editing) return 'Save changes';
    const c = cents();
    if (!c) return s.type === 'income' ? 'Add income' : 'Add';
    return `Add ${formatMoney(c)}`;
  }

  function caption() {
    if (s.type === 'income') return `${incomeSource(s.source).emoji} ${incomeSource(s.source).name}`;
    if (s.type === 'adjustment') return s.negative ? 'Lowers your balance' : 'Raises your balance';
    const cat = cats().get(s.categoryId);
    if (!cat) return 'Pick a category';
    const bucket = cat.bucket === 'savings' ? 'Savings' : BUCKET_LABEL[s.bucket ?? cat.bucket];
    return s.type === 'refund' ? `Refund to ${cat.emoji} ${cat.name}` : `${cat.emoji} ${cat.name} · ${bucket}`;
  }

  function typeSwitch() {
    if (s.type === 'adjustment' || fromBill) return '';
    return html`<div class="segmented qa-types" role="group" aria-label="Type">
      ${TYPES.map(([id, label]) => html`<button type="button" class="seg${s.type === id ? ' on' : ''}" data-action="set-type" data-type="${id}" aria-pressed="${s.type === id}">${label}</button>`)}
    </div>`;
  }

  function tiles() {
    if (s.type === 'income') {
      return html`<div class="cat-grid">${INCOME_SOURCES.map((src) => html`
        <button type="button" class="cat-tile${s.source === src.id ? ' on' : ''}" data-action="pick-source" data-id="${src.id}" aria-pressed="${s.source === src.id}" style="--cat:#2F9E44">
          <span class="cat-emoji" aria-hidden="true">${src.emoji}</span><span class="cat-name">${src.name}</span>
        </button>`)}</div>`;
    }
    const all = ctx.data.categories;
    let top = topCategories(all, ctx.data.transactions, ctx.today, 6);
    const chosen = cats().get(s.categoryId);
    if (chosen && !top.some((c) => c.id === chosen.id)) top = [...top.slice(0, 5), chosen];
    return html`<div class="cat-grid">${top.map((c) => html`
      <button type="button" class="cat-tile${s.categoryId === c.id ? ' on' : ''}" data-action="pick-category" data-id="${c.id}" aria-pressed="${s.categoryId === c.id}" style="--cat:${safeColor(c.color)}">
        <span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${breakable(c.name)}</span>
      </button>`)}</div>`;
  }

  function bucketRow() {
    if (s.type === 'income' || s.type === 'adjustment') return '';
    const cat = cats().get(s.categoryId);
    if (cat?.bucket === 'savings') return html`<span class="pill bg-good">${icon('target')} Counts toward savings</span>`;
    const current = cat ? s.bucket ?? cat.bucket : null;
    return html`<div class="segmented sm qa-bucket" role="group" aria-label="Need or want">
      ${['need', 'want'].map((b) => html`<button type="button" class="seg${current === b ? ' on' : ''}" data-action="set-bucket" data-bucket="${b}" aria-pressed="${current === b}" ${cat ? '' : 'disabled'}>${BUCKET_LABEL[b]}</button>`)}
    </div>`;
  }

  function body() {
    const c = cents();
    const maxDate = editing && tx.date > ctx.today ? tx.date : ctx.today;
    return html`
      <div class="qa">
        <div class="qa-amount">
          ${s.type === 'adjustment'
            ? html`<button type="button" class="sign-toggle" data-action="toggle-sign" aria-label="${s.negative ? 'Make it positive' : 'Make it negative'}">${s.negative ? '−' : '+'}</button>`
            : ''}
          <output class="qa-value ${lengthClass(c)}" aria-live="polite">${formatEntry(s.entry)}</output>
          <p class="qa-caption">${caption()}</p>
        </div>
        ${fromBill ? html`<p class="qa-note-bill">${icon('info')}Posted by a bill. Edits change only this charge.</p>` : ''}
        ${needsCategory() || s.type === 'income'
          ? html`<div class="qa-section">
              <div class="qa-section-head">
                <span>${s.type === 'income' ? 'Source' : 'Category'}</span>
                ${s.type === 'income' ? '' : html`<button type="button" class="link-btn sm" data-action="all-categories">All categories</button>`}
              </div>
              ${tiles()}
            </div>`
          : ''}
        <div class="qa-row">
          ${bucketRow()}
          <label class="chip date-chip">
            ${icon('calendar')}<span>${relativeDay(s.date, ctx.today)}</span>
            <input type="date" data-input="date" value="${s.date}" max="${maxDate}" aria-label="Date">
          </label>
        </div>
        <input class="text-input note-input" type="text" data-input="note" value="${s.note}" maxlength="140" placeholder="Note (optional)" aria-label="Note" enterkeyhint="done" autocomplete="off">
        ${keypadHTML()}
        <div class="qa-actions">
          ${editing ? html`<button type="button" class="btn btn-quiet btn-danger" data-action="delete" aria-label="Delete this transaction">${icon('trash')}</button>` : ''}
          <button type="button" class="btn btn-primary btn-block qa-save" data-action="save" ${ready() ? '' : 'disabled'}>${saveLabel()}</button>
        </div>
      </div>`;
  }

  /** Cheap update while typing: only the amount, the caption and the Save button change. */
  function refreshAmount() {
    const out = sheet.body.querySelector('.qa-value');
    if (!out) return;
    out.textContent = formatEntry(s.entry);
    out.className = `qa-value ${lengthClass(cents())}`;
    const save = sheet.body.querySelector('.qa-save');
    save.textContent = saveLabel();
    save.disabled = !ready();
  }

  function rerender() {
    sheet.refresh();
  }

  function onKey(key) {
    const next = keypadPress(s.entry, key);
    if (next === s.entry) return;
    s.entry = next;
    refreshAmount();
  }

  function save() {
    if (saving) return;
    if (!ready()) {
      ctx.toast(cents() > 0 ? 'Pick a category first.' : 'Type an amount first.', { tone: 'bad' });
      return;
    }
    saving = true;
    const fields = { note: s.note, date: s.date, amount: signedAmount() };
    if (s.type === 'income') Object.assign(fields, { type: 'income', source: s.source });
    else if (s.type === 'adjustment') fields.type = 'adjustment';
    else Object.assign(fields, { type: 'expense', categoryId: s.categoryId, bucket: s.bucket });
    let saved = null;
    try {
      const before = ctx.summary;
      ctx.update((d) => {
        const result = editing ? updateTransaction(d, tx.id, fields) : addTransaction(d, fields);
        saved = result.tx;
        return result.data;
      });
      sheet.close();
      if (editing) {
        ctx.toast('Saved');
      } else {
        const what = s.type === 'income' ? incomeSource(s.source).name : cats().get(s.categoryId)?.name ?? '';
        ctx.toast(`Added ${formatMoney(Math.abs(fields.amount))} · ${what}`, {
          action: { label: 'Undo', run: () => ctx.update((d) => deleteTransaction(d, saved.id).data) },
          duration: 5000,
        });
      }
      ctx.afterChange?.(before);
      onSaved?.(saved);
    } catch (err) {
      saving = false;
      ctx.toast(err.message, { tone: 'bad' });
    }
  }

  function remove() {
    let removed = null;
    ctx.update((d) => {
      const result = deleteTransaction(d, tx.id);
      removed = result.removed;
      return result.data;
    });
    sheet.close();
    ctx.toast('Deleted', {
      action: { label: 'Undo', run: () => ctx.update((d) => restoreTransaction(d, removed)) },
      duration: 5000,
    });
  }

  function openAllCategories() {
    const picker = openSheet({
      title: 'Categories',
      className: 'picker',
      render: () => html`
        <div class="cat-grid cat-grid-all">
          ${ctx.data.categories.map((c) => html`
            <button type="button" class="cat-tile${s.categoryId === c.id ? ' on' : ''}" data-action="choose" data-id="${c.id}" aria-pressed="${s.categoryId === c.id}" style="--cat:${safeColor(c.color)}">
              <span class="cat-emoji" aria-hidden="true">${c.emoji}</span><span class="cat-name">${breakable(c.name)}</span>
            </button>`)}
        </div>
        <button type="button" class="btn btn-quiet btn-block" data-action="manage">${icon('edit')} Manage categories</button>`,
      actions: {
        choose(el) {
          s.categoryId = el.dataset.id;
          s.bucket = null;
          picker.close();
          rerender();
        },
        async manage() {
          await closeAllSheets();
          ctx.navigate('settings/categories');
        },
      },
    });
  }

  const sheet = openSheet({
    title: fromBill ? 'Bill charge' : s.type === 'adjustment' ? 'Adjustment' : editing ? 'Edit transaction' : 'Add',
    hideTitle: !(fromBill || s.type === 'adjustment'),
    className: 'quickadd',
    header: typeSwitch,
    render: body,
    mount(sh) {
      if (!unbind) unbind = bindKeypad(sh.body, onKey, { onEnter: save });
    },
    onClose() {
      unbind?.();
    },
    actions: {
      'set-type'(el) {
        if (s.type === el.dataset.type) return;
        s.type = el.dataset.type;
        rerender();
      },
      'pick-category'(el) {
        s.categoryId = el.dataset.id;
        s.bucket = null;
        rerender();
      },
      'pick-source'(el) {
        s.source = el.dataset.id;
        rerender();
      },
      'set-bucket'(el) {
        const cat = cats().get(s.categoryId);
        if (!cat) return;
        const b = el.dataset.bucket;
        s.bucket = b === cat.bucket ? null : b;
        rerender();
      },
      'toggle-sign'() {
        s.negative = !s.negative;
        rerender();
      },
      'all-categories': openAllCategories,
      save,
      delete: remove,
    },
    inputs: {
      note(el) {
        s.note = el.value;
      },
      date(el, e) {
        if (e.type !== 'change' || !el.value) return;
        s.date = el.value;
        rerender();
      },
    },
  });
  return sheet;
}
