import { analyticsAdapter, type EventProps } from "./analyticsAdapter";
import { APP_VERSION } from "./appVersion";
import { telemetryHostAllowed } from "./telemetry";
import { holdWhilePending } from "./desktopConsent";

/**
 * Gameplay analytics core: the typed event vocabulary, the cross-cutting common
 * props, and the single host-gated send choke point ({@link trackEvent}) every
 * event flows through. The free action trackers live in `analyticsActions.ts`
 * and the per-tab `GameplaySession` in `analytics.ts`; both import `trackEvent`
 * and the types from here, and `analytics.ts` re-exports the public surface so
 * callers import from `./analytics` as before.
 *
 * Every event goes through the SAME host gate as the page-view inject
 * (`telemetryHostAllowed`) and is best-effort: nothing fires on localhost, the
 * e2e preview server, or the native shell, and a transport hiccup can never
 * throw past the caller into the game loop. The vocabulary is deliberately
 * low-volume so a busy session stays well inside the provider's event budget.
 */

/**
 * The event vocabulary and each event's props. Declaring it as a map makes a
 * typo'd event name or a stray prop a compile error and keeps the whole surface
 * legible in one place. Props stay to primitives the relay transport accepts.
 */
export interface GameplayEvents {
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
  /** A discrete gameplay economy action the player took at the build/editor money
   *  boundary: demolishing a facility, tuning pricing, or tuning transport
   *  capacity. One parametrized event (keyed by `action`) like `app_action`, but
   *  a distinct gameplay event (placement is already covered by `first_build` /
   *  `tool_used`; this is the removal + tuning side those never saw). `detail`
   *  carries the small extra dimension `demolish` needs (sell vs bulldoze).
   *  Cookieless: closed enums and per-session behavior, never an identity, never
   *  a currency amount. */
  economy_action: { action: EconomyActionName; detail?: string };
  /** The player answered an in-game emergency prompt (pay for rescue, or gamble
   *  the containment / bomb search). Per occurrence, so the accept/decline split
   *  is visible per emergency kind. Only a real click emits: a timed-out
   *  auto-decline is the absence of a choice, not a decline, and reports nothing. */
  emergency_choice: { kind: EmergencyKind; decision: EmergencyDecision };
  /** Per-session summary of the SIMULATION-fired emergency activity: how many fire
   *  outbreaks ignited, how many rooms they gutted, and how many bombs detonated.
   *  Emitted once at session end like `session_builds`, and emitted EVEN WHEN ALL
   *  ZERO so "fraction of sessions that had a fire" has its denominator. Counts
   *  only, never a currency figure. */
  session_emergencies: { fires: number; firesGutRooms: number; bombs: number };
}

/** The closed set of gameplay economy actions {@link import("./analyticsActions").trackEconomyAction}
 *  reports. `demolish` fires per action (with a `sell` | `bulldoze` detail);
 *  `price_tune` and `capacity_tune` are latched once per session (their gestures
 *  repeat, so the signal is "did the player tune pricing / capacity at all",
 *  never the value or the count). */
export type EconomyActionName = "demolish" | "price_tune" | "capacity_tune";

/** The emergency kinds the player can be prompted to resolve (see `emergency_choice`). */
export type EmergencyKind = "fireRescue" | "bombThreat";
/** The player's answer to an emergency prompt. */
export type EmergencyDecision = "accept" | "decline";

/** The closed set of app-chrome actions {@link import("./analyticsActions").trackAppAction}
 *  reports. A union (not a bare string) so every call site is checked and the
 *  dashboard's action list is discoverable from one place. */
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
  // The TITLE SCREEN's load-only tower picker. Deliberately its own action, not
  // saves_open: a first-run player reaches this from the splash, and folding it
  // into the in-game manager's funnel would dilute that funnel with
  // title-screen browsing and leave the two impossible to separate later.
  | "splash_load_open"
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
  | "volume"
  // The app was installed (the `appinstalled` event, however it was triggered:
  // our in-game offer or the browser's own menu). Latched once per session; the
  // `display` common prop already carries standalone-vs-browser reach.
  | "install_app"
  // The player tapped an install affordance (SPEC-pwa-install CAP-4). `detail`
  // carries which surface: `splash`, `chip`, or `menu`. NOT latched: an install
  // tap is a deliberate, low-volume action, so the raw per-surface count is the
  // signal, and it is the engagement half of the funnel that `install_app` (the
  // completion) cannot attribute (the OS `appinstalled` event names no surface).
  | "install_offer";

