#!/usr/bin/env node
/**
 * Add the repository's new tiles to the "Verticopolis | Gameplay Overview"
 * PostHog dashboard, without touching anything already on it. The dashboard is
 * hand-curated by the owner (names, descriptions, layout), so a run is
 * add-only (owner, 2026-11-18):
 *
 *  - Only tiles marked `overview: true` below are candidates, so the script's
 *    full tile set never lands on the dashboard.
 *  - A candidate already on the dashboard (by name) is left as it is: no rename,
 *    no new query, no new description.
 *  - A candidate whose name an insight elsewhere in the project already uses is
 *    skipped and named in the output, because adding it would mean rewriting
 *    that insight or making a second one with the same name.
 *  - Each new tile goes full width below the existing tiles. The mobile layout
 *    stacks tiles in the desktop order, so both stay readable.
 *  - The saved view and the action are created when missing and otherwise left
 *    as they are. Pass --update-view to rewrite the view from SESSION_LENGTHS_SQL;
 *    it works even when there is no tile to add, and then changes the view only.
 *  - The dashboard is never created: if it is missing (or renamed), the run stops.
 *
 * To put a new tile on the dashboard, add its spec to `buildInsights` with
 * `overview: true`, run the script, then record the short id it prints as the
 * spec's `shortId`. A spec with a short id is never added again, so a tile the
 * owner renames afterwards does not come back as a second copy. The other specs
 * stay here as the reviewed definitions of insights that already exist in
 * PostHog; this script no longer syncs them.
 *
 * Runs on plain Node (18+, global fetch), no dependencies. Env:
 *   POSTHOG_PERSONAL_API_KEY  (required)  a personal API key with insight:read,
 *                                         insight:write, dashboard:read,
 *                                         dashboard:write, action:read,
 *                                         action:write, warehouse_view:read and
 *                                         warehouse_view:write (a phx_... key,
 *                                         NOT the phc_... ingest key).
 *   POSTHOG_PROJECT_ID        (default 524085)  the verticopolis project.
 *   POSTHOG_HOST              (default https://us.posthog.com)  US Cloud app host.
 *
 * Usage: POSTHOG_PERSONAL_API_KEY=phx_... node scripts/posthog-dashboard.mjs
 * Pass --dry-run to list exactly what a run would add, and what it would leave
 * alone, without writing anything (it reads the live dashboard, so it needs the
 * key; without one it lists the candidate tiles only).
 *
 * All insights filter to environment=production (per the spec: preview traffic
 * lands in the same project tagged environment=preview but never blends into the
 * production numbers). GeoIP is disabled at the relay, so there are no geo tiles.
 * The event vocabulary mirrors src/analytics.ts (GameplayEvents).
 */

import { pathToFileURL } from "node:url";

const HOST = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "524085";
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const DRY_RUN = process.argv.includes("--dry-run");
const UPDATE_VIEW = process.argv.includes("--update-view");

/** The live dashboard's name. The owner renamed it from "Verticopolis: Gameplay
 *  Analytics" in PostHog, and the run finds the dashboard by this name, so it
 *  has to match or the run creates a second dashboard. */
const DASHBOARD_NAME = "Verticopolis | Gameplay Overview";
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
  "    -- Counting boot per session id is the true page-life figure, so compare",
  "    -- the two rather than trusting either alone.",
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
  '        -- sits behind it. "Unique users" here means "unique sessions".',
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

