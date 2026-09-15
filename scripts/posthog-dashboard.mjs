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
  "    -- Foreground play across the page lives this session id covers, as a LOWER",
  "    -- BOUND. A reading followed by a STRICTLY SMALLER one ends a page life (the",
  "    -- clock restarted), as does the last reading, so the peaks are per-life",
  "    -- lengths and their sum is the session. Strictly, because the terminal row",
  "    -- makes a repeated reading routine within ONE life (hide then pagehide in",
  "    -- the same rounded second), and <= would split that in two and double it.",
  "    -- The price is that a reload whose next life reaches the previous length OR",
  "    -- MORE is invisible, equality included, which is the likelier half for short",
  "    -- repeatable lives such as a crash loop. Over a recent 30 days, 129 of 919",
  "    -- sessions reloaded (boot fires once per page life) and this walk sees 77;",
  "    -- that 77 is itself a floor for the same reason. Cross-checked against a",
  "    -- boot-partitioned sum: a plain max() loses about 15% of the true total,",
  "    -- this walk recovers about 13 of those points, and the residual 2% did not",
  "    -- justify joining boot into this view.",
  "    arraySum(arrayMap((x, i) -> if(i = length(readings) OR readings[i + 1] < x, x, 0), readings, arrayEnumerate(readings))) AS length_seconds,",
  "    -- What a plain max(seconds) would have reported: the longest single page",
  "    -- life. Kept so the two are comparable rather than silently different, and",
  "    -- so the gap between them is readable per session.",
  "    arrayMax(readings) AS longest_life_seconds,",
  "    -- Page lives VISIBLE to the walk above, which is neither a floor nor a",
  "    -- ceiling. It reads 1 for a session that never reloaded (86% of them) and",
  "    -- also for a reload whose next life matched or outlived the previous one.",
  "    -- It can also read HIGH without any reload: a desktop consent flip restarts",
  "    -- this clock inside one page life (GameplaySession.startEpoch), which looks",
  "    -- exactly like a reload from here. Counting boot per session id is the true",
  "    -- page-life figure, so compare the two rather than trusting either alone.",
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
  "        -- Did any page life report a pagehide row. Best-effort and coarse: a",
  "        -- session killed outright never sends one and a bfcache entry sends one",
  "        -- early, which is why the lengths above never filter on it. False for",
  "        -- every row written before the flag shipped on 2026-09-14. The bare",
  "        -- `= true` is deliberate: the relay sends `final` as a JSON boolean and",
  "        -- it lands as Nullable(Bool), so this compares cleanly (checked against",
  "        -- the `returning` prop, which is the same shape); a missing key is NULL",
  "        -- and max() skips it, hence the coalesce.",
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
 *  `length_seconds` sums each page life's final reading instead. Against the
 *  boot-partitioned total (the closest thing to truth here), a plain `max` loses
 *  about 15%; this walk recovers about 13 of those points and leaves about 2,
 *  concentrated on the update and crash-recovery cohort specifically.
 *
 *  That sum is a LOWER BOUND, not the exact length, and the difference is worth
 *  stating because this dashboard exists to stop publishing numbers that are
 *  quietly wrong. A page life is detected by its reading dropping below the
 *  previous one, so a reload whose second life runs LONGER than the first is
 *  invisible and reads as one continuous life. Measured over a recent 30 days:
 *  129 of 919 sessions reloaded (`boot` fires once per page life, which is the
 *  independent ground truth), and this heuristic sees 77 of them. A
 *  boot-partitioned sum, which is exact wherever `boot` was delivered, comes out
 *  about 2% higher in total and 1 second higher at the median (92s against 91s),
 *  so the residual did not justify joining a second event into the view.
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
      //
      // `dau` is distinct per INTERVAL, so this series does not sum to the
      // "Sessions ended (30d)" tile: a session that straddles midnight, or whose
      // id survives a reload into the next day, appears on each day it touched.
      // That is right for a daily series and wrong as a total, which is why the
      // 30-day figure is its own tile over the view rather than a sum of this one.
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
      // Not a recovery success rate, in either era. `recoveryFailed` can only be
      // true on a FIRST mid-game loss whose flush succeeded, so every later loss
      // in a loop reports false, conflating "recovery succeeded" with "recovery
      // was never attempted". Before the dedup a long loop pushed the false
      // bucket up by its occurrence count; now one looping session contributes at
      // most one row to each bucket, so the split is pulled toward 1:1 by the
      // dedup rather than by how devices behave.
      description:
        "The typed crash event split by whether in-place recovery was tried and failed, production. NOT a recovery success rate: false also covers every loss where recovery was never attempted (a repeat, a loss behind the splash, a failed flush). Deduped per session on the crash's flag set since 2026-09-14, which pulls the split toward 1:1, so counts before and after that date are not comparable.",
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
 *  once the project grows past it, and creates a duplicate instead of updating.
 *
 *  It throws rather than returning a short list on either thing that could
 *  truncate it (a `next` this helper cannot follow, or the page ceiling), because
 *  a truncated list is indistinguishable from "the object does not exist" and
 *  lands right back on the duplicate this exists to prevent. Failing loudly is
 *  the safe direction: the caller aborts instead of quietly forking the tiles. */
