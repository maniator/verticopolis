import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calibrate as calibrateWith, calibrationMarkdown, passesForLimit, stable } from "./calibrate";
import { main, parseCalibrateArgs } from "./calibrateMain";
import type { EngineName } from "./types";

type Folder = Parameters<typeof calibrateWith>[0][number];

const RTX = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
const SWIFT = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";
/** Five passes per engine guarantee 1/6, so most tests state a 20% limit; the default 5% limit is tested on its own. */
const calibrate = (folders: Folder[], options: Parameters<typeof calibrateWith>[1] = {}) => calibrateWith(folders, { exceedanceLimit: 0.2, ...options });

interface Spec {
  engine?: EngineName | null;
  /** Upper bound of every ratio cell. */
  upper?: number;
  /** Cold start paired difference: the wasm slot's value minus ts slot's, per rep. */
  coldDiff?: number;
  reps?: number;
  commit?: string;
  dirty?: boolean;
  ok?: boolean;
  scenarios?: string[];
  quick?: boolean;
  /** Replaces the cmp pairs of every ratio cell. */
  pairs?: number;
  cpu?: string;
  renderer?: string | null;
  rendererEnd?: string | null;
  rendererEndCold?: string | null;
  channel?: string | null;
  args?: string[];
  browserVersion?: string;
  exception?: string | null;
  gpuVerified?: boolean | null;
  tree?: unknown;
  throttles?: number[];
  startedAt?: string;
}

const alternate = (i: number): EngineName => (i % 2 === 0 ? "ts" : "wasm");

const cmp = (group: string, metric: string, scenario: string, throttle: string, upper: number, pairs = 10) => ({
  group, scenario, throttle, metric, unit: "ms", better: "lower", tsMedian: 1, wasmMedian: 1, ratio: 1, ciLow: 2 - upper, ciHigh: upper, verdict: "equivalent", n: { ts: 10, wasm: 10, pairs },
});

function pass(i: number, s: Spec = {}): Folder {
  const reps = s.reps ?? 10;
  const upper = s.upper ?? 1.01;
  // Unset means the verified card; null means no WebGL read at all.
  const renderer = s.renderer === undefined ? RTX : s.renderer;
  const webgl = renderer === null ? null : { renderer, vendor: "v" };
  const scenarios = s.scenarios ?? ["small", "medium", "large"];
  const comparisons = scenarios.flatMap((sc) =>
    ["1", "4"].flatMap((t) => [cmp("sim-raw", "total for fixed duration", sc, t, upper, s.pairs), cmp("sim-hosted", "total for fixed duration", sc, t, upper, s.pairs), cmp("frames", "frame time p99", sc, t, upper, s.pairs), cmp("frames", "1% low FPS", sc, t, upper, s.pairs)]),
  );
  const repsList = Array.from({ length: reps }, (_, r) => r);
  const startup = (engine: EngineName, t: string) => ({ group: "startup", scenario: "-", throttle: t, metric: "cold game ready", unit: "ms", better: "lower", engine, reps: repsList, values: repsList.map((r) => (t === "1" ? 400 : 1600) + r + (engine === "wasm" ? (s.coldDiff ?? 0) * (t === "1" ? 1 : 4) : 0)), summary: null });
  return {
    folder: `aa-${i}`,
    results: {
      startedAt: s.startedAt ?? new Date(Date.UTC(2026, 9, 21, 0, i)).toISOString(),
      config: { aa: s.engine === undefined ? alternate(i) : s.engine, reps, scenarios, throttles: s.throttles ?? [1, 4], quick: s.quick ?? false, dt: 2, steps: 720 },
      browser: { version: s.browserVersion ?? "141.0.1", executable: null, channel: s.channel ?? null, args: s.args ?? [], rendererException: s.exception ?? null, gpuVerified: "gpuVerified" in s ? s.gpuVerified : true },
      runs: [{ ok: true, page: { webgl }, rendererEnd: s.rendererEnd === undefined ? renderer : s.rendererEnd, rendererEndCold: "rendererEndCold" in s ? s.rendererEndCold : renderer }],
      comparisons,
      metrics: ["1", "4"].flatMap((t) => [startup("ts", t), startup("wasm", t)]),
      validation: { ok: s.ok ?? true, errors: [], warnings: [] },
      environment: { commit: s.commit ?? "abc1234def", dirty: s.dirty ?? false, cpuModel: s.cpu ?? "cpu-a", tree: s.tree ?? { porcelain: [], diffSha256: null, untracked: [], hidden: [], complete: true } },
    },
  } as unknown as Folder;
}

const many = (n: number, over: (i: number) => Spec = () => ({})): Folder[] => Array.from({ length: n }, (_, i) => pass(i, over(i)));
const fam = (c: ReturnType<typeof calibrate>, id: string) => c.families.find((f) => f.id === id)!;

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

