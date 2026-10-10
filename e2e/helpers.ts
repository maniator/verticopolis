/**
 * Browser-side E2E helpers. The in-page functions (`buildToStar`, `fitCamera`,
 * `syncEngine`) are SELF-CONTAINED (no module-scope refs) because Playwright
 * serializes them into `page.evaluate`; the canonical, richly-asserted build
 * lives in the Tier-1 fixture `src/tests/fixtures`. The Node-side helpers
 * (`tsOnlyOnWasm`, `expectEngineHosted`) run in the test itself.
 *
 * Engine parity (story-engine-test-parity AC2): the `chromium-wasm` project
 * boots every page on the WASM engine, where the TypeScript `Simulation` is a
 * read model and only relayed commands (`sim.build`, `sim.buildTransport`,
 * `sim.evaluateStar`, `sim.tick`, a money write, a save the app adopts) reach
 * the engine. A direct `tower.place` or field write changes the read model
 * alone, so a spec that scripted its tower that way left the engine untested.
 * The helpers here stage towers through those relayed routes, and the specs'
 * own commands are the same on both projects. One exception: `buildToStar`
 * keeps its in-place build on the TypeScript engine (see there).
 */

import { test, expect, type Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The Playwright project that seeds `vc.engine = wasm` (playwright.config.ts). */
export const WASM_PROJECT = "chromium-wasm";

/**
 * Skip the calling test on the `chromium-wasm` project, with the reason in the
 * report. Use it only where a spec's point cannot survive a relayed setup; the
 * one-line reason is what the story's TypeScript-only table quotes, so grep
 * for `tsOnlyOnWasm(` to list them all.
 */
export function tsOnlyOnWasm(reason: string): void {
  test.skip(test.info().project.name === WASM_PROJECT, `TypeScript-only on ${WASM_PROJECT}: ${reason}`);
}

/**
 * Fail a `chromium-wasm` test unless the live tower runs on the engine: the
 * host is up, it reports the current tower hosted with no errors, and the
 * app's `sim` is the instance the host attached to (the host installs its own
 * `serialize` on that instance, so a `sim` swapped in behind the host's back
 * has none). Without this a spec could pass on the project while the page
 * silently ran the TypeScript engine. A no-op on the other projects.
 */
export async function expectEngineHosted(page: Page): Promise<void> {
  const info = test.info();
  if (info.project.name !== WASM_PROJECT || info.expectedStatus === "skipped") return;
  // Leave an already-failed test's own failure on top of the report.
  if (info.status === "failed" || info.status === "timedOut" || info.status === "interrupted") return;
  const state = await page.evaluate(() => {
    const w = window as any;
    const h = w.__vcEngine;
    return {
      host: Boolean(h),
      hosted: Boolean(h?.status?.hosted),
      errors: (h?.status?.errors ?? []) as string[],
      liveSimHosted: Boolean(w.game?.sim) && Object.prototype.hasOwnProperty.call(w.game.sim, "serialize"),
    };
  });
  expect(state, "the chromium-wasm project must run the live tower on the WASM engine").toEqual({
    host: true,
    hosted: true,
    errors: [],
    liveSimHosted: true,
  });
}

/**
 * The engine's own save on the `chromium-wasm` project (null elsewhere), for a
 * spec that asserts the engine reached a state rather than the read model.
 */
export async function engineSave(page: Page): Promise<Record<string, any> | null> {
  if (test.info().project.name !== WASM_PROJECT) return null;
  return page.evaluate(() => {
    const host = (window as any).__vcEngine?.current();
    return host ? JSON.parse(host.engine.serialize()) : null;
  });
}

/**
 * Refresh the read model from the engine now (a full merge of the engine's
 * save), so what a test reads next is the engine's state. The specs run at
 * speed 0, where no frame ticks the engine and so nothing syncs on its own.
 * A no-op on the TypeScript engine.
 */
export function syncEngine(): void {
  (window as any).__vcEngine?.current()?.syncStructure();
}

/**
 * Grow the one persistent tower (window.game.sim) until `evaluateStar()` reaches
 * `target` star, then return sim.star. Cumulative: call it with 1,2,…,6 in turn
 * and each call extends the SAME tower (taller, more offices, the next gate), so
 * the run tells a real 1★→TOWER growth story. Deterministic: the rating is
 * driven directly (no crowd tick), exactly like the headless fixture.
 *
 * On the TypeScript engine the instance is the engine, so the tower is scripted
 * on it in place (the perf gate's committed baseline measures exactly that
 * tower). On the WASM engine the structure and the occupancy are scripted on a
 * scratch copy of the live tower, loaded from the engine's own save, and the
 * app then adopts that copy, which is the load a player's save takes: the host
 * follows `adoptSim` and starts the engine from it. Every later step there is a
 * relayed command, so the engine evaluates the star and, at TOWER, runs the
 * VIP inspection itself. The undo-restore flavor of `adoptSim` keeps the
 * camera, as the in-place build does.
 */
export function buildToStar(target: number): number {
  const g = (window as any).game;
  const sync = () => (window as any).__vcEngine?.current()?.syncStructure();
  const scratch = () => {
    const Sim = g.sim.constructor;
    return Sim.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
  };
  const W = g.grid.width;
  const hosted = Boolean((window as any).__vcEngine?.current());
  // The WASM engine was asked for but holds no tower: building in place here
  // would script the read model alone, so fail loudly instead.
  let wantsWasm = false;
  try {
    // The same rule as engineRequested (src/wasmhost/engineChoice.ts): the
    // query wins, then the stored choice.
    const q = new URLSearchParams(location.search).get("engine");
    wantsWasm = q === "wasm" || (q !== "ts" && localStorage.getItem("vc.engine") === "wasm");
  } catch {
    /* storage blocked: decide on the host alone */
  }
  if (wantsWasm && !hosted) throw new Error("buildToStar: the WASM engine was requested but no host holds the tower");
  g.speed = 0; // freeze time so the crowd sim can't churn the setup
  const s = hosted ? scratch() : g.sim;
  const t = s.tower;
  s.money = 1e9;

  // Office top floor per rung, sized so population lands in that star's band.
  const officeTop = { 1: 3, 2: 6, 3: 12, 4: 37, 5: 62, 6: 99 }[target] as number;
  const structTop = target === 6 ? 100 : officeTop; // floor 100 carries the hall

  // Ground lobby, extended OUTWARD from center (lay from the center out:
  // ground floors must connect to existing structure).
  const c = Math.floor(W / 2);
  for (let x = c; x < W; x++) t.place("lobby", 1, x);
  for (let x = c - 1; x >= 0; x--) t.place("lobby", 1, x);

  // Deep basement (full width) once we need the basement-only Recycling / Metro.
  if (target >= 4) for (let f = 0; f >= -9; f--) for (let x = 0; x < W; x++) t.place("floor", f, x);

  // Above-ground structure + offices up to the current height (idempotent: a
  // re-place of an existing tile fails harmlessly, so this just extends).
  for (let f = 2; f <= structTop; f++) for (let x = 4; x < W - 4; x++) t.place("floor", f, x);
  for (let f = 3; f <= officeTop; f++) for (let x = 34; x + 9 <= W - 4; x += 9) t.place("office", f, x);

  for (const u of t.units as any[]) {
    if (u.kind === "office" || u.kind === "condo") {
      u.state = "occupied";
      u.everOccupied = true;
      u.satisfaction = 1;
    } else if (u.kind === "hotelSuite") {
      u.state = "asleep";
      u.everOccupied = true;
      u.satisfaction = 1;
    }
  }

  // Gates, added at the rung they unlock.
  if (target >= 3) t.place("security", 2, 24);
  if (target >= 4) {
    t.place("medical", 2, 44);
    // Recycling demand scales with population (~2,500/center): the full tower
    // runs ~19k occupants, so a row of nine centers (22.5k capacity) keeps
    // demand met at every rung, same sizing as the Tier-1 fixture.
    for (let i = 0; i < 9; i++) t.place("recycling", -1, 64 + i * 20);
    t.place("hotelSuite", 2, 84);
    t.place("hotelSuite", 2, 100);
    // One working parking space per suite (canon), chained to a ramp, clear
    // of the recycling row on B1.
    t.place("parkingRamp", 0, 260);
    t.place("parking", 0, 266);
    t.place("parking", 0, 272);
    s.vipFavorable = true;
  }
  if (target >= 5) t.place("metro", -9, 0);

  if (!hosted) {
    s.evaluateStar();
    if (target === 6) {
      s.build("weddingHall", 100, c); // schedules the VIP inspection
      const wh = (t.units as any[]).find((u) => u.kind === "weddingHall");
      if (wh && wh.state === "construction") wh.state = "empty"; // done building
      s.clock.advance(10 * 24 * 60);
      s.checkVip(); // real win logic → star 6, evaluatedTower = true
    }
    return s.star;
  }

  g.adoptSim(s, true);
  g.speed = 0; // adopting the tower can dismiss a lingering title screen, whose teardown resumes play
  g.sim.evaluateStar();
  sync();

  if (target === 6) {
    // The hall schedules the VIP inspection three days out. Its construction
    // finishing and the calendar reaching the visit are scripted on a second
    // save (no command fast-forwards either), parked one minute before the
    // inspection day, and one relayed minute then runs the engine's own day
    // pass: the real win logic (`checkVip`) on whichever engine hosts the tower.
    const r = g.sim.build("weddingHall", 100, c);
    if (!r.ok) throw new Error(`wedding hall refused: ${r.reason ?? "unknown"}`);
    sync();
    const s2 = scratch();
    const wh = (s2.tower.units as any[]).find((u) => u.kind === "weddingHall");
    if (wh && wh.state === "construction") wh.state = "empty"; // done building
    if (!(s2.vipVisitDay > s2.clock.day)) throw new Error(`the hall scheduled no VIP visit ahead (vipVisitDay ${s2.vipVisitDay}, day ${s2.clock.day})`);
    s2.clock.minutes = s2.vipVisitDay * 24 * 60 - 1;
    g.adoptSim(s2, true);
    g.speed = 0;
    g.sim.tick(1);
    sync();
    // The relayed minute runs the whole day pass, random events included. The
    // seeded tower rolls none; an emergency here would pre-empt the TOWER
    // modal, so it fails loudly rather than as a missing modal later.
    if (g.sim.pendingChoice) throw new Error(`the inspection day rolled an emergency: ${g.sim.pendingChoice.kind}`);
  }
  return g.sim.star;
}

/**
 * Frame the whole tower: center the camera, then zoom so the built floor span
 * fits the viewport height (clamped to the engine's 0.3–3 range — which lands
 * small towers low with sky above and fills the frame at TOWER). Derives the
 * current zoom from two world points since there's no absolute-zoom setter.
 */
export function fitCamera(): void {
  const g = (window as any).game;
  const e = g.engine;
  const FLOOR = 34;
  e.center();
  const cur = Math.abs(e.worldToScreenY(1) - e.worldToScreenY(0)) / FLOOR;
  let minF = 1;
  let maxF = 1;
  for (const u of g.sim.tower.units as any[]) {
    if (u.floor < minF) minF = u.floor;
    if (u.floor > maxF) maxF = u.floor;
  }
  const floors = maxF - minF + 8; // a little sky/margin
  const desired = e.viewHeight / (floors * FLOOR);
  e.zoomAt(desired / cur, g.grid.width * 0, e.viewHeight / 2); // vertical fit; recenter next
  e.center();
}
