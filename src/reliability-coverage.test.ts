import { describe, expect, it } from "vitest";
import {
  buildCoverageQuery,
  buildTrapCountQuery,
  buildTrapOutcomeQuery,
  classifyTrap,
  coverageFromRows,
  renderCoverageMarkdown,
  summarizeTraps,
} from "../scripts/reliability-coverage.mjs";

const life = (settled: boolean, attempted: boolean) => ({ settled, attempted });
const none = { recovered: 0, stopped: 0, reloaded: 0, unknown: 0, trapped: 0 };
const base = { coverage: { boots: 10, engineSessions: 8, engineNoEnd: 2 }, traps: none, lives: [life(true, true), life(true, true), life(false, true)] };
const meta = { windowLabel: "last 7 days", truncated: false };

describe("the coverage queries", () => {
  it("read production engine_status and boot rows in the window, with no grouping on the coverage row", () => {
    const sql = buildCoverageQuery(168);
    expect(sql).toContain("countIf(event = 'boot') AS boots");
    expect(sql).toContain("WHERE event IN ('boot', 'engine_status')");
    expect(sql).toContain("properties.environment = 'production'");
    expect(sql).toContain("INTERVAL 168 HOUR");
    expect(sql).not.toContain("GROUP BY");
    expect(sql).toContain("event = 'session_end'");
  });

  it("count trapped sessions from crash-reload rows only", () => {
    expect(buildTrapCountQuery(24)).toContain("uniqIf(distinct_id, properties.trigger = 'crash-reload')");
  });

  it("read only rows after a session's first trap, and every window is a whole number of hours", () => {
    const sql = buildTrapOutcomeQuery(24);
    expect(sql).toContain("properties.trigger = 'crash-reload'");
    expect(sql).toContain("e.timestamp > t.first_trap");
    expect(sql).toContain("startsWith(e.properties.fallback_reason, 'trap-')");
    expect(sql).toContain("countIf(e.properties.trigger = 'crash-reload') AS later_traps");
    for (const bad of [0, 1.5, Number.NaN, "24) OR 1=1 --" as unknown as number]) {
      expect(() => buildCoverageQuery(bad)).toThrow(/bad window/);
      expect(() => buildTrapCountQuery(bad)).toThrow(/bad window/);
      expect(() => buildTrapOutcomeQuery(bad)).toThrow(/bad window/);
    }
  });
});

describe("coverageFromRows", () => {
  it("reads a missing or malformed row as zeros", () => {
    expect(coverageFromRows([])).toEqual({ boots: 0, engineSessions: 0, engineNoEnd: 0 });
    expect(coverageFromRows([{ boots: "x", engine_sessions: -3, engine_no_end: 1.5 }])).toEqual({ boots: 0, engineSessions: 0, engineNoEnd: 0 });
    expect(coverageFromRows([{ boots: 176, engine_sessions: 104, engine_no_end: 13 }])).toEqual({ boots: 176, engineSessions: 104, engineNoEnd: 13 });
  });
});

describe("classifyTrap", () => {
  it("calls a later trap stopped, whatever else ran", () => {
    expect(classifyTrap({ later_trap_fallbacks: 1, later_clean_settles: 1, later_settles: 2 })).toBe("stopped");
  });
  it("calls a later clean settle on the engine recovered", () => {
    expect(classifyTrap({ later_trap_fallbacks: 0, later_clean_settles: 1, later_settles: 1 })).toBe("recovered");
  });
  it("does not call a session recovered when it trapped and reloaded again", () => {
    expect(classifyTrap({ later_trap_fallbacks: 0, later_traps: 1, later_clean_settles: 2, later_settles: 2 })).toBe("reloaded");
  });
  it("calls a later settle without a clean engine run reloaded, not recovered", () => {
    expect(classifyTrap({ later_trap_fallbacks: 0, later_clean_settles: 0, later_settles: 1 })).toBe("reloaded");
  });
  it("calls a session with later rows but no settle unknown, and reads malformed counts as zero", () => {
    expect(classifyTrap({ later_trap_fallbacks: 0, later_clean_settles: 0, later_settles: 0 })).toBe("unknown");
    expect(classifyTrap({ later_trap_fallbacks: "x", later_clean_settles: null, later_settles: -1 })).toBe("unknown");
  });
});

describe("summarizeTraps", () => {
  it("adds the trapped sessions with no later row to unknown, never subtracting below zero", () => {
    const rows = [{ later_clean_settles: 1, later_settles: 1 }, { later_trap_fallbacks: 1 }, { later_settles: 1 }];
    expect(summarizeTraps(5, rows)).toEqual({ trapped: 5, recovered: 1, stopped: 1, reloaded: 1, unknown: 2 });
    expect(summarizeTraps(1, rows).unknown).toBe(0);
  });
  it("is all zero with no traps", () => {
    expect(summarizeTraps(0, [])).toEqual(none);
    expect(summarizeTraps(undefined, [])).toEqual(none);
  });
});

describe("renderCoverageMarkdown", () => {
  const md = renderCoverageMarkdown(base, meta);

  it("states the window and that these are cross-checks, not rates, and that relay loss hides", () => {
    expect(md).toContain("last 7 days");
    expect(md).toMatch(/\*\*cross-checks, not rates\*\*/);
    expect(md).toMatch(/loss on the relay itself hides from all of them/);
  });

  it("counts boots, settles, attempt-only lives and sessions without session_end", () => {
    expect(md).toContain("| Page lives with a `boot` row | 10 |");
    expect(md).toContain("| Page lives with a `settle` row | 2 |");
    expect(md).toContain("loaded, never settled) | 1 |");
    expect(md).toContain("| Sessions with engine rows | 8 |");
    expect(md).toContain("no `session_end` row in the window | 2 |");
  });

  it("says the session_end difference is not lost sessions", () => {
    expect(md).toMatch(/their difference is not lost sessions/);
  });

  it("reads no traps as Insufficient evidence, never 0%", () => {
    expect(md).toContain("Insufficient evidence: no traps observed");
    expect(md).not.toMatch(/\b0(\.0+)?%/);
  });

  it("never prints a bare zero for a count with none, in the coverage table or the outcome table", () => {
    const empty = renderCoverageMarkdown({ ...base, coverage: { boots: 0, engineSessions: 0, engineNoEnd: 0 }, lives: [] }, meta);
    const full = renderCoverageMarkdown({ ...base, traps: { trapped: 3, recovered: 0, stopped: 0, reloaded: 0, unknown: 3 } }, meta);
    for (const text of [empty, full]) {
      const rows = text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Check") && !l.startsWith("| Outcome") && !l.startsWith("| ---"));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((l) => !/\| 0 \|$/.test(l))).toBe(true);
    }
    expect(empty).toContain("| none seen |");
  });

  it("prints the outcome counts as counts of sessions, with unknown not a failure", () => {
    const text = renderCoverageMarkdown({ ...base, traps: { trapped: 4, recovered: 2, stopped: 1, reloaded: 0, unknown: 1 } }, meta);
    expect(text).toContain("sessions with a `crash-reload` row: 4");
    expect(text).toContain("Counts of sessions, not a rate");
    expect(text).toMatch(/\| Recovered .* \| 2 \|/);
    expect(text).toMatch(/\| Stopped .* \| 1 \|/);
    expect(text).toMatch(/Unknown \(no later page life reached the relay; not a failure\) \| 1 \|/);
  });

  it("flags a full page as incomplete", () => {
    expect(renderCoverageMarkdown(base, { windowLabel: "x", truncated: true })).toContain("**Truncated:**");
  });
});
