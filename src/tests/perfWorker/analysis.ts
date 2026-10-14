import { pairedRatio, summarize, verdict, type Summary } from "../perfCompare/stats";
import type { ModeName } from "./pageWorker";
import type { ModeRun, WorkerConfig } from "./runner";

/**
 * The worker-host benchmark's arithmetic: per-metric samples by mode and
 * repetition, their summaries, and paired ratios of each mode against the
 * shipped main-thread host ("wasm") and against TypeScript, with the
 * order-statistic interval `perfCompare/stats.ts` defines. Every number
 * the report prints comes from here.
 */
export interface Metric {
  group: "startup" | "raw" | "hosted" | "frames" | "memory" | "traffic";
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  mode: ModeName;
  values: number[];
  reps: number[];
  summary: Summary | null;
}

export interface Ratio {
  group: Metric["group"];
  scenario: string;
  throttle: string;
  metric: string;
  mode: ModeName;
  against: ModeName;
  ratio: number;
  ciLow: number | null;
  ciHigh: number | null;
  n: number;
  /** Repetitions dropped because the reference was 0 there (a count that
   *  is often zero), so `n` is the pairs that remained. */
  zeroReference: number;
  verdict: "higher" | "lower" | "equivalent" | "inconclusive";
}

type Pick = (r: ModeRun) => number | null | undefined;
interface Def { group: Metric["group"]; scenario: string; throttle: string; metric: string; unit: string; better: "lower" | "higher"; pick: Pick }

