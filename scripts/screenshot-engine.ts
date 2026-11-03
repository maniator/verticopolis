/**
 * The engine the gallery renders on (story-engine-test-parity AC3), and the
 * settle points that make a scene build and its shots repeatable (#899).
 *
 * The committed gallery is the Rust engine's (#1353): every game scene renders
 * with the WASM engine hosting the tower. The game boots on it with no
 * stored choice, and the hosted checks below fail a scene that did not end up on the engine, so
 * a missing engine package can never render under a green gate.
 *
 * On the Rust engine `game.sim` is a copy of the engine's save
 * (src/game/toolingSim.ts): scene builders build in place (a fresh
 * `Simulation` swapped into `game.sim`, `tower.place`, unit state writes), and
 * the copy hands what they did to the engine as a restore of its save. The
 * scenes also go through the app's load path (`adoptSim`) at the settle points
 * below. A load is not a no-op: it prices an unpriced Classic room on its
 * ladder, adopts the milestones the tower already meets, and starts the crowd,
 * the boarding tally and the housekeeping report empty. So the tower loads at
 * fixed points: before a builder's ticks (`__vcShotHandoff`), once a game
 * scene is ready (after its build, if it has one, unless the builder already
 * settled), and after the setups listed in SETTLE_AFTER_SETUP. Before a build
 * or a listed setup `beginSettleStep` hands on any pending edit, so the step
 * edits the engine's current tower.
 *
 * Each settle carries the loop's pass memos and the elevator telemetry
 * across, from the engine, and the copy hands both back with its edits.
 *
 * Everywhere else the scene checks that what a clock pin or a setup changed
 * reached the engine (see SETTLE_AFTER_SETUP for what that covers).
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties). The
 * `pg*` functions are BROWSER-INJECTED: self-contained, no module-scope refs.
 */
import { type Page } from "playwright";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The Rust render needs the engine package in the build this script serves.
 *  Say so up front instead of timing out on every game scene. A run against an
 *  already-served BASE_URL builds nothing here, so it is not checked. */
export function assertEnginePackage(): void {
  if (process.env.BASE_URL) return;
  if (existsSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "public", "engine", "BUILD.json"))) return;
  throw new Error("The gallery renders on the Rust engine, but src/public/engine/ has no engine package: run `npm run wasm:build`.");
}

/** The shots whose setup edits the tower in place (a unit's state or
 *  occupancy, a fire, a placed room), as "scene/shot". Such an edit reaches the
 *  engine as a load of the copy's save, so the scene settles after these setups
 *  and loads at a fixed point; `beginSettleStep` hands on any pending edit
 *  first, so the setup edits the engine's current tower. A setup missing from
 *  the list is caught by the hosted check, which finds the edit unfollowed. */
export const SETTLE_AFTER_SETUP: ReadonlySet<string> = new Set<string>([
  // Builds the demo tower in place on the live instance.
  "engine/11-game-tower",
  // Each rank grows the tower in place (growToStar); the capstone builds
  // the hero tower.
  "milestones/1-star",
  "milestones/2-star",
  "milestones/3-star",
  "milestones/4-star",
  "milestones/5-star",
  "milestones/tower",
  // Stages five vacant offices by writing their state.
  "stats/stats-tenancy-classic",
]);

/** BROWSER-INJECTED (installed as `window.__vcShotShape`): the fields of a save
 *  that a builder or a setup edits by hand, the shape every hosted check
 *  compares. Every unit and transport row has a fixed length. */
export function shotShape(v: any): any {
  return {
    star: v.star,
    // Money stays out: a build on fresh ground can roll a treasure from the
    // copy's rng, which the engine's own build need not match (#868), a
    // known gap that must not fail a scene. A money write reaches the engine
    // as `setMoney`.
    minutes: v.minutes,
    vipVisitDay: v.vipVisitDay,
    builtWeddingHall: v.builtWeddingHall,
    pendingEvent: Boolean(v.events?.pending),
    units: (v.units ?? []).map((u: any) => [u.id, u.kind, u.floor, u.x, u.state, u.occupants ?? 0, u.rent ?? null, Boolean(u.noRate), Boolean(u.everOccupied), u.label ?? null]),
    transports: (v.transports ?? []).map((t: any) => [t.id, t.kind, t.x, t.bottom, t.top]),
  };
}

/** Before navigation: install the shared shape and the settle that builders
 *  call before they tick. */
export async function installShotHelpers(page: Page): Promise<void> {
  await page.addInitScript(`window.__vcShotShape = ${shotShape.toString()};`);
  await page.addInitScript(`window.__vcShotHandoff = () => (${pgSettle.toString()})();`);
}

