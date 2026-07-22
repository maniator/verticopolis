import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { runBootFlow } from "./appBoot";
import { gameplaySession } from "../analytics";
import * as analyticsModule from "../analytics";
import { isOnboarded } from "../ui/Onboarding";

/**
 * The S4 boot-enrichment wiring, isolated from the larger appBoot suite. It locks
 * the assembly point `runBootFlow` -> `setCommonProps(bootCommonProps(...))`: that
 * enrichment is installed from the live app signals, that each field maps to the
 * right source (a swap of tenure/recency or a wrong sim read would pass every
 * pure-function test but fail here), and that it runs BEFORE the boot event so the
 * `boot` snapshot already carries it. The buckets themselves are proven pure in
 * analyticsEnrichment.test.ts; this asserts only the glue.
 */

// Controller modules are built by wireControllers, not runBootFlow; stub them so
// importing appBoot stays light (they are never instantiated by these tests).
vi.mock("./buildActions", () => ({ BuildActions: class {} }));
vi.mock("./inspector", () => ({ InspectorController: class {} }));
vi.mock("./editorActions", () => ({ EditorActions: class {} }));
vi.mock("./keyboardPlay", () => ({ KeyboardPlay: class {} }));
vi.mock("./engineWiring", () => ({ rebuildEngine: vi.fn() }));
vi.mock("./contextRecovery", () => ({ attemptContextRecovery: vi.fn() }));
vi.mock("../ui/crashScreen", async (orig) => ({
  ...(await orig<typeof import("../ui/crashScreen")>()),
  showCrashScreen: vi.fn(),
}));
// Keep the real RESUME_AFTER_RECOVERY_KEY (runBootFlow reads it); mock only the class.
vi.mock("./saveLoad", async (orig) => ({
  ...(await orig<typeof import("./saveLoad")>()),
  SaveLoad: class {},
}));
vi.mock("../ui/Onboarding", () => ({
  OnboardingController: class {
    showSplash = vi.fn();
    arm = vi.fn();
    constructor(_opts: unknown) {}
  },
  // runBootFlow reads this for the `returning` enrichment bucket.
  isOnboarded: vi.fn(() => true),
}));
// The dual-write adapter would fire a real beacon / vendor call on a deployed
// host; stub both transports so these tests stay offline.
vi.mock("../analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vi.fn(), inject: vi.fn() }));
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));

const DAY = 86_400_000;

describe("runBootFlow analytics enrichment wiring (S4)", () => {
  function makeApp(over: Partial<Record<string, unknown>> = {}): GameApp {
    return {
      mobileMq: { matches: false },
      audio: { sfx: vi.fn(), setProgram: vi.fn() },
      setSpeed: vi.fn(),
      ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
      sim: { emit: vi.fn(), mode: "modern", star: 3, population: 100, tower: { highestFloor: 10 }, clock: { day: 12 } },
      saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
      hadReadableSave: true,
      saveWasCorrupt: false,
      ...over,
    } as unknown as GameApp;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = "";
    window.location.href = "https://verticopolis.com/";
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    sessionStorage.clear();
    window.location.href = "http://localhost:3000/";
  });

  it("installs enrichment from the live signals, before the boot event", () => {
    const setSpy = vi.spyOn(analyticsModule, "setCommonProps");
    const bootSpy = vi.spyOn(gameplaySession, "noteBoot");
    window.location.href = "https://verticopolis.com/?src=twa"; // -> platform "twa"
    // clock.day 12 -> tenure "d7-29"; saved just now -> recency "1d"; onboarded true.
    runBootFlow(makeApp(), Date.now());

    expect(setSpy).toHaveBeenCalledWith({ platform: "twa", returning: true, tenure: "d7-29", recency: "1d" });
    // The enrichment is set BEFORE the boot snapshot fires, so `boot` carries it.
    expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(bootSpy.mock.invocationCallOrder[0]);
    setSpy.mockRestore();
    bootSpy.mockRestore();
  });

  it("maps tenure off clock.day and recency off savedAtBoot independently (guards a field swap)", () => {
    const setSpy = vi.spyOn(analyticsModule, "setCommonProps");
    // A day-0 tower (tenure "d0") last saved 10 days ago (recency "30d"): the two
    // axes must not be crossed. A no-marker web launch reads platform "web".
    const app = makeApp({
      sim: { emit: vi.fn(), mode: "classic", star: 1, population: 0, tower: { highestFloor: 1 }, clock: { day: 0 } },
    });

    runBootFlow(app, Date.now() - 10 * DAY);

    expect(setSpy).toHaveBeenCalledWith({ platform: "web", returning: true, tenure: "d0", recency: "30d" });
    setSpy.mockRestore();
  });

  it("never blocks boot when an enrichment read throws (returning stays best-effort)", () => {
    // isOnboarded throwing must not abort boot: the compute is wrapped best-effort.
    vi.mocked(isOnboarded).mockImplementationOnce(() => {
      throw new Error("storage blew up");
    });
    expect(() => runBootFlow(makeApp(), Date.now())).not.toThrow();
    vi.mocked(isOnboarded).mockReturnValue(true);
  });
});
