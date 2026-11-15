import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { CLOSED_NOTICE, CLOSE_FAILED_NOTICE, closeTower, showTitleScreen } from "./titleScreen";
import { ENGINE_FAILURE_ID } from "./interactionState";

vi.mock("../analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));

/** The app File > Close and the title screen talk to, as spies. */
function makeApp(save: () => void = () => {}): GameApp {
  return {
    hadReadableSave: false,
    events: { setBackdrop: vi.fn() },
    onboarding: { showSplash: vi.fn() },
    audio: { muted: false },
    toggleMute: vi.fn(),
    setSpeed: vi.fn(),
    enginePort: { founder: () => false },
    ui: { toast: vi.fn(), newTowerModal: vi.fn() },
    saveLoad: { save: vi.fn(save), newGame: vi.fn() },
  } as unknown as GameApp;
}

type SplashOpts = { hasSave: boolean; onContinue: () => void };
const splashOpts = (app: GameApp) => vi.mocked(app.onboarding.showSplash).mock.calls[0]?.[0] as unknown as SplashOpts;

describe("File > Close", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("saves the tower silently, then shows the title screen with Continue", () => {
    const app = makeApp();
    expect(closeTower(app)).toBe(true);
    expect(app.saveLoad.save).toHaveBeenCalledWith(true);
    expect(app.onboarding.showSplash).toHaveBeenCalledTimes(1);
    expect(splashOpts(app).hasSave).toBe(true);
    expect(app.hadReadableSave).toBe(true);
    expect(app.ui.toast).toHaveBeenCalledWith(CLOSED_NOTICE, "good");
    // The save happens before the title screen goes up.
    expect(vi.mocked(app.saveLoad.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(app.onboarding.showSplash).mock.invocationCallOrder[0],
    );
    // A closed tower is the player's own, never the boot backdrop.
    expect(app.events.setBackdrop).not.toHaveBeenCalled();
  });

  it("keeps the tower open and says so when the save fails", () => {
    const app = makeApp(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(closeTower(app)).toBe(false);
    expect(app.onboarding.showSplash).not.toHaveBeenCalled();
    expect(app.hadReadableSave).toBe(false);
    expect(app.ui.toast).toHaveBeenCalledWith(CLOSE_FAILED_NOTICE, "bad");
  });

  it("does nothing on the title screen", () => {
    document.body.innerHTML = '<div id="splash"></div>';
    const app = makeApp();
    expect(closeTower(app)).toBe(false);
    expect(app.saveLoad.save).not.toHaveBeenCalled();
    expect(app.onboarding.showSplash).not.toHaveBeenCalled();
  });

  it("never writes a tower the game stopped on", () => {
    document.body.innerHTML = `<div id="${ENGINE_FAILURE_ID}"></div>`;
    const app = makeApp();
    expect(closeTower(app)).toBe(false);
    expect(app.saveLoad.save).not.toHaveBeenCalled();
    expect(app.onboarding.showSplash).not.toHaveBeenCalled();
  });

  it("Continue after a Close lands back in the tower paused", () => {
    const app = makeApp();
    closeTower(app);
    splashOpts(app).onContinue();
    expect(app.setSpeed).toHaveBeenCalledWith(0);
    expect(app.ui.toast).toHaveBeenLastCalledWith("Welcome back. Press Play to resume.", "info");
  });
});

describe("showTitleScreen", () => {
  it("marks a save-less boot tower as the backdrop and offers no Continue", () => {
    const app = makeApp();
    showTitleScreen(app, false);
    expect(app.events.setBackdrop).toHaveBeenCalledWith(true);
    expect(splashOpts(app).hasSave).toBe(false);
  });
});
