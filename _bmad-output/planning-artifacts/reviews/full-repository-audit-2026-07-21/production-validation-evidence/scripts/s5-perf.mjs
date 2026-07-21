/**
 * Phase 5: real-GPU frame performance on the live origin (RTX 3060, headed
 * Chrome 150, 75 Hz display, DevTools closed). Loads each owner save through
 * the production Saves -> Import UI, warms up, then samples rAF frame times,
 * long tasks, JS heap, and sim-clock minutes (to correlate hour boundaries).
 * 3 runs per config; extra configs on the largest save (congestion overlay,
 * speed 3).
 */
import fs from "node:fs";
import path from "node:path";
import { launch, attachCollectors, waitGameReady, startNewClassic, saveJson, snap, log, summarizeBucket, EV, ORIGIN } from "./common.mjs";

const WARMUP_MS = 10000;
const SAMPLE_MS = 30000;
const RUNS = 3;

const CONFIGS = [
  { name: "fresh-40u", save: null, runs: RUNS },
  { name: "towerone_4", save: "towerone_4.vctower", runs: RUNS },
  { name: "sixseven_8", save: "sixseven_8.vctower", runs: RUNS },
  { name: "sixseven_15", save: "sixseven_15.vctower", runs: RUNS },
  { name: "sixseven_15-congestion-overlay", save: "sixseven_15.vctower", overlay: "congestion", runs: 2, reuse: "sixseven_15" },
  { name: "sixseven_15-speed3", save: "sixseven_15.vctower", speed: 3, runs: 2, reuse: "sixseven_15" },
];

const SAMPLER = `(async (sampleMs) => {
  const deltas = [];
  const minutes = [];
  const longTasks = [];
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push({ start: e.startTime, dur: e.duration });
  });
  po.observe({ type: "longtask", buffered: false });
  const memBefore = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
  const t0 = performance.now();
  let last = t0;
  await new Promise((done) => {
    const step = (t) => {
      deltas.push(t - last);
      minutes.push(window.game.sim.clock.minutes);
      last = t;
      if (t - t0 >= sampleMs) done();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  po.disconnect();
  const memAfter = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
  const sorted = [...deltas].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const spikes = [];
  for (let i = 0; i < deltas.length; i++) {
    if (deltas[i] > 100) spikes.push({ i, ms: +deltas[i].toFixed(1), simMinute: minutes[i], minuteOfHour: ((minutes[i] % 60) + 60) % 60 });
  }
  const wallS = (last - t0) / 1000;
  return {
    frames: deltas.length,
    wallS: +wallS.toFixed(1),
    avgFps: +(deltas.length / wallS).toFixed(1),
    medianFrameMs: +q(0.5).toFixed(2),
    medianFps: +(1000 / q(0.5)).toFixed(1),
    p95FrameMs: +q(0.95).toFixed(2),
    p99FrameMs: +q(0.99).toFixed(2),
    maxFrameMs: +sorted[sorted.length - 1].toFixed(1),
    longTaskCount: longTasks.length,
    longTaskTotalMs: +longTasks.reduce((s, t) => s + t.dur, 0).toFixed(0),
    longestTaskMs: +(longTasks.reduce((m, t) => Math.max(m, t.dur), 0)).toFixed(0),
    mainThreadBusyPct: +(100 * longTasks.reduce((s, t) => s + t.dur, 0) / (wallS * 1000)).toFixed(1),
    simMinutesAdvanced: minutes[minutes.length - 1] - minutes[0],
    hourBoundariesCrossed: Math.floor(minutes[minutes.length - 1] / 60) - Math.floor(minutes[0] / 60),
    spikeCount: spikes.length,
    spikes: spikes.slice(0, 25),
    memBefore, memAfter,
  };
})`;

