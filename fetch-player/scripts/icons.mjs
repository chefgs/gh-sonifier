/**
 * Writes the extension icons as PNGs, with no image library: a hand-rolled PNG encoder
 * on top of node:zlib. The art is a small contribution grid in GitHub's greens.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PALETTE = [
  [22, 27, 34],    // background
  [14, 68, 41],    // level 1
  [0, 109, 50],    // level 2
  [38, 166, 65],   // level 3
  [57, 211, 83],   // level 4
];

/** 4x4 shade pattern, chosen to read as a calendar even at 16px. */
const PATTERN = [
  [1, 3, 0, 2],
  [2, 4, 3, 1],
  [0, 2, 4, 3],
  [3, 1, 2, 4],
];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixel) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const at = rowStart + 1 + x * 4;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function iconPixel(size) {
  const pad = Math.max(1, Math.round(size * 0.08));
  const inner = size - pad * 2;
  const cell = inner / 4;
  const gap = size >= 48 ? Math.max(1, Math.round(cell * 0.14)) : 0;

  return (x, y) => {
    const gx = Math.floor((x - pad) / cell);
    const gy = Math.floor((y - pad) / cell);
    if (x < pad || y < pad || gx < 0 || gx > 3 || gy < 0 || gy > 3) return [...PALETTE[0], 255];
    if (gap > 0) {
      const ox = (x - pad) % cell;
      const oy = (y - pad) % cell;
      if (ox < gap || oy < gap) return [...PALETTE[0], 255];
    }
    return [...PALETTE[PATTERN[gy][gx]], 255];
  };
}

export function writeIcons(outDir) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const size of [16, 32, 48, 128]) {
    const file = join(outDir, `icon-${size}.png`);
    writeFileSync(file, encodePng(size, iconPixel(size)));
    written.push(file);
  }
  return written;
}
