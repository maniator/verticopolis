import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { buildToStar, expectEngineHosted, onWasm } from "./helpers";
import { benchmarkUiUpdate, measureSimSpeed, checkNodeIdentity } from "./perf-harness";
import { crossEngineLines, formatBaselineFile, gateChecks, harnessOf, hasReportedBudgets, measurementProblem, ownEntryLines, parseBaselineFile, runAction, withBaseline, type BaselineFile, type PerfEngine, type PerfMeasurement } from "../src/tests/perfBaseline";

/**
 * The E5-S0 perf gate (BLOCKING, ahead of any live-view migration). It holds a
 * committed baseline of three measurements taken on the pre-E5 render path, and
 * every later live-view PR (E5-S1 onward) must clear it. See the migration plan's
 * testing strategy, section 3.
 *
 * Baselines are captured on the reference build and committed as JSON, exactly
 * like the visual-snapshot baselines: a local sandbox with variable CPU is never
 * the arbiter. CI mints the authoritative numbers via update-perf-baseline.yml.
 * Set `PERF_CAPTURE=1` to write this engine's entry from a local run instead of
 * asserting against it (a preview, never one to commit); a plain local run
 * writes nothing, so an engine with no entry yet cannot gain a local one by
 * accident. On CI a missing entry fails, so the gate can never stay silently
 * inert (see the backlog note).
 *
 * The spec runs on both engines (#900): `chromium` on the TypeScript engine and
 * `chromium-wasm` on the WASM engine. The file holds one entry per engine
 * (src/tests/perfBaseline.ts), each run is held to its own engine's entry, and
 * a capture writes only the engine it ran. The TypeScript engine's three
 * budgets block; on the WASM engine the speed budget prints and gates nothing
 * until M7's calibration (BLOCKING in src/tests/perfBaseline.ts, which says
 * why). On the WASM engine the run is also read against the TypeScript entry
 * and printed (M7's reading), which fails nothing.
 */

const dir = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(dir, "perf", "baseline.json");
const CAPTURE = process.env.PERF_CAPTURE === "1";
// A mint run (update-perf-baseline.yml) sets this with PERF_CAPTURE=1 and
// `--repeat-each`: each pass records its measurement here, and
// scripts/perf-baseline-mint.ts makes the engine's entry from all of them.
const PASSES_DIR = process.env.PERF_PASSES_DIR;
// The committed baseline is minted on CI hardware, so comparing against it is
// only meaningful there: a slower local machine would always fail and a faster
// one would hide regressions. Mirror of the visual-snapshot convention
// (ignoreSnapshots outside CI): locally the measurements still RUN and are
// reported, but the baseline comparison is skipped; set PERF_ENFORCE=1 to
// compare anyway (e.g. to eyeball a diff in progress).
const ENFORCE = !!process.env.CI || process.env.PERF_ENFORCE === "1";

// (A) 4000 pumps, timed in batches of 40 so each sample (~30ms) clears the
// ~0.1ms performance.now() floor and averages out GC jitter; (B) the fastest
// speed under a 4x CPU throttle, the median of several fixed windows (with a
// steady clock, below) so one starved window can't flip the verdict.
const N_PUMPS = 4000;
const A_BATCH = 40;
const CPU_THROTTLE = 4;
// `speed` is an index into SPEEDS = [0, 10, 30, 120] sim-minutes/second, so the
// fastest speed (the "120" the plan names) is key 3.
const SPEED = 3;
const SPEED_MINUTES_PER_SEC = 120;
const SPEED_WINDOW_MS = 4000;
const SPEED_WINDOWS = 5;
// The tolerances live with the baseline file's helpers (PERF_TOLERANCES in
// src/tests/perfBaseline.ts).

// benchmarkUiUpdate rounds n up to whole batches; a non-divisible configuration
// would silently run more pumps than N_PUMPS while the metadata check still
// expects exactly N_PUMPS. Fail fast at collection instead.
if (N_PUMPS % A_BATCH !== 0) {
  throw new Error(`N_PUMPS (${N_PUMPS}) must be divisible by A_BATCH (${A_BATCH})`);
}

/** The engine the page booted, and on WASM whether the host still runs the
 *  tower: a run that fell back to TypeScript must not be held to, or mint,
 *  the WASM entry (and the reverse). */
async function expectEngine(page: Page, engine: PerfEngine): Promise<void> {
  const booted = await page.evaluate(() => (window as unknown as { __vcEngineBoot?: { engine?: string } }).__vcEngineBoot?.engine ?? null);
  expect(booted, `the page must boot the ${engine} engine this project measures`).toBe(engine);
  await expectEngineHosted(page);
}

