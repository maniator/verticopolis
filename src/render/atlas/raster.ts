import { blank, type Image } from "./pixels";

/**
 * Page rasters: blitting packed images into a page, the nearest-neighbor
 * upscale that makes the 2x and 4x pages, and the normal map derived from a
 * color page.
 */

/** Copy the `w` x `h` block of `src` at (sx, sy) to (dx, dy) in `dst`. */
export function blit(dst: Image, src: Image, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
  for (let row = 0; row < h; row++) {
    const from = ((sy + row) * src.w + sx) * 4;
    dst.data.set(src.data.subarray(from, from + w * 4), ((dy + row) * dst.w + dx) * 4);
  }
}

/** Integer nearest-neighbor upscale: every source pixel becomes an `s` x `s`
 *  block, so no color appears that the 1x bake did not draw. */
export function scaleNearest(img: Image, s: number): Image {
  if (!Number.isInteger(s) || s < 1) throw new Error(`scaleNearest: bad scale ${s}`);
  if (s === 1) return { w: img.w, h: img.h, data: img.data.slice() };
  const out = blank(img.w * s, img.h * s);
  const rowBytes = out.w * 4;
  for (let y = 0; y < img.h; y++) {
    const row = y * s * rowBytes;
    for (let x = 0; x < img.w; x++) {
      const px = img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
      for (let k = 0; k < s; k++) out.data.set(px, row + (x * s + k) * 4);
    }
    for (let k = 1; k < s; k++) out.data.copyWithin(row + k * rowBytes, row, row + rowBytes);
  }
  return out;
}

/** How much a sprite's outline sinks: the edge pixels' height is scaled by
 *  this, so silhouettes read as beveled under a light. */
export const OUTLINE_SINK = 0.5;
/** Sobel gradient gain before normalizing (a steeper relief). */
export const NORMAL_STRENGTH = 2;

/** Height in 0..1 from straight RGBA: luminance times coverage, with the
 *  sprite outline (an opaque pixel touching transparency or the page edge)
 *  sunk by {@link OUTLINE_SINK}. */
export function heightField(img: Image): Float32Array {
  const { w, h, data } = img;
  const out = new Float32Array(w * h);
  const alpha = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const edge = alpha(x - 1, y) === 0 || alpha(x + 1, y) === 0 || alpha(x, y - 1) === 0 || alpha(x, y + 1) === 0;
      out[y * w + x] = lum * (a / 255) * (edge ? OUTLINE_SINK : 1);
    }
  }
  return out;
}

/**
 * Tangent-space normal map in the OpenGL convention (+X right, +Y up, +Z out
 * of the page), encoded as `rgb = n * 0.5 + 0.5`. A Sobel gradient over the
 * height field; transparent pixels stay transparent (flat normal, alpha 0),
 * and each opaque pixel keeps its color pixel's alpha.
 */
export function normalMap(img: Image): Image {
  const { w, h } = img;
  const hf = heightField(img);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : hf[y * w + x]);
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = img.data[i + 3];
      if (a === 0) {
        out.data.set([128, 128, 255, 0], i);
        continue;
      }
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gyDown = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      // Image rows run down; +Y up flips the vertical gradient's sign.
      const nx = -gx * NORMAL_STRENGTH;
      const ny = gyDown * NORMAL_STRENGTH;
      const len = Math.hypot(nx, ny, 1);
      out.data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      out.data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      out.data[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      out.data[i + 3] = a;
    }
  }
  return out;
}
