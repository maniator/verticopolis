import { describe, expect, it } from "vitest";
import { BLOCKING_EPSILON_MS, compareRuns } from "./beforeAfter";
import { comparisonMarkdown } from "./beforeAfterMain";
import { after, BLOCK, both, before, LOW, metric, results, row, TIME, type Spec } from "./beforeAfterFixture";
import type { WorkerResults } from "./main";
import type { ModeName } from "./pageWorker";

/** The same build in both runs, so the pair is an A/A and the defaults are the three main-thread controls. */
const sameBuild = { commit: "a".repeat(40), hash: "h1" };
const REPS = 10;

/** A copy of the results with one repetition of one mode removed from every metric. */
const without = (r: WorkerResults, mode: ModeName, rep: number): WorkerResults => ({
  ...r,
  metrics: r.metrics.map((m) => {
    if (m.mode !== mode) return m;
    const keep = m.reps.map((x, i) => (x === rep ? -1 : i)).filter((i) => i >= 0);
    return { ...m, reps: keep.map((i) => m.reps[i]), values: keep.map((i) => m.values[i]) };
  }),
});

describe("controls that cannot see drift", () => {
  it("does not let a control pinned at a cap vouch, and says so on the subject row", () => {
    // ts sits at exactly 120 sim minutes per second in both runs, as on the owner's RTX runs.
    const pinned = (m: ModeName, n: string): number | undefined => (m === "ts" && n === "mean FPS" ? 120 : undefined);
    const c = compareRuns(before({ valueFor: pinned }), after({ valueFor: (m, n) => pinned(m, n) ?? (m === "wasm-worker" && n === "mean FPS" ? 54 : undefined) }), { controls: ["ts"] });
    expect(row(c, "ts", "mean FPS").status).toBe("control-flat");
    const s = row(c, "wasm-worker", "mean FPS");
    // A 10% loss in the worker's rate, with the only control unable to show drift.
    expect(s.ratio).toBeGreaterThan(1.05);
    expect(s.status).toBe("uncontrolled");
    expect(s.net).toBeNull();
    expect(s.notes.join(" ")).toMatch(/control ts is flat in both runs/);
    expect(c.counts["control-flat"]).toBeGreaterThan(0);
    expect(comparisonMarkdown(c, "t")).toMatch(/CONTROL FLAT/);
  });

  it("lets a control with a little scatter vouch: the flat band is a third of the tolerance", () => {
    const status = (wobble: number) => row(compareRuns(before({ wobble }), after({ wobble }), { controls: ["ts"] }), "ts", "mean FPS").status;
    // The pattern spans 2 x wobble. A 4% and a 2% range are past the 1.7% band; a 1% range is inside it.
    expect(status(0.02)).toBe("control-ok");
    expect(status(0.01)).toBe("control-ok");
    expect(status(0.005)).toBe("control-flat");
    const c = compareRuns(before({ wobble: 0.02 }), after({ wobble: 0.02, scale: { "wasm-worker": 1.2 } }), { controls: ["ts"] });
    expect(row(c, "wasm-worker", TIME).status).toBe("ok");
  });

  it("never calls a precise control flat on a metric no cap or floor pins: hosted time, heap size, byte counts", () => {
    const heap = "main-thread JS heap";
    const withHeap = (r: WorkerResults, spec: Spec): WorkerResults => ({ ...r, metrics: [...r.metrics, ...(["ts", "wasm-worker"] as ModeName[]).map((m) => metric(m, heap, 78e6, spec, { group: "memory", unit: "bytes" }))] });
    // Everything exactly the same in both runs but for the worker's heap, which grows 20%.
    const spec: Spec = { wobble: 0, scale: { "wasm-worker": 1.2 }, scaleOnly: heap };
    const c = compareRuns(withHeap(before({ wobble: 0 }), { wobble: 0 }), withHeap(after({ wobble: 0 }), spec), { controls: ["ts"] });
    expect(row(c, "ts", heap).status).toBe("control-ok");
    expect(row(c, "wasm-worker", heap).status).toBe("ok");
    expect(row(c, "wasm-worker", heap).notes).toEqual([]);
    // The hosted time of a perfectly steady control vouches too, while a frame rate with the same values is flat.
    expect(row(c, "ts", TIME).status).toBe("control-ok");
    expect(row(c, "ts", "mean FPS").status).toBe("control-flat");
  });

  it("counts a flat blocking control (zero in both runs) as unable to vouch, and a quiet-but-moving one as able", () => {
    const c = compareRuns(before(), after({ valueFor: (m, n) => (m === "wasm-worker" && n === BLOCK ? 400 : undefined) }), { controls: ["ts"] });
    expect(row(c, "ts", BLOCK).status).toBe("control-flat");
    expect(row(c, "wasm-worker", BLOCK).status).toBe("uncontrolled");
  });
});

