import { beforeEach, describe, expect, it } from "vitest";
import type { EngineBootFailure, PackageFailure } from "@verticopolis/components/host/engineBoot";
import { MISMATCH_RELOAD_KEY, claimMismatchReload, engineFilesFromAnotherBuild } from "./mismatchReload";

beforeEach(() => sessionStorage.clear());

const detail = { file: "wasm", expected: "111111111111", found: "222222222222", expectedPackage: "aaaaaaaaaaaa", servedPackage: "bbbbbbbbbbbb", controlled: false } as const;

/** A load refused because the files are from another build, on a page no worker controls. */
function mismatch(kind: PackageFailure["kind"] = "mismatch", controlled = false): EngineBootFailure {
  return { stage: "load", reason: "package-mismatch", message: "m", package: { ...detail, kind, controlled } };
}

const stored = () => JSON.parse(sessionStorage.getItem(MISMATCH_RELOAD_KEY) ?? "null") as unknown;

describe("engine files from another build", () => {
  it("is a load the byte check refused as another build's files", () => {
    expect(engineFilesFromAnotherBuild(mismatch())).toBe(true);
  });

  it("is not a page a service worker controls, which a reload would hand the same pair", () => {
    expect(engineFilesFromAnotherBuild(mismatch("mismatch", true))).toBe(false);
  });

  it("is not a file that did not arrive, a link error, a package that cannot save, or a later stage", () => {
    expect(engineFilesFromAnotherBuild(mismatch("load-failed"))).toBe(false);
    expect(engineFilesFromAnotherBuild({ stage: "load", reason: "package-mismatch", message: "import mismatch" })).toBe(false);
    expect(engineFilesFromAnotherBuild({ ...mismatch(), cause: "no-save-writer" })).toBe(false);
    expect(engineFilesFromAnotherBuild({ ...mismatch(), stage: "start" })).toBe(false);
    expect(engineFilesFromAnotherBuild({ ...mismatch(), reason: "boot-error" })).toBe(false);
  });
});

describe("the tab's one reload for matching files", () => {
  it("reloads once per build, and again only for another build", () => {
    expect(claimMismatchReload(sessionStorage, "a", mismatch())).toBe(true);
    expect(stored()).toEqual(["a"]);
    expect(claimMismatchReload(sessionStorage, "a", mismatch())).toBe(false);
    expect(claimMismatchReload(sessionStorage, "b", mismatch())).toBe(true);
    expect(claimMismatchReload(sessionStorage, "b", mismatch())).toBe(false);
    expect(stored()).toEqual(["a", "b"]);
  });

  it("never reloads again for a build that comes back after another one", () => {
    expect(claimMismatchReload(sessionStorage, "a", mismatch())).toBe(true);
    expect(claimMismatchReload(sessionStorage, "b", mismatch())).toBe(true);
    expect(claimMismatchReload(sessionStorage, "a", mismatch())).toBe(false);
    expect(claimMismatchReload(sessionStorage, "b", mismatch())).toBe(false);
  });

  it("reads a stored value it cannot use as spent", () => {
    for (const bad of ["a", "{}", "[1]", "not json", JSON.stringify(Array.from({ length: 16 }, (_, i) => `b${i}`))]) {
      sessionStorage.setItem(MISMATCH_RELOAD_KEY, bad);
      expect(claimMismatchReload(sessionStorage, "z", mismatch()), bad).toBe(false);
    }
  });

  it("never reloads for a failure a fresh copy does not change, and spends nothing on it", () => {
    expect(claimMismatchReload(sessionStorage, "a", mismatch("load-failed"))).toBe(false);
    expect(claimMismatchReload(sessionStorage, "a", mismatch("mismatch", true))).toBe(false);
    expect(sessionStorage.getItem(MISMATCH_RELOAD_KEY)).toBeNull();
  });

  it("never reloads when the tab cannot remember it did", () => {
    expect(claimMismatchReload(null, "a", mismatch())).toBe(false);
    const throws = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(claimMismatchReload(throws, "a", mismatch())).toBe(false);
    const forgets = { getItem: () => null, setItem: () => {} };
    expect(claimMismatchReload(forgets, "a", mismatch())).toBe(false);
  });
});
