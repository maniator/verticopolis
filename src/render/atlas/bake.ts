import { bakeCycles, checkCycles, type BakedCycles } from "./bakeAdditions";
import type { Job, StillJob } from "./catalog";
import type { PaintSpec } from "./paint";
import { LayerError, diffLayer, over, sameImage, trim, type Image, type Piece } from "./pixels";
import { AddedStore, ImageStore, LayerStore, type ImageRef, type PendingRef } from "./store";

export { ImageStore, type ImageRef, type PendingRef };

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
   * already there (source-atop), and its `layerShell` art cuts the furniture
   * it covers away (destination-out). Null when the paint marks no break. A
   * renderer without it bakes no soft furniture.
   */
  renderSoft?(spec: PaintSpec, w: number, h: number): Image | null;
  /**
   * For a frame with a front picture: the canvas at the paint's `layerBreak`
   * (`back`) and at its `layerEnd` (`mid`, the back plus what came between),
   * so what the paint draws after the end is the front. Null when the paint
   * marks no break; with no end, `mid` is the finished paint.
   */
  renderSplit?(spec: PaintSpec, w: number, h: number): { back: Image; mid: Image } | null;
}

/** A frame's chain split for depth: step `k` of `shell` is what changes on
 *  the shell when the input goes from `k - 1` to `k` (a light switching on),
 *  step `k` of `furniture` what changes in front of it (the person who sits
 *  down). Each list is trimmed on its own; its step 0 is always null. */
export interface BakedLayerChain {
  shell: (ImageRef | null)[];
  furniture: (ImageRef | null)[];
  /** Steps over the front picture; present along with it. */
  front?: (ImageRef | null)[];
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
  /** What the paint draws after its furniture that stands in front of it
   *  (a cab's door frames, a train's body around its windows): drawn last,
   *  over the furniture. Present only for frames that ask for it, which then
   *  carry no soft picture. */
  front?: ImageRef | null;
  soft?: ImageRef | null;
  chains?: Record<string, BakedLayerChain>;
}

