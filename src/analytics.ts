import { analyticsAdapter, type EventProps } from "./analyticsAdapter";
import { telemetryHostAllowed } from "./telemetry";

/**
 * Gameplay analytics: a small, typed vocabulary of custom events reported
 * through the SAME transport the page-view telemetry uses, reached via the one
 * analytics adapter (`analyticsAdapter`, today Vercel Web Analytics `track`).
 * Page views and Core Web Vitals answer "who showed up and was it fast"; these
 * answer the questions the raw feed can't: a first-tower funnel (`game_started`
 * then `first_build`), which tools players reach for, how far they climb the
 * star ladder, and how long a session runs.
 *
 * Every event goes through the SAME host gate as the page-view inject
 * (`telemetryHostAllowed`) and is best-effort: nothing fires on localhost, the
 * e2e preview server, or the native shell, and a transport hiccup can never
 * throw past the caller into the game loop.
 *
 * The vocabulary is deliberately low-volume so a busy session stays well inside
 * the provider's event budget instead of streaming a row per click: `tool_used` is
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
   *  build anything" step). Fires once per tower: for a founded tower it follows
   *  that tower's `game_started` (the latch re-opens in `noteNewGame`); for the
   *  boot tower that a continued save opens on, it fires with no preceding
   *  `game_started`. `tool` is the facility/transport kind that broke the ice. */
  first_build: { tool: string };
  /** A tool was selected, reported once per distinct tool so the event captures
   *  the session's tool mix without a row per click. */
  tool_used: { tool: string };
  /** The tower crossed into a new star rating (2 through 6): progression depth,
   *  the clearest "how far do players get" signal. */
  star_reached: { star: number };
  /** The tab was hidden or unloaded: session length in whole seconds. */
  session_end: { seconds: number };
  /** One snapshot per boot: why the session started (`reason`), the build it
   *  runs (`version`), and the standing state of the tower it opened. Unlike the
   *  delta events, this captures a returning player's established tower even when
   *  they trigger nothing else, and pins every session to a build version.
   *  `reason` is one of "update", "recovery" (a WebGL-loss auto-reload),
   *  "corrupt", "continue" (readable save resumed), or "fresh" (no save). */
  boot: {
    reason: string;
    version: string;
    mode: string;
    star: number;
    floors: number;
    population: number;
  };
  /** The game hit a crash screen (today only a lost WebGL context). Carries the
   *  crash description flattened to primitives so a reliability read has the
   *  detail without opening a report: whether it repeated within 90s, whether an
   *  in-place recovery was tried and failed, whether the tower was flushed first,
   *  and whether it happened behind the boot splash. Fired at crash time, so it
   *  lands even when the player never reloads. */
  crash: {
    kind: string;
    repeat: boolean;
    recoveryFailed: boolean;
    saveFlushed: boolean;
    behindSplash: boolean;
    version: string;
    star: number;
    population: number;
  };
  /** The player applied a waiting build ("Update now"). `from` is the build they
   *  were on, `to` the incoming build's version (or "unknown" if its
   *  `version.json` couldn't be read), so update adoption is visible build over
   *  build. Fired just before the activating reload. */
  update: { from: string; to: string };
  /** Usage depth of one tool in a session (one event per tool the session used):
   *  `uses` is how many placements that tool made. A floor/lobby brush stamps a
   *  strip of 1-wide tiles in one action, each counted as a placement, so those
   *  paint tools read heavier per action than a single-room tool; read per-tool
   *  depth with that in mind. Emitted once per session. */
  tool_session_uses: { tool: string; uses: number };
  /** Total placements in a session (build volume). Emitted once per session. */
  session_builds: { builds: number };
  /** Highest floor built on during a session. Can be negative: the ground floor
   *  is 1 and basements run 0 down to -9, so a basement-heavy session reports a
   *  low or negative peak. Emitted once per session. */
  session_peak_floors: { floors: number };
  /** Render frame-rate for the session, sampled off the frame loop and emitted
   *  once per session as a per-session summary (not histogram-bucketed, unlike
   *  the old Vercel report): `p50` is the median frame's fps, `low` the
   *  5th-percentile fps (the worst frames, the hitch signal), and `samples` how
   *  many foreground frames fed the estimate. The two fps numbers are computed
   *  over a bounded per-session reservoir, so they are session ESTIMATES; PostHog
   *  computes the exact CROSS-session fps percentiles from them (issue #538).
   *  Emitted once per session, above a minimum sample count. */
  session_fps: { p50: number; low: number; samples: number };
  /** A discrete app-chrome action the player took OUTSIDE the core build loop:
   *  a save/export/import, a settings or dialog open, a preference toggle, a
   *  toolbar affordance, or a landing on the standalone help/gallery page. One
   *  parametrized event (keyed by `action`) rather than dozens of names, so the
   *  vocabulary stays small and a dashboard breaks the surface down by `action`.
   *  `detail` carries the small extra dimension an action needs (the new mute
   *  or accessibility-toggle state). Cookieless: these are aggregate counts and
   *  per-session behavior, never an identity. */
  app_action: { action: AppActionName; detail?: string };
}

