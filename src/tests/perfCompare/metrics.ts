import { pairedRatio, summarize, verdict } from "./stats";
import type { Comparison, EngineName, MetricRow, ProcessRun } from "./types";
import type { ServedRequest } from "./server";
import { categorize, type Category } from "./bundle";

/**
 * Turn the process runs into one value per successful repetition for every
 * metric (MetricRow), then compare the two engines metric by metric
 * (Comparison). Failed runs contribute nothing here; the validation names
 * them, and every row records its own n.
 */

type Group = MetricRow["group"];
interface Pick {
  group: Group;
  scenario: string;
  throttle: string;
  metric: string;
  unit: string;
  better: "lower" | "higher";
  value: (r: ProcessRun) => number | null | undefined;
  /** Only meaningful for one engine (the WASM load steps, say). */
  engines?: EngineName[];
}

const bytes = (served: readonly ServedRequest[] | undefined): number | null => (served ? served.reduce((s, x) => s + x.bytes, 0) : null);

/** Served bytes of one build category (the same categories as the bundle
 *  table), so the before-ready and after-ready split reads per category. */
export function bytesIn(served: readonly ServedRequest[] | undefined, category: Category): number | null {
  if (!served) return null;
  return served.filter((x) => categorize(x.path.replace(/^\//, "")) === category).reduce((s, x) => s + x.bytes, 0);
}

const SERVED_CATEGORIES: Category[] = ["html", "app-js", "css", "wasm-glue", "wasm-binary", "audio-js", "audio-assets", "images", "service-worker", "other"];

/** A verdict needs this many samples per side; below it, "inconclusive". */
export const MIN_VERDICT_N = 6;

function picks(scenarios: readonly string[], throttles: readonly string[]): Pick[] {
  const out: Pick[] = [];
  const slow = String(Math.max(...throttles.map(Number)));
  const startup = (phase: "cold" | "warm" | "cold4x") => {
    const throttle = phase === "cold4x" ? slow : "1";
    const label = phase === "cold4x" ? "cold" : phase;
    const p = (metric: string, unit: string, value: Pick["value"], engines?: EngineName[]) => out.push({ group: "startup", scenario: "-", throttle, metric: `${label} ${metric}`, unit, better: "lower", value, engines });
    p("game ready", "ms", (r) => r[phase]?.gameReadyMs);
    p("first frame after ready", "ms", (r) => r[phase]?.firstFrameMs);
    p("DOMContentLoaded", "ms", (r) => r[phase]?.domContentLoadedMs);
    p("load event", "ms", (r) => r[phase]?.loadEventMs);
    p("engine hosted", "ms", (r) => r[phase]?.engineHostedMs, ["wasm"]);
    p("wasm fetch (resource timing)", "ms", (r) => r[phase]?.wasmFetchMs, ["wasm"]);
    p("wasm compile and instantiate (boot path)", "ms", (r) => r[phase]?.wasmInstantiateMs, ["wasm"]);
    if (phase === "cold4x") return;
    out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `${phase} bytes served before ready`, unit: "bytes", better: "lower", value: (r) => bytes(r[phase]?.servedBeforeReady) });
    out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `${phase} bytes served total`, unit: "bytes", better: "lower", value: (r) => { const a = bytes(r[phase]?.servedBeforeReady); const b = bytes(r[phase]?.servedAfterReady); return a === null || b === null ? null : a + b; } });
    if (phase !== "cold") return;
    for (const c of SERVED_CATEGORIES) {
      out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `cold before ready: ${c}`, unit: "bytes", better: "lower", value: (r) => bytesIn(r.cold?.servedBeforeReady, c) });
      out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `cold after ready: ${c}`, unit: "bytes", better: "lower", value: (r) => bytesIn(r.cold?.servedAfterReady, c) });
    }
  };
  startup("cold");
  startup("warm");
  if (slow !== "1") startup("cold4x");
  // Only visits whose service worker activated and that ran on the
  // requested engine count.
  out.push({ group: "transfer", scenario: "-", throttle: "1", metric: "first visit with service worker, bytes served", unit: "bytes", better: "lower", value: (r) => { const f = r.firstVisitWithServiceWorker; return f?.swActive && f.onlineEngineActive === r.engine ? bytes(f.served) : null; } });
  for (const [metric, key] of [["fetch", "fetchMs"], ["compile", "compileMs"], ["instantiate", "instantiateMs"], ["first Engine", "firstEngineMs"]] as const) {
    out.push({ group: "wasm-load", scenario: "-", throttle: "1", metric: `cold ${metric}`, unit: "ms", better: "lower", value: (r) => r.wasmCold?.[key], engines: ["ts"] });
  }
  for (const s of scenarios) {
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "adopt (load the save)", unit: "ms", better: "lower", value: (r) => r.scenarios[s]?.adoptMs });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "JS heap used", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.jsHeapUsedBytes });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "WASM linear memory", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.wasmMemoryBytes, engines: ["wasm"] });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "browser process PSS", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.processPssBytes });
    // The JS heap alone leaves the engine's linear memory out on WASM, so
    // the comparable figure is the sum.
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "JS heap + WASM linear memory", unit: "bytes", better: "lower", value: (r) => { const m = r.scenarios[s]?.memory; return m ? m.jsHeapUsedBytes + (m.wasmMemoryBytes ?? 0) : null; } });
    for (const t of throttles) {
      for (const mode of ["hosted", "raw"] as const) {
        const g: Group = mode === "hosted" ? "sim-hosted" : "sim-raw";
        const step = (metric: string, unit: string, better: "lower" | "higher", value: Pick["value"], engines?: EngineName[]) => out.push({ group: g, scenario: s, throttle: t, metric, unit, better, value, engines });
        step("total for fixed duration", "ms", "lower", (r) => r.scenarios[s]?.[mode][t]?.totalMs);
        step("step median", "ms", "lower", (r) => r.scenarios[s]?.[mode][t]?.stepMedianMs);
        step("step p95", "ms", "lower", (r) => r.scenarios[s]?.[mode][t]?.stepP95Ms);
        step("step p99", "ms", "lower", (r) => r.scenarios[s]?.[mode][t]?.stepP99Ms);
        if (mode === "raw") step("instance from save", "ms", "lower", (r) => r.scenarios[s]?.raw[t]?.loadMs);
        if (mode === "hosted") {
          // Shares of the wrapped attribution pass's own step time (the
          // wrappers cost time, so its milliseconds are not the timed pass's).
          const share = (key: "engineTickMs" | "engineExportMs" | "hostJsMs") => (r: ProcessRun) => { const a = r.scenarios[s]?.hosted[t]?.attribution; return a && a.wrappedTotalMs > 0 ? a[key] / a.wrappedTotalMs : null; };
          step("share in the engine's tick", "ratio", "lower", share("engineTickMs"), ["wasm"]);
          step("share in exports the host reads", "ratio", "lower", share("engineExportMs"), ["wasm"]);
          step("share in host JS sync", "ratio", "lower", share("hostJsMs"), ["wasm"]);
        }
      }
      for (const [group, slot] of [["frames", "frames"], ["frames-audio", "framesAudio"]] as const) {
        const f = (metric: string, unit: string, better: "lower" | "higher", key: keyof NonNullable<ProcessRun["scenarios"][string]["frames"][string]>) =>
          out.push({ group, scenario: s, throttle: t, metric, unit, better, value: (r) => r.scenarios[s]?.[slot]?.[t]?.[key] as number | undefined });
        f("frame time median", "ms", "lower", "medianMs");
        f("frame time p95", "ms", "lower", "p95Ms");
        f("frame time p99", "ms", "lower", "p99Ms");
        f("mean FPS", "fps", "higher", "meanFps");
        f("1% low FPS", "fps", "higher", "onePercentLowFps");
        f("sim minutes per real second", "min/s", "higher", "simMinutesPerSecond");
        f("share of frame time in sim.tick", "ratio", "lower", "tickShare");
        f("share of frame time in ui.update", "ratio", "lower", "uiShare");
        f("share of frame time elsewhere (render, compositor, GC, idle)", "ratio", "lower", "restShare");
        f("frames over 200 ms (game time clamped)", "frames", "lower", "clampedFrames");
      }
    }
  }
  return out;
}

