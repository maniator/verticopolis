import { checkEvent } from "./engine/gameplayCatalog";
import { GAMEPLAY_EVENT_RULES } from "./engine/gameplayEventRules";
import type { GameplayEvent } from "./engine/gameplayEvents";
import { RateLimiter } from "./analyticsRateLimit";
import { gameplaySession } from "./analyticsSession";
import { trackEconomyActionOnce, trackEmergencyChoice } from "./analyticsActions";

/**
 * The analytics engine bridge (#873 phase 2): the one place the game's gameplay
 * analytics come from. The engine (Rust under the WASM host, TypeScript
 * otherwise) emits the catalog's events (`conformance/events/catalog.json`)
 * into a drain buffer; the frame loop hands the bridge the live tower once per
 * frame, and the session hands it over once more before it reports or opens a
 * new window. The bridge drains, checks, and folds:
 *
 * - Every drained event is checked against the catalog's rules and fails
 *   closed: an event the catalog does not describe is dropped and counted,
 *   never folded and never thrown into the frame loop.
 * - The folds are the platform's (`GameplaySession` and the action trackers),
 *   and they keep today's wire names. What reaches the provider is only what
 *   the folds send, and the folds' per-occurrence sends pass a rate limit
 *   first. Counting is never limited: a fold counts every action, including a
 *   build the player then undid.
 * - The title backdrop's buffer (`discardOnHandOff`) is drained and thrown
 *   away, so the backdrop's founding is never a new game. So is whatever the
 *   engine still holds when a measurement window closes: that play belongs to
 *   the closing window, which is discarded unsent.
 * - A batch can span two towers: a swap hands the replaced tower's undrained
 *   events on ahead of the new tower's own, so the folds read the batch in
 *   order and only a `tower_founded` re-opens the per-tower funnel.
 *
 * Nothing here reads the sim beyond the drain, and nothing names a vendor:
 * `trackEvent` stays the only send choke point.
 */

/** What the bridge drains: the live `Simulation` (whose drain the WASM host
 *  overrides to answer with its engine's batch). */
export interface GameplayEventSource {
  drainGameplayEvents(): GameplayEvent[];
  readonly gameplayEventsDropped: number;
  readonly gameplayEvents: { readonly discardOnHandOff: boolean };
}

/** Per-occurrence sends allowed per wire event per minute. A player founds a
 *  tower, climbs a star or answers an emergency a handful of times an hour, so
 *  this only ever bites on a runaway loop. */
export const BRIDGE_SEND_LIMIT = 20;
const BRIDGE_SEND_WINDOW_MS = 60_000;

/** A clock that never steps back (a wall-clock correction would otherwise hold
 *  a full rate-limit window shut until the clock caught up). */
const monotonicNow = (): number => (globalThis.performance ? performance.now() : Date.now());

/** What the bridge has dropped this page life, for diagnostics and tests. */
export interface EngineBridgeStats {
  /** Events the catalog does not describe, dropped unread. */
  rejected: number;
  /** Per-occurrence sends the rate limit held back (the folds still counted). */
  rateLimited: number;
  /** Drains that threw or returned no batch (an engine that can no longer
   *  answer); nothing folded. */
  drainFailures: number;
  /** Checked events whose fold threw; the rest of the batch still folded. */
  foldFailures: number;
  /** Events thrown away unread: the title backdrop's, and a closing window's. */
  discarded: number;
  /** The LIVE tower's ring overflow count as of its last drain (a swap hands
   *  the replaced tower's count on with its events). */
  engineDropped: number;
}

const freshStats = (): EngineBridgeStats => ({ rejected: 0, rateLimited: 0, drainFailures: 0, foldFailures: 0, discarded: 0, engineDropped: 0 });
/** Each kind of drop warns on the console once per page life, so a stream that
 *  goes dark (an engine that started adding a field every event now fails)
 *  shows up in a console without flooding it. */
const warned = new Set<string>();
function warnOnce(kind: string, detail: unknown): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  console.warn(`[analytics bridge] ${kind}`, detail);
}
let stats = freshStats();
let limiter = new RateLimiter(BRIDGE_SEND_LIMIT, BRIDGE_SEND_WINDOW_MS, 16);

/** The bridge's drop counters (a copy). */
export function engineBridgeStats(): EngineBridgeStats {
  return { ...stats };
}

/** Whether a per-occurrence send under `name` may go now. */
function allowSend(name: string, now: number): boolean {
  if (limiter.allow(name, now)) return true;
  stats.rateLimited++;
  return false;
}

