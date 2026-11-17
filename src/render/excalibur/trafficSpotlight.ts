import { viewWorld } from "../../presentation/viewWorld";
import { FLOOR, TILE } from "../scale";
import type { TowerEngine } from "./TowerEngine";

/**
 * The Traffic readout's spotlight: after a tap on the HUD's "Backed up · B2",
 * the floor it names is banded across the lot and the transports behind its
 * reading (`congestionCause`) are outlined, for a few seconds. The state lives
 * here, keyed by engine, so `TowerEngine` stays a thin shell. Drawing it costs
 * nothing while no spotlight is up: one map lookup per frame.
 */

/** One transport's column, in tiles and floors. */
export interface SpotShaft {
  readonly x: number;
  readonly width: number;
  readonly bottom: number;
  readonly top: number;
}

interface Spot {
  readonly floor: number;
  readonly shafts: readonly SpotShaft[];
  readonly startMs: number;
}

const spots = new WeakMap<TowerEngine, Spot>();

/** How long the spotlight stays up, in page milliseconds. */
export const SPOTLIGHT_MS = 4000;
/** The last stretch of it, over which it fades out. */
const FADE_MS = 600;
/** Pulses per second while it is up (none under reduced motion). */
const PULSE_HZ = 1.5;
/** The floor band: the Map's Jammed red, so the two read as one signal. */
const BAND_FILL = "rgba(210, 60, 60, 0.18)";
const BAND_EDGE = "#d23c3c";
/** The transports' outline: the selection's yellow. */
const SHAFT_EDGE = "#ffd24a";

/** Put the spotlight on `floor` and `shafts`, replacing any still up. */
export function spotlightTraffic(engine: TowerEngine, floor: number, shafts: readonly SpotShaft[], nowMs = performance.now()): void {
  spots.set(engine, { floor, shafts, startMs: nowMs });
}

/** The floor the spotlight is on, or null when none is up. */
export function trafficSpotlightFloor(engine: TowerEngine): number | null {
  return spots.get(engine)?.floor ?? null;
}

/** How strongly the spotlight shows `ageMs` after it went up: a pulse
 *  between 0.6 and 1 (steady at 1 under reduced motion), faded out over its
 *  last {@link FADE_MS}; 0 once it is over. */
export function spotlightAlpha(ageMs: number, reducedMotion: boolean): number {
  if (ageMs < 0 || ageMs > SPOTLIGHT_MS) return 0;
  const pulse = reducedMotion ? 1 : 0.8 + 0.2 * Math.cos((ageMs / 1000) * 2 * Math.PI * PULSE_HZ);
  return pulse * Math.min(1, (SPOTLIGHT_MS - ageMs) / FADE_MS);
}

/** Paint the spotlight, if one is up, and drop it once it is over. */
export function drawTrafficSpotlight(engine: TowerEngine, ctx: CanvasRenderingContext2D, nowMs = performance.now()): void {
  const spot = spots.get(engine);
  if (!spot) return;
  const alpha = spotlightAlpha(nowMs - spot.startMs, engine.reducedMotion);
  if (alpha <= 0) {
    spots.delete(engine);
    return;
  }
  const z = engine.cam.zoom;
  const rowY = engine.worldToScreenY(spot.floor);
  const rowH = FLOOR * z;
  const left = engine.worldToScreenX(0);
  const width = viewWorld().lotWidth * TILE * z;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = BAND_FILL;
  ctx.fillRect(left, rowY, width, rowH);
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = BAND_EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(left + 1, rowY + 1, width - 2, rowH - 2);
  ctx.setLineDash([]);
  ctx.strokeStyle = SHAFT_EDGE;
  ctx.lineWidth = 3;
  for (const t of spot.shafts) {
    const top = engine.worldToScreenY(t.top);
    ctx.strokeRect(engine.worldToScreenX(t.x) - 2, top - 2, t.width * TILE * z + 4, (t.top - t.bottom + 1) * FLOOR * z + 4);
  }
  ctx.restore();
}