describe("blocking is judged against an absolute epsilon", () => {
  const levels = (shift: number) => (m: ModeName, n: string, r: number): number | undefined => (n === BLOCK && m !== "wasm-worker" ? 100 + 10 * r + shift : undefined);
  const base = (m: ModeName, n: string, r: number): number | undefined => (n === BLOCK && m !== "wasm-worker" ? 100 + 10 * r : undefined);

  it("does not void a subject for a control that moved less than the epsilon, on a nonzero baseline", () => {
    // 40 ms is 40% of a 100 ms baseline, far past 5%, but under the 50 ms cap.
    const c = compareRuns(before({ valueFor: (m, n, r) => base(m, n, r) ?? (m === "wasm-worker" && n === BLOCK ? 100 + 10 * r : undefined) }), after({ valueFor: (m, n, r) => levels(40)(m, n, r) ?? (m === "wasm-worker" && n === BLOCK ? 500 + 10 * r : undefined) }), { controls: ["ts"] });
    expect(row(c, "ts", BLOCK).status).toBe("control-ok");
    const s = row(c, "wasm-worker", BLOCK);
    expect(s.basis).toBe("difference");
    expect(s.diffMedian).toBe(400);
    expect(s.status).toBe("ok");
  });

  it("voids the subject once the control moves more than the epsilon, in either direction", () => {
    expect(BLOCKING_EPSILON_MS).toBe(50);
    for (const shift of [60, -60]) {
      const c = compareRuns(before({ valueFor: (m, n, r) => base(m, n, r) ?? (m === "wasm-worker" && n === BLOCK ? 100 + 10 * r : undefined) }), after({ valueFor: (m, n, r) => levels(shift)(m, n, r) ?? (m === "wasm-worker" && n === BLOCK ? 500 + 10 * r : undefined) }), { controls: ["ts"] });
      expect(row(c, "ts", BLOCK).status, `${shift}`).toBe("control-drift");
      expect(row(c, "wasm-worker", BLOCK).status, `${shift}`).toBe("void");
    }
  });

  it("lists a control on a difference in the report with its absolute move", () => {
    const c = compareRuns(before({ valueFor: base }), after({ valueFor: levels(40) }), { controls: ["ts"] });
    expect(comparisonMarkdown(c, "t")).toMatch(/every control on a difference/);
    expect(comparisonMarkdown(c, "t")).toMatch(/\(ms\) \| ts \| no ratio \| 40\.0 /);
  });
});

