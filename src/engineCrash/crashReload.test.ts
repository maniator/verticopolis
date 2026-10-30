import { beforeEach, describe, expect, it } from "vitest";
import {
  CRASH_LOOP_PAGES,
  countRustCrash,
  crashOutcome,
  crashReportDue,
  markCrashReportShown,
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

describe("the crash report the tab owes", () => {
  const facts = { reason: "trap-tick", stage: "start", rust: { version: "0.21.0", sourceHash: "c".repeat(64) } };

  it("is due once the crashes are spent, with the latest crash's facts, until it is shown", () => {
    countRustCrash(sessionStorage, "a", { ...facts, stage: "first" });
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    countRustCrash(sessionStorage, "a", facts);
    expect(crashReportDue(sessionStorage, "a")).toEqual({ count: CRASH_LOOP_PAGES, last: facts });
    expect(markCrashReportShown(sessionStorage, "a")).toBe(true);
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    // The reloads stay spent: the mark only retires the report.
    expect(spent("a")).toBe(true);
  });

  it("is not due on another build, without kept facts, or with facts of the wrong shape", () => {
    countRustCrash(sessionStorage, "a", facts);
    countRustCrash(sessionStorage, "a", facts);
    expect(crashReportDue(sessionStorage, "b")).toBeNull();
    expect(markCrashReportShown(sessionStorage, "b")).toBe(false);
    sessionStorage.clear();
    countRustCrash(sessionStorage, "a");
    countRustCrash(sessionStorage, "a");
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    sessionStorage.setItem(RUST_CRASHES_KEY, JSON.stringify({ v: 1, sha: "a", count: 2, last: { ...facts, rust: { version: 3, sourceHash: null } } }));
    expect(crashReportDue(sessionStorage, "a")).toBeNull();
    expect(spent("a")).toBe(true);
  });
});
