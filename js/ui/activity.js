// Activity: every transaction, grouped by day, with search, filters, swipe-to-delete and Undo.
import { html, setHTML } from './dom.js';
import { icon } from './icons.js';
import { openSheet } from './sheet.js';
import { openQuickAdd } from './quickadd.js';
import { editCardTransaction } from './card-sheets.js';
import { txView, plural } from './format.js';
import { formatMoney } from '../money.js';
import { relativeDay, periodFor, periodLabel } from '../dates.js';
import { categoryMap, BUCKET_LABEL } from '../categories.js';
import { filterTransactions, groupByDay } from '../search.js';
import { deleteTransaction, restoreTransaction } from '../actions.js';

const PAGE = 150;
const KIND_LABEL = { expense: 'Expenses', refund: 'Refunds', income: 'Income', adjustment: 'Adjustments' };
const CARD_KIND_LABEL = { cardPayment: 'Card payments', cashback: 'Cash back credits' };

/** Card id to card, so rows can name the card a purchase went on. */
export const cardMap = (data) => new Map((data.cards ?? []).map((c) => [c.id, c]));
const BUCKET_FILTER_LABEL = { need: 'Needs', want: 'Wants', savings: 'Savings' };

let shown = PAGE;

/** One transaction row. With `swipe`, it can be swiped left to delete. */
export function txRow(tx, cats, { swipe = true, cards = null, showCard = true } = {}) {
  const v = txView(tx, cats, cards, { showCard });
  return html`<li class="tx-row" data-id="${tx.id}">
    ${swipe ? html`<button type="button" class="tx-delete" data-action="delete-tx" data-id="${tx.id}" tabindex="-1">${icon('trash')}<span>Delete</span></button>` : ''}
    <button type="button" class="tx-main" data-action="edit-tx" data-id="${tx.id}">
      <span class="tx-icon" style="--cat:${v.color}" aria-hidden="true">${v.emoji}</span>
      <span class="tx-text"><span class="tx-title">${v.title}</span><span class="tx-sub">${v.sub}</span></span>
      <span class="tx-amount${v.tone ? ` tone-${v.tone}` : ''}">${v.amount}</span>
    </button>
  </li>`;
}

function filters(ctx) {
  return { q: '', categoryId: null, kind: null, bucket: null, period: null, ...(ctx.ui.activity ?? {}) };
}

function setFilters(ctx, patch) {
  ctx.setUI({ activity: { ...filters(ctx), ...patch } });
  shown = PAGE;
}

function chip(label, action, active) {
  return html`<button type="button" class="chip filter-chip${active ? ' on' : ''}" data-action="${action}" aria-haspopup="dialog">${label}${icon('chevronDown')}</button>`;
}

export function render(ctx) {
  const f = filters(ctx);
  const cat = f.categoryId ? categoryMap(ctx.data.categories).get(f.categoryId) : null;
  const anyFilter = f.categoryId || f.kind || f.bucket || f.period || f.q;
  return html`<main class="screen activity" id="main">
    <h1 class="large-title">Activity</h1>
    <div class="search">
      ${icon('search')}
      <input type="search" class="search-input" data-input="search" value="${f.q}" placeholder="Search notes and categories" aria-label="Search transactions" enterkeyhint="search" autocomplete="off">
    </div>
    <div class="filter-row" role="group" aria-label="Filters">
      ${f.period ? html`<button type="button" class="chip filter-chip on" data-action="clear-period" aria-label="Remove month filter">${periodLabel(periodFor(f.period.start, f.period.startDay))}${icon('close')}</button>` : ''}
      ${chip(cat ? `${cat.emoji} ${cat.name}` : 'Category', 'filter-category', Boolean(cat))}
      ${chip(f.kind ? { ...KIND_LABEL, ...CARD_KIND_LABEL }[f.kind] : 'Type', 'filter-kind', Boolean(f.kind))}
      ${chip(f.bucket ? BUCKET_FILTER_LABEL[f.bucket] : 'Need or want', 'filter-bucket', Boolean(f.bucket))}
      ${anyFilter ? html`<button type="button" class="link-btn sm" data-action="clear-filters">Clear</button>` : ''}
    </div>
    <div class="tx-list" id="tx-list">${list(ctx)}</div>
  </main>`;
}