export interface BakedFrame {
  name: string;
  w: number;
  h: number;
  anchor: { x: number; y: number };
  keys: Record<string, string | number | boolean>;
  image: ImageRef | null;
  /** `alternativeTo` names the chain this one is drawn instead of. */
  chains?: Record<string, { input: string; steps: (ImageRef | null)[]; alternativeTo?: string }>;
  overlays?: Record<string, ImageRef | null>;
  /** Looping pictures over the frame (see `StillJob.cycles`); added after
   *  the first atlas, so their images are added images. */
  cycles?: BakedCycles;
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
  /** Where the families added after the first atlas begin among the frame
   *  images: their new images pack on pages of their own, after the older
   *  frame pages, so adding them never moves an older frame image (absent:
   *  none). Today that is one group, the scenery; a later family that must
   *  not repack it needs a group of its own. The depth layers' pages come
   *  last, so those can move when a family is added. */
  groups?: number[];
  /** Images from here on were added to frames that already shipped (an
   *  alternative chain, a frame's cycles); the archive packs them after every
   *  other page, so they never move an older image (absent: none). */
  addedImages?: number;
  frames: BakedFrame[];
  animations: BakedAnimation[];
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
  front?: PendingRef | null;
  chains?: Record<string, { shell: (PendingRef | null)[]; furniture: (PendingRef | null)[]; soft?: (PendingRef | null)[]; front?: (PendingRef | null)[] }>;
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
  const added = new AddedStore(store, layerStore.own);
  const withCycles: StillJob[] = [];
  const pending: { frame: BakedFrame; layers: PendingLayers }[] = [];
  const frames: BakedFrame[] = [];
  const animations: BakedAnimation[] = [];
  const names = new Set<string>();
  const claim = (name: string) => {
    if (names.has(name)) throw new Error(`duplicate frame name ${name}`);
    names.add(name);
  };
  /** The split of a frame's own paint: its shell and furniture, stored at
   *  once, and (when the soft pass gives one) its soft picture, which the
   *  caller stores only once every step has one, so a dropped soft picture
   *  leaves nothing on the pages. A soft pass that fails gives none. */
  const splitBase = (spec: PaintSpec, w: number, h: number, base: Image, shell: Image) => {
    const layers: PendingLayers = { shell: layerStore.shell(shell), furniture: layerStore.piece(diffLayer(shell, base), base) };
    let soft: Image | null = null;
    try {
      soft = r.renderSoft ? r.renderSoft(spec, w, h) : null;
    } catch (e) {
      if (!(e instanceof LayerError)) throw e;
    }
    return { layers, softBase: soft ? { image: soft, piece: trim(soft) } : null };
  };
  const groups: number[] = [];
  let ownPages = false;
  jobs.forEach((job, done) => {
    onProgress?.(done, jobs.length);
    // A family on pages of its own starts a new image group; one that does
    // not may not come after it, or its images would land in the new group.
    if (job.ownPages && !ownPages) groups.push(store.images.length);
    if (ownPages && !job.ownPages) throw new Error(`${job.name} comes after a family on pages of its own`);
    ownPages ||= job.ownPages === true;
    if (job.type === "anim") {
      const frameNames = job.frames.map((spec, i) => {
        const name = `${job.name}/${i}`;
        claim(name);
        const base = r.render(spec, job.w, job.h);
        const frame: BakedFrame = { name, w: job.w, h: job.h, anchor: job.anchor, keys: { ...job.keys, frame: i }, image: store.ref(base) };
        // An animation frame splits like a still with no chain.
        try {
          const shell = job.layers && r.renderShell ? r.renderShell(spec, job.w, job.h) : null;
          // Unlike a room (whose vacancy card or shutter paints flat), every
          // frame of an animation that asks for layers must split.
          if (job.layers && r.renderShell && !shell) throw new LayerError("marks no layer break");
          if (shell) {
            const { layers, softBase } = splitBase(spec, job.w, job.h, base, shell);
            if (softBase) layers.soft = layerStore.piece(softBase.piece, base);
            else if (r.renderSoft) stats?.softDropped.push(name);
            pending.push({ frame, layers });
          }
        } catch (e) {
          if (e instanceof LayerError) throw new LayerError(`${name}: ${e.message}`);
          throw e;
        }
        frames.push(frame);
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
          // An alternative chain came after the first atlas: added images.
          steps.push(chain.alternativeTo ? added.piece(diffLayer(prev, cur), cur) : store.layer(diffLayer(prev, cur), cur));
          renders.push(cur);
          prev = cur;
        }
        (frame.chains ??= {})[key] = { input: chain.input, steps: trimSteps(steps), ...(chain.alternativeTo ? { alternativeTo: chain.alternativeTo } : {}) };
        chainRenders[key] = renders;
      }
      for (const [key, spec] of Object.entries(job.overlays ?? {})) {
        const next = r.render(spec, job.w, job.h);
        (frame.overlays ??= {})[key] = store.layer(diffLayer(base, next), next);
      }
      const cycles = bakeCycles(job, base, r, added);
      if (cycles) {
        frame.cycles = cycles;
        withCycles.push(job);
      }
      // A vehicle splits three ways: the back (the interior seen through its
      // windows), the riders, then the front (the body and frames around
      // them), each what differs from the picture before it.
      if (job.front && !job.layers) throw new LayerError("a front picture needs layers");
      // A renderer that splits for depth must split a vehicle three ways.
      if (job.front && r.renderShell && !r.renderSplit) throw new LayerError("the renderer cannot split a front picture");
      const split3 = job.front && r.renderSplit ? r.renderSplit(job.paint, job.w, job.h) : null;
      if (job.front && r.renderSplit && !split3) throw new LayerError("marks no layer break");
      if (split3) {
        if (primaryChains(job) > 1) throw new LayerError("depth layers need at most one chain");
        const three = (prev: { back: Image; furniture: Image; front: Image } | null, flat: Image, s: { back: Image; mid: Image }) => {
          const furniture = furniturePicture(prev?.furniture ?? null, s.mid, s.back);
          const front = furniturePicture(prev?.front ?? null, flat, s.mid);
          if (!composesTo(s.back, furniture, s.mid) || !composesTo(s.mid, front, flat)) throw new LayerError("back, furniture and front do not compose to the frame");
          return { back: s.back, furniture, front };
        };
        let prev = three(null, base, split3);
        // A vehicle's front is never empty (its frames or body); one would mean
        // its paint ends the furniture after drawing them.
        if (trim(prev.front) === null) throw new LayerError("a vehicle with an empty front");
        const layers: PendingLayers = { shell: layerStore.shell(prev.back), furniture: layerStore.piece(trim(prev.furniture), base), front: layerStore.piece(trim(prev.front), base) };
        for (const [key, chain] of Object.entries(job.chains ?? {})) {
          const renders = chainRenders[key];
          const depth = chain.alternativeTo ? added : layerStore;
          const out = { shell: [null] as (PendingRef | null)[], furniture: [null] as (PendingRef | null)[], front: [null] as (PendingRef | null)[] };
          for (let k = 1; k < chain.steps.length; k++) {
            const sk = r.renderSplit!(chain.steps[k], job.w, job.h);
            if (!sk) throw new LayerError(`chain ${key} step ${k} marks no layer break`);
            const next = three(prev, renders[k], sk);
            out.shell.push(depth.piece(diffLayer(prev.back, next.back), next.back));
            out.furniture.push(depth.piece(diffLayer(prev.furniture, next.furniture), renders[k]));
            out.front.push(depth.piece(diffLayer(prev.front, next.front), renders[k]));
            prev = next;
          }
          (layers.chains ??= {})[key] = { shell: trimPending(out.shell), furniture: trimPending(out.furniture), front: trimPending(out.front) };
        }
        pending.push({ frame, layers });
        frames.push(frame);
        return;
      }
      // The depth split: the furniture is what differs from the shell, so the
      // shell plus the furniture gives back `base` exactly (diffLayer refuses
      // any pixel source-over could not reproduce).
      const shell = job.layers && r.renderShell ? r.renderShell(job.paint, job.w, job.h) : null;
      if (shell) {
        // At most one chain: the draw order the manifest documents (and the
        // checks that prove it) covers one; overlays draw last, in front.
        if (primaryChains(job) > 1) throw new LayerError("depth layers need at most one chain");
        const { layers, softBase } = splitBase(job.paint, job.w, job.h, base, shell);
        const soft0 = softBase?.image ?? null;
        let softOk = softBase !== null;
        const softSteps: Record<string, { piece: Piece | null; next: Image }[]> = {};
        // Each chain step splits the same way: what changes on the shell (a
        // light that switches on with the first occupant) and what changes in
        // front of it (the occupant).
        for (const [key, chain] of Object.entries(job.chains ?? {})) {
          const renders = chainRenders[key];
          const depth = chain.alternativeTo ? added : layerStore;
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
            split.shell.push(depth.piece(diffLayer(prevShell, shellK), shellK));
            split.furniture.push(depth.piece(diffLayer(prevFurniture, furnitureK), cur));
            if (softOk && prevSoft) {
              try {
                const softK = r.renderSoft!(chain.steps[k], job.w, job.h);
                if (!softK) throw new LayerError("no soft picture");
                softList.push({ piece: diffLayer(prevSoft, softK), next: cur });
                prevSoft = softK;
              } catch (e) {
                if (!(e instanceof LayerError)) throw e;
                // An alternative came after the frame shipped: letting it drop
                // the frame's soft furniture would change older data.
                if (chain.alternativeTo) throw new LayerError(`chain ${key} step ${k}: an alternative chain's soft step fails (${e.message})`);
                softOk = false;
              }
            }
            prevShell = shellK;
            prevFurniture = furnitureK;
          }
          (layers.chains ??= {})[key] = { shell: trimPending(split.shell), furniture: trimPending(split.furniture) };
        }
        if (softOk && softBase) {
          layers.soft = layerStore.piece(softBase.piece, base);
          for (const [key, list] of Object.entries(softSteps)) {
            const depth = job.chains?.[key].alternativeTo ? added : layerStore;
            layers.chains![key].soft = trimPending([null, ...list.map((s) => depth.piece(s.piece, s.next))]);
          }
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
  // The layer store's own images go after the frame images, and the added
  // images after those.
  const frameImages = store.images.length;
  added.finish(frameImages, layerStore.own.images.length);
  // The added flat references are final now; keep them plain like the rest.
  const plain = (ref: ImageRef | null): ImageRef | null => (ref ? { id: ref.id, dx: ref.dx, dy: ref.dy } : null);
  for (const f of frames) {
    for (const c of Object.values(f.chains ?? {})) if (c.alternativeTo) c.steps = c.steps.map(plain);
    for (const c of Object.values(f.cycles ?? {})) c.steps = c.steps.map(plain);
  }
  const resolve = (ref: PendingRef | null): ImageRef | null => (ref ? { id: ref.own ? ref.id + frameImages : ref.id, dx: ref.dx, dy: ref.dy } : null);
  for (const { frame, layers: p } of pending) {
    const layers: BakedLayers = { shell: resolve(p.shell), furniture: resolve(p.furniture) };
    if ("soft" in p) layers.soft = resolve(p.soft ?? null);
    if ("front" in p) layers.front = resolve(p.front ?? null);
    if (p.chains) {
      layers.chains = {};
      for (const [key, c] of Object.entries(p.chains)) {
        const out: BakedLayerChain = { shell: c.shell.map(resolve), furniture: c.furniture.map(resolve) };
        if (c.soft) out.soft = c.soft.map(resolve);
        if (c.front) out.front = c.front.map(resolve);
        layers.chains[key] = out;
      }
    }
    frame.layers = layers;
  }
  const addedImages = frameImages + layerStore.own.images.length;
  const result: BakeResult = {
    images: [...store.images, ...layerStore.own.images, ...added.own.images],
    normals: [...store.normals, ...layerStore.own.normals, ...added.own.normals],
    frameImages,
    ...(groups.length > 0 ? { groups } : {}),
    ...(added.own.images.length > 0 ? { addedImages } : {}),
    frames,
    animations,
  };
  checkCycles(result, r, withCycles);
  return result;
}

/** The job's chains that are not alternatives to another; a depth split
 *  covers one (each alternative splits the same way, on its own). */
function primaryChains(job: StillJob): number {
  return Object.values(job.chains ?? {}).filter((c) => !c.alternativeTo).length;
}