/** The closed set of app-chrome actions {@link trackAppAction} reports. A union
 *  (not a bare string) so every call site is checked and the dashboard's action
 *  list is discoverable from one place. */
export type AppActionName =
  // Persistence. The FACT only, never tower contents or the fidelity report.
  | "quick_save"
  | "save_slot"
  | "load_slot"
  | "delete_save"
  | "export_save"
  | "import_save"
  | "export_tdt"
  | "import_tdt"
  // Dialogs / navigation.
  | "settings_open"
  | "help_open"
  | "compare_open"
  | "saves_open"
  | "stats_open"
  | "replay_onboarding"
  | "page_help"
  | "page_gallery"
  // Preference toggles (detail carries the new on/off state).
  | "mute"
  | "reduced_motion"
  | "steady_clock"
  // Coarse engagement bit, latched once per session via `trackAppActionOnce`:
  // `volume` = the player touched the audio sliders (latched so the pointer-move
  // slider cannot flood; no value, just the fact). (Deliberately NOT tracked, per
  // the design party: undo, redo, overlay, and rename, the last because the tower
  // name is player-authored. `speed` is deferred: its only clean user-only site,
  // the speed button handler, sits in a file at the line-size ceiling, and the
  // command callback it would otherwise hook is also the dialog pause path.)
  | "volume";

/**
 * Cross-cutting props merged into EVERY event: the platform dimension plus the
 * anonymous on-device returning / tenure / recency buckets (S4). Populated once
 * at boot via {@link setCommonProps}; empty until then, so the merge is a no-op
 * before boot and every existing per-event assertion is unaffected. These are
 * coarse, cookieless buckets, never an identifier (see `analyticsEnrichment.ts`).
 */
let commonProps: EventProps = {};

/** Install the boot-computed common props (see `analyticsEnrichment.ts`). Called
 *  once from the boot flow BEFORE the first event so `boot` already carries them.
 *  A later call replaces the whole set. Copied so a caller that later mutates the
 *  object it passed cannot rewrite what every event carries. */
export function setCommonProps(props: EventProps): void {
  commonProps = { ...props };
}

/** A copy of the boot-computed common props (platform / version / returning /
 *  tenure / recency), for a surface that sends OUTSIDE the typed gameplay
 *  vocabulary and so does not flow through `trackEvent`'s merge, namely the
 *  cookieless error reporter (`analyticsErrors.ts`): a `$exception` should carry
 *  the same platform and build context every gameplay event does. Copied so a
 *  caller cannot mutate the shared set. */
export function getCommonProps(): EventProps {
  return { ...commonProps };
}

/** Host-gated, best-effort custom-event send. The single choke point every
 *  gameplay event flows through, so the gate and the never-throw guarantee live
 *  in one place. The common props are spread FIRST so a per-event prop always
 *  wins on a key collision (the typed vocabulary is never shadowed by an
 *  enrichment key). */
function trackEvent<K extends keyof GameplayEvents>(name: K, props: GameplayEvents[K]): void {
  if (!telemetryHostAllowed()) return;
  try {
    analyticsAdapter().send(name, { ...commonProps, ...props });
  } catch {
    /* best-effort telemetry; never block gameplay on it */
  }
}

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

  /** Test hook: forget all session state, including the boot-set common props
   *  (module-level, so cleared here to keep tests isolated). */
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
    appActionOnce.clear(); // test-only reset path: keep test sessions independent
    commonProps = {};
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
  window.addEventListener("pagehide", () => gameplaySession.end());
  document.addEventListener("visibilitychange", () => {
    // Bank on hidden, (re)start on visible, ignore other states (e.g. prerender).
    if (document.visibilityState === "hidden") gameplaySession.end();
    else if (document.visibilityState === "visible") gameplaySession.begin();
  });
}
