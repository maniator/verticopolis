import { describe, expect, it } from "vitest";
// The cohorts of the governed reliability definition (#1090; the owner's
// direction of 2026-10-20, section 5): the all-attempts safety denominator,
// the engaged eligible cohort, the candidate tail and the arm comparison.
// Every rule in scripts/engine-reliability-cohorts.mjs is pinned here.
import {
  COMPARED_ARMS,
  ELIGIBLE_HOST,
  ELIGIBLE_STAGE,
  ENGINE_RUNNING,
  OVERRIDE_SELECTIONS,
  differenceInterval,
  cohortCaveats,
  isEligible,
  summarizeCohorts,
} from "../scripts/engine-reliability-cohorts.mjs";
import {
  ASSIGNED_ARMS,
  ENGAGED_BY,
  ENGINE_KINDS_SENT,
  SELECTIONS,
  STAGES,
  buildCrashSessionsQuery,
  buildPageLivesQuery,
  parseArgs,
  renderReliabilityMarkdown,
  summarizeReliability,
  upperBound,
  type PageLife,
} from "../scripts/engine-reliability.mjs";
import { ENGINE_KINDS } from "./analyticsEngineStatus";

const SHA = "abc1234";

/** An eligible, engaged, clean stage-3 page life; override what a case needs. */
function life(over: Partial<PageLife> = {}): PageLife {
  return {
    session: "s1",
    pageLife: `p-${Math.random()}`,
    version: "2.50.0",
    sha: SHA,
    build: "switchable",
    requested: "wasm",
    stage: "3",
    assignedArm: "wasm",
    selectedBy: "cohort",
    safetySuppressed: false,
    sizeGated: false,
    fallbacks: 0,
    settleFallbacks: 0,
    reasons: [],
    writerLatched: false,
    settled: true,
    attempted: true,
    engaged: true,
    engagedEngine: "wasm",
    engagedBy: "command",
    firstSeen: "2026-12-01 12:00:00",
    ...over,
  };
}

const fault = { fallbacks: 1, reasons: ["trap-tick"] };
const run = (lives: PageLife[], over: { eligibleShas?: string[]; tailShas?: string[]; crashSessions?: Set<string> } = {}) =>
  summarizeCohorts(lives, { hosts: ["wasm"], eligibleShas: [SHA], ...over });

describe("the query's #1090 columns", () => {
  const q = buildPageLivesQuery(720);

  it("reads the A4 fields by their spec names (#1197)", () => {
    for (const col of ["argMin(properties.stage, timestamp) AS stage,", "argMin(properties.assigned_arm, timestamp) AS assigned_arm,", "argMin(properties.selected_by, timestamp) AS selected_by,", "coalesce(max(properties.safety_suppressed = true), false) AS safety_suppressed,"]) expect(q).toContain(col);
  });

  it("marks settled, attempted and engaged page lives, and the engine at engagement", () => {
    expect(q).toContain("countIf(properties.trigger = 'settle') > 0 AS settled,");
    expect(q).toContain("countIf(properties.trigger = 'attempt') > 0 AS attempted,");
    expect(q).toContain("countIf(properties.trigger = 'engaged') > 0 AS engaged,");
    expect(q).toContain("argMinIf(properties.engine, timestamp, properties.trigger = 'engaged') AS engaged_engine,");
  });

  it("finds crash sessions as distinct sessions, production only, in the window", () => {
    const c = buildCrashSessionsQuery(48);
    expect(c).toContain("SELECT DISTINCT distinct_id AS session_id");
    expect(c).toContain("WHERE event = '$exception'");
    expect(c).toContain("AND properties.environment = 'production'");
    expect(c).toContain("AND timestamp >= now() - INTERVAL 48 HOUR");
    // A truncated page keeps a stable set.
    expect(c).toContain("ORDER BY session_id");
  });
});

