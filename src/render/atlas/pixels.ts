/**
 * Pure RGBA pixel operations for the atlas bake: trimming transparent borders,
 * diffing two renders into a composable layer, compositing a layer back, and
 * content hashing for deduplication. Images are straight (unpremultiplied)
 * RGBA, the way `getImageData` hands them back.
 */

export interface Image {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

/** A sub-image placed at (x, y) inside a larger frame. */
export interface Piece extends Image {
  x: number;
  y: number;
}

export function blank(w: number, h: number): Image {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Copy the `w` x `h` block at (x, y) out of `img`. */
export function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const out = blank(w, h);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * img.w + x) * 4;
    out.data.set(img.data.subarray(src, src + w * 4), row * w * 4);
  }
  return out;
}

/** The smallest block holding every non-transparent pixel, or null when the
 *  image is fully transparent. */
export function trim(img: Image): Piece | null {
  let x0 = img.w;
  let y0 = img.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { ...crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1), x: x0, y: y0 };
}

/** Thrown when a step's change cannot be expressed as an over-blended layer. */
export class LayerError extends Error {}

/**
 * The layer that turns `prev` into `next`: every pixel that differs, copied
 * from `next`, in the bounding box of the changes; unchanged pixels are
 * transparent. Null when nothing changed.
 *
 * Drawing the layer source-over onto `prev` reproduces `next` exactly only if
 * every changed pixel is opaque in `next` or lands on a fully transparent
 * pixel of `prev`, so that is checked: any other change throws
 * {@link LayerError} instead of shipping a layer that composes wrong.
 */
export function diffLayer(prev: Image, next: Image): Piece | null {
  if (prev.w !== next.w || prev.h !== next.h) throw new LayerError("diffLayer: size mismatch");
  const { w, h } = next;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const a = prev.data;
    const b = next.data;
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
    if (b[i + 3] !== 255 && a[i + 3] !== 0) {
      throw new LayerError(`diffLayer: pixel ${p % w},${Math.floor(p / w)} changes under translucency (alpha ${a[i + 3]} to ${b[i + 3]})`);
    }
    const x = p % w;
    const y = (p - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const out: Piece = { ...blank(x1 - x0 + 1, y1 - y0 + 1), x: x0, y: y0 };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const a = prev.data;
      const b = next.data;
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
      out.data.set(b.subarray(i, i + 4), ((y - y0) * out.w + (x - x0)) * 4);
    }
  }
  return out;
}

/**
 * Draw `src` onto `dst` at (x, y) with source-over blending, the way a
 * frontend draws a layer. Straight alpha; an opaque source pixel replaces the
 * destination, a transparent one leaves it.
 */
export function over(dst: Image, src: Image, x: number, y: number): void {
  for (let row = 0; row < src.h; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dst.h) continue;
    for (let col = 0; col < src.w; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (row * src.w + col) * 4;
      const d = (dy * dst.w + dx) * 4;
      const sa = src.data[s + 3] / 255;
      if (sa === 0) continue;
      if (sa === 1) {
        dst.data.set(src.data.subarray(s, s + 4), d);
        continue;
      }
      const da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round((src.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / oa);
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** FNV-1a over the size and bytes: the dedup key (byte equality decides). */
export function contentHash(img: Image): string {
  let hsh = 0x811c9dc5;
  const mix = (v: number) => {
    hsh ^= v;
    hsh = Math.imul(hsh, 0x01000193);
  };
  mix(img.w & 0xffff);
  mix(img.h & 0xffff);
  for (let i = 0; i < img.data.length; i++) mix(img.data[i]);
  return `${img.w}x${img.h}:${(hsh >>> 0).toString(16).padStart(8, "0")}`;
}

export function sameImage(a: Image, b: Image): boolean {
  if (a.w !== b.w || a.h !== b.h) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}
