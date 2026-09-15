#!/usr/bin/env node
/**
 * Provision the Verticopolis "Gameplay Analytics" PostHog dashboard from code, so
 * the dashboard the game reports into is reproducible and reviewable rather than
 * a pile of hand-clicked insights. Idempotent: it finds the dashboard and each
 * insight by name and creates or updates in place, so re-running it converges the
 * live dashboard to the definitions below without duplicating tiles.
 *
 * Runs on plain Node (18+, global fetch), no dependencies. Env:
 *   POSTHOG_PERSONAL_API_KEY  (required)  a personal API key with insight:read,
 *                                         insight:write, dashboard:read,
 *                                         dashboard:write (a phx_... key, NOT the
 *                                         phc_... ingest key).
 *   POSTHOG_PROJECT_ID        (default 524085)  the verticopolis project.
 *   POSTHOG_HOST              (default https://us.posthog.com)  US Cloud app host.
 *
 * Usage: POSTHOG_PERSONAL_API_KEY=phx_... node scripts/posthog-dashboard.mjs
 * Pass --dry-run to print the plan without writing.
 *
 * All insights filter to environment=production (per the spec: preview traffic
 * lands in the same project tagged environment=preview but never blends into the
 * production numbers). GeoIP is disabled at the relay, so there are no geo tiles.
 * The event vocabulary mirrors src/analytics.ts (GameplayEvents).
 */

const HOST = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "524085";
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

const DASHBOARD_NAME = "Verticopolis: Gameplay Analytics";
const TAG = "analytics-migration";
/** The one filter every insight carries: production only. */
const PROD_ONLY = [{ key: "environment", operator: "exact", type: "event", value: ["production"] }];
const LAST_30D = { date_from: "-30d" };

/** A trends insight source (event counts / breakdowns / percentiles over time).
 *  `where` adds event-property filters on top of the production filter, e.g.
 *  restricting `app_action` to a subset of action names. */
function trends(series, { breakdown, display = "ActionsLineGraph", breakdownLimit, where } = {}) {
  const source = {
    kind: "TrendsQuery",
    series,
    dateRange: LAST_30D,
    interval: "day",
    properties: where ? [...PROD_ONLY, ...where] : PROD_ONLY,
    trendsFilter: { display },
  };
  if (breakdown) {
    // A single property name, or an array for a multi-dimensional breakdown
    // (e.g. emergency_choice by kind x decision as a 2x2 table).
    const props = Array.isArray(breakdown) ? breakdown : [breakdown];
    source.breakdownFilter = { breakdowns: props.map((property) => ({ property, type: "event" })) };
    if (breakdownLimit) source.breakdownFilter.breakdown_limit = breakdownLimit;
  }
  return { kind: "InsightVizNode", source };
}

/** An event-property filter for a `where` clause (a subset of `action` values).
 *  Works for any event carrying an `action` property (app_action and the #611
 *  economy_action alike). */
function inAction(values) {
  return { key: "action", operator: "exact", type: "event", value: values };
}

/** A `where` clause keeping only events whose numeric `prop` exceeds `n`
 *  (e.g. session_emergencies with at least one fire, for the "% of sessions with
 *  a fire" numerator). */
function whereGt(prop, n) {
  return { key: prop, operator: "gt", type: "event", value: n };
}

/** One event series node. `math` may be a count math ("total"/"dau") or a
 *  property percentile ("median"/"p90"/"p95") paired with `prop`. */
function series(event, name, math = "total", prop) {
  const node = { kind: "EventsNode", event, name, math };
  if (prop) node.math_property = prop;
  return node;
}

/** The body of the session_lengths view, kept as an array so the SQL editor
 *  renders it as readable multi-line SQL rather than one long line. */
