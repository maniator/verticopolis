import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireControllers, runBootFlow, bootReason, APP_VERSION } from "./appBoot";
import { RESUME_AFTER_RECOVERY_KEY } from "./saveLoad";
import { RESUME_AFTER_UPDATE_KEY } from "./updateFlow";
import { showCrashScreen } from "../ui/crashScreen";
import { attemptContextRecovery } from "./contextRecovery";
import { rebuildEngine } from "./engineWiring";
import { gameplaySession } from "../analytics";

/**
 * Headless unit tests for the constructor collaborators.
 *
 * wireControllers is pure composition-root wiring: it news the five controller
 * modules, handing each a bundle of late-bound adapter closures (`() => app.sim`
 * and friends) so the controllers reach the live app without caching it. Its job
 * IS those closures, so the five controller modules are mocked to capture the
 * deps bundle they receive, and the test then invokes every closure and asserts
 * it delegates to the app. `contextRecovery` / `engineWiring` / `crashScreen`
 * are mocked too so the crash-recovery closures can run without a real engine.
 *
 * runBootFlow's OnboardingController is mocked to a spy so the splash path is
 * observable, and the resume flags are driven through sessionStorage.
 */

// Capture each controller's ctor deps so the wiring closures can be invoked.
const mocks = vi.hoisted(() => ({ deps: {} as Record<string, Record<string, unknown>> }));

vi.mock("./buildActions", () => ({
  BuildActions: class {
    constructor(deps: Record<string, unknown>) {
      mocks.deps.build = deps;
    }
  },
}));
vi.mock("./inspector", () => ({
  InspectorController: class {
    constructor(deps: Record<string, unknown>) {
      mocks.deps.inspector = deps;
    }
  },
}));
vi.mock("./editorActions", () => ({
  EditorActions: class {
    constructor(deps: Record<string, unknown>) {
      mocks.deps.editor = deps;
    }
  },
}));
// Keep the real RESUME_AFTER_RECOVERY_KEY (runBootFlow reads it); mock only the class.
vi.mock("./saveLoad", async (orig) => ({
  ...(await orig<typeof import("./saveLoad")>()),
  SaveLoad: class {
    constructor(deps: Record<string, unknown>) {
      mocks.deps.save = deps;
    }
  },
}));
vi.mock("./keyboardPlay", () => ({
  KeyboardPlay: class {
    constructor(deps: Record<string, unknown>) {
      mocks.deps.keyboard = deps;
    }
  },
}));
// showCrashScreen: invoke the getSim it is handed so that closure is covered too.
vi.mock("../ui/crashScreen", async (orig) => ({
  ...(await orig<typeof import("../ui/crashScreen")>()),
  showCrashScreen: vi.fn((info: { getSim?: () => unknown }) => void info.getSim?.()),
}));
vi.mock("./engineWiring", () => ({ rebuildEngine: vi.fn() }));
// Drive the recovery hooks so onRestored (+ its unsub) and rebuild all run.
vi.mock("./contextRecovery", () => ({
  attemptContextRecovery: vi.fn(
    (hooks: { onRestored: (cb: () => void) => () => void; rebuild: () => void }, done?: () => void) => {
      hooks.onRestored(() => {})();
      hooks.rebuild();
      done?.();
    },
  ),
}));

vi.mock("../ui/Onboarding", () => ({
  OnboardingController: class {
    opts: unknown;
    showSplash = vi.fn();
    arm = vi.fn();
    constructor(opts: unknown) {
      this.opts = opts;
    }
  },
}));

