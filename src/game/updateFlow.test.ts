import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GameApp } from "../main";
import {
  RESUME_AFTER_UPDATE_KEY,
  RESUME_RELOAD_MAX_AGE_MS,
  onUpdateAvailable,
  updateCoastClear,
  maybeSurfaceUpdatePrompt,
  showUpdatePrompt,
} from "./updateFlow";

/**
 * Colocated unit tests for the PWA update-prompt flow. Every function is a free
 * function over `GameApp`; here `app` is a hand-built fake carrying only the
 * latch fields and the ui/saveLoad ports the flow touches.
 */

/** Captured args of the last `ui.showUpdatePrompt(now, later, info)` call so the
 *  two decision callbacks can be exercised directly. */
type PromptCbs = { now: () => Promise<void> | void; later: () => void; info: unknown };

function makeApp(over: Partial<Record<string, unknown>> = {}) {
  const captured: { last?: PromptCbs } = {};
  const showUpdateChip = vi.fn();
  const isModalOpen = vi.fn(() => false);
  const showUpdatePrompt = vi.fn((now: PromptCbs["now"], later: PromptCbs["later"], info: unknown) => {
    captured.last = { now, later, info };
  });
  const toast = vi.fn();
  const saveBeforeUpdate = vi.fn();
  const save = vi.fn();
  const app = {
    pendingUpdate: null as unknown,
    pendingUpdateInfo: null as unknown,
    updatePromptShown: false,
    shownUpdate: false,
    shownChoice: false,
    transportStart: null as unknown,
    ui: { showUpdateChip, isModalOpen, showUpdatePrompt, toast },
    saveLoad: { saveBeforeUpdate, save },
    ...over,
  };
  return { app: app as unknown as GameApp, raw: app, captured, showUpdateChip, uiShowPrompt: showUpdatePrompt, toast, saveBeforeUpdate, save, isModalOpen };
}

/** A fake app already in the "coast is clear" state: a pending update waiting,
 *  nothing else owning the screen. */
function clearApp() {
  return makeApp({ pendingUpdate: vi.fn(async () => {}) });
}

beforeEach(() => {
  sessionStorage.clear();
  document.getElementById("splash")?.remove();
});

describe("constants", () => {
  it("exposes the resume key and the resume window", () => {
    expect(RESUME_AFTER_UPDATE_KEY).toBe("vc-resume-after-update");
    expect(RESUME_RELOAD_MAX_AGE_MS).toBe(30_000);
  });
});

describe("onUpdateAvailable", () => {
  it("latches the activation + info, re-arms the auto-pop, and reveals the chip", () => {
    const { app, raw, showUpdateChip } = makeApp({ updatePromptShown: true });
    const activate = vi.fn(async () => {});
    const info = { version: "9.9.9" };
    onUpdateAvailable(app, activate, info as never);
    expect(raw.pendingUpdate).toBe(activate);
    expect(raw.pendingUpdateInfo).toBe(info);
    expect(raw.updatePromptShown).toBe(false);
    expect(showUpdateChip).toHaveBeenCalledTimes(1);
    expect(typeof showUpdateChip.mock.calls[0][0]).toBe("function");
  });

  it("defaults missing info to null", () => {
    const { app, raw } = makeApp();
    onUpdateAvailable(app, vi.fn(async () => {}));
    expect(raw.pendingUpdateInfo).toBeNull();
  });
});

describe("updateCoastClear", () => {
  it("is true when a build is pending and nothing owns the screen", () => {
    expect(updateCoastClear(clearApp().app)).toBe(true);
  });

  it("is false with no pending update", () => {
    expect(updateCoastClear(makeApp({ pendingUpdate: null }).app)).toBe(false);
  });

  it("is false when any single blocker is set", () => {
    for (const blocker of ["shownUpdate", "shownChoice", "transportStart"] as const) {
      const { app } = clearApp();
      (app as unknown as Record<string, unknown>)[blocker] = true;
      expect(updateCoastClear(app), blocker).toBe(false);
    }
  });

  it("is false while a modal is open", () => {
    const { app, isModalOpen } = clearApp();
    isModalOpen.mockReturnValue(true);
    expect(updateCoastClear(app)).toBe(false);
  });

  it("is false while a #splash element is in the DOM", () => {
    const { app } = clearApp();
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    expect(updateCoastClear(app)).toBe(false);
    splash.remove();
    expect(updateCoastClear(app)).toBe(true);
  });
});

