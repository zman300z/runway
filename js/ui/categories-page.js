// Categories: add, rename, pick emoji and color, set Need / Want / Savings and a limit,
// drag to reorder, and delete (moving its transactions first).
import { html } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { moneyInput, moneyText, readMoney, field, errorLine, showFormError } from './forms.js';
import { safeColor, plural } from './format.js';
import { formatWholeMoney } from '../money.js';
import { BUCKET_LABEL, CATEGORY_COLORS, EMOJI_CHOICES } from '../categories.js';
import { addCategory, updateCategory, moveCategory, deleteCategory } from '../actions.js';

export function render(ctx) {
  const cats = ctx.data.categories;
  return html`<main class="screen categories" id="main">
    <header class="navbar">
      <button type="button" class="nav-back" data-action="back">${icon('chevronLeft')}<span>Settings</span></button>
      <button type="button" class="icon-btn" data-action="add-category" aria-label="Add a category">${icon('plus')}</button>
    </header>
    <h1 class="large-title">Categories</h1>
    <p class="group-foot top">Drag the handle to reorder. Tap a category to edit it.</p>
    <ul class="card list-card cat-list" id="cat-list">
      ${cats.map((c, i) => html`<li class="cat-row" data-id="${c.id}">
        <span class="grip" data-grip aria-hidden="true">${icon('grip')}</span>
        <button type="button" class="row cat-edit" data-action="edit-category" data-id="${c.id}" aria-label="${c.name}, ${BUCKET_LABEL[c.bucket]}${c.limit ? `, limit ${formatWholeMoney(c.limit)}` : ''}. Position ${i + 1} of ${cats.length}.">
          <span class="cat-dot" style="--cat:${safeColor(c.color)}" aria-hidden="true">${c.emoji}</span>
          <span class="row-label">${c.name}<span class="row-sub">${BUCKET_LABEL[c.bucket]}${c.limit ? ` · ${formatWholeMoney(c.limit)} limit` : ''}</span></span>
          ${icon('chevronRight', { cls: 'row-chevron' })}
        </button>
      </li>`)}
    </ul>
  </main>`;
}

function inUseCount(data, id) {
  return data.transactions.filter((t) => t.categoryId === id).length + data.recurring.filter((b) => b.categoryId === id).length;
}

function categorySheet(ctx, id = null) {
  const existing = id ? ctx.data.categories.find((c) => c.id === id) : null;
  const st = {
    name: existing?.name ?? '',
    emoji: existing?.emoji ?? '📦',
    color: existing?.color ?? CATEGORY_COLORS[ctx.data.categories.length % CATEGORY_COLORS.length],
    bucket: existing?.bucket ?? 'want',
    limit: moneyText(existing?.limit ?? null),
  };

  const sheet = openSheet({
    title: existing ? 'Edit category' : 'New category',
    render: () => html`
      <div class="cat-preview">
        <span class="cat-dot lg" style="--cat:${safeColor(st.color)}" aria-hidden="true">${st.emoji}</span>
        <span class="cat-preview-name">${st.name || 'Category name'}</span>
      </div>
      ${field('Name', html`<input type="text" class="field-input" maxlength="40" value="${st.name}" placeholder="Gym" data-input="name" autocomplete="off" aria-label="Category name">`)}
      ${field('Emoji', html`<div class="emoji-grid" role="group" aria-label="Pick an emoji">${EMOJI_CHOICES.map((e) => html`<button type="button" class="emoji-btn${st.emoji === e ? ' on' : ''}" data-action="pick-emoji" data-emoji="${e}" aria-pressed="${st.emoji === e}">${e}</button>`)}</div>
        <input type="text" class="field-input emoji-input" maxlength="8" value="${EMOJI_CHOICES.includes(st.emoji) ? '' : st.emoji}" placeholder="Or type any emoji" data-input="emoji" aria-label="Type an emoji">`)}
      ${field('Color', html`<div class="swatches" role="group" aria-label="Pick a color">${CATEGORY_COLORS.map((c) => html`<button type="button" class="swatch${st.color === c ? ' on' : ''}" style="--sw:${c}" data-action="pick-color" data-color="${c}" aria-label="Color ${c}" aria-pressed="${st.color === c}">${st.color === c ? icon('check') : ''}</button>`)}</div>`)}
      ${field('Counts as', html`<div class="segmented" role="group" aria-label="Need, want or savings">${['need', 'want', 'savings'].map((b) => html`<button type="button" class="seg${st.bucket === b ? ' on' : ''}" data-action="pick-bucket" data-bucket="${b}" aria-pressed="${st.bucket === b}">${BUCKET_LABEL[b]}</button>`)}</div>`,
        st.bucket === 'savings' ? 'Money logged here counts toward your savings goal, not your spending.' : 'You can still flip a single purchase between Need and Want.')}
      ${st.bucket === 'savings' ? '' : field('Monthly limit (optional)', moneyInput({ name: 'limit', value: st.limit, label: 'Monthly limit for this category', placeholder: 'No limit' }), 'Runway warns you at 80% and 100%.')}
      ${errorLine()}
      <button type="button" class="btn btn-primary btn-block" data-action="save">${existing ? 'Save' : 'Add category'}</button>
      ${existing ? html`<div class="move-row">
          <button type="button" class="btn btn-quiet btn-sm" data-action="move" data-dir="-1">${icon('arrowUp')}Move up</button>
          <button type="button" class="btn btn-quiet btn-sm" data-action="move" data-dir="1">${icon('arrowDown')}Move down</button>
        </div>
        <button type="button" class="btn btn-plain btn-block btn-danger" data-action="delete">${icon('trash')}Delete category</button>` : ''}`,
    inputs: {
      name(el, e, sh) {
        st.name = el.value;
        sh.body.querySelector('.cat-preview-name').textContent = st.name || 'Category name';
      },
      emoji(el, e, sh) {
        const v = el.value.trim();
        if (!v) return;
        st.emoji = [...v].slice(0, 2).join('');
        sh.body.querySelector('.cat-preview .cat-dot').textContent = st.emoji;
      },
      limit: (el) => { st.limit = el.value; },
    },
    actions: {
      'pick-emoji'(el, e, sh) {
        st.emoji = el.dataset.emoji;
        sh.refresh();
      },
      'pick-color'(el, e, sh) {
        st.color = el.dataset.color;
        sh.refresh();
      },
      'pick-bucket'(el, e, sh) {
        st.bucket = el.dataset.bucket;
        sh.refresh();
      },
      save() {
        const limit = st.bucket === 'savings' ? null : readMoney(st.limit);
        if (Number.isNaN(limit)) return showFormError(sheet.body, 'That limit doesn\'t look right.');
        const fields = { name: st.name, emoji: st.emoji, color: st.color, bucket: st.bucket, limit: limit || null };
        try {
          if (existing) ctx.update((d) => updateCategory(d, existing.id, fields));
          else ctx.update((d) => addCategory(d, fields).data);
        } catch (err) {
          return showFormError(sheet.body, err.message);
        }
        sheet.close();
        return ctx.toast(existing ? 'Category saved' : `Added ${st.name.trim()}`);
      },
      move(el) {
        const index = ctx.data.categories.findIndex((c) => c.id === existing.id);
        ctx.update((d) => moveCategory(d, existing.id, index + Number(el.dataset.dir)));
      },
      delete() {
        confirmDelete(ctx, existing, sheet);
      },
    },
  });
}

