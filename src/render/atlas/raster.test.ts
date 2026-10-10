import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { pack } from "./pack";
import { blank, type Image } from "./pixels";
import { crc32, encodePng } from "./png";
import { blit, heightField, maskTo, normalMap, scaleNearest, OUTLINE_SINK } from "./raster";

function solid(w: number, h: number, rgba: number[]): Image {
  const out = blank(w, h);
  for (let i = 0; i < w * h; i++) out.data.set(rgba, i * 4);
  return out;
}

describe("pack", () => {
  it("places every image inside its page with a gutter and never overlaps", () => {
    const imgs = [
      { id: 0, w: 10, h: 10 },
      { id: 1, w: 30, h: 5 },
      { id: 2, w: 12, h: 12 },
      { id: 3, w: 40, h: 40 },
    ];
    const r = pack(imgs, 64, 1);
    const rects = r.placements.flat().map((s) => s.rect);
    for (const a of rects) {
      expect(a.x).toBeGreaterThanOrEqual(1);
      expect(a.x + a.w).toBeLessThanOrEqual(63);
      expect(a.y + a.h).toBeLessThanOrEqual(63);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const apart = a.page !== b.page || a.x + a.w + 1 < b.x || b.x + b.w + 1 < a.x || a.y + a.h + 1 < b.y || b.y + b.h + 1 < a.y;
        expect(apart).toBe(true);
      }
    }
    expect(pack(imgs, 64, 1)).toEqual(r); // deterministic
  });
  it("opens a new page when one fills, and slices an image wider than a page", () => {
    const r = pack([{ id: 0, w: 150, h: 20 }, { id: 1, w: 60, h: 60 }], 64, 1);
    expect(r.placements[0].map((s) => s.sx)).toEqual([0, 62, 124]);
    expect(r.placements[0].reduce((n, s) => n + s.rect.w, 0)).toBe(150);
    expect(r.pages).toBeGreaterThan(1);
  });
  it("rejects an image taller than a page", () => {
    expect(() => pack([{ id: 0, w: 4, h: 100 }], 64, 1)).toThrow();
  });
});

describe("scaleNearest and blit", () => {
  it("turns each pixel into an s x s block of the same color", () => {
    const src = blank(2, 1);
    src.data.set([1, 2, 3, 255, 9, 8, 7, 255]);
    const out = scaleNearest(src, 4);
    expect(out.w).toBe(8);
    expect(out.h).toBe(4);
    expect(Array.from(out.data.subarray((3 * 8 + 3) * 4, (3 * 8 + 3) * 4 + 4))).toEqual([1, 2, 3, 255]);
    expect(Array.from(out.data.subarray((3 * 8 + 4) * 4, (3 * 8 + 4) * 4 + 4))).toEqual([9, 8, 7, 255]);
    expect(scaleNearest(src, 1).data).toEqual(src.data);
    expect(() => scaleNearest(src, 1.5)).toThrow();
  });
  it("blits a block", () => {
    const dst = blank(4, 4);
    blit(dst, solid(2, 2, [5, 5, 5, 255]), 1, 1, 1, 1, 3, 3);
    expect(dst.data[(3 * 4 + 3) * 4]).toBe(5);
    expect(dst.data[0]).toBe(0);
  });
});

describe("normal maps", () => {
  it("is flat inside a uniform sprite and leaves transparency transparent", () => {
    const page = blank(7, 7);
    blit(page, solid(5, 5, [200, 200, 200, 255]), 0, 0, 5, 5, 1, 1);
    const n = normalMap(page);
    const at = (x: number, y: number) => Array.from(n.data.subarray((y * 7 + x) * 4, (y * 7 + x) * 4 + 4));
    expect(at(3, 3)).toEqual([128, 128, 255, 255]);
    expect(at(0, 0)).toEqual([128, 128, 255, 0]);
    // The left outline sinks, so its right neighbor slopes toward -X (red < 128).
    expect(at(2, 3)[0]).toBeLessThan(128);
    // The bottom outline sinks, so the row above it is the bottom flank of a
    // bump and faces down: with +Y up that is green < 128.
    expect(at(3, 4)[1]).toBeLessThan(128);
    expect(at(3, 2)[1]).toBeGreaterThan(128);
  });
  it("height sinks the outline next to transparency but not at the frame edge", () => {
    const frame = blank(4, 3);
    blit(frame, solid(3, 3, [255, 255, 255, 255]), 0, 0, 3, 3, 0, 0);
    const hf = heightField(frame);
    expect(hf[0]).toBeCloseTo(1); // the frame's own corner: no bevel
    expect(hf[2]).toBeCloseTo(OUTLINE_SINK); // next to the transparent column
    // A uniform frame that fills its canvas is flat all the way to the edge.
    const n = normalMap(solid(3, 3, [90, 90, 90, 128]));
    expect(Array.from(n.data.subarray(0, 4))).toEqual([128, 128, 255, 255]);
  });
  it("maskTo keeps normals only under the mask", () => {
    const mask = blank(2, 1);
    mask.data.set([1, 1, 1, 9], 4);
    const m = maskTo(solid(2, 1, [10, 20, 30, 255]), mask);
    expect(Array.from(m.data)).toEqual([128, 128, 255, 0, 10, 20, 30, 255]);
  });
});

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

describe("encodePng", () => {
  it("writes a valid PNG whose pixels decode back", () => {
    const img = blank(3, 2);
    img.data.set([10, 20, 30, 255, 40, 50, 60, 128, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const png = encodePng(img);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(encodePng(img)).toEqual(png);
    // Walk the chunks, check CRCs, and undo the row filters.
    let o = 8;
    let idat = new Uint8Array(0);
    while (o < png.length) {
      const len = new DataView(png.buffer, png.byteOffset + o).getUint32(0);
      const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
      const crc = new DataView(png.buffer, png.byteOffset + o + 8 + len).getUint32(0);
      expect(crc32(png.subarray(o + 4, o + 8 + len))).toBe(crc);
      if (type === "IDAT") idat = png.slice(o + 8, o + 8 + len);
      o += 12 + len;
    }
    const raw = unzlibSync(idat);
    const stride = 12;
    const out = new Uint8Array(stride * 2);
    for (let y = 0; y < 2; y++) {
      const f = raw[y * (stride + 1)];
      for (let i = 0; i < stride; i++) {
        const v = raw[y * (stride + 1) + 1 + i];
        const a = i >= 4 ? out[y * stride + i - 4] : 0;
        const b = y > 0 ? out[(y - 1) * stride + i] : 0;
        const c = y > 0 && i >= 4 ? out[(y - 1) * stride + i - 4] : 0;
        const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
        out[y * stride + i] = (v + pred) & 255;
      }
    }
    expect(Array.from(out)).toEqual(Array.from(img.data));
  });
});
