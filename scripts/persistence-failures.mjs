#!/usr/bin/env node
/**
 * The governed definition of the persistence failure measures: the
 * `autosave_failed`, `load_failed` and `import_failed` `app_action` codes
 * (#1533, approved by the owner on 2026-11-03), and what each can say.
 * `src/persistence-failures.test.ts` pins every rule here. The codes and their
 * `detail` values are in `docs/analytics-data-map.md`; what each measure can
 * support is in `docs/analytics-measurement-status.md`, rows 8 to 10.
 *
 * Counts and rates are kept apart. A COUNT is what the relay received. A RATE
 * needs a denominator of attempts, and is printed only where the game sends one:
 * - Import of a `.vctower`: `import_failed` with detail `save`, over the
 *   `import_save` attempts (sent when the file is handed over, before it is
 *   parsed).
 * - Import of a `.TDT`: `import_failed` with detail `tdt`, over the `import_tdt`
 *   attempts. A refusal is counted at the file read; a failure after the player
 *   confirms "Open tower" is not.
 * - Slot load: `load_failed` over `load_slot` (sent only on success) plus
 *   `load_failed`. The saves manager and the title-screen picker both send them.
 *   An empty slot and an unreadable one read alike. Quick Load ("No saved tower
 *   found") sends neither, so it is outside this measure.
 * - Autosave: NO rate. `autosave_failed` is latched once per page life (a reload
 *   re-opens the latch, so events can exceed sessions) and the game sends no
 *   autosave attempt or success, so there is no attempt count to divide by. The
 *   report prints the sessions with a failure, counted once across both details,
 *   and says the rate is unavailable. A denominator is never inferred from
 *   another event.
 *
 * A rate is per attempt, not per session or per player. It is an observed,
 * coverage-limited rate with unknown bias, never a lower bound: attempts that
 * never report can sit in the numerator or the denominator. Its exact 95% upper
 * bound holds for the observed sample only, and attempts are not independent
 * (one device that fails may fail every time), so the bound is optimistic. With
 * no attempts the report says "Insufficient evidence", and with attempts and no
 * failures it prints the bound, never a bare 0%. Counts that cannot be right
 * (more failures than attempts, which means attempt rows were lost) print
 * "unavailable".
 *
 * - Export of a `.vctower` or a `.TDT`: `export_failed` (detail `save` or `tdt`,
 *   an export that wrote no file) next to the `export_save` and `export_tdt`
 *   attempts. NO rate: those attempts are sent when the player clicks Export,
 *   before the report dialog, so they include a cancelled report and a click the
 *   export latch drops. The ratio would understate the failure rate by an amount
 *   nobody can measure, so the report prints the counts and the attempts side by
 *   side and says the rate is unavailable. A download the browser blocks is not
 *   seen, and a failure that kills the tab reports nothing.
 *
 * Only builds from `PERSISTENCE_FAILURE_SINCE` send the failure codes, so only
 * their rows are read, attempts included. The export rows have their own first
 * version, `EXPORT_FAILURE_SINCE`, because `export_failed` shipped later, and the
 * same rule applies to them: an older build's `export_save` row is never read,
 * or it would look like an export that failed without a report. A presence probe counts the `boot`
 * rows of those builds in the window; with none, every measure reads "Not
 * measurable" and no zero is printed, so "the code did not exist yet" is never
 * confused with "it shipped and nothing failed". The section does not follow the
 * engine report's `--hosts`, `--shas`, `--versions` or `--arms` filters.
 *
 * Run: `POSTHOG_PERSONAL_API_KEY=phx_... node scripts/persistence-failures.mjs
 * --window 30`; `scripts/engine-reliability.mjs` prints the same section under
 * its rate.
 */

import { pathToFileURL } from "node:url";
import { parseWindow, rowsToObjects, runQuery } from "./posthog-report.mjs";
import { upperBound } from "./engine-reliability.mjs";

/** The first app version whose builds send the three failure codes. */
export const PERSISTENCE_FAILURE_SINCE = "2.78.4";

