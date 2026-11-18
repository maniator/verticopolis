import type { GameApp } from "../main";
import { linePressure, nextTrafficTier, TRAFFIC_LABELS, trafficLevel, worstLine, type LandingLines, type WaitingLine } from "../presentation/traffic";
import { floorLabel } from "../ui/floorLabel";
import { noteFrameError } from "./frameErrors";
import { trackAppAction } from "../analytics";
import { spotlightTraffic, type SpotSpan } from "../render/excalibur/trafficSpotlight";
import type { TransportView } from "../simport/view";
import type { PortRecord } from "../simport/enginePort";
import { TILE } from "../render/scale";
import { VIEW_ZOOM_MAX, VIEW_ZOOM_MIN } from "../shared/viewZoom";

/**
 * The color-blind-safe traffic HUD, split out of the `GameApp` class. On every
 * UI tick it reads the elevator lines the renderer draws (the engine's
 * `queueView`, kept per crowd step) and draws the worst one, reaching the
 * renderer's view through `app` (never captured), so an `adoptSim` swap stays
 * visible. Every read is drawn in the order it was made, and the tier's
 * hysteresis steps from one to the next.
 */

/** Color-blind-safe traffic cue: word + a four-bar meter (never color
 *  alone), driven by the tower's worst waiting line right now
 *  (`worstLine`), so a red readout is always a crowd the player can find on
 *  screen. Boundary hysteresis stops flicker; above Smooth it also names the
 *  line's floor (e.g. "Backed up · B4") so the player knows *where* to look.
 *
 *  The frame loop's refresh: a failed read or draw skips this refresh, as a
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

/** Read the lines once and draw the worst. Throws when the read or the draw
 *  fails. The screenshot tooling calls it (`GameApp.refreshTraffic`), so a
 *  failure stops the capture. */
export function refreshTraffic(app: GameApp): void {
  drawTraffic(app, currentWorstLine(app));
}

/** The worst line of each queue projection read, so the ~6 Hz refresh walks
 *  a step's landings once: the projection is kept per crowd step and tower
 *  revision (`PortRenderSim.queueView`), so a new step is a new key. */
const worstOf = new WeakMap<LandingLines, WaitingLine | null>();

/** The tower's worst waiting line now, from the renderer's queue projection. */
function currentWorstLine(app: GameApp): WaitingLine | null {
  const sim = app.engine.sim;
  const { landings } = sim.crowd.queueView(sim.tower);
  let line = worstOf.get(landings);
  if (line === undefined) {
    line = worstLine(landings);
    worstOf.set(landings, line);
  }
  return line;
}

function drawTraffic(app: GameApp, line: WaitingLine | null): void {
  const tier = (app.lastTrafficTier = nextTrafficTier(app.lastTrafficTier, line ? linePressure(line) : 0));
  const word = TRAFFIC_LABELS[tier];
  // Above Smooth, name the worst line's floor (something the 1994 original
  // could never do). The line can be at the ground lobby (floor 1) or in a
  // basement, so the label handles every floor sign, not just above ground.
  const floor = tier > 0 && line ? line.floor : null;
  // The floor rides its own span (styled as a de-emphasized footnote) so a long
  // "Backed up · 100F" never competes with the tier word or wraps the fixed HUD
  // cell to a second line. The separator lives inside the suffix so Smooth shows
  // no orphan "· ". The full sentence still goes to aria-label for readers.
  // Above ground the HUD keeps its own "NF" footnote form (the lobby is "1F").
  // A basement line uses the game's "B1"/"B2" grammar (never "0F"/"-1F"), the
  // same basement labels the ruler and `floorLabel` use.
  let tag = "";
  if (floor !== null) tag = floor >= 1 ? `${floor}F` : floorLabel(floor);
  const floorText = floor !== null ? ` · ${tag}` : "";
  // aria keeps the spoken "worst line on floor N" phrasing (no trailing "F"),
  // and the "B1"/"B2" grammar for a basement, so a screen reader announces the
  // same floor identity the visible tag shows.
  const aria = floor !== null ? `Traffic: ${word}, worst line on floor ${floorLabel(floor)}` : `Traffic: ${word}`;
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
 *  it brings the tower to the waiting line it names and lights it up
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

/** Zoom in on the worst waiting line the readout names: the camera centers on
 *  the line and its elevator on that floor ({@link lineSpan},
 *  {@link jumpFrame}), and the spotlight marks that one landing, not the whole
 *  floor or the whole shaft. Does nothing while the readout says Smooth, or
 *  when the line has emptied since. Reports `app_action` `traffic_jump` with
 *  the readout's level (`busy`, `backed-up` or `gridlock`). Answers whether
 *  the camera moved. */
export function jumpToTraffic(app: GameApp): boolean {
  const tier = app.lastTrafficTier;
  if (tier === 0) return false;
  const line = currentWorstLine(app);
  if (!line) return false;
  const shaft = app.engine.sim.tower.getTransport(line.shaft);
  if (!shaft) return false;
  // The projection is the step's start; the line may have boarded since.
  // An empty stretch now means nobody is left to show, so the tap does nothing.
  const stretch = app.enginePort.queueLine(line.shaft, line.floor);
  if (stretch.length < 2) return false;
  const span = lineSpan(shaft, stretch);
  const frame = jumpFrame(span, app.engine.viewWidth);
  // A view's floor is the camera's center; a floor's row sits half a floor
  // below its number's line.
  app.engine.applyView({ tile: frame.tile, floor: line.floor - 0.5, zoom: frame.zoom });
  spotlightTraffic(app.engine, line.floor, span, { x: shaft.x, width: shaft.width });
  trackAppAction("traffic_jump", trafficLevel(tier));
  return true;
}

/** How close the jump comes in: a floor is then 90 pixels tall, near enough
 *  to see the people waiting at the landing. */
export const JUMP_ZOOM = 2;
/** Tiles of tower kept beside the line on each side. */
const JUMP_MARGIN_TILES = 4;
/** The stretch of the floor the waiting line at `shaft` takes up: the shaft
 *  itself and the stretch the engine says its line covers (`queueLine`, from
 *  the shaft face to the rider standing farthest from it, a tile added for
 *  that rider).
 *  The engine lines riders up beside the shaft and across any shaft next to
 *  it, so only its answer tells one line in a bank from the next. An empty
 *  answer (the line emptied since) leaves the shaft alone. */
export function lineSpan(shaft: Pick<TransportView, "x" | "width">, stretch: PortRecord): SpotSpan {
  let lo = shaft.x;
  let hi = shaft.x + shaft.width;
  if (stretch.length >= 2) {
    lo = Math.min(lo, Math.floor(stretch[0]));
    hi = Math.max(hi, Math.ceil(stretch[1]) + 1);
  }
  return { x: lo, width: hi - lo };
}

/** Where the jump puts the camera across the lot, and how close: centered on
 *  the line's span, zoomed in to {@link JUMP_ZOOM} or as far as still shows
 *  all of it across a view `viewWidth` pixels wide. */
export function jumpFrame(span: SpotSpan, viewWidth: number): { tile: number; zoom: number } {
  const fit = viewWidth / ((span.width + 2 * JUMP_MARGIN_TILES) * TILE);
  const zoom = Math.max(VIEW_ZOOM_MIN, Math.min(JUMP_ZOOM, VIEW_ZOOM_MAX, fit));
  return { tile: span.x + span.width / 2, zoom };
}