const SESSION_LENGTHS_SQL = [
  "SELECT",
  "    session_id,",
  "    -- Total foreground play across every page life this session id covers. A",
  "    -- reading followed by a SMALLER one ends a page life (the clock restarted),",
  "    -- as does the last reading, so the peaks are the per-life lengths and their",
  "    -- sum is the session's real length.",
  "    arraySum(arrayMap((x, i) -> if(i = length(readings) OR readings[i + 1] < x, x, 0), readings, arrayEnumerate(readings))) AS length_seconds,",
  "    -- What a plain max(seconds) would have reported: the longest single page",
  "    -- life. Kept so the two are comparable rather than silently different.",
  "    arrayMax(readings) AS longest_life_seconds,",
  "    -- How many page lives this session id covers. 1 for a session that never",
  "    -- reloaded, which is about 92% of them.",
  "    arrayCount((x, i) -> i = length(readings) OR readings[i + 1] < x, readings, arrayEnumerate(readings)) AS page_lives,",
  "    length(readings) AS rows_reported,",
  "    saw_final,",
  "    first_reported_at,",
  "    ended_at,",
  "    version,",
  "    platform",
  "FROM (",
  "    SELECT",
  "        -- distinct_id IS the per-tab session id: the ingest relay sets it from",
  "        -- the session id and sets $process_person_profile false, so no person",
  "        -- sits behind it. \"Unique users\" here means \"unique sessions\".",
  "        distinct_id AS session_id,",
  "        -- Every reported length, oldest first. Cumulative WITHIN a page life and",
  "        -- back to 0 after a reload, which is what the peak walk above keys on.",
  "        arrayMap(t -> assumeNotNull(t.2), arraySort(t -> t.1, groupArray(tuple(timestamp, toFloat(properties.seconds))))) AS readings,",
  "        -- Did any page life report a terminal (pagehide) row. Best-effort: a",
  "        -- session killed outright never sends one, which is why the lengths",
  "        -- above never filter on it. False for every row written before the flag",
  "        -- shipped on 2026-09-14.",
  "        coalesce(max(properties.final = true), false) AS saw_final,",
  "        min(timestamp) AS first_reported_at,",
  "        max(timestamp) AS ended_at,",
  "        argMax(properties.version, timestamp) AS version,",
  "        argMax(properties.platform, timestamp) AS platform",
  "    FROM events",
  "    WHERE event = 'session_end'",
  "      AND properties.environment = 'production'",
  "      AND toFloat(properties.seconds) IS NOT NULL",
  "      -- Bounded so a tile refresh does not re-group all history. Comfortably",
  "      -- wider than the 30-day windows the tiles ask for.",
  "      AND timestamp >= now() - INTERVAL 180 DAY",
  "    GROUP BY distinct_id",
  ")",
].join("\n");

/** A SQL insight source, for the questions the trends builder cannot express.
 *  `display` picks the visualization; `chartSettings` maps result columns onto the
 *  axes for a graph (a table or a single number needs neither). */
function hogql(query, { display = "ActionsTable", chartSettings } = {}) {
  const node = { kind: "DataVisualizationNode", source: { kind: "HogQLQuery", query }, display };
  if (chartSettings) node.chartSettings = chartSettings;
  return node;
}

/** The saved view the session-length tiles read instead of the raw event.
 *
 *  Two separate things make a naive read of `session_end` wrong, and the view
 *  exists so the correction is written once rather than in each tile's SQL.
 *
 *  First, it RE-FIRES on every tab-hide with a CUMULATIVE `seconds`, because the
 *  terminal `pagehide` is not reliably delivered and a session that only reported
 *  at its close would often report nothing at all. So one session writes several
 *  rows, and a long session writes more of them than a short one. Counting rows
 *  overcounts sessions, and an event-level percentile over `seconds` is weighted
 *  by the very thing it is measuring.
 *
 *  Second, and less obvious: the session id lives in `sessionStorage` and
 *  DELIBERATELY survives a same-tab reload (see `analyticsRelay.ts`), so an
 *  "Update now" reload or a WebGL crash-recovery reload keeps one `distinct_id`
 *  while the page's clock restarts at 0. One session id therefore covers several
 *  page lives, and a plain `max(seconds)` would report only the longest of them.
 *  `length_seconds` sums each page life's final reading instead; measured over a
 *  recent 30 days that is about 8% of sessions and 13% of total play time, and it
 *  lands on the update and crash-recovery cohort specifically.
 *
 *  `distinct_id` IS the per-tab session id: the relay sets it from the session id
 *  and sets `$process_person_profile` false, so "unique users" in this project
 *  means "unique sessions". */
