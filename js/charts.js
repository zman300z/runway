// Hand-built SVG charts. Pure functions: data in, SVG markup and geometry out. No DOM code here;
// the screens in js/ui/ measure the width, insert the markup and add touch interactions.
// Mark specs follow one system: 2px lines, bars at most 24px wide with a 4px rounded data end,
// hairline solid gridlines, a 2px surface gap between touching marks, a surface ring on dots.
import { formatCompactMoney, formatWholeMoney } from './money.js';

/** Whole dollars under $10,000, compact above: "$120", "$12K". */
const shortMoney = (cents) => (Math.abs(cents) < 1000000 ? formatWholeMoney(cents) : formatCompactMoney(cents));
import { formatDate } from './dates.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
const r2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const TAU = Math.PI * 2;

/**
 * Limit ring: what you've spent (solid) and the bills still scheduled (faint), as shares of the limit.
 * `tone` is "good" | "warn" | "bad" and sets the color through CSS.
 */
export function ringSVG({ spent, scheduled = 0, size = 76, stroke = 10, tone = 'good', label = '' }) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = TAU * r;
  const a = clamp01(spent);
  const b = clamp01(Math.min(1 - a, scheduled));
  const lenA = r2(circ * a);
  const lenB = r2(circ * b);
  const base = `cx="${c}" cy="${c}" r="${r2(r)}" fill="none" stroke-width="${stroke}" transform="rotate(-90 ${c} ${c})"`;
  return `<svg class="ring ring-${esc(tone)}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}">`
    + `<circle class="ring-track" ${base}/>`
    + (lenB > 0 ? `<circle class="ring-sched" ${base} stroke-dasharray="${lenB} ${r2(circ)}" stroke-dashoffset="${r2(-lenA)}"/>` : '')
    + (lenA > 0 ? `<circle class="ring-spent" ${base} stroke-linecap="round" stroke-dasharray="${lenA} ${r2(circ)}"/>` : '')
    + '</svg>';
}

// Scales

/** A round step size (1, 2, 2.5 or 5 times a power of ten) that splits `range` into about `ticks` parts. */
export function niceStep(range, ticks = 3) {
  const raw = Math.abs(range) / Math.max(1, ticks);
  if (!raw) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let nice = 10;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 2.5) nice = 2.5;
  else if (norm <= 5) nice = 5;
  return nice * mag;
}

/** A domain covering [min, max] that starts and ends on round ticks. Values are cents. */
export function niceDomain(min, max, ticks = 3) {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.max(1000, Math.abs(lo) * 0.1);
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, ticks);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const values = [];
  for (let v = start; v <= end + step / 2; v += step) values.push(Math.round(v));
  return { min: start, max: end, step, ticks: values };
}

function linePath(points) {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
}

// Balance over time

/**
 * Balance line for the last weeks (solid, with a 10% wash) and a dashed projection to month end.
 * Returns null when there are fewer than two points. `points` carries each point's position,
 * for finger scrubbing.
 */