export function aggregate(runs: readonly ProcessRun[], scenarios: readonly string[], throttles: readonly number[]): MetricRow[] {
  const rows: MetricRow[] = [];
  const good = runs.filter((r) => r.ok);
  for (const p of picks(scenarios, throttles.map(String))) {
    for (const engine of p.engines ?? (["ts", "wasm"] as EngineName[])) {
      const values: number[] = [];
      const reps: number[] = [];
      for (const r of good) {
        if (r.engine !== engine) continue;
        const v = p.value(r);
        if (typeof v === "number" && Number.isFinite(v)) {
          values.push(v);
          reps.push(r.rep);
        }
      }
      rows.push({ group: p.group, scenario: p.scenario, throttle: p.throttle, metric: p.metric, unit: p.unit, better: p.better, engine, values, reps, summary: values.length ? summarize(values) : null });
    }
  }
  return rows;
}

/** One comparison per metric both engines measured: the median of the
 *  per-repetition WASM / TypeScript ratios with its order-statistic
 *  interval, and a verdict only from {@link MIN_VERDICT_N} pairs up. `verdict` reads the
 *  ratio's interval against a 5% equivalence band (stats.verdict), in the
 *  metric's own direction: "faster"/"slower" for times and rates, "smaller"/
 *  "larger" for bytes. */
