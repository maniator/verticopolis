// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

/** The worker helper as it ships: a plain script that patches `FetchEvent`. */
const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(resolve(here, "public/sw-navigation-fallback.js"), "utf8");

interface Req {
  mode: string;
  url: string;
}

/** Run the script against a stand-in `FetchEvent`, as `importScripts` does in a worker. */
function install() {
  const answered: unknown[] = [];
  class FakeFetchEvent {
    constructor(readonly request: Req) {}
    respondWith(response: unknown): void {
      answered.push(response);
    }
  }
  const fetchStub = vi.fn((request: Req) => Promise.resolve(`network:${request.url}`));
  const scope = workerScope("activated");
  new Function("FetchEvent", "fetch", "self", SCRIPT)(FakeFetchEvent, fetchStub, scope);
  return { FakeFetchEvent, answered, fetchStub };
}

/** The cache name Workbox's precache looks entries up in. */
const PRECACHE = "workbox-precache-v2-https://game.test/";

/** A stand-in worker global with its own `fetch` spy answering `body`, in the given lifecycle state (`null`: no `self.serviceWorker`), and a Cache Storage whose `match` finds the files in `cached` (the installed build's, which sit there until this worker activates, #2206). */
function workerScope(state: string | null, body = "ok", status = 200, cached: string[] = []) {
  const nativeFetch = vi.fn(async (_input: Request | string, _init?: RequestInit) => new Response(body, { status }));
  const nativeMatch = vi.fn(async (request: Request | string, _options?: { cacheName?: string }) =>
    cached.includes(new Request(request).url) ? new Response("cached") : undefined,
  );
  const scope: {
    fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
    caches: { match: typeof nativeMatch };
    serviceWorker?: { state: string };
  } = { fetch: nativeFetch, caches: { match: nativeMatch } };
  if (state !== null) scope.serviceWorker = { state };
  return Object.assign(scope, { nativeFetch, nativeMatch });
}

/** Install `manifest` the way Workbox does, one entry at a time: look the entry up in the precache, and fetch it with its integrity only when the lookup misses. */
async function installEntries(scope: ReturnType<typeof workerScope>, manifest: string[]): Promise<void> {
  for (const url of manifest) {
    if (await scope.caches.match(new Request(url), { cacheName: PRECACHE })) continue;
    await scope.fetch(new Request(url, { integrity: PAGE_SRI, credentials: "same-origin" }));
  }
}

/** Run the script in a worker scope and return what its patched `fetch` hands the browser, and what it answers. `page.manifest` lists the manifest's entries before the page, which the install asks for first; `page.cached` the files already in the precache. */
async function fetchThroughScript(
  state: string | null,
  request: Request,
  init?: RequestInit,
  page?: { body: string; manifest: string[]; cached?: string[]; status?: number },
) {
  const scope = workerScope(state, page?.body, page?.status, page?.cached);
  class FakeFetchEvent {
    respondWith(): void {}
  }
  new Function("FetchEvent", "fetch", "self", SCRIPT)(FakeFetchEvent, scope.fetch, scope);
  await installEntries(scope, page?.manifest ?? []);
  const earlier = scope.nativeFetch.mock.calls.length;
  const answer = scope.fetch(request, init);
  await answer.catch(() => undefined);
  expect(scope.nativeFetch).toHaveBeenCalledTimes(earlier + 1);
  const [sent, sentInit] = scope.nativeFetch.mock.calls[earlier];
  return { sent: sent as Request, sentInit, answer, scope };
}

const PAGE_SRI = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const nav: Req = { mode: "navigate", url: "https://game.test/" };
const sub: Req = { mode: "cors", url: "https://game.test/assets/main-1.js" };

