import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { analyzeBundle } from "./bundle";
import { buildTree, collectEnvironment, ENGINE_PACKAGE_FILES, packageState, type Environment, type PackageState } from "./env";
import { buildLimitations } from "./limitations";
import { gateBrowser, probeBrowser, type BrowserProbe } from "./browserProbe";
import { checkExceptionFolder, exceptionMarker, resolveLaunch } from "./exceptionRegister";
import { browserName, recordedGpuVerified, type BrowserLaunch } from "./renderer";
import { aggregate, compareEngines, missingSamples } from "./metrics";
import { measureChurn } from "./churn";
import { checkScenario, loadWebPackage } from "./nodeCheck";
import { comparisonsCsv, markdownReport, rawCsv, summaryCsv } from "./report";
import { engineOrder, runProcess } from "./runner";
import { autosaveSeed, checkAutosaveSeeds } from "./savedStart";
import { buildScenarios } from "./scenarios";
import { startServer } from "./server";
import type { CompareConfig, CompareResults, EngineName, ProcessRun } from "./types";
import type { Environment as Env } from "./env";
import { incompleteTreeError } from "./treeRecord";
import { validateResults } from "./validate";
import { buildProduction, buildTooling } from "../perfWorker/build";

/**
 * `npm run perf:compare` (issue #972): build the production app and a
 * tooling build of the same sources, check both engines agree in Node, run
 * every repetition of both engines in fresh browser processes, and write
 * results.json, the CSVs and report.md. Exits 1 when the validation fails
 * (a WASM fallback, a state mismatch, a failed run, incomparable runs); the
 * results are written either way, failures included.
 */

export interface Args {
  reps: number;
  quick: boolean;
  skipBuild: boolean;
  out: string | null;
  /** A results folder whose run stopped part way: continue it. */
  resume: string | null;
  scenarios: string[] | null;
  throttles: number[] | null;
  /** `--aa ts|wasm`: an A/A pass, the same engine in both slots. */
  aa: EngineName | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { reps: 10, quick: false, skipBuild: false, out: null, resume: null, scenarios: null, throttles: null, aa: null };
  let repsSet = false;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`${arg} is given twice`);
    seen.add(arg);
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
    else if (arg === "--scenarios") {
      a.scenarios = next().split(",").filter(Boolean);
      if (a.scenarios.length === 0) throw new Error("--scenarios needs at least one name");
      if (new Set(a.scenarios).size !== a.scenarios.length) throw new Error("--scenarios names a scenario twice");
    } else if (arg === "--throttles") {
      a.throttles = next().split(",").map(Number);
      if (a.throttles.some((t) => !Number.isFinite(t) || t < 1 || t > 20)) throw new Error("--throttles takes rates from 1 to 20, comma separated");
      if (new Set(a.throttles).size !== a.throttles.length) throw new Error("--throttles names a rate twice");
    } else if (arg === "--aa") {
      const v = next();
      if (v !== "ts" && v !== "wasm") throw new Error("--aa takes the engine to run in both slots: ts or wasm");
      a.aa = v;
    } else throw new Error(`unknown argument ${arg}; expected --reps N, --quick, --skip-build, --out DIR, --resume DIR, --scenarios a,b, --throttles 1,4, --aa ts|wasm`);
  }
  if (a.quick && !repsSet) a.reps = 2;
  if (a.resume && a.out) throw new Error("--resume continues its own folder; it takes no --out");
  return a;
}

export function makeConfig(args: Args, scenarioNames: string[]): CompareConfig {
  return {
    reps: args.reps,
    dt: 2,
    steps: args.quick ? 90 : 720,
    warmSteps: args.quick ? 30 : 120,
    throttles: args.throttles ?? [1, 4],
    frameWindowMs: args.quick ? 3000 : 15_000,
    frameWarmMs: args.quick ? 1000 : 2000,
    speed: 3,
    viewport: { width: 1280, height: 720 },
    scenarios: scenarioNames,
    quick: args.quick,
    aa: args.aa,
  };
}

/** The five files of a results folder. Every one of them carries the A/A
 *  marker when `results.config.aa` is set. */