/** The reviewed insight definitions. Only those marked `overview: true` are
 *  added to the live dashboard (see the header); the rest record the definitions
 *  of insights that already exist in PostHog. */
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
      query: trends([
        series("boot", "Boots"),
        series("session_end", "Sessions ended", "dau"),
        actionSeries(ids.newGame, "New games"),
      ]),
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
      // #2392: the per-tower count of the funnel above. Not on the dashboard
      // yet: set `overview: true` once real rows from the first release that
      // sends tower_n have checked it. Its rules are in docs/analytics-measurement-status.md,
      // row 30.
      name: "First-tower funnel per tower (24h)",
      description:
        "Towers founded in the last 30 days (at least 24 hours ago), and how many of them laid a first build, and then reached 2 stars, within 24 hours of founding (in that order, like a funnel), production. A tower is one page life's tower_n (#2392), so a tab's second tower never finishes its first tower's funnel and an opened tower's stars finish none. A tower that climbs after a reload, or after it is opened again, is not counted. Rows from the first release that sends tower_n only; before it, the First-tower funnel tile counts per tab. Its windows are fixed in the SQL and do not follow the dashboard date filter.",
      query: hogql(
        [
          "SELECT",
          "    count() AS towers_founded,",
          "    countIf(built >= started AND built <= started + 86400) AS first_build_24h,",
          "    countIf(built >= started AND two_stars >= built AND two_stars <= started + 86400) AS two_stars_24h,",
          "    round(100 * first_build_24h / towers_founded, 1) AS first_build_pct,",
          "    round(100 * two_stars_24h / towers_founded, 1) AS two_stars_pct",
          "FROM (",
          "    SELECT",
          "        minIf(toUnixTimestamp(timestamp), event = 'new_game_started') AS started,",
          "        minIf(toUnixTimestamp(timestamp), event = 'first_build') AS built,",
          "        minIf(toUnixTimestamp(timestamp), event = 'star_reached' AND toInt(properties.star) >= 2) AS two_stars",
          "    FROM events",
          "    WHERE event IN ('new_game_started', 'first_build', 'star_reached')",
          "      AND properties.environment = 'production'",
          "      AND properties.page_life IS NOT NULL",
          "      AND toInt(properties.tower_n) BETWEEN 1 AND 49",
          "      AND timestamp >= now() - INTERVAL 31 DAY",
          "    GROUP BY properties.page_life, toInt(properties.tower_n)",
          ")",
          "WHERE started > 0",
          "  AND started >= toUnixTimestamp(now() - INTERVAL 30 DAY)",
          "  AND started <= toUnixTimestamp(now() - INTERVAL 1 DAY)",
        ].join("\n"),
      ),
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
      name: "Session FPS percentiles (median & 5th-percentile low)",
      description:
        "Median of session_fps.p50 and of session_fps.low across the rows each day (production). `low` is the 5th-percentile fps of one page life's sampled frames, a hitch signal, not its single worst frame. Observed in the field on whatever device each player has: it is not a hardware benchmark or the performance gate. From the release after 4.13.1 only frames where the simulation runs are sampled (#603); before it, paused and modal-frozen frames counted too, so compare versions on the same side of that change. The tile beside it gives the number of rows behind each day (#538, #2391).",
      query: trends(
        [
          series("session_fps", "Typical fps (median of p50)", "median", "p50"),
          series("session_fps", "5th-percentile fps (median of low)", "median", "low"),
        ],
        { display: "ActionsLineGraph" },
      ),
    },
    {
      name: "FPS reports per day",
      description:
        "How many session_fps rows arrived each day and how many sessions sent them (distinct per-tab session ids), production: the n behind the fps percentiles tile. A row is one reporting window: a page life, or the stretch after a back/forward-cache restore (#621), and it is sent only after 120 sampled frames, so short visits, killed tabs and blocked relays send none. A session that reloads sends one row per page life, so rows can outnumber sessions; it is a volume, never a coverage rate (see docs/analytics-fps-telemetry.md, #2391).",
      query: trends([series("session_fps", "FPS rows"), series("session_fps", "Sessions sending one", "dau")], {
        display: "ActionsLineGraph",
      }),
    },
    {
      name: "Session FPS by tower size and speed",
      overview: true,
      shortId: "CvqJXbSp",
      description:
        "session_fps by the session's peak population and the running game speed most sampled frames ran at (3, 15 or 50 game minutes per real second), with the median typical and 5th-percentile low fps, production, 30d. Rows from the release after 4.13.1 only: earlier rows carry no population, and from that release only frames where the simulation runs are sampled. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      query: hogql(
        [
          "SELECT",
          "    multiIf(toInt(properties.population) < 1000, '1. under 1,000', toInt(properties.population) < 5000, '2. 1,000 to 4,999', toInt(properties.population) < 10000, '3. 5,000 to 9,999', '4. 10,000 or more') AS population,",
          "    toInt(properties.speed) AS speed,",
          "    count() AS page_lives,",
          "    round(median(toFloat(properties.p50))) AS typical_fps,",
          "    round(median(toFloat(properties.low))) AS low_fps_p05",
          "FROM events",
          "WHERE event = 'session_fps'",
          "  AND properties.environment = 'production'",
          "  AND toInt(properties.population) IS NOT NULL",
          "  AND timestamp >= now() - INTERVAL 30 DAY",
          "GROUP BY population, speed",
          "ORDER BY population, speed",
        ].join("\n"),
      ),
    },
    {
      name: "Engine cost per game hour by version, tower size and speed",
      overview: true,
      shortId: "SXGRuzl0",
      description:
        "session_sim_cost: the real milliseconds the engine step took per game hour (median and p90), by version, population band and speed (3, 15 or 50 game minutes per real second), production, 30d. Each row is the band and speed its window stepped the most game time at, with that band's peak population, so towers of different sizes are never blended. Sent from the release after 4.13.1, once a visible tab has moved the clock 2 game hours at one band and speed. It depends on the player's machine, and a faster speed takes bigger steps, so compare versions within one population band and speed, and trust a row only with many page lives behind it. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      query: hogql(
        [
          "SELECT",
          "    properties.version AS version,",
          "    multiIf(toInt(properties.population) < 1000, '1. under 1,000', toInt(properties.population) < 5000, '2. 1,000 to 4,999', toInt(properties.population) < 10000, '3. 5,000 to 9,999', '4. 10,000 or more') AS population,",
          "    toInt(properties.speed) AS speed,",
          "    count() AS page_lives,",
          "    round(median(toFloat(properties.ms_per_game_hour)), 1) AS median_ms_per_game_hour,",
          "    round(quantile(0.9)(toFloat(properties.ms_per_game_hour)), 1) AS p90_ms_per_game_hour",
          "FROM events",
          "WHERE event = 'session_sim_cost'",
          "  AND properties.environment = 'production'",
          "  AND toFloat(properties.ms_per_game_hour) IS NOT NULL",
          "  AND timestamp >= now() - INTERVAL 30 DAY",
          "GROUP BY version, population, speed",
          "ORDER BY version DESC, population, speed",
        ].join("\n"),
      ),
    },
    {
      name: "Modern towers by stairs and escalators (boots)",
      description:
        "Modern sessions by the most stairs and escalators their tower held at any boot in the session (boot.flights; a session spans reloads, so this is its largest tower), with the median typical and 5th-percentile low fps those sessions reported, production, 30d. Modern has no limit on flights since 2026-11-16, and Classic keeps 64, so the rows past 64 are towers that use the change. A session with no session_fps row counts in sessions only. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      query: hogql(
        [
          "SELECT",
          "    b.bucket AS flights,",
          "    count() AS sessions,",
          "    round(medianIf(f.p50, f.p50 > 0)) AS typical_fps,",
          "    round(medianIf(f.low, f.low > 0)) AS low_fps_p05",
          "FROM (",
          "    SELECT",
          "        distinct_id,",
          "        multiIf(max(toInt(properties.flights)) <= 64, '1. 64 or fewer', max(toInt(properties.flights)) <= 200, '2. 65 to 200', '3. 201 or more') AS bucket",
          "    FROM events",
          "    WHERE event = 'boot'",
          "      AND properties.environment = 'production'",
          "      AND properties.mode = 'modern'",
          "      AND toInt(properties.flights) IS NOT NULL",
          "      AND timestamp >= now() - INTERVAL 30 DAY",
          "    GROUP BY distinct_id",
          ") AS b",
          "LEFT JOIN (",
          "    SELECT",
          "        distinct_id,",
          "        argMax(toFloat(properties.p50), timestamp) AS p50,",
          "        argMax(toFloat(properties.low), timestamp) AS low",
          "    FROM events",
          "    WHERE event = 'session_fps'",
          "      AND properties.environment = 'production'",
          "      AND timestamp >= now() - INTERVAL 30 DAY",
          "    GROUP BY distinct_id",
          ") AS f ON f.distinct_id = b.distinct_id",
          "GROUP BY flights",
          "ORDER BY flights",
        ].join("\n"),
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
      query: trends([series("tool_used", "Tool used")], {
        breakdown: "tool",
        display: "ActionsBar",
        breakdownLimit: 25,
      }),
    },
    {
      name: "Star ratings reached",
      description: "star_reached events by star level (2-6), production.",
      query: trends([series("star_reached", "Star reached")], { breakdown: "star", display: "ActionsBar" }),
    },
    {
      name: "Star-up message box",
      description:
        "The star-up message box opening (app_action star_notice), by mode and rating (detail classic-2 to modern-5), production, beside the star_reached tile above. See docs/analytics-data-map.md, The star-up message box.",
      query: trends([series("app_action", "Star-up box")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["star_notice"])],
      }),
    },
    // Table + KPI tiles for precise at-a-glance numbers.
    {
      name: "Boots (30d)",
      description: "Total boot events, production, 30d.",
      query: trends([series("boot", "Boots")], { display: "BoldNumber" }),
    },
    {
      name: "Distinct play sessions (30d)",
      description: "Unique per-tab session ids, production, 30d.",
      query: trends([series("boot", "Play sessions", "dau")], { display: "BoldNumber" }),
    },
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
      query: hogql(
        ["SELECT count() AS sessions", "FROM session_lengths", "WHERE ended_at >= now() - INTERVAL 30 DAY"].join("\n"),
        { display: "BoldNumber" },
      ),
    },
    {
      name: "Platform table",
      description: "Boots by platform as a table, production, 30d.",
      query: trends([series("boot", "Boots")], { breakdown: "platform", display: "ActionsTable" }),
    },
    {
      name: "Tool usage table",
      description: "tool_used by tool as a table, production, 30d.",
      query: trends([series("tool_used", "Tool used")], {
        breakdown: "tool",
        display: "ActionsTable",
        breakdownLimit: 25,
      }),
    },
    {
      name: "Boot reason table",
      description: "Boots by reason as a table, production, 30d.",
      query: trends([series("boot", "Boots")], { breakdown: "reason", display: "ActionsTable" }),
    },
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
      description:
        "Update attempts (emitted before the activating reload; a failed activation still counts) by target version, production, 30d.",
      query: trends([series("update", "Update attempts")], {
        breakdown: "to",
        display: "ActionsTable",
        breakdownLimit: 10,
      }),
    },
    {
      // An approximate applied-updates signal, bounded in neither direction: a
      // successful activation can boot as continue/fresh (private-mode storage
      // failure) or corrupt (save precedence), undercounting, and a manual
      // reload inside the 30s resume window can boot the OLD build with
      // reason=update, overcounting (see updateFlow.ts and appBoot.ts).
      name: "Update-reason boots by version",
      description:
        "Boots with reason=update by the build version booted into, production, 30d. Approximate applied-updates signal: reclassification undercounts, and a manual reload in the resume window can count the old build.",
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
        "Daily crash events split by the repeat-within-90s flag, production. Since 2026-09-14 crash is capped and deduped per page life (one event per distinct crash shape, at most 10 per budget; a reload, or a desktop player turning sharing off and on, starts a fresh budget under the same session id), so counts before and after that date are not comparable.",
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
        "Typed crash events by build version, production, 30d. Deduped per page life on the crash's flag set since 2026-09-14 (finer than the $exception mirror's single fingerprint, but still not an occurrence count), so counts before and after that date are not comparable.",
      query: trends([series("crash", "Crashes")], {
        breakdown: "version",
        display: "ActionsTable",
        breakdownLimit: 10,
      }),
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
      query: trends([series("$exception", "Errors")], {
        breakdown: "$exception_type",
        display: "ActionsBar",
        breakdownLimit: 25,
      }),
    },
    {
      name: "Top error issues",
      description: "$exception grouped by $exception_fingerprint (the distinct issues), production.",
      query: trends([series("$exception", "Errors")], {
        breakdown: "$exception_fingerprint",
        display: "ActionsTable",
        breakdownLimit: 50,
      }),
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
    {
      name: "Errors (30d)",
      description: "Total $exception events, production, 30d.",
      query: trends([series("$exception", "Errors")], { display: "BoldNumber" }),
    },
    {
      name: "WebGL crashes by recovery outcome",
      // Not a recovery success rate, in either era. `recoveryFailed` can only be
      // true on a FIRST loss (mid-game or behind the title screen) whose flush
      // succeeded, so every later loss
      // in a loop reports false, conflating "recovery succeeded" with "recovery
      // was never attempted". Before the dedup a long loop pushed the false
      // bucket up by its occurrence count; now one looping session contributes at
      // most one row to each bucket, so the split is pulled toward 1:1 by the
      // dedup rather than by how devices behave.
      description:
        'The typed crash event split by whether in-place recovery was tried and failed, production. NOT a recovery success rate: false also covers every loss where recovery was never attempted (a repeat or a failed flush; before the build that ships graphics_recovered, also a loss behind the title screen). Recoveries that worked are in "WebGL losses recovered in place". Deduped per page life on the crash\'s flag set since 2026-09-14, which pulls the split toward 1:1, so counts before and after that date are not comparable.',
      query: trends([series("crash", "Crashes")], { breakdown: "recoveryFailed", display: "ActionsBar" }),
    },
    {
      name: "WebGL losses recovered in place",
      description:
        "app_action graphics_recovered by where the loss happened (game: mid-game, title: behind the title screen), production, from the build that ships it (2026-11-16). One event per recovery that worked, a lower bound like every client event. Read it beside the crash event with repeat false; crash is deduped per page life on its flag set, so do not add the two as a count of first losses.",
      query: trends([series("app_action", "Recoveries")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["graphics_recovered"])],
      }),
    },
    {
      name: "Engine files from another build, reloaded",
      // A reference spec, not yet on the live Gameplay Overview. It carries no
      // `overview` mark, so the add-only sync (#2458) leaves it alone; mark it
      // when the owner wants the tile placed.
      description:
        "app_action engine_reload (detail mismatch), production, from the build that ships it (2026-11-18): a boot on a page no service worker controls, whose engine files were from another build than the page, reloaded once by itself instead of showing the stop screen. One event per reload, a lower bound like every client event. A controlled page, or a page that came back as a build the tab already reloaded from, still stops, and shows as engine_status package-mismatch with no reload event.",
      query: trends([series("app_action", "Reloads")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["engine_reload"])],
      }),
    },
    // App-chrome actions (the app_action event). COOKIELESS: every tile here is
    // per-session and cohort, never per-person. "8% of sessions exported, more
    // among returning desktop players" is answerable; "who are my power users" is
    // NOT, there is no cross-session identity to thread. Do not read these as
    // individuals.
    {
      name: "App actions by type",
      description:
        "Every app_action broken down by action (save / export / import / TDT / dialog opens / toggles / page landings), production, 30d. COOKIELESS: session counts, never individuals.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "action",
        display: "ActionsTable",
        breakdownLimit: 40,
      }),
    },
    {
      name: "App actions over time",
      description: "Daily total app_action volume (app-chrome engagement), production. Cookieless session counts.",
      query: trends([series("app_action", "Actions")]),
    },
    {
      name: "Persistence actions (save / export / import / TDT)",
      description:
        "app_action restricted to the persistence surface, by action, production. Who saves/exports/uses the TDT round-trip, in aggregate. save_slot, delete_save and rename_slot are the old numbered save slots, which no build from 4.3 sends; the My Towers tile follows them.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [
          inAction([
            "quick_save",
            "save_slot",
            "load_slot",
            "delete_save",
            "rename_slot",
            "file_save",
            "file_open",
            "export_save",
            "import_save",
            "export_tdt",
            "import_tdt",
          ]),
        ],
      }),
    },
    {
      name: "My Towers (Open, Save As, files)",
      description:
        "The My Towers folder from 4.3, by action, production: windows opened (files_open), files opened by kind (file_open), saved (file_save: new, replace, or current from File > Save), added (file_add: picked once it opened, or dropped on a window), files dropped on the game (file_dropped), renamed, duplicated, deleted, writes refused (file_failed: full or error), the one-time copy of the old save slots (files_copied), windows that opened while My Towers was still getting ready (files_waited), the questions before a replace or delete (file_ask: replace or delete), and towers picked from File > Open Recent that were gone (recent_missing: towers or folder). Codes only, never a file's name. See docs/analytics-data-map.md, My Towers.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [
          inAction([
            "files_open",
            "files_waited",
            "file_open",
            "file_save",
            "file_ask",
            "file_add",
            "file_dropped",
            "file_rename",
            "file_copy",
            "file_delete",
            "file_failed",
            "files_copied",
            "recent_missing",
          ]),
        ],
      }),
    },
    {
      name: "Towers kept when another opened",
      description:
        "app_action tower_kept split by detail, production, from 4.9.0: the tower a player left by opening another (File > Open…, New…, a picked or dropped file, or a 1994 import) was kept in its own My Towers file (file), as a new file under its name (new), offered as a download because My Towers couldn't take it (offered, then download on the click), or lost (failed). Before 4.9.0 the swap's autosave wrote over it. See docs/analytics-data-map.md, My Towers.",
      query: trends([series("app_action", "Towers kept")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["tower_kept"])],
      }),
    },
    {
      name: "Open window: where players asked for it",
      description:
        "app_action files_open split by detail, production, from 4.3: open for File > Open… in the menu, open_key for its Ctrl+O key, open_title for the title screen's Open Tower… button, recent for a tower picked from File > Open Recent (no window shows), and save_as for File > Save As…. See docs/analytics-data-map.md, My Towers.",
      query: trends([series("app_action", "Windows opened")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["files_open"])],
      }),
    },
    {
      name: "Linked folder (Open, Save As)",
      description:
        "The folder a player links on their computer in the Open and Save As windows (Chromium browsers only), by action, production: folders linked (folder_link: linked, cancel, refused), the browser's OK asked again (folder_allow: granted, denied), unlinked (folder_unlink), towers opened from it (folder_open: tower, tdt), saved into it (folder_save: new, replace, current), copied (folder_copy), failed steps (folder_failed) and the Auto-save copy turned on, off or failing (folder_mirror: on, off, failed). Codes only, never a folder's or a file's name. From a folder… in other browsers counts as file_add folder on the My Towers tile. See docs/analytics-data-map.md, Linked folder.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [
          inAction([
            "folder_link",
            "folder_allow",
            "folder_unlink",
            "folder_open",
            "folder_save",
            "folder_copy",
            "folder_failed",
            "folder_mirror",
          ]),
        ],
      }),
    },
    {
      name: "Bridge floors between rooms (Modern)",
      description:
        "Whether players turn Modern's bridging back on, production: found_bridged is the New Tower box at a Modern founding (unticked by default from 2026-11-15), auto_bridge the Settings switch, each split by its new state (on, off). See docs/analytics-data-map.md, Bridge floors between rooms.",
      query: trends([series("app_action", "Choices")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        where: [inAction(["found_bridged", "auto_bridge"])],
      }),
    },
    {
      name: "Sky bridges built (Modern)",
      description:
        "Sky bridges the Sky Bridge tool laid, production, one event per bridge: new for a fresh bridge, finish for the rest of a half bridge from a save made before the tool, restyle (from 4.14.0) for a finished bridge given a new look. Only builds from the release after 4.8 send it (the tool shipped then), so an earlier range reads Not measurable, not zero. See docs/analytics-data-map.md, Sky bridges (Modern).",
      query: trends([series("app_action", "Bridges")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["sky_bridge"])],
      }),
    },
    {
      name: "Sky bridge looks (Modern)",
      description:
        "The look each sky bridge went up in or was changed to, production, one event per bridge laid or restyled (app_action sky_bridge_look, detail = the look's name from the catalog's rules.skyBridge.looks). Restyles alone are sky_bridge detail restyle on the tile above. Only builds from 4.14.0 send it, so an earlier range reads Not measurable, not zero. See docs/analytics-data-map.md, Sky bridges (Modern).",
      overview: true,
      query: trends([series("app_action", "Bridge looks")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["sky_bridge_look"])],
      }),
    },
    {
      name: "Traffic readout taps",
      description:
        "Taps, clicks, Enter or Space on the HUD's Traffic readout while it names a floor (app_action traffic_jump), production: the view zoomed in on the worst waiting line it names. detail is the readout's level at the tap (busy, backed-up or gridlock); builds through 4.13.1 sent shafts or none instead. Only builds from the release after 4.12.0 send it, so an earlier range reads Not measurable, not zero. See docs/analytics-data-map.md, traffic_jump.",
      query: trends([series("app_action", "Taps")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["traffic_jump"])],
      }),
    },
    {
      name: "Drags stopped by a rule",
      description:
        "Releases of a drag that said why it stopped (app_action drag_stopped, #1847 and #2046), split by detail: extend (an elevator's arrow drag that stopped for any reason: a floor it can't serve, such as an unbuilt lobby or another shaft, too little money, the kind's longest span or the edge of the lot) or bulldoze (a bulldoze drag that left tiles), production. A refusal the press already said is not counted. Only builds from the release that ships it send it, so an earlier range reads Not measurable, not zero. See docs/analytics-data-map.md, Drags that stop.",
      query: trends([series("app_action", "Stopped drags")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["drag_stopped"])],
      }),
    },
    {
      name: "Persistence failures (counts, not rates)",
      description:
        "autosave_failed, load_failed, import_failed and export_failed events, by action, production (#1533, #1701). These are COUNTS. A rate needs attempts: imports have them (import_save, import_tdt) and Auto-save loads have them (load_slot plus load_failed; up to 4.2 the numbered slots counted too); autosave has none, so its rate is unavailable, and an export's attempts are sent at the click, so no export rate is printed. scripts/engine-reliability.mjs prints the rates and bounds. Only builds from 2.78.4 send the first three codes and only builds from 2.78.10 send export_failed (the tile has no version filter, so read it from the 2026-11-03 deploy), so an earlier range reads Not measurable, not zero. See docs/analytics-measurement-status.md.",
      query: trends([series("app_action", "Failures")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [inAction(["autosave_failed", "load_failed", "import_failed", "export_failed"])],
      }),
    },
    {
      name: "Import and export failures by reason",
      description:
        "import_failed and export_failed events split by reason, the closed code the engine gives a refused tower file (#2075): too_large, not_tower, damaged, newer_version, not_save, unreadable (a .TDT the reader could not walk), modern (a Modern tower cannot become a .TDT) or refused (any other refusal), or error when the engine threw or another step failed. detail still names the format (save or tdt). Production. Only builds from the release that ships it send reason, so earlier failures read as none. See docs/analytics-data-map.md.",
      query: trends([series("app_action", "Failures")], {
        breakdown: "reason",
        display: "ActionsBar",
        where: [inAction(["import_failed", "export_failed"])],
      }),
    },
    {
      name: "Persistence actions by platform (cohort)",
      description:
        "The persistence surface split by platform, so 'who exports' reads as a cohort (web / twa / ios), production. Never a person.",
      query: trends([series("app_action", "Actions")], {
        breakdown: "platform",
        display: "ActionsTable",
        where: [
          inAction(["quick_save", "save_slot", "file_save", "export_save", "import_save", "export_tdt", "import_tdt"]),
        ],
      }),
    },
    {
      name: "Standalone page landings (help, gallery & release notes)",
      description:
        "Landings on the manual (help.verticopolis.com), its release notes (help.verticopolis.com/changelog/) and /gallery (app_action page_help / page_changelog / page_gallery), production. These pages report nowhere else in PostHog.",
      query: trends([series("app_action", "Landings")], {
        breakdown: "action",
        display: "ActionsBar",
        where: [inAction(["page_help", "page_gallery", "page_changelog"])],
      }),
    },
    {
      name: "Help pages viewed",
      description:
        'Every help site page view (app_action help_page_view), split by page (detail: the page\'s path on help.verticopolis.com, home for the front page), production. Landings alone (one per visit) are in the "Standalone page landings" tile.',
      query: trends([series("app_action", "Page views")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_page_view"])],
      }),
    },
    {
      name: "Help landings by source",
      description:
        "Manual and release notes landings (app_action page_help / page_changelog) by page and by where the visit started (detail, #2037): a place in the game (game_menu, title, mode_badge, compare, welcome, update_prompt, about, inspector or stats for a problem line's Help link, help_key for F1 with no card up), game (an older build) or direct (not opened by the game), production. One per visit; older builds send no detail.",
      query: trends([series("app_action", "Landings")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        where: [inAction(["page_help", "page_changelog"])],
      }),
    },
    {
      name: "In-game Help opens",
      description:
        "The game opening the manual in a new tab (app_action help_open), split by where (detail: game_menu for Help > Player's Manual, title for the title screen's How to Play, help_key for F1 with no card up), production. Builds before #2037 send no detail. The visit the tab then makes is the \"Help landings by source\" tile.",
      query: trends([series("app_action", "Help opens")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_open"])],
      }),
    },
    {
      name: "Help links from problem lines",
      description:
        "Presses on a problem line's Help link in the game (app_action help_topic_open, #2036), split by detail: the surface (inspector for the room card, stats for Tower Statistics) then the topic (parking, recycling, noise, elevatorWaits and the rest in src/ui/helpTopics.ts), production. F1 on the room card counts as the inspector link it opens; F1 with no card up is help_open help_key.",
      query: trends([series("app_action", "Help link presses")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_topic_open"])],
      }),
    },
    {
      name: "Help menu picks",
      description:
        "Picks on the help site's menu bar (app_action help_menu_pick), split by item (detail: game, print, find, copy_link, theme_light, theme_dark, theme_auto, whats_new, report or sponsor), production.",
      query: trends([series("app_action", "Help menu picks")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_menu_pick"])],
      }),
    },
    {
      name: "Help bar presses",
      description:
        "Presses on the Help bar of a page the game opened (app_action help_bar_pick, #2035), split by detail: run (Keep my tower running), pause (Pause it) or back (Back to game), production.",
      query: trends([series("app_action", "Help bar presses")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_bar_pick"])],
      }),
    },
    {
      name: "Help site: Play and Back to game",
      description:
        "Presses on the help site's links to the game (app_action help_game_link), split by detail: bar_ or front_ (the title bar's button or the front page's Play) then play (loads the game) or back (Back to game in a tab the game opened, which closes it), production. The File menu's Play/Back to Game item is help_menu_pick game instead.",
      query: trends([series("app_action", "Game link presses")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["help_game_link"])],
      }),
    },
    {
      name: "Page not found",
      description:
        "The 404 page (app_action not_found_view, detail game or help for whose missing page it was) and where people went from it (not_found_pick, detail game, manual, changelog, rooms, close or taskbar), production. The missing address is never sent.",
      query: trends([series("app_action", "Actions")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        where: [inAction(["not_found_view", "not_found_pick"])],
      }),
    },
    {
      name: "Sponsor link taps",
      description:
        "Taps on a link to the GitHub Sponsors page (app_action sponsor_click), split by where (detail: splash for the title screen, menu for the menu bar's Help menu, help for the help site), production. The tap only: whether anyone sponsored is not known. The Android app shows no Sponsor link.",
      query: trends([series("app_action", "Sponsor taps")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["sponsor_click"])],
      }),
    },
    // The version 4 menu bar (owner, 2026-11-14): menu_open, menu_pick and
    // menu_dismiss (src/analyticsMenus.ts, docs/analytics-data-map.md "The
    // menu bar"), and the app_action codes for its windows and the welcome.
    {
      name: "Menu bar: open to pick funnel",
      description:
        "Trips into the menu bar (menu_open) that went on to a pick (menu_pick) within a minute, production. A grayed click is a pick row too, so the grayed tile below says how many went nowhere. Per session (cookieless), never a person.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "FunnelsQuery",
          series: [
            { kind: "EventsNode", event: "menu_open", name: "Opened a menu" },
            { kind: "EventsNode", event: "menu_pick", name: "Picked an item" },
          ],
          dateRange: LAST_30D,
          properties: PROD_ONLY,
          funnelsFilter: {
            funnelOrderType: "ordered",
            funnelVizType: "steps",
            funnelWindowInterval: 1,
            funnelWindowIntervalUnit: "minute",
          },
        },
      },
    },
    {
      name: "Menu bar: picks by item",
      description:
        "menu_pick split by item and grayed (true: the item was grayed out, so nothing happened), production. The command's own event (settings_open and the like) still counts its total from every surface.",
      query: trends([series("menu_pick", "Picks")], {
        breakdown: ["item", "grayed"],
        display: "ActionsTable",
        breakdownLimit: 60,
      }),
    },
    {
      name: "Menu bar: Full Screen by display mode",
      description:
        "menu_pick for Options > Full Screen (item full_screen), split by display (standalone: the installed app; browser: a tab) and state (on / off), production. From the release after 4.3.0 the installed app on a phone no longer offers it, so standalone rows come from tablets and computers only.",
      query: trends([series("menu_pick", "Full Screen picks")], {
        breakdown: ["display", "state"],
        display: "ActionsTable",
        breakdownLimit: 10,
        where: [{ key: "item", operator: "exact", type: "event", value: ["full_screen"] }],
      }),
    },
    {
      name: "Menu bar: what follows what",
      description:
        "menu_pick split by the page life's previous real pick (after) and this pick (item), production: the click path through the menus as a table. 'none' is the first pick of a page life.",
      query: trends([series("menu_pick", "Picks")], {
        breakdown: ["after", "item"],
        display: "ActionsTable",
        breakdownLimit: 100,
      }),
    },
    {
      name: "Menu bar: how menus open and close",
      description:
        "menu_open by menu and how it opened (click, keys, alt), and menu_dismiss by menu and how a trip ended with no pick (outside, escape, tab, title, blur), production.",
      query: trends([series("menu_open", "Opens"), series("menu_dismiss", "Dismissals")], {
        breakdown: ["menu", "via"],
        display: "ActionsTable",
        breakdownLimit: 40,
      }),
    },
    {
      name: "Menu bar: dismissals by how",
      description:
        "menu_dismiss split by menu and how (outside, escape, tab, title, blur), with browsed as the menus each trip looked through, production.",
      query: trends([series("menu_dismiss", "Dismissals")], {
        breakdown: ["menu", "how"],
        display: "ActionsTable",
        breakdownLimit: 40,
      }),
    },
    {
      name: "Version 4 windows and welcome",
      description:
        "app_action for the windows and cards that came with the menu bar: window_close (detail tower, bulletin or map) and window_move (tower, bulletin, map, dialog or card), bulletin_read_back (the player scrolled back through the Bulletin, once per page life, from the release after 4.8.0; from the release after 4.11.1 the Bulletin carries no meal rush lines, #2090), welcome_shown, welcome_close (detail ok, x, escape, backdrop, displaced) and welcome_link (first_tower, modes, whats_new), production.",
      query: trends([series("app_action", "Actions")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        breakdownLimit: 40,
        where: [
          inAction([
            "window_close",
            "window_move",
            "bulletin_read_back",
            "welcome_shown",
            "welcome_close",
            "welcome_link",
          ]),
        ],
      }),
    },
    {
      name: "Windows: moved, resized, minimized, maximized and closed",
      description:
        "Every window change in one table, production: desk_window (<window>_<verb>: min, restore, max, unmax, resize, first move, close) on the 1994 desk, plus window_close (a window's own ✕: tower, bulletin, map) and window_move (first drag: tower, bulletin and map off the desk; dialog and card anywhere). See docs/analytics-data-map.md.",
      query: trends([series("app_action", "Window changes")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        breakdownLimit: 100,
        where: [inAction(["desk_window", "window_close", "window_move"])],
      }),
    },
    // The 1994 desk (docs/ui/desk-windows.md): its app_action codes.
    {
      name: "The desk: windows, taskbar and Control Panel",
      description:
        "app_action for the 1994 desk on a computer: desk_shown and desk_title_shown (once per page life the desk comes up over a tower, or around the title screen), desk_window (<window>_<verb>, such as map_min, tower_max or tower_close), desk_task (a taskbar button: <window>_front, _min or _restore), desk_start_open (the Verticopolis menu opened, title or tower) and desk_start (its item), desk_tray (display or sound), desk_win_menu_open (taskbar or title_bar) and desk_win_menu (<window>_<command>), and desk_control (the Control Panel icon), production.",
      query: trends([series("app_action", "Actions")], {
        breakdown: ["action", "detail"],
        display: "ActionsTable",
        breakdownLimit: 100,
        where: [
          inAction([
            "desk_shown",
            "desk_title_shown",
            "desk_window",
            "desk_task",
            "desk_start_open",
            "desk_start",
            "desk_tray",
            "desk_win_menu_open",
            "desk_win_menu",
            "desk_control",
          ]),
        ],
      }),
    },
    {
      name: "The desk: Verticopolis menu opened to picked",
      description:
        "Sessions that opened the taskbar's Verticopolis menu (app_action desk_start_open) and then picked an item from it (desk_start) within a minute, production. A drop is a menu opened and closed again. Per session (cookieless), never a person.",
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "FunnelsQuery",
          series: [
            {
              kind: "EventsNode",
              event: "app_action",
              name: "Opened the Verticopolis menu",
              properties: [inAction(["desk_start_open"])],
            },
            { kind: "EventsNode", event: "app_action", name: "Picked an item", properties: [inAction(["desk_start"])] },
          ],
          dateRange: LAST_30D,
          properties: PROD_ONLY,
          funnelsFilter: {
            funnelOrderType: "ordered",
            funnelVizType: "steps",
            funnelWindowInterval: 1,
            funnelWindowIntervalUnit: "minute",
          },
        },
      },
    },
    {
      name: "Title screen: buttons pressed",
      description:
        "Presses on the title screen's buttons (app_action title_pick), split by detail: continue (its button, Esc or a click on the title screen's empty background), open, new, help, mute, install or sponsor, production. Each button's own event still follows (files_open open_title, help_open and the rest). A menu item that presses a title button from a script counts as the menu's pick only.",
      query: trends([series("app_action", "Title picks")], {
        breakdown: "detail",
        display: "ActionsBar",
        where: [inAction(["title_pick"])],
      }),
    },
    {
      name: "Mute toggles by state",
      description:
        "app_action mute split by the new state (on / off), so the share of sessions that play muted is visible, production.",
      query: trends([series("app_action", "Mute toggles")], {
        breakdown: "detail",
        display: "ActionsPie",
        where: [inAction(["mute"])],
      }),
    },
    // Gameplay economy + emergencies (#611: economy_action, emergency_choice,
    // session_emergencies). COOKIELESS: every tile is per-session and cohort,
    // never per-person. "12% of sessions demolished something" is answerable;
    // "which player bulldozed" is NOT. No currency amounts are ever collected.
    {
      name: "Economy actions by type",
      description:
        "economy_action broken down by action: demolish (per action; from 2.31.2 at most 40 per page in each one-minute window, so a heavy bulldozer clear is undercounted) vs the latched price_tune / capacity_tune bits, production, 30d. COOKIELESS session counts.",
      query: trends([series("economy_action", "Economy actions")], {
        breakdown: "action",
        display: "ActionsTable",
        breakdownLimit: 10,
      }),
    },
    {
      name: "Demolitions: sell vs bulldoze",
      description:
        "economy_action demolish split by method (sell / bulldoze), production. Does removal happen via the editor Sell or the bulldozer. From 2.31.2 capped at 40 per page in each one-minute window, which trims bulldoze more than sell.",
      query: trends([series("economy_action", "Demolitions")], {
        breakdown: "detail",
        display: "ActionsPie",
        where: [inAction(["demolish"])],
      }),
    },
    {
      name: "Emergency choices (kind x decision)",
      description:
        "emergency_choice as a 2x2 of kind (fireRescue / bombThreat) by decision (accept / decline), production. Do players pay for fire rescue but decline bomb threats. Only real clicks count; a timed-out auto-decline reports nothing.",
      query: trends([series("emergency_choice", "Choices")], {
        breakdown: ["kind", "decision"],
        display: "ActionsTable",
        breakdownLimit: 10,
      }),
    },
    {
      name: "Per-session emergency severity (avg)",
      description:
        "Mean fire outbreaks, rooms gutted by fire and bomb detonations per session (distinct per-tab session id), production, 30d. A session's rows are summed first: it sends one session_emergencies row per page life, and from the release after 4.13.1 one more for the play after a back/forward-cache restore (#621), and each fire lands in exactly one row, so the sum is the session's total. Zeros included, so it is a true per-session mean. Its 30-day window is fixed in the SQL and does not follow the dashboard date filter.",
      query: hogql(
        [
          "SELECT",
          "    round(avg(fires), 3) AS avg_fires,",
          "    round(avg(gutted), 3) AS avg_rooms_gutted,",
          "    round(avg(bombs), 3) AS avg_bombs,",
          "    count() AS sessions",
          "FROM (",
          "    SELECT",
          "        distinct_id,",
          "        sum(toFloat(properties.fires)) AS fires,",
          "        sum(toFloat(properties.firesGutRooms)) AS gutted,",
          "        sum(toFloat(properties.bombs)) AS bombs",
          "    FROM events",
          "    WHERE event = 'session_emergencies'",
          "      AND properties.environment = 'production'",
          "      AND timestamp >= now() - INTERVAL 30 DAY",
          "    GROUP BY distinct_id",
          ")",
        ].join("\n"),
      ),
    },
    {
      name: "Sessions with a fire (30d)",
      description:
        "Sessions (distinct per-tab session ids) with a session_emergencies row showing at least one fire, production, 30d. The numerator for 'fraction of sessions that had a fire'; the denominator is the 'Sessions reporting emergencies' tile. Counted per session, so a session that reloads, or plays on after a back/forward-cache restore (#621), still counts once. Its 30-day window is fixed in the SQL.",
      query: hogql(
        [
          "SELECT uniqIf(distinct_id, toFloat(properties.fires) > 0) AS sessions_with_a_fire",
          "FROM events",
          "WHERE event = 'session_emergencies'",
          "  AND properties.environment = 'production'",
          "  AND timestamp >= now() - INTERVAL 30 DAY",
        ].join("\n"),
        { display: "BoldNumber" },
      ),
    },
    {
      name: "How fires end",
      description:
        "fire_outcome split by outcome (security / rescue / burnedOut), production, from the release that ships #1889. One event per fire the engine reports out: security when a guard reached it, rescue when the paid helicopter landed, burnedOut when neither came. Rate-limited per page like the other gameplay events, so a lower bound.",
      query: trends([series("fire_outcome", "Fires out")], { breakdown: "outcome", display: "ActionsPie" }),
    },
    {
      name: "Sessions reporting emergencies (30d)",
      description:
        "Sessions (distinct per-tab session ids) that sent a session_emergencies row, production, 30d. Every played page life sends one (zeros included), so this is the denominator for the fire and bomb rates. Counted per session, so reloads and back/forward-cache restores (#621) do not inflate it. Its 30-day window is fixed in the SQL.",
      query: hogql(
        [
          "SELECT uniq(distinct_id) AS sessions",
          "FROM events",
          "WHERE event = 'session_emergencies'",
          "  AND properties.environment = 'production'",
          "  AND timestamp >= now() - INTERVAL 30 DAY",
        ].join("\n"),
        { display: "BoldNumber" },
      ),
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
    throw new Error(
      `findInsight("${name}") did not find it in the first 100 search hits and more remain; refusing to risk a duplicate`,
    );
  }
  return hit;
}

