import { describe, expect, it } from "vitest";
// The PostHog report generator is a dependency-free Node script (see
// scripts/posthog-report.mjs). Its pure helpers (the HogQL query builders and
// the response normalizers) are exported so they can be pinned here without a
// live PostHog query.
import {
  parseWindow,
  lit,
  buildTotalsQuery,
  buildDepthQuery,
  buildBreakdownQuery,
  buildFilteredCountQuery,
  rowsToObjects,
  totalsByEvent,
  depthRow,
  breakdownRows,
  countRow,
} from "../scripts/posthog-report.mjs";

describe("parseWindow (look-back parser)", () => {
  it("reads plain numbers as days", () => {
    expect(parseWindow("30")).toEqual({ hours: 720, label: "30 days" });
    expect(parseWindow("1")).toEqual({ hours: 24, label: "1 day" });
    expect(parseWindow("0.5")).toEqual({ hours: 12, label: "12 hours" }); // the half-day case that used to become 30 days
    expect(parseWindow(".25")).toEqual({ hours: 6, label: "6 hours" });
  });

  it("accepts day and hour unit suffixes", () => {
    expect(parseWindow("3d")).toEqual({ hours: 72, label: "3 days" });
    expect(parseWindow("12h")).toEqual({ hours: 12, label: "12 hours" });
    expect(parseWindow("1 hour")).toEqual({ hours: 1, label: "1 hour" });
    expect(parseWindow("36 hours")).toEqual({ hours: 36, label: "36 hours" });
    expect(parseWindow("48H")).toEqual({ hours: 48, label: "2 days" }); // whole days label as days
  });

  it("rounds to whole hours", () => {
    expect(parseWindow("1.5h").hours).toBe(2);
    expect(parseWindow("45.9").hours).toBe(1102); // 45.9 days, kept instead of floored to 45
  });

  it("throws on anything invalid or out of bounds instead of silently defaulting", () => {
    expect(() => parseWindow("nonsense")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("-5")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("1e309")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("")).toThrow(/Invalid look-back window/);
    expect(() => parseWindow("0")).toThrow(/shorter than 1 hour/);
    expect(() => parseWindow("0.4h")).toThrow(/shorter than 1 hour/); // rounds to 0 hours
    expect(() => parseWindow("1000")).toThrow(/longer than 365 days/);
  });

  it("keeps the bounds inclusive", () => {
    expect(parseWindow("1h").hours).toBe(1);
    expect(parseWindow("365").hours).toBe(365 * 24);
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
    const q = buildTotalsQuery(["boot", "session_end"], 720);
    expect(q).toContain("properties.environment = 'production'");
    expect(q).toContain("INTERVAL 720 HOUR");
    expect(q).toContain("event IN ('boot', 'session_end')");
    expect(q).toContain("count(DISTINCT distinct_id) AS sessions");
  });

  it("depth query computes exact quantiles and guards nulls with the cast", () => {
    const q = buildDepthQuery("session_end", "seconds", 336);
    expect(q).toContain("quantile(0.5)(toFloat(properties.seconds))");
    expect(q).toContain("quantile(0.9)(toFloat(properties.seconds))");
    expect(q).toContain("quantile(0.95)(toFloat(properties.seconds))");
    expect(q).toContain("event = 'session_end'");
    expect(q).toContain("toFloat(properties.seconds) IS NOT NULL");
    expect(q).toContain("INTERVAL 336 HOUR");
  });

  it("breakdown query groups by the property and counts sessions per group", () => {
    const q = buildBreakdownQuery("boot", "platform", 720);
    expect(q).toContain("properties.platform AS k");
    expect(q).toContain("count(DISTINCT distinct_id) AS sessions");
    expect(q).toContain("GROUP BY k ORDER BY events DESC LIMIT 100");
    expect(q).toContain("event = 'boot'");
  });

  it("filtered-count query narrows the event by a trusted boolean expression", () => {
    const q = buildFilteredCountQuery("session_emergencies", "toFloat(properties.fires) > 0", 168);
    expect(q).toContain("properties.environment = 'production'");
    expect(q).toContain("INTERVAL 168 HOUR");
    expect(q).toContain("event = 'session_emergencies'");
    expect(q).toContain("AND (toFloat(properties.fires) > 0)");
    expect(q).toContain("count(DISTINCT distinct_id) AS sessions");
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

describe("countRow (filtered-count row)", () => {
  it("reads the single events/sessions row", () => {
    const res = { ok: true, json: { columns: ["events", "sessions"], results: [[42, 30]] } };
    expect(countRow(res)).toEqual({ events: 42, sessions: 30 });
  });

  it("zeroes an empty window (no rows)", () => {
    expect(countRow({ ok: true, json: { columns: ["events", "sessions"], results: [] } })).toEqual({ events: 0, sessions: 0 });
  });

  it("zeroes and flags a skipped query with its hint", () => {
    expect(countRow({ ok: false, hint: "rate limited" })).toEqual({ events: 0, sessions: 0, skipped: true, hint: "rate limited" });
  });
});