describe("noisy controls", () => {
  const noisyPair = () => compareRuns(before({ ...sameBuild, jitter: 0.12, seed: 1 }), results({ ...sameBuild, jitter: 0.12, seed: 2, startedAt: "2026-10-21T14:00:00Z", generatedAt: "2026-10-21T18:00:00Z" }), { controls: ["ts"] });

  it("marks a subject that only a noisy control vouches for apart from a plainly controlled one", () => {
    const c = noisyPair();
    const behindNoisy = c.rows.filter((r) => r.role === "subject" && r.basis === "ratio" && c.rows.some((k) => k.role === "control" && k.status === "control-noisy" && k.scenario === r.scenario && k.throttle === r.throttle && k.metric === r.metric));
    expect(behindNoisy.length).toBeGreaterThan(0);
    for (const r of behindNoisy) expect(["noisy-controlled", "void", "thin"], `${r.metric} ${r.throttle}x`).toContain(r.status);
    expect(behindNoisy.some((r) => r.status === "noisy-controlled")).toBe(true);
    expect(c.counts["noisy-controlled"]).toBeGreaterThan(0);
    expect(c.counts.ok + c.counts["noisy-controlled"] + c.counts.void + c.counts.uncontrolled + c.counts.thin).toBe(c.rows.filter((r) => r.role === "subject").length);
    expect(comparisonMarkdown(c, "t")).toMatch(/controlled by noisy controls only/);
  });

  it("computes the net ratio rep by rep, so a control that shares the subject's scatter narrows the interval", () => {
    // Every mode starts at 800; ts and the worker both land at 800 h(rep) with h spread over +-8%: the same factor per rep.
    const h = (r: number): number => 1 + 0.04 * ((r % 5) - 2);
    const shared = (m: ModeName, n: string, r: number): number | undefined => (n === TIME && (m === "ts" || m === "wasm-worker") ? 800 * h(r) : undefined);
    const c = compareRuns(before({ wobble: 0, valueFor: (m, n) => (n === TIME && (m === "ts" || m === "wasm-worker") ? 800 : undefined) }), after({ wobble: 0, valueFor: shared }), { controls: ["ts"] });
    expect(row(c, "ts", TIME).status).toBe("control-noisy");
    const s = row(c, "wasm-worker", TIME);
    expect(s.status).toBe("noisy-controlled");
    // The raw interval is the control's spread; the net, taken repetition by repetition, is exactly 1 with no spread at all.
    expect(s.ciHigh! - s.ciLow!).toBeGreaterThan(0.1);
    expect(s.net!.ratio).toBeCloseTo(1, 9);
    expect(s.net!.ciLow).toBeCloseTo(1, 9);
    expect(s.net!.ciHigh).toBeCloseTo(1, 9);
    expect(s.net!.controls).toEqual(["ts"]);
    // The note says what each figure assumes.
    expect(s.notes.join(" ")).toMatch(/noisy control ts.*raw ratio assumes.*net-of-control ratio assumes the drift is common/);
  });

  it("takes the net over every vouching control, not the first or the last", () => {
    // Controls at 1.02x and 0.98x, subject at 1.10x: the middle of the two per-rep control ratios is 1.00.
    const c = compareRuns(before(), after({ scale: { ts: 1.02, wasm: 0.98, "wasm-worker": 1.1 }, scaleOnly: TIME }), { controls: both });
    expect(row(c, "ts", TIME).status).toBe("control-ok");
    expect(row(c, "wasm", TIME).status).toBe("control-ok");
    const s = row(c, "wasm-worker", TIME);
    expect(s.net!.controls).toEqual(["ts", "wasm"]);
    expect(s.net!.ratio).toBeCloseTo(1.1, 3);
  });

  it("gives no net below the minimum number of repetitions, and says why", () => {
    // The subject misses repetition 3 and the control repetition 5: 9 pairs each, 8 repetitions in common.
    const a = without(without(after({ scale: { "wasm-worker": 1.1 }, scaleOnly: TIME }), "wasm-worker", 3), "ts", 5);
    const nine = row(compareRuns(before(), a, { controls: ["ts"], minPairs: 9 }), "wasm-worker", TIME);
    expect(nine.pairs).toBe(9);
    expect(nine.status).toBe("ok");
    expect(nine.net).toBeNull();
    expect(nine.notes.join(" ")).toMatch(/no net-of-control ratio: only 8 repetitions have a control ratio/);
    const eight = row(compareRuns(before(), a, { controls: ["ts"], minPairs: 8 }), "wasm-worker", TIME);
    expect(eight.net!.pairs).toBe(8);
  });

  it("says a controlled ratio row has no net when its only vouching control is judged on a difference", () => {
    // ts mean FPS has a zero in one repetition, which puts it on the difference; it does not move and is not flat.
    const c = compareRuns(before(), after({ valueFor: (m, n, r) => (m === "ts" && n === "mean FPS" && r === 4 ? 0 : undefined) }), { controls: ["ts"] });
    expect(row(c, "ts", "mean FPS").basis).toBe("difference");
    expect(row(c, "ts", "mean FPS").status).toBe("control-ok");
    const s = row(c, "wasm-worker", "mean FPS");
    expect(s.basis).toBe("ratio");
    expect(s.status).toBe("ok");
    expect(s.net).toBeNull();
    expect(s.notes.join(" ")).toMatch(/no net-of-control ratio: no vouching control has a per-repetition ratio/);
  });
});

describe("the drift band and thin controls", () => {
  it("voids on a control that improved, as well as one that got worse", () => {
    for (const k of [1.06, 1 / 1.06]) {
      const c = compareRuns(before(), after({ scale: { ts: k, "wasm-worker": 1.2 }, scaleOnly: TIME }), { controls: ["ts"] });
      expect(row(c, "ts", TIME).status, `${k}`).toBe("control-drift");
      expect(row(c, "wasm-worker", TIME).status, `${k}`).toBe("void");
    }
    // 1.04x is inside the band either way.
    for (const k of [1.04, 1 / 1.04]) expect(row(compareRuns(before(), after({ scale: { ts: k }, scaleOnly: TIME }), { controls: ["ts"] }), "wasm-worker", TIME).status).toBe("ok");
  });

  it("does not let a thin control that held still vouch", () => {
    const c = compareRuns(before(), after({ skipRep: 3, skipRepFor: "ts" }), { controls: ["ts"] });
    expect(row(c, "ts", TIME).pairs).toBe(REPS - 1);
    expect(row(c, "ts", TIME).status).toBe("thin");
    expect(row(c, "wasm-worker", TIME).status).toBe("uncontrolled");
  });

  it("judges the 1% low rate the same way: a worker that fell 20% against a steady control is controlled", () => {
    const c = compareRuns(before(), after({ scale: { "wasm-worker": 1.25 }, scaleOnly: LOW }), { controls: ["ts"] });
    const s = row(c, "wasm-worker", LOW);
    expect(s.status).toBe("ok");
    expect(s.ratio).toBeCloseTo(1 / 1.25, 1);
  });
});
