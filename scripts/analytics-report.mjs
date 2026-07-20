#!/usr/bin/env node
/**
 * Vercel Web Analytics rollup for Verticopolis custom events.
 *
 * Pulls the custom events the game reports through `@vercel/analytics` (see
 * src/analytics.ts) from Vercel's Web Analytics API and writes two files into
 * the output directory: a human-readable `analytics-report-<date>.md` and a
 * machine-readable `analytics-report-<date>.json` that carries every raw API
 * response. The JSON is always complete even if a section fails to render, so a
 * run is never a total loss.
 *
 * Runs on plain Node (18+, uses global fetch), no dependencies. Driven by the
 * scheduled GitHub Actions workflow (.github/workflows/analytics-report.yml) or
 * locally: `VERCEL_TOKEN=... node scripts/analytics-report.mjs --days 30`.
 *
 * Plan note: grouping by custom event PROPERTIES (the `eventData/<prop>`
 * breakdowns) is a paid-plan (Vercel Pro) feature. Top-line event counts work
 * on any plan; a property breakdown that the plan does not allow is reported as
 * a skipped section with the API's reason, not a crash.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.vercel.com";
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

/** Read a `--name value` or `--name=value` CLI argument. */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

// Clamp the look-back to a sane, finite integer. A stray value (0, negative,
// non-numeric, or Infinity from something like 1e309) must never push `since`
// to an invalid Date and make day() throw, which would break the never-throw
// promise. Defaults to 30, caps at 365.
function clampDays(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : 30;
}
const DAYS = clampDays(arg("days", "30"));
const OUT_DIR = arg("out", "reports");
// Max groups an aggregate query returns. High enough that low-cardinality
// breakdowns (mode, reason, version, tool) never truncate; a high-cardinality
// one (session_end by raw seconds) can still hit it, so results flag truncation.
const ROW_LIMIT = 1000;

if (!TOKEN) {
  console.error(
    "VERCEL_TOKEN is not set. Create a token at Vercel > Account Settings > Tokens\n" +
      "and expose it as the VERCEL_TOKEN environment variable (a GitHub Actions secret in CI).",
  );
  process.exit(1);
}
if (!PROJECT_ID || !TEAM_ID) {
  console.error("VERCEL_PROJECT_ID and VERCEL_TEAM_ID must be set (plain env, not secrets).");
  process.exit(1);
}

// Web Analytics wants plain YYYY-MM-DD dates; production data only.
const day = (d) => d.toISOString().slice(0, 10);
const until = new Date();
// Inclusive date range: DAYS calendar days ending today (today plus DAYS-1
// prior), so the YYYY-MM-DD span the API sees matches the "N days" label.
const since = new Date(until.getTime() - (DAYS - 1) * 86_400_000);

/** GET a Web Analytics endpoint. Never throws: returns a tagged result so the
 *  caller can render a skipped section instead of aborting the whole report. */
async function apiGet(path, params) {
  const url = new URL(API + path);
  url.searchParams.set("teamId", TEAM_ID);
  url.searchParams.set("projectId", PROJECT_ID);
  url.searchParams.set("since", day(since));
  url.searchParams.set("until", day(until));
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  let res, text;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    text = await res.text();
  } catch (err) {
    return { ok: false, status: 0, hint: `network error: ${err.message}`, json: null };
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    // Prefer Vercel's own error text; it names the real cause (bad token vs a
    // breakdown the plan does not allow) more reliably than the status alone.
    const generic =
      res.status === 401
        ? "unauthorized (check VERCEL_TOKEN)"
        : res.status === 402
          ? "payment required (needs a higher Vercel plan)"
          : res.status === 403
            ? "forbidden (token lacks access, or a breakdown that needs Vercel Pro)"
            : `HTTP ${res.status}`;
    return { ok: false, status: res.status, hint: json?.error?.message || generic, json };
  }
  return { ok: true, status: res.status, json };
}

/** Total count of one event over the window (works on any plan). */
function eventFilter(name, extra) {
  return extra ? `eventName eq '${name}' and ${extra}` : `eventName eq '${name}'`;
}
async function countEvent(name, extra) {
  const r = await apiGet("/v1/query/web-analytics/events/count", { filter: eventFilter(name, extra) });
  return { ...r, total: r.ok ? extractCount(r.json) : null };
}

