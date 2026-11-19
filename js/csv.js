// Export transactions as CSV for Excel or Google Sheets.
import { centsToDecimal } from './money.js';
import { categoryMap, effectiveBucket, BUCKET_LABEL, incomeSource } from './categories.js';

// Byte-order mark: tells Excel the file is UTF-8, so emoji and accents survive.
const BOM = String.fromCharCode(0xfeff);

// Cells starting with these could run as formulas when opened in a spreadsheet.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell. Text cells are guarded against formula injection. */
export function csvCell(value, text = false) {
  let s = value === null || value === undefined ? '' : String(value);
  if (text && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const cardName = (data, id) => (data.cards ?? []).find((c) => c.id === id)?.name ?? 'Card';

/**
 * Every transaction, oldest first. Starts with a byte-order mark so Excel reads emoji correctly.
 * "Paid with" is Debit (the bank) or the card's name. A card payment shows as money out of the
 * bank, with the card it paid in the Category column.
 */
export function transactionsToCSV(data) {
  const cats = categoryMap(data.categories);
  const sorted = [...data.transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
  const lines = ['Date,Type,Category,Bucket,Amount,Paid with,Note'];
  for (const tx of sorted) {
    let type = 'Adjustment';
    let category = '';
    let bucket = '';
    let amount = tx.amount;
    const account = tx.account ?? 'bank';
    let paidWith = account === 'bank' ? 'Debit' : cardName(data, account);
    if (tx.type === 'expense') {
      type = tx.amount > 0 ? 'Refund' : 'Expense';
      category = cats.get(tx.categoryId)?.name ?? 'Uncategorized';
      bucket = BUCKET_LABEL[effectiveBucket(tx, cats)];
    } else if (tx.type === 'income') {
      type = 'Income';
      category = incomeSource(tx.source).name;
    } else if (tx.type === 'cardPayment') {
      type = 'Card payment';
      category = cardName(data, tx.cardId);
      amount = -tx.amount;
      paidWith = 'Debit';
    } else if (tx.type === 'cashback') {
      type = 'Cash back';
    }
    lines.push([
      csvCell(tx.date),
      csvCell(type),
      csvCell(category, true),
      csvCell(bucket),
      csvCell(centsToDecimal(amount)),
      csvCell(paidWith, true),
      csvCell(tx.note, true),
    ].join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
