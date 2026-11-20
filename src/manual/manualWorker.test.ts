// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  activateManual,
  installManual,
  MANIFEST_PATH,
  MEDIA_CACHE,
  NETWORK_WAIT_MS,
  pagesCacheName,
  respond,
  savedKey,
  startManualWorker,
  type ManualConfig,
  type ManualDeps,
  type ManualWorkerScope,
} from "./manualWorker";

const SCOPE = "https://help.example/";

/** An in-memory Cache Storage: one map of address to response per cache. */
function fakeCaches(): CacheStorage & { stores: Map<string, Map<string, Response>> } {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    let store = stores.get(name);
    if (!store) {
      store = new Map();
      stores.set(name, store);
    }
    const s = store;
    const key = (req: RequestInfo | URL) => {
      if (typeof req === "string") return req;
      return req instanceof URL ? req.href : req.url;
    };
    return {
      match: async (req: RequestInfo | URL) => s.get(key(req))?.clone(),
      put: async (req: RequestInfo | URL, res: Response) => {
        s.set(key(req), res);
      },
      keys: async () => [...s.keys()].map((address) => new Request(address)),
      delete: async (req: RequestInfo | URL) => s.delete(key(req)),
    } as unknown as Cache;
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    has: async (name: string) => stores.has(name),
    match: async () => undefined,
  } as unknown as CacheStorage & { stores: Map<string, Map<string, Response>> };
}

const CONFIG: ManualConfig = {
  version: "v2",
  files: [
    { url: "", revision: "home2" },
    { url: "rooms/hotels/", revision: "hotels1" },
    { url: "_astro/page.js", revision: "js1" },
  ],
  pictures: ["_astro/desk.webp", "_astro/missing.webp"],
};

/** A network that answers each address with its own path, or fails. */
function network(fail = false) {
  return vi.fn(async (request: Request) => {
    if (fail) throw new TypeError("Failed to fetch");
    return new Response(`net ${new URL(request.url).pathname}`, { status: 200 });
  });
}

/** The worker's deps with a network a test can swap. */
type TestDeps = { -readonly [K in keyof ManualDeps]: ManualDeps[K] } & { caches: ReturnType<typeof fakeCaches> };

function deps(over: Partial<ManualDeps> = {}): TestDeps {
  return {
    caches: fakeCaches(),
    fetch: network(),
    scope: SCOPE,
    wait: () => new Promise(() => {}),
    ...over,
  } as TestDeps;
}