/** The first app version whose production builds send `export_failed` (#1700,
 *  merged as e51a74df). Production deploys from `main`, which read 2.78.8 at
 *  that merge and 2.78.10 two minutes later, so 2.78.8 is the only older
 *  version that carried the code, for those two minutes. The gate leaves that
 *  window out, and no production build says 2.78.10 without the code. */
export const EXPORT_FAILURE_SINCE = "2.78.10";

/** Every `app_action` this report reads from builds at or above
 *  `PERSISTENCE_FAILURE_SINCE`. */
export const ACTIONS = ["import_save", "import_tdt", "import_failed", "load_slot", "load_failed", "autosave_failed"];

/** The `detail` values the game sends for each action that carries one. A row
 *  with another detail is left out, so a forged value is never counted. */
export const DETAILS = { import_failed: ["save", "tdt"], autosave_failed: ["timer", "manual"], export_failed: ["save", "tdt"] };

/** Every `app_action` this report reads from builds at or above
 *  `EXPORT_FAILURE_SINCE`: the export failure code and the export attempts. */
export const EXPORT_ACTIONS = ["export_save", "export_tdt", "export_failed"];

const everyAction = [...ACTIONS, ...EXPORT_ACTIONS];

/** Rows one query may return. Actions x details is a handful; a full page is an error. */
export const ROW_LIMIT = 500;

/** The version gate as one condition, shared by both queries: a plain
 *  `major.minor.patch` at or above `since` (a prerelease or forged value is
 *  left out). */
function versionExpr(since) {
  const parts = since.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error(`bad version ${since}`);
  return `(match(properties.version, '^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$') AND arrayMap(x -> toInt(x), splitByChar('.', properties.version)) >= [${parts.join(", ")}])`;
}

const inList = (list) => list.map((a) => `'${a}'`).join(", ");

/** HogQL: one row per action and detail, production only. The six persistence
 *  codes count from the first version that sends them, the export codes from
 *  `EXPORT_FAILURE_SINCE`, each behind its own gate. `uniq(distinct_id)` counts
 *  sessions (a tab); read it per row, never summed across rows. */
export function buildPersistenceQuery(hours, since = PERSISTENCE_FAILURE_SINCE, exportSince = EXPORT_FAILURE_SINCE) {
  return [
    "SELECT",
    "  properties.action AS action,",
    "  properties.detail AS detail,",
    "  count() AS events,",
    "  uniq(distinct_id) AS sessions",
    "FROM events",
    "WHERE event = 'app_action'",
    "  AND properties.environment = 'production'",
    `  AND timestamp >= now() - INTERVAL ${hours} HOUR`,
    `  AND ((properties.action IN (${inList(ACTIONS)}) AND ${versionExpr(since)})`,
    `    OR (properties.action IN (${inList(EXPORT_ACTIONS)}) AND ${versionExpr(exportSince)}))`,
    "GROUP BY action, detail",
    `LIMIT ${ROW_LIMIT}`,
  ].join("\n");
}

/** HogQL: the presence probe and the autosave session count, in one grouping-
 *  free row. `liveEvents` is every `boot` or `app_action` row from builds that
 *  send the codes (a long-lived tab can send app_action rows with its boot
 *  before the window, so a boot count alone would hide real counts); a window
 *  with none reads Not measurable; `exportLiveEvents` is the same count for
 *  builds that send `export_failed`, so the export rows read Not measurable on
 *  their own; `autosave_sessions` is the sessions with an `autosave_failed`
 *  under either detail, counted once. */
export function buildPresenceQuery(hours, since = PERSISTENCE_FAILURE_SINCE, exportSince = EXPORT_FAILURE_SINCE) {
  return [
    "SELECT",
    "  count() AS live_events,",
    `  countIf(${versionExpr(exportSince)}) AS export_live_events,`,
    `  uniqIf(distinct_id, event = 'app_action' AND properties.action = 'autosave_failed' AND properties.detail IN (${DETAILS.autosave_failed.map((d) => `'${d}'`).join(", ")})) AS autosave_sessions`,
    "FROM events",
    "WHERE event IN ('boot', 'app_action')",
    "  AND properties.environment = 'production'",
    `  AND timestamp >= now() - INTERVAL ${hours} HOUR`,
    `  AND ${versionExpr(since)}`,
  ].join("\n");
}

