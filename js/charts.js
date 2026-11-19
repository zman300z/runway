// Hand-built SVG charts. Pure functions: data in, SVG markup and geometry out. No DOM code here;
// the screens in js/ui/ add the touch interactions.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
const r2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Limit ring: what you've spent (solid) and the bills still scheduled (faint), as shares of the limit.
 * `tone` is "good" | "warn" | "bad" and sets the color through CSS.
 */
export function ringSVG({ spent, scheduled = 0, size = 76, stroke = 10, tone = 'good', label = '' }) {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
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
