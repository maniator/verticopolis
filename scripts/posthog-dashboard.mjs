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
  "    -- distinct_id IS the per-tab session id: the ingest relay sets it from the",
  "    -- session id and sets $process_person_profile false, so no person sits",
  "    -- behind it. \"Unique users\" in this project means \"unique sessions\".",
  "    distinct_id AS session_id,",
  "    -- session_end carries a CUMULATIVE length and re-fires on every tab-hide,",
  "    -- so the largest value a session reported is its length.",
  "    max(toFloat(properties.seconds)) AS length_seconds,",
  "    -- True once the session reported a terminal (pagehide) row. Best-effort:",
  "    -- a session killed outright never sends one, which is why the length above",
  "    -- reads max() rather than filtering on this.",
  "    max(properties.final = true) AS saw_final,",
  "    count() AS rows_reported,",
  "    min(timestamp) AS first_reported_at,",
  "    max(timestamp) AS ended_at,",
  "    argMax(properties.version, timestamp) AS version,",
  "    argMax(properties.platform, timestamp) AS platform",
  "FROM events",
  "WHERE event = 'session_end'",
  "  AND properties.environment = 'production'",
  "  AND toFloat(properties.seconds) IS NOT NULL",
  "GROUP BY distinct_id",
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
 *  `session_end` re-fires on every tab-hide with a CUMULATIVE `seconds`, because
 *  the terminal `pagehide` is not reliably delivered and a session that only
 *  reported at its close would often report nothing at all. So one session writes
 *  several rows, and a long session writes more of them than a short one.
 *  Counting rows therefore overcounts sessions (3,343 rows for 919 sessions over
 *  a recent 30 days), and an event-level percentile over `seconds` is weighted by
 *  length and reads far too high (a 545s median against a real 90s).
 *
 *  Collapsing to `max(seconds)` per `distinct_id` is the fix, and it lives in one
 *  view rather than in each tile's SQL so the tiles below, and any ad-hoc query,
 *  cannot drift apart. `distinct_id` IS the per-tab session id: the relay sets it
 *  from the session id and sets `$process_person_profile` false, so "unique users"
 *  in this project means "unique sessions". */
const SESSION_LENGTHS_VIEW = {
  name: "session_lengths",
  description:
    "One row per play session, from the session_end event. session_end re-fires on every tab-hide with a cumulative seconds value (the terminal pagehide is not reliably delivered, so the re-emission is the fallback), which means counting rows overcounts sessions and an event-level percentile over seconds is weighted by session length. This view collapses that to max(seconds) per distinct_id, which is the per-tab session id because the ingest relay sets distinct_id to it and disables person profiles. Production traffic only, matching every tile on this dashboard. Filter on ended_at for a time window.",
  query: SESSION_LENGTHS_SQL,
};

/** The dashboard's insight definitions, in display order. Each mirrors what the
 *  live dashboard carries; editing here and re-running is the reproducible path. */
const INSIGHTS = [
  {
    name: "Boots, sessions & new games over time",
    description: "Daily boots, distinct sessions that ended, and new towers founded (production). The sessions series counts DISTINCT session ids, not session_end rows, which re-fire once per tab-hide.",
    // The sessions series is `dau`, i.e. distinct `distinct_id`s, which here means
    // distinct SESSIONS (the relay's distinct_id is the per-tab session id). A
    // `total` would count session_end rows, and a session writes one per tab-hide:
    // 3,343 rows for 919 sessions over a recent 30 days.
    query: trends([series("boot", "Boots"), series("session_end", "Sessions ended", "dau"), series("new_game_started", "New games")]),
  },
  {
    name: "First-tower funnel (new game → first build → 2★)",
    description: "Per-session funnel: new_game_started → first_build → star_reached (star>1), production.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        series: [
          { kind: "EventsNode", event: "new_game_started", name: "New game" },
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
    description: "Daily p50 / p90 / p95 of session length, one value per session (max seconds per session id), production, 30d. An event-level percentile over session_end.seconds reads several times too high.",
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
    description: "Total new_game_started (towers FOUNDED, not sessions: a resumed save fires no such event), production, 30d.",
    query: trends([series("new_game_started", "New games")], { display: "BoldNumber" }),
  },
  {
    name: "Sessions ended (30d)",
    description: "Distinct sessions that reported an end, production, 30d. Counts sessions, not session_end rows, which re-fire once per tab-hide and overcount by roughly 3.6x.",
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
    description: "Daily crash events split by the repeat-within-90s flag, production.",
    query: trends([series("crash", "Crashes")], { breakdown: "repeat" }),
  },
  {
    // Typed crash events, not the $exception mirror: the synthetic crash
    // reporter dedups its fingerprint once per session, so "Errors by build
    // version" undercounts; this tile counts every typed crash.
    name: "Crashes by build version",
    description: "Typed crash events by build version (each crash counts, unlike the per-session-deduped $exception mirror), production, 30d.",
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

/** Find a dashboard by exact name, or return null. */
async function findDashboard() {
  const data = await req("GET", `/dashboards/?limit=200`);
  return (data.results || []).find((d) => d.name === DASHBOARD_NAME && !d.deleted) || null;
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
  const data = await req("GET", `/warehouse_saved_queries/?limit=200`);
  const existing = (data.results || []).find((v) => v.name === spec.name && !v.deleted) || null;
  const body = { name: spec.name, description: spec.description, query: { kind: "HogQLQuery", query: spec.query } };
  if (existing) {
    await req("PATCH", `/warehouse_saved_queries/${existing.id}/`, body);
    return "updated";
  }
  await req("POST", `/warehouse_saved_queries/`, body);
  return "created";
}

async function main() {
  if (!KEY) {
    console.error("POSTHOG_PERSONAL_API_KEY is required (a phx_... personal API key). Aborting.");
    process.exit(1);
  }
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Provisioning "${DASHBOARD_NAME}" in project ${PROJECT_ID} at ${HOST}`);

  if (DRY_RUN) {
    console.log(`Would ensure the "${SESSION_LENGTHS_VIEW.name}" saved view, the dashboard, and ${INSIGHTS.length} insights:`);
    for (const i of INSIGHTS) console.log(`  - ${i.name}`);
    return;
  }

  // Ahead of the insights: two tiles select from this view by name.
  console.log(`Saved view "${SESSION_LENGTHS_VIEW.name}": ${await ensureView(SESSION_LENGTHS_VIEW)}`);

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
