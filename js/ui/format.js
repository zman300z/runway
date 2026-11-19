// Display helpers shared by the screens.
import { formatMoney } from '../money.js';
import { effectiveBucket, incomeSource, BUCKET_LABEL } from '../categories.js';
import { html, esc, raw } from './dom.js';

/** Only plain hex colors reach CSS, so a tampered backup can't smuggle styles in. */
export function safeColor(color, fallback = '#868E96') {
  return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : fallback;
}

/** Big display money: "$1,234" plus a smaller ".56". */
export function bigMoney(cents) {
  const s = formatMoney(cents);
  const dot = s.lastIndexOf('.');
  return html`<span class="whole">${s.slice(0, dot)}</span><span class="cents">${s.slice(dot)}</span>`;
}

/** Size class so long numbers shrink instead of overflowing. */
export function lengthClass(cents) {
  const len = formatMoney(cents).length;
  if (len <= 7) return 'len-xl';
  if (len <= 10) return 'len-lg';
  return 'len-md';
}

/** Category names like "Fun/Entertainment" may wrap after the slash. */
export function breakable(name) {
  return raw(esc(name).replace(/\//g, '/<wbr>'));
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** How one transaction reads in a list. */
export function txView(tx, cats) {
  if (tx.type === 'income') {
    const src = incomeSource(tx.source);
    return {
      emoji: src.emoji, color: '#2F9E44', title: tx.note || src.name, sub: tx.note ? src.name : 'Income',
      amount: formatMoney(tx.amount, { sign: true }), tone: 'good', kind: 'income',
    };
  }
  if (tx.type === 'adjustment') {
    return {
      emoji: '⚖️', color: '#868E96', title: tx.note || 'Adjustment', sub: 'Adjustment',
      amount: formatMoney(tx.amount, { sign: true }), tone: tx.amount > 0 ? 'good' : '', kind: 'adjustment',
    };
  }
  const cat = cats.get(tx.categoryId);
  const name = cat?.name ?? 'Uncategorized';
  const refund = tx.amount > 0;
  const parts = [];
  if (refund) parts.push('Refund');
  if (tx.note) parts.push(name);
  if (tx.recurringId) parts.push('Bill');
  parts.push(BUCKET_LABEL[effectiveBucket(tx, cats)]);
  return {
    emoji: cat?.emoji ?? '📦',
    color: safeColor(cat?.color),
    title: tx.note || name,
    sub: parts.join(' · '),
    amount: refund ? formatMoney(tx.amount, { sign: true }) : formatMoney(-tx.amount),
    tone: refund ? 'good' : '',
    kind: refund ? 'refund' : 'expense',
  };
}