describe("the overall rate with the new fields", () => {
  it("counts an override by selected_by, under the override arm", () => {
    expect(OVERRIDE_SELECTIONS).toEqual(["setting", "url"]);
    // The A4 spec's lists (#1197), until A4 binds them to the source.
    expect(STAGES).toEqual(["none", "0", "1", "2", "3"]);
    expect(ASSIGNED_ARMS).toEqual(["none", "wasm", "ts", "unassigned"]);
    expect(SELECTIONS).toEqual(["default", "cohort", "setting", "url", "safety"]);
    expect(ENGAGED_BY).toEqual(["none", "command", "play"]);
    const lives = [life({ session: "a", selectedBy: "url" }), life({ session: "b", selectedBy: "setting" }), life({ session: "c" })];
    expect(summarizeReliability(lives)).toMatchObject({ n: 1 });
    expect(summarizeReliability(lives, { arms: ["override"] })).toMatchObject({ n: 2 });
  });

  it("leaves an attempt that never settled outside the rate and counts it on its own line", () => {
    const s = summarizeReliability([life({ settled: false, session: "a" }), life({ session: "b" })]);
    expect(s).toMatchObject({ n: 1, unsettledPageLives: 1 });
  });
});

describe("eligibility", () => {
  it("needs every condition at once", () => {
    expect(ELIGIBLE_HOST).toBe("wasm");
    expect(ELIGIBLE_STAGE).toBe("3");
    expect(isEligible(life(), [SHA])).toBe(true);
    const misses: Partial<PageLife>[] = [
      { requested: "wasm-worker" },
      { sha: "0dd0000" },
      { stage: "2" },
      { stage: "none" },
      { assignedArm: "ts" },
      { assignedArm: "unassigned" },
      { selectedBy: "setting" },
      { selectedBy: "url" },
      { selectedBy: "safety" },
      { selectedBy: "default" },
      { safetySuppressed: true },
      { sizeGated: true },
      { settled: false, engaged: false },
      { settleFallbacks: 1, fallbacks: 1, reasons: ["package-mismatch"] },
    ];
    for (const m of misses) expect(isEligible(life(m), [SHA]), JSON.stringify(m)).toBe(false);
  });

  it("never matches a short or forged commit to an eligible one", () => {
    // The rows come from a public ingest route; "a" is a prefix of abc1234.
    for (const sha of ["a", "abc12", "unknown", "ABC1234"]) expect(isEligible(life({ sha }), [SHA]), sha).toBe(false);
  });

  it("refuses eligible commits when the counted hosts leave out the production host", () => {
    expect(() => summarizeCohorts([life()], { hosts: ["wasm-worker"], eligibleShas: [SHA] })).toThrow(/include `wasm`/);
    expect(() => parseArgs(["--hosts", "wasm-worker", "--eligible-shas", SHA])).toThrow(/--eligible-shas needs --hosts to include wasm/);
    expect(summarizeCohorts([life()], { hosts: ["wasm-worker"] }).eligible.n).toBe(0);
  });

  it("binds the value lists it reads to the game's engine kinds", () => {
    expect(ENGINE_KINDS_SENT).toEqual([...ENGINE_KINDS]);
  });

  it("names no eligible commit, so nothing is eligible, until the gate review names them", () => {
    expect(isEligible(life(), [])).toBe(false);
    expect(run([life()], { eligibleShas: [] }).eligible).toMatchObject({ n: 0, faults: 0, upper95: null });
  });
});