function list(ctx) {
  const f = filters(ctx);
  const cats = categoryMap(ctx.data.categories);
  const cards = cardMap(ctx.data);
  if (!ctx.data.transactions.length) {
    return html`<div class="empty">
      <div class="empty-icon">${icon('list')}</div>
      <p class="empty-title">No activity yet</p>
      <p class="empty-text">Tap + to log your first purchase. It takes about 3 seconds.</p>
    </div>`;
  }
  const all = filterTransactions(ctx.data, {
    q: f.q, categoryId: f.categoryId, kind: f.kind, bucket: f.bucket,
    from: f.period?.start ?? null, to: f.period?.end ?? null,
  });
  if (!all.length) {
    return html`<div class="empty">
      <div class="empty-icon">${icon('search')}</div>
      <p class="empty-title">Nothing matches</p>
      <p class="empty-text">Try a different search, or clear the filters.</p>
      <button type="button" class="btn btn-quiet" data-action="clear-filters">Clear filters</button>
    </div>`;
  }
  const groups = groupByDay(all.slice(0, shown), ctx.data.categories);
  return html`
    <p class="list-count">${plural(all.length, 'transaction')}</p>
    ${groups.map((g) => html`<section class="day-group" aria-label="${relativeDay(g.date, ctx.today)}">
      <h2 class="day-head">
        <span>${relativeDay(g.date, ctx.today)}</span>
        <span class="day-total">
          ${g.spent ? html`<span>${formatMoney(g.spent)} spent</span>` : ''}
          ${g.back ? html`<span class="tone-good">${formatMoney(g.back, { sign: true })}</span>` : ''}
          ${!g.spent && !g.back && g.saved ? html`<span>${formatMoney(g.saved)} saved</span>` : ''}
        </span>
      </h2>
      <ul class="card list-card tx-rows">${g.items.map((t) => txRow(t, cats, { cards }))}</ul>
    </section>`)}
    ${all.length > shown ? html`<button type="button" class="btn btn-quiet btn-block more" data-action="show-more">Show more</button>` : ''}`;
}

function refreshList(ctx) {
  const el = document.getElementById('tx-list');
  if (el) setHTML(el, list(ctx));
}

function pickFrom(ctx, title, options, current, onPick) {
  const sheet = openSheet({
    title,
    className: 'picker',
    render: () => html`<ul class="card list-card option-list">${options.map((o) => html`
      <li><button type="button" class="option${o.value === current ? ' on' : ''}" data-action="pick" data-value="${o.value ?? ''}" aria-pressed="${o.value === current}">
        ${o.emoji ? html`<span class="option-emoji" aria-hidden="true">${o.emoji}</span>` : ''}
        <span class="option-label">${o.label}</span>
        ${o.value === current ? icon('check', { cls: 'option-check' }) : ''}
      </button></li>`)}</ul>`,
    actions: {
      pick(el) {
        onPick(el.dataset.value || null);
        sheet.close();
      },
    },
  });
}

export function deleteWithUndo(ctx, id) {
  let removed = null;
  ctx.update((d) => {
    const result = deleteTransaction(d, id);
    removed = result.removed;
    return result.data;
  });
  if (!removed) return;
  const title = txView(removed.tx, categoryMap(ctx.data.categories), cardMap(ctx.data)).title;
  ctx.toast(`Deleted ${title}`, {
    action: { label: 'Undo', run: () => ctx.update((d) => restoreTransaction(d, removed)) },
    duration: 5000,
  });
}

export function editTransaction(ctx, id) {
  const tx = ctx.data.transactions.find((t) => t.id === id);
  if (!tx) return;
  if (tx.type === 'cardPayment' || tx.type === 'cashback') editCardTransaction(ctx, tx);
  else openQuickAdd(ctx, { tx });
}

