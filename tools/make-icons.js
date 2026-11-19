// Draws the Runway app icon and writes the PNGs in icons/. Zero dependencies: it rasterizes
// the mark itself (signed distances, 4x4 supersampling) and encodes PNG with Node's zlib.
// Run: node tools/make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));

// The mark, in a 100 x 100 box (same as js/ui/brand.js).
const GRADIENT = [[0x6d, 0x66, 0xf6], [0x3f, 0x35, 0xd8]];
const DASHES = [[22, 78, 34, 78], [44, 78, 56, 78], [66, 78, 78, 78]];
const LINE = [[22, 62], [41, 45], [54, 54], [76, 28]];
const DOT = [76, 28, 8];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

/** Color of one sample point (in mark units) as [r, g, b]. */
function sample(x, y) {
  const t = Math.max(0, Math.min(1, (x + y) / 200));
  let r = GRADIENT[0][0] + (GRADIENT[1][0] - GRADIENT[0][0]) * t;
  let g = GRADIENT[0][1] + (GRADIENT[1][1] - GRADIENT[0][1]) * t;
  let b = GRADIENT[0][2] + (GRADIENT[1][2] - GRADIENT[0][2]) * t;
  const over = (alpha) => {
    r += (255 - r) * alpha;
    g += (255 - g) * alpha;
    b += (255 - b) * alpha;
  };
  if (DASHES.some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= 3)) over(0.55);
  let onLine = false;
  for (let i = 0; i < LINE.length - 1 && !onLine; i += 1) {
    onLine = distToSegment(x, y, LINE[i][0], LINE[i][1], LINE[i + 1][0], LINE[i + 1][1]) <= 4.5;
  }
  const dx = x - DOT[0];
  const dy = y - DOT[1];
  if (onLine || dx * dx + dy * dy <= DOT[2] * DOT[2]) over(1);
  return [r, g, b];
}

/** Render a square icon. `scale` shrinks the mark around the center (for the maskable safe zone). */
function render(size, scale = 1) {
  const SS = 4;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const ux = ((x + (sx + 0.5) / SS) / size) * 100;
          const uy = ((y + (sy + 0.5) / SS) / size) * 100;
          const mx = 50 + (ux - 50) / scale;
          const my = 50 + (uy - 50) / scale;
          const c = sample(mx, my);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / (SS * SS));
      px[i + 1] = Math.round(g / (SS * SS));
      px[i + 2] = Math.round(b / (SS * SS));
      px[i + 3] = 255;
    }
  }
  return px;
}

// PNG encoding

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(rows, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-180.png', 180, 1], // apple-touch-icon (iOS rounds the corners itself)
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-512-maskable.png', 512, 0.78], // mark kept inside the maskable safe zone
];
for (const [name, size, scale] of icons) {
  writeFileSync(new URL(name, `file:///${OUT.replace(/\\/g, '/')}`), encodePNG(size, render(size, scale)));
  console.log(`wrote icons/${name}`);
}
