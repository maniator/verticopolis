import { describe, it, expect } from "vitest";
import { MAP_SPOT_STORAGE_KEY, rememberMapSpot, storedMapSpot } from "./overviewMapSpot";

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
  removeItem: (): void => {
    throw new Error("blocked");
  },
};

describe("the Map window's stored spot", () => {
  it("round-trips a spot per layout class, rounded to whole px", () => {
    const store = memory();
    expect(rememberMapSpot(store, "desktop", { x: 12.4, y: 300.6 })).toBe(true);
    expect(store.data.get(MAP_SPOT_STORAGE_KEY.desktop)).toBe("12,301");
    expect(storedMapSpot(store, "desktop")).toEqual({ x: 12, y: 301 });
    expect(storedMapSpot(store, "phone")).toBeNull();
  });

  it("forgets the spot on null", () => {
    const store = memory();
    rememberMapSpot(store, "phone", { x: 1, y: 2 });
    rememberMapSpot(store, "phone", null);
    expect(store.data.has(MAP_SPOT_STORAGE_KEY.phone)).toBe(false);
    expect(storedMapSpot(store, "phone")).toBeNull();
  });

  it.each(["", "12", "-5,4", "1.5,2", "a,b", "4,5,6", "123456,1"])("reads %j as nothing stored", (raw) => {
    const store = memory();
    store.data.set(MAP_SPOT_STORAGE_KEY.desktop, raw);
    expect(storedMapSpot(store, "desktop")).toBeNull();
  });

  it("treats missing or throwing storage as nothing stored, and drops the write", () => {
    expect(storedMapSpot(null, "desktop")).toBeNull();
    expect(storedMapSpot(throwing, "desktop")).toBeNull();
    expect(rememberMapSpot(null, "desktop", { x: 1, y: 1 })).toBe(false);
    expect(rememberMapSpot(throwing, "desktop", { x: 1, y: 1 })).toBe(false);
    expect(rememberMapSpot(throwing, "desktop", null)).toBe(false);
  });
});
