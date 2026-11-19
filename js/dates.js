// Local calendar dates, stored as "YYYY-MM-DD" strings in the phone's own time zone.
// Rules: build "today" from local date parts (never toISOString, which is UTC), and do
// day math on whole-day numbers from Date.UTC, so daylight saving can never shift a date.

const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

/** Today's local date. A purchase at 11:30pm stays on today. */
export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parseISO(iso) {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y, m) {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

export function isValidISO(iso) {
  if (typeof iso !== 'string') return false;
  const m = ISO_RE.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1970 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Whole days since 1970-01-01 for a date. */
export function dayNumber(iso) {
  const { y, m, d } = parseISO(iso);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(n) {
  const t = new Date(n * DAY_MS);
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addDays(iso, n) {
  return fromDayNumber(dayNumber(iso) + n);
}

/** Whole days from a to b (b minus a). */
export function diffDays(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/**
 * Add whole months. The day is pinned to `day` (default: the date's own day) and clamped
 * to the month's length, so the 31st becomes the 30th or the 28th, but never drifts.
 */
export function addMonths(iso, n, day) {
  const p = parseISO(iso);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return toISO(y, m, Math.min(day ?? p.d, daysInMonth(y, m)));
}

/** 0 = Sunday to 6 = Saturday. */
export function weekday(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const minDate = (a, b) => (a <= b ? a : b);
export const maxDate = (a, b) => (a >= b ? a : b);
export const inRange = (iso, start, end) => iso >= start && iso <= end;

// Budget months

/** Month start day setting, kept between 1 and 28 so every month has that day. */
export function clampStartDay(n) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return v > 28 ? 28 : v;
}

/**
 * The budget month that contains `iso`. startDay 1 means calendar months;
 * startDay 15 means the 15th through the 14th of the next month.
 */
export function periodFor(iso, startDay = 1) {
  const sd = clampStartDay(startDay);
  const { y, m, d } = parseISO(iso);
  let py = y;
  let pm = m;
  if (d < sd) {
    pm -= 1;
    if (pm === 0) {
      pm = 12;
      py -= 1;
    }
  }
  const start = toISO(py, pm, sd);
  const nextStart = addMonths(start, 1, sd);
  return { start, end: addDays(nextStart, -1), nextStart, startDay: sd };
}

/** The budget month n months before (negative) or after (positive) this one. */
export function shiftPeriod(period, n) {
  return periodFor(addMonths(period.start, n, period.startDay), period.startDay);
}

export const daysInPeriod = (p) => diffDays(p.start, p.nextStart);
/** Days left in the budget month, counting today. */
export const daysLeftInPeriod = (today, p) => diffDays(today, p.nextStart);
/** Days gone by in the budget month, counting today. */
export const daysElapsedInPeriod = (today, p) => diffDays(p.start, today) + 1;

// Display. Dates are formatted in UTC from their own parts, so a label is always exactly the stored date.

const formatters = new Map();
function formatter(options) {
  const key = JSON.stringify(options);
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }));
  }
  return formatters.get(key);
}

const STYLES = {
  short: { month: 'short', day: 'numeric' }, // Nov 18
  medium: { weekday: 'short', month: 'short', day: 'numeric' }, // Wed, Nov 18
  long: { weekday: 'long', month: 'long', day: 'numeric' }, // Wednesday, November 18
  full: { month: 'short', day: 'numeric', year: 'numeric' }, // Nov 18, 2026
  weekday: { weekday: 'short' }, // Wed
  day: { day: 'numeric' }, // 18
  month: { month: 'long', year: 'numeric' }, // November 2026
  monthName: { month: 'long' }, // November
  monthShort: { month: 'short' }, // Nov
};

export function formatDate(iso, style = 'medium') {
  const { y, m, d } = parseISO(iso);
  return formatter(STYLES[style] ?? STYLES.medium).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Today", "Yesterday", "Tomorrow", or a date like "Wed, Nov 18" (with the year when it differs). */
export function relativeDay(iso, today) {
  const diff = diffDays(today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return iso.slice(0, 4) === today.slice(0, 4) ? formatDate(iso, 'medium') : formatDate(iso, 'full');
}

/** "November 2026" for calendar months, "Nov 15 to Dec 14" for custom ones. */
export function periodLabel(p) {
  if (p.startDay === 1) return formatDate(p.start, 'month');
  return `${formatDate(p.start, 'short')} to ${formatDate(p.end, 'short')}`;
}

/** Short label for chart axes, named after the month the budget month starts in: "Nov". */
export function periodShortLabel(p) {
  return formatDate(p.start, 'monthShort');
}
