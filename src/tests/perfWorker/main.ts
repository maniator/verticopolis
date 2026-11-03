import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { readdirSync } from "node:fs";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { buildTree, collectEnvironment, packageState, type Environment } from "../perfCompare/env";
import { machineOf, packageErrors, stampErrors } from "../perfCompare/main";
import { incompleteTreeError } from "../perfCompare/treeRecord";
import { gateBrowser, probeBrowser } from "../perfCompare/browserProbe";
import { aaBaselineLimitation, baselineLimitation, rendererLimitation } from "../perfCompare/limitations";
import { checkExceptionFolder, exceptionMarker, resolveLaunch } from "../perfCompare/exceptionRegister";
import { browserName, recordedGpuVerified } from "../perfCompare/renderer";
import { SCENARIO_NAMES, buildScenarios, unknownScenarios } from "../perfCompare/scenarios";
import { BASELINE_DIST, buildBaseline, requireBaselineCommit, requireBaselineDist, startArmServers, TS_BASELINE, type BaselineRecord } from "../perfCompare/baseline";
import { aggregate, ratios, validate, type Metric, type Ratio } from "./analysis";
import type { ModeName } from "./pageWorker";
import { modeOrder, runMode, type ModeRun, type WorkerConfig } from "./runner";
import { markdown } from "./report";
import { buildProduction, buildTooling } from "./build";
import { AA_SLOTS, aaLimitation, checkAaFolder, parseAa, type AaMode } from "./aa";

/**
 * `npm run perf:worker`: the engine-host comparison, now the `ts` and `wasm`
 * modes (the coalesced and worker hosts were dropped), in one browser on the
 * same towers as `perf:compare`. The `ts` mode serves the pinned pre-cutover
 * build (perfCompare/baseline.ts, issue #1597); the `wasm` mode runs this
 * commit.
 * Builds the production app and a tooling build of the same sources (or,
 * with --skip-build, proves the stamped builds are this clean commit's),
 * refuses an engine package it cannot tie to the sources, runs every
 * repetition of every mode in fresh browser processes, and writes
 * results.json, metrics.csv, ratios.csv and report.md. Exits 1 when the
 * validation fails; the results are written either way.
 */
export interface Args {
  reps: number;
  quick: boolean;
  skipBuild: boolean;
  out: string | null;
  resume: string | null;
  scenarios: string[] | null;
  /** The CSS viewport frames render at (`--viewport WxH`). */
  viewport: { width: number; height: number };
  /** `--aa ts|wasm`: an A/A pass, the same mode in both slots (aa.ts). */
  aa: AaMode | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { reps: 10, quick: false, skipBuild: false, aa: null, out: null, resume: null, scenarios: null, viewport: { ...DEFAULT_VIEWPORT } };
  let repsSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--quick") a.quick = true;
    else if (arg === "--aa") a.aa = parseAa(next());
    else if (arg === "--skip-build") a.skipBuild = true;
    else if (arg === "--reps") {
      a.reps = Number(next());
      repsSet = true;
      if (!Number.isInteger(a.reps) || a.reps < 1) throw new Error("--reps must be a positive integer");
    } else if (arg === "--out") a.out = next();
    else if (arg === "--resume") a.resume = next();
    else if (arg === "--scenarios") {
      a.scenarios = next().split(",").filter(Boolean);
      if (a.scenarios.length === 0) throw new Error("--scenarios needs at least one name");
      if (new Set(a.scenarios).size !== a.scenarios.length) throw new Error("--scenarios names a scenario twice");
    } else if (arg === "--viewport") {
      const m = /^(\d+)x(\d+)$/.exec(next());
      const width = m ? Number(m[1]) : 0;
      const height = m ? Number(m[2]) : 0;
      if (width < 320 || height < 240 || width > 7680 || height > 4320) throw new Error("--viewport needs WIDTHxHEIGHT in CSS pixels, from 320x240 to 7680x4320 (for example 1280x720)");
      a.viewport = { width, height };
    }
    else throw new Error(`unknown argument ${arg}; expected --reps N, --quick, --skip-build, --out DIR, --resume DIR, --scenarios a,b, --viewport WxH, --aa ts|wasm`);
  }
  if (a.quick && !repsSet) a.reps = 2;
  if (a.resume && a.out) throw new Error("--resume continues its own folder; it takes no --out");
  return a;
}

