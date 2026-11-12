import { describe, it, expect, vi } from "vitest";
import { isPreviewDeploy, RETIRING_SERVICE_WORKER } from "./previewDeploy";

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
