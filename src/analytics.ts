import { telemetryHostAllowed } from "./telemetry";
import { trackEvent, setCommonProps, type GameplayEvents } from "./analyticsCore";
import { clearActionLatches } from "./analyticsActions";

/**
 * Gameplay analytics: the per-tab {@link GameplaySession} that tracks the funnel
 * and engagement events, plus the boot wiring. The event vocabulary and the send
 * choke point live in `analyticsCore.ts`; the free per-action trackers in
 * `analyticsActions.ts`. This module re-exports both so callers keep importing
 * from `./analytics`.
 *
 * Page views and Core Web Vitals answer "who showed up and was it fast"; these
 * answer the questions the raw feed can't: a first-tower funnel (`game_started`
 * then `first_build`), which tools players reach for, how far they climb the
 * star ladder, and how long a session runs. The vocabulary is deliberately
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
export {
  trackAppAction,
  trackAppActionOnce,
  trackEconomyAction,
  trackEconomyActionOnce,
  trackEmergencyChoice,
} from "./analyticsActions";

/** Fixed cap on the per-session fps sample reservoir: bounded memory no matter
 *  how long a session runs, large enough for a stable p50/p5. */
const FPS_RESERVOIR = 256;
/** Minimum foreground frames before `session_fps` is worth emitting (about two
 *  seconds at 60fps), so a blink-and-leave visit does not report a meaningless
 *  percentile. */
const FPS_MIN_SAMPLES = 120;
/** Longest wall-clock gap still treated as one rendered frame (1 second = 1fps).
 *  A gap longer than this is not a slow frame but a loop interruption that did
 *  not route through hide/resume: an in-place WebGL context-loss recovery
 *  (`rebuildEngine`) restarts the render loop while this same page-lifetime
 *  session stays active, so its first frame back would otherwise charge the whole
 *  outage as one sub-1fps sample straight into the worst-frame `low` tail (the
 *  Pixel 8a recovery is exactly #538's scenario). Such a gap re-anchors and is
 *  dropped instead. Realistic device jank down to 1fps is still captured. */