/** The engines a run measures. The Rust engine is the game's engine port
 *  (PR 5e), so the old `wasm-frame` and `wasm-worker` hosts are gone. */
export const MODES: readonly ModeName[] = ["ts", "wasm"];

/** A phone-sized CSS viewport. On the 4-CPU container with software WebGL
 *  the harness was built on, a 1280x720 frame took about 250 ms, past the
 *  200 ms clamp, so every mode's frames ran almost no simulation. A machine
 *  with a GPU can pass `--viewport 1280x720`. */
export const DEFAULT_VIEWPORT = { width: 640, height: 360 } as const;

export function makeConfig(args: Args, scenarios: string[]): WorkerConfig {
  return {
    reps: args.reps,
    dt: 2,
    steps: args.quick ? 90 : 720,
    warmSteps: args.quick ? 30 : 120,
    batch: 4,
    memorySteps: 30,
    throttles: [1, 4],
    frameWindowMs: args.quick ? 3000 : 15_000,
    frameWarmMs: args.quick ? 1000 : 2000,
    commandEveryMs: 1000,
    speed: 3,
    viewport: { ...args.viewport },
    scenarios,
    modes: args.aa ? [...AA_SLOTS] : [...MODES],
    quick: args.quick,
    aa: args.aa,
  };
}

/** The report's limitations, worded from the run's own configuration. */
export function limitations(config: WorkerConfig, renderers: readonly string[] = [], exception: string | null = null, tsBaseline: BaselineRecord | null = null): string[] {
  const k = config.modes.length;
  const firsts = Array.from({ length: k }, (_, i) => Math.floor(config.reps / k) + (i < config.reps % k ? 1 : 0));
  const firstText = firsts.every((n) => n === firsts[0]) ? `each mode first ${firsts[0]} time(s)` : `modes first between ${Math.min(...firsts)} and ${Math.max(...firsts)} times`;
  return [
  ...(config.aa ? [aaLimitation(config.aa)] : []),
  ...(tsBaseline ? [config.aa === "ts" ? aaBaselineLimitation(tsBaseline) : baselineLimitation(tsBaseline)] : []),
  "One machine and one headless browser (its name and version are in the Browser row). The renderer line says whether the page used the GPU; a software rasterizer fails validation in a protocol run, because render cost then dominates every frame and the FPS rows say more about the CPU than about GPU-backed frame rates.",
  "CPU throttling is DevTools emulation of the page's main thread. Chromium refuses it on worker targets and a page-level throttle leaves a dedicated worker nearly unthrottled (probed on Chromium 141: a busy loop took 41 ms at 1x and 44 to 58 ms with the page at 4x, 7 to 41% slower against about 4x on the main thread). So at a throttle above 1x the worker host's main thread ran throttled and its engine thread did not; its rows are marked † and carry an `unthrottled` column in the CSVs. A comparison of the worker host with a main-thread host at that throttle favors the worker. Two runs of the same mode are comparable with each other.",
  `Hosted rows run ${config.steps} steps of ${config.dt} minutes in batches of ${config.batch} (the frame loop's cap is 4) with no rendering. Wall time includes the worker host's wait for each reply; main-thread time counts the steps, the flushes and the time applying replies, and leaves the worker's own time out (reported apart). The browser's unpacking of each reply (the structured clone of its strings, the full save's included) runs on the main thread before the host sees the reply and is not in the hosted main-thread rows; the frames rows (frame times, long tasks) include it.`,
  "The worker host keeps one batch in flight. A frame that finds a batch still out takes no steps (the frame loop banks its minutes under the 30-minute cap), so on a tower the engine cannot step in real time the worker host simulates fewer minutes per second rather than queueing work; the sim-minutes-per-second row shows it.",
  "Command latency times a tower rename (relayed by every host, read by nothing in the simulation) from the call to the clock inside the first frame callback that runs once the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame callback. One command is in flight at a time, one per second. A negative sample fails validation.",
  `Memory is measured after ${config.memorySteps} steps on a freshly loaded page, after a forced GC. The harness keeps the scenario saves it loads from in the page for every mode (the same text in every mode's JS heap rows); its own stashed start and end saves are dropped before the read. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).`,
  `Frames render at a ${config.viewport.width}x${config.viewport.height} CSS viewport${config.viewport.width === DEFAULT_VIEWPORT.width && config.viewport.height === DEFAULT_VIEWPORT.height ? " (the default, a common phone size), smaller than perf:compare's 1280x720: on the 4-CPU container with software WebGL the harness was built on, a 1280x720 frame took about 250 ms, past Excalibur's 200 ms clamp, so at that size the modes simulated almost nothing in their frames" : " (set with --viewport)"}. A frame longer than 200 ms is handed 1 ms of game time, so rows with clamped frames understate the simulation work; the clamped-frame row counts them.`,
  "Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.",
  "The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.",
  `Throttles run in a fixed order (${config.throttles.map((t) => `${t}x`).join(" then ")}) in each process. The mode order rotates by repetition (${config.reps} repetitions over ${k} modes: ${firstText}). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.`,
  "Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.",
  ...rendererLimitation(renderers, exception),
  ];
}