const num = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

/** Normalize the query's rows into `{ events, sessions }` per `action` or
 *  `action:detail` key. An action, or a detail outside the closed lists, is
 *  left out. */
export function tallyRows(rows) {
  const tally = new Map();
  for (const r of rows) {
    const action = String(r.action ?? "");
    if (!everyAction.includes(action)) continue;
    const detail = r.detail == null || r.detail === "" ? "" : String(r.detail);
    const allowed = DETAILS[action];
    if (allowed ? !allowed.includes(detail) : detail !== "") continue;
    const key = detail ? `${action}:${detail}` : action;
    const prior = tally.get(key) ?? { events: 0, sessions: 0 };
    // Rows are one per action and detail, so a key is seen once. Rows are summed
    // only if a caller hands over duplicates; sessions are never combined across
    // different keys.
    tally.set(key, { events: prior.events + num(r.events), sessions: prior.sessions + num(r.sessions) });
  }
  return tally;
}

/** The presence row as numbers; a missing or malformed row reads as no presence. */
export function presenceFromRows(rows) {
  const r = rows[0] ?? {};
  return { liveEvents: num(r.live_events), exportLiveEvents: num(r.export_live_events), autosaveSessions: num(r.autosave_sessions) };
}

const at = (tally, key) => tally.get(key) ?? { events: 0, sessions: 0 };

/** One rate: failures over attempts, or why it is unavailable. */
export function rateOf(failures, attempts) {
  if (!(attempts > 0)) return { status: "insufficient", text: "Insufficient evidence: no attempts in the window" };
  if (failures > attempts) return { status: "unavailable", text: "Unavailable: more failures than attempts, so attempt rows were lost" };
  const bound = upperBound(failures, attempts);
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  return failures === 0
    ? { status: "bound", text: `0 of ${attempts} attempts; 95% upper bound ${pct(bound)}` }
    : { status: "rate", text: `${failures} of ${attempts} attempts (${pct(failures / attempts)}); 95% upper bound ${pct(bound)}` };
}

const EXPORT_RATE_UNAVAILABLE = {
  status: "unavailable",
  text: "Unavailable: the attempts are sent at the click, so they include a cancelled report and a dropped click; a ratio would understate the failure rate",
};

const NOT_MEASURABLE = { status: "not-measurable", text: "Not measurable: no build that sends these codes ran in the window" };

/** The measures, each with its count and its rate or the reason there is none.
 *  `presence.liveEvents` of zero means no build that sends the codes ran, so nothing
 *  is counted: every cell reads Not measurable, never zero. The export measures
 *  follow `presence.exportLiveEvents` the same way, since their builds are later. */
export function summarizePersistence(tally, presence) {
  const measure = (name, failures, sessions, attempts, rate, live = presence.liveEvents) =>
    live > 0 ? { measure: name, failures, sessions, attempts, rate } : { measure: name, failures: null, sessions: null, attempts: null, rate: NOT_MEASURABLE };
  const exportMeasure = (name, failure, attempts) =>
    measure(name, failure.events, failure.sessions, attempts, EXPORT_RATE_UNAVAILABLE, presence.exportLiveEvents);
  const importSave = at(tally, "import_save").events;
  const importTdt = at(tally, "import_tdt").events;
  const loadOk = at(tally, "load_slot").events;
  const loadBad = at(tally, "load_failed");
  const saveFail = at(tally, "import_failed:save");
  const tdtFail = at(tally, "import_failed:tdt");
  const exportSaveFail = at(tally, "export_failed:save");
  const exportTdtFail = at(tally, "export_failed:tdt");
  return [
    measure("Import of a .vctower", saveFail.events, saveFail.sessions, importSave, rateOf(saveFail.events, importSave)),
    measure("Import of a .TDT (refusal at the file read)", tdtFail.events, tdtFail.sessions, importTdt, rateOf(tdtFail.events, importTdt)),
    measure("Slot load (manager and title screen)", loadBad.events, loadBad.sessions, loadOk + loadBad.events, rateOf(loadBad.events, loadOk + loadBad.events)),
    measure("Autosave, Quick Save and slot save", null, presence.autosaveSessions, null, {
      status: "unavailable",
      text: "Unavailable: the game sends no autosave attempt or success, and a failure is latched once per page life",
    }),
    exportMeasure("Export of a .vctower (an export that wrote no file)", exportSaveFail, at(tally, "export_save").events),
    exportMeasure("Export of a .TDT (an export that wrote no file)", exportTdtFail, at(tally, "export_tdt").events),
  ];
}

