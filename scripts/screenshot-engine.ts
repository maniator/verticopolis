/**
 * The engine the gallery renders on (story-engine-test-parity AC3, #1353), and
 * the settle points that make the two engines render the same scenes (#899).
 *
 * The committed gallery is the Rust engine's. By default (`VC_SHOT_ENGINE`
 * unset, or `wasm`) every game scene renders with the WASM engine hosting the
 * tower, the way the `chromium-wasm` Playwright project does: the stored
 * engine choice (`vc.engine`, src/wasmhost/engineChoice.ts) is seeded before
 * any page script runs. `VC_SHOT_ENGINE=ts` renders the same scenes on the
 * TypeScript engine, which stays selectable until it is retired: the
 * pr-drift-check parity leg renders this way and compares the result with the
 * Rust render of the same head; a pixel difference between the engines is a
 * parity finding. The TypeScript leg also seeds its choice, so it stays the
 * TypeScript engine after the default flips.
 *
 * Under the host the TypeScript `Simulation` is a read model, and only relayed
 * commands and loads reach the engine. Scene builders build in place (a fresh
 * `Simulation` swapped into `game.sim`, `tower.place`, unit state writes), and
 * some shot setups edit units the same way, so the WASM leg reaches the engine
 * through the app's load path (`adoptSim`). A load is not a no-op: it prices
 * an unpriced Classic room on its ladder, adopts the milestones the tower
 * already meets, and starts the crowd, the boarding tally and the housekeeping
 * report empty. So both legs load at the same points: before a builder's
 * ticks (`__vcShotHandoff`), once a game scene is ready (after its build, if
 * it has one, unless the builder already settled), and after the setups
 * listed in SETTLE_AFTER_SETUP. Before a build or a listed setup the WASM leg
 * merges (`beginSettleStep`), so the step edits the engine's current tower.
 *
 * Each settle carries the loop's pass memos and the elevator telemetry
 * across, so the owed passes and a builder's authored demand curve survive on
 * both legs alike. Once a tower is hosted, both come from the engine; a curve
 * authored on the read model alone never reached it.
 *
 * Everywhere else the WASM leg checks that what a clock pin or a setup
 * changed reached the engine (see SETTLE_AFTER_SETUP for what that covers).
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties). The
 * `pg*` functions are BROWSER-INJECTED: self-contained, no module-scope refs.
 */
import { type Page } from "playwright";

export type ShotEngine = "ts" | "wasm";

/** Read the engine switch; unset is the Rust engine. A typo fails the run
 *  instead of silently rendering one engine under the other's label. */
export function resolveShotEngine(raw: string | undefined): ShotEngine {
  const v = (raw ?? "").trim();
  if (v === "" || v === "wasm") return "wasm";
  if (v === "ts") return "ts";
  throw new Error(`VC_SHOT_ENGINE="${raw}" is not an engine; use "wasm" (the default) or "ts".`);
}

export const SHOT_ENGINE: ShotEngine = resolveShotEngine(process.env.VC_SHOT_ENGINE);

/** The shots whose setup edits the tower past the relay (a unit's state or
 *  occupancy, a fire, a placed room), as "scene/shot". Both legs settle after
 *  these setups, and the WASM leg merges first, so the setup edits the
 *  engine's current tower (a presentation pin an earlier shot left on the read
 *  model alone does not survive that merge). A setup missing from the list
 *  fails the WASM leg by name when it changes a field of `shotShape` the engine
 *  did not follow; an edit outside that shape shows up as a pixel difference
 *  between the legs instead. */
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
    // Money stays out: a relayed build on fresh ground can roll a treasure
    // from the read model's hour-old rng (#868), a known gap that must not
    // fail a scene. The relay forwards a money write as `setMoney`.
    minutes: v.minutes,
    vipVisitDay: v.vipVisitDay,
    builtWeddingHall: v.builtWeddingHall,
    pendingEvent: Boolean(v.events?.pending),
    units: (v.units ?? []).map((u: any) => [u.id, u.kind, u.floor, u.x, u.state, u.occupants ?? 0, u.rent ?? null, Boolean(u.noRate), Boolean(u.everOccupied), u.label ?? null]),
    transports: (v.transports ?? []).map((t: any) => [t.id, t.kind, t.x, t.bottom, t.top]),
  };
}

