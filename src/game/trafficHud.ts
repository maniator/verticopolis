import type { GameApp } from "../main";
import { trafficTier, TRAFFIC_BOUNDS, TRAFFIC_LABELS, trafficGlyph } from "../engine/traffic";
import { floorLabel } from "../ui/floorLabel";
import { inOrderPer } from "../simport/latest";
import type { CongestionHotspot } from "../simport/panels";
import { noteFrameError } from "./frameErrors";

/**
 * The color-blind-safe traffic HUD, split out of the `GameApp` class. It asks
 * the port for the tower's peak hotspot on every UI tick and draws the answer,
 * reaching the tower through `app` (never captured), so an `adoptSim` swap
 * stays visible. On `TsSim` the chip reads the same as under the former
 * synchronous `GameApp.updateTraffic`, drawn a microtask later in the same UI
 * tick; the one difference is that `adoptSim` restarts its hysteresis on
 * another tower.
 */

/** Each app's hotspot answers, never an older one drawn after a newer one: the
 *  tier's hysteresis steps from one answer to the next, so a port that answers
 *  in order (`TsSim`) has every answer drawn. An answer that lands after a
 *  newer question has settled (drawn, failed, or dropped as stale) is
 *  dropped. */
const hotspotAsks = inOrderPer<CongestionHotspot>();

/** Color-blind-safe traffic cue: word + shape-coded bar glyph (never color
 *  alone), driven by the tower's PEAK per-floor congestion, its busiest
 *  populated-and-served floor, so it matches the congestion overlay legend and
 *  moves as real congestion develops. Boundary hysteresis stops flicker; above
 *  Smooth it also names the worst floor (e.g. "Backed up · 42F") so the player
 *  knows *where* to look.
 *
 *  The frame loop's refresh: a failed answer or draw skips this refresh, as a
 *  thrown frame skips its frame, and goes to the throttled frame error log, so
 *  the promise never rejects and a failure that repeats at ~6 Hz cannot flood
 *  the error tracking. */
export async function updateTraffic(app: GameApp): Promise<void> {
  try {
    await refreshTraffic(app);
  } catch (e) {
    noteFrameError(app, e, "traffic");
  }
}

/** Ask once and draw the answer. Settles when the answer is drawn or dropped
 *  (overtaken, or about a tower replaced while it was out, failures included),
 *  and rejects when the answer or the draw fails for the current tower. The
 *  screenshot tooling awaits it (`GameApp.refreshTraffic`), so a failure stops
 *  the capture. */
export async function refreshTraffic(app: GameApp): Promise<void> {
  const asked = app.sim;
  try {
    // One pass over the spatial map: the ratio drives the tier, the floor
    // names the hotspot, asked together so this ~6 Hz loop doesn't rebuild the
    // map twice per refresh on a large tower.
    await hotspotAsks(app)(app.port.query({ op: "peakCongestionHotspot" }), (hot) => {
      // A load or a new tower while the answer was out: it describes the old one.
      if (app.sim === asked) drawTraffic(app, hot);
    });
  } catch (e) {
    if (app.sim === asked) throw e;
  }
}

function drawTraffic(app: GameApp, { ratio: cong, floor: hotspot }: CongestionHotspot): void {
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
  if (glyphEl && glyphEl.textContent !== trafficGlyph(tier)) glyphEl.textContent = trafficGlyph(tier);
  const labelChanged = labelEl != null && labelEl.textContent !== word;
  const floorChanged = floorEl != null && floorEl.textContent !== floorText;
  if (labelChanged) labelEl!.textContent = word;
  if (floorChanged) floorEl!.textContent = floorText;
  if (labelChanged || floorChanged) {
    wrapEl?.setAttribute("aria-label", aria);
    wrapEl?.classList.toggle("traffic-warn", tier >= 2); // red is a redundant cue, not the only one
  }
}
