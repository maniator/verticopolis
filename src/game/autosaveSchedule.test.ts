import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startAutosave, AUTOSAVE_INTERVAL_MS } from "./autosaveSchedule";
import { isEngineStopped, isSplashUp } from "./interactionState";

vi.mock("./interactionState", () => ({ isEngineStopped: vi.fn(() => false), isSplashUp: vi.fn(() => false) }));

describe("startAutosave", () => {
  const autosave = vi.fn(() => Promise.resolve());
  const save = vi.fn((_silent?: boolean) => {});
  let listener: EventListener | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    autosave.mockClear();
    save.mockReset();
    vi.mocked(isSplashUp).mockReturnValue(false);
    vi.mocked(isEngineStopped).mockReturnValue(false);
    // Capture this call's listener so earlier tests' listeners cannot fire.
    vi.spyOn(document, "addEventListener").mockImplementation((type, fn) => {
      if (type === "visibilitychange") listener = fn as EventListener;
    });
    startAutosave({ autosave, save });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const setVisibility = (state: DocumentVisibilityState) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    listener!(new Event("visibilitychange"));
  };

  it("autosaves on every tick", () => {
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 2);
    expect(autosave).toHaveBeenCalledTimes(2);
  });

  it("saves synchronously when the tab goes to the background, and not when it comes back", () => {
    setVisibility("visible");
    expect(save).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(save).toHaveBeenCalledExactlyOnceWith(true);
    expect(autosave).not.toHaveBeenCalled();
  });

  it("lets a failed hidden-tab save pass without an uncaught error", () => {
    save.mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => setVisibility("hidden")).not.toThrow();
  });

  it("saves nothing while the first-run splash is up, on a tick or a hidden tab", () => {
    vi.mocked(isSplashUp).mockReturnValue(true);
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    setVisibility("hidden");
    expect(autosave).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("saves nothing once the game stopped on its engine, on a tick or a hidden tab", () => {
    vi.mocked(isEngineStopped).mockReturnValue(true);
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    setVisibility("hidden");
    expect(autosave).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