export function writeResultFiles(out: string, results: CompareResults): void {
  const aa = results.config.aa;
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1) + "\n");
  writeFileSync(join(out, "metrics.csv"), summaryCsv(results.metrics, aa));
  writeFileSync(join(out, "raw.csv"), rawCsv(results.metrics, aa));
  writeFileSync(join(out, "comparisons.csv"), comparisonsCsv(results.comparisons, aa));
  writeFileSync(join(out, "report.md"), markdownReport(results));
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const startedAt = new Date().toISOString();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const dist = join(repo, "dist");
  const distPerf = join(repo, "dist-perf");
  // The browser is settled first: launch settings are parsed and the adapter
  // is read before any build or results folder exists, so a setting that does
  // not reach the GPU fails in seconds.
  const launch = resolveLaunch(process.env, repo);
  const executablePath = process.env.PW_CHROMIUM_PATH || null;
  const probe = await probeBrowser(executablePath, launch);
  for (const w of gateBrowser(probe, args.quick, launch, executablePath)) log(`perf:compare: warning: ${w}`);
  log(`perf:compare: ${browserName(launch.channel, executablePath)} ${probe.version}${launch.channel ? ` (channel ${launch.channel})` : ""}, WebGL renderer ${probe.renderer ?? "none"}`);
  if (!existsSync(join(repo, "src/public/engine/verticopolis_engine_bg.wasm"))) {
    throw new Error("the engine package src/public/engine/ is missing: build it first with `bash scripts/build-engine-wasm.sh` where that script exists (it installs the pinned toolchain), or `npm run wasm:build` (needs the wasm32 target and the pinned wasm-bindgen CLI)");
  }
  // Which tree the builds came from, stamped beside them (gitignored), so a
  // --skip-build run can prove its builds are this commit's.
  const stampPaths = [join(dist, ".perf-build.json"), join(distPerf, ".perf-build.json")];
  const tree = buildTree(repo);
  if (!args.skipBuild) {
    log("perf:compare: production build (npm run build)");
    buildProduction(repo);
    log("perf:compare: tooling build of the same sources (VC_TOOLING=1) into dist-perf/");
    buildTooling(repo, distPerf);
    for (const p of stampPaths) writeFileSync(p, JSON.stringify(tree) + "\n");
  }
  for (const d of [dist, distPerf]) if (!existsSync(join(d, "index.html"))) throw new Error(`no build at ${d}; run without --skip-build`);

  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}; expected ${all.map((s) => s.name).join(",")}`);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const environment = collectEnvironment(repo, distPerf, sourceHash);
  // Fail closed before measuring anything: a run on a package that cannot
  // be tied to these sources would spend hours on numbers that cannot pass.
  const packageProblems = packageErrors(packageState(distPerf), packageState(dist), sourceHash);
  if (packageProblems.length) throw new Error(`the engine package cannot be tied to this tree:\n  - ${packageProblems.join("\n  - ")}`);

  // The results folder is chosen up front: every finished process run is
  // checkpointed into it, so a run cut short (a killed shell, a restarted
  // machine) continues with --resume instead of starting over.
  // A --skip-build run proves its builds are this clean commit's before it
  // measures anything (and so before a checkpoint can carry its runs).
  if (args.skipBuild) {
    const errs = stampErrors(stampPaths, tree);
    if (errs.length) throw new Error(errs.join("; "));
  }
  const meta: CheckpointMeta = {
    commit: environment.commit,
    dirty: environment.dirty,
    skipBuild: args.skipBuild,
    config,
    enginePackage: environment.enginePackage,
    scenarios: scenarios.map((s) => s.sha256),
    machine: machineOf(environment, executablePath, launch, probe),
    startedAt,
  };
  let out: string;
  const runs: ProcessRun[] = [];
  let interruptedAttempts: { rep: number; engine: string; at: string }[] = [];
  const resumes: { at: string; runsFromCheckpoint: number }[] = [];
  if (args.resume) {
    out = resolve(repo, args.resume);
    if (environment.dirty) throw new Error("--resume needs a clean tree, the same one the run started on");
    const cp = loadCheckpoint(out, meta);
    runs.push(...cp.runs);
    interruptedAttempts = cp.interrupted;
    resumes.push(...cp.resumes, { at: startedAt, runsFromCheckpoint: cp.runs.length });
    meta.startedAt = cp.startedAt;
    appendFileSync(join(out, CHECKPOINT_RUNS), JSON.stringify({ resumed: startedAt, runsFromCheckpoint: cp.runs.length }) + "\n");
    log(`perf:compare: resuming ${out} with ${runs.length} finished process run(s)${interruptedAttempts.length ? `; ${interruptedAttempts.length} attempt(s) were interrupted and run again` : ""}`);
  } else {
    out = outputDir(repo, args, startedAt.slice(0, 10), environment, existsSync, launch.rendererException);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, CHECKPOINT_META), JSON.stringify(meta, null, 1) + "\n");
    writeFileSync(join(out, CHECKPOINT_RUNS), "");
  }
  log(`perf:compare: measuring ${environment.commit}${environment.dirty ? " (dirty tree)" : ""}; origin/main is ${environment.mainCommit ?? "unknown"}${environment.behindMain !== null ? `, ${environment.behindMain} commit(s) not in this tree` : ""}`);
  log("perf:compare: Node conformance check of both engines on every scenario");
  const mod = await loadWebPackage(join(distPerf, "engine"));
  const nodeChecks = scenarios.map((sc, i) => checkScenario(mod, sc, config.steps, config.dt, config.warmSteps, i % 2 === 0 ? "ts-first" : "wasm-first"));
  for (const c of nodeChecks) log(`  ${c.scenario}: ${c.match ? "engines agree" : "ENGINES DISAGREE"} (Node: ts ${c.nodeTsMs.toFixed(0)} ms, wasm ${c.nodeWasmMs.toFixed(0)} ms)`);
  // Hourly save churn on the WASM engine; no TypeScript side, so an A/A pass
  // of TypeScript has nothing to add and an A/A pass of WASM repeats it.
  const churn = scenarios.map((sc) => measureChurn(mod, sc, Math.max(1, Math.floor((config.steps * config.dt) / 60)), config.dt, config.warmSteps));
  for (const c of churn) log(`  ${c.scenario}: hourly save churn median ${(c.medianShare * 100).toFixed(1)}%, p95 ${(c.p95Share * 100).toFixed(1)}% of ${c.saveChars} characters`);
  // The saved-tower starts' seeds, packed and read back before any browser runs (#1254).
  checkAutosaveSeeds(scenarios);
  log(`perf:compare: each scenario's autosave seed loads back as its tower (${scenarios.map((s) => `${s.name} ${autosaveSeed(s).sha256.slice(0, 12)}`).join(", ")})`);

  const server = await startServer(distPerf);
  let browserVersion: string | null = runs.find((r) => r.browserVersion)?.browserVersion ?? null;
  try {
    for (let rep = 0; rep < config.reps; rep++) {
      let order = 0;
      for (const engine of engineOrder(rep)) {
        const position = order++;
        if (runs.some((r) => r.rep === rep && r.engine === engine)) continue; // checkpointed
        log(`perf:compare: rep ${rep + 1}/${config.reps}, ${engine}`);
        // A marker first, so an attempt killed mid-way is reported, never
        // silently replaced by its rerun.
        appendFileSync(join(out, CHECKPOINT_RUNS), JSON.stringify({ started: { rep, engine, at: new Date().toISOString() } }) + "\n");
        const run = await runProcess({ server, config, scenarios, executablePath, launch, log }, rep, engine, position);
        browserVersion ??= run.browserVersion;
        runs.push(run);
        appendFileSync(join(out, CHECKPOINT_RUNS), JSON.stringify(run) + "\n");
      }
    }
  } finally {
    await server.close();
  }

  const validation = validateResults(config, runs, nodeChecks, launch.rendererException);
  // Checked again after the runs, against the package recorded before them
  // (the two ends only).
  for (const e of packageErrors(packageState(distPerf), packageState(dist), sourceHash, { files: environment.enginePackage, buildHash: environment.engineBuildHash })) validation.errors.push(e);
  if (environment.commit === "unknown") validation.errors.push("the commit could not be read (git failed), so the results cannot be tied to a tree");
  const treeError = incompleteTreeError(environment.tree);
  if (treeError) validation.errors.push(treeError);
  if (environment.mainCommit && !environment.mainFetched) validation.warnings.push(`origin/main could not be fetched just now, so ${environment.mainCommit} is the ref as last fetched and may not be the latest main`);
  if (!environment.mainCommit) validation.warnings.push("origin/main is unknown here (no remote or no fetch), so whether this is a baseline of the latest main was not checked");
  for (const a of interruptedAttempts) validation.warnings.push(`rep ${a.rep} ${a.engine}: an attempt started at ${a.at} was interrupted (the run was stopped and resumed) and ran again; its partial measurements were not kept`);
  if (resumes.length) validation.warnings.push(`the run was resumed ${resumes.length} time(s) (${resumes.map((r) => r.at).join(", ")}); the checkpoint proved the same commit, build mode, configuration, engine bytes, scenarios, machine and toolchain, and validation checked that every process ran the same browser build`);
  if (environment.dirty) validation.warnings.push("the working tree had uncommitted or untracked changes; the results folder is marked -dirty");
  if (environment.behindMain) validation.warnings.push(`the measured tree lacks ${environment.behindMain} commit(s) of origin/main (${environment.mainCommit}); it is not a baseline of the latest main`);
  const metrics = aggregate(runs, config.scenarios, config.throttles, config.aa);
  // Pairs with a zero TypeScript median (WASM-only bytes, no clamped
  // frames) get no ratio; the report lists them per engine instead.
  const comparisons = compareEngines(metrics, [], config.aa);
  for (const w of missingSamples(metrics, runs)) validation.warnings.push(w);
  validation.ok = validation.errors.length === 0;
  const bundle = analyzeBundle(dist);
  const toolingBundle = analyzeBundle(distPerf);
  const renderers = [...new Set(runs.filter((r) => r.ok).flatMap((r) => [r.page?.webgl?.renderer, r.rendererEnd, r.rendererEndCold]).filter((x): x is string => !!x))];
  const results: CompareResults = {
    schema: 1,
    startedAt: meta.startedAt,
    resumes,
    interruptedAttempts,
    generatedAt: new Date().toISOString(),
    issue: "maniator/verticopolis#972",
    config,
    environment,
    browser: { version: browserVersion, headless: true, executable: executablePath, channel: launch.channel, args: launch.args, rendererException: launch.rendererException, rendererExceptionSha256: launch.rendererExceptionSha256, rendererExceptionCommit: launch.rendererExceptionCommit, gpuVerified: recordedGpuVerified(launch.rendererException, runs.filter((r) => r.ok).map((r) => r.page?.webgl?.renderer), runs.filter((r) => r.ok).map((r) => r.rendererEnd), runs.filter((r) => r.ok).map((r) => r.rendererEndCold)) },
    scenarios: scenarios.map((s) => ({ name: s.name, description: s.description, sha256: s.sha256, population: s.population, units: s.units, transports: s.transports, saveBytes: s.save.length })),
    nodeChecks,
    churn,
    runs,
    bundle,
    toolingBundleTotals: toolingBundle.totals,
    metrics,
    comparisons,
    validation,
    limitations: buildLimitations(config.aa, environment.appVersion, renderers, launch.rendererException),
  };

  writeResultFiles(out, results);
  // results.json now holds every run; the checkpoint files are spent.
  rmSync(join(out, CHECKPOINT_RUNS), { force: true });
  rmSync(join(out, CHECKPOINT_META), { force: true });
  log(`perf:compare: wrote ${out}`);
  if (!validation.ok) {
    log("perf:compare: VALIDATION FAILED:");
    for (const e of validation.errors) log(`  - ${e}`);
    return 1;
  }
  for (const w of validation.warnings) log(`  warning: ${w}`);
  return 0;
}

