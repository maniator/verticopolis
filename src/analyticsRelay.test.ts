import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Parse the JSON body handed to a transport spy (sendBeacon or fetch). */
function bodyOf(arg: unknown): { event: string; properties: unknown; session: string; ts: string } {
  return JSON.parse(String(arg));
}

/**
 * Load a FRESH copy of the module so its in-memory session memo starts empty,
 * mirroring a new page load. Tests control `sessionStorage` around a reload
 * (kept) versus a new tab (cleared) to exercise session-id continuity.
 */
async function load(): Promise<typeof import("./analyticsRelay")> {
  vi.resetModules();
  return import("./analyticsRelay");
}

const SESSION_KEY = "vc-analytics-session";

describe("sendToRelay", () => {
  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("beacons the typed event to /api/ingest with a session id", async () => {
    const { sendToRelay } = await load();
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    sendToRelay("star_reached", { star: 3 });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [path, raw] = beacon.mock.calls[0];
    expect(path).toBe("/api/ingest");
    const body = bodyOf(raw);
    expect(body.event).toBe("star_reached");
    expect(body.properties).toEqual({ star: 3 });
    expect(typeof body.session).toBe("string");
    expect(body.session.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(body.ts))).toBe(true); // an ISO timestamp
  });

  it("shares one session id across events, cached in sessionStorage (never cookie or localStorage)", async () => {
    const { sendToRelay } = await load();
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    sendToRelay("game_started", { mode: "modern" });
    sendToRelay("first_build", { tool: "office" });
    const first = bodyOf(beacon.mock.calls[0][1]).session;
    const second = bodyOf(beacon.mock.calls[1][1]).session;
    expect(first).toBe(second); // stable within the session
    // Cached in sessionStorage so a reload continues the session...
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(first);
    // ...but never in a cookie or localStorage: cookieless, no cross-session id.
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(document.cookie).toBe("");
  });

  it("keeps the SAME session id across a reload within the tab (sessionStorage survives)", async () => {
    // First page load of the tab: mint + persist an id.
    const first = await load();
    const beacon1 = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon1 });
    first.sendToRelay("boot", { reason: "fresh" });
    const idBefore = bodyOf(beacon1.mock.calls[0][1]).session;

    // A reload (an "Update now" / WebGL-recovery resume reload, or a manual
    // refresh): the module re-initializes (memo cleared) but sessionStorage is
    // untouched, so the same play session continues under one id.
    const reloaded = await load();
    const beacon2 = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon2 });
    reloaded.sendToRelay("boot", { reason: "update" });
    const idAfter = bodyOf(beacon2.mock.calls[0][1]).session;

    expect(idAfter).toBe(idBefore); // one continuous session across the reload
  });

  it("starts a FRESH session id in a new tab (sessionStorage cleared)", async () => {
    const first = await load();
    const beacon1 = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon1 });
    first.sendToRelay("boot", {});
    const idTabA = bodyOf(beacon1.mock.calls[0][1]).session;

    // A new tab: fresh module AND empty sessionStorage (not shared across tabs).
    sessionStorage.clear();
    const second = await load();
    const beacon2 = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon2 });
    second.sendToRelay("boot", {});
    const idTabB = bodyOf(beacon2.mock.calls[0][1]).session;

    expect(idTabB).not.toBe(idTabA); // no cross-tab / cross-session identity
  });

  it("still sends (in-memory id) when sessionStorage throws, as in private mode", async () => {
    const { sendToRelay } = await load();
    // Private-mode storage: getItem/setItem throw. The send path must degrade to
    // a working in-memory id, never break.
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      clear: () => {},
    });
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    expect(() => sendToRelay("boot", {})).not.toThrow();
    expect(beacon).toHaveBeenCalledTimes(1);
    const body = bodyOf(beacon.mock.calls[0][1]);
    expect(typeof body.session).toBe("string");
    expect(body.session.length).toBeGreaterThan(0);
  });

  it("falls back to fetch with keepalive when sendBeacon is unavailable", async () => {
    const { sendToRelay } = await load();
    vi.stubGlobal("navigator", {}); // no sendBeacon on this navigator
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
    sendToRelay("boot", { version: "1.81.0" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [path, init] = fetchSpy.mock.calls[0];
    expect(path).toBe("/api/ingest");
    expect(init?.method).toBe("POST");
    expect(init?.keepalive).toBe(true);
    expect(bodyOf(init?.body).event).toBe("boot");
  });

  it("falls back to fetch when there is no navigator at all (non-browser context)", async () => {
    const { sendToRelay } = await load();
    vi.stubGlobal("navigator", undefined);
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
    sendToRelay("boot", {});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to fetch when sendBeacon cannot queue the payload (returns false)", async () => {
    const { sendToRelay } = await load();
    const beacon = vi.fn((_path: string, _body?: BodyInit) => false); // buffer full
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
    sendToRelay("boot", {});
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the beacon could not queue it
  });

  it("swallows a rejected fetch so it never becomes an unhandled rejection", async () => {
    const { sendToRelay } = await load();
    vi.stubGlobal("navigator", {}); // force the fetch path
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => sendToRelay("boot", {})).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Let the rejected promise settle; the internal .catch must absorb it.
    await Promise.resolve();
  });

  it("drops an unserializable payload without sending or throwing", async () => {
    const { sendToRelay } = await load();
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    // A BigInt is not valid JSON, so JSON.stringify throws; the event is dropped.
    const bad = { n: 1n } as unknown as Record<string, number>;
    expect(() => sendToRelay("boot", bad)).not.toThrow();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("never throws when the transport fails", async () => {
    const { sendToRelay } = await load();
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("beacon down");
      },
    });
    expect(() => sendToRelay("boot", {})).not.toThrow();
  });
});
