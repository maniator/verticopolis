import { aboveFloor, withinCeiling } from "./perfBudget";

/**
 * The committed baselines of the E5-S0 perf gate (`e2e/perf.spec.ts`), one per
 * engine (#900). `e2e/perf/baseline.json` holds an entry for each engine the
 * gate has a baseline for, under the engine's name, and each engine's run is
 * held to its own entry. `update-perf-baseline.yml` mints one engine at a
 * time, and the other entries stay as committed.
 */

export type PerfEngine = "ts" | "wasm";
export const PERF_ENGINES: readonly PerfEngine[] = ["ts", "wasm"];

/** One run's three measurements, as the spec records them. */
export interface PerfMeasurement {
  uiUpdate: { medianMs: number; p95Ms: number; meanMs: number; n: number; batch: number };
  simSpeed: { simMinutesPerRealSecond: number; cpuThrottle: number; speed: number; windowMs: number; windows: number };
}

/** An engine's entry: the measurement minted on CI, and the engine it ran. */
export interface EngineBaseline extends PerfMeasurement {
  engine: PerfEngine;
}

export type BaselineFile = Partial<Record<PerfEngine, EngineBaseline>>;

/** The harness parameters a measurement records, which a baseline must share
 *  with the run it is compared against. */
export interface PerfHarness {
  n: number;
  batch: number;
  cpuThrottle: number;
  speed: number;
  windowMs: number;
  windows: number;
}

/**
 * Tolerances. (A) median may rise at most 5% and p95 at most 10% (the plan's
 * numbers). (B) may fall at most 10% below baseline: it is the noisiest signal
 * (a throttled end-to-end rate), so the floor carries runner-jitter headroom
 * wider than (A)'s, while a genuine catch-up-spiral regression tanks B far more
 * than 10% and is still caught. Locally (a noisier shared sandbox than CI) the
 * three metrics held to ~1% / ~5% / ~4% run-to-run, comfortably inside these.
 * They were set on the TypeScript engine; the WASM engine's entry uses the
 * same values until an A/A calibration of M7 replaces them (#900).
 */
export const PERF_TOLERANCES = { uiMedian: 1.05, uiP95: 1.1, simSpeedFloor: 0.9 } as const;

/** Read the committed file. It refuses the shape from before #900 (one
 *  baseline, no engine), a key that names no engine, and an entry whose
 *  recorded engine is not its key, so a file edited by hand cannot hold one
 *  engine to another's numbers. */
export function parseBaselineFile(text: string): BaselineFile {
  const raw = JSON.parse(text) as Record<string, unknown> | null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the perf baseline must be an object keyed by engine");
  if ("uiUpdate" in raw || "simSpeed" in raw) throw new Error(`the perf baseline has no engine keys; put its entry under "ts" or "wasm" with that engine recorded`);
  const file: BaselineFile = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!(PERF_ENGINES as readonly string[]).includes(key)) throw new Error(`the perf baseline has an entry for "${key}", which is not an engine (${PERF_ENGINES.join(", ")})`);
    const recorded = (entry as { engine?: unknown } | null)?.engine;
    if (recorded !== key) throw new Error(`the perf baseline's "${key}" entry records the engine ${JSON.stringify(recorded)}; re-mint it with [update-perf-baseline:${key}]`);
    file[key as PerfEngine] = entry as EngineBaseline;
  }
  return file;
}

/** The file with `entry` under its engine. Every other entry is kept as it
 *  was, and the keys stay in engine order so a mint diffs one entry only. */
export function withBaseline(file: BaselineFile, entry: EngineBaseline): BaselineFile {
  const next: BaselineFile = {};
  for (const e of PERF_ENGINES) {
    const value = e === entry.engine ? entry : file[e];
    if (value) next[e] = value;
  }
  return next;
}

