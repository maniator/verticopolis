import { track } from "@vercel/analytics";
import { telemetryHostAllowed } from "./telemetry";

/**
 * Gameplay analytics: a small, typed vocabulary of custom events reported
 * through the SAME Vercel Web Analytics channel the page-view telemetry uses
 * (`@vercel/analytics`'s `track`). Page views and Core Web Vitals answer "who
 * showed up and was it fast"; these answer the questions the raw feed can't: a
 * first-tower funnel (`game_started` then `first_build`), which tools players
 * reach for, how far they climb the star ladder, and how long a session runs.
 *
 * Every event goes through the SAME host gate as the page-view inject
 * (`telemetryHostAllowed`) and is best-effort: nothing fires on localhost, the
 * e2e preview server, or the native shell, and a `track` hiccup can never throw
 * past the caller into the game loop.
 *
 * The vocabulary is deliberately low-volume so a busy session stays well inside
 * Vercel's event budget instead of streaming a row per click: `tool_used` is
 * deduped to one fire per distinct tool, `first_build` to one per session, and
 * `star_reached` (at most a handful of promotions) and `session_end` (one per
 * tab) are naturally bounded.
 */

/**
 * The event vocabulary and each event's props. Declaring it as a map makes a
 * typo'd event name or a stray prop a compile error and keeps the whole surface
 * legible in one place. Props stay to primitives Vercel accepts.
 */
interface GameplayEvents {
  /** A fresh tower was founded (the funnel's entry point). `mode` is the
   *  rule-set: "classic" or "modern". */
  game_started: { mode: string };
  /** The first facility placed in the current tower (the funnel's "did they
   *  build anything" step). Re-opens when a new tower is founded, so it pairs
   *  with `game_started` per tower. `tool` is the facility/transport kind that
   *  broke the ice. */
  first_build: { tool: string };
  /** A tool was selected, reported once per distinct tool so the event captures
   *  the session's tool mix without a row per click. */
  tool_used: { tool: string };
  /** The tower crossed into a new star rating (2 through 6): progression depth,
   *  the clearest "how far do players get" signal. */
  star_reached: { star: number };
  /** The tab was hidden or unloaded: session length in whole seconds. */
  session_end: { seconds: number };
}

/** Host-gated, best-effort custom-event send. The single choke point every
 *  gameplay event flows through, so the gate and the never-throw guarantee live
 *  in one place. */
function trackEvent<K extends keyof GameplayEvents>(name: K, props: GameplayEvents[K]): void {
  if (!telemetryHostAllowed()) return;
  try {
    track(name, props);
  } catch {
    /* best-effort telemetry; never block gameplay on it */
  }
}

/**
 * Per-tab session bookkeeping for the funnel and engagement events. One instance
 * (the exported {@link gameplaySession}) lives for the page's lifetime: the game
 * shell calls the `note*` hooks as things happen, and each fires its deduped
 * event. `begin`/`end` bracket the session clock; {@link startGameplaySession}
 * wires `end` to the browser's page-hide signals. Kept as a class with a
 * `reset` so a test can drive it in isolation.
 */
class GameplaySession {
  /** Foreground play time banked from completed visible segments. */
  private activeMs = 0;
  /** Start of the current visible segment; null while hidden or not started. */
  private resumedAt: number | null = null;
  /** Last whole-second length reported, seeded at 0 so a zero-length or repeated
   *  report is skipped. */
  private lastReportedSec = 0;
  private built = false;
  private readonly toolsSeen = new Set<string>();

  /** Start or resume timing foreground play. Idempotent while already running,
   *  so a redundant `begin` (a defensive double boot, a visible event with no
   *  prior hide) can't reset the clock. */
  begin(): void {
    if (this.resumedAt !== null) return;
    this.resumedAt = Date.now();
  }

  /** A new tower was founded: the funnel's entry point. Re-opens the
   *  `first_build` latch so the `game_started` then `first_build` funnel holds
   *  per tower, not just for the first tower founded in the tab. */
  noteNewGame(mode: string): void {
    this.built = false;
    trackEvent("game_started", { mode });
  }

  /** A facility was placed. Fires `first_build` once per founded tower (the
   *  latch re-opens in `noteNewGame`); later builds in that tower are silent,
   *  which is what keeps this off the per-click hot path. */
  noteBuild(tool: string): void {
    if (this.built) return;
    this.built = true;
    trackEvent("first_build", { tool });
  }

  /** A tool was selected. Fires `tool_used` once per distinct tool, so a session
   *  reports its tool mix rather than one event per selection. */
  noteToolUsed(tool: string): void {
    if (this.toolsSeen.has(tool)) return;
    this.toolsSeen.add(tool);
    trackEvent("tool_used", { tool });
  }

  /** The tower reached a new star rating. */
  noteStar(star: number): void {
    trackEvent("star_reached", { star });
  }

  /** Bank the current foreground segment and report cumulative play seconds.
   *  Called when the tab is hidden or the page unloads. The clock re-arms on the
   *  next `begin` (tab visible again), so tabbing away and back keeps ONE growing
   *  session rather than latching the length at the first blur: read the largest
   *  `session_end` per visitor as the length. Hidden time is excluded, so the
   *  number is foreground play, not wall clock. Deduped on the whole-second value
   *  (seeded at 0) so a zero-length end or a `pagehide` right after a
   *  `visibilitychange` doesn't emit a duplicate. */
  end(): void {
    if (this.resumedAt !== null) {
      this.activeMs += Date.now() - this.resumedAt;
      this.resumedAt = null;
    }
    const seconds = Math.round(this.activeMs / 1000);
    if (seconds === this.lastReportedSec) return;
    this.lastReportedSec = seconds;
    trackEvent("session_end", { seconds });
  }

  /** Test hook: forget all session state. */
  reset(): void {
    this.activeMs = 0;
    this.resumedAt = null;
    this.lastReportedSec = 0;
    this.built = false;
    this.toolsSeen.clear();
  }
}

/** The process-wide gameplay session. The shell imports this and calls its
 *  `note*` hooks; boot arms its end via {@link startGameplaySession}. */
export const gameplaySession = new GameplaySession();

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
  gameplaySession.begin();
  window.addEventListener("pagehide", () => gameplaySession.end());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") gameplaySession.end();
    else gameplaySession.begin();
  });
}
