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

describe("registerPWA: offline", () => {
  afterEach(() => {
    registerSW.mockClear();
  });

  it("still offers a waiting update when the version.json fetch fails offline (#945)", async () => {
    // Offline, the incoming build's notes cannot be fetched. The update must
    // still surface (with no info) and nothing may throw, so an installed game
    // keeps running on its cached shell and engine until the player updates.
    const restore = makeBrowserBranchReachable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      const opts = registerSW.mock.calls[0][0] as { onNeedRefresh: () => void };
      opts.onNeedRefresh();
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(fetchSpy).toHaveBeenCalled();
      expect(onUpdateAvailable.mock.calls[0][1]).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });

  // version.json only decorates the update prompt (#985, criterion 7), so
  // every way it can fail to arrive leaves the update on offer, with no info.
  const failures: [string, () => Promise<Response>][] = [
    ["answers 404", async () => new Response("not found", { status: 404 })],
    ["answers 500", async () => new Response("down", { status: 500 })],
    ["is not JSON", async () => new Response("<!doctype html>", { status: 200 })],
    ["is JSON that is not an object", async () => new Response("null", { status: 200 })],
  ];
  it.each(failures)("still offers a waiting update when version.json %s", async (_name, answer) => {
    const restore = makeBrowserBranchReachable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(answer);
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      (registerSW.mock.calls[0][0] as { onNeedRefresh: () => void }).onNeedRefresh();
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(onUpdateAvailable.mock.calls[0][1]).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });

  // A 200 whose body parses to something with no usable fields leaves nothing to
  // show; the update is still on offer, with info that names no build.
  it.each([["{}", "{}"], ["an array", "[1, 2]"], ["fields of the wrong type", '{"version":5,"sha":[],"notes":"x"}']])(
    "still offers a waiting update when version.json is %s",
    async (_name, body) => {
      const restore = makeBrowserBranchReachable();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status: 200 }));
      try {
        const { registerPWA } = await importPwa();
        const onUpdateAvailable = vi.fn();
        registerPWA({ onUpdateAvailable });
        (registerSW.mock.calls[0][0] as { onNeedRefresh: () => void }).onNeedRefresh();
        await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
        expect(onUpdateAvailable.mock.calls[0][1]).toEqual({ version: undefined, sha: undefined, notes: [] });
      } finally {
        fetchSpy.mockRestore();
        restore();
      }
    },
  );

  it("gives up on a version.json that never answers after four seconds and still offers the update", async () => {
    const restore = makeBrowserBranchReachable();
    vi.useFakeTimers();
    // A fetch that hangs until its signal aborts, as a stalled connection does.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      (registerSW.mock.calls[0][0] as { onNeedRefresh: () => void }).onNeedRefresh();
      await vi.advanceTimersByTimeAsync(3_999);
      expect(onUpdateAvailable, "still waiting inside the four seconds").not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
      expect(onUpdateAvailable.mock.calls[0][1]).toBeUndefined();
    } finally {
      vi.useRealTimers();
      fetchSpy.mockRestore();
      restore();
    }
  });

  it("hands the incoming build's identity to the prompt when version.json arrives", async () => {
    const restore = makeBrowserBranchReachable();
    const body = JSON.stringify({ version: "9.9.9", sha: "abc1234", notes: ["A new thing."] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status: 200 }));
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      (registerSW.mock.calls[0][0] as { onNeedRefresh: () => void }).onNeedRefresh();
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(onUpdateAvailable.mock.calls[0][1]).toEqual({ version: "9.9.9", sha: "abc1234", notes: ["A new thing."] });
      // It is fetched fresh: never from a cache, never precached.
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("version.json"));
      expect(call, "version.json was requested").toBeDefined();
      expect((call![1] as RequestInit).cache).toBe("no-store");
      expect(new URL(String(call![0])).searchParams.has("t"), "with a cache-busting query").toBe(true);
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });
});
