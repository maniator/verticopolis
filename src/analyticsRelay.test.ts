import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { DESKTOP_INGEST_URL, ingestEndpoint, relayFetchInit } from "./analyticsRelay";

const RELAY_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "./analyticsRelay.ts");

/** The relative path the web, TWA, and iOS builds have always posted to. */
const WEB_PATH = "/api/ingest";

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

/**
 * The desktop split (issue #781): where one build posts, and how the `fetch`
 * fallback has to be shaped to survive a route that answers `OPTIONS` with 405.
 *
 * Both are pure, mode-taking helpers because under vitest `import.meta.env.MODE`
 * is always `"test"`, so nothing driven only through the live read could ever be
 * shown to pick the desktop URL. That the LIVE path feeds the real mode into both
 * is pinned against the source text at the bottom of this file.
 */
describe("ingestEndpoint", () => {
  it("keeps the unchanged relative path for the web build, and never an absolute URL", () => {
    for (const mode of ["production", "development", "test", "native", "staging"]) {
      expect(ingestEndpoint(mode), `${mode} must post to the relative path`).toBe(WEB_PATH);
      expect(ingestEndpoint(mode)).not.toMatch(/^https?:\/\//);
    }
  });

  it("posts the desktop build to one absolute URL, and never the relative path", () => {
    expect(ingestEndpoint("desktop")).toBe(DESKTOP_INGEST_URL);
    expect(ingestEndpoint("desktop")).not.toBe(WEB_PATH);
    expect(ingestEndpoint("desktop")).toMatch(/^https:\/\//);
  });

  it("names the production domain and the desktop route the server actually serves", () => {
    // Its server half is `POST /api/ingest/desktop` (api/ingest/desktop.ts), and
    // the shell's network allowlist is pinned to this exact URL by full prefix.
    // A typo here is a build that reports nothing and cannot say why.
    expect(DESKTOP_INGEST_URL).toBe("https://verticopolis.com/api/ingest/desktop");
  });
});

describe("relayFetchInit", () => {
  it("keeps the web fallback exactly as it was: POST + keepalive, no mode, no headers", () => {
    const init = relayFetchInit("production", "{}");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe("{}");
    expect(init.mode, "the web request must stay a plain same-origin POST").toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("sends the desktop fallback no-cors and sets NO content-type", () => {
    // The desktop route sends no CORS headers and answers OPTIONS with 405
    // (#791), so anything that triggers a preflight never arrives. A JSON
    // content-type or any custom header would do exactly that.
    const init = relayFetchInit("desktop", "{}");
    expect(init.mode).toBe("no-cors");
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers, "any header at all would preflight this route away").toBeUndefined();
  });
});

describe("the live endpoint choice, checked in the source", () => {
  // Asserted against the SOURCE TEXT, and that is the point: the runner's mode
  // is always "test", so `postToRelay` could hardcode the web path and every
  // behavioral test above would still pass while no desktop build ever reported.
  // The same technique platform.test.ts and analyticsEnrichment.test.ts use.
  const source = readFileSync(RELAY_SOURCE, "utf8");

  it("the source was actually read", () => {
    expect(source, "the source file could not be read, so these tests prove nothing").toContain("postToRelay");
  });

  it("postToRelay resolves the endpoint from the REAL build mode", () => {
    const body = /function postToRelay\([\s\S]*?\n\}/.exec(source);
    expect(body, "could not find postToRelay in the source").not.toBeNull();
    expect(body![0], "the mode must come from the live build mode").toContain("import.meta.env.MODE");
    expect(body![0]).toContain("ingestEndpoint(mode)");
    expect(body![0]).toContain("relayFetchInit(mode, body)");
    // Both transports must use the SAME resolved endpoint, or a beacon and its
    // fetch fallback would post to different places.
    expect(body![0]).toContain("navigator.sendBeacon(endpoint, body)");
    expect(body![0]).toContain("fetch(endpoint,");
    // And no literal path may be left behind in the send path.
    expect(body![0], "the relative path must not be hardcoded in the send path").not.toContain('"/api/ingest"');
  });
});
