import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadFromSlot, loadFromSplash } from "./appModals";
import { SaveGame } from "../storage/SaveGame";
import { makeApp, makeSim } from "./appModals.fixture";
import { trackAppAction } from "../analytics";
import { NEWER_SAVE_REFUSAL } from "./portLifecycle";

/**
 * These pin the Auto-save loads against the hand-built fake `GameApp`
 * (`appModals.fixture.ts`). `SaveGame` is fully mocked (no storage, no
 * compression). The stats screen and the exterminator are in
 * `appModalsStats.test.ts`.
 */

vi.mock("../analytics", async (importActual) => {
  const actual = await importActual<typeof import("../analytics")>();
  return { ...actual, trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() };
});

vi.mock("../storage/SaveGame", async (importActual) => {
  const actual = await importActual<typeof import("../storage/SaveGame")>();
  return { ...actual, SaveGame: { load: vi.fn() } };
});

beforeEach(() => {
  vi.mocked(SaveGame.load).mockReset();
  vi.mocked(trackAppAction).mockClear();
});

describe("loadFromSlot", () => {
  it("reads the autosave via load(), adopts it and toasts", () => {
    const loaded = "AUTO";
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load(loaded));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    loadFromSlot(app, "auto");
    expect(SaveGame.load).toHaveBeenCalledTimes(1);
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Tower loaded.", "good");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_slot");
  });

  it("toasts failure and does not adopt on an empty or damaged Auto-save", () => {
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load("BAD"));
    const { app, ui, followSwap } = makeApp(makeSim());
    loadFromSlot(app, "auto");
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("The Auto-save is empty or damaged.", "bad");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });
});

describe("loadFromSlot with a save from a newer version", () => {
  it("says to update the game, and does not adopt the tower", () => {
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load("BAD"));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    (enginePort as { lastReason: () => string | undefined }).lastReason = () => NEWER_SAVE_REFUSAL;
    loadFromSlot(app, "auto");
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(NEWER_SAVE_REFUSAL, "bad");
  });

  it("keeps the empty-or-damaged copy when the Auto-save held nothing to try, whatever the engine last refused", () => {
    vi.mocked(SaveGame.load).mockReturnValueOnce(false);
    const { app, ui, enginePort } = makeApp(makeSim());
    (enginePort as { lastReason: () => string | undefined }).lastReason = () => NEWER_SAVE_REFUSAL;
    loadFromSlot(app, "auto");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("The Auto-save is empty or damaged.", "bad");
  });
});

/**
 * The title-screen load. It is separate from {@link loadFromSlot} because the
 * splash changes two contracts: failures must not toast (the title screen
 * paints over the toast rail), and the teardown plus re-pause belong to the
 * app's `followSwap`, not here.
 */
describe("loadFromSplash", () => {
  it("adopts the tower and reports success, without toasting or re-pausing", () => {
    const loaded = "TOWER";
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load(loaded));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, "auto")).toBe(true);
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
    // followSwap owns the "Welcome back" toast and the speed-0 re-pause, so that
    // every arrival route (slot, .vctower, .TDT) behaves identically.
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it("reports failure rather than throwing when storage is blocked outright", () => {
    // The load re-reads storage, which throws when storage is blocked. An
    // escaping throw would leave the title screen with no error shown.
    vi.mocked(SaveGame.load).mockImplementationOnce(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { app, ui, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, "auto")).toBe(false);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });

  it("reports failure WITHOUT adopting or toasting, so the title screen survives", () => {
    // The caller says why where the player is looking. Adopting nothing is
    // what keeps the splash up: followSwap is the only thing that takes it down.
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load("BAD"));
    const { app, ui, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, "auto")).toBe(false);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });
});