describe("wireControllers", () => {
  /** A fake app whose every collaborator is a spy, so each wiring closure can be
   *  invoked and asserted to route to the matching app member. */
  function makeWiringApp() {
    const sim = { id: "sim", star: 3, population: 800 };
    const engine = { viewState: vi.fn(() => ({ view: 1 })), onContextRestored: null as unknown };
    const app = {
      sim,
      engine,
      audio: { sfx: vi.fn(), setProgram: vi.fn() },
      speed: 2,
      frameErrors: [],
      tool: "build",
      selected: { id: 7 },
      inspectAnchor: null,
      ui: {
        toast: vi.fn(),
        showInspector: vi.fn(),
        showBatchPricingDialog: vi.fn(),
        showElevatorScheduleDialog: vi.fn(),
        downloadFile: vi.fn(),
        showImportReport: vi.fn(),
        showExportReport: vi.fn(),
      },
      onboarding: { arm: vi.fn() },
      selectedUnit: vi.fn(() => ({ unit: 1 })),
      selectedTransport: vi.fn(() => ({ transport: 1 })),
      clearSelection: vi.fn(),
      refreshEditor: vi.fn(),
      captureUndo: vi.fn(),
      commitUndo: vi.fn(),
      announce: vi.fn(),
      adoptSim: vi.fn(),
      isTransportTool: vi.fn(() => true),
      pickedAt: vi.fn(() => ({ picked: 1 })),
      selectPicked: vi.fn(),
      placeSimpleBuild: vi.fn(),
      updateBuildPreview: vi.fn(),
    };
    return app as unknown as GameApp & typeof app;
  }

  beforeEach(() => {
    mocks.deps = {};
    vi.mocked(showCrashScreen).mockClear();
    vi.mocked(attemptContextRecovery).mockClear();
    vi.mocked(rebuildEngine).mockClear();
  });

  it("hands BuildActions closures that reach the live app", () => {
    const app = makeWiringApp();
    wireControllers(app);
    const d = mocks.deps.build as {
      getSim: () => unknown;
      ui: { toast: (t: string, k: string) => void };
      selectedId: () => number | null;
      clearSelection: () => void;
    };
    expect(d.getSim()).toBe(app.sim);
    d.ui.toast("hi", "bad");
    expect(app.ui.toast).toHaveBeenCalledWith("hi", "bad");
    expect(d.selectedId()).toBe(7);
    d.clearSelection();
    expect(app.clearSelection).toHaveBeenCalled();
  });

  it("hands InspectorController closures that reach the live app", () => {
    const app = makeWiringApp();
    wireControllers(app);
    const d = mocks.deps.inspector as {
      getSim: () => unknown;
      ui: { showInspector: (h: unknown) => void };
      setAnchor: (a: unknown) => void;
    };
    expect(d.getSim()).toBe(app.sim);
    d.ui.showInspector("tpl");
    expect(app.ui.showInspector).toHaveBeenCalledWith("tpl");
    d.setAnchor({ x: 3, floor: 4 });
    expect(app.inspectAnchor).toEqual({ x: 3, floor: 4 });
  });

  it("hands EditorActions closures that reach the live app", () => {
    const app = makeWiringApp();
    wireControllers(app);
    const d = mocks.deps.editor as Record<string, (...a: unknown[]) => unknown> & {
      ui: Record<string, (...a: unknown[]) => unknown>;
    };
    expect(d.getSim()).toBe(app.sim);
    d.ui.toast("t", "info");
    expect(app.ui.toast).toHaveBeenCalledWith("t", "info");
    d.ui.showBatchPricingDialog("ctx", "cb");
    expect(app.ui.showBatchPricingDialog).toHaveBeenCalledWith("ctx", "cb");
    d.ui.showElevatorScheduleDialog("ctx", "cb");
    expect(app.ui.showElevatorScheduleDialog).toHaveBeenCalledWith("ctx", "cb");
    expect(d.selected()).toBe(app.selected);
    d.selectedUnit();
    expect(app.selectedUnit).toHaveBeenCalled();
    d.selectedTransport();
    expect(app.selectedTransport).toHaveBeenCalled();
    d.clearSelection();
    expect(app.clearSelection).toHaveBeenCalled();
    d.refreshEditor();
    expect(app.refreshEditor).toHaveBeenCalled();
    d.captureUndo("label");
    expect(app.captureUndo).toHaveBeenCalledWith("label");
    d.commitUndo();
    expect(app.commitUndo).toHaveBeenCalled();
    d.announce("msg");
    expect(app.announce).toHaveBeenCalledWith("msg");
  });

  it("hands SaveLoad closures that reach the live app (incl. crash + recovery)", () => {
    const app = makeWiringApp();
    wireControllers(app);
    const d = mocks.deps.save as Record<string, (...a: unknown[]) => unknown> & {
      ui: Record<string, (...a: unknown[]) => unknown>;
    };
    expect(d.getSim()).toBe(app.sim);
    expect(d.getView()).toEqual({ view: 1 });
    expect(app.engine.viewState).toHaveBeenCalled();
    d.adoptSim("newsim");
    expect(app.adoptSim).toHaveBeenCalledWith("newsim");
    d.ui.toast("t", "info");
    expect(app.ui.toast).toHaveBeenCalledWith("t", "info");
    d.ui.downloadFile("f.json", "body");
    expect(app.ui.downloadFile).toHaveBeenCalledWith("f.json", "body");
    d.ui.showImportReport("r", "cb");
    expect(app.ui.showImportReport).toHaveBeenCalledWith("r", "cb");
    d.ui.showExportReport("r", "cb");
    expect(app.ui.showExportReport).toHaveBeenCalledWith("r", "cb");
    // Crash screen: the dep forwards the app context (version) and its own
    // getSim, and reports the crash to analytics with its flattened description.
    const crashSpy = vi.spyOn(gameplaySession, "noteCrash");
    d.showCrashScreen({
      crash: { kind: "webgl-context-lost", repeat: false, saveFlushed: true, behindSplash: false, recoveryFailed: false },
      error: "boom",
    });
    expect(showCrashScreen).toHaveBeenCalledWith(expect.objectContaining({ error: "boom", version: APP_VERSION }));
    expect(crashSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "webgl-context-lost",
        repeat: false,
        version: APP_VERSION,
        star: 3,
        population: 800,
      }),
    );
    crashSpy.mockRestore();
    // Graphics recovery: the mocked attemptContextRecovery drives onRestored,
    // the unsubscribe it returns, and rebuild.
    const done = vi.fn();
    d.attemptGraphicsRecovery(done);
    expect(attemptContextRecovery).toHaveBeenCalled();
    expect(rebuildEngine).toHaveBeenCalledWith(app);
    expect(done).toHaveBeenCalled();
    d.armOnboarding();
    expect(app.onboarding.arm).toHaveBeenCalledWith(app.sim);
  });

  it("hands KeyboardPlay closures that reach the live app", () => {
    const app = makeWiringApp();
    wireControllers(app);
    const d = mocks.deps.keyboard as Record<string, (...a: unknown[]) => unknown> & {
      ui: Record<string, (...a: unknown[]) => unknown>;
    };
    expect(d.getSim()).toBe(app.sim);
    expect(d.engine()).toBe(app.engine);
    d.ui.toast("t", "info");
    expect(app.ui.toast).toHaveBeenCalledWith("t", "info");
    expect(d.tool()).toBe("build");
    d.isTransportTool();
    expect(app.isTransportTool).toHaveBeenCalled();
    d.announce("m");
    expect(app.announce).toHaveBeenCalledWith("m");
    d.pickedAt(3, 4);
    expect(app.pickedAt).toHaveBeenCalledWith(3, 4);
    d.selectPicked("p");
    expect(app.selectPicked).toHaveBeenCalledWith("p");
    d.placeSimpleBuild("kind", 1, 2);
    expect(app.placeSimpleBuild).toHaveBeenCalledWith("kind", 1, 2);
    d.updateBuildPreview(1, 2);
    expect(app.updateBuildPreview).toHaveBeenCalledWith(1, 2);
    d.captureUndo("l");
    expect(app.captureUndo).toHaveBeenCalledWith("l");
    d.commitUndo();
    expect(app.commitUndo).toHaveBeenCalled();
  });
});

