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

export interface PerfTolerances {
  uiMedian: number;
  uiP95: number;
  simSpeedFloor: number;
}

/**
 * Tolerances. (A) median may rise at most 5% and p95 at most 10% (the plan's
 * numbers). (B) may fall at most 10% below baseline: it is the noisiest signal
 * (a throttled end-to-end rate), so the floor carries runner-jitter headroom
 * wider than (A)'s, while a genuine catch-up-spiral regression tanks B far more
 * than 10% and is still caught. Locally (a noisier shared sandbox than CI) the
 * three metrics held to ~1% / ~5% / ~4% run-to-run, comfortably inside these.
 * They were set on the TypeScript engine, and they are the approved gate for
 * it. The WASM engine's run is read against them and gates nothing until an
 * A/A calibration of M7 under the δ cap sets the values it is held to (#900).
 */
export const PERF_TOLERANCES: Readonly<PerfTolerances> = { uiMedian: 1.05, uiP95: 1.1, simSpeedFloor: 0.9 };

export type BudgetLabel = "ui.update median" | "ui.update p95" | "sim speed";
export const BUDGET_LABELS: readonly BudgetLabel[] = ["ui.update median", "ui.update p95", "sim speed"];

/**
 * The budgets that block each engine's run against its own entry; the rest
 * are printed and gate nothing. The TypeScript engine's three are the approved
 * E5-S0 gate. On the WASM engine the speed budget prints only (Copilot's
 * 6f8a492); whether any WASM budget blocks before M7's calibration is the
 * owner's call, pending (#900), and this is the one place it is set. CI's
 * first within-run reading of five WASM passes (the mint at eb44215) put a
 * ui.update pass at x1.209 of the median against today's x1.05, and the speed
 * passes at x0.963 or better against x0.9.
 */
export const BLOCKING: Readonly<Record<PerfEngine, readonly BudgetLabel[]>> = {
  ts: BUDGET_LABELS,
  wasm: ["ui.update median", "ui.update p95"],
};

/** A mint takes at least this many passes, so one slow or fast pass cannot
 *  set the baseline (W8, the plan's "at least five A/A passes"). */
export const MIN_MINT_PASSES = 5;

const UI_FIELDS = ["n", "batch", "medianMs", "p95Ms", "meanMs"] as const;
const SPEED_FIELDS = ["simMinutesPerRealSecond", "cpuThrottle", "speed", "windowMs", "windows"] as const;

/** The values a run reads, as against the harness parameters it records. */
const READINGS: ReadonlySet<string> = new Set(["medianMs", "p95Ms", "meanMs", "simMinutesPerRealSecond"]);

/** What is wrong with one recorded measurement, or null: both parts must be
 *  there and every value a finite number above zero. A zero would make its
 *  budget pass any run, so it cannot stand as a baseline. One pass of a mint
 *  may read zero (the speed probe can), so `pass` lets the readings be zero
 *  and still requires the harness parameters above zero. */
export function measurementProblem(value: unknown, o: { pass?: boolean } = {}): string | null {
  const m = value as Partial<Record<"uiUpdate" | "simSpeed", Record<string, unknown>>> | null;
  if (m === null || typeof m !== "object") return "it is not an object";
  const parts = [
    ["uiUpdate", UI_FIELDS],
    ["simSpeed", SPEED_FIELDS],
  ] as const;
  for (const [part, fields] of parts) {
    const p = m[part];
    if (p === null || typeof p !== "object") return `it has no ${part}`;
    for (const f of fields) {
      const v = p[f];
      const floorOk = typeof v === "number" && (v > 0 || (o.pass === true && READINGS.has(f) && v === 0));
      if (!floorOk || !Number.isFinite(v)) return `its ${part}.${f} is ${JSON.stringify(v ?? null)}, and ${o.pass ? "a pass's readings must be numbers of zero or more and its harness parameters above zero" : "every value must be a number above zero"}`;
    }
  }
  return null;
}

/** Read the committed file. It refuses the shape from before #900 (one
 *  baseline, no engine), a key that names no engine, an entry whose recorded
 *  engine is not its key, and an entry with a missing, zero or non-numeric
 *  value, so a file edited by hand cannot hold one engine to another's
 *  numbers or to a floor that passes anything. */
