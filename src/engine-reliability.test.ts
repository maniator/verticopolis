import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// The governed definition of the engine reliability rate (#945's Reliability
// row; issue #1081). Every counting rule in scripts/engine-reliability.mjs is
// pinned here, so a change to a rule without a change to this test fails CI.
import {
  BUILDS,
  DEFAULT_HOSTS,
  EVENT,
  EXCLUDED_ARMS,
  HOSTS,
  REASONS,
  REQUESTS,
  ROW_LIMIT,
  buildPageLivesQuery,
  pageLivesFromRows,
  parseArgs,
  renderReliabilityMarkdown,
  responseRows,
  summarizeReliability,
  upperBound,
  type PageLife,
} from "../scripts/engine-reliability.mjs";
import { ENGINE_BUILDS, ENGINE_KINDS, ENGINE_STATUS_FIELDS } from "./analyticsEngineStatus";
import { FALLBACK_REASONS } from "./wasmhost/engineBoot";

const here = dirname(fileURLToPath(import.meta.url));
const collapse = (s: string) => s.replace(/\s+/g, " ");

/** A counted, clean page life; override what a case needs. */
function life(over: Partial<PageLife> = {}): PageLife {
  return {
    session: "s1",
    pageLife: `p-${Math.random()}`,
    version: "2.36.0",
    sha: "abc1234",
    build: "switchable",
    requested: "wasm",
    arm: "none",
    sizeGated: false,
    fallbacks: 0,
    settleFallbacks: 0,
    reasons: [],
    writerLatched: false,
    ...over,
  };
}

describe("the page-lives query", () => {
  const q = buildPageLivesQuery(720);

  it("reads only engine_status, production, inside the window", () => {
    expect(EVENT).toBe("engine_status");
    expect(q).toContain("WHERE event = 'engine_status'");
    expect(q).toContain("AND properties.environment = 'production'");
    expect(q).toContain("AND timestamp >= now() - INTERVAL 720 HOUR");
    expect(q).toContain("AND properties.page_life IS NOT NULL");
  });

  it("never reads session_end, which re-fires on every tab-hide", () => {
    expect(q).not.toMatch(/session_end/);
  });

  it("groups one row per session and page life, newest first, under a row limit", () => {
    // `session_id`, as the view names it: the events table has a `session`
    // field of its own.
    expect(q).toContain("distinct_id AS session_id,");
    expect(q).toContain("properties.page_life AS page_life,");
    expect(q).toContain("GROUP BY session_id, page_life");
    // The window holds the page lives that settled in it, so a fault from
    // before the window is never charged to it.
    expect(q).toContain("HAVING countIf(properties.trigger = 'settle') > 0");
    // A truncated result keeps the latest builds.
    expect(q).toContain("ORDER BY first_seen DESC");
    expect(q).toContain(`LIMIT ${ROW_LIMIT}`);
    expect(ROW_LIMIT).toBe(50_000);
  });

  it("takes the running count's peak and every reason the page life sent", () => {
    expect(q).toContain("max(toFloat(properties.fallbacks)) AS fallbacks,");
    // Whether the first tower already fell back: a later mismatch ran the engine.
    expect(q).toContain("maxIf(toFloat(properties.fallbacks), properties.trigger = 'settle') AS settle_fallbacks,");
    expect(q).toContain("groupUniqArray(properties.fallback_reason) AS reasons,");
    // Booleans as the session_lengths view reads `final`: `= true`, coalesced.
    expect(q).toContain("coalesce(max(properties.size_gated = true), false) AS size_gated,");
    expect(q).toContain("coalesce(max(properties.writer_latched = true), false) AS writer_latched,");
  });

  it("uses the same session unit as the session_lengths view", () => {
    // The view in scripts/posthog-dashboard.mjs is the governed session: a
    // distinct_id, production only. If the view's unit changes, this rate's
    // must change with it. Read from the view's own SQL, not the whole file.
    const dashboard = readFileSync(resolve(here, "../scripts/posthog-dashboard.mjs"), "utf8");
    const start = dashboard.indexOf("const SESSION_LENGTHS_SQL = [");
    expect(start, "the view's SQL should be findable").toBeGreaterThan(-1);
    const end = dashboard.indexOf('].join("\\n");', start);
    expect(end, "the view's SQL should end where it is joined").toBeGreaterThan(start);
    const view = collapse(dashboard.slice(start, end));
    expect(view).toContain("distinct_id AS session_id,");
    expect(view).toContain("GROUP BY distinct_id");
    expect(view).toContain("AND properties.environment = 'production'");
    expect(q).toContain("distinct_id AS session_id,");
    expect(q).toContain("properties.environment = 'production'");
  });

  it("reads only fields the game sends or the cohort work plans", () => {
    // Every properties.x the query names is a real engine_status field, the
    // relay's environment stamp, or one of the two the A4 cohort work adds (a
    // missing one reads as the default).
    const planned = ["arm", "size_gated", "environment"];
    const read = [...q.matchAll(/properties\.([a-z_]+)/g)].map((m) => m[1]);
    for (const field of read) expect([...ENGINE_STATUS_FIELDS, ...planned]).toContain(field);
  });
});