const SESSION_LENGTHS_VIEW = {
  name: "session_lengths",
  description:
    "One row per play session, from the session_end event. Two things make a naive read wrong. (1) session_end re-fires on every tab-hide with a cumulative seconds value, because the terminal pagehide is not reliably delivered, so counting rows overcounts sessions and an event-level percentile is weighted by session length. (2) The session id lives in sessionStorage and deliberately survives a same-tab reload (an Update now reload, a WebGL crash-recovery reload), so one session id spans several page lives whose clocks each restart at 0, and a plain max() would report only the longest life. length_seconds therefore sums each page life's final reading; longest_life_seconds and page_lives expose the difference. Production traffic only. Filter on ended_at for a time window.",
  query: SESSION_LENGTHS_SQL,
};

/** The action the new-tower tiles count, instead of either bare event name.
 *
 *  `game_started` was renamed to `new_game_started` on 2026-09-14. Pointing the
 *  tiles at the new name alone would have been wrong twice over: every founding
 *  before that date is stored under the OLD name, so a 30-day window would read
 *  near zero and then climb, and the game ships as a PWA / TWA / bundled iOS
 *  build, so clients on a cached build keep sending the old name for as long as
 *  they take to update. An action ORs the two, so history and not-yet-updated
 *  clients both count and the rename is invisible to every tile.
 *
 *  Drop the `game_started` step once no build that emits it is still in the
 *  wild. */
const NEW_GAME_ACTION = {
  name: "New game started (either event name)",
  description:
    "A fresh tower was founded. Matches BOTH new_game_started (the current name) and game_started (the name used until 2026-09-14), because all history sits under the old name and cached PWA/TWA/iOS clients keep sending it until they update. Use this instead of either bare event for any new-tower count. Retire the game_started step once no build that emits it is still in the wild.",
  steps: [{ event: "new_game_started" }, { event: "game_started" }],
};

/** One action series node, for a tile that counts an action rather than a
 *  single event name. */
function actionSeries(id, name, math = "total") {
  return { kind: "ActionsNode", id, name, math };
}

/** The dashboard's insight definitions, in display order. Each mirrors what the
 *  live dashboard carries; editing here and re-running is the reproducible path. */
