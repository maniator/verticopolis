import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { analyzeBundle } from "./bundle";
import { buildTree, collectEnvironment, engineBuildHash, enginePackageDigests, type Environment } from "./env";
import { aggregate, compareEngines, missingSamples } from "./metrics";
import { checkScenario, loadWebPackage } from "./nodeCheck";
import { comparisonsCsv, markdownReport, rawCsv, summaryCsv } from "./report";
import { engineOrder, runProcess } from "./runner";
import { buildScenarios } from "./scenarios";
import { startServer } from "./server";
import type { CompareConfig, CompareResults, ProcessRun } from "./types";
import { validateResults } from "./validate";

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
  scenarios: string[] | null;
  throttles: number[] | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const a: Args = { reps: 10, quick: false, skipBuild: false, out: null, scenarios: null, throttles: null };
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
    else if (arg === "--scenarios") {
      a.scenarios = next().split(",").filter(Boolean);
      if (a.scenarios.length === 0) throw new Error("--scenarios needs at least one name");
      if (new Set(a.scenarios).size !== a.scenarios.length) throw new Error("--scenarios names a scenario twice");
    } else if (arg === "--throttles") {
      a.throttles = next().split(",").map(Number);
      if (a.throttles.some((t) => !Number.isFinite(t) || t < 1 || t > 20)) throw new Error("--throttles takes rates from 1 to 20, comma separated");
      if (new Set(a.throttles).size !== a.throttles.length) throw new Error("--throttles names a rate twice");
    } else throw new Error(`unknown argument ${arg}; expected --reps N, --quick, --skip-build, --out DIR, --scenarios a,b, --throttles 1,4`);
  }
  if (a.quick && !repsSet) a.reps = 2;
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
  };
}

