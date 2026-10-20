import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../perfCompare/calibrateMain";
import { blockingDifference, calibrateM4, isWorkerResults, m4Markdown } from "./calibrateM4";
import { RTX, SWIFT, workerPass, type WorkerSpec } from "./calibrateM4Fixture";

const many = (n: number, over: (i: number) => WorkerSpec = () => ({})) => Array.from({ length: n }, (_, i) => workerPass(i, over(i)));
/** Five passes per engine guarantee 1/6, so most tests state a 20% limit; the default 5% limit is tested on its own. */
const calibrate = (folders: ReturnType<typeof many>, options: Parameters<typeof calibrateM4>[1] = {}) => calibrateM4(folders, { exceedanceLimit: 0.2, ...options });

describe("calibrateM4", () => {
  it("adopts a round candidate when enough passes agree", () => {
    const c = calibrateM4(many(40, (i) => ({ diff1: 1 + (i % 3), diff4: 2 + (i % 4) })));
    expect(c.problems).toEqual([]);
    expect(c.adoptable).toBe(true);
    expect(c.protocolDefaults).toBe(true);
    expect(c.family.id).toBe("M4");
    expect(c.family.unit).toBe("ms");
    expect(c.family.candidate).toBe(5);
    expect(c.family.cap).toBe(50);
    expect(c.family.exceedance).toEqual({ leaveOneOut: 0, of: 40, share: 0 });
    expect(c.passes).toHaveLength(40);
    expect(c.pool?.browser.renderers).toEqual([RTX]);
  });

  it("takes the larger of the two throttles per pass, then the largest pass, rounded up to 5 ms", () => {
    const c = calibrate(many(10, (i) => ({ diff1: 3, diff4: i === 0 ? 12 : 4 })));
    expect(c.family.values[0]).toBe(12);
    expect(c.family.values[1]).toBe(4);
    expect(c.family.candidate).toBe(15);
    // A WASM slot that blocks less sets no negative tolerance: the floor is one step.
    expect(calibrate(many(10, () => ({ diff1: -30, diff4: -20 }))).family.candidate).toBe(5);
  });

  it("is not adoptable above the 50 ms cap", () => {
    const c = calibrate(many(10, (i) => ({ diff4: i === 3 ? 60 : 1 })));
    expect(c.family.candidate).toBe(60);
    expect(c.family.withinCap).toBe(false);
    expect(c.adoptable).toBe(false);
    expect(c.problems.some((p) => p.startsWith("M4: the candidate 60 ms is above its cap 50 ms"))).toBe(true);
  });

  it("leaves M4 without a candidate when a throttle has fewer than 10 pairs", () => {
    const c = calibrate(many(10, (i) => ({ reps4: i === 0 ? 9 : 10 })));
    expect(c.family.values[0]).toBeNull();
    expect(c.family.candidate).toBeNull();
    expect(c.adoptable).toBe(false);
    expect(c.problems.some((p) => p.startsWith("M4: 1 of 10 passes (aa-worker-0) lack a cell"))).toBe(true);
    expect(blockingDifference(workerPass(0).results, "2")).toBeNull();
  });

  it("pairs by repetition number, not by position", () => {
    const p = workerPass(0, { diff1: 7 }).results;
    const wasm = p.metrics.find((m) => m.mode === "wasm" && m.throttle === "1")!;
    wasm.reps = [...wasm.reps].reverse();
    wasm.values = [...wasm.values].reverse();
    expect(blockingDifference(p, "1")).toBe(7);
  });

  it("leaves out a folder that cannot count, and says why", () => {
    const folders = [
      ...many(10),
      workerPass(20, { aa: null }),
      workerPass(21, { ok: false }),
      workerPass(22, { dirty: true }),
      workerPass(23, { quick: true }),
      workerPass(24, { reps: 9 }),
      workerPass(25, { scenarios: ["small", "medium"] }),
      workerPass(26, { renderer: SWIFT }),
      workerPass(27, { gpuVerified: null }),
      workerPass(28, { contextLost: null }),
      workerPass(29, { contextLost: ["webglcontextlost at 12 ms"] }),
    ];
    const c = calibrate(folders);
    expect(c.passes).toHaveLength(10);
    const reason = (name: string) => c.excluded.find((e) => e.folder === name)!.reason;
    expect(reason("aa-worker-20")).toMatch(/not an A\/A pass/);
    expect(reason("aa-worker-21")).toMatch(/validation failed/);
    expect(reason("aa-worker-22")).toMatch(/dirty/);
    expect(reason("aa-worker-23")).toMatch(/--quick/);
    expect(reason("aa-worker-24")).toMatch(/9 repetitions/);
    expect(reason("aa-worker-25")).toMatch(/lacks the large scenario/);
    expect(reason("aa-worker-26")).toMatch(/not verified hardware.*SwiftShader/);
    expect(reason("aa-worker-27")).toMatch(/gpuVerified/);
    expect(reason("aa-worker-28")).toMatch(/no WebGL context-loss record/);
    expect(reason("aa-worker-29")).toMatch(/lost its WebGL context/);
  });

  it("refuses to pool passes that differ, and counts a copy once", () => {
    const c = calibrate(many(10, (i) => ({ cpu: i === 4 ? "cpu-b" : "cpu-a", commit: i === 5 ? "fff0000" : "abc1234def" })));
    expect(c.problems.join("\n")).toMatch(/differ in machine or runtime: cpuModel/);
    expect(c.problems.join("\n")).toMatch(/more than one commit/);
    expect(c.adoptable).toBe(false);
    const dup = many(10);
    const twin = { folder: "copy", results: dup[0].results };
    const d = calibrate([...dup, { ...twin, sha256: "x" }].map((f, i) => (i < 10 ? { ...f, sha256: `h${i}` } : f)));
    expect(d.excluded.map((e) => e.folder)).toEqual(["copy"]);
  });

  it("asks for the protocol's pass count and limit, and never adopts a looser pair", () => {
    expect(calibrateM4(many(10)).adoptable).toBe(false);
    expect(calibrateM4(many(10)).problems.join("\n")).toMatch(/guarantee only/);
    expect(calibrate(many(4)).problems.join("\n")).toMatch(/2 usable A\/A passes of ts/);
    expect(calibrate(many(10)).protocolDefaults).toBe(false);
    expect(calibrate(many(10)).adoptable).toBe(false);
  });

  it("recognizes a perf:worker results.json by its modes", () => {
    expect(isWorkerResults(workerPass(0).results)).toBe(true);
    expect(isWorkerResults({ config: { aa: "ts" } })).toBe(false);
    expect(isWorkerResults(null)).toBe(false);
  });

  it("writes a section with the candidate, the problems and the passes", () => {
    const md = m4Markdown(calibrate(many(10, () => ({ diff1: 7 }))), "t", false);
    expect(md).toContain("# M4 long-task ε from `perf:worker` A/A passes");
    expect(md).toContain("| M4 | ε | 10.0 ms | 50.0 ms |");
    expect(md).toContain("M4 is not adoptable yet.");
    expect(md).toContain("aa-worker-0");
    expect(m4Markdown(calibrateM4([]), "t", true)).toContain("## M4 long-task");
  });
});

describe("perf:calibrate on perf:worker folders", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  it("calibrates M4 from worker folders alone and exits 1 when it is not adoptable", () => {
    const repo = mkdtempSync(join(tmpdir(), "calibrate-m4-"));
    dirs.push(repo);
    const names = many(40, () => ({ diff1: 2, diff4: 3 })).map((f) => {
      mkdirSync(join(repo, f.folder));
      writeFileSync(join(repo, f.folder, "results.json"), JSON.stringify(f.results));
      return f.folder;
    });
    expect(main([...names, "--out", "ok"], repo, () => "2026-10-21T00:00:00Z")).toBe(0);
    const json = JSON.parse(readFileSync(join(repo, "ok", "calibration.json"), "utf8"));
    expect(json.adoptable).toBe(true);
    expect(json.m4.family.candidate).toBe(5);
    expect(readFileSync(join(repo, "ok", "calibration.md"), "utf8")).toContain("# M4 long-task ε");
    expect(main(names.slice(0, 10).concat(["--out", "few"]), repo)).toBe(1);
  });
});