export function parseBaselineFile(text: string): BaselineFile {
  const raw = JSON.parse(text) as Record<string, unknown> | null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("the perf baseline must be an object keyed by engine");
  if ("uiUpdate" in raw || "simSpeed" in raw) throw new Error(`the perf baseline has no engine keys; put its entry under "ts" or "wasm" with that engine recorded`);
  const file: BaselineFile = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!(PERF_ENGINES as readonly string[]).includes(key)) throw new Error(`the perf baseline has an entry for "${key}", which is not an engine (${PERF_ENGINES.join(", ")})`);
    const recorded = (entry as { engine?: unknown } | null)?.engine;
    if (recorded === undefined) throw new Error(`the perf baseline's "${key}" entry records no engine; re-mint it with [update-perf-baseline:${key}]`);
    if (recorded !== key) throw new Error(`the perf baseline's "${key}" entry records the engine ${JSON.stringify(recorded)}; re-mint it with [update-perf-baseline:${key}]`);
    const problem = measurementProblem(entry);
    if (problem) throw new Error(`the perf baseline's "${key}" entry cannot gate: ${problem}; remove it and re-mint it with [update-perf-baseline:${key}]`);
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
  label: BudgetLabel;
  ok: boolean;
  message: string;
}

/** The gate's three budgets for a run against a baseline. The comparisons go
 *  through withinCeiling/aboveFloor (src/tests/perfBudget.ts), which widen
 *  the computed budget by a documented 1e-9 relative epsilon: a strict <=
 *  against `baseline * tol` once failed a docs-only diff by 4e-13 ms of
 *  float-representation noise at the exact boundary (AUD-009). The effective
 *  tolerances stay 5%/10%. */
