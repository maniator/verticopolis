import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import type { GameplayEvent } from "../engine/gameplayEvents";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";
import { PortEvents } from "../simport/portEvents";
import { runBootFlow } from "./appBoot";

// Same module stubs runBootFlow needs as appBoot.test.ts.
vi.mock("../analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("../ui/Onboarding", () => ({
  OnboardingController: class {
    showSplash = vi.fn();
    arm = vi.fn();
  },
  isOnboarded: vi.fn(() => true),
}));

/**
 * The boot backdrop's gameplay events (#873). Split out of appBoot.test.ts,
 * which sits at the file-size ceiling. With no readable save the boot tower
 * is only the title screen's backdrop and the player founds their own from
 * New Tower, so whatever the backdrop emitted stays behind when that tower
 * takes over (the engine's swap drops a backdrop's buffer, `TsEngine.adopt`). A
 * real tower behind Continue hands its events on as usual.
 */

function makeApp(hadReadableSave: boolean, handOff = false): GameApp {
  const enginePort = new TsEngine(Simulation.newGame(Date.parse("2024-01-01")));
  const app = {
    mobileMq: { matches: false },
    audio: { sfx: vi.fn(), setProgram: vi.fn() },
    setSpeed: vi.fn(),
    ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
    sim: enginePort.sim,
    enginePort,
    events: new PortEvents(enginePort),
    saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
    hadReadableSave,
    saveWasCorrupt: false,
  } as unknown as GameApp;
  // The app's own swap, as `GameApp.adoptSim` makes it while the mirror host
  // follows it: the new tower inherits the replaced one's buffer.
  if (handOff)
    enginePort.handOff = (next) => {
      next.gameplayEvents.inherit(app.sim.gameplayEvents);
      (app as { sim: Simulation }).sim = next;
      enginePort.take(next);
    };
  return app;
}

/** New Tower's swap through the port, then the bridge's next drain. */
function foundNewTower(app: GameApp): GameplayEvent[] {
  const codes = new PortCodes(app.enginePort);
  app.enginePort.foundTower(7, codes.code("modes", "modern"), codes.code("calendars", "realWorld"), false);
  return app.events.drainGameplayEvents();
}

describe("runBootFlow: the boot backdrop's events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  it("stay behind when the player founds a tower, even ones emitted after the splash", () => {
    const app = makeApp(false);
    runBootFlow(app);
    app.sim.gameplayEvents.push("fire_started", {}); // the backdrop, still running behind the title
    const events = foundNewTower(app);
    expect(events).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
  });

  it("stay behind when the swap hands the new tower to the app", () => {
    const app = makeApp(false, true);
    runBootFlow(app);
    app.sim.gameplayEvents.push("fire_started", {});
    expect(foundNewTower(app)).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
  });

  it("go on with a saved tower", () => {
    const app = makeApp(true);
    runBootFlow(app);
    expect(foundNewTower(app).filter((e) => e.name === "tower_founded")).toHaveLength(2);
  });
});
