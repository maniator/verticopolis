import { ratioOfMedians, summarize, verdict } from "./stats";
import type { Comparison, EngineName, MetricRow, ProcessRun } from "./types";
import type { ServedRequest } from "./server";

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

function picks(scenarios: readonly string[], throttles: readonly string[]): Pick[] {
  const out: Pick[] = [];
  const startup = (phase: "cold" | "warm") => {
    const p = (metric: string, unit: string, value: Pick["value"], engines?: EngineName[]) => out.push({ group: "startup", scenario: "-", throttle: "1", metric: `${phase} ${metric}`, unit, better: "lower", value, engines });
    p("game ready", "ms", (r) => r[phase]?.gameReadyMs);
    p("first frame after ready", "ms", (r) => r[phase]?.firstFrameMs);
    p("DOMContentLoaded", "ms", (r) => r[phase]?.domContentLoadedMs);
    p("load event", "ms", (r) => r[phase]?.loadEventMs);
    p("engine hosted", "ms", (r) => r[phase]?.engineHostedMs, ["wasm"]);
    p("wasm fetch (resource timing)", "ms", (r) => r[phase]?.wasmFetchMs, ["wasm"]);
    out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `${phase} bytes served before ready`, unit: "bytes", better: "lower", value: (r) => bytes(r[phase]?.servedBeforeReady) });
    out.push({ group: "transfer", scenario: "-", throttle: "1", metric: `${phase} bytes served total`, unit: "bytes", better: "lower", value: (r) => { const a = bytes(r[phase]?.servedBeforeReady); const b = bytes(r[phase]?.servedAfterReady); return a === null || b === null ? null : a + b; } });
  };
  startup("cold");
  startup("warm");
  out.push({ group: "transfer", scenario: "-", throttle: "1", metric: "first visit with service worker, bytes served", unit: "bytes", better: "lower", value: (r) => bytes(r.firstVisitWithServiceWorker?.served) });
  for (const [metric, key] of [["fetch", "fetchMs"], ["compile", "compileMs"], ["instantiate", "instantiateMs"], ["first Engine", "firstEngineMs"]] as const) {
    out.push({ group: "wasm-load", scenario: "-", throttle: "1", metric: `cold ${metric}`, unit: "ms", better: "lower", value: (r) => r.wasmCold?.[key], engines: ["ts"] });
  }
  for (const s of scenarios) {
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "adopt (load the save)", unit: "ms", better: "lower", value: (r) => r.scenarios[s]?.adoptMs });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "JS heap used", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.jsHeapUsedBytes });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "WASM linear memory", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.wasmMemoryBytes, engines: ["wasm"] });
    out.push({ group: "memory", scenario: s, throttle: "1", metric: "browser process PSS", unit: "bytes", better: "lower", value: (r) => r.scenarios[s]?.memory.processPssBytes });
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
          step("engine tick inside host", "ms", "lower", (r) => r.scenarios[s]?.hosted[t]?.attribution?.engineTickMs, ["wasm"]);
          step("engine exports read by host", "ms", "lower", (r) => r.scenarios[s]?.hosted[t]?.attribution?.engineExportMs, ["wasm"]);
          step("host JS sync", "ms", "lower", (r) => r.scenarios[s]?.hosted[t]?.attribution?.hostJsMs, ["wasm"]);
        }
      }
      const f = (metric: string, unit: string, better: "lower" | "higher", key: keyof NonNullable<ProcessRun["scenarios"][string]["frames"][string]>) =>
        out.push({ group: "frames", scenario: s, throttle: t, metric, unit, better, value: (r) => r.scenarios[s]?.frames[t]?.[key] as number | undefined });
      f("frame time median", "ms", "lower", "medianMs");
      f("frame time p95", "ms", "lower", "p95Ms");
      f("frame time p99", "ms", "lower", "p99Ms");
      f("mean FPS", "fps", "higher", "meanFps");
      f("1% low FPS", "fps", "higher", "onePercentLowFps");
      f("sim minutes per real second", "min/s", "higher", "simMinutesPerSecond");
      f("share of frame time in sim.tick", "ratio", "lower", "tickShare");
      f("share of frame time in ui.update", "ratio", "lower", "uiShare");
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

/** One comparison per metric both engines measured. `verdict` reads the
 *  ratio's interval against a 5% equivalence band (stats.verdict), in the
 *  metric's own direction: "faster"/"slower" for times and rates, "smaller"/
 *  "larger" for bytes. */
export function compareEngines(rows: readonly MetricRow[]): Comparison[] {
  const out: Comparison[] = [];
  const key = (r: MetricRow) => `${r.group}|${r.scenario}|${r.throttle}|${r.metric}`;
  const byKey = new Map<string, Partial<Record<EngineName, MetricRow>>>();
  for (const r of rows) (byKey.get(key(r)) ?? byKey.set(key(r), {}).get(key(r))!)[r.engine] = r;
  for (const pair of byKey.values()) {
    const ts = pair.ts;
    const wasm = pair.wasm;
    if (!ts?.summary || !wasm?.summary || ts.summary.median === 0) continue;
    const r = ratioOfMedians(wasm.values, ts.values);
    const v = verdict(r);
    let word: Comparison["verdict"] = v === "equivalent" ? "equivalent" : "inconclusive";
    if (v === "higher" || v === "lower") {
      const wasmBetter = (v === "lower") === (ts.better === "lower");
      if (ts.unit === "bytes") word = v === "lower" ? "wasm smaller" : "wasm larger";
      else if (ts.unit === "ratio") word = v === "lower" ? "wasm lower" : "wasm higher";
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
      n: { ts: ts.values.length, wasm: wasm.values.length },
    });
  }
  return out;
}
