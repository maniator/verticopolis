import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * The Rust engine follows the same prose rule as the TypeScript (CONTRIBUTING
 * "Conventions"): no em-dashes in comments, doc comments or strings. The
 * TypeScript side grandfathers its older comments; the Rust side has none, so
 * this guard holds it at zero. It walks `engine-rs/` (build output and the
 * generated package aside, see `guardFiles.ts`) and fails any `.rs` file with
 * an em-dash, naming each line. An en-dash in a numeric range (`2–5`) is
 * allowed, as in the TypeScript.
 */

const EM_DASH = "\u2014";

describe("Rust prose guard", () => {
  const files = sourceFiles("engine-rs", [".rs"]);

  it("finds the Rust sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no Rust file carries an em-dash", () => {
    const hits: string[] = [];
    for (const abs of files) {
      readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (line.includes(EM_DASH)) hits.push(`${repoRel(abs)}:${i + 1}`);
        });
    }
    expect(hits, `Use a comma, colon, parentheses or a new sentence instead of an em-dash:\n${hits.join("\n")}`).toEqual([]);
  });
});
