import { bake, type BakeResult, type Renderer } from "./bake";
import { roomJobs, type Job } from "./catalog";
import { facadeJobs, peopleJobs, skyJobs, structureJobs, transportJobs, vehicleJobs } from "./catalogExtras";
import { paint, type PaintSpec } from "./paint";
import type { Image } from "./pixels";
import { SAMPLES, type Sample } from "./samples";
import { verifySample, type SampleResult } from "./verify";
import { verifyExtras } from "./verifyExtras";

/**
 * The atlas bake's browser half, bundled by `scripts/export-atlas.ts` and run
 * inside the pinned Playwright Chromium. It renders every catalog job through
 * a real 2D canvas set up the way Excalibur's `Raster` sets up the web game's
 * bake canvases, and hands the unique images back to Node in chunks.
 */

/** Every job the atlas bakes, in a fixed order. */
export function allJobs(): Job[] {
  return [...roomJobs(), ...structureJobs(), ...transportJobs(), ...peopleJobs(), ...facadeJobs(), ...vehicleJobs(), ...skyJobs()];
}

/** A fresh canvas per render, prepared like an Excalibur raster (quality 1,
 *  no padding, smoothing off, 1px butt lines, black fill). */
export function canvasRenderer(doc: Document): Renderer {
  const canvas = doc.createElement("canvas");
  return {
    render(spec: PaintSpec, w: number, h: number): Image {
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
      paint(ctx, spec, w, h);
      ctx.restore();
      const data = ctx.getImageData(0, 0, w, h).data;
      return { w, h, data };
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
  run(filter?: string): { images: number; frames: number; animations: number };
  records(): Omit<BakeResult, "images" | "normals">;
  /** Images from `from` on, at least one, until about `maxBytes` of base64. */
  images(from: number, maxBytes: number): { w: number; h: number; b64: string; normal: string }[];
  verify(samples?: Sample[]): SampleResult[];
}

let result: BakeResult | null = null;
const api: AtlasPage = {
  run(filter) {
    const jobs = filter ? allJobs().filter((j) => j.name.startsWith(filter)) : allJobs();
    result = bake(jobs, canvasRenderer(document));
    return { images: result.images.length, frames: result.frames.length, animations: result.animations.length };
  },
  records() {
    if (!result) throw new Error("run() first");
    return { frames: result.frames, animations: result.animations };
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
