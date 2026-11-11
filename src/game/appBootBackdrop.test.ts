import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { mockPort } from "../tests/portKit/mockPort";
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
 * New Tower, so the boot marks it as the backdrop and the engine hands none
 * of its events on past the swap. A real tower behind Continue is not marked.
 * The engine's half (a marked tower hands on nothing) is
 * `the_backdrop_hands_on_nothing` in `engine-rs/src/wasm_port_life_tests.rs`
 * and the backdrop case in `portReads.integration.test.ts`.
 */

function makeApp(hadReadableSave: boolean) {
  const enginePort = mockPort({ setBackdrop: () => undefined, generation: () => 3, founder: () => false });
  const events = new PortEvents(enginePort);
  const app = {
    mobileMq: { matches: false },
    audio: { sfx: vi.fn(), setProgram: vi.fn() },
    setSpeed: vi.fn(),
    ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
    enginePort,
    events,
    saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
    hadReadableSave,
    saveWasCorrupt: false,
  } as unknown as GameApp;
  return { app, enginePort, events };
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

  it("marks the title's backdrop tower when there is no save, so its events stay behind", () => {
    const { app, enginePort, events } = makeApp(false);
    runBootFlow(app);
    expect(enginePort.setBackdrop).toHaveBeenCalledExactlyOnceWith(true);
    expect(events.gameplayEvents.discardOnHandOff, "the bridge drops the backdrop's events").toBe(true);
  });

  it("leaves a saved tower unmarked, so its events go on", () => {
    const { app, enginePort, events } = makeApp(true);
    runBootFlow(app);
    expect(enginePort.setBackdrop).not.toHaveBeenCalled();
    expect(events.gameplayEvents.discardOnHandOff).toBe(false);
  });
});
