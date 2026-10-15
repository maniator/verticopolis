import { describe, expect, it } from "vitest";
import { LayerError, blank, contentHash, crop, diffLayer, over, sameImage, trim, type Image } from "./pixels";

function img(w: number, h: number, px: Record<string, [number, number, number, number]>): Image {
  const out = blank(w, h);
  for (const [k, v] of Object.entries(px)) {
    const [x, y] = k.split(",").map(Number);
    out.data.set(v, (y * w + x) * 4);
  }
  return out;
}
const RED: [number, number, number, number] = [255, 0, 0, 255];
const BLUE: [number, number, number, number] = [0, 0, 255, 255];
const HAZE: [number, number, number, number] = [0, 0, 0, 60];

describe("trim", () => {
  it("returns the tight box around visible pixels and its offset", () => {
    const t = trim(img(5, 4, { "1,1": RED, "3,2": BLUE }));
    expect(t).toMatchObject({ x: 1, y: 1, w: 3, h: 2 });
    expect(Array.from(t!.data.subarray(0, 4))).toEqual(RED);
  });
  it("is null for a fully transparent image", () => {
    expect(trim(blank(3, 3))).toBeNull();
  });
});

describe("diffLayer and over", () => {
  it("captures exactly the changed pixels, and drawing it back reproduces the next render", () => {
    const prev = img(4, 3, { "0,0": RED, "1,1": RED, "2,1": RED });
    const next = img(4, 3, { "0,0": RED, "1,1": BLUE, "2,1": RED, "3,2": BLUE });
    const layer = diffLayer(prev, next)!;
    expect(layer).toMatchObject({ x: 1, y: 1, w: 3, h: 2 });
    const composed = { ...prev, data: prev.data.slice() };
    over(composed, layer, layer.x, layer.y);
    expect(sameImage(composed, next)).toBe(true);
  });
  it("is null when nothing changed", () => {
    const a = img(2, 2, { "0,0": RED });
    expect(diffLayer(a, { ...a, data: a.data.slice() })).toBeNull();
  });
  it("allows a translucent pixel that lands on transparency", () => {
    const prev = img(3, 1, { "0,0": RED });
    const next = img(3, 1, { "0,0": RED, "2,0": HAZE });
    const layer = diffLayer(prev, next)!;
    const composed = { ...prev, data: prev.data.slice() };
    over(composed, layer, layer.x, layer.y);
    expect(sameImage(composed, next)).toBe(true);
  });
  it("refuses a change under translucency, which would compose wrong", () => {
    const prev = img(2, 1, { "0,0": RED });
    expect(() => diffLayer(prev, img(2, 1, { "0,0": HAZE }))).toThrow(LayerError);
    // Erasing a pixel can't be drawn with source-over either.
    expect(() => diffLayer(prev, blank(2, 1))).toThrow(LayerError);
  });
  it("rejects mismatched sizes", () => {
    expect(() => diffLayer(blank(2, 2), blank(3, 2))).toThrow(LayerError);
  });
  it("over blends translucent source onto opaque destination and clips at the edges", () => {
    const dst = img(2, 1, { "0,0": [0, 0, 0, 255] });
    over(dst, img(1, 1, { "0,0": [255, 255, 255, 128] }), 0, 0);
    expect(dst.data[0]).toBe(128);
    expect(dst.data[3]).toBe(255);
    over(dst, img(2, 2, { "1,1": RED }), -1, -1); // only (1,1) of the source is off the canvas
    over(dst, img(1, 1, { "0,0": RED }), 5, 5);
    expect(dst.data[4 + 3]).toBe(0);
  });
});

describe("crop, contentHash and sameImage", () => {
  it("crops a block", () => {
    const c = crop(img(3, 3, { "2,2": RED }), 1, 1, 2, 2);
    expect(Array.from(c.data.subarray(12, 16))).toEqual(RED);
  });
  it("hashes by size and content", () => {
    const a = img(2, 2, { "0,0": RED });
    expect(contentHash(a)).toBe(contentHash({ ...a, data: a.data.slice() }));
    expect(contentHash(a)).not.toBe(contentHash(img(2, 2, { "0,0": BLUE })));
    expect(contentHash(blank(1, 4))).not.toBe(contentHash(blank(4, 1)));
    expect(sameImage(blank(1, 4), blank(4, 1))).toBe(false);
    expect(sameImage(a, img(2, 2, { "1,0": RED }))).toBe(false);
  });
});
