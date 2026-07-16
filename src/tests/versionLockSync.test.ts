import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * package.json / package-lock.json version-sync guard.
 *
 * `npm version` bumps both files, but a hand-edit of package.json's `version`
 * alone leaves the lockfile stale, which breaks `npm ci` and misreports the
 * build (the splash and the update flow both read the version). This fails CI
 * the moment the two drift, so a version bump can never land without its
 * lockfile being updated in lockstep.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version: string };
const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8")) as {
  version: string;
  packages?: Record<string, { version?: string }>;
};

describe("package.json / package-lock.json version sync", () => {
  it("uses a modern lockfile with a root package entry", () => {
    // Guard so the assertions below fail legibly rather than throwing on an
    // undefined `packages[""]` if the lockfile were ever regenerated as the
    // legacy lockfileVersion 1 (npm 6), which has no `packages` map.
    expect(lock.packages?.[""]).toBeDefined();
  });

  it("the lockfile's top-level version matches package.json", () => {
    expect(lock.version).toBe(pkg.version);
  });

  it("the lockfile's root package entry (\"\") version matches package.json", () => {
    expect(lock.packages?.[""]?.version).toBe(pkg.version);
  });
});
