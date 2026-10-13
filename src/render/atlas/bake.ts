import type { Job } from "./catalog";
import type { PaintSpec } from "./paint";
import { LayerError, contentHash, crop, diffLayer, over, sameImage, trim, type Image, type Piece } from "./pixels";
import { maskTo, normalMap } from "./raster";

/**
 * Runs the catalog through a renderer: one render per frame, per animation
 * frame and per chain step, then trims, diffs and deduplicates the pixels into
 * a set of unique images plus the records that point at them. Renderer-
 * agnostic: the export runs it in the pinned browser, the unit tests with a
 * fake.
 */

export interface Renderer {
  render(spec: PaintSpec, w: number, h: number): Image;
  /**
   * The room's shell picture for a depth-layered frame: the canvas as it stood
   * at the paint's `layerBreak`, with whatever the paint draws after its
   * `layerEnd` drawn over it (`pixelSprites/layers.ts`). Null when the paint
   * marks no break. A renderer without it bakes no depth layers.
   */
  renderShell?(spec: PaintSpec, w: number, h: number): Image | null;
  /**
   * The room's furniture painted onto a transparent canvas from the paint's
   * `layerBreak` on, so glows and soft shadows keep their own transparency;
   * whatever the paint draws after its `layerEnd` only tints the furniture
   * already there (source-atop). Null when the paint marks no break. A
   * renderer without it bakes no soft furniture.
   */
  renderSoft?(spec: PaintSpec, w: number, h: number): Image | null;
}

/** A frame's chain split for depth: step `k` of `shell` is what changes on
 *  the shell when the input goes from `k - 1` to `k` (a light switching on),
 *  step `k` of `furniture` what changes in front of it (the person who sits
 *  down). Each list is trimmed on its own; its step 0 is always null. */
export interface BakedLayerChain {
  shell: (ImageRef | null)[];
  furniture: (ImageRef | null)[];
  /** Steps over the soft furniture picture; absent along with it (a
   *  translucent pixel that changes, or a failed soft pass). */
  soft?: (ImageRef | null)[];
}

/** The frame split for depth. Drawing `shell`, the chain's shell steps,
 *  `furniture`, then the chain's furniture steps gives back the frame plus
 *  its chain steps exactly, for every input (each list clamped on its own).
 *  `soft` is the furniture with its own transparency; over the shell it
 *  rounds a step or two away from `furniture`. */
export interface BakedLayers {
  shell: ImageRef | null;
  furniture: ImageRef | null;
  soft?: ImageRef | null;
  chains?: Record<string, BakedLayerChain>;
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
  /** The frame split for depth (see {@link BakedLayers}). Null pieces are
   *  fully transparent. Absent when the paint marks no break. */
  layers?: BakedLayers;
}

export interface BakedAnimation {
  name: string;
  dt: number;
  loop: boolean;
  keys: Record<string, string | number | boolean>;
  frames: string[];
}

export interface BakeResult {
  /** Unique color images; `normals[i]` is image `i`'s normal map. */
  images: Image[];
  normals: Image[];
  /** Images `0..frameImages - 1` are the ones frames, chains and overlays use,
   *  in the order a bake without depth layers stores them; the depth layers'
   *  own images come after. The archive packs the two groups apart, so the
   *  layers never move a frame image (absent: every image is a frame image). */
  frameImages?: number;
  frames: BakedFrame[];
  animations: BakedAnimation[];
}

/** Unique color-and-normal pairs by content. A normal map is taken over a
 *  whole frame before anything is cut from it, so trimming, slicing and
 *  layering never leave a false bevel at a cut. */
export class ImageStore {
  readonly images: Image[] = [];
  readonly normals: Image[] = [];
  private readonly byHash = new Map<string, number[]>();

  /** The id of a stored pair equal to this one, or -1. */
  find(img: Image, normal: Image): number {
    for (const id of this.byHash.get(`${contentHash(img)}|${contentHash(normal)}`) ?? []) {
      if (sameImage(this.images[id], img) && sameImage(this.normals[id], normal)) return id;
    }
    return -1;
  }

  add(img: Image, normal: Image): number {
    const key = `${contentHash(img)}|${contentHash(normal)}`;
    const ids = this.byHash.get(key) ?? [];
    for (const id of ids) if (sameImage(this.images[id], img) && sameImage(this.normals[id], normal)) return id;
    const id = this.images.length;
    this.images.push(img);
    this.normals.push(normal);
    ids.push(id);
    this.byHash.set(key, ids);
    return id;
  }

  /** Trim a whole frame and store it; null for a fully transparent frame. */
  ref(img: Image): ImageRef | null {
    const t = trim(img);
    if (!t) return null;
    const normal = crop(normalMap(img), t.x, t.y, t.w, t.h);
    return { id: this.add({ w: t.w, h: t.h, data: t.data }, normal), dx: t.x, dy: t.y };
  }

  /** Store a layer cut from the whole frame `next`; its normals come from
   *  that frame, masked to the layer's own pixels. */
  layer(piece: Piece | null, next: Image): ImageRef | null {
    if (!piece) return null;
    const normal = maskTo(crop(normalMap(next), piece.x, piece.y, piece.w, piece.h), piece);
    return { id: this.add({ w: piece.w, h: piece.h, data: piece.data }, normal), dx: piece.x, dy: piece.y };
  }
}

