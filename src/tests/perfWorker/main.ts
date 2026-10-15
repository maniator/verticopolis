import { execFileSync, execSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { readdirSync } from "node:fs";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { buildTree, collectEnvironment, packageState, type Environment } from "../perfCompare/env";
import { machineOf, packageErrors, stampErrors } from "../perfCompare/main";
import { buildScenarios } from "../perfCompare/scenarios";
import { startServer } from "../perfCompare/server";
import { aggregate, ratios, validate, type Metric, type Ratio } from "./analysis";
import type { ModeName } from "./pageWorker";
import { modeOrder, runMode, type ModeRun, type WorkerConfig } from "./runner";
import { markdown, readModelMarkdown } from "./report";
import { measureReadModel, type ReadModelShape } from "./readModel";

/**
 * `npm run perf:worker`: the engine-host comparison (TypeScript, the shipped
 * main-thread WASM host, the coalesced main-thread host and the worker
 * host) on one build, one browser and the same towers as `perf:compare`.
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
  /** `--read-model`: only the read model's shape (readModel.ts), in Node,
   *  with no build and no browser. */
  readModelOnly: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { reps: 10, quick: false, skipBuild: false, readModelOnly: false, out: null, resume: null, scenarios: null, viewport: { ...DEFAULT_VIEWPORT } };
  let repsSet = false;
  let viewportSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--quick") a.quick = true;
    else if (arg === "--read-model") a.readModelOnly = true;
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
      viewportSet = true;
    }
    else throw new Error(`unknown argument ${arg}; expected --reps N, --quick, --skip-build, --out DIR, --resume DIR, --scenarios a,b, --viewport WxH, --read-model`);
  }
  if (a.quick && !repsSet) a.reps = 2;
  if (a.resume && a.out) throw new Error("--resume continues its own folder; it takes no --out");
  if (a.readModelOnly && (a.resume || a.skipBuild || repsSet || viewportSet)) throw new Error("--read-model runs no build and no browser; it takes no --resume, --skip-build, --reps or --viewport");
  return a;
}

export const MODES: readonly ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];

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
    modes: [...MODES],
    quick: args.quick,
  };
}

