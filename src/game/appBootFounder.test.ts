import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { runBootFlow } from "./appBoot";
import { RESUME_AFTER_RECOVERY_KEY } from "./saveLoad";

// Same module stubs runBootFlow needs as appBoot.test.ts: keep the PostHog relay
// from firing, resolve the PWA virtual module on Windows, and make the splash
// observable by spying showSplash on the OnboardingController runBootFlow news up.
vi.mock("../analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));
vi.mock("../ui/Onboarding", () => ({
  OnboardingController: class {
    opts: unknown;
    showSplash = vi.fn();
    arm = vi.fn();
    constructor(opts: unknown) {
      this.opts = opts;
    }
  },
  isOnboarded: vi.fn(() => true),
}));

/**
 * Boot-flow coverage for the 2.0 Ground-floor welcome. Split out of
 * appBoot.test.ts (which sits at the 500-line file-size ceiling).
 *
 * The welcome is gated `app.sim?.founder && shouldWelcomeFounder()`: the Founder
 * check MUST come first, because shouldWelcomeFounder() is a check-and-SET on a
 * one-shot localStorage latch. If that order ever flips, a non-Founder's first
 * boot would spend the latch and a real Founder would never be greeted. These
 * pin that ordering (and the splash badge wiring) at the boot-flow level.
 */

const LATCH = "vc-founder-welcomed";
const FOUNDER_TOAST = "ground floor";

function makeApp(over: Partial<Record<string, unknown>> = {}): GameApp {
  return {
    mobileMq: { matches: false },
    audio: { sfx: vi.fn(), setProgram: vi.fn() },
    setSpeed: vi.fn(),
    ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
    sim: { emit: vi.fn(), mode: "modern", star: 3, population: 500, tower: { highestFloor: 20 }, founder: false },
    saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
    hadReadableSave: false,
    saveWasCorrupt: false,
    ...over,
  } as unknown as GameApp;
}

const founderSim = (founder: boolean) =>
  ({ emit: vi.fn(), mode: "modern", star: 3, population: 500, tower: { highestFloor: 20 }, founder }) as unknown;

describe("runBootFlow: the Ground floor welcome (2.0)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.removeItem(LATCH);
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    sessionStorage.clear();
    localStorage.removeItem(LATCH);
  });

  it("greets a Founder once on the resume path and spends the latch", () => {
    sessionStorage.setItem(RESUME_AFTER_RECOVERY_KEY, String(Date.now()));
    const app = makeApp({ hadReadableSave: true, sim: founderSim(true) });
    runBootFlow(app);
    expect(app.ui.toast).toHaveBeenCalledWith(expect.stringContaining(FOUNDER_TOAST), "good");
    expect(localStorage.getItem(LATCH)).toBe("1");
  });

  it("does NOT greet a non-Founder and leaves the one-shot latch unspent", () => {
    sessionStorage.setItem(RESUME_AFTER_RECOVERY_KEY, String(Date.now()));
    const app = makeApp({ hadReadableSave: true, sim: founderSim(false) });
    runBootFlow(app);
    expect(app.ui.toast).not.toHaveBeenCalledWith(expect.stringContaining(FOUNDER_TOAST), "good");
    // The latch is preserved, so a genuine Founder booted later still gets greeted.
    expect(localStorage.getItem(LATCH)).toBeNull();
  });

  it("wires the badge and greets a Founder via the splash Continue path", () => {
    const app = makeApp({ hadReadableSave: true, sim: founderSim(true) });
    runBootFlow(app);
    const splashArg = (app.onboarding.showSplash as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(splashArg.founder()).toBe(true); // badge shown for a Founder
    splashArg.onContinue();
    expect(app.ui.toast).toHaveBeenCalledWith(expect.stringContaining(FOUNDER_TOAST), "good");
  });

  it("does not show the badge for a non-Founder splash", () => {
    const app = makeApp({ hadReadableSave: true, sim: founderSim(false) });
    runBootFlow(app);
    const splashArg = (app.onboarding.showSplash as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(splashArg.founder()).toBe(false);
  });
});