describe("the engaged eligible cohort", () => {
  it("counts engaged sessions only: a page load that never engaged is not a clean success", () => {
    const c = run([life({ session: "a" }), life({ session: "b", engaged: false, engagedEngine: "none" })]);
    expect(c.eligible).toMatchObject({ n: 1, faults: 0 });
  });

  it("does not count engagement after a fallback to TypeScript as engagement on the engine", () => {
    expect(ENGINE_RUNNING).toEqual(ENGINE_KINDS.filter((k) => k.startsWith("wasm")));
    const c = run([life({ engagedEngine: "ts-fallback", ...fault })]);
    expect(c.eligible.n).toBe(0);
    expect(c.attempts).toMatchObject({ sessions: 1, faults: 1, engaged: 0, faultNotEngaged: 1 });
  });

  it("counts a fault before the engagement when the session engaged in another page life", () => {
    const c = run([life({ session: "a", engaged: false, ...fault, firstSeen: "2026-12-01 11:00:00" }), life({ session: "a" })]);
    expect(c.eligible).toMatchObject({ n: 1, faults: 1 });
  });

  it("keeps a fault that stopped the player engaging in the eligible attempts row, which the cohort cannot hold", () => {
    const c = run([life({ session: "a", engagedEngine: "ts-fallback", ...fault }), life({ session: "b", engaged: false, settled: false }), life({ session: "c" })]);
    expect(c.eligible).toMatchObject({ n: 1, faults: 0 });
    expect(c.eligibleAttempts).toMatchObject({ n: 3, faults: 1, leftBeforeTower: 1, byEngagement: { command: 1, none: 2 } });
  });

  it("reads an engaged row with no route as unknown, apart from sessions that never engaged", () => {
    expect(run([life({ engagedBy: "none" })]).eligible.byEngagement).toEqual({ command: 0, play: 0, unknown: 1, none: 0 });
  });

  it("gives a build a session only where it engaged or faulted there", () => {
    const c = run([life({ session: "a" }), life({ session: "a", sha: "def5678", engaged: false, firstSeen: "2026-12-01 13:00:00" })], { eligibleShas: [SHA, "def5678"] });
    expect(c.eligible.byBuild.map((b) => b.build)).toEqual(["2.50.0 (abc1234, switchable)"]);
    const f = run([life({ session: "a" }), life({ session: "a", sha: "def5678", engaged: false, ...fault, firstSeen: "2026-12-01 13:00:00" })], { eligibleShas: [SHA, "def5678"] });
    expect(f.eligible.byBuild.map((b) => [b.sessions, b.faults])).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });

  it("takes the session's arm from its first page life", () => {
    const c = run([life({ session: "a", assignedArm: "ts", requested: "ts", engaged: false, firstSeen: "2026-12-01 11:00:00" }), life({ session: "a" })]);
    expect(c.eligible.n).toBe(0);
    expect(c.changed.sessions).toBe(1);
  });

  it("skips page lives from a build with no cohort when it picks the arm, and orders by time, then page life", () => {
    const c = run([life({ session: "a", assignedArm: "none", stage: "none", selectedBy: "default", engaged: false, firstSeen: "2026-12-01 11:00:00" }), life({ session: "a", firstSeen: "2026-12-01 12:00:00" })]);
    expect(c.eligible.n).toBe(1);
    expect(c.changed.sessions).toBe(0);
    // A missing time sorts last, so it never decides the arm.
    const d = run([life({ session: "b", firstSeen: "" }), life({ session: "b", assignedArm: "ts", requested: "ts", engaged: false, firstSeen: "2026-12-01 10:00:00" })]);
    expect(d.eligible.n).toBe(0);
    // At one time, the page life id decides.
    const e = run([life({ session: "c", pageLife: "p-b" }), life({ session: "c", pageLife: "p-a", assignedArm: "ts", requested: "ts", engaged: false })]);
    expect(e.eligible.n).toBe(0);
  });

  it("counts a sibling page life that left before its first tower, the engagement route, and each build", () => {
    const c = run([life({ session: "a", settled: false, engaged: false, firstSeen: "2026-12-01 11:00:00" }), life({ session: "a", engagedBy: "play" }), life({ session: "b", ...fault })]);
    expect(c.eligible).toMatchObject({ n: 2, faults: 1, leftBeforeTower: 1, byEngagement: { command: 1, play: 1, unknown: 0 } });
    expect(c.eligible.byBuild).toEqual([{ build: "2.50.0 (abc1234, switchable)", sessions: 2, faults: 1, upper95: upperBound(1, 2) }]);
  });

  it("states the bound it achieved, never a lower one", () => {
    const lives = Array.from({ length: 1000 }, (_, i) => life({ session: `s${i}` }));
    const c = run(lives);
    expect(c.eligible.n).toBe(1000);
    // 1,000 clean sessions show about 0.30%, not 0.1%.
    expect(c.eligible.upper95).toBeCloseTo(upperBound(0, 1000) as number, 12);
    expect(c.eligible.upper95 as number).toBeGreaterThan(0.0029);
  });
});