/** The report's limitations, worded from the run's own configuration. */
export function limitations(config: WorkerConfig): string[] {
  const k = config.modes.length;
  const firsts = Array.from({ length: k }, (_, i) => Math.floor(config.reps / k) + (i < config.reps % k ? 1 : 0));
  const firstText = firsts.every((n) => n === firsts[0]) ? `each mode first ${firsts[0]} time(s)` : `modes first between ${Math.min(...firsts)} and ${Math.max(...firsts)} times`;
  return [
  "One machine, headless Chromium in a container, software WebGL (see the renderer line): render cost dominates every frame, so the FPS rows say more about how much main-thread time each host leaves the renderer than about GPU-backed frame rates.",
  "CPU throttling is DevTools emulation of the renderer process. The engine worker runs in the same renderer process, so the 4x rows slow it too; whether emulation throttles a worker thread exactly as it throttles the main thread was not measured.",
  `Hosted rows run ${config.steps} steps of ${config.dt} minutes in batches of ${config.batch} (the frame loop's cap is 4) with no rendering. Wall time includes the worker host's wait for each reply; main-thread time counts the steps, the flushes and the time applying replies, and leaves the worker's own time out (reported apart). The browser's unpacking of each reply (the structured clone of its strings, the full save's included) runs on the main thread before the host sees the reply and is not in the hosted main-thread rows; the frames rows (frame times, long tasks) include it.`,
  "The worker host keeps one batch in flight. A frame that finds a batch still out takes no steps (the frame loop banks its minutes under the 30-minute cap), so on a tower the engine cannot step in real time the worker host simulates fewer minutes per second rather than queueing work; the sim-minutes-per-second row shows it.",
  "Command latency times a tower rename (relayed by every host, read by nothing in the simulation) from the call to the clock inside the first frame callback that runs once the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame callback. One command is in flight at a time, one per second. A negative sample fails validation.",
  `Memory is measured after ${config.memorySteps} steps on a freshly loaded page, after a forced GC. The harness keeps the scenario saves it loads from in the page for every mode (the same text in every mode's JS heap rows); its own stashed start and end saves are dropped before the read. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).`,
  `Frames render at a ${config.viewport.width}x${config.viewport.height} CSS viewport${config.viewport.width === DEFAULT_VIEWPORT.width && config.viewport.height === DEFAULT_VIEWPORT.height ? " (the default, a common phone size), smaller than perf:compare's 1280x720: on the 4-CPU container with software WebGL the harness was built on, a 1280x720 frame took about 250 ms, past Excalibur's 200 ms clamp, so at that size the modes simulated almost nothing in their frames" : " (set with --viewport)"}. A frame longer than 200 ms is handed 1 ms of game time, so rows with clamped frames understate the simulation work; the clamped-frame row counts them.`,
  "Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.",
  "The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.",
  `Throttles run in a fixed order (${config.throttles.map((t) => `${t}x`).join(" then ")}) in each process. The mode order rotates by repetition (${config.reps} repetitions over ${k} modes: ${firstText}). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.`,
  `The read model section is measured in Node on the TypeScript engine, not in the browser: each scenario loads its save fresh, as the timed hosted run does after its throwaway warm-up, then runs the hosted rows' ${config.steps} steps in batches of ${config.batch}, and a merge is counted after each batch where the worker host merges by its own rule (the hour-pass counter or the tower revision moved). The merges a host forces after a stale reply or for a settle are left out. Sizes are JSON characters of each value. The WASM engine reaches the same end state (the hosted end-state digests), but its intermediate saves were not compared.`,
  "Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.",
  ];
}

/** The limitations a `--read-model` report carries: the read model line. */
export function readModelLimitations(config: WorkerConfig): string[] {
  const lines = limitations(config).filter((l) => l.startsWith("The read model section"));
  if (lines.length !== 1) throw new Error(`expected one read model limitation, found ${lines.length}`);
  return lines;
}

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform !== "win32") {
    execFileSync(cmd, args, { cwd, stdio: "inherit", env });
    return;
  }
  // On Windows npm and npx are .cmd scripts, which Node runs only through a
  // shell, so the line is joined here with any path that has a space quoted.
  const quote = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  execSync([cmd, ...args].map(quote).join(" "), { cwd, stdio: "inherit", env });
}

interface Size { raw: number; brotli: number }

/** Sizes in a production build, raw and Brotli 11: the engine worker chunk
 *  (exactly one), every other JavaScript asset, and the engine package the
 *  WASM modes download (`engine/`). Throws on a build without exactly one
 *  worker chunk or without the package, before anything is measured. */
export function scriptSizes(dist: string): { worker: Size; otherJs: Size; enginePackage: Size } {
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
  if (workers.length !== 1) throw new Error(`${assets} holds ${workers.length} engine worker chunks (engineWorker-*.js); expected one`);
  let enginePackage: Size = { raw: 0, brotli: 0 };
  for (const f of ["verticopolis_engine_bg.wasm", "verticopolis_engine.js"]) {
    const path = join(dist, "engine", f);
    if (!existsSync(path)) throw new Error(`${path} is missing`);
    enginePackage = add(enginePackage, size(path));
  }
  return { worker: workers[0], otherJs, enginePackage };
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
  browser: { version: string | null; executable: string | null };
  scenarios: { name: string; sha256: string; population: number; units: number; transports: number; saveBytes: number }[];
  scripts: ReturnType<typeof scriptSizes>;
  runs: ModeRun[];
  metrics: Metric[];
  ratios: Ratio[];
  /** The read model's shape per scenario (readModel.ts); absent from
   *  results written before it was measured. */
  readModel?: ReadModelShape[];
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}

