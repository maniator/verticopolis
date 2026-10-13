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
 * 6. The simulation really ran: every sample's clock moved by exactly the
 *    steps it was given, and its end state differs from its start. The
 *    browser digests equal the Node check's (same save, steps and step).
 * 7. No host error and no engine or frame error ([wasm], [tick]) appeared
 *    during a run.
 * Warnings (reported, not failing): other page errors, frames longer than
 * the 200 ms clamp, frame windows under 100 frames, audio that did not
 * start, a first visit whose service worker never activated.
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
    for (const [phase, s] of [["cold start", r.cold], ["warm start", r.warm], ["4x cold start", r.cold4x]] as const) {
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
          if (!s) {
            errors.push(`${tag}: ${name} ${mode} at ${t}x missing`);
            continue;
          }
          if (s.engineActive !== r.engine) errors.push(`${tag}: ${name} ${mode} at ${t}x ran on ${s.engineActive}, not ${r.engine}`);
          if (s.hostErrorsAdded.length) errors.push(`${tag}: ${name} ${mode} at ${t}x: the host reported ${s.hostErrorsAdded.join("; ")}`);
          if (s.end.minutes !== s.startMinutes + config.steps * config.dt) errors.push(`${tag}: ${name} ${mode} at ${t}x: the clock moved ${s.end.minutes - s.startMinutes} minutes, expected ${config.steps * config.dt}`);
          if (s.startDigest === s.endDigest) errors.push(`${tag}: ${name} ${mode} at ${t}x: the end state equals the start state; the simulation did not advance`);
        }
        for (const [label, f] of [["frames", sc.frames[t]], ["frames with audio", sc.framesAudio?.[t]]] as const) {
          if (!f) {
            if (label === "frames" || r.audio?.started) errors.push(`${tag}: ${name} ${label} at ${t}x missing`);
            continue;
          }
          if (f.engineActive !== r.engine) errors.push(`${tag}: ${name} ${label} at ${t}x ran on ${f.engineActive}, not ${r.engine}`);
          if (f.hostErrorsAdded.length) errors.push(`${tag}: ${name} ${label} at ${t}x: the host reported ${f.hostErrorsAdded.join("; ")}`);
          if (f.clampedFrames > 0) warnings.push(`${tag}: ${name} ${label} at ${t}x: ${f.clampedFrames} of ${f.frames} frames ran over 200 ms, which the game clamps to 1 ms of elapsed time, so that row understates the simulation work`);
          if (f.frames < 100) warnings.push(`${tag}: ${name} ${label} at ${t}x: only ${f.frames} frames in the window; its p99 and 1% low rest on one or two frames`);
          if (f.ticks === 0 || !(f.simMinutesPerSecond > 0)) errors.push(`${tag}: ${name} ${label} at ${t}x: the simulation did not advance during the window (${f.ticks} ticks)`);
          if (label === "frames" && f.audioStarted) errors.push(`${tag}: ${name} frames at ${t}x ran with audio started; the audio-off rows are not audio-off`);
          if (label === "frames with audio" && !f.audioStarted) errors.push(`${tag}: ${name} frames with audio at ${t}x ran without audio`);
        }
      }
    }
  }

  for (const r of good) {
    const fatal = r.pageErrors.filter((e) => /\[wasm\]|\[tick\]/.test(e));
    if (fatal.length) errors.push(`rep ${r.rep} ${r.engine}: engine or frame errors in the page: ${fatal.slice(0, 3).join(" | ")}`);
    else if (r.pageErrors.length) warnings.push(`rep ${r.rep} ${r.engine}: ${r.pageErrors.length} page error(s), first: ${r.pageErrors[0]}`);
    if (r.engine === "wasm" && r.cold) {
      const { engineHostedMs, gameReadyMs } = r.cold;
      if (engineHostedMs === null || gameReadyMs === null || engineHostedMs > gameReadyMs) errors.push(`rep ${r.rep} wasm: the engine was not hosted by the time the game was ready (hosted ${engineHostedMs ?? "never"}, ready ${gameReadyMs ?? "never"})`);
    }
    if (r.audio?.started && !r.audio.contexts.includes("running") && Object.values(r.scenarios).some((sc) => Object.keys(sc.framesAudio ?? {}).length)) errors.push(`rep ${r.rep} ${r.engine}: audio-on frames ran with no running AudioContext (${r.audio.contexts.join(", ") || "none"})`);
    if (r.cpuProbe && r.cpuProbe.throttledMs < r.cpuProbe.unthrottledMs * r.cpuProbe.rate * 0.5) warnings.push(`rep ${r.rep} ${r.engine}: the CPU probe ran ${r.cpuProbe.throttledMs.toFixed(0)} ms under the ${r.cpuProbe.rate}x throttle against ${r.cpuProbe.unthrottledMs.toFixed(0)} ms without it; the throttled cold start may not have been throttled`);
    for (const [name, sc] of Object.entries(r.scenarios)) {
      for (const [t, h] of Object.entries(sc.hosted)) if (r.engine === "wasm" && h.attribution && h.attribution.exportCalls === 0) errors.push(`rep ${r.rep} wasm: ${name} ${t}x: the attribution pass saw no export call, so its host JS share would include engine time`);
    }
    if (!r.audio?.started) warnings.push(`rep ${r.rep} ${r.engine}: audio did not start, so the audio-on rows have no sample from it`);
    const fv = r.firstVisitWithServiceWorker;
    if (!fv || fv.error || !fv.swActive) warnings.push(`rep ${r.rep} ${r.engine}: the service worker first visit ${fv?.error ? `failed (${fv.error})` : "never activated"}; its transfer and offline rows have no sample from it`);
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
    const node = nodeChecks.find((c) => c.scenario === name);
    if (node && node.steps === config.steps && node.dt === config.dt) {
      if (starts.size === 1 && !starts.has(node.start.tsState)) errors.push(`${name}: the browser runs started from ${[...starts.keys()][0]}, not the Node check's ${node.start.tsState}`);
      if (ends.size === 1 && !ends.has(node.end.tsState)) errors.push(`${name}: the browser runs ended in ${[...ends.keys()][0]}, not the Node check's ${node.end.tsState}`);
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
