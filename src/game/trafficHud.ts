import type { GameApp } from "../main";
import { trafficTier, TRAFFIC_BOUNDS, TRAFFIC_LABELS, trafficLevel } from "../presentation/traffic";
import { floorLabel } from "../ui/floorLabel";
import { noteFrameError } from "./frameErrors";
import { trackAppAction } from "../analytics";
import { spotlightTraffic, type SpotShaft } from "../render/excalibur/trafficSpotlight";
import { TILE } from "../render/scale";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "../shared/viewZoom";

/**
 * The color-blind-safe traffic HUD, split out of the `GameApp` class. It asks
 * the engine port for the tower's peak hotspot on every UI tick and draws the
 * answer, reaching the engine through `app` (never captured), so an `adoptSim`
 * swap stays visible. The port answers at once, so every answer is drawn in
 * the order it was asked and the tier's hysteresis steps from one to the next.
 */

/** Color-blind-safe traffic cue: word + a four-bar meter (never color
 *  alone), driven by the tower's PEAK per-floor congestion, its busiest
 *  populated-and-served floor, so it matches the congestion overlay legend and
 *  moves as real congestion develops. Boundary hysteresis stops flicker; above
 *  Smooth it also names the worst floor (e.g. "Backed up · 42F") so the player
 *  knows *where* to look.
 *
 *  The frame loop's refresh: a failed answer or draw skips this refresh, as a
 *  thrown frame skips its frame, and goes to the throttled frame error log, so
 *  the call never throws and a failure that repeats at ~6 Hz cannot flood
 *  the error tracking. */
export function updateTraffic(app: GameApp): void {
  try {
    refreshTraffic(app);
  } catch (e) {
    noteFrameError(app, e, "traffic");
  }
}

/** Ask once and draw the answer. Throws when the answer or the draw fails. The
 *  screenshot tooling calls it (`GameApp.refreshTraffic`), so a failure stops
 *  the capture. */
export function refreshTraffic(app: GameApp): void {
  // One pass over the spatial map: the ratio drives the tier, the floor
  // names the hotspot, asked together so this ~6 Hz loop doesn't rebuild the
  // map twice per refresh on a large tower.
  const rec = app.enginePort.hotspot();
  const floor = app.portCodes.slot(rec, "hotspot", "floor");
  drawTraffic(app, { ratio: app.portCodes.slot(rec, "hotspot", "ratio"), floor: Number.isNaN(floor) ? null : floor });
}

function drawTraffic(app: GameApp, { ratio: cong, floor: hotspot }: { ratio: number; floor: number | null }): void {
  const B: readonly number[] = TRAFFIC_BOUNDS; // single source shared with trafficTier(), can't desync
  const raw = trafficTier(cong);
  if (raw > app.lastTrafficTier && cong >= B[app.lastTrafficTier] + 0.03) app.lastTrafficTier = raw;
  else if (raw < app.lastTrafficTier && cong <= B[app.lastTrafficTier - 1] - 0.03) app.lastTrafficTier = raw;
  const tier = app.lastTrafficTier;
  const word = TRAFFIC_LABELS[tier];
  // Above Smooth, surface the hotspot floor (something the 1994 original could
  // never do). The engine hands us the floor number (null = no hotspot); we
  // format the label below. The hotspot can be the ground lobby (floor 1) or a
  // basement venue, so the label handles every floor sign, not just above ground.
  const floor = tier > 0 ? hotspot : null;
  // The floor rides its own span (styled as a de-emphasized footnote) so a long
  // "Backed up · 100F" never competes with the tier word or wraps the fixed HUD
  // cell to a second line. The separator lives inside the suffix so Smooth shows
  // no orphan "· ". The full sentence still goes to aria-label for readers.
  // Above ground the HUD keeps its own "NF" footnote form (the lobby is "1F").
  // A basement hotspot uses the game's "B1"/"B2" grammar (never "0F"/"-1F"), the
  // same basement labels the ruler and `floorLabel` use.
  let tag = "";
  if (floor !== null) tag = floor >= 1 ? `${floor}F` : floorLabel(floor);
  const floorText = floor !== null ? ` · ${tag}` : "";
  // aria keeps the spoken "worst on floor N" phrasing (no trailing "F"), and the
  // "B1"/"B2" grammar for a basement, so a screen reader announces the same
  // floor identity the visible tag shows.
  const aria = floor !== null ? `Traffic: ${word}, worst on floor ${floorLabel(floor)}` : `Traffic: ${word}`;
  const glyphEl = document.getElementById("traffic-glyph");
  const labelEl = document.getElementById("traffic-label");
  const floorEl = document.getElementById("traffic-floor");
  const wrapEl = document.getElementById("traffic");
  const level = trafficLevel(tier);
  if (glyphEl && glyphEl.dataset.level !== level) glyphEl.dataset.level = level;
  const labelChanged = labelEl != null && labelEl.textContent !== word;
  const floorChanged = floorEl != null && floorEl.textContent !== floorText;
  if (labelChanged) labelEl!.textContent = word;
  if (floorChanged) floorEl!.textContent = floorText;
  if (labelChanged || floorChanged) {
    wrapEl?.setAttribute("aria-label", aria);
    wrapEl?.classList.toggle("traffic-warn", tier >= 2); // red is a redundant cue, not the only one
  }
}

