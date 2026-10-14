import { bake, type BakeResult, type Renderer } from "./bake";
import { roomJobs, type Job } from "./catalog";
import { facadeJobs, peopleJobs, skyJobs, structureJobs, transportJobs, vehicleJobs } from "./catalogExtras";
import { paint, type PaintSpec } from "./paint";
import { sceneryJobs } from "./scenery";
import { LayerError, type Image } from "./pixels";
import { shellMarks } from "./shellMarks";
import { withLayerHook } from "../pixelSprites/layers";
import { SAMPLES, type Sample } from "./samples";
import { verifySample, type SampleResult } from "./verify";
import { verifyExtras } from "./verifyExtras";
import { catalogFor } from "../../engine/catalog";
import { bindViewWorld } from "../../presentation/viewWorld";

// A tooling page draws sprites without a tower, so it binds the Modern
// catalog's world for the view (the lot geometry the sprites hash on).
bindViewWorld(catalogFor("modern").world);

/**
 * The atlas bake's browser half, bundled by `scripts/export-atlas.ts` and run
 * inside the pinned Playwright Chromium. It renders every catalog job through
 * a real 2D canvas set up the way Excalibur's `Raster` sets up the web game's
 * bake canvases, and hands the unique images back to Node in chunks.
 */

/** Every job the atlas bakes, in a fixed order. */
export function allJobs(): Job[] {
  return [...roomJobs(), ...structureJobs(), ...transportJobs(), ...peopleJobs(), ...facadeJobs(), ...vehicleJobs(), ...skyJobs(), ...sceneryJobs()];
}

/** A 2D context for `canvas` at `w` x `h`, cleared and prepared like an
 *  Excalibur raster (quality 1, no padding, smoothing off, 1px butt lines,
 *  black fill), with that state saved. */
function prepare(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
  ctx.fillStyle = "#000000";
  return ctx;
}

/** Replace every pixel of `dst` with `src`'s, whatever transform, alpha,
 *  shadow or filter the paint has set. Canvas to canvas with "copy" moves the
 *  stored pixels unchanged, translucent ones included. A clip cannot be lifted
 *  without the paint's own `restore`, so the copy stays inside any clip: the
 *  bake's only clip is the room's whole canvas (`paintSettledUnit`). */
function copyPixels(dst: CanvasRenderingContext2D, src: HTMLCanvasElement): void {
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.globalAlpha = 1;
  dst.globalCompositeOperation = "copy";
  dst.imageSmoothingEnabled = false;
  dst.shadowColor = "transparent";
  dst.shadowBlur = 0;
  dst.shadowOffsetX = 0;
  dst.shadowOffsetY = 0;
  dst.filter = "none";
  dst.drawImage(src, 0, 0);
  dst.restore();
}