/** Fold one checked event into the platform's analytics. */
function fold(event: GameplayEvent, now: number): void {
  switch (event.name) {
    case "tower_founded":
      // A founding the rate limit holds back closes the funnel, so no
      // first_build is sent without its own new_game_started ahead of it,
      // and the new tower's first build is never credited to the tower
      // before it.
      if (allowSend("new_game_started", now)) gameplaySession.noteNewGame(event.payload.mode);
      else gameplaySession.noteNewGameUnreported();
      return;
    case "facility_placed":
      gameplaySession.noteBuild(event.payload.kind, event.payload.floor, event.payload.count);
      return;
    case "star_reached":
      if (allowSend("star_reached", now)) gameplaySession.noteStar(event.payload.star);
      return;
    case "fire_started":
      gameplaySession.noteEmergency("fires");
      return;
    case "fire_gutted":
      gameplaySession.noteEmergency("gutRooms", event.payload.rooms);
      return;
    case "bomb_detonated":
      gameplaySession.noteEmergency("bombs");
      return;
    case "emergency_resolved":
      // A timed-out auto-decline is the absence of a choice, and reports nothing.
      if (event.payload.source === "player" && allowSend("emergency_choice", now)) {
        trackEmergencyChoice(event.payload.kind, event.payload.decision);
      }
      return;
    case "pricing_changed":
      trackEconomyActionOnce("price_tune");
      return;
    case "capacity_changed":
      trackEconomyActionOnce("capacity_tune");
      return;
    case "facility_removed": // demolish stays on the shell until the bulldozer removes through the engine (#901, #928)
    case "milestone_reached": // reaches the wire in migration step 3
      return;
    default: {
      // A catalog event with no case here fails the typecheck.
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** Check and fold a drained batch, in order. Never throws. */
export function forwardGameplayEvents(batch: readonly unknown[], now = monotonicNow()): void {
  for (const event of batch) {
    try {
      checkEvent(GAMEPLAY_EVENT_RULES, event);
    } catch (err) {
      stats.rejected++;
      warnOnce("rejected an event outside the catalog", err);
      continue;
    }
    try {
      fold(event as GameplayEvent, now);
    } catch (err) {
      // A fold is analytics and must never break the frame; the sends below it
      // are already never-throw, so this guards only a future fold's own bug.
      stats.foldFailures++;
      warnOnce("a fold threw", err);
    }
  }
}

/** Drain `source`: the events and their batch, or null when the drain threw
 *  or answered with something other than a batch (counted). */
function drain(source: GameplayEventSource): unknown[] | null {
  let batch: unknown;
  try {
    batch = source.drainGameplayEvents();
  } catch (err) {
    stats.drainFailures++;
    warnOnce("a drain threw", err);
    return null;
  }
  try {
    const dropped = source.gameplayEventsDropped;
    if (dropped > stats.engineDropped) warnOnce("the engine's event ring overflowed", dropped);
    stats.engineDropped = dropped;
  } catch {
    // An engine that answered the drain and then trapped: keep the batch.
  }
  if (!Array.isArray(batch)) {
    stats.drainFailures++;
    warnOnce("a drain returned no batch", batch);
    return null;
  }
  return batch;
}

/** Drain `source` and fold its batch. A title backdrop's events are drained
 *  and dropped; a drain that fails folds nothing and is counted. Never
 *  throws: the frame loop calls it every frame. */
export function drainEngineEvents(source: GameplayEventSource | undefined, now = monotonicNow()): void {
  if (!source) return;
  const batch = drain(source);
  if (!batch) return;
  if (source.gameplayEvents?.discardOnHandOff) {
    stats.discarded += batch.length;
    return;
  }
  forwardGameplayEvents(batch, now);
}

/** Bind the bridge to the live tower, so the session can fold the engine's
 *  last events before it reports (page hide), and drop them unsent when the
 *  window they belong to closes (`GameplaySession.startEpoch`, reached only
 *  from the session reset since #991). Called once at
 *  boot. */
export function bindEngineBridge(live: () => GameplayEventSource | undefined): void {
  gameplaySession.setEngineFlush((closing) => {
    if (!closing) {
      drainEngineEvents(live());
      return;
    }
    const source = live();
    const batch = source ? drain(source) : null;
    if (batch) stats.discarded += batch.length;
    // The new window starts with a full send budget, like its other latches.
    limiter = new RateLimiter(BRIDGE_SEND_LIMIT, BRIDGE_SEND_WINDOW_MS, 16);
  });
}

/** Test hook: zero the counters, the rate limit and the console latches. */
export function resetEngineBridge(): void {
  stats = freshStats();
  limiter = new RateLimiter(BRIDGE_SEND_LIMIT, BRIDGE_SEND_WINDOW_MS, 16);
  warned.clear();
}
