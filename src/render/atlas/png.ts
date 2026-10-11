import { zlibSync } from "fflate";
import type { Image } from "./pixels";

/**
 * A small deterministic PNG encoder (8-bit RGBA, non-interlaced). Rows are
 * filtered with the usual minimum-sum heuristic and deflated by fflate, a
 * pure-JS zlib, so the bytes depend only on the pixels: the same atlas on any
 * machine produces the same files and the same checksum.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const tag = new Uint8Array([...type].map((c) => c.charCodeAt(0)));
  const out = new Uint8Array(12 + body.length);
  out.set(u32(body.length), 0);
  out.set(tag, 4);
  out.set(body, 8);
  out.set(u32(crc32(body, crc32(tag))), 8 + body.length);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Filter one row with filter `f` (0 none, 1 sub, 2 up, 3 average, 4 Paeth). */
function filterRow(f: number, cur: Uint8ClampedArray, prev: Uint8ClampedArray | null, out: Uint8Array): void {
  for (let i = 0; i < cur.length; i++) {
    const a = i >= 4 ? cur[i - 4] : 0;
    const b = prev ? prev[i] : 0;
    const c = prev && i >= 4 ? prev[i - 4] : 0;
    let v = cur[i];
    if (f === 1) v -= a;
    else if (f === 2) v -= b;
    else if (f === 3) v -= (a + b) >> 1;
    else if (f === 4) v -= paeth(a, b, c);
    out[i] = v & 255;
  }
}

export function encodePng(img: Image): Uint8Array {
  const stride = img.w * 4;
  const raw = new Uint8Array((stride + 1) * img.h);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < img.h; y++) {
    const cur = img.data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? img.data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      filterRow(f, cur, prev, trial);
      let sum = 0;
      for (let i = 0; i < stride; i++) sum += trial[i] < 128 ? trial[i] : 256 - trial[i];
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    filterRow(best, cur, prev, raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(img.w), 0);
  ihdr.set(u32(img.h), 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive filter, no interlace
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
