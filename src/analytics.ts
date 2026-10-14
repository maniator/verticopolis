import { telemetryHostAllowed } from "./telemetry";
import { gameplaySession } from "./analyticsSession";

/**
 * Gameplay analytics: the module's public surface plus the boot wiring. The
 * per-tab `GameplaySession` that tracks the funnel and engagement events lives in
 * `analyticsSession.ts` (split out at the 500-line file guard), the event
 * vocabulary and the send choke point in `analyticsCore.ts`, and the free
 * per-action trackers in `analyticsActions.ts`. This module re-exports all three
 * so callers keep importing from `./analytics`.
 *
 * Page views and Core Web Vitals answer "who showed up and was it fast"; these
 * answer the questions the raw feed can't: a first-tower funnel
 * (`new_game_started` then `first_build`), which tools players reach for, how far
 * they climb the star ladder, and how long a session runs. The vocabulary is deliberately
 * low-volume: `tool_used` dedupes to one fire per distinct tool, `first_build`
 * to one per tower, and the session-summary events fire once per tab.
 */

// Re-export the vocabulary, common props, and the free trackers so `./analytics`
// stays the one import site every caller already uses.
export {
  setCommonProps,
  getCommonProps,
  type GameplayEvents,
  type AppActionName,
  type EconomyActionName,
  type EmergencyKind,
  type EmergencyDecision,
} from "./analyticsCore";
// The session instance, re-exported so `./analytics` stays its import site even
// though the class now lives next door.
export { gameplaySession } from "./analyticsSession";
export {
  trackAppAction,
  trackAppActionOnce,
  trackEconomyAction,
  trackEconomyActionOnce,
  trackEmergencyChoice,
} from "./analyticsActions";

/**
 * Start the gameplay session at boot and keep its foreground clock in step with
 * the tab's visibility. Host-gated up front so no listeners are attached off a
 * real deployment (the events self-gate too, but this keeps localhost and the
 * e2e preview server free of stray handlers, matching the inject's gate).
 *
 * `visibilitychange` to `hidden` banks the segment and reports the running
 * length; returning to `visible` resumes the clock; `pagehide` banks the final
 * segment on a genuine navigation away (the signal `visibilitychange` may miss
 * on some unloads). Because hidden banks rather than latches, a player who tabs
 * away and back is one continuous session whose reported length grows, and
 * hidden time in between is not counted.
 */
export function startGameplaySession(): void {
  if (!telemetryHostAllowed()) return;
  // Idempotent: wire the listeners at most once, so a repeat call (a future
  // refactor, a double boot) can't attach a second pair and double-count
  // session_end.
  if (!gameplaySession.arm()) return;
  // Only start the clock if the page is actually visible. A background-tab or
  // prerender open begins hidden; timing then starts when it first becomes
  // visible below, so hidden time is never counted as foreground play.
  if (document.visibilityState === "visible") gameplaySession.begin();
  // `pagehide` is the terminal signal (tab close / navigation / bfcache), so it
  // ends the session as FINAL: this is where session_emergencies emits, having
  // waited past mid-session tab switches (see GameplaySession.end).
  window.addEventListener("pagehide", () => gameplaySession.end(true));
  document.addEventListener("visibilitychange", () => {
    // Bank on hidden, (re)start on visible, ignore other states (e.g. prerender).
    // A hide is NOT final (the player may tab back), so session_emergencies waits.
    if (document.visibilityState === "hidden") gameplaySession.end(false);
    else if (document.visibilityState === "visible") gameplaySession.begin();
  });
}
