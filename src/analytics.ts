import { telemetryHostAllowed } from "./telemetry";
import { trackEvent, setCommonProps, type GameplayEvents } from "./analyticsCore";
import { clearActionLatches } from "./analyticsActions";
import { FPS_MAX_FRAME_MS, FPS_RESERVOIR, fpsPercentilesOf, type FpsPercentiles } from "./analyticsFps";
import { onDesktopConsentChange } from "./desktopConsent";

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


/** The cumulative emergency counters the frame loop samples, in the shape the
 *  session banks and reports them. */
interface EmergencyCounts {
  fires: number;
  gutRooms: number;
  bombs: number;
}

/** A zeroed set of counters, fresh per call since the session mutates them. */
function noEmergencies(): EmergencyCounts {
  return { fires: 0, gutRooms: 0, bombs: 0 };
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
  private emergBanked: EmergencyCounts = noEmergencies();
  /** The last sampled CURRENT-tower cumulative emergency counts. A counter going
   *  backwards between samples means the tower was replaced, so the prior peak is
   *  banked into {@link emergBanked} before the new tower's counts take over. */
  private emergLast: EmergencyCounts = noEmergencies();
  /** What the CURRENT tower's counters already read when this measurement window
   *  opened, subtracted from the total so the window is charged only for the
   *  outbreaks it covers. Zero for a tab that has been in one window since boot,
   *  since every tower it saw started from zero inside that window. `null` means
   *  the next sample sets it: a consent flip lands mid-tower, and what the live
   *  counters read right then is only knowable from the sample after it. */
  private emergBase: EmergencyCounts | null = noEmergencies();
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

  /** The session's frame-rate percentiles, or null below the minimum sample
   *  count. The `session_fps` flush in {@link end} reads this too, so the HUD
   *  and the event cannot disagree. Read-only: safe to poll repeatedly. */
  fpsPercentiles(): FpsPercentiles | null {
    return fpsPercentilesOf(this.fpsSamples, this.fpsSeen);
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
    // A window that opened mid-tower takes this first sample as its baseline, so
    // what the tower had been through before the window is not charged to it. A
    // window open since boot already holds a zero baseline and is unaffected.
    this.emergBase ??= { fires, gutRooms: firesGutRooms, bombs };
    if (fires < this.emergLast.fires || firesGutRooms < this.emergLast.gutRooms || bombs < this.emergLast.bombs) {
      this.emergBanked.fires += this.emergLast.fires - this.emergBase.fires;
      this.emergBanked.gutRooms += this.emergLast.gutRooms - this.emergBase.gutRooms;
      this.emergBanked.bombs += this.emergLast.bombs - this.emergBase.bombs;
      // The replacement starts from zero, so the baseline leaves with the old tower.
      this.emergBase = noEmergencies();
    }
    this.emergLast = { fires, gutRooms: firesGutRooms, bombs };
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
    // Nothing below runs while the gate is shut, and the reason is the LATCHES
    // rather than the sends. Every `trackEvent` here already declines to send with
    // sharing off, but each latch is set BEFORE the call it guards, so a page-hide
    // during an off stretch would mark the depth and fps summaries reported and
    // suppress them for the rest of the session even after the player turned
    // sharing back on. It also keeps a summary out of the first-run hold, which a
    // later reset could not undo: a held event freezes its payload at emit time,
    // so a summary computed before the answer would still carry those totals when
    // the queue drains after a grant (see `desktopConsent.ts`). The clock above is
    // banked either way, so an off-stretch hide still stops counting time.
    if (!telemetryHostAllowed()) return;
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
    // above) so a build-free but long session still reports its fps. The
    // percentiles come from `fpsPercentiles`, the same accessor the debug HUD
    // reads, so the two can never disagree; it returns null below the
    // minimum-samples gate, which is what makes it the whole condition here. The
    // event keeps calling the 5th percentile `low` (an established property
    // name in the analytics schema). Rounded to whole fps; PostHog does the
    // exact cross-session percentiles.
    //
    // The report latch is checked FIRST: `fpsPercentiles` sorts a copy of the
    // reservoir, and there is no reason to pay for that on the later flushes of
    // a session that has already reported.
    if (!this.fpsReported) {
      const fps = this.fpsPercentiles();
      if (fps) {
        this.fpsReported = true;
        trackEvent("session_fps", { p50: fps.p50, low: fps.p5, samples: fps.samples });
      }
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
      // Net of the window's opening baseline (zero unless the window opened
      // mid-tower on a consent change), so the summary covers this window only.
      const base = this.emergBase ?? noEmergencies();
      trackEvent("session_emergencies", {
        fires: this.emergBanked.fires + this.emergLast.fires - base.fires,
        firesGutRooms: this.emergBanked.gutRooms + this.emergLast.gutRooms - base.gutRooms,
        bombs: this.emergBanked.bombs + this.emergLast.bombs - base.bombs,
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

  /**
   * Open a fresh measurement window: drop everything banked so far, and re-open
   * every latch, so the next summary describes only what happens from here.
   *
   * Called on any change of the desktop consent answer, in BOTH directions (see
   * the subscription below this class), which is what keeps the accumulators
   * describing one consent state at a time:
   *
   * - Turning sharing ON drops what came before it, so no summary emitted after
   *   the grant can describe play the player had not agreed to share. That is the
   *   half that matters most: the totals are cumulative and the summaries fire
   *   late, so without this a grant at the end of a session would report the
   *   whole session.
   * - Turning sharing OFF drops the same way, which is what stops the window up
   *   to that moment from being transmitted later.
   *
   * Two things deliberately survive. `armed` does, because the page-hide listeners
   * are wired once per tab and a second pair would double-count `session_end`. The
   * boot-set common props do, because they describe the build and the device
   * rather than the play.
   *
   * The per-tower `first_build` latch and the per-tool `tool_used` latch re-open
   * with everything else, so a window that opens mid-play reports the funnel step
   * and the tool mix it sees rather than staying silenced by an earlier window
   * nothing was sent from. The price is one repeat of each on the one path where
   * the earlier window WAS transmitted (a first run whose held queue flushed on
   * the grant), the cheaper side of that trade for two deduped, rare events.
   */
  startEpoch(): void {
    this.activeMs = 0;
    this.lastReportedSec = 0;
    this.built = false;
    this.builds = 0;
    this.peakFloors = Number.NEGATIVE_INFINITY;
    this.depthReported = false;
    this.fpsSamples.length = 0;
    this.fpsSeen = 0;
    this.fpsReported = false;
    this.lastFrameAt = null;
    this.toolsSeen.clear();
    this.toolUses.clear();
    this.emergBanked = noEmergencies();
    this.emergLast = noEmergencies();
    // Unknown until the next sample: this window may have opened in the middle of
    // a tower that already has counts. See `emergBase`.
    this.emergBase = null;
    this.emergSampled = false;
    this.emergReported = false;
    clearActionLatches();
    // Re-anchor a running foreground segment on now, so the clock keeps running
    // for the new window while the time already spent in the old one is dropped
    // with everything else.
    if (this.resumedAt !== null) this.resumedAt = Date.now();
  }

  /** Test hook: forget all session state. A fresh window, plus the few things a
   *  window deliberately outlives (the listener claim and the module-level common
   *  props, both cleared here to keep tests isolated). */
  reset(): void {
    this.startEpoch();
    this.resumedAt = null;
    this.armed = false;
    // A reset stands in for a brand-new tab, whose towers all start from zero
    // inside the window. Only a mid-flight consent flip needs a baseline read
    // from the next sample.
    this.emergBase = noEmergencies();
    setCommonProps({});
  }
}

/** The process-wide gameplay session. The shell imports this and calls its
 *  `note*` hooks; boot arms its end via {@link startGameplaySession}. */
export const gameplaySession = new GameplaySession();

/**
 * Start a fresh measurement window whenever the desktop consent answer changes.
 *
 * Wired here, beside the session it resets, rather than at the two consent
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
onDesktopConsentChange(() => gameplaySession.startEpoch());

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
