import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";
import { Simulation } from "./engine/Simulation";
import type { SerializedGame } from "./engine/serializedGame";
import { RATE_LIMIT_MAX } from "./analyticsRateLimit";
import {
  BRIDGE_SEND_LIMIT,
  REMOVAL_SEND_LIMIT,
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
const removed = (kind: string, method: string) => ({ name: "facility_removed", payload: { kind, method } });
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

  it("sends every removal as demolish with its method, and nothing for a milestone yet", () => {
    forwardGameplayEvents([
      removed("office", "sell"),
      removed("stairs", "bulldoze"),
      removed("office", "bulldoze"),
      { name: "milestone_reached", payload: { id: "pop-500" } },
    ]);
    expect(sent()).toEqual([
      ["economy_action", { action: "demolish", detail: "sell" }],
      ["economy_action", { action: "demolish", detail: "bulldoze" }],
      ["economy_action", { action: "demolish", detail: "bulldoze" }],
    ]);
    expect(engineBridgeStats().rejected).toBe(0);
  });

  it("gives removals their own budget, larger than a wire name's", () => {
    expect(REMOVAL_SEND_LIMIT).toBeGreaterThan(BRIDGE_SEND_LIMIT);
    // Two misaligned windows can put twice the budget in one ingest window.
    expect(2 * REMOVAL_SEND_LIMIT).toBeLessThan(RATE_LIMIT_MAX);
    const now = 1_000;
    // A bulldozer drag runs on its own budget, past a wire name's.
    for (let i = 0; i < REMOVAL_SEND_LIMIT + 3; i++) forwardGameplayEvents([removed("office", "bulldoze")], now);
    expect(propsFor("economy_action")).toHaveLength(REMOVAL_SEND_LIMIT);
    expect(engineBridgeStats().rateLimited).toBe(3);
    // A new minute refills it.
    forwardGameplayEvents([removed("office", "sell")], now + 60_000);
    expect(propsFor("economy_action")).toHaveLength(REMOVAL_SEND_LIMIT + 1);
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

  it("never attributes a build to the wrong tower across rate-limited foundings", () => {
    // The case needs an empty tower founded inside the budget after A.
    expect(BRIDGE_SEND_LIMIT).toBeGreaterThanOrEqual(2);
    const now = 5_000;
    gameplaySession.begin();
    // Tower A is founded and builds: its funnel reports.
    forwardGameplayEvents([founded("classic"), placed("office", 2)], now);
    // Spend the rest of the founding budget on towers that never build.
    for (let i = 1; i < BRIDGE_SEND_LIMIT; i++) forwardGameplayEvents([founded()], now);
    // The last reported tower never built, so its funnel is still open.
    // Tower B's founding is held back. Its builds must not report a
    // first_build: the funnel closes rather than letting B's first build
    // pass as that empty tower's.
    forwardGameplayEvents([founded("modern"), placed("condo", 3), placed("shop", 4)], now);
    // Tower C, after the window, reports its own founding and first build.
    forwardGameplayEvents([founded("modern"), placed("hotelSingle", 5)], now + 60_000);
    // Every first_build follows its own tower's new_game_started, and none
    // carries a tool that tower did not place first.
    const funnel = sent().filter(([n]) => n === "new_game_started" || n === "first_build");
    expect(funnel.filter(([n]) => n === "first_build")).toEqual([
      ["first_build", { tool: "office" }],
      ["first_build", { tool: "hotelSingle" }],
    ]);
    funnel.forEach(([n], i) => {
      if (n === "first_build") expect(funnel[i - 1][0]).toBe("new_game_started");
    });
    expect(funnel[funnel.length - 2]).toEqual(["new_game_started", { mode: "modern" }]);
    // B's builds were still counted for the session.
    gameplaySession.end(false);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
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
    gameplaySession.startEpoch(); // a new measurement window
    expect(queue).toEqual([]);
    expect(engineBridgeStats().discarded).toBe(2);
    vi.mocked(sendToRelay).mockReset();
    forwardGameplayEvents([star(4)]);
    expect(sent()).toEqual([["star_reached", { star: 4 }]]);
  });

  it("asks the source to let go of held events at the session's own flushes, and only there (#874)", () => {
    const calls: unknown[] = [];
    bindEngineBridge(() => ({ drainGameplayEvents: (opts?: unknown) => (calls.push(opts), []), gameplayEventsDropped: 0, gameplayEvents: { discardOnHandOff: false } }));
    drainEngineEvents({ drainGameplayEvents: (opts?: unknown) => (calls.push(opts), []), gameplayEventsDropped: 0, gameplayEvents: { discardOnHandOff: false } });
    gameplaySession.end(); // a hide: the report folds the engine's last events
    gameplaySession.startEpoch(); // a window closing: dropped unsent
    expect(calls).toEqual([undefined, { release: true }, { release: true }]);
  });

  it("refills the removal budget when a window closes", () => {
    bindEngineBridge(() => source([]));
    for (let i = 0; i <= REMOVAL_SEND_LIMIT; i++) forwardGameplayEvents([removed("office", "bulldoze")], 5);
    expect(propsFor("economy_action")).toHaveLength(REMOVAL_SEND_LIMIT);
    expect(engineBridgeStats().rateLimited).toBe(1);
    gameplaySession.startEpoch();
    vi.mocked(sendToRelay).mockReset();
    forwardGameplayEvents([removed("office", "sell")], 5);
    expect(sent()).toEqual([["economy_action", { action: "demolish", detail: "sell" }]]);
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

  it("is the only sender of demolish: no shell code reports a removal itself", () => {
    // A shell call next to the bridge's fold would send every removal twice.
    // Every source file but the bridge itself; tests and the type that names
    // the action are left out by the pattern, which looks for the value as code.
    const src = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(src, { recursive: true, encoding: "utf8" })
      .map((f) => f.replace(/\\/g, "/")) // Windows joins with backslashes
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
      .filter((f) => f !== "analyticsEngineBridge.ts");
    expect(files).toContain("game/buildActions.ts");
    const senders = files.filter((f) => /["'`]demolish["'`]\s*[,)};]/.test(readFileSync(resolve(src, f), "utf8")));
    expect(senders).toEqual([]);
  });

  it("counts a removal the player then undid", () => {
    const sim = Simulation.newGame(6, "classic");
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
    expect(sim.build("office", 2, 180).ok).toBe(true);
    drainEngineEvents(sim);
    vi.mocked(sendToRelay).mockReset();
    const before = sim.serialize();
    expect(sim.removeFacility(sim.tower.unitAt(2, 180)!.id, "bulldoze").ok).toBe(true);
    const undone = Simulation.deserialize(JSON.parse(JSON.stringify(before)) as SerializedGame);
    undone.gameplayEvents.inherit(sim.gameplayEvents); // what adoptSim does
    drainEngineEvents(undone);
    expect(sent()).toEqual([["economy_action", { action: "demolish", detail: "bulldoze" }]]);
  });

  it("counts a fold that throws and folds the rest of the batch", () => {
    const spy = vi.spyOn(gameplaySession, "noteStar").mockImplementation(() => {
      throw new Error("fold bug");
    });
    try {
      expect(() => forwardGameplayEvents([star(2), founded()])).not.toThrow();
      expect(engineBridgeStats().foldFailures).toBe(1);
      expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]);
    } finally {
      spy.mockRestore();
    }
  });

  it("folds every engine event exactly once across a swap, a page hide and a consent flip", () => {
    // One live tower at a time, as the frame loop and the session see it.
    let live = Simulation.newGame(7, "classic");
    bindEngineBridge(() => live);
    gameplaySession.begin();
    live.money = 1e9;
    drainEngineEvents(live); // the founding
    for (let x = 180; x < 183; x++) expect(live.build("lobby", 1, x).ok).toBe(true);
    // A failed drain in the middle loses and repeats nothing.
    const real = live.drainGameplayEvents.bind(live);
    live.drainGameplayEvents = () => {
      throw new Error("trap");
    };
    drainEngineEvents(live);
    live.drainGameplayEvents = real;
    // A swap (a load) hands the undrained builds on; the new tower adds one.
    const next = Simulation.deserialize(JSON.parse(JSON.stringify(live.serialize())) as SerializedGame);
    next.gameplayEvents.inherit(live.gameplayEvents);
    live = next;
    live.money = 1e9;
    expect(live.build("lobby", 1, 183).ok).toBe(true);
    // A rejected event in the same batch is dropped without touching the rest.
    live.gameplayEvents.pushEvent({ name: "tower_renamed", payload: {} } as never);
    // The page hide folds what the engine still holds, once.
    gameplaySession.end(false);
    drainEngineEvents(live);
    gameplaySession.end(false);
    expect(propsFor("session_builds")).toEqual([{ builds: 4 }]);
    expect(propsFor("new_game_started")).toEqual([{ mode: "classic" }]);
    expect(propsFor("first_build")).toEqual([{ tool: "lobby" }]);
    expect(engineBridgeStats()).toMatchObject({ rejected: 1, drainFailures: 1 });
    // A new window drops what the engine holds unsent; nothing is folded twice.
    expect(live.build("lobby", 1, 184).ok).toBe(true);
    gameplaySession.startEpoch();
    drainEngineEvents(live);
    expect(engineBridgeStats().discarded).toBe(1);
  });

  it("counts but sends nothing on a host where analytics is off", () => {
    window.location.href = localhost;
    forwardGameplayEvents([founded(), placed("office", 2), star(2)]);
    expect(sendToRelay).not.toHaveBeenCalled();
  });
});
