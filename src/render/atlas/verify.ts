import { FACILITIES, facilityFloors } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
import { paintAnimatedUnit, paintSettledUnit } from "../regionPaint";
import { FLOOR, TILE } from "../scale";
import { bake, type Renderer } from "./bake";
import { ORIGIN_SEEDED, variantPlacements, type Job } from "./catalog";
import { compareImages, composeLookup } from "./compose";
import { lookupRoom, type LiveScene } from "./lookup";
import type { Image } from "./pixels";
import type { Sample } from "./samples";

/**
 * The comparison the e2e spec and the export's pre-flight run in a real
 * browser. For a live room signature it composes the atlas frame and its
 * layers the way a frontend would ({@link lookupRoom}, `compose.ts`) and paints
 * the same room through the game's own paint functions (`regionPaint.ts`, the
 * ones `towerRegions` and `towerReconcile` call) with the scene the game
 * threads through its `DrawCtx`. The two must match pixel for pixel.
 *
 * Settled rooms are painted at two different offsets inside a larger region
 * canvas, so any art that depends on where its region starts fails here.
 * The kinds known to do that ({@link ORIGIN_SEEDED}) are compared at the
 * per-unit origin, which is the look the atlas carries.
 */

export interface SampleResult {
  label: string;
  frame: string;
  pixels: number;
  mismatches: number;
  /** Where in the region the room was painted for this comparison. */
  offset: { x: number; y: number };
  /** A control compares two different pictures on purpose and must report
   *  a mismatch; one that does not means the comparison itself is broken. */
  control?: boolean;
  box?: { x0: number; y0: number; x1: number; y1: number };
}

/** Region offsets a settled room is checked at: one a multiple of 8 px across
 *  and one not, so art hashing its draw position cannot pass by luck. */
const REGION_OFFSETS = [
  { x: 4 * TILE, y: FLOOR },
  { x: 7 * TILE, y: 2 * FLOOR },
];

function region(doc: Document, w: number, h: number): CanvasRenderingContext2D {
  const canvas = doc.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** The game's paint of `unit`: inside a region with the room at `at`, or into
 *  its own canvas when `at` is null. */
function webPaint(doc: Document, unit: Unit, s: LiveScene, anim: number, at: { x: number; y: number } | null): Image {
  const w = unit.width * TILE;
  const h = facilityFloors(unit.kind) * FLOOR;
  const ox = at?.x ?? 0;
  const oy = at?.y ?? 0;
  const ctx = region(doc, w + 2 * ox, h + 2 * oy);
  const d = { ctx, lit: s.lit, anim, hour: s.hour, parkingUse: s.parkingUse, recycleFill: s.recycleFill };
  if (at) paintSettledUnit(d, unit, ox, oy, w, h, unit.kind === "parking" && s.dead);
  else if (unit.state === "fire" || unit.state === "construction") paintAnimatedUnit(d, unit, w, h);
  else paintSettledUnit(d, unit, 0, 0, w, h, unit.kind === "parking" && s.dead);
  return { w, h, data: ctx.getImageData(ox, oy, w, h).data };
}

export function verifySample(doc: Document, jobs: readonly Job[], renderer: Renderer, sample: Sample): SampleResult[] {
  const pl = variantPlacements(sample.unit.kind)[sample.variant];
  const unit: Unit = {
    ...sample.unit,
    floor: pl.floor,
    x: pl.x,
    // Only the garage reads the id outside the sampled seeds (car color and
    // presence), so the sample keeps its own id there.
    id: sample.unit.kind === "parking" ? sample.unit.id : pl.id,
    width: FACILITIES[sample.unit.kind].width,
    satisfaction: 1,
    everOccupied: true,
    pendingIncome: 0,
    label: "",
  };
  const found = lookupRoom(unit, sample.scene, sample.variant);
  const jobName = "animation" in found ? found.animation : found.frame;
  const job = jobs.find((j) => j.name === jobName);
  if (!job) throw new Error(`no job ${jobName}`);
  let anim = 0;
  if (job.type === "anim") {
    const spec = job.frames[sample.frame ?? 0];
    if (!spec || spec.p !== "unit") throw new Error(`no frame ${sample.frame} in ${jobName}`);
    anim = spec.anim;
  }
  const composed = composeLookup(bake([job], renderer), found, sample.frame ?? 0);
  const animated = unit.state === "fire" || unit.state === "construction";
  const offsets = animated || ORIGIN_SEEDED.has(unit.kind) ? [null] : REGION_OFFSETS;
  return offsets.map((at) => {
    const ref = webPaint(doc, unit, sample.scene, anim, at);
    const cmp = compareImages(ref, composed.image);
    return { label: sample.label, frame: composed.name, pixels: ref.w * ref.h, mismatches: cmp.mismatches, box: cmp.box, offset: at ?? { x: 0, y: 0 } };
  });
}
