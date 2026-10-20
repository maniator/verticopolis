import { describe, expect, it } from "vitest";
import { calibrate as calibrateWith, calibrationMarkdown, coldStartDifference, passesForLimit } from "./calibrate";
import { halvesProblems, poolIdentity } from "./calibratePool";
import { fam, many, pass, RTX, SWIFT, type Folder, type Spec } from "./calibrateFixture";
import type { EngineName } from "./types";

/** Five passes per engine guarantee 1/6, so most tests state a 20% limit; the default 5% limit is tested on its own. */
const calibrate = (folders: Folder[], options: Parameters<typeof calibrateWith>[1] = {}) => calibrateWith(folders, { exceedanceLimit: 0.2, ...options });

describe("calibrate", () => {
  it("adopts round candidates when enough quiet passes agree", () => {
    const c = calibrateWith(many(40, (i) => ({ upper: 1.005 + (i % 3) * 0.002, coldDiff: i % 2 })));
    expect(c.problems).toEqual([]);
    expect(c.adoptable).toBe(true);
    expect(c.protocolDefaults).toBe(true);
    expect(fam(c, "M1").candidate).toBeCloseTo(0.01, 9);
    expect(fam(c, "M1").exceedance).toEqual({ leaveOneOut: 0, of: 40, share: 0 });
    expect(fam(c, "M5-1x").unit).toBe("ms");
    expect(fam(c, "M5-1x").candidate! % 5).toBe(0);
    expect(c.tsColdStartMs["1"]).toBeGreaterThan(400);
    expect(c.passes).toHaveLength(40);
  });

  it("reads 1% low FPS as TypeScript over WASM, so its lower bound sets the value", () => {
    const folders = many(10);
    for (const c of (folders[0].results as { comparisons: { metric: string; ciLow: number; ciHigh: number }[] }).comparisons) if (c.metric === "1% low FPS") Object.assign(c, { ciLow: 0.9, ciHigh: 1.01 });
    const c = calibrate(folders);
    expect(fam(c, "M3").values[0]).toBeCloseTo(1 / 0.9 - 1, 9);
    expect(fam(c, "M3").candidate).toBeCloseTo(0.12, 9);
    expect(c.problems.some((p) => p.startsWith("M3: the candidate 0.12"))).toBe(true);
  });

  it("refuses a candidate above its cap and says to calibrate again", () => {
    const c = calibrate(many(10, (i) => ({ upper: i === 4 ? 1.06 : 1.01 })));
    expect(fam(c, "M2").candidate).toBeCloseTo(0.06, 9);
    expect(fam(c, "M2").withinCap).toBe(false);
    expect(c.adoptable).toBe(false);
    expect(c.problems.join("\n")).toMatch(/M2: the candidate 0\.06 is above its cap 0\.05/);
  });

  it("reports the leave-one-out reading beside each candidate without letting it block adoption", () => {
    const c = calibrate(many(10, (i) => ({ upper: i === 3 ? 1.03 : 1.01 })), { exceedanceLimit: 0.05 });
    expect(fam(c, "M1").exceedance).toEqual({ leaveOneOut: 1, of: 10, share: 0.1 });
    expect(c.problems.join("\n")).not.toMatch(/leave-one-out|not covered by the rest/);
    // One noisy pass among 39 quiet ones sets the candidate (still under the cap) and raises no problem: the guarantee is what counts.
    const noisy = calibrateWith(many(40, (i) => ({ upper: i === 7 ? 1.04 : 1.005 })));
    expect(fam(noisy, "M1").candidate).toBeCloseTo(0.04, 9);
    expect(noisy.problems).toEqual([]);
    expect(noisy.adoptable).toBe(true);
  });

  it("holds a cold-start candidate to 5% of TypeScript's median cold start", () => {
    const c = calibrate(many(10, () => ({ coldDiff: 40 })));
    expect(c.tsColdStartMs["1"]).toBeGreaterThan(400);
    expect(fam(c, "M5-1x").cap).toBeCloseTo(c.tsColdStartMs["1"]! * 0.05, 9);
    expect(fam(c, "M5-1x").withinCap).toBe(false);
    expect(fam(c, "M5-4x").candidate).toBeGreaterThan(fam(c, "M5-1x").candidate!);
  });

  it("leaves out passes that cannot count, and wants five of each engine from one commit", () => {
    const folders = [...many(4), pass(4, { engine: null }), pass(5, { ok: false }), pass(6, { dirty: true }), pass(7, { reps: 5 }), pass(8, { scenarios: ["small"] }), pass(9, { commit: "other00" })];
    const c = calibrate(folders);
    const text = c.problems.join("\n");
    expect(text).toMatch(/aa-4: not an A\/A pass/);
    expect(text).toMatch(/aa-5: its validation failed/);
    expect(text).toMatch(/aa-6: it ran on a dirty tree/);
    expect(text).toMatch(/aa-7: 5 repetitions/);
    expect(text).toMatch(/aa-8: it lacks the medium and large scenarios/);
    expect(text).toMatch(/more than one commit/);
    expect(text).toMatch(/usable A\/A passes of ts; this calibration asks for at least 5/);
    expect(c.adoptable).toBe(false);
  });

  it("counts a copied folder once, so five copies are not five passes", () => {
    const one = [pass(0), pass(1)];
    const copies = [...Array.from({ length: 5 }, (_, i) => ({ ...one[0], folder: `ts-${i}`, sha256: "aa" })), ...Array.from({ length: 5 }, (_, i) => ({ ...one[1], folder: `wasm-${i}`, sha256: "bb" }))];
    const c = calibrate(copies);
    expect(c.passes).toHaveLength(2);
    expect(c.excluded).toHaveLength(8);
    expect(c.excluded[0].reason).toMatch(/identical to ts-0's/);
    expect(c.excluded[0].sha256).toBe("aa");
    expect(c.adoptable).toBe(false);
    expect(c.problems.join("\n")).toMatch(/1 usable A\/A passes of ts/);
  });

  it("counts a re-saved copy once, by its start time, commit and engine, whatever its hash", () => {
    const base = pass(0);
    const resaved = Array.from({ length: 5 }, (_, i) => ({ ...base, folder: `ts-${i}`, sha256: `hash-${i}` }));
    const c = calibrate(resaved);
    expect(c.passes).toHaveLength(1);
    expect(c.excluded).toHaveLength(4);
    expect(c.excluded[0].reason).toMatch(/start time, commit and engine of ts-0 \(one pass saved twice\)/);
    // Two real passes of one engine started at different times are two passes.
    expect(calibrate([pass(0, { engine: "ts", startedAt: "2026-10-21T00:00:00.000Z" }), pass(1, { engine: "ts", startedAt: "2026-10-21T00:01:00.000Z" })]).passes).toHaveLength(2);
    // A pass with no readable start time cannot be checked for being a copy, so it is left out.
    expect(calibrate([pass(0, { engine: "ts", startedAt: "later" })]).excluded[0].reason).toMatch(/startedAt is missing/);
  });

  it("refuses quick runs, another machine, a missing clean flag and a bad engine name", () => {
    const folders = [...many(8), pass(8, { quick: true }), pass(9, { cpu: "cpu-b" }), pass(10, { engine: "x" as EngineName })];
    (folders[7].results as { environment: { dirty?: boolean } }).environment.dirty = undefined;
    const c = calibrate(folders);
    const text = c.problems.join("\n");
    expect(text).toMatch(/aa-8: it is a --quick run/);
    expect(text).toMatch(/aa-10: not an A\/A pass/);
    expect(text).toMatch(/aa-7: it ran on a dirty tree, or does not say it was clean/);
    expect(text).toMatch(/the passes differ in machine or runtime: cpuModel;/);
    expect(c.adoptable).toBe(false);
  });

  it("names the toolchain field that one pass recorded as unknown", () => {
    const folders = many(10);
    for (const f of folders) (f.results as { environment: { rust: string | null } }).environment.rust = "rustc 1.88.0";
    (folders[3].results as { environment: { rust: string | null } }).environment.rust = null;
    const text = calibrate(folders).problems.join("\n");
    expect(text).toMatch(/the passes differ in machine or runtime: rust;/);
    expect(text).toMatch(/recorded as unknown in one pass/);
  });

  it("refuses to pool passes that differ in repetitions, scenarios, throttles or any run parameter", () => {
    const text = (folders: Folder[]) => calibrate(folders).problems.join("\n");
    const steps = many(10);
    (steps[3].results as { config: { steps: number } }).config.steps = 90;
    expect(text(steps)).toMatch(/differ in run parameters/);
    // Only 10-rep passes count: a 30-rep delta is too tight for a 10-rep verdict run, and an 11-rep one pools with nothing.
    expect(text([...many(9), pass(9, { reps: 30 })])).toMatch(/aa-9: 30 repetitions; the verdict runs use 10/);
    expect(text([...many(9), pass(9, { reps: 11 })])).toMatch(/aa-9: 11 repetitions; the verdict runs use 10/);
    expect(text([...many(9), pass(9, { scenarios: ["medium", "large"] })])).toMatch(/differ in run parameters/);
    expect(text([...many(9), pass(9, { throttles: [1, 4, 6] })])).toMatch(/differ in run parameters/);
    // The same set in another order is the same set.
    expect(text([...many(9), pass(9, { throttles: [4, 1] })])).not.toMatch(/differ in run parameters/);
  });

  it("refuses to pool passes from another browser build, channel, switches or renderer", () => {
    const text = (over: Spec) => calibrate([...many(9), pass(9, over)]).problems.join("\n");
    expect(text({ browserVersion: "142.0.0" })).toMatch(/differ in browser \(executable, channel, switches, version or WebGL renderer\)/);
    expect(text({ channel: "chrome" })).toMatch(/differ in browser/);
    expect(text({ args: ["--use-angle=d3d11"] })).toMatch(/differ in browser/);
    expect(text({ renderer: "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)", rendererEnd: "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)" })).toMatch(/differ in browser/);
    expect(text({})).not.toMatch(/differ in browser/);
  });

  it("leaves out a pass whose renderer is not verified hardware, or that declared an exception", () => {
    const left = (over: Spec) => calibrate([...many(9), pass(9, over)]).excluded.map((e) => e.reason).join("\n");
    expect(left({ renderer: SWIFT, rendererEnd: SWIFT })).toMatch(/aa-9|renderer is not verified hardware.*software rasterizer/);
    expect(left({ renderer: "null", rendererEnd: "null" })).toMatch(/renderer is not verified hardware/);
    expect(left({ renderer: null, rendererEnd: null })).toMatch(/renderer is not verified hardware/);
    expect(left({ rendererEnd: null })).toMatch(/renderer is not verified hardware/);
    expect(left({ rendererEnd: SWIFT })).toMatch(/renderer is not verified hardware/);
    // The read after the throttled cold start counts too: a software or missing read there refuses the pass.
    expect(left({ rendererEndCold: SWIFT })).toMatch(/renderer/);
    expect(left({ rendererEndCold: null })).toMatch(/renderer/);
    expect(left({ rendererEndCold: RTX })).toBe("");
    expect(left({ exception: "EX-4" })).toMatch(/declared renderer exception EX-4/);
    expect(left({ gpuVerified: false })).toMatch(/gpuVerified: false/);
    // Fail closed: a missing, null or wrongly typed field is not "verified".
    for (const bad of [null, undefined, "true", 1]) expect(left({ gpuVerified: bad as never }), String(bad)).toMatch(/does not record gpuVerified: true/);
    expect(left({})).toBe("");
    // An all-software set adopts nothing.
    const soft = calibrate(many(10, () => ({ renderer: SWIFT, rendererEnd: SWIFT })));
    expect(soft.passes).toHaveLength(0);
    expect(soft.adoptable).toBe(false);
  });

  it("leaves out a pass with no read after its cold start, and one that never recorded the field", () => {
    const left = (mutate: (r: { runs: { rendererEndCold?: unknown }[] }) => void) => {
      const folders = many(10);
      mutate(folders[9].results as unknown as { runs: { rendererEndCold?: unknown }[] });
      return calibrate(folders).excluded.map((e) => e.reason).join("\n");
    };
    expect(left((r) => delete r.runs[0].rendererEndCold)).toMatch(/no renderer read after its cold start/);
    expect(left((r) => (r.runs[0].rendererEndCold = ""))).toMatch(/no renderer read after its cold start/);
    expect(left(() => undefined)).toBe("");
  });

  it("leaves out a pass with no context-loss record, as a worker pass is, and one that lost a context", () => {
    const c = calibrate([...many(10), pass(20, { contextLost: null }), pass(21, { contextLost: ["webglcontextlost at 12 ms"] })]);
    const reason = (name: string) => c.excluded.find((e) => e.folder === name)?.reason;
    expect(reason("aa-20")).toMatch(/^a process run has no WebGL context-loss record/);
    expect(reason("aa-21")).toMatch(/lost its WebGL context/);
    expect(c.passes).toHaveLength(10);
  });

  it("takes the upper end of the 95% interval of the median cold-start difference, which is x(9) of 10", () => {
    // Differences 0 to 9: the median is 4.5, the maximum 9 and rank 8 is 7; the bound is 8.
    const p = pass(0).results as unknown as { metrics: { throttle: string; engine: string; values: number[] }[] };
    const [ts, wasm] = ["ts", "wasm"].map((engine) => p.metrics.find((m) => m.throttle === "1" && m.engine === engine)!);
    wasm.values = ts.values.map((v, r) => v + r);
    expect(coldStartDifference(p as never, "1")).toBe(8);
  });

  it("refuses halves that differ in engine build, and names the field", () => {
    const base = pass(0).results as unknown as Parameters<typeof poolIdentity>[0];
    const other = (env: Record<string, unknown>) => poolIdentity({ ...base, environment: { ...base.environment, ...env } });
    expect(halvesProblems(poolIdentity(base), other({}))).toEqual([]);
    const build = halvesProblems(poolIdentity(base), other({ engineBuildHash: "other-build", commit: "fff9999aaa" }));
    expect(build).toHaveLength(1);
    expect(build[0]).toMatch(/differ in engine build; one calibration/);
    expect(build[0]).toMatch(/commit abc1234\) and the perf:worker passes \(commit fff9999\)/);
    expect(halvesProblems(poolIdentity(base), other({ cpuModel: "cpu-b" }))[0]).toMatch(/differ in machine or runtime;/);
  });

  it("leaves out a pass whose working-tree record cannot prove a clean tree", () => {
    const clean = { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true };
    const left = (tree: unknown) => calibrate([...many(9), pass(9, { tree })]).excluded.map((e) => e.reason).join("\n");
    expect(left(clean)).toBe("");
    expect(left(undefined)).toBe("");
    expect(left({ ...clean, complete: false })).toMatch(/working-tree record is incomplete/);
    expect(left({ ...clean, porcelain: [" M a.ts"] })).toMatch(/record shows changes/);
    expect(left({ ...clean, porcelain: null })).toMatch(/record shows changes/);
    expect(left({ ...clean, hidden: ["a.ts"] })).toMatch(/assume-unchanged or skip-worktree/);
    const { hidden: _hidden, ...older } = clean;
    expect(left(older)).toMatch(/did not check for edits git hides/);
    // An empty status list does not prove a clean tree when the record holds a tracked-changes hash or untracked files.
    expect(left({ ...clean, diffSha256: "a".repeat(64) })).toMatch(/tracked-changes hash or untracked files/);
    expect(left({ ...clean, untracked: [{ path: "x.ts", sha256: "b".repeat(64) }] })).toMatch(/tracked-changes hash or untracked files/);
    // A record with no untracked list is an incomplete record that leaves the pass out, and does not crash the calibration.
    const { untracked: _untracked, ...noList } = clean;
    expect(left(noList)).toMatch(/no list of untracked files/);
    const none = many(10);
    for (const f of none) delete (f.results as { environment: { tree?: unknown } }).environment.tree;
    expect(calibrate(none).excluded[0].reason).toMatch(/no working-tree record, so a clean tree is not proven/);
  });

  it("leaves out a results file with fields missing instead of crashing on it", () => {
    const folders = many(10);
    delete (folders[2].results as { config: { reps?: number } }).config.reps;
    delete (folders[3].results as { environment: { commit?: string } }).environment.commit;
    (folders[4].results as { config: { scenarios?: string[] } }).config.scenarios = undefined;
    const c = calibrate(folders);
    expect(c.excluded.map((e) => e.folder)).toEqual(["aa-2", "aa-3", "aa-4"]);
    expect(c.excluded[0].reason).toMatch(/lacks what a pass needs \(config\.reps is missing\)/);
  });

  it("does not count a pass whose cells rest on fewer than ten pairs", () => {
    const c = calibrate(many(10, (i) => ({ pairs: i === 2 ? 6 : 10 })));
    expect(fam(c, "M1").values[2]).toBeNull();
    expect(fam(c, "M1").candidate).toBeNull();
    expect(c.adoptable).toBe(false);
  });

  it("never adopts a zero tolerance, a missing cap or float noise", () => {
    const quiet = calibrate(many(10, () => ({ upper: 0.99 })));
    expect(fam(quiet, "M1").candidate).toBeCloseTo(0.01, 9);
    expect(fam(quiet, "M5-1x").candidate).toBe(5);
    const noisy = calibrate(many(10, () => ({ upper: 1.0057 })));
    expect(fam(noisy, "M1").candidate).toBe(0.01);
    const noCap = many(10);
    for (const f of noCap) (f.results as { metrics: { engine: string; reps: number[]; values: number[] }[] }).metrics.forEach((m) => m.engine === "ts" && ((m.values = []), (m.reps = [])));
    const c = calibrate(noCap);
    expect(fam(c, "M5-1x").cap).toBeNull();
    expect(fam(c, "M5-1x").candidate).toBeNull();
    expect(c.adoptable).toBe(false);
    expect(c.problems.join("\n")).not.toContain("null");
  });

  it("states the guarantee for the pass count used, and wants enough passes for the limit", () => {
    // The default limit is the protocol's 5%: five passes per engine give 1/6.
    const five = calibrateWith(many(10));
    expect(five.guarantee).toBeCloseTo(1 / 6, 9);
    expect(five.problems.join("\n")).toMatch(/5 passes per engine guarantee only that a fresh pass lands above the candidate with probability 1\/6 on average \(16.7%\), which is not under the 5% limit; the limit needs at least 20 passes per engine; the pass count and limit are the owner/);
    expect(five.adoptable).toBe(false);
    expect(passesForLimit(0.05)).toBe(20);
    expect(passesForLimit(0.2)).toBe(5);
    expect(passesForLimit(0.17)).toBe(5);
    // Twenty per engine meet 5%; asking for 20 (stricter than the default 5) is not a relaxation.
    const twenty = calibrateWith(many(40, (i) => ({ upper: 1.005 + (i % 3) * 0.002 })), { minPassesPerEngine: 20 });
    expect(twenty.guarantee).toBeCloseTo(1 / 21, 9);
    expect(twenty.problems).toEqual([]);
    expect(twenty.adoptable).toBe(true);
    expect(twenty.minPassesPerEngine).toBe(20);
    expect(twenty.protocolDefaults).toBe(true);
  });

  it("never calls a looser pass count or limit adoptable, and says it needs the owner", () => {
    for (const [name, options] of [["fewer passes", { minPassesPerEngine: 2, exceedanceLimit: 0.34 }], ["a looser limit", { exceedanceLimit: 0.17 }], ["both", { minPassesPerEngine: 3, exceedanceLimit: 0.3 }]] as const) {
      const c = calibrateWith(many(10), options);
      expect(c.protocolDefaults, name).toBe(false);
      expect(c.adoptable, name).toBe(false);
      expect(c.problems.join("\n"), name).toMatch(/looser than the protocol's 5 passes and 5%; the pass count and limit are the owner's to settle \(an open amendment to OD-4\)/);
      expect(calibrationMarkdown(c, "2026-10-21T00:00:00Z"), name).toContain("**Looser than the protocol's parameters.**");
    }
    // Even a set that would pass every other check stays not adoptable under a looser limit.
    const forty = calibrateWith(many(40), { exceedanceLimit: 0.06 });
    expect(forty.problems).toHaveLength(1);
    expect(forty.adoptable).toBe(false);
  });

  it("records what the passes share, so a verdict run can check it matches", () => {
    const c = calibrateWith(many(40), {});
    expect(c.pool).toMatchObject({ commit: "abc1234def", browser: { channel: null, args: [], version: "141.0.1", renderers: [RTX] }, config: { reps: 10, aa: null } });
    expect(c.pool!.machine).toMatchObject({ cpuModel: "cpu-a" });
    const md = calibrationMarkdown(c, "2026-10-21T00:00:00Z");
    expect(md).toMatch(/## What the passes share[\s\S]*machine, browser and run parameters match[\s\S]*Provenance: commit abc1234def[\s\S]*\(not a condition on the verdict run\)[\s\S]*Browser: executable default headless shell, channel default, switches none, version 141\.0\.1, renderer ANGLE/);
    const other = calibrateWith(many(40, () => ({ channel: "chrome", args: ["--use-angle=d3d11"] })), {});
    expect(other.pool!.browser).toMatchObject({ channel: "chrome", args: ["--use-angle=d3d11"] });
    expect(calibrateWith([]).pool).toBeNull();
  });

  it("has no candidate when a pass lacks a cell", () => {
    const folders = many(10);
    (folders[2].results as { comparisons: unknown[] }).comparisons = [];
    const c = calibrate(folders);
    expect(fam(c, "M1").candidate).toBeNull();
    expect(c.problems.join("\n")).toMatch(/M1: 1 of 10 passes \(aa-2\) lack a cell the family needs, so there is no candidate for any pass/);
  });

  it("writes a report that leads with its window, says what it covers and what it leaves out", () => {
    const md = calibrationMarkdown(calibrateWith(many(40)), "2026-10-21T00:00:00Z");
    expect(md.split("\n")[2]).toMatch(/^> \*\*Snapshot of A\/A passes started 2026-10-21T00:00:00\.000Z to 2026-10-21T00:39:00\.000Z, commit abc1234; computed 2026-10-21T00:00:00Z\.\*\* The live numbers come from `npm run perf:calibrate`.*calibrate\.test\.ts/);
    expect(md).toContain("Provisional: it covers M1, M2, M3 and M5; M4's long-task ε needs `perf:worker` A/A passes (#1111)");
    expect(md).toContain("nothing here sets a tolerance until the owner adopts the numbers (OD-4");
    expect(md).toContain("**Candidates pass every check of this tool.** They are provisional");
    expect(md).toContain("With 20 passes of the engine that has the fewest, and passes that are exchangeable, the chance that a fresh pass lands above a candidate (before rounding) is 1/21 on average = 4.8%. The limit is 5%");
    expect(md).toContain("The leave-one-out column below is informational");
    expect(md).toMatch(/\| M1 \| δ \| 0\.0[0-9]+ \| 0\.050 \|/);
    expect(md).toMatch(/\| M5-4x \| ε \| [1-9]\d*\.0 ms \|/);
    // A folder name with a pipe stays in its cell.
    const piped = calibrateWith([...many(40)].map((f, i) => (i === 0 ? { ...f, folder: "a|b" } : f)));
    expect(calibrationMarkdown(piped, "x")).toContain("| a\\|b | ts |");
    expect(md).toContain("M1, M2 and M3 each get their own δ");
    expect(md).toContain("results.json SHA-256 (canonical)");
    expect(calibrationMarkdown(calibrate(many(2)), "t")).toContain("**Not adoptable yet.**");
    // Left-out folders keep their hash in the report.
    const withCopy = calibrate([...many(10), { ...pass(0), folder: "copy", sha256: "abc" }].map((f, i) => (i === 0 ? { ...f, sha256: "abc" } : f)));
    expect(calibrationMarkdown(withCopy, "t")).toMatch(/\| copy \| its results\.json is identical to aa-0's.*\| abc \|/);
  });
});