describe("pageLivesFromRows", () => {
  it("normalizes the query's rows, keeping a placeholder for a missing value", () => {
    const [a, b] = pageLivesFromRows([
      { session_id: "s", page_life: "p", version: "2.36.0", sha: "abc", build: "switchable", requested: "wasm", arm: null, size_gated: 1, fallbacks: "2", settle_fallbacks: 1, reasons: ["none", "attach-refused", ""], writer_latched: "true" },
      { session_id: "t", page_life: "q" },
    ]);
    expect(a).toEqual({ session: "s", pageLife: "p", version: "2.36.0", sha: "abc", build: "switchable", requested: "wasm", arm: "none", sizeGated: true, fallbacks: 2, settleFallbacks: 1, reasons: ["attach-refused"], writerLatched: true });
    expect(b).toMatchObject({ version: "unknown", sha: "unknown", build: "unknown", requested: "unknown", arm: "none", sizeGated: false, fallbacks: 0, settleFallbacks: 0, reasons: [], writerLatched: false });
  });

  it("never passes a forged value through to the report", () => {
    // The rows come from a public ingest route.
    const [pl] = pageLivesFromRows([{ session: "s", page_life: "p", version: "2.36.0 | [x](http://e.vil)", sha: "abc\n# hi", build: "<b>", reasons: ["boot-error", "![i](x)"] }]);
    expect(pl).toMatchObject({ version: "unrecognized", sha: "unrecognized", build: "unrecognized", reasons: ["boot-error", "unrecognized"] });
  });

  it("marks a fallback count that is not a whole number of zero or more", () => {
    const lives = pageLivesFromRows([-1, 0.5, Infinity, "abc"].map((fallbacks) => ({ session_id: "s", page_life: "p", fallbacks, settle_fallbacks: 0 })));
    for (const pl of lives) expect(pl.fallbacks).toBeNaN();
    const [settle] = pageLivesFromRows([{ session_id: "s", page_life: "p", fallbacks: 1, settle_fallbacks: -2 }]);
    expect(settle.settleFallbacks).toBeNaN();
  });
});

describe("upperBound (one-sided 95% Clopper-Pearson)", () => {
  it("matches the rule of three with no faults and about 4.74/n with one", () => {
    expect(upperBound(0, 1000)).toBeCloseTo(0.002991, 6);
    expect(upperBound(0, 3000)).toBeCloseTo(0.000998, 6);
    expect(upperBound(1, 4750)).toBeCloseTo(0.000998, 6);
    // Exact at n = 1: the 5% tail.
    expect(upperBound(0, 1)).toBeCloseTo(0.95, 9);
    expect(upperBound(2, 100)).toBeCloseTo(0.0616, 4);
  });

  it("is 1 when every trial failed and null with no sample", () => {
    expect(upperBound(5, 5)).toBe(1);
    expect(upperBound(0, 0)).toBeNull();
  });
});

