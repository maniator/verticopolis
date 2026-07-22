import { describe, expect, it } from "vitest";
// The PostHog report generator is a dependency-free Node script (see
// scripts/posthog-report.mjs). Its pure helpers (the HogQL query builders and
// the response normalizers) are exported so they can be pinned here without a
// live PostHog query.
import {
  clampDays,
  lit,
  buildTotalsQuery,
  buildDepthQuery,
  buildBreakdownQuery,
  rowsToObjects,
  totalsByEvent,
  depthRow,
  breakdownRows,
} from "../scripts/posthog-report.mjs";

describe("clampDays (look-back guard)", () => {
  it("defaults, floors, and caps the window", () => {
    expect(clampDays("30")).toBe(30);
    expect(clampDays("0")).toBe(30); // below the floor -> default
    expect(clampDays("-5")).toBe(30);
    expect(clampDays("nonsense")).toBe(30);
    expect(clampDays("1000")).toBe(365); // capped
    expect(clampDays("45.9")).toBe(45); // floored to an integer
  });
});

describe("lit (HogQL string-literal escaper)", () => {
  it("wraps in single quotes and escapes quotes and backslashes", () => {
    expect(lit("boot")).toBe("'boot'");
    expect(lit("o'brien")).toBe("'o\\'brien'");
    // Backslash is escaped first, so a value ending in one can't escape the
    // closing quote and break out of the literal.
    expect(lit("a\\b")).toBe("'a\\\\b'");
  });
});

describe("HogQL query builders", () => {
  it("totals query filters to production, the window, and the event set", () => {
    const q = buildTotalsQuery(["boot", "session_end"], 30);
    expect(q).toContain("properties.environment = 'production'");
    expect(q).toContain("INTERVAL 30 DAY");
    expect(q).toContain("event IN ('boot', 'session_end')");
    expect(q).toContain("count(DISTINCT distinct_id) AS sessions");
  });

  it("depth query computes exact quantiles and guards nulls with the cast", () => {
    const q = buildDepthQuery("session_end", "seconds", 14);
    expect(q).toContain("quantile(0.5)(toFloat(properties.seconds))");
    expect(q).toContain("quantile(0.9)(toFloat(properties.seconds))");
    expect(q).toContain("quantile(0.95)(toFloat(properties.seconds))");
    expect(q).toContain("event = 'session_end'");
    expect(q).toContain("toFloat(properties.seconds) IS NOT NULL");
    expect(q).toContain("INTERVAL 14 DAY");
  });

  it("breakdown query groups by the property and counts sessions per group", () => {
    const q = buildBreakdownQuery("boot", "platform", 30);
    expect(q).toContain("properties.platform AS k");
    expect(q).toContain("count(DISTINCT distinct_id) AS sessions");
    expect(q).toContain("GROUP BY k ORDER BY events DESC LIMIT 100");
    expect(q).toContain("event = 'boot'");
  });
});

describe("rowsToObjects (HogQL response normalizer)", () => {
  it("keys each result row by its column name", () => {
    const json = { columns: ["event", "events", "sessions"], results: [["boot", 5400, 2600], ["crash", 37, 30]] };
    expect(rowsToObjects(json)).toEqual([
      { event: "boot", events: 5400, sessions: 2600 },
      { event: "crash", events: 37, sessions: 30 },
    ]);
  });

  it("returns [] on shape drift (missing results or columns)", () => {
    expect(rowsToObjects({ results: [[1]] })).toEqual([]);
    expect(rowsToObjects({ columns: ["a"] })).toEqual([]);
    expect(rowsToObjects(null)).toEqual([]);
  });
});

describe("totalsByEvent (totals fold)", () => {
  const events = ["boot", "session_end", "crash"];
  it("folds rows into a per-event lookup and zero-fills missing events", () => {
    const res = { ok: true, json: { columns: ["event", "events", "sessions"], results: [["boot", 5400, 2600]] } };
    const out = totalsByEvent(res, events);
    expect(out.boot).toEqual({ events: 5400, sessions: 2600 });
    // session_end and crash never appeared -> zero, not undefined.
    expect(out.session_end).toEqual({ events: 0, sessions: 0 });
    expect(out.crash).toEqual({ events: 0, sessions: 0 });
  });

  it("zero-fills every event when the query was skipped", () => {
    const out = totalsByEvent({ ok: false, hint: "forbidden" }, events);
    expect(out.boot).toEqual({ events: 0, sessions: 0 });
  });
});

describe("depthRow (exact percentile row)", () => {
  it("reads the single stats row when there is a sample", () => {
    const res = { ok: true, json: { columns: ["n", "p50", "p90", "p95", "mx"], results: [[3120, 92.4, 640, 1180, 4200]] } };
    const r = depthRow(res);
    expect(r).toMatchObject({ skipped: false, empty: false, n: 3120, p50: 92.4, p90: 640, p95: 1180, max: 4200 });
  });

  it("flags an empty window (a zero-count row) distinctly from a skip", () => {
    const res = { ok: true, json: { columns: ["n", "p50", "p90", "p95", "mx"], results: [[0, null, null, null, null]] } };
    expect(depthRow(res)).toEqual({ skipped: false, empty: true });
  });

  it("flags a skipped query with its hint", () => {
    expect(depthRow({ ok: false, hint: "unauthorized" })).toEqual({ skipped: true, hint: "unauthorized" });
  });
});

describe("breakdownRows (grouped result normalizer)", () => {
  it("sorts by events desc and labels an empty group value (none)", () => {
    const res = {
      ok: true,
      json: {
        columns: ["k", "events", "sessions"],
        results: [
          ["web", 4200, 2000],
          ["", 10, 8],
          ["twa", 900, 500],
        ],
      },
    };
    expect(breakdownRows(res)).toEqual([
      { key: "web", events: 4200, sessions: 2000 },
      { key: "twa", events: 900, sessions: 500 },
      { key: "(none)", events: 10, sessions: 8 },
    ]);
  });

  it("returns null when the query was skipped", () => {
    expect(breakdownRows({ ok: false, hint: "network error" })).toBeNull();
  });
});