describe("the all-attempts safety denominator", () => {
  it("keeps overrides, pre-engagement faults and early exits, under the assigned arm", () => {
    const c = run([
      life({ session: "a" }),
      life({ session: "b", selectedBy: "setting", engaged: false }),
      life({ session: "c", engaged: false, ...fault }),
      life({ session: "d", settled: false, engaged: false }),
      life({ session: "e", assignedArm: "ts", selectedBy: "url" }),
    ]);
    expect(c.attempts).toMatchObject({ sessions: 5, faults: 1, engaged: 2, faultNotEngaged: 1, leftBeforeTower: 1, overrides: 2 });
    expect(c.attempts.byArm.map((r) => [r.arm, r.sessions, r.overrides])).toEqual([
      ["ts", 1, 1],
      ["wasm", 4, 1],
    ]);
    expect(c.eligible.n).toBe(1);
  });

  it("leaves out size-gated page lives and experimental hosts", () => {
    const c = run([life({ session: "a", sizeGated: true, engaged: false }), life({ session: "c", requested: "wasm-worker" })]);
    expect(c.attempts.sessions).toBe(0);
  });

  it("keeps opt-outs and safety suppressions in the WASM arm's row (#1197) but out of the rate's N, and not a TS-arm player's choice of TypeScript", () => {
    const c = run([
      life({ session: "a", requested: "ts", selectedBy: "safety", safetySuppressed: true, engaged: false }),
      life({ session: "b", requested: "ts", selectedBy: "setting", engaged: false }),
      life({ session: "e", requested: "ts", selectedBy: "url", engaged: false }),
      life({ session: "c", selectedBy: "setting" }),
      life({ session: "d", assignedArm: "ts", requested: "ts", selectedBy: "setting", engaged: false }),
      life({ session: "f", requested: "ts", selectedBy: "safety", safetySuppressed: true, sizeGated: true, engaged: false }),
    ]);
    // c asked for the engine (an override); a, b and e never ran it.
    expect(c.attempts).toMatchObject({ sessions: 1, movedOff: 3, overrides: 1 });
    expect(c.attempts.byArm).toEqual([expect.objectContaining({ arm: "wasm", sessions: 1, movedOff: 3, overrides: 1 })]);
    expect(c.eligible.n).toBe(0);
  });

  it("keeps a session that faulted and then opted out in the rate", () => {
    const c = run([life({ session: "a", engaged: false, ...fault, firstSeen: "2026-12-01 11:00:00" }), life({ session: "a", requested: "ts", selectedBy: "setting", engaged: false })]);
    expect(c.attempts).toMatchObject({ sessions: 1, faults: 1, movedOff: 0 });
  });

  it("counts page lives with a value the game never sends on their own line, in no population", () => {
    const c = run([life({ session: "a", selectedBy: "remote" }), life({ session: "b", stage: "9" }), life({ session: "c", engagedBy: "idle" }), life({ session: "d", engagedEngine: "rust" })]);
    expect(c.unrecognizedSessions).toBe(4);
    expect(c.attempts.sessions).toBe(0);
  });

  it("does not count a package mismatch as a fault, nor a page life that never ran the engine as a clean session", () => {
    const c = run([life({ fallbacks: 1, settleFallbacks: 1, reasons: ["package-mismatch"], engaged: false })]);
    expect(c.attempts).toMatchObject({ sessions: 0, faults: 0 });
    expect(c.eligibleAttempts.n).toBe(0);
    // A mismatch met after the first tower ran the engine without a fault.
    expect(run([life({ fallbacks: 1, reasons: ["package-mismatch"] })]).attempts).toMatchObject({ sessions: 1, faults: 0 });
  });

  it("puts an override to an uncounted WASM host in no population, never among the opt-outs", () => {
    const c = run([life({ session: "a", selectedBy: "url", requested: "wasm-worker" }), life({ session: "b", selectedBy: "setting", requested: "wasm-frame" })]);
    expect(c.attempts).toMatchObject({ sessions: 0, movedOff: 0 });
    expect(c.uncountedHostSessions).toBe(2);
  });

  it("reads A4's suppressed row (the selection before safety, `selected_by: safety`) as a move off, flag or not", () => {
    const c = run([
      life({ session: "a", selectedBy: "safety", safetySuppressed: true, engaged: false }),
      life({ session: "b", selectedBy: "safety", engaged: false }),
    ]);
    expect(c.attempts).toMatchObject({ sessions: 0, movedOff: 2 });
    expect(c.attemptsWithMovedOff).toMatchObject({ n: 2, faults: 0 });
    expect(summarizeReliability([life({ session: "b", selectedBy: "safety", engaged: false })])).toMatchObject({ n: 0, safetySuppressedPageLives: 1 });
  });

  it("keeps a size-gated page life's engine fault in the safety denominator", () => {
    expect(run([life({ sizeGated: true, engaged: false, ...fault })]).attempts).toMatchObject({ sessions: 1, faults: 1 });
    expect(run([life({ sizeGated: true, engaged: false })]).attempts.sessions).toBe(0);
    // A gated load, then a new game the engine ran: in N, clean or not.
    expect(run([life({ sizeGated: true })]).attempts).toMatchObject({ sessions: 1, faults: 0 });
  });

  it("flags the TypeScript arm's engagement as unmeasured when its builds send no engaged row in that arm", () => {
    const c = run([life({ session: "w" }), life({ session: "t", assignedArm: "ts", requested: "ts", engaged: false })]);
    expect(c.comparisonEngagedRows.ts).toEqual({ with: 0, of: 1 });
    const md = renderReliabilityMarkdown(summarizeReliability([]), { windowLabel: "w", until: "u", hosts: ["wasm"], builds: "all", arms: "all", truncated: false, cohorts: c, eligibleShas: [SHA], tailShas: [] });
    expect(md).toContain("Engagement in the `ts` arm is not measured");
    expect(md).not.toContain("Engagement in the `wasm` arm is not measured");
  });

  it("charges a crash loop detected after a same-tab reload to the session's cohorts, and counts one in a size-gated page life", () => {
    const loop = { selectedBy: "safety", safetySuppressed: true, engaged: false, reasons: ["boot-error"], firstSeen: "2026-12-01 13:00:00" };
    const c = run([life({ session: "a" }), life({ session: "a", ...loop })]);
    expect(c.eligible).toMatchObject({ n: 1, faults: 1 });
    expect(c.eligibleAttempts).toMatchObject({ n: 1, faults: 1 });
    expect(c.eligible.byBuild).toEqual([{ build: "2.50.0 (abc1234, switchable)", sessions: 1, faults: 1, upper95: upperBound(1, 1) }]);
    expect(run([life({ session: "b", engaged: false }), life({ session: "b", ...loop, sizeGated: true })]).attempts).toMatchObject({ sessions: 1, faults: 1 });
    // A suppressed fault whose reason rows were lost is still a fault.
    expect(run([life({ session: "c", selectedBy: "safety", safetySuppressed: true, engaged: false, fallbacks: 1 })]).attempts).toMatchObject({ sessions: 1, faults: 1, movedOff: 0 });
  });

  it("keeps a crash loop on the host its row names", () => {
    const loop = (requested: string) => life({ requested, selectedBy: "safety", safetySuppressed: true, engaged: false, reasons: ["boot-error"] });
    const worker = run([loop("wasm-worker")]);
    expect(worker.attempts).toMatchObject({ sessions: 0, faults: 0, movedOff: 0 });
    expect(worker.uncountedHostSessions).toBe(1);
    expect(worker.uncountedHostFaults).toBe(1);
    // A loop whose row names `ts` in the `wasm` arm belongs to the production host.
    const named = run([loop("ts")]);
    expect(named.attempts).toMatchObject({ sessions: 1, faults: 1, movedOff: 0 });
    // An uncounted-host page life outranks a move off in the same session.
    const mixed = run([life({ session: "m", requested: "wasm-worker", selectedBy: "url", ...fault }), life({ session: "m", requested: "ts", selectedBy: "setting", engaged: false })]);
    expect(mixed.attempts.movedOff).toBe(0);
    expect(mixed).toMatchObject({ uncountedHostSessions: 1, uncountedHostFaults: 1 });
    // A worker-host run neither charges the production host's loops nor counts its opt-outs.
    const other = summarizeCohorts([loop("wasm"), life({ session: "b", requested: "ts", selectedBy: "setting", engaged: false })], { hosts: ["wasm-worker"] });
    expect(other.attempts).toMatchObject({ sessions: 0, faults: 0, movedOff: 0 });
  });

  it("does not read a page life that engaged as an early exit when its settle row was lost", () => {
    const c = run([life({ settled: false })]);
    expect(c.eligible).toMatchObject({ n: 1, leftBeforeTower: 0 });
    expect(c.attempts.leftBeforeTower).toBe(0);
    // A later fallback row proves the page life settled and ran the engine.
    const later = run([life({ session: "a" }), life({ session: "a", settled: false, engaged: false, ...fault, firstSeen: "2026-12-01 13:00:00" })]);
    expect(later.eligible).toMatchObject({ n: 1, faults: 1, leftBeforeTower: 0 });
  });

  it("counts a fault reason sent with no fallback counted, as an override's crash-loop boot may", () => {
    expect(run([life({ selectedBy: "url", engaged: false, reasons: ["boot-error"] })]).attempts).toMatchObject({ sessions: 1, faults: 1 });
  });

  it("prints how many sessions the size gate left out of each arm", () => {
    const c = run([life({ session: "w" }), life({ session: "g", sizeGated: true }), life({ session: "t", assignedArm: "ts", requested: "ts" })]);
    expect(c.comparison[0].wasm.sizeGatedOut).toBe(1);
    expect(c.comparison[0].ts.sizeGatedOut).toBe(0);
  });

  it("counts a crash loop a suppressed boot detected as a fault, never as a move off, and repeats it", () => {
    // `boot-error` stands in for A4's `unclean-exit` until A4 binds it.
    const loop = (session: string) => life({ session, selectedBy: "safety", safetySuppressed: true, engaged: false, reasons: ["boot-error"] });
    const c = run([life({ session: "a", engaged: false, firstSeen: "2026-12-01 11:00:00" }), loop("a"), loop("b")]);
    expect(c.attempts).toMatchObject({ sessions: 2, faults: 2, movedOff: 0 });
    expect(c.stopSignals).toEqual(["engine fault `boot-error on 2.50.0 (abc1234, switchable)` in 2 sessions"]);
    expect(c.eligible.n).toBe(0);
    expect(summarizeReliability([loop("a")])).toMatchObject({ n: 0, safetySuppressedPageLives: 1, crashLoopPageLives: 1 });
  });
});