/** Settle the tower (see the header) and fail the scene if it does not end up
 *  hosted. A title screen still up skips the settle where `allowSkip` says a
 *  skip is harmless (a scene build on a title-screen scene); a listed setup
 *  must settle. */
async function settleTower(page: Page, where: string, allowSkip: boolean): Promise<void> {
  const state = await page.evaluate(pgSettle);
  if (!state.startsWith("settled") && !(allowSkip && state.startsWith("skipped"))) throw new Error(`could not settle ${where} (${state})`);
  await expectHosted(page, where);
}

/** After a scene build or a listed setup: settle, unless the code it ran
 *  already settled before its ticks (`__vcShotHandoff`, which a builder calls).
 *  A second load would drop the crowd and the live counters those ticks grew.
 *  In that case the scene checks instead that what changed since that settle
 *  reached the engine. */
export async function settleUnlessSettled(page: Page, where: string, allowSkip: boolean): Promise<void> {
  const shape = await page.evaluate(() => {
    const w = window as unknown as { __vcShotSettled?: boolean; __vcShotSettledShape?: string };
    return w.__vcShotSettled === true ? (w.__vcShotSettledShape ?? "null") : null;
  });
  if (shape === null) return settleTower(page, where, allowSkip);
  await expectHosted(page, where);
  await checkHosted(page, where, shape, HOSTED_FIX.settled);
}

/** Before a scene build or a listed setup: forget any earlier settle, so
 *  `settleUnlessSettled` sees only one the step itself makes, and hand any
 *  pending edit of `game.sim` to the engine, so a step
 *  that edits the tower and then settles starts from the engine's current
 *  tower. Fails the scene when the engine does not hold the tower or the hand
 *  on throws. */
