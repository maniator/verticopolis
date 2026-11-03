import { beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_LOOP_PAGES,
  countRustCrash,
  crashOutcome,
  crashReloadsSpent,
  RUST_CRASHES_KEY,
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