/** Find the saved view the SQL tiles read, by exact name, and create it when it
 *  is missing. A view is referenced BY NAME from HogQL, so it has to exist before
 *  an insight that selects from it runs. An existing view is left as it is unless
 *  the run passes --update-view: the live dashboard is hand-curated, and its
 *  session tiles read this view, so a run never changes their numbers on its own. */
async function ensureView(spec) {
  const existing = (await listAll(`/warehouse_saved_queries/`)).find((v) => v.name === spec.name && !v.deleted) || null;
  const body = { name: spec.name, description: spec.description, query: { kind: "HogQLQuery", query: spec.query } };
  if (existing && !UPDATE_VIEW) return "exists, left as is (pass --update-view to rewrite it)";
  if (DRY_RUN) return existing ? "would be rewritten (--update-view)" : "would be created";
  if (existing) {
    // A query edit carries the revision it was based on, so a concurrent edit in
    // the SQL editor is rejected rather than silently overwritten, when the API
    // reports one.
    if (existing.latest_history_id) body.edited_history_id = existing.latest_history_id;
    await req("PATCH", `/warehouse_saved_queries/${existing.id}/`, body);
    return "rewritten (--update-view)";
  }
  await req("POST", `/warehouse_saved_queries/`, body);
  return "created";
}

