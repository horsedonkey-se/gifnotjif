// Draws the gifnotjif mark: three rounded boxes cascading up-right, each one
// fainter than the one in front of it. Usage:
//   node make-tray.mjs <out.png> <size> [--bg]
// --bg paints a dark rounded panel behind the mark, for light backgrounds.
import zlib from 'node:zlib';
import fs from 'node:fs';

const [outPath, sizeArg, ...flags] = process.argv.slice(2);
const S = Number(sizeArg) || 32;
const WITH_BG = flags.includes('--bg');
const SS = S <= 64 ? 8 : 4; // supersample factor
const W = S * SS;

// Straight (non-premultiplied) colour plus alpha, one float per channel.
const buf = new Float32Array(W * W * 4);

function blend(x, y, r, g, b, a) {
  const i = (y * W + x) * 4;
  const da = buf[i + 3];
  const out = a + da * (1 - a);
  if (out <= 0) return;
  const src = [r, g, b];
  for (let c = 0; c < 3; c++) {
    buf[i + c] = (src[c] * a + buf[i + c] * da * (1 - a)) / out;
  }
  buf[i + 3] = out;
}

/** Rounded rect in device pixels. */
function roundRect(x0, y0, w, h, rad, [r, g, b], alpha) {
  const px0 = Math.floor(x0), py0 = Math.floor(y0);
  const px1 = Math.ceil(x0 + w), py1 = Math.ceil(y0 + h);
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      if (x < 0 || y < 0 || x >= W || y >= W) continue;
      const cx = Math.min(Math.max(x + 0.5, x0 + rad), x0 + w - rad);
      const cy = Math.min(Math.max(y + 0.5, y0 + rad), y0 + h - rad);
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > rad * rad) continue;
      blend(x, y, r, g, b, alpha);
    }
  }
}

const WHITE = [0xff, 0xff, 0xff];
const PANEL = [0x18, 0x1a, 0x1f];

if (WITH_BG) roundRect(0, 0, W, W, W * 0.22, PANEL, 1);

// The mark is laid out on a 32x32 grid using cells 1..31, then scaled to fit
// the canvas: edge to edge without a panel, inset by 14% with one.
const pad = WITH_BG ? W * 0.14 : 0;
const unit = (W - pad * 2 - (WITH_BG ? 0 : 2 * SS)) / 30;
const at = (v) => pad + (WITH_BG ? v * unit : SS + v * unit);
const box = (gx, gy, alpha) =>
  roundRect(at(gx), at(gy), 18 * unit, 18 * unit, 4 * unit, WHITE, alpha);

// Back to front, so the solid one lands on top.
box(12, 0, 0.3);
box(6, 6, 0.55);
box(0, 12, 1.0);

// Box-filter down to the final size.
const out = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + x * SS + sx) * 4;
        const sa = buf[i + 3];
        r += buf[i] * sa; g += buf[i + 1] * sa; b += buf[i + 2] * sa; a += sa;
      }
    }
    const o = (y * S + x) * 4;
    if (a > 0) {
      out[o] = Math.round(r / a);
      out[o + 1] = Math.round(g / a);
      out[o + 2] = Math.round(b / a);
    }
    out[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

// --- PNG encode ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const stride = S * 4 + 1;
const raw = Buffer.alloc(S * stride);
for (let y = 0; y < S; y++) {
  raw[y * stride] = 0; // filter: none
  out.copy(raw, y * stride + 1, y * S * 4, (y + 1) * S * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
fs.writeFileSync(outPath, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log('wrote', outPath, S + 'px');