export function balanceChart({ history, projection }, { width, height = 196 }) {
  const past = history.map((p) => ({ ...p, projected: false }));
  const future = (projection ?? []).slice(1).map((p) => ({ ...p, projected: true }));
  const all = [...past, ...future];
  if (all.length < 2 || !past.length) return null;
  const pad = { top: 16, right: 54, bottom: 28, left: 2 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom);
  const values = all.map((p) => p.balance);
  const dom = niceDomain(Math.min(...values), Math.max(...values), 3);
  const n = all.length;
  const xAt = (i) => r2(pad.left + (i * plotW) / (n - 1));
  const yAt = (v) => r2(pad.top + plotH - ((v - dom.min) / (dom.max - dom.min)) * plotH);
  const points = all.map((p, i) => ({ ...p, x: xAt(i), y: yAt(p.balance) }));
  const todayIndex = past.length - 1;
  const bottom = pad.top + plotH;
  const right = pad.left + plotW;

  const grid = dom.ticks.map((v) => {
    const y = yAt(v);
    return `<line class="grid${v === 0 ? ' zero' : ''}" x1="${pad.left}" x2="${right}" y1="${y}" y2="${y}"/>`
      + `<text class="tick" x="${width - 2}" y="${r2(y + 4)}" text-anchor="end">${esc(formatCompactMoney(v))}</text>`;
  }).join('');

  const histPts = points.slice(0, todayIndex + 1);
  const projPts = points.slice(todayIndex);
  const area = histPts.length > 1
    ? `<path class="area" d="${linePath(histPts)} L${histPts[histPts.length - 1].x},${bottom} L${histPts[0].x},${bottom} Z"/>`
    : '';
  const today = points[todayIndex];

  // X labels: first day, today, last projected day. Drop an edge label that would collide.
  const labels = [{ x: points[0].x, text: formatDate(points[0].date, 'short'), anchor: 'start' }];
  if (todayIndex > 0) labels.push({ x: today.x, text: 'Today', anchor: 'middle', strong: true });
  if (future.length) labels.push({ x: points[n - 1].x, text: formatDate(points[n - 1].date, 'short'), anchor: 'end' });
  const kept = labels.filter((l, i) => {
    if (l.strong) return true;
    return !labels.some((o, j) => o.strong && j !== i && Math.abs(o.x - l.x) < 46);
  });
  const xLabels = kept.map((l) => `<text class="tick${l.strong ? ' strong' : ''}" x="${l.x}" y="${height - 8}" text-anchor="${l.anchor}">${esc(l.text)}</text>`).join('');

  const svg = `<svg class="chart-svg balance-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">`
    + grid
    + area
    + (projPts.length > 1 ? `<path class="line projected" d="${linePath(projPts)}"/>` : '')
    + `<path class="line" d="${linePath(histPts)}"/>`
    + `<line class="today-rule" x1="${today.x}" x2="${today.x}" y1="${pad.top}" y2="${bottom}"/>`
    + `<circle class="dot" cx="${today.x}" cy="${today.y}" r="5"/>`
    + xLabels
    + `<g class="scrub" visibility="hidden"><line class="scrub-rule" x1="0" x2="0" y1="${pad.top}" y2="${bottom}"/><circle class="dot scrub-dot" r="5"/></g>`
    + '</svg>';
  return { svg, points, todayIndex, plot: { left: pad.left, right, top: pad.top, bottom }, domain: dom };
}

/** Index of the point nearest to x (for scrubbing). */
export function nearestIndex(points, x) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.abs(points[i].x - x);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

// Monthly net bars

/** A vertical bar path with a rounded data end and a square end on the baseline. */
export function barPath(x, w, yBase, yEnd, radius = 4) {
  const h = Math.abs(yBase - yEnd);
  const r = Math.min(radius, h, w / 2);
  const up = yEnd < yBase;
  const edge = up ? yEnd + r : yEnd - r;
  return `M${r2(x)},${r2(yBase)} V${r2(edge)} Q${r2(x)},${r2(yEnd)} ${r2(x + r)},${r2(yEnd)} H${r2(x + w - r)} Q${r2(x + w)},${r2(yEnd)} ${r2(x + w)},${r2(edge)} V${r2(yBase)} Z`;
}

/**
 * Net (income minus spending) per month: green bars above zero, red below.
 * months: [{ label, net }]. The selected bar is labeled with its value; the rest stay quiet.
 */
export function netBarsChart(months, { width, height = 176, selected = months.length - 1 }) {
  const pad = { top: 22, right: 50, bottom: 26, left: 2 };
  const plotW = Math.max(40, width - pad.left - pad.right);
  const plotH = Math.max(40, height - pad.top - pad.bottom);
  const values = months.map((m) => m.net);
  const dom = niceDomain(Math.min(0, ...values), Math.max(0, ...values), 2);
  const yAt = (v) => r2(pad.top + plotH - ((v - dom.min) / (dom.max - dom.min)) * plotH);
  const band = plotW / months.length;
  const barW = Math.min(24, band * 0.5);
  const y0 = yAt(0);
  const bars = months.map((m, i) => {
    const cx = pad.left + band * (i + 0.5);
    let yEnd = yAt(m.net);
    if (m.net !== 0 && Math.abs(yEnd - y0) < 3) yEnd = m.net > 0 ? y0 - 3 : y0 + 3;
    return { ...m, index: i, cx: r2(cx), x: r2(cx - barW / 2), w: r2(barW), y0, yEnd, bandX: r2(pad.left + band * i), bandW: r2(band) };
  });
  const grid = dom.ticks.map((v) => {
    const y = yAt(v);
    return `<line class="grid${v === 0 ? ' zero' : ''}" x1="${pad.left}" x2="${pad.left + plotW}" y1="${y}" y2="${y}"/>`
      + `<text class="tick" x="${width - 2}" y="${r2(y + 4)}" text-anchor="end">${esc(v === 0 ? '$0' : formatCompactMoney(v))}</text>`;
  }).join('');
  const marks = bars.map((b) => {
    const tone = b.net >= 0 ? 'good' : 'bad';
    const sel = b.index === selected;
    const shape = b.net === 0
      ? `<line class="bar-zero" x1="${b.x}" x2="${r2(b.x + b.w)}" y1="${y0}" y2="${y0}"/>`
      : `<path class="bar bar-${tone}${sel ? ' is-selected' : ''}" d="${barPath(b.x, b.w, y0, b.yEnd)}"/>`;
    const label = `<text class="tick${sel ? ' strong' : ''}" x="${b.cx}" y="${height - 8}" text-anchor="middle">${esc(b.label)}</text>`;
    const value = sel
      ? `<text class="bar-value" x="${b.cx}" y="${r2(b.net >= 0 ? b.yEnd - 6 : b.yEnd + 14)}" text-anchor="middle">${esc(shortMoney(b.net))}</text>`
      : '';
    return shape + label + value;
  }).join('');
  // Whole-column hit targets, bigger than the bars.
  const hits = bars.map((b) => `<rect class="hit" data-index="${b.index}" x="${b.bandX}" y="0" width="${b.bandW}" height="${height}"/>`).join('');
  const svg = `<svg class="chart-svg net-chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${grid}${marks}${hits}</svg>`;
  return { svg, bars, domain: dom };
}

