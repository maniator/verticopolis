// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Pins the two gating rules on `registerPWA` in `src/pwa.ts`: the plain build
 * registers the service worker and drives the update flow (the N1 tripwire for
 * the mobile-distribution E1b story), the `--mode native` build is a no-op
 * (F2). The Android TWA runs the plain build, so the gate is on the build's
 * Vite mode (inlined in production builds), not any runtime wrapper flag.
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
    // Vitest pins `import.meta.env.MODE` to "test"; the native gate must not
    // fire, and the browser preconditions must be satisfied for registration
    // to reach `registerSW`.
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

  it("under MODE=native leaves NO side effects behind: no registerSW, no interval, no visibilitychange, no fetch (F2)", async () => {
    // The native bundle powers the iOS Capacitor wrapper: store updates only,
    // no version.json poll (the fetch would only ever see the bundled snapshot).
    // Assert each promised no-op directly instead of relying on the transitive
    // fact that today all three side effects live inside `onRegisteredSW`. If
    // a future refactor lifts the poll or listener out of that callback, these
    // spies would catch the F2 regression that a plain `registerSW` check
    // would miss.
    vi.stubEnv("MODE", "native");
    const restore = makeBrowserBranchReachable();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const addEventSpy = vi.spyOn(document, "addEventListener");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      const onOfflineReady = vi.fn();
      registerPWA({ onUpdateAvailable, onOfflineReady });
      expect(registerSW).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      // Only visibilitychange matters here (that's the one registerPWA wires);
      // no listener of any name should reach the document from this call.
      expect(addEventSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(onUpdateAvailable).not.toHaveBeenCalled();
      expect(onOfflineReady).not.toHaveBeenCalled();
    } finally {
      restore();
      setIntervalSpy.mockRestore();
      addEventSpy.mockRestore();
      fetchSpy.mockRestore();
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
