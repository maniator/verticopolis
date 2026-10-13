import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { analyzeBundle } from "./bundle";
import { collectEnvironment } from "./env";
import { aggregate, compareEngines } from "./metrics";
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
    else if (arg === "--scenarios") a.scenarios = next().split(",").filter(Boolean);
    else if (arg === "--throttles") {
      a.throttles = next().split(",").map(Number);
      if (a.throttles.some((t) => !(t >= 1))) throw new Error("--throttles takes rates of 1 or more, comma separated");
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
  "One machine, headless Chromium in a container. Spread is reported (CV, order-statistic intervals of the median, bootstrap intervals of the ratios); results from other hardware, browsers or a GPU will differ.",
  "Frame rates come from a software WebGL rasterizer (see the WebGL renderer row), so render cost is much higher than on a GPU device and dominates the frame. The simulation-only rows are unaffected by rendering.",
  "Both engines run on the main thread. The WASM host keeps a TypeScript read model of the tower, refreshed from the engine's frame view after every step and from a full save merge whenever the tower revision moves or an in-game hour passes (src/wasmhost/wasmHost.ts). The hosted rows include that cost; the bare-engine rows do not.",
  "The step driver (the frame loop's owed-minute math and fixed step) is the TypeScript host's for both engines (#867), and commands still run on both the read model and the engine (#954). This benchmark times ticks, which the engine alone runs when hosted; it does not time player commands.",
  "Pages are served cross-origin isolated (COOP/COEP) so performance.now() resolves to about 5 microseconds instead of 100. The production site is not isolated; isolation does not change how either engine executes.",
  "Transfer sizes are what this harness's server sent: Brotli quality 11 or gzip level 9 static compression, Cache-Control per vercel.json. A CDN's compression levels and protocol overhead differ; headers are not counted.",
  "CPU throttling is Chromium's DevTools emulation (the renderer is paused in slices), not a slower CPU: it scales CPU time but not memory bandwidth or cache behavior.",
  "WASM linear memory only grows. The scenarios run small, medium, large in one page, so each WASM memory figure is the high-water mark up to that scenario. The JS heap is measured after a forced GC through the DevTools protocol; process PSS sums every browser process (Linux only).",
  "Startup is measured to the moment the app publishes its tooling handle (window.game) and to the first frame after it; it uses a VC_TOOLING=1 build of the same sources, which only adds that handle.",
];

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(cmd, args, { cwd, stdio: "inherit", env });
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const dist = join(repo, "dist");
  const distPerf = join(repo, "dist-perf");
  if (!existsSync(join(repo, "src/public/engine/verticopolis_engine_bg.wasm"))) {
    throw new Error("the engine package src/public/engine/ is missing: build it first with `npm run wasm:build` (needs the wasm32 target and the pinned wasm-bindgen CLI)");
  }
  if (!args.skipBuild) {
    log("perf:compare: production build (npm run build)");
    sh("npm", ["run", "build"], repo);
    log("perf:compare: tooling build of the same sources (VC_TOOLING=1) into dist-perf/");
    sh("npx", ["vite", "build", "--outDir", distPerf, "--emptyOutDir"], repo, { ...process.env, VC_TOOLING: "1" });
  }
  for (const d of [dist, distPerf]) if (!existsSync(join(d, "index.html"))) throw new Error(`no build at ${d}; run without --skip-build`);

  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}; expected ${all.map((s) => s.name).join(",")}`);
  const config = makeConfig(args, scenarios.map((s) => s.name));
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const environment = collectEnvironment(repo, distPerf, sourceHash);

  log("perf:compare: Node conformance check of both engines on every scenario");
  const mod = await loadWebPackage(join(distPerf, "engine"));
  const nodeChecks = scenarios.map((sc) => checkScenario(mod, sc, config.steps, config.dt, config.warmSteps));
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
  if (environment.engineBuildHash && environment.engineSourceHash && environment.engineBuildHash !== environment.engineSourceHash) {
    validation.errors.push(`the served engine package (${environment.engineBuildHash}) was not built from the current engine-rs sources (${environment.engineSourceHash}); rebuild it with npm run wasm:build`);
    validation.ok = false;
  }
  if (environment.dirty) validation.warnings.push("the working tree had uncommitted changes to tracked files");
  const metrics = aggregate(runs, config.scenarios, config.throttles);
  const comparisons = compareEngines(metrics);
  const bundle = analyzeBundle(dist);
  const renderer = runs.find((r) => r.page?.webgl)?.page?.webgl?.renderer;
  const results: CompareResults = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    issue: "maniator/verticopolis#972",
    config,
    environment,
    browser: { version: browserVersion, headless: true, executable: executablePath },
    scenarios: scenarios.map((s) => ({ name: s.name, description: s.description, sha256: s.sha256, population: s.population, units: s.units, transports: s.transports, saveBytes: s.save.length })),
    nodeChecks,
    runs,
    bundle,
    metrics,
    comparisons,
    validation,
    limitations: [...STATIC_LIMITATIONS, ...(renderer ? [`WebGL renderer in these runs: ${renderer}.`] : [])],
  };

  const day = results.generatedAt.slice(0, 10);
  const out = resolve(repo, args.out ?? join("docs/performance/results", `${day}-${environment.commitShort}${args.quick ? "-quick" : ""}`));
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
