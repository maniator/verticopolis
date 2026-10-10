import { FACILITIES, facilityFloors } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
import { FLOOR, TILE } from "../scale";
import { drawUnit } from "../sprites";
import { drawDeadParkingX } from "../sprites/facilities/garage";
import { bake, type BakeResult, type ImageRef } from "./bake";
import { ORIGIN_SEEDED, variantPlacements } from "./catalog";
import { lookupRoom, type LiveScene, type LiveUnit } from "./lookup";
import { blank, over, type Image } from "./pixels";
import type { Job } from "./catalog";
import type { Renderer } from "./bake";

/**
 * The comparison the e2e spec runs in a real browser: for a live room
 * signature, compose the atlas frame and its layers the way a frontend would
 * (via {@link lookupRoom}), and paint the same room the way the web game's
 * region compositor does (`excalibur/towerRegions.ts`: a shared canvas, the
 * room clipped at its offset, the live `DrawCtx`, the dead-parking mark). The
 * two must match pixel for pixel.
 */

export interface Sample {
  label: string;
  unit: LiveUnit;
  scene: LiveScene;
  variant: number;
  /** For fire and construction: which loop frame to compare. */
  frame?: number;
}

export interface SampleResult {
  label: string;
  frame: string;
  pixels: number;
  mismatches: number;
  /** Bounding box of the mismatched pixels, for a readable failure. */
  box?: { x0: number; y0: number; x1: number; y1: number };
}

/** Region-canvas offset of the room under test: non-zero so the clip and
 *  translation the web uses are part of what is compared. */
const REGION_DX = 4 * TILE;
const REGION_DY = FLOOR;


function placeRef(dst: Image, bakeResult: BakeResult, ref: ImageRef | null): void {
  if (ref) over(dst, bakeResult.images[ref.id], ref.dx, ref.dy);
}

/** The web's bake of `unit`: a settled room into a region-style canvas at an
 *  offset, clipped (`towerRegions`); a burning or unbuilt room into its own
 *  canvas at the origin (`towerReconcile.addRoom`). */
function webBake(doc: Document, unit: Unit, s: LiveScene, anim: number): Image {
  const w = unit.width * TILE;
  const h = facilityFloors(unit.kind) * FLOOR;
  const own = unit.state === "fire" || unit.state === "construction" || ORIGIN_SEEDED.has(unit.kind);
  const DX = own ? 0 : REGION_DX;
  const DY = own ? 0 : REGION_DY;
  const canvas = doc.createElement("canvas");
  canvas.width = w + 2 * DX;
  canvas.height = h + 2 * DY;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(DX, DY, w, h);
  ctx.clip();
  const dead = unit.kind === "parking" && s.dead;
  drawUnit({ ctx, lit: s.lit, anim, hour: s.hour, parkingUse: s.parkingUse, recycleFill: s.recycleFill, parkingDead: dead }, unit, DX, DY, w, h);
  if (dead) drawDeadParkingX(ctx, DX, DY, w, h);
  ctx.restore();
  return { w, h, data: ctx.getImageData(DX, DY, w, h).data };
}

export function verifySample(doc: Document, jobs: readonly Job[], renderer: Renderer, sample: Sample): SampleResult {
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
  let name: string;
  let anim = 0;
  if ("animation" in found) {
    const job = jobs.find((j) => j.name === found.animation);
    if (!job || job.type !== "anim") throw new Error(`no animation ${found.animation}`);
    const i = sample.frame ?? 0;
    name = `${found.animation}/${i}`;
    const spec = job.frames[i];
    if (!spec || spec.p !== "unit") throw new Error(`no frame ${i} in ${found.animation}`);
    anim = spec.anim;
  } else {
    name = found.frame;
  }
  const jobName = "animation" in found ? found.animation : found.frame;
  const r = bake(
    jobs.filter((j) => j.name === jobName),
    renderer,
  );
  const rec = r.frames.find((f) => f.name === name);
  if (!rec) throw new Error(`no frame ${name}`);
  const composed = blank(rec.w, rec.h);
  placeRef(composed, r, rec.image);
  if (!("animation" in found)) {
    for (const [key, n] of Object.entries(found.chains)) {
      const chain = rec.chains?.[key];
      if (!chain) throw new Error(`${name} has no chain ${key}`);
      for (let k = 1; k <= Math.min(n, chain.steps.length - 1); k++) placeRef(composed, r, chain.steps[k]);
    }
    for (const o of found.overlays) placeRef(composed, r, rec.overlays?.[o] ?? null);
  }
  const ref = webBake(doc, unit, sample.scene, anim);
  let mismatches = 0;
  let box: SampleResult["box"];
  for (let i = 0, p = 0; i < ref.data.length; i += 4, p++) {
    const a = ref.data;
    const b = composed.data;
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
    mismatches++;
    const x = p % ref.w;
    const y = (p - x) / ref.w;
    box ??= { x0: x, y0: y, x1: x, y1: y };
    box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
  }
  return { label: sample.label, frame: name, pixels: ref.w * ref.h, mismatches, box };
}