export function metricsCsv(metrics: readonly Metric[]): string {
  const rows = ["group,scenario,throttle,metric,unit,mode,n,median,ci_low,ci_high,mean,cv,values"];
  for (const m of metrics) {
    const s = m.summary;
    rows.push([m.group, m.scenario, m.throttle, m.metric, m.unit, m.mode, s?.n ?? 0, s?.median ?? "", s?.medianCiLow ?? "", s?.medianCiHigh ?? "", s?.mean ?? "", s?.cv ?? "", m.values.join(" ")].map(csvField).join(","));
  }
  return rows.join("\n") + "\n";
}

export function ratiosCsv(rs: readonly Ratio[]): string {
  const rows = ["group,scenario,throttle,metric,mode,against,ratio,ci_low,ci_high,pairs,zero_reference,verdict"];
  for (const r of rs) rows.push([r.group, r.scenario, r.throttle, r.metric, r.mode, r.against, r.ratio, r.ciLow ?? "", r.ciHigh ?? "", r.n, r.zeroReference, r.verdict].map(csvField).join(","));
  return rows.join("\n") + "\n";
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  if (args.readModelOnly) return readModelMain(args, repo);
  const started = new Date().toISOString();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const dist = join(repo, "dist");
  const distPerf = join(repo, "dist-perf");
  const stampPaths = [join(dist, ".perf-build.json"), join(distPerf, ".perf-build.json")];
  const tree = buildTree(repo);
  if (!args.skipBuild) {
    sh("npm", ["run", "build"], repo);
    sh("npx", ["vite", "build", "--outDir", distPerf, "--emptyOutDir"], repo, { ...process.env, VC_TOOLING: "1" });
    for (const p of stampPaths) writeFileSync(p, JSON.stringify(tree) + "\n");
  } else {
    const errs = stampErrors(stampPaths, tree);
    if (errs.length) throw new Error(errs.join("; "));
  }
  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}`);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const environment = collectEnvironment(repo, distPerf, sourceHash);
  const problems = packageErrors(packageState(distPerf), packageState(dist), sourceHash);
  if (problems.length) throw new Error(`the engine package cannot be tied to this tree:\n  - ${problems.join("\n  - ")}`);
  // The sizes, read before anything is measured: a build without the
  // worker chunk or the package fails here, not after hours of runs.
  const scripts = scriptSizes(dist);
  const executablePath = process.env.PW_CHROMIUM_PATH ?? null;
  const meta = { commit: environment.commit, dirty: environment.dirty, skipBuild: args.skipBuild, config, enginePackage: environment.enginePackage, scenarios: scenarios.map((s) => s.sha256), machine: machineOf(environment, executablePath) };
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
    out = args.out ? resolve(repo, args.out) : resolve(repo, "docs/performance/results", `${day}-${environment.commitShort}-worker${args.quick ? "-quick" : ""}${environment.dirty ? "-dirty" : ""}`);
    if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "checkpoint.json"), JSON.stringify({ ...meta, startedAt }, null, 1) + "\n");
    writeFileSync(join(out, "runs.jsonl"), "");
  }
  // Deterministic counts on the TypeScript engine, cheap next to the
  // browser runs, so a resumed run measures them again rather than
  // checkpointing them.
  const readModel = scenarios.map((s) => {
    log(`perf:worker: read model shape, ${s.name}`);
    return measureReadModel(s, { steps: config.steps, dt: config.dt, batch: config.batch });
  });
  log(`perf:worker: measuring ${environment.commit}${environment.dirty ? " (dirty)" : ""}, ${config.reps} reps of ${config.modes.join(", ")}`);
  const server = await startServer(distPerf);
  try {
    for (let rep = 0; rep < config.reps; rep++) {
      let order = 0;
      for (const mode of modeOrder(rep, config.modes)) {
        const position = order++;
        if (runs.some((r) => r.rep === rep && r.mode === mode)) continue;
        log(`perf:worker: rep ${rep + 1}/${config.reps}, ${mode}`);
        const run = await runMode({ server, config, scenarios, executablePath, log }, rep, mode, position);
        runs.push(run);
        appendFileSync(join(out, "runs.jsonl"), JSON.stringify(run) + "\n");
      }
    }
  } finally {
    await server.close();
  }
  const v = validate(config, runs);
  for (const e of packageErrors(packageState(distPerf), packageState(dist), sourceHash, { files: environment.enginePackage, buildHash: environment.engineBuildHash })) v.errors.push(e);
  if (environment.dirty) v.warnings.push("the working tree had uncommitted changes; the folder is marked -dirty");
  const metrics = aggregate(config, runs);
  const results: WorkerResults = {
    schema: 1,
    startedAt,
    generatedAt: new Date().toISOString(),
    config,
    environment,
    browser: { version: runs.find((r) => r.browserVersion)?.browserVersion ?? null, executable: executablePath },
    scenarios: scenarios.map((s) => ({ name: s.name, sha256: s.sha256, population: s.population, units: s.units, transports: s.transports, saveBytes: s.save.length })),
    scripts,
    runs,
    metrics,
    ratios: ratios(metrics, config.modes),
    readModel,
    validation: { ok: v.errors.length === 0, ...v },
    limitations: limitations(config),
  };
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1) + "\n");
  writeFileSync(join(out, "metrics.csv"), metricsCsv(results.metrics));
  writeFileSync(join(out, "ratios.csv"), ratiosCsv(results.ratios));
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
  for (const k of ["commit", "skipBuild", "config", "enginePackage", "scenarios", "machine"]) {
    if (JSON.stringify(saved[k]) === JSON.stringify(expected[k])) continue;
    // Name the options that differ, so a resume can repeat them.
    const a = (saved[k] ?? {}) as Record<string, unknown>;
    const b = (expected[k] ?? {}) as Record<string, unknown>;
    const fields = k === "config" ? [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f])) : [];
    throw new Error(`cannot resume ${dir}: its ${k} differs from this run's${fields.length ? ` (${fields.join(", ")}; pass the options the run started with)` : ""}`);
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