/**
 * The engine package checks, all fail-closed. `perf` is dist-perf/ (the
 * timed build), `prod` is dist/ (the sizes), `sourceHash` the current
 * engine-rs sources' hash. Each build must hold the whole package, both
 * builds must serve the same bytes, and the timed build's BUILD.json must
 * record these sources. Besides the sources hash, BUILD.json (schema 2) records
 * the digest and size of the glue and the binary, but these checks do not
 * compare them yet, so they tie the package to the sources only as far as the
 * build that wrote it was honest. A checkout without engine-rs sources
 * fails, since then nothing proves which engine ran. `recorded`, given after
 * the runs, is the package recorded before them.
 */
export function packageErrors(perf: PackageState, prod: PackageState, sourceHash: string | null, recorded?: Pick<PackageState, "files" | "buildHash">): string[] {
  const errors: string[] = [];
  const sorted = (files: Record<string, string>) => JSON.stringify(Object.entries(files).sort(([a], [b]) => Number(a > b) - Number(a < b)));
  const why = (b: PackageState) => b.buildProblem ?? "has no source hash";
  for (const [name, build] of [["dist-perf/", perf], ["dist/", prod]] as const) {
    const missing = ENGINE_PACKAGE_FILES.filter((f) => !(f in build.files));
    if (missing.length === ENGINE_PACKAGE_FILES.length) errors.push(`${name} serves no engine package, so the WASM engine could not have run`);
    else if (missing.length) errors.push(`${name} serves an incomplete engine package (missing or unreadable: ${missing.join(", ")})`);
  }
  if (sorted(perf.files) !== sorted(prod.files)) errors.push(`dist/ and dist-perf/ serve different engine bytes (${sorted(prod.files)} vs ${sorted(perf.files)})`);
  if (!sourceHash) errors.push("no engine-rs sources in this checkout, so the package's source hash cannot be checked; run from a full checkout");
  if (!perf.buildHash) errors.push(`the served engine package (dist-perf/) ${why(perf)}, so which sources it came from is unknown`);
  else if (sourceHash && perf.buildHash !== sourceHash) errors.push(`the served engine package (${perf.buildHash}) was not built from the current engine-rs sources (${sourceHash}); rebuild it with npm run wasm:build`);
  if (!prod.buildHash && !perf.buildHash) errors.push(`the sizes build (dist/) ${why(prod)}${why(prod) === why(perf) ? " too" : ""}; rebuild without --skip-build`);
  if (prod.buildHash !== perf.buildHash) errors.push(`dist/ (sizes) and dist-perf/ (timings) carry different engine packages (${prod.buildHash ?? `none: dist/ ${why(prod)}`} vs ${perf.buildHash ?? `none: dist-perf/ ${why(perf)}`}); rebuild without --skip-build`);
  // After the runs: the timed build's package must still be the one recorded
  // before them. This compares the two ends only; a build swapped and
  // restored between them is not caught.
  if (recorded && (sorted(recorded.files) !== sorted(perf.files) || recorded.buildHash !== perf.buildHash)) errors.push(`the engine package in dist-perf/ changed during the run (recorded ${sorted(recorded.files)} with ${recorded.buildHash ?? "no source hash"}, now ${sorted(perf.files)} with ${perf.buildHash ?? "no source hash"})`);
  return errors;
}

