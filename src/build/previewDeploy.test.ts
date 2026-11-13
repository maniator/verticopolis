import { describe, it, expect, vi } from "vitest";
import { applyPreviewWorker, isPreviewDeploy, PRECACHE_CALL, productionWorkerProblem, RETIRING_SERVICE_WORKER, RETIRING_WORKER_MARKER } from "./previewDeploy";

describe("isPreviewDeploy", () => {
  it("is true only for a Vercel preview build", () => {
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("keeps the service worker for production, Vercel development and builds outside Vercel", () => {
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(isPreviewDeploy({ VERCEL: "1", VERCEL_ENV: "development" })).toBe(false);
    expect(isPreviewDeploy({})).toBe(false);
    expect(isPreviewDeploy({ VERCEL_ENV: "" })).toBe(false);
  });
});

type Listener = (event: { waitUntil: (work: Promise<unknown>) => void }) => void;

/** Run the retiring worker's source against a stand-in `self` and fire one
 *  lifecycle event, waiting for whatever it hands to `waitUntil`. */
function retiringWorker() {
  const listeners = new Map<string, Listener>();
  const order: string[] = [];
  const navigate = vi.fn(async (url: string) => {
    order.push(`navigate ${url}`);
    return null;
  });
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    caches: {
      keys: vi.fn(async () => ["workbox-precache-v2-https://preview.example/", "other-cache"]),
      delete: vi.fn(async (name: string) => {
        order.push(`delete ${name}`);
        return true;
      }),
    },
    registration: {
      unregister: vi.fn(async () => {
        order.push("unregister");
        return true;
      }),
    },
    clients: {
      matchAll: vi.fn(async () => [
        { url: "https://preview.example/", navigate },
        { url: "https://preview.example/?tower=2", navigate },
      ]),
    },
  };
  new Function("self", RETIRING_SERVICE_WORKER)(self);
  const fire = async (type: string) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)?.({ waitUntil: (work) => pending.push(work) });
    await Promise.all(pending);
  };
  return { self, fire, listeners, order, navigate };
}

describe("RETIRING_SERVICE_WORKER", () => {
  it("handles no fetches, so it never serves a request from a cache", () => {
    const { listeners } = retiringWorker();
    expect([...listeners.keys()].sort()).toEqual(["activate", "install"]);
  });

  it("takes over at once instead of waiting for old tabs to close", async () => {
    const { self, fire } = retiringWorker();
    await fire("install");
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("on activate deletes Workbox's caches, unregisters, then reloads each window from the network", async () => {
    const { self, fire, order } = retiringWorker();
    await fire("activate");
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: "window" });
    // Unregistering before the navigation is what sends it to the network.
    expect(order).toEqual([
      "delete workbox-precache-v2-https://preview.example/",
      "unregister",
      "navigate https://preview.example/",
      "navigate https://preview.example/?tower=2",
    ]);
  });

  it("still finishes when a window refuses to navigate", async () => {
    const { fire, navigate, self } = retiringWorker();
    navigate.mockRejectedValueOnce(new TypeError("not controlled"));
    await expect(fire("activate")).resolves.toBeUndefined();
    expect(self.registration.unregister).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it("still unregisters and reloads when Cache Storage fails", async () => {
    const { fire, navigate, self } = retiringWorker();
    self.caches.keys.mockRejectedValueOnce(new DOMException("blocked", "SecurityError"));
    await fire("activate");
    expect(self.caches.delete).not.toHaveBeenCalled();
    expect(self.registration.unregister).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(2);
  });
});

describe("applyPreviewWorker (scripts/preview-service-worker.ts)", () => {
  const SW = "/build/dist/sw.js";
  const files = (exists: boolean) => ({ exists: vi.fn(() => exists), write: vi.fn() });

  it("replaces the built worker with the retiring one on a preview", () => {
    const io = files(true);
    expect(applyPreviewWorker({ VERCEL_ENV: "preview" }, SW, io)).toEqual({ code: 0, message: expect.stringContaining("now unregisters itself") });
    expect(io.exists).toHaveBeenCalledWith(SW);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(SW, RETIRING_SERVICE_WORKER);
  });

  it("leaves the production worker alone in production and outside Vercel, without looking at the file", () => {
    for (const env of [{ VERCEL_ENV: "production" }, {}]) {
      const io = files(true);
      expect(applyPreviewWorker(env, SW, io)).toEqual({ code: 0, message: expect.stringContaining("stays the production worker") });
      expect(io.exists).not.toHaveBeenCalled();
      expect(io.write).not.toHaveBeenCalled();
    }
  });

  it("fails on a preview whose build wrote no worker, and writes nothing", () => {
    const io = files(false);
    expect(applyPreviewWorker({ VERCEL_ENV: "preview" }, SW, io)).toEqual({ code: 1, message: `preview-service-worker: ${SW} does not exist; did the build output move?` });
    expect(io.write).not.toHaveBeenCalled();
  });
});

describe("productionWorkerProblem (scripts/check-production-worker.ts)", () => {
  /** The shape of Workbox's generated worker, trimmed to the parts the check reads. */
  const PRECACHING_WORKER = `importScripts("sw-navigation-fallback.js");self.skipWaiting();e.precacheAndRoute([{url:"index.html",revision:"abc"}],{});`;

  it("passes the precaching worker", () => {
    expect(PRECACHING_WORKER).toContain(PRECACHE_CALL);
    expect(productionWorkerProblem(PRECACHING_WORKER)).toBeNull();
  });

  it("fails the preview's retiring worker", () => {
    expect(RETIRING_SERVICE_WORKER).toContain(RETIRING_WORKER_MARKER);
    expect(productionWorkerProblem(RETIRING_SERVICE_WORKER)).toMatch(/retiring worker/);
  });

  it("fails a worker that carries the retiring marker even beside a precache call", () => {
    expect(productionWorkerProblem(`${RETIRING_SERVICE_WORKER}\n${PRECACHING_WORKER}`)).toMatch(/retiring worker/);
  });

  it("fails a missing, empty or non-precaching worker", () => {
    expect(productionWorkerProblem(null)).toMatch(/missing/);
    expect(productionWorkerProblem("")).toMatch(/no Workbox precacheAndRoute/);
    expect(productionWorkerProblem("self.addEventListener('fetch', () => {});")).toMatch(/no Workbox precacheAndRoute/);
    // The bare name without the call is not enough.
    expect(productionWorkerProblem("// precacheAndRoute is gone")).toMatch(/no Workbox precacheAndRoute/);
  });
});