function confirmDelete(ctx, cat, parentSheet) {
  if (ctx.data.categories.length <= 1) {
    ctx.toast('Keep at least one category.', { tone: 'bad' });
    return;
  }
  const count = inUseCount(ctx.data, cat.id);
  const finish = (moveTo) => {
    const before = ctx.data;
    let after;
    try {
      after = ctx.update((d) => deleteCategory(d, cat.id, moveTo));
    } catch (err) {
      ctx.toast(err.message, { tone: 'bad' });
      return;
    }
    parentSheet.close();
    const target = moveTo ? ctx.data.categories.find((c) => c.id === moveTo) : null;
    ctx.toast(target ? `Deleted ${cat.name}. Moved ${plural(count, 'item')} to ${target.name}.` : `Deleted ${cat.name}`, {
      duration: 5000,
      action: {
        label: 'Undo',
        run: () => {
          if (ctx.data !== after) {
            ctx.toast("Can't undo after other changes.", { tone: 'bad' });
            return;
          }
          ctx.update(() => before);
        },
      },
    });
  };
  if (!count) {
    finish(null);
    return;
  }
  const picker = openSheet({
    title: `Move ${plural(count, 'item')}`,
    className: 'picker',
    render: () => html`
      <p class="sheet-lead">${cat.name} has ${plural(count, 'transaction or bill', 'transactions and bills')}. Pick where they should go.</p>
      <ul class="card list-card option-list">${ctx.data.categories.filter((c) => c.id !== cat.id).map((c) => html`
        <li><button type="button" class="option" data-action="move-to" data-id="${c.id}">
          <span class="option-emoji" aria-hidden="true">${c.emoji}</span><span class="option-label">${c.name}</span>
        </button></li>`)}</ul>`,
    actions: {
      'move-to'(el) {
        picker.close();
        finish(el.dataset.id);
      },
    },
  });
}

export const actions = {
  'add-category': (ctx) => categorySheet(ctx),
  'edit-category': (ctx, el) => categorySheet(ctx, el.dataset.id),
};

export const inputs = {};

/** Drag a row by its handle to reorder. */
export function mount(root, ctx) {
  const list = root.querySelector('#cat-list');
  if (!list) return null;
  let drag = null;
  const onDown = (e) => {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    e.preventDefault();
    const rowEl = grip.closest('.cat-row');
    const rows = [...list.children];
    drag = {
      rowEl, rows, id: e.pointerId, startY: e.clientY,
      index: rows.indexOf(rowEl), target: rows.indexOf(rowEl), h: rowEl.getBoundingClientRect().height,
    };
    grip.setPointerCapture(e.pointerId);
    rowEl.classList.add('lifted');
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    drag.rowEl.style.transform = `translateY(${dy}px)`;
    const target = Math.max(0, Math.min(drag.rows.length - 1, drag.index + Math.round(dy / drag.h)));
    drag.target = target;
    drag.rows.forEach((r, i) => {
      if (r === drag.rowEl) return;
      let shift = 0;
      if (i > drag.index && i <= target) shift = -drag.h;
      else if (i < drag.index && i >= target) shift = drag.h;
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { rowEl, rows, index, target } = drag;
    drag = null;
    rows.forEach((r) => {
      r.style.transform = '';
    });
    rowEl.classList.remove('lifted');
    if (target !== index) ctx.update((d) => moveCategory(d, rowEl.dataset.id, target));
  };
  list.addEventListener('pointerdown', onDown);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', onUp);
  list.addEventListener('pointercancel', onUp);
  return () => {
    list.removeEventListener('pointerdown', onDown);
    list.removeEventListener('pointermove', onMove);
    list.removeEventListener('pointerup', onUp);
    list.removeEventListener('pointercancel', onUp);
  };
}
