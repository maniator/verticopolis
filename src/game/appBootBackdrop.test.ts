import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { Simulation } from "../engine/Simulation";
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
 * takes over (`GameApp.adoptSim` inherits the replaced tower's buffer). A
 * real tower behind Continue hands its events on as usual.
 */

function makeApp(hadReadableSave: boolean): GameApp {
  return {
    mobileMq: { matches: false },
    audio: { sfx: vi.fn(), setProgram: vi.fn() },
    setSpeed: vi.fn(),
    ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
    sim: Simulation.newGame(Date.parse("2024-01-01")),
    saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
    hadReadableSave,
    saveWasCorrupt: false,
  } as unknown as GameApp;
}

/** What New Tower's swap does with the boot tower's buffer. */
function foundNewTower(app: GameApp): Simulation {
  const next = Simulation.newGame(7, "modern");
  next.gameplayEvents.inherit(app.sim.gameplayEvents);
  return next;
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
    const events = foundNewTower(app).drainGameplayEvents();
    expect(events).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
  });

  it("go on with a saved tower", () => {
    const app = makeApp(true);
    runBootFlow(app);
    expect(foundNewTower(app).drainGameplayEvents().filter((e) => e.name === "tower_founded")).toHaveLength(2);
  });
});
