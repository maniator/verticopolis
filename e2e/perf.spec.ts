import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { buildToStar } from "./helpers";
import { benchmarkUiUpdate, measureSimSpeed, checkNodeIdentity } from "./perf-harness";

/**
 * The E5-S0 perf gate (BLOCKING, ahead of any live-view migration). It holds a
 * committed baseline of three measurements taken on the pre-E5 render path, and
 * every later live-view PR (E5-S1 onward) must clear it. See the migration plan's
 * testing strategy, section 3.
 *
 * Baselines are captured on the reference build and committed as JSON, exactly
 * like the visual-snapshot baselines: a local sandbox with variable CPU is never
 * the arbiter. Set `PERF_CAPTURE=1` to (re)write the baseline instead of asserting
 * against it; CI mints the authoritative numbers via update-perf-baseline.yml.
 * When no baseline file exists yet, a normal run captures one and skips the
 * assertions (first-run bootstrap) so the harness is never gated on a file it just
 * created; E5-S1 additionally asserts the file exists so the gate can never stay
 * silently inert (see the backlog note).
 */

const dir = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(dir, "perf", "baseline.json");
const CAPTURE = process.env.PERF_CAPTURE === "1";

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
// Tolerances. (A) median may rise at most 5% and p95 at most 10% (the plan's
// numbers). (B) may fall at most 10% below baseline: it is the noisiest signal
// (a throttled end-to-end rate), so the floor carries runner-jitter headroom
// wider than (A)'s, while a genuine catch-up-spiral regression tanks B far more
// than 10% and is still caught. Locally (a noisier shared sandbox than CI) the
// three metrics held to ~1% / ~5% / ~4% run-to-run, comfortably inside these.
const A_MEDIAN_TOL = 1.05;
const A_P95_TOL = 1.1;
const B_FLOOR_TOL = 0.9;

interface Baseline {
  uiUpdate: { medianMs: number; p95Ms: number; meanMs: number; n: number; batch: number };
  simSpeed: { simMinutesPerRealSecond: number; cpuThrottle: number; speed: number; windowMs: number };
}

test.describe("E5-S0 perf gate @perf", () => {
  // A perf gate must never be retried: a retry-on-failure would let a marginal
  // regression that fails intermittently pass on the second try, exactly the
  // regression the gate exists to catch.
  test.describe.configure({ retries: 0 });
  // The micro-benchmark plus the throttled speed windows take real wall-clock time.
  test.setTimeout(180_000);

  test("ui.update cost, end-to-end speed, and node identity clear the committed baseline @perf", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as unknown as { game?: { sim?: unknown; ui?: unknown } }).game;
      return Boolean(g?.sim && g.ui);
    });
    // Build the deterministic large tower (TOWER-rank: ~100 floors, thousands of
    // occupants), the committed "large-tower fixture" for the benchmark.
    await page.evaluate(buildToStar, 6);

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
      // the sim), clear any pending emergency so it cannot re-arm and freeze the
      // clock (accMinutes = 0), suppress the one-shot TOWER congrats modal, stub
      // the autosave so a mid-window serialize of the huge tower cannot perturb
      // the measurement, and unpause the engine at the fastest speed.
      await page.evaluate((s) => {
        const g = (window as unknown as {
          game: {
            speed: number;
            engine: { paused: boolean };
            sim: { pendingChoice: unknown };
            prefs: { steadyClock: boolean };
            saveLoad?: { autosave: () => void };
            shownWin: boolean;
            shownChoice: boolean;
            shownUpdate: boolean;
          };
        }).game;
        document.getElementById("splash")?.remove();
        g.sim.pendingChoice = null;
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

    const current: Baseline = {
      uiUpdate,
      simSpeed: { simMinutesPerRealSecond, cpuThrottle: CPU_THROTTLE, speed: SPEED_MINUTES_PER_SEC, windowMs: SPEED_WINDOW_MS },
    };

    // The status leaf spans are textContent writes and must never be replaced;
    // this holds pre-E5 and a live-view regression that rebuilds them fails here.
    // The tower-stats children are rebuilt by the pre-E5 `innerHTML =` and become
    // stable only at E5-S1, so that flag is reported, not yet asserted.
    expect(nodeIdentity.statusLeavesStable, "status leaf spans keep their identity across pumps").toBe(true);
    expect(nodeIdentity.towerStatsContainerStable, "the tower-stats container persists across pumps").toBe(true);

    if (CAPTURE || !fs.existsSync(BASELINE_PATH)) {
      fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
      test.info().annotations.push({
        type: "perf-baseline",
        description: `captured baseline (not asserted): ${JSON.stringify(current)}`,
      });
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
    // (A) median must not rise more than 5%; p95 not more than 10%.
    expect(uiUpdate.medianMs, `ui.update median ${uiUpdate.medianMs.toFixed(4)}ms vs baseline ${baseline.uiUpdate.medianMs.toFixed(4)}ms`)
      .toBeLessThanOrEqual(baseline.uiUpdate.medianMs * A_MEDIAN_TOL);
    expect(uiUpdate.p95Ms, `ui.update p95 ${uiUpdate.p95Ms.toFixed(4)}ms vs baseline ${baseline.uiUpdate.p95Ms.toFixed(4)}ms`)
      .toBeLessThanOrEqual(baseline.uiUpdate.p95Ms * A_P95_TOL);
    // (B) end-to-end speed must be at least the baseline (same speed or faster).
    expect(simMinutesPerRealSecond, `sim-min/s ${simMinutesPerRealSecond.toFixed(2)} vs baseline ${baseline.simSpeed.simMinutesPerRealSecond.toFixed(2)}`)
      .toBeGreaterThanOrEqual(baseline.simSpeed.simMinutesPerRealSecond * B_FLOOR_TOL);
  });
});