describe("the tail", () => {
  it("is the engaged eligible cohort on the candidate's commits", () => {
    const lives = [life({ session: "a" }), life({ session: "b", sha: "def5678", ...fault })];
    const c = run(lives, { eligibleShas: [SHA, "def5678"], tailShas: ["def5678"] });
    expect(c.eligible).toMatchObject({ n: 2, faults: 1 });
    expect(c.tail).toMatchObject({ n: 1, faults: 1 });
    expect(run(lives, { eligibleShas: [SHA, "def5678"] }).tail.n).toBe(0);
  });

  it("must sit inside the eligible commits on the command line", () => {
    expect(parseArgs(["--eligible-shas", "abc1234,def5678", "--tail-shas", "def5678"])).toMatchObject({ eligibleShas: ["abc1234", "def5678"], tailShas: ["def5678"] });
    expect(() => parseArgs(["--tail-shas", "def5678"])).toThrow(/--eligible-shas does not name/);
    // A short and a full form of one commit name the same build.
    expect(parseArgs(["--eligible-shas", "abc1234", "--tail-shas", "abc1234ff"]).tailShas).toEqual(["abc1234ff"]);
    expect(() => parseArgs(["--eligible-shas", "xyz"])).toThrow(/--eligible-shas cannot hold/);
  });
});

