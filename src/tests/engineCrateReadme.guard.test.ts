import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The crate guide, `docs/engine-site/guides/crate.md`, is the docs site's
 * "Rust crate" page; the crate's own README, `engine-rs/CRATE_README.md`, is
 * the short page crates.io shows, pointing at the site (`engine-rs/README.md`
 * is the contributors' page). The guide's quick start is a copy of
 * `engine-rs/consumer/examples/quick_start.rs`, which the consumer job in
 * `engine-rs.yml` compiles and lints (`cargo clippy --all-targets`), so the
 * example a reader copies is one that builds. This guard keeps the two equal,
 * keeps the crate guide and the JavaScript guide linked both ways, and keeps
 * both READMEs pointing at their pages on the site.
 */
const root = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8").replace(/\r\n/g, "\n");
const crateGuide = read("docs/engine-site/guides/crate.md");
const example = read("engine-rs/consumer/examples/quick_start.rs");

/** The first fenced Rust block in `text`. */
function firstRustBlock(text: string): string | undefined {
  return /^```rust\n([\s\S]*?)^```$/m.exec(text)?.[1];
}

/** The example below its header: the leading `//!` lines and the blank line after them. */
function exampleBody(text: string): string {
  return text.replace(/^(?:\/\/!.*\n)+\n/, "");
}

describe("engine crate guide and README", () => {
  it("shows the quick start the consumer crate compiles", () => {
    const block = firstRustBlock(crateGuide);
    expect(block, "the crate guide has a ```rust quick start").toBeDefined();
    expect(example.startsWith("//!"), "quick_start.rs opens with its header").toBe(true);
    expect(block).toBe(exampleBody(example));
  });

  it("links the JavaScript guide and is linked from it", () => {
    expect(crateGuide).toContain("docs/engine-site/guides/javascript.md");
    expect(read("docs/engine-site/guides/javascript.md")).toContain("docs/engine-site/guides/crate.md");
    expect(read("engine-rs/README.md")).toContain("CRATE_README.md");
  });

  it("packages the repository's license with the crate", () => {
    expect(read("engine-rs/LICENSE")).toBe(read("LICENSE"));
    expect(read("engine-rs/Cargo.toml")).toMatch(/^include = \[.*"LICENSE".*\]$/m);
  });

  it("keeps both registry READMEs short and pointing at the docs site", () => {
    const crateReadme = read("engine-rs/CRATE_README.md");
    const packageReadme = read("packages/verticopolis-engine/README.md");
    expect(crateReadme).toContain("https://docs.verticopolis.com/crate/");
    expect(packageReadme).toContain("https://docs.verticopolis.com/javascript/");
    // The full guides live on the site; a README that grows back into one
    // belongs there instead.
    for (const [name, text] of [["CRATE_README.md", crateReadme], ["the package README", packageReadme]] as const) {
      expect(text.split("\n").length, name).toBeLessThan(80);
    }
  });
});
