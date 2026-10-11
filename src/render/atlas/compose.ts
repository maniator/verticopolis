import type { BakeResult, BakedFrame, ImageRef } from "./bake";
import type { Lookup } from "./lookup";
import { blank, over, type Image } from "./pixels";

/**
 * Composition the way a frontend does it: a frame's image, then the chain
 * steps up to the requested count, then the named overlays, each drawn
 * source-over at its offset. Works on a bake result; the archive test checks
 * that the packed pages plus the manifest give back the same pixels.
 */

function place(dst: Image, bake: Pick<BakeResult, "images">, ref: ImageRef | null): void {
  if (ref) over(dst, bake.images[ref.id], ref.dx, ref.dy);
}

/** Compose `rec` with chain inputs `chains` and overlays `overlays`. */
export function composeFrame(
  bake: Pick<BakeResult, "images">,
  rec: BakedFrame,
  chains: Record<string, number> = {},
  overlays: readonly string[] = [],
): Image {
  const out = blank(rec.w, rec.h);
  place(out, bake, rec.image);
  for (const [key, n] of Object.entries(chains)) {
    const chain = rec.chains?.[key];
    if (!chain) throw new Error(`${rec.name} has no chain ${key}`);
    for (let k = 1; k <= Math.min(n, chain.steps.length - 1); k++) place(out, bake, chain.steps[k]);
  }
  for (const o of overlays) {
    if (!rec.overlays || !(o in rec.overlays)) throw new Error(`${rec.name} has no overlay ${o}`);
    place(out, bake, rec.overlays[o]);
  }
  return out;
}

/** The frame a lookup names (an animation resolves to its frame `i`), and
 *  the composed pixels. */
export function composeLookup(bake: Pick<BakeResult, "images" | "frames">, found: Lookup, frameIndex = 0): { name: string; image: Image } {
  const name = "animation" in found ? `${found.animation}/${frameIndex}` : found.frame;
  const rec = bake.frames.find((f) => f.name === name);
  if (!rec) throw new Error(`no frame ${name}`);
  const image = "animation" in found ? composeFrame(bake, rec) : composeFrame(bake, rec, found.chains, found.overlays);
  return { name, image };
}

/** Count differing pixels and their bounding box. */
export function compareImages(a: Image, b: Image): { mismatches: number; box?: { x0: number; y0: number; x1: number; y1: number } } {
  if (a.w !== b.w || a.h !== b.h) return { mismatches: Math.max(a.w * a.h, b.w * b.h) };
  let mismatches = 0;
  let box: { x0: number; y0: number; x1: number; y1: number } | undefined;
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
    mismatches++;
    const x = p % a.w;
    const y = (p - x) / a.w;
    box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
  }
  return { mismatches, box };
}
