/**
 * The engine the gallery renders on (story-engine-test-parity AC3).
 *
 * `VC_SHOT_ENGINE=wasm` renders every game scene with the WASM engine hosting
 * the tower, the way the `chromium-wasm` Playwright project does: the stored
 * engine choice (`vc.engine`, src/wasmhost/engineChoice.ts) is seeded before
 * any page script runs. Unset (or `ts`) is the TypeScript engine, and then
 * nothing here touches the page, so the TypeScript render is byte-identical to
 * a run without this module. The pr-drift-check engine leg renders this way
 * and compares the result with the TypeScript render of the same head. A pixel
 * difference between the engines is a parity finding to report, and the leg
 * commits nothing.
 *
 * Under the host the TypeScript `Simulation` is a read model, and only relayed
 * commands and loads reach the engine. Most scene builders swap a fresh
 * `Simulation` into `game.sim` directly, which the host never sees, so on the
 * WASM leg the runner hands each built tower to the engine through the app's
 * load path (`adoptSim`) before the first shot.
 *
 * Keep this file ERASABLE (no enums / namespaces / parameter properties). The
 * `pg*` function is BROWSER-INJECTED: self-contained, no module-scope refs.
 */
import { type Page } from "playwright";

export type ShotEngine = "ts" | "wasm";

/** Read the engine switch; a typo fails the run instead of silently rendering
 *  the TypeScript engine under a WASM label. */
export function resolveShotEngine(raw: string | undefined): ShotEngine {
  const v = (raw ?? "").trim();
  if (v === "" || v === "ts") return "ts";
  if (v === "wasm") return "wasm";
  throw new Error(`VC_SHOT_ENGINE="${raw}" is not an engine; use "ts" (the default) or "wasm".`);
}

export const SHOT_ENGINE: ShotEngine = resolveShotEngine(process.env.VC_SHOT_ENGINE);

/** Before navigation: seed the stored engine choice so boot hosts the tower on
 *  the WASM engine, and install the handoff that builders call before they
 *  tick. Registered after a scene's own init script, so a scene
 *  that resets storage cannot drop it. */
export async function seedEngineChoice(page: Page): Promise<void> {
  if (SHOT_ENGINE !== "wasm") return;
  await page.addInitScript(() => {
    try {
      localStorage.setItem("vc.engine", "wasm");
    } catch {
      /* storage blocked: the hosted check after boot fails the scene */
    }
  });
  // The in-build handoff a builder calls before it ticks (see pgHostOnEngine).
  await page.addInitScript(`window.__vcShotHandoff = ${pgHostOnEngine.toString()};`);
}

/** After a scene's build (and after a shot's setup): put the live tower on the
 *  engine and fail the scene if it is not there. A no-op on the TypeScript leg. */
export async function hostOnEngine(page: Page, where: string): Promise<void> {
  if (SHOT_ENGINE !== "wasm") return;
  const state = await page.evaluate(pgHostOnEngine);
  if (!state.startsWith("hosted")) throw new Error(`WASM leg: the tower is not on the engine ${where} (${state})`);
}

/**
 * In-page: make sure the engine holds the tower the page shows. A handoff is
 * needed when `game.sim` is not the instance the WASM host attached to (a
 * builder assigned a new `Simulation` directly) or when the hosted instance
 * was edited in place past the relay (`tower.place`, a unit state write),
 * which shows as a structural difference between the instance's own save and
 * the engine's. The handoff loads the instance's own save into the app
 * through `adoptSim`, which the host follows by starting the engine from it.
 *
 * A load derives the loop's pass memos from the clock and starts the elevator
 * telemetry empty, where the TypeScript leg keeps the instance's own: a tower
 * built in place still owes its first hour pass (and a day pass when its
 * builder moved the clock past midnight), and a builder may author a measured
 * demand curve. So the handoff seeds the engine with both (`seedLoopMemos`,
 * `seedElevatorTelemetry`), and the engine runs the same owed passes on its
 * first tick. An instance already on the engine hands over the engine's own
 * telemetry; its memos are the ones the load derives, which match the
 * engine's whenever its passes for the current hour and day have run. The
 * undo-restore flavor keeps the camera and history, and what else `adoptSim`
 * resets is put back (speed, pause, the star and win latches, the step
 * accumulator, the log cursor and panel, the selection), so the scene runs on
 * as the TypeScript leg does from the same point. A save carries no crowd, so
 * a builder that ticks hands over before its ticks (`__vcShotHandoff`, the
 * runner installs this function under that name on the WASM leg) and the
 * engine grows its own crowd. Refuses while the title screen is up, since
 * `adoptSim` would dismiss it. Returns "hosted" (with a note when it handed
 * the tower over), or why not.
 */
