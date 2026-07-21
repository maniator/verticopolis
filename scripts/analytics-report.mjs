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
// Max groups an aggregate query returns. 100 is the API's hard cap (a larger
// value is a 400). Low-cardinality breakdowns (mode, reason, version, tool,
// star) stay well under it; only session_end by raw seconds can reach it, so
// results flag truncation.
const ROW_LIMIT = 100;
// --demo renders the report from built-in sample data with no API calls, so the
// layout and styling can be previewed without a token or any real traffic.
const DEMO = process.argv.includes("--demo");

if (!DEMO && !TOKEN) {
  console.error(
    "VERCEL_TOKEN is not set. Create a token at Vercel > Account Settings > Tokens\n" +
      "and expose it as the VERCEL_TOKEN environment variable (a GitHub Actions secret in CI).\n" +
      "Or pass --demo to render sample data with no API calls.",
  );
  process.exit(1);
}
if (!DEMO && (!PROJECT_ID || !TEAM_ID)) {
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

// Self-contained styles for the HTML report. No external assets. The palette,
// font, and bevels mirror the game's own design tokens (src/styles/retro-tokens
// .css: the Windows 3.1 / SimTower look), copied here as literal values rather
// than imported, because this is a headless, build-free CI script. Keep in sync
// with that file if the theme changes. This commits to the retro look (one
// theme), so no dark-mode variant.
const HTML_STYLE = `
:root {
  --face:#c0c0c0; --shadow:#808080; --dark:#000; --light:#dfdfdf; --hi:#fff;
  --title:#000080; --title-fg:#fff; --ink:#000; --desktop:#008080;
  --muted:#2f2f38; --line:#7a7a7a;
  --font:"MS Sans Serif","Tahoma","Geneva","Segoe UI",sans-serif;
  --bevel-out: inset -1px -1px var(--dark), inset 1px 1px var(--hi), inset -2px -2px var(--shadow), inset 2px 2px var(--light);
  --bevel-in: inset 1px 1px var(--dark), inset -1px -1px var(--hi), inset 2px 2px var(--shadow), inset -2px -2px var(--light);
}
* { box-sizing:border-box; }
body { margin:0; padding:24px; background:var(--desktop); color:var(--ink); font:13px/1.45 var(--font); }
.wrap { max-width:900px; margin:0 auto; background:var(--face); box-shadow:var(--bevel-out); padding:3px; }
.titlebar { background:var(--title); color:var(--title-fg); padding:5px 9px; display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.titlebar h1 { margin:0; font-size:14px; font-weight:700; }
.titlebar .sub { color:#c9c9ff; font-size:11px; }
.body { padding:14px; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:14px; }
.kpi { background:var(--face); box-shadow:var(--bevel-out); padding:10px 12px; }
.kpi-v { font-size:22px; font-weight:700; font-variant-numeric:tabular-nums; }
.kpi-k { color:var(--muted); font-size:11px; margin-top:2px; }
.highlights { list-style:none; padding:0; margin:0 0 18px; display:grid; gap:6px; }
.highlights li { display:flex; justify-content:space-between; gap:12px; background:var(--face); box-shadow:var(--bevel-in); padding:6px 12px; }
.highlights b { font-variant-numeric:tabular-nums; }
section { margin-bottom:18px; }
section h2 { font-size:13px; margin:0 0 8px; background:var(--title); color:var(--title-fg); padding:3px 9px; }
h3 { font-size:12px; color:var(--muted); margin:12px 0 5px; font-weight:700; }
.scroll { overflow-x:auto; box-shadow:var(--bevel-in); background:#fff; }
table { width:100%; border-collapse:collapse; background:#fff; }
th, td { text-align:left; padding:5px 10px; border-bottom:1px solid #d5d5d5; }
tr:last-child td { border-bottom:0; }
thead th { background:var(--face); color:var(--ink); font-weight:700; font-size:11px; border-bottom:1px solid var(--shadow); }
td.n, th.n { text-align:right; font-variant-numeric:tabular-nums; }
.empty { color:var(--muted); background:var(--face); box-shadow:var(--bevel-in); padding:8px 12px; margin:6px 0; }
.note { color:var(--muted); font-size:11px; margin:5px 2px; }
footer { color:var(--muted); font-size:11px; text-align:center; margin-top:20px; padding:10px; box-shadow:var(--bevel-in); background:var(--face); }
`;

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** One breakdown table as HTML, or an empty/skipped note. */
function htmlTable(t) {
  const cap = t.caption ? `<h3>${escapeHtml(t.caption)}</h3>` : "";
  const res = t.res;
  if (res.ok && res.rows && res.rows.length) {
    const body = res.rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.key)}</td><td class="n">${fmt(r.count)}</td><td class="n">${fmt(r.visitors)}</td></tr>`,
      )
      .join("");
    const trunc = res.truncated ? `<p class="note">Showing the top ${fmt(ROW_LIMIT)} groups; more may exist.</p>` : "";
    return `${cap}<div class="scroll"><table><thead><tr><th>${escapeHtml(t.header)}</th><th class="n">Events</th><th class="n">Visitors</th></tr></thead><tbody>${body}</tbody></table></div>${trunc}`;
  }
  const msg = res.ok ? "No data in this window." : `Skipped: ${escapeHtml(res.hint ?? "error")}`;
  return `${cap}<p class="empty">${msg}</p>`;
}

/** The full self-contained HTML report. */
function renderHtml(m) {
  const kpis = m.kpis
    .map(([k, v]) => `<div class="kpi"><div class="kpi-v">${fmt(v)}</div><div class="kpi-k">${escapeHtml(k)}</div></div>`)
    .join("");
  const highlights = m.highlights
    .map(([k, v]) => `<li><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></li>`)
    .join("");
  const sections = m.sections
    .map((s) => `<section><h2>${escapeHtml(s.title)}</h2>${s.tables.map(htmlTable).join("")}</section>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verticopolis analytics</title><style>${HTML_STYLE}</style></head>
<body><div class="wrap">
<div class="titlebar"><h1>Verticopolis analytics</h1>
<span class="sub">${escapeHtml(m.window.since)} to ${escapeHtml(m.window.until)} &middot; ${m.window.days} days &middot; production</span></div>
<div class="body">
<div class="kpis">${kpis}</div>
<ul class="highlights">${highlights}</ul>
${sections}
<footer>Vercel Web Analytics &middot; Events = total custom events, Visitors = unique visitors &middot; generated ${escapeHtml(m.generated)}</footer>
</div>
</div></body></html>`;
}

/** The markdown report, from the same model as the HTML. */
function renderMarkdown(m) {
  const lines = [
    `# Verticopolis analytics report`,
    ``,
    `Window: **${m.window.since} to ${m.window.until}** (${m.window.days} days), production only.`,
    `Generated ${m.generated}.`,
    ``,
    `> Property breakdowns (the tables) need a Vercel Pro plan; on a lower plan they show as skipped.`,
    ``,
    `## Totals`,
    ``,
    `| Metric | Value |`,
    `| --- | ---: |`,
    ...m.kpis.map(([k, v]) => `| ${k} | ${fmt(v)} |`),
    ``,
    ...m.highlights.map(([k, v]) => `- ${k}: **${v}**`),
    ``,
  ];
  for (const s of m.sections) {
    lines.push(`## ${s.title}`, ``);
    for (const t of s.tables) {
      if (t.caption) lines.push(`${t.caption}:`, ``);
      lines.push(renderRows(t.res, t.header), ``);
    }
  }
  return lines.join("\n");
}

