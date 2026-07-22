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

/** A trends insight source (event counts / breakdowns / percentiles over time). */
function trends(series, { breakdown, display = "ActionsLineGraph", breakdownLimit } = {}) {
  const source = {
    kind: "TrendsQuery",
    series,
    dateRange: LAST_30D,
    interval: "day",
    properties: PROD_ONLY,
    trendsFilter: { display },
  };
  if (breakdown) {
    source.breakdownFilter = { breakdowns: [{ property: breakdown, type: "event" }] };
    if (breakdownLimit) source.breakdownFilter.breakdown_limit = breakdownLimit;
  }
  return { kind: "InsightVizNode", source };
}

/** One event series node. `math` may be a count math ("total"/"dau") or a
 *  property percentile ("median"/"p90"/"p95") paired with `prop`. */
function series(event, name, math = "total", prop) {
  const node = { kind: "EventsNode", event, name, math };
  if (prop) node.math_property = prop;
  return node;
}

/** The dashboard's insight definitions, in display order. Each mirrors what the
 *  live dashboard carries; editing here and re-running is the reproducible path. */
const INSIGHTS = [
  {
    name: "Boots, sessions & new games over time",
    description: "Daily boot, session_end, and game_started counts (production).",
    query: trends([series("boot", "Boots"), series("session_end", "Sessions ended"), series("game_started", "New games")]),
  },
  {
    name: "First-tower funnel (new game → first build → 2★)",
    description: "Per-session funnel: game_started → first_build → star_reached (star>1), production.",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        series: [
          { kind: "EventsNode", event: "game_started", name: "New game" },
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
    description: "Exact p50 / p90 / p95 of session_end.seconds (production).",
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "TrendsQuery",
        series: [
          series("session_end", "p50", "median", "seconds"),
          series("session_end", "p90", "p90", "seconds"),
          series("session_end", "p95", "p95", "seconds"),
        ],
        dateRange: LAST_30D,
        interval: "day",
        properties: PROD_ONLY,
        trendsFilter: { display: "ActionsLineGraph", aggregationAxisFormat: "duration" },
      },
    },
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
  { name: "New games started (30d)", description: "Total game_started, production, 30d.", query: trends([series("game_started", "New games")], { display: "BoldNumber" }) },
  { name: "Sessions ended (30d)", description: "Total session_end, production, 30d.", query: trends([series("session_end", "Sessions ended")], { display: "BoldNumber" }) },
  { name: "Platform table", description: "Boots by platform as a table, production, 30d.", query: trends([series("boot", "Boots")], { breakdown: "platform", display: "ActionsTable" }) },
  { name: "Tool usage table", description: "tool_used by tool as a table, production, 30d.", query: trends([series("tool_used", "Tool used")], { breakdown: "tool", display: "ActionsTable", breakdownLimit: 25 }) },
  { name: "Boot reason table", description: "Boots by reason as a table, production, 30d.", query: trends([series("boot", "Boots")], { breakdown: "reason", display: "ActionsTable" }) },
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

async function main() {
  if (!KEY) {
    console.error("POSTHOG_PERSONAL_API_KEY is required (a phx_... personal API key). Aborting.");
    process.exit(1);
  }
  console.log(`${DRY_RUN ? "[dry-run] " : ""}Provisioning "${DASHBOARD_NAME}" in project ${PROJECT_ID} at ${HOST}`);

  if (DRY_RUN) {
    console.log(`Would ensure the dashboard and ${INSIGHTS.length} insights:`);
    for (const i of INSIGHTS) console.log(`  - ${i.name}`);
    return;
  }

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
