import { describe, expect, it } from "vitest";
// The arm comparison, the stop signals and the report of the governed
// reliability definition's cohorts (#1090). The populations are pinned in
// src/engine-reliability-cohorts.test.ts.
import { COMPARED_ARMS, cohortCaveats, differenceInterval } from "../scripts/engine-reliability-cohorts.mjs";
import { renderReliabilityMarkdown, summarizeReliability } from "../scripts/engine-reliability.mjs";
import { SHA, fault, life, run } from "./engine-reliability-cohorts.fixtures";

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
      [
        life({ session: "a", assignedArm: "ts", requested: "ts", firstSeen: "2026-12-01 10:00:00" }),
        life({ session: "a" }),
        life({ session: "b", stage: "2", firstSeen: "2026-12-01 10:00:00" }),
        life({ session: "b" }),
        // A changed session with a size-gated page life is in no gated count.
        life({ session: "g", assignedArm: "ts", requested: "ts", firstSeen: "2026-12-01 10:00:00" }),
        life({ session: "g", sizeGated: true }),
        life({ session: "w" }),
      ],
      { crashSessions: new Set(["a"]) },
    );
    expect(c.comparison.map((s) => [s.stage, s.wasm.sessions, s.ts.sessions, s.wasm.sizeGatedOut, s.ts.sizeGatedOut])).toEqual([["3", 1, 0, 0, 0]]);
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
    // An interval that spans zero raises nothing.
    const few = run([...wasm.slice(0, 20), ...ts.slice(0, 20)], { crashSessions: new Set(["w0"]) });
    expect(few.comparison[0].crashDifference?.[0]).toBeLessThan(0);
    expect(few.stopSignals).toEqual([]);
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

  it("keeps every row caveat when nothing asked for the engine", () => {
    expect(cohortCaveats(run([]), { eligibleShas: [SHA] })).toEqual([caveats[1], caveats[2], caveats[3]].map((lead) => expect.stringContaining(lead)));
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
    expect(md).toContain("| Engaged eligible cohort (proposed release count; rate and bounds conditional on engagement; which bound the gate reads is pending the owner) | 1 |");
    expect(md).toContain("| Candidate tail attempts (no commits named; engaged or not) | 0 |");
    expect(md).toContain("| Candidate tail, engaged (no commits named; rate and bounds conditional on engagement; which bound the gate reads is pending the owner) | 0 |");
    expect(md).toContain("95% upper bound, early exits as faults");
    expect(md).toContain("Sessions left out of the eligible rows for an override page life (with a fault the row would hold): 0 (0) of the eligible attempts");
    expect(md).toContain("| Overrides other than opt-outs |");
    expect(md).toContain("| `2.50.0 (abc1234, switchable)` | 1 | 0 |");
    expect(md).toContain("| Eligible attempts (engaged or not) | 1 |");
    expect(md).toContain("### Candidate tail attempts by build");
    expect(md).toContain("### Candidate tail, engaged, by build");
    expect(md).toContain("no route 0");
    expect(md).toContain("| All attempts, moved-off `wasm`-arm sessions that never ran the engine in N (#1197's wording) | 1 |");
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