/** Built-in sample results for --demo, shaped exactly like the real query
 *  returns, so the same model and renderers exercise a populated report. */
function demoData() {
  const n = (total) => ({ ok: true, total });
  const rows = (pairs) => ({ ok: true, truncated: false, rows: pairs.map(([key, count, visitors]) => ({ key: String(key), count, visitors })) });
  return {
    gameStarted: n(1240),
    firstBuild: n(1012),
    starReached: n(438),
    sessionEnd: n(3120),
    bootTotal: n(5400),
    crashTotal: n(37),
    updateTotal: n(214),
    toolMix: rows([["office", 820, 410], ["fast food", 560, 300], ["floor", 540, 295], ["condo", 300, 180], ["elevator", 260, 170], ["restaurant", 190, 120]]),
    starDist: rows([["2", 260, 190], ["3", 110, 90], ["4", 48, 40], ["5", 20, 18]]),
    bootByStar: rows([["1", 2600, 1400], ["2", 1500, 900], ["3", 800, 520], ["4", 350, 240], ["5", 150, 110]]),
    bootByMode: rows([["classic", 3800, 1900], ["modern", 1600, 1000]]),
    bootByReason: rows([["continue", 2600, 1500], ["fresh", 2100, 2100], ["update", 480, 360], ["recovery", 140, 120], ["corrupt", 80, 70]]),
    bootByVersion: rows([["1.69.1", 3200, 1700], ["1.69.0", 1500, 900], ["1.68.0", 700, 500]]),
    sessionBySeconds: { ok: true, truncated: true, rows: [["12", 180, 140], ["45", 220, 170], ["90", 260, 190], ["300", 300, 210], ["720", 180, 150], ["1500", 90, 80]].map(([key, count, visitors]) => ({ key, count, visitors })) },
    crashByRepeat: rows([["false", 30, 27], ["true", 7, 6]]),
    crashByRecovery: rows([["false", 25, 22], ["true", 12, 11]]),
    crashByVersion: rows([["1.69.1", 20, 18], ["1.69.0", 12, 11], ["1.68.0", 5, 5]]),
    updateByTo: rows([["1.69.1", 130, 110], ["1.69.0", 84, 70]]),
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const raw = {};
  let results;
  if (DEMO) {
    results = demoData();
    raw.demo = "sample data (no API calls)";
  } else {
    const q = async (label, promise) => {
      const r = await promise;
      raw[label] = r.json ?? { status: r.status, hint: r.hint };
      return r;
    };
    results = {
      // Top-line totals (plan-independent).
      gameStarted: await q("game_started", countEvent("game_started")),
      firstBuild: await q("first_build", countEvent("first_build")),
      starReached: await q("star_reached", countEvent("star_reached")),
      sessionEnd: await q("session_end", countEvent("session_end")),
      bootTotal: await q("boot", countEvent("boot")),
      crashTotal: await q("crash", countEvent("crash")),
      updateTotal: await q("update", countEvent("update")),
      // Property breakdowns (Vercel Pro).
      toolMix: await q("tool_used_by_tool", aggregateEvent("tool_used", "tool")),
      starDist: await q("star_reached_by_star", aggregateEvent("star_reached", "star")),
      bootByStar: await q("boot_by_star", aggregateEvent("boot", "star")),
      bootByMode: await q("boot_by_mode", aggregateEvent("boot", "mode")),
      bootByReason: await q("boot_by_reason", aggregateEvent("boot", "reason")),
      bootByVersion: await q("boot_by_version", aggregateEvent("boot", "version")),
      sessionBySeconds: await q("session_end_by_seconds", aggregateEvent("session_end", "seconds")),
      crashByRepeat: await q("crash_by_repeat", aggregateEvent("crash", "repeat")),
      crashByRecovery: await q("crash_by_recoveryFailed", aggregateEvent("crash", "recoveryFailed")),
      crashByVersion: await q("crash_by_version", aggregateEvent("crash", "version")),
      updateByTo: await q("update_by_to", aggregateEvent("update", "to")),
    };
  }
  const {
    gameStarted, firstBuild, starReached, sessionEnd, bootTotal, crashTotal, updateTotal,
    toolMix, starDist, bootByStar, bootByMode, bootByReason, bootByVersion,
    sessionBySeconds, crashByRepeat, crashByRecovery, crashByVersion, updateByTo,
  } = results;

  const buckets = bucketSeconds(sessionBySeconds);
  const crashPerBoot = bootTotal.total ? pct(crashTotal.total ?? 0, bootTotal.total) : "n/a";
  const lengthText = buckets
    ? Object.entries(buckets).map(([k, v]) => `${k}: ${fmt(v)}`).join(" / ") +
      (sessionBySeconds.truncated ? ` (top ${fmt(ROW_LIMIT)} second-values)` : "")
    : `unavailable (${sessionBySeconds.hint ?? "no data"})`;

  // One model feeds both the markdown and the HTML, so they never drift.
  const model = {
    window: { since: day(since), until: day(until), days: DAYS },
    generated: until.toISOString(),
    kpis: [
      ["Towers founded", gameStarted.total],
      ["First builds", firstBuild.total],
      ["Star promotions", starReached.total],
      ["Sessions", sessionEnd.total],
      ["Boots", bootTotal.total],
      ["Crashes", crashTotal.total],
      ["Updates", updateTotal.total],
    ],
    highlights: [
      ["Founded to first build", pct(firstBuild.total ?? 0, gameStarted.total ?? 0)],
      ["Crash to boot ratio", crashPerBoot],
      ["Foreground length", lengthText],
    ],
    sections: [
      { title: "Tool mix", tables: [{ header: "Tool", res: toolMix }] },
      {
        title: "Progression",
        tables: [
          { caption: "Star promotions by star", header: "Star reached", res: starDist },
          { caption: "Standing tower rating at boot", header: "Star", res: bootByStar },
        ],
      },
      {
        title: "Boots and existing towers",
        tables: [
          { caption: "By origin (fresh / continue / update / recovery / corrupt)", header: "Reason", res: bootByReason },
          { caption: "By mode", header: "Mode", res: bootByMode },
        ],
      },
      {
        title: "Reliability",
        tables: [
          { caption: "By repeat within 90s", header: "Repeat", res: crashByRepeat },
          { caption: "By failed in-place recovery", header: "Recovery failed", res: crashByRecovery },
          { caption: "By build version", header: "Version", res: crashByVersion },
        ],
      },
      {
        title: "Version adoption",
        tables: [
          { caption: "Boots by build version", header: "Version", res: bootByVersion },
          { caption: "Updates by target version", header: "To version", res: updateByTo },
        ],
      },
    ],
  };

  const stamp = day(until);
  const mdPath = join(OUT_DIR, `analytics-report-${stamp}.md`);
  const htmlPath = join(OUT_DIR, `analytics-report-${stamp}.html`);
  const jsonPath = join(OUT_DIR, `analytics-report-${stamp}.json`);
  const md = renderMarkdown(model);
  writeFileSync(mdPath, md);
  writeFileSync(htmlPath, renderHtml(model));
  writeFileSync(jsonPath, JSON.stringify({ window: model.window, raw }, null, 2));
  console.log(md);
  console.log(`\nWrote ${mdPath}, ${htmlPath}, and ${jsonPath}`);
}

main().catch((err) => {
  console.error("Report failed:", err);
  process.exit(1);
});
