import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { sendToRelay } from "../../analyticsRelay";
import { gameplaySession } from "../../analytics";
import { drainEngineEvents, engineBridgeStats, resetEngineBridge } from "../../analyticsEngineBridge";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The analytics bridge over both engines (#873 phase 2): the same play on the
 * TypeScript engine and under the WASM host reaches the provider as the same
 * wire events, in the same order, so the 3.0.0 engine flip does not move a
 * dashboard. A drain the engine fails once loses and repeats nothing.
 */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("../../analyticsRelay", () => ({ sendToRelay: vi.fn() }));

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** Play that reaches the command-driven folds (the founding, placements, a
 *  capacity edit and a price change), draining (as the frame loop does)
 *  between steps. The tick-driven events (stars, fires, bombs, emergency
 *  answers) are held identical across the engines by the conformance lock's
 *  events hash on every scenario, and the folds are a function of the stream
 *  alone, so they need no second proof here. */
function play(sim: Simulation): void {
  drainEngineEvents(sim); // the founding
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
  drainEngineEvents(sim);
  expect(sim.build("office", 2, 180).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  const shaft = sim.tower.transportAt(1, 172)!;
  expect(sim.tower.setCars(shaft.id, 2)).toBe(true);
  const office = sim.tower.unitAt(2, 180)!;
  expect(sim.adjustRent(office.id, 1)).not.toBeNull();
  sim.tick(120);
  drainEngineEvents(sim);
}

/** The wire events sent so far, `[name, props]`, in order. */
function wire(): [string, unknown][] {
  return vi.mocked(sendToRelay).mock.calls.map(([n, p]) => [n, p]);
}

describe.skipIf(!hasWasmPackage())("analytics bridge on both engines", () => {
  beforeEach(() => {
    window.location.href = "https://verticopolis.com/";
    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = "http://localhost:3000/";
  });

  it("sends the same wire events whichever engine runs", () => {
    play(Simulation.newGame(41, "classic"));
    gameplaySession.end(true);
    const want = wire();
    expect(want.map(([n]) => n)).toEqual(expect.arrayContaining(["new_game_started", "first_build", "session_builds", "economy_action"]));
    expect(want).toContainEqual(["session_builds", { builds: 62 }]);

    gameplaySession.reset();
    resetEngineBridge();
    vi.mocked(sendToRelay).mockReset();
    const sim = Simulation.newGame(41, "classic");
    const host = attachWasmHost(sim, wasm());
    try {
      play(sim);
      gameplaySession.end(true);
      expect(wire()).toEqual(want);
    } finally {
      host.detach();
    }
  });

  // Each editor control the shell's price_tune and capacity_tune latches used
  // to watch now reports through the engine, on both engines.
  const tuning: [string, string, (sim: Simulation) => unknown][] = [
    ["rent nudge", "price_tune", (sim) => sim.adjustRent(sim.tower.unitAt(2, 180)!.id, 1)],
    ["price pick", "price_tune", (sim) => sim.priceUnit(sim.tower.unitAt(2, 180)!, 15_000)],
    ["off the market", "price_tune", (sim) => sim.setNoRate(sim.tower.unitAt(2, 180)!.id)],
    ["batch pricing", "price_tune", (sim) => sim.applyRentBatch("office", 15_000)?.changed],
    ["car added", "capacity_tune", (sim) => sim.tower.setCars(sim.tower.transportAt(1, 172)!.id, 2)],
    ["shaft extended", "capacity_tune", (sim) => sim.tower.resizeTransport(sim.tower.transportAt(1, 172)!.id, 1, 3).ok],
    ["shaft shrunk", "capacity_tune", (sim) => sim.tower.resizeTransport(sim.tower.transportAt(1, 172)!.id, 1, 2).ok],
  ];
  for (const [what, action, edit] of tuning) {
    it(`reports a ${what} as ${action} on both engines`, () => {
      for (const hosted of [false, true]) {
        gameplaySession.reset();
        resetEngineBridge();
        vi.mocked(sendToRelay).mockReset();
        const sim = Simulation.newGame(44, "classic");
        sim.money = 1e9;
        for (let x = 170; x < 200; x++) sim.build("lobby", 1, x);
        for (const f of [2, 3]) for (let x = 170; x < 200; x++) sim.build("floor", f, x);
        expect(sim.build("office", 2, 180).ok).toBe(true);
        expect(sim.buildTransport("elevatorStandard", 172, 1, what === "shaft shrunk" ? 3 : 2).ok).toBe(true);
        const host = hosted ? attachWasmHost(sim, wasm()) : null;
        try {
          drainEngineEvents(sim);
          vi.mocked(sendToRelay).mockReset();
          expect(edit(sim), `${what} applied (${hosted ? "WASM host" : "TypeScript"})`).toBeTruthy();
          drainEngineEvents(sim);
          expect(wire(), `${what} (${hosted ? "WASM host" : "TypeScript"})`).toEqual([["economy_action", { action }]]);
        } finally {
          host?.detach();
        }
      }
    });
  }

  it("loses and repeats nothing when the engine fails one drain", () => {
    const sim = Simulation.newGame(43, "modern");
    const host = attachWasmHost(sim, wasm());
    try {
      drainEngineEvents(sim);
      sim.money = 1e9;
      for (let x = 170; x < 180; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
      const engine = host.engine as { drainGameplayEvents: () => string };
      const real = engine.drainGameplayEvents;
      engine.drainGameplayEvents = () => {
        throw new Error("unreachable executed");
      };
      drainEngineEvents(sim);
      expect(engineBridgeStats().drainFailures).toBe(1);
      engine.drainGameplayEvents = real;
      drainEngineEvents(sim);
      drainEngineEvents(sim);
      expect(vi.mocked(sendToRelay).mock.calls.filter(([n]) => n === "first_build")).toEqual([["first_build", { tool: "lobby" }]]);
      gameplaySession.begin();
      gameplaySession.end(false);
      expect(vi.mocked(sendToRelay).mock.calls.filter(([n]) => n === "session_builds")).toEqual([["session_builds", { builds: 10 }]]);
    } finally {
      host.detach();
    }
  });
});