test.describe("E5-S0 perf gate @perf", () => {
  // A perf gate must never be retried: a retry-on-failure would let a marginal
  // regression that fails intermittently pass on the second try, exactly the
  // regression the gate exists to catch.
  test.describe.configure({ retries: 0 });
  // The micro-benchmark plus the throttled speed windows take real wall-clock time.
  test.setTimeout(180_000);

  test("ui.update cost, end-to-end speed, and node identity clear the committed baseline @perf", async ({ page }) => {
    const engine: PerfEngine = onWasm(test.info().project.name) ? "wasm" : "ts";
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { sim?: unknown; ui?: unknown } }).game;
      return Boolean(g?.sim && g.ui);
    });
    // Build the deterministic large tower (TOWER-rank: ~100 floors, thousands of
    // occupants), the committed "large-tower fixture" for the benchmark. TOWER
    // needs 15,000 people (TOWER_POPULATION in src/engine/census.ts), so the
    // rank also holds M7's 5,000+ population precondition.
    expect(await page.evaluate(buildToStar, 6), "the fixture must reach TOWER").toBe(6);
    await expectEngine(page, engine);

    // (A) isolated render cost (batched, change-path).
    const uiUpdate = await page.evaluate(benchmarkUiUpdate, { n: N_PUMPS, batch: A_BATCH });
    // (C) node identity across real pumps (measured before the throttle).
    const nodeIdentity = await page.evaluate(checkNodeIdentity, 200);

    // (B) end-to-end speed under a CPU-throttled profile.
    const client = await page.context().newCDPSession(page);
    let simMinutesPerRealSecond = 0;
    try {
      await client.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
      // Resume the real frame loop at full speed: dismiss the splash (it pauses
      // the sim), neutralize emergencies (clear the EventSystem's pending choice,
      // `sim.pendingChoice` is only a getter over it, and stub `showEventChoice`
      // to instantly decline so a NEW mid-window emergency resolves instead of
      // freezing the clock via the shownChoice modal gate), suppress the one-shot
      // TOWER congrats modal, stub the autosave so a mid-window serialize of the
      // huge tower cannot perturb the measurement, and unpause the engine at the
      // fastest speed.
      await page.evaluate((s) => {
        const g = (window as unknown as {
          game: {
            speed: number;
            engine: { paused: boolean };
            sim: { events: { pending: unknown } };
            ui: { showEventChoice: (m: string, c: string, onResolve: (opt: "accept" | "decline") => void) => void };
            prefs: { steadyClock: boolean };
            saveLoad?: { autosave: () => void };
            shownWin: boolean;
            shownChoice: boolean;
            shownUpdate: boolean;
          };
        }).game;
        document.getElementById("splash")?.remove();
        g.sim.events.pending = null;
        g.ui.showEventChoice = (_m, _c, onResolve) => onResolve("decline");
        g.shownWin = true;
        g.shownChoice = false;
        g.shownUpdate = false;
        // Uniform pace: the "breathing clock" dilates sim-time by time-of-day
        // (lunch ~0.1x), which would make the measurement depend on where the
        // clock happens to sit. Steady clock removes that confound.
        g.prefs.steadyClock = true;
        if (g.saveLoad) g.saveLoad.autosave = () => {};
        g.speed = s;
        g.engine.paused = false;
      }, SPEED);
      const windows: number[] = [];
      for (let i = 0; i < SPEED_WINDOWS; i++) windows.push(await page.evaluate(measureSimSpeed, SPEED_WINDOW_MS));
      windows.sort((a, b) => a - b);
      simMinutesPerRealSecond = windows[Math.floor(windows.length / 2)]; // median window
    } finally {
      await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }

    const current: PerfMeasurement = {
      uiUpdate,
      simSpeed: { simMinutesPerRealSecond, cpuThrottle: CPU_THROTTLE, speed: SPEED_MINUTES_PER_SEC, windowMs: SPEED_WINDOW_MS, windows: SPEED_WINDOWS },
    };
    // The engine must still be the one measured after the timed windows: a
    // host fault mid-run would leave TypeScript numbers on the WASM project.
    await expectEngine(page, engine);

    // The status leaf spans are textContent writes and must never be replaced;
    // a live-view regression that rebuilds them fails here.
    expect(nodeIdentity.statusLeavesStable, "status leaf spans keep their identity across pumps").toBe(true);
    expect(nodeIdentity.towerStatsContainerStable, "the tower-stats container persists across pumps").toBe(true);
    // Since E5-S1 the grid renders through lit, which patches text in place, so
    // the grid's child nodes must also keep their identity across pumps (the
    // pre-E5 innerHTML reparse rebuilt them; that regression now fails here).
    expect(nodeIdentity.towerStatsChildStable, "the tower-stats grid children keep their identity across pumps").toBe(true);

    if (CAPTURE && PASSES_DIR) {
      // One pass of a mint: scripts/perf-baseline-mint.ts reads them all, and
      // checks them, and the committed file is left alone.
      fs.mkdirSync(PASSES_DIR, { recursive: true });
      fs.writeFileSync(path.join(PASSES_DIR, `${engine}-${test.info().repeatEachIndex}.json`), JSON.stringify({ engine, ...current }) + "\n");
      return;
    }
    const file: BaselineFile = fs.existsSync(BASELINE_PATH) ? parseBaselineFile(fs.readFileSync(BASELINE_PATH, "utf8")) : {};
    const baseline = file[engine];
    const action = runAction({ capture: CAPTURE, enforce: ENFORCE, hasEntry: Boolean(baseline) });

    // Every CI run prints what it measured, so CI's runs give the
    // runner-to-runner spread M7's calibration needs, and M7's reading and
    // the engine's own reading print before anything below can fail.
    if (ENFORCE) {
      const lines = [`perf ${engine}: ${JSON.stringify(current)}`];
      if (engine === "wasm") lines.push(...crossEngineLines(current, file));
      if (baseline && hasReportedBudgets(engine)) lines.push(...ownEntryLines(engine, current, baseline));
      for (const line of lines) console.log(line);
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["```", ...lines, "```", ""].join("\n"));
    }

    switch (action) {
      case "capture": {
        // A local preview of this engine's entry; the others stay as they are.
        const problem = measurementProblem(current);
        expect(problem, `this ${engine} run cannot be a baseline: ${problem}`).toBeNull();
        fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
        fs.writeFileSync(BASELINE_PATH, formatBaselineFile(withBaseline(file, { engine, ...current })));
        test.info().annotations.push({ type: "perf-baseline", description: `captured ${engine} baseline locally (a preview, not asserted): ${JSON.stringify(current)}` });
        return;
      }
      case "fail-missing":
        // Deleting baseline.json, or an engine's entry, must not silently
        // disable the gate on CI.
        expect(baseline, `no committed ${engine} baseline in ${BASELINE_PATH}; mint one with [update-perf-baseline:${engine}]`).toBeDefined();
        return;
      case "report-missing":
        test.info().annotations.push({
          type: "perf-measured",
          description: `measured ${engine}; there is no committed ${engine} entry, and only CI mints one ([update-perf-baseline:${engine}]): ${JSON.stringify(current)}`,
        });
        return;
      case "report":
        // Local hardware differs from the CI runner that minted the baseline, so
        // the comparison would be meaningless here; report the measurements and
        // stop (see the ENFORCE note at the top).
        test.info().annotations.push({
          type: "perf-measured",
          description: `measured ${engine} (comparison skipped outside CI; PERF_ENFORCE=1 to compare): ${JSON.stringify(current)}`,
        });
        return;
      case "gate":
        break;
    }

    // The baseline is only comparable if it was minted with the SAME harness
    // parameters; a constant change (or a stale file) must demand a re-mint via
    // [update-perf-baseline:<engine>] instead of comparing unlike runs.
    expect(harnessOf(baseline!), `the ${engine} baseline's metadata must match the harness parameters; re-mint with [update-perf-baseline:${engine}]`).toEqual({
      n: N_PUMPS,
      batch: A_BATCH,
      cpuThrottle: CPU_THROTTLE,
      speed: SPEED_MINUTES_PER_SEC,
      windowMs: SPEED_WINDOW_MS,
      windows: SPEED_WINDOWS,
    });
    // (A) median must not rise more than 5%; p95 not more than 10%. (B)
    // end-to-end speed must be at least the baseline, within its 10% floor.
    // gateChecks keeps the budgets that block this engine (BLOCKING in
    // src/tests/perfBaseline.ts; the rest printed above), and
    // src/tests/perfBaseline.ts also carries the float-safe comparisons and
    // the tolerances.
    for (const check of gateChecks(current, baseline!, engine)) expect(check.ok, check.message).toBe(true);
  });
});
