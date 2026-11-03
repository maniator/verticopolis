import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ACTIONS,
  PERSISTENCE_FAILURE_SINCE,
  buildPersistenceQuery,
  buildPresenceQuery,
  presenceFromRows,
  rateOf,
  renderPersistenceMarkdown,
  summarizePersistence,
  tallyRows,
} from "../scripts/persistence-failures.mjs";
import { upperBound } from "../scripts/engine-reliability.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(resolve(here, rel), "utf8");

const live = { liveEvents: 50, autosaveSessions: 0 };
const row = (action: string, detail: string | null, events: number, sessions = events) => ({ action, detail, events, sessions });

describe("the persistence failure query", () => {
  const sql = buildPersistenceQuery(168);
  it("reads production app_action rows for the six codes in the window, and nothing else", () => {
    expect(sql).toContain("WHERE event = 'app_action'");
    expect(sql).toContain("properties.environment = 'production'");
    expect(sql).toContain("INTERVAL 168 HOUR");
    for (const a of ACTIONS) expect(sql).toContain(`'${a}'`);
    expect(ACTIONS).toHaveLength(6);
  });

  it("counts only builds from the first version that sends the failure codes, attempts included", () => {
    expect(sql).toContain("splitByChar('.', properties.version)) >= [2, 78, 4]");
    expect(buildPersistenceQuery(24, "3.0.0")).toContain(">= [3, 0, 0]");
    expect(() => buildPersistenceQuery(24, "2.77")).toThrow(/bad version/);
    expect(() => buildPersistenceQuery(24, "2.77.x")).toThrow(/bad version/);
  });

  it("is never built from a caller's string (no injection through the version)", () => {
    expect(() => buildPersistenceQuery(24, "2.0.0') OR 1=1 --")).toThrow(/bad version/);
  });
});

describe("the presence probe", () => {
  const sql = buildPresenceQuery(168);
  it("counts live rows (boot or app_action, so a long-lived tab counts) and the sessions with an autosave failure from one grouping-free read, behind the same gate", () => {
    expect(sql).toContain("count() AS live_events");
    expect(sql).toContain("WHERE event IN ('boot', 'app_action')");
    expect(sql).toContain("uniqIf(distinct_id, event = 'app_action' AND properties.action = 'autosave_failed' AND properties.detail IN ('timer', 'manual')) AS autosave_sessions");
    expect(sql).toContain("properties.environment = 'production'");
    expect(sql).toContain("INTERVAL 168 HOUR");
    expect(sql).toContain(">= [2, 78, 4]");
    expect(sql).not.toContain("GROUP BY");
    expect(() => buildPresenceQuery(24, "2.0.0') OR 1=1 --")).toThrow(/bad version/);
  });

  it("reads a missing or malformed row as no presence", () => {
    expect(presenceFromRows([])).toEqual({ liveEvents: 0, autosaveSessions: 0 });
    expect(presenceFromRows([{ live_events: "x", autosave_sessions: -1 }])).toEqual({ liveEvents: 0, autosaveSessions: 0 });
    expect(presenceFromRows([{ live_events: 12, autosave_sessions: 2 }])).toEqual({ liveEvents: 12, autosaveSessions: 2 });
  });
});

describe("the first version that sends the codes", () => {
  it("is a real, already-released-or-current version of this repo", () => {
    const current = JSON.parse(read("../package.json")).version as string;
    const parts = (v: string) => v.split(".").map(Number);
    const [a, b] = [parts(PERSISTENCE_FAILURE_SINCE), parts(current)];
    expect(a.length).toBe(3);
    const later = a.some((n, i) => (a.slice(0, i).every((m, j) => m === b[j]) ? n > b[i] : false));
    expect(later, `${PERSISTENCE_FAILURE_SINCE} must not be later than the app version ${current}`).toBe(false);
  });

  it("names the three codes the game sends, in the vocabulary and the data map", () => {
    const core = read("analyticsCore.ts");
    const map = read("../docs/analytics-data-map.md");
    for (const code of ["autosave_failed", "load_failed", "import_failed"]) {
      expect(core).toContain(`| "${code}"`);
      expect(map).toContain(`\`${code}\``);
      expect(ACTIONS).toContain(code);
    }
  });
});