describe("the arm comparison and the stop signals", () => {
  it("compares every settled session by arm, with the crash-rate interval", () => {
    expect(COMPARED_ARMS).toEqual(["wasm", "ts"]);
    const lives = [life({ session: "w1" }), life({ session: "w2", engaged: false }), life({ session: "t1", assignedArm: "ts", requested: "ts", engagedEngine: "ts" })];
    const c = run(lives, { crashSessions: new Set(["w2"]) });
    expect(c.comparison).toEqual([
      {
        stage: "3",
        wasm: { stage: "3", arm: "wasm", sessions: 2, engaged: 1, faults: 0, crashes: 1, sizeGatedOut: 0 },
        ts: { stage: "3", arm: "ts", sessions: 1, engaged: 1, faults: 0, crashes: 0, sizeGatedOut: 0 },
        crashDifference: differenceInterval(1, 2, 0, 1),
      },
    ]);
  });

  it("reads settled sessions only (the TypeScript arm sends no attempt row), leaves size-gated ones out of both arms, and splits by stage", () => {
    const lives = [
      life({ session: "w1", settled: false, engaged: false }),
      life({ session: "w2", sizeGated: true }),
      // A size-gated page life's fault never reaches the comparison.
      life({ session: "w4", sizeGated: true, ...fault, firstSeen: "2026-12-01 13:00:00" }),
      life({ session: "w4" }),
      life({ session: "t1", assignedArm: "ts", requested: "ts", sizeGated: true }),
      life({ session: "w3", stage: "2" }),
    ];
    const c = run(lives, { crashSessions: new Set(["w1"]) });
    expect(c.comparison.map((s) => [s.stage, s.wasm.sessions, s.wasm.crashes, s.ts.sessions])).toEqual([["2", 1, 0, 0]]);
  });

  it("reports sessions whose arm or stage changed apart from both arms", () => {
    const c = run(
      [life({ session: "a", assignedArm: "ts", requested: "ts", firstSeen: "2026-12-01 10:00:00" }), life({ session: "a" }), life({ session: "b", stage: "2", firstSeen: "2026-12-01 10:00:00" }), life({ session: "b" })],
      { crashSessions: new Set(["a"]) },
    );
    expect(c.comparison.every((s) => s.wasm.sessions === 0 && s.ts.sessions === 0)).toBe(true);
    expect(c.changed).toMatchObject({ sessions: 2, crashes: 1 });
  });

  it("computes Newcombe's hybrid interval, and none for an empty arm", () => {
    // Newcombe (1998), Statistics in Medicine 17:873-890, method 10, worked
    // example 56/70 vs 48/80: 0.0524 to 0.3339.
    const [lo, hi] = differenceInterval(56, 70, 48, 80) as [number, number];
    expect(lo).toBeCloseTo(0.0524, 4);
    expect(hi).toBeCloseTo(0.3339, 4);
    expect(differenceInterval(1, 0, 0, 1)).toBeNull();
  });

  it("raises a repeated fault reason on one commit, a latch-off, and a crash difference above zero", () => {
    const repeated = run([life({ session: "a", ...fault }), life({ session: "b", ...fault })]);
    expect(repeated.stopSignals).toEqual(["engine fault `trap-tick on 2.50.0 (abc1234, switchable)` in 2 sessions"]);
    expect(run([life({ session: "a", ...fault }), life({ session: "b", ...fault, sha: "def5678" })]).stopSignals).toEqual([]);
    // Two unknown commits of different versions are two builds.
    expect(run([life({ session: "a", ...fault, sha: "unknown" }), life({ session: "b", ...fault, sha: "unknown", version: "2.51.0" })]).stopSignals).toEqual([]);
    // A fault whose reason rows were lost still repeats.
    expect(run([life({ session: "a", fallbacks: 1 }), life({ session: "b", fallbacks: 1 })]).stopSignals).toEqual(["engine fault `no reason sent on 2.50.0 (abc1234, switchable)` in 2 sessions"]);
    expect(run([life({ writerLatched: true })]).stopSignals).toEqual(["writer latch-off in 1 session"]);
    // Any latch-off, on an uncounted host or in a size-gated page life too.
    expect(run([life({ session: "a", writerLatched: true, requested: "wasm-worker" }), life({ session: "b", writerLatched: true, sizeGated: true })]).stopSignals).toEqual(["writer latch-off in 2 sessions"]);
    // A repeated fault through an uncounted host still repeats.
    expect(run([life({ session: "a", ...fault, requested: "wasm-frame" }), life({ session: "b", ...fault, requested: "wasm-frame" })]).stopSignals).toEqual(["engine fault `trap-tick on 2.50.0 (abc1234, switchable)` in 2 sessions"]);
    const wasm = Array.from({ length: 200 }, (_, i) => life({ session: `w${i}` }));
    const ts = Array.from({ length: 200 }, (_, i) => life({ session: `t${i}`, assignedArm: "ts", requested: "ts" }));
    const crashed = new Set(wasm.slice(0, 40).map((pl) => pl.session));
    expect(run([...wasm, ...ts], { crashSessions: crashed }).stopSignals).toEqual(["at stage `3` the WASM arm's crash rate is above the TypeScript arm's (the 95% interval lies above zero)"]);
  });
});