describe("summarizeReliability", () => {
  it("counts sessions, not rows or page lives", () => {
    const s = summarizeReliability([life({ session: "a" }), life({ session: "a" }), life({ session: "b" })]);
    expect(s).toMatchObject({ n: 2, faults: 0, rate: 0, pageLives: 3 });
    expect(s.upper95).toBeCloseTo(upperBound(0, 2)!, 12);
  });

  it("counts a session once however many of its page lives faulted, and keeps it a fault after a clean reload", () => {
    const s = summarizeReliability([
      life({ session: "a", fallbacks: 1, reasons: ["boot-timeout"] }),
      life({ session: "a", fallbacks: 3, reasons: ["attach-refused"] }),
      life({ session: "a" }),
      life({ session: "b" }),
    ]);
    expect(s).toMatchObject({ n: 2, faults: 1, rate: 0.5, pageLives: 4, faultPageLives: 2 });
  });

  it("counts only the wasm host by default; the experimental hosts are measurement only", () => {
    expect(DEFAULT_HOSTS).toEqual(["wasm"]);
    const lives = [life({ session: "a", requested: "ts" }), life({ session: "b", requested: "wasm-worker", fallbacks: 1, reasons: ["boot-error"] }), life({ session: "c" })];
    expect(summarizeReliability(lives)).toMatchObject({ n: 1, faults: 0 });
    expect(summarizeReliability(lives, { hosts: ["wasm-worker"] })).toMatchObject({ n: 1, faults: 1 });
  });

  it("sets aside a mismatch that never ran the engine, counts a later one as a run without a fault, and reports both on their own line", () => {
    const s = summarizeReliability([
      // a: the settle row already fell back on the mismatch, so the engine never ran.
      life({ session: "a", fallbacks: 1, settleFallbacks: 1, reasons: ["package-mismatch"] }),
      // b: the same, then a reload that ran the engine clean.
      life({ session: "b", fallbacks: 1, settleFallbacks: 1, reasons: ["package-mismatch"] }),
      life({ session: "b" }),
      // c: the first tower ran on the engine; a later tower met the mismatch.
      life({ session: "c", fallbacks: 1, settleFallbacks: 0, reasons: ["package-mismatch"] }),
    ]);
    expect(s).toMatchObject({ n: 2, faults: 0, pageLives: 2, mismatchSessions: 3, mismatchPageLives: 3, mismatchNeverRan: 2 });
    // The mismatch has its own line, never the by-reason table.
    expect(s.byReason).toEqual([]);
  });

  it("counts a writer latch-off in a mismatch that never ran the engine", () => {
    const s = summarizeReliability([life({ session: "a", fallbacks: 1, settleFallbacks: 1, reasons: ["package-mismatch"], writerLatched: true }), life({ session: "b" })]);
    expect(s).toMatchObject({ n: 1, mismatchNeverRan: 1, latchedSessions: 1, latchedPageLives: 1 });
  });

  it("counts a mismatch that came with another reason as a fault, listing only the fault's reason", () => {
    const s = summarizeReliability([life({ fallbacks: 2, settleFallbacks: 1, reasons: ["package-mismatch", "attach-refused"] })]);
    expect(s).toMatchObject({ n: 1, faults: 1, mismatchSessions: 1, mismatchNeverRan: 0 });
    expect(s.byReason).toEqual([{ reason: "attach-refused", pageLives: 1 }]);
  });

  it("counts a session only for its counted page lives, even when another of its page lives faulted", () => {
    const s = summarizeReliability([
      life({ session: "a", requested: "wasm-worker", fallbacks: 1, reasons: ["boot-error"] }),
      life({ session: "a", arm: "override", fallbacks: 1, reasons: ["attach-refused"] }),
      life({ session: "a" }),
    ]);
    expect(s).toMatchObject({ n: 1, faults: 0, pageLives: 1 });
  });

  it("leaves out a page life carrying a value the game never sends, and counts it on its own line", () => {
    // The rows come through a public route; a forged one is not a session.
    const s = summarizeReliability([
      life({ session: "a", build: "unrecognized", fallbacks: 1, reasons: ["boot-error"] }),
      life({ session: "b", requested: "unknown" }),
      life({ session: "c", reasons: ["unrecognized"], fallbacks: 1 }),
      life({ session: "d", sha: "a" }),
      life({ session: "e", version: "unknown" }),
      life({ session: "f", sha: "unknown" }),
      life({ session: "g" }),
    ]);
    expect(s).toMatchObject({ n: 2, faults: 0, unrecognizedPageLives: 5 });
  });

  it("leaves out a page life whose fallback count no build sends", () => {
    // A negative count would read as a clean run, a fraction as a fallback,
    // and an infinite one would swallow the loop-size line.
    const s = summarizeReliability([
      life({ session: "a", fallbacks: -1, reasons: ["boot-error"] }),
      life({ session: "b", fallbacks: 0.5, reasons: ["boot-error"] }),
      life({ session: "c", fallbacks: Infinity, reasons: ["attach-refused"] }),
      life({ session: "d", fallbacks: Number.NaN }),
      life({ session: "e", fallbacks: 1, settleFallbacks: -1, reasons: ["package-mismatch"] }),
      life({ session: "f" }),
    ]);
    expect(s).toMatchObject({ n: 1, faults: 0, unrecognizedPageLives: 5, totalFallbacks: 0, maxFallbacks: 0, mismatchPageLives: 0 });
  });

  it("binds its closed lists to the values the game sends", () => {
    expect(REQUESTS).toEqual(ENGINE_KINDS.filter((k) => k !== "ts-fallback" && k !== "none"));
    expect(HOSTS).toEqual(REQUESTS.filter((r) => r !== "ts"));
    expect(BUILDS).toEqual([...ENGINE_BUILDS]);
    expect(REASONS).toEqual([...FALLBACK_REASONS]);
  });

  it("keeps a loop's size: the fallbacks sent in all and the most in one page life", () => {
    const s = summarizeReliability([life({ session: "a", fallbacks: 50, reasons: ["attach-refused"] }), life({ session: "b", fallbacks: 2, reasons: ["boot-error"] }), life({ session: "c" })]);
    expect(s).toMatchObject({ n: 3, faults: 2, totalFallbacks: 52, maxFallbacks: 50 });
  });

  it("counts a fallback with no reason sent as a fault", () => {
    expect(summarizeReliability([life({ fallbacks: 1, reasons: [] })])).toMatchObject({ n: 1, faults: 1 });
  });

  it("narrows to the asked commits, versions, bundles and arms, and reads a row with no arm as none", () => {
    const lives = [
      life({ session: "a", sha: "0dd0000", version: "2.35.0", fallbacks: 1, reasons: ["boot-error"] }),
      life({ session: "b", arm: "wasm" }),
      life({ session: "c", arm: "ts", build: "wasm-only" }),
    ];
    expect(summarizeReliability(lives, { shas: ["abc1234"] })).toMatchObject({ n: 2, faults: 0 });
    expect(summarizeReliability(lives, { versions: ["2.35.0"] })).toMatchObject({ n: 1, faults: 1 });
    expect(summarizeReliability(lives, { builds: ["wasm-only"] })).toMatchObject({ n: 1, faults: 0 });
    expect(summarizeReliability(lives, { arms: ["wasm"] })).toMatchObject({ n: 1 });
    expect(summarizeReliability(lives, { arms: ["none"] })).toMatchObject({ n: 1, faults: 1 });
  });

  it("matches a commit by prefix either way, so short commits of another length still match", () => {
    const lives = [life({ session: "a", sha: "abc1234" }), life({ session: "b", sha: "abc12345678" }), life({ session: "c", sha: "unknown" })];
    expect(summarizeReliability(lives, { shas: ["abc1234"] })).toMatchObject({ n: 2 });
    expect(summarizeReliability(lives, { shas: ["abc12345678ff"] })).toMatchObject({ n: 2 }); // a full commit matches its short form
    expect(summarizeReliability(lives, { shas: ["abc1299"] })).toMatchObject({ n: 0 });
    // Under 7 digits is no commit: it matches nothing (and the command line refuses it).
    expect(summarizeReliability(lives, { shas: ["abc12"] })).toMatchObject({ n: 0 });
  });

  it("leaves out the override and unassigned arms unless they are asked for", () => {
    expect(EXCLUDED_ARMS).toEqual(["override", "unassigned"]);
    const lives = [life({ session: "a", arm: "override", fallbacks: 1, reasons: ["boot-error"] }), life({ session: "b", arm: "unassigned" }), life({ session: "c", arm: "wasm" }), life({ session: "d" })];
    expect(summarizeReliability(lives)).toMatchObject({ n: 2, faults: 0 });
    expect(summarizeReliability(lives, { arms: ["override"] })).toMatchObject({ n: 1, faults: 1 });
  });

  it("leaves a size-gated page life outside the rate and counts it under the same filters", () => {
    const lives = [life({ session: "a", sizeGated: true, fallbacks: 1, reasons: ["boot-timeout"] }), life({ session: "b" }), life({ session: "c", sizeGated: true, sha: "0dd0000" })];
    expect(summarizeReliability(lives)).toMatchObject({ n: 1, faults: 0, sizeGatedPageLives: 2 });
    expect(summarizeReliability(lives, { shas: ["abc1234"] })).toMatchObject({ sizeGatedPageLives: 1 });
  });

  it("reports by arm as it reports by build", () => {
    const s = summarizeReliability([life({ session: "a", arm: "wasm", fallbacks: 1, reasons: ["trap-tick"] }), life({ session: "b", arm: "wasm" }), life({ session: "c", arm: "ts" })]);
    expect(s.byArm).toEqual([
      { arm: "ts", sessions: 1, faults: 0, pageLives: 1, faultPageLives: 0, upper95: upperBound(0, 1) },
      { arm: "wasm", sessions: 2, faults: 1, pageLives: 2, faultPageLives: 1, upper95: upperBound(1, 2) },
    ]);
  });

  it("charges a fault to its own build, counting a session under each build it ran", () => {
    const s = summarizeReliability([
      life({ session: "a", version: "2.36.0", sha: "abc1234", fallbacks: 1, reasons: ["trap-tick"] }),
      life({ session: "a", version: "2.37.0", sha: "def5678" }),
      life({ session: "b", version: "2.37.0", sha: "def5678" }),
    ]);
    // N still counts session a once.
    expect(s).toMatchObject({ n: 2, faults: 1 });
    expect(s.byBuild).toEqual([
      { build: "2.36.0 (abc1234, switchable)", sessions: 1, faults: 1, pageLives: 1, faultPageLives: 1, upper95: 1 },
      { build: "2.37.0 (def5678, switchable)", sessions: 2, faults: 0, pageLives: 2, faultPageLives: 0, upper95: upperBound(0, 2) },
    ]);
  });

  it("counts writer latch-offs by session and page life, separately from faults", () => {
    const s = summarizeReliability([life({ session: "a", writerLatched: true }), life({ session: "a", writerLatched: true }), life({ session: "b" })]);
    expect(s).toMatchObject({ n: 2, faults: 0, latchedSessions: 1, latchedPageLives: 2 });
  });

  it("ranks reasons by page lives", () => {
    const s = summarizeReliability([
      life({ session: "a", fallbacks: 1, reasons: ["boot-timeout"] }),
      life({ session: "b", fallbacks: 2, reasons: ["attach-refused", "boot-timeout"] }),
      life({ session: "c", fallbacks: 1, reasons: ["attach-refused"] }),
      life({ session: "d", fallbacks: 1, reasons: ["boot-timeout"] }),
    ]);
    expect(s.byReason).toEqual([
      { reason: "boot-timeout", pageLives: 3 },
      { reason: "attach-refused", pageLives: 2 },
    ]);
  });

  it("reports no rate on an empty sample", () => {
    expect(summarizeReliability([])).toMatchObject({ n: 0, faults: 0, rate: null, upper95: null });
  });
});