/** A depth-layer image: a frame image's id, or (`own`) an id in the layer
 *  store, which the bake moves past the frame images once it is done. */
interface PendingRef extends ImageRef {
  own: boolean;
}

/** The depth layers' images, kept apart from the frame images so a bake with
 *  layers stores every frame image under the same id, in the same order, as a
 *  bake without them. A layer equal to a frame image already stored reuses it
 *  (one equal to a later frame's image is stored twice, which costs only
 *  space). */
class LayerStore {
  readonly own = new ImageStore();
  constructor(private readonly frames: ImageStore) {}

  private put(img: Image, normal: Image, dx: number, dy: number): PendingRef {
    const hit = this.frames.find(img, normal);
    return hit >= 0 ? { id: hit, dx, dy, own: false } : { id: this.own.add(img, normal), dx, dy, own: true };
  }

  /** A whole shell picture, trimmed; its normals are its own (the shell is a
   *  picture of its own, drawn without the furniture). */
  shell(img: Image): PendingRef | null {
    const t = trim(img);
    if (!t) return null;
    return this.put({ w: t.w, h: t.h, data: t.data }, crop(normalMap(img), t.x, t.y, t.w, t.h), t.x, t.y);
  }

  /** A piece (the furniture, or one depth step) cut from the whole picture
   *  `next`; its normals come from that picture, masked to its own pixels,
   *  like any other layer. */
  piece(piece: Piece | null, next: Image): PendingRef | null {
    if (!piece) return null;
    const normal = maskTo(crop(normalMap(next), piece.x, piece.y, piece.w, piece.h), piece);
    return this.put({ w: piece.w, h: piece.h, data: piece.data }, normal, piece.x, piece.y);
  }
}

/** Drop trailing empty steps so `max` is the last step that changes pixels.
 *  The catalog sizes each chain to the largest count the engine produces, so
 *  steps past `max` look the same as `max`. */
function trimSteps(steps: (ImageRef | null)[]): (ImageRef | null)[] {
  let n = steps.length;
  while (n > 1 && steps[n - 1] === null) n--;
  return steps.slice(0, n);
}

/** The furniture picture for one step of a layered frame: the flat frame's
 *  pixels wherever they differ from the shell, kept wherever an earlier
 *  step's picture already had a pixel (so a step only ever adds or paints
 *  over, which source-over can draw), transparent elsewhere. */
function furniturePicture(prev: Image | null, flat: Image, shell: Image): Image {
  const out: Image = { w: flat.w, h: flat.h, data: new Uint8ClampedArray(flat.data.length) };
  const a = flat.data;
  const b = shell.data;
  for (let i = 0; i < a.length; i += 4) {
    const differs = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
    if (differs || (prev && prev.data[i + 3] !== 0)) out.data.set(a.subarray(i, i + 4), i);
  }
  return out;
}

/** True when `top` drawn source-over onto `under` gives `want` exactly. */
function composesTo(under: Image, top: Image, want: Image): boolean {
  const out = { w: under.w, h: under.h, data: under.data.slice() };
  over(out, top, 0, 0);
  return sameImage(out, want);
}

/** Pieces still waiting for their final image ids. */
type PendingLayers = {
  shell: PendingRef | null;
  furniture: PendingRef | null;
  soft?: PendingRef | null;
  chains?: Record<string, { shell: (PendingRef | null)[]; furniture: (PendingRef | null)[]; soft?: (PendingRef | null)[] }>;
};

/** Drop trailing nulls from a depth step list (each list on its own). */
function trimPending(steps: (PendingRef | null)[]): (PendingRef | null)[] {
  let n = steps.length;
  while (n > 1 && steps[n - 1] === null) n--;
  return steps.slice(0, n);
}

export interface BakeStats {
  /** Layered frames left without soft furniture: an occupant step could not
   *  be drawn over it source-over (it would change a translucent pixel), or
   *  the soft pass failed or gave no picture. */
  softDropped: string[];
}