/** Find the action the new-tower tiles count, by exact name, and create it when
 *  it is missing. An existing action is never changed. Returns its id, which
 *  `buildInsights` needs for those tiles' series (null in a dry run that would
 *  create it). */
async function ensureAction(spec) {
  const existing = (await listAll(`/actions/`)).find((a) => a.name === spec.name && !a.deleted) || null;
  if (existing) {
    if (existing.id == null) throw new Error(`the existing action "${spec.name}" has no id; cannot point tiles at it`);
    return { id: existing.id, outcome: "exists, left as is" };
  }
  if (DRY_RUN) return { id: null, outcome: "would be created" };
  const created = await req("POST", `/actions/`, { name: spec.name, description: spec.description, steps: spec.steps });
  // `req` returns null on a 204, and a 2xx body without `id` would yield
  // undefined, which JSON.stringify drops from the series node entirely: the
  // tiles would save clean and render nothing. Refuse instead.
  if (!created || created.id == null) {
    throw new Error(`POST /actions/ returned no id for "${spec.name}"; cannot point tiles at it`);
  }
  return { id: created.id, outcome: "created" };
}

/** Rows a new tile takes on the desktop grid, unless its spec sets `height`. */
const DEFAULT_TILE_HEIGHT = 5;

/** The row just below the lowest tile that has a desktop (`sm`) box. Tiles with
 *  no box yet are left where PostHog puts them. */