export async function beginSettleStep(page: Page, where: string): Promise<void> {
  const state = await page.evaluate(() => {
    const w = window as unknown as { __vcEngine?: any; __vcShotSettled?: boolean };
    w.__vcShotSettled = false;
    const vc = w.__vcEngine;
    if (!vc) return "no engine host (did the engine package load?)";
    const g = (window as unknown as { game?: any }).game;
    if (!vc.status?.hosted) return `the engine does not hold the tower (${vc.status?.lastError ?? "no error recorded"})`;
    if (!g || g.enginePort !== vc.port) return "the app does not run on the Rust engine";
    try {
      g.syncSim();
    } catch (e) {
      return `the hand on threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    return "synced";
  });
  if (state !== "synced") throw new Error(`could not hand the edits on ${where} (${state})`);
}

/** The app's engine is the Rust engine and it holds the tower. Catches a scene
 *  that rendered without it (the engine package never loaded). */
async function expectHosted(page: Page, where: string): Promise<void> {
  const hosted = await page.evaluate(() => {
    const w = window as unknown as { game?: any; __vcEngine?: any };
    if (!w.__vcEngine) return "no engine host (did the engine package load?)";
    if (!w.__vcEngine.status?.hosted) return "the engine does not hold the tower";
    return w.game?.enginePort === w.__vcEngine.port ? "hosted" : "the app does not run on the Rust engine";
  });
  if (hosted !== "hosted") throw new Error(`the tower is not on the engine ${where} (${hosted})`);
}

/** Fail the run when a SETTLE_AFTER_SETUP entry names no shot, or a shot
 *  without a setup (the settle runs after a setup only), so a renamed or
 *  reworked shot cannot drop out of the list unnoticed. */
export function checkSettleList(scenes: readonly { id: string; shots: readonly { name: string; setup?: unknown }[] }[]): void {
  const withSetup = new Set(scenes.flatMap((s) => s.shots.filter((shot) => shot.setup).map((shot) => `${s.id}/${shot.name}`)));
  const stale = [...SETTLE_AFTER_SETUP].filter((k) => !withSetup.has(k));
  if (stale.length > 0) throw new Error(`SETTLE_AFTER_SETUP names no shot with a setup: ${stale.join(", ")}`);
}

/** The page's view of the tower before a clock pin or a setup, for
 *  `checkHosted` to compare against. */
export async function hostedSnapshot(page: Page): Promise<string> {
  return page.evaluate(pgOwnShape);
}

/** Fail the scene if a clock pin or a setup changed the page's tower in a way
 *  the engine did not follow. Only what changed since `before` is compared. */
export async function checkHosted(page: Page, where: string, before: string, fix: string): Promise<void> {
  const state = await page.evaluate(pgCheckHosted, before);
  if (state !== "hosted") throw new Error(`the tower is not on the engine ${where} (${state}); ${fix}`);
}

/** What to change when `checkHosted` fails, by where it ran. */
export const HOSTED_FIX = {
  setup: "the setup's edit did not reach the engine: check the copy's hand on (src/game/toolingSim.ts), and add the shot to SETTLE_AFTER_SETUP (if only the clock differs and the setup calls pgSetClock, check pgSetClock and the engine's advanceClock instead)",
  clock: "the clock pin did not reach the engine: check pgSetClock and the engine's advanceClock",
  settled: "code that ran after a builder's __vcShotHandoff edited the tower in a way the engine did not follow: move that edit before the handoff",
} as const;

/** In-page: the page's tower (`game.sim`, the copy of the engine's save) in the
 *  shared shape, as JSON. */
export function pgOwnShape(): string {
  const w = window as unknown as { game?: any; __vcShotShape?: (v: any) => any };
  const sim = w.game?.sim;
  if (!sim || typeof w.__vcShotShape !== "function") return "null";
  return JSON.stringify(w.__vcShotShape(sim.serialize()));
}

/** In-page: compare what changed on the page since `before` with
 *  the engine's own save, in the shared shape. Returns "hosted", or what the
 *  engine did not follow. */
export function pgCheckHosted(before: string): string {
  const w = window as unknown as { game?: any; __vcEngine?: any; __vcShotShape?: (v: any) => any };
  const g = w.game;
  const vc = w.__vcEngine;
  if (!g?.sim) return "no game";
  if (typeof w.__vcShotShape !== "function") return "the shared shape is not installed (installShotHelpers did not run on this page)";
  const shapeOf = w.__vcShotShape;
  if (!vc) return "no engine host (did the engine package load?)";
  if (!vc.status?.hosted) return "the engine does not hold the tower";
  if (g.enginePort !== vc.port) return "the app does not run on the Rust engine";
  const was = JSON.parse(before);
  if (!was) return "no tower before the step";
  g.syncSim();
  const now = shapeOf(g.sim.serialize());
  const engine = shapeOf(JSON.parse(vc.port.serialize()));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ["star", "minutes", "vipVisitDay", "builtWeddingHall", "pendingEvent"]) {
    if (!same(was[key], now[key]) && !same(now[key], engine[key])) return `${key} is ${JSON.stringify(now[key])} on the page, ${JSON.stringify(engine[key])} on the engine`;
  }
  for (const key of ["units", "transports"]) {
    const byId = (rows: unknown[][]) => new Map(rows.map((r) => [r[0], r]));
    const a = byId(was[key]);
    const b = byId(now[key]);
    const e = byId(engine[key]);
    for (const [id, row] of b) {
      const prev = a.get(id);
      if (same(prev, row)) continue;
      const theirs = e.get(id);
      if (theirs === undefined) return `${key} ${JSON.stringify(row)} is on the page only`;
      // Field by field: only what the step changed has to match.
      if (row.some((v, j) => (prev === undefined || !same(v, prev[j])) && !same(v, theirs[j]))) return `${key} ${JSON.stringify(row)} on the page, ${JSON.stringify(theirs)} on the engine`;
    }
    for (const id of a.keys()) {
      if (!b.has(id) && e.has(id)) return `${key} ${String(id)} was removed on the page only`;
    }
    for (const id of e.keys()) {
      if (!a.has(id) && !b.has(id)) return `${key} ${String(id)} was added on the engine only`;
    }
  }
  return "hosted";
}

/**
 * In-page: settle the live tower through the app's load path. The page's save
 * is deserialized and adopted with `adoptSim` (undo-restore flavor, so the
 * camera and history stay) and the engine loads it. What a load resets is
 * carried over from the engine: the loop's pass memos and the elevator
 * telemetry. What `adoptSim` resets in the app is put back (speed, pause, the star and win
 * latches, the step accumulator, the meal-rush day, the log cursor and
 * panel, the selection). Skips while the title screen is up, since
 * `adoptSim` would dismiss it.
 * Returns "settled", "skipped: ...", or why it failed.
 */
export function pgSettle(): string {
  const run = (): string => {
    const w = window as unknown as { game?: any; __vcEngine?: any; __vcShotSettled?: boolean; __vcShotSettledShape?: string; __vcShotShape?: (v: any) => any };
    const g = w.game;
    const vc = w.__vcEngine;
    if (!g?.sim) return "no game";
    if (!vc) return "no engine host (did the engine package load?)";
    if (g.enginePort !== vc.port) return "the app does not run on the Rust engine";
    if (typeof w.__vcShotShape !== "function") return "the shared shape is not installed (installShotHelpers did not run on this page)";
    const shapeOf = w.__vcShotShape;
    // Only a title screen still in the page counts: the runner's splash
    // dismissal removes the node and can leave the controller's reference
    // behind, and the teardown that adoptSim then runs on that stale
    // reference changes nothing on screen (its pause is undone below, its
    // toast swept).
    if (document.getElementById("splash")) return "skipped: the title screen is up";
    const sim = g.sim;
    const Sim = sim.constructor;
    const engineBefore = vc.port;
    // The instance's telemetry in the engine's document shape (see
    // src/wasmhost/telemetry.ts; restated here, as injected code cannot import).
    const telemetryOf = (s: any) => ({
      util: [...s.elevatorUtil],
      hourly: [...s.elevatorHourly].map(([id, r]: [number, any]) => [id, { weekday: [...r.weekday], weekend: [...r.weekend] }]),
      origins: [...s.elevatorOrigins].map(([id, r]: [number, any]) => [id, { weekday: r.weekday.map((m: Map<number, number>) => [...m]), weekend: r.weekend.map((m: Map<number, number>) => [...m]) }]),
    });
    // Telemetry is compared as parsed values with sorted keys: the engine
    // writes a whole float as 0.0 and its keys in its own order.
    const canonOf = (v: unknown) =>
      JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    const telemetry = JSON.parse(engineBefore.elevatorTelemetry());
    const memos: number[] = [...engineBefore.loopMemos()];
    const own = sim.serialize();
    const keep = {
      speed: g.speed,
      paused: g.engine.paused,
      lastStar: g.lastStar,
      shownWin: g.shownWin,
      accMinutes: g.accMinutes,
      lastMealRushDay: { ...g.lastMealRushDay },
      logSeq: sim.logSeq,
      uiLogSeq: g.ui.lastLogSeq,
      logLines: [...g.ui.el.log.childNodes],
      selected: g.selected,
      selectedId: g.engine.selectedId,
    };
    const fresh = Sim.deserialize(JSON.parse(JSON.stringify(own)));
    // A load restarts the log cursor; keep the live one, before the engine
    // loads the tower.
    fresh.logSeq = keep.logSeq;
    // The memos and the telemetry ride on the instance; `adoptSim` seeds them
    // into the engine after the load.
    [fresh.lastHour, fresh.lastDay, fresh.lastMonth, fresh.lastQuarter] = memos;
    const adopt = (store: Map<number, unknown>, entries: [number, unknown][]) => {
      store.clear();
      for (const [id, v] of entries) store.set(id, v);
    };
    adopt(fresh.elevatorUtil, telemetry.util);
    adopt(
      fresh.elevatorHourly,
      telemetry.hourly.map(([id, r]: [number, any]) => [id, { weekday: [...r.weekday], weekend: [...r.weekend] }]),
    );
    adopt(
      fresh.elevatorOrigins,
      telemetry.origins.map(([id, r]: [number, any]) => [id, { weekday: r.weekday.map((s: [number, number][]) => new Map(s)), weekend: r.weekend.map((s: [number, number][]) => new Map(s)) }]),
    );
    let refused = "";
    try {
      g.adoptSim(fresh, true);
    } catch (e) {
      refused = `the engine refused the settled tower: ${e instanceof Error ? e.message : String(e)}`;
    }
    g.speed = keep.speed;
    g.engine.paused = keep.paused;
    g.lastStar = keep.lastStar;
    g.shownWin = keep.shownWin;
    g.accMinutes = keep.accMinutes;
    g.lastMealRushDay = keep.lastMealRushDay;
    g.ui.lastLogSeq = keep.uiLogSeq;
    g.ui.el.log.replaceChildren(...keep.logLines);
    if (keep.selected) {
      g.selected = keep.selected;
      g.engine.selectedId = keep.selectedId;
      g.refreshEditor?.();
    }
    if (refused) return refused;
    if (canonOf(JSON.parse(vc.port.elevatorTelemetry())) !== canonOf(telemetry)) return "the engine's elevator telemetry differs from the one handed to it";
    if (JSON.stringify([...vc.port.loopMemos()]) !== JSON.stringify(memos)) return "the engine's loop memos differ from the ones handed to it";
    // The page holds the carried telemetry: a fresh copy reads it back from the
    // engine, so this also checks that the copy decodes the seeded document.
    if (canonOf(telemetryOf(g.sim)) !== canonOf(telemetry)) return "the page's elevator telemetry differs from the one carried over";
    const settled = JSON.stringify(shapeOf(g.sim.serialize()));
    // The engine loaded the same tower the page did.
    if (JSON.stringify(shapeOf(JSON.parse(vc.port.serialize()))) !== settled) return "the engine's tower differs from the one handed to it";
    w.__vcShotSettled = true;
    w.__vcShotSettledShape = settled;
    return "settled";
  };
  try {
    return run();
  } catch (e) {
    return `the settle threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}