export function formatBaselineFile(file: BaselineFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/** The harness parameters a measurement was taken with. */
export function harnessOf(m: PerfMeasurement): PerfHarness {
  return { n: m.uiUpdate.n, batch: m.uiUpdate.batch, cpuThrottle: m.simSpeed.cpuThrottle, speed: m.simSpeed.speed, windowMs: m.simSpeed.windowMs, windows: m.simSpeed.windows };
}

export interface BudgetCheck {
  label: string;
  ok: boolean;
  message: string;
}

/** The gate's three budgets for a run against a baseline. The comparisons go
 *  through withinCeiling/aboveFloor (src/tests/perfBudget.ts), which widen
 *  the computed budget by a documented 1e-9 relative epsilon: a strict <=
 *  against `baseline * tol` once failed a docs-only diff by 4e-13 ms of
 *  float-representation noise at the exact boundary (AUD-009). The effective
 *  tolerances stay 5%/10%. */
export function budgetChecks(run: PerfMeasurement, baseline: PerfMeasurement, tol = PERF_TOLERANCES): BudgetCheck[] {
  const { uiUpdate: u, simSpeed: s } = run;
  const { uiUpdate: bu, simSpeed: bs } = baseline;
  return [
    {
      label: "ui.update median",
      ok: withinCeiling(u.medianMs, bu.medianMs, tol.uiMedian),
      message: `ui.update median ${u.medianMs.toFixed(4)}ms vs baseline ${bu.medianMs.toFixed(4)}ms (x${tol.uiMedian})`,
    },
    {
      label: "ui.update p95",
      ok: withinCeiling(u.p95Ms, bu.p95Ms, tol.uiP95),
      message: `ui.update p95 ${u.p95Ms.toFixed(4)}ms vs baseline ${bu.p95Ms.toFixed(4)}ms (x${tol.uiP95})`,
    },
    {
      label: "sim speed",
      ok: aboveFloor(s.simMinutesPerRealSecond, bs.simMinutesPerRealSecond, tol.simSpeedFloor),
      message: `sim-min/s ${s.simMinutesPerRealSecond.toFixed(2)} vs baseline ${bs.simMinutesPerRealSecond.toFixed(2)} (x${tol.simSpeedFloor})`,
    },
  ];
}

/** The gate's blocking checks for a measured engine. The WASM sim-speed probe is
 *  still reported, but it is intentionally not a gate until the cloud probe is
 *  calibrated away from the 0 / ~0.48 bimodal outcome. */
export function gateChecks(run: PerfMeasurement, baseline: PerfMeasurement, engine: PerfEngine, tol = PERF_TOLERANCES): BudgetCheck[] {
  const checks = budgetChecks(run, baseline, tol);
  return engine === "wasm" ? checks.filter((check) => check.label !== "sim speed") : checks;
}

/** M7's reading of a WASM run against the TypeScript engine's baseline (the
 *  Performance row: a 5,000+ population tower within the TypeScript engine's
 *  own `npm run perf` baseline). It is printed on every CI run and read on the
 *  release candidate's run; it fails nothing. */
export function crossEngineLines(run: PerfMeasurement, file: BaselineFile): string[] {
  const ts = file.ts;
  const head = "M7, the WASM run against the TypeScript baseline (reported, gates nothing):";
  if (!ts) return [`${head} no TypeScript entry to read against`];
  const a = harnessOf(run);
  const b = harnessOf(ts);
  if (JSON.stringify(a) !== JSON.stringify(b)) return [`${head} not comparable, the TypeScript entry was minted with ${JSON.stringify(b)} and this run used ${JSON.stringify(a)}`];
  return [head, ...budgetChecks(run, ts).map((c) => `  ${c.ok ? "within" : "outside"}: ${c.message}`)];
}

/** After a mint of `engine` (update-perf-baseline.yml): what is wrong with
 *  the new file against the committed one, or null. The minted entry must be
 *  there, and every other engine's entry must be the committed one. */
export function mintProblem(before: BaselineFile, after: BaselineFile, engine: PerfEngine): string | null {
  if (!after[engine]) return `the capture wrote no "${engine}" entry`;
  const changed = PERF_ENGINES.filter((e) => e !== engine && JSON.stringify(before[e] ?? null) !== JSON.stringify(after[e] ?? null));
  return changed.length ? `minting "${engine}" changed the committed ${changed.map((e) => `"${e}"`).join(" and ")} entry` : null;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** A mint's entry from its passes (update-perf-baseline.yml runs the spec
 *  several times): each measured value is the median across the passes, so
 *  one slow or fast pass does not set the baseline. The passes must all be
 *  the minted engine's and share the harness parameters, and a sim speed of
 *  zero is refused, since a floor of zero would pass any run. */
export function entryFromPasses(engine: PerfEngine, passes: readonly EngineBaseline[]): EngineBaseline {
  if (passes.length === 0) throw new Error(`no ${engine} passes to mint from`);
  const other = passes.find((p) => p.engine !== engine);
  if (other) throw new Error(`a ${engine} mint got a pass that recorded the engine ${JSON.stringify(other.engine)}`);
  const harness = JSON.stringify(harnessOf(passes[0]));
  const odd = passes.find((p) => JSON.stringify(harnessOf(p)) !== harness);
  if (odd) throw new Error(`the ${engine} passes used different harness parameters (${harness} and ${JSON.stringify(harnessOf(odd))})`);
  const med = (f: (p: PerfMeasurement) => number): number => median(passes.map(f));
  const [first] = passes;
  const entry: EngineBaseline = {
    engine,
    uiUpdate: { ...first.uiUpdate, medianMs: med((p) => p.uiUpdate.medianMs), p95Ms: med((p) => p.uiUpdate.p95Ms), meanMs: med((p) => p.uiUpdate.meanMs) },
    simSpeed: { ...first.simSpeed, simMinutesPerRealSecond: med((p) => p.simSpeed.simMinutesPerRealSecond) },
  };
  const values = [entry.uiUpdate.medianMs, entry.uiUpdate.p95Ms, entry.uiUpdate.meanMs, entry.simSpeed.simMinutesPerRealSecond];
  if (!values.every((v) => Number.isFinite(v) && v > 0)) throw new Error(`the ${engine} passes give a median that is zero or not a number (${values.join(", ")}); a baseline of zero cannot gate`);
  return entry;
}

/** One budget's A/A reading: the passes of a mint held to the entry made
 *  from them, as the gate holds a run to its baseline. */
export interface PassSpread {
  label: string;
  tolerance: number;
  /** The pass furthest toward failing, as a ratio of the entry's value. */
  worst: number;
  /** Passes the gate would have failed against their own median. */
  outside: number;
  passes: number;
}

/** How a mint's passes spread around their entry: the A/A reading M7's
 *  calibration needs (#900, the plan's section 5.3), from one CI run. */
export function passSpread(passes: readonly PerfMeasurement[], entry: PerfMeasurement, tol = PERF_TOLERANCES): PassSpread[] {
  const ratios = (p: PerfMeasurement): number[] => [p.uiUpdate.medianMs / entry.uiUpdate.medianMs, p.uiUpdate.p95Ms / entry.uiUpdate.p95Ms, p.simSpeed.simMinutesPerRealSecond / entry.simSpeed.simMinutesPerRealSecond];
  const tolerances = [tol.uiMedian, tol.uiP95, tol.simSpeedFloor];
  const checks = passes.map((p) => budgetChecks(p, entry, tol));
  return budgetChecks(entry, entry, tol).map((c, i) => {
    const rs = passes.map((p) => ratios(p)[i]);
    return {
      label: c.label,
      tolerance: tolerances[i],
      // The speed budget is a floor, so its worst pass is the slowest.
      worst: i === 2 ? Math.min(...rs) : Math.max(...rs),
      outside: checks.filter((cs) => !cs[i].ok).length,
      passes: passes.length,
    };
  });
}

/** The spread as a Markdown table, for the mint run's summary. */
export function spreadLines(engine: PerfEngine, spread: readonly PassSpread[]): string[] {
  return [
    `A/A reading of the ${engine} mint (each pass against the median of all ${spread[0]?.passes ?? 0}):`,
    "",
    "| Budget | Tolerance | Worst pass | Passes outside |",
    "| --- | --- | --- | --- |",
    ...spread.map((s) => `| ${s.label} | x${s.tolerance} | x${s.worst.toFixed(3)} | ${s.outside} of ${s.passes} |`),
  ];
}
