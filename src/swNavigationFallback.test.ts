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
  new Function("FetchEvent", "fetch", SCRIPT)(FakeFetchEvent, fetchStub);
  return { FakeFetchEvent, answered, fetchStub };
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

  it("is plain script a worker can import: no module syntax", () => {
    expect(SCRIPT).not.toMatch(/^\s*(?:import|export)\s/m);
  });
});
