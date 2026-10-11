import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";
import { Simulation } from "./engine/Simulation";
import type { SerializedGame } from "./engine/serializedGame";
import {
  BRIDGE_SEND_LIMIT,
  bindEngineBridge,
  drainEngineEvents,
  engineBridgeStats,
  forwardGameplayEvents,
  resetEngineBridge,
  type GameplayEventSource,
} from "./analyticsEngineBridge";

// The analytics engine bridge (#873 phase 2): the engine's drained gameplay
// events, checked against the catalog and folded into today's wire events.
// Stub the vendor surface like the sibling analytics suites.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** Every emitted event, `[name, props]`, in call order. */
function sent(): [string, unknown][] {
  return vi.mocked(sendToRelay).mock.calls.map(([n, p]) => [n, p]);
}

function propsFor(name: string): unknown[] {
  return sent().filter(([n]) => n === name).map(([, p]) => p);
}

const founded = (mode = "classic") => ({ name: "tower_founded", payload: { mode } });
const placed = (kind: string, floor: number, count = 1) => ({ name: "facility_placed", payload: { kind, floor, count } });
const star = (s: number) => ({ name: "star_reached", payload: { star: s } });
const resolved = (kind: string, decision: string, source: string) => ({ name: "emergency_resolved", payload: { kind, decision, source } });

/** A drain source over a fixed queue. */
function source(queue: unknown[], opts: { backdrop?: boolean; dropped?: number } = {}): GameplayEventSource {
  return {
    drainGameplayEvents: () => queue.splice(0) as never,
    gameplayEventsDropped: opts.dropped ?? 0,
    gameplayEvents: { discardOnHandOff: opts.backdrop ?? false },
  };
}