export function pgHostOnEngine(): string {
  const w = window as unknown as { game?: any; __vcEngine?: any };
  const g = w.game;
  const vc = w.__vcEngine;
  if (!g?.sim) return "no game";
  if (!vc) return "no engine host (did the engine package load?)";
  const sim = g.sim;
  const Sim = sim.constructor;
  const onHost = (x: unknown) => Object.prototype.hasOwnProperty.call(x, "serialize");
  const own = Sim.prototype.serialize.call(sim);
  // The fields a builder or a setup edits by hand, limited to the ones the
  // read model keeps current between hours (the frame view syncs the clock,
  // star, pending choice, unit state and occupants; rent, the no-rate flag,
  // labels and everOccupied change only by command or in a pass that merges),
  // so a settled scene never reads as edited. Money stays out: a hand edit of
  // it is relayed anyway (setMoney), and a relayed build on fresh ground can
  // roll a treasure from the read model's hour-old rng (#868), a known gap that
  // must not trigger a load that overwrites the engine. Optional fields are
  // normalized, since the two engines' saves leave out a false flag or an unset
  // field differently.
  const shape = (v: any) =>
    JSON.stringify([
      v.star,
      v.minutes,
      v.vipVisitDay,
      v.builtWeddingHall,
      Boolean(v.events?.pending),
      (v.units ?? []).map((u: any) => [u.id, u.kind, u.floor, u.x, u.state, u.occupants ?? 0, u.rent ?? null, Boolean(u.noRate), Boolean(u.everOccupied), u.label ?? null]),
      (v.transports ?? []).map((t: any) => [t.id, t.kind, t.x, t.bottom, t.top]),
    ]);
  // The instance's telemetry in the engine's document shape (see
  // src/wasmhost/telemetry.ts; restated here, as injected code cannot import).
  const telemetryOf = (s: any) => ({
    util: [...s.elevatorUtil],
    hourly: [...s.elevatorHourly].map(([id, r]: [number, any]) => [id, { weekday: [...r.weekday], weekend: [...r.weekend] }]),
    origins: [...s.elevatorOrigins].map(([id, r]: [number, any]) => [id, { weekday: r.weekday.map((m: Map<number, number>) => [...m]), weekend: r.weekend.map((m: Map<number, number>) => [...m]) }]),
  });
  const handoff = !onHost(sim) || shape(own) !== shape(sim.serialize());
  let telemetry = "";
  if (handoff) {
    // Only a title screen still in the page counts: the runner's splash
    // dismissal removes the node and can leave the controller's reference
    // behind, and the teardown that adoptSim then runs on that stale
    // reference changes nothing on screen (its pause is undone below, its
    // toast swept).
    if (document.getElementById("splash")) return "the title screen is up; a handoff would dismiss it";
    const before = onHost(sim) ? vc.current?.() : null;
    telemetry = before ? before.engine.elevatorTelemetry() : JSON.stringify(telemetryOf(sim));
    const memos = onHost(sim) ? null : [sim.lastHour, sim.lastDay, sim.lastMonth, sim.lastQuarter];
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
    // A load restarts the log cursor; keep the live one, before the host
    // attaches and reads it.
    fresh.logSeq = keep.logSeq;
    g.adoptSim(fresh, true);
    const host = vc.current?.();
    let refused = "";
    if (host && vc.status?.hosted) {
      try {
        if (memos) host.engine.seedLoopMemos(memos[0], memos[1], memos[2], memos[3]);
        host.engine.seedElevatorTelemetry(telemetry);
        host.syncStructure();
      } catch (e) {
        refused = `the engine refused the handed-over state: ${e instanceof Error ? e.message : String(e)}`;
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
  }
  if (!vc.status?.hosted) return `host refused the tower: ${((vc.status?.errors ?? []) as string[]).join("; ")}`;
  if (!onHost(g.sim)) return "the live sim is not the hosted instance";
  if (handoff) {
    if (shape(Sim.prototype.serialize.call(g.sim)) !== shape(g.sim.serialize())) return "the engine's tower differs from the one handed to it";
    // Compared as parsed values with sorted keys: the engine writes a whole
    // float as 0.0 and its keys in its own order.
    const canon = (v: unknown) =>
      JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
    const raw = vc.current?.()?.engine.elevatorTelemetry();
    const now = raw === undefined ? "" : canon(JSON.parse(raw));
    if (now !== canon(JSON.parse(telemetry))) return "the engine's elevator telemetry differs from the one handed to it";
    if (canon(telemetryOf(g.sim)) !== now) return "the read model's elevator telemetry differs from the engine's";
    return onHost(sim) ? "hosted (handed over again after an edit past the relay)" : "hosted (handed over)";
  }
  return "hosted";
}
