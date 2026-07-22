import { afterEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";

/** Parse the JSON body handed to a transport spy (sendBeacon or fetch). */
function bodyOf(arg: unknown): { event: string; properties: unknown; session: string; ts: string } {
  return JSON.parse(String(arg));
}

describe("sendToRelay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("beacons the typed event to /api/ingest with an in-memory session id", () => {
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

  it("shares one in-memory session id across events, and never persists it", () => {
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    sendToRelay("game_started", { mode: "modern" });
    sendToRelay("first_build", { tool: "office" });
    const first = bodyOf(beacon.mock.calls[0][1]).session;
    const second = bodyOf(beacon.mock.calls[1][1]).session;
    expect(first).toBe(second); // stable within the session
    // Cookieless / memory-persistence: nothing about the id is written to storage.
    expect(localStorage.getItem("session")).toBeNull();
    expect(document.cookie).toBe("");
  });

  it("falls back to fetch with keepalive when sendBeacon is unavailable", () => {
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

  it("falls back to fetch when there is no navigator at all (non-browser context)", () => {
    vi.stubGlobal("navigator", undefined);
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
    sendToRelay("boot", {});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to fetch when sendBeacon cannot queue the payload (returns false)", () => {
    const beacon = vi.fn((_path: string, _body?: BodyInit) => false); // buffer full
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.resolve(new Response(null)));
    vi.stubGlobal("fetch", fetchSpy);
    sendToRelay("boot", {});
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // the beacon could not queue it
  });

  it("swallows a rejected fetch so it never becomes an unhandled rejection", async () => {
    vi.stubGlobal("navigator", {}); // force the fetch path
    const fetchSpy = vi.fn((_path: string, _init?: RequestInit) => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => sendToRelay("boot", {})).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Let the rejected promise settle; the internal .catch must absorb it.
    await Promise.resolve();
  });

  it("drops an unserializable payload without sending or throwing", () => {
    const beacon = vi.fn((_path: string, _body?: BodyInit) => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    // A BigInt is not valid JSON, so JSON.stringify throws; the event is dropped.
    const bad = { n: 1n } as unknown as Record<string, number>;
    expect(() => sendToRelay("boot", bad)).not.toThrow();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("never throws when the transport fails", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("beacon down");
      },
    });
    expect(() => sendToRelay("boot", {})).not.toThrow();
  });
});
