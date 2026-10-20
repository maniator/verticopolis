import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { engineSourceHash } from "../../wasmhost/packageHash";
import { buildTree, collectEnvironment, packageState, type PackageState } from "../perfCompare/env";
import { outputDir, packageErrors, stampErrors } from "../perfCompare/main";
import { adoptScenario, prepareLiveApp, stashSave } from "../perfCompare/page";
import { buildScenarios } from "../perfCompare/scenarios";
import { startServer } from "../perfCompare/server";
import { buildTooling } from "../perfWorker/build";
import { restoreRun, type Workload } from "./page";
import { WORKLOADS, markdown, problems, rows, type MeasuredRun, type ReportMeta } from "./report";

/**
 * `npm run perf:restore`: the restore-point benchmark for #874. It times the
 * work the runtime fallback's restore points add to a hosted tower, on the
 * three perf scenarios, at each CPU throttle, in a fresh browser process per
 * repetition, and writes results.json and report.md. Not a gate. It reuses
 * the engine comparison's build, server, scenarios and page helpers
 * (`src/tests/perfCompare/`) without changing them. Temporary, with the
 * WASM engine's fallback: the TypeScript engine's retirement removes this
 * folder (story-engine-retire-typescript.md).
 */

export interface Args {
  reps: number;
  throttles: number[];
  scenarios: string[] | null;
  skipBuild: boolean;
  out: string | null;
  quick: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { reps: 10, throttles: [1, 4], scenarios: null, skipBuild: false, out: null, quick: false };
  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reps") {
      args.reps = Number(value(i++, a));
      if (!Number.isInteger(args.reps) || args.reps < 1) throw new Error("--reps needs a whole number of at least 1");
    } else if (a === "--throttles") {
      args.throttles = [...new Set(value(i++, a).split(",").map(Number))];
      if (args.throttles.some((t) => !Number.isFinite(t) || t < 1)) throw new Error("--throttles needs rates of at least 1, such as 1,4");
    } else if (a === "--scenarios") {
      args.scenarios = [...new Set(value(i++, a).split(","))];
      if (args.scenarios.some((s) => s === "")) throw new Error("--scenarios needs names, such as small,large");
    } else if (a === "--skip-build") args.skipBuild = true;
    else if (a === "--out") args.out = value(i++, a);
    else if (a === "--quick") args.quick = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (args.quick && !argv.includes("--reps")) args.reps = 2;
  return args;
}

/** Steps per workload; a quick run takes a quarter. */
export function stepsFor(quick: boolean): Record<Workload, number> {
  const full = { plain: 240, drag: 40, click: 240, edits: 40 };
  return quick ? { plain: full.plain / 4, drag: full.drag / 4, click: full.click / 4, edits: full.edits / 4 } : full;
}

const DT = 2;
const CLICK_EVERY = 20;
const STEP_TIMEOUT_MS = 20 * 60_000;
const PAGE_TIMEOUT_MS = 2 * 60_000;

/** The throttle order alternates by repetition, so neither rate always runs
 *  first in a process. */
export function throttleOrder(throttles: readonly number[], rep: number): number[] {
  return rep % 2 === 0 ? [...throttles] : [...throttles].reverse();
}

/** The workload order rotates by repetition, so no workload always runs
 *  first, on a cold page, or last, on a heap the others grew. */
export function workloadOrder(rep: number): Workload[] {
  const k = rep % WORKLOADS.length;
  return [...WORKLOADS.slice(k), ...WORKLOADS.slice(0, k)];
}

/** The engine comparison's package checks, read for the one build this
 *  benchmark serves (dist-perf/): its lines about dist/ would only repeat
 *  them. `recorded` is the package before the runs. */
export function restorePackageErrors(pkg: PackageState, sourceHash: string | null, recorded?: PackageState): string[] {
  return packageErrors(pkg, pkg, sourceHash, recorded).filter((e) => !e.startsWith("dist/ ") && !e.startsWith("the sizes build (dist/)"));
}