export function definitions(config: WorkerConfig): Def[] {
  const defs: Def[] = [];
  const steps = config.steps;
  const add = (d: Def) => defs.push(d);
  add({ group: "startup", scenario: "-", throttle: "1", metric: "cold start to mode ready", unit: "ms", better: "lower", pick: (r) => r.cold?.modeReadyMs });
  add({ group: "startup", scenario: "-", throttle: "1", metric: "warm start to mode ready", unit: "ms", better: "lower", pick: (r) => r.warm?.modeReadyMs });
  add({ group: "startup", scenario: "-", throttle: String(Math.max(...config.throttles)), metric: "cold start to mode ready", unit: "ms", better: "lower", pick: (r) => r.cold4x?.modeReadyMs });
  add({ group: "startup", scenario: "-", throttle: "1", metric: "bytes before mode ready (cold)", unit: "bytes", better: "lower", pick: (r) => r.cold?.bytesBeforeReady });
  for (const sc of config.scenarios) {
    const s = (r: ModeRun) => r.scenarios[sc];
    add({ group: "memory", scenario: sc, throttle: "1", metric: "main-thread JS heap", unit: "bytes", better: "lower", pick: (r) => s(r)?.memory.mainHeapUsedBytes });
    add({ group: "memory", scenario: sc, throttle: "1", metric: "JS heaps + WASM memory (main and worker)", unit: "bytes", better: "lower", pick: (r) => {
      const m = s(r)?.memory;
      if (!m) return null;
      // A sample only when every part of it was read: the worker's heap and
      // linear memory on the worker host, the page's linear memory on the
      // main-thread WASM hosts.
      if (r.mode === "wasm-worker" && (m.workerHeapUsedBytes === null || m.workerWasmBytes === null)) return null;
      if ((r.mode === "wasm" || r.mode === "wasm-frame") && m.mainWasmBytes === null) return null;
      return m.mainHeapUsedBytes + (m.workerHeapUsedBytes ?? 0) + (m.mainWasmBytes ?? 0) + (m.workerWasmBytes ?? 0);
    } });
    add({ group: "memory", scenario: sc, throttle: "1", metric: "browser process PSS", unit: "bytes", better: "lower", pick: (r) => s(r)?.memory.processPssBytes });
    for (const rate of config.throttles) {
      const t = String(rate);
      const h = (r: ModeRun) => s(r)?.hosted[t];
      const f = (r: ModeRun) => s(r)?.frames[t];
      add({ group: "raw", scenario: sc, throttle: t, metric: `bare engine, ${steps} steps`, unit: "ms", better: "lower", pick: (r) => s(r)?.raw?.[t]?.totalMs });
      add({ group: "hosted", scenario: sc, throttle: t, metric: `wall time, ${steps} steps`, unit: "ms", better: "lower", pick: (r) => h(r)?.wallMs });
      add({ group: "hosted", scenario: sc, throttle: t, metric: `main-thread time, ${steps} steps`, unit: "ms", better: "lower", pick: (r) => h(r)?.mainMs });
      add({ group: "hosted", scenario: sc, throttle: t, metric: "main-thread time per batch, p95", unit: "ms", better: "lower", pick: (r) => h(r)?.batchMainP95Ms });
      add({ group: "hosted", scenario: sc, throttle: t, metric: "main-thread time per batch, max", unit: "ms", better: "lower", pick: (r) => h(r)?.batchMainMaxMs });
      add({ group: "frames", scenario: sc, throttle: t, metric: "mean FPS", unit: "fps", better: "higher", pick: (r) => f(r)?.meanFps });
      add({ group: "frames", scenario: sc, throttle: t, metric: "1% low FPS", unit: "fps", better: "higher", pick: (r) => f(r)?.onePercentLowFps });
      add({ group: "frames", scenario: sc, throttle: t, metric: "frame time p95", unit: "ms", better: "lower", pick: (r) => f(r)?.p95Ms });
      add({ group: "frames", scenario: sc, throttle: t, metric: "frame time p99", unit: "ms", better: "lower", pick: (r) => f(r)?.p99Ms });
      add({ group: "frames", scenario: sc, throttle: t, metric: "sim minutes per second", unit: "min/s", better: "higher", pick: (r) => f(r)?.simMinutesPerSecond });
      add({ group: "frames", scenario: sc, throttle: t, metric: "frames over 200 ms (clamped)", unit: "count", better: "lower", pick: (r) => f(r)?.clampedFrames });
      add({ group: "frames", scenario: sc, throttle: t, metric: "main-thread blocking (long tasks past 50 ms)", unit: "ms", better: "lower", pick: (r) => f(r)?.blockingMs });
      add({ group: "frames", scenario: sc, throttle: t, metric: "command to visible frame, median", unit: "ms", better: "lower", pick: (r) => f(r)?.commandToFrameP50Ms });
      add({ group: "frames", scenario: sc, throttle: t, metric: "command to visible frame, p95", unit: "ms", better: "lower", pick: (r) => f(r)?.commandToFrameP95Ms });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "worker replies per second (frames)", unit: "1/s", better: "higher", pick: (r) => f(r)?.worker?.repliesPerSecond });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "messages per second, both ways (frames)", unit: "1/s", better: "lower", pick: (r) => f(r)?.worker?.messagesPerSecond });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "bytes received per second (frames)", unit: "bytes/s", better: "lower", pick: (r) => f(r)?.worker?.bytesPerSecond });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "reply apply time per second (frames)", unit: "ms/s", better: "lower", pick: (r) => f(r)?.worker?.applyMsPerSecond });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "command to ack, median (frames)", unit: "ms", better: "lower", pick: (r) => f(r)?.worker?.commandAckP50Ms });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "frame view bytes per reply (hosted)", unit: "bytes", better: "lower", pick: (r) => (h(r)?.worker ? h(r)!.worker!.frameBytes / h(r)!.worker!.replies : null) });
      add({ group: "traffic", scenario: sc, throttle: t, metric: "full-save bytes per merge (hosted)", unit: "bytes", better: "lower", pick: (r) => (h(r)?.worker?.merges ? h(r)!.worker!.mergeBytes / h(r)!.worker!.merges : null) });
      add({ group: "traffic", scenario: sc, throttle: t, metric: `full-save merges, ${steps} steps (hosted)`, unit: "count", better: "lower", pick: (r) => h(r)?.worker?.merges });
      add({ group: "traffic", scenario: sc, throttle: t, metric: `worker engine time, ${steps} steps (hosted)`, unit: "ms", better: "lower", pick: (r) => (h(r)?.worker ? h(r)!.worker!.workerOpsMs + h(r)!.worker!.workerReplyMs : null) });
      add({ group: "traffic", scenario: sc, throttle: t, metric: `main-thread merge time, ${steps} steps (hosted)`, unit: "ms", better: "lower", pick: (r) => h(r)?.worker?.mergeMs });
    }
  }
  return defs;
}