describe("analytics engine bridge", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("folds the engine's events into today's wire names", () => {
    forwardGameplayEvents([
      founded("modern"),
      placed("lobby", 1),
      placed("office", 2),
      star(2),
      resolved("fireRescue", "accept", "player"),
      { name: "pricing_changed", payload: { kind: "office" } },
      { name: "pricing_changed", payload: { kind: "condo" } },
      { name: "capacity_changed", payload: { kind: "elevatorStandard" } },
    ]);
    expect(sent()).toEqual([
      ["new_game_started", { mode: "modern" }],
      ["first_build", { tool: "lobby" }], // the kind placed; once per tower
      ["star_reached", { star: 2 }],
      ["emergency_choice", { kind: "fireRescue", decision: "accept" }],
      ["economy_action", { action: "price_tune" }], // latched once per session
      ["economy_action", { action: "capacity_tune" }],
    ]);
  });

  it("sends nothing for a removal or a milestone yet (demolish stays on the shell until #928)", () => {
    forwardGameplayEvents([
      { name: "facility_removed", payload: { kind: "office", method: "sell" } },
      { name: "milestone_reached", payload: { id: "pop-500" } },
    ]);
    expect(sent()).toEqual([]);
    expect(engineBridgeStats().rejected).toBe(0);
  });

  it("reports a timed-out emergency as nothing, and the decision that took effect", () => {
    forwardGameplayEvents([
      resolved("bombThreat", "decline", "timeout"),
      // The player pressed accept and the tower could not pay: the engine says decline.
      resolved("fireRescue", "decline", "player"),
    ]);
    expect(propsFor("emergency_choice")).toEqual([{ kind: "fireRescue", decision: "decline" }]);
  });

  it("reports every rung of a multi-rung jump", () => {
    forwardGameplayEvents([star(3), star(4)]);
    expect(propsFor("star_reached")).toEqual([{ star: 3 }, { star: 4 }]);
  });

  it("sums placements, so a brush's per-tile events count the tiles it laid", () => {
    window.location.href = prod;
    gameplaySession.begin();
    forwardGameplayEvents([placed("floor", 3), placed("floor", 3), placed("floor", 3), placed("office", 5)]);
    gameplaySession.end(false);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
    expect(propsFor("session_peak_floors")).toEqual([{ floors: 5 }]);
    expect(propsFor("tool_session_uses")).toEqual([{ tool: "floor", uses: 3 }, { tool: "office", uses: 1 }]);
  });

  it("re-opens the funnel only at a founding, across a batch that spans two towers", () => {
    // The replaced tower's last builds, then the new tower's founding and build.
    forwardGameplayEvents([placed("office", 4), founded(), placed("shop", 2), placed("condo", 3)]);
    // A load hands its events on with no founding: the funnel stays closed.
    forwardGameplayEvents([placed("hotelSingle", 6)]);
    expect(sent()).toEqual([
      ["first_build", { tool: "office" }],
      ["new_game_started", { mode: "classic" }],
      ["first_build", { tool: "shop" }],
    ]);
  });

  it("fails closed: an event outside the catalog is dropped and counted, and the batch goes on", () => {
    forwardGameplayEvents([
      { name: "tower_renamed", payload: {} },
      { name: "star_reached", payload: { star: 9 } },
      { name: "star_reached", payload: {} },
      { name: "star_reached", payload: { star: 3, towerName: "x" } },
      { name: "star_reached", payload: { star: 3 }, minute: 4 },
      { name: "facility_placed", payload: { kind: "penthouse", floor: 2, count: 1 } },
      null,
      "star_reached",
      star(3),
    ]);
    expect(engineBridgeStats().rejected).toBe(8);
    expect(sent()).toEqual([["star_reached", { star: 3 }]]);
  });

  it("rate-limits the per-occurrence sends but keeps counting", () => {
    const now = 1_000;
    gameplaySession.begin();
    for (let i = 0; i < BRIDGE_SEND_LIMIT + 5; i++) forwardGameplayEvents([founded(), placed("office", 2)], now);
    expect(propsFor("new_game_started")).toHaveLength(BRIDGE_SEND_LIMIT);
    // A held-back founding leaves the funnel closed: no first_build is ever
    // sent without its new_game_started ahead of it.
    expect(propsFor("first_build")).toHaveLength(BRIDGE_SEND_LIMIT);
    expect(sent().slice(0, 4).map(([n]) => n)).toEqual(["new_game_started", "first_build", "new_game_started", "first_build"]);
    expect(engineBridgeStats().rateLimited).toBe(5);
    // Every build still counted.
    gameplaySession.end(false);
    expect(propsFor("session_builds")).toEqual([{ builds: BRIDGE_SEND_LIMIT + 5 }]);
    // The window passes and the held-back name sends again.
    forwardGameplayEvents([founded()], now + 60_000);
    expect(propsFor("new_game_started")).toHaveLength(BRIDGE_SEND_LIMIT + 1);
  });

  it("drains and drops the title backdrop's events", () => {
    const queue: unknown[] = [founded(), placed("lobby", 1)];
    drainEngineEvents(source(queue, { backdrop: true }));
    expect(queue).toEqual([]);
    expect(sent()).toEqual([]);
    expect(engineBridgeStats().discarded).toBe(2);
  });

  it("survives a drain that throws, and folds the next one", () => {
    let fail = true;
    const queue: unknown[] = [founded()];
    const src: GameplayEventSource = {
      drainGameplayEvents: () => {
        if (fail) throw new Error("unreachable executed");
        return queue.splice(0) as never;
      },
      gameplayEventsDropped: 3,
      gameplayEvents: { discardOnHandOff: false },
    };
    expect(() => drainEngineEvents(src)).not.toThrow();
    expect(engineBridgeStats().drainFailures).toBe(1);
    fail = false;
    drainEngineEvents(src);
    drainEngineEvents(src);
    expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]); // once, not lost or repeated
    expect(engineBridgeStats().engineDropped).toBe(3);
  });

  it("never throws into the frame loop, whatever the drain answers", () => {
    const answers: unknown[] = [null, undefined, "[]", 7, { name: "star_reached" }];
    for (const answer of answers) {
      const src = { drainGameplayEvents: () => answer, gameplayEventsDropped: 0, gameplayEvents: { discardOnHandOff: false } };
      expect(() => drainEngineEvents(src as unknown as GameplayEventSource)).not.toThrow();
    }
    expect(engineBridgeStats().drainFailures).toBe(answers.length);
    // A tower with no buffer object, and one whose drop count traps after it
    // answered the drain: the batch still folds.
    const queue: unknown[] = [star(2)];
    const trapped = {
      drainGameplayEvents: () => queue.splice(0),
      get gameplayEventsDropped(): number {
        throw new Error("unreachable executed");
      },
    };
    expect(() => drainEngineEvents(trapped as unknown as GameplayEventSource)).not.toThrow();
    expect(propsFor("star_reached")).toEqual([{ star: 2 }]);
  });

  it("drops the engine's pending events unsent when a window closes, and refills the send budget", () => {
    const queue: unknown[] = [];
    bindEngineBridge(() => source(queue));
    for (let i = 0; i < BRIDGE_SEND_LIMIT; i++) forwardGameplayEvents([star(2)]);
    queue.push(founded(), star(3));
    gameplaySession.startEpoch(); // a consent change
    expect(queue).toEqual([]);
    expect(engineBridgeStats().discarded).toBe(2);
    vi.mocked(sendToRelay).mockReset();
    forwardGameplayEvents([star(4)]);
    expect(sent()).toEqual([["star_reached", { star: 4 }]]);
  });

  it("counts a build the player then undid", () => {
    // Undo swaps in the earlier save; its own events are none, and the undone
    // build was already drained (or rides the hand-off), so it still counts.
    const sim = Simulation.newGame(5, "classic");
    sim.money = 1e9;
    const before = sim.serialize();
    for (let x = 180; x < 184; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    const undone = Simulation.deserialize(JSON.parse(JSON.stringify(before)) as SerializedGame);
    undone.gameplayEvents.inherit(sim.gameplayEvents); // what adoptSim does
    drainEngineEvents(undone);
    gameplaySession.begin();
    gameplaySession.end(false);
    expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]);
    expect(propsFor("first_build")).toEqual([{ tool: "lobby" }]);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
  });

  it("counts but sends nothing on a host where analytics is off", () => {
    window.location.href = localhost;
    forwardGameplayEvents([founded(), placed("office", 2), star(2)]);
    expect(sendToRelay).not.toHaveBeenCalled();
  });
});
