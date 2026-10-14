// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Pins the gating rules on `registerPWA` in `src/pwa.ts`: the build registers
 * the service worker and drives the update flow (the N1 tripwire), and the only
 * gates left are the browser preconditions (a secure context with service
 * worker support). No build mode turns it off.
 *
 * `virtual:pwa-register` is a Vite-plugin virtual module; we mock it so a
 * plain vitest run (no Vite plugin) still resolves the import and lets us
 * observe whether `registerSW` was called.
 */

// vi.mock is hoisted above the file; use vi.hoisted so the mock factory
// closes over the SAME reference our assertions read from.
const { registerSW } = vi.hoisted(() => ({
  registerSW: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
}));
vi.mock("virtual:pwa-register", () => ({ registerSW }));

async function importPwa() {
  // Import fresh each test so the top-level `registerSW` binding rebinds
  // against the current mock (safe with resetModules; harmless otherwise).
  vi.resetModules();
  return import("./pwa");
}

// happy-dom leaves `isSecureContext` undefined and doesn't ship a service-worker
// implementation, so satisfy the pre-existing browser-branch preconditions for
// tests that exercise the registration path. Reset after each test so no other
// suite sees the stubs stuck.
function makeBrowserBranchReachable(): () => void {
  const originalSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const originalSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
  return () => {
    if (originalSecure) Object.defineProperty(window, "isSecureContext", originalSecure);
    else Reflect.deleteProperty(window, "isSecureContext");
    if (originalSw) Object.defineProperty(navigator, "serviceWorker", originalSw);
    else Reflect.deleteProperty(navigator, "serviceWorker");
  };
}

describe("registerPWA: gating", () => {
  afterEach(() => {
    registerSW.mockClear();
    vi.unstubAllEnvs();
  });

  it("registers the service worker in the default vitest mode (browser branch: N1 tripwire)", async () => {
    // The browser preconditions must be satisfied for registration to reach
    // `registerSW`.
    const restore = makeBrowserBranchReachable();
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: () => {} });
      expect(registerSW).toHaveBeenCalledTimes(1);
      const opts = registerSW.mock.calls[0][0];
      // The three handler seams the update flow hangs off must reach the
      // plugin; missing any of them would silently drop the prompt.
      expect(opts).toHaveProperty("immediate", true);
      expect(typeof opts.onRegisteredSW).toBe("function");
      expect(typeof opts.onNeedRefresh).toBe("function");
      expect(typeof opts.onOfflineReady).toBe("function");
    } finally {
      restore();
    }
  });

  it("registers under a former wrapper mode too: no build mode switches the PWA off", async () => {
    // The retired wrapper build modes used to skip registration and the update
    // poll. Any build that reaches the browser preconditions now registers,
    // which keeps updates and offline play on.
    vi.stubEnv("MODE", "native");
    const restore = makeBrowserBranchReachable();
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: () => {} });
      expect(registerSW).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("stays a no-op when isSecureContext is explicitly false, even with serviceWorker present (pre-existing guard)", async () => {
    // Pin the specific `isSecureContext` precondition rather than lean on the
    // fact that a bare happy-dom environment fails ALL three checks: stub
    // window + serviceWorker so removing the isSecureContext check from the
    // guard would flip this assertion.
    const originalSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    const originalSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: () => {} });
      expect(registerSW).not.toHaveBeenCalled();
    } finally {
      if (originalSecure) Object.defineProperty(window, "isSecureContext", originalSecure);
      else Reflect.deleteProperty(window, "isSecureContext");
      if (originalSw) Object.defineProperty(navigator, "serviceWorker", originalSw);
      else Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });
});
