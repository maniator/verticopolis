#!/usr/bin/env node
/**
 * The governed definition of the engine reliability rate: the Reliability row
 * of #945, as the 3.0 web release plan restates it (section 4.1 of
 * `_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md`, from
 * PR #1080).
 *
 * It reads the `engine_status` rows the game sends (`src/analyticsEngineStatus.ts`,
 * issue #1081; each field is in `docs/analytics-data-map.md`) and counts them by
 * the rules below. `src/engine-reliability.test.ts` pins every rule, and pins the
 * session unit to the `session_lengths` view in `scripts/posthog-dashboard.mjs`,
 * so a number this script prints is a governed one (CLAUDE.md). Change a rule
 * here and in the test together, or not at all.
 *
 * The unit is the view's session: a distinct `distinct_id`, production only. A
 * session survives a same-tab reload, so it can span several page lives; each
 * row names its page life (`page_life`), so page lives are counted exactly
 * rather than by the view's reading-drop walk. `session_end` is never read: it
 * re-fires on every tab-hide, the error behind the 2026-09-03 readout.
 *
 * The rules:
 * - The window holds the page lives whose `settle` row falls in it. A page
 *   life that settled earlier is left out whole, so a fault from before the
 *   window is never charged to it.
 * - A page life is COUNTED when it asked for a counted host (`wasm` by
 *   default; the experimental hosts are measurement only), ran a counted
 *   version, commit and bundle kind (every one by default), sits in a counted
 *   arm and was not size-gated. A row with no `arm` reads as `none`, the value
 *   for a build with no cohort; `override` and `unassigned` are left out by
 *   default, as plan 4.1 leaves them out of both arms.
 * - A commit matches when one of the two is a prefix of the other, so a short
 *   commit of another length still matches; both sides are at least 7 hex
 *   digits.
 * - A page life whose request, bundle kind, reasons, version or commit is not
 *   a value the game can send, or whose fallback count is not a whole number
 *   of zero or more, is UNRECOGNIZED: the rows come through a public route, so
 *   it is left out of everything and counted on its own line. (A forged row
 *   with valid codes cannot be told apart.)
 * - A counted page life FELL BACK when its highest `fallbacks` is above 0.
 *   Its fallback is an ENGINE FAULT when it sent any reason but
 *   `package-mismatch` (or, with its rows lost, no reason at all).
 *   `package-mismatch` comes from the deploy race (#1046) and says nothing
 *   about the engine. Every other code counts, `attach-refused` included, as
 *   plan 4.1 rules, and so does `other`: the worker host sends it for a boot
 *   step outside the engine (so it overstates that host), and the
 *   main-thread host for a save that failed on a running engine (#874).
 * - A page life whose settle row already fell back on `package-mismatch`, and
 *   that sent no other reason, never ran the engine: it is neither a pass nor
 *   a fault. One whose first tower ran on the engine and that met the mismatch
 *   later ran the engine without a fault. Both are counted on the mismatch
 *   line, and a writer latch-off in either still counts on the latch line.
 * - N counts sessions with at least one counted page life that ran the engine.
 *   A session counts as a fault when any of those page lives had an engine
 *   fault; it counts once however many did, and stays a fault if a later page
 *   life ran clean.
 * - Page lives are counted the same way, and the by-reason table lists the
 *   engine-fault reasons of the counted page lives that ran the engine.
 * - By build and by arm, a fault is charged to the build or arm of the page
 *   life it happened in, and a session that ran several counts once under
 *   each.
 * - Size-gated page lives are outside the rate; their count obeys every other
 *   filter.
 * - The bound is the exact one-sided 95% binomial upper bound (Clopper-Pearson)
 *   on faults over N: about 3/N with none, about 4.74/N with one.
 * - The size of a loop is kept: the report gives the fallbacks the counted
 *   page lives sent in all, and the most in one page life.
 * - Every session is early telemetry for now (plan 4.1, OD-2): the split into
 *   eligible evidence, the per-arm crash rates and the tail's bound come with
 *   #1090, and the report says so at the top.
 *
 * What it cannot see: the relay is best-effort, with no offline queue and a
 * per-IP rate limit, so a fallback in an offline session never reports, nor
 * does a tab closed while the engine is still loading (the settle row waits
 * for the load, so this falls on `boot-timeout`), a tab killed before its
 * first row or after a capped drop with no later hide, or a boot whose engine
 * failed and whose game then never started. A page life whose settle row was
 * lost is left out. Runtime traps are not reported before #874, and the worker
 * host reports only its first tower (none of its runtime faults). Outcomes are as of the run, so a page
 * life that settled near the end of the window can still fall back later. A
 * page life that never became visible (a background tab) still counts. The
 * rate is a lower bound, and the report says so at the top. Sessions are not
 * independent (a device that traps once may trap every time), so the bound is
 * optimistic; triage reads repeats by reason and build.
 *
 * Run: `POSTHOG_PERSONAL_API_KEY=phx_... node scripts/engine-reliability.mjs
 * --window 30 [--hosts wasm] [--shas abc1234,def5678] [--versions 2.36.0]
 * [--builds switchable] [--arms wasm]`. Any other flag is an error. The key
 * and host are the ones `posthog-report.mjs` reads.
 */

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { lit, parseWindow, rowsToObjects, runQuery } from "./posthog-report.mjs";

