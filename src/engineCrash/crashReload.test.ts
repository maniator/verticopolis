import { beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_FRESH_CROWD_KEY,
  CRASH_LOOP_PAGES,
  countRustCrash,
  crashOutcome,
  crashReloadsSpent,
  markCrashReload,
  RUST_CRASHES_KEY,
  takeCrashReload,
  withoutSavedPeople,
} from "./crashReload";

beforeEach(() => sessionStorage.clear());

/** Whether the tab's stored crashes on `sha` have spent its reloads. */
function spent(sha: string): boolean {
  try {
    const record = JSON.parse(sessionStorage.getItem(RUST_CRASHES_KEY) ?? "null") as { sha?: string; count?: number } | null;
    return record?.sha === sha && crashReloadsSpent(record.count ?? 0);
  } catch {
    return false;
  }
}

describe("the tab's Rust crash count", () => {
  it("counts crashes on one build and spends the tab's reloads at the loop size", () => {
    expect(spent("a")).toBe(false);
    expect(countRustCrash(sessionStorage, "a")).toBe(1);
    expect(spent("a")).toBe(false);
    expect(countRustCrash(sessionStorage, "a")).toBe(CRASH_LOOP_PAGES);
    expect(spent("a")).toBe(true);
  });

  it("starts over on another build, and in a new tab", () => {
    countRustCrash(sessionStorage, "a");
    countRustCrash(sessionStorage, "a");
    expect(spent("b")).toBe(false);
    expect(countRustCrash(sessionStorage, "b")).toBe(1);
    countRustCrash(sessionStorage, "b");
    sessionStorage.clear();
    expect(spent("b")).toBe(false);
  });

  it("counts on from a record an older build wrote with crash facts and a shown mark", () => {
    sessionStorage.setItem(RUST_CRASHES_KEY, JSON.stringify({ v: 1, sha: "a", count: 1, last: { reason: "trap-tick", stage: "start", rust: { version: null, sourceHash: null } }, reportShown: true }));
    expect(countRustCrash(sessionStorage, "a")).toBe(CRASH_LOOP_PAGES);
    expect(JSON.parse(sessionStorage.getItem(RUST_CRASHES_KEY)!)).toEqual({ v: 1, sha: "a", count: CRASH_LOOP_PAGES });
  });

  it("reads an unreadable record as no crashes, and a count storage did not keep as null", () => {
    sessionStorage.setItem(RUST_CRASHES_KEY, "{not json");
    expect(spent("a")).toBe(false);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(countRustCrash(full, "a")).toBeNull();
    expect(countRustCrash(null, "a")).toBeNull();
  });
});

describe("what a crash does", () => {
  it("reloads on the first crash, and stops once the tab's reloads are spent or the count was not kept", () => {
    expect(crashOutcome(1)).toBe("reload");
    expect(crashOutcome(CRASH_LOOP_PAGES)).toBe("stop");
    expect(crashOutcome(CRASH_LOOP_PAGES + 1)).toBe("stop");
    expect(crashOutcome(null)).toBe("stop");
  });
});

describe("the boot after a crash reload (#2209)", () => {
  it("is asked for once: the request is taken by the next boot only", () => {
    expect(takeCrashReload(sessionStorage)).toBe(false);
    markCrashReload(sessionStorage);
    expect(sessionStorage.getItem(CRASH_FRESH_CROWD_KEY)).toBe("true");
    expect(takeCrashReload(sessionStorage)).toBe(true);
    expect(takeCrashReload(sessionStorage)).toBe(false);
  });

  it("reads no request where storage is missing or throws", () => {
    expect(takeCrashReload(null)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => markCrashReload(throwing)).not.toThrow();
    expect(takeCrashReload(throwing)).toBe(false);
  });

  it("drops the people and the cars' timers from a save and keeps the rest", () => {
    const save = { version: 10, money: 5, crowd: { people: [{ id: 1 }] }, dispatch: { cars: [] }, housekeeping: { cleanedToday: 3 } };
    expect(JSON.parse(withoutSavedPeople(JSON.stringify(save)))).toEqual({ version: 10, money: 5, housekeeping: { cleanedToday: 3 } });
  });

  it("leaves text that is not a save object, or has no people, as it was", () => {
    for (const text of ["not json", "[1,2]", "null", "3", '{"money": 5}']) {
      expect(withoutSavedPeople(text)).toBe(text);
    }
  });
});
