import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics";
import { gameplaySession, setCommonProps, startGameplaySession } from "./analytics";

// The custom-event channel is host-gated and best-effort; stub the whole vendor
// surface so the gate, the dedup, and the never-throw guarantee can be asserted
// without touching the real Vercel endpoints. The adapter imports both vendor
// symbols (`track` and `inject`) plus Speed Insights from one module, so every
// telemetry test mocks all of them: a partial mock would leave the sibling
// symbol `undefined`, and a later test driving that path would throw into the
// best-effort catch and silently drop the event.
vi.mock("@vercel/analytics", () => ({ track: vi.fn(), inject: vi.fn() }));
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
// The active adapter dual-writes to the PostHog relay too (S3); stub it so these
// tests assert the Vercel `track` contract without a real beacon firing.
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

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

  it("fires no event on a non-deployed host (localhost, e2e preview, native shell)", () => {
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

  it("arm claims the listener wiring exactly once until reset", () => {
    expect(gameplaySession.arm()).toBe(true); // first start wires listeners
    expect(gameplaySession.arm()).toBe(false); // a repeat start is a no-op
    gameplaySession.reset();
    expect(gameplaySession.arm()).toBe(true); // reset re-opens it (for tests)
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

describe("common event enrichment (S4)", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(track).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
    setVisibility("visible");
  });

  it("merges the boot-set common props into every event", () => {
    setCommonProps({ platform: "twa", returning: true, tenure: "d7-29", recency: "7d" });
    gameplaySession.noteNewGame("modern");
    gameplaySession.noteStar(3);
    expect(track).toHaveBeenNthCalledWith(1, "game_started", {
      platform: "twa",
      returning: true,
      tenure: "d7-29",
      recency: "7d",
      mode: "modern",
    });
    expect(track).toHaveBeenNthCalledWith(2, "star_reached", {
      platform: "twa",
      returning: true,
      tenure: "d7-29",
      recency: "7d",
      star: 3,
    });
  });

  it("lets a per-event prop win over a common prop on a key collision", () => {
    // The typed vocabulary must never be shadowed by an enrichment key: event
    // props are spread last.
    setCommonProps({ mode: "should-be-overridden" });
    gameplaySession.noteNewGame("classic");
    expect(track).toHaveBeenCalledWith("game_started", { mode: "classic" });
  });

  it("clears the common props on reset, so a later event carries none", () => {
    setCommonProps({ platform: "ios" });
    gameplaySession.reset();
    gameplaySession.noteStar(2);
    expect(track).toHaveBeenCalledWith("star_reached", { star: 2 });
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

  it("emits build volume, peak floor, and per-tool depth at session end", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 5, 2); // 2 placements, floor 5
    gameplaySession.noteBuild("floor", 3, 1); // 1 placement, floor 3
    vi.setSystemTime(4000);
    gameplaySession.end();
    expect(track).toHaveBeenCalledWith("session_builds", { builds: 3 });
    expect(track).toHaveBeenCalledWith("session_peak_floors", { floors: 5 });
    expect(track).toHaveBeenCalledWith("tool_session_uses", { tool: "office", uses: 2 });
    expect(track).toHaveBeenCalledWith("tool_session_uses", { tool: "floor", uses: 1 });
  });

  it("emits no depth events when nothing was built", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    vi.setSystemTime(3000);
    gameplaySession.end();
    expect(track).toHaveBeenCalledWith("session_end", { seconds: 3 });
    expect(track).not.toHaveBeenCalledWith("session_builds", expect.anything());
    expect(track).not.toHaveBeenCalledWith("tool_session_uses", expect.anything());
  });

  it("emits depth only once even when the tab is hidden repeatedly", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 5, 2);
    vi.setSystemTime(3000);
    gameplaySession.end(); // first background: depth emitted (builds so far)
    gameplaySession.begin();
    gameplaySession.noteBuild("floor", 3, 1); // more play after returning
    vi.setSystemTime(9000);
    gameplaySession.end(); // second background: session_end again, depth NOT re-emitted
    const buildsCalls = vi.mocked(track).mock.calls.filter(([name]) => name === "session_builds");
    expect(buildsCalls).toHaveLength(1);
    expect(buildsCalls[0][1]).toEqual({ builds: 2 }); // the value at first background
  });

  it("reports a negative peak floor for a basement-only session", () => {
    vi.setSystemTime(0);
    gameplaySession.begin();
    gameplaySession.noteBuild("parking", -5, 1); // built underground (B6)
    vi.setSystemTime(2000);
    gameplaySession.end();
    expect(track).toHaveBeenCalledWith("session_peak_floors", { floors: -5 });
  });

  it("still records depth when the session ends within the first rounded second", () => {
    // A build-and-close under 0.5s foreground rounds to 0 == lastReportedSec, so
    // session_end is deduped away. Depth must still emit (it is latched
    // separately and runs before the dedup), or fast sessions vanish from depth.
    vi.setSystemTime(0);
    gameplaySession.begin();
    gameplaySession.noteBuild("office", 5, 2);
    vi.setSystemTime(300); // 0.3s -> rounds to 0
    gameplaySession.end();
    expect(track).not.toHaveBeenCalledWith("session_end", expect.anything());
    expect(track).toHaveBeenCalledWith("session_builds", { builds: 2 });
    expect(track).toHaveBeenCalledWith("session_peak_floors", { floors: 5 });
    expect(track).toHaveBeenCalledWith("tool_session_uses", { tool: "office", uses: 2 });
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

  it("arms nothing on a non-deployed host (localhost)", () => {
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

  it("does not count time before the page first becomes visible", () => {
    window.location.href = prod;
    setVisibility("hidden"); // opened in a background tab / prerendered
    vi.setSystemTime(0);
    startGameplaySession(); // must not begin timing while hidden
    vi.setSystemTime(5000);
    setVisibility("visible"); // player focuses the tab at 5s
    document.dispatchEvent(new Event("visibilitychange"));
    vi.setSystemTime(8000);
    setVisibility("hidden"); // leaves at 8s: only 3s of foreground play
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