/** The event the game sends. */
export const EVENT = "engine_status";

/** The host a page life must ask for to count, unless the caller says
 *  otherwise: the production main-thread host. */
export const DEFAULT_HOSTS = ["wasm"];

/** The values the game can send (`src/engine-reliability.test.ts` binds each
 *  list to its source): every engine a page life can ask for, the WASM hosts
 *  among them (the only ones that can count), the bundle kinds, and the
 *  fallback reasons. */
export const REQUESTS = ["ts", "wasm", "wasm-frame", "wasm-worker"];
export const HOSTS = ["wasm", "wasm-frame", "wasm-worker"];
export const BUILDS = ["switchable", "wasm-only"];
export const REASONS = ["none", "boot-timeout", "boot-error", "package-mismatch", "attach-refused", "trap-command", "trap-tick", "trap-undo", "other"];

/** A build's commit (`git rev-parse --short`, or `unknown` outside a checkout)
 *  and version, as the game sends them. */
const SHA = /^[0-9a-f]{7,40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The arms left out unless the caller names arms: plan 4.1 leaves a forced
 *  engine (`override`) and an unreadable draw (`unassigned`) out of both. */
export const EXCLUDED_ARMS = ["override", "unassigned"];

/** Rows one query may return; a full page is reported as truncated. */
export const ROW_LIMIT = 50_000;

/** The shape of a value the report prints: a code, a version or a commit. A
 *  row comes from a public ingest route, so anything else is shown as
 *  `unrecognized` rather than printed into the Markdown. */
const SAFE_VALUE = /^[A-Za-z0-9._+-]{1,64}$/;

/** HogQL: one row per page life that settled in the window, production only,
 *  newest first, so a truncated result keeps the latest builds. `hours` is a
 *  `parseWindow` integer. Booleans compare with `= true` and are coalesced, as
 *  the `session_lengths` view does with `final`, so a missing key reads false.
 *  The session is named `session_id`, as in the view (the events table has a
 *  `session` of its own). */
export function buildPageLivesQuery(hours) {
  return [
    "SELECT",
    "  distinct_id AS session_id,",
    "  properties.page_life AS page_life,",
    "  argMin(properties.version, timestamp) AS version,",
    "  argMin(properties.sha, timestamp) AS sha,",
    "  argMin(properties.build, timestamp) AS build,",
    "  argMin(properties.engine_requested, timestamp) AS requested,",
    "  argMin(properties.arm, timestamp) AS arm,",
    "  coalesce(max(properties.size_gated = true), false) AS size_gated,",
    "  max(toFloat(properties.fallbacks)) AS fallbacks,",
    "  maxIf(toFloat(properties.fallbacks), properties.trigger = 'settle') AS settle_fallbacks,",
    "  groupUniqArray(properties.fallback_reason) AS reasons,",
    "  coalesce(max(properties.writer_latched = true), false) AS writer_latched,",
    "  min(timestamp) AS first_seen",
    "FROM events",
    `WHERE event = ${lit(EVENT)}`,
    "  AND properties.environment = 'production'",
    `  AND timestamp >= now() - INTERVAL ${hours} HOUR`,
    "  AND properties.page_life IS NOT NULL",
    "GROUP BY session_id, page_life",
    "HAVING countIf(properties.trigger = 'settle') > 0",
    "ORDER BY first_seen DESC",
    `LIMIT ${ROW_LIMIT}`,
  ].join("\n");
}

const truthy = (v) => v === true || v === 1 || v === "true" || v === "1";

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** A fallback count: 0 when absent, NaN when it is not a whole number of zero
 *  or more, which no build sends, so the page life is left out as
 *  unrecognized. */
function count(v) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return isCount(n) ? n : Number.NaN;
}

