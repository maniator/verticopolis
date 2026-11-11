import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The engine crate's own README, `engine-rs/CRATE_README.md`, is the page a
 * registry release of the crate will show (`engine-rs/README.md` is the
 * contributors' page). Its quick start is a copy of
 * `engine-rs/consumer/examples/quick_start.rs`, which the consumer job in
 * `engine-rs.yml` compiles and lints (`cargo clippy --all-targets`), so the
 * example a reader copies is one that builds. This guard keeps the two equal,
 * and keeps the crate README linked from the package README and back.
 */
const root = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const crateReadme = read("engine-rs/CRATE_README.md");
const example = read("engine-rs/consumer/examples/quick_start.rs");

/** The first fenced Rust block in `text`. */
function firstRustBlock(text: string): string | undefined {
  return /^```rust\n([\s\S]*?)^```$/m.exec(text)?.[1];
}

/** The example below its header: the leading `//!` lines and the blank line after them. */
function exampleBody(text: string): string {
  return text.replace(/^(?:\/\/!.*\n)+\n/, "");
}

describe("engine crate README", () => {
  it("shows the quick start the consumer crate compiles", () => {
    const block = firstRustBlock(crateReadme);
    expect(block, "CRATE_README.md has a ```rust quick start").toBeDefined();
    expect(example.startsWith("//!"), "quick_start.rs opens with its header").toBe(true);
    expect(block).toBe(exampleBody(example));
  });

  it("links the package README and is linked from it", () => {
    expect(crateReadme).toContain("packages/verticopolis-engine/README.md");
    expect(read("packages/verticopolis-engine/README.md")).toContain("engine-rs/CRATE_README.md");
    expect(read("engine-rs/README.md")).toContain("CRATE_README.md");
  });
});
