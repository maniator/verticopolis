import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_MS, STALE_MS, crashLoopFound } from "./crashMarker";
import { watchSurvival } from "./survival";
import { BOOT_MARKER_KEY, readMarker, type KeyValueStore } from "./records";

const page = { id: "me", sha: "a" };

function store(): KeyValueStore & { data: Map<string, string> } {
  const entries = [
    { id: "me", sha: "a", beat: 0 },
    { id: "other", sha: "a", beat: 0 },
  ];
  const data = new Map<string, string>([[BOOT_MARKER_KEY, JSON.stringify({ v: 1, entries })]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const ids = (s: KeyValueStore) => {
  const r = readMarker(s);
  return r.ok ? r.value.entries.map((e) => e.id).sort() : [];
};
const beatOf = (s: KeyValueStore, id: string) => {
  const r = readMarker(s);
  return r.ok ? r.value.entries.find((e) => e.id === id)?.beat : undefined;
};

function setVisibility(v: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("watchSurvival", () => {
  it("removes the entry of a page that starts hidden, and adds it when the page is shown", () => {
    vi.useFakeTimers({ now: 5_000 });
    const s = store();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    watchSurvival(s, page);
    expect(ids(s)).toEqual(["other"]);
    setVisibility("visible");
    expect(ids(s)).toEqual(["me", "other"]);
  });

  it("keeps an earlier page life's stale entry when it starts hidden, so that crash still counts", () => {
    vi.useFakeTimers({ now: 100_000 });
    const s = store();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    watchSurvival(s, page);
    expect(ids(s)).toEqual(["other"]);
    expect(beatOf(s, "other")).toBe(0);
  });

  it("beats when the page comes back from the back-forward cache", () => {
    vi.useFakeTimers({ now: 5_000 });
    const s = store();
    watchSurvival(s, page);
    vi.setSystemTime(7_000);
    window.dispatchEvent(new Event("pageshow"));
    expect(beatOf(s, "me")).toBe(7_000);
  });

  it("refreshes the heartbeat while the page is visible", () => {
    vi.useFakeTimers({ now: 5_000 });
    const s = store();
    watchSurvival(s, page);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(beatOf(s, "me")).toBe(5_000 + HEARTBEAT_MS);
    expect(beatOf(s, "other")).toBe(0);
  });

  it("removes only its own entry when the page is hidden, and adds it back when visible", () => {
    vi.useFakeTimers({ now: 5_000 });
    const s = store();
    s.data.set(BOOT_MARKER_KEY, JSON.stringify({ v: 1, entries: [{ id: "me", sha: "a", beat: 5_000 }, { id: "other", sha: "a", beat: 5_000 }] }));
    watchSurvival(s, page);
    setVisibility("hidden");
    expect(ids(s)).toEqual(["other"]);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(ids(s)).toEqual(["other"]);
    setVisibility("visible");
    expect(ids(s)).toEqual(["me", "other"]);
  });

  it("removes its entry and this build's stale ones on pagehide after running visibly for STALE_MS", () => {
    vi.useFakeTimers({ now: 100_000 });
    const s = store();
    watchSurvival(s, page);
    vi.advanceTimersByTime(STALE_MS);
    window.dispatchEvent(new Event("pagehide"));
    expect(s.data.has(BOOT_MARKER_KEY)).toBe(false);
  });

  it("keeps earlier stale entries on a pagehide that came too soon to show the build runs", () => {
    vi.useFakeTimers({ now: 100_000 });
    const s = store();
    watchSurvival(s, page);
    vi.advanceTimersByTime(STALE_MS - HEARTBEAT_MS);
    window.dispatchEvent(new Event("pagehide"));
    expect(ids(s)).toEqual(["other"]);
  });

  it("keeps earlier stale entries when the page hides, so a page that hid and then crashed still counts", () => {
    vi.useFakeTimers({ now: 100_000 });
    const s = store();
    // "other" is a page life that died while visible: its heartbeat is stale.
    const stop = watchSurvival(s, page);
    setVisibility("hidden");
    expect(ids(s)).toEqual(["other"]);
    setVisibility("visible");
    // This page now dies while visible: it never reports a hide again.
    stop();
    vi.setSystemTime(100_000 + STALE_MS + 1);
    expect(crashLoopFound(s, { id: "next", sha: "a" }, Date.now())).toBe("loop");
  });

  it("counts visible time across hides toward the STALE_MS a clean pagehide needs", () => {
    vi.useFakeTimers({ now: 100_000 });
    const s = store();
    watchSurvival(s, page);
    vi.advanceTimersByTime(STALE_MS / 2);
    setVisibility("hidden");
    vi.advanceTimersByTime(STALE_MS * 4);
    setVisibility("visible");
    vi.advanceTimersByTime(STALE_MS / 2);
    window.dispatchEvent(new Event("pagehide"));
    expect(s.data.has(BOOT_MARKER_KEY)).toBe(false);
  });

  it("stops without touching the entry when told to", () => {
    vi.useFakeTimers({ now: 5_000 });
    const s = store();
    const stop = watchSurvival(s, page);
    // A visible page beats as soon as it starts watching.
    expect(beatOf(s, "me")).toBe(5_000);
    stop();
    setVisibility("hidden");
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(ids(s)).toEqual(["me", "other"]);
    expect(beatOf(s, "me")).toBe(5_000);
  });
});