// Donut

/** Path for a ring segment between angles a0 and a1 (radians, 0 = 3 o'clock, clockwise). */
export function annularPath(cx, cy, inner, outer, a0, a1) {
  const pt = (r, a) => `${r2(cx + r * Math.cos(a))},${r2(cy + r * Math.sin(a))}`;
  if (a1 - a0 >= TAU - 1e-6) {
    const mid = a0 + Math.PI;
    return `M${pt(outer, a0)} A${outer},${outer} 0 1 1 ${pt(outer, mid)} A${outer},${outer} 0 1 1 ${pt(outer, a0)} Z `
      + `M${pt(inner, a0)} A${inner},${inner} 0 1 0 ${pt(inner, mid)} A${inner},${inner} 0 1 0 ${pt(inner, a0)} Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${pt(outer, a0)} A${outer},${outer} 0 ${large} 1 ${pt(outer, a1)} L${pt(inner, a1)} A${inner},${inner} 0 ${large} 0 ${pt(inner, a0)} Z`;
}

/**
 * Keep the biggest `max - 1` slices and fold the rest into "Other", so the donut never shows
 * more than `max` colors. Zero and negative values are dropped.
 */
export function foldSlices(slices, max = 6, otherLabel = 'Other') {
  const positive = slices.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (positive.length <= max) return positive;
  const keep = positive.slice(0, max - 1);
  const rest = positive.slice(max - 1);
  return [...keep, { id: '__other', label: otherLabel, value: rest.reduce((t, s) => t + s.value, 0), color: '#8E8E93', folded: rest }];
}

/** Donut segments with a 2px surface gap between them. Returns null when there is nothing to show. */
export function donutChart(slices, { size = 176, thickness = 24, gap = 2 } = {}) {
  const total = slices.reduce((t, s) => t + s.value, 0);
  if (!total) return null;
  const c = size / 2;
  const outer = c - 1;
  const inner = outer - thickness;
  const gapAngle = slices.length > 1 ? gap / outer : 0;
  let a = -Math.PI / 2;
  const segments = slices.map((s, i) => {
    const sweep = (s.value / total) * TAU;
    const a0 = a + gapAngle / 2;
    const a1 = a + Math.max(sweep - gapAngle / 2, gapAngle / 2 + 0.002);
    a += sweep;
    return { ...s, index: i, share: s.value / total, d: annularPath(c, c, inner, outer, a0, a1) };
  });
  const svg = `<svg class="chart-svg donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">`
    + segments.map((s) => `<path class="slice" data-index="${s.index}" fill="${esc(s.color)}" fill-rule="evenodd" d="${s.d}"/>`).join('')
    + '</svg>';
  return { svg, segments, total };
}

/** Whole-number percentages that add up to exactly 100 (largest remainder). */
export function percentShares(values) {
  const total = values.reduce((t, v) => t + Math.max(0, v), 0);
  if (!total) return values.map(() => 0);
  const raw = values.map((v) => (Math.max(0, v) * 100) / total);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((t, v) => t + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}
