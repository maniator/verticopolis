import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "../../analyticsRelay";
import { gameplaySession } from "../../analytics";
import { bindEngineBridge, drainEngineEvents, engineBridgeStats, resetEngineBridge } from "../../analyticsEngineBridge";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { PortEvents } from "../../simport/portEvents";
import { look, newEngine, noEngine } from "../portKit/rustEngine";

/**
 * The analytics bridge over the Rust engine's own event queue: what the
 * engine still owes after an Undo or a load, and that the bridge folds each
 * event once. The bridge's folding on canned events is unit-tested in
 * `src/analyticsEngineBridge.test.ts`; the queue's hand-off is the engine's
 * (`engine-rs/src/wasm_port_life_tests.rs`).
 */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("../../analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const propsFor = (name: string): unknown[] =>
  vi
    .mocked(sendToRelay)
    .mock.calls.filter(([n]) => n === name)
    .map(([, p]) => p);

/** A Classic tower with money to spare, and a build helper that must succeed. */
function tower(seed: number) {
  const engine = newEngine(seed, "classic");
  look(engine).money = 1e9;
  const codes = new PortCodes(engine);
  const build = (kind: string, floor: number, x: number) =>
    expect(engine.buildAt(codes.kind(kind as never), floor, x)[0], `${kind} at ${floor},${x}: ${engine.lastReason()}`).toBe(1);
  return { engine, events: new PortEvents(engine), build };
}

/** One undoable gesture on the engine, then its Undo. */
function undone(engine: EnginePort, gesture: () => void): void {
  engine.undoCapture("gesture");
  gesture();
  expect(engine.undoCommit()).toBe(true);
  expect(engine.undo()[0]).toBe(1);
}

describe.skipIf(noEngine)("the analytics bridge on the engine's events", () => {
  beforeEach(() => {
    window.location.href = "https://verticopolis.com/";
    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
  });

  it("counts a build the player then undid", () => {
    const { engine, events, build } = tower(5);
    undone(engine, () => {
      for (let x = 180; x < 184; x++) build("lobby", 1, x);
    });
    drainEngineEvents(events);
    gameplaySession.begin();
    gameplaySession.end(false);
    expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]);
    expect(propsFor("first_build")).toEqual([{ tool: "lobby" }]);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
  });

  it("counts a removal the player then undid", () => {
    const { engine, events, build } = tower(6);
    for (let x = 170; x < 200; x++) build("lobby", 1, x);
    for (let x = 170; x < 200; x++) build("floor", 2, x);
    build("office", 2, 180);
    drainEngineEvents(events);
    vi.mocked(sendToRelay).mockReset();
    const office = look(engine).tower.unitAt(2, 180)!.id as number;
    undone(engine, () => expect(engine.demolish(office, true)[0]).toBe(1));
    drainEngineEvents(events);
    expect(vi.mocked(sendToRelay).mock.calls).toEqual([["economy_action", { action: "demolish", detail: "bulldoze" }]]);
  });

  it("folds every engine event exactly once across a load, a page hide and a new window", () => {
    const { engine, events, build } = tower(7);
    bindEngineBridge(() => events);
    gameplaySession.begin();
    drainEngineEvents(events); // the founding
    for (let x = 180; x < 183; x++) build("lobby", 1, x);
    // A load hands the undrained builds on; the loaded tower adds one.
    expect(engine.loadSave(engine.serialize())[0]).toBe(1);
    look(engine).money = 1e9;
    build("lobby", 1, 183);
    // The page hide folds what the engine still holds, once.
    gameplaySession.end(false);
    drainEngineEvents(events);
    gameplaySession.end(false);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
    expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]);
    expect(propsFor("first_build")).toEqual([{ tool: "lobby" }]);
    // A new window drops what the engine holds unsent; nothing is folded twice.
    build("lobby", 1, 184);
    gameplaySession.startEpoch();
    drainEngineEvents(events);
    expect(engineBridgeStats().discarded).toBe(1);
  });
});