const FPS_MAX_FRAME_MS = 1000;

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
  private armed = false;
  private readonly toolsSeen = new Set<string>();
  /** Placement counts this session, per tool, for the depth events. */
  private readonly toolUses = new Map<string, number>();
  /** Total placements this session (build volume). */
  private builds = 0;
  /** Highest floor built on this session; seeded low so a basement-only session
   *  (floors 0 to -9) reports its real peak, not the ground-floor default. */
  private peakFloors = Number.NEGATIVE_INFINITY;
  /** Depth events fire at most once per session (see `end`). */
  private depthReported = false;
  /** Foreground per-frame fps samples (wall-clock 1000/frameMs), reservoir-sampled
   *  to a fixed cap so a long session's memory stays bounded; sorted at session
   *  end for the `session_fps` percentiles. */
  private readonly fpsSamples: number[] = [];
  /** Foreground frames offered to the reservoir this session: drives the
   *  reservoir replacement probability and the minimum-samples gate. */
  private fpsSeen = 0;
  /** `session_fps` fires at most once per session (like the depth events). */
  private fpsReported = false;
  /** Timestamp of the previous sampled frame, for the wall-clock frame delta;
   *  null between segments so the first frame after a resume re-anchors instead
   *  of charging the whole background gap as one slow frame. */
  private lastFrameAt: number | null = null;
  /** Emergency tallies banked from towers this tab already left behind. A new
   *  game or a loaded save builds a fresh EventSystem whose counters restart at
   *  zero, so the current tower's live counts alone would undercount (report a
   *  clean zero for) a session that had a fire in an earlier tower. */
  private emergBanked = { fires: 0, gutRooms: 0, bombs: 0 };
  /** The last sampled CURRENT-tower cumulative emergency counts. A counter going
   *  backwards between samples means the tower was replaced, so the prior peak is
   *  banked into {@link emergBanked} before the new tower's counts take over. */
  private emergLast = { fires: 0, gutRooms: 0, bombs: 0 };
  /** True once the emergency sampler has run at least once, i.e. the game frame
   *  loop actually ticked. Gates `session_emergencies` so a no-play prerender/hide
   *  (frame loop never ran) does not emit a spurious zero into the denominator. */
  private emergSampled = false;
  /** `session_emergencies` fires at most once per session (like the depth events). */
  private emergReported = false;

  /** Start or resume timing foreground play. Idempotent while already running,
   *  so a redundant `begin` (a defensive double boot, a visible event with no
   *  prior hide) can't reset the clock. */
  begin(): void {
    if (this.resumedAt !== null) return;
    this.resumedAt = Date.now();
    // Re-anchor the fps sampler: the first frame of this segment establishes the
    // baseline, so the wall-clock gap the tab spent hidden is never sampled as
    // one enormous slow frame.
    this.lastFrameAt = null;
  }

  /** A new tower was founded: the funnel's entry point. Re-opens the
   *  `first_build` latch so the `game_started` then `first_build` funnel holds
   *  per tower, not just for the first tower founded in the tab. */
  noteNewGame(mode: string): void {
    this.built = false;
    trackEvent("game_started", { mode });
  }

  /** A facility was placed. Counts toward the session's build volume, per-tool
   *  usage depth, and peak height (all emitted once at session end), and fires
   *  `first_build` once per founded tower. The unit is PLACEMENTS, not tiles: a
   *  wide or multi-story room is one placement (`count` 1); a floor/lobby brush
   *  lays several 1-wide tiles at once, so it passes `count` = how many it laid,
   *  each its own placement. `floor` is the TOP occupied story of what was placed
   *  (callers add the facility height), so the session peak reflects real height.
   *  The counting is O(1) (a Map bump and two numeric compares, no sim reads), so
   *  this stays cheap on the per-placement path. */
  noteBuild(tool: string, floor = 0, count = 1): void {
    this.builds += count;
    this.toolUses.set(tool, (this.toolUses.get(tool) ?? 0) + count);
    if (floor > this.peakFloors) this.peakFloors = floor;
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

  /** Report the boot snapshot: how the session started plus the loaded tower's
   *  state and build version. Fired once at boot so returning players whose
   *  established tower never fires a delta event still show up, and so every
   *  event stream is anchored to a version. */
  noteBoot(info: GameplayEvents["boot"]): void {
    trackEvent("boot", info);
  }

  /** Report a crash (crash-screen moment) with its flattened description. */
  noteCrash(info: GameplayEvents["crash"]): void {
    trackEvent("crash", info);
  }

  /** Report that the player applied a waiting build, from one version to another. */
  noteUpdate(from: string, to: string): void {
    trackEvent("update", { from, to });
  }

  /** Sample this frame's rendered frame-rate for the `session_fps` signal, called
   *  every frame from the frame loop. It measures the REAL wall-clock gap between
   *  frames with its own `performance.now()` read rather than the engine's frame
   *  delta: the engine clock clamps any frame longer than 200ms down to 1ms as a
   *  sim spike-guard (Excalibur `Clock.update`), so a genuine hitch (the whole
   *  point of #538) would reach us as ~1000fps at the GOOD end of the distribution
   *  and blind the worst-frame `low` signal. The wall-clock gap keeps the hitch.
   *  Foreground-only (samples only while a visible segment is running, keyed off
   *  the same `resumedAt` the session clock uses), so background-tab throttling
   *  can't masquerade as bad performance; the anchor is reset on each resume
   *  (`begin`) so a background gap is not sampled. Reservoir sampling (Algorithm R)
   *  keeps a uniform sample of the whole session in bounded memory, so an early
   *  hitch is as likely to be captured as a late one, unlike a last-N ring. */
  noteFrame(): void {
    if (this.resumedAt === null) return; // foreground segments only
    const now = globalThis.performance ? performance.now() : Date.now();
    const prev = this.lastFrameAt;
    this.lastFrameAt = now;
    if (prev === null) return; // first frame of the segment: just set the anchor
    const dtMs = now - prev;
    // Drop a delta that is not a plausible single rendered frame: <= 0 (a clock
    // anomaly) or longer than a second (a loop interruption that skipped the
    // hide/resume re-anchor, e.g. an in-place graphics-recovery rebuild). Because
    // `lastFrameAt` was already advanced to `now` above, returning here re-anchors
    // the sampler, so the gap is dropped rather than banked as a sub-1fps sample.
    if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > FPS_MAX_FRAME_MS) return;
    // Cap the fast end so a sub-millisecond delta (a doubled callback, a very
    // high refresh display) can't inject an implausible spike; the slow end, the
    // hitch this metric exists to catch, is left untouched.
    const fps = Math.min(1000, 1000 / dtMs);
    this.fpsSeen++;
    if (this.fpsSamples.length < FPS_RESERVOIR) {
      this.fpsSamples.push(fps);
      return;
    }
    const j = Math.floor(Math.random() * this.fpsSeen);
    if (j < FPS_RESERVOIR) this.fpsSamples[j] = fps;
  }

  /** Sample the live tower's cumulative emergency counters, called from the frame
   *  loop. The engine (EventSystem) owns the counters as plain integers and never
   *  imports analytics; the shell reads them here, mirroring how `noteBuild` is
   *  shell-called after a build, not engine-called. A counter that dropped since
   *  the last sample means the tower was replaced (a fresh EventSystem restarts at
   *  zero), so the departing tower's last-seen peak is banked before the new
   *  tower's counts take over. Pure arithmetic, no allocation: cheap on the
   *  throttled UI-update path it rides. */
  noteEmergencyCounts(fires: number, firesGutRooms: number, bombs: number): void {
    this.emergSampled = true;
    if (fires < this.emergLast.fires || firesGutRooms < this.emergLast.gutRooms || bombs < this.emergLast.bombs) {
      this.emergBanked.fires += this.emergLast.fires;
      this.emergBanked.gutRooms += this.emergLast.gutRooms;
      this.emergBanked.bombs += this.emergLast.bombs;
    }
    this.emergLast.fires = fires;
    this.emergLast.gutRooms = firesGutRooms;
    this.emergLast.bombs = bombs;
  }

  /** Bank the current foreground segment and report cumulative play seconds.
   *  Called when the tab is hidden or the page unloads. The clock re-arms on the
   *  next `begin` (tab visible again), so tabbing away and back keeps ONE growing
   *  session rather than latching the length at the first blur: read the largest
   *  `session_end` per visitor as the length. Hidden time is excluded, so the
   *  number is foreground play, not wall clock. Deduped on the whole-second value
   *  (seeded at 0) so a zero-length end or a `pagehide` right after a
   *  `visibilitychange` doesn't emit a duplicate. */
  end(isFinal = false): void {
    if (this.resumedAt !== null) {
      this.activeMs += Date.now() - this.resumedAt;
      this.resumedAt = null;
    }
    // Session depth, emitted AT MOST ONCE per session (the first `end` after
    // something was built). `end` re-fires on every tab-hide, and these events
    // carry no session id, so re-emitting the growing cumulative totals would
    // flood the stream and bias a downstream median/p90 that can't be deduped
    // per visitor. Firing once at first background is a conservative lower bound
    // on the session's depth. `builds > 0` guarantees `peakFloors` is finite.
    // Kept AHEAD of the whole-second dedup below, and latched on its own flag, so
    // a build-and-close inside the first rounded second (seconds === 0 ===
    // lastReportedSec) still records its depth even though session_end is skipped.
    if (this.builds > 0 && !this.depthReported) {
      this.depthReported = true;
      trackEvent("session_builds", { builds: this.builds });
      trackEvent("session_peak_floors", { floors: this.peakFloors });
      for (const [tool, uses] of this.toolUses) trackEvent("tool_session_uses", { tool, uses });
    }
    // Per-session frame-rate summary, emitted once per session above a minimum
    // sample count. Latched on its own flag (independent of the build depth
    // above) so a build-free but long session still reports its fps. `low` is the
    // 5th-percentile fps: sorted ascending, the low tail IS the worst frames, the
    // hitch signal. The percentiles are computed over the bounded reservoir (so
    // they are session estimates, not exact), while `samples` is the true
    // foreground frame count behind them. Rounded to whole fps; PostHog does the
    // exact cross-session percentiles.
    if (this.fpsSeen >= FPS_MIN_SAMPLES && !this.fpsReported) {
      this.fpsReported = true;
      const sorted = [...this.fpsSamples].sort((a, b) => a - b);
      const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
      trackEvent("session_fps", { p50: Math.round(at(0.5)), low: Math.round(at(0.05)), samples: this.fpsSeen });
    }
    // Per-session emergency summary, emitted once per session that actually
    // played (the sampler ran). Unlike the depth/fps events it is NOT gated on
    // any count being nonzero: "fraction of sessions with a fire" needs the
    // zero-emergency sessions in the denominator. The total sums every tower the
    // tab played (banked departed towers plus the current one's latest sample).
    //
    // Gated on `isFinal` (the terminal `pagehide`), NOT every tab-hide. The depth
    // and fps summaries can latch at the first `visibilitychange:hidden` because
    // they only emit once their signal exists (builds > 0, an fps floor) and that
    // signal accrues early. Fires are the opposite: they are rare and ignite LATE,
    // so latching at the first hide (a mid-session tab switch, which fires
    // `visibilitychange:hidden` but NOT `pagehide`) would lock in a zero before the
    // first fire and bias "% of sessions with a fire" toward zero. Waiting for
    // `pagehide` (tab close / navigation / bfcache) captures the whole session. A
    // session whose `pagehide` never fires (a hard mobile kill) simply drops from
    // both the numerator and the denominator, so the RATE stays unbiased.
    if (isFinal && this.emergSampled && !this.emergReported) {
      this.emergReported = true;
      trackEvent("session_emergencies", {
        fires: this.emergBanked.fires + this.emergLast.fires,
        firesGutRooms: this.emergBanked.gutRooms + this.emergLast.gutRooms,
        bombs: this.emergBanked.bombs + this.emergLast.bombs,
      });
    }
    const seconds = Math.round(this.activeMs / 1000);
    if (seconds === this.lastReportedSec) return;
    this.lastReportedSec = seconds;
    trackEvent("session_end", { seconds });
  }

  /** Claim the one-time listener wiring. Returns true exactly once (until
   *  `reset`), so {@link startGameplaySession} attaches its page-hide listeners
   *  at most once however many times it is called. */
  arm(): boolean {
    if (this.armed) return false;
    this.armed = true;
    return true;
  }

  /** Test hook: forget all session state, including the boot-set common props and
   *  the once-per-session action latches (both module-level, so cleared here to
   *  keep tests isolated). */
  reset(): void {
    this.activeMs = 0;
    this.resumedAt = null;
    this.lastReportedSec = 0;
    this.built = false;
    this.armed = false;
    this.builds = 0;
    this.peakFloors = Number.NEGATIVE_INFINITY;
    this.depthReported = false;
    this.fpsSamples.length = 0;
    this.fpsSeen = 0;
    this.fpsReported = false;
    this.lastFrameAt = null;
    this.toolsSeen.clear();
    this.toolUses.clear();
    this.emergBanked = { fires: 0, gutRooms: 0, bombs: 0 };
    this.emergLast = { fires: 0, gutRooms: 0, bombs: 0 };
    this.emergSampled = false;
    this.emergReported = false;
    clearActionLatches(); // test-only reset path: keep test sessions independent
    setCommonProps({});
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
