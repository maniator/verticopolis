// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, type MockInstance } from "vitest";

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

  /** Run `scenario` with `fetch` replaced, in a reachable browser branch, and put everything back. */
  async function withFetch(impl: typeof fetch, scenario: (fetchSpy: MockInstance<typeof fetch>) => Promise<void>): Promise<void> {
    const restore = makeBrowserBranchReachable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(impl);
    try {
      await scenario(fetchSpy);
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  }

  /** The URL of a version.json request among the fetch calls, or undefined. */
  const versionJsonCall = (fetchSpy: MockInstance<typeof fetch>) => fetchSpy.mock.calls.find(([url]) => String(url).includes("version.json"));

  /** Register, let the worker report a waiting update, and return the prompt handler. */
  async function needRefresh(): Promise<ReturnType<typeof vi.fn>> {
    const { registerPWA } = await importPwa();
    const onUpdateAvailable = vi.fn();
    registerPWA({ onUpdateAvailable });
    (registerSW.mock.calls[0][0] as { onNeedRefresh: () => void }).onNeedRefresh();
    return onUpdateAvailable;
  }

  // version.json only decorates the update prompt (#985, criterion 7). On the
  // path where the worker reports a waiting update (onNeedRefresh), every way
  // it can fail to arrive still leaves the update on offer, with no info. The
  // hourly backstop path is different: see the test after these.
  const failures: [string, () => Promise<Response>][] = [
    ["answers 404", async () => new Response("not found", { status: 404 })],
    ["answers 500", async () => new Response("down", { status: 500 })],
    ["is not JSON", async () => new Response("<!doctype html>", { status: 200 })],
    ["is JSON that is not an object", async () => new Response("null", { status: 200 })],
  ];
  it.each(failures)("still offers a waiting update when version.json %s", async (_name, answer) => {
    await withFetch(answer, async (fetchSpy) => {
      const onUpdateAvailable = await needRefresh();
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(versionJsonCall(fetchSpy), "version.json was requested").toBeDefined();
      expect(onUpdateAvailable.mock.calls[0][1]).toBeUndefined();
    });
  });

  // A 200 whose body parses to something with no usable fields leaves nothing to
  // show; the update is still on offer, with info that names no build.
  it.each([["{}", "{}"], ["an array", "[1, 2]"], ["fields of the wrong type", '{"version":5,"sha":[],"notes":"x"}']])(
    "still offers a waiting update when version.json is %s",
    async (_name, body) => {
      await withFetch(async () => new Response(body, { status: 200 }), async (fetchSpy) => {
        const onUpdateAvailable = await needRefresh();
        await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
        expect(versionJsonCall(fetchSpy), "version.json was requested").toBeDefined();
        expect(onUpdateAvailable.mock.calls[0][1]).toEqual({ version: undefined, sha: undefined, notes: [], releases: [] });
      });
    },
  );

  it("gives up on a version.json that never answers after four seconds and still offers the update", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    // A fetch that hangs until its signal aborts, as a stalled connection does.
    const stalls: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        signal = init?.signal;
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    try {
      await withFetch(stalls, async () => {
        const onUpdateAvailable = await needRefresh();
        await vi.advanceTimersByTimeAsync(3_999);
        expect(onUpdateAvailable, "still waiting inside the four seconds").not.toHaveBeenCalled();
        expect(signal?.aborted, "not yet aborted").toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(signal?.aborted, "aborted by the four second limit").toBe(true);
        expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
        expect(onUpdateAvailable.mock.calls[0][1]).toBeUndefined();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands the incoming build's identity to the prompt when version.json arrives", async () => {
    const body = JSON.stringify({ version: "9.9.9", sha: "abc1234", notes: ["A new thing."] });
    await withFetch(async () => new Response(body, { status: 200 }), async (fetchSpy) => {
      const onUpdateAvailable = await needRefresh();
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      // A payload without `releases` (an older server) still shows its own notes,
      // as the one version newer than the running build (#1897).
      expect(onUpdateAvailable.mock.calls[0][1]).toEqual({
        version: "9.9.9",
        sha: "abc1234",
        notes: ["A new thing."],
        releases: [{ version: "9.9.9", notes: ["A new thing."] }],
        since: __APP_VERSION__,
      });
      // It is fetched fresh: never from a cache, never precached.
      const call = versionJsonCall(fetchSpy);
      expect(call, "version.json was requested").toBeDefined();
      expect((call![1] as RequestInit).cache).toBe("no-store");
      expect(new URL(String(call![0])).searchParams.has("t"), "with a cache-busting query").toBe(true);
    });
  });

  // The hourly and on-focus backstop asks for a waiting worker, then confirms
  // against version.json. A missing version.json is "no information", which is
  // not a different build, so the backstop does not offer the update; the
  // worker's own onNeedRefresh still does. Whether a missing version.json
  // should offer it here is open (the #985 backlog row records the choice).
  it("does not offer a waiting worker from the backstop check when version.json is missing", async () => {
    await withFetch(async () => new Response("not found", { status: 404 }), async (fetchSpy) => {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      const opts = registerSW.mock.calls[0][0] as { onRegisteredSW: (url: string, registration: unknown) => void };
      opts.onRegisteredSW("sw.js", { update: async () => undefined, waiting: {} });
      // The tab returning to the foreground runs the same check as the poll.
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(versionJsonCall(fetchSpy), "the check asked for version.json").toBeDefined());
      // Let the answer settle: the check has no promise to await from here.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onUpdateAvailable).not.toHaveBeenCalled();
    });
  });
});

