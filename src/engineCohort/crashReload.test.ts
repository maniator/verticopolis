import { beforeEach, describe, expect, it } from "vitest";
import { CRASH_LOOP_PAGES } from "./crashMarker";
import {
  clearRustCrashes,
  countRustCrash,
  crashOutcome,
  crashReportDue,
  markCrashReportShown,
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

describe("the crash report the tab owes", () => {
  const facts = { reason: "trap-tick", stage: "start", rust: { version: "0.21.0", sourceHash: "c".repeat(64) } };

  it("is due once the crashes are spent, with the latest crash's facts, until it is shown", () => {
    countRustCrash(sessionStorage, "a", { ...facts, stage: "first" });
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    countRustCrash(sessionStorage, "a", facts);
    expect(crashReportDue(sessionStorage, "a")).toEqual({ count: CRASH_LOOP_PAGES, last: facts });
    expect(markCrashReportShown(sessionStorage, "a")).toBe(true);
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    // The tab stays held: the mark only retires the report.
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(true);
  });

  it("is not due on another build, without kept facts, or with facts of the wrong shape", () => {
    countRustCrash(sessionStorage, "a", facts);
    countRustCrash(sessionStorage, "a", facts);
    expect(crashReportDue(sessionStorage, "b")).toBeNull();
    expect(markCrashReportShown(sessionStorage, "b")).toBe(false);
    clearRustCrashes(sessionStorage);
    countRustCrash(sessionStorage, "a");
    countRustCrash(sessionStorage, "a");
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    sessionStorage.setItem(RUST_CRASHES_KEY, JSON.stringify({ v: 1, sha: "a", count: 2, last: { ...facts, rust: { version: 3, sourceHash: null } } }));
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    expect(heldAfterCrashes(sessionStorage, "a")).toBe(true);
  });
});
