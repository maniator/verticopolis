import { telemetryHostAllowed } from "./telemetry";
import { onDesktopConsentChange } from "./desktopConsent";
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
 * Start a fresh measurement window whenever the desktop consent answer changes.
 *
 * Wired here, on the module's wiring side rather than at the two consent
 * surfaces: `setDesktopConsent` is the single place the answer is ever written, so
 * hanging the reset off that is one hook a future third surface cannot forget to
 * call. (`armSessionOnGrant` in `uiDesktopAnalytics.ts` is where the two surfaces
 * share their grant work, but it is a helper each of them opts into, and it never
 * runs on the way OFF.) The callback travels outward because `desktopConsent.ts`
 * sits BELOW analytics and importing analytics back would close a cycle through
 * `telemetry.ts`.
 *
 * Turning sharing OFF drops the window rather than emitting a farewell summary of
 * the play up to that instant, which is a deliberate choice between two defensible
 * ones. A player who turns the switch off expects the switch to stop traffic; a
 * summary sent BY the act of turning it off is traffic caused by opting out, and
 * it would also be a timestamped marker of the decision, which is the one thing
 * these surfaces go out of their way never to report (see the note at the top of
 * `uiDesktopAnalytics.ts`). The cost is small: the summaries are once-per-session
 * lower bounds by design, so a dropped partial window reads one session shallower
 * rather than losing a measurement anyone could otherwise recover.
 *
 * A browser build never writes the consent value at all (both surfaces are behind
 * `IS_DESKTOP_BUILD`), so this never fires there and the web session behaves
 * exactly as it did before any of this landed.
 */
onDesktopConsentChange((previous, next) => {
  gameplaySession.startEpoch();
  // The crash throttle is a flood guard, not a measurement, so it does not simply
  // follow the window. A slot should stay spent only if the crash that spent it
  // actually went out, and exactly ONE transition can say yes: a first-run grant,
  // where the watchers run just ahead of the held queue draining. Every other
  // answer either drops that queue (`pending` to `declined`) or never had one
  // (`declined` to `granted`, `granted` to `declined`), so the slots those crashes
  // spent bought nothing and are handed back.
  //
  // Getting this wrong is not cosmetic in either direction: releasing on the grant
  // re-sends a crash that just flushed, and keeping on the others lets a crash loop
  // during an opted-out stretch spend the whole cap on events that were dropped and
  // leave the player's next window unable to report anything at all.
  const heldCrashesAreAboutToFlush = previous === "pending" && next === "granted";
  if (!heldCrashesAreAboutToFlush) gameplaySession.releaseCrashThrottle();
});

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