/** A fresh canvas per render, prepared like an Excalibur raster. */
export function canvasRenderer(doc: Document): Renderer {
  const canvas = doc.createElement("canvas");
  const saved = doc.createElement("canvas");
  const aside = doc.createElement("canvas");
  return {
    render(spec: PaintSpec, w: number, h: number): Image {
      const ctx = prepare(canvas, w, h);
      paint(ctx, spec, w, h);
      ctx.restore();
      const data = ctx.getImageData(0, 0, w, h).data;
      return { w, h, data };
    },
    // The same paint, with the layer marks live: at the break the canvas is
    // copied aside; at the end of the furniture (or of the paint) it is put
    // back, so the furniture is gone and anything drawn after the end (the
    // night scrim, the notice badge) lands on the shell. The flat frame comes
    // from `render`, which runs with no hook, so its pixels never depend on
    // this pass.
    renderShell(spec: PaintSpec, w: number, h: number): Image | null {
      const ctx = prepare(canvas, w, h);
      const store = prepare(saved, w, h);
      const spare = prepare(aside, w, h);
      const marks = shellMarks(
        () => copyPixels(store, canvas),
        () => copyPixels(ctx, saved),
        // Shell art among the furniture: paint it on the shell kept aside
        // (swapped onto the canvas, since the paint holds the canvas's
        // context), then on the canvas as the flat frame has it.
        (draw) => {
          copyPixels(spare, canvas);
          copyPixels(ctx, saved);
          draw();
          copyPixels(store, canvas);
          copyPixels(ctx, aside);
          draw();
        },
      );
      withLayerHook(marks.hook, () => paint(ctx, spec, w, h));
      const split = marks.finish();
      ctx.restore();
      store.restore();
      spare.restore();
      if (!split) return null;
      return { w, h, data: ctx.getImageData(0, 0, w, h).data };
    },
    // For a vehicle: the canvas at the break (the back) and at the end of the
    // furniture (the back plus the riders); what the paint draws after the
    // end is its front, which the bake takes from the flat frame.
    renderSplit(spec: PaintSpec, w: number, h: number): { back: Image; mid: Image } | null {
      const ctx = prepare(canvas, w, h);
      const back = prepare(saved, w, h);
      const mid = prepare(aside, w, h);
      const marks = shellMarks(
        () => copyPixels(back, canvas),
        () => copyPixels(mid, canvas),
        // No vehicle draws shell art among its riders; it would land on them.
        () => {
          throw new LayerError("layerShell in a vehicle's paint");
        },
      );
      withLayerHook(marks.hook, () => paint(ctx, spec, w, h));
      const split = marks.finish();
      ctx.restore();
      back.restore();
      mid.restore();
      if (!split) return null;
      return { back: { w, h, data: back.getImageData(0, 0, w, h).data }, mid: { w, h, data: mid.getImageData(0, 0, w, h).data } };
    },
    // The same paint once more: at the break the canvas is cleared, so the
    // furniture lands on transparency with its own glows and shadows; at the
    // end of the furniture the paint switches to source-atop, so the marks
    // drawn over the room only tint the furniture already there.
    renderSoft(spec: PaintSpec, w: number, h: number): Image | null {
      const ctx = prepare(canvas, w, h);
      // A blank canvas to copy in at the break, so the furniture is painted on
      // transparency (`prepare` clears it; the restore pops its save).
      prepare(saved, w, h).restore();
      // After the end, the marks drawn over the furniture land only on its
      // pixels (source-atop), even past a `restore()` that would bring back
      // source-over: no room routine sets a composite mode of its own.
      const restore = ctx.restore.bind(ctx);
      const atop = () => {
        ctx.globalCompositeOperation = "source-atop";
        ctx.restore = () => {
          restore();
          ctx.globalCompositeOperation = "source-atop";
        };
      };
      // Shell art among the furniture belongs to the shell, so here it only
      // cuts away the furniture it covers (the curb over the machines' feet).
      const onShell = (draw: () => void) => {
        const prev = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "destination-out";
        try {
          draw();
        } finally {
          ctx.globalCompositeOperation = prev;
        }
      };
      const marks = shellMarks(() => copyPixels(ctx, saved), atop, onShell);
      let split: boolean;
      try {
        withLayerHook(marks.hook, () => paint(ctx, spec, w, h));
        split = marks.finish();
      } finally {
        Reflect.deleteProperty(ctx, "restore");
      }
      ctx.restore();
      if (!split) return null;
      return { w, h, data: ctx.getImageData(0, 0, w, h).data };
    },
  };
}

function toBase64(bytes: Uint8ClampedArray): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

interface AtlasPage {
  run(filter?: string): { images: number; frames: number; animations: number; softDropped: string[] };
  records(): Omit<BakeResult, "images" | "normals">;
  /** Images from `from` on, at least one, until about `maxBytes` of base64. */
  images(from: number, maxBytes: number): { w: number; h: number; b64: string; normal: string }[];
  verify(samples?: Sample[]): SampleResult[];
}

let result: BakeResult | null = null;
const api: AtlasPage = {
  run(filter) {
    const jobs = filter ? allJobs().filter((j) => j.name.startsWith(filter)) : allJobs();
    const stats = { softDropped: [] as string[] };
    result = bake(jobs, canvasRenderer(document), undefined, stats);
    return { images: result.images.length, frames: result.frames.length, animations: result.animations.length, softDropped: stats.softDropped };
  },
  records() {
    if (!result) throw new Error("run() first");
    // Everything but the pixels, so a new field of the result reaches Node.
    const { images: _images, normals: _normals, ...records } = result;
    return records;
  },
  images(from, maxBytes) {
    if (!result) throw new Error("run() first");
    const out: { w: number; h: number; b64: string; normal: string }[] = [];
    let bytes = 0;
    for (let i = from; i < result.images.length && (out.length === 0 || bytes < maxBytes); i++) {
      const img = result.images[i];
      bytes += Math.ceil((img.data.length * 2 * 4) / 3);
      out.push({ w: img.w, h: img.h, b64: toBase64(img.data), normal: toBase64(result.normals[i].data) });
    }
    return out;
  },
  verify(samples = SAMPLES) {
    const jobs = allJobs();
    const renderer = canvasRenderer(document);
    return [...samples.flatMap((s) => verifySample(document, jobs, renderer, s)), ...verifyExtras(document, jobs, renderer)];
  },
};
(globalThis as unknown as { __vcAtlas: AtlasPage }).__vcAtlas = api;
