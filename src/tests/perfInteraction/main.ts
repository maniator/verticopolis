import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { webglRenderer } from "../perfCompare/page";
import { browserLaunch, browserName, classifyRenderer, launchOptions, type BrowserLaunch } from "../perfCompare/renderer";
import { buildScenarios, unknownScenarios, type Scenario } from "../perfCompare/scenarios";
import { startServer, type PerfServer } from "../perfCompare/server";
import { activityTable, compareArms, comparisonTable, phaseMetrics, type Arm, type ArmRun } from "./analysis";
import { adoptForInteraction, collectRecord, fastForwardTo, installRecorder, restoreCamera, saveCamera, setPhase } from "./pageRecorder";
import { finishPhase, PHASES, preparePhase, runPhase, type Viewport } from "./phases";

/**
 * `npm run perf:interaction`: how the live game answers a player on a big
 * running tower, two builds side by side. Each repetition starts a fresh
 * browser per arm, loads the scenario, fast-forwards to 07:30, starts the
 * tower at the fastest speed and drives six scripted phases (idle, pan, zoom,
 * panels, build, inspect) while recording frames, long tasks, long animation
 * frames and input latency. Arms alternate A B, B A by repetition. Not a
 * gate, and not the protocol's M8 edit scene. A renderer that is not a named
 * hardware GPU stops the run unless `--allow-software` makes it a labeled
 * preview. See docs/performance/interaction-benchmark.md.
 */

export interface InteractionArgs {
  a: string;
  b: string;
  reps: number;
  throttles: number[];
  phaseMs: number;
  warmMs: number;
  speed: number;
  startMinute: number;
  scenario: string;
  viewport: Viewport;
  out: string | null;
  allowSoftware: boolean;
}

const USAGE = "usage: npm run perf:interaction -- --a <tooling build dir> --b <tooling build dir> [--reps 6] [--throttles 1,4] [--phase-ms 20000] [--warm-ms 10000] [--scenario large] [--viewport 1920x1080] [--out <dir>] [--quick] [--allow-software]";