/** One printable value: `missing` when absent, `unrecognized` when it is not
 *  the shape of a code, a version or a commit. */
function value(v, missing) {
  if (v == null || v === "") return missing;
  const s = String(v);
  return SAFE_VALUE.test(s) ? s : "unrecognized";
}

/** Normalize the query's rows into page lives. Unknown or missing values keep
 *  a readable placeholder rather than dropping the row. */
export function pageLivesFromRows(rows) {
  return rows.map((r) => ({
    session: String(r.session_id ?? ""),
    pageLife: String(r.page_life ?? ""),
    version: value(r.version, "unknown"),
    sha: value(r.sha, "unknown"),
    build: value(r.build, "unknown"),
    requested: value(r.requested, "unknown"),
    arm: value(r.arm, "none"),
    sizeGated: truthy(r.size_gated),
    fallbacks: count(r.fallbacks),
    settleFallbacks: count(r.settle_fallbacks),
    reasons: [...new Set((Array.isArray(r.reasons) ? r.reasons : []).filter((x) => typeof x === "string" && x !== "" && x !== "none").map((x) => value(x, "unknown")))],
    writerLatched: truthy(r.writer_latched),
  }));
}

/** The exact one-sided upper confidence bound on a binomial rate (Clopper-
 *  Pearson): the rate p at which seeing `k` or fewer of `n` has probability
 *  1 - `confidence`. Bisection over the CDF, summed in log space so a large n
 *  cannot underflow. Null when there is no sample. */