export const actions = {
  'edit-tx': (ctx, el) => editTransaction(ctx, el.dataset.id),
  'delete-tx': (ctx, el) => deleteWithUndo(ctx, el.dataset.id),
  'filter-category'(ctx) {
    const f = filters(ctx);
    pickFrom(ctx, 'Category', [{ value: null, label: 'All categories' }, ...ctx.data.categories.map((c) => ({ value: c.id, label: c.name, emoji: c.emoji }))], f.categoryId, (v) => {
      setFilters(ctx, { categoryId: v });
      ctx.rerender();
    });
  },
  'filter-kind'(ctx) {
    const kinds = (ctx.data.cards ?? []).length ? { ...KIND_LABEL, ...CARD_KIND_LABEL } : KIND_LABEL;
    pickFrom(ctx, 'Type', [{ value: null, label: 'All types' }, ...Object.entries(kinds).map(([value, label]) => ({ value, label }))], filters(ctx).kind, (v) => {
      setFilters(ctx, { kind: v });
      ctx.rerender();
    });
  },
  'filter-bucket'(ctx) {
    pickFrom(ctx, 'Need or want', [{ value: null, label: 'Needs and wants' }, ...Object.entries(BUCKET_FILTER_LABEL).map(([value, label]) => ({ value, label }))], filters(ctx).bucket, (v) => {
      setFilters(ctx, { bucket: v });
      ctx.rerender();
    });
  },
  'clear-period'(ctx) {
    setFilters(ctx, { period: null });
    ctx.rerender();
  },
  'clear-filters'(ctx) {
    setFilters(ctx, { q: '', categoryId: null, kind: null, bucket: null, period: null });
    ctx.rerender();
  },
  'show-more'(ctx) {
    shown += PAGE;
    refreshList(ctx);
  },
};

let searchTimer = null;
export const inputs = {
  search(ctx, el) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      setFilters(ctx, { q: el.value });
      refreshList(ctx);
    }, 120);
  },
};

/** Swipe left on a row to reveal Delete; swipe far to delete at once. */
export function attachSwipe(root, ctx) {
  const REVEAL = 92;
  let drag = null;
  let open = null;
  let suppressClick = false;

  const close = (main) => {
    main.style.transform = '';
    main.closest('.tx-row')?.classList.remove('open');
    if (open === main) open = null;
  };

  const onDown = (e) => {
    const main = e.target.closest('.tx-main');
    if (!main || !root.contains(main) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!main.closest('.tx-row').querySelector('.tx-delete')) return;
    if (open && open !== main) close(open);
    drag = { main, x: e.clientX, y: e.clientY, dx: 0, base: open === main ? -REVEAL : 0, mode: null, id: e.pointerId };
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (drag.mode === 'h') {
        drag.main.setPointerCapture(e.pointerId);
        drag.main.classList.add('dragging');
        drag.main.closest('.tx-row').classList.add('swiping');
      }
    }
    if (drag.mode !== 'h') return;
    e.preventDefault();
    drag.dx = Math.min(0, drag.base + dx);
    drag.main.style.transform = `translateX(${drag.dx}px)`;
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { main, mode, dx } = drag;
    drag = null;
    if (mode !== 'h') return;
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 60);
    main.classList.remove('dragging');
    setTimeout(() => main.closest('.tx-row')?.classList.remove('swiping'), 260);
    const width = main.offsetWidth;
    if (dx < -width * 0.55) {
      main.style.transform = `translateX(${-width}px)`;
      setTimeout(() => deleteWithUndo(ctx, main.dataset.id), 140);
    } else if (dx < -REVEAL / 2) {
      main.style.transform = `translateX(${-REVEAL}px)`;
      main.closest('.tx-row').classList.add('open');
      open = main;
    } else {
      close(main);
    }
  };
  const onClickCapture = (e) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (open && !e.target.closest('.tx-delete')) {
      const tapped = e.target.closest('.tx-main');
      close(open);
      if (tapped) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('click', onClickCapture, true);
  return () => {
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onUp);
    root.removeEventListener('click', onClickCapture, true);
  };
}

export function mount(root, ctx) {
  return attachSwipe(root, ctx);
}
