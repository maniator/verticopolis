import {
  trackEvent,
  type AppActionName,
  type EconomyActionName,
  type EmergencyKind,
  type EmergencyDecision,
} from "./analyticsCore";

/**
 * The free, per-action event trackers: app-chrome (`app_action`), gameplay
 * economy (`economy_action`), and the emergency decision (`emergency_choice`).
 * Split out of `analytics.ts` so that file stays under the readable line ceiling.
 * Each is host-gated and never-throw via {@link trackEvent}. The once-per-session
 * latches live here; {@link clearActionLatches} lets the test-only session reset
 * clear them so tests stay isolated.
 */

/** Report one discrete app-chrome action (see the `app_action` event). A thin,
 *  free function (not a `GameplaySession` method) so it can be called from the
 *  UI, the save/persistence layer, and the standalone help/gallery pages alike.
 *  Host-gated and never-throw like every other event; `detail` is omitted when
 *  absent so the payload stays minimal. */
export function trackAppAction(action: AppActionName, detail?: string): void {
  trackEvent("app_action", detail === undefined ? { action } : { action, detail });
}

/** Actions already emitted this session by {@link trackAppActionOnce}, so a
 *  repeatable trigger (a dragged volume slider) reports at most once. It lives
 *  for the tab's lifetime, matching the per-tab analytics session (`reset` is a
 *  test-only helper, not called on a new game), so "once" means once per tab
 *  session. */
const appActionOnce = new Set<AppActionName>();

/** Report an app action AT MOST ONCE per session. For a coarse engagement bit
 *  (today `volume`) whose trigger can fire many times, so the count is "sessions
 *  that ever did X," not a firehose of every repeat. */
export function trackAppActionOnce(action: AppActionName, detail?: string): void {
  if (appActionOnce.has(action)) return;
  appActionOnce.add(action);
  trackAppAction(action, detail);
}

/** Report one gameplay economy action (see the `economy_action` event). A free
 *  function (not a `GameplaySession` method) so the build/editor money-boundary
 *  modules can call it directly. Host-gated and never-throw like every event;
 *  `detail` is omitted when absent so the payload stays minimal. */
export function trackEconomyAction(action: EconomyActionName, detail?: string): void {
  trackEvent("economy_action", detail === undefined ? { action } : { action, detail });
}

/** Economy actions already emitted this session by {@link trackEconomyActionOnce}
 *  (the latched `price_tune` / `capacity_tune` bits), so a repeatable gesture
 *  reports at most once. Per tab session, like {@link appActionOnce}. */
const economyActionOnce = new Set<EconomyActionName>();

/** Report an economy action AT MOST ONCE per session, for the tuning bits
 *  (`price_tune`, `capacity_tune`) whose gestures repeat: the signal is "did the
 *  player ever tune this", not a firehose of every increment. */
export function trackEconomyActionOnce(action: EconomyActionName, detail?: string): void {
  if (economyActionOnce.has(action)) return;
  economyActionOnce.add(action);
  trackEconomyAction(action, detail);
}

/** Report the player's answer to an emergency prompt (see `emergency_choice`).
 *  Called only from the choice callback (a real click), so a timed-out
 *  auto-decline never reaches here. Host-gated and never-throw. */
export function trackEmergencyChoice(kind: EmergencyKind, decision: EmergencyDecision): void {
  trackEvent("emergency_choice", { kind, decision });
}

/** Clear the once-per-session action latches, so the next call to each `*Once`
 *  tracker reports again. Called from `GameplaySession.startEpoch`, which is both
 *  the test-only session reset and the fresh measurement window a desktop consent
 *  change opens. Outside those, the latches live for the tab, matching the per-tab
 *  analytics session. */
export function clearActionLatches(): void {
  appActionOnce.clear();
  economyActionOnce.clear();
}