const STATIC_LIMITATIONS = [
  "One machine, headless Chromium in a container. Spread is reported (CV, order-statistic intervals of the median, order-statistic intervals of the paired median ratios); results from other hardware, browsers or a GPU will differ.",
  "Frame rates come from a software WebGL rasterizer (see the WebGL renderer row), so render cost is much higher than on a GPU device and dominates the frame. The simulation-only rows are unaffected by rendering.",
  "Both engines run on the main thread. The WASM host keeps a TypeScript read model of the tower, refreshed from the engine's frame view after every step and from a full save merge whenever the tower revision moves or an in-game hour passes (src/wasmhost/wasmHost.ts). The hosted rows include that cost; the bare-engine rows do not.",
  "The step driver (the frame loop's owed-minute math and fixed step) is the TypeScript host's for both engines (#867), and commands still run on both the read model and the engine (#954). This benchmark times ticks, which the engine alone runs when hosted; it does not time player commands.",
  "Pages are served cross-origin isolated (COOP/COEP) so performance.now() resolves to about 5 microseconds instead of 100. The production site is not isolated; isolation does not change how either engine executes.",
  "Transfer sizes are what this harness's server sent: Brotli quality 11 or gzip level 9 static compression, Cache-Control per vercel.json. A CDN's compression levels and protocol overhead differ; headers are not counted.",
  "CPU throttling is Chromium's DevTools emulation (the renderer is paused in slices), not a slower CPU: it scales CPU time but not memory bandwidth or cache behavior. A fixed CPU probe runs under each throttle before every scenario's timed passes, at the start of each frame block and just after the throttled cold start, and must show at least half the nominal slowdown or the run fails. A probe shows the throttle held at that moment, not at every moment after it.",
  "Memory is measured per scenario in its own freshly loaded page, after the save is loaded and two in-game hours run, then a forced GC through the DevTools protocol. WASM linear memory only grows, so each WASM figure is that page's high-water mark, which includes the boot tower the page hosted before the save was loaded. The JS heap leaves linear memory out, so the comparable row is JS heap plus linear memory. Process PSS sums the browser's processes (Linux only).",
  "Frame-time accounting times sim.tick and ui.update directly; the rest of each frame (the Excalibur canvas render, the compositor, GC and idle time until the next frame) is reported as one remainder. Render cost is therefore not isolated from idle time.",
  "Ratios are paired by repetition (the two engines' processes ran back to back, order alternating) with a distribution-free 95% interval of the median ratio, and a verdict needs six pairs. Every row is its own 95% interval, so across the report's many rows a few verdicts can be wrong by chance; read single borderline rows with that in mind.",
  "Startup is measured to the moment the app publishes its tooling handle (window.game) and to the first frame after it; it uses a VC_TOOLING=1 build of the same sources, which only adds that handle. The before-ready and after-ready byte split is cut where a 10 ms poll first sees the handle. The 4x cold start runs in a second fresh context of the same browser process (fresh HTTP cache, warm process).",
  "Gameplay frame windows are wall-clock time, so the slower engine simulates fewer in-game minutes in them; the achieved sim speed is reported beside every frame row. A frame over 200 ms is handed 1 ms of elapsed time by Excalibur, so rows with clamped frames (counted in the frames-over-200-ms row) understate the simulation's share.",
  "Audio-off means the game's audio never started (no gesture, so the Tone.js chunk never loads); audio-on starts it the way a first click does, unmuted, with Chromium's autoplay policy relaxed for both engines. Headless Chromium plays to no device, so the audio thread's cost on real output hardware may differ.",
  "The WASM attribution (engine tick, exports the host reads, host JS) comes from a separate pass with wrappers on every method of the engine, never from the timed pass; the wrappers' own bookkeeping outside their timed window lands in the host JS share, so that share is an upper bound. The bare-engine (raw) rows tick a detached Engine and do not include the host's read-model sync.",
  "The incremental WASM download counts the engine package (binary, loader, BUILD.json). The WASM host code (src/wasmhost) is inside the shared app chunks and is counted there for both configurations (backlog row perf-compare-host-js-share).",
  "Node timings (outcome check table) are a secondary data point on Node's V8; the engine order alternates by scenario.",
  "This is a pre-3.0 baseline of an engine still being cut over (#945), not release performance. Every result directory is named by date and commit so later runs can be compared with it.",
];

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env });
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const startedAt = new Date().toISOString();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const dist = join(repo, "dist");
  const distPerf = join(repo, "dist-perf");
  if (!existsSync(join(repo, "src/public/engine/verticopolis_engine_bg.wasm"))) {
    throw new Error("the engine package src/public/engine/ is missing: build it first with `bash scripts/build-engine-wasm.sh` where that script exists (it installs the pinned toolchain), or `npm run wasm:build` (needs the wasm32 target and the pinned wasm-bindgen CLI)");
  }
  // Which tree the builds came from, stamped beside them (gitignored), so a
  // --skip-build run can prove its builds are this commit's.
  const stampPath = join(repo, "dist-perf", ".perf-build.json");
  const tree = buildTree(repo);
  if (!args.skipBuild) {
    log("perf:compare: production build (npm run build)");
    sh("npm", ["run", "build"], repo);
    log("perf:compare: tooling build of the same sources (VC_TOOLING=1) into dist-perf/");
    sh("npx", ["vite", "build", "--outDir", distPerf, "--emptyOutDir"], repo, { ...process.env, VC_TOOLING: "1" });
    writeFileSync(stampPath, JSON.stringify(tree) + "\n");
  }
  for (const d of [dist, distPerf]) if (!existsSync(join(d, "index.html"))) throw new Error(`no build at ${d}; run without --skip-build`);

  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}; expected ${all.map((s) => s.name).join(",")}`);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const environment = collectEnvironment(repo, distPerf, sourceHash);

  if (args.out && existsSync(resolve(repo, args.out))) throw new Error(`${resolve(repo, args.out)} already exists; results are never overwritten`);
  log(`perf:compare: measuring ${environment.commit}${environment.dirty ? " (dirty tree)" : ""}; origin/main is ${environment.mainCommit ?? "unknown"}${environment.behindMain !== null ? `, ${environment.behindMain} commit(s) not in this tree` : ""}`);
  log("perf:compare: Node conformance check of both engines on every scenario");
  const mod = await loadWebPackage(join(distPerf, "engine"));
  const nodeChecks = scenarios.map((sc, i) => checkScenario(mod, sc, config.steps, config.dt, config.warmSteps, i % 2 === 0 ? "ts-first" : "wasm-first"));
  for (const c of nodeChecks) log(`  ${c.scenario}: ${c.match ? "engines agree" : "ENGINES DISAGREE"} (Node: ts ${c.nodeTsMs.toFixed(0)} ms, wasm ${c.nodeWasmMs.toFixed(0)} ms)`);

  const server = await startServer(distPerf);
  const executablePath = process.env.PW_CHROMIUM_PATH ?? null;
  const runs: ProcessRun[] = [];
  let browserVersion: string | null = null;
  try {
    for (let rep = 0; rep < config.reps; rep++) {
      let order = 0;
      for (const engine of engineOrder(rep)) {
        log(`perf:compare: rep ${rep + 1}/${config.reps}, ${engine}`);
        const run = await runProcess({ server, config, scenarios, executablePath, log }, rep, engine, order++);
        browserVersion ??= run.browserVersion;
        runs.push(run);
      }
    }
  } finally {
    await server.close();
  }

  const validation = validateResults(config, runs, nodeChecks);
  const prodHash = engineBuildHash(dist);
  // The served bytes themselves, so a rebuilt binary beside an old
  // BUILD.json cannot pass as the same package.
  const prodFiles = enginePackageDigests(dist);
  if (JSON.stringify(prodFiles) !== JSON.stringify(environment.enginePackage)) validation.errors.push(`dist/ and dist-perf/ serve different engine bytes (${JSON.stringify(prodFiles)} vs ${JSON.stringify(environment.enginePackage)})`);
  if (environment.commit === "unknown") validation.errors.push("the commit could not be read (git failed), so the results cannot be tied to a tree");
  if (!environment.mainCommit) validation.warnings.push("origin/main is unknown here (no remote or no fetch), so whether this is a baseline of the latest main was not checked");
  if (!environment.engineBuildHash) validation.errors.push("the served engine package has no BUILD.json, so which sources it came from is unknown");
  else if (environment.engineSourceHash && environment.engineBuildHash !== environment.engineSourceHash) validation.errors.push(`the served engine package (${environment.engineBuildHash}) was not built from the current engine-rs sources (${environment.engineSourceHash}); rebuild it with npm run wasm:build`);
  if (!environment.engineSourceHash) validation.warnings.push("no engine-rs sources in this checkout, so the package's source hash was not checked");
  if (prodHash !== environment.engineBuildHash) validation.errors.push(`dist/ (sizes) and dist-perf/ (timings) carry different engine packages (${prodHash ?? "none"} vs ${environment.engineBuildHash ?? "none"}); rebuild without --skip-build`);
  if (args.skipBuild) {
    // The builds must be this clean commit's, or the app code measured is
    // not the code the results are filed under.
    const stamp = existsSync(stampPath) ? (JSON.parse(readFileSync(stampPath, "utf8")) as { commit: string; dirty: boolean }) : null;
    if (!stamp) validation.errors.push("--skip-build: dist-perf/ has no build stamp, so which tree it came from is unknown; run once without --skip-build");
    else if (stamp.commit !== tree.commit || stamp.dirty || tree.dirty) validation.errors.push(`--skip-build: the builds came from ${stamp.commit}${stamp.dirty ? " (dirty)" : ""}, the tree is ${tree.commit}${tree.dirty ? " (dirty)" : ""}; rebuild without --skip-build`);
  }
  if (environment.dirty) validation.warnings.push("the working tree had uncommitted or untracked changes; the results folder is marked -dirty");
  if (environment.behindMain) validation.warnings.push(`the measured tree lacks ${environment.behindMain} commit(s) of origin/main (${environment.mainCommit}); it is not a baseline of the latest main`);
  const metrics = aggregate(runs, config.scenarios, config.throttles);
  // Pairs with a zero TypeScript median (WASM-only bytes, no clamped
  // frames) get no ratio; the report lists them per engine instead.
  const comparisons = compareEngines(metrics);
  for (const w of missingSamples(metrics, runs)) validation.warnings.push(w);
  validation.ok = validation.errors.length === 0;
  const bundle = analyzeBundle(dist);
  const toolingBundle = analyzeBundle(distPerf);
  const renderer = runs.find((r) => r.page?.webgl)?.page?.webgl?.renderer;
  const results: CompareResults = {
    schema: 1,
    startedAt,
    generatedAt: new Date().toISOString(),
    issue: "maniator/verticopolis#972",
    config,
    environment,
    browser: { version: browserVersion, headless: true, executable: executablePath },
    scenarios: scenarios.map((s) => ({ name: s.name, description: s.description, sha256: s.sha256, population: s.population, units: s.units, transports: s.transports, saveBytes: s.save.length })),
    nodeChecks,
    runs,
    bundle,
    toolingBundleTotals: toolingBundle.totals,
    metrics,
    comparisons,
    validation,
    limitations: [...STATIC_LIMITATIONS, ...(renderer ? [`WebGL renderer in these runs: ${renderer}.`] : [])],
  };

  const out = outputDir(repo, args, results.generatedAt.slice(0, 10), environment);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 1) + "\n");
  writeFileSync(join(out, "metrics.csv"), summaryCsv(metrics));
  writeFileSync(join(out, "raw.csv"), rawCsv(metrics));
  writeFileSync(join(out, "comparisons.csv"), comparisonsCsv(comparisons));
  writeFileSync(join(out, "report.md"), markdownReport(results));
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
 * Where the results go. The default is a new folder per run under
 * docs/performance/results, named by date and commit (with -quick,
 * -skipbuild (the builds were not made for this commit) and -dirty marks), and never an existing one: a second run of the same day
 * and commit gets -2, -3, and so on, so no result is overwritten. An
 * explicit --out must not exist yet either.
 */
export function outputDir(repo: string, args: Pick<Args, "out" | "quick" | "skipBuild">, day: string, env: Pick<Environment, "commitShort" | "dirty">, exists: (p: string) => boolean = existsSync): string {
  if (args.out) {
    const out = resolve(repo, args.out);
    if (exists(out)) throw new Error(`${out} already exists; results are never overwritten`);
    return out;
  }
  const base = resolve(repo, "docs/performance/results", `${day}-${env.commitShort}${args.quick ? "-quick" : ""}${args.skipBuild ? "-skipbuild" : ""}${env.dirty ? "-dirty" : ""}`);
  let out = base;
  for (let n = 2; exists(out); n++) out = `${base}-${n}`;
  return out;
}
