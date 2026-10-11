import { telemetryHostAllowed } from "./telemetry";
import { trackEvent, setCommonProps, type GameplayEvents } from "./analyticsCore";
import { clearActionLatches } from "./analyticsActions";
import { noteCrash as reportCrash, releaseCrashThrottle as releaseCrashSlots } from "./analyticsCrash";

/**
 * The per-tab {@link GameplaySession} and the one process-wide instance of it,
 * split out of `analytics.ts` at the 500-line file guard. `analytics.ts` keeps
 * the module's public surface (the re-exports, the consent subscription, and the
 * boot wiring) and re-exports `gameplaySession`, so every caller keeps importing
 * from `./analytics` exactly as before.
 *
 * The event vocabulary and the send choke point live in `analyticsCore.ts`, the
 * free per-action trackers in `analyticsActions.ts`, and the cap-and-dedup latch
 * the crash path shares with the error reporter in `analyticsThrottle.ts`.
 */

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

/** The session's emergency tallies, in the shape `session_emergencies` reports. */
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
  /** True once a terminal (`pagehide`) `session_end` has been emitted, so the one
   *  row allowed past the whole-second dedup is allowed exactly once. */
  private finalReported = false;
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
  /** Emergencies this window saw, folded from the engine's events
   *  (`fire_started`, `fire_gutted`, `bomb_detonated`) by the analytics bridge.
   *  Every tower the tab plays adds to the same tallies, so a swap needs no
   *  banking, and a window that opens mid-tower starts from zero. */
  private emerg: EmergencyCounts = noEmergencies();
  /** True once the frame loop's throttled refresh has run (`notePlaying`, where
   *  the old counter sampler sat), i.e. the game actually ran. Gates `session_emergencies` so a no-play prerender/hide (the
   *  frame loop never ran) does not emit a spurious zero into the denominator. */
  private played = false;
  /** `session_emergencies` fires at most once per session (like the depth events). */
  private emergReported = false;
  /** See {@link setEngineFlush}. */
  private engineFlush: ((closing: boolean) => void) | null = null;

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
   *  `first_build` latch so the `new_game_started` then `first_build` funnel holds
   *  per tower, not just for the first tower founded in the tab. The analytics
   *  bridge calls it for the engine's `tower_founded`; a founding the rate limit
   *  holds back calls {@link noteNewGameUnreported} instead. */
  noteNewGame(mode: string): void {
    this.built = false;
    trackEvent("new_game_started", { mode });
  }

  /** A tower was founded but its `new_game_started` was not sent (the
   *  analytics bridge's rate limit held it back). Its funnel is closed, so its
   *  first build is never reported, and above all never reported as the first
   *  build of the tower before it, whose funnel may still be open. */
  noteNewGameUnreported(): void {
    this.built = true;
  }

  /** A facility was placed. Counts toward the session's build volume, per-tool
   *  usage depth, and peak height (all emitted once at session end), and fires
   *  `first_build` once per founded tower. Called by the analytics bridge for
   *  each engine `facility_placed`. The unit is PLACEMENTS: a wide or
   *  multi-story room is one placement, and a floor/lobby brush's tiles are one
   *  each (the engine reports every tile it lays), so `count` sums to the tiles
   *  laid. `floor` is the TOP occupied story of what was placed, as the engine
   *  reports it, so the session peak reflects real height.
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

  /** Report a crash (crash-screen moment). Capped and deduplicated per page life;
   *  the signal and its guard live in `analyticsCrash.ts`. */
  noteCrash(info: GameplayEvents["crash"]): void {
    reportCrash(info);
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

  /** The game ran a frame (the frame loop's throttled refresh): this session
   *  played, so it reports `session_emergencies` at its end even when nothing
   *  caught fire. */
  notePlaying(): void {
    this.played = true;
  }

  /** Fold one engine emergency into the session's tallies: a fire that
   *  started, rooms a fire gutted, or a bomb that went off. Counts only; the
   *  summary is sent once, at the session's end. */
  noteEmergency(kind: keyof EmergencyCounts, n = 1): void {
    this.emerg[kind] += n;
  }

  /** Let the analytics bridge take what the engine still holds before the
   *  session reports (`closing` false: fold it) or a new window opens
   *  (`closing` true: it belongs to the window being discarded). The bridge
   *  binds this once; the session itself never imports the bridge or the
   *  engine. */
  setEngineFlush(flush: ((closing: boolean) => void) | null): void {
    this.engineFlush = flush;
  }

  /** Bank the current foreground segment and report cumulative play seconds.
   *  Called when the tab is hidden or the page unloads. The clock re-arms on the
   *  next `begin` (tab visible again), so tabbing away and back keeps ONE growing
   *  session rather than latching the length at the first blur. Count sessions as
   *  distinct visitors, never as a row count, and take a length as the SUM of
   *  each page life's final reading rather than the largest reading: the session
   *  id survives a same-tab reload, so one visitor covers several page lives whose
   *  clocks each restart here. The `session_end` vocabulary entry in
   *  `analyticsCore.ts` carries both traps and the numbers behind them; read it
   *  before writing a query against this event.
   *  Hidden time is excluded, so the number is foreground play, not wall clock.
   *  Deduped on the whole-second value (seeded at 0) so a zero-length end or a
   *  `pagehide` right after a `visibilitychange` doesn't emit a duplicate;
   *  `isFinal` marks an emission made from `pagehide` and is the one thing let
   *  past that dedup, once, so that row stays identifiable. It marks the
   *  PAGEHIDE, which is not quite the same as the session's last word: a
   *  bfcache entry fires `pagehide` too, so a restored-and-resumed session can
   *  spend the allowance early and report its real ending without the flag. */
  end(isFinal = false): void {
    // Fold the engine's last events first, so a build or a fire in the final
    // frame before the hide is in the summaries below.
    this.engineFlush?.(false);
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
    // played (the frame loop ran). Unlike the depth/fps events it is NOT gated
    // on any count being nonzero: "fraction of sessions with a fire" needs the
    // zero-emergency sessions in the denominator. The total sums every tower the
    // tab played in this window.
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
    if (isFinal && this.played && !this.emergReported) {
      this.emergReported = true;
      trackEvent("session_emergencies", { fires: this.emerg.fires, firesGutRooms: this.emerg.gutRooms, bombs: this.emerg.bombs });
    }
    const seconds = Math.round(this.activeMs / 1000);
    // The terminal emission is let through the whole-second dedup once, because it
    // is the only row that can carry `final: true` and the ordinary close path
    // would otherwise swallow it: `visibilitychange:hidden` reports first, then
    // `pagehide` lands in the same rounded second and reads as a duplicate. A
    // session with nothing to report stays silent either way (`seconds` still 0
    // against the 0 seed), so this never adds a row for a blink-and-leave visit;
    // it adds at most one row to a session that already reported one.
    const terminal = isFinal && !this.finalReported && seconds > 0;
    if (seconds === this.lastReportedSec && !terminal) return;
    this.lastReportedSec = seconds;
    if (isFinal) this.finalReported = true;
    trackEvent("session_end", { seconds, final: isFinal });
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
   * Three things deliberately survive. `armed` does, because the page-hide
   * listeners are wired once per tab and a second pair would double-count
   * `session_end`. The boot-set common props do, because they describe the build
   * and the device rather than the play. The crash throttle does, because it is a
   * flood guard rather than a measurement: see {@link releaseCrashThrottle}.
   *
   * The per-tower `first_build` latch and the per-tool `tool_used` latch DO re-open
   * with everything else, so a window that opens mid-play reports the funnel step
   * and the tool mix it sees rather than staying silenced by an earlier window
   * nothing was sent from. The price is one repeat of each on the one path where
   * the earlier window WAS transmitted (a first run whose held queue flushed on
   * the grant), the cheaper side of that trade for two deduped, rare events. That
   * same path is why the crash throttle, ten slots rather than one shot, is not.
   */
  startEpoch(): void {
    // What the engine emitted before this moment belongs to the window that is
    // closing, so it is dropped unsent with the rest of that window.
    this.engineFlush?.(true);
    this.activeMs = 0;
    this.lastReportedSec = 0;
    this.finalReported = false;
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
    this.emerg = noEmergencies();
    this.played = false;
    this.emergReported = false;
    clearActionLatches();
    // Re-anchor a running foreground segment on now, so the clock keeps running
    // for the new window while the time already spent in the old one is dropped
    // with everything else.
    if (this.resumedAt !== null) this.resumedAt = Date.now();
  }

  /** Hand back the crash throttle's spent slots. See `analyticsCrash.ts`. */
  releaseCrashThrottle(): void {
    releaseCrashSlots();
  }

  /** Test hook: forget all session state. A fresh window, plus the few things a
   *  window deliberately outlives (the listener claim and the module-level common
   *  props, both cleared here to keep tests isolated). */
  reset(): void {
    this.engineFlush = null;
    this.startEpoch();
    this.releaseCrashThrottle();
    this.resumedAt = null;
    this.armed = false;
    setCommonProps({});
  }
}

/** The process-wide gameplay session. The shell imports this and calls its
 *  `note*` hooks; boot arms its end via {@link startGameplaySession}. */
export const gameplaySession = new GameplaySession();
