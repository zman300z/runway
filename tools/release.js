// Bump the app version everywhere it lives, so phones get the "Update available" toast.
// Usage: node tools/release.js          (1.0.3 -> 1.0.4)
//        node tools/release.js minor    (1.0.3 -> 1.1.0)
//        node tools/release.js 2.0.0    (set it exactly)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const SW = file('sw.js');
const VERSION_JS = file('js/version.js');
const PACKAGE = file('package.json');

const sw = readFileSync(SW, 'utf8');
const current = /const VERSION = '(\d+)\.(\d+)\.(\d+)';/.exec(sw);
if (!current) {
  console.error('Could not find VERSION in sw.js');
  process.exit(1);
}
let [major, minor, patch] = current.slice(1).map(Number);
const arg = process.argv[2] ?? 'patch';
if (/^\d+\.\d+\.\d+$/.test(arg)) [major, minor, patch] = arg.split('.').map(Number);
else if (arg === 'major') [major, minor, patch] = [major + 1, 0, 0];
else if (arg === 'minor') [minor, patch] = [minor + 1, 0];
else patch += 1;
const next = `${major}.${minor}.${patch}`;

writeFileSync(SW, sw.replace(current[0], `const VERSION = '${next}';`));
const versionJs = readFileSync(VERSION_JS, 'utf8');
writeFileSync(VERSION_JS, versionJs.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${next}'`));
const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
pkg.version = next;
writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Runway ${current.slice(1).join('.')} -> ${next}. Run node --test, then commit and push.`);