function buildInsights(ids) {
  return [
    {
      name: "Boots, sessions & new games over time",
      description:
        "Daily boots, distinct sessions that ended, and towers founded (production). Sessions counts DISTINCT session ids, not session_end rows, which re-fire once per tab-hide. New games counts the action spanning both event names across the 2026-09-14 rename.",
      // The sessions series is `dau`, i.e. distinct `distinct_id`s, which here means
      // distinct SESSIONS (the relay's distinct_id is the per-tab session id). A
      // `total` would count session_end rows, and a session writes one per tab-hide.
      query: trends([series("boot", "Boots"), series("session_end", "Sessions ended", "dau"), actionSeries(ids.newGame, "New games")]),
    },
    {
      name: "First-tower funnel (new game → first build → 2★)",
      description:
        "Per-session funnel: new game → first_build → star_reached (star>1), production. Step 1 is the action spanning both new-game event names, so the funnel keeps working across the 2026-09-14 rename.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "FunnelsQuery",
          series: [
            { kind: "ActionsNode", id: ids.newGame, name: "New game" },
            { kind: "EventsNode", event: "first_build", name: "First build" },
            {
              kind: "EventsNode",
              event: "star_reached",
              name: "Reached 2 stars",
              properties: [{ key: "star", operator: "gt", type: "event", value: 1 }],
            },
          ],
          dateRange: LAST_30D,
          properties: PROD_ONLY,
          funnelsFilter: {
            funnelOrderType: "ordered",
            funnelVizType: "steps",
            funnelWindowInterval: 14,
            funnelWindowIntervalUnit: "day",
          },
        },
      },
    },
    {
      name: "Platform breakdown (boots)",
      description: "Boots by platform (web / twa / ios), production. Resolves AUD-036.",
      query: trends([series("boot", "Boots")], { breakdown: "platform", display: "ActionsPie" }),
    },
    {
      name: "Boot reason (continue / fresh / update / recovery / corrupt)",
      description: "Boots by reason, production.",
      query: trends([series("boot", "Boots")], { breakdown: "reason", display: "ActionsBar" }),
    },
    {
      name: "Returning vs new (boots)",
      description: "Boots split by the on-device returning flag, production.",
      query: trends([series("boot", "Boots")], { breakdown: "returning", display: "ActionsPie" }),
    },
    {
      name: "Tenure buckets (boots)",
      description: "Boots by tenure bucket (d0 / d1-6 / d7-29 / d30+), production.",
      query: trends([series("boot", "Boots")], { breakdown: "tenure", display: "ActionsBar" }),
    },
    {
      name: "Return-recency buckets (boots)",
      description: "Boots by return-recency bucket (1d / 7d / 30d / 30d+), production.",
      query: trends([series("boot", "Boots")], { breakdown: "recency", display: "ActionsBar" }),
    },
    {
      name: "Session length percentiles (seconds)",
      description:
        "Daily p50 / p90 / p95 of session length, one value per session, production, 30d. An event-level percentile over session_end.seconds reads several times too high. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      // Over the session_lengths view, not the raw event: the percentiles have to be
      // taken over one length PER SESSION. Taken over session_end rows they are
      // weighted by how many times each session reported, which is itself a function
      // of length, so long sessions count many times and short ones once.
      query: hogql(
        [
          "SELECT",
          "    toStartOfDay(ended_at) AS day,",
          "    round(quantile(0.5)(length_seconds)) AS p50_sec,",
          "    round(quantile(0.9)(length_seconds)) AS p90_sec,",
          "    round(quantile(0.95)(length_seconds)) AS p95_sec,",
          "    count() AS sessions",
          "FROM session_lengths",
          "WHERE ended_at >= now() - INTERVAL 30 DAY",
          "GROUP BY day",
          "ORDER BY day",
        ].join("\n"),
        {
          display: "ActionsLineGraph",
          chartSettings: {
            xAxis: { column: "day" },
            yAxis: [
              { column: "p50_sec", settings: { display: { label: "p50" } } },
              { column: "p90_sec", settings: { display: { label: "p90" } } },
              { column: "p95_sec", settings: { display: { label: "p95" } } },
            ],
            showLegend: true,
          },
        },
      ),
    },
    {
      name: "Session FPS percentiles (median & worst-frame)",
      description: "Median of session_fps.p50 and worst-frame session_fps.low (production). Frame health (#538).",
      query: trends(
        [series("session_fps", "Typical fps (median of p50)", "median", "p50"), series("session_fps", "Worst-frame fps (median of low)", "median", "low")],
        { display: "ActionsLineGraph" },
      ),
    },
    {
      name: "Session depth: builds & peak floor (p50 / p90)",
      description: "Per-session build volume and peak floor percentiles (production).",
      query: trends(
        [
          series("session_builds", "Builds p50", "median", "builds"),
          series("session_builds", "Builds p90", "p90", "builds"),
          series("session_peak_floors", "Peak floor p50", "median", "floors"),
          series("session_peak_floors", "Peak floor p90", "p90", "floors"),
        ],
        { display: "ActionsLineGraph" },
      ),
    },
    {
      name: "Tool adoption (first use per session)",
      description: "tool_used events by tool, production.",
      query: trends([series("tool_used", "Tool used")], { breakdown: "tool", display: "ActionsBar", breakdownLimit: 25 }),
    },
    {
      name: "Star ratings reached",
      description: "star_reached events by star level (2-6), production.",
      query: trends([series("star_reached", "Star reached")], { breakdown: "star", display: "ActionsBar" }),
    },
    // Table + KPI tiles for precise at-a-glance numbers.
    { name: "Boots (30d)", description: "Total boot events, production, 30d.", query: trends([series("boot", "Boots")], { display: "BoldNumber" }) },
    { name: "Distinct play sessions (30d)", description: "Unique per-tab session ids, production, 30d.", query: trends([series("boot", "Play sessions", "dau")], { display: "BoldNumber" }) },
    {
      name: "New games started (30d)",
      description:
        "Towers FOUNDED in the last 30 days, production. Counts the new-game action, which spans both event names, so history and not-yet-updated clients both count. Not a session count: a resumed save fires no such event.",
      query: trends([actionSeries(ids.newGame, "New games")], { display: "BoldNumber" }),
    },
    {
      name: "Sessions ended (30d)",
      // A SQL tile takes its window from its own text, not from the dashboard's
      // date filter, so this one stays at 30 days if that filter is moved.
      description:
        "Distinct sessions that reported an end, production, 30d. Counts sessions from the session_lengths view, not session_end rows, which re-fire once per tab-hide. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      query: hogql(["SELECT count() AS sessions", "FROM session_lengths", "WHERE ended_at >= now() - INTERVAL 30 DAY"].join("\n"), { display: "BoldNumber" }),
    },
    { name: "Platform table", description: "Boots by platform as a table, production, 30d.", query: trends([series("boot", "Boots")], { breakdown: "platform", display: "ActionsTable" }) },
    { name: "Tool usage table", description: "tool_used by tool as a table, production, 30d.", query: trends([series("tool_used", "Tool used")], { breakdown: "tool", display: "ActionsTable", breakdownLimit: 25 }) },
    { name: "Boot reason table", description: "Boots by reason as a table, production, 30d.", query: trends([series("boot", "Boots")], { breakdown: "reason", display: "ActionsTable" }) },
    // Version adoption and crash reliability: the last two sections the retired
    // Vercel report carried that had no dashboard tile, added at the D-1 cutover
    // so nothing the report answered went dark.
    {
      name: "Version adoption (boots by build version)",
      description: "Boots broken down by the build version prop, production, 30d.",
      query: trends([series("boot", "Boots")], { breakdown: "version", display: "ActionsTable", breakdownLimit: 10 }),
    },
    {
      // The update event fires before the activating reload and survives a failed
      // activation (see updateFlow.ts), so it counts attempts. The closest
      // applied-count signal is the post-reload boot with reason=update, next
      // tile (approximate in both directions; see its comment).
      name: "Update attempts by target version",
      description: "Update attempts (emitted before the activating reload; a failed activation still counts) by target version, production, 30d.",
      query: trends([series("update", "Update attempts")], { breakdown: "to", display: "ActionsTable", breakdownLimit: 10 }),
    },
    {
      // An approximate applied-updates signal, bounded in neither direction: a
      // successful activation can boot as continue/fresh (private-mode storage
      // failure) or corrupt (save precedence), undercounting, and a manual
      // reload inside the 30s resume window can boot the OLD build with
      // reason=update, overcounting (see updateFlow.ts and appBoot.ts).
      name: "Update-reason boots by version",
      description: "Boots with reason=update by the build version booted into, production, 30d. Approximate applied-updates signal: reclassification undercounts, and a manual reload in the resume window can count the old build.",
      query: trends([series("boot", "Update boots")], {
        breakdown: "version",
        display: "ActionsTable",
        breakdownLimit: 10,
        where: [{ key: "reason", operator: "exact", type: "event", value: ["update"] }],
      }),
    },
    {
      name: "Crashes over time (by repeat)",
      description:
        "Daily crash events split by the repeat-within-90s flag, production. Since 2026-09-14 crash is capped and deduped per session (one event per distinct crash shape, at most 10), so counts before and after that date are not comparable.",
      query: trends([series("crash", "Crashes")], { breakdown: "repeat" }),
    },
    {
      // Typed crash events, not the $exception mirror. Both are deduped per
      // session now, but on different keys: the mirror pins ONE fingerprint for
      // every WebGL loss, while the typed event keys on the crash's full flag
      // set, so it still separates a failed recovery from a clean one and a
      // loop from a one-off. Neither counts occurrences.
      name: "Crashes by build version",
      description:
        "Typed crash events by build version, production, 30d. Deduped per session on the crash's flag set since 2026-09-14 (finer than the $exception mirror's single fingerprint, but still not an occurrence count), so counts before and after that date are not comparable.",
      query: trends([series("crash", "Crashes")], { breakdown: "version", display: "ActionsTable", breakdownLimit: 10 }),
    },
    // Reliability / error tracking. $exception is the cookieless error signal
    // (uncaught JS errors + unhandled rejections + synthetic WebGL-crash events);
    // the typed `crash` event keeps the structured crash-recovery detail.
    {
      name: "JavaScript errors over time",
      description: "Daily $exception count (uncaught errors, rejections, and WebGL crashes), production.",
      query: trends([series("$exception", "Errors")]),
    },
    {
      name: "Errors by type",
      description: "$exception by top-level $exception_type (TypeError / WebGLContextLost / ...), production.",
      query: trends([series("$exception", "Errors")], { breakdown: "$exception_type", display: "ActionsBar", breakdownLimit: 25 }),
    },
    {
      name: "Top error issues",
      description: "$exception grouped by $exception_fingerprint (the distinct issues), production.",
      query: trends([series("$exception", "Errors")], { breakdown: "$exception_fingerprint", display: "ActionsTable", breakdownLimit: 50 }),
    },
    {
      name: "Errors by platform",
      description: "$exception by platform (web / twa / ios), production.",
      query: trends([series("$exception", "Errors")], { breakdown: "platform", display: "ActionsPie" }),
    },
    {
      name: "Errors by build version",
      description: "$exception by build version, so a regression in a new build is visible, production.",
      query: trends([series("$exception", "Errors")], { breakdown: "version", display: "ActionsTable" }),
    },
    { name: "Errors (30d)", description: "Total $exception events, production, 30d.", query: trends([series("$exception", "Errors")], { display: "BoldNumber" }) },
    {
      name: "WebGL crashes by recovery outcome",
      description: "The typed crash event split by whether in-place recovery failed (structured crash detail), production.",
      query: trends([series("crash", "Crashes")], { breakdown: "recoveryFailed", display: "ActionsBar" }),
    },
    // App-chrome actions (the app_action event). COOKIELESS: every tile here is
    // per-session and cohort, never per-person. "8% of sessions exported, more
    // among returning desktop players" is answerable; "who are my power users" is
    // NOT, there is no cross-session identity to thread. Do not read these as
    // individuals.
    {
      name: "App actions by type",
      description: "Every app_action broken down by action (save / export / import / TDT / dialog opens / toggles / page landings), production, 30d. COOKIELESS: session counts, never individuals.",
      query: trends([series("app_action", "Actions")], { breakdown: "action", display: "ActionsTable", breakdownLimit: 40 }),
    },
    {
      name: "App actions over time",
      description: "Daily total app_action volume (app-chrome engagement), production. Cookieless session counts.",
      query: trends([series("app_action", "Actions")]),
    },
    {
      name: "Persistence actions (save / export / import / TDT)",
      description: "app_action restricted to the persistence surface, by action, production. Who saves/exports/uses the TDT round-trip, in aggregate.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [inAction(["quick_save", "save_slot", "load_slot", "delete_save", "export_save", "import_save", "export_tdt", "import_tdt"])],
      }),
    },
    {
      name: "Persistence actions by platform (cohort)",
      description: "The persistence surface split by platform, so 'who exports' reads as a cohort (web / twa / ios), production. Never a person.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "platform",
        display: "ActionsTable",
        where: [inAction(["quick_save", "save_slot", "export_save", "import_save", "export_tdt", "import_tdt"])],
      }),
    },
    {
      name: "Standalone page landings (help & gallery)",
      description: "Landings on the /help and /gallery pages (app_action page_help / page_gallery), production. These pages report nowhere else in PostHog.",
      query: trends([series("app_action", "Landings")], { breakdown: "action", display: "ActionsBar", where: [inAction(["page_help", "page_gallery"])] }),
    },
    {
      name: "Mute toggles by state",
      description: "app_action mute split by the new state (on / off), so the share of sessions that play muted is visible, production.",
      query: trends([series("app_action", "Mute toggles")], { breakdown: "detail", display: "ActionsPie", where: [inAction(["mute"])] }),
    },
    // Gameplay economy + emergencies (#611: economy_action, emergency_choice,
    // session_emergencies). COOKIELESS: every tile is per-session and cohort,
    // never per-person. "12% of sessions demolished something" is answerable;
    // "which player bulldozed" is NOT. No currency amounts are ever collected.
    {
      name: "Economy actions by type",
      description: "economy_action broken down by action: demolish (per action) vs the latched price_tune / capacity_tune bits, production, 30d. COOKIELESS session counts.",
      query: trends([series("economy_action", "Economy actions")], { breakdown: "action", display: "ActionsTable", breakdownLimit: 10 }),
    },
    {
      name: "Demolitions: sell vs bulldoze",
      description: "economy_action demolish split by method (sell / bulldoze), production. Does removal happen via the editor Sell or the bulldozer.",
      query: trends([series("economy_action", "Demolitions")], { breakdown: "detail", display: "ActionsPie", where: [inAction(["demolish"])] }),
    },
    {
      name: "Emergency choices (kind x decision)",
      description: "emergency_choice as a 2x2 of kind (fireRescue / bombThreat) by decision (accept / decline), production. Do players pay for fire rescue but decline bomb threats. Only real clicks count; a timed-out auto-decline reports nothing.",
      query: trends([series("emergency_choice", "Choices")], { breakdown: ["kind", "decision"], display: "ActionsTable", breakdownLimit: 10 }),
    },
    {
      name: "Per-session emergency severity (avg)",
      description: "session_emergencies averaged per session: mean fire outbreaks, rooms gutted by fire, and bomb detonations, production. Emitted every session (zeros included), so this is a true per-session mean.",
      query: trends(
        [
          series("session_emergencies", "Avg fires", "avg", "fires"),
          series("session_emergencies", "Avg rooms gutted", "avg", "firesGutRooms"),
          series("session_emergencies", "Avg bombs", "avg", "bombs"),
        ],
        { display: "ActionsBar" },
      ),
    },
    {
      name: "Sessions with a fire (30d)",
      description: "session_emergencies with at least one fire, production, 30d. The numerator for 'fraction of sessions that had a fire' (divide by total session_emergencies, which is emitted once per played session).",
      query: trends([series("session_emergencies", "Sessions with a fire")], { display: "BoldNumber", where: [whereGt("fires", 0)] }),
    },
    {
      name: "Sessions reporting emergencies (30d)",
      description: "Total session_emergencies, production, 30d. Emitted once per played session (zeros included), so it is the denominator for the fire / bomb rates.",
      query: trends([series("session_emergencies", "Sessions")], { display: "BoldNumber" }),
    },
  ];
}

