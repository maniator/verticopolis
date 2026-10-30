import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cargoVersion } from "../build/engineCompat";

/**
 * `engine-rs/CHANGELOG.md` keeps one `## <version>` section per engine crate
 * version, and a crate bump (the same rule as `engineCompat.guard.test.ts`,
 * CONTRIBUTING.md "The engine crate version") adds its section in the same PR.
 * This guard fails when the crate's current version has none.
 */
const root = resolve(__dirname, "..", "..");
const changelog = readFileSync(resolve(root, "engine-rs/CHANGELOG.md"), "utf8");
const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]!);

describe("engine changelog", () => {
  it("has a section for the crate's current version", () => {
    const version = cargoVersion(readFileSync(resolve(root, "engine-rs/Cargo.toml"), "utf8"));
    expect(versions, `engine-rs/CHANGELOG.md needs a "## ${version}" section for the crate version in Cargo.toml`).toContain(version);
  });

  it("lists each version once, newest first", () => {
    expect(new Set(versions).size).toBe(versions.length);
    const key = (v: string) => v.split(".").map(Number);
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [key(versions[i - 1]!), key(versions[i]!)];
      const newer = a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
      expect(newer, `${versions[i - 1]} before ${versions[i]}`).toBeGreaterThan(0);
    }
  });
});