/**
 * Cross-cutting props merged into EVERY event: the platform and
 * distribution-channel dimensions plus the
 * anonymous on-device returning / tenure / recency buckets (S4). Populated once
 * at boot via {@link setCommonProps}. These are coarse, cookieless buckets,
 * never an identifier (see `analyticsEnrichment.ts`).
 *
 * The build version is here from MODULE LOAD rather than waiting for boot, so
 * that every event can name the build that sent it whatever the entry point.
 * Three paths would otherwise miss it: an uncaught error thrown before the boot
 * enrichment runs (the window that produced the largest real error signal in
 * production, `WebGL context lost (at boot)`), a boot where the enrichment's own
 * optional reads throw and its catch leaves the props untouched, and the
 * standalone `/help` and `/gallery` pages, which never call `bootGame` at all
 * and fire their page events immediately. A compile-time constant needs no
 * boot to be known, so nothing is gained by deferring it.
 */
let commonProps: EventProps = { version: APP_VERSION };

/** Install the boot-computed common props (see `analyticsEnrichment.ts`). Called
 *  once from the boot flow BEFORE the first event so `boot` already carries them.
 *  A later call replaces the whole set. Copied so a caller that later mutates the
 *  object it passed cannot rewrite what every event carries. Passing `{}` clears
 *  them (the session reset does this to keep tests isolated). */
export function setCommonProps(props: EventProps): void {
  commonProps = { ...props };
}

/** A copy of the current common props, for a surface that sends OUTSIDE the
 *  typed gameplay vocabulary and so does not flow through `trackEvent`'s merge,
 *  namely the cookieless error reporter (`analyticsErrors.ts`): a `$exception`
 *  should carry the same build and platform context every gameplay event does.
 *
 *  Two sources, and the distinction matters to a caller reading this before
 *  boot: `version` is here from module load, while the rest
 *  (platform / distribution_channel / returning / tenure / recency / display)
 *  arrives once the boot enrichment runs. So an early crash report carries the
 *  build but not yet the buckets. Copied so a caller cannot mutate the shared
 *  set. */
export function getCommonProps(): EventProps {
  return { ...commonProps };
}

/** Hand one already-merged event to the active adapter, best-effort. Split out
 *  of {@link trackEvent} so the immediate send and a held first-run send are
 *  literally the same call, rather than two spellings that could drift. */
function deliver(name: string, props: EventProps): void {
  try {
    analyticsAdapter().send(name, props);
  } catch {
    /* best-effort telemetry; never block gameplay on it */
  }
}

/**
 * Host-gated, best-effort custom-event send. The single choke point every
 * gameplay event flows through, so the gate and the never-throw guarantee live
 * in one place. The common props are spread FIRST so a per-event prop always
 * wins on a key collision (the typed vocabulary is never shadowed by an
 * enrichment key).
 *
 * The gate saying no still means nothing is sent. The one thing that changed
 * with the desktop epic is what happens to the event afterward: a desktop build
 * whose first-run notice has not resolved HOLDS it in memory rather than
 * dropping it, so a player who says yes ten seconds into their first launch
 * still reports that first launch instead of starting the record at the click.
 * The hold is bounded and drops its oldest first, so it is that much of a
 * session rather than a guarantee about any one event (see `desktopConsent.ts`).
 * Every other dark surface
 * (localhost, the e2e preview server, the iOS shell, and a desktop player who
 * declined) falls straight through `holdWhilePending` and drops the event
 * exactly as before.
 *
 * The merge happens before the gate so a held event carries the props it had at
 * EMIT time rather than whatever the common props say when the queue flushes.
 */
export function trackEvent<K extends keyof GameplayEvents>(name: K, props: GameplayEvents[K]): void {
  const merged: EventProps = { ...commonProps, ...props };
  if (telemetryHostAllowed()) {
    deliver(name, merged);
    return;
  }
  holdWhilePending(() => deliver(name, merged));
}