/** A page load. A script cannot make a navigation request, so its mode is set. */
function page(path: string): Request {
  const request = new Request(SCOPE + path);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

describe("savedKey", () => {
  it("drops the query and hash and puts a page's folder slash back", () => {
    expect(savedKey("https://h/rooms/hotels?from=game#top")).toBe("https://h/rooms/hotels/");
    expect(savedKey("https://h/rooms/hotels/")).toBe("https://h/rooms/hotels/");
    expect(savedKey("https://h/")).toBe("https://h/");
    expect(savedKey("https://h/_astro/page.js?v=1")).toBe("https://h/_astro/page.js");
  });
});

describe("installManual", () => {
  it("fetches every listed file into this version's copy, then writes the list", async () => {
    const d = deps();
    await installManual(CONFIG, d);
    const copy = d.caches.stores.get(pagesCacheName("v2"))!;
    expect([...copy.keys()].sort()).toEqual(
      [SCOPE, `${SCOPE}rooms/hotels/`, `${SCOPE}_astro/page.js`, SCOPE + MANIFEST_PATH].sort(),
    );
    expect(d.fetch).toHaveBeenCalledTimes(3);
    expect(
      await copy
        .get(SCOPE + MANIFEST_PATH)!
        .clone()
        .json(),
    ).toEqual({
      "": "home2",
      "rooms/hotels/": "hotels1",
      "_astro/page.js": "js1",
    });
  });

  it("copies files whose revision did not change from the last finished copy", async () => {
    const d = deps();
    await installManual(
      { ...CONFIG, version: "v1", files: [...CONFIG.files.slice(1), { url: "", revision: "home1" }] },
      d,
    );
    d.fetch = network();
    await installManual(CONFIG, d);
    // Only the front page changed revision, so only it is downloaded again.
    expect(vi.mocked(d.fetch).mock.calls.map(([r]) => r.url)).toEqual([SCOPE]);
    const copy = d.caches.stores.get(pagesCacheName("v2"))!;
    expect(await copy.get(`${SCOPE}rooms/hotels/`)!.text()).toBe("net /rooms/hotels/");
  });

  it("fails when a file does not arrive, and writes no list, so the browser retries", async () => {
    const d = deps({
      fetch: vi.fn(async (r: Request) => new Response("", { status: r.url.endsWith(".js") ? 404 : 200 })),
    });
    await expect(installManual(CONFIG, d)).rejects.toThrow(/_astro\/page\.js answered 404/);
    expect(d.caches.stores.get(pagesCacheName("v2"))!.has(SCOPE + MANIFEST_PATH)).toBe(false);
  });

  it("keeps the files an earlier try of the same version saved", async () => {
    const d = deps();
    const copy = await d.caches.open(pagesCacheName("v2"));
    await copy.put(SCOPE, new Response("kept"));
    await installManual(CONFIG, d);
    expect(vi.mocked(d.fetch).mock.calls.map(([r]) => r.url)).not.toContain(SCOPE);
  });
});

describe("activateManual", () => {
  it("deletes older copies and game caches, keeps this copy and the pictures, and says a game was there", async () => {
    const d = deps();
    for (const name of [
      pagesCacheName("v1"),
      pagesCacheName("v2"),
      MEDIA_CACHE,
      `workbox-precache-v2-${SCOPE}`,
      "other",
    ])
      await d.caches.open(name);
    expect(await activateManual(CONFIG, d)).toBe(true);
    expect([...d.caches.stores.keys()].sort()).toEqual([MEDIA_CACHE, "other", pagesCacheName("v2")].sort());
  });

  it("deletes the saved pictures this build no longer shows and keeps the rest", async () => {
    const d = deps();
    const media = await d.caches.open(MEDIA_CACHE);
    await media.put(`${SCOPE}_astro/desk.webp`, new Response("kept"));
    await media.put(`${SCOPE}_astro/desk-old.webp`, new Response("gone"));
    await activateManual(CONFIG, d);
    expect([...d.caches.stores.get(MEDIA_CACHE)!.keys()]).toEqual([`${SCOPE}_astro/desk.webp`]);
  });

  it("matches saved pictures to the list under a /help/ scope", async () => {
    const d = deps({ scope: "https://game.example/help/" });
    const media = await d.caches.open(MEDIA_CACHE);
    await media.put("https://game.example/help/_astro/desk.webp", new Response("kept"));
    await activateManual(CONFIG, d);
    expect(d.caches.stores.get(MEDIA_CACHE)!.size).toBe(1);
  });

  it("never touches the caches of a game that shares the origin with the manual under /help/", async () => {
    const d = deps({ scope: "https://game.example/help/" });
    const game = ["workbox-precache-v2-https://game.example/", "workbox-runtime-https://game.example/"];
    for (const name of game) await d.caches.open(name);
    expect(await activateManual(CONFIG, d)).toBe(false);
    expect([...d.caches.stores.keys()].sort()).toEqual(game.sort());
  });

  it("says no game was there when no Workbox cache is found", async () => {
    const d = deps();
    await d.caches.open(pagesCacheName("v1"));
    expect(await activateManual(CONFIG, d)).toBe(false);
  });
});

describe("respond", () => {
  it("leaves other sites, other methods, the relay, Vercel's scripts and the worker to the browser", () => {
    const d = deps();
    for (const request of [
      new Request("https://elsewhere.example/"),
      new Request(SCOPE, { method: "POST", body: "x" }),
      new Request(`${SCOPE}api/ingest`),
      new Request(`${SCOPE}_vercel/insights/script.js`),
      new Request(`${SCOPE}sw.js`),
      new Request(`${SCOPE}robots.txt`),
      new Request(`${SCOPE}cards/index.png`),
    ])
      expect(respond(request, CONFIG, d)).toBeNull();
  });

  it("leaves addresses outside a /help scope alone", () => {
    const d = deps({ scope: "https://game.example/help/" });
    expect(respond(new Request("https://game.example/"), CONFIG, d)).toBeNull();
  });

  it("answers a page from the network when it can", async () => {
    const d = deps();
    await installManual(CONFIG, d);
    const res = await respond(page("rooms/hotels/?from=game"), CONFIG, d)!;
    expect(await res.text()).toBe("net /rooms/hotels/");
  });

  it("answers a saved page offline, whatever its query, with or without the slash", async () => {
    const d = deps();
    await installManual(CONFIG, d);
    d.fetch = network(true);
    expect(await (await respond(page("rooms/hotels?from=game&via=game_menu"), CONFIG, d)!).text()).toBe(
      "net /rooms/hotels/",
    );
  });

  it("answers a saved copy when the network is slower than the wait", async () => {
    let finishWait = () => {};
    const d = deps({ wait: () => new Promise<void>((r) => (finishWait = r)) });
    await installManual(CONFIG, d);
    d.fetch = vi.fn(() => new Promise<Response>(() => {}));
    const answer = respond(page(""), CONFIG, d)!;
    finishWait();
    expect(await (await answer).text()).toBe("net /");
    expect(NETWORK_WAIT_MS).toBeGreaterThan(0);
  });

  it("waits on for the network when the wait ends and no copy is saved", async () => {
    let finishWait = () => {};
    let answerNet: (r: Response) => void = () => {};
    const d = deps({
      wait: () => new Promise<void>((r) => (finishWait = r)),
      fetch: vi.fn(() => new Promise<Response>((r) => (answerNet = r))),
    });
    const answer = respond(page("rooms/hotels/"), CONFIG, d)!;
    finishWait();
    await new Promise((r) => setTimeout(r, 0));
    answerNet(new Response("late"));
    expect(await (await answer).text()).toBe("late");
  });

  it("answers a page that is not saved, offline, with the not-saved page linking the front page", async () => {
    const d = deps({ fetch: network(true) });
    const res = await respond(page("rooms/new-room/"), CONFIG, d)!;
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("isn't saved on this device yet");
    expect(text).toContain(`href="${SCOPE}"`);
  });

  it("answers a listed file from the copy without the network, and from the network when the copy lacks it", async () => {
    const d = deps();
    await installManual(CONFIG, d);
    d.fetch = network(true);
    expect(await (await respond(new Request(`${SCOPE}_astro/page.js`), CONFIG, d)!).text()).toBe("net /_astro/page.js");
    const empty = deps();
    expect(await (await respond(new Request(`${SCOPE}_astro/page.js`), CONFIG, empty)!).text()).toBe(
      "net /_astro/page.js",
    );
  });

  it("saves a picture the first time it is shown and answers it from there offline", async () => {
    const d = deps({
      fetch: vi.fn(async () => {
        const res = new Response("webp");
        Object.defineProperty(res, "type", { value: "basic" });
        return res;
      }),
    });
    const shot = () => new Request(`${SCOPE}_astro/desk.webp`);
    expect(await (await respond(shot(), CONFIG, d)!).text()).toBe("webp");
    d.fetch = network(true);
    expect(await (await respond(shot(), CONFIG, d)!).text()).toBe("webp");
    expect(d.caches.stores.get(MEDIA_CACHE)!.has(`${SCOPE}_astro/desk.webp`)).toBe(true);
  });

  it("does not save a failed picture", async () => {
    const d = deps({ fetch: vi.fn(async () => new Response("", { status: 404 })) });
    await respond(new Request(`${SCOPE}_astro/missing.webp`), CONFIG, d);
    expect(d.caches.stores.get(MEDIA_CACHE)?.size ?? 0).toBe(0);
  });
});

describe("startManualWorker", () => {
  function scope() {
    const listeners = new Map<string, (event: never) => void>();
    const navigate = vi.fn(async () => null);
    const self = {
      caches: fakeCaches(),
      registration: { scope: SCOPE },
      clients: {
        claim: vi.fn(async () => {}),
        matchAll: vi.fn(async () => [{ url: `${SCOPE}rooms/`, navigate }]),
      },
      fetch: network(),
      skipWaiting: vi.fn(async () => {}),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      addEventListener: (type: string, listener: (event: never) => void) => listeners.set(type, listener),
    };
    startManualWorker(self as unknown as ManualWorkerScope, CONFIG);
    const fire = async (type: string, extra: object = {}) => {
      const pending: Promise<unknown>[] = [];
      listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => pending.push(p), ...extra } as never);
      await Promise.all(pending);
    };
    return { self, fire, navigate };
  }

  it("takes over at once and saves the manual on install", async () => {
    const { self, fire } = scope();
    await fire("install");
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
    expect(self.caches.stores.get(pagesCacheName("v2"))!.has(SCOPE + MANIFEST_PATH)).toBe(true);
  });

  it("claims open pages on activate, reloading them only when a game worker's caches were there", async () => {
    const quiet = scope();
    await quiet.fire("activate");
    expect(quiet.self.clients.claim).toHaveBeenCalledTimes(1);
    expect(quiet.navigate).not.toHaveBeenCalled();
    const stale = scope();
    await stale.self.caches.open(`workbox-precache-v2-${SCOPE}`);
    await stale.fire("activate");
    expect(stale.navigate).toHaveBeenCalledWith(`${SCOPE}rooms/`);
  });

  it("answers the requests respond takes and leaves the rest alone", async () => {
    const { fire } = scope();
    const respondWith = vi.fn();
    await fire("fetch", { request: page(""), respondWith });
    expect(respondWith).toHaveBeenCalledTimes(1);
    await fire("fetch", { request: new Request(`${SCOPE}api/ingest`), respondWith });
    expect(respondWith).toHaveBeenCalledTimes(1);
  });
});
