/**
 * The governed definition of two reliability reading aids (#1623): how much
 * traffic the engine report never saw, and what became of a session whose
 * running engine trapped. `src/reliability-coverage.test.ts` pins every rule
 * here. Both are derived from events the game already sends; no field is new.
 *
 * COVERAGE is a set of cross-checks, not a rate. It sets the page lives with a
 * `boot` row beside the page lives with a `settle` row (both fire once per page
 * life, so they are comparable), the page lives with an `attempt` row that
 * never settled, and the sessions with engine rows and no `session_end` row.
 * `session_end` re-fires on every tab hide and the engine rows use a different
 * counting rule, so the difference between "sessions that ended" and "sessions
 * with engine rows" is NOT a count of lost sessions. Loss on the relay itself
 * hides from all of these, because every event rides the same route.
 *
 * TRAP RECOVERY follows each session with a `crash-reload` row (a running
 * engine trapped and the page reloaded from its last autosave, #1422) through
 * the page lives that came after:
 * - recovered: a later page life settled on the engine with no fault, and the
 *   session sent no later `trap-*` fallback and no later `crash-reload`;
 * - stopped: a later `fallback` row with a `trap-*` reason (a second trap
 *   stops the game on a Rust-only build);
 * - reloaded, not recovered: a later page life settled but never ran the
 *   engine cleanly, or the session trapped and reloaded again;
 * - unknown: no later page life reached the relay (a closed tab, a blocked
 *   relay, or a window that ended first). Unknown is not a failure.
 * With no trapped session the report says "Insufficient evidence: no traps
 * observed", never 0%. These are counts of sessions, not a rate.
 *
 * Run: `POSTHOG_PERSONAL_API_KEY=phx_... node scripts/engine-reliability.mjs`
 * prints this section under the persistence failures.
 */

import { rowsToObjects, runQuery } from "./posthog-report.mjs";
import { EVENT, ROW_LIMIT } from "./engine-reliability.mjs";

const num = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

/** The window predicate every query shares. `hours` is a `parseWindow` integer. */
function windowGate(hours, alias = "") {
  if (!Number.isSafeInteger(hours) || hours < 1) throw new Error(`bad window: ${hours}`);
  const p = alias ? `${alias}.` : "";
  return [`${p}properties.environment = 'production'`, `${p}timestamp >= now() - INTERVAL ${hours} HOUR`];
}

/** HogQL: boot rows, sessions with engine rows, and those with no `session_end`
 *  in the window. One row, no grouping. */
export function buildCoverageQuery(hours) {
  const gate = windowGate(hours);
  return [
    "SELECT",
    "  countIf(event = 'boot') AS boots,",
    `  uniqIf(distinct_id, event = '${EVENT}') AS engine_sessions,`,
    `  uniqIf(distinct_id, event = '${EVENT}' AND distinct_id NOT IN (SELECT distinct_id FROM events WHERE event = 'session_end' AND ${gate.join(" AND ")})) AS engine_no_end`,
    "FROM events",
    `WHERE event IN ('boot', '${EVENT}')`,
    ...gate.map((g) => `  AND ${g}`),
  ].join("\n");
}

/** The coverage row as numbers; a missing or malformed row reads as zeros. */
export function coverageFromRows(rows) {
  const r = rows[0] ?? {};
  return { boots: num(r.boots), engineSessions: num(r.engine_sessions), engineNoEnd: num(r.engine_no_end) };
}

/** HogQL: how many sessions sent a `crash-reload` row. One row. */
export function buildTrapCountQuery(hours) {
  return [
    "SELECT uniqIf(distinct_id, properties.trigger = 'crash-reload') AS trap_sessions",
    "FROM events",
    `WHERE event = '${EVENT}'`,
    ...windowGate(hours).map((g) => `  AND ${g}`),
  ].join("\n");
}

/** HogQL: for each session that trapped, what its later rows say. A session
 *  with no later row at all is not returned (it is the unknown remainder). */
export function buildTrapOutcomeQuery(hours) {
  const gate = windowGate(hours);
  const outer = windowGate(hours, "e");
  return [
    "SELECT",
    "  e.distinct_id AS session_id,",
    "  countIf(e.properties.trigger = 'fallback' AND startsWith(e.properties.fallback_reason, 'trap-')) AS later_trap_fallbacks,",
    "  countIf(e.properties.trigger = 'crash-reload') AS later_traps,",
    "  countIf(e.properties.trigger = 'settle') AS later_settles,",
    "  countIf(e.properties.trigger = 'settle' AND e.properties.engine IN ('wasm', 'wasm-frame', 'wasm-worker') AND toFloat(e.properties.fallbacks) = 0) AS later_clean_settles",
    "FROM events AS e",
    "INNER JOIN (",
    "  SELECT distinct_id, min(timestamp) AS first_trap",
    "  FROM events",
    `  WHERE event = '${EVENT}' AND properties.trigger = 'crash-reload'`,
    ...gate.map((g) => `    AND ${g}`),
    "  GROUP BY distinct_id",
    ") AS t ON e.distinct_id = t.distinct_id",
    `WHERE e.event = '${EVENT}'`,
    ...outer.map((g) => `  AND ${g}`),
    "  AND e.timestamp > t.first_trap",
    "GROUP BY session_id",
    `LIMIT ${ROW_LIMIT}`,
  ].join("\n");
}