export function aggregate(config: WorkerConfig, runs: readonly ModeRun[]): Metric[] {
  const out: Metric[] = [];
  for (const d of definitions(config)) {
    for (const mode of config.modes) {
      const values: number[] = [];
      const reps: number[] = [];
      for (const r of runs) {
        if (r.mode !== mode || !r.ok) continue;
        const v = d.pick(r);
        if (v === null || v === undefined || !Number.isFinite(v)) continue;
        values.push(v);
        reps.push(r.rep);
      }
      if (d.group === "traffic" && values.length === 0) continue; // worker-only rows
      out.push({ group: d.group, scenario: d.scenario, throttle: d.throttle, metric: d.metric, unit: d.unit, better: d.better, mode, values, reps, summary: values.length ? summarize(values) : null });
    }
  }
  return out;
}

/** Paired ratios (mode / against) by repetition, for every mode against
 *  the shipped host and against TypeScript. */
export function ratios(metrics: readonly Metric[], modes: readonly ModeName[]): Ratio[] {
  const out: Ratio[] = [];
  const key = (m: Metric) => `${m.group}|${m.scenario}|${m.throttle}|${m.metric}`;
  const byKey = new Map<string, Map<ModeName, Metric>>();
  for (const m of metrics) {
    const k = key(m);
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k)!.set(m.mode, m);
  }
  for (const [, row] of byKey) {
    // Against the shipped host and TypeScript for every mode, and the worker
    // host against the coalesced host: the same sync changes on both, so
    // that ratio is the worker placement alone.
    for (const against of ["wasm", "ts", "wasm-frame"] as const) {
      const b = row.get(against);
      if (!b) continue;
      for (const mode of modes) {
        if (mode === against || (against === "wasm-frame" && mode !== "wasm-worker")) continue;
        const a = row.get(mode);
        if (!a) continue;
        const pairs: [number, number][] = [];
        let zeroReference = 0;
        a.reps.forEach((rep, i) => {
          const j = b.reps.indexOf(rep);
          if (j < 0) return;
          if (b.values[j] === 0) zeroReference++;
          else pairs.push([a.values[i], b.values[j]]);
        });
        if (pairs.length === 0) continue;
        const r = pairedRatio(pairs);
        out.push({ group: a.group, scenario: a.scenario, throttle: a.throttle, metric: a.metric, mode, against, ...r, zeroReference, verdict: verdict(r) });
      }
    }
  }
  return out;
}

/** Fail-closed checks over the runs: every run finished on its mode, no
 *  host error, every throttle held, and every mode and repetition started
 *  and ended each scenario's hosted run on the same state digest. */
