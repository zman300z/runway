// Money helpers. Every amount in Runway is an integer number of cents.
// Parse text straight into cents, add and subtract cents, and only turn
// cents back into text for display. Never do math on floating point dollars.

/** Largest single amount Runway accepts: $1,000,000.00. */
export const MAX_CENTS = 100000000;

const currency = (extra = {}) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...extra });
const USD = currency();
const USD_SIGNED = currency({ signDisplay: 'exceptZero' });
const USD_WHOLE = currency({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
const USD_COMPACT = currency({ notation: 'compact', maximumFractionDigits: 1 });
const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** True when n is a usable amount of cents: a safe integer within the cap. */
export function isValidAmount(n) {
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_CENTS;
}

const asInt = (n) => (Number.isSafeInteger(n) ? n : Math.round(Number(n) || 0));

/** Exact decimal text for integer cents, for example -123456 becomes "-1234.56". */
export function centsToDecimal(cents) {
  const c = asInt(cents);
  const abs = Math.abs(c);
  const rem = abs % 100;
  return `${c < 0 ? '-' : ''}${(abs - rem) / 100}.${String(rem).padStart(2, '0')}`;
}

/**
 * "$1,234.56". With { sign: true } positive amounts get a "+".
 * Intl gets an exact decimal string built from the cents, so no float math happens here either.
 */
export function formatMoney(cents, { sign = false } = {}) {
  return (sign ? USD_SIGNED : USD).format(centsToDecimal(cents));
}

/** "$1,235": rounded to whole dollars, for tight labels. */
export function formatWholeMoney(cents) {
  return USD_WHOLE.format(centsToDecimal(cents));
}

/** "$1.2K": compact labels for chart axes. */
export function formatCompactMoney(cents) {
  return USD_COMPACT.format(centsToDecimal(cents));
}

/** Whole dollars rounded down: 2399 becomes 23, -450 becomes -5. */
export function floorDollars(cents) {
  const c = asInt(cents);
  const rem = ((c % 100) + 100) % 100;
  return (c - rem) / 100;
}

const AMOUNT_RE = /^([+-]?)\s*\$?\s*([+-]?)\s*([\d,]*)(?:\.(\d*))?$/;

/**
 * Turn typed text into cents. Accepts "4.5", "$1,234.56", "-3.20", "$-3.20" and "(3.20)".
 * Returns null for anything that is not clearly an amount, including "4,50"
 * (a European decimal comma would otherwise turn $4.50 into $450).
 * More than two decimals round half away from zero.
 */
export function parseMoney(input) {
  if (typeof input === 'number') input = Number.isFinite(input) ? String(input) : '';
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/−/g, '-');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const [, sign1, sign2, intRaw, frac = ''] = m;
  if (sign1 && sign2) return null;
  if (paren && (sign1 || sign2)) return null;
  if (sign1 === '-' || sign2 === '-') negative = true;
  if (intRaw === '' && frac === '') return null;
  if (intRaw.includes(',') && !/^\d{1,3}(,\d{3})+$/.test(intRaw)) return null;
  const intDigits = intRaw.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  if (intDigits.length > 9) return null;
  let cents = Number(intDigits || '0') * 100 + Number(`${frac}00`.slice(0, 2));
  if (frac.length > 2 && frac[2] >= '5') cents += 1;
  return negative && cents !== 0 ? -cents : cents;
}

// Custom keypad. The entry is the text typed so far, like "4.5".

/** Most whole-dollar digits the keypad allows ($999,999.99). */
export const KEYPAD_MAX_DIGITS = 6;

/** Apply one keypad key ("0" to "9", ".", "back", "clear") to the entry text. */
export function keypadPress(entry, key, maxDigits = KEYPAD_MAX_DIGITS) {
  if (key === 'clear') return '';
  if (key === 'back') return entry.slice(0, -1);
  if (key === '.') {
    if (entry.includes('.')) return entry;
    return entry === '' ? '0.' : `${entry}.`;
  }
  if (!/^\d$/.test(key)) return entry;
  if (entry.includes('.')) {
    return entry.split('.')[1].length >= 2 ? entry : entry + key;
  }
  if (entry === '0') return key;
  if (entry.length >= maxDigits) return entry;
  return entry + key;
}

/** Cents for a keypad entry. An empty entry is 0. */
export function entryToCents(entry) {
  if (!entry) return 0;
  return parseMoney(entry) ?? 0;
}

/** Keypad entry text for an existing amount (sign dropped): 450 becomes "4.50", 400 becomes "4". */
export function centsToEntry(cents) {
  if (!cents) return '';
  const s = centsToDecimal(Math.abs(asInt(cents)));
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

/** The keypad display: "$1,234.5" while typing, "$0" when empty. */
export function formatEntry(entry) {
  if (!entry) return '$0';
  const [whole, frac] = entry.split('.');
  const grouped = GROUPED.format(Number(whole || '0'));
  return `$${grouped}${entry.includes('.') ? `.${frac}` : ''}`;
}

/** Sum a list of cents (or of picked cents). */
export function sumCents(list, pick = (x) => x) {
  let total = 0;
  for (const item of list) total += pick(item);
  return total;
}
