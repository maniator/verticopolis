import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics";
import { gameplaySession, startGameplaySession } from "./analytics";

// The custom-event channel is host-gated and best-effort; stub `track` so the
// gate, the dedup, and the never-throw guarantee can be asserted without
// touching the real Vercel endpoint.
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** Force the tab into a given visibility state (jsdom's is read-only). */
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("gameplay analytics events", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(track).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
    setVisibility("visible");
  });

  it("reports game_started, star_reached with their props on a deployed host", () => {
    gameplaySession.noteNewGame("modern");
    gameplaySession.noteStar(3);
    expect(track).toHaveBeenNthCalledWith(1, "game_started", { mode: "modern" });
    expect(track).toHaveBeenNthCalledWith(2, "star_reached", { star: 3 });
  });

  it("fires no event off a deployed host (localhost, e2e preview, native shell)", () => {
    window.location.href = localhost;
    gameplaySession.noteNewGame("classic");
    gameplaySession.noteBuild("floor");
    gameplaySession.noteToolUsed("lobby");
    gameplaySession.noteStar(2);
    gameplaySession.noteBoot({
      reason: "continue",
      version: "1.0.0",
      mode: "classic",
      star: 3,
      floors: 20,
      population: 500,
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("reports a boot snapshot with origin, version, and standing tower state", () => {
    const snapshot = {
      reason: "continue",
      version: "1.68.0",
      mode: "modern",
      star: 4,
      floors: 42,
      population: 1200,
    };
    gameplaySession.noteBoot(snapshot);
    expect(track).toHaveBeenCalledWith("boot", snapshot);
  });

  it("reports a crash with its flattened description and context", () => {
    const crash = {
      kind: "webgl-context-lost",
      repeat: true,
      recoveryFailed: true,
      saveFlushed: false,
      behindSplash: false,
      version: "1.68.0",
      star: 3,
      population: 800,
    };
    gameplaySession.noteCrash(crash);
    expect(track).toHaveBeenCalledWith("crash", crash);
  });

  it("reports an applied update as from/to versions", () => {
    gameplaySession.noteUpdate("1.68.0", "1.69.0");
    expect(track).toHaveBeenCalledWith("update", { from: "1.68.0", to: "1.69.0" });
  });

  it("fires first_build once per tower, then stays silent", () => {
    gameplaySession.noteBuild("floor");
    gameplaySession.noteBuild("office");
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("first_build", { tool: "floor" });
  });

  it("dedups tool_used per distinct tool, not per selection", () => {
    gameplaySession.noteToolUsed("office");
    gameplaySession.noteToolUsed("office"); // same tool again: silent
    gameplaySession.noteToolUsed("elevator");
    expect(track).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenNthCalledWith(1, "tool_used", { tool: "office" });
    expect(track).toHaveBeenNthCalledWith(2, "tool_used", { tool: "elevator" });
  });

  it("re-opens first_build for each newly founded tower", () => {
    gameplaySession.noteBuild("floor"); // first build of tower A
    gameplaySession.noteNewGame("modern"); // founding tower B resets the latch
    gameplaySession.noteBuild("office"); // first build of tower B fires again
    expect(track).toHaveBeenNthCalledWith(1, "first_build", { tool: "floor" });
    expect(track).toHaveBeenNthCalledWith(2, "game_started", { mode: "modern" });
    expect(track).toHaveBeenNthCalledWith(3, "first_build", { tool: "office" });
  });

  it("reset re-opens the per-session dedup latches", () => {
    gameplaySession.noteBuild("floor");
    gameplaySession.reset();
    gameplaySession.noteBuild("floor");
    expect(track).toHaveBeenCalledTimes(2);
  });

  it("never lets a track failure throw past the caller", () => {
    vi.mocked(track).mockImplementationOnce(() => {
      throw new Error("analytics down");
    });
    expect(() => gameplaySession.noteStar(4)).not.toThrow();
  });
});

describe("gameplay session length", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(track).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.location.href = localhost;
    setVisibility("visible");
  });

  it("reports whole-second length once, from begin to end", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(5400); // 5.4s -> rounds to 5
    gameplaySession.end();
    gameplaySession.end(); // a second signal must not double-count
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("session_end", { seconds: 5 });
  });

  it("does not report a session that never began", () => {
    gameplaySession.end();
    expect(track).not.toHaveBeenCalled();
  });

  it("accumulates foreground time across a hide and resume, excluding hidden time", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(3000);
    gameplaySession.end(); // hidden at 3s of play
    vi.setSystemTime(10000);
    gameplaySession.begin(); // resumed after 7s hidden (not counted)
    vi.setSystemTime(12000);
    gameplaySession.end(); // hidden again: 3s + 2s foreground
    expect(track).toHaveBeenNthCalledWith(1, "session_end", { seconds: 3 });
    expect(track).toHaveBeenNthCalledWith(2, "session_end", { seconds: 5 });
  });

  it("begin is idempotent so the clock is not reset mid-session", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(2000);
    gameplaySession.begin(); // ignored: the session already started at 0
    vi.setSystemTime(8000);
    gameplaySession.end();
    expect(track).toHaveBeenCalledWith("session_end", { seconds: 8 });
  });
});

describe("startGameplaySession wiring", () => {
  beforeEach(() => {
    gameplaySession.reset();
    vi.mocked(track).mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.location.href = localhost;
    setVisibility("visible");
  });

  it("arms nothing off a deployed host", () => {
    window.location.href = localhost;
    startGameplaySession();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(track).not.toHaveBeenCalled();
  });

  it("ends the session when the tab is hidden", () => {
    window.location.href = prod;
    vi.setSystemTime(0);
    startGameplaySession();
    vi.setSystemTime(3000);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(track).toHaveBeenCalledWith("session_end", { seconds: 3 });
  });

  it("ignores a visibilitychange that is not to hidden", () => {
    window.location.href = prod;
    startGameplaySession();
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(track).not.toHaveBeenCalled();
  });
});