const MAX_LIST_PAGES = 25;
async function listAll(path) {
  const out = [];
  let next = `${path}${path.includes("?") ? "&" : "?"}limit=200`;
  for (let page = 0; ; page++) {
    const data = await req("GET", next);
    // No envelope means this helper cannot tell an empty listing from a shape it
    // does not understand, and the caller answers "nothing found" by creating a
    // duplicate. Refuse, for the same reason the truncation checks below do.
    if (!data || !Array.isArray(data.results)) {
      throw new Error(`listAll(${path}) got a response with no results array; refusing to act on it`);
    }
    out.push(...data.results);
    if (!data.next) return out;
    if (page + 1 >= MAX_LIST_PAGES) {
      throw new Error(`listAll(${path}) exceeded ${MAX_LIST_PAGES} pages; refusing to act on a truncated list`);
    }
    // The API returns an absolute URL. Reduce it to the path `req` takes, and
    // insist the reduction actually happened: on a host or prefix mismatch the
    // replace is a no-op and the next request would be built from a full URL.
    const prefix = api("");
    if (!data.next.startsWith(prefix)) {
      throw new Error(`listAll(${path}) got a next URL outside ${prefix}: ${data.next}`);
    }
    next = data.next.slice(prefix.length);
  }
}

/** Find a dashboard by exact name, or return null. */
async function findDashboard() {
  return (await listAll(`/dashboards/`)).find((d) => d.name === DASHBOARD_NAME && !d.deleted) || null;
}

/** Find a saved insight by exact name, or return null. */
async function findInsight(name) {
  // `search` is fuzzy and ranked, so the exact-name match is not guaranteed to be
  // the FIRST hit. Reading one row and then filtering for the exact name meant a
  // tile whose name merely shares words with another insight read as absent, and
  // the run created a second copy of it instead of updating. Insights are the one
  // object this script makes dozens of, so that is where a duplicate hurts most.
  const page = (await req("GET", `/insights/?limit=100&search=${encodeURIComponent(name)}`)) || {};
  const hit = (page.results || []).find((i) => i.name === name && !i.deleted) || null;
  // A truncated page is indistinguishable from "no such insight", and the caller
  // answers that by CREATING one, which forks the tile. So when the exact name is
  // not on this page and the API says there are more, refuse rather than guess.
  if (!hit && page.next) {
    throw new Error(`findInsight("${name}") did not find it in the first 100 search hits and more remain; refusing to risk a duplicate`);
  }
  return hit;
}

/** Create or update the saved view the SQL tiles read, matched by exact name. A
 *  view is referenced BY NAME from HogQL, so it has to exist before an insight
 *  that selects from it runs; provisioning it here keeps the whole dashboard
 *  reproducible from this one script rather than half of it from the SQL editor. */
/** Tag a caught failure with which branch of {@link ensureView} it came from, so
 *  the caller can say what state the view is actually in. Coerced to an Error
 *  first: an ES module is always strict mode, so assigning onto a primitive or a
 *  frozen throwable throws a TypeError, and that replacement error would carry no
 *  tag and mask the real message. Nothing in `req` throws a non-Error today; this
 *  is here so the diagnostics cannot be defeated by the one thing they exist to
 *  report on. */
function taggedViewFailure(err, viewState) {
  const tagged = err instanceof Error ? err : new Error(String(err));
  tagged.viewState = viewState;
  return tagged;
}

async function ensureView(spec) {
  let existing;
  try {
    existing = (await listAll(`/warehouse_saved_queries/`)).find((v) => v.name === spec.name && !v.deleted) || null;
  } catch (err) {
    // The listing is where the plausible refusals land (a key without warehouse
    // scope, a plan without saved queries, a host that does not expose them), and
    // from here we do not know whether a view already exists. Saying "absent"
    // would be a guess, and the wrong guess is the dangerous one.
    throw taggedViewFailure(err, "unknown");
  }
  const body = { name: spec.name, description: spec.description, query: { kind: "HogQLQuery", query: spec.query } };
  // Which branch failed matters to the caller: a failed create leaves no view and
  // two visibly broken tiles, while a failed update leaves the PREVIOUS
  // definition serving numbers that look fine and are stale. The error carries
  // the branch so the warning can say which happened.
  if (existing) {
    // A query edit carries the revision it was based on, so a concurrent edit in
    // the SQL editor is rejected rather than silently overwritten. Only when the
    // API actually reported one: without it the PATCH goes out unguarded and
    // DOES overwrite, so the protection is best-effort, not a guarantee.
    if (existing.latest_history_id) body.edited_history_id = existing.latest_history_id;
    try {
      await req("PATCH", `/warehouse_saved_queries/${existing.id}/`, body);
    } catch (err) {
      throw taggedViewFailure(err, "stale");
    }
    return "updated";
  }
  try {
    await req("POST", `/warehouse_saved_queries/`, body);
  } catch (err) {
    throw taggedViewFailure(err, "absent");
  }
  return "created";
}