describe("runBootFlow", () => {
  function makeApp(over: Partial<Record<string, unknown>> = {}): GameApp {
    return {
      mobileMq: { matches: false },
      audio: { sfx: vi.fn(), setProgram: vi.fn() },
      setSpeed: vi.fn(),
      ui: { toast: vi.fn(), newTowerModal: vi.fn(), showHelp: vi.fn() },
      // The boot snapshot (gameplaySession.noteBoot) reads these off the live
      // sim; stub the shape so runBootFlow's snapshot call doesn't throw.
      sim: { emit: vi.fn(), mode: "classic", star: 1, population: 0, tower: { highestFloor: 1 } },
      saveLoad: { autosave: vi.fn(), newGame: vi.fn() },
      hadReadableSave: false,
      saveWasCorrupt: false,
      ...over,
    } as unknown as GameApp;
  }

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

  it("takes the resume path after an update reload (setSpeed(0) + Updated toast, no splash)", () => {
    sessionStorage.setItem(RESUME_AFTER_UPDATE_KEY, String(Date.now()));
    const app = makeApp({ hadReadableSave: true });

    runBootFlow(app);

    expect(app.setSpeed).toHaveBeenCalledWith(0);
    expect(app.ui.toast).toHaveBeenCalledWith(expect.stringContaining("Updated"), "info");
    expect(app.onboarding.showSplash).not.toHaveBeenCalled();
    // The update flag is consumed.
    expect(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY)).toBeNull();
  });

  it("takes the resume path after a recovery reload (Welcome back toast)", () => {
    sessionStorage.setItem(RESUME_AFTER_RECOVERY_KEY, String(Date.now()));
    const app = makeApp({ hadReadableSave: true });

    runBootFlow(app);

    expect(app.setSpeed).toHaveBeenCalledWith(0);
    expect(app.ui.toast).toHaveBeenCalledWith(expect.stringContaining("Welcome back"), "info");
    expect(app.onboarding.showSplash).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RESUME_AFTER_RECOVERY_KEY)).toBeNull();
  });

  it("shows the splash on a cold boot (no resume flags), passing hasSave", () => {
    const app = makeApp({ hadReadableSave: true });

    runBootFlow(app);

    expect(app.onboarding.showSplash).toHaveBeenCalledTimes(1);
    const arg = (app.onboarding.showSplash as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.hasSave).toBe(true);
  });

  it("removes the static boot cover once the boot screen is decided (both paths)", () => {
    // Splash path: the cover comes down so the identical title sky underneath
    // (the mounted splash) shows through.
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    runBootFlow(makeApp({ hadReadableSave: false }));
    expect(document.getElementById("boot-cover")).toBeNull();

    // Resume path: same removal, uncovering the resumed tower.
    document.body.innerHTML = `<div id="boot-cover"></div>`;
    sessionStorage.setItem(RESUME_AFTER_UPDATE_KEY, String(Date.now()));
    runBootFlow(makeApp({ hadReadableSave: true }));
    expect(document.getElementById("boot-cover")).toBeNull();
  });

  it("wires the onboarding + splash callbacks back to the app", () => {
    const app = makeApp({ hadReadableSave: true });
    runBootFlow(app);

    // OnboardingController options: each callback routes to the matching app
    // collaborator (pause/resume, splash chime, music program, help).
    const opts = (
      app.onboarding as unknown as {
        opts: {
          showHelp: () => void;
          pauseForSplash: (p: boolean) => void;
          chime: () => void;
          setMusicProgram: (onSplash: boolean) => void;
        };
      }
    ).opts;
    opts.showHelp();
    expect(app.ui.showHelp).toHaveBeenCalled();
    opts.pauseForSplash(true);
    expect(app.setSpeed).toHaveBeenCalledWith(0);
    opts.pauseForSplash(false);
    expect(app.setSpeed).toHaveBeenCalledWith(1);
    opts.chime();
    expect(app.audio.sfx).toHaveBeenCalledWith("promote");
    opts.setMusicProgram(true);
    expect(app.audio.setProgram).toHaveBeenCalledWith("splash");
    opts.setMusicProgram(false);
    expect(app.audio.setProgram).toHaveBeenCalledWith("game");

    // Splash callbacks: Continue re-pauses and greets; New Tower opens the
    // rule-set modal, whose onFound dismisses the splash and starts a new game.
    const splashArg = (app.onboarding.showSplash as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    splashArg.onContinue();
    expect(app.setSpeed).toHaveBeenCalledWith(0);
    expect(app.ui.toast).toHaveBeenCalledWith(expect.stringContaining("Welcome back"), "info");

    const dismiss = vi.fn();
    splashArg.onNewTower(dismiss);
    expect(app.ui.newTowerModal).toHaveBeenCalledTimes(1);
    const modalArg = (app.ui.newTowerModal as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(modalArg.hasSave).toBe(true);
    modalArg.onFound("modern", "canon", true);
    expect(dismiss).toHaveBeenCalled();
    expect(app.saveLoad.newGame).toHaveBeenCalledWith("modern", "canon", true);
  });

  it("splashes (never resumes) when a resume flag lands on an unreadable save", () => {
    sessionStorage.setItem(RESUME_AFTER_UPDATE_KEY, String(Date.now()));
    const app = makeApp({ hadReadableSave: false });

    runBootFlow(app);

    expect(app.onboarding.showSplash).toHaveBeenCalledTimes(1);
    const arg = (app.onboarding.showSplash as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.hasSave).toBe(false);
  });

  it("emits the older-save bulletin when a corrupt autosave sat over a readable tower", () => {
    const app = makeApp({ hadReadableSave: true, saveWasCorrupt: true });

    runBootFlow(app);

    expect(app.sim.emit).toHaveBeenCalledWith(expect.stringContaining("older saved tower"), "bad");
  });

  it("emits the fresh-start bulletin when a corrupt save had nothing behind it", () => {
    const app = makeApp({ hadReadableSave: false, saveWasCorrupt: true });

    runBootFlow(app);

    expect(app.sim.emit).toHaveBeenCalledWith(expect.stringContaining("Starting a new tower"), "bad");
  });

  it("starts the autosave timer, which autosaves when no splash is up", () => {
    const app = makeApp({ hadReadableSave: true, saveWasCorrupt: false });

    runBootFlow(app);
    // No #splash element in the DOM, so the interval fires an autosave.
    vi.advanceTimersByTime(30000);

    expect((app.saveLoad.autosave as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("skips autosave while the splash is up", () => {
    document.body.innerHTML = `<div id="splash"></div>`;
    const app = makeApp({ hadReadableSave: true });

    runBootFlow(app);
    vi.advanceTimersByTime(30000);

    expect((app.saveLoad.autosave as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("bootReason", () => {
  const flags = {
    justUpdated: false,
    justRecovered: false,
    hadReadableSave: false,
    saveWasCorrupt: false,
  };

  it("prioritizes update over recovery, corrupt, and a readable save", () => {
    expect(
      bootReason({ justUpdated: true, justRecovered: true, hadReadableSave: true, saveWasCorrupt: true }),
    ).toBe("update");
  });

  it("reports recovery for the WebGL-loss auto-reload", () => {
    expect(bootReason({ ...flags, justRecovered: true, hadReadableSave: true })).toBe("recovery");
  });

  it("reports corrupt when a save existed but could not be read", () => {
    expect(bootReason({ ...flags, saveWasCorrupt: true })).toBe("corrupt");
  });

  it("reports corrupt (not update) when an update reload lands on an unreadable save", () => {
    // A save-format-breaking update: the reload sets justUpdated, but the new
    // build can't read the old save, so the player got the splash + corrupt
    // message. The outcome (corrupt) wins over the trigger, mirroring resolveBootScreen.
    expect(
      bootReason({ justUpdated: true, justRecovered: false, hadReadableSave: false, saveWasCorrupt: true }),
    ).toBe("corrupt");
  });

  it("reports continue for a readable save resumed", () => {
    expect(bootReason({ ...flags, hadReadableSave: true })).toBe("continue");
  });

  it("reports fresh for a first-time boot with no save", () => {
    expect(bootReason(flags)).toBe("fresh");
  });
});