/**
 * Where the results go. The default is a new folder per run under
 * docs/performance/results, named by date and commit (with -quick,
 * -skipbuild (the builds were not made for this commit) and -dirty marks), and never an existing one: a second run of the same day
 * and commit gets -2, -3, and so on, so no result is overwritten. An
 * explicit --out must not exist yet either.
 */
export function outputDir(repo: string, args: Pick<Args, "out" | "quick" | "skipBuild" | "aa">, day: string, env: Pick<Environment, "commitShort" | "dirty">, exists: (p: string) => boolean = existsSync, rendererException: string | null = null): string {
  if (args.out) {
    // Only the folder's own name counts, and in lower case, because the results are written on case-insensitive disks too.
    const name = basename(resolve(repo, args.out));
    const lower = name.toLowerCase();
    checkExceptionFolder(name, rendererException);
    if (args.aa) {
      const other = args.aa === "ts" ? "wasm" : "ts";
      if (!lower.includes(`aa-${args.aa}`)) throw new Error(`--aa ${args.aa} needs an --out folder name containing aa-${args.aa}, so the folder cannot be mistaken for a comparison`);
      if (lower.includes(`aa-${other}`)) throw new Error(`--aa ${args.aa} cannot write to ${name}, which also names the aa-${other} marker`);
    } else if (/aa-(ts|wasm)/.test(lower)) throw new Error(`--out ${name} names an A/A folder, but this run is a comparison; pass --aa ts|wasm or pick another name`);
    const out = resolve(repo, args.out);
    if (exists(out)) throw new Error(`${out} already exists; results are never overwritten`);
    return out;
  }
  const base = resolve(repo, "docs/performance/results", `${day}-${env.commitShort}${args.quick ? "-quick" : ""}${args.aa ? `-aa-${args.aa}` : ""}${args.skipBuild ? "-skipbuild" : ""}${rendererException ? `-${exceptionMarker(rendererException)}` : ""}${env.dirty ? "-dirty" : ""}`);
  let out = base;
  for (let n = 2; exists(out); n++) out = `${base}-${n}`;
  return out;
}