function positiveInt(flag: string, v: string | undefined): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive whole number, got "${v ?? ""}"`);
  return n;
}

/** Parse the command line. Throws with the usage on a mistake. */
export function parseArgs(argv: readonly string[]): InteractionArgs {
  const args: InteractionArgs = { a: "", b: "", reps: 6, throttles: [1, 4], phaseMs: 20000, warmMs: 10000, speed: 3, startMinute: 450, scenario: "large", viewport: { width: 1920, height: 1080 }, out: null, allowSoftware: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "--a": args.a = value(); break;
      case "--b": args.b = value(); break;
      case "--reps": args.reps = positiveInt(flag, value()); break;
      case "--phase-ms": args.phaseMs = positiveInt(flag, value()); break;
      case "--warm-ms": args.warmMs = positiveInt(flag, value()); break;
      case "--scenario": args.scenario = value(); break;
      case "--out": args.out = value(); break;
      case "--throttles": args.throttles = value().split(",").map((t) => positiveInt(flag, t)); break;
      case "--viewport": {
        const m = /^(\d+)x(\d+)$/.exec(value());
        if (!m) throw new Error(`--viewport needs WIDTHxHEIGHT, such as 1920x1080\n${USAGE}`);
        args.viewport = { width: Number(m[1]), height: Number(m[2]) };
        break;
      }
      case "--quick": Object.assign(args, { reps: 1, throttles: [1], phaseMs: 3000, warmMs: 2000 }); break;
      case "--allow-software": args.allowSoftware = true; break;
      default: throw new Error(`unknown argument "${flag}"\n${USAGE}`);
    }
  }
  if (!args.a || !args.b) throw new Error(`--a and --b are both required\n${USAGE}`);
  if (unknownScenarios([args.scenario]).length) throw new Error(`unknown scenario "${args.scenario}"`);
  if (new Set(args.throttles).size !== args.throttles.length) throw new Error("--throttles names a throttle twice");
  if (args.allowSoftware && !args.out) throw new Error("--allow-software needs --out: a preview never lands in docs/performance/results");
  return args;
}

/** The arm order for a repetition: A first on odd repetitions, B first on even ones. */
export function armOrder(rep: number): Arm[] {
  return rep % 2 === 1 ? ["A", "B"] : ["B", "A"];
}

interface RunContext {
  args: InteractionArgs;
  scenario: Scenario;
  launch: BrowserLaunch;
  executablePath: string | null;
  log: (line: string) => void;
}

async function waitForGame(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { enginePort?: unknown; engine?: unknown } }).game;
      return Boolean(g?.enginePort && g.engine);
    }, null, { timeout: 120000 });
  } catch {
    throw new Error("the page never published window.game: build each arm with VC_TOOLING=1 (see docs/performance/interaction-benchmark.md)");
  }
}

type Run = ArmRun & { renderer: string | null; browserVersion: string; startMinute: number; errors: string[]; frameErrors: number; stalled: string[]; noEffect: string[]; missedAutosave: string[] };

/** One arm at one throttle in one repetition, in its own browser. */
async function runArm(ctx: RunContext, server: PerfServer, arm: Arm, rep: number, throttle: number): Promise<Run> {
  const { args, scenario } = ctx;
  const browser = await chromium.launch(launchOptions(ctx.executablePath, ctx.launch));
  try {
    const context = await browser.newContext({ viewport: args.viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
    // tsx wraps named functions in `__name(fn, "name")`; the page has no such helper.
    await context.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
    const page = await context.newPage();
    // Playwright's page errors include unhandled promise rejections, which a
    // window `error` listener would miss; listening before the load catches
    // a boot error too.
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await waitForGame(page);
    const renderer = (await page.evaluate(webglRenderer))?.renderer ?? null;
    if (classifyRenderer(renderer) !== "hardware" && !args.allowSoftware) {
      throw new Error(`the page's renderer is ${renderer ?? "none"}, not a named hardware GPU, so its numbers are not evidence; run on a machine with a GPU, or pass --allow-software (with --out) for a labeled preview`);
    }
    await page.evaluate(adoptForInteraction, scenario.save);
    const startMinute = await page.evaluate(fastForwardTo, args.startMinute);
    const cdp = await context.newCDPSession(page);
    if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    const { loafSupported } = await page.evaluate(installRecorder, args.speed);
    await page.waitForTimeout(args.warmMs);
    const acts: Record<string, Awaited<ReturnType<typeof runPhase>>> = {};
    for (const phase of PHASES) {
      // Every phase starts from the same view: a pan can stop mid-stroke, a
      // zoom drifts toward the cursor and the build phase may move to a free spot.
      await page.evaluate(saveCamera);
      const spots = await preparePhase(page, phase);
      await page.evaluate(setPhase, { name: phase, autosaveAtMs: Math.round(args.phaseMs / 2) });
      acts[phase] = await runPhase(page, phase, args.viewport, args.phaseMs, spots);
      await page.evaluate(setPhase, { name: null });
      await finishPhase(page, phase);
      await page.evaluate(restoreCamera);
      await page.waitForTimeout(1000);
    }
    const record = await page.evaluate(collectRecord);
    const phases: ArmRun["phases"] = {};
    const stalled: string[] = [];
    // Each phase carries one autosave stall. A phase blocked until its window
    // closed loses it, which would flatter the slower arm.
    const missedAutosave: string[] = [];
    for (const phase of PHASES) {
      const p = record.phases[phase];
      if (!p) throw new Error(`${arm} rep ${rep}: the ${phase} phase recorded nothing`);
      phases[phase] = phaseMetrics(p, loafSupported, acts[phase]);
      if (p.simMinutes <= 0) stalled.push(phase);
      if ((p.parts.autosave?.n ?? 0) !== 1) missedAutosave.push(phase);
    }
    // A phase whose script took no effect measured nothing it names.
    const noEffect: string[] = [];
    if ((acts.build?.effective ?? 0) === 0) noEffect.push("build (no office placed)");
    if ((acts.panels?.effective ?? 0) === 0) noEffect.push("panels (no dialog opened)");
    const built = acts.build?.effective ?? 0;
    ctx.log(`perf:interaction: rep ${rep} ${throttle}x ${arm}: start ${Math.floor(startMinute / 60)}:${String(startMinute % 60).padStart(2, "0")}, ${built} offices placed, ${errors.length} page errors, ${record.frameErrors} frame errors${stalled.length ? `, tower stalled in ${stalled.join(", ")}` : ""}`);
    for (const what of noEffect) ctx.log(`perf:interaction: warning: ${arm} rep ${rep}: ${what}, so that phase measured nothing it names`);
    for (const phase of missedAutosave) ctx.log(`perf:interaction: warning: ${arm} rep ${rep}: ${phase} did not run exactly one autosave, so it is not comparable with the other arm`);
    return { arm, rep, throttle, phases, renderer, browserVersion: browser.version(), startMinute, errors: [...errors], frameErrors: record.frameErrors, stalled, noEffect, missedAutosave };
  } finally {
    await browser.close();
  }
}

/** A build folder's `version.json` (app version and commit), when it has one. */
function buildVersion(dir: string): { version: string | null; sha: string | null } {
  try {
    const v = JSON.parse(readFileSync(join(dir, "version.json"), "utf8")) as { version?: unknown; sha?: unknown };
    return { version: typeof v.version === "string" ? v.version : null, sha: typeof v.sha === "string" ? v.sha : null };
  } catch {
    return { version: null, sha: null };
  }
}

/** The default results folder: date, both commits, a label, and a counter so a
 *  second run on the same day keeps the first. */
