#!/usr/bin/env node
/**
 * PostHog rollup for Verticopolis custom events (the S5 report re-target).
 *
 * The game reports its gameplay events through the cookieless same-origin relay
 * into PostHog (see src/analytics.ts and src/analyticsIngest.ts). This script
 * queries PostHog with HogQL and renders the same three outputs the Vercel
 * report did: a self-contained styled HTML file in the output directory
 * (`posthog-report-<date>.html`), a plain-markdown version appended to the
 * GitHub Actions job summary when run in CI (`$GITHUB_STEP_SUMMARY`), and the
 * raw query results printed to stdout so a run is never a total loss.
 *
 * Why a second report script rather than editing scripts/analytics-report.mjs:
 * the Vercel Web Analytics path stays live until S6 retires it, so the two run
 * side by side through the migration. This one supersedes it on precision. HogQL
 * computes EXACT percentiles (`quantile(0.5)(...)`) instead of reconstructing
 * them from a capped value histogram, and because every event now carries a
 * per-tab session id (distinct_id), it can do the per-session and per-tool
 * splits the Vercel path could not (Vercel Web Analytics has no session
 * correlation). All numbers are production only (`properties.environment`);
 * preview traffic lands in the same project tagged `preview` and never blends in.
 *
 * Runs on plain Node (18+, global fetch), no dependencies. Driven by the
 * scheduled GitHub Actions workflow (.github/workflows/analytics-report.yml) or
 * locally: `POSTHOG_PERSONAL_API_KEY=phx_... node scripts/posthog-report.mjs --window 30`.
 * The window is days by default ("30", "0.5") or takes a unit suffix ("12h",
 * "3d"); `--days` is kept as an alias for the old flag name.
 *   POSTHOG_PERSONAL_API_KEY  (required)  a personal API key with query:read (a
 *                                         phx_... key, NOT the phc_... ingest key).
 *   POSTHOG_PROJECT_ID        (default 524085)  the verticopolis project.
 *   POSTHOG_HOST              (default https://us.posthog.com)  US Cloud host.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOST = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/+$/, "");
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || "524085";
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;

/** Read a `--name value` or `--name=value` CLI argument. */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

const plural = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;