/** The Markdown section, with the counts-versus-rates reading rules at the top. */
export function renderPersistenceMarkdown(measures, meta) {
  const cell = (n) => (n === null ? "n/a" : String(n));
  const lines = [
    "## Persistence failures (counts, and rates only where attempts are known)",
    "",
    `> Window: ${meta.windowLabel}, production, builds from ${PERSISTENCE_FAILURE_SINCE} (the first to send \`autosave_failed\`, \`load_failed\` and \`import_failed\`); the two export rows count builds from ${EXPORT_FAILURE_SINCE} (the first production version to send \`export_failed\`). With no such build in the window a measure is **Not measurable**, not zero. This section does not follow the report's \`--hosts\`, \`--shas\`, \`--versions\` or \`--arms\` filters.`,
    "> A **count** is what the relay received. A **rate** is printed only where the game sends the attempts; it is per attempt, not per session or player, it is an observed, coverage-limited rate with unknown bias (attempts that never report can sit in the numerator or the denominator), not a lower bound, and its exact bound holds for the observed sample only and is optimistic because attempts are not independent. A tab killed by the failure, or a blocked relay, reports nothing, so every count is a lower bound. See `docs/analytics-measurement-status.md`, rows 8 to 10 and 24.",
    "",
    "| Measure | Failures (count) | Sessions with a failure | Attempts | Rate |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const m of measures) lines.push(`| ${m.measure} | ${cell(m.failures)} | ${cell(m.sessions)} | ${cell(m.attempts)} | ${m.rate.text} |`);
  if (meta.truncated) lines.push("", "> **Truncated:** the query returned a full page; read these as incomplete.");
  return lines.join("\n");
}

/** Run both queries and render the section; a failed query says so rather than printing zeros. */
export async function persistenceSection(hours, windowLabel) {
  const [counts, probe] = [await runQuery(buildPersistenceQuery(hours)), await runQuery(buildPresenceQuery(hours))];
  for (const res of [counts, probe]) {
    if (!res.ok) return `## Persistence failures\n\n> **Unavailable:** the query failed (${res.hint}). Nothing here is a zero.`;
    if (!Array.isArray(res.json?.results) || !Array.isArray(res.json?.columns)) return "## Persistence failures\n\n> **Unavailable:** the query returned no results table.";
  }
  const rows = rowsToObjects(counts.json);
  const truncated = rows.length >= ROW_LIMIT || counts.json.hasMore === true;
  return renderPersistenceMarkdown(summarizePersistence(tallyRows(rows), presenceFromRows(rowsToObjects(probe.json))), { windowLabel, truncated });
}

async function main() {
  const i = process.argv.indexOf("--window");
  if (!process.env.POSTHOG_PERSONAL_API_KEY) {
    console.error("POSTHOG_PERSONAL_API_KEY is not set (a phx_... personal key with query:read; see scripts/posthog-report.mjs).");
    process.exit(1);
  }
  const span = parseWindow(i >= 0 ? process.argv[i + 1] : "30");
  console.log(await persistenceSection(span.hours, `last ${span.label}`));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error("Report failed:", err.message ?? err);
    process.exit(1);
  });
}
