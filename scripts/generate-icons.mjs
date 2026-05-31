/**
 * Generate placeholder launcher icons referenced by webos/appinfo.json.
 * ─────────────────────────────────────────────────────────────────────
 * webOS sideload requires icon.png (80x80) and largeIcon.png (130x130).
 * These are solid-fill placeholders produced by a tiny no-dependency PNG
 * encoder (so the package builds without ImageMagick/PIL). Swap in real
 * artwork before shipping anywhere serious.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BRAND = [0x0c, 0x58, 0xa8]; // LG-blue-ish solid fill (matches iconColor)

// CRC32 (manual table → no reliance on zlib.crc32, which is Node 20.15+).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function solidPng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  // ihdr[10..12] = compression / filter / interlace = 0
  const rowLen = 1 + size * 3; // 1 filter byte + RGB pixels
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [['icon.png', 80], ['largeIcon.png', 130]]) {
  const path = new URL(`../webos/${name}`, import.meta.url);
  writeFileSync(path, solidPng(size, BRAND));
  console.log(`wrote webos/${name} (${size}x${size})`);
}