export function upperBound(k, n, confidence = 0.95) {
  if (!(n > 0)) return null;
  if (k >= n) return 1;
  const alpha = 1 - confidence;
  const cdf = (p) => {
    const lp = Math.log(p);
    const lq = Math.log1p(-p);
    let term = n * lq;
    let max = term;
    const terms = [term];
    for (let i = 0; i < k; i++) {
      term += Math.log(n - i) - Math.log(i + 1) + lp - lq;
      terms.push(term);
      if (term > max) max = term;
    }
    let sum = 0;
    for (const t of terms) sum += Math.exp(t - max);
    return Math.exp(max) * sum;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Whether a page life's commit is one of `shas`: one is a prefix of the
 *  other, so short commits of different lengths still match. Both sides are
 *  checked commits, so a forged one-letter commit matches nothing. */
const shaMatches = (sha, shas) => SHA.test(sha) && shas.some((s) => SHA.test(s) && (sha.startsWith(s) || s.startsWith(sha)));

/** Whether every value a page life carries is one the game can send. */
const recognized = (pl) =>
  REQUESTS.includes(pl.requested) &&
  BUILDS.includes(pl.build) &&
  pl.reasons.every((r) => REASONS.includes(r)) &&
  (SHA.test(pl.sha) || pl.sha === "unknown") &&
  VERSION.test(pl.version) &&
  isCount(pl.fallbacks) &&
  isCount(pl.settleFallbacks);

/** Count page lives by the rules in the module comment. `opts.hosts`,
 *  `opts.shas`, `opts.versions`, `opts.builds` and `opts.arms` narrow what
 *  counts. An absent list counts everything, except `hosts`, which defaults to
 *  `wasm`, and `arms`, which leaves out `override` and `unassigned`. */
export function summarizeReliability(pageLives, opts = {}) {
  const hosts = opts.hosts ?? DEFAULT_HOSTS;
  const shas = opts.shas ?? null;
  const versions = opts.versions ?? null;
  const builds = opts.builds ?? null;
  const arms = opts.arms ?? null;
  const inScope = (pl) =>
    hosts.includes(pl.requested) &&
    (!shas || shaMatches(pl.sha, shas)) &&
    (!versions || versions.includes(pl.version)) &&
    (!builds || builds.includes(pl.build)) &&
    (arms ? arms.includes(pl.arm) : !EXCLUDED_ARMS.includes(pl.arm));

  const sessions = new Map();
  const byBuild = new Map();
  const byArm = new Map();
  const reasons = new Map();
  const totals = { pageLives: 0, faultPageLives: 0, mismatchPageLives: 0, mismatchNeverRan: 0, latchedPageLives: 0, sizeGatedPageLives: 0, unrecognizedPageLives: 0, totalFallbacks: 0, maxFallbacks: 0 };
  const bucket = (map, key) => {
    if (!map.has(key)) map.set(key, { sessions: new Set(), faults: new Set(), pageLives: 0, faultPageLives: 0 });
    return map.get(key);
  };

  for (const pl of pageLives) {
    if (!recognized(pl)) {
      totals.unrecognizedPageLives++;
      continue;
    }
    if (!inScope(pl)) continue;
    if (pl.sizeGated) {
      totals.sizeGatedPageLives++;
      continue;
    }
    const fellBack = pl.fallbacks > 0;
    const faultReasons = pl.reasons.filter((r) => r !== "package-mismatch");
    const mismatch = pl.reasons.includes("package-mismatch");
    const fault = fellBack && (faultReasons.length > 0 || pl.reasons.length === 0);
    const s = sessions.get(pl.session) ?? { ran: false, fault: false, mismatch: false, latched: false };
    sessions.set(pl.session, s);
    if (mismatch) {
      s.mismatch = true;
      totals.mismatchPageLives++;
    }
    if (pl.writerLatched) {
      s.latched = true;
      totals.latchedPageLives++;
    }
    if (mismatch && !fault && pl.settleFallbacks > 0) {
      totals.mismatchNeverRan++;
      continue;
    }
    s.ran = true;
    totals.pageLives++;
    totals.totalFallbacks += pl.fallbacks;
    totals.maxFallbacks = Math.max(totals.maxFallbacks, pl.fallbacks);
    if (fault) for (const r of faultReasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
    const groups = [bucket(byBuild, `${pl.version} (${pl.sha}, ${pl.build})`), bucket(byArm, pl.arm)];
    for (const g of groups) {
      g.sessions.add(pl.session);
      g.pageLives++;
    }
    if (fault) {
      s.fault = true;
      totals.faultPageLives++;
      for (const g of groups) {
        g.faults.add(pl.session);
        g.faultPageLives++;
      }
    }
  }

  const all = [...sessions.values()];
  const n = all.filter((s) => s.ran).length;
  const faults = all.filter((s) => s.fault).length;
  const rows = (map, name) =>
    [...map.entries()]
      .map(([key, b]) => ({ [name]: key, sessions: b.sessions.size, faults: b.faults.size, pageLives: b.pageLives, faultPageLives: b.faultPageLives, upper95: upperBound(b.faults.size, b.sessions.size) }))
      .sort((a, b) => a[name].localeCompare(b[name]));
  return {
    n,
    faults,
    rate: n ? faults / n : null,
    upper95: upperBound(faults, n),
    mismatchSessions: all.filter((s) => s.mismatch).length,
    latchedSessions: all.filter((s) => s.latched).length,
    ...totals,
    byBuild: rows(byBuild, "build"),
    byArm: rows(byArm, "arm"),
    byReason: [...reasons.entries()].map(([reason, pageLives]) => ({ reason, pageLives })).sort((a, b) => b.pageLives - a.pageLives || a.reason.localeCompare(b.reason)),
  };
}

const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(3)}%`);
/** A value from a row or the command line, in a code span so Markdown never
 *  reads it as markup. */
const code = (v) => `\`${v}\``;

/** One group table (by build or by arm). */
function groupTable(title, label, key, rows) {
  return [
    "",
    `## ${title}`,
    "",
    `| ${label} | Sessions | Faults | 95% upper bound | Page lives | Fault page lives |`,
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((b) => `| ${code(b[key])} | ${b.sessions} | ${b.faults} | ${pct(b.upper95)} | ${b.pageLives} | ${b.faultPageLives} |`),
  ];
}

/** The report as Markdown. The window and the lower-bound caveat lead, above
 *  every figure (CLAUDE.md: a published snapshot says so at the top). Every
 *  value printed from a row has passed `pageLivesFromRows`, so it is a code, a
 *  version, a commit or a placeholder. */
export function renderReliabilityMarkdown(summary, meta) {
  const lines = [
    "# Engine reliability",
    "",
    `> **Snapshot** of the ${meta.windowLabel} to ${meta.until} (UTC), production only: the page lives that settled in that window. It does not refresh: the live figure is this script run again (\`node scripts/engine-reliability.mjs\`), whose rules \`src/engine-reliability.test.ts\` pins.`,
    `> Counted: hosts ${meta.hosts.map(code).join(", ")}; builds ${meta.builds}; arms ${meta.arms}.`,
    "> **Early telemetry, not release evidence.** This report does not yet sort sessions into eligible evidence (plan 4.1, OD-2; #1090), and no build carries S4 (#874) and S9 (#954) yet, so every session here is early telemetry: triage each failure, and do not publish the rate as a reliability figure.",
    "> **A lower bound.** The relay is best-effort, with no offline queue and a per-IP rate limit, so a fallback in an offline session, a tab closed while the engine loads, a tab killed before it reports (or after a capped drop with no later hide) and a boot whose game never started after its engine failed never count. Runtime traps are not reported before #874. Outcomes are as of this run, so a page life that settled near the end of the window can still fall back. Background tabs that were never seen still count. Sessions are not independent, so the bound below is optimistic.",
  ];
  if (meta.hosts.includes("wasm-worker")) lines.push("> **The worker host** reports only its first tower, so its later fallbacks are missing, and its `other` is a boot step outside the engine, counted as a fault.");
  if (meta.truncated) lines.push(`> **Truncated:** the query hit a row limit (${ROW_LIMIT.toLocaleString("en-US")} asked for), so these counts are short. Narrow the window.`);
  lines.push(
    "",
    "| Measure | Value |",
    "| --- | --- |",
    `| Engine sessions (N) | ${summary.n} |`,
    `| Sessions with an engine-fault fallback | ${summary.faults} |`,
    `| Fault rate | ${pct(summary.rate)} |`,
    `| 95% upper bound | ${pct(summary.upper95)} |`,
    `| Counted page lives that ran the engine | ${summary.pageLives} (${summary.faultPageLives} with a fault) |`,
    `| Fallbacks the counted page lives sent | ${summary.totalFallbacks} in all, at most ${summary.maxFallbacks} in one page life |`,
    `| Package mismatch (outside the rate) | ${summary.mismatchSessions} sessions, ${summary.mismatchPageLives} page lives, ${summary.mismatchNeverRan} of them never ran the engine |`,
    `| Engine writer latch-offs | ${summary.latchedSessions} sessions, ${summary.latchedPageLives} page lives |`,
    `| Size-gated page lives (outside the rate) | ${summary.sizeGatedPageLives} |`,
    `| Unrecognized page lives (values the game never sends; left out) | ${summary.unrecognizedPageLives} |`,
    ...groupTable("By build", "Version (commit, bundle)", "build", summary.byBuild),
    ...groupTable("By arm", "Arm", "arm", summary.byArm),
    "",
    "## By reason (engine faults in counted page lives)",
    "",
    "| Reason | Page lives |",
    "| --- | --- |",
    ...summary.byReason.map((r) => `| ${code(r.reason)} | ${r.pageLives} |`),
  );
  return lines.join("\n") + "\n";
}

/** The flags the script takes; any other is an error. */
const FLAGS = ["window", "hosts", "shas", "versions", "builds", "arms"];

/** What each list flag may hold: a closed list, or the shape of the value. */
const FLAG_VALUES = {
  hosts: (v) => HOSTS.includes(v),
  builds: (v) => BUILDS.includes(v),
  shas: (v) => SHA.test(v),
  versions: (v) => VERSION.test(v),
  arms: (v) => SAFE_VALUE.test(v),
};
const FLAG_HELP = {
  hosts: HOSTS.join(", "),
  builds: BUILDS.join(", "),
  shas: "commits of 7 to 40 lowercase hex digits",
  versions: "versions like 2.36.0",
  arms: "arm names",
};

/** Read the command line: the window and the counting options. Throws on an
 *  unknown or repeated flag, a flag with no value (or another flag where its
 *  value should be), an empty list, and a value the flag cannot hold (a host
 *  that is not a WASM host, a bundle kind, commit or version of the wrong
 *  shape), so a bad dispatch fails loudly instead of counting the wrong page
 *  lives. An arm can only be checked for its shape until A4 names the arms. */
export function parseArgs(argv) {
  const raw = new Map();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument "${a}"`);
    const eq = a.indexOf("=");
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (!FLAGS.includes(name)) throw new Error(`unknown flag --${name} (the flags are ${FLAGS.map((f) => `--${f}`).join(", ")})`);
    let v;
    if (eq !== -1) v = a.slice(eq + 1);
    else {
      v = argv[i + 1];
      i++;
    }
    if (v == null || v === "" || v.startsWith("--")) throw new Error(`--${name} needs a value`);
    if (raw.has(name)) throw new Error(`--${name} is given twice`);
    raw.set(name, v);
  }
  const list = (name) => {
    if (!raw.has(name)) return null;
    const items = raw.get(name).split(",").map((x) => x.trim()).filter(Boolean);
    if (!items.length) throw new Error(`--${name} needs a comma list`);
    const bad = items.find((x) => !FLAG_VALUES[name](x));
    if (bad !== undefined) throw new Error(`--${name} cannot hold "${bad}" (it takes ${FLAG_HELP[name]})`);
    return items;
  };
  return {
    window: parseWindow(raw.get("window") ?? "30"),
    opts: { hosts: list("hosts") ?? DEFAULT_HOSTS, shas: list("shas"), versions: list("versions"), builds: list("builds"), arms: list("arms") },
  };
}

/** The rows of a query response, or a thrown error when the body is not the
 *  `{results, columns}` shape, so a broken response never prints as an empty
 *  window. `truncated` is true when the page is full or the API says there is
 *  more. */
export function responseRows(json) {
  if (!Array.isArray(json?.results) || !Array.isArray(json?.columns)) throw new Error("the query returned no results table");
  const rows = rowsToObjects(json);
  return { rows, truncated: rows.length >= ROW_LIMIT || json.hasMore === true };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!process.env.POSTHOG_PERSONAL_API_KEY) {
    console.error("POSTHOG_PERSONAL_API_KEY is not set (a phx_... personal key with query:read; see scripts/posthog-report.mjs).");
    process.exit(1);
  }
  const { window: span, opts } = args;
  const res = await runQuery(buildPageLivesQuery(span.hours));
  if (!res.ok) {
    console.error(`The query failed: ${res.hint}`);
    process.exit(1);
  }
  const { rows, truncated } = responseRows(res.json);
  const summary = summarizeReliability(pageLivesFromRows(rows), opts);
  const each = (xs) => xs.map(code).join(", ");
  const builds = [opts.shas && `commits ${each(opts.shas)}`, opts.versions && `versions ${each(opts.versions)}`, opts.builds && `bundles ${each(opts.builds)}`].filter(Boolean).join("; ") || "all";
  const md = renderReliabilityMarkdown(summary, {
    windowLabel: `last ${span.label}`,
    until: new Date().toISOString().slice(0, 16).replace("T", " "),
    hosts: opts.hosts,
    builds,
    arms: opts.arms ? each(opts.arms) : `all but ${EXCLUDED_ARMS.map(code).join(" and ")}`,
    truncated,
  });
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    } catch {
      /* best-effort */
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("Report failed:", err.message ?? err);
    process.exit(1);
  });
}
