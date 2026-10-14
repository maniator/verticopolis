import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import { markdown } from "./report";

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
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { reps: 10, quick: false, skipBuild: false, out: null, resume: null, scenarios: null };
  let repsSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === "--quick") a.quick = true;
    else if (arg === "--skip-build") a.skipBuild = true;
    else if (arg === "--reps") {
      a.reps = Number(next());
      repsSet = true;
      if (!Number.isInteger(a.reps) || a.reps < 1) throw new Error("--reps must be a positive integer");
    } else if (arg === "--out") a.out = next();
    else if (arg === "--resume") a.resume = next();
    else if (arg === "--scenarios") a.scenarios = next().split(",").filter(Boolean);
    else throw new Error(`unknown argument ${arg}; expected --reps N, --quick, --skip-build, --out DIR, --resume DIR, --scenarios a,b`);
  }
  if (a.quick && !repsSet) a.reps = 2;
  if (a.resume && a.out) throw new Error("--resume continues its own folder; it takes no --out");
  return a;
}

export const MODES: readonly ModeName[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];

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
    // A phone-sized CSS viewport: at 1280x720 this machine's software
    // rasterizer drew one frame in about 250 ms, past the 200 ms clamp, so
    // every mode's frames ran almost no simulation (see LIMITATIONS).
    viewport: { width: 640, height: 360 },
    scenarios,
    modes: [...MODES],
    quick: args.quick,
  };
}

export const LIMITATIONS = [
  "One machine, headless Chromium in a container, software WebGL (see the renderer line): render cost dominates every frame, so the FPS rows say more about how much main-thread time each host leaves the renderer than about GPU-backed frame rates.",
  "CPU throttling is DevTools emulation of the renderer process. The engine worker runs in the same renderer process, so the 4x rows slow it too; whether emulation throttles a worker thread exactly as it throttles the main thread was not measured.",
  "Hosted rows run 720 steps of 2 minutes in batches of four (the frame loop's cap) with no rendering. Wall time includes the worker host's wait for each reply; main-thread time counts the steps, the flushes and the time applying replies, and leaves the worker's own time out (reported apart).",
  "The worker host keeps one batch in flight. A frame that finds a batch still out takes no steps (the frame loop banks its minutes under the 30-minute cap), so on a tower the engine cannot step in real time the worker host simulates fewer minutes per second rather than queueing work; the sim-minutes-per-second row shows it.",
  "Command latency times a tower rename (relayed by every host, read by nothing in the simulation) to the first frame drawn after the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame. One command is in flight at a time, one per second.",
  "Memory is measured after 30 steps on a freshly loaded page, after a forced GC. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).",
  "Frames render at a 640x360 CSS viewport (a common phone size), smaller than perf:compare's 1280x720: on this machine's software rasterizer a 1280x720 frame took about 250 ms, past Excalibur's 200 ms clamp (a longer frame is handed 1 ms of game time), so no mode simulated anything in its frames. Rows with clamped frames still understate the simulation work; the clamped-frame row counts them.",
  "Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.",
];

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env });
}

/** Sizes of the app's own scripts in a build: the engine worker chunk and
 *  every other JavaScript asset, raw and Brotli 11. */
export function scriptSizes(dist: string): { worker: { raw: number; brotli: number } | null; otherJs: { raw: number; brotli: number } } {
  const assets = join(dist, "assets");
  let worker: { raw: number; brotli: number } | null = null;
  const other = { raw: 0, brotli: 0 };
  for (const f of readdirSync(assets)) {
    if (!f.endsWith(".js")) continue;
    const buf = readFileSync(join(assets, f));
    const size = { raw: statSync(join(assets, f)).size, brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
    if (f.startsWith("engineWorker-")) worker = size;
    else {
      other.raw += size.raw;
      other.brotli += size.brotli;
    }
  }
  return { worker, otherJs: other };
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
  validation: { ok: boolean; errors: string[]; warnings: string[] };
  limitations: string[];
}

export function metricsCsv(metrics: readonly Metric[]): string {
  const rows = ["group,scenario,throttle,metric,unit,mode,n,median,ci_low,ci_high,mean,cv,values"];
  for (const m of metrics) {
    const s = m.summary;
    rows.push([m.group, m.scenario, m.throttle, JSON.stringify(m.metric), m.unit, m.mode, s?.n ?? 0, s?.median ?? "", s?.medianCiLow ?? "", s?.medianCiHigh ?? "", s?.mean ?? "", s?.cv ?? "", JSON.stringify(m.values.join(" "))].join(","));
  }
  return rows.join("\n") + "\n";
}

export function ratiosCsv(rs: readonly Ratio[]): string {
  const rows = ["group,scenario,throttle,metric,mode,against,ratio,ci_low,ci_high,pairs,verdict"];
  for (const r of rs) rows.push([r.group, r.scenario, r.throttle, JSON.stringify(r.metric), r.mode, r.against, r.ratio, r.ciLow ?? "", r.ciHigh ?? "", r.n, r.verdict].join(","));
  return rows.join("\n") + "\n";
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const startedAt = new Date().toISOString();
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
  const executablePath = process.env.PW_CHROMIUM_PATH ?? null;
  const meta = { commit: environment.commit, dirty: environment.dirty, config, enginePackage: environment.enginePackage, scenarios: scenarios.map((s) => s.sha256), machine: machineOf(environment, executablePath) };
  const runs: ModeRun[] = [];
  let out: string;
  if (args.resume) {
    out = resolve(repo, args.resume);
    if (environment.dirty) throw new Error("--resume needs a clean tree");
    const saved = JSON.parse(readFileSync(join(out, "checkpoint.json"), "utf8")) as typeof meta & { startedAt: string };
    for (const k of ["commit", "config", "enginePackage", "scenarios", "machine"] as const) {
      if (JSON.stringify(saved[k]) !== JSON.stringify(meta[k])) throw new Error(`cannot resume ${out}: its ${k} differs from this run's`);
    }
    for (const line of readFileSync(join(out, "runs.jsonl"), "utf8").split("\n")) if (line.trim()) runs.push(JSON.parse(line) as ModeRun);
    log(`perf:worker: resuming ${out} with ${runs.length} finished run(s)`);
  } else {
    const day = startedAt.slice(0, 10);
    out = args.out ? resolve(repo, args.out) : resolve(repo, "docs/performance/results", `${day}-${environment.commitShort}-worker${args.quick ? "-quick" : ""}${environment.dirty ? "-dirty" : ""}`);
    if (existsSync(out)) throw new Error(`${out} already exists; results are never overwritten`);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "checkpoint.json"), JSON.stringify({ ...meta, startedAt }, null, 1) + "\n");
    writeFileSync(join(out, "runs.jsonl"), "");
  }
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
    scripts: scriptSizes(dist),
    runs,
    metrics,
    ratios: ratios(metrics, config.modes),
    validation: { ok: v.errors.length === 0, ...v },
    limitations: LIMITATIONS,
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
