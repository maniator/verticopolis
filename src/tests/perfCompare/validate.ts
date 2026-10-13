import type { NodeCheck } from "./nodeCheck";
import type { CompareConfig, EngineName, ProcessRun, StepSummary } from "./types";

/**
 * The comparison's correctness rules (issue #972). A run that breaks one is
 * reported as an error and the command exits non-zero; nothing is dropped
 * from the results to make the numbers look comparable.
 *
 * 1. Every configured repetition of both engines produced a process run, and
 *    each failed one is named with its error.
 * 2. The requested engine was the one running: a WASM process whose live
 *    tower ended up on the TypeScript engine (a fallback) is an error, never
 *    a WASM sample. The same holds for every simulation and frame sample.
 * 3. Every sample of a scenario started from the same state and ended in the
 *    same state (same digest), across engines, repetitions, throttles and
 *    hosting modes, since they ran the same ticks from the same save.
 * 4. The Node check (state and crowd conformance digests) matched.
 * 5. The two configurations are comparable: one browser build, one viewport,
 *    one isolation state, at least one good process per engine.
 */
export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const ENGINES: EngineName[] = ["ts", "wasm"];

export function validateResults(config: CompareConfig, runs: readonly ProcessRun[], nodeChecks: readonly NodeCheck[]): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let rep = 0; rep < config.reps; rep++) {
    for (const engine of ENGINES) {
      const r = runs.filter((x) => x.rep === rep && x.engine === engine);
      if (r.length === 0) errors.push(`rep ${rep} ${engine}: no process run recorded`);
      if (r.length > 1) errors.push(`rep ${rep} ${engine}: ${r.length} process runs recorded, expected one`);
    }
  }
  for (const r of runs) if (!r.ok) errors.push(`rep ${r.rep} ${r.engine}: failed: ${r.error ?? "unknown error"}`);

  const good = runs.filter((r) => r.ok);
  for (const r of good) {
    const tag = `rep ${r.rep} ${r.engine}`;
    for (const [phase, s] of [["cold start", r.cold], ["warm start", r.warm]] as const) {
      if (!s) errors.push(`${tag}: no ${phase} sample`);
      else if (s.engineActive !== r.engine) {
        errors.push(r.engine === "wasm" ? `${tag}: ${phase}: the WASM engine did not initialize; the page fell back to TypeScript` : `${tag}: ${phase}: the TypeScript run reports the WASM engine active`);
      }
    }
    for (const name of config.scenarios) {
      const sc = r.scenarios[name];
      if (!sc) {
        errors.push(`${tag}: scenario ${name} missing`);
        continue;
      }
      for (const t of config.throttles.map(String)) {
        for (const [mode, s] of [["hosted", sc.hosted[t]], ["raw", sc.raw[t]]] as const) {
          if (!s) errors.push(`${tag}: ${name} ${mode} at ${t}x missing`);
          else if (s.engineActive !== r.engine) errors.push(`${tag}: ${name} ${mode} at ${t}x ran on ${s.engineActive}, not ${r.engine}`);
        }
        const f = sc.frames[t];
        if (!f) errors.push(`${tag}: ${name} frames at ${t}x missing`);
        else if (f.engineActive !== r.engine) errors.push(`${tag}: ${name} frames at ${t}x ran on ${f.engineActive}, not ${r.engine}`);
      }
    }
  }

  // Same start and same end, everywhere a scenario ran.
  for (const name of config.scenarios) {
    const starts = new Map<string, string[]>();
    const ends = new Map<string, string[]>();
    const minutes = new Set<number>();
    for (const r of good) {
      const sc = r.scenarios[name];
      if (!sc) continue;
      const samples: [string, string, StepSummary][] = [
        ...Object.entries(sc.hosted).map(([t, s]): [string, string, StepSummary] => [t, "hosted", s]),
        ...Object.entries(sc.raw).map(([t, s]): [string, string, StepSummary] => [t, "raw", s]),
      ];
      for (const [t, mode, s] of samples) {
        const where = `rep ${r.rep} ${r.engine} ${mode} ${t}x`;
        (starts.get(s.startDigest) ?? starts.set(s.startDigest, []).get(s.startDigest)!).push(where);
        (ends.get(s.endDigest) ?? ends.set(s.endDigest, []).get(s.endDigest)!).push(where);
        minutes.add(s.end.minutes);
      }
    }
    if (starts.size > 1) errors.push(`${name}: the samples did not start from one state: ${describeGroups(starts)}`);
    if (ends.size > 1) errors.push(`${name}: the samples did not end in one state after the same ticks: ${describeGroups(ends)}`);
    if (minutes.size > 1) errors.push(`${name}: the samples ended at different clock minutes: ${[...minutes].join(", ")}`);
  }

  for (const c of nodeChecks) if (!c.match) errors.push(`${c.scenario}: the Node conformance check found the engines disagree (start ${c.start.tsState}/${c.start.wasmState}, end ${c.end.tsState}/${c.end.wasmState}, crowd ${c.end.tsCrowd}/${c.end.wasmCrowd})`);
  for (const name of config.scenarios) if (!nodeChecks.some((c) => c.scenario === name)) errors.push(`${name}: no Node conformance check ran`);

  for (const engine of ENGINES) if (!good.some((r) => r.engine === engine)) errors.push(`no successful ${engine} process: the configurations cannot be compared`);
  const versions = new Set(good.map((r) => r.browserVersion));
  if (versions.size > 1) errors.push(`the runs used different browser builds: ${[...versions].join(", ")}`);
  const viewports = new Set(good.map((r) => JSON.stringify(r.page?.viewport ?? null)));
  if (viewports.size > 1) errors.push(`the runs used different viewports: ${[...viewports].join(", ")}`);
  const isolation = new Set(good.map((r) => r.page?.crossOriginIsolated ?? null));
  if (isolation.size > 1) errors.push("some runs were cross-origin isolated and some were not");
  const coarse = good.filter((r) => (r.page?.timerResolutionMs ?? Infinity) > 0.02);
  if (coarse.length) warnings.push(`${coarse.length} process(es) had a timer coarser than 20 microseconds; per-step quantiles there are quantized`);

  if (config.reps < 10) warnings.push(`only ${config.reps} repetition(s) per configuration (the methodology asks for at least 10); treat the numbers as a smoke test`);
  return { ok: errors.length === 0, errors, warnings };
}

function describeGroups(groups: Map<string, string[]>): string {
  return [...groups].map(([d, where]) => `${d} (${where.length}: ${where.slice(0, 3).join("; ")}${where.length > 3 ? "; ..." : ""})`).join(" vs ");
}
