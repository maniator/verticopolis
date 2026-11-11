import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

/** The engine crate's version in a Cargo.lock that pins it. */
function lockedEngine(lock: string): string | undefined {
  return /name = "verticopolis-engine"\nversion = "([^"]*)"/.exec(lock.replace(/\r\n/g, "\n"))?.[1];
}

describe("the bench's lockfile", () => {
  // engine-bench builds with --locked, so a lockfile left on an older engine
  // version fails its job. The release script raises it with the others.
  it("pins the engine crate at the version engine-rs/Cargo.toml states", () => {
    const crate = /\[package\][^[]*?\nversion = "([^"]*)"/.exec(read("engine-rs/Cargo.toml"))?.[1];
    expect(crate).toBeDefined();
    expect(lockedEngine(read("engine-bench/Cargo.lock"))).toBe(crate);
  });
});