/** Create or update the action the new-tower tiles count, matched by exact name.
 *  Returns its id, which `buildInsights` needs for those tiles' series. */
async function ensureAction(spec) {
  const existing = (await listAll(`/actions/`)).find((a) => a.name === spec.name && !a.deleted) || null;
  const body = { name: spec.name, description: spec.description, steps: spec.steps };
  if (existing) {
    if (existing.id == null) throw new Error(`the existing action "${spec.name}" has no id; cannot point tiles at it`);
    await req("PATCH", `/actions/${existing.id}/`, body);
    return { id: existing.id, outcome: "updated" };
  }
  const created = await req("POST", `/actions/`, body);
  // `req` returns null on a 204, and a 2xx body without `id` would yield
  // undefined, which JSON.stringify drops from the series node entirely: the
  // tiles would save clean and render nothing. Refuse instead.
  if (!created || created.id == null) {
    throw new Error(`POST /actions/ returned no id for "${spec.name}"; cannot point tiles at it`);
  }
  return { id: created.id, outcome: "created" };
}

async function main() {
  // The dry run builds its plan offline and issues no request, so it does not
  // need a credential; demanding one only blocks a reviewer previewing the plan.
  if (!KEY && !DRY_RUN) {
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
  // The view failing does not STOP the run, which is not the same as being
  // tolerated: the run still ends non-zero, because two tiles are then wrong or
  // missing and nobody should read a green exit as "the dashboard is correct".
  // What carrying on buys is the other forty-one tiles, which have nothing to do
  // with the view and would otherwise be abandoned over one object the endpoint
  // can refuse for unrelated reasons (a key without warehouse scope, a plan
  // without saved queries, a self-hosted host that does not expose them). What happens to those two tiles afterward depends on whether PostHog
  // validates their HogQL at save time, which is why the loop below handles each
  // tile separately: either they are rejected there and named as failures, or
  // they save and surface the view's own error when rendered. Both are better
  // than a dead script, and the run still exits non-zero either way. The action
  // is NOT best-effort: tiles reference it by id and there is no id to invent.
  const action = await ensureAction(NEW_GAME_ACTION);
  console.log(`Action "${NEW_GAME_ACTION.name}": ${action.outcome} (id ${action.id})`);
  let viewOk = true;
  try {
    console.log(`Saved view "${SESSION_LENGTHS_VIEW.name}": ${await ensureView(SESSION_LENGTHS_VIEW)}`);
  } catch (err) {
    viewOk = false;
    console.warn(`WARNING: could not provision the "${SESSION_LENGTHS_VIEW.name}" view (${err.message || err}).`);
    const consequence = {
      stale:
        "The view still EXISTS at its previous definition, so the two session-length tiles will render numbers computed the OLD way rather than failing visibly. Treat them as untrustworthy until this is fixed.",
      absent: "The view does not exist, so the two session-length tiles cannot resolve. Every other tile is unaffected.",
      unknown:
        "Could not even list the saved queries, so whether the view exists is unknown: the two session-length tiles are either unresolvable or serving an older definition. Check them before trusting either.",
    };
    console.warn(consequence[err.viewState] ?? consequence.unknown);
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

  // Per tile, so one rejected insight does not strand the rest. The two tiles
  // that select from the saved view are the likeliest to be rejected, if PostHog
  // validates their HogQL at save time, and they sit eighth of forty-three, so an
  // all-or-nothing loop would have refreshed almost nothing on exactly the run
  // where the view failed. Every failure is named and the run still exits
  // non-zero, so nothing passes silently.
  let created = 0;
  let updated = 0;
  const failures = [];
  for (const spec of INSIGHTS) {
    try {
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
    } catch (err) {
      failures.push(`${spec.name}: ${err.message || err}`);
    }
  }
  console.log(`Insights: ${created} created, ${updated} updated, ${failures.length} failed. Dashboard: ${HOST}/project/${PROJECT_ID}/dashboard/${dashboard.id}`);
  for (const f of failures) console.error(`  FAILED ${f}`);
  if (!viewOk || failures.length) {
    const parts = [];
    if (failures.length) parts.push(`${failures.length} insight(s) failed`);
    if (!viewOk) parts.push("the saved view did not provision");
    throw new Error(parts.join(", and "));
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