function bottomRow(tiles) {
  let bottom = 0;
  for (const tile of tiles) {
    const box = tile?.layouts?.sm;
    if (tile?.deleted || !box) continue;
    bottom = Math.max(bottom, (Number(box.y) || 0) + (Number(box.h) || 0));
  }
  return bottom;
}

/** The names of the live insight tiles on a dashboard. */
function tileNames(tiles) {
  const names = new Set();
  for (const tile of tiles) {
    const name = tile?.insight?.name;
    if (name && !tile.deleted && !tile.insight.deleted) names.add(name);
  }
  return names;
}

/** Decide what a run adds to the dashboard. Pure, so it is tested without
 *  PostHog. Only specs marked `overview: true` are candidates, so the script's
 *  full tile set never lands on the hand-curated dashboard. A candidate that
 *  carries `shortId` was added already and is never added again, whatever the
 *  owner has renamed it to since: record the short id a run prints for each
 *  tile it adds. A candidate already on the dashboard (by insight name) is left
 *  alone; one whose name is taken by an insight elsewhere in the project is
 *  skipped too, because adding it would either rewrite that insight or make a
 *  second insight with the same name.
 *  Each addition goes full width below the existing tiles, one under another:
 *  full width keeps a table readable on desktop, and the mobile layout stacks
 *  tiles in the desktop order, so they land at the end there as well.
 *
 *  `existingElsewhere` is the set of candidate names found outside the
 *  dashboard. Returns `{ add: [{ spec, layout }], added, onDashboard, elsewhere }`. */