/** Before navigation: seed the stored engine choice on both legs, and
 *  install the shared shape and the settle that builders call before they
 *  tick, on both legs. Playwright does not promise an order between init
 *  scripts, so a scene init script that cleared storage could drop the engine
 *  seed; the WASM leg's hosted checks would then fail the scene by name. */
export async function seedEngineChoice(page: Page): Promise<void> {
  await page.addInitScript((engine) => {
    try {
      localStorage.setItem("vc.engine", engine);
    } catch {
      /* storage blocked: the WASM leg's hosted check after boot fails the scene */
    }
  }, SHOT_ENGINE);
  await page.addInitScript(`window.__vcShotShape = ${shotShape.toString()};`);
  await page.addInitScript(`window.__vcShotHandoff = () => (${pgSettle.toString()})(${JSON.stringify(SHOT_ENGINE)});`);
}

/** Settle the tower on both legs (see the header) and fail the scene if the
 *  WASM leg does not end up hosted. A title screen still up skips the settle on
 *  both legs alike where `allowSkip` says a skip is harmless (a scene build on
 *  a title-screen scene); a listed setup must settle. */
async function settleTower(page: Page, where: string, allowSkip: boolean): Promise<void> {
  const state = await page.evaluate(pgSettle, SHOT_ENGINE);
  if (!state.startsWith("settled") && !(allowSkip && state.startsWith("skipped"))) throw new Error(`${SHOT_ENGINE === "wasm" ? "WASM" : "TypeScript"} leg: could not settle ${where} (${state})`);
  await expectHosted(page, where);
}

/** After a scene build or a listed setup: settle, unless the code it ran
 *  already settled before its ticks (`__vcShotHandoff`, which a builder calls).
 *  A second load would drop the crowd and the live counters those ticks grew,
 *  on both legs. In that case the WASM leg checks instead that what changed
 *  since that settle reached the engine. */
export async function settleUnlessSettled(page: Page, where: string, allowSkip: boolean): Promise<void> {
  const shape = await page.evaluate(() => {
    const w = window as unknown as { __vcShotSettled?: boolean; __vcShotSettledShape?: string };
    return w.__vcShotSettled === true ? (w.__vcShotSettledShape ?? "null") : null;
  });
  if (shape === null) return settleTower(page, where, allowSkip);
  await expectHosted(page, where);
  await checkHosted(page, where, SHOT_ENGINE === "wasm" ? shape : null, HOSTED_FIX.settled);
}

/** Before a scene build or a listed setup, on both legs: forget any earlier
 *  settle, so `settleUnlessSettled` sees only one the step itself makes, and on
 *  the WASM leg bring the read model up to the engine with a full merge, so a
 *  step that edits it and then settles starts from the engine's current tower
 *  (some fields reach the read model only at a merge). Fails the scene when no
 *  host holds the tower or the merge throws. */