const api = (path) => `${HOST}/api/projects/${PROJECT_ID}${path}`;

async function req(method, path, body) {
  const res = await fetch(api(path), {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/** Every page of a listing endpoint, following `next` until it runs out. A
 *  find-by-name that reads only the first page silently stops being idempotent
 *  once the project grows past it, and creates a duplicate instead of updating. */
async function listAll(path) {
  const out = [];
  let next = `${path}${path.includes("?") ? "&" : "?"}limit=200`;
  // Bounded so a malformed or cyclic `next` cannot spin forever.
  for (let page = 0; next && page < 25; page++) {
    const data = await req("GET", next);
    out.push(...(data.results || []));
    // The API returns an absolute URL; reduce it to the path this helper takes.
    next = data.next ? data.next.replace(api(""), "") : null;
  }
  return out;
}

/** Find a dashboard by exact name, or return null. */
async function findDashboard() {
  return (await listAll(`/dashboards/`)).find((d) => d.name === DASHBOARD_NAME && !d.deleted) || null;
}

/** Find a saved insight by exact name, or return null. */
async function findInsight(name) {
  const data = await req("GET", `/insights/?limit=1&search=${encodeURIComponent(name)}`);
  return (data.results || []).find((i) => i.name === name && !i.deleted) || null;
}

/** Create or update the saved view the SQL tiles read, matched by exact name. A
 *  view is referenced BY NAME from HogQL, so it has to exist before an insight
 *  that selects from it runs; provisioning it here keeps the whole dashboard
 *  reproducible from this one script rather than half of it from the SQL editor. */
async function ensureView(spec) {
  const existing = (await listAll(`/warehouse_saved_queries/`)).find((v) => v.name === spec.name && !v.deleted) || null;
  const body = { name: spec.name, description: spec.description, query: { kind: "HogQLQuery", query: spec.query } };
  if (existing) {
    // A query edit needs the revision it was based on, so a concurrent edit in
    // the SQL editor is rejected rather than silently overwritten.
    if (existing.latest_history_id) body.edited_history_id = existing.latest_history_id;
    await req("PATCH", `/warehouse_saved_queries/${existing.id}/`, body);
    return "updated";
  }
  await req("POST", `/warehouse_saved_queries/`, body);
  return "created";
}

/** Create or update the action the new-tower tiles count, matched by exact name.
 *  Returns its id, which `buildInsights` needs for those tiles' series. */
async function ensureAction(spec) {
  const existing = (await listAll(`/actions/`)).find((a) => a.name === spec.name && !a.deleted) || null;
  const body = { name: spec.name, description: spec.description, steps: spec.steps };
  if (existing) {
    await req("PATCH", `/actions/${existing.id}/`, body);
    return { id: existing.id, outcome: "updated" };
  }
  const created = await req("POST", `/actions/`, body);
  return { id: created.id, outcome: "created" };
}

async function main() {
  if (!KEY) {
    console.error("POSTHOG_PERSONAL_API_KEY is required (a phx_... personal API key). Aborting.");
    process.exit(1);
  }
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Provisioning "${DASHBOARD_NAME}" in project ${PROJECT_ID} at ${HOST}`);

  if (DRY_RUN) {
    // Ids only matter to the live run; a placeholder is enough to list names.
    const planned = buildInsights({ newGame: 0 });
    console.log(
      `Would ensure the "${NEW_GAME_ACTION.name}" action, the "${SESSION_LENGTHS_VIEW.name}" saved view, the dashboard, and ${planned.length} insights:`,
    );
    for (const i of planned) console.log(`  - ${i.name}`);
    return;
  }

  // Both run AHEAD of the insights, because tiles reference them: the action by
  // id, the view by name from inside HogQL.
  //
  // The view is best-effort on purpose. It is one object that two of ~35 tiles
  // read, and the endpoint can refuse for reasons that have nothing to do with
  // this dashboard (a key without warehouse scope, a plan without saved
  // queries, a self-hosted host that does not expose them). Letting that abort
  // the run would refresh zero tiles over one optional object, so it warns and
  // carries on; the two SQL tiles then show the view's own error, which names
  // the cause far better than a dead script does. The action is NOT best-effort:
  // three tiles reference it by id and there is no sensible id to invent.
  const action = await ensureAction(NEW_GAME_ACTION);
  console.log(`Action "${NEW_GAME_ACTION.name}": ${action.outcome} (id ${action.id})`);
  try {
    console.log(`Saved view "${SESSION_LENGTHS_VIEW.name}": ${await ensureView(SESSION_LENGTHS_VIEW)}`);
  } catch (err) {
    console.warn(`WARNING: could not provision the "${SESSION_LENGTHS_VIEW.name}" view (${err.message || err}).`);
    console.warn("The two session-length tiles will not resolve until it exists. Every other tile is unaffected.");
  }

  const INSIGHTS = buildInsights({ newGame: action.id });

  let dashboard = await findDashboard();
  if (!dashboard) {
    dashboard = await req("POST", `/dashboards/`, {
      name: DASHBOARD_NAME,
      description:
        "Cookieless PostHog analytics for Verticopolis (rule D-1). Filtered to environment=production. Provisioned by scripts/posthog-dashboard.mjs.",
      pinned: true,
      tags: ["verticopolis", "gameplay", TAG],
    });
    console.log(`Created dashboard ${dashboard.id}`);
  } else {
    console.log(`Found dashboard ${dashboard.id}`);
  }

  let created = 0;
  let updated = 0;
  for (const spec of INSIGHTS) {
    const existing = await findInsight(spec.name);
    if (existing) {
      const dashboards = Array.from(new Set([...(existing.dashboards || []), dashboard.id]));
      await req("PATCH", `/insights/${existing.id}/`, {
        query: spec.query,
        description: spec.description,
        dashboards,
      });
      updated++;
    } else {
      await req("POST", `/insights/`, {
        name: spec.name,
        description: spec.description,
        query: spec.query,
        dashboards: [dashboard.id],
      });
      created++;
    }
  }
  console.log(`Insights: ${created} created, ${updated} updated. Dashboard: ${HOST}/project/${PROJECT_ID}/dashboard/${dashboard.id}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