describe("the report", () => {
  const meta = { windowLabel: "last 30 days", until: "2026-12-01 12:00", hosts: ["wasm"], builds: "all", arms: "all", truncated: false };

  const caveats = ["**No eligible commits named**", "**The cohort fields are missing:**", "**Engagement is not fully measured:**", "**Early exits are partly invisible:**"];

  it("says at the top of the report, above every figure, what cannot count yet", () => {
    const old = life({ engaged: false, attempted: false, stage: "none", assignedArm: "none", selectedBy: "default" });
    const c = run([old], { eligibleShas: [] });
    const md = renderReliabilityMarkdown(summarizeReliability([old]), { ...meta, cohorts: c, eligibleShas: [], tailShas: [] });
    const first = md.indexOf("| Measure |");
    for (const lead of caveats) {
      expect(md.indexOf(lead), lead).toBeGreaterThan(-1);
      expect(md.indexOf(lead), lead).toBeLessThan(first);
    }
  });

  it("keeps a caveat while a page life is on a build that never sent the row", () => {
    const c = run([life({ session: "a" }), life({ session: "b", sha: "def5678", engaged: false, attempted: false, stage: "none" })]);
    const top = cohortCaveats(c, { eligibleShas: [SHA] }).join("\n");
    expect(top).toContain("1 of 2 page lives");
    for (const lead of [caveats[1], caveats[3]]) expect(top).toContain(lead);
    // The engagement caveat reads the page lives that could be eligible.
    const both = run([life({ session: "a" }), life({ session: "b", sha: "def5678", engaged: false })], { eligibleShas: [SHA, "def5678"] });
    expect(cohortCaveats(both, { eligibleShas: [SHA, "def5678"] }).join("\n")).toContain("**Engagement is not fully measured:** 1 of 2 page lives");
  });

  it("lifts the row caveats once the build sends them, though a player left early or never engaged", () => {
    // b bounced without engaging; c's attempt row fell before the window.
    const c = run([life({ session: "a" }), life({ session: "b", engaged: false }), life({ session: "c", attempted: false })]);
    expect(cohortCaveats(c, { eligibleShas: [SHA] })).toEqual([]);
    // An older stage-1 build that never sent the row does not hold the
    // cohort's engagement caveat once eligible commits are named.
    const old = run([life({ session: "a" }), life({ session: "d", sha: "def5678", stage: "1", engaged: false })]);
    expect(cohortCaveats(old, { eligibleShas: [SHA] }).join("\n")).not.toContain("**Engagement is not fully measured:**");
  });

  it("drops those caveats once the rows and commits exist, and prints both denominators and the unevaluated signal", () => {
    const c = run([life()]);
    const md = renderReliabilityMarkdown(summarizeReliability([life()]), { ...meta, cohorts: c, eligibleShas: [SHA], tailShas: [] });
    for (const lead of caveats) expect(md).not.toContain(lead);
    expect(md).toContain("| All attempts (safety denominator) | 1 |");
    expect(md).toContain("| Engaged eligible cohort (proposed release count) | 1 |");
    expect(md).toContain("| `2.50.0 (abc1234, switchable)` | 1 | 0 |");
    expect(md).toContain("| Eligible attempts (engaged or not) | 1 |");
    expect(md).toContain("### Candidate tail by build");
    expect(md).toContain("no route 0");
    expect(md).toContain("| All attempts, moved-off `wasm`-arm sessions in N (#1197's wording) | 1 |");
    expect(md).toContain("Blind spots: a trap the host catches");
    expect(md).toContain("`$exception` sessions in the window: 0");
    expect(md).toContain("- none of the evaluated signals");
    expect(md).toContain("- not evaluated: a repeated engine or host `$exception`");
  });

  it("says when the crash query was truncated, apart from the page lives", () => {
    const md = renderReliabilityMarkdown(summarizeReliability([]), { ...meta, crashesTruncated: true });
    expect(md).toContain("**The `$exception` sessions are truncated:**");
    expect(md).not.toContain("> **Truncated:**");
  });

  it("renders without the commit lists, reading them as none", () => {
    const c = run([life()]);
    expect(() => renderReliabilityMarkdown(summarizeReliability([life()]), { ...meta, cohorts: c })).not.toThrow();
  });
});