async function within<T>(what: string, p: Promise<T>, limit = STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took longer than ${limit / 60_000} min`)), limit)))]);
  } finally {
    clearTimeout(timer);
  }
}

async function bootPage(browser: Browser, url: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  // tsx keeps function names through a `__name` helper the page lacks.
  await ctx.addInitScript({ content: "globalThis.__name = (fn) => fn;" });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: PAGE_TIMEOUT_MS });
  await within("preparing the page", page.evaluate(prepareLiveApp), PAGE_TIMEOUT_MS);
  return page;
}

export async function main(argv: readonly string[], repo: string): Promise<number> {
  const args = parseArgs(argv);
  const log = (line: string) => process.stderr.write(`${line}\n`);
  // Everything that can refuse the run does so before the build.
  const all = buildScenarios();
  const scenarios = args.scenarios ? all.filter((s) => args.scenarios!.includes(s.name)) : all;
  if (args.scenarios && scenarios.length !== args.scenarios.length) throw new Error(`unknown scenario in ${args.scenarios.join(",")}; expected ${all.map((s) => s.name).join(",")}`);
  const distPerf = join(repo, "dist-perf");
  const stamp = join(distPerf, ".perf-build.json");
  const tree = buildTree(repo);
  if (args.skipBuild) {
    const errs = stampErrors([stamp], tree);
    if (errs.length) throw new Error(errs.join("; "));
  }
  const date = new Date().toISOString().slice(0, 10);
  const out = outputDir(repo, { ...args, aa: null }, date, { commitShort: `${tree.commit.slice(0, 7)}-restore-points`, dirty: tree.dirty });
  mkdirSync(out, { recursive: true });
  if (!args.skipBuild) {
    log("perf:restore: tooling build (VC_TOOLING=1) into dist-perf/");
    buildTooling(repo, distPerf);
    writeFileSync(stamp, JSON.stringify(tree) + "\n");
  }
  const sourceHash = existsSync(join(repo, "engine-rs/src")) ? engineSourceHash(join(repo, "engine-rs")) : null;
  const pkg = packageState(distPerf);
  const pkgErrors = restorePackageErrors(pkg, sourceHash);
  if (pkgErrors.length) throw new Error(`the engine package cannot be tied to this tree:\n  - ${pkgErrors.join("\n  - ")}`);
  const environment = collectEnvironment(repo, distPerf, sourceHash);
  const steps = stepsFor(args.quick);
  const expected = args.reps * args.throttles.length * scenarios.length * WORKLOADS.length;

  const runs: MeasuredRun[] = [];
  const failures: string[] = [];
  let browserVersion: string | null = null;
  const meta = (): ReportMeta => ({
    date,
    commit: environment.commit,
    dirty: environment.dirty,
    quick: args.quick,
    cpu: `${environment.cpuModel} (${environment.logicalCpus} threads, ${(environment.totalMemoryBytes / 2 ** 30).toFixed(1)} GB)`,
    os: environment.os,
    browser: browserVersion ? `Chromium ${browserVersion}` : null,
    crossOriginIsolated: runs.length ? runs.every((r) => r.crossOriginIsolated) : null,
    reps: args.reps,
    throttles: args.throttles,
    steps,
    clickEvery: CLICK_EVERY,
    dt: DT,
  });
  // Written after every run, so a run that stops keeps what it measured.
  const write = (issues: readonly string[], partial: boolean) => {
    const scenarioList = scenarios.map((s) => ({ name: s.name, sha256: s.sha256, units: s.units, population: s.population }));
    writeFileSync(join(out, "results.json"), JSON.stringify({ meta: meta(), environment, scenarios: scenarioList, partial, issues, runs }, null, 1) + "\n");
  };

  const server = await startServer(distPerf);
  try {
    for (let rep = 0; rep < args.reps; rep++) {
      log(`perf:restore: rep ${rep + 1}/${args.reps}`);
      const browser = await chromium.launch({ headless: true, args: ["--js-flags=--expose-gc"], ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) });
      browserVersion = browser.version();
      try {
        const page = await bootPage(browser, `${server.url}/?engine=wasm`);
        const cdp = await page.context().newCDPSession(page);
        for (const sc of scenarios) await within(`stashing ${sc.name}`, page.evaluate(stashSave, { name: sc.name, save: sc.save }), PAGE_TIMEOUT_MS);
        for (const throttle of throttleOrder(args.throttles, rep)) {
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
          for (const sc of scenarios) {
            for (const workload of workloadOrder(rep)) {
              const label = `${sc.name} ${workload} at ${throttle}x`;
              try {
                const adopt = await within(`${label}: adopting`, page.evaluate(adoptScenario, sc.name));
                if (adopt.engineActive !== "wasm") throw new Error(`${label}: the tower is not hosted on the WASM engine`);
                await within(`${label}: preparing`, page.evaluate(prepareLiveApp), PAGE_TIMEOUT_MS);
                const r = await within(label, page.evaluate(restoreRun, { scenario: sc.name, workload, steps: steps[workload], warmSteps: args.quick ? 10 : 30, dt: DT, clickEvery: CLICK_EVERY }));
                runs.push({ ...r, rep, throttle });
                const med = r.stepMs.length ? r.stepMs.slice().sort((a, b) => a - b)[Math.floor(r.stepMs.length / 2)] : Number.NaN;
                log(`  ${label}: step median ${med.toFixed(2)} ms, merges ${r.merges}, hosted saves ${r.hostedSaves}, extra saves ${r.extraSaves}, pulls ${r.pullMs.toFixed(1)} ms${r.fault ? `, FAULT ${r.fault}` : ""}`);
              } catch (e) {
                failures.push(`rep ${rep + 1}, ${label}: ${e instanceof Error ? e.message : String(e)}`);
                log(`  ${label}: FAILED`);
              }
              write(failures, true);
            }
          }
        }
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      } catch (e) {
        failures.push(`rep ${rep + 1}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  // The package must still be the one checked before the runs.
  const after = restorePackageErrors(packageState(distPerf), sourceHash, pkg);
  const issues = [...failures, ...after, ...problems(runs, expected, environment)];
  write(issues, false);
  writeFileSync(join(out, "report.md"), markdown(meta(), rows(runs), issues));
  log(`perf:restore: wrote ${out}`);
  return issues.length ? 1 : 0;
}