async function importSave(page, file) {
  await page.click("#btn-load");
  await page.waitForSelector("#modal[open]");
  const chooser = page.waitForEvent("filechooser", { timeout: 15000 });
  await page.click('#modal [data-act="import"]');
  const fc = await chooser;
  const t0 = Date.now();
  await fc.setFiles(path.join(EV, "saves", file));
  await page.waitForFunction(() => !document.getElementById("modal")?.open && window.game.sim.tower.units.length > 100, undefined, { timeout: 120000 });
  return Date.now() - t0;
}

const results = [];
let ctx = null, page = null, bucket = null, profileDir = null, loadedSave = null;

async function freshContext() {
  if (ctx) {
    await ctx.close();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
  ({ ctx, profileDir } = await launch({ profile: "fresh" }));
  bucket = {};
  page = ctx.pages()[0] ?? (await ctx.newPage());
  attachCollectors(page, bucket);
  await page.goto(ORIGIN + "/", { waitUntil: "load" });
  await waitGameReady(page);
  await startNewClassic(page);
  await page.waitForTimeout(500);
  loadedSave = null;
}

for (const cfg of CONFIGS) {
  const canReuse = cfg.reuse && loadedSave === cfg.reuse && page;
  if (!canReuse) {
    await freshContext();
    if (cfg.save) {
      const importMs = await importSave(page, cfg.save);
      loadedSave = cfg.reuse ?? cfg.name;
      log(`imported ${cfg.save} in ${importMs}ms`);
      cfg.importMs = importMs;
    }
  }
  // Configure: overlay, speed, fit camera so the tower actually renders.
  await page.evaluate(
    ([overlay, speed]) => {
      const gm = window.game;
      gm.setOverlay(overlay ?? "");
      const sel = document.getElementById("overlay-mode");
      if (sel) sel.value = overlay ?? "";
      gm.setSpeed(speed ?? 1);
      // fitCamera equivalent (from e2e/helpers.ts)
      const e = gm.engine, FLOOR = 34;
      e.center();
      const cur = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(0)) / FLOOR;
      let minF = 1, maxF = 1;
      for (const u of gm.sim.tower.units) { if (u.floor < minF) minF = u.floor; if (u.floor > maxF) maxF = u.floor; }
      const desired = e.viewHeight / ((maxF - minF + 8) * FLOOR);
      e.zoomAt(desired / cur, 0, e.viewHeight / 2);
      e.center();
    },
    [cfg.overlay ?? null, cfg.speed ?? 1],
  );
  const facts = await page.evaluate(() => ({ units: window.game.sim.tower.units.length, pop: document.getElementById("stat-pop")?.textContent, star: document.getElementById("stat-star")?.textContent?.trim(), money: window.game.sim.money }));
  log(`config ${cfg.name}: units=${facts.units} pop=${facts.pop} star=${facts.star}`);
  await snap(page, `s5-${cfg.name}`);
  await page.waitForTimeout(WARMUP_MS);
  const runs = [];
  for (let r = 0; r < cfg.runs; r++) {
    const m = await page.evaluate(`${SAMPLER}(${SAMPLE_MS})`);
    runs.push(m);
    log(`  run ${r + 1}/${cfg.runs}: medianFps=${m.medianFps} avgFps=${m.avgFps} p95=${m.p95FrameMs}ms max=${m.maxFrameMs}ms longTasks=${m.longTaskCount} busy=${m.mainThreadBusyPct}% hours=${m.hourBoundariesCrossed} spikes=${m.spikeCount}`);
  }
  results.push({ ...cfg, facts, runs, collectors: summarizeBucket(bucket) });
  // Reset speed/overlay for a possible reuse follow-up
  await page.evaluate(() => { window.game.setSpeed(1); window.game.setOverlay(""); });
}

await ctx.close();
fs.rmSync(profileDir, { recursive: true, force: true });
saveJson("s5-perf.json", { when: new Date().toISOString(), machine: "AMD Ryzen 5 5600X / RTX 3060 / 32GB / Win11 Pro / Chrome 150.0.7871.125 / 75Hz / DPR 1 / DevTools closed / headed", warmupMs: WARMUP_MS, sampleMs: SAMPLE_MS, results });
log("DONE");
