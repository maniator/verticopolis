import { beforeEach, describe, expect, it } from "vitest";
import { CRASH_LOOP_PAGES } from "./crashMarker";
import {
  clearRustCrashes,
  countRustCrash,
  crashOutcome,
  heldAfterCrashes,
  RUST_CRASHES_KEY,
} from "./crashReload";

beforeEach(() => sessionStorage.clear());

describe("the tab's Rust crash count", () => {
  it("counts crashes on one build and holds the tab at the loop size", () => {
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(false);
    expect(countRustCrash(sessionStorage, "a")).toBe(1);
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(false);
    expect(countRustCrash(sessionStorage, "a")).toBe(CRASH_LOOP_PAGES);
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(true);
  });

  it("starts over on another build, and after a retry", () => {
    countRustCrash(sessionStorage, "a");
    countRustCrash(sessionStorage, "a");
    expect(heldAfterCrashes(sessionStorage, "b")).toBe(false);
    expect(countRustCrash(sessionStorage, "b")).toBe(1);
    countRustCrash(sessionStorage, "b");
    clearRustCrashes(sessionStorage);
    expect(heldAfterCrashes(sessionStorage, "b")).toBe(false);
  });

  it("reads an unreadable record as no crashes, and a count storage did not keep as null", () => {
    sessionStorage.setItem(RUST_CRASHES_KEY, "{not json");
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(false);
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
  it("reloads on Rust, then onto TypeScript, and stops where it cannot count or has no TypeScript", () => {
    expect(crashOutcome(1, false)).toBe("reload");
    expect(crashOutcome(CRASH_LOOP_PAGES, false)).toBe("reload-on-ts");
    expect(crashOutcome(CRASH_LOOP_PAGES + 1, false)).toBe("reload-on-ts");
    expect(crashOutcome(1, true)).toBe("reload");
    expect(crashOutcome(CRASH_LOOP_PAGES, true)).toBe("stop");
    expect(crashOutcome(null, false)).toBe("stop");
  });
});
