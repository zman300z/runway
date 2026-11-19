// Zero-dependency local server that mimics GitHub Pages: the app is served at /runway/,
// so any absolute path that would break on Pages breaks here too.
// Run: node tools/serve.js   then open http://localhost:8080/runway/
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = '/runway/';
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (path === '/' || path === '/runway') return send(res, 302, '', { Location: BASE });
  if (!path.startsWith(BASE)) return send(res, 404, 'Not found. The app lives at /runway/');
  let rel = path.slice(BASE.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  // Never serve dot folders like .git.
  if (rel.split('/').some((part) => part.startsWith('.') && part !== '.nojekyll')) return send(res, 404, 'Not found');
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (info.isDirectory()) return send(res, 302, '', { Location: `${path}/` });
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    return res.end(body);
  } catch {
    return send(res, 404, 'Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Runway dev server: http://localhost:${PORT}/runway/`);
});