function defaultOut(repo: string, a: string | null, b: string | null): string {
  const base = resolve(repo, "docs/performance/results", `${new Date().toISOString().slice(0, 10)}-${a ?? "a"}-vs-${b ?? "b"}-interaction`);
  let out = base;
  for (let n = 2; existsSync(out); n++) out = `${base}-${n}`;
  return out;
}

export async function main(argv: readonly string[], repo: string, log: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Promise<number> {
  const args = parseArgs(argv);
  const launch = browserLaunch(process.env);
  const executablePath = process.env.PW_CHROMIUM_PATH || null;
  const scenario = buildScenarios([args.scenario])[0];
  const dirs: Record<Arm, string> = { A: resolve(repo, args.a), B: resolve(repo, args.b) };
  const versions = { A: buildVersion(dirs.A), B: buildVersion(dirs.B) };
  log(`perf:interaction: ${browserName(launch.channel, executablePath)}, scenario ${scenario.name} (${scenario.units} units), ${args.reps} reps at ${args.throttles.join(", ")}x, ${args.phaseMs} ms per phase`);
  const out = args.out ? resolve(repo, args.out) : defaultOut(repo, versions.A.sha, versions.B.sha);
  const servers: Record<Arm, PerfServer> = { A: await startServer(dirs.A), B: await startServer(dirs.B) };
  const ctx: RunContext = { args, scenario, launch, executablePath, log };
  const runs: Run[] = [];
  const isPreview = (): boolean => runs.some((r) => classifyRenderer(r.renderer) !== "hardware");
  const meta = { date: new Date().toISOString(), machine: { platform: platform(), cpu: cpus()[0]?.model ?? null }, args, scenario: { name: scenario.name, sha256: scenario.sha256, units: scenario.units }, launch, arms: { A: { dir: args.a, ...versions.A }, B: { dir: args.b, ...versions.B } } };
  // The folder appears with the first measured arm, so a run refused at the start leaves nothing behind.
  const save = (): void => {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "results.json"), `${JSON.stringify({ ...meta, preview: isPreview(), runs, comparisons: compareArms(runs, PHASES) }, null, 2)}\n`);
  };
  try {
    for (const throttle of args.throttles) {
      for (let rep = 1; rep <= args.reps; rep++) {
        for (const arm of armOrder(rep)) {
          runs.push(await runArm(ctx, servers[arm], arm, rep, throttle));
          // Written after every arm, so a run that fails late keeps what it measured.
          save();
        }
      }
    }
  } finally {
    await Promise.all([servers.A.close(), servers.B.close()]);
  }
  const renderers = [...new Set(runs.map((r) => r.renderer ?? "none"))];
  const preview = isPreview();
  const arm = (k: Arm): string => `${k}: ${versions[k].version ?? "unknown version"} at ${versions[k].sha ?? "unknown commit"} (\`${k === "A" ? args.a : args.b}\`)`;
  const report = [
    preview
      ? `**Preview of ${meta.date.slice(0, 10)}, not evidence: the renderer is not a named hardware GPU, so render cost dominates every frame.**`
      : `**Snapshot of ${meta.date.slice(0, 10)}, not refreshing.** These numbers come from one run of \`npm run perf:interaction\` (\`src/tests/perfInteraction/\`, tested by \`analysis.test.ts\` and \`pageRecorder.test.ts\`); run it again for current figures.`,
    "",
    `# Interaction benchmark, ${scenario.name} tower`,
    "",
    `${arm("A")}. ${arm("B")}.`,
    "",
    `Machine: ${meta.machine.platform}, ${meta.machine.cpu ?? "unknown CPU"}. Browser: ${browserName(launch.channel, executablePath)} ${runs[0]?.browserVersion ?? ""}. Renderer: ${renderers.join("; ")}. ${args.reps} repetitions per throttle, arms alternating, a fresh browser per arm, ${args.phaseMs / 1000} s per phase, one autosave in the middle of each phase.`,
    "",
    "Frame metrics compare as paired ratios (B over A; below 1 is shorter frames, above 1 for 1% low is more frames). Blocking and input compare as paired differences (B minus A; negative is less blocking or less delay). Not a gate.",
    "",
    comparisonTable(compareArms(runs, PHASES)),
    "",
    "## What each run did",
    "",
    activityTable(runs, PHASES),
    "",
  ].join("\n");
  writeFileSync(join(out, "report.md"), report);
  log(`perf:interaction: wrote ${out}`);
  const problems = runs.filter((r) => r.errors.length || r.frameErrors || r.stalled.length || r.noEffect.length || r.missedAutosave.length);
  for (const r of problems) log(`perf:interaction: ${r.arm} rep ${r.rep} at ${r.throttle}x is not clean: ${r.errors.length} page errors, ${r.frameErrors} frame errors, stalled in ${r.stalled.join(", ") || "none"}, took no effect in ${r.noEffect.join(", ") || "none"}, autosave not run once in ${r.missedAutosave.join(", ") || "none"}`);
  return problems.length ? 1 : 0;
}
