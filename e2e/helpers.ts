/**
 * Browser-side E2E helpers. The in-page functions (`buildToStar`, `fitCamera`,
 * `syncEngine`) are SELF-CONTAINED (no module-scope refs) because Playwright
 * serializes them into `page.evaluate`; the canonical, richly-asserted build
 * lives in the Tier-1 fixture `src/tests/fixtures`. The Node-side helper
 * (`expectEngineHosted`) runs in the test itself.
 *
 * Every page boots on the WASM engine, where `game.sim` is a copy of the
 * engine's save (src/game/toolingSim.ts). Commands and field writes on the
 * copy reach the engine when the task ends, or at `syncEngine`, as a restore
 * of the copy's save; the next read is a fresh copy. The engine itself runs
 * whatever a spec ticks through the app or the port.
 */

import { test, expect, type Page } from "@playwright/test";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "../src/ui/overviewMapPrefs";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * For a test about something else: store an explicit Map close (#343) before
 * the page's scripts run, and hide the Map button, so the open-by-default
 * desktop Map and its button stay out of the test's pixels.
 */
export async function hideMapBeforeLoad(page: Page): Promise<void> {
  await page.addInitScript(
    ({ keys, value }) => {
      try {
        for (const key of keys) localStorage.setItem(key, value);
      } catch {
        // No storage: the Map may open, and the style below still hides it.
      }
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = ".overview-map, .overview-map-toggle { display: none !important; }";
        document.head.append(style);
      });
    },
    { keys: Object.values(MAP_OPEN_STORAGE_KEY), value: MAP_OPEN_VALUE.closed },
  );
}

/**
 * Fail a test unless the live tower runs on the engine: the Rust engine is
 * published, it reports itself hosting with no error, and it is the port the
 * app holds.
 */
export async function expectEngineHosted(page: Page): Promise<void> {
  const info = test.info();
  if (info.expectedStatus === "skipped") return;
  // Leave an already-failed test's own failure on top of the report.
  if (info.status === "failed" || info.status === "timedOut" || info.status === "interrupted") return;
  const state = await page.evaluate(() => {
    const w = window as any;
    const h = w.__vcEngine;
    return {
      host: Boolean(h),
      hosted: Boolean(h?.status?.hosted),
      lastError: h?.status?.lastError ?? null,
      onEngine: Boolean(h?.port) && w.game?.enginePort === h.port,
    };
  });
  expect(state, "the live tower must run on the WASM engine").toEqual({
    host: true,
    hosted: true,
    lastError: null,
    onEngine: true,
  });
}

/** The arguments `dispatchTouch` hands its in-page half. */
function touchArgs(type: string, id: number, x: number, y: number) {
  return { type, id, x, y };
}

/**
 * Dispatch one synthetic touch PointerEvent on the game canvas at
 * canvas-relative coordinates, then wait until Excalibur has run a frame, which
 * is when it reads the event. Fails if no frame comes within five seconds.
 */
export async function dispatchTouch(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  id: number,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(({ type, id, x, y }) => {
    const ex = (window as any).game?.engine?.engine;
    const startFrame = Number.isFinite(ex?.stats?.currFrame?.id) ? ex.stats.currFrame.id : null;
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        isPrimary: false,
        button: 0,
        buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
        clientX: r.left + x,
        clientY: r.top + y,
        bubbles: true,
        cancelable: true,
      }),
    );
    // Excalibur flushes pointer events in its update loop; usually two frames are enough.
    // On overloaded CI, rAF can stall for a while, so the wait is bounded by a generous cap (a stall that long is a real failure).
    return new Promise<void>((done, fail) => {
      let settled = false;
      const frameAdvanced = () => {
        if (startFrame === null) return false;
        const now = (window as any).game?.engine?.engine?.stats?.currFrame?.id;
        return Number.isFinite(now) && now > startFrame;
      };
      const finish = (ok: boolean, reason: string) => {
        if (settled) return;
        settled = true;
        if (ok) done();
        else fail(new Error(reason));
      };
      // Do not treat a missing Excalibur frame as success. If the engine can
      // not provide a stats frame, the test must fail fast rather than mask a
      // missing input update behind a synthetic pass.
      if (startFrame === null) {
        finish(false, "Excalibur frame stats were unavailable before pointer dispatch");
        return;
      }
      let frames = 0;
      const onFrame = () => {
        frames++;
        if (frames >= 2) finish(frameAdvanced(), "pointer event dispatch finished before Excalibur advanced a frame");
        else requestAnimationFrame(onFrame);
      };
      requestAnimationFrame(onFrame);
      setTimeout(() => finish(frameAdvanced(), "pointer event dispatch timed out before Excalibur advanced a frame"), 5_000);
    });
  }, touchArgs(type, id, x, y));
}