export interface ReadModelResults {
  schema: 1;
  generatedAt: string;
  commit: string;
  dirty: boolean;
  appVersion: string;
  node: string;
  config: Pick<WorkerConfig, "steps" | "dt" | "batch" | "quick">;
  scenarios: { name: string; sha256: string }[];
  readModel: ReadModelShape[];
  limitations: string[];
}

/** `npm run perf:worker -- --read-model`: the read model section alone, on
 *  the hosted rows' steps, in Node in a few seconds. Writes read-model.json
 *  and report.md to its own results folder. */
async function readModelMain(args: Args, repo: string): Promise<number> {
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const tree = buildTree(repo);
  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}`);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const generatedAt = new Date().toISOString();
  const out = args.out ? resolve(repo, args.out) : resolve(repo, "docs/performance/results", `${generatedAt.slice(0, 10)}-${tree.commit.slice(0, 7)}-read-model${args.quick ? "-quick" : ""}${tree.dirty ? "-dirty" : ""}`);
  if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
  const readModel = scenarios.map((s) => {
    log(`perf:worker: read model shape, ${s.name}`);
    return measureReadModel(s, { steps: config.steps, dt: config.dt, batch: config.batch });
  });
  const res: ReadModelResults = {
    schema: 1,
    generatedAt,
    commit: tree.commit,
    dirty: tree.dirty,
    appVersion: (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version: string }).version,
    node: process.version,
    config: { steps: config.steps, dt: config.dt, batch: config.batch, quick: config.quick },
    scenarios: scenarios.map((s) => ({ name: s.name, sha256: s.sha256 })),
    readModel,
    limitations: readModelLimitations(config),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "read-model.json"), JSON.stringify(res, null, 1) + "\n");
  writeFileSync(join(out, "report.md"), readModelMarkdown(res));
  log(`perf:worker: wrote ${out}`);
  return 0;
}