describe("the command line", () => {
  it("reads the window and the lists", () => {
    expect(parseArgs([])).toEqual({ window: { hours: 720, label: "30 days" }, opts: { hosts: ["wasm"], shas: null, versions: null, builds: null, arms: null } });
    expect(parseArgs(["--window=7", "--shas", "abc1234, def5678a", "--arms", "wasm", "--hosts", "wasm,wasm-frame", "--builds", "wasm-only", "--versions", "2.36.0"]).opts).toEqual({
      hosts: ["wasm", "wasm-frame"],
      shas: ["abc1234", "def5678a"],
      versions: ["2.36.0"],
      builds: ["wasm-only"],
      arms: ["wasm"],
    });
  });

  it("fails on a value its flag cannot hold, or a flag given twice, instead of counting nothing", () => {
    expect(() => parseArgs(["--hosts", "wsam"])).toThrow(/--hosts cannot hold "wsam"/);
    // A TypeScript page life never runs the engine, so it cannot count.
    expect(() => parseArgs(["--hosts", "ts"])).toThrow(/--hosts cannot hold "ts"/);
    expect(() => parseArgs(["--builds", "switchble"])).toThrow(/--builds cannot hold/);
    expect(() => parseArgs(["--shas", "ABC1234"])).toThrow(/--shas cannot hold/);
    expect(() => parseArgs(["--shas", "abc12"])).toThrow(/--shas cannot hold/);
    expect(() => parseArgs(["--versions", "v2.36.0"])).toThrow(/--versions cannot hold/);
    expect(() => parseArgs(["--arms", "a|b"])).toThrow(/--arms cannot hold/);
    expect(() => parseArgs(["--hosts", "wasm", "--hosts", "wasm-frame"])).toThrow(/--hosts is given twice/);
    expect(() => parseArgs(["--window", "30", "--window=7"])).toThrow(/--window is given twice/);
  });

  it("fails on an unknown flag, a missing value or an empty list instead of counting the wrong thing", () => {
    expect(() => parseArgs(["--days", "7"])).toThrow(/unknown flag --days/);
    expect(() => parseArgs(["--hosts", "--shas", "abc"])).toThrow(/--hosts needs a value/);
    expect(() => parseArgs(["--shas"])).toThrow(/--shas needs a value/);
    expect(() => parseArgs(["--shas", ","])).toThrow(/comma list/);
    expect(() => parseArgs(["wasm"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["--window", "nonsense"])).toThrow(/Invalid look-back window/);
  });
});

describe("responseRows", () => {
  it("reads the results table and flags a full page or more to come", () => {
    expect(responseRows({ columns: ["a"], results: [[1]] })).toEqual({ rows: [{ a: 1 }], truncated: false });
    expect(responseRows({ columns: ["a"], results: [[1]], hasMore: true }).truncated).toBe(true);
    expect(responseRows({ columns: ["a"], results: Array.from({ length: ROW_LIMIT }, () => [1]) }).truncated).toBe(true);
  });

  it("fails on a body that is not a results table, so it never prints as an empty window", () => {
    expect(() => responseRows({ raw: "<html>" })).toThrow(/no results table/);
    expect(() => responseRows(null)).toThrow(/no results table/);
  });
});

describe("renderReliabilityMarkdown", () => {
  const meta = { windowLabel: "last 30 days", until: "2026-10-20 12:00", hosts: ["wasm"], builds: "all", arms: "all", truncated: false };

  it("puts the snapshot window, the live source and the lower-bound caveat above every figure", () => {
    const md = renderReliabilityMarkdown(summarizeReliability([life()]), meta);
    const firstFigure = md.indexOf("| Measure |");
    // Until the eligibility split (#1090), every session is early telemetry,
    // which plan 4.1 (OD-2) never publishes as a reliability figure.
    for (const lead of ["**Snapshot** of the last 30 days to 2026-10-20 12:00 (UTC), production only", "node scripts/engine-reliability.mjs", "src/engine-reliability.test.ts", "**Early telemetry, not release evidence.**", "**A lower bound.**"]) {
      const at = md.indexOf(lead);
      expect(at, lead).toBeGreaterThan(-1);
      expect(at, lead).toBeLessThan(firstFigure);
    }
  });

  it("flags a truncated query above the figures", () => {
    const md = renderReliabilityMarkdown(summarizeReliability([]), { ...meta, truncated: true });
    expect(md.indexOf("**Truncated:**")).toBeGreaterThan(-1);
    expect(md.indexOf("**Truncated:**")).toBeLessThan(md.indexOf("| Measure |"));
    expect(renderReliabilityMarkdown(summarizeReliability([]), meta)).not.toContain("Truncated");
  });

  it("prints the rate and its bound", () => {
    const md = renderReliabilityMarkdown(summarizeReliability([life({ session: "a", fallbacks: 1, reasons: ["boot-error"] }), life({ session: "b" })]), meta);
    expect(md).toContain("| Engine sessions (N) | 2 |");
    expect(md).toContain("| Sessions with an engine-fault fallback | 1 |");
    expect(md).toContain("| Fault rate | 50.000% |");
    expect(md).toContain("| `boot-error` | 1 |");
    expect(md).toContain("## By arm");
    expect(md).toContain("| `none` | 2 | 1 |");
    expect(md).toContain("| Fallbacks the counted page lives sent | 1 in all, at most 1 in one page life |");
    expect(md).toContain("| Unrecognized page lives (values the game never sends; left out) | 0 |");
  });

  it("prints every value in a code span, so none reads as markup", () => {
    const md = renderReliabilityMarkdown(summarizeReliability([life({ arm: "__x__" })], { arms: ["__x__"] }), meta);
    expect(md).toContain("| `__x__` | 1 | 0 |");
  });

  it("names the worker host's blind spots when it is counted", () => {
    expect(renderReliabilityMarkdown(summarizeReliability([]), meta)).not.toContain("**The worker host**");
    const md = renderReliabilityMarkdown(summarizeReliability([]), { ...meta, hosts: ["wasm", "wasm-worker"] });
    expect(md.indexOf("**The worker host**")).toBeGreaterThan(-1);
    expect(md.indexOf("**The worker host**")).toBeLessThan(md.indexOf("| Measure |"));
  });
});