describe("sw-navigation-fallback.js (#1345)", () => {
  it("answers a navigation with the worker's own response when there is one", async () => {
    const { FakeFetchEvent, answered, fetchStub } = install();
    new FakeFetchEvent(nav).respondWith(Promise.resolve("precached shell"));
    expect(await answered[0]).toBe("precached shell");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("answers a navigation from the network when the worker's response fails, as an integrity mismatch does", async () => {
    const { FakeFetchEvent, answered, fetchStub } = install();
    new FakeFetchEvent(nav).respondWith(Promise.reject(new TypeError("Failed to fetch")));
    expect(await answered[0]).toBe("network:https://game.test/");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith(nav);
  });

  it("accepts a response that is not a promise", async () => {
    const { FakeFetchEvent, answered } = install();
    new FakeFetchEvent(nav).respondWith("a response");
    expect(await answered[0]).toBe("a response");
  });

  it("leaves every other request alone, so the engine's own integrity refusal still reaches the page", async () => {
    const { FakeFetchEvent, answered, fetchStub } = install();
    const failing = Promise.reject(new TypeError("Failed to fetch"));
    new FakeFetchEvent(sub).respondWith(failing);
    expect(answered[0], "the same promise, passed through").toBe(failing);
    await expect(answered[0]).rejects.toThrow("Failed to fetch");
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("fetches the HTML page without its integrity while the worker installs, so a rewritten page cannot fail every install", async () => {
    const request = new Request("https://game.test/index.html", { integrity: PAGE_SRI, credentials: "same-origin" });
    const { sent, sentInit } = await fetchThroughScript("installing", request, { cache: "reload" });
    expect(sent).not.toBe(request);
    expect(sent.url).toBe("https://game.test/index.html");
    expect(sent.integrity, "no integrity on the page").toBe("");
    expect(sent.credentials, "the rest of the request is kept").toBe("same-origin");
    expect(sentInit, "Workbox's fetch options pass through").toEqual({ cache: "reload" });
  });

  it("keeps the integrity on every other file during install", async () => {
    const request = new Request("https://game.test/assets/main-1.js", { integrity: PAGE_SRI });
    const { sent } = await fetchThroughScript("installing", request);
    expect(sent).toBe(request);
  });

  it("keeps the page's integrity once the worker is installed, so a precache miss is still checked before it is stored (#1345)", async () => {
    for (const state of ["installed", "activating", "activated"]) {
      const request = new Request("https://game.test/index.html", { integrity: PAGE_SRI });
      const { sent } = await fetchThroughScript(state, request);
      expect(sent, state).toBe(request);
    }
  });

  it("keeps the strict check where the worker cannot tell its own state", async () => {
    const request = new Request("https://game.test/index.html", { integrity: PAGE_SRI });
    const { sent } = await fetchThroughScript(null, request);
    expect(sent).toBe(request);
  });

  describe("a page from another build fails the install (#1949, #2206)", () => {
    const pageRequest = () => new Request("https://game.test/index.html", { integrity: PAGE_SRI });
    const html = (...names: string[]) =>
      `<html><head>${names.map((n) => `<script type="module" src="./assets/${n}"></script>`).join("")}<link rel="stylesheet" href="./assets/main-1.css"></head></html>`;
    const thisBuild = [
      "https://game.test/assets/main-1.js",
      "https://game.test/assets/vendor-1.js",
      "https://game.test/assets/main-1.css",
    ];

    it("stores a page whose `assets/` files this worker fetched for its precache, as the server sent it", async () => {
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: html("main-1.js", "vendor-1.js"),
        manifest: thisBuild,
      });
      expect(await (await answer).text()).toBe(html("main-1.js", "vendor-1.js"));
    });

    it("stores a page naming files the installed build already cached, which Workbox looks up and does not fetch", async () => {
      // An update whose vendor chunk did not change: it is in the precache from the installed worker.
      const unchanged = ["https://game.test/assets/vendor-1.js"];
      const { answer, scope } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: html("main-1.js", "vendor-1.js"),
        manifest: thisBuild,
        cached: unchanged,
      });
      expect(await (await answer).text()).toBe(html("main-1.js", "vendor-1.js"));
      const fetched = scope.nativeFetch.mock.calls.map(([input]) => new Request(input).url);
      expect(fetched, "the unchanged chunk was not fetched").not.toContain(unchanged[0]);
      expect(scope.nativeMatch, "the lookup reached the real Cache Storage").toHaveBeenCalledWith(expect.anything(), {
        cacheName: PRECACHE,
      });
    });

    it("refuses a newer build's page, which names a file this worker does not precache", async () => {
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: html("main-2.js", "vendor-1.js"),
        manifest: thisBuild,
      });
      await expect(answer).rejects.toThrow(/from another build/);
    });

    it("refuses an older build's page too, though the previous build's files are still in the precache (#2206)", async () => {
      // A worker for build 2 installing while a rollback serves build 1's page: build 1's files are
      // in the cache from the active worker, but this worker asks only for build 2's.
      const build2 = [
        "https://game.test/assets/main-2.js",
        "https://game.test/assets/vendor-1.js",
        "https://game.test/assets/main-2.css",
      ];
      const build1Page = `<html><head><script type="module" src="./assets/main-1.js"></script><link rel="stylesheet" href="./assets/main-1.css"></head></html>`;
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: build1Page,
        manifest: build2,
        cached: thisBuild,
      });
      await expect(answer).rejects.toThrow(/from another build/);
    });

    it("matches a fetched file without its query, as a revisioned entry carries one", async () => {
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: html("main-1.js"),
        manifest: ["https://game.test/assets/main-1.js?__WB_REVISION__=abc", "https://game.test/assets/main-1.css"],
      });
      expect(await (await answer).text()).toBe(html("main-1.js"));
    });

    it("counts only files fetched with an integrity or looked up in a precache while installing", async () => {
      const scope = workerScope("installing", html("main-1.js"), 200, thisBuild);
      new Function("FetchEvent", "fetch", "self", SCRIPT)(class {}, scope.fetch, scope);
      for (const url of thisBuild) await scope.fetch(new Request(url)); // a runtime fetch
      for (const url of thisBuild) await scope.caches.match(new Request(url), { cacheName: "runtime-images" });
      for (const url of thisBuild) await scope.caches.match(new Request(url));
      await expect(scope.fetch(pageRequest())).rejects.toThrow(/from another build/);
      const before = workerScope("activated", html("main-1.js"), 200, thisBuild);
      new Function("FetchEvent", "fetch", "self", SCRIPT)(class {}, before.fetch, before);
      await installEntries(before, thisBuild); // looked up before the install began
      before.serviceWorker!.state = "installing";
      await expect(before.fetch(pageRequest()), "lookups made while not installing do not count").rejects.toThrow(
        /from another build/,
      );
    });

    it("lets a host's rewrite through: its script is not one of the build's files", async () => {
      const rewritten = `${html("main-1.js")}<script async src="https://toolbar.example/live.js" data-host-toolbar="true"></script>`;
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: rewritten,
        manifest: thisBuild,
      });
      expect(await (await answer).text()).toBe(rewritten);
    });

    it("skips a link that is no URL, as a host's rewrite could add, and still checks the rest", async () => {
      const broken = `${html("main-1.js")}<a href="http://">help</a>`;
      const kept = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: broken,
        manifest: thisBuild,
      });
      expect(await (await kept.answer).text()).toBe(broken);
      const other = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: `${html("main-2.js")}<a href="http://">help</a>`,
        manifest: thisBuild,
      });
      await expect(other.answer).rejects.toThrow(/from another build/);
    });

    it("hands a failed response to Workbox unread, which fails the install on its own", async () => {
      const { answer } = await fetchThroughScript("installing", pageRequest(), undefined, {
        body: html("main-2.js"),
        manifest: thisBuild,
        status: 503,
      });
      expect((await answer).status).toBe(503);
    });
  });

  it("is plain script a worker can import: no module syntax", () => {
    expect(SCRIPT).not.toMatch(/^\s*(?:import|export)\s/m);
  });
});