export function bake(jobs: readonly Job[], r: Renderer, onProgress?: (done: number, total: number) => void, stats?: BakeStats): BakeResult {
  const store = new ImageStore();
  const layerStore = new LayerStore(store);
  const pending: { frame: BakedFrame; layers: PendingLayers }[] = [];
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
      // The flat chains, exactly as before; their renders are kept for the
      // depth split below.
      const chainRenders: Record<string, Image[]> = {};
      for (const [key, chain] of Object.entries(job.chains ?? {})) {
        const steps: (ImageRef | null)[] = [null];
        const renders: Image[] = [base];
        let prev = base;
        for (let k = 1; k < chain.steps.length; k++) {
          const cur = r.render(chain.steps[k], job.w, job.h);
          steps.push(store.layer(diffLayer(prev, cur), cur));
          renders.push(cur);
          prev = cur;
        }
        (frame.chains ??= {})[key] = { input: chain.input, steps: trimSteps(steps) };
        chainRenders[key] = renders;
      }
      for (const [key, spec] of Object.entries(job.overlays ?? {})) {
        const next = r.render(spec, job.w, job.h);
        (frame.overlays ??= {})[key] = store.layer(diffLayer(base, next), next);
      }
      // The depth split: the furniture is what differs from the shell, so the
      // shell plus the furniture gives back `base` exactly (diffLayer refuses
      // any pixel source-over could not reproduce).
      const shell = job.layers && r.renderShell ? r.renderShell(job.paint, job.w, job.h) : null;
      if (shell) {
        // One chain and no overlays: the draw order the manifest documents
        // (and the checks that prove it) covers exactly that.
        if (Object.keys(job.chains ?? {}).length > 1 || Object.keys(job.overlays ?? {}).length > 0) throw new LayerError("depth layers need at most one chain and no overlays");
        const layers: PendingLayers = { shell: layerStore.shell(shell), furniture: layerStore.piece(diffLayer(shell, base), base) };
        // The soft picture is optional: a soft pass that fails drops it.
        let soft0: Image | null = null;
        try {
          soft0 = r.renderSoft ? r.renderSoft(job.paint, job.w, job.h) : null;
        } catch (e) {
          if (!(e instanceof LayerError)) throw e;
        }
        let softOk = soft0 !== null;
        // The soft pieces go into the layer store only once every step has
        // one, so a dropped soft picture leaves nothing on the pages.
        const softBase = soft0 ? trim(soft0) : null;
        const softSteps: Record<string, { piece: Piece | null; next: Image }[]> = {};
        // Each chain step splits the same way: what changes on the shell (a
        // light that switches on with the first occupant) and what changes in
        // front of it (the occupant).
        for (const [key, chain] of Object.entries(job.chains ?? {})) {
          const renders = chainRenders[key];
          const split = { shell: [null] as (PendingRef | null)[], furniture: [null] as (PendingRef | null)[] };
          let prevShell = shell;
          let prevFurniture = furniturePicture(null, base, shell);
          let prevSoft = soft0;
          const softList: { piece: Piece | null; next: Image }[] = (softSteps[key] = []);
          for (let k = 1; k < chain.steps.length; k++) {
            const cur = renders[k];
            const shellK = r.renderShell!(chain.steps[k], job.w, job.h);
            if (!shellK) throw new LayerError(`chain ${key} step ${k} marks no layer break`);
            const furnitureK = furniturePicture(prevFurniture, cur, shellK);
            if (!composesTo(shellK, furnitureK, cur)) throw new LayerError(`chain ${key} step ${k}: shell and furniture do not compose to the frame`);
            split.shell.push(layerStore.piece(diffLayer(prevShell, shellK), shellK));
            split.furniture.push(layerStore.piece(diffLayer(prevFurniture, furnitureK), cur));
            if (softOk && prevSoft) {
              try {
                const softK = r.renderSoft!(chain.steps[k], job.w, job.h);
                if (!softK) throw new LayerError("no soft picture");
                softList.push({ piece: diffLayer(prevSoft, softK), next: cur });
                prevSoft = softK;
              } catch (e) {
                if (!(e instanceof LayerError)) throw e;
                softOk = false;
              }
            }
            prevShell = shellK;
            prevFurniture = furnitureK;
          }
          (layers.chains ??= {})[key] = { shell: trimPending(split.shell), furniture: trimPending(split.furniture) };
        }
        if (softOk && soft0) {
          layers.soft = layerStore.piece(softBase, base);
          for (const [key, list] of Object.entries(softSteps)) layers.chains![key].soft = trimPending([null, ...list.map((s) => layerStore.piece(s.piece, s.next))]);
        } else if (r.renderSoft) {
          // A soft picture without composable steps would mislead; drop it.
          stats?.softDropped.push(job.name);
        }
        pending.push({ frame, layers });
      }
    } catch (e) {
      if (e instanceof LayerError) throw new LayerError(`${job.name}: ${e.message}`);
      throw e;
    }
    frames.push(frame);
  });
  onProgress?.(jobs.length, jobs.length);
  // The layer store's own images go after the frame images.
  const frameImages = store.images.length;
  const resolve = (ref: PendingRef | null): ImageRef | null => (ref ? { id: ref.own ? ref.id + frameImages : ref.id, dx: ref.dx, dy: ref.dy } : null);
  for (const { frame, layers: p } of pending) {
    const layers: BakedLayers = { shell: resolve(p.shell), furniture: resolve(p.furniture) };
    if ("soft" in p) layers.soft = resolve(p.soft ?? null);
    if (p.chains) {
      layers.chains = {};
      for (const [key, c] of Object.entries(p.chains)) {
        const out: BakedLayerChain = { shell: c.shell.map(resolve), furniture: c.furniture.map(resolve) };
        if (c.soft) out.soft = c.soft.map(resolve);
        layers.chains[key] = out;
      }
    }
    frame.layers = layers;
  }
  return {
    images: [...store.images, ...layerStore.own.images],
    normals: [...store.normals, ...layerStore.own.normals],
    frameImages,
    frames,
    animations,
  };
}