// Parse the look-back window. A plain number is days ("30", "0.5"); a unit
// suffix picks the unit ("12h", "3d"). Normalized to whole hours, so a
// half-day request really queries 12 hours instead of being discarded.
// Bounds: at least 1 hour, at most 365 days. Anything the regex rejects (or a
// value outside the bounds) throws so a bad dispatch input fails the run
// loudly; the old guard silently swapped bad values for the 30-day default,
// which turned a "0.5" request into a month of data with no warning. Only the
// interpolated INTERVAL count must stay a guarded integer, and Math.round
// keeps it one.
function parseWindow(v) {
  const bad = (why) =>
    new Error(
      `Invalid look-back window "${v}": ${why}. Use days ("30", "0.5") or a unit suffix ("12h", "3d"); minimum 1 hour, maximum 365 days.`,
    );
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(d|day|days|h|hr|hrs|hour|hours)?\s*$/i.exec(String(v));
  if (!m) throw bad("not a number with an optional d/h unit");
  const unit = (m[2] || "d")[0].toLowerCase();
  const hours = Math.round(unit === "h" ? Number(m[1]) : Number(m[1]) * 24);
  if (hours < 1) throw bad("shorter than 1 hour");
  if (hours > 365 * 24) throw bad("longer than 365 days");
  return { hours, label: hours % 24 === 0 ? plural(hours / 24, "day") : plural(hours, "hour") };
}
const WINDOW = (() => {
  try {
    return parseWindow(arg("window", null) ?? arg("days", "30"));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
const OUT_DIR = arg("out", "reports");
// --demo renders the report from built-in sample data with no API calls, so the
// layout and styling can be previewed without a key or any real traffic.
const DEMO = process.argv.includes("--demo");

/** Escape a HogQL single-quoted string literal. Every event and property name
 *  this script queries is a hardcoded constant, so this is hygiene rather than a
 *  live injection surface, but it keeps the query builders honest if the
 *  vocabulary ever grows. Backslash first so it does not double-escape the
 *  quotes it then adds. */
function lit(s) {
  return `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Fail fast when a live run is missing its key. Kept out of module load so the
 *  pure helpers can be imported (and unit-tested) without a key. */
function requireEnv() {
  if (!DEMO && !KEY) {
    console.error(
      "POSTHOG_PERSONAL_API_KEY is not set. Create a personal API key at\n" +
        "PostHog > Settings > Personal API keys (scope: query:read) and expose it\n" +
        "as POSTHOG_PERSONAL_API_KEY (a GitHub Actions secret in CI). It is the\n" +
        "phx_... personal key, not the phc_... ingest key.\n" +
        "Or pass --demo to render sample data with no API calls.",
    );
    process.exit(1);
  }
}

// The production + window guard every query shares. `hours` is a parseWindow
// integer, so interpolating it into the INTERVAL is safe. Hour granularity so
// sub-day windows ("12h", "0.5") query exactly what was asked for.
const SCOPE = (hours) => `properties.environment = 'production' AND timestamp >= now() - INTERVAL ${hours} HOUR`;

/** HogQL for the top-line event totals: one row per event with its count and the
 *  number of distinct play sessions (distinct_id) that fired it. */
function buildTotalsQuery(events, hours) {
  const list = events.map(lit).join(", ");
  return (
    `SELECT event, count() AS events, count(DISTINCT distinct_id) AS sessions ` +
    `FROM events WHERE ${SCOPE(hours)} AND event IN (${list}) GROUP BY event`
  );
}

/** HogQL for one numeric property's exact percentiles over a session-scoped
 *  event. `prop` is a hardcoded property name (seconds / builds / floors / p50 /
 *  low). Rows with a null or non-numeric property are excluded by the cast. */
function buildDepthQuery(event, prop, hours) {
  const val = `toFloat(properties.${prop})`;
  return (
    `SELECT count() AS n, quantile(0.5)(${val}) AS p50, quantile(0.9)(${val}) AS p90, ` +
    `quantile(0.95)(${val}) AS p95, max(${val}) AS mx ` +
    `FROM events WHERE ${SCOPE(hours)} AND event = ${lit(event)} AND ${val} IS NOT NULL`
  );
}

/** HogQL for one event grouped by a property: events and distinct sessions per
 *  group, most frequent first. The per-session column is the payoff over the
 *  Vercel path, which had no session id to count. */
function buildBreakdownQuery(event, prop, hours, limit = 100) {
  return (
    `SELECT properties.${prop} AS k, count() AS events, count(DISTINCT distinct_id) AS sessions ` +
    `FROM events WHERE ${SCOPE(hours)} AND event = ${lit(event)} ` +
    `GROUP BY k ORDER BY events DESC LIMIT ${limit}`
  );
}

/** HogQL count of one event narrowed by an extra boolean expression, returning
 *  events and distinct sessions like the totals query. `where` is a TRUSTED,
 *  hardcoded HogQL fragment (never user input), e.g. `toFloat(properties.fires)
 *  > 0` to count the session_emergencies rows that saw at least one fire. */
function buildFilteredCountQuery(event, where, hours) {
  return (
    `SELECT count() AS events, count(DISTINCT distinct_id) AS sessions ` +
    `FROM events WHERE ${SCOPE(hours)} AND event = ${lit(event)} AND (${where})`
  );
}

/** POST a HogQL query. Never throws: returns a tagged result so a caller can
 *  render a skipped section instead of aborting the whole report. */
async function runQuery(query) {
  let res, text;
  try {
    res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
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
    const generic =
      res.status === 401
        ? "unauthorized (check POSTHOG_PERSONAL_API_KEY)"
        : res.status === 403
          ? "forbidden (key lacks query:read on this project)"
          : res.status === 429
            ? "rate limited (too many queries)"
            : `HTTP ${res.status}`;
    return { ok: false, status: res.status, hint: json?.detail || json?.error?.message || generic, json };
  }
  return { ok: true, status: res.status, json };
}

/** Normalize a HogQL response `{results: [[...]], columns: [...]}` into an array
 *  of plain objects keyed by column name, tolerant of shape drift (a missing
 *  results/columns pair yields []). */
function rowsToObjects(json) {
  const results = Array.isArray(json?.results) ? json.results : null;
  const columns = Array.isArray(json?.columns) ? json.columns : null;
  if (!results || !columns) return [];
  return results.map((row) => {
    const obj = {};
    columns.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj;
  });
}

/** Fold the totals rows into a lookup of `{ event: { events, sessions } }`, so a
 *  missing event reads as zero rather than undefined. */
function totalsByEvent(res, events) {
  const out = {};
  for (const e of events) out[e] = { events: 0, sessions: 0 };
  if (!res.ok) return out;
  for (const r of rowsToObjects(res.json)) {
    if (r.event in out) out[r.event] = { events: Number(r.events) || 0, sessions: Number(r.sessions) || 0 };
  }
  return out;
}

/** Pull the single depth row (n / p50 / p90 / p95 / max) from a depth query, or
 *  null when the query was skipped or the window is empty. Percentiles are exact
 *  (HogQL computed them), so there is no truncation/approximation flag. */
function depthRow(res) {
  if (!res.ok) return { skipped: true, hint: res.hint };
  const rows = rowsToObjects(res.json);
  const r = rows[0];
  const n = r ? Number(r.n) || 0 : 0;
  if (!n) return { skipped: false, empty: true };
  return {
    skipped: false,
    empty: false,
    n,
    p50: Number(r.p50),
    p90: Number(r.p90),
    p95: Number(r.p95),
    max: Number(r.mx),
  };
}

/** Normalize a breakdown result into sorted rows, mirroring the Vercel report's
 *  "(none)" (real empty value) vs a present key distinction. */
function breakdownRows(res) {
  if (!res.ok) return null;
  return rowsToObjects(res.json)
    .map((r) => ({
      key: r.k == null || r.k === "" ? "(none)" : String(r.k),
      events: Number(r.events) || 0,
      sessions: Number(r.sessions) || 0,
    }))
    .sort((a, b) => b.events - a.events);
}

/** Pull the single `{ events, sessions }` row from a filtered-count query, zeroed
 *  when the query was skipped or the window is empty. */
function countRow(res) {
  if (!res.ok) return { events: 0, sessions: 0, skipped: true, hint: res.hint };
  const r = rowsToObjects(res.json)[0];
  return { events: Number(r?.events) || 0, sessions: Number(r?.sessions) || 0 };
}

const fmt = (n) => (n == null || Number.isNaN(n) ? "n/a" : Number(n).toLocaleString("en-US"));
const rnd = (n) => (n == null || Number.isNaN(n) ? null : Math.round(Number(n)));
const pct = (num, den) => (den ? `${((num / den) * 100).toFixed(1)}%` : "n/a");
const mdCell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

// Self-contained styles for the HTML report. Mirrors the retro Windows 3.1 look
// of the game (src/styles/retro-tokens.css), copied as literal values because
// this is a headless, build-free CI script. Kept intentionally close to the
// Vercel report so the two read as one family through the migration.
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
td.empty-cell { color:var(--muted); }
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
  const rows = t.rows;
  if (t.ok && rows && rows.length) {
    const body = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.key)}</td><td class="n">${fmt(r.events)}</td><td class="n">${fmt(r.sessions)}</td></tr>`,
      )
      .join("");
    return `${cap}<div class="scroll"><table><thead><tr><th>${escapeHtml(t.header)}</th><th class="n">Events</th><th class="n">Sessions</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const msg = t.ok ? "No data in this window." : `Skipped: ${escapeHtml(t.hint ?? "error")}`;
  return `${cap}<p class="empty">${msg}</p>`;
}

/** The per-session Depth section (exact p50 / p90 / p95 / max), or nothing. */
function htmlDepth(depth) {
  if (!depth || !depth.length) return "";
  const rows = depth
    .map((d) => {
      const r = d.row;
      if (r.skipped || r.empty) {
        const msg = r.skipped ? `Skipped: ${escapeHtml(r.hint ?? "error")}` : "No data in this window.";
        return `<tr><td>${escapeHtml(d.label)}</td><td class="empty-cell" colspan="5">${msg}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(d.label)}</td><td class="n">${fmt(r.n)}</td><td class="n">${fmt(rnd(r.p50))}</td><td class="n">${fmt(rnd(r.p90))}</td><td class="n">${fmt(rnd(r.p95))}</td><td class="n">${fmt(rnd(r.max))}</td></tr>`;
    })
    .join("");
  return `<section><h2>Depth (per session)</h2><div class="scroll"><table><thead><tr><th>Metric</th><th class="n">Samples</th><th class="n">p50</th><th class="n">p90</th><th class="n">p95</th><th class="n">Max</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">Percentiles are exact (HogQL <code>quantile</code>), computed per session from the raw values. No histogram approximation.</p></section>`;
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
<title>Verticopolis analytics (PostHog)</title><style>${HTML_STYLE}</style></head>
<body><div class="wrap">
<div class="titlebar"><h1>Verticopolis analytics</h1>
<span class="sub">${escapeHtml(m.window.since)} to ${escapeHtml(m.window.until)} &middot; ${escapeHtml(m.window.label)} &middot; production &middot; PostHog</span></div>
<div class="body">
<div class="kpis">${kpis}</div>
<ul class="highlights">${highlights}</ul>
${htmlDepth(m.depth)}
${sections}
<footer>PostHog (HogQL) &middot; Events = total custom events, Sessions = distinct per-tab session ids &middot; generated ${escapeHtml(m.generated)}</footer>
</div>
</div></body></html>`;
}

/** The per-session Depth block for the markdown report / job summary. */
function markdownDepth(depth) {
  if (!depth || !depth.length) return [];
  const lines = [`## Depth (per session)`, ``, `| Metric | Samples | p50 | p90 | p95 | Max |`, `| --- | ---: | ---: | ---: | ---: | ---: |`];
  for (const d of depth) {
    const r = d.row;
    if (r.skipped || r.empty) {
      const msg = r.skipped ? mdCell(`Skipped: ${r.hint ?? "error"}`) : "No data";
      lines.push(`| ${mdCell(d.label)} | ${msg} | n/a | n/a | n/a | n/a |`);
      continue;
    }
    lines.push(`| ${mdCell(d.label)} | ${fmt(r.n)} | ${fmt(rnd(r.p50))} | ${fmt(rnd(r.p90))} | ${fmt(rnd(r.p95))} | ${fmt(rnd(r.max))} |`);
  }
  lines.push(``, `_Percentiles are exact (HogQL quantile), computed per session from the raw values. No histogram approximation._`, ``);
  return lines;
}

/** One breakdown table as markdown rows, or a skipped-section note. */
function renderRows(t) {
  if (t.ok && t.rows && t.rows.length) {
    const lines = [`| ${t.header} | Events | Sessions |`, "| --- | ---: | ---: |"];
    for (const r of t.rows) lines.push(`| ${mdCell(r.key)} | ${fmt(r.events)} | ${fmt(r.sessions)} |`);
    return lines.join("\n");
  }
  if (t.ok) return "_No data in this window._";
  return `_Skipped: ${t.hint}._`;
}

/** The report as GitHub-flavored markdown, from the same model as the HTML. */
function renderMarkdown(m) {
  const lines = [
    `# Verticopolis analytics report (PostHog)`,
    ``,
    `Window: **${m.window.since} to ${m.window.until}** (${m.window.label}), production only. Generated ${m.generated}.`,
    ``,
    `## Totals`,
    ``,
    `| Metric | Value |`,
    `| --- | ---: |`,
    ...m.kpis.map(([k, v]) => `| ${k} | ${fmt(v)} |`),
    ``,
    ...m.highlights.map(([k, v]) => `- ${k}: **${v}**`),
    ``,
    ...markdownDepth(m.depth),
  ];
  for (const s of m.sections) {
    lines.push(`## ${s.title}`, ``);
    for (const t of s.tables) {
      if (t.caption) lines.push(`${t.caption}:`, ``);
      lines.push(renderRows(t), ``);
    }
  }
  return lines.join("\n");
}

/** Built-in sample results for --demo, shaped exactly like the normalized query
 *  output, so the same model and renderers exercise a populated report. */
function demoModel() {
  const rows = (pairs) => ({ ok: true, rows: pairs.map(([key, events, sessions]) => ({ key: String(key), events, sessions })) });
  const depth = (n, p50, p90, p95, max) => ({ skipped: false, empty: false, n, p50, p90, p95, max });
  return {
    window: { since: "sample", until: "sample", label: WINDOW.label },
    generated: "sample",
    kpis: [
      ["Towers founded", 1240],
      ["First builds", 1012],
      ["Star promotions", 438],
      ["Sessions ended", 3120],
      ["Boots", 5400],
      ["Play sessions", 2600],
      ["Crashes", 37],
      ["App actions", 1830],
      ["Economy actions", 640],
      ["Emergency choices", 210],
      ["Errors", 54],
    ],
    highlights: [
      ["Founded to first build", "81.6%"],
      ["Crash to boot ratio", "0.7%"],
      ["Typical session fps (p50)", "58"],
      ["Sessions with a fire", "6.2%"],
    ],
    depth: [
      { label: "Session length (seconds)", row: depth(3120, 92, 640, 1180, 4200) },
      { label: "Builds per session", row: depth(2600, 6, 31, 58, 210) },
      { label: "Peak floor reached", row: depth(2600, 9, 34, 51, 92) },
      { label: "Session fps (p50)", row: depth(2100, 58, 41, 33, 60) },
      { label: "Session fps (worst-frame low)", row: depth(2100, 42, 22, 15, 60) },
    ],
    sections: [
      { title: "Tool mix", tables: [{ ok: true, header: "Tool", ...rows([["office", 820, 410], ["fast food", 560, 300], ["floor", 540, 295]]) }] },
      {
        title: "Boots",
        tables: [
          { ok: true, caption: "By platform", header: "Platform", ...rows([["web", 4200, 2000], ["twa", 900, 500], ["ios", 300, 100]]) },
          { ok: true, caption: "By reason", header: "Reason", ...rows([["continue", 2600, 1500], ["fresh", 2100, 900], ["update", 480, 360]]) },
        ],
      },
      {
        title: "App-chrome actions",
        tables: [{ ok: true, caption: "app_action by action", header: "Action", ...rows([["quick_save", 720, 480], ["settings_open", 410, 300], ["export_save", 160, 140]]) }],
      },
      {
        title: "Economy actions",
        tables: [{ ok: true, caption: "economy_action by action", header: "Action", ...rows([["demolish", 380, 260], ["price_tune", 180, 170], ["capacity_tune", 80, 78]]) }],
      },
      {
        title: "Emergencies",
        tables: [
          { ok: true, caption: "Emergency choices by kind", header: "Kind", ...rows([["fireRescue", 150, 130], ["bombThreat", 60, 55]]) },
          { ok: true, caption: "Emergency choices by decision", header: "Decision", ...rows([["accept", 120, 108], ["decline", 90, 84]]) },
          { ok: true, caption: "Fire occurrence", header: "Metric", ...rows([["Sessions with a fire", 170, 162], ["Sessions reporting (all played)", 2580, 2580]]) },
        ],
      },
    ],
  };
}

async function main() {
  requireEnv();
  mkdirSync(OUT_DIR, { recursive: true });

  const stamp = new Date().toISOString().slice(0, 10);
  // The queries use a rolling `now() - INTERVAL h HOUR` window, so the shown
  // start is exactly that far back (dates only; the label carries precision).
  const since = new Date(Date.now() - WINDOW.hours * 3_600_000).toISOString().slice(0, 10);

  if (DEMO) {
    const model = demoModel();
    model.window = { since, until: stamp, label: WINDOW.label };
    model.generated = new Date().toISOString();
    return writeAll(model, { demo: "sample data (no API calls)" });
  }

  const TOTAL_EVENTS = [
    "boot", "session_end", "game_started", "first_build", "star_reached", "crash", "update",
    // App-chrome (#614), error tracking, and the gameplay economy / emergency
    // surfaces (#611). Each only has history from when its build went live.
    "app_action", "economy_action", "emergency_choice", "session_emergencies", "$exception",
  ];
  const raw = {};
  const q = async (label, query) => {
    const r = await runQuery(query);
    raw[label] = r.ok ? r.json?.results ?? r.json : { status: r.status, hint: r.hint };
    return r;
  };

  const totalsRes = await q("totals", buildTotalsQuery(TOTAL_EVENTS, WINDOW.hours));
  const totals = totalsByEvent(totalsRes, TOTAL_EVENTS);

  // Depth: exact percentiles per session-scoped numeric property.
  const depthSpecs = [
    { label: "Session length (seconds)", event: "session_end", prop: "seconds" },
    { label: "Builds per session", event: "session_builds", prop: "builds" },
    { label: "Peak floor reached", event: "session_peak_floors", prop: "floors" },
    { label: "Session fps (p50)", event: "session_fps", prop: "p50" },
    { label: "Session fps (worst-frame low)", event: "session_fps", prop: "low" },
  ];
  const depth = [];
  for (const d of depthSpecs) {
    const r = await q(`depth_${d.event}_${d.prop}`, buildDepthQuery(d.event, d.prop, WINDOW.hours));
    depth.push({ label: d.label, row: depthRow(r) });
  }

  // Breakdowns: each returns events + distinct sessions per group.
  const bd = async (label, event, prop) => {
    const r = await q(label, buildBreakdownQuery(event, prop, WINDOW.hours));
    return { ok: r.ok, hint: r.hint, rows: breakdownRows(r) };
  };
  const toolMix = await bd("tool_used_by_tool", "tool_used", "tool");
  const starDist = await bd("star_reached_by_star", "star_reached", "star");
  const bootByPlatform = await bd("boot_by_platform", "boot", "platform");
  const bootByReason = await bd("boot_by_reason", "boot", "reason");
  const bootByReturning = await bd("boot_by_returning", "boot", "returning");
  const bootByTenure = await bd("boot_by_tenure", "boot", "tenure");
  const bootByRecency = await bd("boot_by_recency", "boot", "recency");
  const crashByRecovery = await bd("crash_by_recoveryFailed", "crash", "recoveryFailed");
  const updateByTo = await bd("update_by_to", "update", "to");
  // App-chrome (#614), error tracking, and gameplay economy / emergencies (#611).
  const appActionByAction = await bd("app_action_by_action", "app_action", "action");
  const exceptionByType = await bd("exception_by_type", "$exception", "$exception_type");
  const economyByAction = await bd("economy_action_by_action", "economy_action", "action");
  const emergencyByKind = await bd("emergency_choice_by_kind", "emergency_choice", "kind");
  const emergencyByDecision = await bd("emergency_choice_by_decision", "emergency_choice", "decision");
  // Fire rate: the session_emergencies rows with at least one fire, over all
  // session_emergencies (emitted once per played session), gives "% of sessions
  // with a fire". `fires` is a server-trusted integer prop, not user input.
  const firesRes = await q("session_emergencies_with_fire", buildFilteredCountQuery("session_emergencies", "toFloat(properties.fires) > 0", WINDOW.hours));
  const firesWithFire = countRow(firesRes);

  const fpsP50 = depth.find((d) => d.label === "Session fps (p50)")?.row;
  const model = {
    window: { since, until: stamp, label: WINDOW.label },
    generated: new Date().toISOString(),
    kpis: [
      ["Towers founded", totals.game_started.events],
      ["First builds", totals.first_build.events],
      ["Star promotions", totals.star_reached.events],
      ["Sessions ended", totals.session_end.events],
      ["Boots", totals.boot.events],
      ["Play sessions", totals.boot.sessions],
      ["Crashes", totals.crash.events],
      ["App actions", totals.app_action.events],
      ["Economy actions", totals.economy_action.events],
      ["Emergency choices", totals.emergency_choice.events],
      ["Errors", totals["$exception"].events],
    ],
    highlights: [
      ["Founded to first build", pct(totals.first_build.events, totals.game_started.events)],
      ["Crash to boot ratio", pct(totals.crash.events, totals.boot.events)],
      ["Typical session fps (p50)", fpsP50 && !fpsP50.skipped && !fpsP50.empty ? fmt(rnd(fpsP50.p50)) : "n/a"],
      // Fire rate: sessions with >=1 fire over all played sessions that reported.
      // "n/a" (not a false 0.0%) when that one query was skipped while totals succeeded.
      ["Sessions with a fire", firesWithFire.skipped ? "n/a" : pct(firesWithFire.sessions, totals.session_emergencies.sessions)],
    ],
    depth,
    sections: [
      { title: "Tool mix", tables: [{ ...toolMix, header: "Tool" }] },
      {
        title: "Progression",
        tables: [{ ...starDist, caption: "Star promotions by star", header: "Star reached" }],
      },
      {
        title: "Boots and existing towers",
        tables: [
          { ...bootByPlatform, caption: "By platform (web / twa / ios)", header: "Platform" },
          { ...bootByReason, caption: "By origin (fresh / continue / update / recovery / corrupt)", header: "Reason" },
          { ...bootByReturning, caption: "By returning flag", header: "Returning" },
          { ...bootByTenure, caption: "By tenure bucket", header: "Tenure" },
          { ...bootByRecency, caption: "By return-recency bucket", header: "Recency" },
        ],
      },
      {
        title: "Reliability and updates",
        tables: [
          { ...crashByRecovery, caption: "Crashes by failed in-place recovery", header: "Recovery failed" },
          { ...updateByTo, caption: "Updates by target version", header: "To version" },
          { ...exceptionByType, caption: "Errors ($exception) by type", header: "Exception type" },
        ],
      },
      {
        title: "App-chrome actions",
        tables: [
          { ...appActionByAction, caption: "app_action by action (save / export / TDT / dialog opens / toggles / page landings)", header: "Action" },
        ],
      },
      {
        title: "Economy actions",
        tables: [
          { ...economyByAction, caption: "economy_action by action (demolish / price_tune / capacity_tune)", header: "Action" },
        ],
      },
      {
        title: "Emergencies",
        tables: [
          { ...emergencyByKind, caption: "Emergency choices by kind (fireRescue / bombThreat)", header: "Kind" },
          { ...emergencyByDecision, caption: "Emergency choices by decision (accept / decline)", header: "Decision" },
          {
            // Skip the whole table (not a false zero numerator) if the fires
            // query failed while totals succeeded; carries the hint like the rest.
            ok: firesRes.ok,
            hint: firesRes.hint,
            caption: "Fire occurrence (session_emergencies emits once per played session)",
            header: "Metric",
            rows: [
              { key: "Sessions with a fire", events: firesWithFire.events, sessions: firesWithFire.sessions },
              { key: "Sessions reporting (all played)", events: totals.session_emergencies.events, sessions: totals.session_emergencies.sessions },
            ],
          },
        ],
      },
    ],
  };

  writeAll(model, raw);
}

/** Render the model to the HTML file, the job summary, and stdout. Shared by the
 *  live and --demo paths so both exercise the same output surface. */
function writeAll(model, raw) {
  const htmlPath = join(OUT_DIR, `posthog-report-${model.window.until}.html`);
  writeFileSync(htmlPath, renderHtml(model));
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(model) + "\n");
    } catch {
      /* best-effort; a summary write must never fail the run */
    }
  }
  console.log(JSON.stringify({ window: model.window, raw }, null, 2));
  console.log(`\nWrote ${htmlPath}`);
}

// Run only when invoked directly, so a test can import the pure helpers without
// kicking off a live report. Compare as file URLs (process.argv[1] is an
// absolute path; pathToFileURL normalizes it to import.meta.url's form).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("Report failed:", err);
    process.exit(1);
  });
}

// Exported for unit tests; the script itself uses them directly above.
export { parseWindow, lit, buildTotalsQuery, buildDepthQuery, buildBreakdownQuery, buildFilteredCountQuery, rowsToObjects, totalsByEvent, depthRow, breakdownRows, countRow };