export function budgetChecks(run: PerfMeasurement, baseline: PerfMeasurement, tol: PerfTolerances = PERF_TOLERANCES): BudgetCheck[] {
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

/** The budgets that fail an engine's run against its own entry (BLOCKING). */
export function gateChecks(run: PerfMeasurement, baseline: PerfMeasurement, engine: PerfEngine, tol: PerfTolerances = PERF_TOLERANCES): BudgetCheck[] {
  return budgetChecks(run, baseline, tol).filter((c) => BLOCKING[engine].includes(c.label));
}

/** Whether some budget of an engine prints without blocking. */
export function hasReportedBudgets(engine: PerfEngine): boolean {
  return BUDGET_LABELS.some((l) => !BLOCKING[engine].includes(l));
}

/** An engine's run against its own entry as printed lines, each budget marked
 *  blocking or reported. A reported budget's line is its whole reading. */
export function ownEntryLines(engine: PerfEngine, run: PerfMeasurement, baseline: PerfMeasurement): string[] {
  return [
    `perf ${engine} against its own entry (a reported budget gates nothing until M7's calibration):`,
    ...budgetChecks(run, baseline).map((c) => `  ${c.ok ? "within" : "outside"} (${BLOCKING[engine].includes(c.label) ? "blocking" : "reported"}): ${c.message}`),
  ];
}

/** M7's reading of a WASM run against the TypeScript engine's baseline (the
 *  Performance row: a 5,000+ population tower within the TypeScript engine's
 *  own `npm run perf` baseline). It is printed on every CI run and read on the
 *  release candidate's run; it fails nothing. It is provisional on two
 *  counts, which the printed note names: the tolerances are the TypeScript
 *  gate's and are not yet calibrated under the δ cap, and the two entries measure
 *  towers set up differently (`buildToStar` builds the TypeScript tower in
 *  place and the WASM one through a loaded save, which #905 measures at about
 *  twice the `stats()` cost, and their clocks sit at different times). */
export function crossEngineLines(run: PerfMeasurement, file: BaselineFile): string[] {
  const ts = file.ts;
  const head = "M7, the WASM run against the TypeScript baseline (provisional, reported, gates nothing):";
  if (!ts) return [`${head} no TypeScript entry to read against`];
  const a = harnessOf(run);
  const b = harnessOf(ts);
  if (JSON.stringify(a) !== JSON.stringify(b)) return [`${head} not comparable, the TypeScript entry was minted with ${JSON.stringify(b)} and this run used ${JSON.stringify(a)}`];
  return [
    head,
    "  note: tolerances not yet calibrated under the δ cap; the TypeScript tower is built in place and the WASM tower through a loaded save (#905), at a different clock time",
    ...budgetChecks(run, ts).map((c) => `  ${c.ok ? "within" : "outside"}: ${c.message}`),
  ];
}

/** What a run of the spec does with its measurement against the committed
 *  file (a pass of a mint records itself before this, for the mint script).
 *  A local capture writes the engine's entry; on CI a missing entry fails, so
 *  deleting an entry cannot silently switch the gate off; off CI nothing is
 *  compared or written, since local hardware is never the arbiter. */
export type RunAction = "capture" | "fail-missing" | "report-missing" | "report" | "gate";

export function runAction(o: { capture: boolean; enforce: boolean; hasEntry: boolean }): RunAction {
  if (o.capture) return "capture";
  if (!o.hasEntry) return o.enforce ? "fail-missing" : "report-missing";
  return o.enforce ? "gate" : "report";
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
 *  one slow or fast pass does not set the baseline, and the result does not
 *  depend on the order the passes are read in. Every pass must be a complete
 *  measurement of the minted engine with the same harness parameters, and a
 *  median of zero is refused, since a floor of zero would pass any run. */
export function entryFromPasses(engine: PerfEngine, passes: readonly EngineBaseline[]): EngineBaseline {
  if (passes.length === 0) throw new Error(`no ${engine} passes to mint from`);
  const other = passes.find((p) => p.engine !== engine);
  if (other) throw new Error(`a ${engine} mint got a pass that recorded the engine ${JSON.stringify(other.engine)}`);
  for (const [i, p] of passes.entries()) {
    const problem = measurementProblem(p, { pass: true });
    if (problem) throw new Error(`${engine} pass ${i + 1} is not a complete measurement: ${problem}`);
  }
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
  const problem = measurementProblem(entry);
  if (problem) throw new Error(`the ${engine} passes give a median entry that cannot gate: ${problem}`);
  return entry;
}

/** One budget's within-run reading: the passes of a mint held to the entry
 *  made from them, as the gate holds a run to its baseline. */
export interface PassSpread {
  label: string;
  tolerance: number;
  /** The pass furthest toward failing, as a ratio of the entry's value. */
  worst: number;
  /** Passes the gate would have failed against their own median. */
  outside: number;
  passes: number;
}

/** How a mint's passes spread around their entry. The passes share one job,
 *  one runner and one browser, and each is held to a median it is part of,
 *  so this is a within-run spread: it leaves out the runner-to-runner
 *  variance a later PR's run meets. M7's calibration (#900, the plan's
 *  section 5.3) also reads the `perf <engine>:` lines every CI run prints, or
 *  several mints. */
export function passSpread(passes: readonly PerfMeasurement[], entry: PerfMeasurement, tol: PerfTolerances = PERF_TOLERANCES): PassSpread[] {
  const ratios = (p: PerfMeasurement): number[] => [p.uiUpdate.medianMs / entry.uiUpdate.medianMs, p.uiUpdate.p95Ms / entry.uiUpdate.p95Ms, p.simSpeed.simMinutesPerRealSecond / entry.simSpeed.simMinutesPerRealSecond];
  const tolerances = [tol.uiMedian, tol.uiP95, tol.simSpeedFloor];
  const checks = passes.map((p) => budgetChecks(p, entry, tol));
  return budgetChecks(entry, entry, tol).map((c, i): PassSpread => {
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

/** The spread as a Markdown table, for the mint run's summary and commit. */
export function spreadLines(engine: PerfEngine, spread: readonly PassSpread[]): string[] {
  return [
    `Within-run spread of the ${engine} mint (each pass against the median of all ${spread[0]?.passes ?? 0}, one runner):`,
    "",
    "| Budget | Tolerance | Worst pass | Passes outside |",
    "| --- | --- | --- | --- |",
    ...spread.map((s) => `| ${s.label} | x${s.tolerance} | x${s.worst.toFixed(3)} | ${s.outside} of ${s.passes} |`),
  ];
}

/** The passes themselves as a Markdown table, printed before anything can
 *  refuse them so a refused mint still shows what it measured. */
export function passLines(engine: PerfEngine, passes: readonly unknown[]): string[] {
  const cell = (v: unknown): string => (typeof v === "number" ? String(v) : JSON.stringify(v ?? null));
  return [
    `The ${engine} passes:`,
    "",
    "| Pass | ui.update median ms | ui.update p95 ms | sim-min/s |",
    "| --- | --- | --- | --- |",
    ...passes.map((raw, i) => {
      const p = raw as Partial<PerfMeasurement> | null;
      return `| ${i + 1} | ${cell(p?.uiUpdate?.medianMs)} | ${cell(p?.uiUpdate?.p95Ms)} | ${cell(p?.simSpeed?.simMinutesPerRealSecond)} |`;
    }),
  ];
}
