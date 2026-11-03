import { describe, it, expect, vi } from "vitest";
import {
  browserStorage,
  MAP_OPEN_STORAGE_KEY,
  MAP_OPEN_VALUE,
  mapOpenByDefault,
  mapStartsOpen,
  rememberMapOpen,
  storedMapOpen,
  type MapLayoutClass,
} from "./overviewMapPrefs";

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
};

const LAYOUTS: MapLayoutClass[] = ["desktop", "phone"];

describe("map open preference", () => {
  it("opens by default on desktop and stays closed by default on phone", () => {
    expect(mapOpenByDefault("desktop")).toBe(true);
    expect(mapOpenByDefault("phone")).toBe(false);
    const s = memory();
    for (const l of LAYOUTS) expect(mapStartsOpen(s, l)).toBe(mapOpenByDefault(l));
  });

  it("never writes the default: a fresh start stores nothing", () => {
    const s = memory();
    for (const l of LAYOUTS) mapStartsOpen(s, l);
    expect(s.data.size).toBe(0);
  });

  it("remembers an explicit close on desktop and an explicit open on phone", () => {
    const s = memory();
    expect(rememberMapOpen(s, "desktop", false)).toBe(true);
    expect(rememberMapOpen(s, "phone", true)).toBe(true);
    expect(mapStartsOpen(s, "desktop")).toBe(false);
    expect(mapStartsOpen(s, "phone")).toBe(true);
    expect(s.data.get(MAP_OPEN_STORAGE_KEY.desktop)).toBe(MAP_OPEN_VALUE.closed);
  });

  it("keeps desktop and phone independent", () => {
    const s = memory();
    rememberMapOpen(s, "phone", false);
    expect(mapStartsOpen(s, "desktop")).toBe(true);
    rememberMapOpen(s, "desktop", false);
    rememberMapOpen(s, "phone", true);
    expect(mapStartsOpen(s, "desktop")).toBe(false);
    expect(MAP_OPEN_STORAGE_KEY.desktop).not.toBe(MAP_OPEN_STORAGE_KEY.phone);
  });

  it("falls back to the layout default when storage is missing, throws or holds something else", () => {
    for (const l of LAYOUTS) {
      expect(mapStartsOpen(null, l)).toBe(mapOpenByDefault(l));
      expect(mapStartsOpen(undefined, l)).toBe(mapOpenByDefault(l));
      expect(() => mapStartsOpen(throwing, l)).not.toThrow();
      expect(mapStartsOpen(throwing, l)).toBe(mapOpenByDefault(l));
      expect(rememberMapOpen(throwing, l, true)).toBe(false);
      expect(rememberMapOpen(null, l, true)).toBe(false);
    }
    const s = memory();
    s.setItem(MAP_OPEN_STORAGE_KEY.desktop, "1");
    expect(storedMapOpen(s, "desktop")).toBeNull();
    expect(mapStartsOpen(s, "desktop")).toBe(true);
  });

  it("adopts the other layout's own choice or default when a resize crosses the breakpoint", () => {
    const s = memory();
    // A player on desktop closes the Map, then the window narrows to the phone layout.
    rememberMapOpen(s, "desktop", false);
    expect(mapStartsOpen(s, "phone")).toBe(false);
    // They open it on the phone layout, then widen back to desktop: desktop keeps its close.
    rememberMapOpen(s, "phone", true);
    expect(mapStartsOpen(s, "desktop")).toBe(false);
    expect(mapStartsOpen(s, "phone")).toBe(true);
  });

  it("gets the browser's storage, or null where reading it throws", () => {
    expect(browserStorage()).toBe(window.localStorage);
    const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    try {
      expect(browserStorage()).toBeNull();
      expect(mapStartsOpen(browserStorage(), "desktop")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
