import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession, trackAppAction, trackAppActionOnce } from "./analytics";

// app_action is the parametrized app-chrome event (save/export/import/dialog
// opens/toggles/page landings). Stub the vendor surface like the sibling
// analytics suites so the host gate, the merge, and the once-per-session latch
// can be asserted without a real beacon.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

describe("app_action telemetry", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset(); // clears the once-per-session latch too
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("reports app_action with just the action when no detail is given", () => {
    trackAppAction("quick_save");
    expect(sendToRelay).toHaveBeenCalledWith("app_action", { action: "quick_save" });
  });

  it("includes the detail dimension when given", () => {
    trackAppAction("mute", "on");
    expect(sendToRelay).toHaveBeenCalledWith("app_action", { action: "mute", detail: "on" });
  });

  it("is host-gated: nothing fires on a non-deployed host", () => {
    window.location.href = localhost;
    trackAppAction("export_save");
    trackAppAction("page_help");
    expect(sendToRelay).not.toHaveBeenCalled();
  });

  it("latches trackAppActionOnce to a single emission per session", () => {
    trackAppActionOnce("volume");
    trackAppActionOnce("volume");
    trackAppActionOnce("volume");
    const volumeCalls = vi.mocked(sendToRelay).mock.calls.filter(([name, props]) => name === "app_action" && (props as { action?: string }).action === "volume");
    expect(volumeCalls).toHaveLength(1);
  });

  it("latches each action independently", () => {
    trackAppActionOnce("volume");
    trackAppActionOnce("mute", "on");
    expect(sendToRelay).toHaveBeenCalledTimes(2); // two distinct latched actions
    expect(sendToRelay).toHaveBeenCalledWith("app_action", { action: "mute", detail: "on" });
  });

  it("the reset test-helper clears the once-per-session latch (test isolation)", () => {
    // In production the latch lives for the tab (reset is test-only), so this
    // pins that reset() clears it so each test starts clean.
    trackAppActionOnce("volume");
    gameplaySession.reset();
    window.location.href = prod; // reset does not touch the host
    trackAppActionOnce("volume");
    const volumeCalls = vi.mocked(sendToRelay).mock.calls.filter(([name, props]) => name === "app_action" && (props as { action?: string }).action === "volume");
    expect(volumeCalls).toHaveLength(2); // once before reset, once after
  });
});