/** One trapped session's outcome from its later rows. Order matters: a later
 *  trap stops the game, whatever else ran. */
export function classifyTrap(row) {
  if (num(row.later_trap_fallbacks) > 0) return "stopped";
  if (num(row.later_clean_settles) > 0 && num(row.later_traps) === 0) return "recovered";
  if (num(row.later_settles) > 0) return "reloaded";
  return "unknown";
}

/** Sessions per outcome. `trapped` is the count of sessions with a trap row;
 *  those with no later row are unknown too. */
export function summarizeTraps(trapped, outcomeRows) {
  const t = { trapped: num(trapped), recovered: 0, stopped: 0, reloaded: 0, unknown: 0 };
  for (const row of outcomeRows) t[classifyTrap(row)]++;
  const seen = t.recovered + t.stopped + t.reloaded + t.unknown;
  t.unknown += Math.max(0, t.trapped - seen);
  return t;
}

/** A count that is zero reads "none seen", never a bare 0, so an empty window
 *  is not read as a clean one. */
const seen = (n) => (n === 0 ? "none seen" : String(n));

/** The section's markdown. `lives` are the engine report's page lives (before
 *  its filters), which hold the settle and attempt flags. */
export function renderCoverageMarkdown({ coverage, traps, lives }, meta) {
  const settled = lives.filter((l) => l.settled).length;
  const attemptOnly = lives.filter((l) => l.attempted && !l.settled).length;
  const out = [
    "## Telemetry coverage and trap recovery",
    "",
    `> Window: ${meta.windowLabel}, production. These are **cross-checks, not rates**. They do not follow the report's \`--hosts\`, \`--shas\`, \`--versions\` or \`--arms\` filters. Every event rides the same relay, so loss on the relay itself hides from all of them. See \`docs/analytics-measurement-status.md\`.`,
    "",
    "| Check | Count |",
    "| --- | --- |",
    `| Page lives with a \`boot\` row | ${seen(coverage.boots)} |`,
    `| Page lives with a \`settle\` row | ${seen(settled)} |`,
    `| Page lives with an \`attempt\` row and no \`settle\` (loaded, never settled) | ${seen(attemptOnly)} |`,
    `| Sessions with engine rows | ${seen(coverage.engineSessions)} |`,
    `| Of those, sessions with no \`session_end\` row in the window | ${seen(coverage.engineNoEnd)} |`,
    "",
    "> A page life that began before the window and one that ended after it sit on one side of a check only, so the two sides of a pair differ a little by construction. \"Sessions that ended\" and \"sessions with engine rows\" use different counting rules (`session_end` re-fires on every tab hide), so their difference is not lost sessions.",
    "",
  ];
  if (traps.trapped === 0) {
    out.push("**Trap recovery:** Insufficient evidence: no traps observed in the window.");
  } else {
    out.push(
      `**Trap recovery** (sessions with a \`crash-reload\` row: ${traps.trapped}). Counts of sessions, not a rate:`,
      "",
      "| Outcome | Sessions |",
      "| --- | --- |",
      `| Recovered (a later page life ran the engine with no fault) | ${seen(traps.recovered)} |`,
      `| Stopped (a later trap on the build) | ${seen(traps.stopped)} |`,
      `| Reloaded, not recovered (no clean engine run after the trap, or it trapped and reloaded again) | ${seen(traps.reloaded)} |`,
      `| Unknown (no later page life reached the relay; not a failure) | ${seen(traps.unknown)} |`,
    );
  }
  if (meta.truncated) out.push("", "> **Truncated:** a query returned a full page; read these as incomplete.");
  return out.join("\n");
}

/** Run the three queries and render; a failed query says so rather than printing zeros. */
export async function coverageSection(hours, windowLabel, lives) {
  const [cov, trapCount, outcomes] = [await runQuery(buildCoverageQuery(hours)), await runQuery(buildTrapCountQuery(hours)), await runQuery(buildTrapOutcomeQuery(hours))];
  for (const res of [cov, trapCount, outcomes]) {
    if (!res.ok) return `## Telemetry coverage and trap recovery\n\n> **Unavailable:** the query failed (${res.hint}). Nothing here is a zero.`;
    if (!Array.isArray(res.json?.results) || !Array.isArray(res.json?.columns)) return "## Telemetry coverage and trap recovery\n\n> **Unavailable:** the query returned no results table.";
  }
  const outcomeRows = rowsToObjects(outcomes.json);
  const truncated = outcomeRows.length >= ROW_LIMIT || outcomes.json.hasMore === true;
  const trapped = rowsToObjects(trapCount.json)[0]?.trap_sessions;
  return renderCoverageMarkdown({ coverage: coverageFromRows(rowsToObjects(cov.json)), traps: summarizeTraps(trapped, outcomeRows), lives }, { windowLabel, truncated });
}
