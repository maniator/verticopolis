import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { startWasmHost } from "../../wasmhost/startWasmHost";
import { sendToRelay } from "../../analyticsRelay";
import { gameplaySession } from "../../analytics";
import { drainEngineEvents, engineBridgeStats, resetEngineBridge } from "../../analyticsEngineBridge";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The analytics bridge over both engines (#873 phase 2): the same play on the
 * TypeScript engine and under the WASM host reaches the provider as the same
 * wire events, in the same order, so the 3.0.0 engine flip does not move a
 * dashboard. A drain the engine fails loses and repeats nothing: the host
 * falls back (#874) and hands over every event from before its restore point.
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
  expect(sim.setCars(shaft.id, 2)).toBe(true);
  const office = sim.tower.unitAt(2, 180)!;
  expect(sim.adjustRent(office.id, 1)).not.toBeNull();
  sim.tick(120);
  drainEngineEvents(sim);
}

/** The frame loop's drain once the play is covered. The WASM host holds a
 *  command's events until its engine's state covers the command (#874), so a
 *  fallback that undoes the command never sends them: here the next save the
 *  game reads (an undo capture, an autosave) covers it. On TypeScript the
 *  save changes nothing. */
function drainCovered(sim: Simulation): void {
  sim.serialize();
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
    ["car added", "capacity_tune", (sim) => sim.setCars(sim.tower.transportAt(1, 172)!.id, 2)],
    ["shaft extended", "capacity_tune", (sim) => sim.resizeTransport(sim.tower.transportAt(1, 172)!.id, 1, 3).ok],
    ["shaft shrunk", "capacity_tune", (sim) => sim.resizeTransport(sim.tower.transportAt(1, 172)!.id, 1, 2).ok],
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
          // TypeScript sends at once; the WASM host waits for a point.
          expect(wire(), `${what} before a point (${hosted ? "WASM host" : "TypeScript"})`).toEqual(hosted ? [] : [["economy_action", { action }]]);
          drainCovered(sim);
          expect(wire(), `${what} (${hosted ? "WASM host" : "TypeScript"})`).toEqual([["economy_action", { action }]]);
        } finally {
          host?.detach();
        }
      }
    });
  }

  it("reports each removal as demolish with its method, and a refused one as nothing, on both engines", () => {
    for (const hosted of [false, true]) {
      gameplaySession.reset();
      resetEngineBridge();
      const sim = Simulation.newGame(45, "classic");
      sim.money = 1e9;
      for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
      for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
      expect(sim.build("office", 2, 180).ok).toBe(true);
      expect(sim.buildTransport("stairs", 190, 1, 2).ok).toBe(true);
      const host = hosted ? attachWasmHost(sim, wasm()) : null;
      const engine = hosted ? "WASM host" : "TypeScript";
      try {
        drainEngineEvents(sim);
        vi.mocked(sendToRelay).mockReset();
        // The editor's Sell and the bulldozer both remove through removeFacility.
        expect(sim.removeFacility(sim.tower.unitAt(2, 180)!.id, "sell").ok, engine).toBe(true);
        expect(sim.removeFacility(sim.tower.transportAt(1, 190)!.id, "bulldoze").ok, engine).toBe(true);
        // A lobby tile is permanent: refused, and reports nothing.
        const refused = sim.removeFacility(sim.tower.unitAt(1, 180)!.id, "bulldoze");
        expect(refused.ok, engine).toBe(false);
        expect(refused.reason, engine).toMatch(/^Lobby tiles are permanent/);
        drainCovered(sim);
        expect(wire(), engine).toEqual([
          ["economy_action", { action: "demolish", detail: "sell" }],
          ["economy_action", { action: "demolish", detail: "bulldoze" }],
        ]);
      } finally {
        host?.detach();
      }
    }
  });

  it("loses and repeats nothing when the engine fails a drain and the host falls back", async () => {
    const app = {
      sim: Simulation.newGame(43, "modern"),
      adoptSim(next: Simulation) {
        next.gameplayEvents.inherit(app.sim.gameplayEvents); // as GameApp.adoptSim does
        app.sim = next;
      },
    };
    const handle = startWasmHost(app, wasm(), { info: () => {}, error: () => {} });
    const sim = app.sim;
    const engine = handle.current()!.engine as { drainGameplayEvents: () => string };
    try {
      drainEngineEvents(sim);
      sim.money = 1e9;
      for (let x = 170; x < 180; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
      sim.tick(1); // the tick's restore point takes the placements' events
      const real = engine.drainGameplayEvents;
      engine.drainGameplayEvents = () => {
        throw new Error("unreachable executed");
      };
      // The host answers the drain with the events it holds and falls back;
      // the bridge sees a drain that worked.
      drainEngineEvents(sim);
      expect(engineBridgeStats().drainFailures).toBe(0);
      expect(handle.status.lastFallback).toEqual({ reason: "trap-tick", stage: "start" });
      engine.drainGameplayEvents = real;
      await new Promise((r) => setTimeout(r, 0));
      expect(app.sim).not.toBe(sim);
      expect(app.sim.tower.units.filter((u) => u.kind === "lobby")).toHaveLength(10);
      drainEngineEvents(app.sim);
      drainEngineEvents(app.sim);
      expect(vi.mocked(sendToRelay).mock.calls.filter(([n]) => n === "first_build")).toEqual([["first_build", { tool: "lobby" }]]);
      gameplaySession.begin();
      gameplaySession.end(false);
      expect(vi.mocked(sendToRelay).mock.calls.filter(([n]) => n === "session_builds")).toEqual([["session_builds", { builds: 10 }]]);
    } finally {
      handle.stop();
    }
  });
});