export function validate(config: WorkerConfig, runs: readonly ModeRun[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (let rep = 0; rep < config.reps; rep++) {
    for (const mode of config.modes) {
      const r = runs.filter((x) => x.rep === rep && x.mode === mode);
      if (r.length !== 1) errors.push(`rep ${rep} ${mode}: ${r.length} runs (expected 1)`);
      else if (!r[0].ok) errors.push(`rep ${rep} ${mode}: failed: ${r[0].error}`);
    }
  }
  const versions = new Set(runs.map((r) => r.browserVersion).filter((v) => v !== null));
  if (versions.size > 1) errors.push(`the runs used different browser builds: ${[...versions].join(", ")}`);
  for (const r of runs) {
    if (!r.ok) continue;
    if (r.offline?.error) warnings.push(`rep ${r.rep} ${r.mode}: the offline measurement failed: ${r.offline.error}`);
    else if (r.offline && r.offline.onlineMode !== r.mode) warnings.push(`rep ${r.rep} ${r.mode}: the service-worker visit came up on ${r.offline.onlineMode}, not ${r.mode}`);
    for (const [name, sc] of Object.entries(r.scenarios)) {
      if (r.mode === "wasm-worker") {
        if (sc.memory.workerWasmBytes === null) warnings.push(`rep ${r.rep} wasm-worker ${name}: the worker's WASM memory was not reported, so its combined memory has no sample`);
        for (const [t, h] of Object.entries(sc.hosted)) if (!h.worker) errors.push(`rep ${r.rep} wasm-worker ${name} ${t}x hosted: no worker counters`);
        for (const [t, f] of Object.entries(sc.frames)) if (!f.worker) errors.push(`rep ${r.rep} wasm-worker ${name} ${t}x frames: no worker counters`);
      }
      if (r.mode === "wasm-worker" && sc.memory.workerHeapUsedBytes === null) warnings.push(`rep ${r.rep} wasm-worker ${name}: the worker's JS heap could not be read, so its combined memory has no sample`);
      const f1 = sc.frames["1"];
      if (f1 && f1.simMinutesPerSecond < 1) warnings.push(`rep ${r.rep} ${r.mode} ${name} 1x frames: ${f1.simMinutesPerSecond.toFixed(2)} sim-minutes per second, so the window ran almost no simulation (clamped frames: ${f1.clampedFrames})`);
    }
    if (r.pageErrors.length) warnings.push(`rep ${r.rep} ${r.mode}: ${r.pageErrors.length} page error(s): ${r.pageErrors.slice(0, 3).join(" | ")}`);
    for (const [name, sc] of Object.entries(r.scenarios)) {
      for (const [t, h] of Object.entries(sc.hosted)) if (h.hostErrorsAdded.length) errors.push(`rep ${r.rep} ${r.mode} ${name} ${t}x hosted: host errors ${h.hostErrorsAdded.join("; ")}`);
      for (const [t, f] of Object.entries(sc.frames)) {
        if (f.hostErrorsAdded.length) errors.push(`rep ${r.rep} ${r.mode} ${name} ${t}x frames: host errors ${f.hostErrorsAdded.join("; ")}`);
        if (f.commands === 0) warnings.push(`rep ${r.rep} ${r.mode} ${name} ${t}x frames: no command was timed`);
      }
    }
    if (r.cpuProbe) {
      for (const [k, ms] of Object.entries(r.cpuProbe.timed)) {
        const rate = Number(k.split(":").pop());
        if (ms / r.cpuProbe.unthrottledMs < rate / 2) errors.push(`rep ${r.rep} ${r.mode} ${k}: the CPU probe ran ${(ms / r.cpuProbe.unthrottledMs).toFixed(2)}x slower, under half the ${rate}x throttle`);
      }
    }
  }
  for (const sc of config.scenarios) {
    for (const rate of config.throttles) {
      const t = String(rate);
      const starts = new Set<string>();
      const ends = new Set<string>();
      for (const r of runs) {
        const h = r.ok ? r.scenarios[sc]?.hosted[t] : undefined;
        if (!h) continue;
        starts.add(h.startDigest);
        ends.add(h.endDigest);
      }
      // The bare engines ran the same steps from the same save.
      for (const r of runs) {
        const raw = r.ok ? r.scenarios[sc]?.raw?.[t] : undefined;
        if (raw) {
          starts.add(raw.startDigest);
          ends.add(raw.endDigest);
        }
      }
      if (starts.size > 1) errors.push(`${sc} ${t}x: the hosted runs started from ${starts.size} different states (${[...starts].join(", ")})`);
      if (ends.size > 1) errors.push(`${sc} ${t}x: the modes or repetitions ended in ${ends.size} different states (${[...ends].join(", ")}); the hosts must be deterministic and agree`);
    }
  }
  return { errors, warnings };
}
