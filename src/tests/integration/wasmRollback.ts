import { expect, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameplayEvent } from "../../engine/gameplayEvents";
import type { UndoHistory } from "../../engine/UndoHistory";
import { towerStateSig } from "../../engine/UndoHistory";
import type { WasmEngine } from "../../dualrun/binding";
import { createAppHistory } from "../../game/appHistory";
import { startWasmHost, type WasmHostHandle } from "../../wasmhost/startWasmHost";
import { wasm } from "../conformance/wasmEngine";
import { FrameDriver } from "../dualrun/dualRunHarness";

/**
 * The real-engine rollback tests' shared setting (#874; the owner's review
 * of #1101): a game app with the real undo history, hosted on the engine,
 * and what a recovery is checked against. Temporary, with the fallback.
 */

export const UNDONE = "The WASM engine stopped, so the tower went back to its last good state and your recent changes were undone. It runs on the TypeScript engine now.";
export const RESTORED = "The WASM engine stopped, so the tower went back to its last good state and runs on the TypeScript engine.";
export const REPLACED = "The WASM engine stopped, so the game runs on the TypeScript engine now.";
export const LOST = "The WASM engine stopped, so some of your recent changes were lost. The game runs on the TypeScript engine now.";

/** GameApp as far as the host and the undo trail see it: its adopt, its
 *  history (the real one, through the app's own ports) and its toasts. */
export function gameApp(sim: Simulation) {
  const a = {
    sim,
    toasts: [] as string[],
    ui: { toast: (message: string) => void a.toasts.push(message) },
    history: null as unknown as UndoHistory,
    adoptSim(next: Simulation, preserveHistory = false) {
      if (preserveHistory) next.autoBridge = a.sim.autoBridge;
      next.gameplayEvents.inherit(a.sim.gameplayEvents);
      a.sim = next;
      if (!preserveHistory) a.history.clear();
    },
    captureUndo: (label: string) => a.history.capture(label),
    commitUndo: () => a.history.commit(),
    undo: () => a.history.undo(),
    redo: () => a.history.redo(),
    dropEmptyUndo: () => a.history.dropUnchanged(),
    holdClearedRedo: (on: boolean) => void (a.history.holdClearedRedo = on),
  };
  a.history = createAppHistory(a);
  return a;
}

export type App = ReturnType<typeof gameApp>;

export interface Setting {
  a: App;
  h: WasmHostHandle;
  /** The engine of the tower hosted now. */
  engine: () => WasmEngine;
  /** Every event the game received, from whichever tower the app held. */
  delivered: GameplayEvent[];
  /** The frame loop's drain. */
  deliver: () => void;
}

/** A paused Classic tower with a lobby, a floor, an office and an elevator,
 *  hosted on the engine and run for a while, its events delivered. */
export function setUp(seed: number): Setting {
  const a = gameApp(Simulation.newGame(seed, "classic"));
  const h = startWasmHost(a, wasm(), { info: vi.fn(), error: vi.fn() });
  const delivered: GameplayEvent[] = [];
  const deliver = () => void delivered.push(...a.sim.drainGameplayEvents());
  const sim = a.sim;
  sim.money = 1e9;
  for (let x = 160; x < 220; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let x = 160; x < 220; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
  expect(sim.build("office", 2, 170).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 200, 1, 2).ok).toBe(true);
  new FrameDriver(sim, 3).run(30);
  deliver();
  return { a, h, engine: () => h.current()!.engine, delivered, deliver };
}

/** The state the recovery should go back to, read from the read model's own
 *  fields: no hosted save, so the test never takes the restore point it
 *  then finds. Call it when the read model shows the point's state (just
 *  after an undo capture, or just after a merge). */
export function lastGood(sim: Simulation) {
  return {
    money: sim.money,
    minutes: sim.clock.minutes,
    sig: towerStateSig(sim.tower, sim.money),
    log: sim.log.map((e) => e.text),
    identity: { initialSeed: sim.rng.initialSeed, mode: sim.mode, modernCalendar: sim.modernCalendar },
  };
}

export type Good = ReturnType<typeof lastGood>;

/** The save an undo capture took, when one is pending. */
export function pendingCapture(a: App): string | null {
  return (a.history as unknown as { pending: { snap: string } | null }).pending?.snap ?? null;
}

export const settle = () => new Promise((r) => setTimeout(r, 0));

/** The recovered tower matches the last good state, says `line` once (a
 *  `bad` line, which the UI toasts), and its save round-trips with the
 *  tower's identity. With `point`, the save is that point's state. */
export function expectRolledBack(a: App, faulted: Simulation, good: Good, line = UNDONE, point: string | null = null): Simulation {
  const fresh = a.sim;
  expect(fresh).not.toBe(faulted);
  expect(fresh.money).toBe(good.money);
  expect(fresh.clock.minutes).toBe(good.minutes);
  expect(towerStateSig(fresh.tower, fresh.money)).toBe(good.sig);
  expect(fresh.log.map((e) => e.text)).toEqual([...good.log, line]);
  expect(fresh.log[fresh.log.length - 1].kind).toBe("bad");
  const save = JSON.stringify(fresh.serialize());
  expect(JSON.stringify(Simulation.deserialize(JSON.parse(save)).serialize())).toBe(save);
  const data = JSON.parse(save) as Record<string, unknown>;
  expect({ initialSeed: data.initialSeed, mode: data.mode, modernCalendar: data.modernCalendar }).toEqual(good.identity);
  if (point) {
    const p = JSON.parse(point) as Record<string, unknown>;
    expect({ seed: data.seed, minutes: data.minutes, money: data.money }).toEqual({ seed: p.seed, minutes: p.minutes, money: p.money });
  }
  return fresh;
}

const TALLIED = ["tower_founded", "facility_placed", "facility_removed", "pricing_changed", "capacity_changed", "fire_started", "emergency_resolved"];

/** The edits' events the game received, as "name kind" tallies. */
export function tally(delivered: GameplayEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of delivered) {
    if (!TALLIED.includes(e.name)) continue;
    const key = `${e.name} ${(e.payload as { kind?: string }).kind ?? ""}`.trim();
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** The set-up's own events, each once: the founding and its placements. */
export const SET_UP = { tower_founded: 1, "facility_placed lobby": 60, "facility_placed floor": 60, "facility_placed office": 1, "facility_placed elevatorStandard": 1 };

/** The offices' tiles on the tower the app holds now. */
export const offices = (a: App) => a.sim.tower.units.filter((u) => u.kind === "office").map((u) => u.x);