function planAdditions(specs, dashboardTiles, existingElsewhere) {
  const present = tileNames(dashboardTiles);
  const add = [];
  const added = [];
  const onDashboard = [];
  const elsewhere = [];
  let y = bottomRow(dashboardTiles);
  for (const spec of specs) {
    if (!spec.overview) continue;
    if (spec.shortId) {
      added.push(spec.name);
    } else if (present.has(spec.name)) {
      onDashboard.push(spec.name);
    } else if (existingElsewhere.has(spec.name)) {
      elsewhere.push(spec.name);
    } else {
      const h = spec.height ?? DEFAULT_TILE_HEIGHT;
      add.push({ spec, layout: { x: 0, y, w: 12, h } });
      y += h;
    }
  }
  return { add, added, onDashboard, elsewhere };
}

/** Whether a tile's query counts through an action (and so needs its id). */
function usesAction(spec) {
  return JSON.stringify(spec.query).includes('"ActionsNode"');
}

/** What a run does once it has planned. `tiles`: there is something to add, which
 *  also needs the action and the view to exist. `view`: the saved view gets
 *  checked, because new tiles read it or because --update-view asked for a
 *  rewrite; the flag works on its own, so a run with no tiles to add can still
 *  rewrite the view, and it writes no tile while doing so. */