/** The engine's own save (null before the engine is published), for a spec that
 *  asserts the engine reached a state. */
export async function engineSave(page: Page): Promise<Record<string, any> | null> {
  return page.evaluate(() => {
    const port = (window as any).__vcEngine?.port;
    return port ? JSON.parse(port.serialize()) : null;
  });
}

/**
 * Hand the edits a test made to `game.sim` to the engine now. On the Rust
 * engine `game.sim` is a copy of the engine's save (src/game/toolingSim.ts),
 * whose edits otherwise reach the engine when the task ends.
 */
export function syncEngine(): void {
  (window as any).game.syncSim();
}

/**
 * Grow the one persistent tower (window.game.sim) until `evaluateStar()` reaches
 * `target` star, then return sim.star. Cumulative: call it with 1,2,…,6 in turn
 * and each call extends the SAME tower (taller, more offices, the next gate), so
 * the run tells a real 1★→TOWER growth story. Deterministic: the rating is
 * driven directly (no crowd tick), exactly like the headless fixture.
 *
 * The structure and the occupancy are scripted on a
 * scratch copy of the live tower, loaded from the engine's own save, and the
 * app then adopts that copy, which the engine restores. The minute that runs
 * the VIP inspection at TOWER is a tick of the engine itself. The
 * restore flavor of `adoptSim` keeps the camera, as the in-place build
 * does.
 */
export function buildToStar(target: number): number {
  const g = (window as any).game;
  const sync = () => (window as any).game.syncSim();
  const scratch = () => {
    const Sim = g.sim.constructor;
    return Sim.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
  };
  const W = g.grid.width;
  const port = (window as any).__vcEngine?.port;
  // The Rust engine is the only engine, so a tower it does not hold would be
  // scripted into the read model alone: fail loudly instead.
  if (!port || g.enginePort !== port) throw new Error("buildToStar: no engine host holds the tower");
  g.speed = 0; // freeze time so the crowd sim can't churn the setup
  const s = scratch();
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
  if (target >= 3) {
    t.place("security", 2, 24);
    t.place("security", 2, 40); // the 3★ gate wants two offices (16 wide each)
  }
  if (target >= 4) {
    t.place("medical", 2, 56); // 26 wide, clear of both offices
    // Recycling demand scales with population (~2,500/center): the full tower
    // runs ~19k occupants, so a row of nine centers (22.5k capacity) keeps
    // demand met at every rung, same sizing as the Tier-1 fixture. A center
    // is 25 wide, so they sit 25 apart.
    for (let i = 0; i < 9; i++) t.place("recycling", -1, 64 + i * 25);
    t.place("hotelSuite", 2, 84);
    t.place("hotelSuite", 2, 100);
    // One working parking space per suite (canon), chained to a ramp, clear
    // of the recycling row on B1.
    t.place("parkingRamp", 0, 300);
    t.place("parking", 0, 316);
    t.place("parking", 0, 320);
    s.vipFavorable = true;
  }
  if (target >= 5) t.place("metro", -9, c - 15); // 30 wide, under the tower

  g.adoptSim(s, true);
  g.speed = 0; // adopting the tower can dismiss a lingering title screen, whose teardown resumes play
  g.sim.evaluateStar();
  sync();

  if (target === 6) {
    // The hall schedules the VIP inspection three days out. Its construction
    // finishing and the calendar reaching the visit are scripted on a second
    // save (no command fast-forwards either), parked one minute before the
    // inspection day, and one relayed minute then runs the engine's own day
    // pass: the real win logic (`checkVip`) on the engine.
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
    port.tick(1);
    g.reader.update();
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