export async function beginSettleStep(page: Page, where: string): Promise<void> {
  const state = await page.evaluate((wasm) => {
    const w = window as unknown as { __vcEngine?: any; __vcShotSettled?: boolean };
    w.__vcShotSettled = false;
    if (!wasm) return "synced";
    const vc = w.__vcEngine;
    if (!vc) return "no engine host (did the engine package load?)";
    const host = vc.status?.hosted ? vc.current?.() : null;
    if (!host) return "the host does not hold the tower";
    try {
      host.syncStructure();
    } catch (e) {
      return `the merge threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    return "synced";
  }, SHOT_ENGINE === "wasm");
  if (state !== "synced") throw new Error(`WASM leg: could not merge ${where} (${state})`);
}

/** WASM leg only: the live sim is the hosted instance of an attached host.
 *  Catches a leg that silently rendered on the TypeScript engine (the engine
 *  package never loaded, or a load the host refused). */
async function expectHosted(page: Page, where: string): Promise<void> {
  if (SHOT_ENGINE !== "wasm") return;
  const hosted = await page.evaluate(() => {
    const w = window as unknown as { game?: any; __vcEngine?: any };
    if (!w.__vcEngine) return "no engine host (did the engine package load?)";
    if (!w.__vcEngine.status?.hosted) return "the host does not hold the tower";
    return Object.prototype.hasOwnProperty.call(w.game?.sim ?? {}, "serialize") ? "hosted" : "the live sim is not the hosted instance";
  });
  if (hosted !== "hosted") throw new Error(`WASM leg: the tower is not on the engine ${where} (${hosted})`);
}

/** Fail the run when a SETTLE_AFTER_SETUP entry names no shot, or a shot
 *  without a setup (the settle runs after a setup only), so a renamed or
 *  reworked shot cannot drop out of the list unnoticed. */
export function checkSettleList(scenes: readonly { id: string; shots: readonly { name: string; setup?: unknown }[] }[]): void {
  const withSetup = new Set(scenes.flatMap((s) => s.shots.filter((shot) => shot.setup).map((shot) => `${s.id}/${shot.name}`)));
  const stale = [...SETTLE_AFTER_SETUP].filter((k) => !withSetup.has(k));
  if (stale.length > 0) throw new Error(`SETTLE_AFTER_SETUP names no shot with a setup: ${stale.join(", ")}`);
}

/** WASM leg only: the page's view of the tower before a clock pin or a
 *  setup, for `checkHosted` to compare against. Null on the TypeScript leg. */
export async function hostedSnapshot(page: Page): Promise<string | null> {
  if (SHOT_ENGINE !== "wasm") return null;
  return page.evaluate(pgOwnShape);
}

/** WASM leg only: fail the scene if a clock pin or a setup changed the page's
 *  tower in a way the engine did not follow (it edited the tower past the
 *  relay and is not in SETTLE_AFTER_SETUP). Only what changed since `before`
 *  is compared: the page refreshes some fields only at the engine's merges,
 *  so a field the step did not touch may lag the engine harmlessly. A no-op
 *  on the TypeScript leg. */
export async function checkHosted(page: Page, where: string, before: string | null, fix: string): Promise<void> {
  if (SHOT_ENGINE !== "wasm" || before === null) return;
  const state = await page.evaluate(pgCheckHosted, before);
  if (state !== "hosted") throw new Error(`WASM leg: the tower is not on the engine ${where} (${state}); ${fix}`);
}

/** What to change when `checkHosted` fails, by where it ran. */
export const HOSTED_FIX = {
  setup: "the setup edits the tower past the relay: add the shot to SETTLE_AFTER_SETUP (if only the clock differs and the setup calls pgSetClock, check pgSetClock and the engine's advanceClock instead)",
  clock: "the clock pin did not reach the engine: check pgSetClock and the engine's advanceClock",
  settled: "code that ran after a builder's __vcShotHandoff edited the tower past the relay: move that edit before the handoff",
} as const;

/** In-page: the live instance's own save (the read model's, which may lag
 *  the engine's) in the shared shape, as JSON. */
export function pgOwnShape(): string {
  const w = window as unknown as { game?: any; __vcShotShape?: (v: any) => any };
  const sim = w.game?.sim;
  if (!sim || typeof w.__vcShotShape !== "function") return "null";
  return JSON.stringify(w.__vcShotShape(sim.constructor.prototype.serialize.call(sim)));
}

/** In-page, WASM leg: compare what changed on the page since `before` with
 *  the engine's own save, in the shared shape. Returns "hosted", or what the
 *  engine did not follow. */
export function pgCheckHosted(before: string): string {
  const w = window as unknown as { game?: any; __vcEngine?: any; __vcShotShape?: (v: any) => any };
  const g = w.game;
  const vc = w.__vcEngine;
  if (!g?.sim) return "no game";
  if (typeof w.__vcShotShape !== "function") return "the shared shape is not installed (seedEngineChoice did not run on this page)";
  const shapeOf = w.__vcShotShape;
  if (!vc) return "no engine host (did the engine package load?)";
  if (!vc.status?.hosted) return "the host does not hold the tower";
  const sim = g.sim;
  if (!Object.prototype.hasOwnProperty.call(sim, "serialize")) return "the live sim is not the hosted instance";
  const was = JSON.parse(before);
  if (!was) return "no tower before the step";
  const now = shapeOf(sim.constructor.prototype.serialize.call(sim));
  const engine = shapeOf(sim.serialize());
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
      // Field by field: only what the step changed has to match, since a
      // field the step left alone may lag the engine until the next merge.
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
 * In-page, both legs: settle the live tower through the app's load path. The
 * instance's own save is deserialized and adopted with `adoptSim` (undo-restore
 * flavor, so the camera and history stay); on the WASM leg the host follows by
 * starting the engine from it. What a load resets and the TypeScript leg would
 * otherwise keep is carried over on both legs: the loop's pass memos (from the
 * engine when the tower is already hosted) and the elevator telemetry. What
 * `adoptSim` resets in the app is put back (speed, pause, the star and win
 * latches, the step accumulator, the meal-rush day, the log cursor and
 * panel, the selection). Skips while the title screen is up, since
 * `adoptSim` would dismiss it.
 * Returns "settled", "skipped: ...", or why it failed.
 */
export function pgSettle(leg: "ts" | "wasm"): string {
  const run = (): string => {
    const w = window as unknown as { game?: any; __vcEngine?: any; __vcShotSettled?: boolean; __vcShotSettledShape?: string; __vcShotShape?: (v: any) => any };
    const g = w.game;
    // The leg is handed in, so a WASM leg whose engine never loaded fails here
    // instead of settling as the TypeScript leg does.
    const vc = leg === "wasm" ? w.__vcEngine : null;
    if (!g?.sim) return "no game";
    if (leg === "wasm" && !vc) return "no engine host (did the engine package load?)";
    if (typeof w.__vcShotShape !== "function") return "the shared shape is not installed (seedEngineChoice did not run on this page)";
    const shapeOf = w.__vcShotShape;
    // Only a title screen still in the page counts: the runner's splash
    // dismissal removes the node and can leave the controller's reference
    // behind, and the teardown that adoptSim then runs on that stale
    // reference changes nothing on screen (its pause is undone below, its
    // toast swept).
    if (document.getElementById("splash")) return "skipped: the title screen is up";
    const sim = g.sim;
    const Sim = sim.constructor;
    const hostedBefore = Object.prototype.hasOwnProperty.call(sim, "serialize");
    const engineBefore = hostedBefore ? vc?.current?.()?.engine : null;
    if (hostedBefore && !engineBefore) return "the tower is hosted but no host holds it";
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
    const telemetry = engineBefore ? JSON.parse(engineBefore.elevatorTelemetry()) : telemetryOf(sim);
    const memos: number[] = engineBefore ? [...engineBefore.loopMemos()] : [sim.lastHour, sim.lastDay, sim.lastMonth, sim.lastQuarter];
    const own = Sim.prototype.serialize.call(sim);
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
    // A load restarts the log cursor; keep the live one, before a host
    // attaches and reads it.
    fresh.logSeq = keep.logSeq;
    // The TypeScript leg carries the memos and the telemetry on the instance
    // itself; the WASM leg seeds them into the engine below.
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
    g.adoptSim(fresh, true);
    let refused = "";
    if (vc) {
      const host = vc.current?.();
      if (!host || !vc.status?.hosted) {
        refused = `the host refused the tower: ${(vc.status?.lastError as string | null | undefined) ?? "no reason given"}`;
      } else {
        try {
          host.engine.seedLoopMemos(memos[0], memos[1], memos[2], memos[3]);
          host.engine.seedElevatorTelemetry(JSON.stringify(telemetry));
          host.syncStructure();
        } catch (e) {
          refused = `the engine refused the settled state: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
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
    if (vc) {
      const host = vc.current?.();
      if (canonOf(JSON.parse(host.engine.elevatorTelemetry())) !== canonOf(telemetry)) return "the engine's elevator telemetry differs from the one handed to it";
      if (JSON.stringify([...host.engine.loopMemos()]) !== JSON.stringify(memos)) return "the engine's loop memos differ from the ones handed to it";
    }
    // The read model holds the carried telemetry, on both legs: the
    // TypeScript leg keeps it on the instance, and on the WASM leg the merge
    // after the seed replaced it with the engine's copy (adoptTelemetry), so
    // this also checks that the read model decodes the seeded document.
    if (canonOf(telemetryOf(g.sim)) !== canonOf(telemetry)) return "the page's elevator telemetry differs from the one carried over";
    // The TypeScript leg holds the memos on the instance; the WASM leg's
    // live memos are the engine's, checked above.
    if (!vc && JSON.stringify([g.sim.lastHour, g.sim.lastDay, g.sim.lastMonth, g.sim.lastQuarter]) !== JSON.stringify(memos)) return "the page's loop memos differ from the ones carried over";
    const settled = JSON.stringify(shapeOf(Sim.prototype.serialize.call(g.sim)));
    if (vc) {
      // The live sim is the hosted instance, and the engine loaded the same
      // tower the page did.
      if (!Object.prototype.hasOwnProperty.call(g.sim, "serialize")) return "the live sim is not the hosted instance";
      if (JSON.stringify(shapeOf(g.sim.serialize())) !== settled) return "the engine's tower differs from the one handed to it";
    }
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
