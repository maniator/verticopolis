import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectVercelTelemetry, telemetryHostAllowed } from "./telemetry";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { inject as injectWebAnalytics } from "@vercel/analytics";
import { resetDesktopConsentForTests, setDesktopConsent } from "./desktopConsent";

// The telemetry SDKs are gated on the host and best-effort; stub them so the
// gate and its catch can be asserted without touching the real endpoints.
vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ inject: vi.fn() }));

/**
 * The shared, host-gated Vercel telemetry inject. It is called the same way by
 * the game boot, the sprite gallery, and the standalone /help page, so every
 * deployed page reports Core Web Vitals and page views (the kept page-level
 * pair) only where the Vercel endpoints exist
 * (production + preview) and never throws past its caller.
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

  it("injects on a custom-suffix preview subdomain (*.preview.verticopolis.com)", () => {
    window.location.href = "https://branch.preview.verticopolis.com/";
    injectVercelTelemetry();
    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });

  it("injects on the canonical absolute FQDN (trailing dot)", () => {
    window.location.href = "https://verticopolis.com./";
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
    // The gate allows verticopolis.com, its subdomains (`.verticopolis.com`), and
    // `.vercel.app`, so a look-alike host that only ends with the wrong suffix
    // (a phishing mirror, a staging alias) gets no inject: this one ends with
    // `.evil.example`, not `.verticopolis.com`.
    window.location.href = "https://verticopolis.com.evil.example/";
    injectVercelTelemetry();
    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("does not accept a prefix-glued look-alike (the dot boundary matters)", () => {
    // The leading dot in `.verticopolis.com` is load-bearing: without it,
    // `evilverticopolis.com` would wrongly pass. This locks that boundary so a
    // future edit dropping the dot fails here instead of silently regressing.
    for (const host of ["https://evilverticopolis.com/", "https://notverticopolis.com/"]) {
      window.location.href = host;
      injectVercelTelemetry();
      expect(injectSpeedInsights).not.toHaveBeenCalled();
      expect(injectWebAnalytics).not.toHaveBeenCalled();
    }
  });

  it("never lets a telemetry failure throw past the caller", () => {
    window.location.href = "https://verticopolis.com/";
    vi.mocked(injectSpeedInsights).mockImplementationOnce(() => {
      throw new Error("telemetry down");
    });
    expect(() => injectVercelTelemetry()).not.toThrow();
  });
});

describe("telemetryHostAllowed: wrapped builds answer on the mode, never the host", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  it("stays false for the iOS shell (`native`) whatever the consent value says", () => {
    // The ruling opened DESKTOP and deliberately left iOS alone. A consent value
    // is not a way around that: `native` is closed by the mode, full stop.
    window.location.href = "https://verticopolis.com/";
    expect(telemetryHostAllowed("native")).toBe(false);
    setDesktopConsent("granted");
    expect(telemetryHostAllowed("native"), "iOS must not be opened by a desktop consent").toBe(false);
  });

  it("follows the desktop consent state in BOTH directions", () => {
    window.location.href = "https://verticopolis.com/";
    expect(telemetryHostAllowed("desktop"), "pending emits nothing").toBe(false);
    setDesktopConsent("granted");
    expect(telemetryHostAllowed("desktop")).toBe(true);
    setDesktopConsent("declined");
    expect(telemetryHostAllowed("desktop"), "declining closes it again").toBe(false);
    setDesktopConsent("granted");
    expect(telemetryHostAllowed("desktop")).toBe(true);
  });

  it("answers desktop on consent alone, on a host the list would refuse", () => {
    // The hazard from the distribution plan was a wrapper serving its bundle
    // from a host the list allows. The inverse now matters just as much: the
    // shell serves from `app://game`, a host the list refuses, and a consented
    // desktop build must still report, because it posts to an absolute URL
    // rather than to a path on whatever origin served it.
    window.location.href = "http://localhost:3000/";
    setDesktopConsent("granted");
    expect(telemetryHostAllowed("desktop")).toBe(true);
    expect(telemetryHostAllowed("native"), "the same host must not open iOS").toBe(false);
  });

  it("leaves the browser modes exactly as they were", () => {
    setDesktopConsent("granted");
    window.location.href = "https://verticopolis.com/";
    expect(telemetryHostAllowed("production")).toBe(true);
    window.location.href = "http://localhost:3000/";
    expect(telemetryHostAllowed("production"), "a desktop consent must not open localhost").toBe(false);
  });
});

describe("injectVercelTelemetry stays dark on every wrapped build", () => {
  const localhost = "http://localhost:3000/";

  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    resetDesktopConsentForTests();
    localStorage.clear();
    vi.mocked(injectSpeedInsights).mockReset();
    vi.mocked(injectWebAnalytics).mockReset();
    window.location.href = localhost;
  });

  it("injects nothing on a CONSENTED desktop build", () => {
    // Consent opens the gameplay events, which have an absolute ingest URL to
    // reach. The Vercel page pair is served at `/_vercel/*` by our own
    // deployment, so on a shell it would 404 and be refused by the shell's
    // `connect-src` besides. It has to stay dark whatever the consent says.
    window.location.href = "https://verticopolis.com/";
    setDesktopConsent("granted");
    expect(telemetryHostAllowed("desktop"), "the gate itself is open here").toBe(true);
    injectVercelTelemetry("desktop");
    expect(injectSpeedInsights).not.toHaveBeenCalled();
    expect(injectWebAnalytics).not.toHaveBeenCalled();
  });

  it("still injects on a browser build from the same host", () => {
    window.location.href = "https://verticopolis.com/";
    injectVercelTelemetry("production");
    expect(injectSpeedInsights).toHaveBeenCalledTimes(1);
    expect(injectWebAnalytics).toHaveBeenCalledTimes(1);
  });
});