/** The readout as a control: above Smooth, a click, a tap, Enter or Space on
 *  it brings the tower to the floor it names and lights up what backs it up
 *  ({@link jumpToTraffic}). Wired once at boot. */
export function wireTrafficJump(app: GameApp): void {
  const el = document.getElementById("traffic");
  if (!el) return;
  el.addEventListener("click", () => jumpToTraffic(app));
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    jumpToTraffic(app);
  });
}

/** Center the camera on the floor the readout names, across the transports
 *  behind its reading (`congestionCause`), zoomed in on them ({@link jumpFrame}),
 *  and put the spotlight on them. Does nothing while the readout says Smooth, since it names no floor then.
 *  Reports `app_action` `traffic_jump` with the cause found: `shafts` or
 *  `none`. Answers whether the camera moved. */
export function jumpToTraffic(app: GameApp): boolean {
  if (app.lastTrafficTier === 0) return false;
  const floor = app.portCodes.slot(app.enginePort.hotspot(), "hotspot", "floor");
  if (Number.isNaN(floor)) return false;
  const shafts: SpotShaft[] = [];
  for (const id of app.enginePort.congestionCause(floor)) {
    const t = app.engine.sim.tower.getTransport(id);
    if (t) shafts.push(t);
  }
  const frame = jumpFrame(shafts, app.engine.viewState().tile, app.engine.viewWidth);
  // A view's floor is the camera's center; a floor's row sits half a floor
  // below its number's line.
  app.engine.applyView({ tile: frame.tile, floor: floor - 0.5, zoom: frame.zoom });
  spotlightTraffic(app.engine, floor, shafts);
  trackAppAction("traffic_jump", shafts.length > 0 ? "shafts" : "none");
  return true;
}

/** How close the jump comes in: a floor is then 90 pixels tall, near enough
 *  to see the people waiting at the landings. */
export const JUMP_ZOOM = 2;
/** Tiles of tower kept beside the outermost transport behind the reading. */
const JUMP_MARGIN_TILES = 8;

/** Where the jump puts the camera across the lot, and how close: centered on
 *  the transports behind the reading (`tile` when there are none), zoomed in
 *  to {@link JUMP_ZOOM} or as far as still shows all of them across a view
 *  `viewWidth` pixels wide. */
export function jumpFrame(shafts: readonly SpotShaft[], tile: number, viewWidth: number): { tile: number; zoom: number } {
  if (shafts.length === 0) return { tile, zoom: JUMP_ZOOM };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of shafts) {
    lo = Math.min(lo, t.x);
    hi = Math.max(hi, t.x + t.width);
  }
  const fit = viewWidth / ((hi - lo + 2 * JUMP_MARGIN_TILES) * TILE);
  const zoom = Math.max(VIEW_ZOOM_MIN, Math.min(JUMP_ZOOM, VIEW_ZOOM_MAX, fit));
  return { tile: (lo + hi) / 2, zoom };
}