describe("perf:calibrate", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  it("reads folders and a new --out", () => {
    expect(parseCalibrateArgs(["a", "b", "--out", "o"])).toEqual({ folders: ["a", "b"], out: "o" });
    expect(parseCalibrateArgs(["a", "--out", "o", "--min-passes", "20", "--exceedance-limit", "0.05"])).toEqual({ folders: ["a"], out: "o", minPassesPerEngine: 20, exceedanceLimit: 0.05 });
    for (const bad of [["--min-passes", "1"], ["--min-passes", "x"], ["--min-passes"], ["--exceedance-limit", "0"], ["--exceedance-limit", "1.5"], ["--min-passes", "5", "--min-passes", "6"]]) expect(() => parseCalibrateArgs(["a", "--out", "o", ...bad]), bad.join(" ")).toThrow(/--min-passes|--exceedance-limit/);
    expect(() => parseCalibrateArgs(["--out", "o"])).toThrow(/at least one/);
    expect(() => parseCalibrateArgs(["a"])).toThrow(/--out DIR is required/);
    expect(() => parseCalibrateArgs(["a", "--out"])).toThrow(/needs a value/);
    expect(() => parseCalibrateArgs(["a", "--out", "o", "--out", "p"])).toThrow(/given twice/);
    expect(() => parseCalibrateArgs(["a", "--fast"])).toThrow(/unknown argument --fast/);
  });


  it("writes calibration.json and calibration.md, never over an existing folder", () => {
    const repo = mkdtempSync(join(tmpdir(), "calibrate-"));
    dirs.push(repo);
    const names = many(40).map((f, i) => {
      mkdirSync(join(repo, `aa-${i}`));
      writeFileSync(join(repo, `aa-${i}`, "results.json"), JSON.stringify(f.results));
      return `aa-${i}`;
    });
    const limit = ["--exceedance-limit", "0.2"];
    // Twenty passes per engine meet the protocol's 5%; a looser limit is the owner's call, so it exits 1.
    expect(main([...names, "--out", "loose", ...limit], repo)).toBe(1);
    expect(main(names.slice(0, 10).concat(["--out", "strict"]), repo)).toBe(1);
    expect(main([...names, "--out", "cal"], repo, () => "2026-10-21T00:00:00Z")).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, "cal", "calibration.json"), "utf8")).adoptable).toBe(true);
    expect(readFileSync(join(repo, "cal", "calibration.md"), "utf8")).toContain("# δ and ε calibration");
    expect(() => main([...names, "--out", "cal"], repo)).toThrow(/never overwritten/);
    expect(() => main(["missing", "--out", "cal2"], repo)).toThrow(/has no results.json/);
    expect(main(names.slice(0, 3).concat(["--out", "cal3"]), repo)).toBe(1);
    // A folder copied under another name is one pass, and the record keeps each input's hash.
    mkdirSync(join(repo, "copy"));
    writeFileSync(join(repo, "copy", "results.json"), readFileSync(join(repo, "aa-0", "results.json")));
    expect(main([...names, "copy", "--out", "cal4"], repo)).toBe(1);
    const cal = JSON.parse(readFileSync(join(repo, "cal4", "calibration.json"), "utf8"));
    expect(cal.excluded).toEqual([{ folder: "copy", reason: expect.stringMatching(/identical to aa-0's/), sha256: cal.passes[0].sha256 }]);
    expect(cal.passes[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // A copy re-saved with CRLF line endings, other indentation and another key order is the same pass.
    mkdirSync(join(repo, "resaved"));
    const original = JSON.parse(readFileSync(join(repo, "aa-1", "results.json"), "utf8")) as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    writeFileSync(join(repo, "resaved", "results.json"), JSON.stringify(reordered, null, 4).replace(/\n/g, "\r\n"));
    expect(main([...names, "resaved", "--out", "cal7"], repo)).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "cal7", "calibration.json"), "utf8")).excluded).toEqual([{ folder: "resaved", reason: expect.stringMatching(/identical to aa-1's/), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
    expect(stable({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stable({ a: [2, { c: 2, d: 1 }], b: 1 }));
    mkdirSync(join(repo, "bad"));
    writeFileSync(join(repo, "bad", "results.json"), "{}");
    expect(() => main(["bad", "--out", "cal5"], repo)).toThrow(/is not a perf:compare results.json/);
    writeFileSync(join(repo, "bad", "results.json"), "{");
    expect(() => main(["bad", "--out", "cal6"], repo)).toThrow(/not valid JSON/);
    // A UTF-8 byte order mark (PowerShell 5.1 writes one) does not abort the run.
    mkdirSync(join(repo, "bom"));
    writeFileSync(join(repo, "bom", "results.json"), `\uFEFF${JSON.stringify(many(1)[0].results)}`);
    expect(main([...names, "bom", "--out", "cal8"], repo)).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "cal8", "calibration.json"), "utf8")).excluded[0].reason).toMatch(/identical to aa-0/);
  });
});
