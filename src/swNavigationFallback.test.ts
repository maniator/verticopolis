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

/** A stand-in worker global with its own `fetch` spy, in the given lifecycle state (`null`: no `self.serviceWorker`). */
function workerScope(state: string | null) {
  const nativeFetch = vi.fn(async (_input: Request | string, _init?: RequestInit) => new Response("ok"));
  const scope: { fetch: (input: Request | string, init?: RequestInit) => Promise<Response>; serviceWorker?: { state: string } } = { fetch: nativeFetch };
  if (state !== null) scope.serviceWorker = { state };
  return Object.assign(scope, { nativeFetch });
}

/** Run the script in a worker scope and return what its patched `fetch` hands the browser. */
async function fetchThroughScript(state: string | null, request: Request, init?: RequestInit) {
  const scope = workerScope(state);
  class FakeFetchEvent {
    respondWith(): void {}
  }
  new Function("FetchEvent", "fetch", "self", SCRIPT)(FakeFetchEvent, scope.fetch, scope);
  await scope.fetch(request, init);
  expect(scope.nativeFetch).toHaveBeenCalledTimes(1);
  const [sent, sentInit] = scope.nativeFetch.mock.calls[0];
  return { sent: sent as Request, sentInit };
}

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

  const PAGE_SRI = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

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

  it("is plain script a worker can import: no module syntax", () => {
    expect(SCRIPT).not.toMatch(/^\s*(?:import|export)\s/m);
  });
});