/** What is wrong with the build stamps for a --skip-build run, if
 *  anything: each build (dist/ for the sizes, dist-perf/ for the timings)
 *  must carry a readable stamp from this same clean commit. */
export function stampErrors(paths: readonly string[], tree: { commit: string; dirty: boolean }, read: (p: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null)): string[] {
  const out: string[] = [];
  for (const p of paths) {
    let text: string | null;
    try {
      text = read(p);
    } catch {
      // A directory or an unreadable file in the stamp's place: an error to
      // report, never a crash after the measurements.
      out.push(`--skip-build: ${p} cannot be read; run once without --skip-build`);
      continue;
    }
    if (text === null) {
      out.push(`--skip-build: ${p} is missing, so which tree that build came from is unknown; run once without --skip-build`);
      continue;
    }
    let stamp: { commit?: unknown; dirty?: unknown };
    try {
      stamp = JSON.parse(text) as { commit?: unknown; dirty?: unknown };
    } catch {
      out.push(`--skip-build: ${p} is unreadable; run once without --skip-build`);
      continue;
    }
    if (typeof stamp.commit !== "string" || typeof stamp.dirty !== "boolean") out.push(`--skip-build: ${p} is not a build stamp this harness wrote; run once without --skip-build`);
    else if (stamp.commit !== tree.commit || stamp.dirty || tree.dirty) out.push(`--skip-build: ${p} came from ${stamp.commit}${stamp.dirty ? " (dirty)" : ""}, the tree is ${tree.commit}${tree.dirty ? " (dirty)" : ""}; rebuild without --skip-build`);
  }
  return out;
}

