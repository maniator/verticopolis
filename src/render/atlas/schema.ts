/**
 * The sprite atlas archive's contract: its constants and the manifest shape
 * any frontend on the open engine reads. Bump {@link ATLAS_SCHEMA_VERSION} on
 * any change a reader could notice (a renamed frame, a moved field, a new
 * meaning); adding frames or optional fields keeps the version.
 *
 * The full reader's guide lives in `docs/atlas.md`.
 */

/** Manifest schema version. Readers reject a major they do not know. */
export const ATLAS_SCHEMA_VERSION = 1;

/** Integer upscales shipped next to the canonical 1x bake. */
export const ATLAS_SCALES = [1, 2, 4] as const;
export type AtlasScale = (typeof ATLAS_SCALES)[number];

/** Page edge at 1x. Every scale's pages are this times the scale, so the 4x
 *  pages stay at 2048 px, inside the smallest mobile GPU texture limit. */
export const ATLAS_PAGE_BASE = 512;

/** Transparent gutter around every packed image, in 1x pixels. */
export const ATLAS_PADDING = 1;

/** Sampled per-footprint placements per room kind (see `variants` in the
 *  manifest): the web seeds room variety from the room's floor, column and id,
 *  so a finite atlas carries a fixed sample of those seeds. */
export const ROOM_VARIANTS = 4;

/** Animation frames sampled per loop. */
export const FIRE_FRAMES = 12;
export const CONSTRUCTION_FRAMES = 24;
export const CRANE_FRAMES = 16;
/** Seconds between sampled crane frames (the crane's motion is aperiodic). */
export const CRANE_DT = 0.5;

/** Where an image sits in the atlas, in 1x pixels. Multiply every number but
 *  `page` by the scale to address the same image in a 2x or 4x page. */
export interface AtlasRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A packed image placed inside a frame: `dx`/`dy` is its offset from the
 *  frame's top-left (transparent borders are trimmed before packing). */
export interface Placed {
  rect: AtlasRect;
  dx: number;
  dy: number;
}

/** One composed layer: drawn over its frame with ordinary source-over
 *  blending at the layer's own offset. Every layer pixel is either opaque or
 *  lands on a transparent pixel, so the blend reproduces the web's bake. */
export type LayerRef = Placed | null;

/** A run of layers indexed by an engine number (occupants, fill steps). To
 *  show input `n`, draw the base frame then layers `1..min(n, max)` in order;
 *  a `null` entry draws nothing. `steps[0]` is always null (the base). */
export interface LayerChain {
  input: string;
  max: number;
  steps: LayerRef[];
}

export interface FrameRecord {
  /** Frame size in 1x pixels (the full rectangle, trimming undone). */
  w: number;
  h: number;
  /** The pixel that sits on the frame's grid origin (see docs/atlas.md). */
  anchor: { x: number; y: number };
  /** The packed pieces. One piece normally; a frame wider than a page is cut
   *  into column slices laid side by side at their `dx`. Empty when the frame
   *  is fully transparent. */
  parts: Placed[];
  /** Structured keys (kind, state, subtype, lit, ...), the same values the
   *  frame name spells, so nobody has to parse names. */
  keys: Record<string, string | number | boolean>;
  /** Composed layers that ride on this frame, by input name. */
  chains?: Record<string, LayerChain>;
  /** Named single overlays (the dead-parking mark, a parked car color). */
  overlays?: Record<string, LayerRef>;
}

export interface AnimationRecord {
  /** Frame names in play order. */
  frames: string[];
  /** Seconds each frame holds. */
  dt: number;
  /** True when the last frame flows back into the first. */
  loop: boolean;
  keys: Record<string, string | number | boolean>;
}

export interface AtlasManifest {
  schema: number;
  game: { version: string; commit: string };
  license: { name: string; url: string; attribution: string };
  tile: { w: number; h: number };
  scales: number[];
  pageSize: number;
  padding: number;
  pages: { index: number; files: Record<string, { color: string; normal: string }> }[];
  /** Which inputs of the web's re-bake signature are baked into frames, which
   *  are composed at runtime, and which are animated or sampled. */
  signature: {
    baked: string[];
    composed: string[];
    animated: string[];
    sampled: string[];
    rules: Record<string, string>;
  };
  variants: Record<string, { floor: number; x: number; id: number }[]>;
  frames: Record<string, FrameRecord>;
  animations: Record<string, AnimationRecord>;
  data: Record<string, unknown>;
}
