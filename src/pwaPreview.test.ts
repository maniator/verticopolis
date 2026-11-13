// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Pins `registerPWA` on a Vercel preview deployment (src/build/previewDeploy.ts):
 * the page registers no service worker, starts no update poll, and removes the
 * registrations and Workbox caches an earlier build of the preview left. The
 * build-time flag is replaced through `./deployTarget`, and the browser's
 * service worker container and Cache Storage are spies.
 */

const { registerSW, deploy } = vi.hoisted(() => ({
  registerSW: vi.fn((_opts: Record<string, unknown>) => vi.fn()),
  deploy: { preview: true },
}));
vi.mock("virtual:pwa-register", () => ({ registerSW }));
vi.mock("./deployTarget", () => ({
  get PREVIEW_DEPLOY() {
    return deploy.preview;
  },
}));

async function importPwa() {
  vi.resetModules();
  return import("./pwa");
}

interface BrowserSpies {
  getRegistrations: ReturnType<typeof vi.fn>;
  unregisters: ReturnType<typeof vi.fn>[];
  cacheDelete: ReturnType<typeof vi.fn>;
  restore: () => void;
}

/** A secure page with service worker support, two leftover registrations and
 *  a mix of Workbox and other caches. */
function browserWithLeftovers(): BrowserSpies {
  const originalSecure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const originalSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const unregisters = [vi.fn(async () => true), vi.fn(async () => true)];
  const getRegistrations = vi.fn(async () => unregisters.map((unregister) => ({ unregister })));
  const cacheDelete = vi.fn(async () => true);
  const cacheNames = ["workbox-precache-v2-https://preview.example/", "workbox-runtime", "someone-elses-cache"];
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistrations } });
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { keys: vi.fn(async () => cacheNames), delete: cacheDelete } });
  return {
    getRegistrations,
    unregisters,
    cacheDelete,
    restore: () => {
      for (const [target, key, original] of [
        [window, "isSecureContext", originalSecure],
        [navigator, "serviceWorker", originalSw],
        [globalThis, "caches", originalCaches],
      ] as const) {
        if (original) Object.defineProperty(target, key, original);
        else Reflect.deleteProperty(target, key);
      }
    },
  };
}

describe("registerPWA on a preview deployment", () => {
  afterEach(() => {
    registerSW.mockClear();
    deploy.preview = true;
    vi.restoreAllMocks();
  });

  it("registers no service worker and starts no update poll", async () => {
    const browser = browserWithLeftovers();
    const setInterval = vi.spyOn(window, "setInterval");
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      expect(registerSW).not.toHaveBeenCalled();
      expect(setInterval).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(browser.cacheDelete).toHaveBeenCalled());
      expect(onUpdateAvailable).not.toHaveBeenCalled();
    } finally {
      browser.restore();
    }
  });

  it("unregisters every leftover worker and deletes only Workbox's caches", async () => {
    const browser = browserWithLeftovers();
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: () => {} });
      await vi.waitFor(() => expect(browser.cacheDelete).toHaveBeenCalledTimes(2));
      expect(browser.getRegistrations).toHaveBeenCalledTimes(1);
      for (const unregister of browser.unregisters) expect(unregister).toHaveBeenCalledTimes(1);
      expect(browser.cacheDelete.mock.calls.map(([name]) => name)).toEqual(["workbox-precache-v2-https://preview.example/", "workbox-runtime"]);
    } finally {
      browser.restore();
    }
  });

  it("does not throw when the browser refuses to list registrations", async () => {
    const browser = browserWithLeftovers();
    browser.getRegistrations.mockRejectedValue(new DOMException("denied", "SecurityError"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { registerPWA } = await importPwa();
      expect(() => registerPWA({ onUpdateAvailable: () => {} })).not.toThrow();
      await vi.waitFor(() => expect(browser.getRegistrations).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
      expect(browser.cacheDelete).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      browser.restore();
    }
  });

  it("registers as usual and removes nothing when the build is not a preview", async () => {
    deploy.preview = false;
    const browser = browserWithLeftovers();
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: () => {} });
      expect(registerSW).toHaveBeenCalledTimes(1);
      expect(browser.getRegistrations).not.toHaveBeenCalled();
      expect(browser.cacheDelete).not.toHaveBeenCalled();
    } finally {
      browser.restore();
    }
  });
});