interface Size { raw: number; brotli: number }

/** Sizes in a production build, raw and Brotli 11: the engine worker chunk
 *  (null when the build has none, as the shipped build does not since the
 *  worker host was dropped), every other JavaScript asset, and the engine
 *  package the WASM modes download (`engine/`). Throws on more than one
 *  worker chunk or on a build without the package, before anything is
 *  measured; a missing worker chunk is reported as "not run", not an error. */
export function scriptSizes(dist: string): { worker: Size | null; otherJs: Size; enginePackage: Size } {
  const size = (path: string): Size => ({ raw: statSync(path).size, brotli: brotliCompressSync(readFileSync(path), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
  const add = (a: Size, b: Size): Size => ({ raw: a.raw + b.raw, brotli: a.brotli + b.brotli });
  const assets = join(dist, "assets");
  const workers: Size[] = [];
  let otherJs: Size = { raw: 0, brotli: 0 };
  for (const f of readdirSync(assets)) {
    if (!f.endsWith(".js")) continue;
    if (f.startsWith("engineWorker-")) workers.push(size(join(assets, f)));
    else otherJs = add(otherJs, size(join(assets, f)));
  }
  if (workers.length > 1) throw new Error(`${assets} holds ${workers.length} engine worker chunks (engineWorker-*.js); expected at most one`);
  let enginePackage: Size = { raw: 0, brotli: 0 };
  for (const f of ["verticopolis_engine_bg.wasm", "verticopolis_engine.js"]) {
    const path = join(dist, "engine", f);
    if (!existsSync(path)) throw new Error(`${path} is missing`);
    enginePackage = add(enginePackage, size(path));
  }
  return { worker: workers[0] ?? null, otherJs, enginePackage };
}

/** One CSV field: quoted when it holds a comma, a quote or a newline, with
 *  quotes doubled. */
export function csvField(v: string | number): string {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export interface WorkerResults {
  schema: 1;
  startedAt: string;
  generatedAt: string;
  config: WorkerConfig;
  environment: Environment;
  browser: { version: string | null; executable: string | null; channel?: string | null; args?: string[]; rendererException?: string | null; rendererExceptionSha256?: string | null; rendererExceptionCommit?: string | null; gpuVerified?: boolean };
  scenarios: { name: string; sha256: string; population: number; units: number; transports: number; saveBytes: number }[];
  scripts: ReturnType<typeof scriptSizes>;
  /** The pinned TypeScript baseline the ts mode served (issue #1597), or null when no ts mode ran; absent from older results. */
  tsBaseline?: BaselineRecord | null;
  runs: ModeRun[];
  metrics: Metric[];
  ratios: Ratio[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}

/** An A/A folder's CSVs carry one more column, `aa`, naming the mode both slots ran, so a row cannot be read as a comparison. */
const withAa = (cells: (string | number)[], aa: AaMode | null | undefined): (string | number)[] => (aa ? [...cells, aa] : cells);

export function metricsCsv(metrics: readonly Metric[], aa?: AaMode | null): string {
  const rows = [`group,scenario,throttle,metric,unit,mode,n,median,ci_low,ci_high,mean,cv,unthrottled,values${aa ? ",aa" : ""}`];
  for (const m of metrics) {
    const s = m.summary;
    rows.push(withAa([m.group, m.scenario, m.throttle, m.metric, m.unit, m.mode, s?.n ?? 0, s?.median ?? "", s?.medianCiLow ?? "", s?.medianCiHigh ?? "", s?.mean ?? "", s?.cv ?? "", m.unthrottled ?? "", m.values.join(" ")], aa).map(csvField).join(","));
  }
  return rows.join("\n") + "\n";
}

/** In an A/A folder the `verdict` column is "A/A": there is no verdict, only the interval. */
export function ratiosCsv(rs: readonly Ratio[], aa?: AaMode | null): string {
  const rows = [`group,scenario,throttle,metric,mode,against,ratio,ci_low,ci_high,pairs,zero_reference,verdict,unthrottled${aa ? ",aa" : ""}`];
  for (const r of rs) rows.push(withAa([r.group, r.scenario, r.throttle, r.metric, r.mode, r.against, r.ratio, r.ciLow ?? "", r.ciHigh ?? "", r.n, r.zeroReference, aa ? "A/A" : r.verdict, r.unthrottled ?? ""], aa).map(csvField).join(","));
  return rows.join("\n") + "\n";
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const started = new Date().toISOString();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const dist = join(repo, "dist");
  const distPerf = join(repo, "dist-perf");
  const distTs = join(repo, BASELINE_DIST);
  // The ts mode runs the pinned pre-cutover build (issue #1597). Every comparison has a ts mode; an A/A pass of wasm does not.
  const needsBaseline = args.aa !== "wasm";
  const tsBaseline: BaselineRecord | null = needsBaseline ? { commit: TS_BASELINE.commit, appVersion: TS_BASELINE.appVersion } : null;
  // The browser is settled first, as in perf:compare: launch settings parsed
  // and the adapter read before any build or results folder exists.
  const launch = resolveLaunch(process.env, repo);
  const executablePath = process.env.PW_CHROMIUM_PATH || null;
  const probe = await probeBrowser(executablePath, launch);
  for (const w of gateBrowser(probe, args.quick, launch, executablePath)) log(`perf:worker: warning: ${w}`);
  log(`perf:worker: ${browserName(launch.channel, executablePath)} ${probe.version}${launch.channel ? ` (channel ${launch.channel})` : ""}, WebGL renderer ${probe.renderer ?? "none"}`);
  const stampPaths = [join(dist, ".perf-build.json"), join(distPerf, ".perf-build.json")];
  const tree = buildTree(repo);
  if (!args.skipBuild) {
    if (needsBaseline) requireBaselineCommit(repo);
    buildProduction(repo);
    buildTooling(repo, distPerf);
    if (needsBaseline) buildBaseline(repo, log);
    for (const p of stampPaths) writeFileSync(p, JSON.stringify(tree) + "\n");
  } else {
    const errs = stampErrors(stampPaths, tree);
    if (errs.length) throw new Error(errs.join("; "));
  }
  if (needsBaseline) requireBaselineDist(distTs);
  const unknown = unknownScenarios(args.scenarios ?? []);
  if (unknown.length) throw new Error(`unknown scenario ${unknown.join(",")}; expected ${SCENARIO_NAMES.join(",")}`);
  const scenarios = buildScenarios(args.scenarios);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const environment = collectEnvironment(repo, distPerf, sourceHash);
  const problems = packageErrors(packageState(distPerf), packageState(dist), sourceHash);
  if (problems.length) throw new Error(`the engine package cannot be tied to this tree:\n  - ${problems.join("\n  - ")}`);
  // The sizes, read before anything is measured: a build without the
  // engine package fails here, not after hours of runs.
  const scripts = scriptSizes(dist);
  const meta = { commit: environment.commit, dirty: environment.dirty, skipBuild: args.skipBuild, config, enginePackage: environment.enginePackage, scenarios: scenarios.map((s) => s.sha256), tsBaseline, machine: machineOf(environment, executablePath, launch, probe) };
  const runs: ModeRun[] = [];
  let out: string;
  let startedAt = started;
  if (args.resume) {
    out = resolve(repo, args.resume);
    const cp = loadWorkerCheckpoint(out, meta);
    runs.push(...cp.runs);
    startedAt = cp.startedAt;
    log(`perf:worker: resuming ${out} with ${runs.length} finished run(s)${cp.retried ? `; ${cp.retried} failed run(s) will run again` : ""}`);
  } else {
    const day = started.slice(0, 10);
    if (args.out) {
      checkExceptionFolder(basename(resolve(repo, args.out)), launch.rendererException);
      checkAaFolder(basename(resolve(repo, args.out)), args.aa);
    }
    out = args.out ? resolve(repo, args.out) : resolve(repo, "docs/performance/results", `${day}-${environment.commitShort}-worker${args.quick ? "-quick" : ""}${args.aa ? `-aa-${args.aa}` : ""}${launch.rendererException ? `-${exceptionMarker(launch.rendererException)}` : ""}${environment.dirty ? "-dirty" : ""}`);
    if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "checkpoint.json"), JSON.stringify({ ...meta, startedAt }, null, 1) + "\n");
    writeFileSync(join(out, "runs.jsonl"), "");
  }
  log(`perf:worker: measuring ${environment.commit}${environment.dirty ? " (dirty)" : ""}, ${config.reps} reps of ${config.aa ? `${config.aa} in both slots (A/A)` : config.modes.join(", ")}`);
  const servers = await startArmServers(distPerf, distTs, needsBaseline);
  try {
    for (let rep = 0; rep < config.reps; rep++) {
      let order = 0;
      for (const mode of modeOrder(rep, config.modes)) {
        const position = order++;
        if (runs.some((r) => r.rep === rep && r.mode === mode)) continue;
        log(`perf:worker: rep ${rep + 1}/${config.reps}, ${mode}`);
        const run = await runMode({ servers, config, scenarios, executablePath, launch, log }, rep, mode, position);
        runs.push(run);
        appendFileSync(join(out, "runs.jsonl"), JSON.stringify(run) + "\n");
      }
    }
  } finally {
    await Promise.allSettled(Object.values(servers).map((srv) => srv.close()));
  }
  const v = validate(config, runs, launch.rendererException);
  for (const e of packageErrors(packageState(distPerf), packageState(dist), sourceHash, { files: environment.enginePackage, buildHash: environment.engineBuildHash })) v.errors.push(e);
  const treeError = incompleteTreeError(environment.tree);
  if (treeError) v.errors.push(treeError);
  if (environment.dirty) v.warnings.push("the working tree had uncommitted changes; the folder is marked -dirty");
  const metrics = aggregate(config, runs);
  const results: WorkerResults = {
    schema: 1,
    startedAt,
    generatedAt: new Date().toISOString(),
    config,
    environment,
    browser: { version: runs.find((r) => r.browserVersion)?.browserVersion ?? null, executable: executablePath, channel: launch.channel, args: launch.args, rendererException: launch.rendererException, rendererExceptionSha256: launch.rendererExceptionSha256, rendererExceptionCommit: launch.rendererExceptionCommit, gpuVerified: recordedGpuVerified(launch.rendererException, runs.filter((r) => r.ok).map((r) => r.page?.webgl?.renderer), runs.filter((r) => r.ok).map((r) => r.rendererEnd), runs.filter((r) => r.ok).map((r) => r.rendererEndCold)) },
    scenarios: scenarios.map((s) => ({ name: s.name, sha256: s.sha256, population: s.population, units: s.units, transports: s.transports, saveBytes: s.save.length })),
    scripts,
    tsBaseline,
    runs,
    metrics,
    ratios: ratios(metrics, config.modes),
    validation: { ok: v.errors.length === 0, ...v },
    limitations: limitations(config, [...new Set(runs.filter((r) => r.ok).flatMap((r) => [r.page?.webgl?.renderer, r.rendererEnd, r.rendererEndCold]).filter((x): x is string => !!x))], launch.rendererException, tsBaseline),
  };
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1) + "\n");
  writeFileSync(join(out, "metrics.csv"), metricsCsv(results.metrics, config.aa));
  writeFileSync(join(out, "ratios.csv"), ratiosCsv(results.ratios, config.aa));
  writeFileSync(join(out, "report.md"), markdown(results));
  rmSync(join(out, "runs.jsonl"), { force: true });
  rmSync(join(out, "checkpoint.json"), { force: true });
  log(`perf:worker: wrote ${out}`);
  if (!results.validation.ok) {
    log("perf:worker: VALIDATION FAILED:");
    for (const e of results.validation.errors) log(`  - ${e}`);
    return 1;
  }
  return 0;
}

/**
 * Read a stopped run's checkpoint for --resume: refuses a folder that holds
 * final results, a run that started on a dirty tree or that this tree is
 * not (commit, build mode, configuration, engine bytes, scenarios, machine
 * and toolchain), and a tree that is dirty now. A last line the stop cut
 * off is cut from the file; a bad line elsewhere is an error. A failed run
 * is dropped, so it runs again.
 */
export function loadWorkerCheckpoint(dir: string, expected: Record<string, unknown>): { runs: ModeRun[]; startedAt: string; retried: number } {
  if (existsSync(join(dir, "results.json"))) throw new Error(`${dir} already holds final results; nothing to resume`);
  const saved = JSON.parse(readFileSync(join(dir, "checkpoint.json"), "utf8")) as Record<string, unknown> & { startedAt: string };
  if (saved.dirty) throw new Error(`cannot resume ${dir}: it started on a dirty tree`);
  if (expected.dirty) throw new Error("--resume needs a clean tree, the same one the run started on");
  for (const k of ["commit", "skipBuild", "config", "enginePackage", "scenarios", "tsBaseline", "machine"]) {
    // A checkpoint from before the baseline existed lacks the field, which reads as none, the same as an A/A pass of wasm records.
    if (JSON.stringify(saved[k] ?? null) === JSON.stringify(expected[k] ?? null)) continue;
    // Name the options that differ, so a resume can repeat them.
    const a = (saved[k] ?? {}) as Record<string, unknown>;
    const b = (expected[k] ?? {}) as Record<string, unknown>;
    const fields = k === "config" || k === "machine" ? [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f])) : [];
    const hint = k === "machine" ? "run on the machine and browser the run started with" : "pass the options the run started with";
    throw new Error(`cannot resume ${dir}: its ${k} differs from this run's${fields.length ? ` (${fields.join(", ")}; ${hint})` : ""}`);
  }
  const path = join(dir, "runs.jsonl");
  let text = readFileSync(path, "utf8");
  if (text && !text.endsWith("\n")) {
    text = text.slice(0, text.lastIndexOf("\n") + 1);
    truncateSync(path, Buffer.byteLength(text, "utf8"));
  }
  const all = text.split("\n").filter((l) => l.trim()).map((line, i) => {
    try {
      return JSON.parse(line) as ModeRun;
    } catch {
      throw new Error(`cannot resume ${dir}: line ${i + 1} of runs.jsonl is not JSON`);
    }
  });
  const runs = all.filter((r) => r.ok);
  return { runs, startedAt: saved.startedAt, retried: all.length - runs.length };
}
