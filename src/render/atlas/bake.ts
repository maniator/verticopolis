import type { Job } from "./catalog";
import type { PaintSpec } from "./paint";
import { LayerError, contentHash, diffLayer, sameImage, trim, type Image } from "./pixels";

/**
 * Runs the catalog through a renderer: one render per frame, per animation
 * frame and per chain step, then trims, diffs and deduplicates the pixels into
 * a set of unique images plus the records that point at them. Renderer-
 * agnostic: the export runs it in the pinned browser, the unit tests with a
 * fake.
 */

export interface Renderer {
  render(spec: PaintSpec, w: number, h: number): Image;
}

/** An image placed inside a frame: the unique image's id and its offset. */
export interface ImageRef {
  id: number;
  dx: number;
  dy: number;
}

export interface BakedFrame {
  name: string;
  w: number;
  h: number;
  anchor: { x: number; y: number };
  keys: Record<string, string | number | boolean>;
  image: ImageRef | null;
  chains?: Record<string, { input: string; steps: (ImageRef | null)[] }>;
  overlays?: Record<string, ImageRef | null>;
}

export interface BakedAnimation {
  name: string;
  dt: number;
  loop: boolean;
  keys: Record<string, string | number | boolean>;
  frames: string[];
}

export interface BakeResult {
  images: Image[];
  frames: BakedFrame[];
  animations: BakedAnimation[];
}

/** Unique images by content. */
export class ImageStore {
  readonly images: Image[] = [];
  private readonly byHash = new Map<string, number[]>();

  add(img: Image): number {
    const key = contentHash(img);
    const ids = this.byHash.get(key) ?? [];
    for (const id of ids) if (sameImage(this.images[id], img)) return id;
    const id = this.images.length;
    this.images.push(img);
    ids.push(id);
    this.byHash.set(key, ids);
    return id;
  }

  /** Trim and store; null for a fully transparent image. */
  ref(img: Image): ImageRef | null {
    const t = trim(img);
    if (!t) return null;
    return { id: this.add({ w: t.w, h: t.h, data: t.data }), dx: t.x, dy: t.y };
  }
}

/** Drop trailing empty steps so `max` is the last step that changes pixels. */
function trimSteps(steps: (ImageRef | null)[]): (ImageRef | null)[] {
  let n = steps.length;
  while (n > 1 && steps[n - 1] === null) n--;
  return steps.slice(0, n);
}

export function bake(jobs: readonly Job[], r: Renderer, onProgress?: (done: number, total: number) => void): BakeResult {
  const store = new ImageStore();
  const frames: BakedFrame[] = [];
  const animations: BakedAnimation[] = [];
  const names = new Set<string>();
  const claim = (name: string) => {
    if (names.has(name)) throw new Error(`duplicate frame name ${name}`);
    names.add(name);
  };
  jobs.forEach((job, done) => {
    onProgress?.(done, jobs.length);
    if (job.type === "anim") {
      const frameNames = job.frames.map((spec, i) => {
        const name = `${job.name}/${i}`;
        claim(name);
        const image = store.ref(r.render(spec, job.w, job.h));
        frames.push({ name, w: job.w, h: job.h, anchor: job.anchor, keys: { ...job.keys, frame: i }, image });
        return name;
      });
      animations.push({ name: job.name, dt: job.dt, loop: job.loop, keys: job.keys, frames: frameNames });
      return;
    }
    claim(job.name);
    const base = r.render(job.paint, job.w, job.h);
    const frame: BakedFrame = { name: job.name, w: job.w, h: job.h, anchor: job.anchor, keys: job.keys, image: store.ref(base) };
    try {
      for (const [key, chain] of Object.entries(job.chains ?? {})) {
        const steps: (ImageRef | null)[] = [null];
        let prev = base;
        for (let k = 1; k < chain.steps.length; k++) {
          const cur = r.render(chain.steps[k], job.w, job.h);
          const layer = diffLayer(prev, cur);
          steps.push(layer ? { id: store.add(layer), dx: layer.x, dy: layer.y } : null);
          prev = cur;
        }
        (frame.chains ??= {})[key] = { input: chain.input, steps: trimSteps(steps) };
      }
      for (const [key, spec] of Object.entries(job.overlays ?? {})) {
        const layer = diffLayer(base, r.render(spec, job.w, job.h));
        (frame.overlays ??= {})[key] = layer ? { id: store.add(layer), dx: layer.x, dy: layer.y } : null;
      }
    } catch (e) {
      if (e instanceof LayerError) throw new LayerError(`${job.name}: ${e.message}`);
      throw e;
    }
    frames.push(frame);
  });
  onProgress?.(jobs.length, jobs.length);
  return { images: store.images, frames, animations };
}