describe("tallyRows", () => {
  it("keys by action and detail, sums rows, and ignores an action or detail it does not read", () => {
    const t = tallyRows([row("import_failed", "save", 2), row("import_failed", "save", 1), row("import_failed", "tdt", 4), row("quick_save", null, 99), row("load_failed", "", 3)]);
    expect(t.get("import_failed:save")).toEqual({ events: 3, sessions: 3 });
    expect(t.get("import_failed:tdt")).toEqual({ events: 4, sessions: 4 });
    expect(t.get("load_failed")).toEqual({ events: 3, sessions: 3 });
    expect(t.has("quick_save")).toBe(false);
  });

  it("leaves out a detail the game never sends, and a detail on an action that has none", () => {
    const t = tallyRows([row("autosave_failed", "bogus", 5), row("import_failed", "zip", 2), row("load_failed", "x", 3), row("import_failed", "save", 1)]);
    expect([...t.keys()]).toEqual(["import_failed:save"]);
  });

  it("reads a malformed count as zero rather than inventing one", () => {
    const t = tallyRows([row("load_slot", null, Number.NaN), { action: "load_slot", detail: null, events: -5, sessions: "x" }]);
    expect(t.get("load_slot")).toEqual({ events: 0, sessions: 0 });
  });
});

describe("rateOf: a rate needs attempts", () => {
  it("says Insufficient evidence with no attempts, never 0%", () => {
    const r = rateOf(0, 0);
    expect(r.status).toBe("insufficient");
    expect(r.text).toMatch(/^Insufficient evidence/);
    expect(r.text).not.toMatch(/\b0(\.0+)?%/);
  });

  it("prints the exact bound with no failures, matching the engine report's own function", () => {
    const r = rateOf(0, 300);
    expect(r.status).toBe("bound");
    expect(r.text).toBe(`0 of 300 attempts; 95% upper bound ${(upperBound(0, 300)! * 100).toFixed(2)}%`);
  });

  it("prints the observed rate and its bound with failures", () => {
    const r = rateOf(2, 40);
    expect(r.status).toBe("rate");
    expect(r.text).toContain("2 of 40 attempts (5.00%)");
    expect(r.text).toContain(`${(upperBound(2, 40)! * 100).toFixed(2)}%`);
  });

  it("is unavailable when failures outnumber attempts, which means attempt rows were lost", () => {
    const r = rateOf(5, 3);
    expect(r.status).toBe("unavailable");
    expect(r.text).toMatch(/^Unavailable/);
  });
});

