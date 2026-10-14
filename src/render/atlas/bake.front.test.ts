import { describe, expect, it } from "vitest";
import { buildArchive, checkLayers } from "./archive";
import { bake, type Renderer } from "./bake";
import type { Job } from "./catalog";
import { composeFrame, composeLayered } from "./compose";
import type { PaintSpec } from "./paint";
import { blank, sameImage, type Image } from "./pixels";

const solid = (css: string): PaintSpec => ({ p: "solid", css });
function solidPixels(spec: PaintSpec, w: number, h: number): Image {
  if (spec.p !== "solid") throw new Error(`fake renderer: ${spec.p}`);
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([Number(spec.css), 0, 0, 255], i * 4);
  return img;
}

/** A fake vehicle: an interior in 50, riders in 200 from pixel 1, then its
 *  frame (90) at both ends and a seam at pixel 3, over any rider there. */
const bus = (riders: number): PaintSpec => ({ p: "solid", css: `bus:${riders}` });
function busPixels(spec: PaintSpec, w: number, h: number, upTo: "back" | "mid" | "flat"): Image | null {
  if (spec.p !== "solid" || !spec.css.startsWith("bus:")) return null;
  const riders = Number(spec.css.split(":")[1]);
  const img = blank(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([50, 0, 0, 255], i * 4);
  if (upTo === "back") return img;
  for (let r = 1; r <= riders && r < w - 1; r++) img.data.set([200, 0, 0, 255], r * 4);
  if (upTo === "mid") return img;
  for (const x of [0, 3, w - 1]) img.data.set([90, 0, 0, 255], x * 4);
  return img;
}
const busFake: Renderer = {
  render: (spec, w, h) => busPixels(spec, w, h, "flat") ?? solidPixels(spec, w, h),
  renderShell: () => null,
  renderSplit: (spec, w, h) => (busPixels(spec, w, h, "back") ? { back: busPixels(spec, w, h, "back")!, mid: busPixels(spec, w, h, "mid")! } : null),
};

describe("a vehicle's front picture", () => {
  const job: Job = {
    type: "still",
    name: "bus",
    w: 6,
    h: 1,
    anchor: { x: 0, y: 0 },
    keys: {},
    paint: bus(0),
    chains: { riders: { input: "riders", steps: [bus(0), bus(1), bus(2), bus(3), bus(4)] } },
    layers: true,
    front: true,
  };
  const r = bake([job], busFake);
  const f = r.frames[0];

  it("splits into the interior, the riders and the frame in front of them", () => {
    expect(f.layers?.front).toBeTruthy();
    expect(f.layers?.soft).toBeUndefined();
    expect(f.layers?.chains?.riders.front).toBeDefined();
    // The back is the bare interior; nothing of the frame lands on it.
    expect(sameImage(composeLayered(r, { ...f, layers: { shell: f.layers!.shell, furniture: null } }), busPixels(bus(0), 6, 1, "back")!)).toBe(true);
  });
  it("composes back, riders and front to the flat frame at every rider count", () => {
    for (let n = 0; n <= 4; n++) expect(sameImage(composeLayered(r, f, { riders: n }), composeFrame(r, f, { riders: n })), `n=${n}`).toBe(true);
    const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
    expect(checkLayers(buildArchive(r, info, undefined, 32))).toEqual([]);
  });
  it("puts the riders, and only the riders, between the interior and the front", () => {
    const L = f.layers!;
    const only = (pick: "furniture" | "front") =>
      composeLayered(r, { ...f, layers: { shell: null, furniture: L[pick] ?? null, chains: { riders: { shell: [null], furniture: L.chains!.riders[pick]! } } } }, { riders: 4 });
    const red = (img: Image) => Array.from({ length: 6 }, (_, x) => (img.data[x * 4 + 3] ? img.data[x * 4] : 0));
    expect(red(only("furniture"))).toEqual([0, 200, 200, 200, 200, 0]);
    expect(red(only("front"))).toEqual([90, 0, 0, 90, 0, 90]);
  });
  it("flags front steps without a front, and a front with soft furniture", () => {
    const info = { version: "1", commit: "x", attribution: "a", licenseText: "" };
    const a = buildArchive(r, info, undefined, 32);
    const rec = a.manifest.frames.bus;
    const orphan = { ...rec, layers: { ...rec.layers!, front: undefined } };
    const withSoft = { ...rec, layers: { ...rec.layers!, soft: [] } };
    for (const bad of [orphan, withSoft]) expect(checkLayers({ ...a, manifest: { ...a.manifest, frames: { bus: bad } } })).toEqual(["bus"]);
  });
  it("refuses a front without layers, and a depth renderer that cannot split one", () => {
    expect(() => bake([{ ...job, layers: false }], busFake)).toThrow(/front picture needs layers/);
    expect(() => bake([job], { ...busFake, renderSplit: undefined, renderShell: () => null })).toThrow(/cannot split a front/);
  });
  it("refuses a vehicle whose paint marks no break", () => {
    expect(() => bake([{ ...job, paint: solid("3"), chains: undefined }], busFake)).toThrow(/marks no layer break/);
  });
});
