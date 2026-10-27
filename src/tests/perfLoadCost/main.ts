import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer, type PerfServer } from "../perfCompare/server";
import { browserLaunch, launchOptions } from "../perfCompare/renderer";
import { buildTree } from "../perfCompare/env";
import { parseArgs, USAGE } from "./args";
import { ARMS, reportMarkdown, type Arm, type Refusal, type Row } from "./report";
import { takeSample } from "./sample";

/**
 * `npm run perf:load-cost --`: the engine load cost measurement of #985
 * (spec: /release-3.0/offline-985/load-cost-measurement.md). It compares two
 * built folders on cold, repeat, offline and restarted boots. Runs interleave
 * the two arms and swap which goes first on every repetition. Not a gate.
 */
export async function main(argv: readonly string[], repo: string): Promise<number> {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n${USAGE}\n`);
    return 2;
  }
  const launch = browserLaunch(process.env);
  const executablePath = process.env.PW_CHROMIUM_PATH ?? null;
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const servers: Record<Arm, PerfServer> = { before: await startServer(resolve(opts.before)), after: await startServer(resolve(opts.after)) };
  const browser = await chromium.launch(launchOptions(executablePath, launch));
  const rows: Row[] = [];
  const refusals: Refusal[] = [];
  const started = new Date();
  const version = browser.version();
  try {
    for (let rep = 1; rep <= opts.reps; rep++) {
      const order: Arm[] = rep % 2 === 1 ? [...ARMS] : [...ARMS].reverse();
      for (const throttle of opts.throttles) {
        for (const condition of opts.conditions) {
          for (const arm of order) {
            const profileDir = mkdtempSync(join(tmpdir(), "vc-load-cost-"));
            try {
              const sample = await takeSample(condition, browser, { baseUrl: servers[arm].url, executablePath, launch, throttle, dt: opts.dt, profileDir });
              rows.push({ arm, condition, throttle, rep, sample });
              process.stdout.write(`rep ${rep} ${condition} ${throttle}x ${arm}: ready ${sample.readyMs.toFixed(0)} ms, first 10 steps ${sample.stepsMs[0]?.toFixed(1)} ms\n`);
            } catch (e) {
              const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
              refusals.push({ arm, condition, throttle, rep, error });
              process.stdout.write(`rep ${rep} ${condition} ${throttle}x ${arm}: refused (${error})\n`);
            } finally {
              rmSync(profileDir, { recursive: true, force: true });
            }
          }
        }
      }
      writeFileSync(join(out, "rows.json"), JSON.stringify({ rows, refusals }, null, 2));
    }
  } finally {
    await browser.close();
    await Promise.all(ARMS.map((a) => servers[a].close()));
  }
  const tree = buildTree(repo);
  const header = {
    window: `${started.toISOString()} to ${new Date().toISOString()}`,
    before: opts.before,
    after: opts.after,
    machine: `${process.platform} ${process.arch}, Chromium ${version}, script tree ${tree.commit.slice(0, 8)}${tree.dirty ? " (dirty)" : ""}`,
    reps: opts.reps,
    command: `npm run perf:load-cost -- ${argv.join(" ")}`,
  };
  writeFileSync(join(out, "report.md"), reportMarkdown(rows, refusals, header, opts.throttles, opts.conditions));
  process.stdout.write(`wrote ${join(out, "report.md")} and rows.json (${rows.length} kept, ${refusals.length} refused)\n`);
  return refusals.length > 0 && rows.length === 0 ? 1 : 0;
}