/** Rows for one event grouped by a custom property (needs Vercel Pro). */
async function aggregateEvent(name, prop) {
  const r = await apiGet("/v1/query/web-analytics/events/aggregate", {
    by: `eventData/${prop}`,
    filter: eventFilter(name),
    limit: String(ROW_LIMIT),
  });
  const rows = r.ok ? extractRows(r.json) : null;
  return { ...r, rows, truncated: !!rows && rows.length >= ROW_LIMIT };
}

/** Pull a total from the count endpoint's `data`, tolerant of shape drift. */
function extractCount(json) {
  const d = json?.data;
  if (typeof d === "number") return d;
  if (d && typeof d.count === "number") return d.count;
  if (d && typeof d.total === "number") return d.total;
  if (typeof json?.count === "number") return json.count;
  if (typeof json?.total === "number") return json.total;
  if (Array.isArray(d)) return d.reduce((s, r) => s + (r.count ?? r.total ?? 0), 0);
  return null;
}

/** Normalize aggregate `data: [{ eventData, count, visitors }]` into rows. */
function extractRows(json) {
  const arr = Array.isArray(json?.data) ? json.data : null;
  if (!arr) return null;
  return arr
    .map((r) => ({
      key: String(r.eventData ?? r.key ?? r.value ?? "(unknown)"),
      count: Number(r.count ?? r.total ?? 0),
      visitors: Number(r.visitors ?? 0),
    }))
    .sort((a, b) => b.count - a.count);
}

const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));
const pct = (num, den) => (den ? `${((num / den) * 100).toFixed(1)}%` : "n/a");

/** Render an aggregate result as a markdown table, or a skipped-section note. */
function renderRows(res, valueHeader) {
  if (res.ok && res.rows && res.rows.length) {
    const lines = [`| ${valueHeader} | Events | Visitors |`, "| --- | ---: | ---: |"];
    for (const r of res.rows) lines.push(`| ${r.key} | ${fmt(r.count)} | ${fmt(r.visitors)} |`);
    if (res.truncated) lines.push(`\n_Showing the top ${fmt(ROW_LIMIT)} groups; more may exist._`);
    return lines.join("\n");
  }
  if (res.ok) return "_No data in this window._";
  return `_Skipped: ${res.hint}._`;
}