function runSteps(plan, updateView) {
  const tiles = plan.add.length > 0;
  return { tiles, action: tiles, view: tiles || Boolean(updateView) };
}

async function main() {
  // Offline, a dry run can only list the candidates: which of them are missing
  // depends on what the live dashboard already holds.
  if (!KEY) {
    if (!DRY_RUN) {
      console.error("POSTHOG_PERSONAL_API_KEY is required (a phx_... personal API key). Aborting.");
      process.exit(1);
    }
    const candidates = buildInsights({ newGame: 0 }).filter((s) => s.overview);
    console.log(
      `[dry-run, no key] Candidate tiles for "${DASHBOARD_NAME}" (a run adds only the ones it does not already hold):`,
    );
    for (const s of candidates)
      console.log(`  - ${s.name}${s.shortId ? ` (added already as ${s.shortId}; never added again)` : ""}`);
    if (UPDATE_VIEW)
      console.log(`  --update-view: checking the saved view "${SESSION_LENGTHS_VIEW.name}" needs the key`);
    return;
  }
  const tag = DRY_RUN ? "[dry-run] " : "";
  console.log(`${tag}Adding to "${DASHBOARD_NAME}" in project ${PROJECT_ID} at ${HOST}`);

  const listed = (await listAll(`/dashboards/`)).find((d) => d.name === DASHBOARD_NAME && !d.deleted) || null;
  if (!listed) {
    throw new Error(
      `No dashboard named "${DASHBOARD_NAME}". This script only adds to an existing dashboard; if it was renamed, update DASHBOARD_NAME.`,
    );
  }
  const dashboard = await req("GET", `/dashboards/${listed.id}/`);
  const tiles = Array.isArray(dashboard?.tiles) ? dashboard.tiles : [];

  // Plan first, so a run with nothing to add makes no write at all.
  const candidates = buildInsights({ newGame: null });
  const onDashboardNames = tileNames(tiles);
  const existingElsewhere = new Set();
  for (const spec of candidates) {
    if (!spec.overview || spec.shortId || onDashboardNames.has(spec.name)) continue;
    if (await findInsight(spec.name)) existingElsewhere.add(spec.name);
  }
  const plan = planAdditions(candidates, tiles, existingElsewhere);
  for (const name of plan.added) console.log(`  added by an earlier run (short id recorded), left as is: ${name}`);
  for (const name of plan.onDashboard) console.log(`  already on the dashboard, left as is: ${name}`);
  for (const name of plan.elsewhere)
    console.log(`  SKIPPED, an insight with this name exists elsewhere in the project: ${name}`);
  for (const { spec, layout } of plan.add)
    console.log(
      `  ${DRY_RUN ? "would add" : "adding"}: ${spec.name} (full width, rows ${layout.y} to ${layout.y + layout.h})`,
    );
  const steps = runSteps(plan, UPDATE_VIEW);
  if (!steps.tiles) console.log("  nothing to add");
  if (!steps.view) return;

  // Make sure what the new tiles read exists. With nothing to add, only
  // --update-view gets here, and it touches the view alone, never a tile.
  let action = null;
  if (steps.action) {
    action = await ensureAction(NEW_GAME_ACTION);
    console.log(`${tag}Action "${NEW_GAME_ACTION.name}": ${action.outcome}`);
  }
  console.log(`${tag}Saved view "${SESSION_LENGTHS_VIEW.name}": ${await ensureView(SESSION_LENGTHS_VIEW)}`);
  if (DRY_RUN || !steps.tiles) return;
  const withAction = new Map(buildInsights({ newGame: action.id }).map((s) => [s.name, s]));
  for (const entry of plan.add) entry.spec = withAction.get(entry.spec.name) ?? entry.spec;

  const missingAction = plan.add.find(({ spec }) => usesAction(spec) && action.id == null);
  if (missingAction)
    throw new Error(`"${missingAction.spec.name}" needs the action, which has no id; nothing was added`);

  // Create every insight on the dashboard, then place the new tiles in one write.
  const created = [];
  for (const { spec, layout } of plan.add) {
    const insight = await req("POST", `/insights/`, {
      name: spec.name,
      description: spec.description,
      query: spec.query,
      dashboards: [dashboard.id],
    });
    created.push({ id: insight?.id, shortId: insight?.short_id, name: spec.name, layout });
  }
  const after = await req("GET", `/dashboards/${dashboard.id}/`);
  const placed = [];
  for (const c of created) {
    const tile = (after?.tiles || []).find((t) => t?.insight?.id === c.id);
    if (tile) placed.push({ id: tile.id, layouts: { sm: c.layout } });
    else console.warn(`  WARNING: could not find the new tile for "${c.name}"; PostHog will place it`);
  }
  if (placed.length) await req("PATCH", `/dashboards/${dashboard.id}/`, { tiles: placed });
  console.log(`Added ${created.length} tile(s). Dashboard: ${HOST}/project/${PROJECT_ID}/dashboard/${dashboard.id}`);
  console.log(
    "Record each short id on its spec as `shortId`, so a later run never adds the tile again after a rename:",
  );
  for (const c of created) console.log(`  ${c.name}: shortId "${c.shortId}"`);
}

// Run only when executed directly, so a test can import the planner without
// starting a live run.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

export { planAdditions, runSteps, bottomRow, buildInsights, DASHBOARD_NAME };
