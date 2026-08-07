import type { GameApp } from "../main";
import { trafficTier, TRAFFIC_BOUNDS, TRAFFIC_LABELS, trafficGlyph } from "../engine/traffic";
import { floorLabel } from "../ui/floorLabel";

/**
 * The color-blind-safe traffic HUD, split out of the `GameApp` class. Reads the
 * live sim through `app` (never captured), so an `adoptSim` swap stays visible.
 * Behavior unchanged from the former `GameApp.updateTraffic`.
 */

/** Color-blind-safe traffic cue: word + shape-coded bar glyph (never color
 *  alone), driven by the tower's PEAK per-floor congestion, its busiest
 *  populated-and-served floor, so it matches the congestion overlay legend and
 *  moves as real congestion develops. Boundary hysteresis stops flicker; above
 *  Smooth it also names the worst floor (e.g. "Backed up · 42F") so the player
 *  knows *where* to look. */
export function updateTraffic(app: GameApp): void {
  // One pass over the spatial map: the ratio drives the tier, the floor names
  // the hotspot, fetched together so this ~6 Hz loop doesn't rebuild the map
  // twice per frame on a large tower.
  const { ratio: cong, floor: hotspot } = app.sim.peakCongestionHotspot();
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
