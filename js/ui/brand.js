// The Runway mark: a bold rising line over runway dashes, on the indigo accent.
// tools/make-icons.js draws the same shape for the home screen icon.
import { raw } from './dom.js';

let gradientId = 0;

export function appMark(size = 64) {
  gradientId += 1;
  const id = `mark-grad-${gradientId}`;
  return raw(`<svg class="app-mark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6D66F6"/><stop offset="1" stop-color="#3F35D8"/>
    </linearGradient></defs>
    <rect width="100" height="100" rx="23" fill="url(#${id})"/>
    <g stroke="#fff" stroke-linecap="round" fill="none">
      <path d="M22 78h12M44 78h12M66 78h12" stroke-width="6" opacity=".55"/>
      <path d="M22 62 41 45 54 54 76 28" stroke-width="9" stroke-linejoin="round"/>
    </g>
    <circle cx="76" cy="28" r="8" fill="#fff"/>
  </svg>`);
}
