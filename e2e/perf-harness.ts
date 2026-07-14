/**
 * Browser-side perf-measurement helpers for the E5-S0 gate. Like `helpers.ts`,
 * every function is SELF-CONTAINED (no module-scope refs) because Playwright
 * serializes it into `page.evaluate`. They read the `window.game` surface the
 * app exposes and return plain JSON (never DOM nodes, which cannot cross the
 * evaluate boundary), so the node-identity check runs entirely in-page.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface UiUpdateSample {
  n: number;
  batch: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
}

/**
 * Profile (A): the per-pump cost of `ui.update`, measured so it survives two
 * traps. (1) The clock is advanced one minute BEFORE every pump, so the snapshot
 * genuinely changes (the time/date leaves move) and the render does real work
 * each pump: a static snapshot would let a render-on-change migration no-op the
 * whole update and hide a regression. (2) Each timed sample covers a BATCH of
 * pumps, not one: `performance.now()` in a non-cross-origin-isolated context is
 * clamped to ~0.1ms, so a single sub-millisecond pump is quantized to the timer
 * floor and a 5% gate would be noise. Batching lifts each sample to tens of
 * milliseconds, well above the floor, and the per-pump cost is the batch time
 * divided by the batch size. Returns the median/p95/mean of those per-pump costs.
 */
export function benchmarkUiUpdate(opts: { n: number; batch: number }): UiUpdateSample {
  const { n, batch } = opts;
  const g = (window as any).game;
  for (let i = 0; i < 50; i++) {
    g.sim.clock.advance(1);
    g.ui.update(g.sim);
  } // warm up on the change path
  const samples: number[] = [];
  const iters = Math.ceil(n / batch);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    for (let k = 0; k < batch; k++) {
      g.sim.clock.advance(1);
      g.ui.update(g.sim);
    }
    samples.push((performance.now() - t0) / batch);
  }
  samples.sort((a, b) => a - b);
  // Map the percentile onto the 0-based sorted array via (length - 1): flooring
  // p/100 * length would bias p95 toward the 96th percentile and skew an
  // even-count median high.
  const pct = (p: number): number => samples[Math.floor((p / 100) * (samples.length - 1))];
  return { n: iters * batch, batch, medianMs: pct(50), p95Ms: pct(95), meanMs: samples.reduce((s, x) => s + x, 0) / samples.length };
}

/**
 * Profile (B): with the sim at a high speed and the page CPU-throttled by the
 * caller (CDP), advance real frames for `windowMs` and report how many sim-minutes
 * the clock moved per real second. This measures "same speed or faster" through the
 * WHOLE loop (the pump feeds the engine's dt accounting), so a heavier pump that
 * stretches frames and stalls the clock shows up here even when the isolated render
 * (A) looks fine. Driven by rAF so it rides the real frame loop. A wall-clock
 * `setTimeout` fallback resolves the promise even if rAF is starved to zero, so a
 * stalled loop fails the assertion fast rather than hanging to the test timeout.
 */
export function measureSimSpeed(windowMs: number): Promise<number> {
  const g = (window as any).game;
  return new Promise<number>((resolve) => {
    const startClock = g.sim.clock.minutes as number;
    const startWall = performance.now();
    let done = false;
    let fallback = 0;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(fallback); // no stray timer bleeding into the next window
      const elapsed = performance.now() - startWall;
      const simMinutes = (g.sim.clock.minutes as number) - startClock;
      resolve(simMinutes / (elapsed / 1000));
    };
    const tick = (): void => {
      if (done) return;
      if (performance.now() - startWall >= windowMs) {
        finish();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // Belt-and-braces: if rAF never fires (starved/backgrounded), still resolve a
    // little after the window so the measurement can't hang.
    fallback = setTimeout(finish, windowMs + 2000) as unknown as number;
  });
}

/**
 * Profile (C): pump the UI `pumps` times (advancing the clock so the snapshot
 * actually changes) and report whether the key DOM nodes keep their identity. The
 * status leaf spans (money/pop/star/time/date) are textContent writes and must
 * NEVER be replaced. The tower-stats CONTAINER must also persist; its CHILDREN are
 * rebuilt by the pre-E5 `innerHTML =` and become stable only once E5-S1 lands, so
 * `towerStatsChildStable` is reported (not asserted) here and flips true then.
 */
export function checkNodeIdentity(pumps: number): {
  statusLeavesStable: boolean;
  towerStatsContainerStable: boolean;
  towerStatsChildStable: boolean;
} {
  const g = (window as any).game;
  const el = g.ui.el;
  const before = { money: el.money, pop: el.pop, star: el.star, time: el.time, date: el.date, towerStats: el.towerStats };
  const beforeChild = el.towerStats.firstElementChild;
  for (let i = 0; i < pumps; i++) {
    // One minute per pump: enough to change the time leaf (the change path)
    // without shoving the tower hours into a different time-of-day regime for
    // the measurements that follow in the same run.
    g.sim.clock.advance(1);
    g.ui.update(g.sim);
  }
  const statusLeavesStable =
    before.money === el.money &&
    before.pop === el.pop &&
    before.star === el.star &&
    before.time === el.time &&
    before.date === el.date;
  return {
    statusLeavesStable,
    towerStatsContainerStable: before.towerStats === el.towerStats,
    towerStatsChildStable: beforeChild === el.towerStats.firstElementChild,
  };
}
