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

/** Every transaction, oldest first. Starts with a byte-order mark so Excel reads emoji correctly. */
export function transactionsToCSV(data) {
  const cats = categoryMap(data.categories);
  const sorted = [...data.transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
  const lines = ['Date,Type,Category,Bucket,Amount,Note'];
  for (const tx of sorted) {
    let type = 'Adjustment';
    let category = '';
    let bucket = '';
    if (tx.type === 'expense') {
      type = tx.amount > 0 ? 'Refund' : 'Expense';
      category = cats.get(tx.categoryId)?.name ?? 'Uncategorized';
      bucket = BUCKET_LABEL[effectiveBucket(tx, cats)];
    } else if (tx.type === 'income') {
      type = 'Income';
      category = incomeSource(tx.source).name;
    }
    lines.push([
      csvCell(tx.date),
      csvCell(type),
      csvCell(category, true),
      csvCell(bucket),
      csvCell(centsToDecimal(tx.amount)),
      csvCell(tx.note, true),
    ].join(','));
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