export function compareEngines(rows: readonly MetricRow[], skipped: string[] = []): Comparison[] {
  const out: Comparison[] = [];
  const key = (r: MetricRow) => `${r.group}|${r.scenario}|${r.throttle}|${r.metric}`;
  const byKey = new Map<string, Partial<Record<EngineName, MetricRow>>>();
  for (const r of rows) (byKey.get(key(r)) ?? byKey.set(key(r), {}).get(key(r))!)[r.engine] = r;
  for (const pair of byKey.values()) {
    const ts = pair.ts;
    const wasm = pair.wasm;
    if (!ts?.summary || !wasm?.summary) continue;
    if (ts.summary.median === 0) {
      // No ratio against zero (a byte count of 0, no clamped frames).
      skipped.push(`${ts.group} ${ts.scenario} ${ts.throttle}x ${ts.metric}: TypeScript median is 0, WASM median ${wasm.summary.median}`);
      continue;
    }
    // Pair the two engines by repetition; a repetition missing on either
    // side drops out of the pairs (its absence is warned about elsewhere).
    const tsByRep = new Map(ts.reps.map((rep, i) => [rep, ts.values[i]]));
    const pairs: [number, number][] = [];
    wasm.reps.forEach((rep, i) => {
      const b = tsByRep.get(rep);
      if (b !== undefined) pairs.push([wasm.values[i], b]);
    });
    if (pairs.length === 0) {
      skipped.push(`${ts.group} ${ts.scenario} ${ts.throttle}x ${ts.metric}: no repetition has both engines`);
      continue;
    }
    // A zero on the TypeScript side has no ratio. Dropping those pairs
    // would keep only the repetitions where TypeScript did worst, so the
    // whole metric goes without a ratio instead (reported per engine).
    if (pairs.some(([, b]) => b === 0)) {
      skipped.push(`${ts.group} ${ts.scenario} ${ts.throttle}x ${ts.metric}: a TypeScript repetition is 0, so no ratio`);
      continue;
    }
    const r = pairedRatio(pairs);
    const v = r.n < MIN_VERDICT_N ? "inconclusive" : verdict(r);
    let word: Comparison["verdict"] = v === "equivalent" ? "equivalent" : "inconclusive";
    if (v === "higher" || v === "lower") {
      const wasmBetter = (v === "lower") === (ts.better === "lower");
      if (ts.unit === "bytes") word = v === "lower" ? "wasm smaller" : "wasm larger";
      else if (ts.unit === "ratio") word = v === "lower" ? "wasm lower" : "wasm higher";
      else if (ts.unit === "frames") word = v === "lower" ? "wasm fewer" : "wasm more";
      else word = wasmBetter ? "wasm faster" : "wasm slower";
    }
    out.push({
      group: ts.group,
      scenario: ts.scenario,
      throttle: ts.throttle,
      metric: ts.metric,
      unit: ts.unit,
      better: ts.better,
      tsMedian: ts.summary.median,
      wasmMedian: wasm.summary.median,
      ratio: r.ratio,
      ciLow: r.ciLow,
      ciHigh: r.ciHigh,
      verdict: word,
      n: { ts: ts.values.length, wasm: wasm.values.length, pairs: r.n },
    });
  }
  return out;
}

/** A warning for every metric with fewer values than successful processes
 *  of its engine (a missing first frame, a resource that never loaded), so
 *  no sample leaves a row unnoticed. */
export function missingSamples(rows: readonly MetricRow[], runs: readonly ProcessRun[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const expected = runs.filter((x) => x.ok && x.engine === r.engine).length;
    if (r.values.length < expected) out.push(`${r.group} ${r.scenario} ${r.throttle}x ${r.metric} (${r.engine}): ${r.values.length} of ${expected} processes produced a value`);
  }
  return out;
}