describe("registerPWA: a newer build whose worker never installed", () => {
  afterEach(() => {
    registerSW.mockClear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A registration the check can drive, with spies for the calls it may make. */
  function fakeRegistration(state: { waiting?: object | null; installing?: object | null }) {
    return {
      scope: "https://example.test/",
      update: vi.fn(async () => undefined),
      unregister: vi.fn(async () => true),
      waiting: state.waiting ?? null,
      installing: (state.installing ?? null) as object | null,
    };
  }

  /** Register, hand the plugin `registration`, and fire the focus check. */
  async function runFocusCheck(registration: ReturnType<typeof fakeRegistration>): Promise<ReturnType<typeof vi.fn>> {
    const { registerPWA } = await importPwa();
    const onUpdateAvailable = vi.fn();
    registerPWA({ onUpdateAvailable });
    const opts = registerSW.mock.calls[0][0] as { onRegisteredSW: (url: string, registration: unknown) => void };
    opts.onRegisteredSW("sw.js", registration);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    return onUpdateAvailable;
  }

  const live = (version: string) => async () => new Response(JSON.stringify({ version, sha: "f00dcafe" }), { status: 200 });

  it("offers the update when the live build differs and no worker is waiting, and Update reloads from the network", async () => {
    const restore = makeBrowserBranchReachable();
    vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => ["workbox-precache-v2-https://example.test/", "workbox-precache-v2-https://example.test/other-app/", "posthog-other"]),
      delete: cacheDelete,
    });
    const reload = vi.fn();
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    try {
      const registration = fakeRegistration({});
      const onUpdateAvailable = await runFocusCheck(registration);
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(onUpdateAvailable.mock.calls[0][1]).toMatchObject({ version: "99.0.0" });
      const activate = onUpdateAvailable.mock.calls[0][0] as () => Promise<void>;
      await activate();
      expect(registration.unregister).toHaveBeenCalledTimes(1);
      expect(cacheDelete.mock.calls).toEqual([["workbox-precache-v2-https://example.test/"]]);
      expect(reload).toHaveBeenCalledTimes(1);
      const updateSW = registerSW.mock.results[0].value as ReturnType<typeof vi.fn>;
      expect(updateSW, "no waiting worker to skip to").not.toHaveBeenCalled();
    } finally {
      if (originalLocation) Object.defineProperty(window, "location", originalLocation);
      restore();
    }
  });

  it("keeps the worker and its offline copy when the network is gone by the time the player picks Update", async () => {
    const restore = makeBrowserBranchReachable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal("caches", { keys: vi.fn(async () => ["workbox-precache-v2-https://example.test/"]), delete: cacheDelete });
    try {
      const registration = fakeRegistration({});
      const onUpdateAvailable = await runFocusCheck(registration);
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
      const activate = onUpdateAvailable.mock.calls[0][0] as () => Promise<void>;
      await expect(activate(), "the prompt is told the update did not apply").rejects.toThrow(/not reachable/);
      expect(registration.unregister).not.toHaveBeenCalled();
      expect(cacheDelete).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("still uses the waiting worker when one is there", async () => {
    const restore = makeBrowserBranchReachable();
    vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    try {
      const registration = fakeRegistration({ waiting: {} });
      const onUpdateAvailable = await runFocusCheck(registration);
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      await (onUpdateAvailable.mock.calls[0][0] as () => Promise<void>)();
      const updateSW = registerSW.mock.results[0].value as ReturnType<typeof vi.fn>;
      expect(updateSW).toHaveBeenCalledWith(true);
      expect(registration.unregister).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  /** A worker in the "installing" state that the test moves on by hand. */
  function installingWorker() {
    const target = new EventTarget();
    const worker = Object.assign(target, { state: "installing" as string });
    const settle = (state: "installed" | "redundant") => {
      worker.state = state;
      worker.dispatchEvent(new Event("statechange"));
    };
    return { worker, settle };
  }

  it("waits for an install the check started, and offers the reload when that install fails", async () => {
    const restore = makeBrowserBranchReachable();
    vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    try {
      // Every update() against a deploy whose install keeps failing starts a new
      // attempt, so the check always sees "installing" first.
      const { worker, settle } = installingWorker();
      const registration = fakeRegistration({ installing: worker });
      const onUpdateAvailable = await runFocusCheck(registration);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onUpdateAvailable, "nothing while the install runs").not.toHaveBeenCalled();
      registration.installing = null;
      settle("redundant");
      await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
      expect(onUpdateAvailable.mock.calls[0][1]).toMatchObject({ version: "99.0.0" });
    } finally {
      restore();
    }
  });

  it("leaves an install that is still running after a minute for the next check", async () => {
    vi.useFakeTimers();
    const restore = makeBrowserBranchReachable();
    vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    try {
      const { registerPWA } = await importPwa();
      const onUpdateAvailable = vi.fn();
      registerPWA({ onUpdateAvailable });
      const registration = fakeRegistration({ installing: installingWorker().worker });
      (registerSW.mock.calls[0][0] as { onRegisteredSW: (url: string, registration: unknown) => void }).onRegisteredSW("sw.js", registration);
      await vi.advanceTimersByTimeAsync(15_000 + 60_000 + 1);
      expect(registration.update).toHaveBeenCalledTimes(1);
      expect(onUpdateAvailable).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("does not offer anything when the live build is the one running", async () => {
    const restore = makeBrowserBranchReachable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ version: __APP_VERSION__, sha: __APP_SHA__ }), { status: 200 }));
    try {
      const onUpdateAvailable = await runFocusCheck(fakeRegistration({}));
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(onUpdateAvailable).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("runs the first check fifteen seconds after registration, without waiting for the hourly poll", async () => {
    vi.useFakeTimers();
    const restore = makeBrowserBranchReachable();
    vi.spyOn(globalThis, "fetch").mockImplementation(live("99.0.0"));
    try {
      const { registerPWA } = await importPwa();
      registerPWA({ onUpdateAvailable: vi.fn() });
      const registration = fakeRegistration({});
      (registerSW.mock.calls[0][0] as { onRegisteredSW: (url: string, registration: unknown) => void }).onRegisteredSW("sw.js", registration);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(registration.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(registration.update).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
