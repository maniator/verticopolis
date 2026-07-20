import { afterEach, describe, expect, it, vi } from "vitest";
import { injectVercelTelemetry } from "./telemetry";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { inject as injectWebAnalytics } from "@vercel/analytics";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));

/**
 * The shared, host-gated Vercel telemetry inject. It is called the same way by
 * the game boot, the sprite gallery, and the standalone /help page, so every
 * deployed page reports Core Web Vitals and page views only where the Vercel
 * endpoints exist (production + preview) and never throws past its caller.
 */
describe("injectVercelTelemetry host gate", () => {
  const localhost = "http://localhost:3000/";

  afterEach(() => {
    vi.mocked(injectSpeedInsights).mockReset();
    vi.mocked(injectWebAnalytics).mockReset();
    window.location.href = localhost;
  });

  it("injects on the production host", () => {
    window.location.href = "https://verticopolis.com/";
    injectVercelTelemetry();
    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("injects on a Vercel preview host too", () => {
    window.location.href = "https://feature-branch.vercel.app/";
    injectVercelTelemetry();
    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("skips on any other host (localhost, preview server, native shell)", () => {
    window.location.href = localhost;
    injectVercelTelemetry();
    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("does not name a bare hostname that merely contains the production domain", () => {
    // The gate is an exact match on verticopolis.com plus a .vercel.app suffix,
    // so a look-alike host (a phishing mirror, a staging alias) gets no inject.
    window.location.href = "https://verticopolis.com.evil.example/";
    injectVercelTelemetry();
    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("never lets a telemetry failure throw past the caller", () => {
    window.location.href = "https://verticopolis.com/";
    vi.mocked(injectSpeedInsights).mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });
    expect(() => injectVercelTelemetry()).not.toThrow();
  });
});