describe("summarizePersistence: which denominators are real", () => {
  const find = (ms: ReturnType<typeof summarizePersistence>, text: string) => ms.find((m) => m.measure.startsWith(text))!;

  it("divides each import by its own attempt count, .vctower and .TDT apart", () => {
    const ms = summarizePersistence(tallyRows([row("import_save", null, 20), row("import_failed", "save", 1), row("import_tdt", null, 10), row("import_failed", "tdt", 3)]), live);
    expect(find(ms, "Import of a .vctower")).toMatchObject({ failures: 1, attempts: 20 });
    expect(find(ms, "Import of a .TDT")).toMatchObject({ failures: 3, attempts: 10 });
  });

  it("takes slot-load attempts as the successes plus the failures", () => {
    const ms = summarizePersistence(tallyRows([row("load_slot", null, 9), row("load_failed", null, 1)]), live);
    expect(find(ms, "Slot load")).toMatchObject({ failures: 1, attempts: 10 });
    expect(find(ms, "Slot load").rate.text).toContain("1 of 10 attempts (10.00%)");
  });

  it("never infers an autosave rate, whatever else was sent", () => {
    const busy = summarizePersistence(
      tallyRows([row("autosave_failed", "timer", 7, 7), row("load_slot", null, 500), row("import_save", null, 500), row("quick_save", null, 900)]),
      { liveEvents: 50, autosaveSessions: 7 },
    );
    const m = find(busy, "Autosave");
    expect(m.attempts).toBeNull();
    expect(m.failures).toBeNull();
    expect(m.sessions).toBe(7);
    expect(m.rate.status).toBe("unavailable");
    expect(m.rate.text).toMatch(/no autosave attempt or success/);
  });

  it("counts a tab that failed under both autosave details once, from the probe, never by summing rows", () => {
    // One tab: the timer autosave failed, it reloaded (the once-latch is module
    // memory), then Quick Save failed. Each detail row sees that one session.
    const rows = [row("autosave_failed", "timer", 1, 1), row("autosave_failed", "manual", 1, 1)];
    const m = find(summarizePersistence(tallyRows(rows), { liveEvents: 10, autosaveSessions: 1 }), "Autosave");
    expect(m.sessions).toBe(1);
  });

  it("counts a long-lived tab whose boot was before the window: app_action rows alone make the window measurable", () => {
    const ms = summarizePersistence(tallyRows([row("import_save", null, 5), row("import_failed", "save", 1)]), { liveEvents: 6, autosaveSessions: 0 });
    expect(find(ms, "Import of a .vctower")).toMatchObject({ failures: 1, attempts: 5 });
    expect(find(ms, "Import of a .vctower").rate.status).not.toBe("not-measurable");
  });

  it("reads a window with builds that send the codes but no attempts as insufficient evidence", () => {
    const ms = summarizePersistence(tallyRows([]), live);
    expect(ms.filter((m) => m.rate.status === "insufficient")).toHaveLength(3);
    expect(find(ms, "Autosave").sessions).toBe(0);
  });

  it("reads a window with no build that sends the codes as Not measurable, with no zero anywhere", () => {
    // Stray rows must not leak into the cells either.
    const ms = summarizePersistence(tallyRows([row("load_slot", null, 9)]), { liveEvents: 0, autosaveSessions: 0 });
    for (const m of ms) {
      expect(m.rate.status).toBe("not-measurable");
      expect(m.rate.text).toMatch(/^Not measurable: no build that sends these codes ran/);
      expect([m.failures, m.sessions, m.attempts]).toEqual([null, null, null]);
    }
    const md = renderPersistenceMarkdown(ms, { windowLabel: "last 7 days", truncated: false });
    expect(md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Measure") && !l.startsWith("| ---")).every((l) => !/\| 0 \|/.test(l))).toBe(true);
  });
});

describe("renderPersistenceMarkdown", () => {
  const md = renderPersistenceMarkdown(summarizePersistence(tallyRows([row("load_slot", null, 4), row("autosave_failed", "timer", 1)]), { liveEvents: 50, autosaveSessions: 1 }), { windowLabel: "last 7 days", truncated: false });

  it("states the window, the first version, and that an earlier window is not zero", () => {
    expect(md).toContain("last 7 days");
    expect(md).toContain(`builds from ${PERSISTENCE_FAILURE_SINCE}`);
    expect(md).toMatch(/\*\*Not measurable\*\*, not zero/);
  });

  it("calls a rate observed and coverage-limited with unknown bias, never a lower bound", () => {
    expect(md).toMatch(/observed, coverage-limited rate with unknown bias/);
    expect(md).toMatch(/not a lower bound/);
  });

  it("separates counts from rates and points at the measurement-status rows", () => {
    expect(md).toMatch(/A \*\*count\*\* is what the relay received/);
    expect(md).toContain("docs/analytics-measurement-status.md");
    expect(md).toContain("| Measure | Failures (count) | Sessions with a failure | Attempts | Rate |");
  });

  it("prints n/a, not 0, where a measure has no failure or attempt event", () => {
    const line = md.split("\n").find((l) => l.startsWith("| Autosave"))!;
    expect(line).toContain("| n/a | 1 | n/a | Unavailable");
  });

  it("flags a full page as incomplete", () => {
    expect(renderPersistenceMarkdown([], { windowLabel: "x", truncated: true })).toContain("**Truncated:**");
  });
});
