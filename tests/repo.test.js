// Project rules, enforced. See CLAUDE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'screenshots']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(relative(ROOT, full).split(sep).join('/'));
  }
  return out;
}

const FILES = walk(ROOT);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
// Built from char codes so this file does not contain the characters it bans.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const TEXT = /\.(html|css|js|json|md|webmanifest|txt|svg)$/i;

/** Files that ship to the phone. */
const APP_FILES = FILES.filter((f) => f === 'index.html' || f === 'sw.js' || f === 'manifest.webmanifest'
  || f.startsWith('js/') || f.startsWith('css/'));

/** Pure logic modules that must run in Node without a browser. */
const LOGIC = ['money', 'dates', 'ids', 'categories', 'recurring', 'pay', 'budget', 'explain', 'actions', 'csv', 'store', 'demo', 'version', 'charts', 'search', 'cards']
  .map((name) => `js/${name}.js`)
  .filter((f) => existsSync(join(ROOT, f)));

test('no em dashes (or en dashes) anywhere in app text or docs', () => {
  const offenders = FILES.filter((f) => TEXT.test(f) && DASHES.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('app code only uses relative paths (GitHub Pages serves the app under /runway/)', () => {
  const patterns = [
    /(?:href|src|action)\s*=\s*["']\/(?!\/)/,
    /url\(\s*["']?\/(?!\/)/,
    /\bfrom\s+["']\//,
    /\bimport\(\s*["']\//,
    /register\(\s*["']\//,
    /fetch\(\s*["']\//,
  ];
  for (const f of APP_FILES) {
    const text = read(f);
    for (const p of patterns) assert.doesNotMatch(text, p, `${f} uses an absolute path`);
  }
  if (existsSync(join(ROOT, 'manifest.webmanifest'))) {
    const m = JSON.parse(read('manifest.webmanifest'));
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    for (const icon of m.icons) assert.ok(!icon.src.startsWith('/'), icon.src);
  }
});

test('no network URLs in app code (everything is served from the repo)', () => {
  for (const f of APP_FILES) {
    const urls = (read(f).match(/https?:\/\/[^\s"'`)<>]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(urls, [], `${f} references the network`);
  }
});

test('logic modules have no DOM or browser code, so they run in Node', () => {
  assert.ok(LOGIC.length >= 12);
  for (const f of LOGIC) {
    assert.doesNotMatch(read(f), /\b(document|window|navigator|localStorage|sessionStorage|HTMLElement)\b/, f);
  }
});

test('no backups or exports with real money data in the repo', () => {
  assert.deepEqual(FILES.filter((f) => /runway-(backup|transactions)/i.test(f)), []);
});

test('every app file is in the service worker cache list (so the app works offline)', () => {
  const sw = read('sw.js');
  const listed = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  const needed = FILES.filter((f) => f === 'index.html' || f === 'manifest.webmanifest' || /^(js|css|icons)\//.test(f));
  assert.deepEqual(needed.filter((f) => !listed.has(f)), [], 'add these to ASSETS in sw.js');
  assert.deepEqual([...listed].filter((f) => f && !FILES.includes(f)), [], 'these are listed in sw.js but do not exist');
});

test('the app version, cache version and package version match', () => {
  const sw = /const VERSION = '([^']+)'/.exec(read('sw.js'))[1];
  const app = /APP_VERSION = '([^']+)'/.exec(read('js/version.js'))[1];
  const pkg = JSON.parse(read('package.json')).version;
  assert.equal(app, sw);
  assert.equal(pkg, sw);
});

test('the manifest and page have everything iPhone needs', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Runway');
  assert.equal(m.short_name, 'Runway');
  assert.equal(m.display, 'standalone');
  const sizes = m.icons.map((i) => `${i.sizes}${i.purpose === 'maskable' ? ' maskable' : ''}`);
  assert.deepEqual(sizes, ['180x180', '192x192', '512x512', '512x512 maskable']);
  for (const icon of m.icons) assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
  const page = read('index.html');
  for (const needle of ['viewport-fit=cover', 'apple-touch-icon', 'apple-mobile-web-app-capable', 'apple-mobile-web-app-status-bar-style', 'theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)', 'theme-color" content="#000000" media="(prefers-color-scheme: dark)', 'rel="manifest" href="./manifest.webmanifest"']) {
    assert.ok(page.includes(needle), needle);
  }
});