export const CHECKPOINT_META = "checkpoint.json";
export const CHECKPOINT_RUNS = "runs.jsonl";

/** What a run in progress records about itself, so a resume can prove it
 *  continues the same measurement: the tree (clean or not) and how it was
 *  built, the configuration, the served engine bytes, the scenario saves,
 *  and the machine and toolchain it ran on. */
export interface CheckpointMeta {
  commit: string;
  dirty: boolean;
  skipBuild: boolean;
  config: CompareConfig;
  enginePackage: Env["enginePackage"];
  scenarios: string[];
  machine: Record<string, string | number | null>;
  startedAt: string;
}

/** The machine and toolchain fields a resume must match. */
export function machineOf(env: Env, executablePath: string | null, launch?: BrowserLaunch, probe?: BrowserProbe): Record<string, string | number | null> {
  // The launch settings, the browser build and the adapter are part of the
  // identity: a resume with a different channel, switch, browser update or
  // renderer would mix incompatible processes in one results folder.
  // Main's commit is a record, not an identity: any unrelated merge to main would otherwise refuse the resume.
  const { rendererExceptionCommit: _commit, ...identity } = launch ?? {};
  const browser: Record<string, string | null> = launch ? { launch: JSON.stringify(identity) } : {};
  if (probe) {
    browser.browserVersion = probe.version;
    browser.renderer = probe.renderer;
  }
  return { ...browser, cpuModel: env.cpuModel, logicalCpus: env.logicalCpus, totalMemoryBytes: env.totalMemoryBytes, os: env.os, kernel: env.kernel, arch: env.arch, node: env.node, rust: env.rust, playwright: env.playwright, executablePath };
}