describe("maybeSurfaceUpdatePrompt", () => {
  it("no-ops when the prompt was already surfaced this build", () => {
    const { app, uiShowPrompt } = clearApp();
    app.updatePromptShown = true;
    maybeSurfaceUpdatePrompt(app);
    expect(uiShowPrompt).not.toHaveBeenCalled();
  });

  it("no-ops when the coast is not clear", () => {
    const { app, uiShowPrompt } = makeApp({ pendingUpdate: null });
    maybeSurfaceUpdatePrompt(app);
    expect(uiShowPrompt).not.toHaveBeenCalled();
  });

  it("opens the prompt when clear and not yet shown", () => {
    const { app, raw, uiShowPrompt } = clearApp();
    maybeSurfaceUpdatePrompt(app);
    expect(uiShowPrompt).toHaveBeenCalledTimes(1);
    expect(raw.shownUpdate).toBe(true);
    expect(raw.updatePromptShown).toBe(true);
  });
});

describe("showUpdatePrompt", () => {
  it("no-ops unless the coast is clear", () => {
    const { app, uiShowPrompt } = makeApp({ pendingUpdate: null });
    showUpdatePrompt(app);
    expect(uiShowPrompt).not.toHaveBeenCalled();
  });

  it("freezes the sim, marks the prompt shown, and forwards the pending info", () => {
    const info = { version: "1.2.3" };
    const { app, raw, uiShowPrompt, captured } = makeApp({
      pendingUpdate: vi.fn(async () => {}),
      pendingUpdateInfo: info,
    });
    showUpdatePrompt(app);
    expect(raw.updatePromptShown).toBe(true);
    expect(raw.shownUpdate).toBe(true);
    expect(uiShowPrompt).toHaveBeenCalledTimes(1);
    expect(captured.last!.info).toBe(info);
  });

  describe('"update now" callback', () => {
    it("saves first, stamps the resume key, unfreezes, and awaits activate", async () => {
      const activate = vi.fn(async () => {});
      const { app, raw, captured, saveBeforeUpdate } = makeApp({ pendingUpdate: activate });
      showUpdatePrompt(app);
      await captured.last!.now();
      expect(saveBeforeUpdate).toHaveBeenCalledTimes(1);
      expect(raw.shownUpdate).toBe(false);
      expect(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY)).not.toBeNull();
      expect(activate).toHaveBeenCalledTimes(1);
    });

    it("save-fails branch: toasts, unfreezes, does NOT stamp or activate", async () => {
      const activate = vi.fn(async () => {});
      const { app, raw, captured, saveBeforeUpdate, toast } = makeApp({ pendingUpdate: activate });
      saveBeforeUpdate.mockImplementation(() => {
        throw new Error("disk full");
      });
      showUpdatePrompt(app);
      await captured.last!.now();
      expect(raw.shownUpdate).toBe(false);
      expect(toast).toHaveBeenCalledWith("Couldn't save your tower. Update paused. Try again.", "bad");
      expect(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY)).toBeNull();
      expect(activate).not.toHaveBeenCalled();
    });

    it("activate-fails branch: clears the resume flag and toasts a retry", async () => {
      const activate = vi.fn(async () => {
        throw new Error("worker hiccup");
      });
      const { app, captured, toast } = makeApp({ pendingUpdate: activate });
      showUpdatePrompt(app);
      await captured.last!.now();
      expect(activate).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY)).toBeNull();
      expect(toast).toHaveBeenCalledWith("Update couldn't be applied. Try again.", "bad");
    });
  });

  describe('"later" callback', () => {
    it("unfreezes, keeps the prompt marked shown, and resets the autosave baseline", () => {
      const { app, raw, captured, save } = makeApp({ pendingUpdate: vi.fn(async () => {}) });
      showUpdatePrompt(app);
      raw.shownUpdate = true; // re-arm to prove the callback unfreezes
      captured.last!.later();
      expect(raw.shownUpdate).toBe(false);
      expect(raw.updatePromptShown).toBe(true);
      expect(save).toHaveBeenCalledWith(true);
    });

    it("swallows a failed baseline save", () => {
      const { app, captured, save } = makeApp({ pendingUpdate: vi.fn(async () => {}) });
      save.mockImplementation(() => {
        throw new Error("save failed");
      });
      showUpdatePrompt(app);
      expect(() => captured.last!.later()).not.toThrow();
    });
  });
});