/** Sum aggregate rows (used to bucket session length client-side). */
function bucketSeconds(res) {
  if (!res.ok || !res.rows) return null;
  const buckets = { "0-30s": 0, "30s-2m": 0, "2-10m": 0, "10m+": 0 };
  for (const r of res.rows) {
    const s = Number(r.key);
    if (!Number.isFinite(s)) continue; // skip an unparseable seconds group, don't misbucket it
    const b = s < 30 ? "0-30s" : s < 120 ? "30s-2m" : s < 600 ? "2-10m" : "10m+";
    buckets[b] += r.count;
  }
  return buckets;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const raw = {};
  const q = async (label, promise) => {
    const r = await promise;
    raw[label] = r.json ?? { status: r.status, hint: r.hint };
    return r;
  };

  // Top-line totals (plan-independent).
  const gameStarted = await q("game_started", countEvent("game_started"));
  const firstBuild = await q("first_build", countEvent("first_build"));
  const starReached = await q("star_reached", countEvent("star_reached"));
  const sessionEnd = await q("session_end", countEvent("session_end"));
  const bootTotal = await q("boot", countEvent("boot"));
  const crashTotal = await q("crash", countEvent("crash"));
  const updateTotal = await q("update", countEvent("update"));

  // Property breakdowns (Vercel Pro).
  const toolMix = await q("tool_used_by_tool", aggregateEvent("tool_used", "tool"));
  const starDist = await q("star_reached_by_star", aggregateEvent("star_reached", "star"));
  const bootByStar = await q("boot_by_star", aggregateEvent("boot", "star"));
  const bootByMode = await q("boot_by_mode", aggregateEvent("boot", "mode"));
  const bootByReason = await q("boot_by_reason", aggregateEvent("boot", "reason"));
  const bootByVersion = await q("boot_by_version", aggregateEvent("boot", "version"));
  const sessionBySeconds = await q("session_end_by_seconds", aggregateEvent("session_end", "seconds"));
  const crashByRepeat = await q("crash_by_repeat", aggregateEvent("crash", "repeat"));
  const crashByRecovery = await q("crash_by_recoveryFailed", aggregateEvent("crash", "recoveryFailed"));
  const crashByVersion = await q("crash_by_version", aggregateEvent("crash", "version"));
  const updateByTo = await q("update_by_to", aggregateEvent("update", "to"));

  const buckets = bucketSeconds(sessionBySeconds);
  const crashPerBoot = bootTotal.total ? pct(crashTotal.total ?? 0, bootTotal.total) : "n/a";

  const md = [
    `# Verticopolis analytics report`,
    ``,
    `Window: **${day(since)} to ${day(until)}** (${DAYS} days), production only.`,
    `Generated ${until.toISOString()}.`,
    ``,
    `> Property breakdowns (the tables below) need a Vercel Pro plan; on Hobby they`,
    `> show as skipped. Top-line counts work on any plan.`,
    ``,
    `## First-tower funnel`,
    ``,
    `| Step | Events |`,
    `| --- | ---: |`,
    `| Towers founded (game_started) | ${fmt(gameStarted.total)} |`,
    `| First build (first_build) | ${fmt(firstBuild.total)} |`,
    `| Star promotions (star_reached) | ${fmt(starReached.total)} |`,
    ``,
    `- Founded to first build: **${pct(firstBuild.total ?? 0, gameStarted.total ?? 0)}**`,
    ``,
    `## Engagement`,
    ``,
    `- Sessions ended (session_end): **${fmt(sessionEnd.total)}**`,
    buckets
      ? `- Foreground length: ${Object.entries(buckets).map(([k, v]) => `${k}: ${fmt(v)}`).join(", ")}` +
        (sessionBySeconds.truncated ? ` (top ${fmt(ROW_LIMIT)} second-values only)` : "")
      : `- Foreground length distribution: _unavailable (${sessionBySeconds.hint ?? "no data"})._`,
    ``,
    `## Tool mix`,
    ``,
    renderRows(toolMix, "Tool"),
    ``,
    `## Progression`,
    ``,
    `Star promotions by star:`,
    ``,
    renderRows(starDist, "Star reached"),
    ``,
    `Standing tower rating at boot:`,
    ``,
    renderRows(bootByStar, "Star"),
    ``,
    `## Boots and existing towers`,
    ``,
    `- Total boots: **${fmt(bootTotal.total)}**`,
    ``,
    `By origin (fresh / continue / update / recovery / corrupt):`,
    ``,
    renderRows(bootByReason, "Reason"),
    ``,
    `By mode:`,
    ``,
    renderRows(bootByMode, "Mode"),
    ``,
    `## Reliability`,
    ``,
    `- Crashes: **${fmt(crashTotal.total)}**  (crash-to-boot ratio: **${crashPerBoot}**)`,
    ``,
    `By repeat-within-90s:`,
    ``,
    renderRows(crashByRepeat, "Repeat"),
    ``,
    `By failed in-place recovery:`,
    ``,
    renderRows(crashByRecovery, "Recovery failed"),
    ``,
    `By build version:`,
    ``,
    renderRows(crashByVersion, "Version"),
    ``,
    `## Version adoption`,
    ``,
    `- Updates applied (update): **${fmt(updateTotal.total)}**`,
    ``,
    `Boots by build version:`,
    ``,
    renderRows(bootByVersion, "Version"),
    ``,
    `Updates by target version:`,
    ``,
    renderRows(updateByTo, "To version"),
    ``,
  ].join("\n");

  const stamp = day(until);
  const mdPath = join(OUT_DIR, `analytics-report-${stamp}.md`);
  const jsonPath = join(OUT_DIR, `analytics-report-${stamp}.json`);
  writeFileSync(mdPath, md);
  writeFileSync(
    jsonPath,
    JSON.stringify({ window: { since: day(since), until: day(until), days: DAYS }, raw }, null, 2),
  );
  console.log(md);
  console.log(`\nWrote ${mdPath} and ${jsonPath}`);
}

main().catch((err) => {
  console.error("Report failed:", err);
  process.exit(1);
});