/**
 * Read a stopped run's checkpoint for --resume: the finished process runs
 * so far, the attempts that started and never finished, earlier resumes,
 * and when the run began. Refuses a folder that already holds final
 * results, a run that started on a dirty tree, and one whose commit, build
 * mode, configuration, engine bytes, scenario saves, machine or toolchain
 * differ from this run's. A last line cut off by the stop is cut from the
 * file (so the next append starts clean); a bad line anywhere else is an
 * error, never skipped.
 */
export function loadCheckpoint(
  dir: string,
  expected: Omit<CheckpointMeta, "startedAt">,
  read: (p: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  // In place: shortening the file never empties it, so a stop during the
  // cut cannot lose the finished runs before the cut.
  cut: (p: string, length: number) => void = (p, length) => truncateSync(p, length),
): { runs: ProcessRun[]; interrupted: { rep: number; engine: string; at: string }[]; resumes: { at: string; runsFromCheckpoint: number }[]; startedAt: string } {
  if (read(join(dir, "results.json")) !== null) throw new Error(`${dir} already holds final results; nothing to resume`);
  const metaText = read(join(dir, CHECKPOINT_META));
  if (metaText === null) throw new Error(`${dir} has no ${CHECKPOINT_META}; nothing to resume`);
  const meta = JSON.parse(metaText) as CheckpointMeta;
  if (meta.dirty) throw new Error(`cannot resume ${dir}: it started on a dirty tree, so its first runs measured uncommitted code`);
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ["commit", "skipBuild", "config", "enginePackage", "scenarios", "machine"] as const) {
    if (!same(meta[key], expected[key])) throw new Error(`cannot resume ${dir}: its ${key} differs from this run's (${JSON.stringify(meta[key])} vs ${JSON.stringify(expected[key])})`);
  }
  const path = join(dir, CHECKPOINT_RUNS);
  let text = read(path) ?? "";
  if (text && !text.endsWith("\n")) {
    text = text.slice(0, text.lastIndexOf("\n") + 1); // the line the stop cut off
    cut(path, Buffer.byteLength(text, "utf8"));
  }
  const runs: ProcessRun[] = [];
  const started: { rep: number; engine: string; at: string }[] = [];
  const resumes: { at: string; runsFromCheckpoint: number }[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`cannot resume ${dir}: line ${i + 1} of ${CHECKPOINT_RUNS} is not JSON`);
    }
    const bad = () => new Error(`cannot resume ${dir}: line ${i + 1} of ${CHECKPOINT_RUNS} is neither a run, a start marker nor a resume record`);
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw bad();
    if (entry.started) started.push(entry.started as { rep: number; engine: string; at: string });
    else if (entry.resumed) resumes.push({ at: String(entry.resumed), runsFromCheckpoint: Number(entry.runsFromCheckpoint) });
    else if (typeof entry.rep === "number" && (entry.engine === "ts" || entry.engine === "wasm") && typeof entry.scenarios === "object" && entry.scenarios !== null) {
      const ran = entry.ranEngine ?? entry.engine;
      if (ran !== (expected.config.aa ?? entry.engine)) throw new Error(`cannot resume ${dir}: line ${i + 1} of ${CHECKPOINT_RUNS} ran ${String(ran)} where this run's configuration calls for ${expected.config.aa ?? entry.engine}`);
      runs.push(entry as unknown as ProcessRun);
    }
    else throw bad();
  });
  // An attempt with no run after it was interrupted.
  const interrupted = started.filter((s, i) => !runs.some((r) => r.rep === s.rep && r.engine === s.engine) || started.slice(i + 1).some((t) => t.rep === s.rep && t.engine === s.engine));
  return { runs, interrupted, resumes, startedAt: meta.startedAt };
}
