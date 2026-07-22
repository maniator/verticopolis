import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track, inject as injectWebAnalytics } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import {
  analyticsAdapter,
  setAnalyticsAdapter,
  vercelAdapter,
  type AnalyticsAdapter,
  type EventProps,
} from "./analyticsAdapter";
import { gameplaySession } from "./analytics";
import { injectVercelTelemetry } from "./telemetry";

// Keep the real Vercel SDK inert so this file can assert that a swapped-in stub
// takes over the whole surface: under the stub, none of these vendor calls fire.
vi.mock("@vercel/analytics", () => ({ track: vi.fn(), inject: vi.fn() }));
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

/** A test adapter that records every wire call instead of reaching a vendor. */
function makeStub(): AnalyticsAdapter & {
  readonly events: Array<[string, EventProps]>;
  injects: number;
} {
  const events: Array<[string, EventProps]> = [];
  return {
    events,
    injects: 0,
    send(event, props) {
      events.push([event, props]);
    },
    injectPageTelemetry() {
      this.injects += 1;
    },
  };
}

describe("analytics adapter seam", () => {
  let restore: AnalyticsAdapter;
  let stub: ReturnType<typeof makeStub>;

  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(track).mockReset();
    vi.mocked(injectWebAnalytics).mockReset();
    vi.mocked(injectSpeedInsights).mockReset();
    stub = makeStub();
    restore = setAnalyticsAdapter(stub);
  });

  afterEach(() => {
    setAnalyticsAdapter(restore);
    window.location.href = localhost;
  });

  it("defaults to the Vercel adapter until one is swapped in", () => {
    // The swap in beforeEach handed back the adapter that was active before it,
    // which is the module's production default.
    expect(restore).toBe(vercelAdapter);
  });

  it("routes the active adapter through the accessor", () => {
    expect(analyticsAdapter()).toBe(stub);
  });

  it("rejects a malformed adapter at swap time instead of silently killing telemetry", () => {
    expect(() => setAnalyticsAdapter(null as unknown as AnalyticsAdapter)).toThrow(TypeError);
    expect(() => setAnalyticsAdapter({} as AnalyticsAdapter)).toThrow(TypeError);
    // The rejected installs left the active adapter untouched (the guard runs
    // before the assignment), so telemetry still routes to the stub.
    expect(analyticsAdapter()).toBe(stub);
  });

  it("drives the whole gameplay vocabulary through the stub, never the vendor", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      gameplaySession.begin();
      gameplaySession.noteBoot({
        reason: "continue",
        version: "1.77.0",
        mode: "modern",
        star: 4,
        floors: 42,
        population: 1200,
      });
      gameplaySession.noteNewGame("modern");
      gameplaySession.noteBuild("office", 5, 2); // first_build + depth counting
      gameplaySession.noteToolUsed("elevator");
      gameplaySession.noteStar(3);
      gameplaySession.noteCrash({
        kind: "webgl-context-lost",
        repeat: false,
        recoveryFailed: false,
        saveFlushed: true,
        behindSplash: false,
        version: "1.77.0",
        star: 4,
        population: 1200,
      });
      gameplaySession.noteUpdate("1.76.0", "1.77.0");
      vi.setSystemTime(5000);
      gameplaySession.end(); // session depth + session_end
    } finally {
      vi.useRealTimers();
    }

    const names = stub.events.map(([name]) => name);
    // Every event in the typed vocabulary reached the stub, in the order fired.
    expect(names).toEqual([
      "boot",
      "game_started",
      "first_build",
      "tool_used",
      "star_reached",
      "crash",
      "update",
      "session_builds",
      "session_peak_floors",
      "tool_session_uses",
      "session_end",
    ]);
    // Props ride through untouched (spot-check across the vocabulary).
    const byName = new Map(stub.events);
    expect(byName.get("game_started")).toEqual({ mode: "modern" });
    expect(byName.get("first_build")).toEqual({ tool: "office" });
    expect(byName.get("star_reached")).toEqual({ star: 3 });
    expect(byName.get("session_builds")).toEqual({ builds: 2 });
    expect(byName.get("session_peak_floors")).toEqual({ floors: 5 });
    expect(byName.get("tool_session_uses")).toEqual({ tool: "office", uses: 2 });
    expect(byName.get("session_end")).toEqual({ seconds: 5 });
    // The whole point of the seam: swapping the adapter took the vendor out.
    expect(track).not.toHaveBeenCalled();
  });

  it("routes the page-view inject through the active adapter, not the vendor", () => {
    injectVercelTelemetry();
    expect(stub.injects).toBe(1);
    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("restores the vendor adapter cleanly, re-reaching the Vercel transport", () => {
    setAnalyticsAdapter(restore); // put the production adapter back
    gameplaySession.noteStar(5);
    injectVercelTelemetry();
    // With the vendor adapter active again, the real transport is reached and the
    // stub sees nothing more.
    expect(track).toHaveBeenCalledWith("star_reached", { star: 5 });
    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
    // Byte-identical to the pre-seam call: Speed Insights injects before Web
    // Analytics. Locking the order guards against a future reorder in the adapter.
    expect(vi.mocked(injectSpeedInsights).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(injectWebAnalytics).mock.invocationCallOrder[0],
    );
    expect(stub.events.some(([name]) => name === "star_reached")).toBe(false);
  });
});
